# 隐私、安全、部署与验证 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将前三阶段功能收敛为可供5至10个家庭封闭测试的本地候选版本，完成隐私生命周期、共享设备缓存隔离、安全加固、容器部署、备份恢复和验收工具。

**Architecture:** 在业务模块外增加明确的媒体清理、数据删除、PWA缓存、安全响应头、健康检查和运维边界。生产容器由Caddy、Web、Worker和PostgreSQL组成；备份使用独立目标并通过隔离恢复演练验证。计划只生成和本地验证部署文件，实际Hetzner变更必须单独获批。

**Tech Stack:** 前三阶段技术栈、Next.js PWA Manifest、Service Worker、IndexedDB、Sharp、Docker Compose、Caddy 2、PostgreSQL 17、Restic、Vitest、Playwright

**Spec:** `docs/superpowers/specs/2026-09-01-family-learning-mvp-design.md`

## Global Constraints

- MVP不请求摄像头、麦克风或通知权限。
- 习惯照片审核完成后30天自动删除，家长可提前删除。
- OCR图片和习惯照片必须分开处理；生活照片不得进入OCR。
- Service Worker不得缓存家长页面、儿童HTML、API响应、照片或会话令牌。
- 共享设备切换孩子时清除前一孩子的本地恢复记录和页面状态。
- 数据删除必须再次验证家长身份，不提供无确认的一键删除。
- 数据库、Worker和文件卷不直接暴露公网。
- 备份与服务器原数据必须位于不同存储；保留7份日备份和4份周备份。
- “本地测试通过”“已提交”和“已部署”必须分别表述。
- 任何Hetzner、防火墙、DNS、邮件、外部存储或正式发布变更前必须获得Tom确认。

---

### Task 1: 图片隐私、自动删除与家庭数据删除

**Files:**
- Modify: `src/modules/media/service.ts`
- Create: `src/modules/media/image-sanitizer.ts`
- Create: `src/modules/media/cleanup.ts`
- Create: `src/modules/families/deletion-service.ts`
- Create: `src/app/(parent)/parent/settings/privacy/page.tsx`
- Create: `src/app/api/parent/media/[mediaId]/route.ts`
- Create: `src/app/api/parent/family/delete/route.ts`
- Test: `tests/unit/media-retention.test.ts`
- Test: `tests/integration/privacy-deletion.test.ts`
- Test: `e2e/privacy.spec.ts`

**Interfaces:**
- Produces: `sanitizeUploadedImage(input: Uint8Array): Promise<{ bytes: Uint8Array; mimeType: "image/jpeg"; width: number; height: number }>`
- Produces: `scheduleHabitPhotoDeletion(mediaId: string, reviewedAt: Date): Promise<void>`
- Produces: `deleteExpiredMedia(now: Date, limit: number): Promise<{ deleted: number; failed: string[] }>`
- Produces: `deleteFamily(actor: GuardianActor, confirmation: DeleteFamilyConfirmation): Promise<void>`

```ts
export type DeleteFamilyConfirmation = { currentPassword: string; typedFamilyName: string; commandId: string };
```

- [ ] **Step 1: 安装图片处理库并写保留期失败测试**

Run: `pnpm add sharp`

```ts
import { expect, test } from "vitest";
import { habitPhotoExpiry } from "@/modules/media/cleanup";

test("习惯照片从审核完成起保留30天", () => {
  expect(habitPhotoExpiry(new Date("2026-09-01T08:00:00Z")))
    .toEqual(new Date("2026-10-01T08:00:00Z"));
});
```

- [ ] **Step 2: 实现图片净化和清理**

```ts
import sharp from "sharp";

export async function sanitizeUploadedImage(input: Uint8Array) {
  const image = sharp(input, { failOn: "error" }).rotate();
  const bytes = await image.resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  const metadata = await sharp(bytes).metadata();
  return { bytes: new Uint8Array(bytes), mimeType: "image/jpeg" as const, width: metadata.width!, height: metadata.height! };
}
```

只接受JPEG和PNG，原始上传上限8 MiB；重新编码移除EXIF和定位信息。清理任务先锁定到期媒体行，再删除文件，最后标记`deletedAt`；文件删除失败时保留数据库引用和错误，下一轮重试。

- [ ] **Step 3: 写越权和清理集成测试**

