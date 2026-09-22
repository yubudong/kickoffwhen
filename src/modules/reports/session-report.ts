import { and, asc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";

import type { DbTransaction } from "@/db/client";
import type { GuardianActor } from "@/modules/auth/actor";
import {
  dictationAnswerEvents,
  dictationCompletionEvents,
  dictationPlaybackEvents,
  dictationRoundItems,
  dictationSessionItems,
  dictationSessions,
} from "@/modules/dictation/session-schema";
import { learningTaskItems, learningTasks } from "@/modules/dictation/task-schema";
import { learningCards } from "@/modules/learning-content/schema";

import type {
  ReportReviewEventType,
  SessionAttemptFact,
  SessionMetrics,
  SessionReport,
} from "./types";

type ReportDatabase = typeof import("@/db/client").db | DbTransaction;

type RoundItemFact = { itemId: string; round: number };

function factKey(fact: RoundItemFact): string {
  return `${fact.round}:${fact.itemId}`;
}

function inconsistent(): never {
  throw new Error("REPORT_INCONSISTENT");
}

export function calculateSessionMetrics(input: {
  itemIds: string[];
  attempts: SessionAttemptFact[];
  roundMemberships: RoundItemFact[];
  playbackFacts: RoundItemFact[];
}): SessionMetrics {
  const itemIds = new Set(input.itemIds);
  if (itemIds.size === 0 || itemIds.size !== input.itemIds.length) inconsistent();

  const memberships = new Set<string>();
  for (const membership of input.roundMemberships) {
    if (!itemIds.has(membership.itemId) || membership.round < 1) inconsistent();
    const key = factKey(membership);
    if (memberships.has(key)) inconsistent();
    memberships.add(key);
  }

  const attemptsByItem = new Map<string, SessionAttemptFact[]>();
  const attemptsByMembership = new Map<string, SessionAttemptFact>();
  for (const attempt of input.attempts) {
    const key = factKey({ itemId: attempt.itemId, round: attempt.round });
    if (
      !itemIds.has(attempt.itemId) ||
      !memberships.has(key) ||
      attemptsByMembership.has(key)
    ) inconsistent();
    if (attempt.round === 1 && attempt.eventRole !== "first_pass") inconsistent();
    if (attempt.round > 1 && attempt.eventRole === "first_pass") inconsistent();
    if (attempt.eventRole === "continued_error" && attempt.correct) inconsistent();
    if (attempt.eventRole === "same_session_relearning" && !attempt.correct) inconsistent();
    attemptsByMembership.set(key, attempt);
    const attempts = attemptsByItem.get(attempt.itemId) ?? [];
    attempts.push(attempt);
    attemptsByItem.set(attempt.itemId, attempts);
  }
  if (
    attemptsByMembership.size !== memberships.size ||
    [...memberships].some((key) => !attemptsByMembership.has(key))
  ) inconsistent();

  const roundTimes = new Map<number, { earliest: number; latest: number }>();
  for (const attempt of input.attempts) {
    const time = attempt.occurredAt.getTime();
    if (!Number.isFinite(time)) inconsistent();
    const current = roundTimes.get(attempt.round);
    roundTimes.set(attempt.round, {
      earliest: Math.min(current?.earliest ?? time, time),
      latest: Math.max(current?.latest ?? time, time),
    });
  }
  const orderedRounds = [...roundTimes.entries()].sort(
    ([left], [right]) => left - right,
  );
  for (let index = 1; index < orderedRounds.length; index += 1) {
    if (orderedRounds[index - 1]![1].latest >= orderedRounds[index]![1].earliest) {
      inconsistent();
    }
  }

  let firstPassCorrect = 0;
  let finalCorrect = 0;
  let retryCount = 0;
  const errorCards: SessionMetrics["errorCards"] = [];
  for (const itemId of itemIds) {
    const attempts = [...(attemptsByItem.get(itemId) ?? [])].sort(
      (left, right) => left.round - right.round,
    );
    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index]!;
      if (attempt.round !== index + 1) inconsistent();
      if (
        attempt.cardId !== attempts[0]!.cardId ||
        attempt.answerText !== attempts[0]!.answerText
      ) inconsistent();
      if (index > 0 && attempts[index - 1]!.correct) inconsistent();
    }
    const firstPass = attempts.filter((attempt) => attempt.eventRole === "first_pass");
    if (firstPass.length !== 1 || attempts[0] !== firstPass[0]) inconsistent();
    if (firstPass[0]!.correct) firstPassCorrect += 1;
    if (attempts.at(-1)!.correct) finalCorrect += 1;
    retryCount += attempts.length - 1;

    const errors = attempts.filter((attempt) => !attempt.correct);
    if (errors.length > 0) {
      if (firstPass[0]!.correct) inconsistent();
      errorCards.push({
        cardId: firstPass[0]!.cardId,
        answerText: firstPass[0]!.answerText,
        firstCorrect: false,
        totalErrorCount: errors.length,
        correctionAttempts: attempts.length - 1,
        lastErrorAt: errors.at(-1)!.occurredAt,
      });
    }
  }

  const playbackCounts = new Map<string, number>();
  for (const playback of input.playbackFacts) {
    const key = factKey(playback);
    if (!memberships.has(key)) inconsistent();
    playbackCounts.set(key, (playbackCounts.get(key) ?? 0) + 1);
  }
  let manualReplayCount = 0;
  for (const key of memberships) {
    const count = playbackCounts.get(key) ?? 0;
    if (count < 1) inconsistent();
    manualReplayCount += count - 1;
  }

  const correctionRounds = new Set(
    input.roundMemberships
      .map((membership) => membership.round)
      .filter((round) => round > 1),
  ).size;
  errorCards.sort((left, right) => left.cardId.localeCompare(right.cardId));

  return {
    itemCount: itemIds.size,
    firstPassAccuracy: firstPassCorrect / itemIds.size,
    finalCompletionRate: finalCorrect / itemIds.size,
    retryCount,
    correctionRounds,
    manualReplayCount,
    errorCards,
  };
}

