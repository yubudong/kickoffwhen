import { describe, expect, test } from "vitest";

import { validateReportAttemptFact } from "@/modules/reports/attempt-facts";
import {
  calculateSessionMetrics,
  calculateScheduledRetention,
} from "@/modules/reports/session-report";
import {
  rankWeakCards,
  shanghaiWeekFromMonday,
} from "@/modules/reports/weekly-report";

describe("session report metrics", () => {
  test("首轮正确率、最终完成率和连续错误各自保留", () => {
    const result = calculateSessionMetrics({
      itemIds: ["a", "b"],
      attempts: [
        {
          itemId: "a",
          cardId: "card-a",
          answerText: "sun",
          round: 1,
          correct: true,
          eventRole: "first_pass",
          occurredAt: new Date("2026-09-01T08:00:00.000Z"),
        },
        {
          itemId: "b",
          cardId: "card-b",
          answerText: "moon",
          round: 1,
          correct: false,
          eventRole: "first_pass",
          occurredAt: new Date("2026-09-01T08:01:00.000Z"),
        },
        {
          itemId: "b",
          cardId: "card-b",
          answerText: "moon",
          round: 2,
          correct: false,
          eventRole: "continued_error",
          occurredAt: new Date("2026-09-01T08:02:00.000Z"),
        },
        {
          itemId: "b",
          cardId: "card-b",
          answerText: "moon",
          round: 3,
          correct: true,
          eventRole: "same_session_relearning",
          occurredAt: new Date("2026-09-01T08:03:00.000Z"),
        },
      ],
      roundMemberships: [
        { itemId: "a", round: 1 },
        { itemId: "b", round: 1 },
        { itemId: "b", round: 2 },
        { itemId: "b", round: 3 },
      ],
      playbackFacts: [
        { itemId: "a", round: 1 },
        { itemId: "b", round: 1 },
        { itemId: "b", round: 1 },
        { itemId: "b", round: 2 },
        { itemId: "b", round: 3 },
      ],
    });

    expect(result).toMatchObject({
      itemCount: 2,
      firstPassAccuracy: 0.5,
      finalCompletionRate: 1,
      retryCount: 2,
      correctionRounds: 2,
      manualReplayCount: 1,
    });
    expect(result.errorCards).toEqual([
      {
        cardId: "card-b",
        answerText: "moon",
        firstCorrect: false,
        totalErrorCount: 2,
        correctionAttempts: 2,
        lastErrorAt: new Date("2026-09-01T08:02:00.000Z"),
      },
    ]);
  });

  test("任务 repeatCount 不会凭空增加手动重听，缺失必需播放则失败关闭", () => {
    expect(calculateSessionMetrics({
      itemIds: ["a"],
      attempts: [{
        itemId: "a",
        cardId: "card-a",
        answerText: "sun",
        round: 1,
        correct: true,
        eventRole: "first_pass",
        occurredAt: new Date("2026-09-01T08:00:00.000Z"),
      }],
      roundMemberships: [{ itemId: "a", round: 1 }],
      playbackFacts: [{ itemId: "a", round: 1 }],
    }).manualReplayCount).toBe(0);

    expect(() => calculateSessionMetrics({
      itemIds: ["a"],
      attempts: [{
        itemId: "a",
        cardId: "card-a",
        answerText: "sun",
        round: 1,
        correct: true,
        eventRole: "first_pass",
        occurredAt: new Date("2026-09-01T08:00:00.000Z"),
      }],
      roundMemberships: [{ itemId: "a", round: 1 }],
      playbackFacts: [],
    })).toThrow("REPORT_INCONSISTENT");
  });

  test("重复首轮事实和不属于会话的题目都失败关闭", () => {
    const first = {
      itemId: "a",
      cardId: "card-a",
      answerText: "sun",
      round: 1,
      correct: true,
      eventRole: "first_pass" as const,
      occurredAt: new Date("2026-09-01T08:00:00.000Z"),
    };
    expect(() => calculateSessionMetrics({
      itemIds: ["a"],
      attempts: [first, { ...first, occurredAt: new Date("2026-09-01T08:01:00.000Z") }],
      roundMemberships: [{ itemId: "a", round: 1 }],
      playbackFacts: [{ itemId: "a", round: 1 }],
    })).toThrow("REPORT_INCONSISTENT");
    expect(() => calculateSessionMetrics({
      itemIds: ["a"],
      attempts: [{ ...first, itemId: "foreign" }],
      roundMemberships: [{ itemId: "a", round: 1 }],
      playbackFacts: [{ itemId: "a", round: 1 }],
    })).toThrow("REPORT_INCONSISTENT");
  });

  test("每个轮次成员必须恰有一条按 Task 4 顺序形成的答题事实", () => {
    const first = {
      itemId: "a",
      cardId: "card-a",
      answerText: "sun",
      round: 1,
      correct: false,
      eventRole: "first_pass" as const,
      occurredAt: new Date("2026-09-01T08:00:00.000Z"),
    };
    const continued = {
      ...first,
      round: 2,
      eventRole: "continued_error" as const,
      occurredAt: new Date("2026-09-01T08:01:00.000Z"),
    };
    const corrected = {
      ...first,
      round: 3,
      correct: true,
      eventRole: "same_session_relearning" as const,
      occurredAt: new Date("2026-09-01T08:02:00.000Z"),
    };
    const memberships = [
      { itemId: "a", round: 1 },
      { itemId: "a", round: 2 },
      { itemId: "a", round: 3 },
    ];
    const playbackFacts = [...memberships];

    expect(() => calculateSessionMetrics({
      itemIds: ["a"],
      attempts: [first, corrected],
      roundMemberships: memberships,
      playbackFacts,
    })).toThrow("REPORT_INCONSISTENT");
    expect(() => calculateSessionMetrics({
      itemIds: ["a"],
      attempts: [first, continued, { ...continued }],
      roundMemberships: memberships.slice(0, 2),
      playbackFacts: playbackFacts.slice(0, 2),
    })).toThrow("REPORT_INCONSISTENT");
    expect(() => calculateSessionMetrics({
      itemIds: ["a"],
      attempts: [{ ...first, eventRole: "continued_error" }],
      roundMemberships: memberships.slice(0, 1),
      playbackFacts: playbackFacts.slice(0, 1),
    })).toThrow("REPORT_INCONSISTENT");
    expect(() => calculateSessionMetrics({
      itemIds: ["a"],
      attempts: [first, { ...corrected, round: 2, eventRole: "first_pass" }],
      roundMemberships: memberships.slice(0, 2),
      playbackFacts: playbackFacts.slice(0, 2),
    })).toThrow("REPORT_INCONSISTENT");
    expect(() => calculateSessionMetrics({
      itemIds: ["a"],
      attempts: [first, { ...corrected, round: 2, occurredAt: first.occurredAt }],
      roundMemberships: memberships.slice(0, 2),
      playbackFacts: playbackFacts.slice(0, 2),
    })).toThrow("REPORT_INCONSISTENT");
  });

  test("到期保持只统计 scheduled_first，同场订正不算独立成功", () => {
    expect(calculateScheduledRetention([
      { eventType: "scheduled_first", correct: true },
      { eventType: "scheduled_first", correct: false },
      { eventType: "same_session_relearning", correct: true },
      { eventType: "new_first", correct: true },
    ])).toEqual({ completed: 2, correct: 1, accuracy: 0.5 });
    expect(calculateScheduledRetention([])).toEqual({
      completed: 0,
      correct: 0,
      accuracy: null,
    });
  });
});

