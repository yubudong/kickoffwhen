import type { EnglishDetails } from "@/modules/learning-content/english-types";
import { englishFormLabel } from "@/modules/learning-content/english-types";

export function EnglishCardDetails({ details, filled = false, hideMeaning = false }: {
  details: EnglishDetails; filled?: boolean; hideMeaning?: boolean;
}) {
  return <div className="english-card-details">
    {!hideMeaning && <p className="english-meaning">{details.meaningZh}{details.grammarForm && !details.meaningZh?.includes(englishFormLabel(details.grammarForm)) ? ` · ${englishFormLabel(details.grammarForm)}` : ""}
      {details.phonetic && <span lang="en" className="english-phonetic"> · /{details.phonetic}/</span>}</p>}
    {(filled ? details.exampleSentence : details.exampleWithBlank) && <p lang="en" className="english-example">{filled ? details.exampleSentence : details.exampleWithBlank}</p>}
    {details.exampleTranslation && <p className="english-translation">{details.exampleTranslation}</p>}
    {details.spellingRules.note && <p className="english-rule">{details.spellingRules.note}</p>}
    {details.spellingRules.acceptedAnswers.length > 0 && <p className="english-rule">另可接受：<span lang="en">{details.spellingRules.acceptedAnswers.join(" / ")}</span></p>}
  </div>;
}
