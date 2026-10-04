import { z } from "zod";

import type { FamilyOwnerActor } from "@/modules/auth/actor";
import type { FamilySetupStage } from "@/modules/families/service";
import type { OcrDraftView, OcrProviderStatus } from "@/modules/learning-content/ocr-draft-service";
import type { OcrUploadInput } from "@/modules/learning-content/ocr-upload-service";
import type { ConfirmedCardInput, LearningCard } from "@/modules/learning-content/types";

type AccessDependencies = {
  requestHeaders: () => Promise<Headers>;
  requireActor: (headers: Headers) => Promise<FamilyOwnerActor>;
  getSetupStage: (actor: FamilyOwnerActor) => Promise<FamilySetupStage>;
};
type PostDependencies = AccessDependencies & {
  providerStatus?: OcrProviderStatus;
  createUpload: (actor: FamilyOwnerActor, input: OcrUploadInput) => Promise<{ draftId: string; jobId: string }>;
};
type GetDependencies = AccessDependencies & {
  providerStatus: OcrProviderStatus;
  getDraft: (actor: FamilyOwnerActor, input: { draftId: string; jobId: string; providerStatus: OcrProviderStatus }) => Promise<OcrDraftView>;
};
type ConfirmDependencies = AccessDependencies & {
  confirmDraft: (actor: FamilyOwnerActor, draftId: string, cards: ConfirmedCardInput[], decidedLineIds: string[]) => Promise<Array<LearningCard | { id: string }>>;
};

const idSchema = z.string().uuid();
const confirmRequestSchema = z.object({
  draftId: idSchema,
  lines: z.array(z.discriminatedUnion("selected", [
    z.object({
      lineId: idSchema,
      selected: z.literal(true),
      answerText: z.string().trim().min(1).max(500),
      broadcastText: z.string().trim().min(1).max(500),
      hintText: z.string().trim().min(1).max(500).optional(),
    }).strict(),
    z.object({ lineId: idSchema, selected: z.literal(false) }).strict(),
  ])).min(1).max(500),
}).strict().superRefine((input, context) => {
  if (new Set(input.lines.map((line) => line.lineId)).size !== input.lines.length) {
    context.addIssue({ code: "custom", message: "duplicate OCR line" });
  }
});

async function requireAccess(
  dependencies: AccessDependencies,
): Promise<{ actor: FamilyOwnerActor } | { response: Response }> {
  let actor: FamilyOwnerActor;
  try {
    actor = await dependencies.requireActor(await dependencies.requestHeaders());
  } catch (error) {
    if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") {
      return { response: Response.json({ error: "UNAUTHORIZED" }, { status: 401 }) };
    }
    if (error instanceof Error && ["GUARDIAN_MEMBERSHIP_REQUIRED", "FAMILY_OWNER_REQUIRED", "PARENT_UNLOCK_INVALID"].includes(error.message)) {
      return { response: Response.json({ error: error.message }, { status: 403 }) };
    }
    throw error;
  }
  if ((await dependencies.getSetupStage(actor)) === "pin") {
    return { response: Response.json({ error: "PARENT_PIN_REQUIRED" }, { status: 428 }) };
  }
  return { actor };
}

export function createOcrPostHandler(dependencies: PostDependencies) {
  return async function handleOcrPost(request: Request): Promise<Response> {
    const access = await requireAccess(dependencies);
    if ("response" in access) return access.response;
    if (dependencies.providerStatus === "disabled") {
      return Response.json({ error: "OCR_PROVIDER_DISABLED" }, { status: 503 });
    }
    const form = await request.formData().catch(() => null);
    if (!form) return Response.json({ error: "INVALID_OCR_UPLOAD" }, { status: 400 });
    const subject = form.get("subject");
    const image = form.get("image");
    if ((subject !== "chinese" && subject !== "english") || !(image instanceof File)) {
      return Response.json({ error: "INVALID_OCR_UPLOAD" }, { status: 400 });
    }
    if (image.type !== "image/jpeg" && image.type !== "image/png") {
      return Response.json({ error: "UNSUPPORTED_OCR_MEDIA_TYPE" }, { status: 415 });
    }
    if (image.size < 1 || image.size > 10 * 1024 * 1024) {
      return Response.json({ error: "OCR_UPLOAD_TOO_LARGE" }, { status: 413 });
    }
    const created = await dependencies.createUpload(access.actor, {
      subject,
      bytes: new Uint8Array(await image.arrayBuffer()),
      mimeType: image.type,
    });
    return Response.json({ ...created, status: "queued" }, { status: 202 });
  };
}

