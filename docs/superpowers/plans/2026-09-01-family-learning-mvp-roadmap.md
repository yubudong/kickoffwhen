# 家庭学习工具 MVP Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按四个可独立验收的阶段交付家庭学习工具MVP，并在最后一个阶段形成可供封闭家庭测试的候选版本。

**Architecture:** 使用单代码库、模块化单体结构：Next.js 16负责网页与服务端接口，PostgreSQL负责业务数据和持久化任务队列，独立Node工作进程处理TTS、OCR、清理和报告。阶段之间只通过本路线图列出的稳定接口衔接，避免跨模块直接写表。

**Tech Stack:** Node.js 24.x、pnpm 11.x、Next.js 16、React 19、TypeScript 5、PostgreSQL、Drizzle ORM、Better Auth 1.7、Vitest、Playwright、ts-fsrs、Docker Compose、Caddy 2

**Spec:** `docs/superpowers/specs/2026-09-01-family-learning-mvp-design.md`

## Global Constraints

- MVP只有一名可操作的家庭管理员；第二监护人只保留数据结构扩展点。
- 设备绑定家庭，按设备授权一个或多个孩子；共享设备默认可点击头像切换。
- 家长端使用邮箱和密码；儿童端不使用邮箱密码；家长模式始终受独立PIN保护。
- 所有家庭数据必须带`familyId`；所有儿童数据必须同时带`familyId`和`childId`。
- 默认听写模式是连续听写、集中批改、错题整组循环；逐题模式仅作为可选项。
- FSRS目标保持率固定默认为`0.90`；首轮结果不可被同场订正覆盖。
- 成长值只增不减且不可消费；星币可消费；奖励不能因网络重试而重复发放。
- 每个孩子最多5个活跃习惯；照片可选；习惯照片审核完成30天后删除。
- MVP不请求摄像头权限，不加入微信登录、支付、排行榜、社区或完整教材库。
- 内置教材内容公开前必须核实来源、版次和可使用范围。
- 部署、账号设置、购买服务、上传真实教材内容和开放家庭测试必须再次获得Tom确认。
- 所有依赖在首次安装时写入`pnpm-lock.yaml`并使用精确版本；后续不得使用未锁定的浮动版本发布。

---

## 1. 阶段拆分与依赖

### 阶段1：工程基础、账号与设备

计划：`docs/superpowers/plans/2026-09-01-foundation-auth-devices.md`

交付一个可运行的安全骨架：家长注册登录、创建家庭和孩子、设置家长PIN、配对设备、授权儿童档案、共享设备切换、撤销设备。此阶段完成后，两个孩子可以在两台设备同时进入各自空白首页，也可在共用设备错时切换。

### 阶段2：学习内容、听写、FSRS与报告

计划：`docs/superpowers/plans/2026-09-01-learning-dictation-fsrs-reports.md`

依赖阶段1。交付核心学习闭环：学习卡片、四种内容入口、音频生成接口、连续听写、集中批改、错题循环、中断恢复、FSRS复习和家长报告。

### 阶段3：习惯、账本、宠物与奖励

计划：`docs/superpowers/plans/2026-09-01-habits-pet-rewards.md`

依赖阶段1，并消费阶段2提供的`LearningTaskCompleted`事件。交付习惯确认、成长值和星币账本、宠物三阶段、虚拟物品及家庭奖励兑换。

### 阶段4：隐私、安全、PWA、部署与验证

计划：`docs/superpowers/plans/2026-09-01-hardening-deployment-validation.md`

依赖阶段1至3。交付照片生命周期、共享设备缓存隔离、异常监控、备份恢复、Docker/Caddy部署文件、安全验收、国内网络测试表和封闭测试候选版本。

## 2. 计划锁定的文件结构

```text
.
├── content/
│   └── seed/
│       ├── chinese-grade5-volume1.json
│       ├── english-pep-grade5-volume1.json
│       └── schema.json
├── drizzle/
│   └── *.sql
├── e2e/
│   ├── auth-family.spec.ts
│   ├── device-switching.spec.ts
│   ├── dictation.spec.ts
│   ├── engagement.spec.ts
│   └── privacy.spec.ts
├── ops/
│   ├── Caddyfile
│   ├── compose.production.yml
│   ├── backup.sh
│   └── restore.sh
├── public/
│   ├── icons/
│   └── pet/
├── scripts/
│   ├── migrate.ts
│   ├── seed-content.ts
│   └── verify-backup.ts
├── src/
│   ├── app/
│   │   ├── (auth)/
│   │   ├── (parent)/parent/
│   │   ├── (child)/child/
│   │   └── api/
│   ├── db/
│   │   ├── client.ts
│   │   └── schema.ts
│   ├── modules/
│   │   ├── auth/
│   │   ├── families/
│   │   ├── devices/
│   │   ├── jobs/
│   │   ├── media/
│   │   ├── learning-content/
│   │   ├── dictation/
│   │   ├── review/
│   │   ├── reports/
│   │   ├── habits/
│   │   ├── ledger/
│   │   ├── pets/
│   │   └── family-rewards/
│   ├── shared/
│   │   ├── errors.ts
│   │   ├── idempotency.ts
│   │   └── validation.ts
│   └── worker/
│       └── index.ts
├── tests/
│   ├── fixtures/
│   ├── integration/
│   └── unit/
├── .env.example
├── compose.test.yml
├── Dockerfile
├── drizzle.config.ts
├── next.config.ts
├── package.json
├── playwright.config.ts
├── pnpm-lock.yaml
├── tsconfig.json
└── vitest.config.ts
```

