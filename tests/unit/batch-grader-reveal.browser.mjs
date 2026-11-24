import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const root = new URL("../..", import.meta.url);
const require = createRequire(new URL("../../package.json", import.meta.url));
const esbuild = require(new URL(
  "../../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js",
  import.meta.url,
).pathname);
const evidenceDir = new URL("../../../家庭学习网站-听写一次揭答证据/", import.meta.url);

const bundled = await esbuild.build({
  absWorkingDir: new URL(".", root).pathname,
  entryPoints: ["tests/unit/batch-grader-reveal.harness.tsx"],
  bundle: true,
  format: "iife",
  platform: "browser",
  write: false,
  jsx: "automatic",
  alias: { "@": new URL("../../src", import.meta.url).pathname },
});
const script = bundled.outputFiles[0].text;
const html = `<!doctype html><meta charset="utf-8"><div id="root"></div><script>${script}</script>`;
const server = createServer((_, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const findings = [];
try {
  const familyId = "11111111-1111-4111-8111-111111111111";
  const childId = "22222222-2222-4222-8222-222222222222";
  const sessionId = "33333333-3333-4333-8333-333333333333";
  const firstId = "44444444-4444-4444-8444-444444444444";
  await page.addInitScript(({ key, draft }) => localStorage.setItem(key, draft), {
    key: `dictation:${familyId}:${childId}:${sessionId}`,
    draft: JSON.stringify({
      schemaVersion: 1, familyId, childId, sessionId, roundNumber: 1, serverVersion: 3,
      marks: { [firstId]: true },
    }),
  });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.getByRole("button", { name: "查看本轮答案" }).waitFor();
  const beforeText = await page.locator("body").innerText();
  if (beforeText.includes("桂花") || beforeText.includes("故乡")) throw new Error(`答案出现在揭答前：${beforeText}`);
  if (await page.locator("fieldset").count() !== 0) throw new Error("揭答前渲染了批改列表");
  await mkdir(evidenceDir, { recursive: true });
  const beforePath = decodeURIComponent(new URL("揭答前.png", evidenceDir).pathname);
  await page.screenshot({ path: beforePath });
  await page.getByRole("button", { name: "查看本轮答案" }).click();
  await page.getByText("桂花", { exact: true }).waitFor();
  await page.getByText("故乡", { exact: true }).waitFor();
  if (await page.getByRole("button", { name: "正确" }).count() !== 2) throw new Error("没有同时显示两题的批改按钮");
  await page.waitForFunction(() => document.querySelector("fieldset button")?.getAttribute("aria-pressed") === "true");
  const pressed = await page.locator("fieldset").nth(0).getByRole("button", { name: "正确" }).getAttribute("aria-pressed");
  if (pressed !== "true") throw new Error(`恢复的标记未保留：${pressed}`);
  await page.locator("fieldset").nth(0).getByRole("button", { name: "错了" }).click();
  await page.locator("fieldset").nth(1).getByRole("button", { name: "正确" }).click();
  if (!(await page.locator("body").innerText()).includes("桂花")) throw new Error("标记后答案被隐藏");
  await page.evaluate(() => window.setGraderState({ pending: true }));
  if (await page.getByText("桂花", { exact: true }).count() !== 1) throw new Error("pending后答案被隐藏");
  if (await page.getByRole("button", { name: "正在保存…" }).isEnabled()) throw new Error("pending时提交按钮仍可点");
  await page.evaluate(() => window.setGraderState({ pending: false, version: 8 }));
  if (await page.getByText("故乡", { exact: true }).count() !== 1) throw new Error("同轮version变化后答案被隐藏");
  await page.getByRole("button", { name: "提交本轮" }).click();
  await page.waitForFunction(() => window.submitted.length === 1);
  const payload = await page.evaluate(() => window.submitted.at(-1));
  if (JSON.stringify(payload) !== JSON.stringify([
    { itemId: firstId, correct: false },
    { itemId: "55555555-5555-4555-8555-555555555555", correct: true },
  ])) throw new Error(`提交顺序或内容变化：${JSON.stringify(payload)}`);
  if (await page.getByText("桂花", { exact: true }).count() !== 1) throw new Error("提交失败后答案被隐藏");
  const afterPath = decodeURIComponent(new URL("揭答后.png", evidenceDir).pathname);
  await page.screenshot({ path: afterPath });
  await page.evaluate(() => window.setGraderState({ round: 2, version: 9 }));
  await page.getByRole("button", { name: "查看本轮答案" }).waitFor();
  if ((await page.locator("body").innerText()).includes("桂花")) throw new Error("新轮次仍显示上一轮答案");
  findings.push("prep-hidden", "one-click-all", "marks-restored", "pending-version-failure-stay-open", "new-round-hidden");
  await writeFile(decodeURIComponent(new URL("结果.json", evidenceDir).pathname), JSON.stringify({ ok: true, findings }, null, 2));
  console.log("PASS");
} finally {
  await browser.close();
  server.close();
}
