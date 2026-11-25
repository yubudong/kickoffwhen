import { createHash } from "node:crypto";
import { validateMultiEnglishMetadata } from './english-multi-audit';
import approvedIndex from "../../../content/official-english-metadata.json";
import type { SeedContent } from "./seed-validator";
import { englishCardMetadataSchema } from "./english-types";

export type EnglishContentRequirements = {
  auditProfile: "official_english"; publisher: string; series: string; subject: "english";
  grade: number; volume: string; editionText: string;
  source: { provider: string; resourceId: string; url: string; activeImageBase: string;
    requirement: string; requirementImagePage: number;
    evidence: Array<{imagePage:number;url:string;sha256:string}> };
  unitTitles: string[]; counts: Record<string,number>;
  entries: Array<{builtinKey:string;answerText:string;broadcastText:string;unitOrder:number;
    sectionKey:string;learningTarget:string;sourceWord:string;sourceRole:string;
    originalMeaningZh:string;sourceImagePage:number;sourcePrintedPage:number;metadataDigest:string}>;
};
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([key,item]) => [key,stable(item)]));
  return value;
}
export function englishMetadataDigest(value: unknown) { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function hasAnswer(text: string, answer: string) {
  return new RegExp(`(?<![A-Za-z])${answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`, "i").test(text);
}
export function validateEnglishSeedMetadata(content: SeedContent) {
  if (content.auditProfile === 'verified_english') { validateMultiEnglishMetadata(content); return; }
  if (content.auditProfile !== "official_english") {
    if (content.units.some(unit=>unit.sections.some(section=>section.cards.some(card=>card.english)))) throw new Error("ENGLISH_METADATA_PROFILE_REQUIRED");
    return;
  }
  if (content.subject !== "english" || content.grade < 3 || content.grade > 6) throw new Error("ENGLISH_EDITION_SCOPE_INVALID");
  for (const unit of content.units) for (const section of unit.sections) for (const card of section.cards) {
    const meta = englishCardMetadataSchema.parse(card.english);
    if (meta.version !== 1) throw new Error('ENGLISH_PEP_METADATA_VERSION_INVALID');
    if (!/^[A-Za-z][A-Za-z .'-]*$/.test(card.answerText) || card.broadcastText.length > 500 || /[\u4e00-\u9fff]/.test(card.broadcastText)) throw new Error("ENGLISH_CARD_TEXT_INVALID");
    if (!/^en-pep-\d{6}-g[3-6]-v[12]-u[1-7]-(a|b|numbers)-[0-9a-f]{14}$/.test(card.builtinKey)) throw new Error("ENGLISH_BUILTIN_KEY_INVALID");
    if (meta.exampleWithBlank.split("（　　）").length !== 2) throw new Error("ENGLISH_CLOZE_INVALID");
    if ([meta.meaningZh,meta.exampleWithBlank.replace("（　　）", " "),meta.exampleTranslation].some(text => hasAnswer(text,card.answerText))) throw new Error("ENGLISH_ASSISTED_ANSWER_LEAK");
    if (!hasAnswer(meta.exampleSentence,card.answerText)) throw new Error("ENGLISH_EXAMPLE_TARGET_MISSING");
    if (meta.pronunciation && meta.pronunciation.target !== card.answerText) throw new Error("ENGLISH_PRONUNCIATION_TARGET_MISMATCH");
    const expectedBroadcast = meta.spokenContext
      ? card.answerText + (card.answerText.endsWith(".") ? " " : ". ") + meta.spokenContext : card.answerText;
    if (expectedBroadcast !== card.broadcastText) throw new Error("ENGLISH_BROADCAST_MISMATCH");
    if (card.pinyinText || card.curriculumSource) throw new Error("ENGLISH_CHINESE_FIELD_MISMATCH");
  }
}
export function assertEnglishSeedAudit(content: SeedContent, ref: EnglishContentRequirements) {
  validateEnglishSeedMetadata(content);
  for (const key of ["publisher","series","grade","volume","editionText"] as const) if (content[key] !== ref[key]) throw new Error("ENGLISH_REQUIREMENTS_IDENTITY_MISMATCH");
  if (content.auditProfile !== "official_english" || ref.auditProfile !== "official_english" || ref.subject !== "english") throw new Error("ENGLISH_AUDIT_PROFILE_INVALID");
  if (!ref.source || ref.source.provider !== "国家中小学智慧教育平台" || !ref.source.url.includes(ref.source.resourceId)
    || !/^https:\/\/basic\.smartedu\.cn\//.test(ref.source.url)
    || !/^https:\/\/r[123]-ndr\.ykt\.cbern\.com\.cn\/edu_product\/esp\/assets\//.test(ref.source.activeImageBase)
    || !ref.source.evidence.some(page => page.imagePage === ref.source.requirementImagePage)) throw new Error("ENGLISH_SOURCE_EVIDENCE_INVALID");
  if (content.units.map(unit => unit.title).join("\0") !== ref.unitTitles.join("\0")) throw new Error("ENGLISH_UNIT_ORDER_MISMATCH");
  const cards = content.units.flatMap(unit => unit.sections.flatMap(section => section.cards.map(card => ({card,unit,section}))));
  if (cards.length !== ref.entries.length || !cards.length) throw new Error("ENGLISH_VOCABULARY_COVERAGE_MISMATCH");
  const expected = new Map(ref.entries.map(entry => [entry.builtinKey,entry]));
  if (expected.size !== ref.entries.length) throw new Error("ENGLISH_REFERENCE_DUPLICATE");
  const counts:Record<string,number>={};
  for (const {card,unit,section} of cards) {
    const entry=expected.get(card.builtinKey);const meta=card.english!;
    const approved=(approvedIndex as Record<string,unknown>)[card.builtinKey];
    if (!Object.hasOwn(approvedIndex,card.builtinKey) || englishMetadataDigest(approved)!==englishMetadataDigest(meta)) throw new Error("ENGLISH_RUNTIME_INDEX_MISMATCH");
    if (!entry || entry.answerText!==card.answerText || entry.broadcastText!==card.broadcastText || entry.unitOrder!==unit.order
      || entry.sectionKey!==section.key || entry.learningTarget!==meta.learningTarget || entry.sourceWord!==meta.sourceWord
      || entry.sourceRole!==meta.sourceRole || entry.sourceImagePage!==meta.sourceImagePage || entry.sourcePrintedPage!==meta.sourcePrintedPage
      || englishMetadataDigest(meta)!==entry.metadataDigest) throw new Error(`ENGLISH_REFERENCE_CARD_MISMATCH:${card.builtinKey}`);
    const evidence=ref.source.evidence.find(page=>page.imagePage===meta.sourceImagePage);
    if (!evidence || !/^[a-f0-9]{64}$/.test(evidence.sha256) || !evidence.url.endsWith(`/${meta.sourceImagePage}.jpg`)) throw new Error("ENGLISH_REFERENCE_PAGE_MISSING");
    counts[meta.learningTarget]=(counts[meta.learningTarget]??0)+1;
  }
  for (const key of ["spelling","core","recognition"]) if ((counts[key]??0)!==(ref.counts[key]??0)) throw new Error("ENGLISH_TARGET_TOTAL_MISMATCH");
  return {cards:cards.length,counts};
}
