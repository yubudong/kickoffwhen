import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db, type DbTransaction } from "@/db/client";
import { children } from "@/modules/families/schema";
import {
  learningCards,
  ocrDraftLines,
  ocrDrafts,
} from "@/modules/learning-content/schema";
import type { OcrProvider } from "@/modules/learning-content/ocr-provider";
import { ocrLinesSchema } from "@/modules/learning-content/ocr-lines";
import type { TtsProvider } from "@/modules/learning-content/tts-provider";
import { isActiveTtsMedia } from "@/modules/media/active-cache";
import type { createPrivateMediaStore } from "@/modules/media/store";

import { jobs } from "./schema";
import {
  buildTtsDedupeKey,
  generateTtsJobPayloadSchema,
  type Job,
  type JobType,
} from "./service";

const MAX_ATTEMPTS = 5;
const RUNNING_LEASE_MS = 15 * 60 * 1000;
const ORPHAN_MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

const runOcrPayloadSchema = z.object({
  familyId: z.string().uuid(),
  guardianId: z.string().uuid(),
  draftId: z.string().uuid(),
  mediaId: z.string().uuid(),
});

const deleteMediaPayloadSchema = z.object({
  familyId: z.string().uuid(),
  mediaId: z.string().uuid(),
});

type JobDatabase = typeof db | DbTransaction;
type MediaStore = ReturnType<typeof createPrivateMediaStore>;

function publicJob(row: typeof jobs.$inferSelect): Job {
  return {
    id: row.id,
    type: row.type as JobType,
    status: row.status as Job["status"],
    attempts: row.attempts,
    availableAt: row.availableAt,
    lastError: row.lastError,
  };
}

function sanitizeJobError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (
    /^(?:TTS|OCR)_(?:UPSTREAM_(?:\d{3}|UNAVAILABLE)|INVALID_RESPONSE|VOICE_LANGUAGE_MISMATCH|RATE_INVALID|TEXT_INVALID)$/.test(
      message,
    )
  ) {
    return message;
  }
  if (
    [
      "JOB_PAYLOAD_INVALID",
      "JOB_DEDUPE_INVALID",
      "JOB_SCOPE_INVALID",
      "JOB_TYPE_NOT_IMPLEMENTED",
      "MEDIA_NOT_FOUND",
    ].includes(message)
  ) {
    return message;
  }
  return "JOB_HANDLER_FAILED";
}

