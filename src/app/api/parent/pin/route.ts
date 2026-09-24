import { headers } from "next/headers";

import { requireParentActor } from "@/modules/auth/parent-access";
import { setParentPin } from "@/modules/families/service";
import { parentPinInputSchema } from "@/modules/families/validation";

export async function POST(request: Request) {
  let actor;
  try {
    actor = await requireParentActor(await headers());
  } catch (error) {
    if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") {
      return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (
      error instanceof Error &&
      error.message === "GUARDIAN_MEMBERSHIP_REQUIRED"
    ) {
      return Response.json(
        { error: "GUARDIAN_MEMBERSHIP_REQUIRED" },
        { status: 403 },
      );
    }
    if (error instanceof Error && error.message === "FAMILY_OWNER_REQUIRED") {
      return Response.json(
        { error: "FAMILY_OWNER_REQUIRED" },
        { status: 403 },
      );
    }
    if (error instanceof Error && error.message === "PARENT_UNLOCK_INVALID") {
      return Response.json(
        { error: "PARENT_UNLOCK_INVALID" },
        { status: 403 },
      );
    }
    throw error;
  }

  const input = parentPinInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!input.success) {
    return Response.json({ error: "INVALID_PARENT_PIN" }, { status: 400 });
  }

  await setParentPin(actor, input.data.pin);
  return new Response(null, { status: 204 });
}
