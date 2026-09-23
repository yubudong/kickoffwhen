import { todoTasks } from '@/modules/todos/schema';
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq, inArray, isNull } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";

import { user as authUsers } from "@/modules/auth/schema";
import {
  createDictationTaskService,
  type BuildTaskInput,
} from "@/modules/dictation/task-service";
import { createTaskBuilderQueryService } from "@/modules/dictation/task-builder-query";
import { learningTaskItems, learningTasks } from "@/modules/dictation/task-schema";
import { children, families, guardians } from "@/modules/families/schema";
import { buildTtsDedupeKey, createJobService } from "@/modules/jobs/service";
import { jobs } from "@/modules/jobs/schema";
import { createJobWorker } from "@/modules/jobs/worker";
import {
  learningCards,
  textbookEditions,
  textbookUnits,
  textbookSections,
} from "@/modules/learning-content/schema";
import { privateMedia } from "@/modules/media/schema";
import { createPrivateMediaStore } from "@/modules/media/store";
import { childCardStates } from "@/modules/review/db-schema";
import { reviewEvents } from "@/modules/review/db-schema";
import { createReviewService } from "@/modules/review/service";
import { createInitialState, scheduleFirstResult } from "@/modules/review/scheduler";
import { serializeFsrsCard } from "@/modules/review/schema";

import { withDatabaseRollback } from "../helpers/database";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function makeFamily(tx: Parameters<Parameters<typeof withDatabaseRollback>[0]>[0], label: string) {
  const suffix = crypto.randomUUID();
  await tx.insert(authUsers).values({
    id: `task-${label}-${suffix}`,
    name: `家长${label}`,
    email: `task-${label}-${suffix}@example.test`,
  });
  const [family] = await tx.insert(families).values({ name: `任务家庭${label}-${suffix}` }).returning();
  const [guardian] = await tx.insert(guardians).values({
    familyId: family.id,
    authUserId: `task-${label}-${suffix}`,
  }).returning();
  const [child, sibling] = await tx.insert(children).values([
    { familyId: family.id, nickname: `${label}孩子`, grade: 5 },
    { familyId: family.id, nickname: `${label}弟妹`, grade: 5 },
  ]).returning();
  return {
    family,
    child,
    sibling,
    actor: {
      role: "guardian" as const,
      familyId: family.id,
      guardianId: guardian.id,
    },
  };
}

function taskInput(childId: string, newCardIds: string[], commandId = crypto.randomUUID()): BuildTaskInput {
  return {
    childId,
    newCardIds,
    commandId,
    maxReviewCards: 2,
    mode: "continuous_batch",
    order: "source",
    intervalSeconds: 8,
    repeatCount: 2,
    speechRate: 1,
    allowManualReplay: true,
  };
}

test("按科目创建的听写只包含同科目内容并同步创建待办", async () => {
  await withDatabaseRollback(async (tx) => {
    const { actor, child } = await makeFamily(tx, "subject");
    const now = new Date("2026-09-22T08:00:00Z");
    const [cnDue, enDue, cnNew, enNew] = await tx.insert(learningCards).values([
      { subject: "chinese", answerText: "到期语文" }, { subject: "english", answerText: "due" },
      { subject: "chinese", answerText: "新词" }, { subject: "english", answerText: "new" },
    ].map(c => ({ ...c, familyId: actor.familyId, broadcastText: c.answerText, source: "manual" }))).returning();
    const initial = createInitialState(new Date("2026-08-01T00:00:00Z"));
    await tx.insert(childCardStates).values([cnDue, enDue].map(c => ({ familyId: actor.familyId, childId: child.id, cardId: c.id, cardJson: serializeFsrsCard(initial), dueAt: initial.due })));
    const data = await createTaskBuilderQueryService(tx).getTaskBuilderData(actor, now);
    expect(data.children.find(c => c.id === child.id)).toMatchObject({ dueCount: 2, dueCounts: { chinese: 1, english: 1 } });
    const service = createDictationTaskService(tx, () => now);
    await expect(service.buildDailyTask(actor, { ...taskInput(child.id, [enNew.id]), subject: "chinese" })).rejects.toThrow("TASK_CARD_SUBJECT_MISMATCH");
    const task = await service.buildDailyTask(actor, { ...taskInput(child.id, [cnNew.id]), subject: "chinese" });
    expect(task.items.map(c => c.cardId)).toEqual([cnDue.id, cnNew.id]);
    const [todo] = await tx.select().from(todoTasks).where(eq(todoTasks.dictationTaskId, task.id));
    expect(todo).toMatchObject({
      childId: child.id,
      kind: "dictation",
      status: "open",
      title: "今日听写（2项）",
    });
    const after = await createTaskBuilderQueryService(tx).getTaskBuilderData(actor, now);
    expect(after.children.find(c => c.id === child.id)).toMatchObject({ dueCounts: { chinese: 0, english: 1 } });
  });
});

