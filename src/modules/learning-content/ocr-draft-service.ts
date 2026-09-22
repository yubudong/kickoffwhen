import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db, type DbTransaction } from "@/db/client";
import type { GuardianActor } from "@/modules/auth/actor";
import { jobs } from "@/modules/jobs/schema";

import { ocrDraftLines, ocrDrafts } from "./schema";

export type OcrProviderStatus = "disabled" | "mock";
export type OcrDraftView = {
  draftId: string;
  subject: "chinese" | "english";
  status: "provider_disabled" | "queued" | "running" | "ready" | "empty" | "failed" | "finalized";
  lines: Array<{
    id: string;
    sourceText: string;
    sourceOrder: number;
    status: "draft" | "confirmed" | "rejected";
  }>;
};

type OcrDraftDatabase = typeof db | DbTransaction;
const runOcrJobPayloadSchema = z.object({
  familyId: z.string().uuid(),
  guardianId: z.string().uuid(),
  draftId: z.string().uuid(),
  mediaId: z.string().uuid(),
}).strict();

export function createOcrDraftService(database: OcrDraftDatabase = db) {
  async function getDraft(
    actor: GuardianActor,
    input: {
      draftId: string;
      jobId: string;
      providerStatus: OcrProviderStatus;
    },
  ): Promise<OcrDraftView> {
    const value = z
      .object({
        draftId: z.string().uuid(),
        jobId: z.string().uuid(),
        providerStatus: z.enum(["disabled", "mock"]),
      })
      .parse(input);
    const [[draft], [job]] = await Promise.all([
      database
        .select()
        .from(ocrDrafts)
        .where(
          and(
            eq(ocrDrafts.id, value.draftId),
            eq(ocrDrafts.familyId, actor.familyId),
          ),
        )
        .limit(1),
      database.select().from(jobs).where(eq(jobs.id, value.jobId)).limit(1),
    ]);
    const payload = job ? runOcrJobPayloadSchema.safeParse(job.payload) : null;
    if (
      !draft ||
      !job ||
      job.type !== "run_ocr" ||
      !payload?.success ||
      payload.data.familyId !== actor.familyId ||
      payload.data.guardianId !== draft.guardianId ||
      payload.data.draftId !== draft.id
    ) {
      throw new Error("OCR_DRAFT_NOT_FOUND");
    }

    const rows = await database
      .select()
      .from(ocrDraftLines)
      .where(
        and(
          eq(ocrDraftLines.familyId, actor.familyId),
          eq(ocrDraftLines.draftId, draft.id),
        ),
      )
      .orderBy(ocrDraftLines.sourceOrder, ocrDraftLines.id);
    const jobStatus = z
      .enum(["queued", "running", "succeeded", "failed"])
      .parse(job.status);
    const allFinalized = rows.length > 0 && rows.every((line) => line.status !== "draft");
    const partiallyFinalized = rows.some((line) => line.status !== "draft") && !allFinalized;
    const status: OcrDraftView["status"] =
      allFinalized
        ? "finalized"
        : partiallyFinalized || jobStatus === "failed"
        ? "failed"
        : jobStatus === "succeeded"
          ? rows.length === 0
            ? "empty"
            : "ready"
          : value.providerStatus === "disabled"
            ? "provider_disabled"
            : jobStatus;
    return {
      draftId: draft.id,
      subject: z.enum(["chinese", "english"]).parse(draft.subject),
      status,
      lines: rows.map((line) => ({
        id: line.id,
        sourceText: line.sourceText,
        sourceOrder: line.sourceOrder,
        status: z.enum(["draft", "confirmed", "rejected"]).parse(line.status),
      })),
    };
  }

  return { getDraft };
}

export const ocrDraftService = createOcrDraftService();