```ts
test("其他家庭不能读取或删除照片", async () => {
  const photo = await fixture.habitPhoto(familyA.child);
  await expect(openPrivateMedia(familyB.actor, photo.id)).rejects.toThrow("MEDIA_NOT_FOUND");
  await expect(deletePrivateMedia(familyB.actor, photo.id)).rejects.toThrow("MEDIA_NOT_FOUND");
});

test("到期照片删除且未到期照片保留", async () => {
  await fixture.media({ id: "expired", expiresAt: new Date("2026-08-31T00:00:00Z") });
  await fixture.media({ id: "active", expiresAt: new Date("2026-09-02T00:00:00Z") });
  const result = await deleteExpiredMedia(new Date("2026-09-01T00:00:00Z"), 100);
  expect(result.deleted).toBe(1);
  expect(await fixture.fileExists("expired")).toBe(false);
  expect(await fixture.fileExists("active")).toBe(true);
});
```

- [ ] **Step 4: 实现高风险数据删除确认**

删除单个孩子要求输入家长PIN和孩子昵称；删除整个家庭要求Better Auth重新验证密码并输入完整家庭名称。事务先标记家庭为`deleting`并吊销全部设备和会话，再由后台任务删除私密文件和级联业务数据；完成前禁止新写入。

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm test -- tests/unit/media-retention.test.ts`

Expected: PASS。

Run: `pnpm test:integration -- tests/integration/privacy-deletion.test.ts`

Expected: PASS。

Run: `pnpm test:e2e -- e2e/privacy.spec.ts`

Expected: 家长可提前删除照片，孩子和其他家庭无权读取，删除家庭必须二次验证。

```bash
git add package.json pnpm-lock.yaml src/modules/media src/modules/families/deletion-service.ts src/app/\(parent\)/parent/settings/privacy src/app/api/parent/media src/app/api/parent/family/delete tests/unit/media-retention.test.ts tests/integration/privacy-deletion.test.ts e2e/privacy.spec.ts
git commit -m "feat: enforce child media privacy lifecycle"
```

### Task 2: PWA安装、断网提示与共享设备缓存隔离

**Files:**
- Create: `src/app/manifest.ts`
- Create: `public/sw.js`
- Create: `src/components/pwa/service-worker-registration.tsx`
- Create: `src/components/pwa/network-status.tsx`
- Create: `src/modules/pwa/cache-policy.ts`
- Create: `src/modules/dictation/pending-command-store.ts`
- Modify: `src/modules/dictation/client-resume.ts`
- Modify: `src/app/layout.tsx`
- Modify: `next.config.ts`
- Create: `public/icons/icon-192.png`
- Create: `public/icons/icon-512.png`
- Test: `tests/unit/pwa-cache-policy.test.ts`
- Test: `tests/unit/pending-command-store.test.ts`
- Test: `e2e/pwa-resume.spec.ts`

**Interfaces:**
- Produces: `isCacheableRequest(request: Request): boolean`
- Produces: `savePendingCommand(actor: ChildActor, command: DictationCommand): Promise<void>`
- Produces: `retryPendingCommands(actor: ChildActor): Promise<number>`
- Produces: `clearChildLocalState(familyId: string, childId: string): Promise<void>`

```ts
export type PendingDictationCommand = { familyId: string; childId: string; sessionId: string; commandId: string; command: DictationCommand; createdAt: number };
```

- [ ] **Step 1: 写缓存白名单失败测试**

```ts
import { expect, test } from "vitest";
import { isCacheablePath } from "@/modules/pwa/cache-policy";

test("只缓存静态公共素材", () => {
  expect(isCacheablePath("/_next/static/chunk.js")).toBe(true);
  expect(isCacheablePath("/pet/stage-1.png")).toBe(true);
  expect(isCacheablePath("/api/child/dictation/s1")).toBe(false);
  expect(isCacheablePath("/api/private-media/m1")).toBe(false);
  expect(isCacheablePath("/parent/reports")).toBe(false);
});
```

- [ ] **Step 2: 实现Manifest与保守Service Worker**

```ts
// src/app/manifest.ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "家庭学习工具",
    short_name: "家庭学习",
    start_url: "/",
    display: "standalone",
    background_color: "#fffaf2",
    theme_color: "#ff8a4c",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
