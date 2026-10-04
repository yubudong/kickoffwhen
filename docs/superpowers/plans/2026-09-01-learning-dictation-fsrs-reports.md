# 学习内容、听写、FSRS与报告 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在阶段1账号与设备基础上交付完整的语文、英语听写闭环，包括内容创建、语音缓存、连续听写、集中批改、错题循环、FSRS复习和家长报告。

**Architecture:** 学习卡片、听写会话、FSRS状态和报告分别由独立模块管理。听写状态机保存不可变答题事件；FSRS只消费首轮结果和再学习完成事件；TTS、OCR通过持久化任务队列异步运行，具体供应商封装在适配器中。

**Tech Stack:** 阶段1技术栈、ts-fsrs、PostgreSQL JSONB、Node后台工作进程、Azure Speech REST适配器、Azure Vision Image Analysis 4.0 OCR适配器、Vitest、Playwright

**Spec:** `docs/superpowers/specs/2026-09-01-family-learning-mvp-design.md`

## Global Constraints

- 内容入口必须包含手动输入、批量粘贴、OCR草稿和内置种子内容。
- OCR结果未经家长逐项确认不得进入正式任务。
- 默认听写先连续播完整组，再集中批改；错题也按整组重听和集中批改。
- 逐题模式可选，但与默认模式共享记录、FSRS和报告口径。
- 首轮结果不可修改；最后答对不得覆盖先前错误。
- FSRS默认`request_retention: 0.9`，儿童界面只显示“正确”和“错了”。
- 同一场错题订正不计为多次独立保持成功。
- 语音必须生成并缓存；开始听写前预加载本组音频。
- 教材种子内容必须带准确版次和单元，不得提交教材扫描页。
- 本阶段只发布`LearningTaskCompleted`事件，不直接增加成长值或星币。
- 启用Azure或任何付费TTS/OCR账号、密钥和实际调用前必须得到Tom确认。

---

### Task 1: 学习卡片、教材与四种内容入口

**Files:**
- Create: `src/modules/learning-content/schema.ts`
- Create: `src/modules/learning-content/types.ts`
- Create: `src/modules/learning-content/service.ts`
- Create: `src/modules/learning-content/bulk-parser.ts`
- Create: `src/modules/learning-content/seed-validator.ts`
- Modify: `src/db/schema.ts`
- Create: `src/app/(parent)/parent/content/page.tsx`
- Create: `src/app/(parent)/parent/content/new/page.tsx`
- Create: `src/app/api/parent/content/route.ts`
- Create: `content/seed/schema.json`
- Create: `content/seed/chinese-grade5-volume1.json`
- Create: `content/seed/english-pep-grade5-volume1.json`
- Create: `scripts/seed-content.ts`
- Test: `tests/unit/bulk-parser.test.ts`
- Test: `tests/integration/learning-content.test.ts`
- Create: `drizzle/0003_learning_content.sql`

**Interfaces:**
- Produces: `createCard(actor: GuardianActor, input: CreateCardInput): Promise<LearningCard>`
- Produces: `parseBulkCards(text: string, subject: "chinese" | "english"): ParsedCard[]`
- Produces: `confirmOcrDraft(actor: GuardianActor, draftId: string, cards: ConfirmedCardInput[]): Promise<LearningCard[]>`
- Produces: `listCards(actor: GuardianActor, filter: CardFilter): Promise<LearningCard[]>`

```ts
export type LearningCard = {
  id: string;
  familyId: string | null;
  subject: "chinese" | "english";
  answerText: string;
  broadcastText: string;
  hintText: string | null;
  textbookEditionId: string | null;
  unitId: string | null;
  source: CardSource;
};

export type ParsedCard = Pick<LearningCard, "subject" | "answerText" | "broadcastText"> & { sourceOrder: number };
export type ConfirmedCardInput = { lineId: string; answerText: string; broadcastText: string; hintText?: string };
export type CardFilter = { subject?: "chinese" | "english"; unitId?: string; query?: string };
```

- [ ] **Step 1: 写批量解析失败测试**