test("教材选择和任务原顺序按小节及词序排列，忽略插入时间", async () => {
  await withDatabaseRollback(async (tx) => {
    const { actor, child } = await makeFamily(tx, "section-order");
    const [edition] = await tx.insert(textbookEditions).values({ subject: "chinese", publisher: crypto.randomUUID(), series: "语文", grade: 5, volume: "上册", editionText: "2026" }).returning();
    const [unit] = await tx.insert(textbookUnits).values({ textbookEditionId: edition.id, unitOrder: 1, title: "第一单元" }).returning();
    const sections = await tx.insert(textbookSections).values([
      { unitId: unit.id, sectionKey: "lesson-1", sectionOrder: 1, title: "第1课", sectionType: "lesson" },
      { unitId: unit.id, sectionKey: "garden-1", sectionOrder: 2, title: "语文园地一", sectionType: "language_garden" },
    ]).returning();
    const inserted = await tx.insert(learningCards).values([
      { answerText: "园地", sectionId: sections[1]!.id, sourceOrder: 1 },
      { answerText: "故乡", sectionId: sections[0]!.id, sourceOrder: 2 },
      { answerText: "桂花", sectionId: sections[0]!.id, sourceOrder: 1 },
    ].map((c, i) => ({ ...c, familyId: actor.familyId, subject: "chinese", broadcastText: c.answerText, source: "manual", textbookEditionId: edition.id, unitId: unit.id, createdAt: new Date(1000 + i) }))).returning();
    const options = (await createTaskBuilderQueryService(tx).getTaskBuilderData(actor)).cards.filter(c => c.unitId === unit.id);
    expect(options.map(c => c.answerText)).toEqual(["桂花", "故乡", "园地"]);
    expect(options[0]).toMatchObject({ unitOrder: 1, sectionId: sections[0]!.id, sectionTitle: "第1课", sectionOrder: 1 });
    const task = await createDictationTaskService(tx).buildDailyTask(actor, taskInput(child.id, inserted.map(c => c.id)));
    expect(task.items.map(c => c.cardId)).toEqual([inserted[2]!.id, inserted[1]!.id, inserted[0]!.id]);
  });
});

