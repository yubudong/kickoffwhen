import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));

test.each([
  ["vitest.config.ts", "unit"],
  ["vitest.integration.config.ts", "integration"],
])("%s 只发现当前项目对应套件，不扫描缓存或工作区副本", (config, suite) => {
  const directory = resolve(root, "tests", suite);
  const expected = readdirSync(directory, { recursive: true })
    .filter((name): name is string => typeof name === "string")
    .filter((name) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(name))
    .map((name) => resolve(directory, name))
    .sort();

  // File discovery does not import test files or run database setup.
  const output = execFileSync(process.execPath, [
    resolve(root, "node_modules/vitest/vitest.mjs"),
    "list", "--filesOnly", "--config", config,
  ], { cwd: root, encoding: "utf8", timeout: 15_000 });
  const actual = output.trim().split(/\r?\n/).filter(Boolean)
    .map((name) => resolve(root, name)).sort();

  expect(expected.length).toBeGreaterThan(0);
  expect(actual).toEqual(expected);
});
