# 工程基础、账号与设备 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可运行、可测试的Next.js/PostgreSQL项目，并完成家长账号、家庭、孩子、家长PIN、设备配对和儿童档案切换。

**Architecture:** 采用Next.js 16模块化单体和Drizzle代码优先迁移。Better Auth只负责家长邮箱密码与会话；家庭角色、家长PIN、设备令牌和儿童会话由业务模块负责，所有服务端入口统一生成`Actor`并执行家庭边界检查。

**Tech Stack:** Node.js 24.x、pnpm 11.x、Next.js 16、React 19、TypeScript 5、PostgreSQL、Drizzle ORM、Better Auth 1.7.2、Argon2、Zod、Vitest、Playwright

**Spec:** `docs/superpowers/specs/2026-09-01-family-learning-mvp-design.md`

## Global Constraints

- 家长使用邮箱和密码，MVP只开放一个家庭管理员。
- 家长PIN与账号密码分开保存；任何儿童会话进入家长模式都必须验证PIN。
- 设备绑定家庭，通过授权列表决定可见孩子；不得把设备永久固定到一个孩子。
- 儿童档案切换默认点头像，可选儿童口令；儿童口令只防误入。
- 服务端不得从表单或URL直接信任`familyId`和`childId`。
- 密码、PIN、设备令牌和会话令牌不得写入日志或测试快照。
- 本阶段不实现听写、习惯、宠物或部署。

---

### Task 1: 项目骨架与验证命令

**Files:**
- Create: `package.json`
- Create: `.npmrc`
- Create: `.nvmrc`
- Create: `.env.example`
- Create: `next.config.ts`
- Create: `tsconfig.json`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Create: `src/config/env.ts`
- Create: `src/config/runtime.ts`
- Test: `tests/unit/env.test.ts`

**Interfaces:**
- Produces: `readEnv(source?: NodeJS.ProcessEnv): AppEnv`
- Produces: package scripts `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build`, `db:generate`, `db:migrate`, `worker`

- [ ] **Step 1: 创建确定性的包配置**

```json
{
  "name": "family-learning-mvp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.9.0",
  "engines": { "node": ">=24 <25" },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:e2e": "playwright test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx scripts/migrate.ts",
    "worker": "tsx src/worker/index.ts"
  }
}
```

`.npmrc`写入`save-exact=true`，`.nvmrc`写入`24`。安装并锁定依赖：

```bash
pnpm add next@16 react@19 react-dom@19 zod pg drizzle-orm
pnpm add -D typescript@5 @types/node@24 @types/react@19 @types/react-dom@19 @types/pg eslint eslint-config-next vitest @vitest/coverage-v8 @playwright/test drizzle-kit tsx
pnpm exec playwright install chromium webkit
```

- [ ] **Step 2: 写环境配置失败测试**

```ts
import { describe, expect, it } from "vitest";
import { readEnv } from "@/config/env";

describe("readEnv", () => {
  it("拒绝缺少数据库地址的配置", () => {
    expect(() => readEnv({ NODE_ENV: "test" })).toThrow("DATABASE_URL");
  });

  it("解析完整的测试配置", () => {
    expect(readEnv({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://app:app@localhost:5433/family_learning_test",
      APP_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: "12345678901234567890123456789012",
    }).appUrl).toBe("http://localhost:3000");
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm test -- tests/unit/env.test.ts`

Expected: FAIL，提示无法导入`@/config/env`。

- [ ] **Step 4: 实现环境解析和最小页面**

```ts
// src/config/env.ts
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  APP_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  SMTP_URL: z.string().optional(),
  MEDIA_ROOT: z.string().default("./var/media"),
});

export type AppEnv = ReturnType<typeof readEnv>;

export function readEnv(source: NodeJS.ProcessEnv = process.env) {
  const value = schema.parse(source);
  return {
    nodeEnv: value.NODE_ENV,
    databaseUrl: value.DATABASE_URL,
    appUrl: value.APP_URL,
    betterAuthSecret: value.BETTER_AUTH_SECRET,
    smtpUrl: value.SMTP_URL,
    mediaRoot: value.MEDIA_ROOT,
  } as const;
}
```

```ts
// src/config/runtime.ts，仅服务端模块导入
import "server-only";
import { readEnv } from "./env";

export const env = readEnv();
```

