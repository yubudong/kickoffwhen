import { z } from "zod";
import type { SeedContent } from "./seed-validator";

const text = z.string().min(1);
const character = z.string().regex(/^[\u4e00-\u9fff]$/u);
const practiceCard = z.object({
  answerText: text, broadcastText: text, pinyinText: text, hintText: text, builtinKey: text,
  writingExample: text.optional(),
  practiceOrigin: z.enum(["grade_one_character", "lesson_text", "age_appropriate"]),
  practiceCharacters: z.array(character).min(1),
  lessonImagePages: z.array(z.number().int().positive()),
});
const requirementSchema = z.object({
  auditProfile: z.literal("official_textbook"),
  teachingProfile: z.literal("grade_aware_v2").optional(),
  expectedWritingCharacters: z.number().int().positive(),
  expectedVocabulary: z.number().int().nonnegative(),
  expectedPracticeCards: z.number().int().nonnegative().optional(),
  source: z.object({
    id: z.uuid(), title: text, grade: z.number().int().min(1).max(6), volume: z.number().int().min(1).max(2),
    sourceUrl: z.url(), provider: z.literal("国家中小学智慧教育平台"), publisher: z.literal("人民教育出版社"),
    retrievedAt: z.iso.date(), writingImagePages: z.array(z.number().int().positive()).min(1),
    vocabularyImagePages: z.array(z.number().int().positive()),
    evidence: z.array(z.object({ imagePage: z.number().int().positive(), url: z.url(), sha256: z.string().regex(/^[0-9a-f]{64}$/) })).min(1),
  }),
  requiredVocabulary: z.array(z.object({ sectionKey: text, words: z.array(text) })),
  requiredCharacters: z.array(z.object({ sectionKey: text, characters: z.array(character) })),
  originalWritingPractice: z.array(z.unknown()).max(0),
  sections: z.array(z.object({ key: text, unit: z.number().int().positive(), title: text, characters: z.string(), words: z.array(text) })).min(1),
  teachingPractice: z.array(z.object({
    sectionKey: text,
    lessonImageRange: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    cards: z.array(practiceCard),
  })).optional(),
});

