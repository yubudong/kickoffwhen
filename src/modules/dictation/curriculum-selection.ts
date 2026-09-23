import type { TaskCardOption } from "./task-card-filter";

export type CurriculumSection = {
  id: string;
  title: string;
  order: number;
  availableCount: number;
  totalCount: number;
};
export type CurriculumUnit = { id: string; title: string; order: number; sections: CurriculumSection[] };
export type CurriculumEdition = {
  id: string;
  grade: number;
  volume: string;
  subject: "chinese" | "english";
  units: CurriculumUnit[];
};

export function buildCurriculumTree(
  cards: TaskCardOption[],
  childId: string,
  subject: "chinese" | "english",
): CurriculumEdition[] {
  const editions = new Map<string, CurriculumEdition>();
  for (const card of cards) {
    if (card.subject !== subject || !card.editionId || !card.unitId || !card.sectionId || !card.grade || !card.volume) continue;
    let edition = editions.get(card.editionId);
    if (!edition) {
      edition = { id: card.editionId, grade: card.grade, volume: card.volume, subject, units: [] };
      editions.set(card.editionId, edition);
    }
    let unit = edition.units.find((item) => item.id === card.unitId);
    if (!unit) {
      unit = { id: card.unitId, title: card.unitTitle ?? "未命名单元", order: card.unitOrder ?? 0, sections: [] };
      edition.units.push(unit);
    }
    let section = unit.sections.find((item) => item.id === card.sectionId);
    if (!section) {
      section = { id: card.sectionId, title: card.sectionTitle ?? "未命名课次", order: card.sectionOrder ?? 0, availableCount: 0, totalCount: 0 };
      unit.sections.push(section);
    }
    section.totalCount += 1;
    if (!card.startedChildIds.includes(childId) && !card.activeChildIds?.includes(childId)) section.availableCount += 1;
  }
  return [...editions.values()]
    .sort((a, b) => a.grade - b.grade || a.volume.localeCompare(b.volume))
    .map((edition) => ({ ...edition, units: edition.units.sort((a, b) => a.order - b.order)
      .map((unit) => ({ ...unit, sections: unit.sections.sort((a, b) => a.order - b.order) })) }));
}

export function toggleUnitSections(current: string[], sectionIds: string[]): string[] {
  const selected = new Set(current);
  if (sectionIds.every((id) => selected.has(id))) {
    for (const id of sectionIds) selected.delete(id);
  } else {
    for (const id of sectionIds) selected.add(id);
  }
  return [...selected];
}
