import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const workflowPath = resolve(root, ".github/workflows/ci.yml");
const readWorkflow = () => readFileSync(workflowPath, "utf8");

test("CI 仅由指向 main 的 PR 与 main 推送触发，并使用只读权限", () => {
  const source = readWorkflow();
  expect(source.match(/^on:\n([\s\S]*?)(?=^\S)/m)?.[1].trimEnd()).toBe(
    "  pull_request:\n    branches: [main]\n  push:\n    branches: [main]",
  );
  expect(source.match(/^permissions:\n([\s\S]*?)(?=^\S)/m)?.[1].trimEnd()).toBe(
    "  contents: read",
  );
  expect(source.match(/^\s*permissions:/gm)).toHaveLength(1);
  expect(source).not.toContain("pull_request_target");
});

test("CI 使用项目工具链并按顺序执行四项基础检查", () => {
  const source = readWorkflow();
  expect(source).toContain("runs-on: ubuntu-24.04");
  expect(source.match(/uses: .+/g)).toEqual([
    "uses: actions/checkout@v6",
    "uses: actions/setup-node@v6",
  ]);
  expect(source).toMatch(/uses: actions\/setup-node@v6\n        with:\n          node-version: 24\n          package-manager-cache: false\n      - name:/);
  expect(source).not.toMatch(/^\s*cache(?:-[\w-]+)?:/m);
  const commands = [
    'npm install --prefix "$RUNNER_TEMP/pnpm-cli" pnpm@11.9.0',
    'echo "$RUNNER_TEMP/pnpm-cli/node_modules/.bin" >> "$GITHUB_PATH"',
    "pnpm install --frozen-lockfile",
    "pnpm lint",
    "pnpm typecheck",
    "pnpm test",
    "pnpm build",
  ];
  let previous = source.indexOf("uses: actions/setup-node@v6");
  for (const command of commands) {
    const index = source.indexOf(command);
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
