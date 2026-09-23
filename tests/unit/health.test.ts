import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it } from "vitest";

import { checkReadiness } from "@/modules/operations/health";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

it("ready 检查数据库和可写媒体目录", async () => {
  const mediaRoot = await mkdtemp(join(tmpdir(), "family-learning-health-"));
  created.push(mediaRoot);

  await expect(
    checkReadiness({ checkDatabase: async () => undefined, mediaRoot }),
  ).resolves.toEqual({ status: "ready" });
});

it("数据库不可用时拒绝 ready", async () => {
  const mediaRoot = await mkdtemp(join(tmpdir(), "family-learning-health-"));
  created.push(mediaRoot);

  await expect(
    checkReadiness({
      checkDatabase: async () => {
        throw new Error("connection refused");
      },
      mediaRoot,
    }),
  ).rejects.toThrow("DATABASE_UNAVAILABLE");
});

it("媒体路径不可写时拒绝 ready", async () => {
  const mediaRoot = await mkdtemp(join(tmpdir(), "family-learning-health-"));
  created.push(mediaRoot);
  await writeFile(join(mediaRoot, "occupied"), "file");

  await expect(
    checkReadiness({
      checkDatabase: async () => undefined,
      mediaRoot: join(mediaRoot, "occupied"),
    }),
  ).rejects.toThrow("MEDIA_ROOT_UNAVAILABLE");
});