```

`sw.js`只对`/_next/static/`、`/icons/`和`/pet/`执行cache-first；导航请求与所有`/api/`请求始终走网络且不写Cache Storage。Service Worker更新使用新版本缓存名并删除旧静态缓存。

- [ ] **Step 3: 实现同一命令ID的断网重试**

批改提交失败时，把`commandId`、会话ID和标记保存在IndexedDB，键包含`familyId + childId + sessionId`。恢复联网后用原`commandId`重试；服务端幂等保证不重复记分。切换孩子或撤销设备时删除对应恢复记录。

```ts
test("同一设备两个孩子的待提交命令完全分区", async () => {
  await savePendingCommand(childA, commandA);
  await savePendingCommand(childB, commandB);
  await clearChildLocalState(childA.familyId, childA.childId);
  expect(await listPendingCommands(childA)).toEqual([]);
  expect(await listPendingCommands(childB)).toEqual([commandB]);
});
```

- [ ] **Step 4: 写离线E2E并验证**

E2E步骤：进入听写、完成一轮播放、切断网络、提交批改、确认显示“网络恢复后自动提交”、恢复网络、确认只产生一组答题事件；随后切换孩子，浏览器中不得显示前一孩子的题号或答案。

Run: `pnpm test -- tests/unit/pwa-cache-policy.test.ts tests/unit/pending-command-store.test.ts`

Expected: PASS。

Run: `pnpm test:e2e -- e2e/pwa-resume.spec.ts`

Expected: Chromium PASS；WebKit验证刷新恢复，Service Worker特有断网测试仅在Chromium执行并明确标记。

- [ ] **Step 5: 提交**

```bash
git add src/app/manifest.ts src/app/layout.tsx public/sw.js public/icons src/components/pwa src/modules/pwa src/modules/dictation next.config.ts tests/unit/pwa-cache-policy.test.ts tests/unit/pending-command-store.test.ts e2e/pwa-resume.spec.ts
git commit -m "feat: add privacy-safe pwa recovery"
```

### Task 3: 服务端安全边界、上传限制与日志脱敏

**Files:**
- Create: `src/shared/security/origin.ts`
- Create: `src/shared/security/rate-limit.ts`
- Create: `src/shared/security/redact.ts`
- Create: `src/shared/security/headers.ts`
- Create: `src/shared/security/schema.ts`
- Create: `src/shared/idempotency.ts`
- Modify: `next.config.ts`
- Modify: `src/proxy.ts`
- Modify: all mutating route handlers under `src/app/api/`
- Modify: `src/db/schema.ts`
- Test: `tests/unit/redact.test.ts`
- Test: `tests/integration/security-boundaries.test.ts`
- Test: `e2e/security.spec.ts`
- Create: `drizzle/0011_security_rate_limits.sql`

**Interfaces:**
- Produces: `assertSameOrigin(request: Request): void`
- Produces: `consumeRateLimit(input: RateLimitInput): Promise<RateLimitResult>`
- Produces: `redactForLog(value: unknown): unknown`
- Produces: `withIdempotency<T>(actor: Actor, commandId: string, fn: () => Promise<T>): Promise<T>`

```ts
export type RateLimitInput = { scope: "parent_pin" | "pairing" | "upload"; key: string; windowSeconds: number; max: number; now: Date };
export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number | null };
```

- [ ] **Step 1: 写日志脱敏失败测试**

```ts
import { expect, test } from "vitest";
import { redactForLog } from "@/shared/security/redact";

