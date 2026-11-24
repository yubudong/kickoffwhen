import type { ContentLibrary } from "./library-tree";
import type { Subject } from "./types";

export type SubjectFilter = Subject | "all";
export type GradeFilter = number | "all";

export function matchesCurriculumFilter(item: { subject: string; grade?: number | null }, subject: SubjectFilter, grade: GradeFilter): boolean {
  return (subject === "all" || item.subject === subject) && (grade === "all" || item.grade === grade);
}

export function filterContentLibrary(library: ContentLibrary, subject: SubjectFilter, grade: GradeFilter): ContentLibrary {
  const editions = library.editions.filter(item => matchesCurriculumFilter(item, subject, grade));
  const byId = new Map(library.editions.map(item => [item.id, item]));
  const filterPersonal = (key: Subject) => library.personal[key].filter(card => {
    const edition = byId.get(card.textbookEditionId ?? "");
    return matchesCurriculumFilter({ subject: card.subject, grade: edition?.subject === card.subject ? edition.grade : undefined }, subject, grade);
  });
  const personal = { chinese: filterPersonal("chinese"), english: filterPersonal("english") };
  return { editions, personal, total: editions.reduce((sum, item) => sum + item.count, 0) + personal.chinese.length + personal.english.length };
}