describe("report attempt facts", () => {
  const firstPass = {
    round: 1,
    correct: false,
    eventRole: "first_pass" as const,
    occurredAt: new Date("2026-09-01T08:00:00.000Z"),
    taskItemKind: "due_review" as const,
    sessionItemKind: "due_review" as const,
    answerReviewEventId: "review-first",
    firstReviewEventId: "review-first",
    reviewEventType: "scheduled_first" as const,
    reviewEventCorrect: false,
    reviewEventReviewedAt: new Date("2026-09-01T08:00:00.000Z"),
    reviewEventSourceId: null,
  };

  test("answer 必须与自己的 review event 事实及任务来源完全一致", () => {
    expect(validateReportAttemptFact(firstPass)).toEqual({
      eventRole: "first_pass",
      eventType: "scheduled_first",
    });

    const mismatches = [
      { reviewEventCorrect: true },
      { reviewEventReviewedAt: new Date("2026-09-01T08:00:00.001Z") },
      { taskItemKind: "new", reviewEventType: "scheduled_first" },
      { sessionItemKind: "new" },
      { firstReviewEventId: "another-review" },
      { reviewEventSourceId: "unexpected-source" },
    ] as const;
    for (const mismatch of mismatches) {
      expect(() => validateReportAttemptFact({ ...firstPass, ...mismatch }))
        .toThrow("REPORT_INCONSISTENT");
    }
  });

  test("continued_error 不得伪装成正确或产生 review event，订正必须指向首轮来源", () => {
    const continued = {
      ...firstPass,
      round: 2,
      eventRole: "continued_error" as const,
      answerReviewEventId: null,
      reviewEventType: null,
      reviewEventCorrect: null,
      reviewEventReviewedAt: null,
      reviewEventSourceId: null,
    };
    expect(validateReportAttemptFact(continued)).toEqual({
      eventRole: "continued_error",
      eventType: null,
    });
    expect(() => validateReportAttemptFact({ ...continued, correct: true }))
      .toThrow("REPORT_INCONSISTENT");

    const corrected = {
      ...firstPass,
      round: 2,
      correct: true,
      eventRole: "same_session_relearning" as const,
      occurredAt: new Date("2026-09-01T08:01:00.000Z"),
      answerReviewEventId: "review-correction",
      reviewEventType: "same_session_relearning" as const,
      reviewEventCorrect: true,
      reviewEventReviewedAt: new Date("2026-09-01T08:01:00.000Z"),
      reviewEventSourceId: "review-first",
    };
    expect(validateReportAttemptFact(corrected)).toEqual({
      eventRole: "same_session_relearning",
      eventType: "same_session_relearning",
    });
    expect(() => validateReportAttemptFact({
      ...corrected,
      reviewEventSourceId: "another-review",
    })).toThrow("REPORT_INCONSISTENT");
  });
});

