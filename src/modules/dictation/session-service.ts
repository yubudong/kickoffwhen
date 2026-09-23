import { submitDictationTodo } from "@/modules/todos/dictation";
import { createHash } from "node:crypto";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db, type DbTransaction } from "@/db/client";
import type { ChildActor } from "@/modules/auth/actor";
import { activeTtsMediaPredicate } from "@/modules/media/active-cache";
import { privateMedia } from "@/modules/media/schema";
import { childCardStates, reviewEvents } from "@/modules/review/db-schema";
import {
  createTransactionalReviewService,
  lockReviewCardsInTransaction,
} from "@/modules/review/service";

import { deriveReviewCommandId } from "./events";
import {
  dictationAnswerEvents,
  dictationCommands,
  dictationCompletionEvents,
  dictationPlaybackEvents,
  dictationRoundItems,
  dictationRounds,
  dictationSessionItems,
  dictationSessions,
} from "./session-schema";
import { createSessionState, reduceSession } from "./session-machine";
import { learningTaskItems, learningTasks } from "./task-schema";
import type {
  DictationSnapshot,
  DictationState,
  PlaybackCommand,
  SubmitBatchMarksInput,
} from "./session-types";

type SessionDatabase = typeof db | DbTransaction;

const uuidSchema = z.string().uuid();
const modeSchema = z.enum(["continuous_batch", "item_by_item"]);
const phaseSchema = z.enum(["listening", "grading", "completed"]);

