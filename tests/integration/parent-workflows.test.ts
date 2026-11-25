import { eq, sql } from 'drizzle-orm';
import { expect, test, vi } from 'vitest';
import type { DbTransaction } from '@/db/client';
import { user } from '@/modules/auth/schema';
import { families, guardians, children } from '@/modules/families/schema';
import { habitVersions, wallets } from '@/modules/engagement/schema';
import { todoTasks } from '@/modules/todos/schema';
import { createEngagementService } from '@/modules/engagement/service';
import { createParentWorkflows } from '@/modules/engagement/parent-workflows';
import { createTodoService } from '@/modules/todos/service';
import { changeWallet } from '@/modules/engagement/wallet';
import { withDatabaseRollback } from '../helpers/database';
import { readFileSync } from 'node:fs';
async function fixture(tx:DbTransaction){const id=crypto.randomUUID();await tx.insert(user).values({id,name:'家长流程测试',email:id+'@example.test'});const [f]=await tx.insert(families).values({name:'测试家庭'}).returning();const [g]=await tx.insert(guardians).values({familyId:f.id,authUserId:id}).returning();const kids=await tx.insert(children).values([{familyId:f.id,nickname:'甲',grade:5},{familyId:f.id,nickname:'乙',grade:3}]).returning();return {parent:{role:'guardian' as const,familyId:f.id,guardianId:g.id},kids,child:{role:'child' as const,familyId:f.id,childId:kids[0].id,deviceId:crypto.randomUUID()}}}
const config={title:'原阅读',requirements:'原要求',schedule:'daily',weekdays:[],weeklyTarget:3,confirmation:'parent',coins:2,growth:10};
function time(day:string){vi.setSystemTime(new Date(day+'T02:00:00Z'))}

test('习惯编辑次日起生效，当日任务和延期任务不改写，网络重试不加版本',async()=>{vi.useFakeTimers({toFake:['Date']});time('2026-11-25');try{await withDatabaseRollback(async tx=>{
 const {parent,child}=await fixture(tx);const s=createEngagementService(tx);const h=await s.createHabit(parent,{...config,commandId:crypto.randomUUID(),childId:child.childId,startDate:'2026-11-25'});
 await s.ensureHabits(child,'2026-11-25','2026-11-25');const [original]=await tx.select().from(todoTasks).where(eq(todoTasks.habitId,h.id));
 const input={...config,title:'新阅读',coins:9,growth:80,confirmation:'self',commandId:crypto.randomUUID(),expectedRevision:1};await s.editHabit(parent,h.id,input);await s.editHabit(parent,h.id,input);
 expect(await tx.select().from(habitVersions).where(eq(habitVersions.habitId,h.id))).toHaveLength(2);
 const today=await s.list(child);expect(today.habits[0].title).toBe('原阅读');expect(today.habits[0].pendingChange).toMatchObject({effectiveFrom:'2026-11-26',config:{title:'新阅读',coins:9}});
 expect((await tx.select().from(todoTasks).where(eq(todoTasks.id,original.id)))[0]).toEqual(original);
 await s.adjustOccurrence(parent,original.id,'postpone',original.updatedAt.toISOString());time('2026-11-26');await s.ensureHabits(child,'2026-11-26','2026-11-26');
 const tasks=await tx.select().from(todoTasks).where(eq(todoTasks.habitId,h.id));const moved=tasks.find(t=>t.id===original.id)!;expect(moved).toMatchObject({title:'原阅读',rewardCoins:2,rewardGrowth:10,date:'2026-11-26',habitRevisionId:original.habitRevisionId});expect(tasks.filter(t=>t.date==='2026-11-26'&&t.status==='open')).toHaveLength(1);
 time('2026-11-27');await s.ensureHabits(child,'2026-11-27','2026-11-27');const [fresh]=await tx.select().from(todoTasks).where(eq(todoTasks.occurrenceDate,'2026-11-27'));expect(fresh).toMatchObject({title:'新阅读',rewardCoins:9,rewardGrowth:80,confirmation:'self'});expect(fresh.habitRevisionId).not.toBe(original.habitRevisionId);
 })}finally{vi.useRealTimers()}});

test('旧编辑草稿、停止的习惯、孩子和其他家庭均不能覆盖新版本',()=>withDatabaseRollback(async tx=>{
 const {parent,child}=await fixture(tx),other=await fixture(tx);const s=createEngagementService(tx);const h=await s.createHabit(parent,{...config,commandId:crypto.randomUUID(),childId:child.childId,startDate:'2026-11-25'});
 await s.editHabit(parent,h.id,{...config,title:'第二版',expectedRevision:1,commandId:crypto.randomUUID()});
 await expect(s.editHabit(parent,h.id,{...config,title:'旧草稿',expectedRevision:1,commandId:crypto.randomUUID()})).rejects.toThrow('HABIT_STALE');
 await expect(s.editHabit(child,h.id,{...config,expectedRevision:2,commandId:crypto.randomUUID()})).rejects.toThrow('FORBIDDEN');
 await expect(s.editHabit(other.parent,h.id,{...config,expectedRevision:2,commandId:crypto.randomUUID()})).rejects.toThrow('NOT_FOUND');
 await s.stopHabit(parent,h.id);await expect(s.editHabit(parent,h.id,{...config,expectedRevision:2,commandId:crypto.randomUUID()})).rejects.toThrow('HABIT_STOPPED');
}));

