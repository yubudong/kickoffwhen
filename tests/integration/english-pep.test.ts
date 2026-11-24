import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { expect, test } from "vitest";
import { user } from "@/modules/auth/schema";
import { children, families, guardians } from "@/modules/families/schema";
import { learningCards } from "@/modules/learning-content/schema";
import { applySeedContents } from "@/modules/learning-content/seed-service";
import type { EnglishContentRequirements } from "@/modules/learning-content/english-content-audit";
import { getEnglishMetadata } from "@/modules/learning-content/english-metadata";
import { createDictationTaskService } from "@/modules/dictation/task-service";
import { learningTasks, learningTaskItems } from "@/modules/dictation/task-schema";
import { createDictationSessionService } from "@/modules/dictation/session-service";
import { createChildDictationViewService } from "@/modules/dictation/child-view-service";
import { privateMedia } from "@/modules/media/schema";
import { childCardStates } from "@/modules/review/db-schema";
import { createInitialState } from "@/modules/review/scheduler";
import { serializeFsrsCard } from "@/modules/review/schema";
import type { DbTransaction } from "@/db/client";
import { withDatabaseRollback } from "../helpers/database";
const seed=JSON.parse(readFileSync('content/seed/english-official-grade3-volume1.json','utf8'));
const reference=JSON.parse(readFileSync('content/reference/english-official-grade3-volume1.json','utf8')) as EnglishContentRequirements;
const base={subject:'english' as const,mode:'continuous_batch' as const,order:'source' as const,intervalSeconds:2,repeatCount:1 as const,speechRate:1,allowManualReplay:true};
async function fixture(tx:DbTransaction){
 await applySeedContents(tx,[seed],[],[reference]);
 const uid=crypto.randomUUID();await tx.insert(user).values({id:uid,name:'英语验证家长',email:`english-${uid}@example.test`});
 const [family]=await tx.insert(families).values({name:'英语隔离验证'}).returning();
 const [guardian]=await tx.insert(guardians).values({familyId:family!.id,authUserId:uid}).returning();
 const [child,sibling]=await tx.insert(children).values([{familyId:family!.id,nickname:'英语孩子',grade:3},{familyId:family!.id,nickname:'其他孩子',grade:3}]).returning();
 const [eye]=await tx.select().from(learningCards).where(eq(learningCards.builtinKey,seed.units[0].sections[0].cards.find((card:{answerText:string})=>card.answerText==='eye').builtinKey));
 const [name]=await tx.select().from(learningCards).where(eq(learningCards.builtinKey,seed.units[0].sections[0].cards.find((card:{answerText:string})=>card.answerText==='name').builtinKey));
 return {family:family!,child:child!,sibling:sibling!,eye:eye!,name:name!,actor:{role:'guardian' as const,familyId:family!.id,guardianId:guardian!.id},childActor:{role:'child' as const,familyId:family!.id,childId:child!.id,deviceId:crypto.randomUUID()}};
}
async function cache(tx:DbTransaction,taskId:string,familyId:string,childId:string){
 const items=await tx.select().from(learningTaskItems).where(eq(learningTaskItems.taskId,taskId));
 for(const item of items){const mid=crypto.randomUUID();await tx.insert(privateMedia).values({id:mid,familyId,childId,kind:'tts_audio',mimeType:'audio/mpeg',byteSize:3,sha256:'b'.repeat(64),relativePath:`${mid.slice(0,2)}/${mid.slice(2,4)}/${mid}`,dedupeKey:item.ttsDedupeKey});}
 return items;
}

test.each(['standard','assisted'] as const)('英语%s模式持久化，监听不含答案，批改后才展示完整资料',async mode=>{
 await withDatabaseRollback(async tx=>{
  const f=await fixture(tx);const service=createDictationTaskService(tx);const options={version:1 as const,mode,includeRecognition:false};
  const task=await service.buildDailyTask(f.actor,{...base,childId:f.child.id,newCardIds:[f.eye.id],commandId:crypto.randomUUID(),maxReviewCards:0,englishStudyOptions:options});
  expect(task).not.toHaveProperty('englishStudyOptions');
  const [saved]=await tx.select().from(learningTasks).where(eq(learningTasks.id,task.id));expect(saved!.englishStudyOptions).toEqual(options);
  const items=await cache(tx,task.id,f.family.id,f.child.id);const sessions=createDictationSessionService(tx);const started=await sessions.startSession(f.childActor,task.id);const views=createChildDictationViewService(tx);
  const listen=await views.getSession(f.childActor,started.sessionId);expect(listen.phase).toBe('listening');
  const serialized=JSON.stringify(listen);expect(serialized).not.toContain('eye');expect(serialized).not.toContain('aɪ');expect(serialized).not.toMatch(/answerText|broadcastText|exampleSentence|acceptedAnswers/);
  if(listen.phase!=='listening')throw Error('NOT_LISTENING');
  expect(listen.items[0]).toMatchObject({pinyinText:null,contextText:null,writingHint:'请写完整英文单词。'});
  if(mode==='standard')expect(listen.items[0]!.englishHints).toBeUndefined();
  else expect(listen.items[0]!.englishHints).toMatchObject({meaningZh:'眼睛',exampleWithBlank:expect.stringContaining('（　　）')});
  await expect(views.getSession({...f.childActor,childId:f.sibling.id},started.sessionId)).rejects.toThrow('DICTATION_SESSION_NOT_FOUND');
  const grading=await sessions.recordPlayback(f.childActor,{sessionId:started.sessionId,commandId:crypto.randomUUID(),expectedVersion:started.version,roundNumber:1,playedItemIds:[items[0]!.id],sequenceFinished:true});
  const reveal=await views.getSession(f.childActor,started.sessionId);expect(reveal).toMatchObject({phase:'grading',items:[{answerText:'eye',english:{meaningZh:'眼睛',phonetic:'aɪ'}}]});
  const done=await sessions.submitBatchMarks(f.childActor,{sessionId:started.sessionId,commandId:crypto.randomUUID(),expectedVersion:grading.version,roundNumber:1,marks:[{itemId:items[0]!.id,correct:true}]});expect(done.phase).toBe('completed');
  expect((await views.getSession(f.childActor,started.sessionId)).items).toEqual([]);
 });
});

