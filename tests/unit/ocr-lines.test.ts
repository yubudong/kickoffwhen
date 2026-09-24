import { expect, test } from "vitest";

import { ocrLinesSchema } from "@/modules/learning-content/ocr-lines";

test("OCR provider 超过 500 行时不创建无法确认的草稿", () => {
  const lines = Array.from({ length: 501 }, (_, order) => ({
    text: `line-${order}`,
    confidence: 1,
    order,
  }));

  expect(ocrLinesSchema.safeParse(lines).success).toBe(false);
});
