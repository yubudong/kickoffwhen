import { eq } from "drizzle-orm";
import { expect, test } from "vitest";

import type { DbTransaction } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { dictationSessions } from "@/modules/dictation/session-schema";
import { createDictationTaskManagementService } from "@/modules/dictation/task-management";
import { learningTaskItems, learningTasks } from "@/modules/dictation/task-schema";
import { createDictationTaskService } from "@/modules/dictation/task-service";
import { children, families, guardians } from "@/modules/families/schema";
import { learningCards } from "@/modules/learning-content/schema";
import { todoRewards, todoTasks } from "@/modules/todos/schema";
import { createTodoService } from "@/modules/todos/service";
import { todayShanghai } from "@/modules/todos/validation";

import { withDatabaseRollback } from "../helpers/database";

test("家长可移除未开始的词、撤回进行中任务，已发积分不可撤回", async () => {
  await withDatabaseRollback(async (tx) => {
    const authId = crypto.randomUUID();
    await tx.insert(user).values({ id: authId, name: "家长", email: `${authId}@example.test` });
    const [family] = await tx.insert(families).values({ name: "撤回测试" }).returning();
    const [guardian] = await tx.insert(guardians).values({ familyId: family.id, authUserId: authId }).returning();
    const [child] = await tx.insert(children).values({ familyId: family.id, nickname: "小雨", grade: 5 }).returning();
    const cards = await tx.insert(learningCards).values(["桂花", "故乡"].map((word) => ({
      familyId: family.id, subject: "chinese", answerText: word, broadcastText: word, source: "manual",
    }))).returning();
    const actor = { role: "guardian" as const, familyId: family.id, guardianId: guardian.id };
    const task = await createDictationTaskService(tx).buildDailyTask(actor, {
      childId: child.id, subject: "chinese", newCardIds: cards.map((card) => card.id),
      commandId: crypto.randomUUID(), maxReviewCards: 0, mode: "continuous_batch", order: "source",
      intervalSeconds: 8, repeatCount: 1, speechRate: 1, allowManualReplay: true,
    });
    const childActor = { role: "child" as const, familyId: family.id, childId: child.id,
      deviceId: crypto.randomUUID() };
    expect((await createTodoService(tx).list(childActor, todayShanghai())).tasks[0].dictationAudioStatus).toBe("preparing");
    const management = createDictationTaskManagementService(tx);
    await management.removeUnstartedTaskItem(actor, task.id, cards[0].id);
    await management.removeUnstartedTaskItem(actor, task.id, cards[0].id);
    expect((await tx.select().from(learningTaskItems).where(eq(learningTaskItems.taskId, task.id)))).toMatchObject([
      { cardId: cards[1].id, position: 0 },
    ]);
    expect((await tx.select().from(todoTasks).where(eq(todoTasks.dictationTaskId, task.id)))[0].title).toBe("今日听写（1词）");

    await tx.insert(dictationSessions).values({ familyId: family.id, childId: child.id, taskId: task.id,
      mode: "continuous_batch", currentRoundItemIds: [] });
    expect((await createTodoService(tx).list(childActor, todayShanghai())).tasks[0].dictationSessionStatus).toBe("active");
    await expect(management.removeUnstartedTaskItem(actor, task.id, cards[1].id)).rejects.toThrow("TASK_ALREADY_STARTED");
    await management.cancelTask(actor, task.id);
    expect((await tx.select().from(learningTasks).where(eq(learningTasks.id, task.id)))[0].status).toBe("cancelled");
    expect((await tx.select().from(todoTasks).where(eq(todoTasks.dictationTaskId, task.id)))[0].status).toBe("cancelled");
    expect((await tx.select().from(dictationSessions).where(eq(dictationSessions.taskId, task.id)))[0].status).toBe("cancelled");
    await management.cancelTask(actor, task.id);

    const second = await createDictationTaskService(tx).buildDailyTask(actor, {
      childId: child.id, subject: "chinese", newCardIds: [cards[0].id],
      commandId: crypto.randomUUID(), maxReviewCards: 0, mode: "continuous_batch", order: "source",
      intervalSeconds: 8, repeatCount: 1, speechRate: 1, allowManualReplay: true,
    });
    const [secondTodo] = await tx.select().from(todoTasks).where(eq(todoTasks.dictationTaskId, second.id));
    await tx.insert(todoRewards).values({ todoId: secondTodo.id, bonusPoints: 2 });
    await expect(management.cancelTask(actor, second.id)).rejects.toThrow("TASK_REWARDED");
    await expect(management.removeUnstartedTaskItem(actor, second.id, cards[0].id)).rejects.toThrow("TASK_REWARDED");

    const third = await createDictationTaskService(tx).buildDailyTask(actor, {
      childId: child.id, subject: "chinese", newCardIds: [cards[1].id],
      commandId: crypto.randomUUID(), maxReviewCards: 0, mode: "continuous_batch", order: "source",
      intervalSeconds: 8, repeatCount: 1, speechRate: 1, allowManualReplay: true,
    });
    await management.removeUnstartedTaskItem(actor, third.id, cards[1].id);
    await management.removeUnstartedTaskItem(actor, third.id, cards[1].id);
    expect((await tx.select().from(learningTasks).where(eq(learningTasks.id, third.id)))[0].status).toBe("cancelled");
    expect((await tx.select().from(todoTasks).where(eq(todoTasks.dictationTaskId, third.id)))[0].status).toBe("cancelled");
  });
});

