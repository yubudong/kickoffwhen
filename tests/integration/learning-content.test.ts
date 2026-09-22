import { expect, test } from "vitest";
import { eq } from "drizzle-orm";

import { withDatabaseRollback } from "../helpers/database";
import { user as authUsers } from "@/modules/auth/schema";
import { createLearningContentService } from "@/modules/learning-content/service";
import {
  learningCards,
  ocrDraftLines,
  ocrDrafts,
  textbookEditions,
  textbookSections,
  textbookUnits,
} from "@/modules/learning-content/schema";
import { families, guardians } from "@/modules/families/schema";

test("教材卡片保存小节、拼音、课程来源和原始顺序", async () => {
  await withDatabaseRollback(async (tx) => {
    const [edition] = await tx.insert(textbookEditions).values({ publisher: "p", series: "s", subject: "chinese", grade: 5, volume: "v", editionText: crypto.randomUUID() }).returning();
    const [unit] = await tx.insert(textbookUnits).values({ textbookEditionId: edition.id, unitOrder: 1, title: "u" }).returning();
    const [section] = await tx.insert(textbookSections).values({ unitId: unit.id, sectionKey: "lesson-1", sectionOrder: 1, title: "第1课", sectionType: "lesson" }).returning();
    const [card] = await tx.insert(learningCards).values({ familyId: null, subject: "chinese", answerText: "桂花", broadcastText: "桂花", hintText: "院子里的（　　）散发着清香。", pinyinText: "guì huā", curriculumSource: "required_vocabulary", sourceOrder: 1, textbookEditionId: edition.id, unitId: unit.id, sectionId: section.id, source: "builtin", builtinKey: `cn-${crypto.randomUUID()}` }).returning();
    expect(card).toMatchObject({ pinyinText: "guì huā", curriculumSource: "required_vocabulary", sourceOrder: 1, sectionId: section.id });
  });
});

test("OCR 草稿确认前不出现在可选卡片中，且家庭内容不串号", async () => {
  await withDatabaseRollback(async (tx) => {
    const suffix = crypto.randomUUID();
    const [familyA, familyB] = await tx
      .insert(families)
      .values([{ name: `内容家庭 A-${suffix}` }, { name: `内容家庭 B-${suffix}` }])
      .returning();
    await tx.insert(authUsers).values([
      { id: `content-a-${suffix}`, name: "家长 A", email: `content-a-${suffix}@example.test` },
      { id: `content-b-${suffix}`, name: "家长 B", email: `content-b-${suffix}@example.test` },
    ]);
    const [guardianA, guardianB] = await tx
      .insert(guardians)
      .values([
        { familyId: familyA.id, authUserId: `content-a-${suffix}` },
        { familyId: familyB.id, authUserId: `content-b-${suffix}` },
      ])
      .returning();
    const actorA = {
      role: "guardian" as const,
      familyId: familyA.id,
      guardianId: guardianA.id,
    };
    const actorB = {
      role: "guardian" as const,
      familyId: familyB.id,
      guardianId: guardianB.id,
    };
    const [draft] = await tx
      .insert(ocrDrafts)
      .values({ familyId: actorA.familyId, guardianId: actorA.guardianId, subject: "english" })
      .returning();
    const [line] = await tx
      .insert(ocrDraftLines)
      .values({ familyId: actorA.familyId, draftId: draft.id, sourceText: "mountain", sourceOrder: 0 })
      .returning();
    const service = createLearningContentService(tx);

    expect(await service.listCards(actorA, { query: "mountain" })).toHaveLength(0);
    await service.confirmOcrDraft(actorA, draft.id, [
      { lineId: line.id, answerText: "mountain", broadcastText: "mountain" },
    ]);
    expect(await service.listCards(actorA, { query: "mountain" })).toHaveLength(1);

    await service.createCard(actorA, {
      subject: "chinese",
      answerText: "只属于家庭 A",
      broadcastText: "只属于家庭 A",
      source: "manual",
    });
    expect(await service.listCards(actorB, { query: "只属于家庭 A" })).toHaveLength(0);
  });
});

test("OCR 草稿确认会拒绝未选行且重试不会重复生成卡片", async () => {
  await withDatabaseRollback(async (tx) => {
    const suffix = crypto.randomUUID();
    await tx.insert(authUsers).values({
      id: `ocr-finalize-${suffix}`,
      name: "OCR 家长",
      email: `ocr-finalize-${suffix}@example.test`,
    });
    const [family] = await tx.insert(families).values({ name: `OCR-${suffix}` }).returning();
    const [guardian] = await tx
      .insert(guardians)
      .values({ familyId: family.id, authUserId: `ocr-finalize-${suffix}` })
      .returning();
    const actor = {
      role: "guardian" as const,
      familyId: family.id,
      guardianId: guardian.id,
    };
    const [draft] = await tx
      .insert(ocrDrafts)
      .values({ familyId: family.id, guardianId: guardian.id, subject: "english" })
      .returning();
    const lines = await tx
      .insert(ocrDraftLines)
      .values([
        { familyId: family.id, draftId: draft.id, sourceText: "mountain", sourceOrder: 0 },
        { familyId: family.id, draftId: draft.id, sourceText: "noise", sourceOrder: 1 },
      ])
      .returning();
    const service = createLearningContentService(tx);
    const input = [
      {
        lineId: lines[0].id,
        answerText: "mountain",
        broadcastText: "mountain edited",
      },
    ];

    await expect(
      service.confirmOcrDraft(actor, draft.id, input, [lines[0].id]),
    ).rejects.toThrow("OCR_DRAFT_LINE_INVALID");
    expect(await tx.select().from(ocrDraftLines).where(eq(ocrDraftLines.draftId, draft.id)))
      .toMatchObject([{ status: "draft" }, { status: "draft" }]);
    const decidedLineIds = lines.map((line) => line.id);
    const first = await service.confirmOcrDraft(actor, draft.id, input, decidedLineIds);
    const retried = await service.confirmOcrDraft(actor, draft.id, input, decidedLineIds);
    expect(retried.map((card) => card.id)).toEqual(first.map((card) => card.id));
    expect(await tx.select().from(ocrDraftLines).where(eq(ocrDraftLines.draftId, draft.id)))
      .toMatchObject([
        { status: "confirmed", confirmedCardId: first[0].id },
        { status: "rejected", confirmedCardId: null },
      ]);
    expect(await service.listCards(actor, { query: "mountain" })).toHaveLength(1);
    expect(await service.listCards(actor, { query: "noise" })).toHaveLength(0);
  });
});

