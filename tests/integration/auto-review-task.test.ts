import { eq } from "drizzle-orm";
import { expect, test } from "vitest";

import { user } from "@/modules/auth/schema";
import { learningTasks } from "@/modules/dictation/task-schema";
import { children, families, guardians } from "@/modules/families/schema";
import { learningCards } from "@/modules/learning-content/schema";
import { childCardStates } from "@/modules/review/db-schema";
import { createInitialState } from "@/modules/review/scheduler";
import { serializeFsrsCard } from "@/modules/review/schema";
import { createAutoReviewTaskService } from "@/modules/review/auto-review-task";
import { todoTasks } from "@/modules/todos/schema";

import { withDatabaseRollback } from "../helpers/database";

test("每日六点后自动汇总到期词，重复检查不会生成第二项", async () => {
  await withDatabaseRollback(async (tx) => {
    const authId = crypto.randomUUID();
    await tx.insert(user).values({ id: authId, name: "家长", email: `${authId}@example.test` });
    const [family] = await tx.insert(families).values({ name: "自动复习" }).returning();
    const [guardian] = await tx.insert(guardians).values({ familyId: family.id, authUserId: authId }).returning();
    const [child] = await tx.insert(children).values({ familyId: family.id, nickname: "小雨", grade: 5 }).returning();
    const [card] = await tx.insert(learningCards).values({
      familyId: family.id, subject: "chinese", source: "manual", answerText: "皱纹", broadcastText: "皱纹",
    }).returning();
    const state = createInitialState(new Date("2026-09-20T00:00:00Z"));
    await tx.insert(childCardStates).values({ familyId: family.id, childId: child.id, cardId: card.id,
      cardJson: serializeFsrsCard(state), dueAt: new Date("2026-09-23T00:00:00Z") });
    const service = createAutoReviewTaskService(tx);
    const beforeSix = new Date("2026-09-23T21:59:00Z");
    const afterSix = new Date("2026-09-23T22:00:00Z");
    expect(await service.ensureForChild(family.id, child.id, guardian.id, beforeSix)).toBe(0);
    expect(await service.ensureForChild(family.id, child.id, guardian.id, afterSix)).toBe(1);
    expect(await service.ensureForChild(family.id, child.id, guardian.id, afterSix)).toBe(0);
    const tasks = await tx.select().from(learningTasks).where(eq(learningTasks.childId, child.id));
    expect(tasks).toMatchObject([{ origin: "auto_review", title: "语文 · 到期复习" }]);
    expect((await tx.select().from(todoTasks).where(eq(todoTasks.childId, child.id))).map((todo) => todo.title)).toEqual(["语文 · 到期复习（1词）"]);
  });
});