describe("weekly report metrics", () => {
  test("上海周界以周一零点开始，周日深夜和周一零点不混淆", () => {
    const week = shanghaiWeekFromMonday("2026-09-07");
    expect(week.start.toISOString()).toBe("2026-09-06T16:00:00.000Z");
    expect(week.end.toISOString()).toBe("2026-09-13T16:00:00.000Z");
    expect(week.days).toEqual([
      "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10",
      "2026-09-11", "2026-09-12", "2026-09-13",
    ]);
    expect(() => shanghaiWeekFromMonday("2026-09-06")).toThrow("REPORT_WEEK_INVALID");
    expect(() => shanghaiWeekFromMonday("2026-02-30")).toThrow("REPORT_WEEK_INVALID");
  });

  test("薄弱词只按首轮错误排序，同分时最近错误优先再按 cardId，最多 10 个", () => {
    const facts: Array<{
      cardId: string;
      answerText: string;
      correct: boolean;
      eventRole: "first_pass" | "continued_error" | "same_session_relearning";
      occurredAt: Date;
    }> = Array.from({ length: 12 }, (_, index) => ({
      cardId: `card-${String(index).padStart(2, "0")}`,
      answerText: `word-${index}`,
      correct: false,
      eventRole: "first_pass" as const,
      occurredAt: new Date(`2026-09-0${index % 2 + 1}T08:00:00.000Z`),
    }));
    facts.push({
      cardId: "card-05",
      answerText: "word-5",
      correct: false,
      eventRole: "first_pass",
      occurredAt: new Date("2026-09-03T08:00:00.000Z"),
    });
    facts.push({
      cardId: "card-05",
      answerText: "word-5",
      correct: false,
      eventRole: "continued_error",
      occurredAt: new Date("2026-09-04T08:00:00.000Z"),
    });

    const ranked = rankWeakCards(facts);
    expect(ranked).toHaveLength(10);
    expect(ranked[0]).toMatchObject({ cardId: "card-05", errorCount: 2 });
    expect(ranked.every((card) => card.cardId !== "card-10")).toBe(true);
    expect(ranked.find((card) => card.cardId === "card-05")?.errorCount).toBe(2);
  });
});
