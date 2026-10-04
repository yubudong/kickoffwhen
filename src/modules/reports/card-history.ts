import { and, desc, eq, isNull, max, or } from "drizzle-orm";
import { z } from "zod";

import type { DbTransaction } from "@/db/client";
import type { GuardianActor } from "@/modules/auth/actor";
import {
  dictationAnswerEvents,
  dictationSessionItems,
  dictationSessions,
} from "@/modules/dictation/session-schema";
import { learningTaskItems, learningTasks } from "@/modules/dictation/task-schema";
import { children } from "@/modules/families/schema";
import { learningCards } from "@/modules/learning-content/schema";
import { childCardStates, reviewEvents } from "@/modules/review/db-schema";

import { validateReportAttemptFact } from "./attempt-facts";
import type {
  CardHistory,
  CardHistoryAttempt,
  ReportAttemptRole,
  ReportReviewEventType,
} from "./types";

type ReportDatabase = typeof import("@/db/client").db | DbTransaction;
const ATTEMPT_LIMIT = 100 as const;

function notFound(): never {
  throw new Error("REPORT_NOT_FOUND");
}

function inconsistent(): never {
  throw new Error("REPORT_INCONSISTENT");
}

export function createCardHistoryService(database?: ReportDatabase) {
  async function getCardHistory(
    actor: GuardianActor,
    rawChildId: string,
    rawCardId: string,
  ): Promise<CardHistory> {
    const childId = z.string().uuid().safeParse(rawChildId);
    const cardId = z.string().uuid().safeParse(rawCardId);
    if (!childId.success || !cardId.success) notFound();
    const client = database ?? (await import("@/db/client")).db;

    const [card] = await client
      .select({
        cardId: learningCards.id,
        answerText: learningCards.answerText,
        nextDueAt: childCardStates.dueAt,
      })
      .from(learningCards)
      .innerJoin(
        children,
        and(
          eq(children.familyId, actor.familyId),
          eq(children.id, childId.data),
        ),
      )
      .leftJoin(
        childCardStates,
        and(
          eq(childCardStates.familyId, actor.familyId),
          eq(childCardStates.childId, childId.data),
          eq(childCardStates.cardId, learningCards.id),
        ),
      )
      .where(and(
        eq(learningCards.id, cardId.data),
        or(eq(learningCards.familyId, actor.familyId), isNull(learningCards.familyId)),
      ))
      .limit(1);
    if (!card) notFound();

    const scope = and(
      eq(dictationAnswerEvents.familyId, actor.familyId),
      eq(dictationAnswerEvents.childId, childId.data),
      eq(dictationSessionItems.cardId, cardId.data),
      eq(learningTaskItems.cardId, cardId.data),
    );
    const rows = await client
        .select({
          occurredAt: dictationAnswerEvents.answeredAt,
          round: dictationAnswerEvents.roundNumber,
          correct: dictationAnswerEvents.correct,
          eventRole: dictationAnswerEvents.eventRole,
          taskItemKind: learningTaskItems.kind,
          sessionItemKind: dictationSessionItems.kind,
          answerReviewEventId: dictationAnswerEvents.reviewEventId,
          firstReviewEventId: dictationSessionItems.firstReviewEventId,
          eventType: reviewEvents.eventType,
          reviewEventCorrect: reviewEvents.correct,
          reviewEventReviewedAt: reviewEvents.reviewedAt,
          reviewEventSourceId: reviewEvents.sourceReviewEventId,
        })
        .from(dictationAnswerEvents)
        .innerJoin(
          dictationSessionItems,
          and(
            eq(dictationSessionItems.familyId, dictationAnswerEvents.familyId),
            eq(dictationSessionItems.childId, dictationAnswerEvents.childId),
            eq(dictationSessionItems.sessionId, dictationAnswerEvents.sessionId),
            eq(dictationSessionItems.taskItemId, dictationAnswerEvents.taskItemId),
          ),
        )
        .innerJoin(
          dictationSessions,
          and(
            eq(dictationSessions.familyId, dictationSessionItems.familyId),
            eq(dictationSessions.childId, dictationSessionItems.childId),
            eq(dictationSessions.id, dictationSessionItems.sessionId),
            eq(dictationSessions.taskId, dictationSessionItems.taskId),
          ),
        )
        .innerJoin(
          learningTasks,
          and(
            eq(learningTasks.familyId, dictationSessions.familyId),
            eq(learningTasks.childId, dictationSessions.childId),
            eq(learningTasks.id, dictationSessions.taskId),
          ),
        )
        .innerJoin(
          learningTaskItems,
          and(
            eq(learningTaskItems.familyId, dictationSessionItems.familyId),
            eq(learningTaskItems.childId, dictationSessionItems.childId),
            eq(learningTaskItems.taskId, dictationSessionItems.taskId),
            eq(learningTaskItems.id, dictationSessionItems.taskItemId),
            eq(learningTaskItems.cardId, dictationSessionItems.cardId),
          ),
        )
        .leftJoin(
          reviewEvents,
          and(
            eq(reviewEvents.id, dictationAnswerEvents.reviewEventId),
            eq(reviewEvents.familyId, dictationAnswerEvents.familyId),
            eq(reviewEvents.childId, dictationAnswerEvents.childId),
            eq(reviewEvents.cardId, learningTaskItems.cardId),
          ),
        )
        .where(scope)
        .orderBy(desc(dictationAnswerEvents.answeredAt), desc(dictationAnswerEvents.id))
        .limit(ATTEMPT_LIMIT);
    const [latestError] = await client
        .select({ occurredAt: max(dictationAnswerEvents.answeredAt) })
        .from(dictationAnswerEvents)
        .innerJoin(
          dictationSessionItems,
          and(
            eq(dictationSessionItems.familyId, dictationAnswerEvents.familyId),
            eq(dictationSessionItems.childId, dictationAnswerEvents.childId),
            eq(dictationSessionItems.sessionId, dictationAnswerEvents.sessionId),
            eq(dictationSessionItems.taskItemId, dictationAnswerEvents.taskItemId),
          ),
        )
        .innerJoin(
          learningTaskItems,
          and(
            eq(learningTaskItems.familyId, dictationSessionItems.familyId),
            eq(learningTaskItems.childId, dictationSessionItems.childId),
            eq(learningTaskItems.taskId, dictationSessionItems.taskId),
            eq(learningTaskItems.id, dictationSessionItems.taskItemId),
            eq(learningTaskItems.cardId, dictationSessionItems.cardId),
          ),
        )
        .where(and(scope, eq(dictationAnswerEvents.correct, false)));
    if (!card.nextDueAt && rows.length === 0) notFound();
    if (card.nextDueAt && rows.length === 0) inconsistent();

    const attempts: CardHistoryAttempt[] = rows.reverse().map((row) => {
      const validated = validateReportAttemptFact({
        round: row.round,
        correct: row.correct,
        eventRole: row.eventRole,
        occurredAt: row.occurredAt,
        taskItemKind: row.taskItemKind,
        sessionItemKind: row.sessionItemKind,
        answerReviewEventId: row.answerReviewEventId,
        firstReviewEventId: row.firstReviewEventId,
        reviewEventType: row.eventType,
        reviewEventCorrect: row.reviewEventCorrect,
        reviewEventReviewedAt: row.reviewEventReviewedAt,
        reviewEventSourceId: row.reviewEventSourceId,
      });
      const eventRole = validated.eventRole satisfies ReportAttemptRole;
      const eventType = validated.eventType satisfies ReportReviewEventType | null;
      return {
        occurredAt: row.occurredAt,
        round: row.round,
        correct: row.correct,
        eventRole,
        eventType,
        scheduledRetentionResult:
          eventType === "scheduled_first" ? row.correct : null,
      };
    });

    return {
      childId: childId.data,
      cardId: card.cardId,
      answerText: card.answerText,
      nextDueAt: card.nextDueAt,
      recentErrorAt: latestError?.occurredAt ?? null,
      attemptLimit: ATTEMPT_LIMIT,
      attempts,
    };
  }

  return { getCardHistory };
}

const cardHistoryService = createCardHistoryService();
export const getCardHistory = cardHistoryService.getCardHistory;
