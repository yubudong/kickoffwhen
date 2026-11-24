import { officialEnglishInfo } from "@/modules/learning-content/english-catalog";

export function EnglishBookNote({ edition }: { edition: Parameters<typeof officialEnglishInfo>[0] }) {
  const book = officialEnglishInfo(edition);
  if (!book) return null;
  const counts = book.counts as Partial<Record<"spelling" | "core" | "recognition",number>>;
  return <div className="english-book-note muted">
    <p>PEP（三年级起点）。本册{counts.spelling ? ` ${counts.spelling} 项教材明确读写词；` : ""}{counts.core ? ` ${counts.core} 项理解运用核心词；` : ""}{counts.recognition ? ` ${counts.recognition} 项认读或自选复习内容。` : ""}
      新版“理解、运用”不等于逐词强制默写；家长可选择做拼写练习。认读内容默认不混入新课范围。</p>
    <p>标准英语朗读，音标供参考；语境句为辅助练习句。
      <a href={book.sourceUrl} target="_blank" rel="noreferrer">教材来源</a> · <a href={book.contentsUrl} target="_blank" rel="noreferrer">本版目录</a> · <a href={book.vocabularyUrl} target="_blank" rel="noreferrer">词表原页</a></p>
  </div>;
}