export function calculateScheduledRetention(
  events: Array<{ eventType: ReportReviewEventType; correct: boolean }>,
) {
  const scheduled = events.filter((event) => event.eventType === "scheduled_first");
  const correct = scheduled.filter((event) => event.correct).length;
  return {
    completed: scheduled.length,
    correct,
    accuracy: scheduled.length === 0 ? null : correct / scheduled.length,
  };
}

function reportNotFound(): never {
  throw new Error("REPORT_NOT_FOUND");
}

export function createSessionReportService(database?: ReportDatabase) {
  async function getSessionReport(
    actor: GuardianActor,
    rawSessionId: string,
  ): Promise<SessionReport> {
    const parsed = z.string().uuid().safeParse(rawSessionId);
    if (!parsed.success) reportNotFound();
    const sessionId = parsed.data;
    const client = database ?? (await import("@/db/client")).db;

    const [base] = await client
      .select({
        sessionId: dictationSessions.id,
        childId: dictationSessions.childId,
        taskId: dictationSessions.taskId,
        sessionStatus: dictationSessions.status,
        sessionCompletedAt: dictationSessions.completedAt,
        taskStatus: learningTasks.status,
        taskCompletedAt: learningTasks.completedAt,
        completedAt: dictationCompletionEvents.completedAt,
      })
      .from(dictationSessions)
      .innerJoin(
        learningTasks,
        and(
          eq(learningTasks.id, dictationSessions.taskId),
          eq(learningTasks.familyId, dictationSessions.familyId),
          eq(learningTasks.childId, dictationSessions.childId),
        ),
      )
      .innerJoin(
        dictationCompletionEvents,
        and(
          eq(dictationCompletionEvents.familyId, dictationSessions.familyId),
          eq(dictationCompletionEvents.childId, dictationSessions.childId),
          eq(dictationCompletionEvents.sessionId, dictationSessions.id),
          eq(dictationCompletionEvents.taskId, dictationSessions.taskId),
        ),
      )
      .where(and(
        eq(dictationSessions.id, sessionId),
        eq(dictationSessions.familyId, actor.familyId),
      ))
      .limit(1);
    if (!base) reportNotFound();
    if (
      base.sessionStatus !== "completed" ||
      base.taskStatus !== "completed" ||
      !base.sessionCompletedAt ||
      !base.taskCompletedAt ||
      base.sessionCompletedAt.getTime() !== base.completedAt.getTime() ||
      base.taskCompletedAt.getTime() !== base.completedAt.getTime()
    ) inconsistent();

    const items = await client
        .select({
          itemId: dictationSessionItems.taskItemId,
          cardId: dictationSessionItems.cardId,
          firstCorrect: dictationSessionItems.firstCorrect,
          finalCorrect: dictationSessionItems.finalCorrect,
        })
        .from(dictationSessionItems)
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
        .innerJoin(
          learningCards,
          and(
            eq(learningCards.id, dictationSessionItems.cardId),
            or(eq(learningCards.familyId, actor.familyId), isNull(learningCards.familyId)),
          ),
        )
        .where(and(
          eq(dictationSessionItems.familyId, actor.familyId),
          eq(dictationSessionItems.childId, base.childId),
          eq(dictationSessionItems.sessionId, sessionId),
          eq(dictationSessionItems.taskId, base.taskId),
        ));
    const attempts = await client
        .select({
          itemId: dictationAnswerEvents.taskItemId,
          cardId: dictationSessionItems.cardId,
          answerText: learningCards.answerText,
          round: dictationAnswerEvents.roundNumber,
          correct: dictationAnswerEvents.correct,
          eventRole: dictationAnswerEvents.eventRole,
          occurredAt: dictationAnswerEvents.answeredAt,
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
          learningTaskItems,
          and(
            eq(learningTaskItems.familyId, dictationSessionItems.familyId),
            eq(learningTaskItems.childId, dictationSessionItems.childId),
            eq(learningTaskItems.taskId, dictationSessionItems.taskId),
            eq(learningTaskItems.id, dictationSessionItems.taskItemId),
            eq(learningTaskItems.cardId, dictationSessionItems.cardId),
          ),
        )
        .innerJoin(
          learningCards,
          and(
            eq(learningCards.id, learningTaskItems.cardId),
            or(eq(learningCards.familyId, actor.familyId), isNull(learningCards.familyId)),
          ),
        )
        .where(and(
          eq(dictationAnswerEvents.familyId, actor.familyId),
          eq(dictationAnswerEvents.childId, base.childId),
          eq(dictationAnswerEvents.sessionId, sessionId),
          eq(dictationSessionItems.taskId, base.taskId),
        ))
        .orderBy(asc(dictationAnswerEvents.answeredAt), asc(dictationAnswerEvents.id));
    const roundMemberships = await client
        .select({
          itemId: dictationRoundItems.taskItemId,
          round: dictationRoundItems.roundNumber,
        })
        .from(dictationRoundItems)
        .innerJoin(
          dictationSessionItems,
          and(
            eq(dictationSessionItems.familyId, dictationRoundItems.familyId),
            eq(dictationSessionItems.childId, dictationRoundItems.childId),
            eq(dictationSessionItems.sessionId, dictationRoundItems.sessionId),
            eq(dictationSessionItems.taskItemId, dictationRoundItems.taskItemId),
          ),
        )
        .where(and(
          eq(dictationRoundItems.familyId, actor.familyId),
          eq(dictationRoundItems.childId, base.childId),
          eq(dictationRoundItems.sessionId, sessionId),
          eq(dictationSessionItems.taskId, base.taskId),
        ));
    const playbackFacts = await client
        .select({
          itemId: dictationPlaybackEvents.taskItemId,
          round: dictationPlaybackEvents.roundNumber,
        })
        .from(dictationPlaybackEvents)
        .innerJoin(
          dictationRoundItems,
          and(
            eq(dictationRoundItems.familyId, dictationPlaybackEvents.familyId),
            eq(dictationRoundItems.childId, dictationPlaybackEvents.childId),
            eq(dictationRoundItems.sessionId, dictationPlaybackEvents.sessionId),
            eq(dictationRoundItems.roundNumber, dictationPlaybackEvents.roundNumber),
            eq(dictationRoundItems.taskItemId, dictationPlaybackEvents.taskItemId),
          ),
        )
        .where(and(
          eq(dictationPlaybackEvents.familyId, actor.familyId),
          eq(dictationPlaybackEvents.childId, base.childId),
          eq(dictationPlaybackEvents.sessionId, sessionId),
        ));

    const parsedAttempts: SessionAttemptFact[] = attempts.map((attempt) => ({
      ...attempt,
      eventRole: z.enum([
        "first_pass",
        "continued_error",
        "same_session_relearning",
      ]).parse(attempt.eventRole),
    }));
    const metrics = calculateSessionMetrics({
      itemIds: items.map((item) => item.itemId),
      attempts: parsedAttempts,
      roundMemberships,
      playbackFacts,
    });
    const firstByItem = new Map(
      parsedAttempts
        .filter((attempt) => attempt.eventRole === "first_pass")
        .map((attempt) => [attempt.itemId, attempt.correct]),
    );
    const finalByItem = new Map<string, boolean>();
    for (const attempt of parsedAttempts) finalByItem.set(attempt.itemId, attempt.correct);
    if (
      metrics.finalCompletionRate !== 1 ||
      items.some((item) =>
        item.firstCorrect !== firstByItem.get(item.itemId) ||
        item.finalCorrect !== finalByItem.get(item.itemId))
    ) inconsistent();

    return {
      sessionId,
      childId: base.childId,
      taskId: base.taskId,
      ...metrics,
      completedAt: base.completedAt,
      selfGraded: true,
    };
  }

  return { getSessionReport };
}

const sessionReportService = createSessionReportService();
export const getSessionReport = sessionReportService.getSessionReport;
