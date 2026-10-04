import { headers } from "next/headers";
import { z } from "zod";

import { requireParentActor } from "@/modules/auth/parent-access";
import type { FamilyOwnerActor } from "@/modules/auth/actor";
import {
  buildTaskInputSchema,
  type LearningTask,
} from "@/modules/dictation/task-types";
import { getFamilySetupStage } from "@/modules/families/service";

async function taskAccess() {
  try {
    const actor = await requireParentActor(await headers());
    if ((await getFamilySetupStage(actor)) !== "complete") {
      return {
        response: Response.json(
          { error: "FAMILY_SETUP_REQUIRED" },
          { status: 428 },
        ),
      };
    }
    return { actor };
  } catch (error) {
    if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") {
      return { response: Response.json({ error: "UNAUTHORIZED" }, { status: 401 }) };
    }
    if (
      error instanceof Error &&
      [
        "GUARDIAN_MEMBERSHIP_REQUIRED",
        "FAMILY_OWNER_REQUIRED",
        "PARENT_UNLOCK_INVALID",
      ].includes(error.message)
    ) {
      return { response: Response.json({ error: error.message }, { status: 403 }) };
    }
    throw error;
  }
}

type ParentTaskPostDependencies = {
  resolveAccess: () => Promise<
    | { actor: FamilyOwnerActor }
    | { response: Response }
  >;
  buildTask: (
    actor: FamilyOwnerActor,
    input: z.infer<typeof buildTaskInputSchema>,
  ) => Promise<LearningTask>;
};

export function createParentTaskPostHandler(
  dependencies: ParentTaskPostDependencies,
) {
  return async function handleParentTaskPost(request: Request) {
    const access = await dependencies.resolveAccess();
    if ("response" in access) return access.response;

    const input = buildTaskInputSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!input.success) {
      return Response.json({ error: "INVALID_TASK_INPUT" }, { status: 400 });
    }
    try {
      const task = await dependencies.buildTask(access.actor, input.data);
      return Response.json({ task }, { status: 201 });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return Response.json({ error: "INVALID_TASK_INPUT" }, { status: 400 });
      }
      if (error instanceof Error) {
        if (error.message === "TASK_IDEMPOTENCY_CONFLICT") {
          return Response.json({ error: error.message }, { status: 409 });
        }
        if (
          [
            "CHILD_NOT_FOUND",
            "TASK_CARD_NOT_FOUND",
            "TASK_CARD_SUBJECT_MISMATCH",
            "TASK_CARD_DUPLICATE",
            "TASK_NEW_CARD_ALREADY_STARTED",
            "TASK_EMPTY",
          ].includes(error.message)
        ) {
          return Response.json({ error: error.message }, { status: 400 });
        }
      }
      throw error;
    }
  };
}

export async function POST(request: Request) {
  const { createDictationTaskService } = await import(
    "@/modules/dictation/task-service"
  );
  return createParentTaskPostHandler({
    resolveAccess: taskAccess,
    buildTask: createDictationTaskService().buildDailyTask,
  })(request);
}