test("到期复习优先且受上限约束，幂等重试不重复建任务", async () => {
  await withDatabaseRollback(async (tx) => {
    const { actor, child } = await makeFamily(tx, "A");
    const dueAt = new Date("2026-09-01T07:00:00.000Z");
    const now = new Date("2026-09-01T08:00:00.000Z");
    const dueCards = await tx.insert(learningCards).values(
      ["due-1", "due-2", "due-3"].map((text) => ({
        familyId: actor.familyId,
        subject: "english",
        answerText: text,
        broadcastText: text,
        source: "manual",
      })),
    ).returning();
    const newCards = await tx.insert(learningCards).values(
      ["新卡一", "新卡二"].map((text) => ({
        familyId: actor.familyId,
        subject: "chinese",
        answerText: text,
        broadcastText: text,
        source: "manual",
      })),
    ).returning();
    const state = scheduleFirstResult({
      state: createInitialState(new Date("2026-08-20T08:00:00.000Z")),
      correct: true,
      reviewedAt: new Date("2026-08-20T08:00:00.000Z"),
      eventType: "new_first",
    }).card;
    await tx.insert(childCardStates).values(dueCards.map((card) => ({
      familyId: actor.familyId,
      childId: child.id,
      cardId: card.id,
      cardJson: serializeFsrsCard({ ...state, due: dueAt }),
      dueAt,
    })));

    const service = createDictationTaskService(tx, () => now);
    const input = taskInput(child.id, newCards.map((card) => card.id));
    const first = await service.buildDailyTask(actor, input);
    const replay = await service.buildDailyTask(actor, input);

    expect(replay.id).toBe(first.id);
    const linkedTodos = await tx.select().from(todoTasks).where(eq(todoTasks.dictationTaskId, first.id));
    expect(linkedTodos).toHaveLength(1);
    expect(linkedTodos[0]).toMatchObject({ status: "open", kind: "dictation", childId: child.id });
    expect(first.items.map((item) => item.kind)).toEqual([
      "due_review",
      "due_review",
      "new",
      "new",
    ]);
    expect(first.items.map((item) => item.position)).toEqual([0, 1, 2, 3]);
    expect(first.audioStatus).toBe("preparing");
    const queuedVoices = (await tx
      .select({ payload: jobs.payload })
      .from(jobs)
      .where(inArray(jobs.dedupeKey, first.items.map((item) => item.ttsDedupeKey))))
      .map(({ payload }) => (payload as { voice?: string }).voice)
      .filter(Boolean);
    expect(queuedVoices).toContain("en-US-JennyNeural");
    expect(queuedVoices).toContain("zh-CN-XiaoxiaoNeural");
    expect(await service.getDueCards(
      { role: "child", familyId: actor.familyId, childId: child.id, deviceId: crypto.randomUUID() },
      now,
      10,
    )).toHaveLength(3);

    await expect(service.buildDailyTask(actor, { ...input, maxReviewCards: 1 }))
      .rejects.toThrow("TASK_IDEMPOTENCY_CONFLICT");
  });
});

test("连续建任务会排除已在当前孩子 active 任务中的 due 与 new 卡", async () => {
  await withDatabaseRollback(async (tx) => {
    const { actor, child } = await makeFamily(tx, "active-card-exclusion");
    const now = new Date("2026-09-01T08:00:00.000Z");
    const [dueCard, activeNewCard, availableNewCard] = await tx
      .insert(learningCards)
      .values([
        { familyId: actor.familyId, subject: "english", answerText: "due-active", broadcastText: "due-active", source: "manual" },
        { familyId: actor.familyId, subject: "english", answerText: "new-active", broadcastText: "new-active", source: "manual" },
        { familyId: actor.familyId, subject: "english", answerText: "new-available", broadcastText: "new-available", source: "manual" },
      ])
      .returning();
    const dueState = createInitialState(new Date("2026-08-01T00:00:00.000Z"));
    await tx.insert(childCardStates).values({
      familyId: actor.familyId,
      childId: child.id,
      cardId: dueCard.id,
      cardJson: serializeFsrsCard(dueState),
      dueAt: dueState.due,
    });
    const service = createDictationTaskService(tx, () => now);
    const firstInput = {
      ...taskInput(child.id, [activeNewCard.id]),
      maxReviewCards: 1,
    };

    const first = await service.buildDailyTask(actor, firstInput);
    const replay = await service.buildDailyTask(actor, firstInput);
    expect(replay.id).toBe(first.id);
    expect(first.items.map((item) => item.cardId)).toEqual([dueCard.id, activeNewCard.id]);

    const second = await service.buildDailyTask(actor, {
      ...taskInput(child.id, [activeNewCard.id, availableNewCard.id]),
      maxReviewCards: 1,
    });
    expect(second.items.map((item) => item.cardId)).toEqual([availableNewCard.id]);

    await expect(service.buildDailyTask(actor, {
      ...taskInput(child.id, [activeNewCard.id]),
      maxReviewCards: 1,
    })).rejects.toThrow("TASK_EMPTY");
  });
});

