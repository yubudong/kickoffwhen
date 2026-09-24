import { headers } from "next/headers";
import { z } from "zod";

import { requireParentActor } from "@/modules/auth/parent-access";
import { setDeviceChildAccess } from "@/modules/devices/service";

const inputSchema = z.object({
  childIds: z.array(z.string().uuid()).min(1).max(20),
});

export async function PUT(
  request: Request,
  context: RouteContext<"/api/parent/devices/[deviceId]/children">,
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
      [
        "GUARDIAN_MEMBERSHIP_REQUIRED",
        "FAMILY_OWNER_REQUIRED",
        "PARENT_UNLOCK_INVALID",
      ].includes(error.message)
    ) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return Response.json({ error: "INVALID_CHILD_ACCESS" }, { status: 400 });
  }

  try {
    const { deviceId } = await context.params;
    await setDeviceChildAccess(actor, deviceId, input.data.childIds);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof Error && error.message === "DEVICE_NOT_FOUND") {
      return Response.json({ error: "DEVICE_NOT_FOUND" }, { status: 404 });
    }
    if (error instanceof Error && error.message === "INVALID_CHILD_ACCESS") {
      return Response.json({ error: "INVALID_CHILD_ACCESS" }, { status: 400 });
    }
    throw error;
  }
}