```ts
import { expect, test } from "vitest";
import { parseBulkCards } from "@/modules/learning-content/bulk-parser";

test("按换行解析并去掉空白但保留原顺序", () => {
  expect(parseBulkCards("  山峰\n\n河流\n山峰 ", "chinese")).toEqual([
    { answerText: "山峰", broadcastText: "山峰", subject: "chinese", sourceOrder: 0 },
    { answerText: "河流", broadcastText: "河流", subject: "chinese", sourceOrder: 1 },
  ]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- tests/unit/bulk-parser.test.ts`

Expected: FAIL，提示解析器不存在。

- [ ] **Step 3: 实现类型、解析器和数据库表**

```ts
export type CardSource = "manual" | "bulk" | "ocr" | "builtin";

export type CreateCardInput = {
  subject: "chinese" | "english";
  answerText: string;
  broadcastText: string;
  hintText?: string;
  textbookEditionId?: string;
  unitId?: string;
  source: CardSource;
};
```

数据库表固定为`textbookEditions`、`textbookUnits`、`learningCards`、`ocrDrafts`和`ocrDraftLines`。`learningCards`同时保存`familyId`和可为空的`builtinKey`；家庭自建内容只能被本家庭查询。OCR行使用`draft`、`confirmed`、`rejected`状态，只有`confirmed`行可生成卡片。

- [ ] **Step 4: 生成迁移并运行隔离测试**

```ts
test("OCR草稿确认前不出现在可选卡片中", async () => {
  const draft = await fixture.ocrDraft(actor, ["mountain"]);
  expect(await listCards(actor, { query: "mountain" })).toHaveLength(0);
  await confirmOcrDraft(actor, draft.id, [{ lineId: draft.lineIds[0], answerText: "mountain", broadcastText: "mountain" }]);
  expect(await listCards(actor, { query: "mountain" })).toHaveLength(1);
});
```

Run: `pnpm db:generate && pnpm db:migrate`

Expected: 学习内容表和家庭索引建立成功。

Run: `pnpm test:integration -- tests/integration/learning-content.test.ts`

Expected: PASS，OCR确认和家庭隔离场景全部通过。

- [ ] **Step 5: 建立种子内容格式与人工内容门槛**

`content/seed/schema.json`要求每个文件包含`publisher`、`series`、`grade`、`volume`、`editionText`、`units`和每条卡片的`answerText`、`broadcastText`。先提交结构正确但不含教材扫描内容的空`units`数组。

实际填充前暂停并请Tom提供所选1至2个单元的自有教材照片或经过核实的词表。逐条核对后再写入JSON，运行：

```bash
pnpm tsx scripts/seed-content.ts --validate-only
```

Expected: 输出两本教材的准确版次、单元数、卡片数和`validation: PASS`；任何空答案、重复键或缺少版次均退出1。

- [ ] **Step 6: 完成家长内容页面并提交**

页面提供四个入口卡片：单条输入、批量粘贴、拍照识别、内置教材。OCR入口在Task 2接通；此任务先显示“上传后需要家长确认”的明确说明。

```bash
git add src/modules/learning-content src/db/schema.ts src/app/\(parent\)/parent/content src/app/api/parent/content content/seed scripts/seed-content.ts tests/unit/bulk-parser.test.ts tests/integration/learning-content.test.ts drizzle
git commit -m "feat: add learning cards and content ingestion"
```

### Task 2: 私密媒体、后台任务、TTS与OCR

**Files:**
- Create: `src/modules/media/schema.ts`
- Create: `src/modules/media/store.ts`
- Create: `src/modules/media/service.ts`
- Create: `src/modules/jobs/service.ts`
- Create: `src/modules/jobs/worker.ts`
- Create: `src/modules/learning-content/tts-provider.ts`
- Create: `src/modules/learning-content/azure-tts-provider.ts`
- Create: `src/modules/learning-content/ocr-provider.ts`
- Create: `src/modules/learning-content/azure-ocr-provider.ts`
- Create: `src/worker/index.ts`
- Create: `src/app/api/parent/content/ocr/route.ts`
- Create: `src/app/api/private-media/[mediaId]/route.ts`
- Modify: `.env.example`
- Modify: `src/db/schema.ts`
- Test: `tests/unit/media-path.test.ts`
- Test: `tests/unit/tts-provider.test.ts`
- Test: `tests/integration/job-worker.test.ts`
- Create: `drizzle/0004_media_jobs.sql`

