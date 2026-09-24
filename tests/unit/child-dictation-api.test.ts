import { expect, test, vi } from "vitest";

import { createChildSessionCommandHandler } from "@/app/api/child/dictation/[sessionId]/commands/route";
import { createChildSessionGetHandler } from "@/app/api/child/dictation/[sessionId]/route";
import { createChildTaskStartHandler } from "@/app/api/child/tasks/[taskId]/start/route";
import type { ChildSessionView } from "@/modules/dictation/child-view-types";

const actor = {
  role: "child" as const,
  familyId: "018f3b5d-1111-7111-8111-111111111111",
  childId: "018f3b5d-2222-7222-8222-222222222222",
  deviceId: "018f3b5d-3333-7333-8333-333333333333",
};
const taskId = "018f3b5d-4444-7444-8444-444444444444";
const sessionId = "018f3b5d-5555-7555-8555-555555555555";
const itemId = "018f3b5d-6666-7666-8666-666666666666";
const mediaId = "018f3b5d-7777-7777-8777-777777777777";

const listening: ChildSessionView = {
  sessionId,
  taskId,
  familyId: actor.familyId,
  childId: actor.childId,
  version: 0,
  phase: "listening",
  mode: "continuous_batch",
  roundNumber: 1,
  itemCount: 1,
  playedItemIds: [],
  intervalSeconds: 2,
  repeatCount: 1,
  speechRate: 1,
  allowManualReplay: true,
  items: [{ itemId, position: 0, audioUrl: `/api/private-media/${mediaId}`, pinyinText: "guì huā", contextText: "院子里的（　　）开了。" }],
};

test("开始接口严格拒绝伪造身份字段且只使用ChildActor", async () => {
  const startSession = vi.fn(async () => ({ sessionId }));
  const handler = createChildTaskStartHandler({
    resolveActor: async () => actor,
    startSession,
    getSession: async () => listening,
  });
  const rejected = await handler(
    new Request("http://example.test/start", {
      method: "POST",
      body: JSON.stringify({ childId: crypto.randomUUID() }),
    }),
    { params: Promise.resolve({ taskId }) },
  );
  expect(rejected.status).toBe(400);
  expect(startSession).not.toHaveBeenCalled();

  const malformedPath = await handler(
    new Request("http://example.test/start", { method: "POST", body: "{}" }),
    { params: Promise.resolve({ taskId: "not-a-task-id" }) },
  );
  expect(malformedPath.status).toBe(400);
  expect(startSession).not.toHaveBeenCalled();

  const accepted = await handler(
    new Request("http://example.test/start", { method: "POST", body: "{}" }),
    { params: Promise.resolve({ taskId }) },
  );
  expect(accepted.status).toBe(200);
  expect(startSession).toHaveBeenCalledWith(actor, taskId);
});

test("监听响应不包含任何答案文本且未授权/越权统一隐藏", async () => {
  const handler = createChildSessionGetHandler({
    resolveActor: async () => actor,
    getSession: async () => listening,
  });
  const response = await handler(new Request("http://example.test/session"), {
    params: Promise.resolve({ sessionId }),
  });
  const raw = await response.text();
  expect(response.status).toBe(200);
  expect(raw).not.toMatch(/answerText|broadcastText|secret-answer/);
  expect(raw).toContain("guì huā");
  expect(raw).toContain("院子里的（　　）开了。");

  const hidden = createChildSessionGetHandler({
    resolveActor: async () => actor,
    getSession: async () => {
      throw new Error("DICTATION_SESSION_NOT_FOUND");
    },
  });
  const missing = await hidden(new Request("http://example.test/session"), {
    params: Promise.resolve({ sessionId }),
  });
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({ error: "SESSION_NOT_FOUND" });
});