test.each([false,true])('英语课内默认范围与认读开关%s一致，重复请求幂等',async includeRecognition=>{
 await withDatabaseRollback(async tx=>{
  const f=await fixture(tx);const service=createDictationTaskService(tx);const input={...base,childId:f.child.id,sectionIds:[f.eye.sectionId!],extraCardIds:[],commandId:crypto.randomUUID(),englishStudyOptions:{version:1 as const,mode:'assisted' as const,includeRecognition}};
  const tasks=await service.buildTaskBatch(f.actor,input);expect(tasks).toHaveLength(1);expect(tasks[0]!.items).toHaveLength(includeRecognition?7:5);
  const selected=await tx.select().from(learningCards).where(eq(learningCards.sectionId,f.eye.sectionId!));
  const byId=new Map(selected.map(card=>[card.id,card]));
  if(!includeRecognition)expect(tasks[0]!.items.every(item=>getEnglishMetadata(byId.get(item.cardId)!.builtinKey)!.learningTarget!=='recognition')).toBe(true);
  expect((await service.buildTaskBatch(f.actor,input))[0]!.id).toBe(tasks[0]!.id);
  await expect(service.buildTaskBatch(f.actor,{...input,englishStudyOptions:{...input.englishStudyOptions,mode:'standard'}})).rejects.toThrow('TASK_IDEMPOTENCY_CONFLICT');
  const [saved]=await tx.select().from(learningTasks).where(eq(learningTasks.id,tasks[0]!.id));expect(saved!.title).toContain('辅助练习');expect(saved!.englishStudyOptions).toEqual(input.englishStudyOptions);
 });
});

test('主动加练认读词不被默认课内范围阻挡，已学认读词仍正常到期复习',async()=>{
 await withDatabaseRollback(async tx=>{
  const f=await fixture(tx);const service=createDictationTaskService(tx);
  const options={version:1 as const,mode:'standard' as const,includeRecognition:false};
  const state=createInitialState(new Date('2020-01-01'));await tx.insert(childCardStates).values({familyId:f.family.id,childId:f.child.id,cardId:f.name.id,cardJson:serializeFsrsCard(state),dueAt:new Date('2020-01-01')});
  const review=await service.buildDailyTask(f.actor,{...base,childId:f.child.id,newCardIds:[],maxReviewCards:10,commandId:crypto.randomUUID(),englishStudyOptions:options});
  expect(review.items).toMatchObject([{cardId:f.name.id,kind:'due_review'}]);
  const extra=await service.buildTaskBatch(f.actor,{...base,childId:f.sibling.id,sectionIds:[],extraCardIds:[f.name.id],commandId:crypto.randomUUID(),englishStudyOptions:options});
  expect(extra[0]!.items).toMatchObject([{cardId:f.name.id,kind:'new'}]);
 });
});

test('家长批改任务不会向孩子提交阶段返回英语答案资料',async()=>{
 await withDatabaseRollback(async tx=>{
  const f=await fixture(tx);const task=await createDictationTaskService(tx).buildDailyTask(f.actor,{...base,childId:f.child.id,newCardIds:[f.eye.id],maxReviewCards:0,commandId:crypto.randomUUID(),gradingMode:'parent',englishStudyOptions:{version:1,mode:'assisted',includeRecognition:false}});
  const items=await cache(tx,task.id,f.family.id,f.child.id);const service=createDictationSessionService(tx);const started=await service.startSession(f.childActor,task.id);
  await service.recordPlayback(f.childActor,{sessionId:started.sessionId,commandId:crypto.randomUUID(),expectedVersion:started.version,roundNumber:1,playedItemIds:[items[0]!.id],sequenceFinished:true});
  const view=await createChildDictationViewService(tx).getSession(f.childActor,started.sessionId);expect(view).toMatchObject({phase:'submission',items:[]});expect(JSON.stringify(view)).not.toContain('eye');
 });
});
