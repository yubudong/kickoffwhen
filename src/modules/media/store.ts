import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open as openFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { and, eq, inArray, isNull } from "drizzle-orm";

import type { DbTransaction } from "@/db/client";
import type { Actor } from "@/modules/auth/actor";
import { learningTaskItems, learningTasks } from "@/modules/dictation/task-schema";

import { isActiveTtsMedia } from "./active-cache";
import { privateMedia } from "./schema";
import {
  authorizePrivateMediaAccess,
  type PrivateMediaKind,
  type PrivateMediaMimeType,
  type PrivateMediaRef,
  type PutPrivateMediaInput,
} from "./service";

const MEDIA_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANONICAL_MEDIA_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MEDIA_DIRECTORY_PATTERN = /^[0-9a-f]{2}$/;

export function mediaDiskPath(
  mediaId: string,
  root = process.env.MEDIA_ROOT ?? "./var/media",
): string {
  if (!MEDIA_ID_PATTERN.test(mediaId)) throw new Error("INVALID_MEDIA_ID");

  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(
    resolvedRoot,
    mediaId.slice(0, 2),
    mediaId.slice(2, 4),
    mediaId,
  );
  if (!resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("INVALID_MEDIA_ID");
  }
  return resolvedPath;
}

type MediaDatabase = typeof import("@/db/client").db | DbTransaction;

export type OpenPrivateMedia = PrivateMediaRef & {
  mimeType: PrivateMediaMimeType;
  byteSize: number;
  sha256: string;
  stream: ReadableStream<Uint8Array>;
};

function relativeMediaPath(mediaId: string): string {
  if (!MEDIA_ID_PATTERN.test(mediaId)) throw new Error("INVALID_MEDIA_ID");
  return path.posix.join(
    mediaId.slice(0, 2),
    mediaId.slice(2, 4),
    mediaId,
  );
}

function toPrivateMediaRef(row: typeof privateMedia.$inferSelect): PrivateMediaRef {
  return {
    id: row.id,
    familyId: row.familyId,
    childId: row.childId,
    kind: row.kind as PrivateMediaKind,
    expiresAt: row.expiresAt,
  };
}

function assertPutInput(input: PutPrivateMediaInput) {
  if (!MEDIA_ID_PATTERN.test(input.familyId)) throw new Error("INVALID_FAMILY_ID");
  if (input.childId && !MEDIA_ID_PATTERN.test(input.childId)) {
    throw new Error("INVALID_CHILD_ID");
  }
  if (input.bytes.byteLength < 1 || input.bytes.byteLength > 10 * 1024 * 1024) {
    throw new Error("INVALID_MEDIA_SIZE");
  }
  if (
    (input.kind === "tts_audio" &&
      (input.mimeType !== "audio/mpeg" || !input.childId)) ||
    (input.kind !== "tts_audio" && input.mimeType === "audio/mpeg")
  ) {
    throw new Error("INVALID_MEDIA_TYPE");
  }
  if (input.dedupeKey !== undefined && input.dedupeKey !== null) {
    if (!input.dedupeKey.trim() || input.dedupeKey.length > 500) {
      throw new Error("INVALID_MEDIA_DEDUPE_KEY");
    }
  }
}