test("source 顺序不信任客户端点击顺序，random 使用可注入 RNG 且 due 仍优先", async () => {
  await withDatabaseRollback(async (tx) => {
    const { actor, child } = await makeFamily(tx, "source-order");
    const cards = await tx.insert(learningCards).values([
      { familyId: actor.familyId, subject: "english", answerText: "manual", broadcastText: "manual", source: "manual" },
      { familyId: actor.familyId, subject: "english", answerText: "bulk", broadcastText: "bulk", source: "bulk" },
      { familyId: actor.familyId, subject: "english", answerText: "ocr", broadcastText: "ocr", source: "ocr" },
    ]).returning();
    const [edition] = await tx.insert(textbookEditions).values({
      publisher: "测试出版社",
      series: "测试系列",
      subject: "english",
      grade: 5,
      volume: "上册",
      editionText: `测试版-${crypto.randomUUID()}`,
    }).returning();
    const units = await tx.insert(textbookUnits).values([
      { textbookEditionId: edition.id, unitOrder: 1, title: "Unit 1" },
      { textbookEditionId: edition.id, unitOrder: 2, title: "Unit 2" },
    ]).returning();
    const textbookCards = await tx.insert(learningCards).values([
      {
        familyId: null,
        subject: "english",
        answerText: "unit-2",
        broadcastText: "unit-2",
        textbookEditionId: edition.id,
        unitId: units[1].id,
        source: "builtin",
        builtinKey: `source-unit-2-${crypto.randomUUID()}`,
      },
      {
        familyId: null,
        subject: "english",
        answerText: "unit-1",
        broadcastText: "unit-1",
        textbookEditionId: edition.id,
        unitId: units[0].id,
        source: "builtin",
        builtinKey: `source-unit-1-${crypto.randomUUID()}`,
      },
    ]).returning();
    const [dueCard] = await tx.insert(learningCards).values({
      familyId: actor.familyId,
      subject: "english",
      answerText: "due-first",
      broadcastText: "due-first",
      source: "manual",
    }).returning();
    const dueState = createInitialState(new Date("2026-08-01T00:00:00.000Z"));
    await tx.insert(childCardStates).values({
      familyId: actor.familyId,
      childId: child.id,
      cardId: dueCard.id,
      cardJson: serializeFsrsCard(dueState),
      dueAt: dueState.due,
    });
    const sourceTask = await createDictationTaskService(tx).buildDailyTask(
      actor,
      {
        ...taskInput(child.id, [
          cards[2].id,
          textbookCards[0].id,
          cards[1].id,
          textbookCards[1].id,
          cards[0].id,
        ]),
        maxReviewCards: 1,
      },
    );
    expect(sourceTask.items.map((item) => item.cardId)).toEqual([
      dueCard.id,
      textbookCards[1].id,
      textbookCards[0].id,
      cards[0].id,
      cards[1].id,
      cards[2].id,
    ]);
    await tx
      .update(learningTasks)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(learningTasks.id, sourceTask.id));

    const randomTask = await createDictationTaskService(tx, () => new Date(), () => 0)
      .buildDailyTask(actor, {
        ...taskInput(child.id, cards.map((card) => card.id)),
        commandId: crypto.randomUUID(),
        maxReviewCards: 1,
        order: "random",
      });
    expect(randomTask.items.map((item) => item.cardId)).toEqual([
      dueCard.id,
      cards[1].id,
      cards[2].id,
      cards[0].id,
    ]);
    expect(randomTask.items.map((item) => item.kind)).toEqual([
      "due_review",
      "new",
      "new",
      "new",
    ]);
  });
});

