import { headers } from "next/headers";
import { z } from "zod";

import { requireParentActor } from "@/modules/auth/parent-access";
import { getFamilySetupStage } from "@/modules/families/service";
import { parseBulkCards } from "@/modules/learning-content/bulk-parser";
import {
  createCardInputSchema,
  createLearningContentService,
} from "@/modules/learning-content/service";

const subjectSchema = z.enum(["chinese", "english"]);
const requestSchema = z.discriminatedUnion("mode", [
  createCardInputSchema
    .pick({ subject: true, answerText: true, broadcastText: true, hintText: true, textbookEditionId: true, unitId: true })
    .extend({ mode: z.literal("single") }),
  z.object({
    mode: z.literal("bulk"),
    subject: subjectSchema,
    text: z.string().min(1).max(20_000),
  }),
]);

async function parentActor() {
  try {
    return { actor: await requireParentActor(await headers()) };
  } catch (error) {
    if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") {
      return { response: Response.json({ error: "UNAUTHORIZED" }, { status: 401 }) };
    }
    if (
      error instanceof Error &&
      ["GUARDIAN_MEMBERSHIP_REQUIRED", "FAMILY_OWNER_REQUIRED", "PARENT_UNLOCK_INVALID"].includes(error.message)
    ) {
      return { response: Response.json({ error: error.message }, { status: 403 }) };
    }
    throw error;
  }
}

async function contentAccess() {
  const access = await parentActor();
  if ("response" in access) return access;
  if ((await getFamilySetupStage(access.actor)) === "pin") {
    return {
      response: Response.json({ error: "PARENT_PIN_REQUIRED" }, { status: 428 }),
    };
  }
  return access;
}

export async function GET(request: Request) {
  const access = await contentAccess();
  if ("response" in access) return access.response;

  const url = new URL(request.url);
  const service = createLearningContentService();
  try {
    const subject = url.searchParams.get("subject");
    if (subject && subject !== "chinese" && subject !== "english") {
      return Response.json({ error: "INVALID_CARD_FILTER" }, { status: 400 });
    }
    const cards = await service.listCards(access.actor, {
      subject:
        subject === "chinese" || subject === "english" ? subject : undefined,
      unitId: url.searchParams.get("unitId") ?? undefined,
      query: url.searchParams.get("query") ?? undefined,
    });
    return Response.json({ cards });
  } catch {
    return Response.json({ error: "INVALID_CARD_FILTER" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const access = await contentAccess();
  if ("response" in access) return access.response;

  const input = requestSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) {
    return Response.json({ error: "INVALID_CARD_INPUT" }, { status: 400 });
  }

  const service = createLearningContentService();
  if (input.data.mode === "single") {
    const card = await service.createCard(access.actor, {
      ...input.data,
      source: "manual",
    });
    return Response.json({ cards: [card] }, { status: 201 });
  }

  const cards = parseBulkCards(input.data.text, input.data.subject);
  if (cards.length === 0) {
    return Response.json({ error: "EMPTY_BULK_CONTENT" }, { status: 400 });
  }
  try {
    const createdCards = await service.createBulkCards(
      access.actor,
      cards.map(({ answerText, broadcastText, subject }) => ({
        answerText,
        broadcastText,
        subject,
        source: "bulk",
      })),
    );
    return Response.json({ cards: createdCards }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError || (error instanceof Error && error.message === "BULK_CARD_SOURCE_REQUIRED")) {
      return Response.json({ error: "INVALID_CARD_INPUT" }, { status: 400 });
    }
    throw error;
  }
}
