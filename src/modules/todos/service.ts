import { and, eq, sql, asc, ne, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db, type DbTransaction } from '@/db/client';
import type { Actor, GuardianActor, ChildActor } from '@/modules/auth/actor';
import { children } from '@/modules/families/schema';
import { learningTasks, learningTaskItems } from '@/modules/dictation/task-schema';
import { dictationSessions } from '@/modules/dictation/session-schema';
import { activeTtsMediaPredicate } from '@/modules/media/active-cache';
import { privateMedia } from '@/modules/media/schema';
import { todoTasks, todoSubmissions, todoReviews, todoRewards } from './schema';
import { bonusSchema, dateSchema, taskInputSchema, updateManualSchema } from './validation';
type Database = typeof db | DbTransaction;
export type Attachment = {
    id: string;
    mimeType: string;
    byteSize: number;
};
const reviewSchema = z.object({ number: z.number().int().positive(), decision: z.enum(['approved', 'rejected']), bonus: bonusSchema, note: z.string().trim().max(2000) }).refine(v => v.decision !== 'rejected' || v.note.length > 0);
export function createTodoService(database: Database = db) {
    const scope = (actor: Actor) => and(eq(todoTasks.familyId, actor.familyId), actor.role === 'child' ? eq(todoTasks.childId, actor.childId) : undefined);
    async function create(actor: GuardianActor, input: unknown) {
        if (actor.role !== 'guardian')
            throw new Error('FORBIDDEN');
        const v = taskInputSchema.parse(input);
        return database.transaction(async (tx) => {
            const [child] = await tx.select({ id: children.id }).from(children).where(and(eq(children.id, v.childId), eq(children.familyId, actor.familyId), eq(children.active, true)));
            if (!child)
                throw new Error('TODO_NOT_FOUND');
            const [row] = await tx.insert(todoTasks).values({ familyId: actor.familyId, guardianId: actor.guardianId, childId: v.childId, title: v.title, requirements: v.requirements, date: v.date, commandId: v.commandId }).onConflictDoNothing().returning();
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
            const [row] = await tx.select().from(todoTasks).where(and(eq(todoTasks.familyId, actor.familyId), eq(todoTasks.id, id))).for('update');
            if (!row)
                throw new Error('TODO_NOT_FOUND');
            if (row.kind !== 'manual')
                throw new Error('TODO_KIND');
            if (row.status !== 'open' || row.updatedAt.toISOString() !== v.expectedUpdatedAt)
                throw new Error('TODO_STALE');
            const [updated] = await tx.update(todoTasks).set({ title: v.title, requirements: v.requirements, date: v.date,
                updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)) }).where(eq(todoTasks.id, id)).returning();
            return updated;
        });
    }
    async function cancelManual(actor: GuardianActor, id: string) {
        if (actor.role !== 'guardian')
            throw new Error('FORBIDDEN');
        z.string().uuid().parse(id);
        return database.transaction(async (tx) => {
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
    async function list(actor: Actor, date: string, childId?: string) {
        dateSchema.parse(date);
        if (childId)
            z.string().uuid().parse(childId);
        const rows = await database.select({ task: todoTasks, childName: children.nickname, attachmentId: todoSubmissions.attachmentId, mimeType: todoSubmissions.mimeType, base: todoRewards.basePoints, bonus: todoRewards.bonusPoints }).from(todoTasks).innerJoin(children, eq(children.id, todoTasks.childId)).leftJoin(todoSubmissions, and(eq(todoSubmissions.todoId, todoTasks.id), eq(todoSubmissions.number, todoTasks.submissionNumber))).leftJoin(todoRewards, eq(todoRewards.todoId, todoTasks.id)).where(and(scope(actor), eq(todoTasks.date, date), childId ? eq(todoTasks.childId, childId) : undefined, actor.role === 'child' ? ne(todoTasks.status, 'cancelled') : undefined)).orderBy(asc(todoTasks.createdAt));
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
        const [points] = await database.select({ total: sql<number> `coalesce(sum(${todoRewards.basePoints}+${todoRewards.bonusPoints}),0)::int` }).from(todoRewards).innerJoin(todoTasks, eq(todoTasks.id, todoRewards.todoId)).where(and(scope(actor), childId ? eq(todoTasks.childId, childId) : undefined));
        return { tasks: rows.map(r => { const counts = r.task.dictationTaskId ? mediaCounts.get(r.task.dictationTaskId) : undefined;
            return { ...r.task, childName: r.childName, attachment: r.attachmentId ? { id: r.attachmentId, mimeType: r.mimeType! } : null,
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
            await tx.insert(todoSubmissions).values({ todoId: id, number: number + 1, attachmentId: attachment?.id, mimeType: attachment?.mimeType, byteSize: attachment?.byteSize });
            await tx.update(todoTasks).set({ status: 'submitted', submissionNumber: number + 1, reviewNote: '', updatedAt: new Date() }).where(eq(todoTasks.id, id));
        });
    }
    async function review(actor: GuardianActor, id: string, input: unknown) {
        if (actor.role !== 'guardian')
            throw new Error('FORBIDDEN');
        z.string().uuid().parse(id);
        const v = reviewSchema.parse(input);
        return database.transaction(async (tx) => {
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
            if (v.decision === 'approved')
                await tx.insert(todoRewards).values({ todoId: id, basePoints: 1, bonusPoints: v.bonus });
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
    return { create, updateManual, cancelManual, list, submit, review, attachment };
}
