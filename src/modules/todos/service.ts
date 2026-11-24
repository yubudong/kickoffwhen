import { and, eq, sql, asc, ne, inArray, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db, type DbTransaction } from '@/db/client';
import type { Actor, GuardianActor, ChildActor } from '@/modules/auth/actor';
import { children } from '@/modules/families/schema';
import { learningTasks, learningTaskItems } from '@/modules/dictation/task-schema';
import { dictationSessions } from '@/modules/dictation/session-schema';
import { activeTtsMediaPredicate } from '@/modules/media/active-cache';
import { privateMedia } from '@/modules/media/schema';
import { todoTasks, todoSubmissions, todoReviews, todoRewards } from './schema';
import { createEngagementService } from '@/modules/engagement/service';
import { habits } from '@/modules/engagement/schema';
import { boostAt, grantTodo, lockWallet } from '@/modules/engagement/wallet';
import { todoDateRange as habitDateRange } from './validation';
import { bonusSchema, taskInputSchema, todoDateRange, updateManualSchema, type TodoView, todayShanghai } from './validation';
type Database = typeof db | DbTransaction;
export type Attachment = {
    id: string;
    mimeType: string;
    byteSize: number;
};
const reviewSchema = z.object({ number: z.number().int().positive(), decision: z.enum(['approved', 'rejected']), bonus: bonusSchema, note: z.string().trim().max(2000) }).refine(v => v.decision !== 'rejected' || v.note.length > 0);
export function createTodoService(database: Database = db, clock: () => Date = () => new Date()) {
    const scope = (actor: Actor) => and(eq(todoTasks.familyId, actor.familyId), actor.role === 'child' ? eq(todoTasks.childId, actor.childId) : undefined);
    async function lockTaskOwner(tx: DbTransaction, actor: Actor, id: string) {
        const [task] = await tx.select({ familyId: todoTasks.familyId, childId: todoTasks.childId }).from(todoTasks).where(and(scope(actor), eq(todoTasks.id, id)));
        if (!task) throw new Error('TODO_NOT_FOUND');
        await lockWallet(tx, task);
    }
    async function create(actor: GuardianActor, input: unknown) {
        if (actor.role !== 'guardian')
            throw new Error('FORBIDDEN');
        const v = taskInputSchema.parse(input);
        return database.transaction(async (tx) => {
            const [child] = await tx.select({ id: children.id }).from(children).where(and(eq(children.id, v.childId), eq(children.familyId, actor.familyId), eq(children.active, true)));
            if (!child)
                throw new Error('TODO_NOT_FOUND');
            const [row] = await tx.insert(todoTasks).values({ familyId: actor.familyId, guardianId: actor.guardianId, childId: v.childId, title: v.title, requirements: v.requirements, date: v.date, commandId: v.commandId, rewardCoins: v.rewardCoins, rewardGrowth: v.rewardGrowth, confirmation: v.confirmation }).onConflictDoNothing().returning();
            if (row)
                return row;
            const [existing] = await tx.select().from(todoTasks).where(and(eq(todoTasks.familyId, actor.familyId), eq(todoTasks.commandId, v.commandId)));
            if (!existing || existing.childId !== v.childId || existing.title !== v.title || existing.requirements !== v.requirements || existing.date !== v.date)
                throw new Error('TODO_STALE');
            return existing;
        });
    }
    async function updateManual(actor: GuardianActor, id: string, input: unknown) {
        if (actor.role !== 'guardian')
            throw new Error('FORBIDDEN');
        z.string().uuid().parse(id);
        const v = updateManualSchema.parse(input);
        return database.transaction(async (tx) => {
            await lockTaskOwner(tx, actor, id);
            const [row] = await tx.select().from(todoTasks).where(and(eq(todoTasks.familyId, actor.familyId), eq(todoTasks.id, id))).for('update');
            if (!row)
                throw new Error('TODO_NOT_FOUND');
            if (row.kind !== 'manual')
                throw new Error('TODO_KIND');
            if (row.habitId && v.date !== row.date) throw new Error('HABIT_DATE');
            if (row.status !== 'open' || row.updatedAt.toISOString() !== v.expectedUpdatedAt)
                throw new Error('TODO_STALE');
            const [updated] = await tx.update(todoTasks).set({ title: v.title, requirements: v.requirements, date: v.date,
                rewardCoins: v.rewardCoins ?? row.rewardCoins, rewardGrowth: v.rewardGrowth ?? row.rewardGrowth, confirmation: v.confirmation ?? row.confirmation,
                updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)) }).where(eq(todoTasks.id, id)).returning();
            return updated;
        });
    }
    async function configureRewards(actor: GuardianActor, id: string, input: unknown) {
        if (actor.role !== 'guardian') throw new Error('FORBIDDEN');
        z.string().uuid().parse(id);
        const v = z.object({ expectedUpdatedAt: z.iso.datetime(), rewardCoins: bonusSchema, rewardGrowth: bonusSchema }).parse(input);
        return database.transaction(async tx => {
            await lockTaskOwner(tx, actor, id);
            const [row] = await tx.select().from(todoTasks).where(and(scope(actor), eq(todoTasks.id, id))).for('update');
            if (!row || row.status !== 'open' || row.updatedAt.toISOString() !== v.expectedUpdatedAt) throw new Error('TODO_STALE');
            await tx.update(todoTasks).set({ rewardCoins: v.rewardCoins, rewardGrowth: v.rewardGrowth, updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)) }).where(eq(todoTasks.id, id));
        });
    }
    async function cancelManual(actor: GuardianActor, id: string) {
        if (actor.role !== 'guardian')
            throw new Error('FORBIDDEN');
        z.string().uuid().parse(id);
        return database.transaction(async (tx) => {
            await lockTaskOwner(tx, actor, id);
            const [row] = await tx.select().from(todoTasks).where(and(eq(todoTasks.familyId, actor.familyId), eq(todoTasks.id, id))).for('update');
            if (!row)
                throw new Error('TODO_NOT_FOUND');
            if (row.kind !== 'manual')
                throw new Error('TODO_KIND');
            if (row.status === 'cancelled')
                return;
            if (row.status === 'approved')
                throw new Error('TODO_REWARDED');
            const [reward] = await tx.select({ id: todoRewards.id }).from(todoRewards).where(eq(todoRewards.todoId, id));
            if (reward)
                throw new Error('TODO_REWARDED');
            await tx.update(todoTasks).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(todoTasks.id, id));
        });
    }
    async function list(actor: Actor, date: string, childId?: string, view: TodoView = 'day') {
        const range = todoDateRange(date, view);
        if (childId)
            z.string().uuid().parse(childId);
        if (actor.role === 'child' || childId) await createEngagementService(database).ensureHabits(actor, range.from, range.to, childId);
        const inRange = and(gte(todoTasks.date, range.from), lte(todoTasks.date, range.to));
        const rows = await database.select({ task: todoTasks, childName: children.nickname, dictationPhase: dictationSessions.phase, gradingMode: learningTasks.gradingMode, attachmentId: todoSubmissions.attachmentId, mimeType: todoSubmissions.mimeType, base: todoRewards.basePoints, bonus: todoRewards.bonusPoints }).from(todoTasks).innerJoin(children, eq(children.id, todoTasks.childId)).leftJoin(learningTasks, and(eq(learningTasks.id, todoTasks.dictationTaskId), eq(learningTasks.familyId, todoTasks.familyId), eq(learningTasks.childId, todoTasks.childId))).leftJoin(dictationSessions, and(eq(dictationSessions.taskId, learningTasks.id), eq(dictationSessions.familyId, todoTasks.familyId), eq(dictationSessions.childId, todoTasks.childId))).leftJoin(todoSubmissions, and(eq(todoSubmissions.todoId, todoTasks.id), eq(todoSubmissions.number, todoTasks.submissionNumber))).leftJoin(todoRewards, eq(todoRewards.todoId, todoTasks.id)).where(and(scope(actor), inRange, childId ? eq(todoTasks.childId, childId) : undefined, actor.role === 'child' ? ne(todoTasks.status, 'cancelled') : undefined)).orderBy(asc(todoTasks.date), asc(todoTasks.createdAt));
        const taskIds = rows.flatMap(({ task }) => task.dictationTaskId ? [task.dictationTaskId] : []);
        const mediaRows = taskIds.length ? await database.select({ taskId: learningTaskItems.taskId, mediaId: privateMedia.id })
            .from(learningTaskItems).leftJoin(privateMedia, activeTtsMediaPredicate({
                dedupeKey: learningTaskItems.ttsDedupeKey, familyId: learningTaskItems.familyId,
                childId: learningTaskItems.childId, at: new Date(),
            })).where(inArray(learningTaskItems.taskId, taskIds)) : [];
        const sessionRows = taskIds.length ? await database.select({ taskId: dictationSessions.taskId,
            status: dictationSessions.status }).from(dictationSessions)
            .where(inArray(dictationSessions.taskId, taskIds)) : [];
        const mediaCounts = new Map<string, { total: number; ready: number }>();
        for (const row of mediaRows) {
            const counts = mediaCounts.get(row.taskId) ?? { total: 0, ready: 0 };
            counts.total += 1;
            if (row.mediaId) counts.ready += 1;
            mediaCounts.set(row.taskId, counts);
        }
        const sessionStatus = new Map(sessionRows.map((row) => [row.taskId, row.status]));
        const [points] = await database.select({ total: sql<number> `coalesce(sum(${todoRewards.basePoints}+${todoRewards.bonusPoints}),0)::int` }).from(todoRewards).innerJoin(todoTasks, eq(todoTasks.id, todoRewards.todoId)).where(and(scope(actor), inRange, childId ? eq(todoTasks.childId, childId) : undefined));
        const habitIds = [...new Set(rows.flatMap(r => r.task.habitId ? [r.task.habitId] : []))];
        const habitConfigs = habitIds.length ? await database.select().from(habits).where(and(eq(habits.familyId, actor.familyId), inArray(habits.id, habitIds))) : [];
        const habitFacts = habitIds.length ? await database.select({ habitId: todoTasks.habitId, date: todoTasks.date, status: todoTasks.status }).from(todoTasks).where(and(scope(actor), inArray(todoTasks.habitId, habitIds), gte(todoTasks.date, habitDateRange(range.from, 'week').from), lte(todoTasks.date, habitDateRange(range.to, 'week').to))) : [];
        return { tasks: rows.map(r => { const counts = r.task.dictationTaskId ? mediaCounts.get(r.task.dictationTaskId) : undefined;
            const habit = habitConfigs.find(h => h.id === r.task.habitId);
            const week = habitDateRange(r.task.date, 'week');
            const facts = habitFacts.filter(f => f.habitId === r.task.habitId && f.date >= week.from && f.date <= week.to);
            const habitProgress = habit?.schedule === 'weekly' ? { target: habit.weeklyTarget, completed: facts.filter(f => f.status === 'approved').length, pending: facts.filter(f => f.status === 'submitted').length } : null;
            return { ...r.task, habitProgress, childName: r.childName, dictationPhase: r.dictationPhase, gradingMode: r.gradingMode, attachment: r.attachmentId ? { id: r.attachmentId, mimeType: r.mimeType! } : null,
                points: r.base === null ? null : r.base + (r.bonus ?? 0),
                dictationAudioStatus: r.task.dictationTaskId ? counts && counts.total > 0 && counts.total === counts.ready ? 'ready' : 'preparing' : null,
                dictationSessionStatus: r.task.dictationTaskId ? sessionStatus.get(r.task.dictationTaskId) ?? null : null };
        }), points: points.total };
    }
    async function submit(actor: ChildActor, id: string, number: number, attachment?: Attachment) {
        z.string().uuid().parse(id);
        z.number().int().nonnegative().parse(number);
        if (actor.role !== 'child')
            throw new Error('FORBIDDEN');
        return database.transaction(async (tx) => {
            await lockTaskOwner(tx, actor, id);
            const [row] = await tx.select().from(todoTasks).where(and(scope(actor), eq(todoTasks.id, id))).for('update');
            if (!row)
                throw new Error('TODO_NOT_FOUND');
            if (row.submissionNumber !== number || !['open', 'rejected'].includes(row.status))
                throw new Error('TODO_STALE');
            if (row.dictationTaskId) {
                const [task] = await tx.select().from(learningTasks).where(eq(learningTasks.id, row.dictationTaskId));
                if (task?.status !== 'completed')
                    throw new Error('DICTATION_INCOMPLETE');
                if (attachment && !['image/jpeg', 'image/png', 'image/webp'].includes(attachment.mimeType))
                    throw new Error('DICTATION_IMAGE_ONLY');
            }
            if (row.habitId) {
                const [habit] = await tx.select().from(habits).where(eq(habits.id, row.habitId)).for('update');
                if (!habit || (habit.stoppedOn && row.date >= habit.stoppedOn)) throw new Error('TODO_STALE');
                const [sameDay] = await tx.select({ id: todoTasks.id }).from(todoTasks).where(and(eq(todoTasks.habitId, habit.id), eq(todoTasks.date, row.date), ne(todoTasks.id, row.id), inArray(todoTasks.status, ['submitted','approved'])));
                if (sameDay) throw new Error('WEEKLY_LIMIT');
                if (habit.schedule === 'weekly') {
                    const week = habitDateRange(row.date, 'week');
                    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(todoTasks).where(and(eq(todoTasks.habitId, habit.id), gte(todoTasks.date, week.from), lte(todoTasks.date, week.to), inArray(todoTasks.status, ['submitted','approved'])));
                    if (count.n >= habit.weeklyTarget) throw new Error('WEEKLY_LIMIT');
                    if (row.date !== todayShanghai(clock())) throw new Error('HABIT_DATE');
                }
            }
            const submittedBoost = await boostAt(tx, row, clock());
            await tx.insert(todoSubmissions).values({ todoId: id, number: number + 1, attachmentId: attachment?.id, mimeType: attachment?.mimeType, byteSize: attachment?.byteSize });
            const autonomous = row.confirmation === 'self' && row.kind === 'manual';
            if (autonomous) {
                await tx.insert(todoRewards).values({ todoId: id, basePoints: row.rewardCoins, bonusPoints: 0 });
                await grantTodo(tx, { ...row, submittedBoost }, 0);
            }
            await tx.update(todoTasks).set({ status: autonomous ? 'approved' : 'submitted', submittedBoost, submissionNumber: number + 1, reviewNote: '', updatedAt: new Date() }).where(eq(todoTasks.id, id));
        });
    }
    async function review(actor: GuardianActor, id: string, input: unknown) {
        if (actor.role !== 'guardian')
            throw new Error('FORBIDDEN');
        z.string().uuid().parse(id);
        const v = reviewSchema.parse(input);
        return database.transaction(async (tx) => {
            await lockTaskOwner(tx, actor, id);
            const [row] = await tx.select().from(todoTasks).where(and(scope(actor), eq(todoTasks.id, id))).for('update');
            if (!row)
                throw new Error('TODO_NOT_FOUND');
            if (row.submissionNumber !== v.number)
                throw new Error('TODO_STALE');
            if (row.status === v.decision)
                return;
            if (row.status !== 'submitted')
                throw new Error('TODO_STALE');
            await tx.insert(todoReviews).values({ todoId: id, submissionNumber: v.number, guardianId: actor.guardianId, decision: v.decision, note: v.note });
            if (v.decision === 'approved') {
                await tx.insert(todoRewards).values({ todoId: id, basePoints: row.rewardCoins, bonusPoints: v.bonus });
                await grantTodo(tx, row, v.bonus);
            }
            await tx.update(todoTasks).set({ status: v.decision, reviewNote: v.note, updatedAt: new Date() }).where(eq(todoTasks.id, id));
        });
    }
    async function attachment(actor: Actor, id: string) {
        z.string().uuid().parse(id);
        const [row] = await database.select({ id: todoSubmissions.attachmentId, mimeType: todoSubmissions.mimeType, byteSize: todoSubmissions.byteSize }).from(todoSubmissions).innerJoin(todoTasks, eq(todoTasks.id, todoSubmissions.todoId)).where(and(scope(actor), eq(todoSubmissions.attachmentId, id)));
        if (!row)
            throw new Error('TODO_NOT_FOUND');
        return row;
    }
    return { create, updateManual, configureRewards, cancelManual, list, submit, review, attachment };
}
