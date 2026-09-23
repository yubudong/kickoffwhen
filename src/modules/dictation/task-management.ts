import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { db, type DbTransaction } from "@/db/client";
import type { GuardianActor } from "@/modules/auth/actor";
import { learningCards } from "@/modules/learning-content/schema";
import { todoRewards, todoTasks } from "@/modules/todos/schema";

import { dictationSessions } from "./session-schema";
import { learningTaskItems, learningTasks } from "./task-schema";

type Database = typeof db | DbTransaction;

export function createDictationTaskManagementService(database: Database = db) {
  async function getManagedTask(actor: GuardianActor, rawTaskId: string) {
    const taskId = z.string().uuid().parse(rawTaskId);
    const [task] = await database.select().from(learningTasks).where(and(
      eq(learningTasks.id, taskId), eq(learningTasks.familyId, actor.familyId),
    )).limit(1);
    if (!task) throw new Error("TASK_NOT_FOUND");
    const items = await database.select({ id: learningTaskItems.id, cardId: learningTaskItems.cardId,
      answerText: learningCards.answerText, position: learningTaskItems.position })
      .from(learningTaskItems).innerJoin(learningCards, eq(learningCards.id, learningTaskItems.cardId))
      .where(eq(learningTaskItems.taskId, taskId)).orderBy(asc(learningTaskItems.position));
    const [session] = await database.select({ id: dictationSessions.id }).from(dictationSessions)
      .where(eq(dictationSessions.taskId, taskId)).limit(1);
    const [todo] = await database.select({ status: todoTasks.status }).from(todoTasks)
      .where(eq(todoTasks.dictationTaskId, taskId)).limit(1);
    return { id: task.id, title: task.title, status: task.status,
      todoStatus: todo?.status ?? null, started: Boolean(session), items };
  }

  async function lockTask(tx: DbTransaction, actor: GuardianActor, taskId: string) {
    const [task] = await tx.select().from(learningTasks).where(and(
      eq(learningTasks.id, taskId), eq(learningTasks.familyId, actor.familyId),
    )).limit(1).for("update");
    if (!task) throw new Error("TASK_NOT_FOUND");
    return task;
  }

  async function ensureNoReward(tx: DbTransaction, taskId: string) {
    const [reward] = await tx.select({ id: todoRewards.id }).from(todoRewards)
      .innerJoin(todoTasks, eq(todoTasks.id, todoRewards.todoId))
      .where(eq(todoTasks.dictationTaskId, taskId)).limit(1);
    if (reward) throw new Error("TASK_REWARDED");
  }

  async function cancelLocked(tx: DbTransaction, taskId: string) {
    const at = new Date();
    await tx.update(learningTasks).set({ status: "cancelled" }).where(eq(learningTasks.id, taskId));
    await tx.update(todoTasks).set({ status: "cancelled", updatedAt: at })
      .where(eq(todoTasks.dictationTaskId, taskId));
    await tx.update(dictationSessions).set({ status: "cancelled", cancelledAt: at, updatedAt: at })
      .where(and(eq(dictationSessions.taskId, taskId), eq(dictationSessions.status, "active")));
  }

  async function cancelTask(actor: GuardianActor, rawTaskId: string): Promise<void> {
    const taskId = z.string().uuid().parse(rawTaskId);
    await database.transaction(async (tx) => {
      const task = await lockTask(tx, actor, taskId);
      if (task.status === "cancelled") return;
      await ensureNoReward(tx, taskId);
      await cancelLocked(tx, taskId);
    });
  }

  async function removeUnstartedTaskItem(actor: GuardianActor, rawTaskId: string, rawCardId: string): Promise<void> {
    const taskId = z.string().uuid().parse(rawTaskId);
    const cardId = z.string().uuid().parse(rawCardId);
    await database.transaction(async (tx) => {
      const task = await lockTask(tx, actor, taskId);
      if (task.status !== "active") throw new Error("TASK_NOT_ACTIVE");
      await ensureNoReward(tx, taskId);
      const [session] = await tx.select({ id: dictationSessions.id }).from(dictationSessions)
        .where(eq(dictationSessions.taskId, taskId)).limit(1);
      if (session) throw new Error("TASK_ALREADY_STARTED");
      const [item] = await tx.select().from(learningTaskItems).where(and(
        eq(learningTaskItems.taskId, taskId), eq(learningTaskItems.cardId, cardId),
      )).limit(1);
      if (!item) throw new Error("TASK_ITEM_NOT_FOUND");
      await tx.delete(learningTaskItems).where(eq(learningTaskItems.id, item.id));
      const remaining = await tx.select({ id: learningTaskItems.id, position: learningTaskItems.position })
        .from(learningTaskItems).where(eq(learningTaskItems.taskId, taskId))
        .orderBy(asc(learningTaskItems.position));
      if (remaining.length === 0) {
        await cancelLocked(tx, taskId);
        return;
      }
      for (const [index, row] of remaining.entries()) {
        if (row.position !== index) await tx.update(learningTaskItems).set({ position: index })
          .where(eq(learningTaskItems.id, row.id));
      }
      await tx.update(todoTasks).set({ title: `${task.title}（${remaining.length}词）`, updatedAt: new Date() })
        .where(eq(todoTasks.dictationTaskId, taskId));
    });
  }

  return { getManagedTask, cancelTask, removeUnstartedTaskItem };
}
