import { expect, test } from "vitest";

import {
  createOcrConfirmHandler,
  createOcrGetHandler,
  createOcrPostHandler,
} from "@/app/api/parent/content/ocr/route";

const actor = {
  role: "guardian" as const,
  familyRole: "owner" as const,
  familyId: "018f3b5d-1111-7111-8111-111111111111",
  guardianId: "018f3b5d-2222-7222-8222-222222222222",
};

function uploadRequest(file: File, subject = "chinese") {
  const form = new FormData();
  form.set("subject", subject);
  form.set("image", file);
  return new Request("http://example.test/api/parent/content/ocr", {
    method: "POST",
    body: form,
  });
}

test("OCR上传在家庭PIN未完成时失败关闭", async () => {
  const handler = createOcrPostHandler({
    requestHeaders: async () => new Headers(),
    requireActor: async () => actor,
    getSetupStage: async () => "pin",
    createUpload: async () => {
      throw new Error("UPLOAD_MUST_NOT_START");
    },
  });

  const response = await handler(
    uploadRequest(new File([new Uint8Array([0x89, 0x50])], "page.png", { type: "image/png" })),
  );
  expect(response.status).toBe(428);
  expect(await response.json()).toEqual({ error: "PARENT_PIN_REQUIRED" });
});

test("OCR上传拒绝非图片MIME和超过10MiB的文件", async () => {
  const handler = createOcrPostHandler({
    requestHeaders: async () => new Headers(),
    requireActor: async () => actor,
    getSetupStage: async () => "complete",
    createUpload: async () => {
      throw new Error("UPLOAD_MUST_NOT_START");
    },
  });

  const wrongMime = await handler(
    uploadRequest(new File(["secret text"], "page.txt", { type: "text/plain" })),
  );
  const tooLarge = await handler(
    uploadRequest(
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], "huge.png", {
        type: "image/png",
      }),
    ),
  );
  expect(wrongMime.status).toBe(415);
  expect(tooLarge.status).toBe(413);
});

test("合法图片以私密字节创建OCR草稿任务而不调用真实Vision", async () => {
  const handler = createOcrPostHandler({
    requestHeaders: async () => new Headers(),
    requireActor: async () => actor,
    getSetupStage: async () => "complete",
    createUpload: async (receivedActor, input) => {
      if (receivedActor.familyId !== actor.familyId) throw new Error("WRONG_ACTOR");
      if (
        input.mimeType !== "image/jpeg" ||
        input.subject !== "english" ||
        !input.bytes.every((value, index) => value === [0xff, 0xd8, 0xff][index])
      ) {
        throw new Error("WRONG_PRIVATE_BYTES");
      }
      return {
        draftId: "018f3b5d-3333-7333-8333-333333333333",
        jobId: "018f3b5d-4444-7444-8444-444444444444",
      };
    },
  });

  const response = await handler(
    uploadRequest(
      new File([new Uint8Array([0xff, 0xd8, 0xff])], "private.jpg", {
        type: "image/jpeg",
      }),
      "english",
    ),
  );
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({
    draftId: "018f3b5d-3333-7333-8333-333333333333",
    jobId: "018f3b5d-4444-7444-8444-444444444444",
    status: "queued",
  });
});

test("OCR provider 未配置时诚实拒绝上传而不创建永久排队任务", async () => {
  const handler = createOcrPostHandler({
    requestHeaders: async () => new Headers(),
    requireActor: async () => actor,
    getSetupStage: async () => "complete",
    providerStatus: "disabled",
    createUpload: async () => {
      throw new Error("UPLOAD_MUST_NOT_START");
    },
  });

  const response = await handler(
    uploadRequest(new File([new Uint8Array([0x89, 0x50])], "page.png", { type: "image/png" })),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "OCR_PROVIDER_DISABLED" });
});

test("草稿状态只使用通过家长权限校验的 actor 和完整标识", async () => {
  const draftId = "018f3b5d-3333-7333-8333-333333333333";
  const jobId = "018f3b5d-4444-7444-8444-844444444444";
  const handler = createOcrGetHandler({
    requestHeaders: async () => new Headers(),
    requireActor: async () => actor,
    getSetupStage: async () => "complete",
    providerStatus: "mock",
    getDraft: async (receivedActor, input) => {
      expect(receivedActor).toBe(actor);
      expect(input).toEqual({ draftId, jobId, providerStatus: "mock" });
      return {
        draftId,
        subject: "english" as const,
        status: "ready" as const,
        lines: [
          {
            id: "018f3b5d-5555-7555-8555-555555555555",
            sourceText: "mountain",
            sourceOrder: 0,
            status: "draft" as const,
          },
        ],
      };
    },
  });

  const response = await handler(
    new Request(`http://example.test/api/parent/content/ocr?draftId=${draftId}&jobId=${jobId}`),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "ready" });
});

test("家长确认接口传入逐项选择与编辑文本", async () => {
  const draftId = "018f3b5d-3333-7333-8333-333333333333";
  const selectedLineId = "018f3b5d-5555-7555-8555-555555555555";
  const rejectedLineId = "018f3b5d-6666-7666-8666-666666666666";
  const handler = createOcrConfirmHandler({
    requestHeaders: async () => new Headers(),
    requireActor: async () => actor,
    getSetupStage: async () => "complete",
    confirmDraft: async (receivedActor, receivedDraftId, cards, decidedLineIds) => {
      expect(receivedActor).toBe(actor);
      expect(receivedDraftId).toBe(draftId);
      expect(cards).toEqual([
        {
          lineId: selectedLineId,
          answerText: "mountain",
          broadcastText: "mountain edited",
          hintText: "unit 1",
        },
      ]);
      expect(decidedLineIds).toEqual([selectedLineId, rejectedLineId]);
      return [{ id: "018f3b5d-7777-7777-8777-777777777777" }];
    },
  });

  const response = await handler(
    new Request("http://example.test/api/parent/content/ocr", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draftId,
        lines: [
          {
            lineId: selectedLineId,
            selected: true,
            answerText: "mountain",
            broadcastText: "mountain edited",
            hintText: "unit 1",
          },
          { lineId: rejectedLineId, selected: false },
        ],
      }),
    }),
  );
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({
    cards: [{ id: "018f3b5d-7777-7777-8777-777777777777" }],
    rejectedLineIds: [rejectedLineId],
  });
});
