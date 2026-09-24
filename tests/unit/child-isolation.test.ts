import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import {
  createChildPageShowHandler,
  shouldRevalidateChildPage,
} from "@/components/child/child-pageshow-guard";

test("pageshow只在BFCache恢复时强制重新校验", () => {
  expect(shouldRevalidateChildPage({ persisted: true })).toBe(true);
  expect(shouldRevalidateChildPage({ persisted: false })).toBe(false);
  let reloads = 0;
  const handlePageShow = createChildPageShowHandler(() => { reloads += 1; });
  handlePageShow({ persisted: false });
  handlePageShow({ persisted: true });
  expect(reloads).toBe(1);
});

test("listening生产查询分支不选择或连接答案列", async () => {
  const source = await readFile("src/modules/dictation/child-view-service.ts", "utf8");
  const start = source.indexOf('if (snapshot.phase === "listening")');
  const end = source.indexOf('observeItemProjection(["itemId", "position"');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const listening = source.slice(
    start,
    end,
  );
  expect(listening).not.toMatch(/answerText|broadcastText|\.select\(\)|\.select\(\{\s*card:\s*learningCards/);
});

test("孩子页切换入口是无href的按钮", async () => {
  const source = await readFile("src/components/child/child-header.tsx", "utf8");
  expect(source).toMatch(/<button\b[\s\S]*?type="button"[\s\S]*?>/);
  expect(source).not.toMatch(/<(?:a|Link)\b[\s\S]*?(?:href=|\/child\/switch)[\s\S]*?>/);
});
