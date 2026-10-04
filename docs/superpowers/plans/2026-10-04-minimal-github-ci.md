# Minimal GitHub CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 PR #1 上提供可见、只读的基础自动检查，不更改生产部署。

**Architecture:** 新建一个 GitHub Actions 工作流，针对指向 `main` 的 PR 和 `main` 推送运行单个 Linux 作业。作业安装项目声明的 pnpm 与 Node 24，顺序执行已有脚本；单元测试固定工作流的触发、权限和无部署边界。

**Tech Stack:** GitHub Actions YAML、Node.js 24、pnpm 11.9.0、Vitest 4、Next.js 16。

**Spec:** `docs/superpowers/specs/2026-10-04-minimal-ci-design.md`

## Global Constraints

- 只新增 `.github/workflows/ci.yml` 和必要的验证测试；不修改应用业务代码、数据库迁移或生产配置。
- `pull_request` 指向 `main` 与 `push` 到 `main` 触发；不使用 `pull_request_target`。
- `permissions` 只授予 `contents: read`；不使用 GitHub Secrets 或生产数据库、邮件、TTS 凭据。
- 使用 Node.js 24、`package.json` 的 pnpm 11.9.0 和 `pnpm install --frozen-lockfile`。
- 用 `actions/setup-node@v6` 设置 `node-version: 24` 和 `package-manager-cache: false`，不配置显式 `cache`。只在 GitHub runner 上运行 `npm install --prefix "$RUNNER_TEMP/pnpm-cli" pnpm@11.9.0`，然后将临时目录的 `node_modules/.bin` 追加到 `$GITHUB_PATH`，避免已有 Corepack shim 冲突；本地使用已有工具链，不执行全局安装。该方案替代会保留锁文件校验缓存的 `pnpm/setup@v3`。
- 顺序执行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`。本轮不接入集成/E2E 测试、缓存、分支保护、合并或部署。
- 构建占位配置使用 `127.0.0.1` 未开放端口与 `example.invalid`，不启动数据库或 SMTP 服务，不上传构建产物。
- 现有隔离 worktree 为 `/Users/yubudong/code/学习管理网站/.worktrees/grade5-dictation`，分支 `codex/replace-with-learning-site`；先核对工作区，仅改计划列出的文件，保留其他改动。

---

### Task 1: 增加只读 CI 工作流与回归测试

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `tests/unit/ci-workflow.test.ts`
- Read: `package.json`, `src/config/env.ts`, `node_modules/next/dist/docs/01-app/02-guides/ci-build-caching.md`, `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`

**Interfaces:**
- Consumes: `package.json` 中已有的 `lint`、`typecheck`、`test`、`build` 脚本；不修改脚本签名。
- Produces: PR 上名为 `CI / quality` 的检查作业；不产出部署镜像或数据库写入。

- [ ] **Step 1: 核对分支、Node 版本与工作区。**

```bash
git branch --show-current
git status --short
node --version
pnpm --version
```

预期：分支为 `codex/replace-with-learning-site`、工作区无非本任务改动，使用 Node 24.x / pnpm 11.9.0。若当前 shell 的 `node` 不是 24，先在该 shell 中运行 `source /Users/yubudong/.nvm/nvm.sh`，再运行 `nvm use 24` 并重新核对版本。

- [ ] **Step 2: 先写失败的工作流边界测试。** 新建 `tests/unit/ci-workflow.test.ts`：

```ts
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
```

- [ ] **Step 3: 验证测试先红。**

```bash
pnpm exec vitest run tests/unit/ci-workflow.test.ts
```

预期：因 `.github/workflows/ci.yml` 尚不存在，测试以 `ENOENT` 失败；若已经通过，应先查明是否已有同名工作流，不覆盖他人改动。

- [ ] **Step 4: 新增最小工作流。** 新建 `.github/workflows/ci.yml`：

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  quality:
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    env:
      DATABASE_URL: postgres://ci:ci@127.0.0.1:65432/ci_never_connect
      APP_URL: http://localhost:3000
      BETTER_AUTH_SECRET: "00000000000000000000000000000000"
      SMTP_URL: smtp://127.0.0.1:1
      SMTP_FROM: "CI <ci@example.invalid>"
      REGISTRATION_ALLOWED_EMAILS: ci@example.invalid
      AZURE_SPEECH_ENABLED: "false"
      AUTH_TEST_EMAIL_ENABLED: "false"
    steps:
      - name: Checkout
        uses: actions/checkout@v6
      - name: Set up Node.js
        uses: actions/setup-node@v6
        with:
          node-version: 24
          package-manager-cache: false
      - name: Install pnpm
        run: |
          npm install --prefix "$RUNNER_TEMP/pnpm-cli" pnpm@11.9.0
          echo "$RUNNER_TEMP/pnpm-cli/node_modules/.bin" >> "$GITHUB_PATH"
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Lint
        run: pnpm lint
      - name: Typecheck
        run: pnpm typecheck
      - name: Unit tests
        run: pnpm test
      - name: Build
        run: pnpm build
```

