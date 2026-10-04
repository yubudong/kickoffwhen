import type { LearningCard, Subject } from "./types";

export type CatalogEdition = {
  id: string;
  publisher: string;
  series: string;
  editionText: string;
  subject: Subject;
  grade: number;
  volume: string;
  units: {
    id: string;
    title: string;
    order: number;
    sections: { id: string; title: string; order: number }[];
  }[];
};

export type LibrarySection = { id: string; title: string; order: number; cards: LearningCard[] };
export type LibraryUnit = { id: string; title: string; order: number; sections: LibrarySection[]; unplaced: LearningCard[]; count: number };
export type LibraryEdition = { id: string; label: string; subject: Subject; grade: number; volume: string; units: LibraryUnit[]; unplaced: LearningCard[]; count: number };
export type ContentLibrary = { editions: LibraryEdition[]; personal: Record<Subject, LearningCard[]>; total: number };

const compareCards = (a: LearningCard, b: LearningCard) =>
  (a.sourceOrder ?? Number.MAX_SAFE_INTEGER) - (b.sourceOrder ?? Number.MAX_SAFE_INTEGER)
  || a.answerText.localeCompare(b.answerText)
  || a.id.localeCompare(b.id);

export function buildContentLibrary(catalog: CatalogEdition[], cards: LearningCard[]): ContentLibrary {
  const editions: LibraryEdition[] = catalog.map((item) => ({
    id: item.id,
    label: [item.publisher, item.series, item.editionText].filter(Boolean).join(" · "),
    subject: item.subject,
    grade: item.grade,
    volume: item.volume,
    units: item.units.map((unit) => ({
      id: unit.id,
      title: unit.title,
      order: unit.order,
      sections: unit.sections.map((section) => ({ ...section, cards: [] })).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
      unplaced: [],
      count: 0,
    })).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    unplaced: [],
    count: 0,
  })).sort((a, b) =>
    a.subject.localeCompare(b.subject)
    || a.grade - b.grade
    || a.volume.localeCompare(b.volume)
    || a.label.localeCompare(b.label)
    || a.id.localeCompare(b.id));

  const personal: Record<Subject, LearningCard[]> = { chinese: [], english: [] };
  const editionsById = new Map(editions.map((edition) => [edition.id, edition]));
  for (const card of cards) {
    const candidate = editionsById.get(card.textbookEditionId ?? "");
    const edition = candidate?.subject === card.subject ? candidate : undefined;
    const unit = edition?.units.find((item) => item.id === card.unitId);
    const section = unit?.sections.find((item) => item.id === card.sectionId);
    if (section) section.cards.push(card);
    else if (unit) unit.unplaced.push(card);
    else if (edition) edition.unplaced.push(card);
    else personal[card.subject].push(card);
  }

  for (const edition of editions) {
    edition.unplaced.sort(compareCards);
    for (const unit of edition.units) {
      unit.unplaced.sort(compareCards);
      for (const section of unit.sections) section.cards.sort(compareCards);
      unit.count = unit.unplaced.length + unit.sections.reduce((sum, section) => sum + section.cards.length, 0);
    }
    edition.count = edition.unplaced.length + edition.units.reduce((sum, unit) => sum + unit.count, 0);
  }
  personal.chinese.sort(compareCards);
  personal.english.sort(compareCards);
  return { editions, personal, total: cards.length };
}
