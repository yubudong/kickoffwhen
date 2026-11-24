import type { EnglishSpellingRules } from "./english-types";

export function normalizeEnglishSpelling(value: string) {
  return value.normalize("NFKC").replace(/[‘’ʼ]/g, "'").replace(/[‐‑‒–]/g, "-")
    .trim().replace(/\s+/g, " ");
}
const alternatives: Record<string, string[]> = {
  colour: ["color"], centre: ["center"], favourite: ["favorite"], labour: ["labor"],
  kilometre: ["kilometer"], "Labour Day": ["Labor Day"], "hard-working": ["hardworking"],
};
export function checkEnglishSpelling(input: string, answer: string, rules: EnglishSpellingRules) {
  const actual = normalizeEnglishSpelling(input);
  const targets = [answer, ...rules.acceptedAnswers].map(normalizeEnglishSpelling);
  const accepted = targets.flatMap(target => rules.caseRule === "required"
    ? [target] : [target, target.charAt(0).toUpperCase() + target.slice(1)]);
  if (accepted.includes(actual)) return { correct: true, message: "与本卡目标写法一致。仍请核对纸面内容并确认。" };
  if (!actual) return { correct: false, message: "请输入纸上写的英文，再核对。" };
  if (accepted.some(target => target.toLowerCase() === actual.toLowerCase())) {
    return { correct: false, message: "字母相符，请按教材核对大小写；姓名、月份、星期、I 等要保留必要的大写。" };
  }
  if (accepted.some(target => target.replaceAll(" ", "") === actual.replaceAll(" ", ""))) {
    return { correct: false, message: "请核对单词之间的空格；词组需要按目标写法分词。" };
  }
  if ((alternatives[answer] ?? []).includes(actual)) {
    return { correct: false, message: `这是另一种规范写法。本卡按教材练习 ${answer}，请按课堂要求自行确认。` };
  }
  if (/^\d+(st|nd|rd|th)?$/i.test(actual)) {
    return { correct: false, message: "本卡练习完整英文拼写，数字或数字简写不自动视作相同答案。" };
  }
  return { correct: false, message: "与本卡目标写法不一致。请核对字母、时态、复数、连字符及缩写形式，再确认纸面结果。" };
}