export function assertOfficialTextbookAudit(content: SeedContent, input: unknown) {
  const reference = requirementSchema.parse(input);
  if (content.auditProfile !== "official_textbook" || content.subject !== "chinese" || content.publisher !== "人民教育出版社") throw new Error("OFFICIAL_TEXTBOOK_PROFILE_MISMATCH");
  if (content.teachingProfile !== reference.teachingProfile) throw new Error("OFFICIAL_TEACHING_PROFILE_MISMATCH");
  const source = reference.source;
  const link = new URL(source.sourceUrl);
  if (source.grade !== content.grade || (source.volume === 1 ? "上册" : "下册") !== content.volume
    || link.protocol !== "https:" || link.hostname !== "basic.smartedu.cn" || link.searchParams.get("contentId") !== source.id) throw new Error("OFFICIAL_TEXTBOOK_SOURCE_INVALID");
  if (reference.expectedVocabulary > 0 && source.vocabularyImagePages.length === 0) throw new Error("OFFICIAL_TEXTBOOK_EVIDENCE_MISSING");
  const imagePages = [...source.writingImagePages, ...source.vocabularyImagePages];
  if (imagePages.some(page => !source.evidence.some(item => item.imagePage === page))) throw new Error("OFFICIAL_TEXTBOOK_EVIDENCE_MISSING");
  if (new Set(source.evidence.map(item => item.imagePage)).size !== source.evidence.length) throw new Error("OFFICIAL_TEXTBOOK_SOURCE_INVALID");
  for (const item of source.evidence) {
    const url = new URL(item.url);
    if (url.protocol !== "https:" || !/^r[123]-ndr\.ykt\.cbern\.com\.cn$/.test(url.hostname) || !url.pathname.includes(source.id) || !url.pathname.endsWith(`/${item.imagePage}.jpg`)) throw new Error("OFFICIAL_TEXTBOOK_SOURCE_INVALID");
  }
  const chars = reference.sections.flatMap(section => [...section.characters]);
  const words = reference.sections.flatMap(section => section.words);
  if (chars.length !== reference.expectedWritingCharacters || new Set(chars).size !== chars.length || words.length !== reference.expectedVocabulary) throw new Error("OFFICIAL_TEXTBOOK_TOTAL_MISMATCH");
  if (new Set(reference.sections.map(section => section.key)).size !== reference.sections.length) throw new Error("OFFICIAL_TEXTBOOK_SECTION_MISMATCH");
  const vocabulary = reference.sections.map(section => ({ sectionKey: section.key, words: section.words }));
  const characters = reference.sections.map(section => ({ sectionKey: section.key, characters: [...section.characters] }));
  if (JSON.stringify(vocabulary) !== JSON.stringify(reference.requiredVocabulary) || JSON.stringify(characters) !== JSON.stringify(reference.requiredCharacters)) throw new Error("OFFICIAL_TEXTBOOK_REFERENCE_MISMATCH");
  const actual = content.units.flatMap(unit => unit.sections.map(section => ({ unit: unit.order, section })));
  if (actual.length !== reference.sections.length) throw new Error("OFFICIAL_TEXTBOOK_SECTION_MISMATCH");
  const gradeAware = content.teachingProfile === "grade_aware_v2";
  if (gradeAware && (!reference.teachingPractice || reference.teachingPractice.length !== reference.sections.length
    || reference.expectedPracticeCards !== reference.teachingPractice.reduce((sum, item) => sum + item.cards.length, 0))) throw new Error("OFFICIAL_TEACHING_REFERENCE_MISSING");
  for (const [index, { unit, section }] of actual.entries()) {
    const expected = reference.sections[index]!;
    if (unit !== expected.unit || section.key !== expected.key || section.title !== expected.title) throw new Error("OFFICIAL_TEXTBOOK_SECTION_MISMATCH");
    const covered = expected.words.join("");
    if (!gradeAware) {
      const expectedCards = [
        ...expected.words.map(answer => ({ answer, source: "required_vocabulary" })),
        ...[...expected.characters].filter(c => !covered.includes(c)).map(answer => ({ answer, source: "writing_practice" })),
      ];
      if (section.cards.length !== expectedCards.length || section.cards.some((card, i) => card.answerText !== expectedCards[i]!.answer || card.curriculumSource !== expectedCards[i]!.source)) throw new Error("OFFICIAL_TEXTBOOK_CARD_MISMATCH");
      continue;
    }
    const teaching = reference.teachingPractice![index]!;
    if (teaching.sectionKey !== expected.key || teaching.lessonImageRange[0] > teaching.lessonImageRange[1]) throw new Error("OFFICIAL_TEACHING_SECTION_MISMATCH");
    if (section.cards.length !== expected.words.length + teaching.cards.length) throw new Error("OFFICIAL_TEXTBOOK_CARD_MISMATCH");
    for (const [wordIndex, word] of expected.words.entries()) {
      const card = section.cards[wordIndex]!;
      if (card.answerText !== word || card.curriculumSource !== "required_vocabulary") throw new Error("OFFICIAL_TEXTBOOK_CARD_MISMATCH");
    }
    if (content.grade === 1 && JSON.stringify(teaching.cards.map(card => card.answerText)) !== JSON.stringify([...expected.characters].filter(c => !covered.includes(c)))) throw new Error("OFFICIAL_TEXTBOOK_CHARACTER_COVERAGE_MISMATCH");
    for (const [practiceIndex, item] of teaching.cards.entries()) {
      const card = section.cards[expected.words.length + practiceIndex]!;
      if (card.curriculumSource !== "writing_practice" || card.answerText !== item.answerText || card.broadcastText !== item.broadcastText
        || card.pinyinText !== item.pinyinText || card.hintText !== item.hintText || card.builtinKey !== item.builtinKey || card.practiceOrigin !== item.practiceOrigin
        || card.writingExample !== item.writingExample || JSON.stringify(card.practiceCharacters) !== JSON.stringify(item.practiceCharacters)
        || JSON.stringify(card.lessonImagePages) !== JSON.stringify(item.lessonImagePages)) throw new Error("OFFICIAL_TEXTBOOK_CARD_MISMATCH");
      const expectedCovered = [...expected.characters].filter(c => !covered.includes(c) && item.answerText.includes(c));
      if (JSON.stringify(expectedCovered) !== JSON.stringify(item.practiceCharacters)) throw new Error("OFFICIAL_TEXTBOOK_CHARACTER_COVERAGE_MISMATCH");
      for (const page of item.lessonImagePages) {
        if (page < teaching.lessonImageRange[0] || page > teaching.lessonImageRange[1] || !source.evidence.some(e => e.imagePage === page)) throw new Error("OFFICIAL_TEACHING_EVIDENCE_MISSING");
      }
    }
    const answers = section.cards.map(card => card.answerText).join("");
    if ([...expected.characters].some(c => !answers.includes(c))) throw new Error("OFFICIAL_TEXTBOOK_CHARACTER_COVERAGE_MISMATCH");
  }
}