test("无效设置、重复卡片、跨家庭孩子和卡片全部拒绝", async () => {
  await withDatabaseRollback(async (tx) => {
    const familyA = await makeFamily(tx, "A-negative");
    const familyB = await makeFamily(tx, "B-negative");
    const [cardA] = await tx.insert(learningCards).values({
      familyId: familyA.family.id,
      subject: "english",
      answerText: "apple",
      broadcastText: "apple",
      source: "manual",
    }).returning();
    const [cardB] = await tx.insert(learningCards).values({
      familyId: familyB.family.id,
      subject: "english",
      answerText: "secret",
      broadcastText: "secret",
      source: "manual",
    }).returning();
    const service = createDictationTaskService(tx);

    await expect(service.buildDailyTask(familyA.actor, taskInput(familyB.child.id, [])))
      .rejects.toThrow("CHILD_NOT_FOUND");
    await expect(service.buildDailyTask(familyA.actor, taskInput(familyA.child.id, [cardB.id])))
      .rejects.toThrow("TASK_CARD_NOT_FOUND");
    await expect(service.buildDailyTask(familyA.actor, taskInput(familyA.child.id, [cardA.id, cardA.id])))
      .rejects.toThrow("TASK_CARD_DUPLICATE");
    await expect(service.buildDailyTask(familyA.actor, { ...taskInput(familyA.child.id, []), speechRate: 4 }))
      .rejects.toThrow();
  });
});

test("任务只通过现有去重键排队和识别音频就绪，儿童仅能读取自己活动任务的 TTS", async () => {
  await withDatabaseRollback(async (tx) => {
    const root = await mkdtemp(path.join(tmpdir(), "task-media-"));
    temporaryRoots.push(root);
    const { actor, child, sibling } = await makeFamily(tx, "media");
    const [card] = await tx.insert(learningCards).values({
      familyId: actor.familyId,
      subject: "chinese",
      answerText: "山峰",
      broadcastText: "山峰",
      source: "manual",
    }).returning();
    const input = taskInput(child.id, [card.id]);
    const service = createDictationTaskService(tx);
    const task = await service.buildDailyTask(actor, input);
    const item = task.items[0];

    expect(item.audioStatus).toBe("queued");
    expect(await tx.select().from(jobs).where(eq(jobs.dedupeKey, item.ttsDedupeKey))).toHaveLength(1);

    const expectedDedupeKey = buildTtsDedupeKey({
      familyId: actor.familyId,
      childId: child.id,
      cardId: card.id,
      text: card.broadcastText,
      language: "zh-CN",
      voice: "zh-CN-XiaoxiaoNeural",
      rate: input.speechRate,
    });
    expect(item.ttsDedupeKey).toBe(expectedDedupeKey);

    const store = createPrivateMediaStore({ database: tx, root });
    const media = await store.put({
      familyId: actor.familyId,
      childId: child.id,
      kind: "tts_audio",
      bytes: new TextEncoder().encode("fake audio"),
      mimeType: "audio/mpeg",
      expiresAt: null,
      dedupeKey: expectedDedupeKey,
    });
    const refreshed = await service.getTask(actor, task.id);
    expect(refreshed.audioStatus).toBe("ready");
    expect(refreshed.items[0]).toMatchObject({ audioStatus: "ready", mediaId: media.id });

    const opened = await store.open(
      { role: "child", familyId: actor.familyId, childId: child.id, deviceId: crypto.randomUUID() },
      media.id,
    );
    await opened.cancel();
    await expect(store.open(
      { role: "child", familyId: actor.familyId, childId: sibling.id, deviceId: crypto.randomUUID() },
      media.id,
    )).rejects.toThrow("MEDIA_NOT_FOUND");

    await tx.update(learningTasks).set({ status: "completed" }).where(eq(learningTasks.id, task.id));
    await expect(store.open(
      { role: "child", familyId: actor.familyId, childId: child.id, deviceId: crypto.randomUUID() },
      media.id,
    )).rejects.toThrow("MEDIA_NOT_FOUND");
    await tx.update(learningTasks).set({ status: "cancelled" }).where(eq(learningTasks.id, task.id));
    await expect(store.open(
      { role: "child", familyId: actor.familyId, childId: child.id, deviceId: crypto.randomUUID() },
      media.id,
    )).rejects.toThrow("MEDIA_NOT_FOUND");

    const [ocr] = await tx.insert(privateMedia).values({
      familyId: actor.familyId,
      childId: null,
      kind: "ocr_source",
      mimeType: "image/png",
      byteSize: 1,
      sha256: "a".repeat(64),
      relativePath: `${crypto.randomUUID().slice(0, 2)}/placeholder`,
    }).returning();
    await expect(store.open(
      { role: "child", familyId: actor.familyId, childId: child.id, deviceId: crypto.randomUUID() },
      ocr.id,
    )).rejects.toThrow("MEDIA_NOT_FOUND");
  });
});

