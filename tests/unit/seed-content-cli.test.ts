import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { afterEach, expect, test } from "vitest";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

test("CLI validate-only 对非空中文和空官方基准报错", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "seed-cli-"));
  roots.push(root);
  await mkdir(resolve(root, "content/seed"), { recursive: true });
  await mkdir(resolve(root, "content/reference"), { recursive: true });
  const chinese = { publisher: "p", series: "s", subject: "chinese", grade: 5, volume: "v", editionText: "e", units: [{ order: 1, title: "u", sections: [{ key: "l1", order: 1, title: "l", type: "lesson", cards: [{ answerText: "桂花", broadcastText: "桂花", pinyinText: "guì huā", hintText: "（　　）开了。", curriculumSource: "required_vocabulary", builtinKey: "k" }] }] }] };
  const english = { publisher: "p", series: "e", subject: "english", grade: 5, volume: "v", editionText: "e", units: [] };
  const requirements = { publisher: "p", series: "s", grade: 5, volume: "v", editionText: "e", requiredVocabulary: [], requiredCharacters: [], originalWritingPractice: [] };
  await writeFile(resolve(root, "content/seed/chinese-grade5-volume1.json"), JSON.stringify(chinese));
  await writeFile(resolve(root, "content/seed/english-pep-grade5-volume1.json"), JSON.stringify(english));
  await writeFile(resolve(root, "content/reference/chinese-grade5-volume1.json"), JSON.stringify(requirements));
  const project = resolve(import.meta.dirname, "../..");
  const tsxLoader = createRequire(import.meta.url).resolve("tsx");
  expect(() => execFileSync(process.execPath, ["--import", tsxLoader, resolve(project, "scripts/seed-content.ts"), "--validate-only"], { cwd: root, encoding: "utf8", stdio: "pipe", env: { ...process.env, TSX_TSCONFIG_PATH: resolve(project, "tsconfig.json") } })).toThrow(/SEED_REQUIREMENTS_EMPTY/);
});
