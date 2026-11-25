import { z } from "zod";
import { englishCardMetadataSchema } from "./english-types";
import { validateEnglishSeedMetadata } from "./english-content-audit";

const cardText = z.string().trim().min(1);
const adaptationSchema = z.enum(["retained", "replaced", "coverage_added"]);

const cardSchema = z.object({
  english: englishCardMetadataSchema.optional(),
  answerText: cardText,
  broadcastText: cardText,
  pinyinText: cardText.optional(),
  hintText: cardText.optional(),
  curriculumSource: z.enum(["required_vocabulary", "writing_practice"]).optional(),
  adaptation: adaptationSchema.optional(),
  originalAnswerText: cardText.optional(),
  builtinKey: cardText,
  writingExample: cardText.optional(),
  practiceOrigin: z.enum(["grade_one_character", "lesson_text", "age_appropriate"]).optional(),
  practiceCharacters: z.array(z.string().regex(/^[\u4e00-\u9fff]$/u)).optional(),
  lessonImagePages: z.array(z.number().int().positive()).optional(),
});

const sectionSchema = z.object({
  key: cardText,
  order: z.number().int().positive(),
  title: cardText,
  type: z.enum(["lesson", "language_garden", "other"]),
  cards: z.array(cardSchema),
});

const unitSchema = z.object({
  order: z.number().int().positive(),
  title: cardText,
  sections: z.array(sectionSchema),
});

export const seedContentSchema = z.object({
  auditProfile: z.enum(["official_textbook", "official_english", "verified_english"]).optional(),
  teachingProfile: z.literal("grade_aware_v2").optional(),
  publisher: cardText,
  series: cardText,
  subject: z.enum(["chinese", "english"]),
  grade: z.number().int().positive(),
  volume: cardText,
  editionText: cardText,
  units: z.array(unitSchema),
});

export type SeedCard = z.infer<typeof cardSchema>;
export type SeedSection = z.infer<typeof sectionSchema>;
export type SeedContent = z.infer<typeof seedContentSchema>;

function validateUniqueStructure(content: SeedContent, seenBuiltinKeys: Set<string>) {
  const unitOrders = new Set<number>();
  const editionSectionKeys = new Set<string>();
  for (const [unitIndex, unit] of content.units.entries()) {
    if (unitOrders.has(unit.order)) throw new Error("DUPLICATE_UNIT_ORDER");
    if (unit.order !== unitIndex + 1) throw new Error("NON_CONTIGUOUS_UNIT_ORDER");
    unitOrders.add(unit.order);
    const sectionOrders = new Set<number>();
    const sectionKeys = new Set<string>();
    for (const [sectionIndex, section] of unit.sections.entries()) {
      if (sectionOrders.has(section.order)) throw new Error("DUPLICATE_SECTION_ORDER");
      if (sectionKeys.has(section.key)) throw new Error("DUPLICATE_SECTION_KEY");
      if (editionSectionKeys.has(section.key)) throw new Error("DUPLICATE_EDITION_SECTION_KEY");
      if (section.order !== sectionIndex + 1) throw new Error("NON_CONTIGUOUS_SECTION_ORDER");
      sectionOrders.add(section.order);
      sectionKeys.add(section.key);
      editionSectionKeys.add(section.key);
      const answers = new Set<string>();
      for (const card of section.cards) {
        if (seenBuiltinKeys.has(card.builtinKey)) throw new Error("DUPLICATE_BUILTIN_KEY");
        seenBuiltinKeys.add(card.builtinKey);
        const answerIdentity = (content.auditProfile === "official_english" || content.auditProfile === 'verified_english') && card.english
          ? `${card.answerText}\0${card.english.grammarForm ?? "word"}` : card.answerText;
        if (answers.has(answerIdentity)) throw new Error("DUPLICATE_SECTION_ANSWER");
        answers.add(answerIdentity);
      }
    }
  }
}