function fingerprint(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseStringArray(value: unknown): string[] {
  return z.array(z.string().uuid()).parse(value);
}

function parseMarks(value: unknown): Record<string, boolean> {
  return z.record(z.string().uuid(), z.boolean()).parse(value);
}

function stateFromRow(row: typeof dictationSessions.$inferSelect): DictationState {
  return {
    mode: modeSchema.parse(row.mode),
    phase: phaseSchema.parse(row.phase),
    roundNumber: row.roundNumber,
    currentRoundItemIds: parseStringArray(row.currentRoundItemIds),
    playedItemIds: parseStringArray(row.playedItemIds),
    markedItemIds: parseStringArray(row.markedItemIds),
    firstPassMarks: parseMarks(row.firstPassMarks),
    latestMarks: parseMarks(row.latestMarks),
  };
}

async function replayCounts(
  tx: DbTransaction,
  session: typeof dictationSessions.$inferSelect,
): Promise<Record<string, number>> {
  const rows = await tx
    .select({ taskItemId: dictationSessionItems.taskItemId, replayCount: dictationSessionItems.replayCount })
    .from(dictationSessionItems)
    .where(
      and(
        eq(dictationSessionItems.familyId, session.familyId),
        eq(dictationSessionItems.childId, session.childId),
        eq(dictationSessionItems.sessionId, session.id),
      ),
    );
  return Object.fromEntries(rows.map((row) => [row.taskItemId, row.replayCount]));
}

async function snapshotFromRow(
  tx: DbTransaction,
  row: typeof dictationSessions.$inferSelect,
): Promise<DictationSnapshot> {
  const state = stateFromRow(row);
  return {
    sessionId: row.id,
    taskId: row.taskId,
    version: row.version,
    phase: state.phase,
    roundNumber: state.roundNumber,
    currentRoundItemIds: state.currentRoundItemIds,
    playedItemIds: state.playedItemIds,
    markedItemIds: state.markedItemIds,
    replayCounts: await replayCounts(tx, row),
  };
}

function stateUpdate(state: DictationState, at: Date) {
  return {
    phase: state.phase,
    roundNumber: state.roundNumber,
    currentRoundItemIds: state.currentRoundItemIds,
    playedItemIds: state.playedItemIds,
    markedItemIds: state.markedItemIds,
    firstPassMarks: state.firstPassMarks,
    latestMarks: state.latestMarks,
    updatedAt: at,
  };
}

async function lockSession(
  tx: DbTransaction,
  actor: ChildActor,
  sessionId: string,
) {
  const [session] = await tx
    .select()
    .from(dictationSessions)
    .where(
      and(
        eq(dictationSessions.id, sessionId),
        eq(dictationSessions.familyId, actor.familyId),
        eq(dictationSessions.childId, actor.childId),
      ),
    )
    .limit(1)
    .for("update");
  if (!session) throw new Error("DICTATION_SESSION_NOT_FOUND");
  return session;
}

async function commandReplay(
  tx: DbTransaction,
  sessionId: string,
  commandId: string,
  inputFingerprint: string,
): Promise<DictationSnapshot | null> {
  const [stored] = await tx
    .select({ fingerprint: dictationCommands.inputFingerprint, result: dictationCommands.resultSnapshot })
    .from(dictationCommands)
    .where(
      and(
        eq(dictationCommands.sessionId, sessionId),
        eq(dictationCommands.commandId, commandId),
      ),
    )
    .limit(1);
  if (!stored) return null;
  if (stored.fingerprint !== inputFingerprint) throw new Error("DICTATION_IDEMPOTENCY_CONFLICT");
  return stored.result;
}

async function storeCommand(
  tx: DbTransaction,
  session: typeof dictationSessions.$inferSelect,
  commandId: string,
  commandType: "playback" | "grading",
  inputFingerprint: string,
  snapshot: DictationSnapshot,
  createdAt: Date,
) {
  await tx.insert(dictationCommands).values({
    familyId: session.familyId,
    childId: session.childId,
    sessionId: session.id,
    commandId,
    commandType,
    inputFingerprint,
    resultingVersion: snapshot.version,
    resultSnapshot: snapshot,
    createdAt,
  });
}

function ensureMutableVersion(
  session: typeof dictationSessions.$inferSelect,
  expectedVersion: number,
  roundNumber: number,
) {
  if (session.status !== "active") throw new Error("DICTATION_SESSION_NOT_ACTIVE");
  if (session.version !== expectedVersion) throw new Error("DICTATION_VERSION_CONFLICT");
  if (session.roundNumber !== roundNumber) throw new Error("DICTATION_ROUND_CONFLICT");
}

async function ensureTaskActive(
  tx: DbTransaction,
  session: typeof dictationSessions.$inferSelect,
) {
  const [task] = await tx
    .select({
      status: learningTasks.status,
      allowManualReplay: learningTasks.allowManualReplay,
    })
    .from(learningTasks)
    .where(
      and(
        eq(learningTasks.id, session.taskId),
        eq(learningTasks.familyId, session.familyId),
        eq(learningTasks.childId, session.childId),
      ),
    )
    .limit(1)
    .for("update");
  if (!task || task.status !== "active") throw new Error("TASK_NOT_ACTIVE");
  return task;
}

export function createDictationSessionService(
  database: SessionDatabase = db,
  now: () => Date = () => new Date(),
) {
  async function startSession(actor: ChildActor, rawTaskId: string): Promise<DictationSnapshot> {
    const taskId = uuidSchema.parse(rawTaskId);
    return database.transaction(async (tx) => {
      const [task] = await tx
        .select()
        .from(learningTasks)
        .where(
          and(
            eq(learningTasks.id, taskId),
            eq(learningTasks.familyId, actor.familyId),
            eq(learningTasks.childId, actor.childId),
          ),
        )
        .limit(1)
        .for("update");
      if (!task) throw new Error("TASK_NOT_FOUND");
      if (task.status !== "active") throw new Error("TASK_NOT_ACTIVE");

      const [existing] = await tx
        .select()
        .from(dictationSessions)
        .where(
          and(
            eq(dictationSessions.familyId, actor.familyId),
            eq(dictationSessions.childId, actor.childId),
            eq(dictationSessions.taskId, task.id),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.status !== "active") throw new Error("DICTATION_SESSION_NOT_ACTIVE");
        return snapshotFromRow(tx, existing);
      }

      const itemRows = await tx
        .select({ item: learningTaskItems, mediaId: privateMedia.id })
        .from(learningTaskItems)
        .leftJoin(
          privateMedia,
          activeTtsMediaPredicate({
            dedupeKey: learningTaskItems.ttsDedupeKey,
            familyId: learningTaskItems.familyId,
            childId: learningTaskItems.childId,
            at: now(),
          }),
        )
        .where(
          and(
            eq(learningTaskItems.taskId, task.id),
            eq(learningTaskItems.familyId, actor.familyId),
            eq(learningTaskItems.childId, actor.childId),
          ),
        )
        .orderBy(asc(learningTaskItems.position));
      if (itemRows.length === 0) throw new Error("TASK_EMPTY");
      if (itemRows.some((row) => !row.mediaId)) throw new Error("TASK_AUDIO_NOT_READY");

      const initial = createSessionState({
        mode: modeSchema.parse(task.mode),
        itemIds: itemRows.map(({ item }) => item.id),
      });
      const startedAt = now();
      const [created] = await tx
        .insert(dictationSessions)
        .values({
          familyId: actor.familyId,
          childId: actor.childId,
          taskId: task.id,
          mode: initial.mode,
          ...stateUpdate(initial, startedAt),
          createdAt: startedAt,
        })
        .returning();
      await tx.insert(dictationSessionItems).values(
        itemRows.map(({ item }) => ({
          familyId: actor.familyId,
          childId: actor.childId,
          sessionId: created.id,
          taskItemId: item.id,
          taskId: task.id,
          cardId: item.cardId,
          kind: item.kind,
          position: item.position,
        })),
      );
      await tx.insert(dictationRounds).values({
        familyId: actor.familyId,
        childId: actor.childId,
        sessionId: created.id,
        roundNumber: 1,
        itemIds: initial.currentRoundItemIds,
        createdAt: startedAt,
      });
      await tx.insert(dictationRoundItems).values(
        initial.currentRoundItemIds.map((taskItemId, position) => ({
          familyId: actor.familyId,
          childId: actor.childId,
          sessionId: created.id,
          roundNumber: 1,
          taskItemId,
          position,
        })),
      );
      return snapshotFromRow(tx, created);
    });
  }

  async function resumeSession(actor: ChildActor, rawSessionId: string): Promise<DictationSnapshot> {
    const sessionId = uuidSchema.parse(rawSessionId);
    return database.transaction(async (tx) => {
      const [session] = await tx
        .select()
        .from(dictationSessions)
        .innerJoin(
          learningTasks,
          and(
            eq(learningTasks.id, dictationSessions.taskId),
            eq(learningTasks.familyId, dictationSessions.familyId),
            eq(learningTasks.childId, dictationSessions.childId),
          ),
        )
        .where(
          and(
            eq(dictationSessions.id, sessionId),
            eq(dictationSessions.familyId, actor.familyId),
            eq(dictationSessions.childId, actor.childId),
            eq(dictationSessions.status, "active"),
            eq(learningTasks.status, "active"),
          ),
        )
        .limit(1);
      if (!session) throw new Error("DICTATION_SESSION_NOT_FOUND");
      return snapshotFromRow(tx, session.dictation_sessions);
    });
  }

  async function recordPlayback(actor: ChildActor, raw: PlaybackCommand): Promise<DictationSnapshot> {
    const command = {
      commandId: uuidSchema.parse(raw.commandId),
      sessionId: uuidSchema.parse(raw.sessionId),
      expectedVersion: z.number().int().nonnegative().parse(raw.expectedVersion),
      roundNumber: z.number().int().positive().parse(raw.roundNumber),
      playedItemIds: z.array(uuidSchema).min(1).parse(raw.playedItemIds),
      sequenceFinished: z.boolean().parse(raw.sequenceFinished),
    };
    const inputFingerprint = fingerprint(command);
    return database.transaction(async (tx) => {
      const session = await lockSession(tx, actor, command.sessionId);
      const replay = await commandReplay(tx, session.id, command.commandId, inputFingerprint);
      if (replay) return replay;
      const task = await ensureTaskActive(tx, session);
      ensureMutableVersion(session, command.expectedVersion, command.roundNumber);
      const currentState = stateFromRow(session);
      const replaysCurrent =
        currentState.mode === "continuous_batch" &&
        command.playedItemIds.length === 1 &&
        command.playedItemIds[0] === currentState.playedItemIds.at(-1);
      if (replaysCurrent && !task.allowManualReplay) {
        throw new Error("PLAYBACK_REPLAY_NOT_ALLOWED");
      }
      const next = reduceSession(currentState, {
        type: "PLAYBACK_RECORDED",
        roundNumber: command.roundNumber,
        playedItemIds: command.playedItemIds,
        sequenceFinished: command.sequenceFinished,
      });
      const at = new Date(Math.max(
        now().getTime(),
        session.updatedAt.getTime() + 1,
      ));
      await tx.insert(dictationPlaybackEvents).values(
        command.playedItemIds.map((taskItemId) => ({
          familyId: actor.familyId,
          childId: actor.childId,
          sessionId: session.id,
          commandId: command.commandId,
          roundNumber: command.roundNumber,
          taskItemId,
          playedAt: at,
        })),
      );
      await tx
        .update(dictationSessionItems)
        .set({ replayCount: sql`${dictationSessionItems.replayCount} + 1` })
        .where(
          and(
            eq(dictationSessionItems.sessionId, session.id),
            inArray(dictationSessionItems.taskItemId, command.playedItemIds),
          ),
        );
      const [updated] = await tx
        .update(dictationSessions)
        .set({ ...stateUpdate(next, at), version: session.version + 1 })
        .where(eq(dictationSessions.id, session.id))
        .returning();
      const snapshot = await snapshotFromRow(tx, updated);
      await storeCommand(
        tx,
        session,
        command.commandId,
        "playback",
        inputFingerprint,
        snapshot,
        updated.updatedAt,
      );
      return snapshot;
    });
  }

  async function submitBatchMarks(
    actor: ChildActor,
    raw: SubmitBatchMarksInput,
  ): Promise<DictationSnapshot> {
    const command = {
      commandId: uuidSchema.parse(raw.commandId),
      sessionId: uuidSchema.parse(raw.sessionId),
      expectedVersion: z.number().int().nonnegative().parse(raw.expectedVersion),
      roundNumber: z.number().int().positive().parse(raw.roundNumber),
      marks: z.array(z.object({ itemId: uuidSchema, correct: z.boolean() })).min(1).parse(raw.marks),
    };
    const inputFingerprint = fingerprint(command);
    return database.transaction(async (tx) => {
      const session = await lockSession(tx, actor, command.sessionId);
      const replay = await commandReplay(tx, session.id, command.commandId, inputFingerprint);
      if (replay) return replay;
      await ensureTaskActive(tx, session);
      ensureMutableVersion(session, command.expectedVersion, command.roundNumber);
      const next = reduceSession(stateFromRow(session), {
        type: "BATCH_MARKED",
        roundNumber: command.roundNumber,
        marks: command.marks,
      });

      const itemRows = await tx
        .select()
        .from(dictationSessionItems)
        .where(
          and(
            eq(dictationSessionItems.familyId, actor.familyId),
            eq(dictationSessionItems.childId, actor.childId),
            eq(dictationSessionItems.sessionId, session.id),
            inArray(dictationSessionItems.taskItemId, command.marks.map((mark) => mark.itemId)),
          ),
        );
      if (itemRows.length !== command.marks.length) throw new Error("DICTATION_ITEM_SCOPE_INVALID");
      const itemById = new Map(itemRows.map((item) => [item.taskItemId, item]));
      await lockReviewCardsInTransaction(tx, actor, itemRows.map((item) => item.cardId));
      const cardStates = itemRows.length === 0
        ? []
        : await tx
            .select()
            .from(childCardStates)
            .where(
              and(
                eq(childCardStates.familyId, actor.familyId),
                eq(childCardStates.childId, actor.childId),
                inArray(childCardStates.cardId, itemRows.map((item) => item.cardId)),
              ),
            );
      const cardStateById = new Map(cardStates.map((state) => [state.cardId, state]));
      const reviewService = createTransactionalReviewService(tx);
      const [previousAnswer] = await tx
        .select({ answeredAt: dictationAnswerEvents.answeredAt })
        .from(dictationAnswerEvents)
        .where(eq(dictationAnswerEvents.sessionId, session.id))
        .orderBy(desc(dictationAnswerEvents.answeredAt))
        .limit(1);
      const [previousReview] = await tx
        .select({ reviewedAt: reviewEvents.reviewedAt })
        .from(reviewEvents)
        .where(
          and(
            eq(reviewEvents.familyId, actor.familyId),
            eq(reviewEvents.childId, actor.childId),
            inArray(reviewEvents.cardId, itemRows.map((item) => item.cardId)),
          ),
        )
        .orderBy(desc(reviewEvents.reviewedAt))
        .limit(1);
      const baseTime = Math.max(
        now().getTime(),
        session.updatedAt.getTime() + 1,
        previousAnswer ? previousAnswer.answeredAt.getTime() + 1 : 0,
        previousReview ? previousReview.reviewedAt.getTime() + 1 : 0,
      );
      let timestampCursor = Math.max(
        baseTime,
        previousAnswer ? previousAnswer.answeredAt.getTime() + 1 : 0,
      );
      const actualAnswerTimes: number[] = [];
      const orderedMarks = [...command.marks].sort(
        (left, right) => itemById.get(left.itemId)!.position - itemById.get(right.itemId)!.position,
      );
      for (const mark of orderedMarks) {
        const item = itemById.get(mark.itemId)!;
        const storedState = cardStateById.get(item.cardId);
        const minimumTime = Math.max(
          timestampCursor,
          storedState ? storedState.updatedAt.getTime() + 1 : 0,
          item.firstCorrect === null && item.kind === "due_review" && storedState
            ? storedState.dueAt.getTime()
            : 0,
        );
        const answeredAt = new Date(minimumTime);
        actualAnswerTimes.push(minimumTime);
        timestampCursor = minimumTime + 1;
        let eventRole: "first_pass" | "continued_error" | "same_session_relearning";
        let reviewEventId: string | null = null;
        if (item.firstCorrect === null) {
          eventRole = "first_pass";
          const result = await reviewService.recordFirstResult(actor, {
            cardId: item.cardId,
            commandId: deriveReviewCommandId(command.commandId, item.taskItemId, "first_pass"),
            correct: mark.correct,
            reviewedAt: answeredAt,
            eventType: item.kind === "new" ? "new_first" : "scheduled_first",
          });
          reviewEventId = result.reviewEventId;
        } else if (mark.correct && !item.finalCorrect) {
          eventRole = "same_session_relearning";
          if (!item.firstReviewEventId) throw new Error("DICTATION_FIRST_REVIEW_MISSING");
          const result = await reviewService.markRelearningComplete(actor, {
            cardId: item.cardId,
            commandId: deriveReviewCommandId(
              command.commandId,
              item.taskItemId,
              "same_session_relearning",
            ),
            correctedAt: answeredAt,
            sourceReviewEventId: item.firstReviewEventId,
          });
          reviewEventId = result.reviewEventId;
        } else {
          eventRole = "continued_error";
        }

        await tx.insert(dictationAnswerEvents).values({
          familyId: actor.familyId,
          childId: actor.childId,
          sessionId: session.id,
          commandId: command.commandId,
          roundNumber: command.roundNumber,
          taskItemId: item.taskItemId,
          correct: mark.correct,
          eventRole,
          reviewEventId,
          replayCount: item.replayCount,
          answeredAt,
        });
        await tx
          .update(dictationSessionItems)
          .set({
            ...(item.firstCorrect === null
              ? { firstCorrect: mark.correct, firstReviewEventId: reviewEventId }
              : {}),
            finalCorrect: mark.correct,
          })
          .where(
            and(
              eq(dictationSessionItems.sessionId, session.id),
              eq(dictationSessionItems.taskItemId, item.taskItemId),
            ),
          );
      }

      const at = new Date(Math.max(baseTime, ...actualAnswerTimes) + 1);
      if (next.phase === "completed" || next.roundNumber !== session.roundNumber) {
        await tx
          .update(dictationRounds)
          .set({ completedAt: at })
          .where(
            and(
              eq(dictationRounds.sessionId, session.id),
              eq(dictationRounds.roundNumber, command.roundNumber),
            ),
          );
      }
      if (next.phase !== "completed" && next.roundNumber !== session.roundNumber) {
        await tx.insert(dictationRounds).values({
          familyId: actor.familyId,
          childId: actor.childId,
          sessionId: session.id,
          roundNumber: next.roundNumber,
          itemIds: next.currentRoundItemIds,
          createdAt: at,
        });
        await tx.insert(dictationRoundItems).values(
          next.currentRoundItemIds.map((taskItemId, position) => ({
            familyId: actor.familyId,
            childId: actor.childId,
            sessionId: session.id,
            roundNumber: next.roundNumber,
            taskItemId,
            position,
          })),
        );
      }

      const completed = next.phase === "completed";
      const [updated] = await tx
        .update(dictationSessions)
        .set({
          ...stateUpdate(next, at),
          version: session.version + 1,
          ...(completed ? { status: "completed", completedAt: at } : {}),
        })
        .where(eq(dictationSessions.id, session.id))
        .returning();
      if (completed) {
        await tx
          .update(learningTasks)
          .set({ status: "completed", completedAt: at })
          .where(
            and(
              eq(learningTasks.id, session.taskId),
              eq(learningTasks.familyId, actor.familyId),
              eq(learningTasks.childId, actor.childId),
              eq(learningTasks.status, "active"),
            ),
          );
        await submitDictationTodo(tx, session.taskId, at);
        await tx.insert(dictationCompletionEvents).values({
          familyId: actor.familyId,
          childId: actor.childId,
          taskId: session.taskId,
          sessionId: session.id,
          completedAt: at,
        });
      }
      const snapshot = await snapshotFromRow(tx, updated);
      await storeCommand(
        tx,
        session,
        command.commandId,
        "grading",
        inputFingerprint,
        snapshot,
        updated.updatedAt,
      );
      return snapshot;
    });
  }

  return { recordPlayback, resumeSession, startSession, submitBatchMarks };
}

const sessionService = createDictationSessionService();
export const startSession = sessionService.startSession;
export const recordPlayback = sessionService.recordPlayback;
export const submitBatchMarks = sessionService.submitBatchMarks;
export const resumeSession = sessionService.resumeSession;
