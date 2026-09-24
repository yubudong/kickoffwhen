import { describe, expect, test } from "vitest";

import {
  hasExactFixtureJobKeys,
  mergeFixtureJobIds,
} from "../../e2e/job-fixture";

describe("dictation E2E job fixture tracking", () => {
  test("部分查到的 job IDs 与已记录 IDs 合并且去重", () => {
    expect(mergeFixtureJobIds(
      ["job-before"],
      [{ id: "job-after" }, { id: "job-before" }],
    )).toEqual(["job-before", "job-after"]);
  });

  test("只有查到的 dedupe keys 与 fixture keys 精确相同才完整", () => {
    const expected = ["tts:fixture:a", "tts:fixture:b"];
    expect(hasExactFixtureJobKeys(expected, [
      { dedupeKey: "tts:fixture:b" },
      { dedupeKey: "tts:fixture:a" },
    ])).toBe(true);
    expect(hasExactFixtureJobKeys(expected, [
      { dedupeKey: "tts:fixture:a" },
    ])).toBe(false);
    expect(hasExactFixtureJobKeys(expected, [
      { dedupeKey: "tts:fixture:a" },
      { dedupeKey: "tts:fixture:foreign" },
    ])).toBe(false);
  });
});