export function createPrivateMediaStore({
  database,
  root = process.env.MEDIA_ROOT ?? "./var/media",
  now = () => new Date(),
}: {
  database?: MediaDatabase;
  root?: string;
  now?: () => Date;
} = {}) {
  async function getDatabase(): Promise<MediaDatabase> {
    return database ?? (await import("@/db/client")).db;
  }

  async function findByDedupeKey(
    dedupeKey: string,
  ): Promise<PrivateMediaRef | null> {
    const client = await getDatabase();
    const [row] = await client
      .select()
      .from(privateMedia)
      .where(
        and(
          eq(privateMedia.dedupeKey, dedupeKey),
          isNull(privateMedia.deletedAt),
        ),
      )
      .limit(1);
    return row ? toPrivateMediaRef(row) : null;
  }

  async function put(input: PutPrivateMediaInput): Promise<PrivateMediaRef> {
    assertPutInput(input);
    const writeAt = now();
    if (input.dedupeKey) {
      const existing = await findByDedupeKey(input.dedupeKey);
      if (existing) {
        if (input.kind !== "tts_audio") return existing;
        const scope = {
          dedupeKey: input.dedupeKey,
          familyId: input.familyId,
          childId: input.childId!,
          at: writeAt,
        };
        if (
          existing.familyId !== scope.familyId ||
          existing.childId !== scope.childId ||
          existing.kind !== "tts_audio"
        ) {
          throw new Error("MEDIA_DEDUPE_CONFLICT");
        }
        if (isActiveTtsMedia(
          { ...existing, dedupeKey: input.dedupeKey, deletedAt: null },
          scope,
        )) return existing;
      }
    }

    const id = randomUUID();
    const relativePath = relativeMediaPath(id);
    const finalPath = mediaDiskPath(id, root);
    const directory = path.dirname(finalPath);
    const temporaryPath = path.join(directory, `.${id}.${randomUUID()}.tmp`);
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    let movedToFinal = false;
    const client = await getDatabase();

    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(temporaryPath, input.bytes, { flag: "wx", mode: 0o600 });

    try {
      const result = await client.transaction(async (tx) => {
        if (input.dedupeKey) {
          const [occupied] = await tx
            .select()
            .from(privateMedia)
            .where(eq(privateMedia.dedupeKey, input.dedupeKey))
            .limit(1)
            .for("update");
          if (occupied) {
            if (input.kind !== "tts_audio") {
              if (!occupied.deletedAt) return { row: occupied, created: false };
              throw new Error("MEDIA_DEDUPE_CONFLICT");
            }
            const scope = {
              dedupeKey: input.dedupeKey,
              familyId: input.familyId,
              childId: input.childId!,
              at: writeAt,
            };
            if (
              occupied.familyId !== scope.familyId ||
              occupied.childId !== scope.childId ||
              occupied.kind !== "tts_audio"
            ) {
              throw new Error("MEDIA_DEDUPE_CONFLICT");
            }
            if (isActiveTtsMedia(occupied, scope)) {
              return { row: occupied, created: false };
            }
            await tx
              .update(privateMedia)
              .set({
                deletedAt: occupied.deletedAt ?? writeAt,
                dedupeKey: null,
              })
              .where(eq(privateMedia.id, occupied.id));
          }
        }
        const insert = tx.insert(privateMedia).values({
          id,
          familyId: input.familyId,
          childId: input.childId,
          kind: input.kind,
          mimeType: input.mimeType,
          byteSize: input.bytes.byteLength,
          sha256,
          relativePath,
          dedupeKey: input.dedupeKey ?? null,
          expiresAt: input.expiresAt,
        });
        const [created] = input.dedupeKey
          ? await insert
              .onConflictDoNothing()
              .returning()
          : await insert.returning();

        if (!created && input.dedupeKey) {
          const [existing] = await tx
            .select()
            .from(privateMedia)
            .where(eq(privateMedia.dedupeKey, input.dedupeKey))
            .limit(1);
          if (!existing || existing.deletedAt) {
            throw new Error("MEDIA_DEDUPE_CONFLICT");
          }
          if (
            input.kind === "tts_audio" &&
            (existing.familyId !== input.familyId ||
              existing.childId !== input.childId ||
              existing.kind !== "tts_audio")
          ) {
            throw new Error("MEDIA_DEDUPE_CONFLICT");
          }
          return { row: existing, created: false };
        }
        if (!created) throw new Error("MEDIA_WRITE_FAILED");

        await rename(temporaryPath, finalPath);
        movedToFinal = true;
        return { row: created, created: true };
      });

      if (!result.created) await rm(temporaryPath, { force: true });
      return toPrivateMediaRef(result.row);
    } catch (error) {
      await Promise.all([
        rm(temporaryPath, { force: true }),
        movedToFinal ? rm(finalPath, { force: true }) : Promise.resolve(),
      ]);
      throw error;
    }
  }

  async function openWithMetadata(
    actor: Actor,
    mediaId: string,
  ): Promise<OpenPrivateMedia> {
    if (!MEDIA_ID_PATTERN.test(mediaId)) throw new Error("MEDIA_NOT_FOUND");
    const client = await getDatabase();
    const [row] = await client
      .select()
      .from(privateMedia)
      .where(eq(privateMedia.id, mediaId))
      .limit(1);
    const [taskAccess] =
      row && actor.role === "child" && row.kind === "tts_audio" && row.dedupeKey
        ? await client
            .select({ id: learningTaskItems.id })
            .from(learningTaskItems)
            .innerJoin(
              learningTasks,
              and(
                eq(learningTasks.id, learningTaskItems.taskId),
                eq(learningTasks.familyId, learningTaskItems.familyId),
                eq(learningTasks.childId, learningTaskItems.childId),
              ),
            )
            .where(
              and(
                eq(learningTaskItems.familyId, actor.familyId),
                eq(learningTaskItems.childId, actor.childId),
                eq(learningTaskItems.ttsDedupeKey, row.dedupeKey),
                eq(learningTasks.status, "active"),
              ),
            )
            .limit(1)
        : [];
    if (
      !row ||
      !authorizePrivateMediaAccess(
        actor,
        {
          ...row,
          kind: row.kind as PrivateMediaKind,
        },
        Boolean(taskAccess),
      )
    ) {
      throw new Error("MEDIA_NOT_FOUND");
    }
    if (row.expiresAt && row.expiresAt <= now()) {
      throw new Error("MEDIA_NOT_FOUND");
    }
    if (row.relativePath !== relativeMediaPath(row.id)) {
      throw new Error("MEDIA_NOT_FOUND");
    }

    let handle: Awaited<ReturnType<typeof openFile>> | undefined;
    try {
      handle = await openFile(
        mediaDiskPath(row.id, root),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      const fileStat = await handle.stat();
      if (!fileStat.isFile() || fileStat.size !== row.byteSize) {
        throw new Error("MEDIA_FILE_INVALID");
      }
    } catch {
      await handle?.close().catch(() => undefined);
      throw new Error("MEDIA_NOT_FOUND");
    }
    const nodeStream = handle.createReadStream({ autoClose: true });
    const stream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
    return {
      ...toPrivateMediaRef(row),
      mimeType: row.mimeType as PrivateMediaMimeType,
      byteSize: row.byteSize,
      sha256: row.sha256,
      stream,
    };
  }

  async function open(actor: Actor, mediaId: string): Promise<ReadableStream<Uint8Array>> {
    return (await openWithMetadata(actor, mediaId)).stream;
  }

  async function remove(familyId: string, mediaId: string): Promise<void> {
    if (
      !MEDIA_ID_PATTERN.test(familyId) ||
      !MEDIA_ID_PATTERN.test(mediaId)
    ) {
      throw new Error("MEDIA_NOT_FOUND");
    }
    const client = await getDatabase();
    const [row] = await client
      .select()
      .from(privateMedia)
      .where(
        and(
          eq(privateMedia.id, mediaId),
          eq(privateMedia.familyId, familyId),
        ),
      )
      .limit(1);
    if (!row) return;
    if (row.relativePath !== relativeMediaPath(row.id)) {
      throw new Error("MEDIA_NOT_FOUND");
    }
    await client
      .update(privateMedia)
      .set({ deletedAt: row.deletedAt ?? now(), dedupeKey: null })
      .where(eq(privateMedia.id, row.id));
    await rm(mediaDiskPath(row.id, root), { force: true });
  }

  async function reconcileOrphans({
    now = new Date(),
    graceMs = 60 * 60 * 1000,
  }: {
    now?: Date;
    graceMs?: number;
  } = {}): Promise<{ removed: number }> {
    if (!Number.isFinite(graceMs) || graceMs < 60 * 60 * 1000) {
      throw new Error("INVALID_ORPHAN_GRACE");
    }
    const threshold = now.getTime() - graceMs;
    const candidates: Array<{ id: string; filePath: string }> = [];
    let firstLevel;
    try {
      firstLevel = await readdir(path.resolve(root), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { removed: 0 };
      throw error;
    }

    for (const first of firstLevel) {
      if (!first.isDirectory() || !MEDIA_DIRECTORY_PATTERN.test(first.name)) continue;
      const firstPath = path.join(path.resolve(root), first.name);
      const secondLevel = await readdir(firstPath, { withFileTypes: true });
      for (const second of secondLevel) {
        if (!second.isDirectory() || !MEDIA_DIRECTORY_PATTERN.test(second.name)) continue;
        const secondPath = path.join(firstPath, second.name);
        const files = await readdir(secondPath, { withFileTypes: true });
        for (const file of files) {
          if (!file.isFile() || !CANONICAL_MEDIA_ID_PATTERN.test(file.name)) continue;
          if (file.name.slice(0, 2) !== first.name || file.name.slice(2, 4) !== second.name) {
            continue;
          }
          const filePath = path.join(secondPath, file.name);
          const fileStat = await lstat(filePath);
          if (!fileStat.isFile() || fileStat.mtimeMs > threshold) continue;
          candidates.push({ id: file.name, filePath });
        }
      }
    }
    if (candidates.length === 0) return { removed: 0 };

    const client = await getDatabase();
    const rows = await client
      .select({ id: privateMedia.id, relativePath: privateMedia.relativePath })
      .from(privateMedia)
      .where(inArray(privateMedia.id, candidates.map((candidate) => candidate.id)));
    const tracked = new Set(
      rows
        .filter((row) => row.relativePath === relativeMediaPath(row.id))
        .map((row) => row.id),
    );
    let removed = 0;
    for (const candidate of candidates) {
      if (tracked.has(candidate.id)) continue;
      await rm(candidate.filePath);
      removed += 1;
    }
    return { removed };
  }

  return {
    findByDedupeKey,
    open,
    openWithMetadata,
    put,
    reconcileOrphans,
    remove,
  };
}

export const privateMediaStore = createPrivateMediaStore();
