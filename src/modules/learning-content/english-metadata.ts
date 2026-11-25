// Server-side content lookup. Client components receive projected details, never this index.
import rawIndex from "../../../content/official-english-metadata.json";
import multiIndex from '../../../content/english-multi/metadata.json';
import { or, isNull, notInArray } from "drizzle-orm";
import { learningCards } from "./schema";
import type { EnglishCardMetadata, EnglishDetails, EnglishStudyOptions } from "./english-types";

for (const key of Object.keys(multiIndex)) if (Object.hasOwn(rawIndex,key)) throw new Error('ENGLISH_RUNTIME_INDEX_COLLISION');
const index = new Map<string, EnglishCardMetadata>(Object.entries({...rawIndex,...multiIndex} as unknown as Record<string, EnglishCardMetadata>));
export const optionalEnglishBuiltinKeys = [...index].filter(([, meta]) => meta.learningTarget === "recognition").map(([key]) => key);
export function getEnglishMetadata(key: string | null | undefined) { return key ? index.get(key) : undefined; }
export function englishTextbookSelectionPredicate(includeRecognition = false) {
  return includeRecognition ? undefined : or(isNull(learningCards.builtinKey), notInArray(learningCards.builtinKey, optionalEnglishBuiltinKeys));
}
export function englishPublicDetails(meta: EnglishCardMetadata): EnglishDetails {
  return {
    meaningZh: meta.meaningZh, phonetic: meta.phonetic ?? null,
    exampleWithBlank: meta.exampleWithBlank ?? null, exampleSentence: meta.exampleSentence ?? null,
    exampleTranslation: meta.exampleTranslation ?? null, spellingRules: meta.spellingRules,
    learningTarget: meta.learningTarget, kind: meta.kind, sourceRole: meta.sourceRole,
    sourceWord: meta.sourceWord, sourcePrintedPage: meta.sourcePrintedPage,
    ...(meta.grammarForm ? { grammarForm: meta.grammarForm } : {}),
    ...(meta.baseForm ? { baseForm: meta.baseForm } : {}),
  };
}
export function englishGradingDetails(key: string | null | undefined) {
  const meta = getEnglishMetadata(key); return meta ? englishPublicDetails(meta) : undefined;
}
export function englishListeningProjection(key: string | null | undefined, options: EnglishStudyOptions | null | undefined): {
  writingHint?: "请写完整英文单词。" | "请写完整英文短语。" | "本题请写规范缩写。";
  englishHints?: Pick<EnglishCardMetadata, "meaningZh" | "exampleWithBlank" | "exampleTranslation">;
} {
  const meta = getEnglishMetadata(key);
  if (!meta) return {};
  const writingHint = meta.kind === "abbreviation" ? "本题请写规范缩写。" as const
    : meta.kind === "phrase" || meta.kind === "pattern_example" ? "请写完整英文短语。" as const
      : "请写完整英文单词。" as const;
  return {
    writingHint,
    ...(options?.mode === "assisted" ? { englishHints: {
      meaningZh: meta.meaningZh, exampleWithBlank: meta.exampleWithBlank,
      exampleTranslation: meta.exampleTranslation,
    } } : {}),
  };
}
