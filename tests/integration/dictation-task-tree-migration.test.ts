import { sql } from "drizzle-orm";
import { expect, test } from "vitest";

import { user } from "@/modules/auth/schema";
import { learningTasks } from "@/modules/dictation/task-schema";
import { children, families, guardians } from "@/modules/families/schema";
import { todoTasks } from "@/modules/todos/schema";

import { withDatabaseRollback } from "../helpers/database";

test("旧任务仍可读取，新增来源可写入，误派待办可标记撤回", async () => {
  await withDatabaseRollback(async (tx) => {
    const suffix = crypto.randomUUID();
    await tx.insert(user).values({ id: suffix, name: "旧家长", email: `${suffix}@example.test` });
    const [family] = await tx.insert(families).values({ name: "旧家庭" }).returning();
    const [guardian] = await tx.insert(guardians).values({ familyId: family.id, authUserId: suffix }).returning();
    const [child] = await tx.insert(children).values({ familyId: family.id, nickname: "孩子", grade: 5 }).returning();
    const [task] = await tx.insert(learningTasks).values({
      familyId: family.id, childId: child.id, guardianId: guardian.id,
      commandId: crypto.randomUUID(), inputFingerprint: "old task", mode: "continuous_batch",
      taskOrder: "source", intervalSeconds: 8, repeatCount: 1, speechRate: "1",
      allowManualReplay: true, maxReviewCards: 0,
    }).returning();
    const [todo] = await tx.insert(todoTasks).values({
      familyId: family.id, childId: child.id, guardianId: guardian.id,
      commandId: task.commandId, title: "旧听写", date: "2026-09-23",
      kind: "dictation", dictationTaskId: task.id,
    }).returning();

    await tx.execute(sql`update learning_tasks set origin = 'curriculum', batch_command_id = ${crypto.randomUUID()} where id = ${task.id}`);
    await tx.execute(sql`update todo_tasks set status = 'cancelled' where id = ${todo.id}`);
    const result = await tx.execute(sql`select t.id, t.origin, d.status from learning_tasks t join todo_tasks d on d.dictation_task_id=t.id where t.id=${task.id}`);
    expect(result.rows).toEqual([{ id: task.id, origin: "curriculum", status: "cancelled" }]);
  });
});
