import { and,eq } from 'drizzle-orm';
import { expect,test } from 'vitest';
import { createTodoService } from '@/modules/todos/service';
import { todoTasks,todoRewards } from '@/modules/todos/schema';
import { createSessionReportService } from '@/modules/reports/session-report';
import { user } from '@/modules/auth/schema';
import { families,guardians,children } from '@/modules/families/schema';
import { learningCards } from '@/modules/learning-content/schema';
import { learningTasks,learningTaskItems } from '@/modules/dictation/task-schema';
import { dictationSessions,dictationSessionItems,dictationAnswerEvents,dictationCompletionEvents } from '@/modules/dictation/session-schema';
import { keyboardAttempts,keyboardDrafts } from '@/modules/dictation/keyboard-schema';
import { createDictationTaskService } from '@/modules/dictation/task-service';
import { createDictationSessionService } from '@/modules/dictation/session-service';
import { createChildDictationViewService } from '@/modules/dictation/child-view-service';
import { createKeyboardService } from '@/modules/dictation/keyboard-service';
import { keyboardParentReports } from '@/modules/dictation/keyboard-view';
import { privateMedia } from '@/modules/media/schema';
import { reviewEvents } from '@/modules/review/db-schema';
import { withDatabaseRollback } from '../helpers/database';
import type { DbTransaction } from '@/db/client';
import type { KeyboardCommand } from '@/modules/dictation/keyboard-types';
const uuid=()=>crypto.randomUUID();
async function fixture(tx:DbTransaction,words=['pencil','Monday']){
 const uid=uuid();await tx.insert(user).values({id:uid,name:'键盘家长',email:`keys-${uid}@example.test`});const [family]=await tx.insert(families).values({name:'键盘测试'}).returning();const [parent]=await tx.insert(guardians).values({familyId:family.id,authUserId:uid}).returning();const [child,sibling]=await tx.insert(children).values([{familyId:family.id,nickname:'小月',grade:3},{familyId:family.id,nickname:'小星',grade:3}]).returning();
 const actor={role:'guardian' as const,familyId:family.id,guardianId:parent.id},childActor={role:'child' as const,familyId:family.id,childId:child.id,deviceId:uuid()};
 const cards=await tx.insert(learningCards).values(words.map((answerText,index)=>({familyId:family.id,subject:'english',answerText,broadcastText:answerText,source:'manual',sourceOrder:index+1}))).returning();const input={childId:child.id,subject:'english' as const,newCardIds:cards.map(c=>c.id),commandId:uuid(),maxReviewCards:0,mode:'continuous_batch' as const,order:'source' as const,intervalSeconds:2,repeatCount:1 as const,speechRate:1,allowManualReplay:true,responseMode:'keyboard' as const};
 const task=await createDictationTaskService(tx).buildDailyTask(actor,input);const items=await tx.select().from(learningTaskItems).where(eq(learningTaskItems.taskId,task.id)).orderBy(learningTaskItems.position);
 for(const i of items){const id=uuid();await tx.insert(privateMedia).values({id,familyId:family.id,childId:child.id,kind:'tts_audio',mimeType:'audio/mpeg',byteSize:3,sha256:'f'.repeat(64),relativePath:`${id.slice(0,2)}/${id.slice(2,4)}/${id}`,dedupeKey:i.ttsDedupeKey})}
 const sessions=createDictationSessionService(tx),keyboard=createKeyboardService(tx),views=createChildDictationViewService(tx),start=await sessions.startSession(childActor,task.id);const get=()=>views.getSession(childActor,start.sessionId);
 async function play(){for(const i of (await get()).phase==='listening'?(await get()).items:[]){const s=await get();await sessions.recordPlayback(childActor,{commandId:uuid(),sessionId:start.sessionId,expectedVersion:s.version,roundNumber:s.roundNumber,playedItemIds:[i.itemId],sequenceFinished:false})}}
 async function cmd(type:KeyboardCommand['type'],extra:Record<string,unknown>={}){const s=await get();const body={type,commandId:uuid(),expectedVersion:s.version,roundNumber:s.roundNumber,...extra} as KeyboardCommand;await keyboard.command(childActor,start.sessionId,body);return body}
 return {family,child,sibling,actor,childActor,cards,input,task,items,sessions,keyboard,views,start,get,play,cmd};
}
test('在线草稿独立版本、丢响应重试、跨页面冲突和孩子隔离',async()=>{await withDatabaseRollback(async tx=>{
 const f=await fixture(tx);const first=await f.get();expect(first.responseMode).toBe('keyboard');expect(JSON.stringify(first)).not.toMatch(/pencil|Monday|acceptedAnswers|keyboardSnapshot/);
 const saved=await f.cmd('draft',{draftRevision:0,cursor:1,answers:[{itemId:f.items[0].id,input:'pensil'}]});await f.keyboard.command(f.childActor,f.start.sessionId,saved);
 let view=await f.get();expect(view.keyboard?.draft).toMatchObject({revision:1,cursor:1,answers:[{input:'pensil'}]});
 await expect(f.cmd('draft',{draftRevision:0,cursor:0,answers:[]})).rejects.toThrow('DRAFT_CONFLICT');await expect(f.keyboard.command({...f.childActor,childId:f.sibling.id},f.start.sessionId,saved)).rejects.toThrow('NOT_FOUND');await expect(f.views.getSession({...f.childActor,childId:f.sibling.id},f.start.sessionId)).rejects.toThrow('NOT_FOUND');
 view=await f.get();expect(view.keyboard?.draft?.answers[0].input).toBe('pensil');expect(await tx.select().from(keyboardDrafts).where(eq(keyboardDrafts.sessionId,f.start.sessionId))).toHaveLength(1);
})});
test('整轮提交后才公开答案，初次错误与后续订正分开且完成只写一次',async()=>{await withDatabaseRollback(async tx=>{
 const f=await fixture(tx);await f.play();const answers=f.items.map((i,n)=>({itemId:i.id,input:n?'monday':'pencil'}));const submitted=await f.cmd('submit',{draftRevision:0,answers});await f.keyboard.command(f.childActor,f.start.sessionId,submitted);
 const result=await f.get();expect(result.phase).toBe('grading');expect(result.keyboard?.summary).toMatchObject({firstCorrect:1,firstIncorrect:1});expect(result.keyboard?.result?.items[1]).toMatchObject({reason:'case',correct:false,input:'monday',answerText:'Monday'});
 await expect(f.cmd('draft',{draftRevision:0,cursor:0,answers:[]})).rejects.toThrow('ALREADY_SUBMITTED');const advance=await f.cmd('advance');await f.keyboard.command(f.childActor,f.start.sessionId,advance);const retry=await f.get();expect(retry).toMatchObject({phase:'listening',roundNumber:2});expect(retry.items).toHaveLength(1);expect(retry.keyboard?.draft?.answers).toEqual([]);expect(JSON.stringify(retry)).not.toContain('Monday');
 await f.play();await f.cmd('submit',{draftRevision:0,answers:[{itemId:f.items[1].id,input:'Monday'}]});const done=await f.cmd('advance');await f.keyboard.command(f.childActor,f.start.sessionId,done);const completed=await f.get();expect(completed.phase).toBe('completed');expect(completed.keyboard?.summary).toMatchObject({firstCorrect:1,firstIncorrect:1,corrected:1,rounds:2});
 const originals=await tx.select().from(dictationSessionItems).where(eq(dictationSessionItems.sessionId,f.start.sessionId));expect(originals.find(i=>i.taskItemId===f.items[1].id)).toMatchObject({firstCorrect:false,finalCorrect:true});expect(await tx.select().from(dictationAnswerEvents).where(eq(dictationAnswerEvents.sessionId,f.start.sessionId))).toHaveLength(3);expect(await tx.select().from(dictationCompletionEvents).where(eq(dictationCompletionEvents.sessionId,f.start.sessionId))).toHaveLength(1);expect(await tx.select().from(keyboardAttempts).where(eq(keyboardAttempts.sessionId,f.start.sessionId))).toHaveLength(2);
 const reports=await keyboardParentReports(f.actor,tx);expect(reports[0].rounds[0].items[1].input).toBe('monday');expect(reports[0].rounds[1].items[0].input).toBe('Monday');expect(await tx.select().from(reviewEvents).where(eq(reviewEvents.familyId,f.family.id))).toHaveLength(3);
})});
test('规范变体保留原自动结果与家长决策，不提前写复习事件或完成',async()=>{await withDatabaseRollback(async tx=>{
 const f=await fixture(tx,['colour']);await f.play();await f.cmd('submit',{draftRevision:0,answers:[{itemId:f.items[0].id,input:'color'}]});let s=await f.get();expect(s.phase).toBe('awaiting_parent');expect(s.keyboard?.summary.firstPending).toBe(1);await expect(f.cmd('advance')).rejects.toThrow('RESULT_NOT_READY');expect(await tx.select().from(reviewEvents).where(eq(reviewEvents.familyId,f.family.id))).toHaveLength(0);
 const review={sessionId:f.start.sessionId,commandId:uuid(),expectedVersion:s.version,roundNumber:1,decisions:[{itemId:f.items[0].id,correct:true}],note:'认可美式拼写'};await expect(f.keyboard.review({...f.actor,familyId:uuid()},review)).rejects.toThrow('NOT_FOUND');await f.keyboard.review(f.actor,review);await f.keyboard.review(f.actor,review);s=await f.get();expect(s.phase).toBe('grading');expect(s.keyboard?.result?.items[0]).toMatchObject({status:'pending',reason:'variant',correct:true,input:'color'});await f.cmd('advance');expect((await f.get()).keyboard?.summary).toMatchObject({firstCorrect:1,firstPending:0});const [attempt]=await tx.select().from(keyboardAttempts).where(eq(keyboardAttempts.sessionId,f.start.sessionId));expect(attempt.results[0].correct).toBeNull();expect(attempt.decisions).toEqual(review.decisions);
})});
test('旧自评/照片/重开/结束播放接口不能绕过键盘交卷，未听题不能提交',async()=>{await withDatabaseRollback(async tx=>{
 const f=await fixture(tx);const command={sessionId:f.start.sessionId,commandId:uuid(),expectedVersion:0,roundNumber:1};await expect(f.sessions.recordPlayback(f.childActor,{...command,playedItemIds:[f.items[0].id],sequenceFinished:true})).rejects.toThrow('KEYBOARD_SUBMIT_REQUIRED');await expect(f.sessions.restartRound(f.childActor,command)).rejects.toThrow('KEYBOARD_SUBMIT_REQUIRED');await expect(f.sessions.submitBatchMarks(f.childActor,{...command,marks:f.items.map(i=>({itemId:i.id,correct:true}))})).rejects.toThrow('KEYBOARD_SUBMIT_REQUIRED');await expect(f.cmd('submit',{draftRevision:0,answers:f.items.map(i=>({itemId:i.id,input:'pencil'}))})).rejects.toThrow('ROUND_INCOMPLETE');expect((await f.get()).phase).toBe('listening');
})});
test('任务冻结目标，后续编辑词条不改变键盘判分',async()=>{await withDatabaseRollback(async tx=>{
 const f=await fixture(tx,['pencil']);await tx.update(learningCards).set({answerText:'changed'}).where(eq(learningCards.id,f.cards[0].id));await f.play();await f.cmd('submit',{draftRevision:0,answers:[{itemId:f.items[0].id,input:'pencil'}]});expect((await f.get()).keyboard?.result?.items[0]).toMatchObject({answerText:'pencil',correct:true});
})});
test('旧任务默认纸笔，中文/逐题自评参数不能建立键盘任务；撤回阻断草稿',async()=>{await withDatabaseRollback(async tx=>{
 const f=await fixture(tx);await expect(createDictationTaskService(tx).buildDailyTask(f.actor,{...f.input,commandId:uuid(),subject:'chinese'})).rejects.toThrow('SUBJECT_MISMATCH');await expect(createDictationTaskService(tx).buildDailyTask(f.actor,{...f.input,commandId:uuid(),mode:'item_by_item'})).rejects.toThrow('SUBJECT_MISMATCH');const [old]=await tx.insert(learningTasks).values({familyId:f.family.id,childId:f.child.id,guardianId:f.actor.guardianId,commandId:uuid(),inputFingerprint:'a',mode:'continuous_batch',taskOrder:'source',intervalSeconds:2,repeatCount:1,speechRate:'1',allowManualReplay:true,maxReviewCards:0}).returning();expect(old.responseMode).toBe('paper');await tx.update(learningTasks).set({status:'cancelled'}).where(eq(learningTasks.id,f.task.id));await expect(f.keyboard.command(f.childActor,f.start.sessionId,{type:'draft',commandId:uuid(),expectedVersion:0,roundNumber:1,draftRevision:0,cursor:0,answers:[]})).rejects.toThrow('TASK_NOT_ACTIVE');expect(await tx.select().from(dictationSessions).where(and(eq(dictationSessions.id,f.start.sessionId),eq(dictationSessions.version,0)))).toHaveLength(1);
})});

