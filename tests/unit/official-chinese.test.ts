import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { assertChineseSeedAudit, type ChineseContentRequirements } from "@/modules/learning-content/content-audit";
import { validateSeedContent, validateSeedContents } from "@/modules/learning-content/seed-validator";
import { officialTextbookInfo } from "@/modules/learning-content/official-catalog";
import { isRetiredBuiltinKey, retiredOfficialBuiltinKeys } from "@/modules/learning-content/active-cards";
import { getPracticeOrigin } from "@/modules/learning-content/practice-metadata";

const load = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const manifest = load("content/official-chinese-manifest.json") as { books: Array<{ grade: number; volume: number; volumeText: string; editionText: string; seedFile: string; referenceFile: string; cardCount: number; visibleSectionCount: number }> };
const books = manifest.books.map(book => ({ ...book, seed: validateSeedContent(load(book.seedFile)), reference: load(book.referenceFile) as ChineseContentRequirements }));
const cards = books.flatMap(book => book.seed.units.flatMap(unit => unit.sections.flatMap(section => section.cards)));
const replacements = load("content/official-chinese-replacements.json") as { retainedGradeOneKeys: string[]; retiredBuiltinKeys: string[]; replacements: Array<{ previousKey: string; newKeys: string[] }> };

test("十二册保留全部教材词语与写字要求，分级组词和语境完整", () => {
  expect(validateSeedContents(books.map(book => book.seed))).toHaveLength(12);
  expect(new Set(books.map(book => `${book.grade}:${book.volume}`)).size).toBe(12);
  expect(books.reduce((sum, book) => sum + book.reference.requiredVocabulary.reduce((n, row) => n + row.words.length, 0), 0)).toBe(2162);
  expect(books.reduce((sum, book) => sum + book.reference.requiredCharacters.reduce((n, row) => n + row.characters.length, 0), 0)).toBe(2500);
  expect(cards).toHaveLength(3427);
  expect(books.reduce((sum, book) => sum + book.visibleSectionCount, 0)).toBe(295);
  for (const book of books) {
    expect(() => assertChineseSeedAudit(book.seed, book.reference)).not.toThrow();
    const items = book.seed.units.flatMap(unit => unit.sections.flatMap(section => section.cards));
    expect(items).toHaveLength(book.cardCount);
    for (const card of items) {
      expect(card.hintText?.match(/（　　）/g)).toHaveLength(1);
      expect(card.hintText).not.toContain(card.answerText);
      expect(card.pinyinText).toBeTruthy();
      if (book.grade >= 2) expect([...card.answerText].length).toBeGreaterThanOrEqual(2);
      if (card.curriculumSource === "writing_practice") expect(getPracticeOrigin(card.builtinKey)).toBe(card.practiceOrigin);
    }
    expect(officialTextbookInfo({ subject: "chinese", grade: book.grade, volume: book.volumeText, editionText: book.editionText })?.sourceUrl).toContain("basic.smartedu.cn");
  }
  const firstGrade = books.filter(book => book.grade === 1).flatMap(book => book.seed.units.flatMap(unit => unit.sections.flatMap(section => section.cards)));
  expect(firstGrade).toHaveLength(300);
  expect(firstGrade.every(card => [...card.answerText].length === 1)).toBe(true);
  expect(firstGrade.find(card => card.answerText === "日")?.broadcastText).toBe("日，日月的日");
});

test("被替换单字退出新任务范围；未改播报的一年级卡片继续使用原ID", () => {
  const activeKeys = new Set(cards.map(card => card.builtinKey));
  expect(retiredOfficialBuiltinKeys).toHaveLength(1201);
  expect(replacements.retainedGradeOneKeys).toHaveLength(100);
  for (const key of replacements.retainedGradeOneKeys) {
    expect(activeKeys.has(key)).toBe(true);
    expect(isRetiredBuiltinKey(key)).toBe(false);
  }
  for (const row of replacements.replacements) {
    expect(isRetiredBuiltinKey(row.previousKey)).toBe(true);
    expect(activeKeys.has(row.previousKey)).toBe(false);
    expect(row.newKeys.length).toBeGreaterThan(0);
    expect(row.newKeys.every(key => activeKeys.has(key) && !isRetiredBuiltinKey(key))).toBe(true);
  }
  expect(isRetiredBuiltinKey(null)).toBe(false);
  expect(isRetiredBuiltinKey("cn-g5-v1-u1-lesson-1-001")).toBe(false);
});

