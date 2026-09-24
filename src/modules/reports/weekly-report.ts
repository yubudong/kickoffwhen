import { and, asc, eq, gte, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";

import type { DbTransaction } from "@/db/client";
import type { GuardianActor } from "@/modules/auth/actor";
import {
  dictationAnswerEvents,
  dictationCompletionEvents,
  dictationSessionItems,
  dictationSessions,
} from "@/modules/dictation/session-schema";
import { learningTaskItems, learningTasks } from "@/modules/dictation/task-schema";
import { children } from "@/modules/families/schema";
import { learningCards } from "@/modules/learning-content/schema";
import { reviewEvents } from "@/modules/review/db-schema";

import { validateReportAttemptFact } from "./attempt-facts";
import { calculateScheduledRetention } from "./session-report";
import type {
  ReportAttemptRole,
  ReportReviewEventType,
  WeakCard,
  WeeklyReport,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
type ReportDatabase = typeof import("@/db/client").db | DbTransaction;

function calendarDateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("REPORT_WEEK_INVALID");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) throw new Error("REPORT_WEEK_INVALID");
  return { utc, year, month, day };
}

function formatUtcCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function shanghaiWeekFromMonday(value: string): {
  start: Date;
  end: Date;
  days: string[];
} {
  const { utc } = calendarDateParts(value);
  if (utc.getUTCDay() !== 1) throw new Error("REPORT_WEEK_INVALID");
  const start = new Date(utc.getTime() - SHANGHAI_OFFSET_MS);
  return {
    start,
    end: new Date(start.getTime() + 7 * DAY_MS),
    days: Array.from({ length: 7 }, (_, index) =>
      formatUtcCalendarDate(new Date(utc.getTime() + index * DAY_MS))),
  };
}

export function shanghaiDate(at: Date): string {
  return new Date(at.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function shanghaiDayBounds(at: Date): {
  date: string;
  start: Date;
  end: Date;
  tomorrowStart: Date;
  tomorrowEnd: Date;
} {
  const date = shanghaiDate(at);
  const { utc } = calendarDateParts(date);
  const start = new Date(utc.getTime() - SHANGHAI_OFFSET_MS);
  return {
    date,
    start,
    end: new Date(start.getTime() + DAY_MS),
    tomorrowStart: new Date(start.getTime() + DAY_MS),
    tomorrowEnd: new Date(start.getTime() + 2 * DAY_MS),
  };
}

export function mondayForShanghaiDate(at: Date): string {
  const shifted = new Date(at.getTime() + SHANGHAI_OFFSET_MS);
  const weekday = shifted.getUTCDay() || 7;
  const monday = new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() - weekday + 1,
  ));
  return formatUtcCalendarDate(monday);
}

export function rankWeakCards(
  facts: Array<{
    cardId: string;
    answerText: string;
    correct: boolean;
    eventRole: ReportAttemptRole;
    occurredAt: Date;
  }>,
  limit = 10,
): WeakCard[] {
  const grouped = new Map<string, WeakCard>();
  for (const fact of facts) {
    if (fact.eventRole !== "first_pass" || fact.correct) continue;
    const current = grouped.get(fact.cardId);
    grouped.set(fact.cardId, {
      cardId: fact.cardId,
      answerText: fact.answerText,
      errorCount: (current?.errorCount ?? 0) + 1,
      latestErrorAt:
        !current || fact.occurredAt > current.latestErrorAt
          ? fact.occurredAt
          : current.latestErrorAt,
    });
  }
  return [...grouped.values()]
    .sort((left, right) =>
      right.errorCount - left.errorCount ||
      right.latestErrorAt.getTime() - left.latestErrorAt.getTime() ||
      left.cardId.localeCompare(right.cardId),
    )
    .slice(0, Math.max(0, limit));
}

function notFound(): never {
  throw new Error("REPORT_NOT_FOUND");
}

function inconsistent(): never {
  throw new Error("REPORT_INCONSISTENT");
}

