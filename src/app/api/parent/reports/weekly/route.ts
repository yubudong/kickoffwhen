import { headers } from "next/headers";
import { z } from "zod";

import type { FamilyOwnerActor } from "@/modules/auth/actor";
import { shanghaiWeekFromMonday } from "@/modules/reports/weekly-report";
import type { WeeklyReport } from "@/modules/reports/types";

const weeklyQuerySchema = z.object({
  childId: z.string().uuid(),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

export const weeklyReportResponseSchema = z.object({
  report: z.object({
    childId: z.string().uuid(),
    weekStart: z.iso.datetime(),
    weekEnd: z.iso.datetime(),
    studyDays: z.number().int().nonnegative(),
    completedTasks: z.number().int().nonnegative(),
    firstPassAccuracy: z.number().min(0).max(1).nullable(),
    dailyTrend: z.array(z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      completedTasks: z.number().int().nonnegative(),
      firstPassAccuracy: z.number().min(0).max(1).nullable(),
    }).strict()).length(7),
    dueReviewsCompleted: z.number().int().nonnegative(),
    dueReviewAccuracy: z.number().min(0).max(1).nullable(),
    weakCards: z.array(z.object({
      cardId: z.string().uuid(),
      answerText: z.string(),
      errorCount: z.number().int().positive(),
      latestErrorAt: z.iso.datetime(),
    }).strict()).max(10),
    habitCompletion: z.object({
      available: z.literal(false),
      message: z.string(),
    }).strict(),
  }).strict(),
}).strict();

async function reportAccess() {
  try {
    const [{ requireParentActor }, { getFamilySetupStage }] = await Promise.all([
      import("@/modules/auth/parent-access"),
      import("@/modules/families/service"),
    ]);
    const actor = await requireParentActor(await headers());
    if ((await getFamilySetupStage(actor)) !== "complete") {
      return {
        response: Response.json({ error: "FAMILY_SETUP_REQUIRED" }, { status: 428 }),
      };
    }
    return { actor };
  } catch (error) {
    if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") {
      return { response: Response.json({ error: "UNAUTHORIZED" }, { status: 401 }) };
    }
    if (
      error instanceof Error &&
      ["GUARDIAN_MEMBERSHIP_REQUIRED", "FAMILY_OWNER_REQUIRED", "PARENT_UNLOCK_INVALID"]
        .includes(error.message)
    ) {
      return { response: Response.json({ error: error.message }, { status: 403 }) };
    }
    throw error;
  }
}

type WeeklyHandlerDependencies = {
  resolveAccess: () => Promise<
    | { actor: FamilyOwnerActor }
    | { response: Response }
  >;
  getWeeklyReport: (
    actor: FamilyOwnerActor,
    childId: string,
    weekStart: Date,
  ) => Promise<WeeklyReport>;
};

function serializeReport(report: WeeklyReport) {
  return weeklyReportResponseSchema.parse({
    report: {
      ...report,
      weekStart: report.weekStart.toISOString(),
      weekEnd: report.weekEnd.toISOString(),
      weakCards: report.weakCards.map((card) => ({
        ...card,
        latestErrorAt: card.latestErrorAt.toISOString(),
      })),
    },
  });
}

export function createParentWeeklyReportGetHandler(
  dependencies: WeeklyHandlerDependencies,
) {
  return async function handleWeeklyReportGet(request: Request) {
    const access = await dependencies.resolveAccess();
    if ("response" in access) return access.response;

    const url = new URL(request.url);
    const entries = [...url.searchParams.entries()];
    const raw = Object.fromEntries(entries);
    const query = entries.length === 2 ? weeklyQuerySchema.safeParse(raw) : null;
    if (!query?.success) {
      return Response.json({ error: "INVALID_REPORT_QUERY" }, { status: 400 });
    }
    let weekStart: Date;
    try {
      weekStart = shanghaiWeekFromMonday(query.data.weekStart).start;
    } catch {
      return Response.json({ error: "INVALID_REPORT_QUERY" }, { status: 400 });
    }

    try {
      const report = await dependencies.getWeeklyReport(
        access.actor,
        query.data.childId,
        weekStart,
      );
      return Response.json(serializeReport(report));
    } catch (error) {
      if (error instanceof Error && error.message === "REPORT_NOT_FOUND") {
        return Response.json({ error: "REPORT_NOT_FOUND" }, { status: 404 });
      }
      if (
        error instanceof Error &&
        ["REPORT_INCONSISTENT", "REPORT_WEEK_INVALID"].includes(error.message)
      ) {
        return Response.json({ error: "REPORT_UNAVAILABLE" }, { status: 503 });
      }
      throw error;
    }
  };
}

export async function GET(request: Request) {
  const { getWeeklyReport } = await import("@/modules/reports/weekly-report");
  return createParentWeeklyReportGetHandler({
    resolveAccess: reportAccess,
    getWeeklyReport,
  })(request);
}