**Interfaces:**
- Produces: `PrivateMediaRef`
- Produces: `privateMediaStore.put(input: PutPrivateMediaInput): Promise<PrivateMediaRef>`
- Produces: `privateMediaStore.open(actor: Actor, mediaId: string): Promise<ReadableStream>`
- Produces: `enqueueJob<T>(type: JobType, payload: T, dedupeKey: string): Promise<Job>`
- Produces: `TtsProvider.synthesize(input: TtsInput): Promise<{ bytes: Uint8Array; mimeType: "audio/mpeg" }>`
- Produces: `OcrProvider.read(input: { bytes: Uint8Array; mimeType: string }): Promise<OcrLine[]>`

- [ ] **Step 1: 写媒体路径逃逸失败测试**

```ts
import { expect, test } from "vitest";
import { mediaDiskPath } from "@/modules/media/store";

test("媒体ID不能逃出私密目录", () => {
  expect(() => mediaDiskPath("../etc/passwd")).toThrow("INVALID_MEDIA_ID");
  expect(mediaDiskPath("018f3b5d-1111-7111-8111-111111111111"))
    .toMatch(/var\/media\/01\/8f\/018f3b5d/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- tests/unit/media-path.test.ts`

Expected: FAIL，媒体存储模块不存在。

- [ ] **Step 3: 实现私密媒体和持久化队列**

```ts
export type PrivateMediaRef = {
  id: string;
  familyId: string;
  childId: string | null;
  kind: "tts_audio" | "ocr_source" | "habit_photo";
  expiresAt: Date | null;
};

export type PutPrivateMediaInput = {
  familyId: string;
  childId: string | null;
  kind: PrivateMediaRef["kind"];
  bytes: Uint8Array;
  mimeType: "audio/mpeg" | "image/jpeg" | "image/png";
  expiresAt: Date | null;
};

export type JobType = "generate_tts" | "run_ocr" | "delete_media" | "build_weekly_report";
export type Job = { id: string; type: JobType; status: "queued" | "running" | "succeeded" | "failed"; attempts: number };

export interface TtsProvider {
  synthesize(input: TtsInput): Promise<{ bytes: Uint8Array; mimeType: "audio/mpeg" }>;
}

export type TtsInput = {
  text: string;
  language: "zh-CN" | "en-US";
  voice: "zh-CN-XiaoxiaoNeural" | "en-US-JennyNeural";
  rate: number;
};

export type OcrLine = { text: string; confidence: number; order: number };

export interface OcrProvider {
  read(input: { bytes: Uint8Array; mimeType: "image/jpeg" | "image/png" }): Promise<OcrLine[]>;
}
```

文件名只使用服务端生成UUID；媒体表保存家庭、孩子、类型、MIME、大小、SHA-256、相对路径和删除时间。授权下载必须根据`Actor`验证家庭，儿童只可读取自己任务需要的TTS，不能读取OCR原图。

工作进程使用`SELECT ... FOR UPDATE SKIP LOCKED`领取任务；成功、失败、重试和最大5次尝试均写回数据库；`dedupeKey`唯一。

- [ ] **Step 4: 实现Azure适配器但不启用真实调用**

在开始本步骤前，向Tom展示Azure Speech与Azure Vision将产生外部账号和用量费用；没有授权时只运行Fake Provider测试，不创建资源、不写密钥。

