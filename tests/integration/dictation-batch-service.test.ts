import { eq } from "drizzle-orm";
import { expect, test } from "vitest";

import { user } from "@/modules/auth/schema";
import { createDictationTaskService } from "@/modules/dictation/task-service";
import { createTaskBuilderQueryService } from "@/modules/dictation/task-builder-query";
import { learningTasks } from "@/modules/dictation/task-schema";
import { children, families, guardians } from "@/modules/families/schema";
import { learningCards, textbookEditions, textbookSections, textbookUnits } from "@/modules/learning-content/schema";
import { todoTasks } from "@/modules/todos/schema";
import { childCardStates } from "@/modules/review/db-schema";
import { createInitialState } from "@/modules/review/scheduler";
import { serializeFsrsCard } from "@/modules/review/schema";

import { withDatabaseRollback } from "../helpers/database";

test("勾选单元后每课产生一项听写与待办，重复提交不增加任务", async () => {
  await withDatabaseRollback(async (tx) => {
    const authId = crypto.randomUUID();
    await tx.insert(user).values({ id: authId, name: "家长", email: `${authId}@example.test` });
    const [family] = await tx.insert(families).values({ name: "单元听写" }).returning();
    const [guardian] = await tx.insert(guardians).values({ familyId: family.id, authUserId: authId }).returning();
    const [child] = await tx.insert(children).values({ familyId: family.id, nickname: "小雨", grade: 5 }).returning();
    const [edition] = await tx.insert(textbookEditions).values({ publisher: "统编", series: "语文", subject: "chinese", grade: 5, volume: "上册", editionText: "测试版" }).returning();
    const [unit] = await tx.insert(textbookUnits).values({ textbookEditionId: edition.id, unitOrder: 1, title: "第一单元" }).returning();
    const sections = await tx.insert(textbookSections).values([
      { unitId: unit.id, sectionKey: "lesson-1", sectionOrder: 1, title: "第1课", sectionType: "lesson" },
      { unitId: unit.id, sectionKey: "lesson-2", sectionOrder: 2, title: "第2课", sectionType: "lesson" },
    ]).returning();
    await tx.insert(textbookSections).values({ unitId: unit.id, sectionKey: "lesson-3",
      sectionOrder: 3, title: "第3课", sectionType: "lesson" });
    await tx.insert(learningCards).values(sections.map((section, index) => ({
      subject: "chinese", answerText: index ? "故乡" : "桂花", broadcastText: index ? "故乡" : "桂花",
      source: "builtin", builtinKey: `unit-batch-${authId}-${index}`, textbookEditionId: edition.id,
      unitId: unit.id, sectionId: section.id, sourceOrder: 1,
    })));
    const actor = { role: "guardian" as const, familyId: family.id, guardianId: guardian.id };
    const catalog = (await createTaskBuilderQueryService(tx).getTaskBuilderData(actor)).catalog;
    expect(catalog.find((item) => item.id === edition.id)?.units[0].sections.map((section) => section.title))
      .toEqual(["第1课", "第2课", "第3课"]);
    const service = createDictationTaskService(tx);
    const input = {
      childId: child.id, subject: "chinese" as const, sectionIds: sections.map((section) => section.id),
      extraCardIds: [], commandId: crypto.randomUUID(), mode: "continuous_batch" as const,
      order: "source" as const, intervalSeconds: 8, repeatCount: 1 as const,
      speechRate: 1, allowManualReplay: true,
    };
    const first = await service.buildTaskBatch(actor, input);
    const retry = await service.buildTaskBatch(actor, input);
    expect(first.map((task) => task.id)).toEqual(retry.map((task) => task.id));
    await expect(service.buildTaskBatch(actor, { ...input, intervalSeconds: 9 })).rejects.toThrow("TASK_IDEMPOTENCY_CONFLICT");
    expect(first).toHaveLength(2);
    const saved = await tx.select().from(learningTasks).where(eq(learningTasks.familyId, family.id));
    expect(saved.map((task) => task.title)).toEqual(["语文 · 第一单元 · 第1课", "语文 · 第一单元 · 第2课"]);
    expect((await tx.select().from(todoTasks).where(eq(todoTasks.familyId, family.id))).map((todo) => todo.title).sort()).toEqual([
      "语文 · 第一单元 · 第1课（1词）", "语文 · 第一单元 · 第2课（1词）",
    ]);

    await expect(service.buildTaskBatch(actor, {
      ...input, commandId: crypto.randomUUID(), extraCardIds: [crypto.randomUUID()],
    })).rejects.toThrow("TASK_CARD_NOT_FOUND");
    expect(await tx.select().from(learningTasks).where(eq(learningTasks.familyId, family.id))).toHaveLength(2);

    const [practice] = await tx.insert(learningCards).values({
      familyId: family.id, subject: "chinese", answerText: "皱纹", broadcastText: "皱纹", source: "manual",
    }).returning();
    const learned = createInitialState(new Date("2026-09-20T00:00:00Z"));
    await tx.insert(childCardStates).values({
      familyId: family.id, childId: child.id, cardId: practice.id,
      cardJson: serializeFsrsCard(learned), dueAt: new Date("2026-09-30T00:00:00Z"),
    });
    const [extra] = await service.buildTaskBatch(actor, {
      ...input, commandId: crypto.randomUUID(), sectionIds: [], extraCardIds: [practice.id],
    });
    expect(extra.items).toMatchObject([{ cardId: practice.id, kind: "manual_review" }]);
    expect((await tx.select().from(todoTasks).where(eq(todoTasks.dictationTaskId, extra.id)))[0]?.title).toBe("语文 · 单独加练（1词）");
  });
});