export function createWeeklyReportService(database?: ReportDatabase) {
  async function getWeeklyReport(
    actor: GuardianActor,
    rawChildId: string,
    rawWeekStart: Date,
  ): Promise<WeeklyReport> {
    const childId = z.string().uuid().safeParse(rawChildId);
    if (!childId.success || !(rawWeekStart instanceof Date) || Number.isNaN(rawWeekStart.getTime())) {
      notFound();
    }
    const calendar = shanghaiWeekFromMonday(shanghaiDate(rawWeekStart));
    if (calendar.start.getTime() !== rawWeekStart.getTime()) {
      throw new Error("REPORT_WEEK_INVALID");
    }
    const client = database ?? (await import("@/db/client")).db;
    const [child] = await client
      .select({ id: children.id })
      .from(children)
      .where(and(
        eq(children.familyId, actor.familyId),
        eq(children.id, childId.data),
      ))
      .limit(1);
    if (!child) notFound();

    const completionRows = await client
        .select({
          sessionId: dictationCompletionEvents.sessionId,
          taskId: dictationCompletionEvents.taskId,
          completedAt: dictationCompletionEvents.completedAt,
          sessionStatus: dictationSessions.status,
          sessionCompletedAt: dictationSessions.completedAt,
          taskStatus: learningTasks.status,
          taskCompletedAt: learningTasks.completedAt,
        })
        .from(dictationCompletionEvents)
        .innerJoin(
          dictationSessions,
          and(
            eq(dictationSessions.familyId, dictationCompletionEvents.familyId),
            eq(dictationSessions.childId, dictationCompletionEvents.childId),
            eq(dictationSessions.id, dictationCompletionEvents.sessionId),
            eq(dictationSessions.taskId, dictationCompletionEvents.taskId),
          ),
        )
        .innerJoin(
          learningTasks,
          and(
            eq(learningTasks.familyId, dictationCompletionEvents.familyId),
            eq(learningTasks.childId, dictationCompletionEvents.childId),
            eq(learningTasks.id, dictationCompletionEvents.taskId),
          ),
        )
        .where(and(
          eq(dictationCompletionEvents.familyId, actor.familyId),
          eq(dictationCompletionEvents.childId, childId.data),
          gte(dictationCompletionEvents.completedAt, calendar.start),
          lt(dictationCompletionEvents.completedAt, calendar.end),
        ))
        .orderBy(asc(dictationCompletionEvents.completedAt), asc(dictationCompletionEvents.id));
    const completionItemRows = await client
      .select({
        sessionId: dictationSessionItems.sessionId,
        itemId: dictationSessionItems.taskItemId,
      })
      .from(dictationSessionItems)
      .innerJoin(
        dictationCompletionEvents,
        and(
          eq(dictationCompletionEvents.familyId, dictationSessionItems.familyId),
          eq(dictationCompletionEvents.childId, dictationSessionItems.childId),
          eq(dictationCompletionEvents.sessionId, dictationSessionItems.sessionId),
          eq(dictationCompletionEvents.taskId, dictationSessionItems.taskId),
        ),
      )
      .where(and(
        eq(dictationSessionItems.familyId, actor.familyId),
        eq(dictationSessionItems.childId, childId.data),
        gte(dictationCompletionEvents.completedAt, calendar.start),
        lt(dictationCompletionEvents.completedAt, calendar.end),
      ));
    const answerRows = await client
        .select({
          sessionId: dictationAnswerEvents.sessionId,
          completedAt: dictationCompletionEvents.completedAt,
          itemId: dictationAnswerEvents.taskItemId,
          round: dictationAnswerEvents.roundNumber,
          cardId: dictationSessionItems.cardId,
          answerText: learningCards.answerText,
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
          occurredAt: dictationAnswerEvents.answeredAt,
        })
        .from(dictationAnswerEvents)
        .innerJoin(
          dictationCompletionEvents,
          and(
            eq(dictationCompletionEvents.familyId, dictationAnswerEvents.familyId),
            eq(dictationCompletionEvents.childId, dictationAnswerEvents.childId),
            eq(dictationCompletionEvents.sessionId, dictationAnswerEvents.sessionId),
          ),
        )
        .innerJoin(
          dictationSessions,
          and(
            eq(dictationSessions.familyId, dictationCompletionEvents.familyId),
            eq(dictationSessions.childId, dictationCompletionEvents.childId),
            eq(dictationSessions.id, dictationCompletionEvents.sessionId),
            eq(dictationSessions.taskId, dictationCompletionEvents.taskId),
          ),
        )
        .innerJoin(
          dictationSessionItems,
          and(
            eq(dictationSessionItems.familyId, dictationAnswerEvents.familyId),
            eq(dictationSessionItems.childId, dictationAnswerEvents.childId),
            eq(dictationSessionItems.sessionId, dictationAnswerEvents.sessionId),
            eq(dictationSessionItems.taskItemId, dictationAnswerEvents.taskItemId),
            eq(dictationSessionItems.taskId, dictationSessions.taskId),
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
        .leftJoin(
          reviewEvents,
          and(
            eq(reviewEvents.id, dictationAnswerEvents.reviewEventId),
            eq(reviewEvents.familyId, dictationAnswerEvents.familyId),
            eq(reviewEvents.childId, dictationAnswerEvents.childId),
            eq(reviewEvents.cardId, learningTaskItems.cardId),
          ),
        )
        .where(and(
          eq(dictationAnswerEvents.familyId, actor.familyId),
          eq(dictationAnswerEvents.childId, childId.data),
          gte(dictationCompletionEvents.completedAt, calendar.start),
          lt(dictationCompletionEvents.completedAt, calendar.end),
        ))
        .orderBy(asc(dictationAnswerEvents.answeredAt), asc(dictationAnswerEvents.id));

    for (const completion of completionRows) {
      if (
        completion.sessionStatus !== "completed" ||
        completion.taskStatus !== "completed" ||
        !completion.sessionCompletedAt ||
        !completion.taskCompletedAt ||
        completion.sessionCompletedAt.getTime() !== completion.completedAt.getTime() ||
        completion.taskCompletedAt.getTime() !== completion.completedAt.getTime()
      ) inconsistent();
    }
    const completionIds = new Set(completionRows.map((row) => row.sessionId));
    if (completionIds.size !== completionRows.length) inconsistent();
    const completionItemKeys = new Set(
      completionItemRows.map((row) => `${row.sessionId}:${row.itemId}`),
    );
    if (
      completionItemKeys.size !== completionItemRows.length ||
      completionRows.some((completion) =>
        !completionItemRows.some((item) => item.sessionId === completion.sessionId))
    ) inconsistent();

    const firstPassKeys = new Set<string>();
    const firstPassFacts: Array<{
      sessionId: string;
      completedAt: Date;
      cardId: string;
      answerText: string;
      correct: boolean;
      eventRole: "first_pass";
      eventType: Exclude<ReportReviewEventType, "same_session_relearning">;
      occurredAt: Date;
    }> = [];
    for (const row of answerRows) {
      if (!completionIds.has(row.sessionId)) inconsistent();
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
      if (validated.eventRole === "first_pass") {
        const key = `${row.sessionId}:${row.itemId}`;
        if (firstPassKeys.has(key)) inconsistent();
        firstPassKeys.add(key);
        firstPassFacts.push({
          ...row,
          eventRole: validated.eventRole,
          eventType: validated.eventType,
        });
      }
    }
    if (completionRows.some((completion) =>
      !firstPassFacts.some((fact) => fact.sessionId === completion.sessionId))) {
      inconsistent();
    }
    if (
      firstPassKeys.size !== completionItemKeys.size ||
      [...completionItemKeys].some((key) => !firstPassKeys.has(key))
    ) inconsistent();

    const firstCorrect = firstPassFacts.filter((fact) => fact.correct).length;
    const retention = calculateScheduledRetention(firstPassFacts);
    const completedByDay = new Map<string, number>();
    for (const completion of completionRows) {
      const date = shanghaiDate(completion.completedAt);
      completedByDay.set(date, (completedByDay.get(date) ?? 0) + 1);
    }
    const trend = calendar.days.map((date) => {
      const daily = firstPassFacts.filter(
        (fact) => shanghaiDate(fact.completedAt) === date,
      );
      return {
        date,
        completedTasks: completedByDay.get(date) ?? 0,
        firstPassAccuracy: daily.length === 0
          ? null
          : daily.filter((fact) => fact.correct).length / daily.length,
      };
    });

    return {
      childId: childId.data,
      weekStart: calendar.start,
      weekEnd: calendar.end,
      studyDays: completedByDay.size,
      completedTasks: completionRows.length,
      firstPassAccuracy:
        firstPassFacts.length === 0 ? null : firstCorrect / firstPassFacts.length,
      dailyTrend: trend,
      dueReviewsCompleted: retention.completed,
      dueReviewAccuracy: retention.accuracy,
      weakCards: rankWeakCards(firstPassFacts),
      habitCompletion: {
        available: false,
        message: "习惯统计将在下一阶段开启",
      },
    };
  }

  return { getWeeklyReport };
}

const weeklyReportService = createWeeklyReportService();
export const getWeeklyReport = weeklyReportService.getWeeklyReport;