```ts
export class AzureTtsProvider implements TtsProvider {
  constructor(private readonly endpoint: string, private readonly key: string) {}

  async synthesize(input: TtsInput) {
    const response = await fetch(`${this.endpoint}/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": this.key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
        "User-Agent": "family-learning-mvp",
      },
      body: buildSafeSsml(input),
    });
    if (!response.ok) throw new Error(`TTS_UPSTREAM_${response.status}`);
    return { bytes: new Uint8Array(await response.arrayBuffer()), mimeType: "audio/mpeg" as const };
  }
}
```

OCR使用Image Analysis 4.0的`api-version=2024-02-01&features=read`，直接上传图片字节，不为私密原图创建公开URL。适配器只返回文本、置信度和阅读顺序。

`.env.example`增加`AZURE_SPEECH_ENDPOINT`、`AZURE_SPEECH_KEY`、`AZURE_VISION_ENDPOINT`和`AZURE_VISION_KEY`四个变量名；真实值只进入部署环境。

- [ ] **Step 5: 写任务幂等集成测试并运行**

```ts
test("同一卡片和语音参数只生成一份缓存", async () => {
  await enqueueJob("generate_tts", payload, "tts:card-1:zh-CN:1.0");
  await enqueueJob("generate_tts", payload, "tts:card-1:zh-CN:1.0");
  await worker.runOnce();
  expect(await countMediaByCard("card-1")).toBe(1);
});
```

Run: `pnpm test -- tests/unit/media-path.test.ts tests/unit/tts-provider.test.ts`

Expected: PASS，SSML对`<>&`正确转义，上游错误不记录密钥或正文。

Run: `pnpm test:integration -- tests/integration/job-worker.test.ts`

Expected: PASS，重复任务只生成一份媒体，失败按计划重试。

- [ ] **Step 6: 提交**

```bash
git add src/modules/media src/modules/jobs src/modules/learning-content/*provider.ts src/worker src/app/api/parent/content/ocr src/app/api/private-media .env.example src/db/schema.ts tests/unit/media-path.test.ts tests/unit/tts-provider.test.ts tests/integration/job-worker.test.ts drizzle
git commit -m "feat: add private media and learning background jobs"
```

### Task 3: 学习任务与FSRS调度

**Files:**
- Create: `src/modules/review/schema.ts`
- Create: `src/modules/review/scheduler.ts`
- Create: `src/modules/review/service.ts`
- Create: `src/modules/dictation/task-schema.ts`
- Create: `src/modules/dictation/task-service.ts`
- Modify: `src/db/schema.ts`
- Create: `src/app/(parent)/parent/tasks/new/page.tsx`
- Create: `src/app/api/parent/tasks/route.ts`
- Test: `tests/unit/fsrs-scheduler.test.ts`
- Test: `tests/integration/task-planner.test.ts`
- Create: `drizzle/0005_review_tasks.sql`

**Interfaces:**
- Produces: `scheduleFirstResult(input: FirstResultInput): ScheduledReview`
- Produces: `markRelearningComplete(input: RelearningInput): ScheduledReview`
- Produces: `buildDailyTask(actor: GuardianActor, input: BuildTaskInput): Promise<LearningTask>`
- Produces: `getDueCards(childActor: ChildActor, at: Date, limit: number): Promise<LearningCard[]>`

```ts
export type FirstResultInput = { state: Card; correct: boolean; reviewedAt: Date; eventType: "new_first" | "scheduled_first" };
export type RelearningInput = { state: Card; correctedAt: Date; sourceReviewEventId: string };
export type ScheduledReview = { card: Card; dueAt: Date; rating: "again" | "good"; eventType: "new_first" | "scheduled_first" | "same_session_relearning"; parameters: { request_retention: 0.9 } };

export type BuildTaskInput = {
  childId: string;
  newCardIds: string[];
  maxReviewCards: number;
  mode: "continuous_batch" | "item_by_item";
  order: "source" | "random";
  intervalSeconds: number;
  repeatCount: 1 | 2 | 3;
  speechRate: number;
  allowManualReplay: boolean;
};

export type LearningTask = { id: string; childId: string; mode: BuildTaskInput["mode"]; items: Array<{ cardId: string; kind: "due_review" | "new"; position: number }> };
```

- [ ] **Step 1: 安装FSRS并写90%保持率失败测试**

Run: `pnpm add ts-fsrs`

```ts
import { expect, test } from "vitest";
import { createInitialState, scheduleFirstResult } from "@/modules/review/scheduler";

test("正确与错误映射到Good和Again且保持率为90%", () => {
  const now = new Date("2026-09-01T08:00:00Z");
  const initial = createInitialState(now);
  const good = scheduleFirstResult({ state: initial, correct: true, reviewedAt: now });
  const again = scheduleFirstResult({ state: initial, correct: false, reviewedAt: now });
  expect(good.rating).toBe("good");
  expect(again.rating).toBe("again");
  expect(good.parameters.request_retention).toBe(0.9);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- tests/unit/fsrs-scheduler.test.ts`

Expected: FAIL，调度器不存在。

- [ ] **Step 3: 实现FSRS包装器**

```ts
import { createEmptyCard, fsrs, Rating, type Card } from "ts-fsrs";

const parameters = {
  request_retention: 0.9,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
} as const;

const scheduler = fsrs(parameters);

export function scheduleFirstResult(input: FirstResultInput): ScheduledReview {
  const rating = input.correct ? Rating.Good : Rating.Again;
  const result = scheduler.next(input.state, input.reviewedAt, rating);
  return {
    card: result.card,
    dueAt: result.card.due,
    rating: input.correct ? "good" : "again",
    eventType: input.eventType,
    parameters: { request_retention: 0.9 },
  };
}

export const createInitialState = (now: Date) => createEmptyCard(now);

export function markRelearningComplete(input: RelearningInput): ScheduledReview {
  const result = scheduler.next(input.state, input.correctedAt, Rating.Good);
  return {
    card: result.card,
    dueAt: result.card.due,
    rating: "good",
    eventType: "same_session_relearning",
    parameters: { request_retention: 0.9 },
  };
}
```

数据库同时保存可查询的`dueAt`和完整`cardJson`。首轮结果写`reviewEvents`，事件类型为`new_first`、`scheduled_first`或`same_session_relearning`；报告只把`scheduled_first`纳入保持率。

- [ ] **Step 4: 实现每日任务规划并测试**

```ts
test("到期卡片排在新卡片之前且积压按上限拆分", async () => {
  await fixture.dueCards(child, 25);
  await fixture.newCards(child, 10);
  const task = await buildDailyTask(parentActor, {
    childId: child.id,
    newCardIds: fixture.newCardIds.slice(0, 5),
    maxReviewCards: 20,
    mode: "continuous_batch",
  });
  expect(task.items.slice(0, 20).every((item) => item.kind === "due_review")).toBe(true);
  expect(task.items.filter((item) => item.kind === "new")).toHaveLength(5);
});
```

Run: `pnpm test:integration -- tests/integration/task-planner.test.ts`

Expected: PASS，剩余5张到期卡保持到期状态供下一短任务使用。

- [ ] **Step 5: 完成家长建任务页面**

页面先显示到期复习数量，再允许从教材单元、自建列表或搜索结果选择新卡片。设置项为模式、顺序、题间隔、播报次数、朗读速度、允许手动重听和本次复习上限。

- [ ] **Step 6: 提交**

```bash
git add package.json pnpm-lock.yaml src/modules/review src/modules/dictation/task-* src/db/schema.ts src/app/\(parent\)/parent/tasks src/app/api/parent/tasks tests/unit/fsrs-scheduler.test.ts tests/integration/task-planner.test.ts drizzle
git commit -m "feat: add learning tasks and fsrs scheduling"
```

### Task 4: 听写状态机、集中批改与错题循环

**Files:**
- Create: `src/modules/dictation/session-schema.ts`
- Create: `src/modules/dictation/session-types.ts`
- Create: `src/modules/dictation/session-machine.ts`
- Create: `src/modules/dictation/session-service.ts`
- Create: `src/modules/dictation/events.ts`
- Modify: `src/db/schema.ts`
- Test: `tests/unit/dictation-machine.test.ts`
- Test: `tests/integration/dictation-session.test.ts`
- Create: `drizzle/0006_dictation_sessions.sql`

**Interfaces:**
- Produces: `startSession(actor: ChildActor, taskId: string): Promise<DictationSnapshot>`
- Produces: `recordPlayback(actor: ChildActor, command: PlaybackCommand): Promise<DictationSnapshot>`
- Produces: `submitBatchMarks(actor: ChildActor, input: SubmitBatchMarksInput): Promise<DictationSnapshot>`
- Produces: `resumeSession(actor: ChildActor, sessionId: string): Promise<DictationSnapshot>`
- Produces event: `LearningTaskCompleted`

```ts
export type PlaybackCommand = { commandId: string; sessionId: string; roundNumber: number; playedItemIds: string[]; sequenceFinished: boolean };
export type SubmitBatchMarksInput = { commandId: string; sessionId: string; expectedVersion: number; marks: Array<{ itemId: string; correct: boolean }> };
export type DictationSnapshot = {
  sessionId: string;
  taskId: string;
  version: number;
  phase: "listening" | "grading" | "completed";
  roundNumber: number;
  currentRoundItemIds: string[];
  playedItemIds: string[];
  markedItemIds: string[];
};
export type DictationCommand = PlaybackCommand | SubmitBatchMarksInput;
```

- [ ] **Step 1: 写默认模式状态机失败测试**

```ts
import { expect, test } from "vitest";
import { createSessionState, reduceSession } from "@/modules/dictation/session-machine";

test("连续播完后集中批改，错题组成下一轮", () => {
  let state = createSessionState({ mode: "continuous_batch", itemIds: ["a", "b", "c"] });
  state = reduceSession(state, { type: "AUDIO_SEQUENCE_FINISHED" });
  expect(state.phase).toBe("grading");
  state = reduceSession(state, {
    type: "BATCH_MARKED",
    marks: [{ itemId: "a", correct: true }, { itemId: "b", correct: false }, { itemId: "c", correct: true }],
  });
  expect(state.phase).toBe("listening");
  expect(state.currentRoundItemIds).toEqual(["b"]);
  expect(state.roundNumber).toBe(2);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- tests/unit/dictation-machine.test.ts`

Expected: FAIL，状态机不存在。

- [ ] **Step 3: 实现纯状态机**

```ts
export type DictationPhase = "listening" | "grading" | "completed";

export type DictationState = {
  mode: "continuous_batch" | "item_by_item";
  phase: DictationPhase;
  roundNumber: number;
  currentRoundItemIds: string[];
  playedItemIds: string[];
  firstPassMarks: Record<string, boolean>;
  latestMarks: Record<string, boolean>;
};
```

状态机必须拒绝：未播完就批改、漏标题目、修改首轮结果、完成后再次批改、把不属于当前轮的题目提交。它只返回下一状态，不访问数据库。

- [ ] **Step 4: 实现事务服务和幂等提交**

数据表包含`sessions`、`rounds`、`sessionItems`、`answerEvents`和`completionEvents`。`submitBatchMarks`在单一事务中：锁定会话、验证版本号、追加答题事件、更新FSRS、生成下一轮或完成事件。请求携带`commandId`；相同`commandId`返回原快照。

```ts
test("最后答对不会覆盖首轮错误且完成事件只出现一次", async () => {
  const session = await fixture.startedSession(["a"]);
  await finishAudio(session, 1);
  await markBatch(session, [{ itemId: "a", correct: false }], "cmd-1");
  await finishAudio(session, 2);
  await markBatch(session, [{ itemId: "a", correct: true }], "cmd-2");
  await markBatch(session, [{ itemId: "a", correct: true }], "cmd-2");
  const report = await fixture.sessionFacts(session.id);
  expect(report.firstPassCorrect).toBe(false);
  expect(report.finalCorrect).toBe(true);
  expect(report.completionEvents).toHaveLength(1);
});
```

- [ ] **Step 5: 运行测试**

Run: `pnpm test -- tests/unit/dictation-machine.test.ts`

Expected: PASS，覆盖连续和逐题两种模式。

Run: `pnpm test:integration -- tests/integration/dictation-session.test.ts`

Expected: PASS，中断、重复命令、错题循环和首轮不可变测试全部通过。

- [ ] **Step 6: 提交**

```bash
git add src/modules/dictation src/modules/review src/db/schema.ts tests/unit/dictation-machine.test.ts tests/integration/dictation-session.test.ts drizzle
git commit -m "feat: add resumable dictation session engine"
```

### Task 5: 儿童听写界面与中断恢复

**Files:**
- Create: `src/app/(child)/child/tasks/page.tsx`
- Create: `src/app/(child)/child/dictation/[sessionId]/page.tsx`
- Create: `src/components/dictation/audio-sequence.tsx`
- Create: `src/components/dictation/batch-grader.tsx`
- Create: `src/components/dictation/session-progress.tsx`
- Create: `src/modules/dictation/client-resume.ts`
- Create: `src/app/api/child/tasks/[taskId]/start/route.ts`
- Create: `src/app/api/child/dictation/[sessionId]/route.ts`
- Create: `src/app/api/child/dictation/[sessionId]/commands/route.ts`
- Test: `tests/unit/client-resume.test.ts`
- Test: `e2e/dictation.spec.ts`

**Interfaces:**
- Consumes: `DictationSnapshot`、`startSession`、`recordPlayback`、`submitBatchMarks`、`resumeSession`
- Produces: local recovery key `dictation:{familyId}:{childId}:{sessionId}`

- [ ] **Step 1: 写共享设备恢复隔离失败测试**

```ts
import { expect, test } from "vitest";
import { resumeStorageKey } from "@/modules/dictation/client-resume";

test("恢复键包含家庭、孩子和会话", () => {
  expect(resumeStorageKey("f1", "c1", "s1")).toBe("dictation:f1:c1:s1");
  expect(resumeStorageKey("f1", "c2", "s1")).not.toBe(resumeStorageKey("f1", "c1", "s1"));
});
```

- [ ] **Step 2: 实现儿童交互**

听写页面监听浏览器自动播放限制，开始前显示一个明确的“开始听写”按钮。连续模式只显示题号、进度、暂停、继续和重听当前题；批改前不渲染答案文本。音频序列使用预加载完成标记，缺少音频时不开始并显示家长可理解的错误。

集中批改页面逐题显示编号和答案，必须全部标记后提交。错题新轮次显示“再听一次，共N题”，不显示惩罚性文案。

- [ ] **Step 3: 写完整E2E并确认先失败**

```ts
test("连续听写后集中批改并只循环错题", async ({ page }) => {
  await loginAsPairedChild(page, "小雨");
  await page.getByRole("button", { name: "开始听写" }).click();
  await expect(page.getByText("第 3 / 3 题")).toBeVisible();
  await page.getByRole("button", { name: "开始批改" }).click();
  await markAnswers(page, [true, false, true]);
  await expect(page.getByText("再听一次，共 1 题")).toBeVisible();
  await finishRetryAndMarkCorrect(page);
  await expect(page.getByText("本次听写已完成")).toBeVisible();
});
```

Run: `pnpm test:e2e -- e2e/dictation.spec.ts`

Expected before implementation: FAIL。实现后再次运行，Expected: PASS。

- [ ] **Step 4: 验证刷新和切换保护**

E2E增加：听到中间刷新继续原题；批改到中间刷新保留已标题目；正在听写点击切换孩子先弹出退出确认；确认后服务端已保存进度，返回原孩子可继续。

Run: `pnpm test -- tests/unit/client-resume.test.ts`

Expected: PASS。

Run: `pnpm test:e2e -- e2e/dictation.spec.ts`

Expected: Chromium和WebKit均PASS。

- [ ] **Step 5: 提交**

```bash
git add src/app/\(child\)/child/tasks src/app/\(child\)/child/dictation src/app/api/child src/components/dictation src/modules/dictation/client-resume.ts tests/unit/client-resume.test.ts e2e/dictation.spec.ts
git commit -m "feat: add continuous dictation child experience"
```

### Task 6: 单次、每周和单词报告

**Files:**
- Create: `src/modules/reports/types.ts`
- Create: `src/modules/reports/session-report.ts`
- Create: `src/modules/reports/weekly-report.ts`
- Create: `src/modules/reports/card-history.ts`
- Create: `src/app/(parent)/parent/reports/page.tsx`
- Create: `src/app/(parent)/parent/reports/sessions/[sessionId]/page.tsx`
- Create: `src/app/(parent)/parent/reports/cards/[cardId]/page.tsx`
- Create: `src/app/api/parent/reports/weekly/route.ts`
- Test: `tests/unit/report-metrics.test.ts`
- Test: `tests/integration/report-queries.test.ts`

**Interfaces:**
- Produces: `getSessionReport(actor: GuardianActor, sessionId: string): Promise<SessionReport>`
- Produces: `getWeeklyReport(actor: GuardianActor, childId: string, weekStart: Date): Promise<WeeklyReport>`
- Produces: `getCardHistory(actor: GuardianActor, childId: string, cardId: string): Promise<CardHistory>`

```ts
export type SessionReport = { sessionId: string; itemCount: number; firstPassAccuracy: number; finalCompletionRate: number; retryCount: number; completedAt: Date; selfGraded: true };
export type WeeklyReport = { childId: string; weekStart: Date; studyDays: number; completedTasks: number; firstPassAccuracy: number | null; dueReviewsCompleted: number; weakCards: Array<{ cardId: string; errorCount: number }> };
export type CardHistory = { cardId: string; nextDueAt: Date | null; attempts: Array<{ occurredAt: Date; round: number; correct: boolean; eventType: "new_first" | "scheduled_first" | "same_session_relearning" }> };
```

- [ ] **Step 1: 写指标口径失败测试**

```ts
import { expect, test } from "vitest";
import { calculateSessionMetrics } from "@/modules/reports/session-report";

test("首轮正确率与最终完成率分开", () => {
  const result = calculateSessionMetrics([
    { itemId: "a", round: 1, correct: true },
    { itemId: "b", round: 1, correct: false },
    { itemId: "b", round: 2, correct: true },
  ]);
  expect(result.firstPassAccuracy).toBe(0.5);
  expect(result.finalCompletionRate).toBe(1);
  expect(result.retryCount).toBe(1);
});
```

- [ ] **Step 2: 运行测试确认失败并实现纯计算**

Run: `pnpm test -- tests/unit/report-metrics.test.ts`

Expected before implementation: FAIL。

实现后再次运行，Expected: PASS。保持率只使用`eventType === "scheduled_first"`，不得使用`same_session_relearning`。

- [ ] **Step 3: 写家庭隔离查询测试**

```ts
test("家长只能查看本家庭报告", async () => {
  const other = await fixture.completedSessionInOtherFamily();
  await expect(getSessionReport(actor, other.sessionId)).rejects.toThrow("REPORT_NOT_FOUND");
});
```

Run: `pnpm test:integration -- tests/integration/report-queries.test.ts`

Expected: PASS。

- [ ] **Step 4: 实现家长报告页面**

首页顺序固定为：今日任务状态、待处理事项占位、今日薄弱词、明日预计复习。单次报告显示首轮正确率、最终完成率、错误词、每词错误次数、订正轮数、重听次数和完成时间，并标注“由孩子自主批改”。每周报告显示学习天数、完成量、首轮正确率趋势、到期复习完成量和最多10个薄弱词。

- [ ] **Step 5: 完整阶段验证与提交**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm test:e2e`

Expected: 全部退出0，0 failed。

```bash
git add src/modules/reports src/app/\(parent\)/parent/reports src/app/api/parent/reports tests/unit/report-metrics.test.ts tests/integration/report-queries.test.ts
git commit -m "feat: add actionable learning reports"
```

## 阶段2完成门槛

- 四种内容入口均可形成草稿或正式卡片；OCR必须确认。
- 两种听写模式都保留首轮错误、完成错题循环并可中断恢复。
- FSRS参数中`request_retention`为`0.9`，正确映射`Good`、错误映射`Again`。
- 报告明确区分首轮、最终完成和到期保持。
- TTS/OCR真实供应商未获授权时，阶段候选版本必须标注使用Fake Provider，不能声称已具备生产音频或OCR。
- 内置教材种子文件未经过实际教材逐条核对时，不能声称教材库已完成。