test("会话撤回写入失败时，任务与待办也必须保持原状", async () => {
  await withDatabaseRollback(async (tx) => {
    const authId = crypto.randomUUID();
    await tx.insert(user).values({ id: authId, name: "家长", email: `${authId}@example.test` });
    const [family] = await tx.insert(families).values({ name: "撤回原子性" }).returning();
    const [guardian] = await tx.insert(guardians).values({ familyId: family.id, authUserId: authId }).returning();
    const [child] = await tx.insert(children).values({ familyId: family.id, nickname: "小雨", grade: 5 }).returning();
    const [card] = await tx.insert(learningCards).values({ familyId: family.id, subject: "chinese",
      answerText: "桂花", broadcastText: "桂花", source: "manual" }).returning();
    const actor = { role: "guardian" as const, familyId: family.id, guardianId: guardian.id };
    const task = await createDictationTaskService(tx).buildDailyTask(actor, {
      childId: child.id, subject: "chinese", newCardIds: [card.id], commandId: crypto.randomUUID(),
      maxReviewCards: 0, mode: "continuous_batch", order: "source", intervalSeconds: 8,
      repeatCount: 1, speechRate: 1, allowManualReplay: true,
    });
    await tx.insert(dictationSessions).values({ familyId: family.id, childId: child.id,
      taskId: task.id, mode: "continuous_batch", currentRoundItemIds: [] });
    const failSessionUpdate = (database: DbTransaction): DbTransaction => new Proxy(database, {
      get(target, property, receiver) {
        if (property === "update") return (table: unknown) => {
          if (table === dictationSessions) throw new Error("SESSION_WRITE_FAILED");
          return target.update(table as never);
        };
        if (property === "transaction") return <T,>(fn: (inner: DbTransaction) => Promise<T>) =>
          target.transaction((inner) => fn(failSessionUpdate(inner)));
        return Reflect.get(target, property, receiver);
      },
    });
    const failingDb = failSessionUpdate(tx);
    await expect(createDictationTaskManagementService(failingDb).cancelTask(actor, task.id))
      .rejects.toThrow("SESSION_WRITE_FAILED");
    expect((await tx.select().from(learningTasks).where(eq(learningTasks.id, task.id)))[0].status).toBe("active");
    expect((await tx.select().from(todoTasks).where(eq(todoTasks.dictationTaskId, task.id)))[0].status).toBe("open");
    expect((await tx.select().from(dictationSessions).where(eq(dictationSessions.taskId, task.id)))[0].status).toBe("active");
  });
});
