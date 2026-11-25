import manifest from "../../../content/official-english-manifest.json";

export function officialEnglishInfo(edition: {
  subject: string; grade: number; volume: string; publisher?: string; series?: string; editionText?: string; label?: string;
}) {
  if (edition.subject !== "english") return undefined;
  return manifest.books.find(book => book.grade === edition.grade && book.volumeText === edition.volume
    && (book.editionText === edition.editionText || edition.label?.endsWith(book.editionText)));
}
export function curriculumGroupLabel(edition: { subject: string; units: Array<{ title: string }> }) {
  if (edition.subject !== "english") return `${edition.units.length} 个单元`;
  const appendix = edition.units.filter(unit => unit.title.startsWith("附录")).length;
  return `${edition.units.length - appendix} 个单元${appendix ? ` · ${appendix} 个附录` : ""}`;
}
