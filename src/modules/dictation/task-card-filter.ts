export type TaskCardOption = {
  id: string;
  answerText: string;
  subject: "chinese" | "english";
  source: "manual" | "bulk" | "ocr" | "builtin";
  unitId: string | null;
  unitTitle: string | null;
  unitOrder?: number | null;
  sectionId?: string | null;
  sectionTitle?: string | null;
  sectionOrder?: number | null;
  startedChildIds: string[];
};

export type TaskCardFilter = {
  childId: string;
  sourceView: "all" | "textbook" | "custom";
  unitId: string | "all";
  query: string;
  subject?: "chinese" | "english";
  sectionId?: string;
};

export function filterTaskCardOptions<T extends TaskCardOption>(
  cards: T[],
  filter: TaskCardFilter,
): T[] {
  const query = filter.query.trim().toLocaleLowerCase();
  return cards.filter((card) => {
    if (filter.subject && card.subject !== filter.subject) return false;
    if (filter.sectionId && filter.sectionId !== "all" && card.sectionId !== filter.sectionId) return false;
    if (card.startedChildIds.includes(filter.childId)) return false;
    const textbook = card.source === "builtin" || card.unitId !== null;
    if (filter.sourceView === "textbook" && !textbook) return false;
    if (filter.sourceView === "custom" && textbook) return false;
    if (filter.unitId !== "all" && card.unitId !== filter.unitId) return false;
    return !query || card.answerText.toLocaleLowerCase().includes(query);
  });
}
