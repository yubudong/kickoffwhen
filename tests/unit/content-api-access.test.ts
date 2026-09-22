import { expect, test, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  createLearningContentService: vi.fn(() => ({
    createBulkCards: vi.fn(),
    createCard: vi.fn(),
    listCards: vi.fn().mockResolvedValue([]),
  })),
  getFamilySetupStage: vi.fn(),
  requireParentActor: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/modules/auth/parent-access", () => ({
  requireParentActor: mocked.requireParentActor,
}));
vi.mock("@/modules/families/service", () => ({
  getFamilySetupStage: mocked.getFamilySetupStage,
}));
vi.mock("@/modules/learning-content/service", async () => {
  const { z } = await import("zod");
  return {
    createLearningContentService: mocked.createLearningContentService,
    createCardInputSchema: z.object({
      subject: z.enum(["chinese", "english"]),
      answerText: z.string(),
      broadcastText: z.string(),
      hintText: z.string().optional(),
      textbookEditionId: z.string().uuid().optional(),
      unitId: z.string().uuid().optional(),
      source: z.enum(["manual", "bulk", "ocr", "builtin"]),
    }),
  };
});

import { GET, POST } from "@/app/api/parent/content/route";

test("内容 API 在家长尚未设置 PIN 时同时拒绝读取和写入", async () => {
  mocked.requireParentActor.mockResolvedValue({
    role: "guardian",
    familyRole: "owner",
    familyId: crypto.randomUUID(),
    guardianId: crypto.randomUUID(),
  });
  mocked.getFamilySetupStage.mockResolvedValue("pin");

  const getResponse = await GET(new Request("http://example.test/api/parent/content"));
  const postResponse = await POST(
    new Request("http://example.test/api/parent/content", {
      body: JSON.stringify({
        mode: "single",
        subject: "chinese",
        answerText: "山峰",
        broadcastText: "山峰",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );

  if (!getResponse || !postResponse) throw new Error("content API did not respond");
  expect(getResponse.status).toBe(428);
  expect(postResponse.status).toBe(428);
});
