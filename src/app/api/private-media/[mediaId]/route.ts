import type { Actor } from "@/modules/auth/actor";
import type { OpenPrivateMedia } from "@/modules/media/store";

type PrivateMediaRouteDependencies = {
  resolveActor: (request: Request) => Promise<Actor>;
  openMedia: (actor: Actor, mediaId: string) => Promise<OpenPrivateMedia>;
};

type PrivateMediaRouteContext = {
  params: Promise<{ mediaId: string }>;
};

export function createPrivateMediaGetHandler(
  dependencies: PrivateMediaRouteDependencies,
) {
  return async function handlePrivateMediaGet(
    request: Request,
    context: PrivateMediaRouteContext,
  ): Promise<Response> {
    let actor: Actor;
    try {
      actor = await dependencies.resolveActor(request);
    } catch {
      return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    const { mediaId } = await context.params;
    try {
      const media = await dependencies.openMedia(actor, mediaId);
      return new Response(media.stream, {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": "inline",
          "Content-Length": String(media.byteSize),
          "Content-Type": media.mimeType,
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      // Missing and unauthorized objects deliberately share one response.
      return Response.json({ error: "MEDIA_NOT_FOUND" }, { status: 404 });
    }
  };
}

async function resolveProductionActor(request: Request): Promise<Actor> {
  const [parentAccess, childAccess] = await Promise.all([
    import("@/modules/auth/parent-access"),
    import("@/modules/devices/child-actor"),
  ]);
  try {
    return await parentAccess.requireParentActor(request.headers);
  } catch {
    return childAccess.requireChildActor(request);
  }
}

async function productionDependencies(): Promise<PrivateMediaRouteDependencies> {
  const { privateMediaStore } = await import("@/modules/media/store");
  return {
    resolveActor: resolveProductionActor,
    openMedia: privateMediaStore.openWithMetadata,
  };
}

export async function GET(
  request: Request,
  context: RouteContext<"/api/private-media/[mediaId]">,
) {
  return createPrivateMediaGetHandler(await productionDependencies())(
    request,
    context,
  );
}