test("命令接口严格校验并在版本冲突时返回权威快照", async () => {
  const recordPlayback = vi.fn(async () => {
    throw new Error("DICTATION_VERSION_CONFLICT");
  });
  const handler = createChildSessionCommandHandler({
    resolveActor: async () => actor,
    recordPlayback,
    submitMarks: vi.fn(),
    getSession: async () => ({ ...listening, version: 1 }),
  });
  const commandId = crypto.randomUUID();
  const response = await handler(
    new Request("http://example.test/commands", {
      method: "POST",
      body: JSON.stringify({
        type: "playback",
        commandId,
        expectedVersion: 0,
        roundNumber: 1,
        playedItemIds: [itemId],
        sequenceFinished: true,
      }),
    }),
    { params: Promise.resolve({ sessionId }) },
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ error: "SESSION_CHANGED", session: { version: 1 } });
  expect(recordPlayback).toHaveBeenCalledWith(actor, expect.objectContaining({ commandId, sessionId }));

  const invalid = await handler(
    new Request("http://example.test/commands", {
      method: "POST",
      body: JSON.stringify({
        type: "grading",
        commandId,
        expectedVersion: 1,
        roundNumber: 1,
        marks: [{ itemId, correct: true }],
        answerText: "must-not-be-accepted",
      }),
    }),
    { params: Promise.resolve({ sessionId }) },
  );
  expect(invalid.status).toBe(400);
});

test("成功命令响应使用mutation返回的stored snapshot而非重新查询当前会话", async () => {
  const stored = { sessionId, taskId, version: 1, phase: "listening" as const, roundNumber: 1,
    currentRoundItemIds: [itemId], playedItemIds: [itemId], markedItemIds: [], replayCounts: { [itemId]: 1 } };
  const getSessionFromSnapshot = vi.fn(async () => ({ ...listening, version: 1, playedItemIds: [itemId] }));
  const handler = createChildSessionCommandHandler({
    resolveActor: async () => actor,
    recordPlayback: async () => stored,
    submitMarks: vi.fn(),
    getSession: vi.fn(async () => ({ ...listening, version: 9 })),
    getSessionFromSnapshot,
  });
  const response = await handler(new Request("http://example.test/commands", { method: "POST", body: JSON.stringify({
    type: "playback", commandId: crypto.randomUUID(), expectedVersion: 0, roundNumber: 1,
    playedItemIds: [itemId], sequenceFinished: false,
  }) }), { params: Promise.resolve({ sessionId }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ session: { version: 1 } });
  expect(getSessionFromSnapshot).toHaveBeenCalledWith(actor, stored);
});

test.each(["TASK_NOT_ACTIVE", "DICTATION_SESSION_NOT_ACTIVE"])(
  "%s只在权威会话已一致完成时收敛，否则fail closed",
  async (lifecycleError) => {
    const completed: ChildSessionView = {
      ...listening,
      version: 2,
      phase: "completed",
      itemCount: 0,
      items: [],
      todoSubmission: null,
    };
    const completedHandler = createChildSessionCommandHandler({
      resolveActor: async () => actor,
      recordPlayback: async () => { throw new Error(lifecycleError); },
      submitMarks: vi.fn(),
      getSession: async () => completed,
    });
    const request = () => new Request("http://example.test/commands", {
      method: "POST",
      body: JSON.stringify({
        type: "playback", commandId: crypto.randomUUID(), expectedVersion: 1, roundNumber: 1,
        playedItemIds: [itemId], sequenceFinished: true,
      }),
    });
    const completedResponse = await completedHandler(request(), {
      params: Promise.resolve({ sessionId }),
    });
    expect(completedResponse.status).toBe(409);
    expect(await completedResponse.json()).toEqual({ error: "SESSION_CHANGED", session: completed });

    const racingHandler = createChildSessionCommandHandler({
      resolveActor: async () => actor,
      recordPlayback: async () => { throw new Error(lifecycleError); },
      submitMarks: vi.fn(),
      getSession: async () => ({ ...listening, phase: "grading", items: [{ itemId, position: 0, answerText: "secret" }] }),
    });
    const racingResponse = await racingHandler(request(), {
      params: Promise.resolve({ sessionId }),
    });
    expect(racingResponse.status).toBe(404);
    expect(await racingResponse.json()).toEqual({ error: "SESSION_NOT_FOUND" });
  },
);
