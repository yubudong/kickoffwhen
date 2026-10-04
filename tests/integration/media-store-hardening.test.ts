import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, expect, test } from "vitest";

import { children, families } from "@/modules/families/schema";
import { privateMedia } from "@/modules/media/schema";
import { createPrivateMediaStore, mediaDiskPath } from "@/modules/media/store";

import { withDatabaseRollback } from "../helpers/database";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "family-learning-media-hardening-"));
  roots.push(root);
  return root;
}

test("orphan reconciler拒绝小于一小时的宽限期", async () => {
  await withDatabaseRollback(async (tx) => {
    const store = createPrivateMediaStore({ database: tx, root: await makeRoot() });

    await expect(
      store.reconcileOrphans({ graceMs: 59 * 60 * 1000 }),
    ).rejects.toThrow("INVALID_ORPHAN_GRACE");
  });
});

test("媒体读取在返回响应前拒绝缺失、符号链接和尺寸不一致的文件", async () => {
  await withDatabaseRollback(async (tx) => {
    const root = await makeRoot();
    const [family] = await tx.insert(families).values({ name: "文件完整性家庭" }).returning();
    const store = createPrivateMediaStore({ database: tx, root });
    const actor = {
      role: "guardian" as const,
      familyId: family.id,
      guardianId: crypto.randomUUID(),
    };

    const missing = await store.put({
      familyId: family.id,
      childId: null,
      kind: "ocr_source",
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
      expiresAt: null,
    });
    await rm(mediaDiskPath(missing.id, root));
    await expect(store.openWithMetadata(actor, missing.id)).rejects.toThrow("MEDIA_NOT_FOUND");

    const linked = await store.put({
      familyId: family.id,
      childId: null,
      kind: "ocr_source",
      bytes: new Uint8Array([4, 5, 6]),
      mimeType: "image/png",
      expiresAt: null,
    });
    const linkedPath = mediaDiskPath(linked.id, root);
    const target = path.join(root, "outside-target");
    await writeFile(target, new Uint8Array([4, 5, 6]));
    await rm(linkedPath);
    await symlink(target, linkedPath);
    await expect(store.openWithMetadata(actor, linked.id)).rejects.toThrow("MEDIA_NOT_FOUND");

    const wrongSize = await store.put({
      familyId: family.id,
      childId: null,
      kind: "ocr_source",
      bytes: new Uint8Array([7, 8, 9]),
      mimeType: "image/png",
      expiresAt: null,
    });
    await writeFile(mediaDiskPath(wrongSize.id, root), new Uint8Array([7, 8, 9, 10]));
    await expect(store.openWithMetadata(actor, wrongSize.id)).rejects.toThrow("MEDIA_NOT_FOUND");
  });
});

test("过期 TTS dedupe 可原子替换且不跨家庭复用", async () => {
  await withDatabaseRollback(async (tx) => {
    const now = new Date("2026-09-02T12:00:00.000Z");
    const root = await makeRoot();
    const [firstFamily, secondFamily] = await tx
      .insert(families)
      .values([{ name: "过期 TTS 家庭 A" }, { name: "过期 TTS 家庭 B" }])
      .returning();
    const [firstChild, secondChild] = await tx
      .insert(children)
      .values([
        { familyId: firstFamily.id, nickname: "孩子 A", grade: 5 },
        { familyId: secondFamily.id, nickname: "孩子 B", grade: 5 },
      ])
      .returning();
    const store = createPrivateMediaStore({ database: tx, root, now: () => now });
    const dedupeKey = `tts:expired:${crypto.randomUUID()}`;

    const expired = await store.put({
      familyId: firstFamily.id,
      childId: firstChild.id,
      kind: "tts_audio",
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "audio/mpeg",
      dedupeKey,
      expiresAt: new Date(now.getTime() - 1),
    });
    const fresh = await store.put({
      familyId: firstFamily.id,
      childId: firstChild.id,
      kind: "tts_audio",
      bytes: new Uint8Array([4, 5, 6]),
      mimeType: "audio/mpeg",
      dedupeKey,
      expiresAt: null,
    });

    expect(fresh.id).not.toBe(expired.id);
    const [expiredRow] = await tx
      .select()
      .from(privateMedia)
      .where(eq(privateMedia.id, expired.id));
    const [freshRow] = await tx
      .select()
      .from(privateMedia)
      .where(eq(privateMedia.id, fresh.id));
    expect(expiredRow).toMatchObject({ dedupeKey: null });
    expect(expiredRow.deletedAt).toEqual(now);
    expect(freshRow).toMatchObject({ dedupeKey, deletedAt: null });

    await expect(
      store.put({
        familyId: secondFamily.id,
        childId: secondChild.id,
        kind: "tts_audio",
        bytes: new Uint8Array([7, 8, 9]),
        mimeType: "audio/mpeg",
        dedupeKey,
        expiresAt: null,
      }),
    ).rejects.toThrow("MEDIA_DEDUPE_CONFLICT");
  });
});

