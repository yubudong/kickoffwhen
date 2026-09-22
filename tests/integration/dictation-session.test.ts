import { asc, count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { describe, expect, test } from "vitest";

import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { user as authUsers } from "@/modules/auth/schema";
import {
  dictationAnswerEvents,
  dictationCommands,
  dictationCompletionEvents,
  dictationPlaybackEvents,
  dictationRoundItems,
  dictationRounds,
  dictationSessionItems,
  dictationSessions,
} from "@/modules/dictation/session-schema";
import { createDictationSessionService } from "@/modules/dictation/session-service";
import { learningTaskItems, learningTasks } from "@/modules/dictation/task-schema";
import { children, families, guardians } from "@/modules/families/schema";
import { learningCards } from "@/modules/learning-content/schema";
import { privateMedia } from "@/modules/media/schema";
import { createPrivateMediaStore } from "@/modules/media/store";
import { childCardStates, reviewEvents } from "@/modules/review/db-schema";
import { createReviewService } from "@/modules/review/service";

import { withDatabaseRollback } from "../helpers/database";

type TestDatabase = typeof db;
type TestTx = Parameters<Parameters<typeof withDatabaseRollback>[0]>[0];

async function expectSavepointRejection(
  tx: TestTx,
  write: (nested: TestTx) => Promise<unknown>,
  message: string,
) {
  const error = await tx.transaction(write).then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).not.toBeNull();
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  expect(messages.join("\n")).toContain(message);
}

async function makeFamily(tx: TestTx, label: string) {
  const suffix = crypto.randomUUID();
  const authUserId = `dictation-${label}-${suffix}`;
  await tx.insert(authUsers).values({
    id: authUserId,
    name: `听写家长-${label}`,
    email: `${authUserId}@example.test`,
  });
  const [family] = await tx.insert(families).values({ name: `听写家庭-${label}-${suffix}` }).returning();
  await tx.insert(guardians).values({ familyId: family.id, authUserId });
  const [child, sibling] = await tx.insert(children).values([
    { familyId: family.id, nickname: `孩子-${label}`, grade: 5 },
    { familyId: family.id, nickname: `兄弟-${label}`, grade: 5 },
  ]).returning();
  return {
    authUserId,
    family,
    child,
    sibling,
    actor: {
      role: "child" as const,
      familyId: family.id,
      childId: child.id,
      deviceId: crypto.randomUUID(),
    },
  };
}

async function makeTask(
  tx: TestTx,
  input: {
    familyId: string;
    childId: string;
    mode?: "continuous_batch" | "item_by_item";
    itemKinds?: Array<"new" | "due_review">;
    ready?: boolean;
    status?: "active" | "completed" | "cancelled";
    allowManualReplay?: boolean;
  },
) {
  const [guardian] = await tx
    .select()
    .from(guardians)
    .where(eq(guardians.familyId, input.familyId))
    .limit(1);
  const kinds = input.itemKinds ?? ["new"];
  const cards = await tx
    .insert(learningCards)
    .values(kinds.map((_, index) => ({
      familyId: input.familyId,
      subject: "english",
      answerText: `answer-${index}-${crypto.randomUUID()}`,
      broadcastText: `broadcast-${index}`,
      source: "manual",
    })))
    .returning();
  const [task] = await tx.insert(learningTasks).values({
    familyId: input.familyId,
    childId: input.childId,
    guardianId: guardian.id,
    commandId: crypto.randomUUID(),
    inputFingerprint: "a".repeat(64),
    mode: input.mode ?? "continuous_batch",
    taskOrder: "source",
    intervalSeconds: 8,
    repeatCount: 1,
    speechRate: "1",
    allowManualReplay: input.allowManualReplay ?? true,
    maxReviewCards: kinds.filter((kind) => kind === "due_review").length,
    status: input.status ?? "active",
    ...(input.status === "completed" ? { completedAt: new Date() } : {}),
  }).returning();
  const items = await tx.insert(learningTaskItems).values(cards.map((card, position) => ({
    taskId: task.id,
    familyId: input.familyId,
    childId: input.childId,
    cardId: card.id,
    cardFamilyId: input.familyId,
    kind: kinds[position]!,
    position,
    ttsDedupeKey: `tts:${input.familyId}:${input.childId}:${card.id}:${crypto.randomUUID()}`,
  }))).returning();
  if (input.ready !== false) {
    await tx.insert(privateMedia).values(items.map((item) => ({
      familyId: input.familyId,
      childId: input.childId,
      kind: "tts_audio",
      mimeType: "audio/mpeg",
      byteSize: 1,
      sha256: "0".repeat(64),
      relativePath: `tests/${crypto.randomUUID()}.mp3`,
      dedupeKey: item.ttsDedupeKey,
    })));
  }
  return { task, items, cards };
}

const fixedNow = () => new Date("2026-09-02T08:00:00.000Z");

