import { z } from "zod";

const cardText = z.string().trim().min(1);
const adaptationSchema = z.enum(["retained", "replaced", "coverage_added"]);

const cardSchema = z.object({
  answerText: cardText,
  broadcastText: cardText,
  pinyinText: cardText.optional(),
  hintText: cardText.optional(),
  curriculumSource: z.enum(["required_vocabulary", "writing_practice"]).optional(),
  adaptation: adaptationSchema.optional(),
  originalAnswerText: cardText.optional(),
  builtinKey: cardText,
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
        if (answers.has(card.answerText)) throw new Error("DUPLICATE_SECTION_ANSWER");
        answers.add(card.answerText);
      }
    }
  }
}

function validateChineseCards(content: SeedContent) {
  if (content.subject !== "chinese") return;
  for (const unit of content.units) for (const section of unit.sections) for (const card of section.cards) {
    if (!card.pinyinText || !card.hintText || !card.curriculumSource) throw new Error("CHINESE_CARD_METADATA_REQUIRED");
    if (card.broadcastText !== card.answerText) throw new Error("CHINESE_BROADCAST_MUST_EQUAL_ANSWER");
    if ((card.hintText.match(/（　　）/g) ?? []).length !== 1) throw new Error("CHINESE_CONTEXT_BLANK_REQUIRED");
    if (card.hintText.includes(card.answerText)) throw new Error("CHINESE_CONTEXT_EXPOSES_ANSWER");
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
  return content;
}

export function validateSeedContents(inputs: unknown[]): SeedContent[] {
  const contents = inputs.map((input) => seedContentSchema.parse(input));
  const keys = new Set<string>();
  for (const content of contents) {
    validateUniqueStructure(content, keys);
    validateChineseCards(content);
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
