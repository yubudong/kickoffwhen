import { and, eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";

import { user as authUsers } from "@/modules/auth/schema";
import { createChildSessionCommandHandler } from "@/app/api/child/dictation/[sessionId]/commands/route";
import type { DbTransaction } from "@/db/client";
import { createChildDictationViewService } from "@/modules/dictation/child-view-service";
import { createDictationSessionService } from "@/modules/dictation/session-service";
import { dictationCommands, dictationSessions } from "@/modules/dictation/session-schema";
import { learningTaskItems, learningTasks } from "@/modules/dictation/task-schema";
import { children, families, guardians } from "@/modules/families/schema";
import { learningCards } from "@/modules/learning-content/schema";
import { privateMedia } from "@/modules/media/schema";

import { withDatabaseRollback } from "../helpers/database";

async function fixture(
  tx: DbTransaction,
  mode: "continuous_batch" | "item_by_item" = "continuous_batch",
  itemCount = 1,
  builtin = false,
) {
  const id = crypto.randomUUID();
  const authUserId = `child-view-${id}`;
  await tx.insert(authUsers).values({ id: authUserId, name: "视图家长", email: `${id}@example.test` });
  const [family] = await tx.insert(families).values({ name: `视图家庭-${id}` }).returning();
  const [guardian] = await tx.insert(guardians).values({ familyId: family.id, authUserId }).returning();
  const [child, sibling] = await tx.insert(children).values([
    { familyId: family.id, nickname: "本孩子", grade: 5 },
    { familyId: family.id, nickname: "兄弟", grade: 5 },
  ]).returning();
  const cards = await tx.insert(learningCards).values(Array.from({ length: itemCount }, (_, index) => ({
    familyId: builtin ? null : family.id, subject: "english" as const, answerText: `private-answer-${index + 1}`,
    broadcastText: `private-broadcast-${index + 1}`, source: builtin ? "builtin" : "manual",
    builtinKey: builtin ? `test-${id}-${index}` : null,
    curriculumSource: builtin ? "required_vocabulary" : null,
  }))).returning();
  const [task] = await tx.insert(learningTasks).values({
    familyId: family.id,
    childId: child.id,
    guardianId: guardian.id,
    commandId: crypto.randomUUID(),
    inputFingerprint: "a".repeat(64),
    mode,
    taskOrder: "source",
    intervalSeconds: 2,
    repeatCount: 1,
    speechRate: "1",
    allowManualReplay: true,
    maxReviewCards: 0,
  }).returning();
  const items = await tx.insert(learningTaskItems).values(cards.map((entry, position) => ({
    taskId: task.id, familyId: family.id, childId: child.id, cardId: entry.id,
    cardFamilyId: entry.familyId, kind: "new" as const, position,
    ttsDedupeKey: `tts:${family.id}:${child.id}:${entry.id}:test`,
  }))).returning();
  const mediaIds = items.map(() => crypto.randomUUID());
  await tx.insert(privateMedia).values(items.map((entry, index) => ({
    id: mediaIds[index]!, familyId: family.id, childId: child.id, kind: "tts_audio" as const,
    mimeType: "audio/mpeg", byteSize: 3, sha256: "b".repeat(64),
    relativePath: `${mediaIds[index]!.slice(0, 2)}/${mediaIds[index]!.slice(2, 4)}/${mediaIds[index]!}`,
    dedupeKey: entry.ttsDedupeKey,
  })));
  const item = items[0]!;
  const mediaId = mediaIds[0]!;
  return {
    family,
    child,
    sibling,
    task,
    item,
    items,
    mediaId,
    actor: { role: "child" as const, familyId: family.id, childId: child.id, deviceId: crypto.randomUUID() },
  };
}

describe("儿童听写视图", () => {
  test("监听仅投影拼音与填空语境，旧卡兼容空提示", async () => {
    await withDatabaseRollback(async (tx) => {
      const data = await fixture(tx, "continuous_batch", 2, true);
      await tx.update(learningCards).set({ answerText: "桂花", broadcastText: "桂花", pinyinText: "guì huā", hintText: "院子里的（　　）开了。" }).where(eq(learningCards.id, data.item.cardId));
      const started = await createDictationSessionService(tx).startSession(data.actor, data.task.id);
      const view = await createChildDictationViewService(tx).getSession(data.actor, started.sessionId);
      expect(view.items[0]).toEqual({ itemId: data.item.id, position: 0, audioUrl: `/api/private-media/${data.mediaId}`, pinyinText: "guì huā", contextText: "院子里的（　　）开了。" });
      expect(view.items[1]).toMatchObject({ pinyinText: null, contextText: null });
      expect(JSON.stringify(view)).not.toMatch(/桂花|answerText|broadcastText|private-answer|private-broadcast/);
    });
  });
  test("旧自建卡的自由提示含答案时仍返回空语境", async () => {
    await withDatabaseRollback(async (tx) => {
      const data = await fixture(tx);
      await tx.update(learningCards).set({ hintText: "private-answer-1 is the answer" }).where(eq(learningCards.id, data.item.cardId));
      const started = await createDictationSessionService(tx).startSession(data.actor, data.task.id);
      const view = await createChildDictationViewService(tx).getSession(data.actor, started.sessionId);
      expect(view.items[0]).toMatchObject({ pinyinText: null, contextText: null });
      expect(JSON.stringify(view)).not.toContain("private-answer");
    });
  });
  test("只列当前孩子任务，监听DTO无答案，批改阶段才返回当前轮答案", async () => {
    await withDatabaseRollback(async (tx) => {
      const data = await fixture(tx);
      const sessionService = createDictationSessionService(tx);
      const observedProjections: string[][] = [];
      const viewService = createChildDictationViewService(
        tx,
        () => new Date(),
        (projection) => observedProjections.push([...projection]),
      );
      const tasks = await viewService.listTasks(data.actor);
      expect(tasks).toEqual([expect.objectContaining({ taskId: data.task.id, audioStatus: "ready" })]);

      const started = await sessionService.startSession(data.actor, data.task.id);
      const listening = await viewService.getSession(data.actor, started.sessionId);
      expect(listening).toMatchObject({
        phase: "listening",
        items: [{ itemId: data.item.id, audioUrl: `/api/private-media/${data.mediaId}` }],
      });
      expect(JSON.stringify(listening)).not.toMatch(/private-answer|private-broadcast|answerText|broadcastText/);
      expect(observedProjections).toEqual([["itemId", "mediaId", "pinyinText", "contextText"]]);

      const grading = await sessionService.recordPlayback(data.actor, {
        commandId: crypto.randomUUID(),
        sessionId: started.sessionId,
        expectedVersion: 0,
        roundNumber: 1,
        playedItemIds: [data.item.id],
        sequenceFinished: true,
      });
      expect(await viewService.getSession(data.actor, started.sessionId)).toMatchObject({
        phase: "grading",
        version: grading.version,
        items: [{ itemId: data.item.id, answerText: "private-answer-1" }],
      });
      expect(observedProjections).toEqual([
        ["itemId", "mediaId", "pinyinText", "contextText"],
        ["itemId", "position", "answerText", "mediaId"],
      ]);
    });
  });

  test("兄弟越权和不存在统一not found，过期音频阻止监听", async () => {
    await withDatabaseRollback(async (tx) => {
      const data = await fixture(tx);
      const sessionService = createDictationSessionService(tx);
      const viewService = createChildDictationViewService(tx, () => new Date("2030-01-01T00:00:00Z"));
      const started = await sessionService.startSession(data.actor, data.task.id);
      await expect(viewService.getSession({
        ...data.actor,
        childId: data.sibling.id,
      }, started.sessionId)).rejects.toThrow("DICTATION_SESSION_NOT_FOUND");
      await expect(viewService.getSession(data.actor, crypto.randomUUID())).rejects.toThrow("DICTATION_SESSION_NOT_FOUND");

      await tx.update(privateMedia).set({ expiresAt: new Date("2029-01-01T00:00:00Z") })
        .where(eq(privateMedia.id, data.mediaId));
      await expect(viewService.getSession(data.actor, started.sessionId)).rejects.toThrow("TASK_AUDIO_NOT_READY");
    });
  });

  test("任务取消后即使会话仍active也不返回监听或批改答案", async () => {
    await withDatabaseRollback(async (tx) => {
      const data = await fixture(tx);
      const sessionService = createDictationSessionService(tx);
      const viewService = createChildDictationViewService(tx);
      const started = await sessionService.startSession(data.actor, data.task.id);
      await sessionService.recordPlayback(data.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: 0, roundNumber: 1, playedItemIds: [data.item.id], sequenceFinished: true,
      });
      await tx.update(learningTasks).set({ status: "cancelled" }).where(eq(learningTasks.id, data.task.id));
      await expect(viewService.getSession(data.actor, started.sessionId))
        .rejects.toThrow("DICTATION_SESSION_NOT_FOUND");
      expect(await viewService.listTasks(data.actor)).toEqual([]);
    });
  });

  test("逐题模式仍先隐藏答案，只在当前题grading时返回答案并可完成", async () => {
    await withDatabaseRollback(async (tx) => {
      const data = await fixture(tx, "item_by_item");
      const sessionService = createDictationSessionService(tx);
      const viewService = createChildDictationViewService(tx);
      const started = await sessionService.startSession(data.actor, data.task.id);
      expect(await viewService.getSession(data.actor, started.sessionId)).toMatchObject({
        mode: "item_by_item",
        phase: "listening",
        items: [{ itemId: data.item.id }],
      });
      const grading = await sessionService.recordPlayback(data.actor, {
        commandId: crypto.randomUUID(),
        sessionId: started.sessionId,
        expectedVersion: started.version,
        roundNumber: 1,
        playedItemIds: [data.item.id],
        sequenceFinished: true,
      });
      const gradingView = await viewService.getSession(data.actor, started.sessionId);
      expect(gradingView).toMatchObject({
        mode: "item_by_item",
        phase: "grading",
        items: [{ itemId: data.item.id, answerText: "private-answer-1" }],
      });
      const completed = await sessionService.submitBatchMarks(data.actor, {
        commandId: crypto.randomUUID(),
        sessionId: started.sessionId,
        expectedVersion: grading.version,
        roundNumber: 1,
        marks: [{ itemId: data.item.id, correct: true }],
      });
      expect(completed.phase).toBe("completed");
      expect(await viewService.getSession(data.actor, started.sessionId)).toMatchObject({
        phase: "completed",
        items: [],
      });
    });
  });

  test("逐题多题只揭示当前题并把错误题带入下一轮", async () => {
    await withDatabaseRollback(async (tx) => {
      const data = await fixture(tx, "item_by_item", 2);
      const sessions = createDictationSessionService(tx);
      const views = createChildDictationViewService(tx);
      let snapshot = await sessions.startSession(data.actor, data.task.id);
      snapshot = await sessions.recordPlayback(data.actor, {
        commandId: crypto.randomUUID(), sessionId: snapshot.sessionId, expectedVersion: snapshot.version,
        roundNumber: 1, playedItemIds: [data.items[0]!.id], sequenceFinished: true,
      });
      expect(await views.getSession(data.actor, snapshot.sessionId)).toMatchObject({
        phase: "grading", items: [{ itemId: data.items[0]!.id, answerText: "private-answer-1" }],
      });
      snapshot = await sessions.submitBatchMarks(data.actor, {
        commandId: crypto.randomUUID(), sessionId: snapshot.sessionId, expectedVersion: snapshot.version,
        roundNumber: 1, marks: [{ itemId: data.items[0]!.id, correct: true }],
      });
      snapshot = await sessions.recordPlayback(data.actor, {
        commandId: crypto.randomUUID(), sessionId: snapshot.sessionId, expectedVersion: snapshot.version,
        roundNumber: 1, playedItemIds: [data.items[1]!.id], sequenceFinished: true,
      });
      expect(await views.getSession(data.actor, snapshot.sessionId)).toMatchObject({
        phase: "grading", items: [{ itemId: data.items[1]!.id, answerText: "private-answer-2" }],
      });
      snapshot = await sessions.submitBatchMarks(data.actor, {
        commandId: crypto.randomUUID(), sessionId: snapshot.sessionId, expectedVersion: snapshot.version,
        roundNumber: 1, marks: [{ itemId: data.items[1]!.id, correct: false }],
      });
      expect(snapshot).toMatchObject({ phase: "listening", roundNumber: 2, currentRoundItemIds: [data.items[1]!.id] });
    });
  });

  test("A成功后B推进，再重放A仍返回A的stored version和phase", async () => {
    await withDatabaseRollback(async (tx) => {
      const data = await fixture(tx, "continuous_batch", 2);
      const sessions = createDictationSessionService(tx);
      const views = createChildDictationViewService(tx);
      const started = await sessions.startSession(data.actor, data.task.id);
      const handler = createChildSessionCommandHandler({
        resolveActor: async () => data.actor,
        recordPlayback: sessions.recordPlayback,
        submitMarks: sessions.submitBatchMarks,
        getSession: views.getSession,
        getSessionFromSnapshot: views.getSessionFromSnapshot,
      });
      const commandId = crypto.randomUUID();
      const body = { type: "playback", commandId, expectedVersion: 0, roundNumber: 1,
        playedItemIds: [data.items[0]!.id], sequenceFinished: false };
      const invoke = () => handler(new Request("http://example.test", { method: "POST", body: JSON.stringify(body) }),
        { params: Promise.resolve({ sessionId: started.sessionId }) });
      expect(await (await invoke()).json()).toMatchObject({ session: { version: 1, phase: "listening" } });
      await sessions.recordPlayback(data.actor, { commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: 1, roundNumber: 1, playedItemIds: [data.items[1]!.id], sequenceFinished: true });
      expect(await (await invoke()).json()).toMatchObject({ session: { version: 1, phase: "listening" } });
    });
  });

  test("旧的stored非终态命令在当前会话完成后收敛到无答案completed", async () => {
    await withDatabaseRollback(async (tx) => {
      const data = await fixture(tx);
      const sessions = createDictationSessionService(tx);
      const views = createChildDictationViewService(tx);
      const started = await sessions.startSession(data.actor, data.task.id);
      const handler = createChildSessionCommandHandler({
        resolveActor: async () => data.actor,
        recordPlayback: sessions.recordPlayback,
        submitMarks: sessions.submitBatchMarks,
        getSession: views.getSession,
        getSessionFromSnapshot: views.getSessionFromSnapshot,
      });
      const oldCommand = {
        type: "playback",
        commandId: crypto.randomUUID(),
        expectedVersion: 0,
        roundNumber: 1,
        playedItemIds: [data.item.id],
        sequenceFinished: true,
      } as const;
      const replayOld = () => handler(new Request("http://example.test", {
        method: "POST",
        body: JSON.stringify(oldCommand),
      }), { params: Promise.resolve({ sessionId: started.sessionId }) });
      expect(await (await replayOld()).json()).toMatchObject({ session: { phase: "grading", version: 1 } });
      await sessions.submitBatchMarks(data.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId, expectedVersion: 1,
        roundNumber: 1, marks: [{ itemId: data.item.id, correct: true }],
      });

      const response = await replayOld();
      const raw = await response.text();
      expect(response.status).toBe(409);
      expect(JSON.parse(raw)).toMatchObject({
        error: "SESSION_CHANGED",
        session: { phase: "completed", version: 2, items: [] },
      });
      expect(raw).not.toMatch(/answerText|private-answer|audioUrl|private-media/);
    });
  });

  test("未入库命令在另一设备完成后重试也收敛到无答案completed", async () => {
    await withDatabaseRollback(async (tx) => {
      const data = await fixture(tx);
      const sessions = createDictationSessionService(tx);
      const views = createChildDictationViewService(tx);
      const started = await sessions.startSession(data.actor, data.task.id);
      const grading = await sessions.recordPlayback(data.actor, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: 0, roundNumber: 1, playedItemIds: [data.item.id], sequenceFinished: true,
      });
      const pendingCommandId = crypto.randomUUID();
      const pendingBody = {
        type: "grading", commandId: pendingCommandId, expectedVersion: grading.version,
        roundNumber: 1, marks: [{ itemId: data.item.id, correct: true }],
      } as const;

      await sessions.submitBatchMarks({ ...data.actor, deviceId: crypto.randomUUID() }, {
        commandId: crypto.randomUUID(), sessionId: started.sessionId,
        expectedVersion: grading.version, roundNumber: 1,
        marks: [{ itemId: data.item.id, correct: true }],
      });
      expect(await tx.select().from(dictationCommands).where(and(
        eq(dictationCommands.sessionId, started.sessionId),
        eq(dictationCommands.commandId, pendingCommandId),
      ))).toEqual([]);

      const handler = createChildSessionCommandHandler({
        resolveActor: async () => data.actor,
        recordPlayback: sessions.recordPlayback,
        submitMarks: sessions.submitBatchMarks,
        getSession: views.getSession,
        getSessionFromSnapshot: views.getSessionFromSnapshot,
      });
      const response = await handler(new Request("http://example.test", {
        method: "POST", body: JSON.stringify(pendingBody),
      }), { params: Promise.resolve({ sessionId: started.sessionId }) });
      const raw = await response.text();
      expect(response.status).toBe(409);
      expect(JSON.parse(raw)).toMatchObject({
        error: "SESSION_CHANGED",
        session: { phase: "completed", version: 2, items: [] },
      });
      expect(raw).not.toMatch(/answerText|private-answer|audioUrl|private-media/);
    });
  });

  test("取消或不一致生命周期的新命令及越权访问统一not found", async () => {
    await withDatabaseRollback(async (tx) => {
      const cancelledTask = await fixture(tx);
      const taskSessions = createDictationSessionService(tx);
      const taskViews = createChildDictationViewService(tx);
      const taskStarted = await taskSessions.startSession(cancelledTask.actor, cancelledTask.task.id);
      await tx.update(learningTasks).set({ status: "cancelled" })
        .where(eq(learningTasks.id, cancelledTask.task.id));
      const taskHandler = createChildSessionCommandHandler({
        resolveActor: async () => cancelledTask.actor,
        recordPlayback: taskSessions.recordPlayback,
        submitMarks: taskSessions.submitBatchMarks,
        getSession: taskViews.getSession,
        getSessionFromSnapshot: taskViews.getSessionFromSnapshot,
      });
      const taskResponse = await taskHandler(new Request("http://example.test", {
        method: "POST", body: JSON.stringify({
          type: "playback", commandId: crypto.randomUUID(), expectedVersion: 0, roundNumber: 1,
          playedItemIds: [cancelledTask.item.id], sequenceFinished: true,
        }),
      }), { params: Promise.resolve({ sessionId: taskStarted.sessionId }) });
      expect(taskResponse.status).toBe(404);
      expect(await taskResponse.json()).toEqual({ error: "SESSION_NOT_FOUND" });

      const cancelledSession = await fixture(tx);
      const sessionService = createDictationSessionService(tx);
      const sessionViews = createChildDictationViewService(tx);
      const sessionStarted = await sessionService.startSession(cancelledSession.actor, cancelledSession.task.id);
      await tx.update(dictationSessions).set({ status: "cancelled", cancelledAt: new Date() })
        .where(eq(dictationSessions.id, sessionStarted.sessionId));
      const sessionHandler = createChildSessionCommandHandler({
        resolveActor: async () => cancelledSession.actor,
        recordPlayback: sessionService.recordPlayback,
        submitMarks: sessionService.submitBatchMarks,
        getSession: sessionViews.getSession,
        getSessionFromSnapshot: sessionViews.getSessionFromSnapshot,
      });
      const sessionResponse = await sessionHandler(new Request("http://example.test", {
        method: "POST", body: JSON.stringify({
          type: "playback", commandId: crypto.randomUUID(), expectedVersion: 0, roundNumber: 1,
          playedItemIds: [cancelledSession.item.id], sequenceFinished: true,
        }),
      }), { params: Promise.resolve({ sessionId: sessionStarted.sessionId }) });
      expect(sessionResponse.status).toBe(404);
      expect(await sessionResponse.json()).toEqual({ error: "SESSION_NOT_FOUND" });

      const crossActorHandler = createChildSessionCommandHandler({
        resolveActor: async () => ({ ...cancelledSession.actor, childId: cancelledSession.sibling.id }),
        recordPlayback: sessionService.recordPlayback,
        submitMarks: sessionService.submitBatchMarks,
        getSession: sessionViews.getSession,
        getSessionFromSnapshot: sessionViews.getSessionFromSnapshot,
      });
      const crossActorResponse = await crossActorHandler(new Request("http://example.test", {
        method: "POST", body: JSON.stringify({
          type: "playback", commandId: crypto.randomUUID(), expectedVersion: 0, roundNumber: 1,
          playedItemIds: [cancelledSession.item.id], sequenceFinished: true,
        }),
      }), { params: Promise.resolve({ sessionId: sessionStarted.sessionId }) });
      expect(crossActorResponse.status).toBe(404);
      expect(await crossActorResponse.json()).toEqual({ error: "SESSION_NOT_FOUND" });
    });
  });
});