test("日志移除令牌、PIN、密码、答案和媒体地址", () => {
  expect(redactForLog({
    password: "secret",
    pin: "482731",
    token: "abc",
    answerText: "山峰",
    signedUrl: "https://private.example/file",
    event: "request_failed",
  })).toEqual({
    password: "[REDACTED]",
    pin: "[REDACTED]",
    token: "[REDACTED]",
    answerText: "[REDACTED]",
    signedUrl: "[REDACTED]",
    event: "request_failed",
  });
});
```

- [ ] **Step 2: 实现跨站和限流保护**

所有POST、PUT、PATCH、DELETE验证`Origin`与`APP_URL`同源。登录由Better Auth数据库限流；家长PIN为每家庭每15分钟最多10次，配对码为每IP每10分钟最多20次，上传为每家庭每分钟10次。超限返回429和`Retry-After`，不在内存单机计数。

`rateLimitBuckets`表以`scope + key + windowStart`为唯一键，保存计数和过期时间；消费操作在单条`INSERT ... ON CONFLICT DO UPDATE`中原子增加。

- [ ] **Step 3: 配置安全响应头**

```ts
export const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Content-Security-Policy", value: "default-src 'self'; img-src 'self' blob:; media-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
] as const;
```

私密媒体响应使用`Cache-Control: private, no-store`。API错误只返回稳定错误码，不返回SQL、文件路径、上游密钥或堆栈。

- [ ] **Step 4: 写越权矩阵集成测试**

对孩子、设备、卡片、任务、会话、习惯、照片、账本、宠物、家庭奖励和报告逐类建立A家庭与B家庭记录；用A的家长、A的孩子、B的家长、B的孩子分别尝试读取与写入。预期只有明确授权组合成功，其他统一返回404或403且不泄露对象存在性。

Run: `pnpm test -- tests/unit/redact.test.ts`

Expected: PASS。

Run: `pnpm test:integration -- tests/integration/security-boundaries.test.ts`

Expected: PASS，权限矩阵0失败。

Run: `pnpm test:e2e -- e2e/security.spec.ts`

Expected: 跨站写请求、错误PIN暴力尝试、超大上传和伪造childId均被拒绝。

- [ ] **Step 5: 提交**

```bash
git add src/shared/security src/shared/idempotency.ts src/db/schema.ts src/app/api next.config.ts src/proxy.ts tests/unit/redact.test.ts tests/integration/security-boundaries.test.ts e2e/security.spec.ts drizzle
git commit -m "security: harden family and child boundaries"
```

### Task 4: Docker、Caddy、健康检查与本地生产候选

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `ops/compose.production.yml`
- Create: `ops/Caddyfile`
- Create: `src/app/api/health/live/route.ts`
- Create: `src/app/api/health/ready/route.ts`
- Create: `scripts/release-check.sh`
- Test: `tests/integration/health.test.ts`

**Interfaces:**
- Produces: `GET /api/health/live`，进程存活时返回200
- Produces: `GET /api/health/ready`，数据库和媒体目录可用时返回200，否则503
- Produces containers: `web`、`worker`、`db`、`caddy`

- [ ] **Step 1: 写健康检查失败测试**

```ts
test("ready检查数据库与媒体目录", async () => {
  await expect(checkReadiness({ db: healthyDb, mediaRoot: writableDir }))
    .resolves.toEqual({ status: "ready" });
  await expect(checkReadiness({ db: failedDb, mediaRoot: writableDir }))
    .rejects.toThrow("DATABASE_UNAVAILABLE");
});
```

- [ ] **Step 2: 创建非root多阶段镜像**

```dockerfile
FROM node:24-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:24-alpine AS runtime
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=app:app /app ./
USER app
EXPOSE 3000
CMD ["pnpm", "start"]
```

Worker使用同一镜像覆盖命令为`pnpm worker`。数据库只加入内部Docker网络；Caddy是唯一映射80和443的服务。

- [ ] **Step 3: 创建Caddy和Compose配置**

```caddyfile
{$APP_DOMAIN} {
  encode zstd gzip
  header {
    X-Content-Type-Options nosniff
    X-Frame-Options DENY
    Referrer-Policy strict-origin-when-cross-origin
  }
  reverse_proxy web:3000 {
    health_uri /api/health/live
    lb_try_duration 5s
  }
}
```

Compose使用命名卷`postgres_data`、`private_media`和`caddy_data`；密钥只从`.env.production`读取，该文件在`.gitignore`中。Web和Worker等待数据库healthy，迁移作为显式一次性命令运行，不在每个Web启动时自动修改数据库。

- [ ] **Step 4: 本地构建候选并测试**

Run: `docker build -t family-learning:mvp-local .`

Expected: 构建成功，镜像运行用户不是root。

Run: `docker compose -f ops/compose.production.yml --env-file .env.production.local up -d`

Expected: 四个服务healthy，主机只映射测试用HTTP端口和Caddy端口，PostgreSQL端口未映射。

Run: `curl -fsS http://localhost:8080/api/health/ready`

Expected: `{"status":"ready"}`。

- [ ] **Step 5: 运行发布检查并提交**

