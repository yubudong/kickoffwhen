import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db, type DbTransaction } from "@/db/client";
import type { ChildActor } from "@/modules/auth/actor";
import { learningCards } from "@/modules/learning-content/schema";
import { activeTtsMediaPredicate } from "@/modules/media/active-cache";
import { privateMedia } from "@/modules/media/schema";

import { dictationSessionItems, dictationSessions } from "./session-schema";
import { learningTaskItems, learningTasks } from "./task-schema";
import type { DictationSnapshot } from "./session-types";
import {
  childSessionViewSchema,
  type ChildSessionView,
  type ChildTaskSummary,
} from "./child-view-types";

type ViewDatabase = typeof db | DbTransaction;
const uuidSchema = z.string().uuid();
type ItemProjection = readonly ("itemId" | "position" | "answerText" | "mediaId" | "pinyinText" | "contextText")[];

export function createChildDictationViewService(
  database: ViewDatabase = db,
  now: () => Date = () => new Date(),
  observeItemProjection: (projection: ItemProjection) => void = () => undefined,
) {
  async function listTasks(actor: ChildActor): Promise<ChildTaskSummary[]> {
    const tasks = await database
      .select({
        id: learningTasks.id,
        mode: learningTasks.mode,
        sessionId: dictationSessions.id,
      })
      .from(learningTasks)
      .leftJoin(
        dictationSessions,
        and(
          eq(dictationSessions.taskId, learningTasks.id),
          eq(dictationSessions.familyId, learningTasks.familyId),
          eq(dictationSessions.childId, learningTasks.childId),
          eq(dictationSessions.status, "active"),
        ),
      )
      .where(
        and(
          eq(learningTasks.familyId, actor.familyId),
          eq(learningTasks.childId, actor.childId),
          eq(learningTasks.status, "active"),
        ),
      )
      .orderBy(asc(learningTasks.createdAt));

    const result: ChildTaskSummary[] = [];
    for (const task of tasks) {
      const items = await database
        .select({ id: learningTaskItems.id, mediaId: privateMedia.id })
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
        );
      if (items.length === 0) continue;
      result.push({
        taskId: task.id,
        sessionId: task.sessionId,
        itemCount: items.length,
        mode: z.enum(["continuous_batch", "item_by_item"]).parse(task.mode),
        audioStatus: items.every((item) => item.mediaId) ? "ready" : "preparing",
      });
    }
    return result;
  }

  async function getSession(
    actor: ChildActor,
    rawSessionId: string,
    resultSnapshot?: DictationSnapshot,
  ): Promise<ChildSessionView> {
    const sessionId = uuidSchema.parse(rawSessionId);
    const [row] = await database
      .select({ session: dictationSessions, task: learningTasks })
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
        ),
      )
      .limit(1);
    if (!row || (resultSnapshot && (
      resultSnapshot.sessionId !== row.session.id || resultSnapshot.taskId !== row.task.id
    ))) {
      throw new Error("DICTATION_SESSION_NOT_FOUND");
    }

    const currentSnapshot: DictationSnapshot = {
      sessionId: row.session.id,
      taskId: row.task.id,
      version: row.session.version,
      phase: z.enum(["listening", "grading", "completed"]).parse(row.session.phase),
      roundNumber: row.session.roundNumber,
      currentRoundItemIds: row.session.currentRoundItemIds,
      playedItemIds: row.session.playedItemIds,
      markedItemIds: row.session.markedItemIds,
      replayCounts: {},
    };
    const currentCompleted = row.session.status === "completed" && row.task.status === "completed";
    const currentActive = row.session.status === "active" && row.task.status === "active";
    if (!currentCompleted && !currentActive) throw new Error("DICTATION_SESSION_NOT_FOUND");
    if (currentActive && resultSnapshot?.phase === "completed") {
      throw new Error("DICTATION_SESSION_NOT_FOUND");
    }
    const snapshot = currentCompleted ? currentSnapshot : resultSnapshot ?? currentSnapshot;

    const base = {
      sessionId: row.session.id,
      taskId: row.task.id,
      familyId: actor.familyId,
      childId: actor.childId,
      version: snapshot.version,
      phase: snapshot.phase,
      mode: row.session.mode,
      roundNumber: snapshot.roundNumber,
      itemCount: snapshot.currentRoundItemIds.length,
      playedItemIds: snapshot.playedItemIds,
      intervalSeconds: row.task.intervalSeconds,
      repeatCount: row.task.repeatCount,
      speechRate: Number(row.task.speechRate),
      allowManualReplay: row.task.allowManualReplay,
    };
    if (snapshot.phase === "completed") {
      return childSessionViewSchema.parse({ ...base, phase: "completed", items: [] });
    }

    if (snapshot.phase === "listening") {
      observeItemProjection(["itemId", "mediaId", "pinyinText", "contextText"]);
      const listeningRows = await database
        .select({
          itemId: dictationSessionItems.taskItemId,
          mediaId: privateMedia.id,
          pinyinText: learningCards.pinyinText,
          // Only audited built-in curriculum contexts are safe to disclose.
          // Older parent/OCR hints are unrestricted text and may contain answers.
          contextText: sql<string | null>`case when ${learningCards.source} = 'builtin' and ${learningCards.curriculumSource} is not null then ${learningCards.hintText} else null end`,
        })
        .from(dictationSessionItems)
        .innerJoin(learningCards, eq(learningCards.id, dictationSessionItems.cardId))
        .innerJoin(learningTaskItems, and(
          eq(learningTaskItems.id, dictationSessionItems.taskItemId),
          eq(learningTaskItems.taskId, dictationSessionItems.taskId),
          eq(learningTaskItems.familyId, dictationSessionItems.familyId),
          eq(learningTaskItems.childId, dictationSessionItems.childId),
        ))
        .leftJoin(privateMedia, activeTtsMediaPredicate({
          dedupeKey: learningTaskItems.ttsDedupeKey, familyId: learningTaskItems.familyId,
          childId: learningTaskItems.childId, at: now(),
        }))
        .where(and(eq(dictationSessionItems.familyId, actor.familyId),
          eq(dictationSessionItems.childId, actor.childId), eq(dictationSessionItems.sessionId, sessionId),
          inArray(dictationSessionItems.taskItemId, snapshot.currentRoundItemIds)));
      const byId = new Map(listeningRows.map((item) => [item.itemId, item]));
      const ordered = snapshot.currentRoundItemIds.map((id) => byId.get(id));
      if (ordered.some((item) => !item)) throw new Error("DICTATION_SESSION_NOT_FOUND");
      if (ordered.some((item) => !item!.mediaId)) throw new Error("TASK_AUDIO_NOT_READY");
      return childSessionViewSchema.parse({ ...base, phase: "listening", items: ordered.map((item, position) => ({
        itemId: item!.itemId, position, audioUrl: `/api/private-media/${item!.mediaId}`,
        pinyinText: item!.pinyinText, contextText: item!.contextText,
      })) });
    }

    observeItemProjection(["itemId", "position", "answerText", "mediaId"]);
    const itemRows = await database
      .select({
        itemId: dictationSessionItems.taskItemId,
        position: dictationSessionItems.position,
        answerText: learningCards.answerText,
        mediaId: privateMedia.id,
      })
      .from(dictationSessionItems)
      .innerJoin(
        learningTaskItems,
        and(
          eq(learningTaskItems.id, dictationSessionItems.taskItemId),
          eq(learningTaskItems.taskId, dictationSessionItems.taskId),
          eq(learningTaskItems.familyId, dictationSessionItems.familyId),
          eq(learningTaskItems.childId, dictationSessionItems.childId),
        ),
      )
      .innerJoin(learningCards, eq(learningCards.id, dictationSessionItems.cardId))
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
          eq(dictationSessionItems.familyId, actor.familyId),
          eq(dictationSessionItems.childId, actor.childId),
          eq(dictationSessionItems.sessionId, sessionId),
          inArray(dictationSessionItems.taskItemId, snapshot.currentRoundItemIds),
        ),
      );
    const byId = new Map(itemRows.map((item) => [item.itemId, item]));
    const ordered = snapshot.currentRoundItemIds.map((id) => byId.get(id));
    if (ordered.some((item) => !item)) throw new Error("DICTATION_SESSION_NOT_FOUND");

    const gradingItems = row.session.mode === "item_by_item"
      ? ordered.slice(snapshot.markedItemIds.length, snapshot.markedItemIds.length + 1)
      : ordered;
    return childSessionViewSchema.parse({
      ...base,
      phase: "grading",
      items: gradingItems.map((item, position) => ({
        itemId: item!.itemId,
        position: row.session.mode === "item_by_item"
          ? snapshot.markedItemIds.length
          : position,
        answerText: item!.answerText,
      })),
    });
  }

  const getSessionFromSnapshot = (actor: ChildActor, snapshot: DictationSnapshot) =>
    getSession(actor, snapshot.sessionId, snapshot);

  return { getSession, getSessionFromSnapshot, listTasks };
}

export const childDictationViewService = createChildDictationViewService();
