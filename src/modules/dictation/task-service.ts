import { addDictationTodo } from "@/modules/todos/dictation";
import { createHash } from "node:crypto";

import { and, asc, eq, inArray, isNull, lte, notInArray, or } from "drizzle-orm";
import { z } from "zod";

import { db, type DbTransaction } from "@/db/client";
import type { Actor, ChildActor, GuardianActor } from "@/modules/auth/actor";
import { children } from "@/modules/families/schema";
import {
  buildTtsDedupeKey,
  createJobService,
  type GenerateTtsJobPayload,
} from "@/modules/jobs/service";
import { learningCards, textbookEditions, textbookUnits, textbookSections } from "@/modules/learning-content/schema";
import { activeTtsMediaPredicate } from "@/modules/media/active-cache";
import { privateMedia } from "@/modules/media/schema";
import { childCardStates } from "@/modules/review/db-schema";
import { createReviewService } from "@/modules/review/service";

import { getActiveTaskCards } from "./active-task-cards";
import { learningTaskItems, learningTasks } from "./task-schema";
import {
  buildTaskInputSchema,
  buildTaskBatchInputSchema,
  type BuildTaskInput,
  type BuildTaskBatchInput,
  type LearningTask,
  type LearningTaskItem,
} from "./task-types";

export type { BuildTaskInput, LearningTask } from "./task-types";

type TaskDatabase = typeof db | DbTransaction;
type TaskMetadata = {
  origin: "curriculum" | "extra_practice" | "auto_review";
  title: string;
  sectionId?: string;
  batchCommandId?: string;
  batchFingerprint?: string;
};

