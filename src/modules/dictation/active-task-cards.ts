import { and, eq, inArray } from "drizzle-orm";

import { db, type DbTransaction } from "@/db/client";

import { learningTaskItems, learningTasks } from "./task-schema";

type ActiveTaskCardDatabase = typeof db | DbTransaction;

export async function getActiveTaskCards(
  database: ActiveTaskCardDatabase,
  familyId: string,
  childIds: string[],
) {
  if (childIds.length === 0) return [];

  return database
    .selectDistinct({
      childId: learningTaskItems.childId,
      cardId: learningTaskItems.cardId,
    })
    .from(learningTaskItems)
    .innerJoin(
      learningTasks,
      and(
        eq(learningTasks.id, learningTaskItems.taskId),
        eq(learningTasks.familyId, learningTaskItems.familyId),
        eq(learningTasks.childId, learningTaskItems.childId),
      ),
    )
    .where(
      and(
        eq(learningTaskItems.familyId, familyId),
        inArray(learningTaskItems.childId, childIds),
        eq(learningTasks.status, "active"),
      ),
    );
}
