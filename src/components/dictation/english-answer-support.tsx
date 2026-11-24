"use client";

import { useState } from "react";
import type { EnglishDetails } from "@/modules/learning-content/english-types";
import { checkEnglishSpelling } from "@/modules/learning-content/english-spelling";
import { EnglishCardDetails } from "@/components/content/english-card-details";

export function EnglishAnswerSupport({ answer, details, disabled, onSuggest }: {
  answer: string; details: EnglishDetails; disabled: boolean; onSuggest?: (correct: boolean) => void;
}) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<ReturnType<typeof checkEnglishSpelling> | null>(null);
  return <div className="english-answer-support">
    <p className="english-meaning">{details.meaningZh}{details.phonetic && <span lang="en"> · /{details.phonetic}/</span>}</p>
    <details><summary>查看语境与拼写核对</summary>
      <EnglishCardDetails details={details} filled hideMeaning/>
      <label>输入纸上英文拼写（可选）<input autoComplete="off" autoCapitalize="none" spellCheck={false} lang="en" value={input} disabled={disabled}
        onChange={event => { setInput(event.target.value); setResult(null); }}/></label>
      <button type="button" disabled={disabled || !input.trim()} onClick={() => setResult(checkEnglishSpelling(input, answer, details.spellingRules))}>核对拼写</button>
      {result && <div aria-live="polite"><p>{result.message}</p>{onSuggest && <button type="button" disabled={disabled} onClick={() => onSuggest(result.correct)}>
        {result.correct ? "确认纸面一致，标记正确" : "确认按本卡目标订正，标记错了"}</button>}</div>}
      <p className="english-rule">工具只核对输入拼写。请对照纸面并按课堂要求确认，未确认前不会保存或更改成绩。</p>
    </details>
  </div>;
}
