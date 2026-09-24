import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db, type DbTransaction } from "@/db/client";
import type { GuardianActor } from "@/modules/auth/actor";
import type { TtsInput } from "@/modules/learning-content/tts-provider";
import { isActiveTtsMedia } from "@/modules/media/active-cache";
import { privateMedia } from "@/modules/media/schema";

import { jobs } from "./schema";

export type JobType =
  | "generate_tts"
  | "run_ocr"
  | "delete_media"
  | "build_weekly_report";

export type Job = {
  id: string;
  type: JobType;
  status: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  availableAt: Date;
  lastError: string | null;
};

export type GenerateTtsJobPayload = TtsInput & {
  familyId: string;
  childId: string;
  cardId: string;
};

export type RunOcrJobPayload = {
  familyId: string;
  guardianId: string;
  draftId: string;
  mediaId: string;
};

type JobDatabase = typeof db | DbTransaction;

const jobTypeSchema = z.enum([
  "generate_tts",
  "run_ocr",
  "delete_media",
  "build_weekly_report",
]);
const dedupeKeySchema = z.string().trim().min(1).max(500);
export const generateTtsJobPayloadSchema = z
  .object({
    familyId: z.string().uuid(),
    childId: z.string().uuid(),
    cardId: z.string().uuid(),
    text: z.string().min(1).max(500),
    language: z.enum(["zh-CN", "en-US"]),
    voice: z.enum(["zh-CN-XiaoxiaoNeural", "en-US-JennyNeural"]),
    rate: z.number().finite().min(0.5).max(2),
  })
  .strict();

function toJob(row: typeof jobs.$inferSelect): Job {
  return {
    id: row.id,
    type: jobTypeSchema.parse(row.type),
    status: z
      .enum(["queued", "running", "succeeded", "failed"])
      .parse(row.status),
    attempts: row.attempts,
    availableAt: row.availableAt,
    lastError: row.lastError,
  };
}

export function buildTtsDedupeKey(payload: GenerateTtsJobPayload): string {
  const textHash = createHash("sha256").update(payload.text).digest("hex");
  const rate = Number.isFinite(payload.rate) ? payload.rate.toFixed(3) : "invalid";
  return [
    "tts",
    payload.familyId,
    payload.childId,
    payload.cardId,
    payload.language,
    payload.voice,
    rate,
    textHash,
  ].join(":");
}

export function createJobService(
  database: JobDatabase = db,
  now: () => Date = () => new Date(),
) {
  async function enqueueJob<T>(
    type: JobType,
    payload: T,
    dedupeKey: string,
  ): Promise<Job> {
    const value = {
      type: jobTypeSchema.parse(type),
      dedupeKey: dedupeKeySchema.parse(dedupeKey),
    };
    const [created] = await database
      .insert(jobs)
      .values({
        type: value.type,
        payload,
        status: "queued",
        attempts: 0,
        availableAt: now(),
        dedupeKey: value.dedupeKey,
      })
      .onConflictDoNothing({ target: jobs.dedupeKey })
      .returning();
    if (created) return toJob(created);

    const [existing] = await database
      .select()
      .from(jobs)
      .where(eq(jobs.dedupeKey, value.dedupeKey))
      .limit(1);
    if (!existing) throw new Error("JOB_ENQUEUE_CONFLICT");
    return toJob(existing);
  }

  async function getJob(id: string): Promise<Job | null> {
    const [row] = await database
      .select()
      .from(jobs)
      .where(eq(jobs.id, id))
      .limit(1);
    return row ? toJob(row) : null;
  }

  async function requeueTts(
    actor: GuardianActor,
    id: string,
    allowedStatus: "failed" | "failed_or_succeeded",
  ): Promise<Job> {
    const parsedId = z.string().uuid().safeParse(id);
    if (!parsedId.success) throw new Error("JOB_NOT_FOUND");
    return database.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(jobs)
        .where(eq(jobs.id, parsedId.data))
        .limit(1)
        .for("update");
      const payload = row
        ? generateTtsJobPayloadSchema.safeParse(row.payload)
        : null;
      const statusAllowed =
        row?.status === "failed" ||
        (allowedStatus === "failed_or_succeeded" && row?.status === "succeeded");
      if (
        !row ||
        row.type !== "generate_tts" ||
        !statusAllowed ||
        !payload?.success ||
        payload.data.familyId !== actor.familyId ||
        buildTtsDedupeKey(payload.data) !== row.dedupeKey
      ) {
        throw new Error("JOB_NOT_FOUND");
      }

      const cacheAt = now();
      const [cached] = await tx
        .select()
        .from(privateMedia)
        .where(eq(privateMedia.dedupeKey, row.dedupeKey))
        .limit(1)
        .for("update");
      if (cached) {
        const cacheScope = {
          dedupeKey: row.dedupeKey,
          familyId: payload.data.familyId,
          childId: payload.data.childId,
          at: cacheAt,
        };
        if (
          cached.familyId !== cacheScope.familyId ||
          cached.childId !== cacheScope.childId ||
          cached.kind !== "tts_audio"
        ) {
          throw new Error("JOB_NOT_FOUND");
        }
        if (isActiveTtsMedia(cached, cacheScope)) {
          throw new Error("JOB_TTS_CACHE_EXISTS");
        }
        await tx
          .update(privateMedia)
          .set({ deletedAt: cached.deletedAt ?? cacheAt, dedupeKey: null })
          .where(eq(privateMedia.id, cached.id));
      }

      const [requeued] = await tx
        .update(jobs)
        .set({
          status: "queued",
          attempts: 0,
          availableAt: now(),
          lockedAt: null,
          lastError: null,
        })
        .where(
          and(
            eq(jobs.id, row.id),
            eq(jobs.type, "generate_tts"),
            eq(jobs.status, row.status),
          ),
        )
        .returning();
      if (!requeued) throw new Error("JOB_NOT_FOUND");
      return toJob(requeued);
    });
  }

  async function requeueFailedJob(actor: GuardianActor, id: string) {
    return requeueTts(actor, id, "failed");
  }

  async function requeueTtsJob(actor: GuardianActor, id: string) {
    return requeueTts(actor, id, "failed_or_succeeded");
  }

  return { enqueueJob, getJob, requeueFailedJob, requeueTtsJob };
}

const jobService = createJobService();

export const enqueueJob = jobService.enqueueJob;
