import { expect, test, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/modules/auth/parent-access", () => ({ requireParentActor: vi.fn() }));
vi.mock("@/modules/families/service", () => ({ getFamilySetupStage: vi.fn() }));

import { createParentTaskBatchPostHandler } from "@/app/api/parent/task-batches/route";

test("未登录不能批量布置，非法小节 ID 不会创建任务", async () => {
  const input = {
    childId: crypto.randomUUID(), subject: "chinese", sectionIds: ["not-a-uuid"], extraCardIds: [],
    commandId: crypto.randomUUID(), mode: "continuous_batch", order: "source", intervalSeconds: 8,
    repeatCount: 1, speechRate: 1, allowManualReplay: true,
  };
  const unauthorized = createParentTaskBatchPostHandler({
    resolveAccess: async () => ({ response: Response.json({ error: "UNAUTHORIZED" }, { status: 401 }) }),
    buildTaskBatch: async () => { throw new Error("unexpected write"); },
  });
  expect((await unauthorized(new Request("http://localhost/api/parent/task-batches", {
    method: "POST", body: JSON.stringify(input),
  }))).status).toBe(401);

  const invalid = createParentTaskBatchPostHandler({
    resolveAccess: async () => ({ actor: { role: "guardian", familyRole: "owner", familyId: crypto.randomUUID(), guardianId: crypto.randomUUID() } }),
    buildTaskBatch: async () => { throw new Error("unexpected write"); },
  });
  expect((await invalid(new Request("http://localhost/api/parent/task-batches", {
    method: "POST", body: JSON.stringify(input),
  }))).status).toBe(400);
});
