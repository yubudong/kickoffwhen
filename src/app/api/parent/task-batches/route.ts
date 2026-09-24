import { headers } from "next/headers";
import { z } from "zod";

import type { FamilyOwnerActor } from "@/modules/auth/actor";
import { requireParentActor } from "@/modules/auth/parent-access";
import type { LearningTask } from "@/modules/dictation/task-types";
import { buildTaskBatchInputSchema, type BuildTaskBatchInput } from "@/modules/dictation/task-types";
import { getFamilySetupStage } from "@/modules/families/service";

type Dependencies = {
  resolveAccess: () => Promise<{ actor: FamilyOwnerActor } | { response: Response }>;
  buildTaskBatch: (actor: FamilyOwnerActor, input: BuildTaskBatchInput) => Promise<LearningTask[]>;
};

export function createParentTaskBatchPostHandler(dependencies: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const access = await dependencies.resolveAccess();
    if ("response" in access) return access.response;
    const parsed = buildTaskBatchInputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "INVALID_TASK_INPUT" }, { status: 400 });
    try {
      const tasks = await dependencies.buildTaskBatch(access.actor, parsed.data);
      return Response.json({ tasks }, { status: 201 });
    } catch (error) {
      if (error instanceof z.ZodError) return Response.json({ error: "INVALID_TASK_INPUT" }, { status: 400 });
      const message = error instanceof Error ? error.message : "";
      if (message === "TASK_IDEMPOTENCY_CONFLICT") return Response.json({ error: message }, { status: 409 });
      if (["CHILD_NOT_FOUND", "TASK_SECTION_NOT_FOUND", "TASK_CARD_NOT_FOUND", "TASK_CARD_SUBJECT_MISMATCH", "TASK_CARD_ACTIVE", "TASK_BATCH_INVALID", "TASK_EMPTY", "TASK_NEW_CARD_ALREADY_STARTED"].includes(message)) {
        return Response.json({ error: message }, { status: 400 });
      }
      throw error;
    }
  };
}

async function taskAccess(): Promise<{ actor: FamilyOwnerActor } | { response: Response }> {
  try {
    const actor = await requireParentActor(await headers());
    if ((await getFamilySetupStage(actor)) !== "complete") {
      return { response: Response.json({ error: "FAMILY_SETUP_REQUIRED" }, { status: 428 }) };
    }
    return { actor };
  } catch (error) {
    if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") {
      return { response: Response.json({ error: "UNAUTHORIZED" }, { status: 401 }) };
    }
    if (error instanceof Error && ["GUARDIAN_MEMBERSHIP_REQUIRED", "FAMILY_OWNER_REQUIRED", "PARENT_UNLOCK_INVALID"].includes(error.message)) {
      return { response: Response.json({ error: error.message }, { status: 403 }) };
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const { createDictationTaskService } = await import("@/modules/dictation/task-service");
  return createParentTaskBatchPostHandler({
    resolveAccess: taskAccess,
    buildTaskBatch: createDictationTaskService().buildTaskBatch,
  })(request);
}
