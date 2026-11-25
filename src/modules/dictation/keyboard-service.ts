import { createHash } from 'node:crypto';
import { and,asc,eq,inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db,type DbTransaction } from '@/db/client';
import type { ChildActor,GuardianActor } from '@/modules/auth/actor';
import { keyboardDrafts,keyboardAttempts } from './keyboard-schema';
import { dictationSessions } from './session-schema';
import { learningTaskItems } from './task-schema';
import { applyMarksInTransaction,lockSession,ensureTaskActive,ensureMutableVersion } from './session-service';
import { keyboardCommandSchema,keyboardReviewSchema,keyboardSnapshotSchema,type KeyboardCommand,type KeyboardResult } from './keyboard-types';
import { gradeKeyboardAnswer } from './keyboard-grading';
const uuid=z.string().uuid();
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function resolvedKeyboardResults(attempt:typeof keyboardAttempts.$inferSelect):KeyboardResult[]{
 const decisions=new Map((attempt.decisions??[]).map(d=>[d.itemId,d.correct]));
 return attempt.results.map(r=>({...r,correct:r.status==='pending'?(decisions.get(r.itemId)??null):r.correct}));
}
export function createKeyboardService(database:typeof db|DbTransaction=db,now:()=>Date=()=>new Date()){
 async function command(actor:ChildActor,rawSessionId:string,raw:KeyboardCommand){
  if(actor.role!=='child')throw new Error('FORBIDDEN');
  const sessionId=uuid.parse(rawSessionId),input=keyboardCommandSchema.parse(raw),hash=fingerprint(input);
  return database.transaction(async tx=>{
   const session=await lockSession(tx,actor,sessionId);const task=await ensureTaskActive(tx,session,false);
   if(task.responseMode!=='keyboard')throw new Error('KEYBOARD_REQUIRED');
   const [attempt]=await tx.select().from(keyboardAttempts).where(and(eq(keyboardAttempts.sessionId,sessionId),eq(keyboardAttempts.roundNumber,input.roundNumber))).limit(1);
   const [draft]=await tx.select().from(keyboardDrafts).where(and(eq(keyboardDrafts.sessionId,sessionId),eq(keyboardDrafts.roundNumber,input.roundNumber))).limit(1);
   if(input.type==='submit'&&attempt?.commandId===input.commandId){if(attempt.inputFingerprint!==hash)throw new Error('COMMAND_CONFLICT');return;}
   if(input.type==='advance'&&attempt?.advanceCommandId===input.commandId)return;
   if(input.type==='draft'&&draft?.commandId===input.commandId){if(draft.inputFingerprint!==hash)throw new Error('COMMAND_CONFLICT');return;}
   if(task.status!=='active')throw new Error('TASK_NOT_ACTIVE');
   ensureMutableVersion(session,input.expectedVersion,input.roundNumber);
   const ids=session.currentRoundItemIds;
   if(input.type==='advance'){
    if(!attempt||attempt.appliedAt||attempt.status!=='resolved'||session.phase!=='grading')throw new Error('KEYBOARD_RESULT_NOT_READY');
    const results=resolvedKeyboardResults(attempt);if(results.some(r=>r.correct===null))throw new Error('KEYBOARD_REVIEW_PENDING');
    await applyMarksInTransaction(tx,session,{commandId:input.commandId,sessionId,expectedVersion:input.expectedVersion,roundNumber:input.roundNumber,marks:results.map(r=>({itemId:r.itemId,correct:r.correct!}))},now);
    await tx.update(keyboardAttempts).set({advanceCommandId:input.commandId,appliedAt:now()}).where(eq(keyboardAttempts.id,attempt.id));return;
   }
   if(attempt||session.phase!=='listening')throw new Error('KEYBOARD_ALREADY_SUBMITTED');
   if((draft?.revision??0)!==input.draftRevision)throw new Error('KEYBOARD_DRAFT_CONFLICT');
   const answerIds=input.answers.map(a=>a.itemId);
   if(new Set(answerIds).size!==answerIds.length||answerIds.some(id=>!ids.includes(id)))throw new Error('KEYBOARD_ANSWERS_SCOPE');
   const sorted=[...input.answers].sort((a,b)=>ids.indexOf(a.itemId)-ids.indexOf(b.itemId));
   if(input.type==='draft'){
    if(input.cursor>=ids.length)throw new Error('KEYBOARD_CURSOR_INVALID');
    const values={familyId:actor.familyId,childId:actor.childId,sessionId,roundNumber:input.roundNumber,revision:(draft?.revision??0)+1,cursor:input.cursor,answers:sorted,commandId:input.commandId,inputFingerprint:hash,updatedAt:now()};
    if(draft)await tx.update(keyboardDrafts).set(values).where(eq(keyboardDrafts.id,draft.id));else await tx.insert(keyboardDrafts).values(values);return;
   }
   if(answerIds.length!==ids.length||ids.some(id=>!session.playedItemIds.includes(id)))throw new Error('KEYBOARD_ROUND_INCOMPLETE');
   const rows=await tx.select({id:learningTaskItems.id,snapshot:learningTaskItems.keyboardSnapshot}).from(learningTaskItems).where(and(eq(learningTaskItems.taskId,session.taskId),eq(learningTaskItems.familyId,actor.familyId),eq(learningTaskItems.childId,actor.childId),inArray(learningTaskItems.id,ids))).orderBy(asc(learningTaskItems.position));
   if(rows.length!==ids.length)throw new Error('KEYBOARD_ANSWERS_SCOPE');
   const snapshots=new Map(rows.map(r=>[r.id,keyboardSnapshotSchema.parse(r.snapshot)]));
   const results=sorted.map(answer=>gradeKeyboardAnswer(answer.itemId,answer.input,snapshots.get(answer.itemId)!));const pending=results.some(r=>r.status==='pending');
   await tx.insert(keyboardAttempts).values({familyId:actor.familyId,childId:actor.childId,sessionId,roundNumber:input.roundNumber,commandId:input.commandId,inputFingerprint:hash,results,status:pending?'pending':'resolved',submittedAt:now()});
   await tx.update(dictationSessions).set({phase:pending?'awaiting_parent':'grading',version:session.version+1,updatedAt:now()}).where(eq(dictationSessions.id,sessionId));
  });
 }
 async function review(actor:GuardianActor,raw:z.input<typeof keyboardReviewSchema>){
  if(actor.role!=='guardian')throw new Error('FORBIDDEN');const input=keyboardReviewSchema.parse(raw),hash=fingerprint(input);
  return database.transaction(async tx=>{
   const session=await lockSession(tx,actor,input.sessionId);const task=await ensureTaskActive(tx,session,false);if(task.responseMode!=='keyboard')throw new Error('KEYBOARD_REQUIRED');
   const [attempt]=await tx.select().from(keyboardAttempts).where(and(eq(keyboardAttempts.sessionId,session.id),eq(keyboardAttempts.roundNumber,input.roundNumber))).limit(1);
   if(!attempt)throw new Error('DICTATION_SESSION_NOT_FOUND');
   if(attempt.reviewCommandId===input.commandId){if(attempt.reviewFingerprint!==hash)throw new Error('COMMAND_CONFLICT');return;}
   if(task.status!=='active')throw new Error('TASK_NOT_ACTIVE');ensureMutableVersion(session,input.expectedVersion,input.roundNumber);
   if(attempt.status!=='pending'||session.phase!=='awaiting_parent'||attempt.appliedAt)throw new Error('KEYBOARD_REVIEW_NOT_READY');
   const pending=attempt.results.filter(r=>r.status==='pending').map(r=>r.itemId),ids=input.decisions.map(d=>d.itemId);
   if(new Set(ids).size!==ids.length||ids.length!==pending.length||ids.some(id=>!pending.includes(id)))throw new Error('KEYBOARD_REVIEW_INCOMPLETE');
   await tx.update(keyboardAttempts).set({status:'resolved',decisions:input.decisions,reviewCommandId:input.commandId,reviewFingerprint:hash,reviewedBy:actor.guardianId,reviewNote:input.note,reviewedAt:now()}).where(eq(keyboardAttempts.id,attempt.id));
   await tx.update(dictationSessions).set({phase:'grading',version:session.version+1,updatedAt:now()}).where(eq(dictationSessions.id,session.id));
  });
 }
 return {command,review};
}