根布局使用`lang="zh-CN"`，首页只显示“家庭学习工具”和进入家长登录的链接。`.env.example`只写变量名与安全的本地示例，不写真实凭证。

- [ ] **Step 5: 运行基础验证**

Run: `pnpm test -- tests/unit/env.test.ts`

Expected: PASS，2 tests passed。

Run: `pnpm lint && pnpm typecheck && pnpm build`

Expected: 三条命令退出码为0。

- [ ] **Step 6: 提交**

```bash
git add package.json pnpm-lock.yaml .npmrc .nvmrc .env.example next.config.ts tsconfig.json eslint.config.mjs vitest.config.ts playwright.config.ts src/app src/config tests/unit/env.test.ts
git commit -m "chore: scaffold family learning application"
```

### Task 2: PostgreSQL、迁移与家庭基础表

**Files:**
- Create: `compose.test.yml`
- Create: `drizzle.config.ts`
- Create: `scripts/migrate.ts`
- Create: `src/db/client.ts`
- Create: `src/db/schema.ts`
- Create: `src/modules/families/schema.ts`
- Create: `src/modules/jobs/schema.ts`
- Create: `tests/helpers/database.ts`
- Test: `tests/integration/family-schema.test.ts`
- Create: `drizzle/0000_foundation.sql`

**Interfaces:**
- Produces: `db: NodePgDatabase`
- Produces: `withTestTransaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T>`
- Produces tables: `families`, `guardians`, `children`, `parentPins`, `jobs`

```ts
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
```

- [ ] **Step 1: 启动独立测试数据库**

```yaml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: family_learning_test
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    ports:
      - "5433:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d family_learning_test"]
      interval: 2s
      timeout: 2s
      retries: 20
```

Run: `docker compose -f compose.test.yml up -d db`

Expected: `docker compose -f compose.test.yml ps`显示数据库为healthy。

- [ ] **Step 2: 写家庭隔离失败测试**

```ts
import { expect, test } from "vitest";
import { db } from "@/db/client";
import { children, families } from "@/modules/families/schema";

test("孩子必须属于一个家庭且昵称在家庭内可重复以外不串号", async () => {
  const [family] = await db.insert(families).values({ name: "测试家庭" }).returning();
  const [child] = await db.insert(children).values({
    familyId: family.id,
    nickname: "小雨",
    grade: 5,
  }).returning();
  expect(child.familyId).toBe(family.id);
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm test:integration -- tests/integration/family-schema.test.ts`

Expected: FAIL，提示家庭表或数据库模块不存在。

- [ ] **Step 4: 实现基础表与连接**

```ts
// src/modules/families/schema.ts
import { boolean, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const families = pgTable("families", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const guardians = pgTable("guardians", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
  authUserId: text("auth_user_id").notNull(),
  isOwner: boolean("is_owner").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("guardians_auth_user_unique").on(table.authUserId)]);

export const children = pgTable("children", {
  id: uuid("id").primaryKey().defaultRandom(),
  familyId: uuid("family_id").notNull().references(() => families.id, { onDelete: "cascade" }),
  nickname: text("nickname").notNull(),
  avatarKey: text("avatar_key").notNull().default("child-1"),
  grade: integer("grade").notNull(),
  childPinHash: text("child_pin_hash"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const parentPins = pgTable("parent_pins", {
  guardianId: uuid("guardian_id").primaryKey().references(() => guardians.id, { onDelete: "cascade" }),
  pinHash: text("pin_hash").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

`jobs`表包含`type`、`payload`、`status`、`attempts`、`availableAt`、`lockedAt`、`lastError`和唯一`dedupeKey`。`src/db/schema.ts`只重新导出各模块表，避免建立第二份模型。

- [ ] **Step 5: 生成并审阅迁移**

Run: `pnpm db:generate`

Expected: 新增`drizzle/0000_foundation.sql`，包含外键、唯一索引和级联删除；不得出现删除既有表的语句。

Run: `DATABASE_URL=postgres://app:app@localhost:5433/family_learning_test pnpm db:migrate`

Expected: 迁移成功。

- [ ] **Step 6: 运行集成测试**