test("来源不可信、缺页、改词、串课和伪造课文组词出处都被拒绝", () => {
  const book = books.find(book => book.grade === 3 && book.volume === 1)!;
  const missing = structuredClone(book.seed);
  missing.units[0]!.sections[0]!.cards.pop();
  expect(() => assertChineseSeedAudit(missing, book.reference)).toThrow("OFFICIAL_TEXTBOOK_CARD_MISMATCH");
  const moved = structuredClone(book.seed);
  moved.units[0]!.sections[0]!.title = "另一课";
  expect(() => assertChineseSeedAudit(moved, book.reference)).toThrow("OFFICIAL_TEXTBOOK_SECTION_MISMATCH");
  const badSource = structuredClone(load(book.referenceFile));
  badSource.source.sourceUrl = `https://example.com/?contentId=${badSource.source.id}`;
  expect(() => assertChineseSeedAudit(book.seed, badSource)).toThrow("OFFICIAL_TEXTBOOK_SOURCE_INVALID");
  const badEvidence = structuredClone(load(book.referenceFile));
  badEvidence.source.evidence = [];
  expect(() => assertChineseSeedAudit(book.seed, badEvidence)).toThrow();
  const fake = structuredClone(book.seed);
  const practice = fake.units.flatMap(unit => unit.sections.flatMap(section => section.cards)).find(card => card.practiceOrigin === "lesson_text")!;
  practice.lessonImagePages = [9999];
  expect(() => assertChineseSeedAudit(fake, book.reference)).toThrow();
});

test("一年级需简单组词播报，二至六年级不得重新塞入单字或缺失语境", () => {
  const seed = structuredClone(books[0]!.seed);
  const card = seed.units.flatMap(unit => unit.sections.flatMap(section => section.cards))[0]!;
  card.broadcastText = card.answerText;
  expect(() => validateSeedContent(seed)).toThrow("OFFICIAL_CHARACTER_PROMPT_REQUIRED");
  const words = structuredClone(books.find(book => book.grade === 2)!.seed);
  const word = words.units[0]!.sections[0]!.cards[0]!;
  word.broadcastText = "不应播报的语境";
  expect(() => validateSeedContent(words)).toThrow("CHINESE_BROADCAST_MUST_EQUAL_ANSWER");
  word.broadcastText = word.answerText;
  delete word.hintText;
  expect(() => validateSeedContent(words)).toThrow("GRADE_AWARE_CONTEXT_REQUIRED");
  const single = structuredClone(books.find(book => book.grade === 2)!.seed);
  const supplemental = single.units.flatMap(unit => unit.sections.flatMap(section => section.cards)).find(card => card.curriculumSource === "writing_practice")!;
  supplemental.answerText = supplemental.practiceCharacters![0]!;
  supplemental.broadcastText = supplemental.answerText;
  expect(() => validateSeedContent(single)).toThrow("GRADE_AWARE_WORD_REQUIRED");
});

test("结合语境的多音字、轻声和变调保持正确", () => {
  const byAnswer = new Map(cards.map(card => [card.answerText, card]));
  for (const [word, pin] of Object.entries({
    散发: "sàn fā", 何曾: "hé céng", 供养: "gōng yǎng", 朝阳: "zhāo yáng", 质朴: "zhì pǔ",
    眼睛: "yǎn jing", 妈妈: "mā ma", 认识: "rèn shi", 肚子: "dù zi", 不禁: "bù jīn",
    一知半解: "yì zhī bàn jiě", 不卑不亢: "bù bēi bú kàng", 兴亡盛衰: "xīng wáng shèng shuāi",
    不可估量: "bù kě gū liáng", 情不自禁: "qíng bú zì jīn", 子: "zǐ", 爪: "zhuǎ",
    汤匙: "tāng chí", 吞咽: "tūn yàn", 光晕: "guāng yùn", 拖拽: "tuō zhuài", 系紧: "jì jǐn",
    剥开: "bāo kāi", 轧伤: "yà shāng", 结实: "jiē shi", 甘蔗: "gān zhè", 颇具: "pō jù",
  })) expect(byAnswer.get(word)?.pinyinText, word).toBe(pin);
});
