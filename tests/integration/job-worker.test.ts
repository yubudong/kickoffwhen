import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterEach, expect, test } from "vitest";

import { db } from "@/db/client";
import * as databaseSchema from "@/db/schema";
import { user as authUsers } from "@/modules/auth/schema";
import { children, families, guardians } from "@/modules/families/schema";
import {
  buildTtsDedupeKey,
  createJobService,
  type GenerateTtsJobPayload,
} from "@/modules/jobs/service";
import { jobs } from "@/modules/jobs/schema";
import { createJobWorker } from "@/modules/jobs/worker";
import {
  learningCards,
  ocrDraftLines,
  ocrDrafts,
} from "@/modules/learning-content/schema";
import type { OcrProvider } from "@/modules/learning-content/ocr-provider";
import type { TtsInput, TtsProvider } from "@/modules/learning-content/tts-provider";
import { privateMedia } from "@/modules/media/schema";
import { createPrivateMediaStore } from "@/modules/media/store";

import { withDatabaseRollback } from "../helpers/database";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function temporaryMediaRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "family-learning-media-"));
  temporaryRoots.push(root);
  return root;
}

async function readAll(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
    size += result.value.byteLength;
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

class RecordingTtsProvider implements TtsProvider {
  calls: TtsInput[] = [];

  async synthesize(input: TtsInput) {
    this.calls.push(input);
    return {
      bytes: new TextEncoder().encode(`audio:${input.text}`),
      mimeType: "audio/mpeg" as const,
    };
  }
}

class BlockingTtsProvider implements TtsProvider {
  private enter!: () => void;
  private release!: () => void;
  readonly entered = new Promise<void>((resolve) => {
    this.enter = resolve;
  });
  private readonly released = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  async synthesize(input: TtsInput) {
    this.enter();
    await this.released;
    return {
      bytes: new TextEncoder().encode(`audio:${input.text}`),
      mimeType: "audio/mpeg" as const,
    };
  }

  unblock() {
    this.release();
  }
}

const unusedOcrProvider: OcrProvider = {
  async read() {
    throw new Error("OCR_PROVIDER_NOT_EXPECTED");
  },
};

test("同一卡片和完整语音参数只生成一份家庭隔离缓存", async () => {
  await withDatabaseRollback(async (tx) => {
    const root = await temporaryMediaRoot();
    const suffix = crypto.randomUUID();
    await tx.insert(authUsers).values({
      id: `tts-${suffix}`,
      name: "TTS 家长",
      email: `tts-${suffix}@example.test`,
    });
    const [family] = await tx.insert(families).values({ name: `TTS-${suffix}` }).returning();
    const [guardian] = await tx
      .insert(guardians)
      .values({ familyId: family.id, authUserId: `tts-${suffix}` })
      .returning();
    const [child] = await tx
      .insert(children)
      .values({ familyId: family.id, nickname: "小山", grade: 5 })
      .returning();
    const [card] = await tx
      .insert(learningCards)
      .values({
        familyId: family.id,
        subject: "chinese",
        answerText: "山峰",
        broadcastText: "山峰",
        source: "manual",
      })
      .returning();
    const payload: GenerateTtsJobPayload = {
      familyId: family.id,
      childId: child.id,
      cardId: card.id,
      text: card.broadcastText,
      language: "zh-CN",
      voice: "zh-CN-XiaoxiaoNeural",
      rate: 1,
    };
    const dedupeKey = buildTtsDedupeKey(payload);
    const jobService = createJobService(tx);
    const first = await jobService.enqueueJob("generate_tts", payload, dedupeKey);
    const duplicate = await jobService.enqueueJob("generate_tts", payload, dedupeKey);
    expect(duplicate.id).toBe(first.id);

    const ttsProvider = new RecordingTtsProvider();
    const mediaStore = createPrivateMediaStore({ database: tx, root });
    const worker = createJobWorker({
      database: tx,
      mediaStore,
      ttsProvider,
      ocrProvider: unusedOcrProvider,
      claimDedupeKeys: [dedupeKey],
    });
    await worker.runOnce();

    expect(await tx.select().from(privateMedia).where(eq(privateMedia.dedupeKey, dedupeKey))).toHaveLength(1);
    expect(ttsProvider.calls).toHaveLength(1);

    // Simulate a crash after the media commit but before durable job success.
    await tx
      .update(jobs)
      .set({ status: "queued", availableAt: new Date(0) })
      .where(eq(jobs.id, first.id));
    await worker.runOnce();
    expect(await tx.select().from(privateMedia).where(eq(privateMedia.dedupeKey, dedupeKey))).toHaveLength(1);
    expect(ttsProvider.calls).toHaveLength(1);

    const media = (await tx.select().from(privateMedia).where(eq(privateMedia.dedupeKey, dedupeKey)))[0];
    const opened = await mediaStore.open(
      { role: "guardian", familyId: family.id, guardianId: guardian.id },
      media.id,
    );
    expect(new TextDecoder().decode(await readAll(opened))).toBe("audio:山峰");

    const healthyDuplicate = await jobService.enqueueJob(
      "generate_tts",
      payload,
      dedupeKey,
    );
    expect(healthyDuplicate).toMatchObject({
      id: first.id,
      status: "succeeded",
      attempts: 2,
    });
    await expect(
      jobService.requeueTtsJob(
        { role: "guardian", familyId: family.id, guardianId: guardian.id },
        first.id,
      ),
    ).rejects.toThrow("JOB_TTS_CACHE_EXISTS");

    await mediaStore.remove(family.id, media.id);
    const regenerated = await jobService.requeueTtsJob(
      { role: "guardian", familyId: family.id, guardianId: guardian.id },
      first.id,
    );
    expect(regenerated).toMatchObject({ id: first.id, status: "queued", attempts: 0 });
    await worker.runOnce();
    expect(ttsProvider.calls).toHaveLength(2);
    expect(
      await tx.select().from(privateMedia).where(eq(privateMedia.dedupeKey, dedupeKey)),
    ).toHaveLength(1);
  });
});

test("受控重排拒绝非TTS任务以及畸形payload或去重键", async () => {
  await withDatabaseRollback(async (tx) => {
    const [family] = await tx.insert(families).values({ name: "重排边界家庭" }).returning();
    const actor = {
      role: "guardian" as const,
      familyId: family.id,
      guardianId: crypto.randomUUID(),
    };
    const service = createJobService(tx);
    const deleteJob = await service.enqueueJob(
      "delete_media",
      { familyId: family.id, mediaId: crypto.randomUUID() },
      `delete-media:${family.id}:${crypto.randomUUID()}`,
    );
    const badTts = await service.enqueueJob(
      "generate_tts",
      { familyId: family.id, text: "missing fields" },
      `tts:${family.id}:invalid`,
    );
    const badKeyTts = await service.enqueueJob(
      "generate_tts",
      {
        familyId: family.id,
        childId: crypto.randomUUID(),
        cardId: crypto.randomUUID(),
        text: "完整但键错误",
        language: "zh-CN",
        voice: "zh-CN-XiaoxiaoNeural",
        rate: 1,
      },
      `tts:${family.id}:wrong-key`,
    );
    await tx
      .update(jobs)
      .set({ status: "failed", attempts: 5, lastError: "JOB_HANDLER_FAILED" })
      .where(eq(jobs.id, deleteJob.id));
    await tx
      .update(jobs)
      .set({ status: "failed", attempts: 5, lastError: "JOB_HANDLER_FAILED" })
      .where(eq(jobs.id, badTts.id));
    await tx
      .update(jobs)
      .set({ status: "failed", attempts: 5, lastError: "JOB_HANDLER_FAILED" })
      .where(eq(jobs.id, badKeyTts.id));

    await expect(service.requeueFailedJob(actor, deleteJob.id)).rejects.toThrow(
      "JOB_NOT_FOUND",
    );
    await expect(service.requeueFailedJob(actor, badTts.id)).rejects.toThrow(
      "JOB_NOT_FOUND",
    );
    await expect(service.requeueTtsJob(actor, badTts.id)).rejects.toThrow(
      "JOB_NOT_FOUND",
    );
    await expect(service.requeueFailedJob(actor, badKeyTts.id)).rejects.toThrow(
      "JOB_NOT_FOUND",
    );
  });
});

test("worker限定去重键时不领取队列中的其他任务", async () => {
  await withDatabaseRollback(async (tx) => {
    const root = await temporaryMediaRoot();
    const [family] = await tx.insert(families).values({ name: "worker领取隔离家庭" }).returning();
    const store = createPrivateMediaStore({ database: tx, root });
    const firstMedia = await store.put({
      familyId: family.id,
      childId: null,
      kind: "ocr_source",
      bytes: new Uint8Array([1]),
      mimeType: "image/png",
      expiresAt: null,
    });
    const targetMedia = await store.put({
      familyId: family.id,
      childId: null,
      kind: "ocr_source",
      bytes: new Uint8Array([2]),
      mimeType: "image/png",
      expiresAt: null,
    });
    const service = createJobService(tx);
    const firstKey = `delete-media:${family.id}:${firstMedia.id}`;
    const targetKey = `delete-media:${family.id}:${targetMedia.id}`;
    const firstJob = await service.enqueueJob(
      "delete_media",
      { familyId: family.id, mediaId: firstMedia.id },
      firstKey,
    );
    const targetJob = await service.enqueueJob(
      "delete_media",
      { familyId: family.id, mediaId: targetMedia.id },
      targetKey,
    );

    const result = await createJobWorker({
      database: tx,
      mediaStore: store,
      claimDedupeKeys: [targetKey],
    }).runOnce();

    expect(result?.id).toBe(targetJob.id);
    expect(await service.getJob(firstJob.id)).toMatchObject({ status: "queued", attempts: 0 });
    await expect(
      store.open(
        { role: "guardian", familyId: family.id, guardianId: crypto.randomUUID() },
        firstMedia.id,
      ),
    ).resolves.toBeDefined();
    await expect(
      store.open(
        { role: "guardian", familyId: family.id, guardianId: crypto.randomUUID() },
        targetMedia.id,
      ),
    ).rejects.toThrow("MEDIA_NOT_FOUND");
  });
});

test("TTS worker拒绝错误去重键和缺少儿童绑定的任务", async () => {
  await withDatabaseRollback(async (tx) => {
    const root = await temporaryMediaRoot();
    const [family] = await tx.insert(families).values({ name: "去重校验家庭" }).returning();
    const [child] = await tx
      .insert(children)
      .values({ familyId: family.id, nickname: "小树", grade: 5 })
      .returning();
    const [card] = await tx
      .insert(learningCards)
      .values({
        familyId: family.id,
        subject: "chinese",
        answerText: "树木",
        broadcastText: "树木",
        source: "manual",
      })
      .returning();
    const payload: GenerateTtsJobPayload = {
      familyId: family.id,
      childId: child.id,
      cardId: card.id,
      text: card.broadcastText,
      language: "zh-CN",
      voice: "zh-CN-XiaoxiaoNeural",
      rate: 1,
    };
    const service = createJobService(tx);
    const badKey = `tts:${family.id}:attacker-controlled`;
    const missingChildKey = `${buildTtsDedupeKey(payload)}:missing-child`;
    const badKeyJob = await service.enqueueJob(
      "generate_tts",
      payload,
      badKey,
    );
    const missingChildJob = await service.enqueueJob(
      "generate_tts",
      { ...payload, childId: undefined },
      missingChildKey,
    );
    const provider = new RecordingTtsProvider();
    const worker = createJobWorker({
      database: tx,
      mediaStore: createPrivateMediaStore({ database: tx, root }),
      ttsProvider: provider,
      claimDedupeKeys: [badKey, missingChildKey],
    });

    await worker.runOnce();
    await worker.runOnce();

    expect(await service.getJob(badKeyJob.id)).toMatchObject({
      status: "queued",
      lastError: "JOB_DEDUPE_INVALID",
    });
    expect(await service.getJob(missingChildJob.id)).toMatchObject({
      status: "queued",
      lastError: "JOB_PAYLOAD_INVALID",
    });
    expect(provider.calls).toHaveLength(0);
  });
});

test("TTS worker拒绝命中其他家庭的伪造缓存", async () => {
  await withDatabaseRollback(async (tx) => {
    const root = await temporaryMediaRoot();
    const [family, otherFamily] = await tx
      .insert(families)
      .values([{ name: "缓存家庭" }, { name: "其他家庭" }])
      .returning();
    const [child] = await tx
      .insert(children)
      .values({ familyId: family.id, nickname: "小林", grade: 5 })
      .returning();
    const [otherChild] = await tx
      .insert(children)
      .values({ familyId: otherFamily.id, nickname: "小海", grade: 5 })
      .returning();
    const [card] = await tx
      .insert(learningCards)
      .values({
        familyId: family.id,
        subject: "english",
        answerText: "forest",
        broadcastText: "forest",
        source: "manual",
      })
      .returning();
    const payload: GenerateTtsJobPayload = {
      familyId: family.id,
      childId: child.id,
      cardId: card.id,
      text: card.broadcastText,
      language: "en-US",
      voice: "en-US-JennyNeural",
      rate: 1,
    };
    const dedupeKey = buildTtsDedupeKey(payload);
    const store = createPrivateMediaStore({ database: tx, root });
    await store.put({
      familyId: otherFamily.id,
      childId: otherChild.id,
      kind: "tts_audio",
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "audio/mpeg",
      expiresAt: null,
      dedupeKey,
    });
    const service = createJobService(tx);
    const job = await service.enqueueJob("generate_tts", payload, dedupeKey);
    const provider = new RecordingTtsProvider();

    await createJobWorker({
      database: tx,
      mediaStore: store,
      ttsProvider: provider,
      claimDedupeKeys: [dedupeKey],
    }).runOnce();

    expect(await service.getJob(job.id)).toMatchObject({
      status: "queued",
      lastError: "JOB_SCOPE_INVALID",
    });
    expect(provider.calls).toHaveLength(0);
  });
});

test("失败任务有限重试五次并只保存脱敏错误码", async () => {
  await withDatabaseRollback(async (tx) => {
    const root = await temporaryMediaRoot();
    const clock = { now: new Date("2026-09-02T00:00:00.000Z") };
    let calls = 0;
    const failingTtsProvider: TtsProvider = {
      async synthesize() {
        calls += 1;
        throw new Error("api-key=should-not-leak; body=private-text");
      },
    };
    const [family] = await tx
      .insert(families)
      .values({ name: "失败重试家庭" })
      .returning();
    const [child] = await tx
      .insert(children)
      .values({ familyId: family.id, nickname: "小云", grade: 5 })
      .returning();
    const [card] = await tx
      .insert(learningCards)
      .values({
        familyId: family.id,
        subject: "english",
        answerText: "private-text",
        broadcastText: "private-text",
        source: "manual",
      })
      .returning();
    const payload: GenerateTtsJobPayload = {
      familyId: family.id,
      childId: child.id,
      cardId: card.id,
      text: "private-text",
      language: "en-US",
      voice: "en-US-JennyNeural",
      rate: 0.9,
    };
    const service = createJobService(tx, () => clock.now);
    const dedupeKey = buildTtsDedupeKey(payload);
    const job = await service.enqueueJob(
      "generate_tts",
      payload,
      dedupeKey,
    );
    const worker = createJobWorker({
      database: tx,
      mediaStore: createPrivateMediaStore({ database: tx, root }),
      ttsProvider: failingTtsProvider,
      ocrProvider: unusedOcrProvider,
      now: () => clock.now,
      claimDedupeKeys: [dedupeKey],
    });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await worker.runOnce();
      const state = await service.getJob(job.id);
      expect(state?.attempts).toBe(attempt);
      expect(state?.status).toBe(attempt === 5 ? "failed" : "queued");
      expect(state?.lastError).toBe("JOB_HANDLER_FAILED");
      expect(state?.lastError).not.toContain("should-not-leak");
      expect(state?.lastError).not.toContain("private-text");
      clock.now = new Date(clock.now.getTime() + 24 * 60 * 60 * 1000);
    }
    expect(await worker.runOnce()).toBeNull();
    expect(calls).toBe(5);

    await expect(
      service.requeueFailedJob(
        {
          role: "guardian",
          familyId: crypto.randomUUID(),
          guardianId: crypto.randomUUID(),
        },
        job.id,
      ),
    ).rejects.toThrow("JOB_NOT_FOUND");

    const requeued = await service.requeueFailedJob(
      {
        role: "guardian",
        familyId: family.id,
        guardianId: crypto.randomUUID(),
      },
      job.id,
    );
    expect(requeued).toMatchObject({ status: "queued", attempts: 0, lastError: null });
    failingTtsProvider.synthesize = async (input) => ({
      bytes: new TextEncoder().encode(`audio:${input.text}`),
      mimeType: "audio/mpeg" as const,
    });
    await worker.runOnce();
    expect(await service.getJob(job.id)).toMatchObject({
      status: "succeeded",
      attempts: 1,
    });
  });
});

