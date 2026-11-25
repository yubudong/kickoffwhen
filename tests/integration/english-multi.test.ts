import { readFileSync } from 'node:fs';
import { and,eq,inArray } from 'drizzle-orm';
import { expect,test } from 'vitest';
import { user } from '@/modules/auth/schema';
import { families,guardians,children } from '@/modules/families/schema';
import { learningCards } from '@/modules/learning-content/schema';
import { applySeedContents } from '@/modules/learning-content/seed-service';
import { multiEnglishManifest } from '@/modules/learning-content/english-multi-catalog';
import type { MultiEnglishReference } from '@/modules/learning-content/english-multi-audit';
import { createDictationTaskService } from '@/modules/dictation/task-service';
import { createDictationSessionService } from '@/modules/dictation/session-service';
import { createChildDictationViewService } from '@/modules/dictation/child-view-service';
import { learningTaskItems } from '@/modules/dictation/task-schema';
import { privateMedia } from '@/modules/media/schema';
import { withDatabaseRollback } from '../helpers/database';
import type { DbTransaction } from '@/db/client';
const load=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const books=['renjiao-jingtong','beijing'].map(key=>multiEnglishManifest.books.find(b=>b.seriesKey===key&&b.grade===3&&b.volume===1)!);
const seeds=books.map(b=>load(b.seedFile));const refs=books.map(b=>load(b.referenceFile) as MultiEnglishReference);
const base={subject:'english' as const,mode:'continuous_batch' as const,order:'source' as const,intervalSeconds:2,repeatCount:1 as const,speechRate:1,allowManualReplay:true};
async function fixture(tx:DbTransaction){
 await applySeedContents(tx,seeds,[],[],refs);
 const id=crypto.randomUUID();await tx.insert(user).values({id,name:'多版本家长',email:`multi-${id}@example.test`});
 const [family]=await tx.insert(families).values({name:'多版本验证'}).returning();const [guardian]=await tx.insert(guardians).values({familyId:family.id,authUserId:id}).returning();
 const [child,sibling]=await tx.insert(children).values([{familyId:family.id,nickname:'小月',grade:3},{familyId:family.id,nickname:'小星',grade:3}]).returning();
 const keys=seeds.map(seed=>seed.units.flatMap((u:{sections:Array<{cards:Array<{builtinKey:string;answerText:string}>}>})=>u.sections.flatMap(s=>s.cards)).find((c:{answerText:string})=>c.answerText==='pencil').builtinKey as string);
 const cards=await tx.select().from(learningCards).where(inArray(learningCards.builtinKey,keys));expect(cards).toHaveLength(2);
 return {family,child,sibling,cards,actor:{role:'guardian' as const,familyId:family.id,guardianId:guardian.id},childActor:{role:'child' as const,familyId:family.id,childId:child.id,deviceId:crypto.randomUUID()}};
}
test('不同版本同词保留独立归属，重复导入不增加卡片或改变原卡标识',async()=>{await withDatabaseRollback(async tx=>{
 const f=await fixture(tx);expect(f.cards[0].id).not.toBe(f.cards[1].id);expect(f.cards[0].textbookEditionId).not.toBe(f.cards[1].textbookEditionId);
 const original=await tx.select().from(learningCards).where(and(eq(learningCards.subject,'english'),eq(learningCards.source,'builtin'))).orderBy(learningCards.id);
 const summaries=await applySeedContents(tx,seeds,[],[],refs);expect(summaries.every(s=>s.insertedCards===0)).toBe(true);
 const after=await tx.select().from(learningCards).where(and(eq(learningCards.subject,'english'),eq(learningCards.source,'builtin'))).orderBy(learningCards.id);expect(after).toEqual(original);
})});
test('篡改任何词表时整批拒绝，不留下半本新教材',async()=>{await withDatabaseRollback(async tx=>{
 const altered=structuredClone(seeds);altered[1].units[0].sections[0].cards[0].english.meaningZh='改过的释义';
 const before=await tx.select({id:learningCards.id}).from(learningCards);await expect(applySeedContents(tx,altered,[],[],refs)).rejects.toThrow('MISMATCH');expect(await tx.select({id:learningCards.id}).from(learningCards)).toEqual(before);
})});
test.each(['standard','assisted'] as const)('新词表%s听写无例句也可播放批改，孩子隔离仍有效',async mode=>{await withDatabaseRollback(async tx=>{
 const f=await fixture(tx);const card=f.cards[0];const task=await createDictationTaskService(tx).buildDailyTask(f.actor,{...base,childId:f.child.id,newCardIds:[card.id],maxReviewCards:0,commandId:crypto.randomUUID(),englishStudyOptions:{version:1,mode,includeRecognition:false}});
 const items=await tx.select().from(learningTaskItems).where(eq(learningTaskItems.taskId,task.id));for(const item of items){const mid=crypto.randomUUID();await tx.insert(privateMedia).values({id:mid,familyId:f.family.id,childId:f.child.id,kind:'tts_audio',mimeType:'audio/mpeg',byteSize:3,sha256:'c'.repeat(64),relativePath:`${mid.slice(0,2)}/${mid.slice(2,4)}/${mid}`,dedupeKey:item.ttsDedupeKey})}
 const sessions=createDictationSessionService(tx);const started=await sessions.startSession(f.childActor,task.id);const views=createChildDictationViewService(tx);const listening=await views.getSession(f.childActor,started.sessionId);expect(listening.phase).toBe('listening');expect(JSON.stringify(listening)).not.toMatch(/answerText|acceptedAnswers|sourceWord|exampleSentence/);if(listening.phase!=='listening')throw new Error('NOT_LISTENING');
 if(mode==='standard')expect(listening.items[0].englishHints).toBeUndefined();else expect(listening.items[0].englishHints?.meaningZh).toBeTruthy();
 await expect(views.getSession({...f.childActor,childId:f.sibling.id},started.sessionId)).rejects.toThrow('NOT_FOUND');
 await sessions.recordPlayback(f.childActor,{sessionId:started.sessionId,commandId:crypto.randomUUID(),expectedVersion:started.version,roundNumber:1,playedItemIds:[items[0].id],sequenceFinished:true});const grading=await views.getSession(f.childActor,started.sessionId);expect(grading.phase).toBe('grading');expect(JSON.stringify(grading)).toContain('pencil');
})});
