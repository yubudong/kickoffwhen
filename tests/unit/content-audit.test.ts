import { expect, test } from "vitest";

import { assertChineseSeedAudit, auditChineseSeed } from "@/modules/learning-content/content-audit";

test("按对应小节审计要求，替换比例使用原始补充基线", () => {
  const seed = { publisher: "p", series: "s", subject: "chinese" as const, grade: 5, volume: "v", editionText: "e", units: [{ order: 1, title: "u", sections: [
    { key: "lesson-1", order: 1, title: "l1", type: "lesson" as const, cards: [
      { answerText: "桂花", broadcastText: "桂花", pinyinText: "guì huā", hintText: "（　　）开了。", curriculumSource: "required_vocabulary" as const, builtinKey: "1" },
      { answerText: "花香", broadcastText: "花香", pinyinText: "huā xiāng", hintText: "有（　　）。", curriculumSource: "writing_practice" as const, adaptation: "retained" as const, builtinKey: "2" },
      { answerText: "快乐", broadcastText: "快乐", pinyinText: "kuài lè", hintText: "很（　　）。", curriculumSource: "writing_practice" as const, adaptation: "replaced" as const, originalAnswerText: "旧词", builtinKey: "3" },
      { answerText: "额外", broadcastText: "额外", pinyinText: "é wài", hintText: "是（　　）。", curriculumSource: "writing_practice" as const, adaptation: "coverage_added" as const, builtinKey: "4" },
    ] },
    { key: "lesson-2", order: 2, title: "l2", type: "lesson" as const, cards: [{ answerText: "故乡", broadcastText: "故乡", pinyinText: "gù xiāng", hintText: "想念（　　）。", curriculumSource: "writing_practice" as const, adaptation: "retained" as const, builtinKey: "5" }] },
  ] }] };
  const requirements = { requiredVocabulary: [{ sectionKey: "lesson-1", words: ["桂花", "故乡"] }], requiredCharacters: [{ sectionKey: "lesson-1", characters: ["桂", "花", "故", "乡"] }, { sectionKey: "lesson-2", characters: ["浇"] }], originalWritingPractice: [{ sectionKey: "lesson-1", words: ["花香", "旧词"] }, { sectionKey: "lesson-2", words: ["故乡"] }] };
  expect(auditChineseSeed(seed, requirements)).toEqual({ missingVocabulary: ["lesson-1:故乡"], uncoveredCharacters: ["lesson-1:故", "lesson-1:乡", "lesson-2:浇"], duplicateSectionAnswers: [], writingPracticeCount: 4, originalWritingPracticeCount: 3, replacedWritingPracticeCount: 1, replacementRatio: 1 / 3, replacementMappingErrors: [] });
});

test("完整官方基准不允许中文种子突然变空", () => {
  const empty = { publisher: "p", series: "s", subject: "chinese" as const, grade: 5, volume: "v", editionText: "e", units: [] };
  expect(() => assertChineseSeedAudit(empty, { publisher: "p", series: "s", grade: 5, volume: "v", editionText: "e", requiredVocabulary: [{ sectionKey: "lesson-1", words: ["桂花"] }], requiredCharacters: [{ sectionKey: "lesson-1", characters: ["桂"] }], originalWritingPractice: [{ sectionKey: "lesson-1", words: ["花香"] }] })).toThrow("SEED_CONTENT_AUDIT_FAILED");
});

test("审计报告同一小节的重复答案", () => {
  const card = { answerText: "桂花", broadcastText: "桂花", pinyinText: "guì huā", hintText: "（　　）开了。", curriculumSource: "required_vocabulary" as const, builtinKey: "1" };
  const seed = { publisher: "p", series: "s", subject: "chinese" as const, grade: 5, volume: "v", editionText: "e", units: [{ order: 1, title: "u", sections: [{ key: "lesson-1", order: 1, title: "l", type: "lesson" as const, cards: [card, { ...card, builtinKey: "2" }] }] }] };
  expect(auditChineseSeed(seed, { requiredVocabulary: [], requiredCharacters: [], originalWritingPractice: [] }).duplicateSectionAnswers).toEqual(["lesson-1:桂花"]);
});

test("替换映射拒绝重复、伪基线标签和丢失负责覆盖字", () => {
  const replacement = { answerText: "新词", broadcastText: "新词", pinyinText: "xīn cí", hintText: "这是（　　）。", curriculumSource: "writing_practice" as const, adaptation: "replaced" as const, originalAnswerText: "浇花", builtinKey: "r1" };
  const seed = { publisher: "p", series: "s", subject: "chinese" as const, grade: 5, volume: "v", editionText: "e", units: [{ order: 1, title: "u", sections: [{ key: "lesson-1", order: 1, title: "l", type: "lesson" as const, cards: [replacement, { ...replacement, builtinKey: "r2" }, { ...replacement, answerText: "浇花", adaptation: "coverage_added" as const, originalAnswerText: undefined, builtinKey: "a" }] }] }] };
  const result = auditChineseSeed(seed, { requiredVocabulary: [], requiredCharacters: [{ sectionKey: "lesson-1", characters: ["浇"] }], originalWritingPractice: [{ sectionKey: "lesson-1", words: ["浇花"] }] });
  expect(result.replacementMappingErrors).toEqual(["unexpected-mapping:lesson-1:浇花", "unexpected-mapping:lesson-1:浇花", "duplicate-mapping:lesson-1:浇花", "replacement-loses-character:lesson-1:浇花->新词:浇", "replacement-loses-character:lesson-1:浇花->新词:浇", "coverage-added-is-baseline:lesson-1:浇花"]);
});