describe("dictation session lifecycle", () => {
  test("启动幂等、中断精确恢复、播放重试不重复计数且命令指纹防冲突", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await makeFamily(tx, "resume");
      const { task, items } = await makeTask(tx, {
        familyId: family.family.id,
        childId: family.child.id,
        itemKinds: ["new", "new"],
      });
      const service = createDictationSessionService(tx, fixedNow);
      const started = await service.startSession(family.actor, task.id);
      const retriedStart = await service.startSession(family.actor, task.id);
      expect(retriedStart).toEqual(started);

      await expect(service.recordPlayback(family.actor, {
        commandId: crypto.randomUUID(),
        sessionId: started.sessionId,
        expectedVersion: 0,
        roundNumber: 1,
        playedItemIds: [items[1]!.id],
        sequenceFinished: false,
      })).rejects.toThrow("PLAYBACK_OUT_OF_ORDER");

      const commandId = crypto.randomUUID();
      const afterOne = await service.recordPlayback(family.actor, {
        commandId,
        sessionId: started.sessionId,
        expectedVersion: 0,
        roundNumber: 1,
        playedItemIds: [items[0]!.id],
        sequenceFinished: false,
      });
      expect(afterOne).toMatchObject({ version: 1, phase: "listening" });
      expect(afterOne.replayCounts[items[0]!.id]).toBe(1);
      expect(await service.resumeSession(family.actor, started.sessionId)).toEqual(afterOne);
      const [beforeStale] = await tx.select().from(dictationSessions)
        .where(eq(dictationSessions.id, started.sessionId));
      await expect(service.recordPlayback(family.actor, {
        commandId: crypto.randomUUID(),
        sessionId: started.sessionId,
        expectedVersion: 0,
        roundNumber: 1,
        playedItemIds: [items[0]!.id],
        sequenceFinished: false,
      })).rejects.toThrow("DICTATION_VERSION_CONFLICT");
      const [afterStale] = await tx.select().from(dictationSessions)
        .where(eq(dictationSessions.id, started.sessionId));
      expect(afterStale.updatedAt).toEqual(beforeStale.updatedAt);
      expect(await service.recordPlayback(family.actor, {
        commandId,
        sessionId: started.sessionId,
        expectedVersion: 0,
        roundNumber: 1,
        playedItemIds: [items[0]!.id],
        sequenceFinished: false,
      })).toEqual(afterOne);
      expect((await tx.select().from(dictationPlaybackEvents)).filter((row) => row.sessionId === started.sessionId)).toHaveLength(1);
      await expect(service.recordPlayback(family.actor, {
        commandId,
        sessionId: started.sessionId,
        expectedVersion: 1,
        roundNumber: 1,
        playedItemIds: [items[1]!.id],
        sequenceFinished: false,
      })).rejects.toThrow("DICTATION_IDEMPOTENCY_CONFLICT");

      const replayCommand = {
        commandId: crypto.randomUUID(),
        sessionId: started.sessionId,
        expectedVersion: 1,
        roundNumber: 1,
        playedItemIds: [items[0]!.id],
        sequenceFinished: false,
      };
      const replayed = await service.recordPlayback(family.actor, replayCommand);
      expect(replayed).toMatchObject({
        version: 2,
        phase: "listening",
        playedItemIds: [items[0]!.id],
      });
      expect(replayed.replayCounts[items[0]!.id]).toBe(2);
      const [beforeReplayRetry] = await tx.select().from(dictationSessions)
        .where(eq(dictationSessions.id, started.sessionId));
      expect(await service.recordPlayback(family.actor, replayCommand)).toEqual(replayed);
      const [afterReplayRetry] = await tx.select().from(dictationSessions)
        .where(eq(dictationSessions.id, started.sessionId));
      expect(afterReplayRetry.updatedAt).toEqual(beforeReplayRetry.updatedAt);

      const grading = await service.recordPlayback(family.actor, {
        commandId: crypto.randomUUID(),
        sessionId: started.sessionId,
        expectedVersion: 2,
        roundNumber: 1,
        playedItemIds: [items[1]!.id],
        sequenceFinished: true,
      });
      expect(grading).toMatchObject({ version: 3, phase: "grading" });
      expect(grading.replayCounts).toEqual({ [items[0]!.id]: 2, [items[1]!.id]: 1 });
    });
  });

  test("allowManualReplay=false 拒绝重听且不写事件、计数、版本或时间", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await makeFamily(tx, "no-replay");
      const { task, items } = await makeTask(tx, {
        familyId: family.family.id,
        childId: family.child.id,
        itemKinds: ["new", "new"],
        allowManualReplay: false,
      });
      const service = createDictationSessionService(tx, fixedNow);
      const started = await service.startSession(family.actor, task.id);
      const progressed = await service.recordPlayback(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: 0, roundNumber: 1,
        playedItemIds: [items[0]!.id], sequenceFinished: false,
      });
      const [before] = await tx.select().from(dictationSessions)
        .where(eq(dictationSessions.id, started.sessionId));
      const beforeEvents = await tx.select().from(dictationPlaybackEvents)
        .where(eq(dictationPlaybackEvents.sessionId, started.sessionId));
      await expect(service.recordPlayback(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: progressed.version, roundNumber: 1,
        playedItemIds: [items[0]!.id], sequenceFinished: false,
      })).rejects.toThrow("PLAYBACK_REPLAY_NOT_ALLOWED");
      const [after] = await tx.select().from(dictationSessions)
        .where(eq(dictationSessions.id, started.sessionId));
      const afterEvents = await tx.select().from(dictationPlaybackEvents)
        .where(eq(dictationPlaybackEvents.sessionId, started.sessionId));
      expect(after.version).toBe(before.version);
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect(afterEvents).toEqual(beforeEvents);
      expect((await service.resumeSession(family.actor, started.sessionId)).replayCounts[items[0]!.id]).toBe(1);
    });
  });

  test("首轮错误只写一次调度事件，订正链接原错误，完成事件仅一次", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await makeFamily(tx, "complete");
      const { task, items, cards } = await makeTask(tx, {
        familyId: family.family.id,
        childId: family.child.id,
      });
      const service = createDictationSessionService(tx, fixedNow);
      const started = await service.startSession(family.actor, task.id);
      const grading1 = await service.recordPlayback(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: 0, roundNumber: 1,
        playedItemIds: [items[0]!.id], sequenceFinished: true,
      });
      const round2 = await service.submitBatchMarks(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: grading1.version, roundNumber: 1,
        marks: [{ itemId: items[0]!.id, correct: false }],
      });
      const grading2 = await service.recordPlayback(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: round2.version, roundNumber: 2,
        playedItemIds: [items[0]!.id], sequenceFinished: true,
      });
      const completionCommandId = crypto.randomUUID();
      const completed = await service.submitBatchMarks(family.actor, {
        commandId: completionCommandId, sessionId: started.sessionId,
        expectedVersion: grading2.version, roundNumber: 2,
        marks: [{ itemId: items[0]!.id, correct: true }],
      });
      expect(completed).toMatchObject({ phase: "completed", version: 4 });
      expect(await service.submitBatchMarks(family.actor, {
        commandId: completionCommandId, sessionId: started.sessionId,
        expectedVersion: grading2.version, roundNumber: 2,
        marks: [{ itemId: items[0]!.id, correct: true }],
      })).toEqual(completed);

      const answers = await tx.select().from(dictationAnswerEvents).where(eq(dictationAnswerEvents.sessionId, started.sessionId));
      expect(answers.map((row) => [row.correct, row.eventRole])).toEqual([
        [false, "first_pass"],
        [true, "same_session_relearning"],
      ]);
      const reviews = await tx.select().from(reviewEvents).where(eq(reviewEvents.cardId, cards[0]!.id));
      expect(reviews.map((row) => row.eventType)).toEqual(["new_first", "same_session_relearning"]);
      expect(reviews[1]!.sourceReviewEventId).toBe(reviews[0]!.id);
      const [itemFact] = await tx.select().from(dictationSessionItems).where(eq(dictationSessionItems.sessionId, started.sessionId));
      expect(itemFact).toMatchObject({ firstCorrect: false, finalCorrect: true, replayCount: 2 });
      expect(await tx.select().from(dictationCompletionEvents).where(eq(dictationCompletionEvents.sessionId, started.sessionId))).toHaveLength(1);
      const storedCommands = await tx.select().from(dictationCommands).where(eq(dictationCommands.sessionId, started.sessionId));
      for (const stored of storedCommands) {
        const serialized = JSON.stringify(stored.resultSnapshot);
        expect(serialized).not.toContain("answerText");
        expect(serialized).not.toContain("broadcastText");
        expect(serialized).not.toContain("firstPassMarks");
        expect(serialized).not.toContain("latestMarks");
      }
      const [storedTask] = await tx.select().from(learningTasks).where(eq(learningTasks.id, task.id));
      expect(storedTask.status).toBe("completed");
      await expect(service.resumeSession(family.actor, started.sessionId)).rejects.toThrow("DICTATION_SESSION_NOT_FOUND");
      await expect(service.startSession(family.actor, task.id)).rejects.toThrow("TASK_NOT_ACTIVE");
    });
  });

  test("批量批改中任一复习失败时，答题、FSRS和会话版本全部回滚", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await makeFamily(tx, "rollback");
      const { task, items, cards } = await makeTask(tx, {
        familyId: family.family.id,
        childId: family.child.id,
        itemKinds: ["new", "due_review"],
      });
      const service = createDictationSessionService(tx, fixedNow);
      const started = await service.startSession(family.actor, task.id);
      const grading = await service.recordPlayback(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: 0, roundNumber: 1,
        playedItemIds: items.map((item) => item.id), sequenceFinished: true,
      });
      await expect(service.submitBatchMarks(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: grading.version, roundNumber: 1,
        marks: items.map((item) => ({ itemId: item.id, correct: true })),
      })).rejects.toThrow("REVIEW_EVENT_TYPE_INVALID");
      const resumed = await service.resumeSession(family.actor, started.sessionId);
      expect(resumed).toMatchObject({ version: 1, phase: "grading", markedItemIds: [] });
      expect(await tx.select().from(dictationAnswerEvents).where(eq(dictationAnswerEvents.sessionId, started.sessionId))).toHaveLength(0);
      expect(await tx.select().from(reviewEvents).where(eq(reviewEvents.cardId, cards[0]!.id))).toHaveLength(0);
      expect(await tx.select().from(childCardStates).where(eq(childCardStates.childId, family.child.id))).toHaveLength(0);
    });
  });

  test("音频未就绪、已完成或已取消任务不能启动，家庭与孩子不串号", async () => {
    await withDatabaseRollback(async (tx) => {
      const familyA = await makeFamily(tx, "scope-a");
      const familyB = await makeFamily(tx, "scope-b");
      const notReady = await makeTask(tx, {
        familyId: familyA.family.id, childId: familyA.child.id, ready: false,
      });
      const completed = await makeTask(tx, {
        familyId: familyA.family.id, childId: familyA.child.id, status: "completed",
      });
      const cancelled = await makeTask(tx, {
        familyId: familyA.family.id, childId: familyA.child.id, status: "cancelled",
      });
      const ready = await makeTask(tx, {
        familyId: familyA.family.id, childId: familyA.child.id,
      });
      const service = createDictationSessionService(tx, fixedNow);
      await expect(service.startSession(familyA.actor, notReady.task.id)).rejects.toThrow("TASK_AUDIO_NOT_READY");
      await expect(service.startSession(familyA.actor, completed.task.id)).rejects.toThrow("TASK_NOT_ACTIVE");
      await expect(service.startSession(familyA.actor, cancelled.task.id)).rejects.toThrow("TASK_NOT_ACTIVE");
      await expect(service.startSession({ ...familyA.actor, childId: familyA.sibling.id }, ready.task.id)).rejects.toThrow("TASK_NOT_FOUND");
      await expect(service.startSession(familyB.actor, ready.task.id)).rejects.toThrow("TASK_NOT_FOUND");
      const started = await service.startSession(familyA.actor, ready.task.id);
      const siblingTask = await makeTask(tx, {
        familyId: familyA.family.id, childId: familyA.sibling.id,
      });
      await expectSavepointRejection(tx, (nested) => nested
        .insert(dictationSessionItems)
        .values({
          familyId: familyA.family.id,
          childId: familyA.child.id,
          sessionId: started.sessionId,
          taskItemId: siblingTask.items[0]!.id,
          taskId: ready.task.id,
          cardId: siblingTask.cards[0]!.id,
          kind: "new",
          position: 99,
        }), "DICTATION_TASK_ITEM_SCOPE_INVALID");
      await expect(service.resumeSession(familyB.actor, started.sessionId)).rejects.toThrow("DICTATION_SESSION_NOT_FOUND");
      await expect(service.resumeSession({ ...familyA.actor, childId: familyA.sibling.id }, started.sessionId)).rejects.toThrow("DICTATION_SESSION_NOT_FOUND");
      for (const foreignActor of [familyB.actor, { ...familyA.actor, childId: familyA.sibling.id }]) {
        await expect(service.recordPlayback(foreignActor, {
          commandId: crypto.randomUUID(), sessionId: started.sessionId,
          expectedVersion: 0, roundNumber: 1,
          playedItemIds: [ready.items[0]!.id], sequenceFinished: true,
        })).rejects.toThrow("DICTATION_SESSION_NOT_FOUND");
        await expect(service.submitBatchMarks(foreignActor, {
          commandId: crypto.randomUUID(), sessionId: started.sessionId,
          expectedVersion: 0, roundNumber: 1,
          marks: [{ itemId: ready.items[0]!.id, correct: true }],
        })).rejects.toThrow("DICTATION_SESSION_NOT_FOUND");
      }
    });
  });

  test("逐题模式从首轮错误到关联订正完成，重试不重复事实", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await makeFamily(tx, "item-mode");
      const { task, items } = await makeTask(tx, {
        familyId: family.family.id, childId: family.child.id,
        mode: "item_by_item", itemKinds: ["new", "new"],
      });
      const service = createDictationSessionService(tx, fixedNow);
      const started = await service.startSession(family.actor, task.id);
      const grading = await service.recordPlayback(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: 0, roundNumber: 1,
        playedItemIds: [items[0]!.id], sequenceFinished: true,
      });
      const afterMark = await service.submitBatchMarks(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: grading.version, roundNumber: 1,
        marks: [{ itemId: items[0]!.id, correct: false }],
      });
      expect(afterMark).toMatchObject({
        phase: "listening", roundNumber: 1,
        playedItemIds: [items[0]!.id], markedItemIds: [items[0]!.id],
      });
      expect(await service.resumeSession(family.actor, started.sessionId)).toEqual(afterMark);
      const gradingSecond = await service.recordPlayback(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: afterMark.version, roundNumber: 1,
        playedItemIds: [items[1]!.id], sequenceFinished: true,
      });
      const round2 = await service.submitBatchMarks(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: gradingSecond.version, roundNumber: 1,
        marks: [{ itemId: items[1]!.id, correct: true }],
      });
      expect(round2).toMatchObject({ phase: "listening", roundNumber: 2 });
      const gradingCorrection = await service.recordPlayback(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: round2.version, roundNumber: 2,
        playedItemIds: [items[0]!.id], sequenceFinished: true,
      });
      const completionCommand = {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: gradingCorrection.version, roundNumber: 2,
        marks: [{ itemId: items[0]!.id, correct: true }],
      };
      const completed = await service.submitBatchMarks(family.actor, completionCommand);
      expect(completed.phase).toBe("completed");
      expect(await service.submitBatchMarks(family.actor, completionCommand)).toEqual(completed);
      const answers = await tx.select().from(dictationAnswerEvents).where(eq(dictationAnswerEvents.sessionId, started.sessionId));
      expect(answers.map((answer) => answer.eventRole)).toEqual([
        "first_pass", "first_pass", "same_session_relearning",
      ]);
      const itemReviews = await tx
        .select()
        .from(reviewEvents)
        .where(eq(reviewEvents.cardId, items[0]!.cardId))
        .orderBy(asc(reviewEvents.reviewedAt));
      expect(itemReviews).toHaveLength(2);
      expect(itemReviews[1]!.sourceReviewEventId).toBe(itemReviews[0]!.id);
      expect(await tx.select().from(dictationCompletionEvents).where(eq(dictationCompletionEvents.sessionId, started.sessionId))).toHaveLength(1);
    });
  });

  test("到期卡首次结果映射 scheduled_first，新卡映射 new_first", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await makeFamily(tx, "event-types");
      const { task, items, cards } = await makeTask(tx, {
        familyId: family.family.id,
        childId: family.child.id,
        itemKinds: ["new", "due_review"],
      });
      await createReviewService(tx).recordFirstResult(family.actor, {
        cardId: cards[1]!.id,
        commandId: crypto.randomUUID(),
        correct: true,
        reviewedAt: new Date("2026-08-01T08:00:00.000Z"),
        eventType: "new_first",
      });
      const service = createDictationSessionService(tx, fixedNow);
      const started = await service.startSession(family.actor, task.id);
      const grading = await service.recordPlayback(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: 0, roundNumber: 1,
        playedItemIds: items.map((item) => item.id), sequenceFinished: true,
      });
      await service.submitBatchMarks(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: grading.version, roundNumber: 1,
        marks: items.map((item) => ({ itemId: item.id, correct: true })),
      });
      const taskReviews = await tx
        .select()
        .from(reviewEvents)
        .where(eq(reviewEvents.childId, family.child.id));
      expect(taskReviews.filter((row) => row.cardId === cards[0]!.id).at(-1)?.eventType).toBe("new_first");
      expect(taskReviews.filter((row) => row.cardId === cards[1]!.id).at(-1)?.eventType).toBe("scheduled_first");
      const states = await tx.select().from(childCardStates).where(eq(childCardStates.childId, family.child.id));
      expect(states).toHaveLength(2);
      expect(states.every((state) => state.dueAt > fixedNow())).toBe(true);
    });
  });

  test("固定时钟下多卡事件严格递增，同场订正不被 FSRS 未来 dueAt 推迟", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await makeFamily(tx, "monotonic");
      const { task, items, cards } = await makeTask(tx, {
        familyId: family.family.id,
        childId: family.child.id,
        itemKinds: ["due_review", "new"],
      });
      await createReviewService(tx).recordFirstResult(family.actor, {
        cardId: cards[0]!.id,
        commandId: crypto.randomUUID(),
        correct: true,
        reviewedAt: new Date("2026-08-01T08:00:00.000Z"),
        eventType: "new_first",
      });
      const service = createDictationSessionService(tx, fixedNow);
      const started = await service.startSession(family.actor, task.id);
      const grading1 = await service.recordPlayback(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: 0, roundNumber: 1,
        playedItemIds: items.map((item) => item.id), sequenceFinished: true,
      });
      const round2 = await service.submitBatchMarks(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: grading1.version, roundNumber: 1,
        marks: items.map((item) => ({ itemId: item.id, correct: false })),
      });
      const grading2 = await service.recordPlayback(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: round2.version, roundNumber: 2,
        playedItemIds: items.map((item) => item.id), sequenceFinished: true,
      });
      const completed = await service.submitBatchMarks(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: grading2.version, roundNumber: 2,
        marks: items.map((item) => ({ itemId: item.id, correct: true })),
      });
      expect(completed.phase).toBe("completed");

      const positionByItem = new Map(items.map((item) => [item.id, item.position]));
      const answers = (await tx.select().from(dictationAnswerEvents)
        .where(eq(dictationAnswerEvents.sessionId, started.sessionId)))
        .sort((left, right) => left.roundNumber - right.roundNumber ||
          positionByItem.get(left.taskItemId)! - positionByItem.get(right.taskItemId)!);
      const answerTimes = answers.map((answer) => answer.answeredAt.getTime());
      expect(answerTimes.every((value, index) => index === 0 || value > answerTimes[index - 1]!)).toBe(true);
      const playbackFacts = await tx.select().from(dictationPlaybackEvents)
        .where(eq(dictationPlaybackEvents.sessionId, started.sessionId));
      const playback1 = Math.min(...playbackFacts
        .filter((event) => event.roundNumber === 1)
        .map((event) => event.playedAt.getTime()));
      const playback2 = Math.min(...playbackFacts
        .filter((event) => event.roundNumber === 2)
        .map((event) => event.playedAt.getTime()));
      const round1Answers = answers
        .filter((answer) => answer.roundNumber === 1)
        .map((answer) => answer.answeredAt.getTime());
      const round2Answers = answers
        .filter((answer) => answer.roundNumber === 2)
        .map((answer) => answer.answeredAt.getTime());
      expect(playback1).toBeLessThan(Math.min(...round1Answers));
      expect(Math.max(...round1Answers)).toBeLessThan(playback2);
      expect(playback2).toBeLessThan(Math.min(...round2Answers));
      const referencedReviewIds = answers.flatMap((answer) => answer.reviewEventId ? [answer.reviewEventId] : []);
      const sessionReviews = await tx.select().from(reviewEvents);
      const referencedReviews = sessionReviews
        .filter((review) => referencedReviewIds.includes(review.id));
      const reviewTimeById = new Map(
        referencedReviews.map((review) => [review.id, review.reviewedAt.getTime()]),
      );
      for (const answer of answers) {
        expect(reviewTimeById.get(answer.reviewEventId!)).toBe(answer.answeredAt.getTime());
      }
      const reviewTimes = referencedReviews.map((review) => review.reviewedAt.getTime());
      const [completion] = await tx.select().from(dictationCompletionEvents)
        .where(eq(dictationCompletionEvents.sessionId, started.sessionId));
      const maximumFactTime = Math.max(...answerTimes, ...reviewTimes);
      expect(completion.completedAt.getTime()).toBeGreaterThan(maximumFactTime);
      const [storedSession] = await tx.select().from(dictationSessions)
        .where(eq(dictationSessions.id, started.sessionId));
      expect(storedSession.updatedAt).toEqual(completion.completedAt);
      expect(completion.completedAt.getTime() - fixedNow().getTime()).toBeLessThan(5_000);
    });
  });

  test("完成任务后孩子无法再读取实际私密 TTS 文件", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "dictation-media-auth-"));
    try {
      await withDatabaseRollback(async (tx) => {
        const family = await makeFamily(tx, "media-read");
        const { task, items } = await makeTask(tx, {
          familyId: family.family.id, childId: family.child.id, ready: false,
        });
        const store = createPrivateMediaStore({ database: tx, root });
        const media = await store.put({
          familyId: family.family.id,
          childId: family.child.id,
          kind: "tts_audio",
          mimeType: "audio/mpeg",
          bytes: new Uint8Array([1, 2, 3]),
          dedupeKey: items[0]!.ttsDedupeKey,
          expiresAt: null,
        });
        const service = createDictationSessionService(tx, fixedNow);
        const started = await service.startSession(family.actor, task.id);
        const opened = await store.openWithMetadata(family.actor, media.id);
        expect(Array.from((await opened.stream.getReader().read()).value ?? [])).toEqual([1, 2, 3]);
        const grading = await service.recordPlayback(family.actor, {
          commandId: crypto.randomUUID(), sessionId: started.sessionId,
          expectedVersion: 0, roundNumber: 1,
          playedItemIds: [items[0]!.id], sequenceFinished: true,
        });
        await service.submitBatchMarks(family.actor, {
          commandId: crypto.randomUUID(), sessionId: started.sessionId,
          expectedVersion: grading.version, roundNumber: 1,
          marks: [{ itemId: items[0]!.id, correct: true }],
        });
        await expect(store.open(family.actor, media.id)).rejects.toThrow("MEDIA_NOT_FOUND");
        await store.remove(family.family.id, media.id);
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("取消任务后新会话命令失败，但之前命令的安全重放仍返回原快照", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await makeFamily(tx, "cancel-active");
      const { task, items } = await makeTask(tx, {
        familyId: family.family.id, childId: family.child.id,
      });
      const service = createDictationSessionService(tx, fixedNow);
      const started = await service.startSession(family.actor, task.id);
      const command = {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: 0, roundNumber: 1,
        playedItemIds: [items[0]!.id], sequenceFinished: true,
      };
      const first = await service.recordPlayback(family.actor, command);
      await tx.update(learningTasks).set({ status: "cancelled" }).where(eq(learningTasks.id, task.id));
      expect(await service.recordPlayback(family.actor, command)).toEqual(first);
      await expect(service.submitBatchMarks(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: first.version, roundNumber: 1,
        marks: [{ itemId: items[0]!.id, correct: true }],
      })).rejects.toThrow("TASK_NOT_ACTIVE");
      await expect(service.resumeSession(family.actor, started.sessionId)).rejects.toThrow("DICTATION_SESSION_NOT_FOUND");
      await tx.update(learningTasks).set({ status: "active" }).where(eq(learningTasks.id, task.id));
      await tx.update(dictationSessions).set({
        status: "cancelled",
        cancelledAt: fixedNow(),
      }).where(eq(dictationSessions.id, started.sessionId));
      await expect(service.recordPlayback(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: first.version, roundNumber: 1,
        playedItemIds: [items[0]!.id], sequenceFinished: true,
      })).rejects.toThrow("DICTATION_SESSION_NOT_ACTIVE");
      await expect(service.startSession(family.actor, task.id)).rejects.toThrow("DICTATION_SESSION_NOT_ACTIVE");
    });
  });

  test("数据库旁路不能改写首轮、答题或命令事实，每个预期错误使用独立 savepoint", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await makeFamily(tx, "immutable");
      const { task, items } = await makeTask(tx, {
        familyId: family.family.id, childId: family.child.id,
      });
      const service = createDictationSessionService(tx, fixedNow);
      const started = await service.startSession(family.actor, task.id);
      const grading = await service.recordPlayback(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: 0, roundNumber: 1,
        playedItemIds: [items[0]!.id], sequenceFinished: true,
      });
      await service.submitBatchMarks(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: grading.version, roundNumber: 1,
        marks: [{ itemId: items[0]!.id, correct: true }],
      });
      await expectSavepointRejection(tx, (nested) => nested
        .update(dictationSessionItems)
        .set({ firstCorrect: false })
        .where(eq(dictationSessionItems.sessionId, started.sessionId)),
      "DICTATION_FIRST_PASS_IMMUTABLE");
      await expectSavepointRejection(tx, (nested) => nested
        .update(dictationAnswerEvents)
        .set({ correct: false })
        .where(eq(dictationAnswerEvents.sessionId, started.sessionId)),
      "DICTATION_FACT_IMMUTABLE");
      await expectSavepointRejection(tx, (nested) => nested
        .update(dictationCommands)
        .set({ resultingVersion: 999 })
        .where(eq(dictationCommands.sessionId, started.sessionId)),
      "DICTATION_FACT_IMMUTABLE");
      const [stillUsable] = await tx.select({ value: count() }).from(dictationCompletionEvents);
      expect(stillUsable.value).toBeGreaterThan(0);
    });
  });

  test("数据库复合关系闭合 task、round、item、event 和 completion", async () => {
    await withDatabaseRollback(async (tx) => {
      const familyA = await makeFamily(tx, "db-chain-a");
      const familyB = await makeFamily(tx, "db-chain-b");
      const primary = await makeTask(tx, {
        familyId: familyA.family.id, childId: familyA.child.id,
        itemKinds: ["new", "new"],
      });
      const otherTask = await makeTask(tx, {
        familyId: familyA.family.id, childId: familyA.child.id,
      });
      const service = createDictationSessionService(tx, fixedNow);
      const started = await service.startSession(familyA.actor, primary.task.id);
      await expectSavepointRejection(tx, (nested) => nested.insert(dictationSessionItems).values({
        familyId: familyA.family.id,
        childId: familyA.child.id,
        sessionId: started.sessionId,
        taskItemId: otherTask.items[0]!.id,
        taskId: primary.task.id,
        cardId: otherTask.cards[0]!.id,
        kind: "new",
        position: 99,
      }), "DICTATION_TASK_ITEM_SCOPE_INVALID");
      await expectSavepointRejection(tx, (nested) => nested.insert(dictationPlaybackEvents).values({
        familyId: familyA.family.id, childId: familyA.child.id,
        sessionId: started.sessionId, commandId: crypto.randomUUID(),
        roundNumber: 99, taskItemId: primary.items[0]!.id, playedAt: fixedNow(),
      }), "dictation_playback_round_item_fk");
      await expectSavepointRejection(tx, (nested) => nested.insert(dictationPlaybackEvents).values({
        familyId: familyB.family.id, childId: familyB.child.id,
        sessionId: started.sessionId, commandId: crypto.randomUUID(),
        roundNumber: 1, taskItemId: primary.items[0]!.id, playedAt: fixedNow(),
      }), "dictation_playback_item_scope_fk");
      await expectSavepointRejection(tx, (nested) => nested.insert(dictationCompletionEvents).values({
        familyId: familyA.family.id, childId: familyA.child.id,
        sessionId: started.sessionId, taskId: otherTask.task.id,
        completedAt: fixedNow(),
      }), "dictation_completion_session_task_fk");

      const grading = await service.recordPlayback(familyA.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: 0, roundNumber: 1,
        playedItemIds: primary.items.map((item) => item.id), sequenceFinished: true,
      });
      const round2 = await service.submitBatchMarks(familyA.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: grading.version, roundNumber: 1,
        marks: [
          { itemId: primary.items[0]!.id, correct: false },
          { itemId: primary.items[1]!.id, correct: true },
        ],
      });
      await expectSavepointRejection(tx, (nested) => nested.insert(dictationPlaybackEvents).values({
        familyId: familyA.family.id, childId: familyA.child.id,
        sessionId: started.sessionId, commandId: crypto.randomUUID(),
        roundNumber: 2, taskItemId: primary.items[1]!.id, playedAt: fixedNow(),
      }), "dictation_playback_round_item_fk");
      await expectSavepointRejection(tx, (nested) => nested.insert(dictationAnswerEvents).values({
        familyId: familyA.family.id, childId: familyA.child.id,
        sessionId: started.sessionId, commandId: crypto.randomUUID(),
        roundNumber: 2, taskItemId: primary.items[1]!.id,
        correct: false, eventRole: "continued_error", replayCount: 1,
        answeredAt: fixedNow(),
      }), "dictation_answer_round_item_fk");
      const correction = await service.recordPlayback(familyA.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: round2.version, roundNumber: 2,
        playedItemIds: [primary.items[0]!.id], sequenceFinished: true,
      });
      const completed = await service.submitBatchMarks(familyA.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: correction.version, roundNumber: 2,
        marks: [{ itemId: primary.items[0]!.id, correct: true }],
      });
      expect(completed.phase).toBe("completed");
    });
  });

  test("round membership 与不可变 item_ids 一致，直接改删与 subset 均被拒绝", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await makeFamily(tx, "round-membership");
      const primary = await makeTask(tx, {
        familyId: family.family.id,
        childId: family.child.id,
        itemKinds: ["new", "new"],
      });
      const service = createDictationSessionService(tx, fixedNow);
      const started = await service.startSession(family.actor, primary.task.id);
      await tx.insert(dictationRounds).values({
        familyId: family.family.id,
        childId: family.child.id,
        sessionId: started.sessionId,
        roundNumber: 9,
        itemIds: [primary.items[0]!.id],
      });
      for (const invalid of [
        { taskItemId: primary.items[1]!.id, position: 1 },
        { taskItemId: primary.items[0]!.id, position: 1 },
        { taskItemId: primary.items[1]!.id, position: 0 },
      ]) {
        await expectSavepointRejection(tx, (nested) => nested.insert(dictationRoundItems).values({
          familyId: family.family.id,
          childId: family.child.id,
          sessionId: started.sessionId,
          roundNumber: 9,
          ...invalid,
        }), "DICTATION_ROUND_MEMBER_MISMATCH");
      }
      await tx.insert(dictationRoundItems).values({
        familyId: family.family.id,
        childId: family.child.id,
        sessionId: started.sessionId,
        roundNumber: 9,
        taskItemId: primary.items[0]!.id,
        position: 0,
      });
      await expectSavepointRejection(tx, (nested) => nested.update(dictationRoundItems).set({
        position: 1,
      }).where(eq(dictationRoundItems.roundNumber, 9)), "DICTATION_ROUND_MEMBER_IMMUTABLE");
      await expectSavepointRejection(tx, (nested) => nested.delete(dictationRoundItems).where(
        eq(dictationRoundItems.roundNumber, 9),
      ), "DICTATION_ROUND_MEMBER_IMMUTABLE");
      await tx.insert(dictationPlaybackEvents).values({
        familyId: family.family.id,
        childId: family.child.id,
        sessionId: started.sessionId,
        commandId: crypto.randomUUID(),
        roundNumber: 9,
        taskItemId: primary.items[0]!.id,
        playedAt: fixedNow(),
      });
      await expectSavepointRejection(tx, (nested) => nested.delete(dictationRoundItems).where(
        eq(dictationRoundItems.roundNumber, 9),
      ), "DICTATION_ROUND_MEMBER_IMMUTABLE");

      await expectSavepointRejection(tx, async (nested) => {
        await nested.insert(dictationRounds).values({
          familyId: family.family.id,
          childId: family.child.id,
          sessionId: started.sessionId,
          roundNumber: 10,
          itemIds: primary.items.map((item) => item.id),
        });
        await nested.insert(dictationRoundItems).values({
          familyId: family.family.id,
          childId: family.child.id,
          sessionId: started.sessionId,
          roundNumber: 10,
          taskItemId: primary.items[0]!.id,
          position: 0,
        });
        await nested.execute(sql`set constraints dictation_round_membership_complete_from_round immediate`);
      }, "DICTATION_ROUND_MEMBERSHIP_INCOMPLETE");
    });
  });

  test("先删除会话事实后，父 session 或 task 的有序删除可清理 membership", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await makeFamily(tx, "ordered-delete");
      const first = await makeTask(tx, {
        familyId: family.family.id, childId: family.child.id,
      });
      const second = await makeTask(tx, {
        familyId: family.family.id, childId: family.child.id,
      });
      const service = createDictationSessionService(tx, fixedNow);
      const sessionA = await service.startSession(family.actor, first.task.id);
      await service.recordPlayback(family.actor, {
        commandId: crypto.randomUUID(), sessionId: sessionA.sessionId,
        expectedVersion: 0, roundNumber: 1,
        playedItemIds: [first.items[0]!.id], sequenceFinished: true,
      });
      await tx.delete(dictationPlaybackEvents).where(eq(dictationPlaybackEvents.sessionId, sessionA.sessionId));
      await tx.delete(dictationCommands).where(eq(dictationCommands.sessionId, sessionA.sessionId));
      await tx.delete(dictationSessions).where(eq(dictationSessions.id, sessionA.sessionId));
      await tx.execute(sql`set constraints dictation_round_membership_complete_from_round, dictation_round_membership_complete_from_member immediate`);
      await tx.execute(sql`set constraints dictation_round_membership_complete_from_round, dictation_round_membership_complete_from_member deferred`);
      expect(await tx.select().from(dictationRoundItems).where(eq(dictationRoundItems.sessionId, sessionA.sessionId))).toHaveLength(0);

      const sessionB = await service.startSession(family.actor, second.task.id);
      await tx.delete(learningTasks).where(eq(learningTasks.id, second.task.id));
      await tx.execute(sql`set constraints dictation_round_membership_complete_from_round, dictation_round_membership_complete_from_member immediate`);
      expect(await tx.select().from(dictationSessions).where(eq(dictationSessions.id, sessionB.sessionId))).toHaveLength(0);
      expect(await tx.select().from(dictationRoundItems).where(eq(dictationRoundItems.sessionId, sessionB.sessionId))).toHaveLength(0);
    });
  });
});

