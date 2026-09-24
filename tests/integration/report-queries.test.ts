import { and, eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";

import { user as authUsers } from "@/modules/auth/schema";
import {
  dictationAnswerEvents,
  dictationCompletionEvents,
  dictationPlaybackEvents,
  dictationRoundItems,
  dictationRounds,
  dictationSessionItems,
  dictationSessions,
} from "@/modules/dictation/session-schema";
import { learningTaskItems, learningTasks } from "@/modules/dictation/task-schema";
import { children, families, guardians } from "@/modules/families/schema";
import { learningCards } from "@/modules/learning-content/schema";
import { createCardHistoryService } from "@/modules/reports/card-history";
import { createReportDashboardService } from "@/modules/reports/dashboard";
import { createSessionReportService } from "@/modules/reports/session-report";
import { createWeeklyReportService } from "@/modules/reports/weekly-report";
import { childCardStates, reviewEvents } from "@/modules/review/db-schema";

import { withDatabaseRollback } from "../helpers/database";

type TestTx = Parameters<Parameters<typeof withDatabaseRollback>[0]>[0];

async function makeFamily(tx: TestTx, label: string) {
  const suffix = crypto.randomUUID();
  const authUserId = `reports-${label}-${suffix}`;
  await tx.insert(authUsers).values({
    id: authUserId,
    email: `${authUserId}@example.test`,
    name: `报告家长-${label}`,
  });
  const [family] = await tx.insert(families).values({ name: `报告家庭-${label}` }).returning();
  const [guardian] = await tx.insert(guardians).values({
    familyId: family.id,
    authUserId,
  }).returning();
  const [child, sibling] = await tx.insert(children).values([
    { familyId: family.id, nickname: `孩子-${label}`, grade: 5 },
    { familyId: family.id, nickname: `手足-${label}`, grade: 5 },
  ]).returning();
  return {
    family,
    guardian,
    child,
    sibling,
    actor: {
      role: "guardian" as const,
      familyRole: "owner" as const,
      familyId: family.id,
      guardianId: guardian.id,
    },
  };
}

async function insertCompletedSession(
  tx: TestTx,
  family: Awaited<ReturnType<typeof makeFamily>>,
  input: {
    completedAt: Date;
    label: string;
    builtinCard?: typeof learningCards.$inferSelect;
    customAnswerCorrect?: boolean;
  },
) {
  const [customCard] = await tx.insert(learningCards).values({
    familyId: family.family.id,
    subject: "english",
    answerText: `weak-${input.label}`,
    broadcastText: `weak-${input.label}`,
    source: "manual",
  }).returning();
  const builtinCard = input.builtinCard ?? (await tx.insert(learningCards).values({
    familyId: null,
    subject: "english",
    answerText: `builtin-${input.label}`,
    broadcastText: `builtin-${input.label}`,
    source: "builtin",
    builtinKey: `reports:${input.label}:${crypto.randomUUID()}`,
  }).returning())[0]!;
  const taskCreatedAt = new Date(input.completedAt.getTime() - 60_000);
  const [task] = await tx.insert(learningTasks).values({
    familyId: family.family.id,
    childId: family.child.id,
    guardianId: family.guardian.id,
    commandId: crypto.randomUUID(),
    inputFingerprint: "a".repeat(64),
    mode: "continuous_batch",
    taskOrder: "source",
    intervalSeconds: 8,
    repeatCount: 3,
    speechRate: "1",
    allowManualReplay: true,
    maxReviewCards: 1,
    status: "completed",
    createdAt: taskCreatedAt,
    completedAt: input.completedAt,
  }).returning();
  const items = await tx.insert(learningTaskItems).values([
    {
      taskId: task.id,
      familyId: family.family.id,
      childId: family.child.id,
      cardId: customCard.id,
      cardFamilyId: family.family.id,
      kind: "new",
      position: 0,
      ttsDedupeKey: `report:${crypto.randomUUID()}`,
      createdAt: taskCreatedAt,
    },
    {
      taskId: task.id,
      familyId: family.family.id,
      childId: family.child.id,
      cardId: builtinCard.id,
      cardFamilyId: null,
      kind: "due_review",
      position: 1,
      ttsDedupeKey: `report:${crypto.randomUUID()}`,
      createdAt: taskCreatedAt,
    },
  ]).returning();
  const [session] = await tx.insert(dictationSessions).values({
    familyId: family.family.id,
    childId: family.child.id,
    taskId: task.id,
    mode: "continuous_batch",
    status: "completed",
    phase: "completed",
    version: 8,
    roundNumber: 3,
    currentRoundItemIds: [items[0]!.id],
    playedItemIds: [items[0]!.id],
    markedItemIds: [items[0]!.id],
    firstPassMarks: { [items[0]!.id]: false, [items[1]!.id]: true },
    latestMarks: { [items[0]!.id]: true, [items[1]!.id]: true },
    createdAt: taskCreatedAt,
    updatedAt: input.completedAt,
    completedAt: input.completedAt,
  }).returning();

  const firstAt = new Date(input.completedAt.getTime() - 30_000);
  const continuedAt = new Date(input.completedAt.getTime() - 20_000);
  const correctedAt = new Date(input.completedAt.getTime() - 10_000);
  const dueAt = new Date(input.completedAt.getTime() + 86_400_000);
  const [customFirst, builtinFirst] = await tx.insert(reviewEvents).values([
    {
      familyId: family.family.id,
      childId: family.child.id,
      cardId: customCard.id,
      eventType: "new_first",
      correct: false,
      fsrsRating: 1,
      reviewedAt: firstAt,
      dueAt,
      cardJson: { due: dueAt.toISOString() },
      commandId: crypto.randomUUID(),
      inputFingerprint: "b".repeat(64),
    },
    {
      familyId: family.family.id,
      childId: family.child.id,
      cardId: builtinCard.id,
      eventType: "scheduled_first",
      correct: true,
      fsrsRating: 3,
      reviewedAt: new Date(firstAt.getTime() + 1),
      dueAt,
      cardJson: { due: dueAt.toISOString() },
      commandId: crypto.randomUUID(),
      inputFingerprint: "c".repeat(64),
    },
  ]).returning();
  const [correction] = await tx.insert(reviewEvents).values({
    familyId: family.family.id,
    childId: family.child.id,
    cardId: customCard.id,
    eventType: "same_session_relearning",
    correct: true,
    fsrsRating: 3,
    reviewedAt: correctedAt,
    dueAt,
    cardJson: { due: dueAt.toISOString() },
    sourceReviewEventId: customFirst.id,
    commandId: crypto.randomUUID(),
    inputFingerprint: "d".repeat(64),
  }).returning();
  await tx.insert(childCardStates).values([
    {
      familyId: family.family.id,
      childId: family.child.id,
      cardId: customCard.id,
      cardJson: { due: dueAt.toISOString() },
      dueAt,
      createdAt: firstAt,
      updatedAt: correctedAt,
    },
    {
      familyId: family.family.id,
      childId: family.child.id,
      cardId: builtinCard.id,
      cardJson: { due: dueAt.toISOString() },
      dueAt,
      createdAt: firstAt,
      updatedAt: new Date(firstAt.getTime() + 1),
    },
  ]);
  await tx.insert(dictationSessionItems).values([
    {
      familyId: family.family.id,
      childId: family.child.id,
      sessionId: session.id,
      taskItemId: items[0]!.id,
      taskId: task.id,
      cardId: customCard.id,
      kind: "new",
      position: 0,
      firstCorrect: false,
      finalCorrect: true,
      replayCount: 4,
      firstReviewEventId: customFirst.id,
    },
    {
      familyId: family.family.id,
      childId: family.child.id,
      sessionId: session.id,
      taskItemId: items[1]!.id,
      taskId: task.id,
      cardId: builtinCard.id,
      kind: "due_review",
      position: 1,
      firstCorrect: true,
      finalCorrect: true,
      replayCount: 1,
      firstReviewEventId: builtinFirst.id,
    },
  ]);
  await tx.insert(dictationRounds).values([
    {
      familyId: family.family.id,
      childId: family.child.id,
      sessionId: session.id,
      roundNumber: 1,
      itemIds: items.map((item) => item.id),
      createdAt: taskCreatedAt,
      completedAt: new Date(firstAt.getTime() + 2),
    },
    {
      familyId: family.family.id,
      childId: family.child.id,
      sessionId: session.id,
      roundNumber: 2,
      itemIds: [items[0]!.id],
      createdAt: new Date(firstAt.getTime() + 3),
      completedAt: new Date(continuedAt.getTime() + 1),
    },
    {
      familyId: family.family.id,
      childId: family.child.id,
      sessionId: session.id,
      roundNumber: 3,
      itemIds: [items[0]!.id],
      createdAt: new Date(continuedAt.getTime() + 2),
      completedAt: input.completedAt,
    },
  ]);
  await tx.insert(dictationRoundItems).values([
    { familyId: family.family.id, childId: family.child.id, sessionId: session.id, roundNumber: 1, taskItemId: items[0]!.id, position: 0 },
    { familyId: family.family.id, childId: family.child.id, sessionId: session.id, roundNumber: 1, taskItemId: items[1]!.id, position: 1 },
    { familyId: family.family.id, childId: family.child.id, sessionId: session.id, roundNumber: 2, taskItemId: items[0]!.id, position: 0 },
    { familyId: family.family.id, childId: family.child.id, sessionId: session.id, roundNumber: 3, taskItemId: items[0]!.id, position: 0 },
  ]);
  await tx.insert(dictationPlaybackEvents).values([
    { familyId: family.family.id, childId: family.child.id, sessionId: session.id, commandId: crypto.randomUUID(), roundNumber: 1, taskItemId: items[0]!.id, playedAt: new Date(firstAt.getTime() - 5) },
    { familyId: family.family.id, childId: family.child.id, sessionId: session.id, commandId: crypto.randomUUID(), roundNumber: 1, taskItemId: items[0]!.id, playedAt: new Date(firstAt.getTime() - 4) },
    { familyId: family.family.id, childId: family.child.id, sessionId: session.id, commandId: crypto.randomUUID(), roundNumber: 1, taskItemId: items[1]!.id, playedAt: new Date(firstAt.getTime() - 3) },
    { familyId: family.family.id, childId: family.child.id, sessionId: session.id, commandId: crypto.randomUUID(), roundNumber: 2, taskItemId: items[0]!.id, playedAt: new Date(continuedAt.getTime() - 1) },
    { familyId: family.family.id, childId: family.child.id, sessionId: session.id, commandId: crypto.randomUUID(), roundNumber: 3, taskItemId: items[0]!.id, playedAt: new Date(correctedAt.getTime() - 1) },
  ]);
  await tx.insert(dictationAnswerEvents).values([
    { familyId: family.family.id, childId: family.child.id, sessionId: session.id, commandId: crypto.randomUUID(), roundNumber: 1, taskItemId: items[0]!.id, correct: input.customAnswerCorrect ?? false, eventRole: "first_pass", reviewEventId: customFirst.id, replayCount: 2, answeredAt: firstAt },
    { familyId: family.family.id, childId: family.child.id, sessionId: session.id, commandId: crypto.randomUUID(), roundNumber: 1, taskItemId: items[1]!.id, correct: true, eventRole: "first_pass", reviewEventId: builtinFirst.id, replayCount: 1, answeredAt: new Date(firstAt.getTime() + 1) },
    { familyId: family.family.id, childId: family.child.id, sessionId: session.id, commandId: crypto.randomUUID(), roundNumber: 2, taskItemId: items[0]!.id, correct: false, eventRole: "continued_error", reviewEventId: null, replayCount: 3, answeredAt: continuedAt },
    { familyId: family.family.id, childId: family.child.id, sessionId: session.id, commandId: crypto.randomUUID(), roundNumber: 3, taskItemId: items[0]!.id, correct: true, eventRole: "same_session_relearning", reviewEventId: correction.id, replayCount: 4, answeredAt: correctedAt },
  ]);
  await tx.insert(dictationCompletionEvents).values({
    familyId: family.family.id,
    childId: family.child.id,
    taskId: task.id,
    sessionId: session.id,
    completedAt: input.completedAt,
  });

  return { task, items, session, customCard, builtinCard, dueAt };
}

describe("report queries", () => {
  test("单次报告从不可变事实计算并严格隔离家庭", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await makeFamily(tx, "session-a");
      const other = await makeFamily(tx, "session-b");
      const fixture = await insertCompletedSession(tx, family, {
        label: "session",
        completedAt: new Date("2026-09-08T03:00:00.000Z"),
      });
      const service = createSessionReportService(tx);

      const report = await service.getSessionReport(family.actor, fixture.session.id);
      expect(report).toMatchObject({
        sessionId: fixture.session.id,
        childId: family.child.id,
        itemCount: 2,
        firstPassAccuracy: 0.5,
        finalCompletionRate: 1,
        retryCount: 2,
        correctionRounds: 2,
        manualReplayCount: 1,
        completedAt: new Date("2026-09-08T03:00:00.000Z"),
        selfGraded: true,
      });
      expect(report.errorCards[0]).toMatchObject({
        answerText: "weak-session",
        totalErrorCount: 2,
      });
      await expect(service.getSessionReport(other.actor, fixture.session.id))
        .rejects.toThrow("REPORT_NOT_FOUND");
    });
  });

  test("缺失完成事件的会话不会被报告伪造为已完成", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await makeFamily(tx, "missing-completion");
      const fixture = await insertCompletedSession(tx, family, {
        label: "missing-completion",
        completedAt: new Date("2026-09-08T03:00:00.000Z"),
      });
      await tx.delete(dictationCompletionEvents)
        .where(eq(dictationCompletionEvents.sessionId, fixture.session.id));

      await expect(createSessionReportService(tx).getSessionReport(
        family.actor,
        fixture.session.id,
      )).rejects.toThrow("REPORT_NOT_FOUND");
    });
  });

  test("完成会话缺失中间轮答题事实时报告失败关闭", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await makeFamily(tx, "missing-answer");
      const fixture = await insertCompletedSession(tx, family, {
        label: "missing-answer",
        completedAt: new Date("2026-09-08T03:00:00.000Z"),
      });
      await tx.delete(dictationAnswerEvents).where(and(
        eq(dictationAnswerEvents.sessionId, fixture.session.id),
        eq(dictationAnswerEvents.roundNumber, 2),
      ));

      await expect(createSessionReportService(tx).getSessionReport(
        family.actor,
        fixture.session.id,
      )).rejects.toThrow("REPORT_INCONSISTENT");
    });
  });

  test("周报只统计上海周界内的完成事件，首轮薄弱和到期保持不被订正膨胀", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await makeFamily(tx, "weekly");
      await insertCompletedSession(tx, family, {
        label: "sunday-outside",
        completedAt: new Date("2026-09-06T15:59:59.999Z"),
      });
      const monday = await insertCompletedSession(tx, family, {
        label: "monday",
        completedAt: new Date("2026-09-06T16:00:00.000Z"),
      });
      await insertCompletedSession(tx, family, {
        label: "tuesday",
        completedAt: new Date("2026-09-08T04:00:00.000Z"),
      });
      const incomplete = await insertCompletedSession(tx, family, {
        label: "no-event",
        completedAt: new Date("2026-09-09T04:00:00.000Z"),
      });
      await tx.delete(dictationCompletionEvents)
        .where(eq(dictationCompletionEvents.sessionId, incomplete.session.id));

      const report = await createWeeklyReportService(tx).getWeeklyReport(
        family.actor,
        family.child.id,
        new Date("2026-09-06T16:00:00.000Z"),
      );
      expect(report).toMatchObject({
        childId: family.child.id,
        studyDays: 2,
        completedTasks: 2,
        firstPassAccuracy: 0.5,
        dueReviewsCompleted: 2,
        dueReviewAccuracy: 1,
        habitCompletion: { available: false },
      });
      expect(report.dailyTrend).toHaveLength(7);
      expect(report.dailyTrend[0]).toMatchObject({
        date: "2026-09-07",
        completedTasks: 1,
        firstPassAccuracy: 0.5,
      });
      expect(report.weakCards).toHaveLength(2);
      expect(report.weakCards.every((card) => card.errorCount === 1)).toBe(true);
      expect(report.weakCards.map((card) => card.cardId)).toContain(monday.customCard.id);

      await expect(createWeeklyReportService(tx).getWeeklyReport(
        family.actor,
        family.sibling.id,
        new Date("2026-09-06T16:00:00.000Z"),
      )).resolves.toMatchObject({ completedTasks: 0, firstPassAccuracy: null });
    });
  });

  test("周报和卡片历史遇到 answer/review 正确性错配时失败关闭", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await makeFamily(tx, "report-review-mismatch");
      const fixture = await insertCompletedSession(tx, family, {
        label: "report-review-mismatch",
        completedAt: new Date("2026-09-08T03:00:00.000Z"),
        customAnswerCorrect: true,
      });

      await expect(createWeeklyReportService(tx).getWeeklyReport(
        family.actor,
        family.child.id,
        new Date("2026-09-06T16:00:00.000Z"),
      )).rejects.toThrow("REPORT_INCONSISTENT");
      await expect(createCardHistoryService(tx).getCardHistory(
        family.actor,
        family.child.id,
        fixture.customCard.id,
      )).rejects.toThrow("REPORT_INCONSISTENT");
    });
  });

  test("卡片历史支持家庭卡和内置卡，continued_error 保留错误但不伪装保持成功", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await makeFamily(tx, "card");
      const other = await makeFamily(tx, "card-other");
      const fixture = await insertCompletedSession(tx, family, {
        label: "card",
        completedAt: new Date("2026-09-08T03:00:00.000Z"),
      });
      const service = createCardHistoryService(tx);

      const history = await service.getCardHistory(
        family.actor,
        family.child.id,
        fixture.customCard.id,
      );
      expect(history).toMatchObject({
        answerText: "weak-card",
        nextDueAt: fixture.dueAt,
        recentErrorAt: new Date("2026-09-08T02:59:40.000Z"),
        attemptLimit: 100,
      });
      expect(history.attempts.map((attempt) => ({
        correct: attempt.correct,
        eventRole: attempt.eventRole,
        eventType: attempt.eventType,
        retention: attempt.scheduledRetentionResult,
      }))).toEqual([
        { correct: false, eventRole: "first_pass", eventType: "new_first", retention: null },
        { correct: false, eventRole: "continued_error", eventType: null, retention: null },
        { correct: true, eventRole: "same_session_relearning", eventType: "same_session_relearning", retention: null },
      ]);

      const builtin = await service.getCardHistory(
        family.actor,
        family.child.id,
        fixture.builtinCard.id,
      );
      expect(builtin.answerText).toBe("builtin-card");
      expect(builtin.attempts[0]).toMatchObject({
        eventType: "scheduled_first",
        scheduledRetentionResult: true,
      });
      await expect(service.getCardHistory(family.actor, family.sibling.id, fixture.customCard.id))
        .rejects.toThrow("REPORT_NOT_FOUND");
      await expect(service.getCardHistory(other.actor, family.child.id, fixture.customCard.id))
        .rejects.toThrow("REPORT_NOT_FOUND");
    });
  });

  test("家长概览一次返回各孩子今日状态、薄弱词和明日到期量", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await makeFamily(tx, "dashboard");
      const completed = await insertCompletedSession(tx, family, {
        label: "dashboard",
        completedAt: new Date("2026-09-08T03:00:00.000Z"),
      });
      await tx.insert(learningTasks).values({
        familyId: family.family.id,
        childId: family.sibling.id,
        guardianId: family.guardian.id,
        commandId: crypto.randomUUID(),
        inputFingerprint: "e".repeat(64),
        mode: "continuous_batch",
        taskOrder: "source",
        intervalSeconds: 8,
        repeatCount: 1,
        speechRate: "1",
        allowManualReplay: true,
        maxReviewCards: 0,
        status: "active",
        createdAt: new Date("2026-09-08T02:00:00.000Z"),
      });
      await tx.insert(learningTasks).values({
        familyId: family.family.id,
        childId: family.child.id,
        guardianId: family.guardian.id,
        commandId: crypto.randomUUID(),
        inputFingerprint: "f".repeat(64),
        mode: "continuous_batch",
        taskOrder: "source",
        intervalSeconds: 8,
        repeatCount: 1,
        speechRate: "1",
        allowManualReplay: true,
        maxReviewCards: 0,
        status: "active",
        createdAt: new Date("2026-09-08T03:30:00.000Z"),
      });

      const dashboard = await createReportDashboardService(tx).getReportDashboard(
        family.actor,
        new Date("2026-09-08T04:00:00.000Z"),
      );
      expect(dashboard).toMatchObject({
        calendar: "Asia/Shanghai",
        date: "2026-09-08",
        pendingHabits: { available: false },
        familyRewards: { available: false },
      });
      expect(dashboard.children).toHaveLength(2);
      expect(dashboard.children.find((child) => child.childId === family.child.id)).toMatchObject({
        todayTaskStatus: "in_progress",
        latestCompletedSessionId: completed.session.id,
        tomorrowDueReviewCount: 2,
        todayWeakCards: [{ cardId: completed.customCard.id, answerText: "weak-dashboard" }],
      });
      expect(dashboard.children.find((child) => child.childId === family.sibling.id)).toMatchObject({
        todayTaskStatus: "in_progress",
        tomorrowDueReviewCount: 0,
        todayWeakCards: [],
      });
    });
  });

  test("家长概览查询数不随孩子和卡片数增长", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await makeFamily(tx, "query-count");
      await tx.insert(children).values([
        { familyId: family.family.id, nickname: "第三个孩子", grade: 3 },
        { familyId: family.family.id, nickname: "第四个孩子", grade: 4 },
      ]);
      let selectCount = 0;
      const counted = new Proxy(tx, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            if (property === "select") selectCount += 1;
            return Reflect.apply(value, target, args);
          };
        },
      }) as TestTx;

      const dashboard = await createReportDashboardService(counted).getReportDashboard(
        family.actor,
        new Date("2026-09-08T04:00:00.000Z"),
      );
      expect(dashboard.children).toHaveLength(4);
      expect(selectCount).toBe(4);
    });
  });

  test("数据库拒绝会话与卡片不一致的篡改且外层报告查询不被中止", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await makeFamily(tx, "integrity");
      const fixture = await insertCompletedSession(tx, family, {
        label: "integrity",
        completedAt: new Date("2026-09-08T03:00:00.000Z"),
      });
      await expect(tx.transaction((nested) => nested.update(dictationSessionItems)
        .set({ cardId: fixture.builtinCard.id })
        .where(and(
          eq(dictationSessionItems.sessionId, fixture.session.id),
          eq(dictationSessionItems.taskItemId, fixture.items[0]!.id),
        )))).rejects.toThrow();

      await expect(createCardHistoryService(tx).getCardHistory(
        family.actor,
        family.child.id,
        fixture.customCard.id,
      )).resolves.toMatchObject({ answerText: "weak-integrity" });
    });
  });
});
