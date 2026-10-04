import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
  CardHistoryView,
  ReportsOverview,
  SessionReportView,
  WeeklyReportView,
} from "@/modules/reports/components";

describe("parent report views", () => {
  test("家长概览按行动优先级排列且明确标注第三阶段功能尚未开启", () => {
    const html = renderToStaticMarkup(<ReportsOverview dashboard={{
      calendar: "Asia/Shanghai",
      date: "2026-09-08",
      children: [{
        childId: "child-1",
        nickname: "小雨",
        todayTaskStatus: "completed",
        latestCompletedSessionId: "session-1",
        latestCompletedSessionWithdrawn: false,
        todayWeakCards: [{ cardId: "card-1", answerText: "moon" }],
        tomorrowDueReviewCount: 5,
      }],
      pendingHabits: { available: false, message: "习惯审核将在下一阶段开启" },
      familyRewards: { available: false, message: "家庭奖励将在下一阶段开启" },
    }} />);

    const task = html.indexOf("今日任务");
    const pending = html.indexOf("待处理事项");
    const weak = html.indexOf("今日薄弱词");
    const tomorrow = html.indexOf("明日预计复习");
    expect(task).toBeGreaterThan(-1);
    expect(task).toBeLessThan(pending);
    expect(pending).toBeLessThan(weak);
    expect(weak).toBeLessThan(tomorrow);
    expect(html).toContain("明天建议复习 5 个词");
    expect(html).toContain("今日听写已完成");
    expect(html).not.toContain("已撤回");
    expect(html).toContain("下一阶段开启");
    expect(html).not.toContain("排名");
  });

  test("概览标注最近已完成但撤回的听写，并保留历史报告入口", () => {
    const html = renderToStaticMarkup(<ReportsOverview dashboard={{
      calendar: "Asia/Shanghai",
      date: "2026-09-08",
      children: [{
        childId: "child-1",
        nickname: "小雨",
        todayTaskStatus: "completed",
        latestCompletedSessionId: "session-withdrawn",
        latestCompletedSessionWithdrawn: true,
        todayWeakCards: [],
        tomorrowDueReviewCount: 0,
      }],
      pendingHabits: { available: false, message: "习惯审核将在下一阶段开启" },
      familyRewards: { available: false, message: "家庭奖励将在下一阶段开启" },
    }} />);

    expect(html).toContain("今日听写已完成");
    expect(html).toContain("最近完成的听写任务已撤回");
    expect(html).toContain('href="/parent/reports/sessions/session-withdrawn"');
  });

  test("单次报告展示首轮、最终、订正和自主批改声明", () => {
    const html = renderToStaticMarkup(<SessionReportView report={{
      sessionId: "session-1",
      taskId: "task-1",
      childId: "child-1",
      itemCount: 2,
      firstPassAccuracy: 0.5,
      finalCompletionRate: 1,
      retryCount: 2,
      correctionRounds: 2,
      manualReplayCount: 1,
      errorCards: [{
        cardId: "card-1",
        answerText: "moon",
        firstCorrect: false,
        totalErrorCount: 2,
        correctionAttempts: 2,
        lastErrorAt: new Date("2026-09-08T02:59:40.000Z"),
      }],
      completedAt: new Date("2026-09-08T03:00:00.000Z"),
      selfGraded: true,
      withdrawn: false,
    }} />);
    expect(html).toContain("首轮正确率");
    expect(html).toContain("最终完成率");
    expect(html).toContain("订正轮数");
    expect(html).toContain("手动重听");
    expect(html).toContain("由孩子自主批改，未经机器或家长判卷");
    expect(html).not.toContain("已撤回");
  });

  test("已撤回的单次报告标注历史状态，同时保留原指标", () => {
    const html = renderToStaticMarkup(<SessionReportView report={{
      sessionId: "session-withdrawn",
      taskId: "task-withdrawn",
      childId: "child-1",
      itemCount: 2,
      firstPassAccuracy: 0.5,
      finalCompletionRate: 1,
      retryCount: 1,
      correctionRounds: 1,
      manualReplayCount: 0,
      errorCards: [],
      completedAt: new Date("2026-09-08T03:00:00.000Z"),
      selfGraded: true,
      withdrawn: true,
    }} />);

    expect(html).toContain("本次听写任务已撤回");
    expect(html).toContain("历史报告及指标保留");
    expect(html).toContain("<strong>2</strong><span>本次词数</span>");
    expect(html).toContain("<strong>50%</strong><span>首轮正确率</span>");
    expect(html).toContain("<strong>100%</strong><span>最终完成率</span>");
  });

  test("周报和卡片历史保持可执行语言，连续错误不显示为保持成功", () => {
    const weekly = renderToStaticMarkup(<WeeklyReportView report={{
      childId: "child-1",
      weekStart: new Date("2026-09-06T16:00:00.000Z"),
      weekEnd: new Date("2026-09-13T16:00:00.000Z"),
      studyDays: 2,
      completedTasks: 3,
      withdrawnCompletedTasks: 0,
      firstPassAccuracy: 0.75,
      dailyTrend: [{ date: "2026-09-07", completedTasks: 1, firstPassAccuracy: 0.5 }],
      dueReviewsCompleted: 4,
      dueReviewAccuracy: 0.75,
      weakCards: [{
        cardId: "card-1",
        answerText: "moon",
        errorCount: 2,
        latestErrorAt: new Date("2026-09-08T03:00:00.000Z"),
      }],
      habitCompletion: { available: false, message: "习惯统计将在下一阶段开启" },
    }} />);
    expect(weekly).toContain("到期复习完成 4 个");
    expect(weekly).toContain("下周优先复习 moon");
    expect(weekly).not.toContain("其中已撤回");

    const card = renderToStaticMarkup(<CardHistoryView history={{
      childId: "child-1",
      cardId: "card-1",
      answerText: "moon",
      nextDueAt: new Date("2026-09-09T03:00:00.000Z"),
      recentErrorAt: new Date("2026-09-08T02:59:40.000Z"),
      attemptLimit: 100,
      attempts: [{
        occurredAt: new Date("2026-09-08T02:59:40.000Z"),
        round: 2,
        correct: false,
        eventRole: "continued_error",
        eventType: null,
        scheduledRetentionResult: null,
      }],
    }} />);
    expect(card).toContain("本场订正仍需继续");
    expect(card).not.toContain("到期保持成功");
    expect(card).toContain("最近 100 次");
  });

  test("周报单列已撤回的完成次数，并说明已计入完成总数", () => {
    const html = renderToStaticMarkup(<WeeklyReportView report={{
      childId: "child-1",
      weekStart: new Date("2026-09-06T16:00:00.000Z"),
      weekEnd: new Date("2026-09-13T16:00:00.000Z"),
      studyDays: 2,
      completedTasks: 3,
      withdrawnCompletedTasks: 1,
      firstPassAccuracy: 0.75,
      dailyTrend: [],
      dueReviewsCompleted: 0,
      dueReviewAccuracy: null,
      weakCards: [],
      habitCompletion: { available: false, message: "习惯统计将在下一阶段开启" },
    }} />);

    expect(html).toContain("<strong>3</strong><span>完成听写</span>");
    expect(html).toContain("其中已撤回 1 次");
    expect(html).toContain("已计入完成听写总数");
  });
});