Run: `pnpm test:integration -- tests/integration/family-schema.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add compose.test.yml drizzle.config.ts scripts/migrate.ts src/db src/modules/families/schema.ts src/modules/jobs/schema.ts tests/helpers tests/integration/family-schema.test.ts drizzle
git commit -m "feat: add family database foundation"
```

### Task 3: 家长邮箱密码登录与会话

**Files:**
- Create: `src/modules/auth/schema.ts`
- Create: `src/modules/auth/server.ts`
- Create: `src/modules/auth/client.ts`
- Create: `src/modules/auth/email-sender.ts`
- Create: `src/modules/auth/actor.ts`
- Create: `src/app/api/auth/[...all]/route.ts`
- Create: `src/app/(auth)/sign-in/page.tsx`
- Create: `src/app/(auth)/sign-up/page.tsx`
- Create: `src/app/(auth)/forgot-password/page.tsx`
- Create: `src/app/(auth)/reset-password/page.tsx`
- Modify: `src/db/schema.ts`
- Test: `tests/unit/actor.test.ts`
- Test: `e2e/auth-family.spec.ts`

**Interfaces:**
- Produces: `requireGuardianActor(headers: Headers): Promise<Extract<Actor, { role: "guardian" }>>`
- Produces: `EmailSender.send(input: { to: string; subject: string; text: string }): Promise<void>`
- Produces: Better Auth route `/api/auth/[...all]`

- [ ] **Step 1: 安装认证依赖并生成认证表**

```bash
pnpm add better-auth@1.7.2 @better-auth/drizzle-adapter@1.7.2 argon2 nodemailer
pnpm add -D @types/nodemailer
pnpm dlx @better-auth/cli@1.7.2 generate --adapter drizzle --dialect postgresql --output src/modules/auth/schema.ts --yes
```

Expected: `src/modules/auth/schema.ts`包含用户、会话、账号、验证和限流表。把它从`src/db/schema.ts`导出后运行`pnpm db:generate`，审阅新增迁移且无破坏性语句。

- [ ] **Step 2: 写服务端角色失败测试**

```ts
import { describe, expect, it } from "vitest";
import { actorFromSession } from "@/modules/auth/actor";

describe("actorFromSession", () => {
  it("没有家庭成员记录时拒绝家长身份", async () => {
    await expect(actorFromSession({ user: { id: "user-1" } }, null))
      .rejects.toThrow("GUARDIAN_MEMBERSHIP_REQUIRED");
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm test -- tests/unit/actor.test.ts`

Expected: FAIL，提示`actorFromSession`不存在。

- [ ] **Step 4: 配置Better Auth和邮件接口**

```ts
// src/modules/auth/server.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { toNextJsHandler } from "better-auth/next-js";
import { db } from "@/db/client";
import * as schema from "@/modules/auth/schema";
import { env } from "@/config/runtime";
import { emailSender } from "./email-sender";

export const auth = betterAuth({
  baseURL: env.appUrl,
  secret: env.betterAuthSecret,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: env.nodeEnv === "production",
    sendResetPassword: async ({ user, url }) => {
      void emailSender.send({ to: user.email, subject: "重置密码", text: url });
    },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: { "/sign-in/email": { window: 10, max: 3 } },
  },
});

export const authHandler = toNextJsHandler(auth);
```

开发和测试环境使用内存`FakeEmailSender`收集重置链接；生产环境缺少`SMTP_URL`时启动失败，不允许静默丢弃邮件。

- [ ] **Step 5: 实现Actor转换与页面**

```ts
export type Actor =
  | { role: "guardian"; familyId: string; guardianId: string }
  | { role: "child"; familyId: string; childId: string; deviceId: string };

export type GuardianActor = Extract<Actor, { role: "guardian" }>;
export type ChildActor = Extract<Actor, { role: "child" }>;

export async function actorFromSession(
  session: { user: { id: string } } | null,
  membership: { id: string; familyId: string } | null,
): Promise<Extract<Actor, { role: "guardian" }>> {
  if (!session || !membership) throw new Error("GUARDIAN_MEMBERSHIP_REQUIRED");
  return { role: "guardian", familyId: membership.familyId, guardianId: membership.id };
}
```

登录、注册、忘记密码和重置密码页面只调用Better Auth客户端，不自行保存密码。错误文案不透露某个邮箱是否已注册。

- [ ] **Step 6: 运行测试与认证E2E**

Run: `pnpm test -- tests/unit/actor.test.ts`

