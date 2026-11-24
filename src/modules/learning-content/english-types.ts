import { z } from "zod";
import { englishPronunciationSchema } from "./english-pronunciation";

export const englishLearningTargetSchema = z.enum(["spelling", "core", "recognition"]);
export type EnglishLearningTarget = z.infer<typeof englishLearningTargetSchema>;
export const englishStudyOptionsSchema = z.object({
  version: z.literal(1), mode: z.enum(["standard", "assisted"]), includeRecognition: z.boolean(),
}).strict();
export type EnglishStudyOptions = z.infer<typeof englishStudyOptionsSchema>;
export const englishSpellingRulesSchema = z.object({
  caseRule: z.enum(["initial_optional", "required"]),
  acceptedAnswers: z.array(z.string().min(1).max(200)).max(8),
  note: z.string().max(400).optional(),
}).strict();
export type EnglishSpellingRules = z.infer<typeof englishSpellingRulesSchema>;
const grammarFormSchema = z.enum(["past", "comparative", "ing", "plural"]);
const sourceRoleSchema = z.enum(["head", "past_form", "plural_note"]);
const kindSchema = z.enum(["word", "phrase", "abbreviation", "pattern_example", "form_note"]);
export const englishCardMetadataSchema = z.object({
  version: z.literal(1), learningTarget: englishLearningTargetSchema,
  meaningZh: z.string().trim().min(1).max(200),
  phonetic: z.string().max(120).optional(),
  exampleWithBlank: z.string().min(1).max(500),
  exampleSentence: z.string().min(1).max(500),
  exampleTranslation: z.string().min(1).max(300),
  spellingRules: englishSpellingRulesSchema,
  grammarForm: grammarFormSchema.optional(), baseForm: z.string().max(100).optional(),
  kind: kindSchema, sourceRole: sourceRoleSchema,
  sourceWord: z.string().min(1).max(200), sourcePrintedPage: z.number().int().nonnegative(),
  sourceImagePage: z.number().int().positive(),
  pronunciation: englishPronunciationSchema.optional(),
  spokenContext: z.string().max(400).optional(),
}).strict();
export type EnglishCardMetadata = z.infer<typeof englishCardMetadataSchema>;

// This is the only complete English detail shape allowed in parent or grading views.
// It deliberately excludes speech markup and the private source/reference ledger.
export const englishDetailsSchema = z.object({
  meaningZh: z.string().nullable(), phonetic: z.string().nullable(),
  exampleWithBlank: z.string().nullable(), exampleSentence: z.string().nullable(),
  exampleTranslation: z.string().nullable(), spellingRules: englishSpellingRulesSchema,
  learningTarget: englishLearningTargetSchema.optional(), grammarForm: grammarFormSchema.optional(),
  baseForm: z.string().optional(), kind: kindSchema.optional(), sourceRole: sourceRoleSchema.optional(),
  sourceWord: z.string().optional(), sourcePrintedPage: z.number().int().nonnegative().optional(),
}).strict();
export type EnglishDetails = z.infer<typeof englishDetailsSchema>;

// Listening never accepts a complete metadata object or a written answer/IPA.
export const englishListeningHintsSchema = z.object({
  meaningZh: z.string().optional(), exampleWithBlank: z.string().optional(),
  exampleTranslation: z.string().optional(), notice: z.string().optional(),
}).strict();
export const englishWritingHintSchema = z.enum([
  "请写完整英文单词。", "请写完整英文短语。", "本题请写规范缩写。",
]);
export function englishTargetLabel(meta: { learningTarget?: EnglishLearningTarget; sourceRole?: string }) {
  if (meta.sourceRole === "plural_note") return "教材注释词形 · 自选练习";
  return meta.learningTarget === "spelling" ? "教材明确读写词"
    : meta.learningTarget === "core" ? "理解运用核心词"
      : meta.learningTarget === "recognition" ? "语境认读词 · 自选练习" : "自建词";
}
export function englishFormLabel(form?: string) {
  return form === "past" ? "过去式" : form === "comparative" ? "比较级"
    : form === "ing" ? "-ing 形式" : form === "plural" ? "复数形式" : "";
}