test('键盘成绩不提前发奖，完成后沿用家长审核且重复审核不发双份',async()=>{await withDatabaseRollback(async tx=>{
 const f=await fixture(tx,['pencil']);const todos=createTodoService(tx);const [todo]=await tx.select().from(todoTasks).where(eq(todoTasks.dictationTaskId,f.task.id));
 await expect(todos.submit(f.childActor,todo.id,0)).rejects.toThrow('DICTATION_INCOMPLETE');await f.play();await f.cmd('submit',{draftRevision:0,answers:[{itemId:f.items[0].id,input:'pencil'}]});await expect(todos.submit(f.childActor,todo.id,0)).rejects.toThrow('DICTATION_INCOMPLETE');await f.cmd('advance');
 const report=await createSessionReportService(tx).getSessionReport(f.actor,f.start.sessionId);expect(report).toMatchObject({responseMode:'keyboard',selfGraded:false,firstPassAccuracy:1});
 expect(await tx.select().from(todoRewards).where(eq(todoRewards.todoId,todo.id))).toHaveLength(0);await todos.submit(f.childActor,todo.id,0);await todos.review(f.actor,todo.id,{number:1,decision:'approved',bonus:0,note:''});await todos.review(f.actor,todo.id,{number:1,decision:'approved',bonus:0,note:''});expect(await tx.select().from(todoRewards).where(eq(todoRewards.todoId,todo.id))).toHaveLength(1);
})});