- [ ] **Step 5: 验证工作流测试转绿。**

```bash
pnpm exec vitest run tests/unit/ci-workflow.test.ts
```

预期：三项测试全部通过。

- [ ] **Step 6: 静态检查 YAML 语法。**

```bash
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/ci.yml")'
```

预期：退出 0。此静态解析只证明 YAML 语法，不代替 GitHub Actions 的实际运行。

- [ ] **Step 7: 验证锁文件安装。** 不读取生产 env，不启动数据库或邮件服务。

```bash
pnpm install --frozen-lockfile
```

预期：退出 0，`pnpm-lock.yaml` 不改变。

- [ ] **Step 8: 运行 lint。**

```bash
pnpm lint
```

预期：退出 0。

- [ ] **Step 9: 运行类型检查。**

```bash
pnpm typecheck
```

预期：退出 0。

- [ ] **Step 10: 运行全量单元测试。**

```bash
pnpm test
```

预期：退出 0，新增 CI 边界测试也包含在内。

- [ ] **Step 11: 用与工作流相同的占位变量运行生产构建。**

```bash
DATABASE_URL=postgres://ci:ci@127.0.0.1:65432/ci_never_connect APP_URL=http://localhost:3000 BETTER_AUTH_SECRET=00000000000000000000000000000000 SMTP_URL=smtp://127.0.0.1:1 SMTP_FROM='CI <ci@example.invalid>' REGISTRATION_ALLOWED_EMAILS=ci@example.invalid AZURE_SPEECH_ENABLED=false AUTH_TEST_EMAIL_ENABLED=false pnpm build
```

预期：退出 0，无实际数据库或邮件连接。若构建失败，定位具体原因，不能删除失败的检查项来换取绿色结果。运行后检查 `git status --short`，仅保留本任务文件；Next 生成文件若变化须先查明归属再处理。

- [ ] **Step 12: 复核并提交本任务文件。**

```bash
git diff --check
git status --short
git add -- .github/workflows/ci.yml tests/unit/ci-workflow.test.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "ci: check pull requests with read-only quality job"
```

预期仅两份本任务文件进入提交。不要使用 `git add .`，不要提交生产环境文件或主工作区的其他改动。

## 远端启用与验收（执行 Task 1 后）

Tom 此前要求推送到 GitHub；在复核本任务提交及工作区后，普通推送现有 `codex/replace-with-learning-site` 分支，不强推、不合并、不触碰 Hetzner：

```bash
git push origin codex/replace-with-learning-site
gh pr view 1 --repo yubudong/kickoffwhen --json headRefOid,state,statusCheckRollup,url
gh run list --repo yubudong/kickoffwhen --branch codex/replace-with-learning-site --limit 10
```

只有 PR #1 出现由本次提交触发的 `CI / quality` 检查且结论成功，才可报告自动 CI 已生效。若运行失败，查看该 run 的日志，按实际失败原因修复、重跑本地检查并提交修复后普通推送；不修改生产服务。若 GitHub 没有触发运行，报告实际状态并调查触发条件或 Actions 设置，不把空的 `statusCheckRollup` 当作通过。
