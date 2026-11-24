import type { TaskCardOption } from "./task-card-filter";

export type CurriculumSection = {
  id: string;
  title: string;
  order: number;
  availableCount: number;
  totalCount: number;
  excludedOptionalCount?: number;
};
export type CurriculumUnit = { id: string; title: string; order: number; sections: CurriculumSection[] };
export type CurriculumCatalogEdition = {
  id: string;
  publisher: string;
  series: string;
  editionText: string;
  grade: number;
  volume: string;
  subject: "chinese" | "english";
  units: Array<{ id: string; title: string; order: number;
    sections: Array<{ id: string; title: string; order: number }> }>;
};
export type CurriculumEdition = Omit<CurriculumCatalogEdition, "units"> & { units: CurriculumUnit[] };

export function buildCurriculumTree(
  cards: TaskCardOption[],
  childId: string,
  subject: "chinese" | "english",
  catalog: CurriculumCatalogEdition[],
  includeRecognition = false,
): CurriculumEdition[] {
  const editions = new Map(catalog.filter((edition) => edition.subject === subject).map((edition) => [
    edition.id,
    { ...edition, units: edition.units.map((unit) => ({ ...unit,
      sections: unit.sections.map((section) => ({ ...section, availableCount: 0, totalCount: 0, excludedOptionalCount: 0 })),
    })) },
  ] as const));
  for (const card of cards) {
    if (card.subject !== subject || !card.editionId || !card.unitId || !card.sectionId) continue;
    const edition = editions.get(card.editionId);
    const unit = edition?.units.find((item) => item.id === card.unitId);
    const section = unit?.sections.find((item) => item.id === card.sectionId);
    if (!section) continue;
    section.totalCount += 1;
    if (card.englishLearningTarget === "recognition" && !includeRecognition) { section.excludedOptionalCount += 1; continue; }
    if (!card.startedChildIds.includes(childId) && !card.activeChildIds?.includes(childId)) section.availableCount += 1;
  }
  return [...editions.values()]
    .sort((a, b) => a.grade - b.grade || a.volume.localeCompare(b.volume))
    .map((edition) => ({ ...edition, units: edition.units.sort((a, b) => a.order - b.order)
      .map((unit) => ({ ...unit, sections: unit.sections.filter(section => section.totalCount > 0).sort((a, b) => a.order - b.order) }))
      .filter(unit => unit.sections.length > 0) }))
    .filter(edition => edition.units.length > 0);
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