test("OCR 草稿可全部删除且重试仍为空结果", async () => {
  await withDatabaseRollback(async (tx) => {
    const suffix = crypto.randomUUID();
    await tx.insert(authUsers).values({
      id: `ocr-reject-all-${suffix}`,
      name: "OCR 全删家长",
      email: `ocr-reject-all-${suffix}@example.test`,
    });
    const [family] = await tx.insert(families).values({ name: `OCR reject-${suffix}` }).returning();
    const [guardian] = await tx.insert(guardians).values({
      familyId: family.id,
      authUserId: `ocr-reject-all-${suffix}`,
    }).returning();
    const [draft] = await tx.insert(ocrDrafts).values({
      familyId: family.id,
      guardianId: guardian.id,
      subject: "chinese",
    }).returning();
    await tx.insert(ocrDraftLines).values({
      familyId: family.id,
      draftId: draft.id,
      sourceText: "噪声",
      sourceOrder: 0,
    });
    const actor = { role: "guardian" as const, familyId: family.id, guardianId: guardian.id };
    const service = createLearningContentService(tx);

    await expect(service.confirmOcrDraft(actor, draft.id, [])).resolves.toEqual([]);
    await expect(service.confirmOcrDraft(actor, draft.id, [])).resolves.toEqual([]);
    expect(await service.listCards(actor, { query: "噪声" })).toHaveLength(0);
  });
});

test("数据库拒绝无家庭的自建卡片和无效的内容枚举值", async () => {
  await withDatabaseRollback(async (tx) => {
    const suffix = crypto.randomUUID();
    await tx.insert(authUsers).values({
      id: `content-constraint-${suffix}`,
      name: "约束家长",
      email: `content-constraint-${suffix}@example.test`,
    });
    const [family] = await tx
      .insert(families)
      .values({ name: `约束家庭-${suffix}` })
      .returning();
    const [guardian] = await tx
      .insert(guardians)
      .values({ familyId: family.id, authUserId: `content-constraint-${suffix}` })
      .returning();
    const [draft] = await tx
      .insert(ocrDrafts)
      .values({ familyId: family.id, guardianId: guardian.id, subject: "chinese" })
      .returning();

    await expect(
      tx.insert(learningCards).values({
        familyId: null,
        subject: "chinese",
        answerText: "泄漏卡片",
        broadcastText: "泄漏卡片",
        source: "manual",
      }),
    ).rejects.toThrow();
    await expect(
      tx.insert(learningCards).values({
        familyId: family.id,
        subject: "science",
        answerText: "无效学科",
        broadcastText: "无效学科",
        source: "manual",
      }),
    ).rejects.toThrow();
    await expect(
      tx.insert(learningCards).values({
        familyId: family.id,
        subject: "chinese",
        answerText: "无效来源",
        broadcastText: "无效来源",
        source: "imported",
      }),
    ).rejects.toThrow();
    await expect(
      tx.insert(ocrDraftLines).values({
        familyId: family.id,
        draftId: draft.id,
        sourceText: "无效状态",
        sourceOrder: 0,
        status: "ready",
      }),
    ).rejects.toThrow();
  });
});

test("批量写入在任一行违反约束时不会留下先前卡片", async () => {
  await withDatabaseRollback(async (tx) => {
    const suffix = crypto.randomUUID();
    await tx.insert(authUsers).values({
      id: `content-bulk-${suffix}`,
      name: "批量家长",
      email: `content-bulk-${suffix}@example.test`,
    });
    const [family] = await tx
      .insert(families)
      .values({ name: `批量家庭-${suffix}` })
      .returning();
    const [guardian] = await tx
      .insert(guardians)
      .values({ familyId: family.id, authUserId: `content-bulk-${suffix}` })
      .returning();
    const actor = {
      role: "guardian" as const,
      familyId: family.id,
      guardianId: guardian.id,
    };
    const service = createLearningContentService(tx);

    await expect(
      service.createBulkCards(actor, [
        {
          subject: "english",
          answerText: "first-card-must-rollback",
          broadcastText: "first-card-must-rollback",
          source: "bulk",
        },
        {
          subject: "english",
          answerText: "second-invalid-card",
          broadcastText: "second-invalid-card",
          textbookEditionId: crypto.randomUUID(),
          source: "bulk",
        },
      ]),
    ).rejects.toThrow();
    expect(await service.listCards(actor, { query: "first-card-must-rollback" })).toHaveLength(0);
  });
});
