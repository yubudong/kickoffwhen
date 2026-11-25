import { createHash } from 'node:crypto';
import sharp,{type OutputInfo} from 'sharp';
import { and,asc,desc,eq,inArray,sql } from 'drizzle-orm';
import { z } from 'zod';
import { db,type DbTransaction } from '@/db/client';
import type { Actor,ChildActor,GuardianActor } from '@/modules/auth/actor';
import { children } from '@/modules/families/schema';
import { lockWallet } from '@/modules/engagement/wallet';
import { learningTasks } from '@/modules/dictation/task-schema';
import { todoTasks,todoSubmissions,todoReviews } from './schema';
import { homeworkUploads,homeworkPages,homeworkSubmissionDetails,homeworkReviewDrafts,homeworkReviewSnapshots } from './homework-schema';
import { homeworkReviewSchema,homeworkSubmitSchema,homeworkDocumentText,validateReviewDocument,type HomeworkSubmit,type HomeworkReviewCommand,type HomeworkPage,type HomeworkRound,type HomeworkView,type CorrectionTask } from './homework-types';
import { createTodoService } from './service';
import { saveAttachment,removeAttachment } from './attachments';
import { attachmentType,MAX_ATTACHMENT_BYTES } from './validation';
type Database=typeof db|DbTransaction;
const uuid=z.string().uuid(),hash=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export function createHomeworkService(database:Database=db){
 function scope(actor:Actor,id:string){return and(eq(todoTasks.id,id),eq(todoTasks.familyId,actor.familyId),actor.role==='child'?eq(todoTasks.childId,actor.childId):undefined)}
 async function task(actor:Actor,raw:string,tx:Database=database,lock=false){
  const id=uuid.parse(raw);const [row]=await tx.select().from(todoTasks).where(scope(actor,id)).limit(1);if(!row)throw new Error('TODO_NOT_FOUND');
  if(lock){await lockWallet(tx as DbTransaction,row);const [locked]=await (tx as DbTransaction).select().from(todoTasks).where(scope(actor,id)).for('update');if(!locked)throw new Error('TODO_NOT_FOUND');return locked}return row;
 }
 async function rounds(id:string,tx:Database=database):Promise<HomeworkRound[]>{
  const submissions=await tx.select().from(todoSubmissions).where(eq(todoSubmissions.todoId,id)).orderBy(asc(todoSubmissions.number));
  if(!submissions.length)return [];
  const ids=submissions.map(s=>s.id);const pages=await tx.select().from(homeworkPages).where(inArray(homeworkPages.submissionId,ids)).orderBy(asc(homeworkPages.position));const details=await tx.select().from(homeworkSubmissionDetails).where(eq(homeworkSubmissionDetails.todoId,id));
  const reviews=await tx.select({review:todoReviews,snapshot:homeworkReviewSnapshots}).from(todoReviews).leftJoin(homeworkReviewSnapshots,eq(homeworkReviewSnapshots.reviewId,todoReviews.id)).where(eq(todoReviews.todoId,id));
  return submissions.map(s=>{let list:HomeworkPage[]=pages.filter(p=>p.submissionId===s.id).map(p=>({pageKey:p.pageKey,attachmentId:p.attachmentId,mimeType:p.mimeType,byteSize:p.byteSize,rotation:p.rotation as HomeworkPage['rotation'],parentPageKey:p.parentPageKey,position:p.position}));if(!list.length&&s.attachmentId)list=[{pageKey:s.attachmentId,attachmentId:s.attachmentId,mimeType:s.mimeType!,byteSize:s.byteSize!,rotation:0,parentPageKey:null,position:0}];const review=reviews.find(r=>r.review.submissionNumber===s.number);return {number:s.number,submittedAt:s.submittedAt.toISOString(),note:details.find(d=>d.submissionId===s.id)?.note??'',pages:list,review:review?{decision:review.review.decision,note:review.review.note,reviewedAt:review.review.createdAt.toISOString(),document:review.snapshot?.document??{note:review.review.note,pages:[]}}:null}});
 }
 async function view(actor:Actor,id:string):Promise<HomeworkView>{
  const row=await task(actor,id);const [child]=await database.select({name:children.nickname}).from(children).where(and(eq(children.id,row.childId),eq(children.familyId,actor.familyId)));let dictationComplete=true;
  if(row.dictationTaskId){const [dt]=await database.select({status:learningTasks.status}).from(learningTasks).where(eq(learningTasks.id,row.dictationTaskId));dictationComplete=dt?.status==='completed'}
  const result:HomeworkView={task:{id:row.id,title:row.title,requirements:row.requirements,date:row.date,status:row.status,submissionNumber:row.submissionNumber,updatedAt:row.updatedAt.toISOString(),reviewNote:row.reviewNote,rewardCoins:row.rewardCoins,rewardGrowth:row.rewardGrowth,confirmation:row.confirmation,kind:row.kind,childName:child?.name??'孩子',canSubmit:['open','rejected'].includes(row.status)&&dictationComplete},rounds:await rounds(id)};
  if(actor.role==='guardian'){const [draft]=await database.select().from(homeworkReviewDrafts).where(and(eq(homeworkReviewDrafts.todoId,id),eq(homeworkReviewDrafts.submissionNumber,row.submissionNumber))).limit(1);result.draft=draft?{revision:draft.revision,document:draft.document,savedAt:draft.updatedAt.toISOString()}:null}
  return result;
 }
 async function corrections(actor:Actor,childId?:string):Promise<CorrectionTask[]>{
  if(childId)uuid.parse(childId);return database.select({id:todoTasks.id,title:todoTasks.title,date:todoTasks.date,reviewNote:todoTasks.reviewNote,submissionNumber:todoTasks.submissionNumber}).from(todoTasks).where(and(eq(todoTasks.familyId,actor.familyId),eq(todoTasks.status,'rejected'),actor.role==='child'?eq(todoTasks.childId,actor.childId):childId?eq(todoTasks.childId,childId):undefined)).orderBy(desc(todoTasks.updatedAt)).limit(200);
 }
 async function upload(actor:ChildActor,id:string,commandId:string,file:File){
  if(actor.role!=='child')throw new Error('FORBIDDEN');uuid.parse(commandId);let row=await task(actor,id);if(!['open','rejected'].includes(row.status))throw new Error('TODO_STALE');
  if(!file.size||file.size>MAX_ATTACHMENT_BYTES)throw new Error('ATTACHMENT_SIZE');const original=new Uint8Array(await file.arrayBuffer());const type=attachmentType(original,file.type);if(!type.startsWith('image/'))throw new Error('HOMEWORK_IMAGE_ONLY');
  let bytes:Buffer,info:OutputInfo;
  try{const out=await sharp(original,{limitInputPixels:32000000,failOn:'warning',animated:false}).rotate().resize({width:2600,height:3600,fit:'inside',withoutEnlargement:true}).jpeg({quality:92}).toBuffer({resolveWithObject:true});bytes=out.data;info=out.info}catch{throw new Error('HOMEWORK_IMAGE_INVALID')}
  if(bytes.length>MAX_ATTACHMENT_BYTES)throw new Error('ATTACHMENT_SIZE');const digest=createHash('sha256').update(bytes).digest('hex');
  let saved:Awaited<ReturnType<typeof saveAttachment>>|undefined;
  try{return await database.transaction(async tx=>{row=await task(actor,id,tx,true);if(!['open','rejected'].includes(row.status))throw new Error('TODO_STALE');const [existing]=await tx.select().from(homeworkUploads).where(and(eq(homeworkUploads.todoId,id),eq(homeworkUploads.commandId,commandId)));if(existing){if(existing.sha256!==digest)throw new Error('HOMEWORK_COMMAND_CONFLICT');return existing}
   const [pending]=await tx.select({n:sql<number>`count(*)::int`}).from(homeworkUploads).where(and(eq(homeworkUploads.todoId,id),sql`not exists (select 1 from ${homeworkPages} where ${homeworkPages.attachmentId}=${homeworkUploads.id})`));if(pending.n>=80)throw new Error('HOMEWORK_UPLOAD_LIMIT');
   saved=await saveAttachment(new File([new Uint8Array(bytes)],'homework.jpg',{type:'image/jpeg'}));const [created]=await tx.insert(homeworkUploads).values({id:saved.id,todoId:id,familyId:actor.familyId,childId:actor.childId,commandId,sha256:digest,mimeType:saved.mimeType,byteSize:saved.byteSize,width:info.width,height:info.height}).returning();return created;
  })}catch(error){if(saved)await removeAttachment(saved.id);throw error}
 }
 async function submit(actor:ChildActor,id:string,raw:HomeworkSubmit){
  if(actor.role!=='child')throw new Error('FORBIDDEN');const input=homeworkSubmitSchema.parse(raw),fingerprint=hash(input);
  return database.transaction(async tx=>{
   const row=await task(actor,id,tx,true);const [replay]=await tx.select().from(homeworkSubmissionDetails).where(and(eq(homeworkSubmissionDetails.todoId,id),eq(homeworkSubmissionDetails.commandId,input.commandId))).limit(1);if(replay){if(replay.inputFingerprint!==fingerprint)throw new Error('HOMEWORK_COMMAND_CONFLICT');return}
   if(!['open','rejected'].includes(row.status)||row.submissionNumber!==input.number||row.updatedAt.toISOString()!==input.expectedUpdatedAt)throw new Error('TODO_STALE');
   const history=await rounds(id,tx),previous=history.at(-1)?.pages??[];const keys=input.pages.map(p=>p.pageKey),attachmentIds=input.pages.map(p=>p.attachmentId);if(new Set(keys).size!==keys.length||new Set(attachmentIds).size!==attachmentIds.length)throw new Error('HOMEWORK_PAGES_DUPLICATE');
   const uploads=await tx.select().from(homeworkUploads).where(and(eq(homeworkUploads.todoId,id),eq(homeworkUploads.familyId,actor.familyId),eq(homeworkUploads.childId,actor.childId),inArray(homeworkUploads.id,attachmentIds)));
   const pages:HomeworkPage[]=input.pages.map((page,position)=>{const old=previous.find(p=>p.pageKey===page.pageKey),owned=uploads.find(p=>p.id===page.attachmentId);if(old){if(old.attachmentId!==page.attachmentId||old.parentPageKey!==page.parentPageKey)throw new Error('HOMEWORK_PAGE_SCOPE');return {...old,rotation:page.rotation,position}}
    if(history.some(r=>r.pages.some(p=>p.pageKey===page.pageKey))||!owned||(page.parentPageKey&&!previous.some(p=>p.pageKey===page.parentPageKey)))throw new Error('HOMEWORK_PAGE_SCOPE');return {...page,mimeType:owned.mimeType,byteSize:owned.byteSize,position}});
   const used=await tx.select({id:todoSubmissions.attachmentId}).from(todoSubmissions).where(inArray(todoSubmissions.attachmentId,attachmentIds));
   const preview=pages.find(p=>!used.some(u=>u.id===p.attachmentId));
   await createTodoService(tx).submit(actor,id,input.number,preview?{id:preview.attachmentId,mimeType:preview.mimeType,byteSize:preview.byteSize}:undefined);
   const [submission]=await tx.select().from(todoSubmissions).where(and(eq(todoSubmissions.todoId,id),eq(todoSubmissions.number,input.number+1))).limit(1);if(!submission)throw new Error('TODO_STALE');await tx.insert(homeworkSubmissionDetails).values({submissionId:submission.id,todoId:id,commandId:input.commandId,inputFingerprint:fingerprint,note:input.note});await tx.insert(homeworkPages).values(pages.map(p=>({...p,submissionId:submission.id})));
  });
 }
 async function review(actor:GuardianActor,id:string,raw:HomeworkReviewCommand){
  if(actor.role!=='guardian')throw new Error('FORBIDDEN');const input=homeworkReviewSchema.parse(raw),fingerprint=hash(input);
  return database.transaction(async tx=>{
   const row=await task(actor,id,tx,true);if(input.type==='publish'){const [replay]=await tx.select().from(homeworkReviewSnapshots).where(and(eq(homeworkReviewSnapshots.todoId,id),eq(homeworkReviewSnapshots.commandId,input.commandId))).limit(1);if(replay){if(replay.inputFingerprint!==fingerprint)throw new Error('HOMEWORK_COMMAND_CONFLICT');return}}
   const [draft]=await tx.select().from(homeworkReviewDrafts).where(and(eq(homeworkReviewDrafts.todoId,id),eq(homeworkReviewDrafts.submissionNumber,input.number))).limit(1);if(input.type==='draft'&&draft?.commandId===input.commandId){if(draft.inputFingerprint!==fingerprint)throw new Error('HOMEWORK_COMMAND_CONFLICT');return}
   if(row.status!=='submitted'||row.submissionNumber!==input.number||row.updatedAt.toISOString()!==input.expectedUpdatedAt)throw new Error('TODO_STALE');if((draft?.revision??0)!==input.revision)throw new Error('HOMEWORK_DRAFT_CONFLICT');
   const history=await rounds(id,tx),current=history.find(r=>r.number===input.number);if(!current)throw new Error('TODO_STALE');validateReviewDocument(input.document,current.pages.map(p=>p.pageKey));
   if(input.type==='draft'){const value={todoId:id,submissionNumber:input.number,guardianId:actor.guardianId,revision:(draft?.revision??0)+1,document:input.document,commandId:input.commandId,inputFingerprint:fingerprint,updatedAt:new Date()};if(draft)await tx.update(homeworkReviewDrafts).set(value).where(eq(homeworkReviewDrafts.id,draft.id));else await tx.insert(homeworkReviewDrafts).values(value);return}
   const text=homeworkDocumentText(input.document,current.pages.map(p=>p.pageKey));if(input.decision==='rejected'&&!text.trim())throw new Error('HOMEWORK_REQUIREMENTS_REQUIRED');
   await createTodoService(tx).review(actor,id,{number:input.number,decision:input.decision,bonus:input.bonus,note:text},true);const [saved]=await tx.select().from(todoReviews).where(and(eq(todoReviews.todoId,id),eq(todoReviews.submissionNumber,input.number))).limit(1);if(!saved)throw new Error('TODO_STALE');await tx.insert(homeworkReviewSnapshots).values({reviewId:saved.id,todoId:id,commandId:input.commandId,inputFingerprint:fingerprint,document:input.document});
  });
 }
 return {view,corrections,upload,submit,review};
}
