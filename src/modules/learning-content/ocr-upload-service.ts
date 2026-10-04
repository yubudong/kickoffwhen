import { db, type DbTransaction } from "@/db/client";
import type { GuardianActor } from "@/modules/auth/actor";
import { createJobService } from "@/modules/jobs/service";
import {
  createPrivateMediaStore,
  type privateMediaStore,
} from "@/modules/media/store";

import { ocrDrafts } from "./schema";

type OcrUploadDatabase = typeof db | DbTransaction;
type MediaStore = typeof privateMediaStore;

export type OcrUploadInput = {
  subject: "chinese" | "english";
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
};

function assertOcrUpload(input: OcrUploadInput) {
  if (input.mimeType !== "image/jpeg" && input.mimeType !== "image/png") {
    throw new Error("OCR_UPLOAD_MIME_INVALID");
  }
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > 10 * 1024 * 1024) {
    throw new Error("OCR_UPLOAD_SIZE_INVALID");
  }
}

export function createOcrUploadService({
  database = db,
  mediaStore = createPrivateMediaStore({ database }),
  now = () => new Date(),
}: {
  database?: OcrUploadDatabase;
  mediaStore?: MediaStore;
  now?: () => Date;
} = {}) {
  async function createUpload(actor: GuardianActor, input: OcrUploadInput) {
    assertOcrUpload(input);
    const source = await mediaStore.put({
      familyId: actor.familyId,
      childId: null,
      kind: "ocr_source",
      bytes: input.bytes,
      mimeType: input.mimeType,
      expiresAt: new Date(now().getTime() + 7 * 24 * 60 * 60 * 1000),
    });

    try {
      return await database.transaction(async (tx) => {
        const [draft] = await tx
          .insert(ocrDrafts)
          .values({
            familyId: actor.familyId,
            guardianId: actor.guardianId,
            subject: input.subject,
          })
          .returning({ id: ocrDrafts.id });
        const job = await createJobService(tx, now).enqueueJob(
          "run_ocr",
          {
            familyId: actor.familyId,
            guardianId: actor.guardianId,
            draftId: draft.id,
            mediaId: source.id,
          },
          `ocr:${actor.familyId}:${draft.id}:${source.id}`,
        );
        return { draftId: draft.id, jobId: job.id };
      });
    } catch (error) {
      await mediaStore.remove(actor.familyId, source.id).catch(() => undefined);
      throw error;
    }
  }

  return { createUpload };
}

export const ocrUploadService = createOcrUploadService();
