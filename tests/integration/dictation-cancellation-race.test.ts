import { eq, inArray } from "drizzle-orm";
import { expect, test } from "vitest";

import { db } from "@/db/client";
import { user } from "@/modules/auth/schema";
import { dictationSessions } from "@/modules/dictation/session-schema";
import { createDictationTaskManagementService } from "@/modules/dictation/task-management";
import { learningTasks } from "@/modules/dictation/task-schema";
import { children, families, guardians } from "@/modules/families/schema";
import { todoRewards, todoReviews, todoTasks } from "@/modules/todos/schema";
import { createTodoService } from "@/modules/todos/service";
import { todayShanghai } from "@/modules/todos/validation";

test("撤回与审核发积分、答题占用会话并发时保持一致且无锁序死锁", async () => {
  const authId = crypto.randomUUID();
  let familyId = "";
  let guardianId = "";
  let childId = "";
  const taskIds: string[] = [];
  const todoIds: string[] = [];
  try {
    await db.insert(user).values({ id: authId, name: "并发家长", email: `${authId}@example.test` });
    const [family] = await db.insert(families).values({ name: "撤回并发" }).returning();
    familyId = family.id;
    const [guardian] = await db.insert(guardians).values({ familyId, authUserId: authId }).returning();
    guardianId = guardian.id;
    const [child] = await db.insert(children).values({ familyId, nickname: "小雨", grade: 5 }).returning();
    childId = child.id;
    const actor = { role: "guardian" as const, familyId, guardianId };
    for (const status of ["submitted", "open"]) {
      const [task] = await db.insert(learningTasks).values({ familyId, childId, guardianId,
        commandId: crypto.randomUUID(), inputFingerprint: crypto.randomUUID(), mode: "continuous_batch",
        taskOrder: "source", intervalSeconds: 8, repeatCount: 1, speechRate: "1",
        allowManualReplay: true, maxReviewCards: 0 }).returning();
      taskIds.push(task.id);
      const [todo] = await db.insert(todoTasks).values({ familyId, childId, guardianId,
        commandId: crypto.randomUUID(), date: todayShanghai(), kind: "dictation",
        dictationTaskId: task.id, title: "测试听写", status,
        submissionNumber: status === "submitted" ? 1 : 0 }).returning();
      todoIds.push(todo.id);
    }

    let cancelDuringApproval!: Promise<void>;
    await db.transaction(async (tx) => {
      await tx.select({ id: todoTasks.id }).from(todoTasks).where(eq(todoTasks.id, todoIds[0])).for("update");
      cancelDuringApproval = createDictationTaskManagementService().cancelTask(actor, taskIds[0]);
      await new Promise((resolve) => setTimeout(resolve, 80));
      await createTodoService(tx).review(actor, todoIds[0], { number: 1, decision: "approved", bonus: 2, note: "" });
    });
    await expect(cancelDuringApproval).rejects.toThrow("TASK_REWARDED");
    expect((await db.select().from(learningTasks).where(eq(learningTasks.id, taskIds[0])))[0].status).toBe("active");
    expect((await db.select().from(todoRewards).where(eq(todoRewards.todoId, todoIds[0])))).toHaveLength(1);

    const [session] = await db.insert(dictationSessions).values({ familyId, childId,
      taskId: taskIds[1], mode: "continuous_batch", currentRoundItemIds: [] }).returning();
    let cancelDuringGrading!: Promise<void>;
    await db.transaction(async (tx) => {
      await tx.select({ id: learningTasks.id }).from(learningTasks)
        .where(eq(learningTasks.id, taskIds[1])).for("update");
      cancelDuringGrading = createDictationTaskManagementService().cancelTask(actor, taskIds[1]);
      await new Promise((resolve) => setTimeout(resolve, 80));
      await tx.select({ id: dictationSessions.id }).from(dictationSessions)
        .where(eq(dictationSessions.id, session.id)).for("update");
    });
    await expect(cancelDuringGrading).resolves.toBeUndefined();
    expect((await db.select().from(dictationSessions).where(eq(dictationSessions.id, session.id)))[0].status).toBe("cancelled");
  } finally {
    if (todoIds.length > 0) {
      await db.delete(todoRewards).where(inArray(todoRewards.todoId, todoIds));
      await db.delete(todoReviews).where(inArray(todoReviews.todoId, todoIds));
      await db.delete(todoTasks).where(inArray(todoTasks.id, todoIds));
    }
    if (taskIds.length > 0) {
      await db.delete(dictationSessions).where(inArray(dictationSessions.taskId, taskIds));
      await db.delete(learningTasks).where(inArray(learningTasks.id, taskIds));
    }
    if (childId) await db.delete(children).where(eq(children.id, childId));
    if (guardianId) await db.delete(guardians).where(eq(guardians.id, guardianId));
    if (familyId) await db.delete(families).where(eq(families.id, familyId));
    await db.delete(user).where(eq(user.id, authId));
  }
});
