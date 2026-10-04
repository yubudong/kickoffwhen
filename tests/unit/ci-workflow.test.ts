import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const workflowPath = resolve(root, ".github/workflows/ci.yml");
const readWorkflow = () => readFileSync(workflowPath, "utf8");

test("CI 仅由指向 main 的 PR 与 main 推送触发，并使用只读权限", () => {
  const source = readWorkflow();
  expect(source).toMatch(/^on:\n  pull_request:\n    branches: \[main\]\n  push:\n    branches: \[main\]/m);
  expect(source).toMatch(/^permissions:\n  contents: read$/m);
  expect(source).not.toContain("pull_request_target");
});

test("CI 使用项目工具链并按顺序执行四项基础检查", () => {
  const source = readWorkflow();
  expect(source).toContain("runs-on: ubuntu-24.04");
  expect(source).toContain("uses: pnpm/setup@v3");
  expect(source).toContain("runtime: node@24");
  const commands = [
    "pnpm install --frozen-lockfile",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm test",
    "pnpm build",
  ];
  let previous = -1;
  for (const command of commands) {
    const index = source.indexOf(`run: ${command}`);
    expect(index).toBeGreaterThan(previous);
    previous = index;
  }
});

test("CI 不读取生产密钥或执行部署、迁移和导入", () => {
  const source = readWorkflow();
  expect(source).toContain("DATABASE_URL: postgres://ci:ci@127.0.0.1:65432/ci_never_connect");
  expect(source).toContain("SMTP_URL: smtp://127.0.0.1:1");
  expect(source).toContain("REGISTRATION_ALLOWED_EMAILS: ci@example.invalid");
  expect(source).not.toMatch(/secrets\.|pull_request_target|db:migrate|seed:content|deploy/i);
  expect(source).not.toContain("actions/cache");
  expect(source).not.toContain("services:");
});
