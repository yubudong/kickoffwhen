import { and,asc,desc,eq,sql } from 'drizzle-orm';
import { db,type DbTransaction } from '@/db/client';
import type { GuardianActor } from '@/modules/auth/actor';
import { children } from '@/modules/families/schema';
import { privateMedia } from '@/modules/media/schema';
import { activeTtsMediaPredicate } from '@/modules/media/active-cache';
import { dictationSessions } from './session-schema';
import { learningTasks,learningTaskItems } from './task-schema';
import { keyboardDrafts,keyboardAttempts } from './keyboard-schema';
import { keyboardSnapshotSchema,keyboardViewSchema,type KeyboardView } from './keyboard-types';
import { resolvedKeyboardResults } from './keyboard-service';
type Database=typeof db|DbTransaction;
function summary(attempts:Array<typeof keyboardAttempts.$inferSelect>,total:number,assisted:boolean):KeyboardView['summary']{
 const first=attempts.find(a=>a.roundNumber===1),results=first?resolvedKeyboardResults(first):[];
 const latest=new Map<string,boolean|null>();for(const a of [...attempts].sort((a,b)=>a.roundNumber-b.roundNumber))for(const r of resolvedKeyboardResults(a))latest.set(r.itemId,r.correct);
 return {total,firstCorrect:results.filter(r=>r.correct===true).length,firstIncorrect:results.filter(r=>r.correct===false).length,firstPending:results.filter(r=>r.correct===null).length,corrected:results.filter(r=>r.correct===false&&latest.get(r.itemId)===true).length,rounds:attempts.length,assisted};
}
export async function keyboardChildView(database:Database,session:typeof dictationSessions.$inferSelect,task:typeof learningTasks.$inferSelect,now:Date){
 const scope=and(eq(learningTaskItems.taskId,task.id),eq(learningTaskItems.familyId,session.familyId),eq(learningTaskItems.childId,session.childId));
 const all=await database.select({id:learningTaskItems.id,position:learningTaskItems.position,snapshot:learningTaskItems.keyboardSnapshot,mediaId:privateMedia.id}).from(learningTaskItems).leftJoin(privateMedia,activeTtsMediaPredicate({dedupeKey:learningTaskItems.ttsDedupeKey,familyId:learningTaskItems.familyId,childId:learningTaskItems.childId,at:now})).where(scope).orderBy(asc(learningTaskItems.position));
 const attempts=await database.select().from(keyboardAttempts).where(and(eq(keyboardAttempts.sessionId,session.id),eq(keyboardAttempts.familyId,session.familyId),eq(keyboardAttempts.childId,session.childId))).orderBy(asc(keyboardAttempts.roundNumber));
 const keyboard:KeyboardView={summary:summary(attempts,all.length,task.englishStudyOptions?.mode==='assisted')};
 if(session.phase==='listening'){
  const [draft]=await database.select().from(keyboardDrafts).where(and(eq(keyboardDrafts.sessionId,session.id),eq(keyboardDrafts.roundNumber,session.roundNumber))).limit(1);
  keyboard.draft={revision:draft?.revision??0,cursor:draft?.cursor??0,answers:draft?.answers??[],savedAt:draft?.updatedAt.toISOString()??null};
  const byId=new Map(all.map(i=>[i.id,i]));
  const items=session.currentRoundItemIds.map((id,position)=>{const item=byId.get(id);if(!item?.mediaId)throw new Error('TASK_AUDIO_NOT_READY');const snapshot=keyboardSnapshotSchema.parse(item.snapshot);return {itemId:id,position,audioUrl:'/api/private-media/'+item.mediaId,pinyinText:null,contextText:null,writingHint:snapshot.writingHint,...(task.englishStudyOptions?.mode==='assisted'&&snapshot.hints?{englishHints:snapshot.hints}:{})}});
  return {keyboard:keyboardViewSchema.parse(keyboard),items};
 }
 const attempt=attempts.find(a=>a.roundNumber===session.roundNumber);
 if(attempt){const snapshots=new Map(all.map(i=>[i.id,keyboardSnapshotSchema.parse(i.snapshot)]));keyboard.result={roundNumber:attempt.roundNumber,pending:attempt.status==='pending',submittedAt:attempt.submittedAt.toISOString(),reviewNote:attempt.reviewNote,items:resolvedKeyboardResults(attempt).map(r=>({...r,answerText:snapshots.get(r.itemId)!.answer,...(snapshots.get(r.itemId)!.details?{english:snapshots.get(r.itemId)!.details}:{})}))};}
 else if(session.phase!=='completed')throw new Error('KEYBOARD_RESULT_NOT_READY');
 return {keyboard:keyboardViewSchema.parse(keyboard),items:session.phase==='grading'?(keyboard.result?.items.map((r,position)=>({itemId:r.itemId,position,answerText:r.answerText,...(r.english?{english:r.english}:{})}))??[]):[]};
}
export async function keyboardParentReports(actor:GuardianActor,database:Database=db){
 if(actor.role!=='guardian')throw new Error('FORBIDDEN');
 const rows=await database.select({session:dictationSessions,task:learningTasks,childName:children.nickname}).from(dictationSessions).innerJoin(learningTasks,eq(learningTasks.id,dictationSessions.taskId)).innerJoin(children,and(eq(children.id,dictationSessions.childId),eq(children.familyId,actor.familyId))).where(and(eq(dictationSessions.familyId,actor.familyId),eq(learningTasks.responseMode,'keyboard'),sql`${learningTasks.status}<>'cancelled'`)).orderBy(sql`case when ${dictationSessions.phase}='awaiting_parent' then 0 else 1 end`,desc(dictationSessions.updatedAt)).limit(100);
 const reports=[];
 for(const {session,task,childName} of rows){
  const attempts=await database.select().from(keyboardAttempts).where(and(eq(keyboardAttempts.familyId,actor.familyId),eq(keyboardAttempts.sessionId,session.id))).orderBy(asc(keyboardAttempts.roundNumber));
  const items=await database.select({id:learningTaskItems.id,snapshot:learningTaskItems.keyboardSnapshot}).from(learningTaskItems).where(and(eq(learningTaskItems.familyId,actor.familyId),eq(learningTaskItems.taskId,task.id)));
  const snapshots=new Map(items.map(i=>[i.id,keyboardSnapshotSchema.parse(i.snapshot)]));
  reports.push({sessionId:session.id,childId:session.childId,childName,title:task.title,version:session.version,roundNumber:session.roundNumber,status:session.status,phase:session.phase,summary:summary(attempts,items.length,task.englishStudyOptions?.mode==='assisted'),rounds:attempts.map(a=>({roundNumber:a.roundNumber,pending:a.status==='pending',applied:!!a.appliedAt,submittedAt:a.submittedAt.toISOString(),reviewNote:a.reviewNote,items:resolvedKeyboardResults(a).map(r=>({...r,answerText:snapshots.get(r.itemId)!.answer}))}))});
 }
 return reports;
}
export type KeyboardParentReport=Awaited<ReturnType<typeof keyboardParentReports>>[number];
