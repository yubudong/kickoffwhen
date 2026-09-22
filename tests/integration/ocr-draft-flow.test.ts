import { eq } from "drizzle-orm";
import { expect, test } from "vitest";

import { user as authUsers } from "@/modules/auth/schema";
import { families, guardians } from "@/modules/families/schema";
import { jobs } from "@/modules/jobs/schema";
import { createOcrDraftService } from "@/modules/learning-content/ocr-draft-service";
import { ocrDraftLines, ocrDrafts } from "@/modules/learning-content/schema";

import { withDatabaseRollback } from "../helpers/database";

test("OCR 草稿状态校验家庭、草稿与任务绑定", async () => {
  await withDatabaseRollback(async (tx) => {
    const suffix = crypto.randomUUID();
    await tx.insert(authUsers).values([
      { id: `ocr-state-a-${suffix}`, name: "A", email: `ocr-state-a-${suffix}@example.test` },
      { id: `ocr-state-b-${suffix}`, name: "B", email: `ocr-state-b-${suffix}@example.test` },
    ]);
    const [familyA, familyB] = await tx
      .insert(families)
      .values([{ name: `OCR state A-${suffix}` }, { name: `OCR state B-${suffix}` }])
      .returning();
    const [guardianA, guardianB] = await tx
      .insert(guardians)
      .values([
        { familyId: familyA.id, authUserId: `ocr-state-a-${suffix}` },
        { familyId: familyB.id, authUserId: `ocr-state-b-${suffix}` },
      ])
      .returning();
    const [draft] = await tx
      .insert(ocrDrafts)
      .values({ familyId: familyA.id, guardianId: guardianA.id, subject: "english" })
      .returning();
    await tx.insert(ocrDraftLines).values({
      familyId: familyA.id,
      draftId: draft.id,
      sourceText: "mountain",
      sourceOrder: 0,
    });
    const mediaId = crypto.randomUUID();
    const [job] = await tx
      .insert(jobs)
      .values({
        type: "run_ocr",
        payload: {
          familyId: familyA.id,
          guardianId: guardianA.id,
          draftId: draft.id,
          mediaId,
        },
        status: "succeeded",
        attempts: 1,
        availableAt: new Date(),
        dedupeKey: `ocr-state:${suffix}`,
      })
      .returning();
    const service = createOcrDraftService(tx);
    const actorA = { role: "guardian" as const, familyId: familyA.id, guardianId: guardianA.id };
    const actorB = { role: "guardian" as const, familyId: familyB.id, guardianId: guardianB.id };

    await expect(service.getDraft(actorA, {
      draftId: draft.id,
      jobId: job.id,
      providerStatus: "mock",
    })).resolves.toMatchObject({
      draftId: draft.id,
      status: "ready",
      lines: [{ sourceText: "mountain", sourceOrder: 0, status: "draft" }],
    });
    await tx.update(jobs).set({ status: "queued" }).where(eq(jobs.id, job.id));
    await expect(service.getDraft(actorA, {
      draftId: draft.id,
      jobId: job.id,
      providerStatus: "disabled",
    })).resolves.toMatchObject({ status: "provider_disabled" });
    await tx
      .update(ocrDraftLines)
      .set({ status: "rejected" })
      .where(eq(ocrDraftLines.draftId, draft.id));
    await expect(service.getDraft(actorA, {
      draftId: draft.id,
      jobId: job.id,
      providerStatus: "mock",
    })).resolves.toMatchObject({ status: "finalized" });
    await expect(service.getDraft(actorB, {
      draftId: draft.id,
      jobId: job.id,
      providerStatus: "mock",
    })).rejects.toThrow("OCR_DRAFT_NOT_FOUND");
    await expect(service.getDraft(actorA, {
      draftId: draft.id,
      jobId: crypto.randomUUID(),
      providerStatus: "mock",
    })).rejects.toThrow("OCR_DRAFT_NOT_FOUND");
  });
});

test("OCR 任务成功但没有识别行时返回可结束的空结果", async () => {
  await withDatabaseRollback(async (tx) => {
    const suffix = crypto.randomUUID();
    await tx.insert(authUsers).values({
      id: `ocr-empty-${suffix}`,
      name: "Empty",
      email: `ocr-empty-${suffix}@example.test`,
    });
    const [family] = await tx.insert(families).values({ name: `OCR empty-${suffix}` }).returning();
    const [guardian] = await tx.insert(guardians).values({
      familyId: family.id,
      authUserId: `ocr-empty-${suffix}`,
    }).returning();
    const [draft] = await tx.insert(ocrDrafts).values({
      familyId: family.id,
      guardianId: guardian.id,
      subject: "chinese",
    }).returning();
    const [job] = await tx.insert(jobs).values({
      type: "run_ocr",
      payload: {
        familyId: family.id,
        guardianId: guardian.id,
        draftId: draft.id,
        mediaId: crypto.randomUUID(),
      },
      status: "succeeded",
      attempts: 1,
      availableAt: new Date(),
      dedupeKey: `ocr-empty:${suffix}`,
    }).returning();

    await expect(createOcrDraftService(tx).getDraft(
      { role: "guardian", familyId: family.id, guardianId: guardian.id },
      { draftId: draft.id, jobId: job.id, providerStatus: "mock" },
    )).resolves.toMatchObject({ status: "empty", lines: [] });
  });
});