test("真实外部Provider未启用时worker不领取也不消耗任务重试次数", async () => {
  await withDatabaseRollback(async (tx) => {
    const payload: GenerateTtsJobPayload = {
      familyId: crypto.randomUUID(),
      childId: crypto.randomUUID(),
      cardId: crypto.randomUUID(),
      text: "不会发往外部",
      language: "zh-CN",
      voice: "zh-CN-XiaoxiaoNeural",
      rate: 1,
    };
    const service = createJobService(tx);
    const job = await service.enqueueJob(
      "generate_tts",
      payload,
      buildTtsDedupeKey(payload),
    );
    const worker = createJobWorker({
      database: tx,
      mediaStore: createPrivateMediaStore({
        database: tx,
        root: await temporaryMediaRoot(),
      }),
    });

    expect(await worker.runOnce()).toBeNull();
    expect(await service.getJob(job.id)).toMatchObject({
      status: "queued",
      attempts: 0,
    });
  });
});

test("空闲worker只在低频维护到期时运行孤儿清理", async () => {
  await withDatabaseRollback(async (tx) => {
    const clock = { now: new Date("2026-09-02T00:00:00.000Z") };
    const maintenanceCalls: Array<{ now?: Date; graceMs?: number }> = [];
    const worker = createJobWorker({
      database: tx,
      mediaStore: createPrivateMediaStore({
        database: tx,
        root: await temporaryMediaRoot(),
      }),
      now: () => clock.now,
      reconcileOrphans: async (options) => {
        if (!options) throw new Error("MAINTENANCE_OPTIONS_REQUIRED");
        maintenanceCalls.push(options);
        return { removed: 0 };
      },
    });

    await expect(worker.runOnce()).resolves.toBeNull();
    clock.now = new Date(clock.now.getTime() + 5 * 60 * 60 * 1000);
    await expect(worker.runOnce()).resolves.toBeNull();
    expect(maintenanceCalls).toHaveLength(1);

    clock.now = new Date(clock.now.getTime() + 2 * 60 * 60 * 1000);
    await expect(worker.runOnce()).resolves.toBeNull();
    expect(maintenanceCalls).toEqual([
      { now: new Date("2026-09-02T00:00:00.000Z"), graceMs: 24 * 60 * 60 * 1000 },
      { now: new Date("2026-09-02T07:00:00.000Z"), graceMs: 24 * 60 * 60 * 1000 },
    ]);
  });
});

