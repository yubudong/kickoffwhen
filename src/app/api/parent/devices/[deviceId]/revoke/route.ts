import { headers } from "next/headers";

import { requireParentActor } from "@/modules/auth/parent-access";
import { revokeDevice } from "@/modules/devices/service";

export async function POST(
  _request: Request,
  context: RouteContext<"/api/parent/devices/[deviceId]/revoke">,
) {
  let actor;
  try {
    actor = await requireParentActor(await headers());
  } catch (error) {
    if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") {
      return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (
      error instanceof Error &&
      (error.message === "GUARDIAN_MEMBERSHIP_REQUIRED" ||
        error.message === "FAMILY_OWNER_REQUIRED" ||
        error.message === "PARENT_UNLOCK_INVALID")
    ) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  try {
    const { deviceId } = await context.params;
    await revokeDevice(actor, deviceId);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof Error && error.message === "DEVICE_NOT_FOUND") {
      return Response.json({ error: "DEVICE_NOT_FOUND" }, { status: 404 });
    }
    throw error;
  }
}
