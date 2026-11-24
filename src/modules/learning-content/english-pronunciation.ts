import { z } from "zod";

const target = z.string().min(1).max(100).regex(/^[A-Za-z][A-Za-z .'-]*$/);
export const englishPronunciationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ipa"), target,
    ipa: z.string().min(1).max(100).regex(/^[a-zɡɑɒæɔəɚɛɜɝɪʊʌŋθðʃʒˈˌː. ]+$/u),
  }).strict(),
  z.object({ kind: z.literal("characters"), target, letters: z.string().regex(/^[A-Z]{1,8}$/) }).strict(),
]);
export type EnglishPronunciation = z.infer<typeof englishPronunciationSchema>;

function escapeXml(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
export function renderEnglishPronunciation(text: string, raw: EnglishPronunciation) {
  const hint = englishPronunciationSchema.parse(raw);
  const escaped = hint.target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`(?<![A-Za-z])(${escaped})(?![A-Za-z])`, "gi");
  const parts = text.split(matcher);
  if (parts.length < 3) throw new Error("TTS_PRONUNCIATION_TARGET_NOT_FOUND");
  return parts.map((part, index) => index % 2 === 0 ? escapeXml(part)
    : hint.kind === "ipa"
      ? `<phoneme alphabet="ipa" ph="${escapeXml(hint.ipa)}">${escapeXml(part)}</phoneme>`
      : `<say-as interpret-as="characters">${escapeXml(hint.letters)}</say-as>`).join("");
}
