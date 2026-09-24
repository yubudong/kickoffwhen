import { expect, test } from "vitest";

import { type SeedCard, validateSeedContent, validateSeedContents } from "@/modules/learning-content/seed-validator";

const chineseCard = { answerText: "桂花", broadcastText: "桂花", pinyinText: "guì huā", hintText: "院子里的（　　）开了。", curriculumSource: "required_vocabulary" as const, builtinKey: "cn-g5-v1-u1-l1-001" };

function seedWith(card: SeedCard = chineseCard) {
  return { publisher: "人民教育出版社", series: "义务教育教科书", subject: "chinese", grade: 5, volume: "上册", editionText: "统编版", units: [{ order: 1, title: "第一单元", sections: [{ key: "lesson-1", order: 1, title: "第1课", type: "lesson", cards: [card] }] }] };
}

test("内置语文词条接受小节和完整元数据", () => {
  expect(validateSeedContent(seedWith()).units[0].sections[0].cards[0]).toEqual(chineseCard);
});

test("教材种子拒绝重复小节顺序", () => {
  const seed = seedWith();
  seed.units[0].sections.push({ ...seed.units[0].sections[0], key: "lesson-2" });
  expect(() => validateSeedContent(seed)).toThrow("DUPLICATE_SECTION_ORDER");
});

test("内置语文词条要求拼音和唯一空位", () => {
  expect(() => validateSeedContent(seedWith({ ...chineseCard, pinyinText: undefined }))).toThrow();
  expect(() => validateSeedContent(seedWith({ ...chineseCard, hintText: "院子里的花开了。" }))).toThrow();
  expect(() => validateSeedContent(seedWith({ ...chineseCard, hintText: "（　　）和（　　）开了。" }))).toThrow();
});

test("内置语文词条拒绝朗读语境或在语境中泄露答案", () => {
  expect(() => validateSeedContent(seedWith({ ...chineseCard, broadcastText: chineseCard.hintText }))).toThrow();
  expect(() => validateSeedContent(seedWith({ ...chineseCard, hintText: "桂花开了。" }))).toThrow();
});

test("写字练习必须标注适配状态，必保词不得标注", () => {
  expect(() => validateSeedContent(seedWith({ ...chineseCard, curriculumSource: "writing_practice" }))).toThrow();
  expect(() => validateSeedContent(seedWith({ ...chineseCard, adaptation: "retained" }))).toThrow();
});

test("旧英语空 units 种子保持兼容", () => {
  expect(validateSeedContent({ publisher: "人民教育出版社", series: "PEP", subject: "english", grade: 5, volume: "上册", editionText: "人教版", units: [] }).units).toEqual([]);
});

test("跨教材种子文件的重复 builtinKey 被拒绝", () => {
  const duplicate = { answerText: "mountain", broadcastText: "mountain", builtinKey: "same" };
  const english = (editionText: string) => ({ publisher: "人民教育出版社", series: "PEP", subject: "english", grade: 5, volume: "上册", editionText, units: [{ order: 1, title: "Unit 1", sections: [{ key: "part-a", order: 1, title: "Part A", type: "other", cards: [duplicate] }] }] });
  expect(() => validateSeedContents([english("a"), english("b")])).toThrow("DUPLICATE_BUILTIN_KEY");
});