test("orphan reconciler只清理超过宽限期的规范UUID普通文件", async () => {
  await withDatabaseRollback(async (tx) => {
    const root = await makeRoot();
    const store = createPrivateMediaStore({ database: tx, root });
    const [family] = await tx.insert(families).values({ name: "孤儿清理家庭" }).returning();
    const tracked = await store.put({
      familyId: family.id,
      childId: null,
      kind: "ocr_source",
      bytes: new Uint8Array([8]),
      mimeType: "image/png",
      expiresAt: null,
    });
    const now = new Date("2026-09-02T12:00:00.000Z");
    const old = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const canonicalOldId = crypto.randomUUID();
    const canonicalNewId = crypto.randomUUID();
    const wrongDirectoryId = crypto.randomUUID();
    const symlinkId = crypto.randomUUID();
    const canonicalOldPath = mediaDiskPath(canonicalOldId, root);
    const canonicalNewPath = mediaDiskPath(canonicalNewId, root);
    const wrongDirectoryPath = path.join(root, "ff", "ff", wrongDirectoryId);
    const symlinkPath = mediaDiskPath(symlinkId, root);
    const unknownPath = path.join(root, "unknown.txt");
    const targetPath = path.join(root, "symlink-target");

    await Promise.all([
      mkdir(path.dirname(canonicalOldPath), { recursive: true }),
      mkdir(path.dirname(canonicalNewPath), { recursive: true }),
      mkdir(path.dirname(wrongDirectoryPath), { recursive: true }),
      mkdir(path.dirname(symlinkPath), { recursive: true }),
    ]);
    await writeFile(canonicalOldPath, new Uint8Array([1]));
    await writeFile(canonicalNewPath, new Uint8Array([2]));
    await writeFile(wrongDirectoryPath, new Uint8Array([3]));
    await writeFile(unknownPath, new Uint8Array([4]));
    await writeFile(targetPath, new Uint8Array([5]));
    await symlink(targetPath, symlinkPath);
    await Promise.all([
      utimes(canonicalOldPath, old, old),
      utimes(canonicalNewPath, now, now),
      utimes(mediaDiskPath(tracked.id, root), old, old),
      utimes(wrongDirectoryPath, old, old),
      utimes(unknownPath, old, old),
      utimes(targetPath, old, old),
    ]);

    await expect(
      store.reconcileOrphans({ now, graceMs: 60 * 60 * 1000 }),
    ).resolves.toEqual({ removed: 1 });

    await expect(writeFile(canonicalOldPath, new Uint8Array([9]), { flag: "wx" })).resolves.toBeUndefined();
    await expect(writeFile(canonicalNewPath, new Uint8Array([9]), { flag: "wx" })).rejects.toThrow();
    await expect(writeFile(wrongDirectoryPath, new Uint8Array([9]), { flag: "wx" })).rejects.toThrow();
    await expect(writeFile(unknownPath, new Uint8Array([9]), { flag: "wx" })).rejects.toThrow();
    await expect(writeFile(symlinkPath, new Uint8Array([9]), { flag: "wx" })).rejects.toThrow();
    await expect(
      writeFile(mediaDiskPath(tracked.id, root), new Uint8Array([9]), { flag: "wx" }),
    ).rejects.toThrow();
  });
});