test('每周次数编辑后继续计算原来的完成次数，不重复发奖',async()=>{vi.useFakeTimers({toFake:['Date']});time('2026-11-23');try{await withDatabaseRollback(async tx=>{
 const {parent,child}=await fixture(tx);const s=createEngagementService(tx),todos=createTodoService(tx);
 const h=await s.createHabit(parent,{...config,schedule:'weekly',weeklyTarget:1,confirmation:'self',childId:child.childId,startDate:'2026-11-23',commandId:crypto.randomUUID()});
 await s.ensureHabits(child,'2026-11-23','2026-11-23');let [row]=await tx.select().from(todoTasks).where(eq(todoTasks.habitId,h.id));await todos.submit(child,row.id,0);
 await s.editHabit(parent,h.id,{...config,schedule:'weekly',weeklyTarget:2,confirmation:'self',expectedRevision:1,commandId:crypto.randomUUID()});time('2026-11-24');await s.ensureHabits(child,'2026-11-24','2026-11-24');[row]=await tx.select().from(todoTasks).where(eq(todoTasks.occurrenceDate,'2026-11-24'));await todos.submit(child,row.id,0);
 time('2026-11-25');await s.ensureHabits(child,'2026-11-25','2026-11-25');expect(await tx.select().from(todoTasks).where(eq(todoTasks.habitId,h.id))).toHaveLength(2);expect((await s.list(child)).wallet.coins).toBe(4);
 })}finally{vi.useRealTimers()}});

test('家庭奖励共享设置、个人余额隔离，概览只返回本家庭待处理事项',()=>withDatabaseRollback(async tx=>{
 const {parent,child,kids}=await fixture(tx),other=await fixture(tx);const s=createEngagementService(tx),flow=createParentWorkflows(tx),todos=createTodoService(tx);
 await s.saveReward(parent,{title:'全家电影',price:20,commandId:crypto.randomUUID()});const family=await flow.family(parent);expect(family.balances).toHaveLength(2);expect(family.rewards).toHaveLength(1);expect((await flow.family(other.parent)).rewards).toHaveLength(0);
 const second={...child,childId:kids[1].id};expect((await s.list(second)).rewards[0].id).toBe(family.rewards[0].id);
 await changeWallet(tx,child,'fixture','fixture',{coins:50});await s.requestReward(child,{rewardId:family.rewards[0].id,commandId:crypto.randomUUID()});
 const t=await todos.create(parent,{childId:child.childId,title:'待审核任务',date:'2026-11-25',commandId:crypto.randomUUID()});await todos.submit(child,t.id,0);
 let actions=await flow.actions(parent);expect(actions.counts).toMatchObject({tasks:1,pending:1,approved:0});expect((await flow.actions(other.parent)).counts.tasks).toBe(0);
 await todos.review(parent,t.id,{number:1,decision:'approved',bonus:0,note:''});await todos.review(parent,t.id,{number:1,decision:'approved',bonus:0,note:''});
 const request=actions.requests[0].request;await s.decideReward(parent,{id:request.id,decision:'approve'});actions=await flow.actions(parent);expect(actions.counts).toMatchObject({tasks:0,pending:0,approved:1});await s.decideReward(parent,{id:request.id,decision:'complete'});expect((await flow.actions(parent)).counts.approved).toBe(0);
 expect((await s.list(second)).wallet.coins).toBe(0);await expect(flow.family(child as never)).rejects.toThrow('FORBIDDEN');
}));

test('0028实际迁移回填原规则和任务关联，原字段及钱包完全不变',()=>withDatabaseRollback(async tx=>{
 const {parent,child}=await fixture(tx);await changeWallet(tx,child,'fixture','fixture',{coins:42,growth:90});
 await tx.execute(sql.raw('ALTER TABLE todo_tasks DROP COLUMN habit_revision_id; DROP TABLE habit_versions; ALTER TABLE habits DROP COLUMN revision, DROP COLUMN updated_at;'));
 const id=crypto.randomUUID(),taskId=crypto.randomUUID();await tx.execute(sql`INSERT INTO habits (id,family_id,child_id,guardian_id,command_id,title,schedule,start_date) VALUES (${id},${parent.familyId},${child.childId},${parent.guardianId},${crypto.randomUUID()},'旧习惯','daily','2026-11-20')`);
 await tx.execute(sql`INSERT INTO todo_tasks (id,family_id,child_id,guardian_id,command_id,title,date,habit_id,occurrence_date,reward_coins) VALUES (${taskId},${parent.familyId},${child.childId},${parent.guardianId},${crypto.randomUUID()},'旧任务快照','2026-11-25',${id},'2026-11-25',7)`);
 const before=(await tx.execute(sql`SELECT to_jsonb(h) AS v FROM habits h WHERE id=${id}`)).rows;const taskBefore=(await tx.execute(sql`SELECT to_jsonb(t) AS v FROM todo_tasks t WHERE id=${taskId}`)).rows;const [walletBefore]=await tx.select().from(wallets).where(eq(wallets.childId,child.childId));
 for(const statement of readFileSync('drizzle/0028_small_trish_tilby.sql','utf8').split('--> statement-breakpoint'))if(statement.trim())await tx.execute(sql.raw(statement));
 expect((await tx.execute(sql`SELECT to_jsonb(h)-'revision'-'updated_at' AS v FROM habits h WHERE id=${id}`)).rows).toEqual(before);expect((await tx.execute(sql`SELECT to_jsonb(t)-'habit_revision_id' AS v FROM todo_tasks t WHERE id=${taskId}`)).rows).toEqual(taskBefore);
 const [v]=await tx.select().from(habitVersions).where(eq(habitVersions.habitId,id));expect(v.config.title).toBe('旧习惯');expect((await tx.select().from(todoTasks).where(eq(todoTasks.id,taskId)))[0].habitRevisionId).toBe(v.id);expect((await tx.select().from(wallets).where(eq(wallets.childId,child.childId)))[0]).toEqual(walletBefore);
}));
