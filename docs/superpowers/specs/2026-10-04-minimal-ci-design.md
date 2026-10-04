# 最小 GitHub CI 设计（2026-10-04）

## 背景与目标

现有仓库没有 `.github/workflows/`，PR #1 在 2026-10-04 核查时没有自动检查结果。应用已有 `lint`、`typecheck`、`test` 和 `build` 脚本。目标是让代码变更在合并前获得可见的基础质量检查；CI 只验证候选代码，不操作 Hetzner 或其他生产系统。

## 已确认范围

Tom 选择先实施最小 CI，而不是同时接入需要隔离数据库和浏览器环境的完整集成/E2E 测试。

- 新增单个 `.github/workflows/ci.yml`。
- `pull_request` 指向 `main` 时运行；`push` 到 `main` 时再次运行。无论触发来源，工作流都不部署网站。
- 单个 Linux 作业使用项目要求的 Node.js 24、`package.json` 声明的 pnpm 11.9.0，并以 `pnpm install --frozen-lockfile` 安装依赖。
- 顺序执行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`；任一步失败，作业失败并在 PR 上显示结果。首版不缓存依赖或 `.next/cache`，避免增加缓存权限与跨信任边界管理。
- 工作流令牌只授予 `contents: read`，使用普通 `pull_request`，不用 `pull_request_target`。不读取 GitHub Secrets、不接生产数据库、不发邮件、不调用真实 TTS，不执行迁移、词库导入或部署。

## 构建环境和数据边界

构建步骤仅提供格式合法的测试占位配置：`DATABASE_URL=postgres://ci:ci@127.0.0.1:65432/ci_never_connect`、`APP_URL=http://localhost:3000`、固定且非生产的 32 字符以上认证密钥、`SMTP_URL=smtp://127.0.0.1:1`、`SMTP_FROM=CI <ci@example.invalid>`。本机端口不提供数据库或邮件服务。占位配置不写入仓库环境文件，且不得被用作可部署产物；CI 不上传构建产物。若构建确实要求连接数据库，应先查明具体依赖，再决定是否扩展隔离测试服务，不得接入生产库作为捷径。

## 验证与失败处理

实施前确认当前分支与工作区状态，只修改工作流及必要的验证文档。先静态校验 YAML 和触发/权限配置，再用测试占位环境在本地运行同一组命令；失败时定位实际原因，不通过跳过检查使 CI 变绿。推送工作流后，必须在 PR #1 上看到新的检查运行并确认结果，才可称自动 CI 已生效。若未推送或 GitHub 尚未运行，则只报告“本地配置完成”，不能称线上检查已启用。

本次不设置分支保护、不自动合并或部署，不新增生产凭据。集成测试、浏览器测试、缓存优化及强制通过检查才能合并，均作为后续独立决策。

## 参考

- [GitHub Actions 工作流语法与最小权限](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [pnpm 11 持续集成与锁文件行为](https://pnpm.io/zh/11.x/continuous-integration)
- 仓库自带的 `node_modules/next/dist/docs/01-app/02-guides/ci-build-caching.md` 与 `environment-variables.md`。