test("孤儿维护失败保持脱敏且不妨碍后续本地任务", async () => {
  await withDatabaseRollback(async (tx) => {
    const root = await temporaryMediaRoot();
    const now = new Date("2026-09-02T08:00:00.000Z");
    const store = createPrivateMediaStore({ database: tx, root });
    let maintenanceAttempts = 0;
    const worker = createJobWorker({
      database: tx,
      mediaStore: store,
      now: () => now,
      reconcileOrphans: async () => {
        maintenanceAttempts += 1;
        throw new Error("private-path-and-secret");
      },
    });

    await expect(worker.runOnce()).resolves.toBeNull();
    expect(maintenanceAttempts).toBe(1);

    const [family] = await tx.insert(families).values({ name: "维护失败家庭" }).returning();
    const media = await store.put({
      familyId: family.id,
      childId: null,
      kind: "ocr_source",
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
      expiresAt: null,
    });
    await createJobService(tx, () => now).enqueueJob(
      "delete_media",
      { familyId: family.id, mediaId: media.id },
      `delete-media:${family.id}:${media.id}`,
    );

    await expect(worker.runOnce()).resolves.toMatchObject({ status: "succeeded" });
  });
});

test("OCR只形成本家庭草稿行，确认前不创建正式卡片", async () => {
  await withDatabaseRollback(async (tx) => {
    const root = await temporaryMediaRoot();
    const now = new Date("2026-09-02T00:00:00.000Z");
    const suffix = crypto.randomUUID();
    await tx.insert(authUsers).values({
      id: `ocr-${suffix}`,
      name: "OCR 家长",
      email: `ocr-${suffix}@example.test`,
    });
    const [family] = await tx.insert(families).values({ name: `OCR-${suffix}` }).returning();
    const [guardian] = await tx
      .insert(guardians)
      .values({ familyId: family.id, authUserId: `ocr-${suffix}` })
      .returning();
    const [draft] = await tx
      .insert(ocrDrafts)
      .values({ familyId: family.id, guardianId: guardian.id, subject: "english" })
      .returning();
    const mediaStore = createPrivateMediaStore({ database: tx, root, now: () => now });
    const source = await mediaStore.put({
      familyId: family.id,
      childId: null,
      kind: "ocr_source",
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      mimeType: "image/png",
      expiresAt: new Date("2026-09-09T00:00:00.000Z"),
    });
    const service = createJobService(tx, () => now);
    const dedupeKey = `ocr:${family.id}:${draft.id}:${source.id}`;
    await service.enqueueJob(
      "run_ocr",
      {
        familyId: family.id,
        guardianId: guardian.id,
        draftId: draft.id,
        mediaId: source.id,
      },
      dedupeKey,
    );
    const worker = createJobWorker({
      database: tx,
      mediaStore,
      now: () => now,
      ttsProvider: new RecordingTtsProvider(),
      ocrProvider: {
        async read() {
          return [
            { text: "mountain", confidence: 0.99, order: 0 },
            { text: "river", confidence: 0.97, order: 1 },
          ];
        },
      },
      claimDedupeKeys: [dedupeKey],
    });
    await worker.runOnce();

    expect(
      await tx.select().from(ocrDraftLines).where(eq(ocrDraftLines.draftId, draft.id)),
    ).toMatchObject([
      { sourceText: "mountain", sourceOrder: 0, status: "draft" },
      { sourceText: "river", sourceOrder: 1, status: "draft" },
    ]);
    expect(
      await tx.select().from(learningCards).where(eq(learningCards.familyId, family.id)),
    ).toHaveLength(0);
  });
});

