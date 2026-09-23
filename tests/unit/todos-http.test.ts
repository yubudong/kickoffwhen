import { beforeEach, expect, test, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  updateManual: vi.fn(),
  review: vi.fn(),
}));

vi.mock("@/config/runtime", () => ({ env: { appUrl: "http://example.test" } }));
vi.mock("@/modules/auth/parent-access", () => ({
  requireParentActor: async () => ({ role: "guardian", familyId: "family", guardianId: "guardian" }),
}));
vi.mock("@/modules/devices/child-actor", () => ({ requireChildActor: vi.fn() }));
vi.mock("@/modules/todos/service", () => ({ createTodoService: () => mocked }));
vi.mock("@/modules/todos/attachments", () => ({ saveAttachment: vi.fn(), removeAttachment: vi.fn() }));

import { todosHandler } from "@/modules/todos/http";

function parentRequest(action: "update" | "review") {
  return new Request("http://example.test/api/parent/todos", {
    method: "POST",
    headers: { origin: "http://example.test", "content-type": "application/json" },
    body: JSON.stringify({ action, id: crypto.randomUUID() }),
  });
}

beforeEach(() => {
  mocked.updateManual.mockReset().mockRejectedValue(new Error("TODO_STALE"));
  mocked.review.mockReset().mockRejectedValue(new Error("TODO_STALE"));
});

test("家长旧草稿更新失败时提示刷新并重新打开编辑", async () => {
  const response = await todosHandler(parentRequest("update"), "parent");

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "任务状态已更新，请刷新清单，取消编辑后重新打开。" });
});

test("家长审核过期时保留通用刷新提示", async () => {
  const response = await todosHandler(parentRequest("review"), "parent");

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "任务状态已更新，请刷新后重试。" });
});
