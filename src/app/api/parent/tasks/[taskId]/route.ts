import { headers } from "next/headers";
import { z } from "zod";

import { requireParentActor } from "@/modules/auth/parent-access";
import { createDictationTaskManagementService } from "@/modules/dictation/task-management";

type Context = { params: Promise<{ taskId: string }> };

async function handle(context: Context, action: (taskId: string) => Promise<unknown>): Promise<Response> {
  try {
    const { taskId } = await context.params;
    return Response.json({ result: await action(taskId) });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "INVALID_TASK_INPUT" }, { status: 400 });
    const code = error instanceof Error ? error.message : "";
    if (code === "AUTHENTICATION_REQUIRED") return Response.json({ error: code }, { status: 401 });
    if (["GUARDIAN_MEMBERSHIP_REQUIRED", "FAMILY_OWNER_REQUIRED", "PARENT_UNLOCK_INVALID"].includes(code)) {
      return Response.json({ error: code }, { status: 403 });
    }
    if (["TASK_NOT_FOUND", "TASK_ITEM_NOT_FOUND"].includes(code)) return Response.json({ error: code }, { status: 404 });
    if (["TASK_REWARDED", "TASK_ALREADY_STARTED", "TASK_NOT_ACTIVE"].includes(code)) {
      return Response.json({ error: code }, { status: 409 });
    }
    throw error;
  }
}

export async function GET(_request: Request, context: Context) {
  return handle(context, async (taskId) => {
    const actor = await requireParentActor(await headers());
    return createDictationTaskManagementService().getManagedTask(actor, taskId);
  });
}

export async function DELETE(_request: Request, context: Context) {
  return handle(context, async (taskId) => {
    const actor = await requireParentActor(await headers());
    await createDictationTaskManagementService().cancelTask(actor, taskId);
    return { cancelled: true };
  });
}

export async function PATCH(request: Request, context: Context) {
  return handle(context, async (taskId) => {
    const actor = await requireParentActor(await headers());
    const body = z.object({ cardId: z.string().uuid() }).parse(await request.json().catch(() => null));
    await createDictationTaskManagementService().removeUnstartedTaskItem(actor, taskId, body.cardId);
    return { removed: true };
  });
}
