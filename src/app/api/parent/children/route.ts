import { headers } from "next/headers";

import { requireParentActor } from "@/modules/auth/parent-access";
import {
  createChild,
  getFamilySetupStage,
  listChildren,
} from "@/modules/families/service";
import { createChildInputSchema } from "@/modules/families/validation";

async function ownerActor() {
  try {
    return { actor: await requireParentActor(await headers()) };
  } catch (error) {
    if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") {
      return { response: Response.json({ error: "UNAUTHORIZED" }, { status: 401 }) };
    }
    if (
      error instanceof Error &&
      error.message === "GUARDIAN_MEMBERSHIP_REQUIRED"
    ) {
      return {
        response: Response.json(
          { error: "GUARDIAN_MEMBERSHIP_REQUIRED" },
          { status: 403 },
        ),
      };
    }
    if (error instanceof Error && error.message === "FAMILY_OWNER_REQUIRED") {
      return {
        response: Response.json(
          { error: "FAMILY_OWNER_REQUIRED" },
          { status: 403 },
        ),
      };
    }
    if (error instanceof Error && error.message === "PARENT_UNLOCK_INVALID") {
      return {
        response: Response.json(
          { error: "PARENT_UNLOCK_INVALID" },
          { status: 403 },
        ),
      };
    }
    throw error;
  }
}

async function childrenAccess() {
  const result = await ownerActor();
  if ("response" in result) return result;
  if ((await getFamilySetupStage(result.actor)) === "pin") {
    return {
      response: Response.json(
        { error: "PARENT_PIN_REQUIRED" },
        { status: 428 },
      ),
    };
  }
  return result;
}

export async function GET() {
  const access = await childrenAccess();
  if ("response" in access) return access.response;

  return Response.json({ children: await listChildren(access.actor) });
}

export async function POST(request: Request) {
  const access = await childrenAccess();
  if ("response" in access) return access.response;

  const input = createChildInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!input.success) {
    return Response.json({ error: "INVALID_CHILD_INPUT" }, { status: 400 });
  }

  const child = await createChild(access.actor, input.data);
  return Response.json({ child }, { status: 201 });
}