Expected: PASS。

Run: `pnpm test:e2e -- e2e/auth-family.spec.ts`

Expected: 家长可注册、退出、重新登录并完成密码重置；未登录访问`/parent`被送回登录页。

- [ ] **Step 7: 提交**

```bash
git add package.json pnpm-lock.yaml src/modules/auth src/app/api/auth src/app/\(auth\) src/db/schema.ts tests/unit/actor.test.ts e2e/auth-family.spec.ts drizzle
git commit -m "feat: add guardian email authentication"
```

### Task 4: 家庭入门、孩子档案与家长PIN

**Files:**
- Create: `src/modules/families/service.ts`
- Create: `src/modules/families/validation.ts`
- Create: `src/modules/auth/parent-pin.ts`
- Create: `src/app/(parent)/parent/onboarding/page.tsx`
- Create: `src/app/(parent)/parent/children/page.tsx`
- Create: `src/app/api/parent/family/route.ts`
- Create: `src/app/api/parent/children/route.ts`
- Create: `src/app/api/parent/pin/route.ts`
- Test: `tests/unit/parent-pin.test.ts`
- Test: `tests/integration/family-service.test.ts`

**Interfaces:**
- Produces: `createFamilyOwner(authUserId: string, input: { familyName: string; ownerName: string }): Promise<GuardianActor>`
- Produces: `createChild(actor: GuardianActor, input: CreateChildInput): Promise<Child>`
- Produces: `setParentPin(actor: GuardianActor, pin: string): Promise<void>`
- Produces: `verifyParentPin(actor: GuardianActor, pin: string, now?: Date): Promise<boolean>`

```ts
export type CreateChildInput = {
  nickname: string;
  avatarKey: string;
  grade: number;
  textbookEditionIds: string[];
  childPin?: string;
};

export type Child = {
  id: string;
  familyId: string;
  nickname: string;
  avatarKey: string;
  grade: number;
  active: boolean;
};
```

- [ ] **Step 1: 写PIN锁定失败测试**

```ts
import { expect, test } from "vitest";
import { hashParentPin, verifyPinHash } from "@/modules/auth/parent-pin";

test("家长PIN使用哈希且错误PIN不通过", async () => {
  const hash = await hashParentPin("482731");
  expect(hash).not.toContain("482731");
  await expect(verifyPinHash(hash, "000000")).resolves.toBe(false);
  await expect(verifyPinHash(hash, "482731")).resolves.toBe(true);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- tests/unit/parent-pin.test.ts`

Expected: FAIL，提示PIN函数不存在。

- [ ] **Step 3: 实现PIN与家庭事务**

```ts
import argon2 from "argon2";

export function hashParentPin(pin: string) {
  if (!/^\d{6}$/.test(pin)) throw new Error("PIN_MUST_BE_6_DIGITS");
  return argon2.hash(pin, { type: argon2.argon2id });
}

export function verifyPinHash(hash: string, pin: string) {
  return argon2.verify(hash, pin);
}
```

`createFamilyOwner`必须在同一事务内创建家庭和唯一owner监护人。`createChild`从`actor.familyId`写入家庭，不接受客户端传入家庭ID。连续5次错误PIN锁定15分钟；成功验证后清零失败次数。

- [ ] **Step 4: 写并运行家庭隔离集成测试**

```ts
test("家长不能修改其他家庭的孩子", async () => {
  const familyA = await fixture.familyWithOwner("a@example.com");
  const familyB = await fixture.familyWithOwner("b@example.com");
  const childB = await fixture.child(familyB.actor, "小北");
  await expect(renameChild(familyA.actor, childB.id, "越权"))
    .rejects.toThrow("CHILD_NOT_FOUND");
});
```

Run: `pnpm test:integration -- tests/integration/family-service.test.ts`

Expected: PASS，且越权错误不暴露其他家庭是否存在该孩子。

- [ ] **Step 5: 完成入门和孩子管理页面**

家长首次登录依次填写家庭名称、家长显示名、6位家长PIN，然后至少创建一个孩子。孩子表单字段固定为昵称、头像键、年级、教材选择和可选儿童口令；不得要求真实姓名。

- [ ] **Step 6: 运行本任务全部验证**

Run: `pnpm test -- tests/unit/parent-pin.test.ts`

