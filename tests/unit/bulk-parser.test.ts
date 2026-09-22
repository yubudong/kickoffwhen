import { expect, test } from "vitest";

import { parseBulkCards } from "@/modules/learning-content/bulk-parser";

test("按换行解析并去掉空白但保留原顺序", () => {
  expect(parseBulkCards("  山峰\n\n河流\n山峰 ", "chinese")).toEqual([
    { answerText: "山峰", broadcastText: "山峰", subject: "chinese", sourceOrder: 0 },
    { answerText: "河流", broadcastText: "河流", subject: "chinese", sourceOrder: 1 },
  ]);
});
