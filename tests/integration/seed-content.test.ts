import { eq, inArray } from "drizzle-orm";
import { expect, test } from "vitest";

import { withDatabaseRollback } from "../helpers/database";
import { learningCards, textbookEditions, textbookSections, textbookUnits } from "@/modules/learning-content/schema";
import { applySeedContents } from "@/modules/learning-content/seed-service";
import { user as authUsers } from "@/modules/auth/schema";
import { children, families, guardians } from "@/modules/families/schema";
import { learningTaskItems, learningTasks } from "@/modules/dictation/task-schema";
import { jobs } from "@/modules/jobs/schema";

const requirements = {
  publisher: "测试社", series: "测试系列", grade: 5, volume: "上册", editionText: "幂等测试",
  requiredVocabulary: [{ sectionKey: "lesson-1", words: ["桂花"] }],
  requiredCharacters: [{ sectionKey: "lesson-1", characters: ["桂", "花"] }],
  originalWritingPractice: [{ sectionKey: "lesson-1", words: ["花香", "庭院", "旧词"] }],
};

const seed = { publisher: "测试社", series: "测试系列", subject: "chinese" as const, grade: 5, volume: "上册", editionText: "幂等测试", units: [{ order: 1, title: "第一单元", sections: [{ key: "lesson-1", order: 1, title: "第1课", type: "lesson" as const, cards: [
  { answerText: "桂花", broadcastText: "桂花", pinyinText: "guì huā", hintText: "（　　）开了。", curriculumSource: "required_vocabulary" as const, builtinKey: "seed-test-1" },
  { answerText: "花香", broadcastText: "花香", pinyinText: "huā xiāng", hintText: "有（　　）。", curriculumSource: "writing_practice" as const, adaptation: "retained" as const, builtinKey: "seed-test-2" },
  { answerText: "庭院", broadcastText: "庭院", pinyinText: "tíng yuàn", hintText: "走进（　　）。", curriculumSource: "writing_practice" as const, adaptation: "retained" as const, builtinKey: "seed-test-3" },
  { answerText: "新词", broadcastText: "新词", pinyinText: "xīn cí", hintText: "学会（　　）。", curriculumSource: "writing_practice" as const, adaptation: "replaced" as const, originalAnswerText: "旧词", builtinKey: "seed-test-4" },
  { answerText: "额外", broadcastText: "额外", pinyinText: "é wài", hintText: "这是（　　）内容。", curriculumSource: "writing_practice" as const, adaptation: "coverage_added" as const, builtinKey: "seed-test-5" },
] }, { key: "lesson-2", order: 2, title: "第2课", type: "lesson" as const, cards: [] }] }] };

test("种子导入可重复执行、更新现有卡片且不删无关卡片", async () => {
  await withDatabaseRollback(async (tx) => {
    await tx.insert(learningCards).values({ familyId: null, subject: "english", answerText: "keep", broadcastText: "keep", source: "builtin", builtinKey: "seed-unrelated" });
    const first = await applySeedContents(tx, [seed], [requirements]);
    const changed = structuredClone(seed);
    changed.units[0].sections[0].cards[0].pinyinText = "guì huā updated";
    changed.units[0].sections[0].cards[0].hintText = "院子里的（　　）很香。";
    changed.units[0].sections[0].cards = changed.units[0].sections[0].cards.filter((card) => card.builtinKey !== "seed-test-5");
    changed.units[0].sections = [
      { ...changed.units[0].sections[1], order: 1 },
      { ...changed.units[0].sections[0], order: 2 },
    ];
    const second = await applySeedContents(tx, [changed], [requirements]);
    expect(first[0]).toMatchObject({ insertedCards: 5, updatedCards: 0 });
    expect(second[0]).toMatchObject({ insertedCards: 0, updatedCards: 4 });
    expect(await tx.select().from(textbookEditions).where(eq(textbookEditions.editionText, "幂等测试"))).toHaveLength(1);
    expect(await tx.select().from(textbookUnits)).toHaveLength(1);
    expect(await tx.select().from(textbookSections).orderBy(textbookSections.sectionOrder)).toMatchObject([
      { sectionKey: "lesson-2", sectionOrder: 1 },
      { sectionKey: "lesson-1", sectionOrder: 2 },
    ]);
    expect((await tx.select().from(learningCards).where(eq(learningCards.builtinKey, "seed-test-1")))[0]).toMatchObject({ pinyinText: "guì huā updated", hintText: "院子里的（　　）很香。" });
    expect(await tx.select().from(learningCards).where(eq(learningCards.builtinKey, "seed-unrelated"))).toHaveLength(1);
    expect(await tx.select().from(learningCards).where(eq(learningCards.builtinKey, "seed-test-5"))).toHaveLength(1);
  });
});

test("审计失败在任何教材结构写入前拒绝", async () => {
  await withDatabaseRollback(async (tx) => {
    const invalid = structuredClone(seed);
    invalid.units[0].sections[0].cards = invalid.units[0].sections[0].cards.filter((card) => card.answerText !== "桂花");
    await expect(applySeedContents(tx, [invalid], [requirements])).rejects.toThrow("SEED_CONTENT_AUDIT_FAILED");
    expect(await tx.select().from(textbookEditions).where(eq(textbookEditions.editionText, invalid.editionText))).toHaveLength(0);
  });
});