async function readAll(
  stream: ReadableStream<Uint8Array>,
  maximumBytes = 10 * 1024 * 1024,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new Error("MEDIA_TOO_LARGE");
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createJobWorker({
  database = db,
  mediaStore,
  ttsProvider,
  ocrProvider,
  now = () => new Date(),
  reconcileOrphans,
  claimDedupeKeys,
}: {
  database?: JobDatabase;
  mediaStore: MediaStore;
  ttsProvider?: TtsProvider;
  ocrProvider?: OcrProvider;
  now?: () => Date;
  reconcileOrphans?: MediaStore["reconcileOrphans"];
  claimDedupeKeys?: readonly string[];
}) {
  const activeTypes: JobType[] = ["delete_media"];
  if (ttsProvider) activeTypes.push("generate_tts");
  if (ocrProvider) activeTypes.push("run_ocr");
  const claimScope = claimDedupeKeys
    ? [...new Set(claimDedupeKeys)]
    : null;
  const runOrphanReconciler =
    reconcileOrphans ?? ((options) => mediaStore.reconcileOrphans(options));
  let nextOrphanMaintenanceAt = 0;

  async function runOrphanMaintenanceIfDue(): Promise<void> {
    const maintenanceAt = now();
    if (maintenanceAt.getTime() < nextOrphanMaintenanceAt) return;
    nextOrphanMaintenanceAt =
      maintenanceAt.getTime() + ORPHAN_MAINTENANCE_INTERVAL_MS;
    try {
      await runOrphanReconciler({
        now: maintenanceAt,
        graceMs: ORPHAN_GRACE_MS,
      });
    } catch {
      // Maintenance is best-effort and must not expose private paths or stop jobs.
    }
  }

  async function claimOne() {
    if (activeTypes.length === 0 || claimScope?.length === 0) return null;
    const claimedAt = now();
    return database.transaction(async (tx) => {
      const staleBefore = new Date(claimedAt.getTime() - RUNNING_LEASE_MS);
      await tx
        .update(jobs)
        .set({
          status: sql`case when ${jobs.attempts} >= ${MAX_ATTEMPTS} then 'failed' else 'queued' end`,
          availableAt: claimedAt,
          lockedAt: null,
          lastError: "JOB_LEASE_EXPIRED",
        })
        .where(
          and(
            eq(jobs.status, "running"),
            inArray(jobs.type, activeTypes),
            ...(claimScope ? [inArray(jobs.dedupeKey, claimScope)] : []),
            lte(jobs.lockedAt, staleBefore),
          ),
        );

      const [candidate] = await tx
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.status, "queued"),
            inArray(jobs.type, activeTypes),
            ...(claimScope ? [inArray(jobs.dedupeKey, claimScope)] : []),
            lte(jobs.availableAt, claimedAt),
            lt(jobs.attempts, MAX_ATTEMPTS),
          ),
        )
        .orderBy(asc(jobs.availableAt), asc(jobs.id))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!candidate) return null;

      const [claimed] = await tx
        .update(jobs)
        .set({
          status: "running",
          attempts: sql`${jobs.attempts} + 1`,
          lockedAt: claimedAt,
          lastError: null,
        })
        .where(and(eq(jobs.id, candidate.id), eq(jobs.status, "queued")))
        .returning();
      return claimed ?? null;
    });
  }

  async function generateTts(payloadValue: unknown, dedupeKey: string) {
    if (!ttsProvider) throw new Error("JOB_TYPE_NOT_IMPLEMENTED");
    const parsed = generateTtsJobPayloadSchema.safeParse(payloadValue);
    if (!parsed.success) throw new Error("JOB_PAYLOAD_INVALID");
    const payload = parsed.data;
    if (buildTtsDedupeKey(payload) !== dedupeKey) {
      throw new Error("JOB_DEDUPE_INVALID");
    }
    const cached = await mediaStore.findByDedupeKey(dedupeKey);
    if (cached) {
      if (
        cached.familyId !== payload.familyId ||
        cached.childId !== payload.childId ||
        cached.kind !== "tts_audio"
      ) {
        throw new Error("JOB_SCOPE_INVALID");
      }
      if (isActiveTtsMedia(
        { ...cached, dedupeKey, deletedAt: null },
        {
          dedupeKey,
          familyId: payload.familyId,
          childId: payload.childId,
          at: now(),
        },
      )) return;
    }

    const [[child], [card]] = await Promise.all([
      database
        .select({ id: children.id })
        .from(children)
        .where(
          and(
            eq(children.id, payload.childId),
            eq(children.familyId, payload.familyId),
            eq(children.active, true),
          ),
        )
        .limit(1),
      database
        .select({
          id: learningCards.id,
          broadcastText: learningCards.broadcastText,
        })
        .from(learningCards)
        .where(
          and(
            eq(learningCards.id, payload.cardId),
            or(
              eq(learningCards.familyId, payload.familyId),
              isNull(learningCards.familyId),
            ),
          ),
        )
        .limit(1),
    ]);
    if (!child || !card || card.broadcastText !== payload.text) {
      throw new Error("JOB_SCOPE_INVALID");
    }

    const generated = await ttsProvider.synthesize({
      text: payload.text,
      language: payload.language,
      voice: payload.voice,
      rate: payload.rate,
    });
    await mediaStore.put({
      familyId: payload.familyId,
      childId: payload.childId,
      kind: "tts_audio",
      bytes: generated.bytes,
      mimeType: generated.mimeType,
      expiresAt: null,
      dedupeKey,
    });
  }

  async function runOcr(payloadValue: unknown) {
    if (!ocrProvider) throw new Error("JOB_TYPE_NOT_IMPLEMENTED");
    const parsed = runOcrPayloadSchema.safeParse(payloadValue);
    if (!parsed.success) throw new Error("JOB_PAYLOAD_INVALID");
    const payload = parsed.data;
    const [draft] = await database
      .select({ id: ocrDrafts.id })
      .from(ocrDrafts)
      .where(
        and(
          eq(ocrDrafts.id, payload.draftId),
          eq(ocrDrafts.familyId, payload.familyId),
          eq(ocrDrafts.guardianId, payload.guardianId),
        ),
      )
      .limit(1);
    if (!draft) throw new Error("JOB_SCOPE_INVALID");

    const [existing] = await database
      .select({ id: ocrDraftLines.id })
      .from(ocrDraftLines)
      .where(
        and(
          eq(ocrDraftLines.draftId, payload.draftId),
          eq(ocrDraftLines.familyId, payload.familyId),
        ),
      )
      .limit(1);
    if (existing) return;

    const media = await mediaStore.openWithMetadata(
      {
        role: "guardian",
        familyId: payload.familyId,
        guardianId: payload.guardianId,
      },
      payload.mediaId,
    );
    if (
      media.kind !== "ocr_source" ||
      (media.mimeType !== "image/jpeg" && media.mimeType !== "image/png")
    ) {
      throw new Error("JOB_SCOPE_INVALID");
    }
    const lines = ocrLinesSchema.parse(
      await ocrProvider.read({
        bytes: await readAll(media.stream),
        mimeType: media.mimeType,
      }),
    );
    if (new Set(lines.map((line) => line.order)).size !== lines.length) {
      throw new Error("JOB_HANDLER_FAILED");
    }
    if (lines.length === 0) return;

    await database.transaction(async (tx) => {
      const [alreadyWritten] = await tx
        .select({ id: ocrDraftLines.id })
        .from(ocrDraftLines)
        .where(
          and(
            eq(ocrDraftLines.draftId, payload.draftId),
            eq(ocrDraftLines.familyId, payload.familyId),
          ),
        )
        .limit(1)
        .for("update");
      if (alreadyWritten) return;
      await tx.insert(ocrDraftLines).values(
        lines.map((line) => ({
          familyId: payload.familyId,
          draftId: payload.draftId,
          sourceText: line.text,
          sourceOrder: line.order,
          status: "draft",
        })),
      );
    });
  }

  async function deleteMedia(payloadValue: unknown) {
    const parsed = deleteMediaPayloadSchema.safeParse(payloadValue);
    if (!parsed.success) throw new Error("JOB_PAYLOAD_INVALID");
    await mediaStore.remove(parsed.data.familyId, parsed.data.mediaId);
  }

  async function handle(row: typeof jobs.$inferSelect) {
    if (row.type === "generate_tts") {
      if (!ttsProvider) throw new Error("JOB_TYPE_NOT_IMPLEMENTED");
      await generateTts(row.payload, row.dedupeKey);
      return;
    }
    if (row.type === "run_ocr") {
      if (!ocrProvider) throw new Error("JOB_TYPE_NOT_IMPLEMENTED");
      await runOcr(row.payload);
      return;
    }
    if (row.type === "delete_media") {
      await deleteMedia(row.payload);
      return;
    }
    throw new Error("JOB_TYPE_NOT_IMPLEMENTED");
  }

  async function runOnce(): Promise<Job | null> {
    const claimed = await claimOne();
    if (!claimed) {
      await runOrphanMaintenanceIfDue();
      return null;
    }
    if (!claimed.lockedAt) return null;
    const ownsLease = and(
      eq(jobs.id, claimed.id),
      eq(jobs.status, "running"),
      eq(jobs.lockedAt, claimed.lockedAt),
      eq(jobs.attempts, claimed.attempts),
    );

    try {
      await handle(claimed);
      const [succeeded] = await database
        .update(jobs)
        .set({ status: "succeeded", lockedAt: null, lastError: null })
        .where(ownsLease)
        .returning();
      if (!succeeded) return null;
      return publicJob(succeeded);
    } catch (error) {
      const terminal = claimed.attempts >= MAX_ATTEMPTS;
      const retryDelay = RETRY_DELAYS_MS[Math.max(0, claimed.attempts - 1)] ?? 0;
      const [failed] = await database
        .update(jobs)
        .set({
          status: terminal ? "failed" : "queued",
          availableAt: terminal
            ? claimed.availableAt
            : new Date(now().getTime() + retryDelay),
          lockedAt: null,
          lastError: sanitizeJobError(error),
        })
        .where(ownsLease)
        .returning();
      if (!failed) return null;
      return publicJob(failed);
    }
  }

  return { runOnce };
}