test("过期 TTS 会重排 succeeded job，fake worker 原子替换后任务 ready", async () => {
  await withDatabaseRollback(async (tx) => {
    const root = await mkdtemp(path.join(tmpdir(), "task-expired-media-"));
    temporaryRoots.push(root);
    const now = new Date("2026-09-01T00:00:00.000Z");
    const { actor, child } = await makeFamily(tx, "expired-audio");
    const [card] = await tx.insert(learningCards).values({
      familyId: actor.familyId,
      subject: "english",
      answerText: "expired",
      broadcastText: "expired",
      source: "manual",
    }).returning();
    const input = { ...taskInput(child.id, [card.id]), maxReviewCards: 0 };
    const dedupeKey = buildTtsDedupeKey({
      familyId: actor.familyId,
      childId: child.id,
      cardId: card.id,
      text: card.broadcastText,
      language: "en-US",
      voice: "en-US-JennyNeural",
      rate: input.speechRate,
    });
    const store = createPrivateMediaStore({ database: tx, root, now: () => now });
    const expired = await store.put({
      familyId: actor.familyId,
      childId: child.id,
      kind: "tts_audio",
      bytes: new TextEncoder().encode("expired audio"),
      mimeType: "audio/mpeg",
      dedupeKey,
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    const payload = {
      familyId: actor.familyId,
      childId: child.id,
      cardId: card.id,
      text: card.broadcastText,
      language: "en-US" as const,
      voice: "en-US-JennyNeural" as const,
      rate: input.speechRate,
    };
    const jobService = createJobService(tx, () => now);
    const existingJob = await jobService.enqueueJob("generate_tts", payload, dedupeKey);
    await tx
      .update(jobs)
      .set({ status: "succeeded", attempts: 1 })
      .where(eq(jobs.id, existingJob.id));

    const service = createDictationTaskService(tx, () => now);
    const task = await service
      .buildDailyTask(actor, input);
    expect(task.audioStatus).toBe("preparing");
    expect(task.items[0]).toMatchObject({ audioStatus: "queued", mediaId: null });
    expect(await jobService.getJob(existingJob.id)).toMatchObject({
      status: "queued",
      attempts: 0,
    });

    let syntheses = 0;
    const workerOptions = {
      database: tx,
      mediaStore: store,
      ttsProvider: {
        async synthesize() {
          syntheses += 1;
          await Promise.resolve();
          return {
            bytes: new TextEncoder().encode("fresh audio"),
            mimeType: "audio/mpeg" as const,
          };
        },
      },
      now: () => now,
      claimDedupeKeys: [dedupeKey],
    };
    await Promise.all([
      createJobWorker(workerOptions).runOnce(),
      createJobWorker(workerOptions).runOnce(),
    ]);
    expect(syntheses).toBe(1);

    const activeRows = await tx
      .select()
      .from(privateMedia)
      .where(
        isNull(privateMedia.deletedAt),
      );
    const active = activeRows.find((row) => row.dedupeKey === dedupeKey);
    expect(active).toBeDefined();
    expect(active?.id).not.toBe(expired.id);
    expect(await service.getTask(actor, task.id)).toMatchObject({
      audioStatus: "ready",
      items: [{ audioStatus: "ready", mediaId: active?.id }],
    });
    await expect(store.open(
      {
        role: "child",
        familyId: actor.familyId,
        childId: child.id,
        deviceId: crypto.randomUUID(),
      },
      expired.id,
    )).rejects.toThrow("MEDIA_NOT_FOUND");
    const opened = await store.open(
      {
        role: "child",
        familyId: actor.familyId,
        childId: child.id,
        deviceId: crypto.randomUUID(),
      },
      active!.id,
    );
    expect(new TextDecoder().decode(await (async () => {
      const reader = opened.getReader();
      const result = await reader.read();
      await reader.cancel();
      return result.value;
    })())).toBe("fresh audio");
  });
});

test("任务 item 的数据库卡片范围约束拒绝跨家庭直接写入", async () => {
  await withDatabaseRollback(async (tx) => {
    const familyA = await makeFamily(tx, "task-db-a");
    const familyB = await makeFamily(tx, "task-db-b");
    const [cardA] = await tx.insert(learningCards).values({
      familyId: familyA.family.id,
      subject: "english",
      answerText: "allowed",
      broadcastText: "allowed",
      source: "manual",
    }).returning();
    const [cardB] = await tx.insert(learningCards).values({
      familyId: familyB.family.id,
      subject: "english",
      answerText: "forbidden",
      broadcastText: "forbidden",
      source: "manual",
    }).returning();
    const task = await createDictationTaskService(tx).buildDailyTask(
      familyA.actor,
      { ...taskInput(familyA.child.id, [cardA.id]), maxReviewCards: 0 },
    );

    await expect(tx.transaction(async (nested) => {
      await nested.insert(learningTaskItems).values({
        taskId: task.id,
        familyId: familyA.family.id,
        childId: familyA.child.id,
        cardId: cardB.id,
        cardFamilyId: familyA.family.id,
        kind: "new",
        position: 99,
        ttsDedupeKey: `scope-test:${crypto.randomUUID()}`,
      });
    })).rejects.toThrow();
    expect(await tx.select().from(learningTaskItems).where(eq(learningTaskItems.taskId, task.id)))
      .toHaveLength(1);
  });
});

test("建任务页与创建服务一致排除 active 任务中的 due 与 new 卡", async () => {
  await withDatabaseRollback(async (tx) => {
    const familyA = await makeFamily(tx, "builder-a");
    const familyB = await makeFamily(tx, "builder-b");
    const [cardA] = await tx.insert(learningCards).values({
      familyId: familyA.family.id,
      subject: "chinese",
      answerText: "A家卡",
      broadcastText: "A家卡",
      source: "manual",
    }).returning();
    const [cardB] = await tx.insert(learningCards).values({
      familyId: familyB.family.id,
      subject: "chinese",
      answerText: "B家卡",
      broadcastText: "B家卡",
      source: "manual",
    }).returning();
    const [builtin] = await tx.insert(learningCards).values({
      familyId: null,
      subject: "english",
      answerText: "builtin-safe",
      broadcastText: "builtin-safe",
      source: "builtin",
      builtinKey: `builder-${crypto.randomUUID()}`,
    }).returning();
    const dueAt = new Date("2026-09-01T07:00:00.000Z");
    const state = createInitialState(dueAt);
    await tx.insert(childCardStates).values({
      familyId: familyA.family.id,
      childId: familyA.child.id,
      cardId: cardA.id,
      cardJson: serializeFsrsCard(state),
      dueAt,
    });
    await createDictationTaskService(tx, () => new Date("2026-09-01T08:00:00.000Z"))
      .buildDailyTask(familyA.actor, {
        ...taskInput(familyA.child.id, [builtin.id]),
        maxReviewCards: 1,
      });

    const data = await createTaskBuilderQueryService(tx).getTaskBuilderData(
      familyA.actor,
      new Date("2026-09-01T08:00:00.000Z"),
    );
    expect(data.cards.map((card) => card.id)).toEqual(expect.arrayContaining([cardA.id, builtin.id]));
    expect(data.cards.map((card) => card.id)).not.toContain(cardB.id);
    expect(data.cards.find((card) => card.id === cardA.id)?.startedChildIds)
      .toContain(familyA.child.id);
    expect(data.cards.find((card) => card.id === builtin.id)?.startedChildIds)
      .toContain(familyA.child.id);
    expect(data.children.find((child) => child.id === familyA.child.id)?.dueCount).toBe(0);
  });
});

test("首轮遗忘与同场订正持久化为两种不可混淆的事件", async () => {
  await withDatabaseRollback(async (tx) => {
    const { actor, child } = await makeFamily(tx, "review-event");
    const [card] = await tx.insert(learningCards).values({
      familyId: actor.familyId,
      subject: "english",
      answerText: "memory",
      broadcastText: "memory",
      source: "manual",
    }).returning();
    const childActor = {
      role: "child" as const,
      familyId: actor.familyId,
      childId: child.id,
      deviceId: crypto.randomUUID(),
    };
    const service = createReviewService(tx);
    const first = await service.recordFirstResult(childActor, {
      cardId: card.id,
      commandId: crypto.randomUUID(),
      correct: false,
      reviewedAt: new Date("2026-09-01T08:00:00.000Z"),
      eventType: "new_first",
    });
    await service.markRelearningComplete(childActor, {
      cardId: card.id,
      commandId: crypto.randomUUID(),
      correctedAt: new Date("2026-09-01T08:10:00.000Z"),
      sourceReviewEventId: first.reviewEventId,
    });

    const events = await tx.select().from(reviewEvents).where(eq(reviewEvents.cardId, card.id));
    expect(events.map((event) => event.eventType)).toEqual([
      "new_first",
      "same_session_relearning",
    ]);
    expect(events[1].sourceReviewEventId).toBe(events[0].id);
    const [state] = await tx.select().from(childCardStates).where(eq(childCardStates.cardId, card.id));
    expect(new Date((state.cardJson as { due: string }).due)).toEqual(state.dueAt);
  });
});

test("数据库触发器也拒绝将其他家庭的卡片挂到孩子 FSRS 状态", async () => {
  await withDatabaseRollback(async (tx) => {
    const familyA = await makeFamily(tx, "db-scope-a");
    const familyB = await makeFamily(tx, "db-scope-b");
    const [cardB] = await tx.insert(learningCards).values({
      familyId: familyB.family.id,
      subject: "chinese",
      answerText: "不可跨家庭",
      broadcastText: "不可跨家庭",
      source: "manual",
    }).returning();
    const state = createInitialState(new Date());

    let caught: unknown;
    try {
      await tx.transaction(async (nested) => {
        await nested.insert(childCardStates).values({
          familyId: familyA.family.id,
          childId: familyA.child.id,
          cardId: cardB.id,
          cardJson: serializeFsrsCard(state),
          dueAt: state.due,
        });
      });
    } catch (error) {
      caught = error;
    }
    const messages: string[] = [];
    let current = caught;
    while (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
    }
    expect(messages.join("\n")).toContain("LEARNING_CARD_FAMILY_SCOPE_INVALID");
  });
});