Expected: PASS。

Run: `pnpm test:integration -- tests/integration/family-service.test.ts`

Expected: PASS。

Run: `pnpm lint && pnpm typecheck`

Expected: 退出码为0。

- [ ] **Step 7: 提交**

```bash
git add src/modules/families src/modules/auth/parent-pin.ts src/app/\(parent\) src/app/api/parent tests/unit/parent-pin.test.ts tests/integration/family-service.test.ts
git commit -m "feat: add family onboarding and parent pin"
```

### Task 5: 设备配对、授权孩子与儿童会话

**Files:**
- Create: `src/modules/devices/schema.ts`
- Create: `src/modules/devices/token.ts`
- Create: `src/modules/devices/service.ts`
- Create: `src/modules/devices/child-actor.ts`
- Modify: `src/db/schema.ts`
- Create: `src/app/(parent)/parent/devices/page.tsx`
- Create: `src/app/(child)/pair/page.tsx`
- Create: `src/app/(child)/select-child/page.tsx`
- Create: `src/app/api/parent/devices/pairing-code/route.ts`
- Create: `src/app/api/child/pair/route.ts`
- Create: `src/app/api/child/select/route.ts`
- Create: `src/app/api/parent/devices/[deviceId]/revoke/route.ts`
- Test: `tests/unit/device-token.test.ts`
- Test: `tests/integration/device-session.test.ts`
- Create: `drizzle/0002_devices.sql`

**Interfaces:**
- Produces: `createPairingCode(actor: GuardianActor, childIds: string[], now?: Date): Promise<{ code: string; expiresAt: Date }>`
- Produces: `claimPairingCode(code: string, label: string): Promise<{ rawDeviceToken: string; deviceId: string }>`
- Produces: `selectChild(rawDeviceToken: string, childId: string, childPin?: string): Promise<{ rawChildSessionToken: string }>`
- Produces: `requireChildActor(request: Request): Promise<ChildActor>`
- Produces: `revokeDevice(actor: GuardianActor, deviceId: string): Promise<void>`

- [ ] **Step 1: 写令牌不落明文的失败测试**

```ts
import { expect, test } from "vitest";
import { createOpaqueToken, hashOpaqueToken } from "@/modules/devices/token";

test("设备令牌只保存SHA-256摘要", () => {
  const token = createOpaqueToken();
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(hashOpaqueToken(token)).toMatch(/^[a-f0-9]{64}$/);
  expect(hashOpaqueToken(token)).not.toBe(token);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- tests/unit/device-token.test.ts`

Expected: FAIL，提示令牌函数不存在。

- [ ] **Step 3: 实现设备表和令牌**

```ts
import { createHash, randomBytes } from "node:crypto";

export const createOpaqueToken = () => randomBytes(32).toString("base64url");
export const hashOpaqueToken = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");
```

设备模型包括`devices`、`deviceChildAccess`、`pairingCodes`和`childSessions`：配对码10分钟过期且只能领取一次；数据库只保存设备令牌和儿童会话令牌摘要；撤销设备时同时撤销其所有儿童会话。

- [ ] **Step 4: 写共享设备和并发集成测试**

```ts
test("一台设备可切换两个孩子，两台设备会话互不挤下线", async () => {
  const family = await fixture.familyWithTwoChildren();
  const shared = await fixture.pairedDevice(family.actor, family.childIds);
  const personal = await fixture.pairedDevice(family.actor, [family.childIds[1]]);
  const childA = await selectChild(shared.token, family.childIds[0]);
  const childB = await selectChild(personal.token, family.childIds[1]);
  expect((await actorFromChildToken(childA.rawChildSessionToken)).childId).toBe(family.childIds[0]);
  expect((await actorFromChildToken(childB.rawChildSessionToken)).childId).toBe(family.childIds[1]);
});
```

另写测试覆盖：未授权孩子被拒绝、错误儿童口令被拒绝、直接切换模式无需口令、撤销设备后所有会话失效。

- [ ] **Step 5: 运行迁移和测试**

Run: `pnpm db:generate && DATABASE_URL=postgres://app:app@localhost:5433/family_learning_test pnpm db:migrate`

Expected: 设备表和唯一索引创建成功。

Run: `pnpm test -- tests/unit/device-token.test.ts`

Expected: PASS。

