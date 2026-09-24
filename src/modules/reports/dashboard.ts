import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";

import type { DbTransaction } from "@/db/client";
import type { GuardianActor } from "@/modules/auth/actor";
import {
  dictationAnswerEvents,
  dictationCompletionEvents,
  dictationSessionItems,
} from "@/modules/dictation/session-schema";
import { learningTaskItems, learningTasks } from "@/modules/dictation/task-schema";
import { children } from "@/modules/families/schema";
import { learningCards } from "@/modules/learning-content/schema";
import { childCardStates } from "@/modules/review/db-schema";

import type { ReportDashboard } from "./types";
import { shanghaiDayBounds } from "./weekly-report";

type ReportDatabase = typeof import("@/db/client").db | DbTransaction;

export function createReportDashboardService(database?: ReportDatabase) {
  async function getReportDashboard(
    actor: GuardianActor,
    rawAt: Date,
  ): Promise<ReportDashboard> {
    const at = z.date().parse(rawAt);
    const bounds = shanghaiDayBounds(at);
    const client = database ?? (await import("@/db/client")).db;
    const childRows = await client
      .select({ id: children.id, nickname: children.nickname })
      .from(children)
      .where(and(eq(children.familyId, actor.familyId), eq(children.active, true)))
      .orderBy(asc(children.createdAt), asc(children.id));
    if (childRows.length === 0) {
      return {
        calendar: "Asia/Shanghai",
        date: bounds.date,
        children: [],
        pendingHabits: { available: false, message: "习惯审核将在下一阶段开启" },
        familyRewards: { available: false, message: "家庭奖励将在下一阶段开启" },
      };
    }
    const childIds = childRows.map((child) => child.id);

    const taskRows = await client
      .select({
        childId: learningTasks.childId,
        status: learningTasks.status,
        completedAt: dictationCompletionEvents.completedAt,
        completedSessionId: dictationCompletionEvents.sessionId,
      })
      .from(learningTasks)
      .leftJoin(
        dictationCompletionEvents,
        and(
          eq(dictationCompletionEvents.familyId, learningTasks.familyId),
          eq(dictationCompletionEvents.childId, learningTasks.childId),
          eq(dictationCompletionEvents.taskId, learningTasks.id),
        ),
      )
      .where(and(
        eq(learningTasks.familyId, actor.familyId),
        inArray(learningTasks.childId, childIds),
        or(
          eq(learningTasks.status, "active"),
          and(
            eq(learningTasks.status, "completed"),
            isNotNull(dictationCompletionEvents.sessionId),
            gte(dictationCompletionEvents.completedAt, bounds.start),
            lt(dictationCompletionEvents.completedAt, bounds.end),
          ),
        ),
      ));
    const weakRows = await client
      .select({
        childId: dictationAnswerEvents.childId,
        cardId: learningCards.id,
        answerText: learningCards.answerText,
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
        dictationSessionItems,
        and(
          eq(dictationSessionItems.familyId, dictationAnswerEvents.familyId),
          eq(dictationSessionItems.childId, dictationAnswerEvents.childId),
          eq(dictationSessionItems.sessionId, dictationAnswerEvents.sessionId),
          eq(dictationSessionItems.taskItemId, dictationAnswerEvents.taskItemId),
          eq(dictationSessionItems.taskId, dictationCompletionEvents.taskId),
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
        inArray(dictationAnswerEvents.childId, childIds),
        eq(dictationAnswerEvents.eventRole, "first_pass"),
        eq(dictationAnswerEvents.correct, false),
        gte(dictationCompletionEvents.completedAt, bounds.start),
        lt(dictationCompletionEvents.completedAt, bounds.end),
      ))
      .orderBy(asc(dictationAnswerEvents.answeredAt), asc(dictationAnswerEvents.id));
    const dueRows = await client
      .select({ childId: childCardStates.childId, cardId: childCardStates.cardId })
      .from(childCardStates)
      .innerJoin(
        learningCards,
        and(
          eq(learningCards.id, childCardStates.cardId),
          or(eq(learningCards.familyId, actor.familyId), isNull(learningCards.familyId)),
        ),
      )
      .where(and(
        eq(childCardStates.familyId, actor.familyId),
        inArray(childCardStates.childId, childIds),
        gte(childCardStates.dueAt, bounds.tomorrowStart),
        lt(childCardStates.dueAt, bounds.tomorrowEnd),
      ));

    return {
      calendar: "Asia/Shanghai",
      date: bounds.date,
      children: childRows.map((child) => {
        const tasks = taskRows.filter((task) => task.childId === child.id);
        const completed = tasks.some(
          (task) => task.status === "completed" && task.completedSessionId,
        );
        const active = tasks.some((task) => task.status === "active");
        const seenCards = new Set<string>();
        const weakCards = weakRows
          .filter((row) => row.childId === child.id)
          .filter((row) => {
            if (seenCards.has(row.cardId)) return false;
            seenCards.add(row.cardId);
            return true;
          })
          .map(({ cardId, answerText }) => ({ cardId, answerText }));
        return {
          childId: child.id,
          nickname: child.nickname,
          todayTaskStatus: active ? "in_progress" as const : completed ? "completed" as const : "not_created" as const,
          latestCompletedSessionId: tasks
            .filter((task) => task.status === "completed" && task.completedSessionId)
            .sort((left, right) =>
              (right.completedAt?.getTime() ?? 0) - (left.completedAt?.getTime() ?? 0))
            .at(0)?.completedSessionId ?? null,
          todayWeakCards: weakCards,
          tomorrowDueReviewCount: dueRows.filter((row) => row.childId === child.id).length,
        };
      }),
      pendingHabits: { available: false, message: "习惯审核将在下一阶段开启" },
      familyRewards: { available: false, message: "家庭奖励将在下一阶段开启" },
    };
  }

  return { getReportDashboard };
}

const reportDashboardService = createReportDashboardService();
export const getReportDashboard = reportDashboardService.getReportDashboard;
