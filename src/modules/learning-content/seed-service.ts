import { and, eq, isNull } from "drizzle-orm";

import { db, type DbTransaction } from "@/db/client";
import { learningCards, textbookEditions, textbookSections, textbookUnits } from "./schema";
import { type SeedContent, validateSeedContents } from "./seed-validator";
import { assertChineseSeedAudit, chineseContentIdentity, chineseRequirementsIdentity, type ChineseContentRequirements } from "./content-audit";

type SeedDatabase = typeof db | DbTransaction;
export type SeedApplySummary = { edition: string; insertedCards: number; updatedCards: number };

async function importEdition(tx: DbTransaction, content: SeedContent): Promise<SeedApplySummary> {
  const identity = and(eq(textbookEditions.publisher, content.publisher), eq(textbookEditions.series, content.series), eq(textbookEditions.subject, content.subject), eq(textbookEditions.grade, content.grade), eq(textbookEditions.volume, content.volume), eq(textbookEditions.editionText, content.editionText));
  await tx.insert(textbookEditions).values({ publisher: content.publisher, series: content.series, subject: content.subject, grade: content.grade, volume: content.volume, editionText: content.editionText }).onConflictDoNothing();
  const [edition] = await tx.select().from(textbookEditions).where(identity).limit(1);
  if (!edition) throw new Error("SEED_EDITION_UPSERT_FAILED");
  let insertedCards = 0;
  let updatedCards = 0;
  for (const unitInput of content.units) {
    await tx.insert(textbookUnits).values({ textbookEditionId: edition.id, unitOrder: unitInput.order, title: unitInput.title }).onConflictDoUpdate({ target: [textbookUnits.textbookEditionId, textbookUnits.unitOrder], set: { title: unitInput.title } });
    const [unit] = await tx.select().from(textbookUnits).where(and(eq(textbookUnits.textbookEditionId, edition.id), eq(textbookUnits.unitOrder, unitInput.order))).limit(1);
    if (!unit) throw new Error("SEED_UNIT_UPSERT_FAILED");
    const existingSections = await tx.select().from(textbookSections).where(eq(textbookSections.unitId, unit.id)).orderBy(textbookSections.sectionOrder, textbookSections.id);
    for (const [index, existing] of existingSections.entries()) {
      await tx.update(textbookSections).set({ sectionOrder: -(index + 1) }).where(eq(textbookSections.id, existing.id));
    }
    for (const sectionInput of unitInput.sections) {
      await tx.insert(textbookSections).values({ unitId: unit.id, sectionKey: sectionInput.key, sectionOrder: sectionInput.order, title: sectionInput.title, sectionType: sectionInput.type }).onConflictDoUpdate({ target: [textbookSections.unitId, textbookSections.sectionKey], set: { sectionOrder: sectionInput.order, title: sectionInput.title, sectionType: sectionInput.type } });
      const [section] = await tx.select().from(textbookSections).where(and(eq(textbookSections.unitId, unit.id), eq(textbookSections.sectionKey, sectionInput.key))).limit(1);
      if (!section) throw new Error("SEED_SECTION_UPSERT_FAILED");
      for (const [index, card] of sectionInput.cards.entries()) {
        const [existing] = await tx.select({ id: learningCards.id, subject: learningCards.subject, answerText: learningCards.answerText, broadcastText: learningCards.broadcastText }).from(learningCards).where(and(eq(learningCards.builtinKey, card.builtinKey), eq(learningCards.source, "builtin"), isNull(learningCards.familyId))).limit(1);
        const mutableValues = { hintText: card.hintText ?? null, pinyinText: card.pinyinText ?? null, curriculumSource: card.curriculumSource ?? null, sourceOrder: index + 1, textbookEditionId: edition.id, unitId: unit.id, sectionId: section.id };
        if (existing) {
          if (existing.subject !== content.subject || existing.answerText !== card.answerText || existing.broadcastText !== card.broadcastText) {
            throw new Error(`BUILTIN_CARD_IDENTITY_IMMUTABLE:${card.builtinKey}:use-new-builtin-key`);
          }
          await tx.update(learningCards).set(mutableValues).where(and(eq(learningCards.id, existing.id), eq(learningCards.source, "builtin"), isNull(learningCards.familyId)));
          updatedCards += 1;
        } else {
          await tx.insert(learningCards).values({ ...mutableValues, familyId: null, subject: content.subject, answerText: card.answerText, broadcastText: card.broadcastText, source: "builtin", builtinKey: card.builtinKey });
          insertedCards += 1;
        }
      }
    }
    const incomingKeys = new Set(unitInput.sections.map((section) => section.key));
    const absentSections = existingSections.filter((section) => !incomingKeys.has(section.sectionKey));
    for (const [index, absent] of absentSections.entries()) {
      await tx.update(textbookSections).set({ sectionOrder: unitInput.sections.length + index + 1 }).where(eq(textbookSections.id, absent.id));
    }
  }
  return { edition: `${content.publisher}｜${content.series}｜${content.editionText}`, insertedCards, updatedCards };
}

export async function applySeedContents(database: SeedDatabase, inputs: unknown[], requirements: ChineseContentRequirements[]): Promise<SeedApplySummary[]> {
  const contents = validateSeedContents(inputs);
  const requirementsByIdentity = new Map(requirements.map((item) => [chineseRequirementsIdentity(item), item]));
  for (const content of contents) {
    if (content.subject !== "chinese") continue;
    const matchingRequirements = requirementsByIdentity.get(chineseContentIdentity(content));
    if (!matchingRequirements) throw new Error("SEED_REQUIREMENTS_NOT_FOUND");
    assertChineseSeedAudit(content, matchingRequirements);
  }
  const summaries: SeedApplySummary[] = [];
  for (const content of contents) summaries.push(await database.transaction((tx) => importEdition(tx, content)));
  return summaries;
}