test("删除任务使媒体立即不可访问且无需启用外部Provider", async () => {
  await withDatabaseRollback(async (tx) => {
    const root = await temporaryMediaRoot();
    const [family] = await tx
      .insert(families)
      .values({ name: "媒体删除家庭" })
      .returning();
    const store = createPrivateMediaStore({ database: tx, root });
    const media = await store.put({
      familyId: family.id,
      childId: null,
      kind: "ocr_source",
      bytes: new Uint8Array([9, 8, 7]),
      mimeType: "image/png",
      expiresAt: new Date("2026-09-03T00:00:00.000Z"),
    });
    await createJobService(tx).enqueueJob(
      "delete_media",
      { familyId: family.id, mediaId: media.id },
      `delete-media:${family.id}:${media.id}`,
    );

    const worker = createJobWorker({ database: tx, mediaStore: store });
    expect(await worker.runOnce()).toMatchObject({ status: "succeeded" });
    await expect(
      store.open(
        {
          role: "guardian",
          familyId: family.id,
          guardianId: crypto.randomUUID(),
        },
        media.id,
      ),
    ).rejects.toThrow("MEDIA_NOT_FOUND");
  });
});

test("worker崩溃遗留的过期运行租约可被安全重新领取", async () => {
  await withDatabaseRollback(async (tx) => {
    const root = await temporaryMediaRoot();
    const now = new Date("2026-09-02T08:00:00.000Z");
    const [family] = await tx
      .insert(families)
      .values({ name: "租约恢复家庭" })
      .returning();
    const store = createPrivateMediaStore({ database: tx, root });
    const media = await store.put({
      familyId: family.id,
      childId: null,
      kind: "ocr_source",
      bytes: new Uint8Array([4, 5, 6]),
      mimeType: "image/png",
      expiresAt: null,
    });
    const job = await createJobService(tx, () => now).enqueueJob(
      "delete_media",
      { familyId: family.id, mediaId: media.id },
      `delete-media:${family.id}:${media.id}`,
    );
    await tx
      .update(jobs)
      .set({
        status: "running",
        attempts: 1,
        lockedAt: new Date(now.getTime() - 16 * 60 * 1000),
      })
      .where(eq(jobs.id, job.id));

    const worker = createJobWorker({
      database: tx,
      mediaStore: store,
      now: () => now,
    });
    expect(await worker.runOnce()).toMatchObject({
      status: "succeeded",
      attempts: 2,
    });
  });
});