async function waitForTwoBlocked(control: PoolClient, names: string[]) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await control.query<{ count: string }>(
      `select count(*)::text as count from pg_stat_activity
       where application_name = any($1::text[]) and wait_event_type = 'Lock'`,
      [names],
    );
    if (Number(result.rows[0]?.count) === 2) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("DICTATION_CALLS_DID_NOT_OVERLAP");
}

test("两个独立连接同版本并发变更只有一个成功", async () => {
  const connectionString = process.env.DATABASE_URL!;
  const names = [`dsa-${crypto.randomUUID().slice(0, 8)}`, `dsb-${crypto.randomUUID().slice(0, 8)}`];
  const poolA = new Pool({ connectionString, application_name: names[0], max: 1 });
  const poolB = new Pool({ connectionString, application_name: names[1], max: 1 });
  const controlPool = new Pool({ connectionString, application_name: "dictation-control", max: 1 });
  const clientA = await poolA.connect();
  const clientB = await poolB.connect();
  const control = await controlPool.connect();
  let cleanup: { familyId: string; authUserId: string; sessionId: string } | undefined;
  try {
    const databaseA = drizzle({ client: clientA, schema }) as TestDatabase;
    const databaseB = drizzle({ client: clientB, schema }) as TestDatabase;
    const family = await db.transaction(async (tx) => {
      const createdFamily = await makeFamily(tx, "concurrent");
      const task = await makeTask(tx, {
        familyId: createdFamily.family.id, childId: createdFamily.child.id,
      });
      return { ...createdFamily, ...task };
    });
    await control.query("begin");
    await control.query("select id from learning_tasks where id = $1 for update", [family.task.id]);
    const starts = Promise.all([
      createDictationSessionService(databaseA, fixedNow).startSession(family.actor, family.task.id),
      createDictationSessionService(databaseB, fixedNow).startSession(family.actor, family.task.id),
    ]);
    await waitForTwoBlocked(control, names);
    await control.query("commit");
    const [started, retriedStart] = await starts;
    expect(retriedStart).toEqual(started);
    cleanup = { familyId: family.family.id, authUserId: family.authUserId, sessionId: started.sessionId };
    await control.query("begin");
    await control.query("select id from dictation_sessions where id = $1 for update", [started.sessionId]);
    const calls = Promise.allSettled([
      createDictationSessionService(databaseA, fixedNow).recordPlayback(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: 0, roundNumber: 1,
        playedItemIds: [family.items[0]!.id], sequenceFinished: true,
      }),
      createDictationSessionService(databaseB, fixedNow).recordPlayback(family.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: 0, roundNumber: 1,
        playedItemIds: [family.items[0]!.id], sequenceFinished: true,
      }),
    ]);
    await waitForTwoBlocked(control, names);
    await control.query("commit");
    const outcomes = await calls;
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const [commandCount] = await db.select({ value: count() }).from(dictationCommands).where(eq(dictationCommands.sessionId, started.sessionId));
    expect(commandCount.value).toBe(1);
  } finally {
    await control.query("rollback").catch(() => undefined);
    clientA.release(); clientB.release(); control.release();
    await Promise.all([poolA.end(), poolB.end(), controlPool.end()]);
    if (cleanup) {
      await db.delete(learningTasks).where(eq(learningTasks.familyId, cleanup.familyId));
      await db.delete(families).where(eq(families.id, cleanup.familyId));
      await db.delete(authUsers).where(eq(authUsers.id, cleanup.authUserId));
    }
  }
});
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
