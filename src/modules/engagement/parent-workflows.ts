import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, type DbTransaction } from '@/db/client';
import type { GuardianActor } from '@/modules/auth/actor';
import { children } from '@/modules/families/schema';
import { todoTasks, todoSubmissions } from '@/modules/todos/schema';
import { dictationSessions, dictationSubmissions } from '@/modules/dictation/session-schema';
import { learningTasks } from '@/modules/dictation/task-schema';
import type { Json } from './types';
import { familyRewards, rewardRequests, wallets } from './schema';
export function createParentWorkflows(database: typeof db | DbTransaction = db) {
  function parent(actor: GuardianActor) { if (actor.role !== 'guardian') throw new Error('FORBIDDEN'); }
  async function family(actor: GuardianActor) {
    parent(actor);
    const rewards = await database.select().from(familyRewards).where(eq(familyRewards.familyId,actor.familyId)).orderBy(asc(familyRewards.createdAt));
    const requests = await database.select({ request:rewardRequests,childName:children.nickname }).from(rewardRequests).innerJoin(children,and(eq(children.id,rewardRequests.childId),eq(children.familyId,actor.familyId))).where(eq(rewardRequests.familyId,actor.familyId)).orderBy(desc(rewardRequests.createdAt)).limit(200);
    const balances = await database.select({ childId:children.id,nickname:children.nickname,coins:wallets.coins,held:wallets.held,growth:wallets.growth }).from(children).leftJoin(wallets,and(eq(wallets.childId,children.id),eq(wallets.familyId,actor.familyId))).where(eq(children.familyId,actor.familyId)).orderBy(asc(children.createdAt));
    return { rewards, requests, balances:balances.map(b => ({...b,coins:b.coins??0,held:b.held??0,growth:b.growth??0,available:(b.coins??0)-(b.held??0)})) };
  }
  async function actions(actor: GuardianActor) {
    parent(actor);
    const taskScope=and(eq(todoTasks.familyId,actor.familyId),eq(todoTasks.status,'submitted'));
    const requestScope=and(eq(rewardRequests.familyId,actor.familyId),inArray(rewardRequests.status,['pending','approved']));
    const photoScope=and(eq(dictationSubmissions.familyId,actor.familyId),eq(dictationSubmissions.status,'pending'),eq(dictationSessions.phase,'awaiting_parent'),eq(dictationSessions.status,'active'),eq(learningTasks.status,'active'));
    const tasks=await database.select({task:todoTasks,childName:children.nickname,attachmentId:todoSubmissions.attachmentId,mimeType:todoSubmissions.mimeType}).from(todoTasks).innerJoin(children,and(eq(children.id,todoTasks.childId),eq(children.familyId,actor.familyId))).leftJoin(todoSubmissions,and(eq(todoSubmissions.todoId,todoTasks.id),eq(todoSubmissions.number,todoTasks.submissionNumber))).where(taskScope).orderBy(asc(todoTasks.updatedAt)).limit(100);
    const requests=await database.select({request:rewardRequests,childName:children.nickname}).from(rewardRequests).innerJoin(children,and(eq(children.id,rewardRequests.childId),eq(children.familyId,actor.familyId))).where(requestScope).orderBy(asc(rewardRequests.createdAt));
    const photos=await database.select({sessionId:dictationSessions.id,childName:children.nickname,roundNumber:dictationSessions.roundNumber,submittedAt:dictationSubmissions.createdAt}).from(dictationSubmissions).innerJoin(dictationSessions,eq(dictationSessions.id,dictationSubmissions.sessionId)).innerJoin(learningTasks,eq(learningTasks.id,dictationSessions.taskId)).innerJoin(children,and(eq(children.id,dictationSubmissions.childId),eq(children.familyId,actor.familyId))).where(photoScope).orderBy(asc(dictationSubmissions.createdAt)).limit(100);
    const [tc]=await database.select({n:sql<number>`count(*)::int`}).from(todoTasks).where(taskScope);
    const [rc]=await database.select({pending:sql<number>`count(*) filter (where status='pending')::int`,approved:sql<number>`count(*) filter (where status='approved')::int`}).from(rewardRequests).where(requestScope);
    const [pc]=await database.select({n:sql<number>`count(*)::int`}).from(dictationSubmissions).innerJoin(dictationSessions,eq(dictationSessions.id,dictationSubmissions.sessionId)).innerJoin(learningTasks,eq(learningTasks.id,dictationSessions.taskId)).where(photoScope);
    return {tasks,requests,photos,counts:{tasks:tc.n,pending:rc.pending,approved:rc.approved,photos:pc.n}};
  }
  return {family,actions};
}
export type FamilyRewardsView=Json<Awaited<ReturnType<ReturnType<typeof createParentWorkflows>['family']>>>;
export type ParentActionsView=Json<Awaited<ReturnType<ReturnType<typeof createParentWorkflows>['actions']>>>;