`release-check.sh`依次执行锁文件安装、lint、typecheck、全部Vitest、生产构建、Playwright和Compose配置校验；任一失败立即退出非0。

```bash
git add Dockerfile .dockerignore ops/compose.production.yml ops/Caddyfile src/app/api/health scripts/release-check.sh tests/integration/health.test.ts .gitignore
git commit -m "ops: add local production container candidate"
```

### Task 5: 独立备份、恢复演练与监控

**Files:**
- Create: `ops/backup.sh`
- Create: `ops/restore.sh`
- Create: `ops/backup.env.example`
- Create: `src/modules/operations/health.ts`
- Create: `src/modules/operations/job-alerts.ts`
- Create: `docs/runbooks/backup-and-restore.md`
- Create: `docs/runbooks/incident-response.md`
- Test: `tests/integration/backup-restore.test.ts`

**Interfaces:**
- Produces: encrypted Restic snapshots containing PostgreSQL custom dump and retained private media
- Produces: `collectOperationalHealth(): Promise<OperationalHealth>`
- Produces: restore target that must differ from production database name and media path

```ts
export type OperationalHealth = { database: "up" | "down"; failedJobs: number; failedMediaDeletes: number; lastBackupAt: Date | null; lastRestoreDrillAt: Date | null };
```

- [ ] **Step 1: 写备份脚本安全约束测试**

```ts
test("恢复工具拒绝生产目标", async () => {
  await expect(runRestore({
    sourceSnapshot: "latest",
    targetDatabase: "family_learning_production",
    productionDatabase: "family_learning_production",
    targetMediaRoot: "/srv/family-learning/media",
    productionMediaRoot: "/srv/family-learning/media",
  })).rejects.toThrow("RESTORE_TARGET_MUST_BE_ISOLATED");
});
```

- [ ] **Step 2: 实现备份脚本**

```sh
#!/bin/sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${MEDIA_ROOT:?MEDIA_ROOT is required}"
: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE is required}"

backup_dir="$(mktemp -d)"
trap 'rm -rf "$backup_dir"' EXIT
pg_dump --format=custom --no-owner --file="$backup_dir/database.dump" "$DATABASE_URL"
restic backup "$backup_dir/database.dump" "$MEDIA_ROOT" --tag family-learning
restic forget --tag family-learning --keep-daily 7 --keep-weekly 4 --prune
restic check
```

备份目标必须是独立Storage Box或S3兼容存储；不得把Restic仓库放在同一服务器系统盘。真实仓库账号、网络访问和费用需要Tom批准。

- [ ] **Step 3: 实现隔离恢复脚本和演练**

恢复脚本要求显式提供`RESTORE_DATABASE_URL`和`RESTORE_MEDIA_ROOT`，并拒绝与生产值相同。它先恢复到临时目录，再用`pg_restore --clean --if-exists`只清理隔离测试数据库，不操作生产库。

Run: `pnpm test:integration -- tests/integration/backup-restore.test.ts`

Expected: 创建测试家庭、备份、删除测试数据库、恢复到新数据库，重新查询家庭、答题事件、账本和媒体SHA-256全部一致。

- [ ] **Step 4: 实现运维状态与告警清单**

状态页只对家长管理员显示：最近备份时间、最近恢复演练时间、失败后台任务数、媒体清理失败数和数据库连接状态。日志采用JSON并通过`redactForLog`处理。MVP不向外部聊天工具发送告警，失败只显示在后台和服务器日志。

- [ ] **Step 5: 提交**

```bash
git add ops/backup.sh ops/restore.sh ops/backup.env.example src/modules/operations docs/runbooks tests/integration/backup-restore.test.ts
git commit -m "ops: add verified offsite backup workflow"
```

### Task 6: 验收矩阵、国内网络测试与封闭测试候选

**Files:**
- Create: `docs/qa/mvp-acceptance-checklist.md`
- Create: `docs/qa/china-network-matrix.md`
- Create: `docs/qa/private-beta-observation-sheet.md`
- Create: `src/modules/analytics/schema.ts`
- Create: `src/modules/analytics/service.ts`
- Modify: `src/db/schema.ts`
- Create: `drizzle/0012_privacy_safe_usage_events.sql`
- Test: `tests/unit/usage-events.test.ts`
- Test: `e2e/full-family-journey.spec.ts`