test("私密媒体仅家长本家庭可读，儿童在Task 3关联前失败关闭", async () => {
  await withDatabaseRollback(async (tx) => {
    const root = await temporaryMediaRoot();
    const [family] = await tx.insert(families).values({ name: "媒体授权家庭" }).returning();
    const [child] = await tx
      .insert(children)
      .values({ familyId: family.id, nickname: "小河", grade: 5 })
      .returning();
    const store = createPrivateMediaStore({ database: tx, root });
    const media = await store.put({
      familyId: family.id,
      childId: child.id,
      kind: "tts_audio",
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "audio/mpeg",
      expiresAt: null,
    });

    const opened = await store.open(
      { role: "guardian", familyId: family.id, guardianId: crypto.randomUUID() },
      media.id,
    );
    expect(await readAll(opened)).toEqual(new Uint8Array([1, 2, 3]));
    await expect(
      store.open(
        {
          role: "guardian",
          familyId: crypto.randomUUID(),
          guardianId: crypto.randomUUID(),
        },
        media.id,
      ),
    ).rejects.toThrow("MEDIA_NOT_FOUND");
    await expect(
      store.open({
        role: "child",
        familyId: family.id,
        childId: child.id,
        deviceId: crypto.randomUUID(),
      }, media.id),
    ).rejects.toThrow("MEDIA_NOT_FOUND");
  });
});