test("非空中文种子不能用空基准或错教材基准绕过审计", async () => {
  await withDatabaseRollback(async (tx) => {
    await expect(applySeedContents(tx, [seed], [])).rejects.toThrow("SEED_REQUIREMENTS_NOT_FOUND");
    await expect(applySeedContents(tx, [seed], [{ ...requirements, editionText: "wrong", requiredVocabulary: [], requiredCharacters: [], originalWritingPractice: [] }])).rejects.toThrow("SEED_REQUIREMENTS_NOT_FOUND");
    expect(await tx.select().from(textbookEditions).where(eq(textbookEditions.editionText, seed.editionText))).toHaveLength(0);
  });
});

test("已有 builtinKey 拒绝答案、播报或科目变更并回滚教材元数据", async () => {
  await withDatabaseRollback(async (tx) => {
    await applySeedContents(tx, [seed], [requirements]);
    const [original] = await tx.select().from(learningCards).where(eq(learningCards.builtinKey, "seed-test-1"));

    const authUserId = `seed-history-${crypto.randomUUID()}`;
    await tx.insert(authUsers).values({ id: authUserId, name: "历史任务", email: `${authUserId}@example.test` });
    const [family] = await tx.insert(families).values({ name: "历史任务家庭" }).returning();
    const [guardian] = await tx.insert(guardians).values({ familyId: family.id, authUserId }).returning();
    const [child] = await tx.insert(children).values({ familyId: family.id, nickname: "孩子", avatarKey: "child-1", grade: 5 }).returning();
    const tasks = await tx.insert(learningTasks).values(["pending", "ready"].map((label) => ({ familyId: family.id, childId: child.id, guardianId: guardian.id, commandId: crypto.randomUUID(), inputFingerprint: label, mode: "continuous_batch", taskOrder: "source", intervalSeconds: 5, repeatCount: 1, speechRate: "1", allowManualReplay: true, maxReviewCards: 0 }))).returning();
    await tx.insert(learningTaskItems).values(tasks.map((task, index) => ({ taskId: task.id, familyId: family.id, childId: child.id, cardId: original.id, cardFamilyId: null, kind: "new", position: 0, ttsDedupeKey: index === 0 ? "old-pending-audio" : "old-ready-audio" })));
    await tx.insert(jobs).values([
      { type: "generate_tts", payload: { cardId: original.id }, status: "queued", dedupeKey: "old-pending-audio" },
      { type: "generate_tts", payload: { cardId: original.id }, status: "succeeded", dedupeKey: "old-ready-audio" },
    ]);

    const semanticChange = structuredClone(seed);
    semanticChange.units[0].title = "不应留下的标题";
    semanticChange.units[0].sections[0].cards[0] = { ...semanticChange.units[0].sections[0].cards[0], answerText: "桂树", broadcastText: "桂树", pinyinText: "guì shù", hintText: "院子里有（　　）。" };
    const changedRequirements = { ...requirements, requiredVocabulary: [{ sectionKey: "lesson-1", words: ["桂树"] }], requiredCharacters: [{ sectionKey: "lesson-1", characters: ["桂", "树"] }] };
    await expect(applySeedContents(tx, [semanticChange], [changedRequirements])).rejects.toThrow("BUILTIN_CARD_IDENTITY_IMMUTABLE:seed-test-1");

    const subjectChange = { ...structuredClone(seed), subject: "english" as const };
    await expect(applySeedContents(tx, [subjectChange], [])).rejects.toThrow("BUILTIN_CARD_IDENTITY_IMMUTABLE:seed-test-1");
    expect((await tx.select().from(textbookUnits).where(eq(textbookUnits.title, "不应留下的标题")))).toHaveLength(0);
    expect((await tx.select().from(learningCards).where(eq(learningCards.id, original.id)))[0]).toMatchObject({ subject: "chinese", answerText: "桂花", broadcastText: "桂花" });
    expect(await tx.select({ key: learningTaskItems.ttsDedupeKey }).from(learningTaskItems).where(eq(learningTaskItems.cardId, original.id)).orderBy(learningTaskItems.ttsDedupeKey)).toEqual([{ key: "old-pending-audio" }, { key: "old-ready-audio" }]);
    expect(await tx.select({ key: jobs.dedupeKey, status: jobs.status }).from(jobs).where(inArray(jobs.dedupeKey, ["old-pending-audio", "old-ready-audio"])).orderBy(jobs.dedupeKey)).toEqual([{ key: "old-pending-audio", status: "queued" }, { key: "old-ready-audio", status: "succeeded" }]);
  });
});

test("英语内置卡的播报文本也不能在同 key 下变更", async () => {
  await withDatabaseRollback(async (tx) => {
    const english = { publisher: "p", series: "e", subject: "english" as const, grade: 5, volume: "v", editionText: "e", units: [{ order: 1, title: "u", sections: [{ key: "part-a", order: 1, title: "Part A", type: "other" as const, cards: [{ answerText: "mountain", broadcastText: "mountain", builtinKey: "english-immutable" }] }] }] };
    await applySeedContents(tx, [english], []);
    const changed = structuredClone(english);
    changed.units[0].sections[0].cards[0].broadcastText = "a mountain";
    await expect(applySeedContents(tx, [changed], [])).rejects.toThrow("BUILTIN_CARD_IDENTITY_IMMUTABLE:english-immutable");
  });
});