## 3. 跨阶段稳定接口

以下类型一经阶段1建立，后续计划只能向后兼容扩展：

```ts
export type Actor =
  | { role: "guardian"; familyId: string; guardianId: string }
  | { role: "child"; familyId: string; childId: string; deviceId: string };

export type GuardianActor = Extract<Actor, { role: "guardian" }>;
export type ChildActor = Extract<Actor, { role: "child" }>;

export type LedgerGrantRequest = {
  familyId: string;
  childId: string;
  growthXp: number;
  starCoins: number;
  sourceType: "dictation" | "habit" | "manual_adjustment";
  sourceId: string;
  idempotencyKey: string;
};

export type LearningTaskCompleted = {
  familyId: string;
  childId: string;
  taskId: string;
  sessionId: string;
  completedAt: Date;
  uniqueCardCount: number;
  firstPassCorrectCount: number;
};

export type PrivateMediaRef = {
  id: string;
  familyId: string;
  childId: string | null;
  kind: "tts_audio" | "ocr_source" | "habit_photo";
  expiresAt: Date | null;
};
```

`dictation`模块发布`LearningTaskCompleted`，`ledger`模块消费并按`idempotencyKey`结算。其他模块不得直接更新星币或成长值余额。

## 4. 阶段门槛

- [ ] 阶段1完成：账号、家庭、孩子、PIN、配对和切换的单元、集成、浏览器测试全部通过。
- [ ] 阶段2开始前：确认首个TTS与OCR供应方式；若需要付费账号或密钥，先向Tom申请授权。
- [ ] 阶段2完成：两种听写模式、错题循环、90%目标保持率、报告口径和中断恢复通过验收。
- [ ] 阶段3开始前：先让Tom审批宠物视觉方向和首批物品清单，再制作正式资产。
- [ ] 阶段3完成：重复提交不会重复发奖或扣币，家庭奖励冻结与退款正确。
- [ ] 阶段4开始前：不得直接连接或修改Hetzner生产环境。
- [ ] 阶段4完成：本地候选版本、生产配置、备份恢复演练说明和封闭测试清单齐备。
- [ ] 部署前：单独向Tom确认域名、邮件、TTS/OCR凭证、服务器防火墙、备份和正式发布操作。

## 5. 总体验证命令

每个阶段完成时运行完整验证，不用单项测试代替总体验证：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
```

预期结果：所有命令退出码为`0`，Vitest和Playwright报告`0 failed`，Next.js生产构建完成。没有部署授权时，只验证本地Docker候选版本，不连接Hetzner。

## 6. 规格覆盖表

| 设计规格 | 实施任务 |
|---|---|
| 产品角色、家长登录、家庭边界 | 阶段1 Task 2至4 |
| 家庭设备配对、多孩子切换、并发会话 | 阶段1 Task 5至6 |
| 学习卡片、教材元数据、手动/粘贴/OCR/内置入口 | 阶段2 Task 1至2 |
| 连续听写、集中批改、逐题模式、错题循环、中断恢复 | 阶段2 Task 3至5 |
| FSRS 90%目标保持率与答题事件口径 | 阶段2 Task 3至4 |
| 单次、每周、卡片报告与家长行动提示 | 阶段2 Task 6 |
| 习惯、自主/审核模式、可选照片 | 阶段3 Task 3 |
| 成长值、星币、追加式账本和幂等 | 阶段3 Task 2 |
| 一只宠物、三阶段、一次性/永久物品 | 阶段3 Task 1和4 |
| 家庭奖励冻结、批准、拒绝、兑现 | 阶段3 Task 5 |
| 照片30天生命周期、数据删除与日志隐私 | 阶段4 Task 1和3 |
| PWA、共享设备本地隔离和断网恢复 | 阶段4 Task 2 |
| Docker、Caddy、Hetzner部署边界 | 阶段4 Task 4 |
| 独立备份、恢复演练、运维状态 | 阶段4 Task 5 |
| 国内网络与两阶段家庭验证 | 阶段4 Task 6 |
| 摄像头功能不进入MVP | 全局约束与阶段4权限策略 |
