import { expect, test, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/modules/auth/parent-access", () => ({ requireParentActor: vi.fn() }));
vi.mock("@/modules/families/service", () => ({ getFamilySetupStage: vi.fn() }));

import { createParentTaskPostHandler } from "@/app/api/parent/tasks/route";

const actor = {
  role: "guardian" as const,
  familyRole: "owner" as const,
  familyId: "018f3b5d-1111-7111-8111-111111111111",
  guardianId: "018f3b5d-2222-7222-8222-222222222222",
};
const validInput = {
  childId: "018f3b5d-3333-7333-8333-333333333333",
  newCardIds: [],
  commandId: "018f3b5d-4444-7444-8444-444444444444",
  maxReviewCards: 20,
  mode: "continuous_batch",
  order: "source",
  intervalSeconds: 8,
  repeatCount: 1,
  speechRate: 1,
  allowManualReplay: true,
};

test("家长任务 API 严格拒绝请求伪造 familyId", async () => {
  const buildTask = vi.fn();
  const handler = createParentTaskPostHandler({
    resolveAccess: async () => ({ actor }),
    buildTask,
  });
  const response = await handler(new Request("http://example.test/api/parent/tasks", {
    method: "POST",
    body: JSON.stringify({ ...validInput, familyId: crypto.randomUUID() }),
  }));

  expect(response.status).toBe(400);
  expect(buildTask).not.toHaveBeenCalled();
});

test("家长任务 API 只把已验证 actor 交给服务层", async () => {
  const buildTask = vi.fn(async () => ({
    id: crypto.randomUUID(),
    childId: validInput.childId,
    mode: "continuous_batch" as const,
    order: "source" as const,
    intervalSeconds: 8,
    repeatCount: 1 as const,
    speechRate: 1,
    allowManualReplay: true,
    maxReviewCards: 20,
    audioStatus: "preparing" as const,
    items: [],
  }));
  const handler = createParentTaskPostHandler({
    resolveAccess: async () => ({ actor }),
    buildTask,
  });
  const response = await handler(new Request("http://example.test/api/parent/tasks", {
    method: "POST",
    body: JSON.stringify(validInput),
  }));

  expect(response.status).toBe(201);
  expect(buildTask).toHaveBeenCalledWith(actor, validInput);
});

test("家庭设置未完成时 API 在调用服务前失败关闭", async () => {
  const buildTask = vi.fn();
  const handler = createParentTaskPostHandler({
    resolveAccess: async () => ({
      response: Response.json({ error: "FAMILY_SETUP_REQUIRED" }, { status: 428 }),
    }),
    buildTask,
  });
  const response = await handler(new Request("http://example.test/api/parent/tasks", {
    method: "POST",
    body: JSON.stringify(validInput),
  }));

  expect(response.status).toBe(428);
  expect(buildTask).not.toHaveBeenCalled();
});

test("任务API传递科目约束，并将跨科目新卡转换为400", async () => {
  const buildTask = vi.fn(async () => { throw new Error("TASK_CARD_SUBJECT_MISMATCH"); });
  const handler = createParentTaskPostHandler({ resolveAccess: async () => ({ actor }), buildTask });
  const response = await handler(new Request("http://example.test/api/parent/tasks", {
    method: "POST", body: JSON.stringify({ ...validInput, subject: "chinese" }),
  }));
  expect(buildTask).toHaveBeenCalledWith(actor, { ...validInput, subject: "chinese" });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "TASK_CARD_SUBJECT_MISMATCH" });
});