export function createOcrGetHandler(dependencies: GetDependencies) {
  return async function handleOcrGet(request: Request): Promise<Response> {
    const access = await requireAccess(dependencies);
    if ("response" in access) return access.response;
    const url = new URL(request.url);
    const identifiers = z.object({ draftId: idSchema, jobId: idSchema }).safeParse({
      draftId: url.searchParams.get("draftId"),
      jobId: url.searchParams.get("jobId"),
    });
    if (!identifiers.success) return Response.json({ error: "INVALID_OCR_DRAFT_QUERY" }, { status: 400 });
    try {
      const draft = await dependencies.getDraft(access.actor, {
        ...identifiers.data,
        providerStatus: dependencies.providerStatus,
      });
      return Response.json(draft, { headers: { "cache-control": "private, no-store" } });
    } catch (error) {
      if (error instanceof Error && error.message === "OCR_DRAFT_NOT_FOUND") {
        return Response.json({ error: "OCR_DRAFT_NOT_FOUND" }, { status: 404 });
      }
      throw error;
    }
  };
}

export function createOcrConfirmHandler(dependencies: ConfirmDependencies) {
  return async function handleOcrConfirm(request: Request): Promise<Response> {
    const access = await requireAccess(dependencies);
    if ("response" in access) return access.response;
    const input = confirmRequestSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return Response.json({ error: "INVALID_OCR_CONFIRMATION" }, { status: 400 });
    const selected = input.data.lines.filter((line) => line.selected).map((line) => ({
      lineId: line.lineId,
      answerText: line.answerText,
      broadcastText: line.broadcastText,
      hintText: line.hintText,
    }));
    try {
      const cards = await dependencies.confirmDraft(
        access.actor,
        input.data.draftId,
        selected,
        input.data.lines.map((line) => line.lineId),
      );
      return Response.json({
        cards,
        rejectedLineIds: input.data.lines.filter((line) => !line.selected).map((line) => line.lineId),
      }, { status: 201 });
    } catch (error) {
      if (error instanceof Error && error.message === "OCR_DRAFT_NOT_FOUND") {
        return Response.json({ error: "OCR_DRAFT_NOT_FOUND" }, { status: 404 });
      }
      if (error instanceof Error && ["OCR_DRAFT_EMPTY", "OCR_DRAFT_LINE_INVALID", "OCR_DRAFT_LINE_DUPLICATE"].includes(error.message)) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      if (error instanceof Error && error.message === "OCR_DRAFT_ALREADY_FINALIZED") {
        return Response.json({ error: error.message }, { status: 409 });
      }
      if (error instanceof z.ZodError) {
        return Response.json({ error: "INVALID_OCR_CONFIRMATION" }, { status: 400 });
      }
      throw error;
    }
  };
}

async function productionDependencies() {
  const [nextHeaders, parentAccess, families, upload, drafts, content] = await Promise.all([
    import("next/headers"),
    import("@/modules/auth/parent-access"),
    import("@/modules/families/service"),
    import("@/modules/learning-content/ocr-upload-service"),
    import("@/modules/learning-content/ocr-draft-service"),
    import("@/modules/learning-content/service"),
  ]);
  return {
    requestHeaders: nextHeaders.headers,
    requireActor: parentAccess.requireParentActor,
    getSetupStage: families.getFamilySetupStage,
    providerStatus: "disabled" as const,
    createUpload: upload.ocrUploadService.createUpload,
    getDraft: drafts.ocrDraftService.getDraft,
    confirmDraft: content.confirmOcrDraft,
  };
}

export async function POST(request: Request) {
  return createOcrPostHandler(await productionDependencies())(request);
}
export async function GET(request: Request) {
  return createOcrGetHandler(await productionDependencies())(request);
}
export async function PUT(request: Request) {
  return createOcrConfirmHandler(await productionDependencies())(request);
}
