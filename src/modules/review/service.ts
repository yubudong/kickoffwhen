import { createHash } from "node:crypto";

import { and, asc, count, eq, isNull, lte, or, sql } from "drizzle-orm";
import { Rating, type Grade } from "ts-fsrs";
import { z } from "zod";

import { db, type DbTransaction } from "@/db/client";
import type { ChildActor } from "@/modules/auth/actor";
import { learningCards } from "@/modules/learning-content/schema";
import type { LearningCard } from "@/modules/learning-content/types";

import { childCardStates, reviewEvents } from "./db-schema";
import { parseFsrsCard, serializeFsrsCard } from "./schema";
import {
  createInitialState,
  markRelearningComplete as scheduleRelearningComplete,
  scheduleFirstResult,
  type ScheduledReview,
} from "./scheduler";

type ReviewDatabase = typeof db | DbTransaction;

function commandFingerprint(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function lockReviewScope(
  tx: DbTransaction,
  actor: ChildActor,
  cardId: string,
): Promise<void> {
  const scope = `${actor.familyId}:${actor.childId}:${cardId}`;
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${scope}, 0))`,
  );
}

export async function lockReviewCardsInTransaction(
  tx: DbTransaction,
  actor: ChildActor,
  cardIds: string[],
): Promise<void> {
  const orderedCardIds = [...new Set(cardIds.map((id) => z.string().uuid().parse(id)))].sort();
  for (const cardId of orderedCardIds) {
    await lockReviewScope(tx, actor, cardId);
  }
}

function storedScheduledReview(row: typeof reviewEvents.$inferSelect) {
  const fsrsRating = z.union([z.literal(Rating.Again), z.literal(Rating.Good)]).parse(
    row.fsrsRating,
  ) as Grade;
  return {
    card: parseFsrsCard(row.cardJson),
    dueAt: row.dueAt,
    rating: fsrsRating === Rating.Good ? "good" as const : "again" as const,
    fsrsRating,
    eventType: z.enum([
      "new_first",
      "scheduled_first",
      "same_session_relearning",
    ]).parse(row.eventType),
    parameters: { request_retention: 0.9 as const },
    reviewEventId: row.id,
  };
}

async function findCommandReplay(
  tx: DbTransaction,
  actor: ChildActor,
  commandId: string,
  inputFingerprint: string,
) {
  const [event] = await tx
    .select()
    .from(reviewEvents)
    .where(
      and(
        eq(reviewEvents.familyId, actor.familyId),
        eq(reviewEvents.childId, actor.childId),
        eq(reviewEvents.commandId, commandId),
      ),
    )
    .limit(1);
  if (!event) return null;
  if (event.inputFingerprint !== inputFingerprint) {
    throw new Error("REVIEW_IDEMPOTENCY_CONFLICT");
  }
  return storedScheduledReview(event);
}

function toLearningCard(row: typeof learningCards.$inferSelect): LearningCard {
  return {
    id: row.id,
    familyId: row.familyId,
    subject: z.enum(["chinese", "english"]).parse(row.subject),
    answerText: row.answerText,
    broadcastText: row.broadcastText,
    hintText: row.hintText,
    pinyinText: row.pinyinText,
    curriculumSource: row.curriculumSource as LearningCard["curriculumSource"],
    sourceOrder: row.sourceOrder,
    textbookEditionId: row.textbookEditionId,
    unitId: row.unitId,
    sectionId: row.sectionId,
    source: z.enum(["manual", "bulk", "ocr", "builtin"]).parse(row.source),
  };
}

function buildReviewService(
  database: ReviewDatabase,
  inTransaction: <T>(work: (tx: DbTransaction) => Promise<T>) => Promise<T>,
) {
  async function countDueCards(actor: ChildActor, at: Date): Promise<number> {
    const [result] = await database
      .select({ value: count() })
      .from(childCardStates)
      .innerJoin(learningCards, eq(learningCards.id, childCardStates.cardId))
      .where(
        and(
          eq(childCardStates.familyId, actor.familyId),
          eq(childCardStates.childId, actor.childId),
          lte(childCardStates.dueAt, z.date().parse(at)),
          or(eq(learningCards.familyId, actor.familyId), isNull(learningCards.familyId)),
        ),
      );
    return result.value;
  }

  async function getDueCards(
    actor: ChildActor,
    at: Date,
    limit: number,
  ): Promise<LearningCard[]> {
    const parsedAt = z.date().parse(at);
    const parsedLimit = z.number().int().min(1).max(100).parse(limit);
    const rows = await database
      .select({ card: learningCards })
      .from(childCardStates)
      .innerJoin(learningCards, eq(learningCards.id, childCardStates.cardId))
      .where(
        and(
          eq(childCardStates.familyId, actor.familyId),
          eq(childCardStates.childId, actor.childId),
          lte(childCardStates.dueAt, parsedAt),
          or(
            eq(learningCards.familyId, actor.familyId),
            isNull(learningCards.familyId),
          ),
        ),
      )
      .orderBy(asc(childCardStates.dueAt), asc(childCardStates.cardId))
      .limit(parsedLimit);
    return rows.map((row) => toLearningCard(row.card));
  }

  async function recordFirstResult(
    actor: ChildActor,
    input: {
      cardId: string;
      commandId: string;
      correct: boolean;
      reviewedAt: Date;
      eventType: "new_first" | "scheduled_first";
    },
  ): Promise<ScheduledReview & { reviewEventId: string }> {
    const cardId = z.string().uuid().parse(input.cardId);
    const commandId = z.string().uuid().parse(input.commandId);
    const reviewedAt = z.date().parse(input.reviewedAt);
    const inputFingerprint = commandFingerprint({
      cardId,
      commandId,
      correct: z.boolean().parse(input.correct),
      reviewedAt: reviewedAt.toISOString(),
      eventType: z.enum(["new_first", "scheduled_first"]).parse(input.eventType),
    });
    return inTransaction(async (tx) => {
      await lockReviewScope(tx, actor, cardId);
      const replay = await findCommandReplay(
        tx,
        actor,
        commandId,
        inputFingerprint,
      );
      if (replay) return replay;

      const [card] = await tx
        .select({ id: learningCards.id })
        .from(learningCards)
        .where(
          and(
            eq(learningCards.id, cardId),
            or(eq(learningCards.familyId, actor.familyId), isNull(learningCards.familyId)),
          ),
        )
        .limit(1);
      if (!card) throw new Error("REVIEW_CARD_NOT_FOUND");

      const [stored] = await tx
        .select()
        .from(childCardStates)
        .where(
          and(
            eq(childCardStates.familyId, actor.familyId),
            eq(childCardStates.childId, actor.childId),
            eq(childCardStates.cardId, cardId),
          ),
        )
        .limit(1)
        .for("update");
      if (input.eventType === "new_first" && stored) {
        throw new Error("REVIEW_EVENT_TYPE_INVALID");
      }
      if (input.eventType === "scheduled_first" && !stored) {
        throw new Error("REVIEW_EVENT_TYPE_INVALID");
      }
      if (
        stored &&
        (reviewedAt.getTime() <= stored.updatedAt.getTime() ||
          reviewedAt.getTime() < stored.dueAt.getTime())
      ) {
        throw new Error("REVIEW_TIME_INVALID");
      }

      const scheduled = scheduleFirstResult({
        state: stored ? parseFsrsCard(stored.cardJson) : createInitialState(reviewedAt),
        correct: input.correct,
        reviewedAt,
        eventType: input.eventType,
      });
      const cardJson = serializeFsrsCard(scheduled.card);
      await tx
        .insert(childCardStates)
        .values({
          familyId: actor.familyId,
          childId: actor.childId,
          cardId,
          cardJson,
          dueAt: scheduled.dueAt,
          updatedAt: reviewedAt,
        })
        .onConflictDoUpdate({
          target: [childCardStates.familyId, childCardStates.childId, childCardStates.cardId],
          set: { cardJson, dueAt: scheduled.dueAt, updatedAt: reviewedAt },
        });
      const [event] = await tx
        .insert(reviewEvents)
        .values({
          familyId: actor.familyId,
          childId: actor.childId,
          cardId,
          eventType: scheduled.eventType,
          correct: input.correct,
          fsrsRating: scheduled.fsrsRating,
          reviewedAt,
          dueAt: scheduled.dueAt,
          cardJson,
          commandId,
          inputFingerprint,
        })
        .returning({ id: reviewEvents.id });
      return { ...scheduled, reviewEventId: event.id };
    });
  }

  async function markRelearningComplete(
    actor: ChildActor,
    input: {
      cardId: string;
      commandId: string;
      correctedAt: Date;
      sourceReviewEventId: string;
    },
  ): Promise<ScheduledReview & { reviewEventId: string }> {
    const cardId = z.string().uuid().parse(input.cardId);
    const commandId = z.string().uuid().parse(input.commandId);
    const sourceReviewEventId = z.string().uuid().parse(input.sourceReviewEventId);
    const correctedAt = z.date().parse(input.correctedAt);
    const inputFingerprint = commandFingerprint({
      cardId,
      commandId,
      correctedAt: correctedAt.toISOString(),
      sourceReviewEventId,
      eventType: "same_session_relearning",
    });
    return inTransaction(async (tx) => {
      await lockReviewScope(tx, actor, cardId);
      const replay = await findCommandReplay(
        tx,
        actor,
        commandId,
        inputFingerprint,
      );
      if (replay) return replay;

      const [source] = await tx
        .select()
        .from(reviewEvents)
        .where(
          and(
            eq(reviewEvents.id, sourceReviewEventId),
            eq(reviewEvents.familyId, actor.familyId),
            eq(reviewEvents.childId, actor.childId),
            eq(reviewEvents.cardId, cardId),
            eq(reviewEvents.correct, false),
          ),
        )
        .limit(1);
      const [stored] = await tx
        .select()
        .from(childCardStates)
        .where(
          and(
            eq(childCardStates.familyId, actor.familyId),
            eq(childCardStates.childId, actor.childId),
            eq(childCardStates.cardId, cardId),
          ),
        )
        .limit(1)
        .for("update");
      if (
        !source ||
        !stored ||
        !["new_first", "scheduled_first"].includes(source.eventType)
      ) {
        throw new Error("RELEARNING_SOURCE_INVALID");
      }
      const [existingCorrection] = await tx
        .select({ id: reviewEvents.id })
        .from(reviewEvents)
        .where(eq(reviewEvents.sourceReviewEventId, sourceReviewEventId))
        .limit(1);
      if (existingCorrection) throw new Error("RELEARNING_SOURCE_ALREADY_USED");
      if (
        correctedAt.getTime() <= source.reviewedAt.getTime() ||
        correctedAt.getTime() <= stored.updatedAt.getTime()
      ) {
        throw new Error("REVIEW_TIME_INVALID");
      }
      const scheduled = scheduleRelearningComplete({
        state: parseFsrsCard(stored.cardJson),
        correctedAt,
        sourceReviewEventId,
      });
      const cardJson = serializeFsrsCard(scheduled.card);
      await tx
        .update(childCardStates)
        .set({ cardJson, dueAt: scheduled.dueAt, updatedAt: correctedAt })
        .where(
          and(
            eq(childCardStates.familyId, actor.familyId),
            eq(childCardStates.childId, actor.childId),
            eq(childCardStates.cardId, cardId),
          ),
        );
      const [event] = await tx
        .insert(reviewEvents)
        .values({
          familyId: actor.familyId,
          childId: actor.childId,
          cardId,
          eventType: scheduled.eventType,
          correct: true,
          fsrsRating: Rating.Good,
          reviewedAt: correctedAt,
          dueAt: scheduled.dueAt,
          cardJson,
          sourceReviewEventId,
          commandId,
          inputFingerprint,
        })
        .returning({ id: reviewEvents.id });
      return { ...scheduled, reviewEventId: event.id };
    });
  }

  return { countDueCards, getDueCards, markRelearningComplete, recordFirstResult };
}

export function createReviewService(database: ReviewDatabase = db) {
  return buildReviewService(database, (work) => database.transaction(work));
}

export function createTransactionalReviewService(tx: DbTransaction) {
  return buildReviewService(tx, (work) => work(tx));
}

const reviewService = createReviewService();
export const getDueCards = reviewService.getDueCards;
export const recordFirstResult = reviewService.recordFirstResult;