**Interfaces:**
- Produces: `recordUsageEvent(input: UsageEventInput): Promise<void>`
- Produces event names: `task_started`、`task_completed`、`habit_submitted`、`reward_requested`、`session_resumed`
- Produces private-beta metrics without card text, photo IDs, real names, email addresses or free-form content

```ts
export type UsageEventInput = {
  name: "task_started" | "task_completed" | "habit_submitted" | "reward_requested" | "session_resumed";
  familyId: string;
  childId: string;
  occurredAt: Date;
  durationSeconds?: number;
  itemCount?: number;
};
```

- [ ] **Step 1: 写隐私安全事件失败测试**

```ts
import { expect, test } from "vitest";
import { validateUsageEvent } from "@/modules/analytics/service";

test("使用事件拒绝答案、邮箱和自由文本", () => {
  expect(() => validateUsageEvent({ name: "task_completed", answerText: "山峰" }))
    .toThrow("DISALLOWED_ANALYTICS_FIELD");
  expect(validateUsageEvent({
    name: "task_completed",
    familyId: "f1",
    childId: "c1",
    durationSeconds: 420,
    itemCount: 12,
  }).name).toBe("task_completed");
});
```

- [ ] **Step 2: 实现最小使用事件**

事件只用于计算每周使用天数、核心任务完成率、家长操作时长、儿童独立完成比例和中断恢复次数。所有事件保存在自有PostgreSQL，不接第三方分析SDK。

- [ ] **Step 3: 写完整家庭旅程E2E**

```ts
test("两个孩子完成MVP全旅程且数据隔离", async ({ browser }) => {
  const family = await onboardTwoChildFamily(browser);
  await runDictationJourney(family.childA, { firstPass: [true, false, true] });
  await runHabitJourney(family.childB, { mode: "guardian", photo: false });
  await approveHabit(family.parent, family.childB);
  await purchasePetItem(family.childA, "food.apple");
  await requestAndFulfillFamilyReward(family.childB);
  await assertNoCrossChildData(family.childA, family.childB);
});
```

Run: `pnpm test:e2e -- e2e/full-family-journey.spec.ts`

Expected: Chromium与WebKit均PASS。

- [ ] **Step 4: 执行完整本地候选验证**

Run: `sh scripts/release-check.sh`

Expected: lint、typecheck、unit、integration、build、E2E和Compose校验全部成功。

Run: `git status --short`

Expected: 无输出。

- [ ] **Step 5: 完成国内网络矩阵但不发布**

测试表固定记录：日期、设备、浏览器、运营商、网络类型、首次页面可用时间、任务开始等待、音频失败、批改提交失败、中断恢复结果。覆盖移动、联通、电信各至少一次家庭宽带或5G；微信内置浏览器只测试基础打开和登录，不承诺PWA安装。

- [ ] **Step 6: 准备封闭测试观察表**

观察表按家庭记录两周：每周使用天数、布置和查看总时间、孩子是否需家长中途帮助、任务完成率、诚实标错反馈、宠物是否促进完成、家长是否使用薄弱词建议。成功标准固定为：每周至少3天、核心任务完成率至少70%、家长每日操作约3分钟、无重复积分、无串号、无记录丢失。

- [ ] **Step 7: 提交并停在发布审批前**

```bash
git add docs/qa src/modules/analytics src/db/schema.ts tests/unit/usage-events.test.ts e2e/full-family-journey.spec.ts drizzle
git commit -m "test: add mvp acceptance and beta measurement"
```

完成后向Tom报告：本地候选验证、尚未配置的外部服务、备份演练证据和国内网络结果。没有明确发布授权时，不登录Hetzner、不修改DNS、不开放域名、不导入真实家庭数据。

## 阶段4完成门槛

- 隐私照片按审核完成时间计算30天，并通过实际清理测试。
- 共享设备切换后不显示或缓存上一孩子的敏感页面和恢复数据。
- 权限矩阵、跨站请求、限流、上传和日志脱敏测试通过。
- 本地生产容器健康，数据库未暴露公网。
- 独立备份可恢复到隔离环境，数据库和媒体校验一致。
- 完整家庭旅程在Chromium与WebKit通过。
- 国内网络测试表和封闭测试观察表齐备。
- 所有Hetzner与外部账号操作仍处于“未部署、等待授权”状态。
