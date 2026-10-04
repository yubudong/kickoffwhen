import { expect, test } from "vitest";

import {
  createTaskSubmissionController,
  readTaskCreationResponse,
} from "@/modules/dictation/task-submission";

test("响应丢失后重试复用同一 commandId，只有确认成功才轮换", async () => {
  const ids = [
    "018f3b5d-1111-7111-8111-111111111111",
    "018f3b5d-2222-7222-8222-222222222222",
  ];
  const controller = createTaskSubmissionController(() => ids.shift()!);
  const used: string[] = [];

  const lost = await controller.submit(async (commandId) => {
    used.push(commandId);
    throw new Error("RESPONSE_LOST");
  });
  expect(lost.status).toBe("failed");

  const retried = await controller.submit(async (commandId) => {
    used.push(commandId);
    return "created";
  });
  expect(retried).toEqual({ status: "succeeded", value: "created" });
  expect(used).toEqual([
    "018f3b5d-1111-7111-8111-111111111111",
    "018f3b5d-1111-7111-8111-111111111111",
  ]);
  expect(controller.getCommandId()).toBe("018f3b5d-2222-7222-8222-222222222222");
});

test("快速双击被同步锁拦住，只发出一个请求", async () => {
  const controller = createTaskSubmissionController(
    () => "018f3b5d-3333-7333-8333-333333333333",
  );
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;

  const first = controller.submit(async () => {
    calls += 1;
    await blocked;
    return "ok";
  });
  const second = await controller.submit(async () => {
    calls += 1;
    return "duplicate";
  });

  expect(second).toEqual({ status: "busy" });
  expect(calls).toBe(1);
  release();
  await first;
});

test("201 的坏 JSON 或坏 task 不轮换 commandId，只有严格合法响应才轮换", async () => {
  const ids = [
    "018f3b5d-4444-7444-8444-444444444444",
    "018f3b5d-5555-7555-8555-555555555555",
  ];
  const controller = createTaskSubmissionController(() => ids.shift()!);
  const attemptedIds: string[] = [];
  const invalidResponses = [
    new Response("{", { status: 201, headers: { "Content-Type": "application/json" } }),
    Response.json({}, { status: 201 }),
    Response.json({ task: { id: "not-a-uuid" } }, { status: 201 }),
  ];

  for (const response of invalidResponses) {
    const result = await controller.submit(async (commandId) => {
      attemptedIds.push(commandId);
      return readTaskCreationResponse(response);
    });
    expect(result.status).toBe("failed");
    expect(controller.getCommandId()).toBe("018f3b5d-4444-7444-8444-444444444444");
  }

  const succeeded = await controller.submit(async (commandId) => {
    attemptedIds.push(commandId);
    return readTaskCreationResponse(Response.json({
      task: {
        id: "018f3b5d-6666-7666-8666-666666666666",
        childId: "018f3b5d-7777-7777-8777-777777777777",
        mode: "continuous_batch",
        order: "source",
        intervalSeconds: 8,
        repeatCount: 1,
        speechRate: 1,
        allowManualReplay: true,
        maxReviewCards: 20,
        audioStatus: "preparing",
        items: [{
          cardId: "018f3b5d-8888-7888-8888-888888888888",
          kind: "new",
          position: 0,
          ttsDedupeKey: "tts:valid",
          audioStatus: "queued",
          mediaId: null,
        }],
      },
    }, { status: 201 }));
  });

  expect(succeeded.status).toBe("succeeded");
  expect(attemptedIds).toEqual([
    "018f3b5d-4444-7444-8444-444444444444",
    "018f3b5d-4444-7444-8444-444444444444",
    "018f3b5d-4444-7444-8444-444444444444",
    "018f3b5d-4444-7444-8444-444444444444",
  ]);
  expect(controller.getCommandId()).toBe("018f3b5d-5555-7555-8555-555555555555");
});
