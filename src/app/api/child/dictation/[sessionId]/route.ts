import type { ChildActor } from "@/modules/auth/actor";
import type { ChildSessionView } from "@/modules/dictation/child-view-types";

type Dependencies = {
  resolveActor: (request: Request) => Promise<ChildActor>;
  getSession: (actor: ChildActor, sessionId: string) => Promise<ChildSessionView>;
};

export function createChildSessionGetHandler(dependencies: Dependencies) {
  return async function GET(
    request: Request,
    context: { params: Promise<{ sessionId: string }> },
  ): Promise<Response> {
    let actor: ChildActor;
    try {
      actor = await dependencies.resolveActor(request);
    } catch {
      return Response.json({ error: "CHILD_SESSION_REQUIRED" }, { status: 401 });
    }
    try {
      const { sessionId } = await context.params;
      return Response.json({ session: await dependencies.getSession(actor, sessionId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "TASK_AUDIO_NOT_READY") {
        return Response.json({ error: "AUDIO_NOT_READY" }, { status: 409 });
      }
      return Response.json({ error: "SESSION_NOT_FOUND" }, { status: 404 });
    }
  };
}

async function productionDependencies(): Promise<Dependencies> {
  const [{ requireChildActor }, { childDictationViewService }] = await Promise.all([
    import("@/modules/devices/child-actor"),
    import("@/modules/dictation/child-view-service"),
  ]);
  return { resolveActor: requireChildActor, getSession: childDictationViewService.getSession };
}

export async function GET(
  request: Request,
  context: RouteContext<"/api/child/dictation/[sessionId]">,
) {
  return createChildSessionGetHandler(await productionDependencies())(request, context);
}
