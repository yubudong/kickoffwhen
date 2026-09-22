import { expect, test } from "vitest";

import { createPrivateMediaGetHandler } from "@/app/api/private-media/[mediaId]/route";

const actor = {
  role: "guardian" as const,
  familyId: "018f3b5d-1111-7111-8111-111111111111",
  guardianId: "018f3b5d-2222-7222-8222-222222222222",
};
const mediaId = "018f3b5d-3333-7333-8333-333333333333";

test("私密媒体路由等待动态params并以no-store流返回", async () => {
  const handler = createPrivateMediaGetHandler({
    resolveActor: async () => actor,
    openMedia: async (receivedActor, receivedMediaId) => {
      if (receivedActor.familyId !== actor.familyId || receivedMediaId !== mediaId) {
        throw new Error("WRONG_MEDIA_SCOPE");
      }
      return {
        id: mediaId,
        familyId: actor.familyId,
        childId: null,
        kind: "ocr_source" as const,
        expiresAt: null,
        mimeType: "image/png" as const,
        byteSize: 3,
        sha256: "a".repeat(64),
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            controller.close();
          },
        }),
      };
    },
  });

  const response = await handler(
    new Request(`http://example.test/api/private-media/${mediaId}`),
    { params: Promise.resolve({ mediaId }) },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(
    new Uint8Array([1, 2, 3]),
  );
});

test("媒体不存在或越权统一返回404且不暴露家庭信息", async () => {
  const handler = createPrivateMediaGetHandler({
    resolveActor: async () => actor,
    openMedia: async () => {
      throw new Error("MEDIA_NOT_FOUND");
    },
  });

  const response = await handler(
    new Request(`http://example.test/api/private-media/${mediaId}`),
    { params: Promise.resolve({ mediaId }) },
  );
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "MEDIA_NOT_FOUND" });
});