Run: `pnpm test:integration -- tests/integration/device-session.test.ts`

Expected: PASS，全部并发与撤销场景通过。

- [ ] **Step 6: 实现配对和选择页面**

家长设备页展示设备名称、授权孩子、最近活跃时间和撤销按钮。儿童配对页只输入配对码与设备名称；成功后进入头像选择页。只有一个授权孩子且未开启儿童口令时直接进入该孩子首页。

- [ ] **Step 7: 提交**

```bash
git add src/modules/devices src/db/schema.ts src/app/\(parent\)/parent/devices src/app/\(child\) src/app/api/parent/devices src/app/api/child tests/unit/device-token.test.ts tests/integration/device-session.test.ts drizzle
git commit -m "feat: add family device pairing and child sessions"
```

### Task 6: 家长与儿童外壳及端到端权限验收

**Files:**
- Create: `src/app/(parent)/parent/layout.tsx`
- Create: `src/app/(parent)/parent/page.tsx`
- Create: `src/app/(child)/child/layout.tsx`
- Create: `src/app/(child)/child/page.tsx`
- Create: `src/app/(child)/child/switch/page.tsx`
- Create: `src/components/parent/parent-nav.tsx`
- Create: `src/components/child/child-header.tsx`
- Create: `src/components/child/profile-selector.tsx`
- Create: `src/proxy.ts`
- Test: `e2e/device-switching.spec.ts`

**Interfaces:**
- Consumes: `requireGuardianActor(headers)`、`requireChildActor(request)`、`selectChild(...)`、`revokeDevice(...)`
- Produces: 稳定路由`/parent`、`/parent/children`、`/parent/devices`、`/child`、`/child/switch`

- [ ] **Step 1: 写端到端失败测试**

```ts
import { expect, test } from "@playwright/test";

test("共享设备切换孩子且不能进入家长页", async ({ browser }) => {
  const parent = await browser.newContext();
  const shared = await browser.newContext();
  const secondDevice = await browser.newContext();

  const family = await seedFamily(parent, ["小雨", "小川"]);
  await pairDevice(shared, family, ["小雨", "小川"]);
  await pairDevice(secondDevice, family, ["小川"]);

  await selectProfile(shared, "小雨");
  await expect(shared.pages()[0].getByText("小雨的今日任务")).toBeVisible();
  await selectProfile(shared, "小川");
  await expect(shared.pages()[0].getByText("小川的今日任务")).toBeVisible();
  await expect(secondDevice.pages()[0].getByText("小川的今日任务")).toBeVisible();

  await shared.pages()[0].goto("/parent");
  await expect(shared.pages()[0]).toHaveURL(/parent-unlock/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test:e2e -- e2e/device-switching.spec.ts`

Expected: FAIL，页面或辅助函数尚不存在。

- [ ] **Step 3: 实现角色外壳**

家长布局每次服务端渲染都验证完整家长会话。儿童布局每次从HttpOnly儿童会话读取`ChildActor`。`src/proxy.ts`只做乐观跳转，任何读写接口仍在模块服务入口重新验证完整会话。

儿童首页显示当前头像、昵称、“今日任务尚未开放”和“切换孩子”；不能出现审核、设备管理或积分调整入口。切换孩子时先清除前一个孩子的页面状态。

- [ ] **Step 4: 运行端到端和完整验证**

Run: `pnpm test:e2e -- e2e/auth-family.spec.ts e2e/device-switching.spec.ts`

Expected: PASS，Chromium与WebKit均通过。

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build`

Expected: 所有命令退出码为0。

- [ ] **Step 5: 人工验收**

在两个浏览器配置中分别登录两个孩子，再用第三个配置测试共享设备切换。核对：不会相互退出、切换后昵称和头像同步改变、儿童直接访问家长URL必须验证家长PIN、撤销设备后再次请求立即失败。

- [ ] **Step 6: 提交**

```bash
git add src/app/\(parent\) src/app/\(child\) src/components src/proxy.ts e2e/device-switching.spec.ts
git commit -m "feat: add isolated parent and child application shells"
```

## 阶段1完成门槛

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:e2e
git status --short
```

预期：所有验证退出码为0，浏览器测试0 failed，`git status --short`无输出。阶段1不部署到Hetzner；只提交本地候选版本并进行代码审查。
