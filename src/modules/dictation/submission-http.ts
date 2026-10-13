import { createHash } from "node:crypto";
import { z } from "zod";
import type { ChildActor } from "@/modules/auth/actor";
import type { ChildSessionView } from "./child-view-types";
import type { DictationPhoto } from "./grading-types";
import type { RestartRoundInput } from "./session-types";
import { attachmentType } from "@/modules/todos/validation";
import { saveAttachment, removeAttachment } from "@/modules/todos/attachments";

const MAX_BODY = 33 * 1024 * 1024;
async function boundedForm(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) throw new Error("ATTACHMENT_SIZE");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_REQUEST");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY) { await reader.cancel(); throw new Error("ATTACHMENT_SIZE"); }
      chunks.push(new Uint8Array(value));
    }
  } finally { reader.releaseLock(); }
  return new Response(new Blob(chunks), { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
}

type Dependencies = {
  resolveActor: (request: Request) => Promise<ChildActor>;
  getSession: (actor: ChildActor, sessionId: string) => Promise<ChildSessionView>;
  submitPhotos: (actor: ChildActor, input: RestartRoundInput & { photos: DictationPhoto[] }) => Promise<unknown>;
  submissionPhotos: (actor: ChildActor, sessionId: string, commandId: string) => Promise<DictationPhoto[]>;
  appOrigin: string;
};
export function createDictationSubmissionHandler(deps: Dependencies) {
  return async (request: Request, context: { params: Promise<{ sessionId: string }> }) => {
    let actor: ChildActor;
    try { actor = await deps.resolveActor(request); }
    catch { return Response.json({ error: "请重新登录孩子账号。" }, { status: 401 }); }
    const origin = request.headers.get("origin");
    if (origin && origin !== deps.appOrigin) return Response.json({ error: "请求来源无效。" }, { status: 403 });
    const saved: DictationPhoto[] = [];
    let committed = false;
    try {
      const { sessionId: rawId } = await context.params;
      const sessionId = z.string().uuid().parse(rawId);
      // Authorize the session before buffering or saving evidence.
      const session = await deps.getSession(actor, sessionId);
      if (session.gradingMode !== "parent") throw new Error("SELF_GRADING_REQUIRED");
      const form = await boundedForm(request);
      const command = z.object({ commandId: z.string().uuid(), expectedVersion: z.coerce.number().int().nonnegative(), roundNumber: z.coerce.number().int().positive() })
        .parse({ commandId: form.get("commandId"), expectedVersion: form.get("expectedVersion"), roundNumber: form.get("roundNumber") });
      const files = form.getAll("photos");
      if (files.length < 1 || files.length > 4 || files.some(file => !(file instanceof File))) throw new Error("ATTACHMENT_TYPE");
      for (const file of files as File[]) {
        if (file.size > 8 * 1024 * 1024) throw new Error("ATTACHMENT_SIZE");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const mimeType = attachmentType(bytes, file.type);
        if (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp") throw new Error("ATTACHMENT_TYPE");
        saved.push({ ...await saveAttachment(file), mimeType, sha256: createHash("sha256").update(bytes).digest("hex") });
      }
      await deps.submitPhotos(actor, { ...command, sessionId, photos: saved });
      committed = true;
      const persistedIds = new Set((await deps.submissionPhotos(actor, sessionId, command.commandId)).map(photo => photo.id));
      await Promise.all(saved.filter(photo => !persistedIds.has(photo.id)).map(photo => removeAttachment(photo.id)));
      return Response.json({ session: await deps.getSession(actor, sessionId) }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      if (!committed) await Promise.all(saved.map(photo => removeAttachment(photo.id)));
      const message = error instanceof Error ? error.message : "";
      const notFound = message === "DICTATION_SESSION_NOT_FOUND";
      const attachment = message.startsWith("ATTACHMENT");
      return Response.json({ error: notFound ? "听写不存在或无权访问。" : attachment ? "请上传1至4张照片，每张不超过8MB，支持JPG、PNG、WebP。" : "提交未成功，请刷新进度后重试。" },
        { status: notFound ? 404 : message === "ATTACHMENT_SIZE" ? 413 : attachment || error instanceof z.ZodError ? 400 : 409 });
    }
  };
}
