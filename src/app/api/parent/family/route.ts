import { headers } from "next/headers";

import { auth } from "@/modules/auth/server";
import { createFamilyOwner } from "@/modules/families/service";
import { createFamilyOwnerInputSchema } from "@/modules/families/validation";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const input = createFamilyOwnerInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!input.success) {
    return Response.json({ error: "INVALID_FAMILY_INPUT" }, { status: 400 });
  }

  try {
    const actor = await createFamilyOwner(session.user.id, input.data);
    return Response.json({ actor }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "FAMILY_ALREADY_EXISTS") {
      return Response.json({ error: "FAMILY_ALREADY_EXISTS" }, { status: 409 });
    }
    throw error;
  }
}
