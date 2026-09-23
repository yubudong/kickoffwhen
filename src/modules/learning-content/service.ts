import { and, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { db, type DbTransaction } from "@/db/client";
import type { GuardianActor } from "@/modules/auth/actor";

import {
  learningCards,
  ocrDraftLines,
  ocrDrafts,
  textbookEditions,
  textbookSections,
  textbookUnits,
} from "./schema";
import { buildContentLibrary, type CatalogEdition, type ContentLibrary } from "./library-tree";
import type {
  CardFilter,
  CardSource,
  ConfirmedCardInput,
  CreateCardInput,
  LearningCard,
} from "./types";

const subjectSchema = z.enum(["chinese", "english"]);
const cardSourceSchema = z.enum(["manual", "bulk", "ocr", "builtin"]);
const cardTextSchema = z.string().trim().min(1).max(500);
const curriculumSourceSchema = z.enum(["required_vocabulary", "writing_practice"]);

export const createCardInputSchema = z.object({
  subject: subjectSchema,
  answerText: cardTextSchema,
  broadcastText: cardTextSchema,
  hintText: cardTextSchema.optional(),
  pinyinText: cardTextSchema.optional(),
  curriculumSource: curriculumSourceSchema.optional(),
  sourceOrder: z.number().int().nonnegative().optional(),
  textbookEditionId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  sectionId: z.string().uuid().optional(),
  source: cardSourceSchema,
});

export const confirmedCardInputSchema = z.object({
  lineId: z.string().uuid(),
  answerText: cardTextSchema,
  broadcastText: cardTextSchema,
  hintText: cardTextSchema.optional(),
});

const cardFilterSchema = z.object({
  subject: subjectSchema.optional(),
  unitId: z.string().uuid().optional(),
  query: z.string().trim().max(500).optional(),
});

type LearningContentDatabase = typeof db | DbTransaction;

function toLearningCard(row: typeof learningCards.$inferSelect): LearningCard {
  return {
    id: row.id,
    familyId: row.familyId,
    subject: subjectSchema.parse(row.subject),
    answerText: row.answerText,
    broadcastText: row.broadcastText,
    hintText: row.hintText,
    pinyinText: row.pinyinText,
    curriculumSource: row.curriculumSource ? curriculumSourceSchema.parse(row.curriculumSource) : null,
    sourceOrder: row.sourceOrder,
    textbookEditionId: row.textbookEditionId,
    unitId: row.unitId,
    sectionId: row.sectionId,
    source: cardSourceSchema.parse(row.source) as CardSource,
  };
}

export function createLearningContentService(
  database: LearningContentDatabase = db,
) {
  async function createCard(
    actor: GuardianActor,
    input: CreateCardInput,
  ): Promise<LearningCard> {
    const value = createCardInputSchema.parse(input);
    const [card] = await database
      .insert(learningCards)
      .values({ ...value, familyId: actor.familyId, hintText: value.hintText ?? null })
      .returning();
    return toLearningCard(card);
  }

  async function createBulkCards(
    actor: GuardianActor,
    inputs: CreateCardInput[],
  ): Promise<LearningCard[]> {
    const values = z
      .array(createCardInputSchema)
      .min(1)
      .parse(inputs)
      .map((input) => {
        if (input.source !== "bulk") throw new Error("BULK_CARD_SOURCE_REQUIRED");
        return {
          ...input,
          familyId: actor.familyId,
          hintText: input.hintText ?? null,
        };
      });

    return database.transaction(async (tx) => {
      const cards = await tx.insert(learningCards).values(values).returning();
      return cards.map(toLearningCard);
    });
  }

  async function listCards(
    actor: GuardianActor,
    filter: CardFilter,
  ): Promise<LearningCard[]> {
    const value = cardFilterSchema.parse(filter);
    const conditions = [
      or(eq(learningCards.familyId, actor.familyId), isNull(learningCards.familyId)),
    ];
    if (value.subject) conditions.push(eq(learningCards.subject, value.subject));
    if (value.unitId) conditions.push(eq(learningCards.unitId, value.unitId));
    if (value.query) {
      conditions.push(ilike(learningCards.answerText, `%${value.query}%`));
    }

    const rows = await database
      .select()
      .from(learningCards)
      .where(and(...conditions))
      .orderBy(learningCards.createdAt, learningCards.id);
    return rows.map(toLearningCard);
  }

  async function listContentLibrary(actor: GuardianActor): Promise<ContentLibrary> {
    const rows = await database
      .select({ edition: textbookEditions, unit: textbookUnits, section: textbookSections })
      .from(textbookEditions)
      .leftJoin(textbookUnits, eq(textbookUnits.textbookEditionId, textbookEditions.id))
      .leftJoin(textbookSections, eq(textbookSections.unitId, textbookUnits.id))
      .orderBy(
        textbookEditions.subject,
        textbookEditions.grade,
        textbookEditions.volume,
        textbookEditions.publisher,
        textbookEditions.id,
        textbookUnits.unitOrder,
        textbookUnits.id,
        textbookSections.sectionOrder,
        textbookSections.id,
      );
    const catalog: CatalogEdition[] = [];
    const editionsById = new Map<string, CatalogEdition>();
    for (const row of rows) {
      let edition = editionsById.get(row.edition.id);
      if (!edition) {
        edition = {
          id: row.edition.id,
          publisher: row.edition.publisher,
          series: row.edition.series,
          editionText: row.edition.editionText,
          subject: subjectSchema.parse(row.edition.subject),
          grade: row.edition.grade,
          volume: row.edition.volume,
          units: [],
        };
        editionsById.set(edition.id, edition);
        catalog.push(edition);
      }
      const rowUnit = row.unit;
      if (!rowUnit) continue;
      let unit = edition.units.find((item) => item.id === rowUnit.id);
      if (!unit) {
        unit = { id: rowUnit.id, title: rowUnit.title, order: rowUnit.unitOrder, sections: [] };
        edition.units.push(unit);
      }
      if (row.section) {
        unit.sections.push({
          id: row.section.id,
          title: row.section.title,
          order: row.section.sectionOrder,
        });
      }
    }
    return buildContentLibrary(catalog, await listCards(actor, {}));
  }

  async function confirmOcrDraft(
    actor: GuardianActor,
    draftId: string,
    cards: ConfirmedCardInput[],
    decidedLineIds?: string[],
  ): Promise<LearningCard[]> {
    const confirmedCards = z.array(confirmedCardInputSchema).max(500).parse(cards);
    const uniqueLineIds = new Set(confirmedCards.map((card) => card.lineId));
    if (uniqueLineIds.size !== confirmedCards.length) {
      throw new Error("OCR_DRAFT_LINE_DUPLICATE");
    }
    const decisions = decidedLineIds
      ? z.array(z.string().uuid()).min(1).max(500).parse(decidedLineIds)
      : null;
    const uniqueDecisionIds = decisions ? new Set(decisions) : null;
    if (decisions && uniqueDecisionIds?.size !== decisions.length) {
      throw new Error("OCR_DRAFT_LINE_DUPLICATE");
    }
    if (uniqueDecisionIds && [...uniqueLineIds].some((id) => !uniqueDecisionIds.has(id))) {
      throw new Error("OCR_DRAFT_LINE_INVALID");
    }

    return database.transaction(async (tx) => {
      const [draft] = await tx
        .select({ id: ocrDrafts.id, subject: ocrDrafts.subject })
        .from(ocrDrafts)
        .where(and(eq(ocrDrafts.id, draftId), eq(ocrDrafts.familyId, actor.familyId)))
        .limit(1)
        .for("update");
      if (!draft) throw new Error("OCR_DRAFT_NOT_FOUND");

      const lines = await tx
        .select()
        .from(ocrDraftLines)
        .where(
          and(
            eq(ocrDraftLines.draftId, draft.id),
            eq(ocrDraftLines.familyId, actor.familyId),
          ),
        )
        .orderBy(ocrDraftLines.sourceOrder, ocrDraftLines.id)
        .for("update");
      if (lines.length === 0) throw new Error("OCR_DRAFT_EMPTY");
      if (
        uniqueDecisionIds &&
        (lines.length !== uniqueDecisionIds.size ||
          lines.some((line) => !uniqueDecisionIds.has(line.id)))
      ) {
        throw new Error("OCR_DRAFT_LINE_INVALID");
      }
      if (lines.filter((line) => uniqueLineIds.has(line.id)).length !== confirmedCards.length) {
        throw new Error("OCR_DRAFT_LINE_INVALID");
      }

      const lineById = new Map(lines.map((line) => [line.id, line]));
      if (lines.some((line) => line.status !== "draft")) {
        const confirmedByLineId = new Map(
          (
            await tx
              .select()
              .from(learningCards)
              .where(
                and(
                  eq(learningCards.familyId, actor.familyId),
                  inArray(
                    learningCards.id,
                    lines.flatMap((line) =>
                      line.confirmedCardId ? [line.confirmedCardId] : [],
                    ),
                  ),
                ),
              )
          ).map((card) => [card.id, card]),
        );
        const isSameDecision = lines.every((line) => {
          const input = confirmedCards.find((card) => card.lineId === line.id);
          if (!input) return line.status === "rejected" && line.confirmedCardId === null;
          const existing = line.confirmedCardId
            ? confirmedByLineId.get(line.confirmedCardId)
            : undefined;
          return (
            line.status === "confirmed" &&
            existing?.answerText === input.answerText &&
            existing.broadcastText === input.broadcastText &&
            existing.hintText === (input.hintText ?? null)
          );
        });
        if (!isSameDecision) throw new Error("OCR_DRAFT_ALREADY_FINALIZED");
        return confirmedCards.map((input) => {
          const line = lineById.get(input.lineId);
          const card = line?.confirmedCardId
            ? confirmedByLineId.get(line.confirmedCardId)
            : undefined;
          if (!card) throw new Error("OCR_DRAFT_ALREADY_FINALIZED");
          return toLearningCard(card);
        });
      }

      const createdCards: LearningCard[] = [];
      for (const input of confirmedCards) {
        const line = lineById.get(input.lineId);
        if (!line) throw new Error("OCR_DRAFT_LINE_INVALID");
        const [card] = await tx
          .insert(learningCards)
          .values({
            familyId: actor.familyId,
            subject: subjectSchema.parse(draft.subject),
            answerText: input.answerText,
            broadcastText: input.broadcastText,
            hintText: input.hintText ?? null,
            source: "ocr",
          })
          .returning();
        await tx
          .update(ocrDraftLines)
          .set({ status: "confirmed", confirmedCardId: card.id })
          .where(
            and(
              eq(ocrDraftLines.id, line.id),
              eq(ocrDraftLines.familyId, actor.familyId),
              eq(ocrDraftLines.draftId, draft.id),
            ),
          );
        createdCards.push(toLearningCard(card));
      }
      const rejectedLineIds = lines
        .filter((line) => !uniqueLineIds.has(line.id))
        .map((line) => line.id);
      if (rejectedLineIds.length > 0) {
        await tx
          .update(ocrDraftLines)
          .set({ status: "rejected", confirmedCardId: null })
          .where(
            and(
              eq(ocrDraftLines.familyId, actor.familyId),
              eq(ocrDraftLines.draftId, draft.id),
              inArray(ocrDraftLines.id, rejectedLineIds),
            ),
          );
      }
      return createdCards;
    });
  }

  return { createBulkCards, createCard, confirmOcrDraft, listCards, listContentLibrary };
}

const learningContentService = createLearningContentService();

export const createCard = learningContentService.createCard;
export const createBulkCards = learningContentService.createBulkCards;
export const confirmOcrDraft = learningContentService.confirmOcrDraft;
export const listCards = learningContentService.listCards;
export const listContentLibrary = learningContentService.listContentLibrary;
