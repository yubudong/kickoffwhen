import type { SeedContent } from "./seed-validator";

export type ChineseContentRequirements = {
  publisher: string;
  series: string;
  grade: number;
  volume: string;
  editionText: string;
  requiredVocabulary: { sectionKey: string; words: string[] }[];
  requiredCharacters: { sectionKey: string; characters: string[] }[];
  originalWritingPractice: { sectionKey: string; words: string[] }[];
};

export type ChineseContentAuditRequirements = Pick<ChineseContentRequirements, "requiredVocabulary" | "requiredCharacters" | "originalWritingPractice">;

export function chineseRequirementsIdentity(requirements: ChineseContentRequirements) {
  return `${requirements.publisher}\u0000${requirements.series}\u0000${requirements.grade}\u0000${requirements.volume}\u0000${requirements.editionText}`;
}

export function chineseContentIdentity(content: SeedContent) {
  return `${content.publisher}\u0000${content.series}\u0000${content.grade}\u0000${content.volume}\u0000${content.editionText}`;
}

export function assertChineseSeedAudit(content: SeedContent, requirements: ChineseContentRequirements): ChineseContentAudit {
  if (chineseContentIdentity(content) !== chineseRequirementsIdentity(requirements)) throw new Error("SEED_REQUIREMENTS_IDENTITY_MISMATCH");
  const hasCards = content.units.some((unit) => unit.sections.some((section) => section.cards.length > 0));
  const hasRequirements = requirements.requiredVocabulary.length > 0 || requirements.requiredCharacters.length > 0 || requirements.originalWritingPractice.length > 0;
  if (!hasCards && !hasRequirements) return auditChineseSeed(content, requirements);
  if (requirements.requiredVocabulary.length === 0 || requirements.requiredCharacters.length === 0 || requirements.originalWritingPractice.length === 0) throw new Error("SEED_REQUIREMENTS_EMPTY");
  const audit = auditChineseSeed(content, requirements);
  if (audit.missingVocabulary.length || audit.uncoveredCharacters.length || audit.duplicateSectionAnswers.length || audit.replacementMappingErrors.length || audit.replacementRatio < 0.2 || audit.replacementRatio > 0.4) throw new Error(`SEED_CONTENT_AUDIT_FAILED:${JSON.stringify(audit)}`);
  return audit;
}

export type ChineseContentAudit = {
  missingVocabulary: string[];
  uncoveredCharacters: string[];
  duplicateSectionAnswers: string[];
  writingPracticeCount: number;
  originalWritingPracticeCount: number;
  replacedWritingPracticeCount: number;
  replacementRatio: number;
  replacementMappingErrors: string[];
};

export function auditChineseSeed(content: SeedContent, requirements: ChineseContentAuditRequirements): ChineseContentAudit {
  const sections = new Map(content.units.flatMap((unit) => unit.sections.map((section) => [section.key, section] as const)));
  const missingVocabulary = requirements.requiredVocabulary.flatMap(({ sectionKey, words }) => {
    const answers = new Set(sections.get(sectionKey)?.cards.map((card) => card.answerText) ?? []);
    return words.filter((word) => !answers.has(word)).map((word) => `${sectionKey}:${word}`);
  });
  const uncoveredCharacters = requirements.requiredCharacters.flatMap(({ sectionKey, characters }) => {
    const answers = sections.get(sectionKey)?.cards.map((card) => card.answerText).join("") ?? "";
    return characters.filter((character) => !answers.includes(character)).map((character) => `${sectionKey}:${character}`);
  });
  const duplicateSectionAnswers = content.units.flatMap((unit) => unit.sections.flatMap((section) => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const card of section.cards) {
      if (seen.has(card.answerText)) duplicates.add(`${section.key}:${card.answerText}`);
      seen.add(card.answerText);
    }
    return [...duplicates];
  }));
  const writingCards = content.units.flatMap((unit) => unit.sections.flatMap((section) => section.cards.filter((card) => card.curriculumSource === "writing_practice")));
  const originalWritingPracticeCount = requirements.originalWritingPractice.reduce((sum, item) => sum + item.words.length, 0);
  const missingOriginals = requirements.originalWritingPractice.flatMap(({ sectionKey, words }) => {
    const answers = new Set(sections.get(sectionKey)?.cards.map((card) => card.answerText) ?? []);
    return words.filter((word) => !answers.has(word)).map((word) => `${sectionKey}:${word}`);
  });
  const replacementMappings = content.units.flatMap((unit) => unit.sections.flatMap((section) => section.cards
    .filter((card) => card.adaptation === "replaced")
    .map((card) => `${section.key}:${card.originalAnswerText}`)));
  const missingSet = new Set(missingOriginals);
  const mappingSet = new Set(replacementMappings);
  const replacementMappingErrors = [
    ...missingOriginals.filter((item) => !mappingSet.has(item)).map((item) => `missing-mapping:${item}`),
    ...replacementMappings.filter((item) => !missingSet.has(item)).map((item) => `unexpected-mapping:${item}`),
    ...replacementMappings.filter((item, index) => replacementMappings.indexOf(item) !== index).map((item) => `duplicate-mapping:${item}`),
  ];
  for (const { sectionKey, words } of requirements.originalWritingPractice) {
    const section = sections.get(sectionKey);
    if (!section) continue;
    for (const card of section.cards) {
      if (card.adaptation === "retained" && !words.includes(card.answerText)) replacementMappingErrors.push(`retained-not-baseline:${sectionKey}:${card.answerText}`);
      if (card.adaptation === "coverage_added" && words.includes(card.answerText)) replacementMappingErrors.push(`coverage-added-is-baseline:${sectionKey}:${card.answerText}`);
      if (card.adaptation === "replaced" && card.originalAnswerText) {
        const required = requirements.requiredCharacters.find((item) => item.sectionKey === sectionKey)?.characters ?? [];
        for (const character of required.filter((item) => card.originalAnswerText?.includes(item))) {
          if (!card.answerText.includes(character)) replacementMappingErrors.push(`replacement-loses-character:${sectionKey}:${card.originalAnswerText}->${card.answerText}:${character}`);
        }
      }
    }
  }
  const replacedWritingPracticeCount = missingOriginals.length;
  return {
    missingVocabulary,
    uncoveredCharacters,
    duplicateSectionAnswers,
    writingPracticeCount: writingCards.length,
    originalWritingPracticeCount,
    replacedWritingPracticeCount,
    replacementRatio: originalWritingPracticeCount === 0 ? 0 : replacedWritingPracticeCount / originalWritingPracticeCount,
    replacementMappingErrors,
  };
}
