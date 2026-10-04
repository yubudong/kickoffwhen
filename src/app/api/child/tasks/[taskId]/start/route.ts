import { z } from "zod";

import type { ChildActor } from "@/modules/auth/actor";
import type { ChildSessionView } from "@/modules/dictation/child-view-types";

type Dependencies = {
  resolveActor: (request: Request) => Promise<ChildActor>;
  startSession: (actor: ChildActor, taskId: string) => Promise<{ sessionId: string }>;
  getSession: (actor: ChildActor, sessionId: string) => Promise<ChildSessionView>;
};

const emptyBodySchema = z.object({}).strict();
const uuidSchema = z.string().uuid();

export function createChildTaskStartHandler(dependencies: Dependencies) {
  return async function POST(
    request: Request,
    context: { params: Promise<{ taskId: string }> },
  ): Promise<Response> {
    let actor: ChildActor;
    try {
      actor = await dependencies.resolveActor(request);
    } catch {
      return Response.json({ error: "CHILD_SESSION_REQUIRED" }, { status: 401 });
    }
    try {
      emptyBodySchema.parse(await request.json());
      const taskId = uuidSchema.parse((await context.params).taskId);
      const snapshot = await dependencies.startSession(actor, taskId);
      return Response.json({ session: await dependencies.getSession(actor, snapshot.sessionId) });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
      }
      const message = error instanceof Error ? error.message : "";
      if (message === "TASK_AUDIO_NOT_READY") {
        return Response.json({ error: "AUDIO_NOT_READY" }, { status: 409 });
      }
      if (["TASK_NOT_FOUND", "TASK_NOT_ACTIVE", "TASK_EMPTY"].includes(message)) {
        return Response.json({ error: "TASK_NOT_FOUND" }, { status: 404 });
      }
      return Response.json({ error: "START_FAILED" }, { status: 409 });
    }
  };
}

async function productionDependencies(): Promise<Dependencies> {
  const [{ requireChildActor }, { createDictationSessionService }, { childDictationViewService }] =
    await Promise.all([
      import("@/modules/devices/child-actor"),
      import("@/modules/dictation/session-service"),
      import("@/modules/dictation/child-view-service"),
    ]);
  return {
    resolveActor: requireChildActor,
    startSession: createDictationSessionService().startSession,
    getSession: childDictationViewService.getSession,
  };
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/child/tasks/[taskId]/start">,
) {
  return createChildTaskStartHandler(await productionDependencies())(request, context);
}
