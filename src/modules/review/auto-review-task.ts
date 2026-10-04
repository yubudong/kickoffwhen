import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db, type DbTransaction } from "@/db/client";
import { learningTasks } from "@/modules/dictation/task-schema";
import { createDictationTaskService } from "@/modules/dictation/task-service";
import { children, guardians } from "@/modules/families/schema";

type ReviewTaskDatabase = typeof db | DbTransaction;

function shanghaiDay(at: Date): { day: string; hour: number } {
  const local = new Date(at.getTime() + 8 * 60 * 60 * 1000);
  return { day: local.toISOString().slice(0, 10), hour: local.getUTCHours() };
}

function reviewCommandId(familyId: string, childId: string, subject: string, day: string): string {
  const hash = createHash("sha256")
    .update(`auto-review:${familyId}:${childId}:${subject}:${day}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function createAutoReviewTaskService(database: ReviewTaskDatabase = db) {
  async function ensureForChild(
    familyId: string,
    childId: string,
    guardianId: string,
    at: Date = new Date(),
  ): Promise<number> {
    const { day, hour } = shanghaiDay(at);
    if (hour < 6) return 0;
    let created = 0;
    for (const subject of ["chinese", "english"] as const) {
      const commandId = reviewCommandId(familyId, childId, subject, day);
      const [existing] = await database.select({ id: learningTasks.id }).from(learningTasks).where(and(
        eq(learningTasks.familyId, familyId), eq(learningTasks.commandId, commandId),
      )).limit(1);
      if (existing) continue;
      try {
        await createDictationTaskService(database, () => at).buildDailyTask(
          { role: "guardian", familyId, guardianId },
          { childId, subject, newCardIds: [], commandId, maxReviewCards: 20,
            mode: "continuous_batch", order: "source", intervalSeconds: 8,
            repeatCount: 1, speechRate: 1, allowManualReplay: true },
          { origin: "auto_review", title: `${subject === "chinese" ? "语文" : "英语"} · 到期复习` },
        );
        created += 1;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "TASK_EMPTY") throw error;
      }
    }
    return created;
  }

  async function run(at: Date = new Date()): Promise<number> {
    if (shanghaiDay(at).hour < 6) return 0;
    const rows = await database.select({ familyId: children.familyId, childId: children.id,
      guardianId: guardians.id }).from(children).innerJoin(guardians, and(
      eq(guardians.familyId, children.familyId), eq(guardians.isOwner, true),
    )).where(eq(children.active, true));
    let created = 0;
    for (const row of rows) created += await ensureForChild(row.familyId, row.childId, row.guardianId, at);
    return created;
  }

  return { ensureForChild, run };
}