function validateChineseCards(content: SeedContent) {
  if (content.teachingProfile && (content.subject !== "chinese" || content.auditProfile !== "official_textbook" || content.grade > 6)) throw new Error("OFFICIAL_TEACHING_PROFILE_MISMATCH");
  if (content.subject !== "chinese") return;
  const gradeAware = content.teachingProfile === "grade_aware_v2";
  for (const unit of content.units) for (const section of unit.sections) for (const card of section.cards) {
    if (content.auditProfile === "official_textbook") {
      if (!card.pinyinText || !card.curriculumSource || !/^[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜńňǹḿê ]+$/u.test(card.pinyinText)) throw new Error("CHINESE_CARD_METADATA_REQUIRED");
      if (gradeAware && !card.hintText) throw new Error("GRADE_AWARE_CONTEXT_REQUIRED");
      if (card.curriculumSource === "writing_practice") {
        if (!gradeAware || content.grade === 1) {
          if ([...card.answerText].length !== 1 || !card.writingExample?.includes(card.answerText) || card.broadcastText !== `${card.answerText}，${card.writingExample}的${card.answerText}`) throw new Error("OFFICIAL_CHARACTER_PROMPT_REQUIRED");
          if (gradeAware && ([...card.writingExample].length < 2 || [...card.writingExample].length > 3 || card.practiceOrigin !== "grade_one_character" || JSON.stringify(card.practiceCharacters) !== JSON.stringify([card.answerText]) || card.lessonImagePages?.length !== 0)) throw new Error("GRADE_AWARE_PRACTICE_METADATA_REQUIRED");
        } else {
          if ([...card.answerText].length < 2 || [...card.answerText].length > (content.grade === 2 ? 3 : 4)) throw new Error("GRADE_AWARE_WORD_REQUIRED");
          if (card.broadcastText !== card.answerText || card.writingExample) throw new Error("CHINESE_BROADCAST_MUST_EQUAL_ANSWER");
          if (!card.practiceCharacters?.length || new Set(card.practiceCharacters).size !== card.practiceCharacters.length || card.practiceCharacters.some(c => !card.answerText.includes(c)) || !card.lessonImagePages
            || !["lesson_text", "age_appropriate"].includes(card.practiceOrigin ?? "")
            || (card.practiceOrigin === "lesson_text" ? card.lessonImagePages.length === 0 : card.lessonImagePages.length !== 0)) throw new Error("GRADE_AWARE_PRACTICE_METADATA_REQUIRED");
        }
      } else if (card.broadcastText !== card.answerText || card.writingExample || (gradeAware && (card.practiceOrigin || card.practiceCharacters || card.lessonImagePages))) throw new Error("CHINESE_BROADCAST_MUST_EQUAL_ANSWER");
      if (gradeAware && content.grade >= 2 && [...card.answerText].length < 2) throw new Error("GRADE_AWARE_WORD_REQUIRED");
    } else {
      if (!card.pinyinText || !card.hintText || !card.curriculumSource) throw new Error("CHINESE_CARD_METADATA_REQUIRED");
      if (card.broadcastText !== card.answerText || card.writingExample) throw new Error("CHINESE_BROADCAST_MUST_EQUAL_ANSWER");
    }
    if (card.hintText !== undefined) {
      if ((card.hintText.match(/（　　）/g) ?? []).length !== 1) throw new Error("CHINESE_CONTEXT_BLANK_REQUIRED");
      if (card.hintText.includes(card.answerText)) throw new Error("CHINESE_CONTEXT_EXPOSES_ANSWER");
    }
    if (card.curriculumSource === "writing_practice" && !card.adaptation) throw new Error("WRITING_PRACTICE_ADAPTATION_REQUIRED");
    if (card.curriculumSource === "required_vocabulary" && card.adaptation) throw new Error("REQUIRED_VOCABULARY_ADAPTATION_FORBIDDEN");
    if (card.adaptation === "replaced" && !card.originalAnswerText) throw new Error("REPLACED_ORIGINAL_ANSWER_REQUIRED");
    if (card.adaptation !== "replaced" && card.originalAnswerText) throw new Error("ORIGINAL_ANSWER_FORBIDDEN");
  }
}

export function validateSeedContent(input: unknown): SeedContent {
  const content = seedContentSchema.parse(input);
  validateUniqueStructure(content, new Set());
  validateChineseCards(content);
  validateEnglishSeedMetadata(content);
  return content;
}

export function validateSeedContents(inputs: unknown[]): SeedContent[] {
  const contents = inputs.map((input) => seedContentSchema.parse(input));
  const keys = new Set<string>();
  for (const content of contents) {
    validateUniqueStructure(content, keys);
    validateChineseCards(content);
    validateEnglishSeedMetadata(content);
  }
  return contents;
}

export function seedContentSummary(content: SeedContent) {
  return {
    edition: `${content.publisher}｜${content.series}｜${content.editionText}`,
    units: content.units.length,
    sections: content.units.reduce((sum, unit) => sum + unit.sections.length, 0),
    cards: content.units.reduce((sum, unit) => sum + unit.sections.reduce((n, section) => n + section.cards.length, 0), 0),
  };
}