function derivedCommandId(batchId: string, discriminator: string): string {
  const hash = createHash("sha256").update(`${batchId}:${discriminator}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function fingerprint(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function randomShuffle<T>(items: T[], random: () => number): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

const sourceRank: Record<string, number> = {
  builtin: 0,
  manual: 1,
  bulk: 2,
  ocr: 3,
};

function stableSourceOrder<T extends {
  card: typeof learningCards.$inferSelect;
  unitOrder: number | null;
  sectionOrder: number | null;
}>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const leftHasUnit = left.card.unitId === null ? 1 : 0;
    const rightHasUnit = right.card.unitId === null ? 1 : 0;
    return (
      leftHasUnit - rightHasUnit ||
      left.card.subject.localeCompare(right.card.subject) ||
      (left.card.textbookEditionId ?? "").localeCompare(
        right.card.textbookEditionId ?? "",
      ) ||
      (left.unitOrder ?? Number.MAX_SAFE_INTEGER) -
        (right.unitOrder ?? Number.MAX_SAFE_INTEGER) ||
      (left.sectionOrder ?? Number.MAX_SAFE_INTEGER) - (right.sectionOrder ?? Number.MAX_SAFE_INTEGER) ||
      (left.card.sourceOrder ?? Number.MAX_SAFE_INTEGER) - (right.card.sourceOrder ?? Number.MAX_SAFE_INTEGER) ||
      (sourceRank[left.card.source] ?? 99) -
        (sourceRank[right.card.source] ?? 99) ||
      left.card.createdAt.getTime() - right.card.createdAt.getTime() ||
      left.card.id.localeCompare(right.card.id)
    );
  });
}

function ttsPayload(
  familyId: string,
  childId: string,
  card: typeof learningCards.$inferSelect,
  rate: number,
): GenerateTtsJobPayload {
  return card.subject === "chinese"
    ? {
        familyId,
        childId,
        cardId: card.id,
        text: card.broadcastText,
        language: "zh-CN",
        voice: "zh-CN-XiaoxiaoNeural",
        rate,
      }
    : {
        familyId,
        childId,
        cardId: card.id,
        text: card.broadcastText,
        language: "en-US",
        voice: "en-US-JennyNeural",
        rate,
      };
}

export function createDictationTaskService(
  database: TaskDatabase = db,
  now: () => Date = () => new Date(),
  random: () => number = Math.random,
) {
  async function loadTask(
    client: TaskDatabase,
    actor: Actor,
    taskId: string,
  ): Promise<LearningTask> {
    const id = z.string().uuid().parse(taskId);
    const [task] = await client
      .select()
      .from(learningTasks)
      .where(
        and(
          eq(learningTasks.id, id),
          eq(learningTasks.familyId, actor.familyId),
          ...(actor.role === "child"
            ? [eq(learningTasks.childId, actor.childId), eq(learningTasks.status, "active")]
            : []),
        ),
      )
      .limit(1);
    if (!task) throw new Error("TASK_NOT_FOUND");

    const rows = await client
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
          eq(learningTaskItems.familyId, task.familyId),
          eq(learningTaskItems.childId, task.childId),
        ),
      )
      .orderBy(asc(learningTaskItems.position));
    const items: LearningTaskItem[] = rows.map(({ item, mediaId }) => ({
      cardId: item.cardId,
      kind: z.enum(["due_review", "new", "manual_review"]).parse(item.kind),
      position: item.position,
      ttsDedupeKey: item.ttsDedupeKey,
      audioStatus: mediaId ? "ready" : "queued",
      mediaId,
    }));
    return {
      id: task.id,
      childId: task.childId,
      mode: z.enum(["continuous_batch", "item_by_item"]).parse(task.mode),
      order: z.enum(["source", "random"]).parse(task.taskOrder),
      intervalSeconds: task.intervalSeconds,
      repeatCount: z.union([z.literal(1), z.literal(2), z.literal(3)]).parse(task.repeatCount),
      speechRate: Number(task.speechRate),
      allowManualReplay: task.allowManualReplay,
      maxReviewCards: task.maxReviewCards,
      audioStatus: items.length > 0 && items.every((item) => item.audioStatus === "ready")
        ? "ready"
        : "preparing",
      items,
    };
  }

  async function buildDailyTask(
    actor: GuardianActor,
    rawInput: BuildTaskInput,
    metadata?: TaskMetadata,
  ): Promise<LearningTask> {
    const input = buildTaskInputSchema.parse(rawInput);
    if (new Set(input.newCardIds).size !== input.newCardIds.length) {
      throw new Error("TASK_CARD_DUPLICATE");
    }
    const inputFingerprint = metadata
      ? `${fingerprint({ input, metadata })}${metadata.batchFingerprint ? `:${metadata.batchFingerprint}` : ""}`
      : fingerprint(input);

    return database.transaction(async (tx) => {
      const [child] = await tx
        .select({ id: children.id })
        .from(children)
        .where(
          and(
            eq(children.id, input.childId),
            eq(children.familyId, actor.familyId),
            eq(children.active, true),
          ),
        )
        .limit(1)
        .for("update");
      if (!child) throw new Error("CHILD_NOT_FOUND");

      const [created] = await tx
        .insert(learningTasks)
        .values({
          familyId: actor.familyId,
          childId: child.id,
          guardianId: actor.guardianId,
          commandId: input.commandId,
          inputFingerprint,
          mode: input.mode,
          taskOrder: input.order,
          intervalSeconds: input.intervalSeconds,
          repeatCount: input.repeatCount,
          speechRate: String(input.speechRate),
          allowManualReplay: input.allowManualReplay,
          maxReviewCards: input.maxReviewCards,
          ...(metadata ? {
            origin: metadata.origin,
            title: metadata.title,
            sectionId: metadata.sectionId ?? null,
            batchCommandId: metadata.batchCommandId ?? null,
          } : {}),
        })
        .onConflictDoNothing({ target: [learningTasks.familyId, learningTasks.commandId] })
        .returning();
      if (!created) {
        const [existing] = await tx
          .select()
          .from(learningTasks)
          .where(
            and(
              eq(learningTasks.familyId, actor.familyId),
              eq(learningTasks.commandId, input.commandId),
            ),
          )
          .limit(1);
        if (!existing || existing.inputFingerprint !== inputFingerprint) {
          throw new Error("TASK_IDEMPOTENCY_CONFLICT");
        }
        return loadTask(tx, actor, existing.id);
      }

      const activeCardIds = (await getActiveTaskCards(
        tx,
        actor.familyId,
        [child.id],
      )).map(({ cardId }) => cardId);

      const dueRows = input.maxReviewCards === 0
        ? []
        : await tx
            .select({ card: learningCards })
            .from(childCardStates)
            .innerJoin(learningCards, eq(learningCards.id, childCardStates.cardId))
            .where(
              and(
                eq(childCardStates.familyId, actor.familyId),
                eq(childCardStates.childId, child.id),
                lte(childCardStates.dueAt, now()),
                ...(input.subject ? [eq(learningCards.subject, input.subject)] : []),
                or(eq(learningCards.familyId, actor.familyId), isNull(learningCards.familyId)),
                ...(activeCardIds.length > 0
                  ? [notInArray(childCardStates.cardId, activeCardIds)]
                  : []),
              ),
            )
            .orderBy(asc(childCardStates.dueAt), asc(childCardStates.cardId))
            .limit(input.maxReviewCards);

      const requestedCards = input.newCardIds.length === 0
        ? []
        : await tx
            .select({ card: learningCards, unitOrder: textbookUnits.unitOrder, sectionOrder: textbookSections.sectionOrder })
            .from(learningCards)
            .leftJoin(textbookUnits, eq(textbookUnits.id, learningCards.unitId))
            .leftJoin(textbookSections, eq(textbookSections.id, learningCards.sectionId))
            .where(
              and(
                inArray(learningCards.id, input.newCardIds),
                or(eq(learningCards.familyId, actor.familyId), isNull(learningCards.familyId)),
              ),
            );
      if (requestedCards.length !== input.newCardIds.length) {
        throw new Error("TASK_CARD_NOT_FOUND");
      }
      if (input.subject && requestedCards.some(({ card }) => card.subject !== input.subject)) {
        throw new Error("TASK_CARD_SUBJECT_MISMATCH");
      }
      const activeCardIdSet = new Set(activeCardIds);
      if (metadata?.origin === "extra_practice" && requestedCards.some(({ card }) => activeCardIdSet.has(card.id))) {
        throw new Error("TASK_CARD_ACTIVE");
      }
      const selectedCards = requestedCards.filter(({ card }) => !activeCardIdSet.has(card.id));
      let existingStateIds = new Set<string>();
      if (selectedCards.length > 0) {
        const existingStates = await tx
          .select({ cardId: childCardStates.cardId })
          .from(childCardStates)
          .where(
            and(
              eq(childCardStates.familyId, actor.familyId),
              eq(childCardStates.childId, child.id),
              inArray(
                childCardStates.cardId,
                selectedCards.map(({ card }) => card.id),
              ),
            ),
          );
        existingStateIds = new Set(existingStates.map(({ cardId }) => cardId));
        if (metadata?.origin !== "extra_practice" && existingStates.length > 0) throw new Error("TASK_NEW_CARD_ALREADY_STARTED");
      }

      const orderedNewCards = stableSourceOrder(selectedCards);
      let dueItems = dueRows.map(({ card }) => ({ card, cardId: card.id, kind: "due_review" as const }));
      let newItems = orderedNewCards.map(({ card }) => ({
        card, cardId: card.id,
        kind: metadata?.origin === "extra_practice" && existingStateIds.has(card.id) ? "manual_review" as const : "new" as const,
      }));
      if (input.order === "random") {
        dueItems = randomShuffle(dueItems, random);
        newItems = randomShuffle(newItems, random);
      }
      const planned = [...dueItems, ...newItems];
      if (planned.length === 0) throw new Error("TASK_EMPTY");

      const jobService = createJobService(tx, now);
      const values = [];
      for (const [position, item] of planned.entries()) {
        const payload = ttsPayload(actor.familyId, child.id, item.card, input.speechRate);
        const ttsDedupeKey = buildTtsDedupeKey(payload);
        const [cached] = await tx
          .select({ id: privateMedia.id })
          .from(privateMedia)
          .where(
            activeTtsMediaPredicate({
              dedupeKey: ttsDedupeKey,
              familyId: actor.familyId,
              childId: child.id,
              at: now(),
            }),
          )
          .limit(1);
        if (!cached) {
          const job = await jobService.enqueueJob("generate_tts", payload, ttsDedupeKey);
          if (job.status === "failed" || job.status === "succeeded") {
            await jobService.requeueTtsJob(actor, job.id);
          }
        }
        values.push({
          taskId: created.id,
          familyId: actor.familyId,
          childId: child.id,
          cardId: item.cardId,
          cardFamilyId: item.card.familyId,
          kind: item.kind,
          position,
          ttsDedupeKey,
        });
      }
      await tx.insert(learningTaskItems).values(values);
      await addDictationTodo(tx, created, values.length, metadata?.title);
      return loadTask(tx, actor, created.id);
    });
  }

  async function buildTaskBatch(actor: GuardianActor, rawInput: BuildTaskBatchInput): Promise<LearningTask[]> {
    const input = buildTaskBatchInputSchema.parse(rawInput);
    if (new Set(input.sectionIds).size !== input.sectionIds.length || input.sectionIds.length > 30 || input.extraCardIds.length > 100) {
      throw new Error("TASK_BATCH_INVALID");
    }
    if (input.sectionIds.length === 0 && input.extraCardIds.length === 0) throw new Error("TASK_EMPTY");
    return database.transaction(async (tx) => {
      const [child] = await tx.select({ id: children.id }).from(children).where(and(
        eq(children.id, input.childId), eq(children.familyId, actor.familyId), eq(children.active, true),
      )).limit(1).for("update");
      if (!child) throw new Error("CHILD_NOT_FOUND");
      const batchFingerprint = fingerprint(input);
      const sections = input.sectionIds.length === 0 ? [] : await tx.select({
        id: textbookSections.id, title: textbookSections.title,
        unitId: textbookUnits.id, unitTitle: textbookUnits.title, unitOrder: textbookUnits.unitOrder,
      }).from(textbookSections)
        .innerJoin(textbookUnits, eq(textbookUnits.id, textbookSections.unitId))
        .innerJoin(textbookEditions, eq(textbookEditions.id, textbookUnits.textbookEditionId))
        .where(and(inArray(textbookSections.id, input.sectionIds), eq(textbookEditions.subject, input.subject)))
        .orderBy(asc(textbookUnits.unitOrder), asc(textbookSections.sectionOrder));
      if (sections.length !== input.sectionIds.length) throw new Error("TASK_SECTION_NOT_FOUND");
      const existing = await tx.select().from(learningTasks).where(and(
        eq(learningTasks.familyId, actor.familyId),
        eq(learningTasks.childId, input.childId),
        eq(learningTasks.batchCommandId, input.commandId),
      ));
      if (existing.length > 0) {
        const sectionSet = new Set(sections.map((section) => section.id));
        if (existing.some((task) => !task.inputFingerprint.endsWith(`:${batchFingerprint}`) ||
          (task.sectionId ? !sectionSet.has(task.sectionId) : task.origin !== "extra_practice")) ||
          (input.extraCardIds.length > 0 && !existing.some((task) => task.origin === "extra_practice"))) {
          throw new Error("TASK_IDEMPOTENCY_CONFLICT");
        }
        return Promise.all(existing.map((task) => loadTask(tx, actor, task.id)));
      }
      const extraCards = input.extraCardIds.length === 0 ? [] : await tx.select({ id: learningCards.id })
        .from(learningCards).where(and(inArray(learningCards.id, input.extraCardIds),
          eq(learningCards.subject, input.subject),
          or(eq(learningCards.familyId, actor.familyId), isNull(learningCards.familyId))));
      if (extraCards.length !== input.extraCardIds.length || new Set(input.extraCardIds).size !== input.extraCardIds.length) {
        throw new Error("TASK_CARD_NOT_FOUND");
      }
      const actorCards = await tx.select({ card: learningCards }).from(learningCards).where(and(
        eq(learningCards.subject, input.subject),
        or(eq(learningCards.familyId, actor.familyId), isNull(learningCards.familyId)),
        inArray(learningCards.sectionId, input.sectionIds),
      ));
      const active = new Set((await getActiveTaskCards(tx, actor.familyId, [input.childId])).map((row) => row.cardId));
      const started = actorCards.length === 0 ? new Set<string>() : new Set((await tx.select({ cardId: childCardStates.cardId })
        .from(childCardStates).where(and(eq(childCardStates.familyId, actor.familyId), eq(childCardStates.childId, input.childId),
          inArray(childCardStates.cardId, actorCards.map(({ card }) => card.id))))).map((row) => row.cardId));
      const result: LearningTask[] = [];
      for (const section of sections) {
        const ids = actorCards.filter(({ card }) => card.sectionId === section.id && !active.has(card.id) && !started.has(card.id)).map(({ card }) => card.id);
        if (ids.length === 0) continue;
        const title = `${input.subject === "chinese" ? "语文" : "英语"} · ${section.unitTitle} · ${section.title}`;
        result.push(await createDictationTaskService(tx, now, random).buildDailyTask(actor, {
          childId: input.childId, subject: input.subject, newCardIds: ids,
          commandId: derivedCommandId(input.commandId, section.id), maxReviewCards: 0,
          mode: input.mode, order: input.order, intervalSeconds: input.intervalSeconds,
          repeatCount: input.repeatCount, speechRate: input.speechRate, allowManualReplay: input.allowManualReplay,
        }, { origin: "curriculum", title, sectionId: section.id, batchCommandId: input.commandId, batchFingerprint }));
      }
      if (input.extraCardIds.length > 0) {
        const title = `${input.subject === "chinese" ? "语文" : "英语"} · 单独加练`;
        result.push(await createDictationTaskService(tx, now, random).buildDailyTask(actor, {
          childId: input.childId, subject: input.subject, newCardIds: input.extraCardIds,
          commandId: derivedCommandId(input.commandId, "extra"), maxReviewCards: 0,
          mode: input.mode, order: input.order, intervalSeconds: input.intervalSeconds,
          repeatCount: input.repeatCount, speechRate: input.speechRate, allowManualReplay: input.allowManualReplay,
        }, { origin: "extra_practice", title, batchCommandId: input.commandId, batchFingerprint }));
      }
      if (result.length === 0) throw new Error("TASK_EMPTY");
      return result;
    });
  }

  async function getTask(actor: Actor, taskId: string): Promise<LearningTask> {
    return loadTask(database, actor, taskId);
  }

  async function getDueCards(actor: ChildActor, at: Date, limit: number) {
    return createReviewService(database).getDueCards(actor, at, limit);
  }

  return { buildDailyTask, buildTaskBatch, getDueCards, getTask };
}

const taskService = createDictationTaskService();
export const buildDailyTask = taskService.buildDailyTask;
export const getDueCards = taskService.getDueCards;
