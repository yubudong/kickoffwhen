import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createDictationSubmissionHandler } from "@/modules/dictation/submission-http";
import type { ChildSessionView } from "@/modules/dictation/child-view-types";
import type { DictationPhoto } from "@/modules/dictation/grading-types";

let root: string;
let oldRoot: string | undefined;
beforeEach(async () => { oldRoot = process.env.MEDIA_ROOT; root = await mkdtemp(path.join(os.tmpdir(), "dictation-photo-test-")); process.env.MEDIA_ROOT = root; });
afterEach(async () => { if (oldRoot === undefined) delete process.env.MEDIA_ROOT; else process.env.MEDIA_ROOT = oldRoot; await rm(root, { recursive: true, force: true }); });
const actor = { role: "child" as const, familyId: crypto.randomUUID(), childId: crypto.randomUUID(), deviceId: crypto.randomUUID() };
const sessionId = crypto.randomUUID();
const session: ChildSessionView = { sessionId, taskId: crypto.randomUUID(), ...actor, version: 1,
  phase: "submission", gradingMode: "parent", mode: "continuous_batch", roundNumber: 1, itemCount: 1, playedItemIds: [],
  intervalSeconds: 2, repeatCount: 1, speechRate: 1, allowManualReplay: true, items: [] };
const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"));
function request(mime = "image/png") {
  const form = new FormData();
  form.set("commandId", crypto.randomUUID()); form.set("expectedVersion", "1"); form.set("roundNumber", "1");
  form.append("photos", new File([png], "photo.png", { type: mime }));
  return new Request("http://local.test/submission", { method: "POST", body: form });
}
const context = { params: Promise.resolve({ sessionId }) };
function fixture(overrides: Partial<Parameters<typeof createDictationSubmissionHandler>[0]> = {}) {
  let photos: DictationPhoto[] = [];
  return createDictationSubmissionHandler({ appOrigin: "http://local.test", resolveActor: async () => actor,
    getSession: async () => session,
    submitPhotos: async (_actor, input) => { photos = input.photos; },
    submissionPhotos: async () => photos, ...overrides });
}
test("真实照片存到私有目录，返回的子视图不含文件路径或答案", async () => {
  const response = await fixture()(request(), context);
  expect(response.status).toBe(200);
  const files = await readdir(path.join(root, "todo"));
  expect(files).toHaveLength(1);
  expect(new Uint8Array(await readFile(path.join(root, "todo", files[0])))).toEqual(png);
  expect(JSON.stringify(await response.json())).not.toMatch(/answerText|relativePath|sha256/);
});
test("无权访问的会话不接收照片", async () => {
  const response = await fixture({ getSession: async () => { throw new Error("DICTATION_SESSION_NOT_FOUND"); } })(request(), context);
  expect(response.status).toBe(404);
  expect(await readdir(root)).toEqual([]);
});
test("提交事务冲突会移除尚未绑定的文件", async () => {
  const response = await fixture({ submitPhotos: async () => { throw new Error("DICTATION_VERSION_CONFLICT"); } })(request(), context);
  expect(response.status).toBe(409);
  expect(await readdir(path.join(root, "todo"))).toEqual([]);
});
test("伪造图片类型与超大请求被拒绝", async () => {
  expect((await fixture()(request("image/jpeg"), context)).status).toBe(400);
  const large = request(); large.headers.set("content-length", String(34 * 1024 * 1024));
  expect((await fixture()(large, context)).status).toBe(413);
  expect(await readdir(root)).toEqual([]);
});
test("跨站提交被拒绝", async () => {
  const crossSite = request(); crossSite.headers.set("origin", "https://other.test");
  expect((await fixture()(crossSite, context)).status).toBe(403);
  expect(await readdir(root)).toEqual([]);
});