test("过期租约被重新领取后旧worker不能结算新租约", async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const root = await temporaryMediaRoot();
  const pool1 = new Pool({ connectionString, application_name: "lease-worker-1" });
  const pool2 = new Pool({ connectionString, application_name: "lease-worker-2" });
  const database1 = drizzle({ client: pool1, schema: databaseSchema });
  const database2 = drizzle({ client: pool2, schema: databaseSchema });
  const t0 = new Date("2026-09-02T00:00:00.000Z");
  const t1 = new Date(t0.getTime() + 16 * 60 * 1000);
  let familyId: string | undefined;
  let jobId: string | undefined;

  try {
    const fixture = await db.transaction(async (tx) => {
      const [family] = await tx.insert(families).values({ name: "租约 fencing 家庭" }).returning();
      const [child] = await tx
        .insert(children)
        .values({ familyId: family.id, nickname: "小钟", grade: 5 })
        .returning();
      const [card] = await tx
        .insert(learningCards)
        .values({
          familyId: family.id,
          subject: "chinese",
          answerText: "时钟",
          broadcastText: "时钟",
          source: "manual",
        })
        .returning();
      const payload: GenerateTtsJobPayload = {
        familyId: family.id,
        childId: child.id,
        cardId: card.id,
        text: card.broadcastText,
        language: "zh-CN",
        voice: "zh-CN-XiaoxiaoNeural",
        rate: 1,
      };
      const dedupeKey = buildTtsDedupeKey(payload);
      const job = await createJobService(tx, () => t0).enqueueJob(
        "generate_tts",
        payload,
        dedupeKey,
      );
      return { familyId: family.id, jobId: job.id, dedupeKey };
    });
    familyId = fixture.familyId;
    jobId = fixture.jobId;

    const provider1 = new BlockingTtsProvider();
    const provider2 = new BlockingTtsProvider();
    const worker1 = createJobWorker({
      database: database1,
      mediaStore: createPrivateMediaStore({ database: database1, root }),
      ttsProvider: provider1,
      now: () => t0,
      claimDedupeKeys: [fixture.dedupeKey],
    });
    const worker2 = createJobWorker({
      database: database2,
      mediaStore: createPrivateMediaStore({ database: database2, root }),
      ttsProvider: provider2,
      now: () => t1,
      claimDedupeKeys: [fixture.dedupeKey],
    });

    const oldRun = worker1.runOnce();
    await provider1.entered;
    const newRun = worker2.runOnce();
    await provider2.entered;

    provider1.unblock();
    await expect(oldRun).resolves.toBeNull();
    expect(await createJobService(database2).getJob(fixture.jobId)).toMatchObject({
      status: "running",
      attempts: 2,
    });

    provider2.unblock();
    await expect(newRun).resolves.toMatchObject({ status: "succeeded", attempts: 2 });
  } finally {
    if (jobId) await db.delete(jobs).where(eq(jobs.id, jobId));
    if (familyId) await db.delete(families).where(eq(families.id, familyId));
    await Promise.all([pool1.end(), pool2.end()]);
  }
});
