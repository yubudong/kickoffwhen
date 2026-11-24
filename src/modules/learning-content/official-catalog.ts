import manifest from "../../../content/official-chinese-manifest.json";

export function officialTextbookInfo(edition: {
  subject: string;
  grade: number;
  volume: string;
  editionText?: string;
  label?: string;
}) {
  if (edition.subject !== "chinese") return undefined;
  return manifest.books.find(book => book.grade === edition.grade && book.volumeText === edition.volume
    && (book.editionText === edition.editionText || edition.label?.endsWith(book.editionText)));
}
