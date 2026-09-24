import { expect, test, vi } from "vitest";

import { createParentWeeklyReportGetHandler } from "@/app/api/parent/reports/weekly/route";

const actor = {
  role: "guardian" as const,
  familyRole: "owner" as const,
  familyId: "018f3b5d-1111-7111-8111-111111111111",
  guardianId: "018f3b5d-2222-7222-8222-222222222222",
};
const childId = "018f3b5d-3333-7333-8333-333333333333";

test("周报 API 严格拒绝 familyId、多余参数、非周一和无效孩子", async () => {
  const getWeeklyReport = vi.fn();
  const handler = createParentWeeklyReportGetHandler({
    resolveAccess: async () => ({ actor }),
    getWeeklyReport,
  });
  for (const query of [
    `childId=${childId}&weekStart=2026-09-07&familyId=${crypto.randomUUID()}`,
    `childId=${childId}&weekStart=2026-09-07&extra=1`,
    `childId=${childId}&weekStart=2026-09-06`,
    "childId=bad&weekStart=2026-09-07",
  ]) {
    const response = await handler(new Request(`http://example.test/api/parent/reports/weekly?${query}`));
    expect(response.status).toBe(400);
  }
  expect(getWeeklyReport).not.toHaveBeenCalled();
});

test("周报 API 只传递验证 actor 并将 Date 序列化为 ISO", async () => {
  const getWeeklyReport = vi.fn(async () => ({
    childId,
    weekStart: new Date("2026-09-06T16:00:00.000Z"),
    weekEnd: new Date("2026-09-13T16:00:00.000Z"),
    studyDays: 1,
    completedTasks: 1,
    firstPassAccuracy: 0.5,
    dailyTrend: [
      { date: "2026-09-07", completedTasks: 1, firstPassAccuracy: 0.5 },
      { date: "2026-09-08", completedTasks: 0, firstPassAccuracy: null },
      { date: "2026-09-09", completedTasks: 0, firstPassAccuracy: null },
      { date: "2026-09-10", completedTasks: 0, firstPassAccuracy: null },
      { date: "2026-09-11", completedTasks: 0, firstPassAccuracy: null },
      { date: "2026-09-12", completedTasks: 0, firstPassAccuracy: null },
      { date: "2026-09-13", completedTasks: 0, firstPassAccuracy: null },
    ],
    dueReviewsCompleted: 1,
    dueReviewAccuracy: 0,
    weakCards: [{
      cardId: "018f3b5d-4444-7444-8444-444444444444",
      answerText: "moon",
      errorCount: 1,
      latestErrorAt: new Date("2026-09-07T01:00:00.000Z"),
    }],
    habitCompletion: { available: false as const, message: "下一阶段开启" },
  }));
  const handler = createParentWeeklyReportGetHandler({
    resolveAccess: async () => ({ actor }),
    getWeeklyReport,
  });
  const response = await handler(new Request(
    `http://example.test/api/parent/reports/weekly?childId=${childId}&weekStart=2026-09-07`,
  ));
  expect(response.status).toBe(200);
  expect(getWeeklyReport).toHaveBeenCalledWith(
    actor,
    childId,
    new Date("2026-09-06T16:00:00.000Z"),
  );
  expect(await response.json()).toMatchObject({
    report: {
      weekStart: "2026-09-06T16:00:00.000Z",
      weekEnd: "2026-09-13T16:00:00.000Z",
      weakCards: [{ latestErrorAt: "2026-09-07T01:00:00.000Z" }],
    },
  });
});

test("家庭设置或家长 PIN 门禁未通过时不查报告", async () => {
  const getWeeklyReport = vi.fn();
  const handler = createParentWeeklyReportGetHandler({
    resolveAccess: async () => ({
      response: Response.json({ error: "FAMILY_SETUP_REQUIRED" }, { status: 428 }),
    }),
    getWeeklyReport,
  });
  const response = await handler(new Request(
    `http://example.test/api/parent/reports/weekly?childId=${childId}&weekStart=2026-09-07`,
  ));
  expect(response.status).toBe(428);
  expect(getWeeklyReport).not.toHaveBeenCalled();
});

test("跨家庭或缺失报告统一返回 404", async () => {
  const handler = createParentWeeklyReportGetHandler({
    resolveAccess: async () => ({ actor }),
    getWeeklyReport: async () => {
      throw new Error("REPORT_NOT_FOUND");
    },
  });
  const response = await handler(new Request(
    `http://example.test/api/parent/reports/weekly?childId=${childId}&weekStart=2026-09-07`,
  ));
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "REPORT_NOT_FOUND" });
});
