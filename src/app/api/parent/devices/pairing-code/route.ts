import { headers } from "next/headers";
import { z } from "zod";

import { requireParentActor } from "@/modules/auth/parent-access";
import { createPairingCode } from "@/modules/devices/service";

const inputSchema = z.object({
  childIds: z.array(z.string().uuid()).min(1).max(20),
});

async function ownerActor() {
  try {
    return { actor: await requireParentActor(await headers()) };
  } catch (error) {
    if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") {
      return { response: Response.json({ error: "UNAUTHORIZED" }, { status: 401 }) };
    }
    if (
      error instanceof Error &&
      (error.message === "GUARDIAN_MEMBERSHIP_REQUIRED" ||
        error.message === "FAMILY_OWNER_REQUIRED" ||
        error.message === "PARENT_UNLOCK_INVALID")
    ) {
      return { response: Response.json({ error: error.message }, { status: 403 }) };
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const access = await ownerActor();
  if ("response" in access) return access.response;
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return Response.json({ error: "INVALID_CHILD_ACCESS" }, { status: 400 });
  }

  try {
    const pairing = await createPairingCode(access.actor, input.data.childIds);
    return Response.json(
      { code: pairing.code, expiresAt: pairing.expiresAt.toISOString() },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_CHILD_ACCESS") {
      return Response.json({ error: "INVALID_CHILD_ACCESS" }, { status: 400 });
    }
    throw error;
  }
}
