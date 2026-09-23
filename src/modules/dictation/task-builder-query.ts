import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { db, type DbTransaction } from "@/db/client";
import type { GuardianActor } from "@/modules/auth/actor";
import { children } from "@/modules/families/schema";
import { learningCards, textbookEditions, textbookUnits, textbookSections } from "@/modules/learning-content/schema";
import { childCardStates } from "@/modules/review/db-schema";

import { getActiveTaskCards } from "./active-task-cards";
import type { TaskCardOption } from "./task-card-filter";

type TaskBuilderDatabase = typeof db | DbTransaction;

export type TaskBuilderData = {
  children: Array<{ id: string; nickname: string; dueCount: number; dueCounts: Record<"chinese" | "english", number> }>;
  cards: TaskCardOption[];
};

export function createTaskBuilderQueryService(
  database: TaskBuilderDatabase = db,
) {
  async function getTaskBuilderData(
    actor: GuardianActor,
    at = new Date(),
  ): Promise<TaskBuilderData> {
    const childRows = await database
      .select({ id: children.id, nickname: children.nickname })
      .from(children)
      .where(and(eq(children.familyId, actor.familyId), eq(children.active, true)))
      .orderBy(asc(children.createdAt), asc(children.id));
    const cardRows = await database
      .select({ card: learningCards, grade: textbookEditions.grade, volume: textbookEditions.volume, unitTitle: textbookUnits.title, unitOrder: textbookUnits.unitOrder, sectionTitle: textbookSections.title, sectionOrder: textbookSections.sectionOrder })
      .from(learningCards)
      .leftJoin(textbookEditions, eq(textbookEditions.id, learningCards.textbookEditionId))
      .leftJoin(textbookUnits, eq(textbookUnits.id, learningCards.unitId))
      .leftJoin(textbookSections, eq(textbookSections.id, learningCards.sectionId))
      .where(or(eq(learningCards.familyId, actor.familyId), isNull(learningCards.familyId)))
      .orderBy(asc(sql`case when ${learningCards.unitId} is null then 1 else 0 end`), asc(learningCards.subject), asc(learningCards.textbookEditionId), asc(textbookUnits.unitOrder), asc(textbookSections.sectionOrder), asc(learningCards.sourceOrder), asc(sql`case ${learningCards.source} when 'builtin' then 0 when 'manual' then 1 when 'bulk' then 2 else 3 end`), asc(learningCards.createdAt), asc(learningCards.id));

    const states = childRows.length === 0 || cardRows.length === 0
      ? []
      : await database
          .select({
            childId: childCardStates.childId,
            cardId: childCardStates.cardId,
            dueAt: childCardStates.dueAt,
          })
          .from(childCardStates)
          .where(
            and(
              eq(childCardStates.familyId, actor.familyId),
              inArray(childCardStates.childId, childRows.map((child) => child.id)),
              inArray(childCardStates.cardId, cardRows.map(({ card }) => card.id)),
            ),
          );
    const activeTaskCards = await getActiveTaskCards(
      database,
      actor.familyId,
      childRows.map((child) => child.id),
    );
    const activeByChildAndCard = new Set(
      activeTaskCards.map(({ childId, cardId }) => `${childId}:${cardId}`),
    );
    const dueByChild = new Map<string, number>();
    const subjectsByCard = new Map(cardRows.map(({ card }) => [card.id, card.subject]));
    const dueSubjectsByChild = new Map<string, Record<"chinese" | "english", number>>();
    const startedByCard = new Map<string, Set<string>>();
    for (const state of states) {
      if (
        state.dueAt <= at &&
        !activeByChildAndCard.has(`${state.childId}:${state.cardId}`)
      ) {
        dueByChild.set(state.childId, (dueByChild.get(state.childId) ?? 0) + 1);
        const counts = dueSubjectsByChild.get(state.childId) ?? { chinese: 0, english: 0 };
        const subject = subjectsByCard.get(state.cardId);
        if (subject === "chinese" || subject === "english") counts[subject] += 1;
        dueSubjectsByChild.set(state.childId, counts);
      }
      const started = startedByCard.get(state.cardId) ?? new Set<string>();
      started.add(state.childId);
      startedByCard.set(state.cardId, started);
    }
    for (const { childId, cardId } of activeTaskCards) {
      const started = startedByCard.get(cardId) ?? new Set<string>();
      started.add(childId);
      startedByCard.set(cardId, started);
    }

    return {
      children: childRows.map((child) => ({
        ...child,
        dueCount: dueByChild.get(child.id) ?? 0,
        dueCounts: dueSubjectsByChild.get(child.id) ?? { chinese: 0, english: 0 },
      })),
      cards: cardRows.map(({ card, grade, volume, unitTitle, unitOrder, sectionTitle, sectionOrder }) => ({
        id: card.id,
        answerText: card.answerText,
        subject: card.subject === "chinese" ? "chinese" : "english",
        source: card.source as TaskCardOption["source"],
        editionId: card.textbookEditionId,
        grade,
        volume,
        unitId: card.unitId,
        unitTitle,
        unitOrder,
        sectionId: card.sectionId,
        sectionTitle,
        sectionOrder,
        startedChildIds: [...(startedByCard.get(card.id) ?? [])],
        activeChildIds: childRows.filter((child) => activeByChildAndCard.has(`${child.id}:${card.id}`)).map((child) => child.id),
      })),
    };
  }

  return { getTaskBuilderData };
}
