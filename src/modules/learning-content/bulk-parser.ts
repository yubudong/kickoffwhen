import type { ParsedCard, Subject } from "./types";

export function parseBulkCards(text: string, subject: Subject): ParsedCard[] {
  const seen = new Set<string>();

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((answerText) => {
      if (!answerText || seen.has(answerText)) return false;
      seen.add(answerText);
      return true;
    })
    .map((answerText, sourceOrder) => ({
      answerText,
      broadcastText: answerText,
      subject,
      sourceOrder,
    }));
}
