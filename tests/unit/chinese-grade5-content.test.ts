import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

import { assertChineseSeedAudit, auditChineseSeed } from "@/modules/learning-content/content-audit";
import { validateSeedContent } from "@/modules/learning-content/seed-validator";

const loadJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as unknown;
const seedPath = "content/seed/chinese-grade5-volume1.json";
const referencePath = "content/reference/chinese-grade5-volume1.json";

test("五年级上册中文内置词库完整覆盖独立基准", () => {
  const chinese = validateSeedContent(loadJson(seedPath));
  const requirements = loadJson(referencePath) as Parameters<typeof assertChineseSeedAudit>[1];
  const audit = auditChineseSeed(chinese, requirements);
  const cards = chinese.units.flatMap((unit) => unit.sections.flatMap((section) => section.cards));

  expect(requirements.requiredVocabulary.reduce((sum, section) => sum + section.words.length, 0)).toBe(247);
  expect(requirements.requiredCharacters.reduce((sum, section) => sum + section.characters.length, 0)).toBe(223);
  expect(requirements.originalWritingPractice.reduce((sum, section) => sum + section.words.length, 0)).toBe(41);
  expect(chinese.units).toHaveLength(8);
  expect(chinese.units.flatMap((unit) => unit.sections)).toHaveLength(22);
  expect(cards).toHaveLength(312);
  expect(cards.filter((card) => card.curriculumSource === "required_vocabulary")).toHaveLength(247);
  expect(cards.filter((card) => card.curriculumSource === "writing_practice")).toHaveLength(65);
  expect(cards.filter((card) => card.adaptation === "retained")).toHaveLength(29);
  expect(cards.filter((card) => card.adaptation === "replaced")).toHaveLength(12);
  expect(cards.filter((card) => card.adaptation === "coverage_added")).toHaveLength(24);
  expect(audit.missingVocabulary).toEqual([]);
  expect(audit.uncoveredCharacters).toEqual([]);
  expect(audit.duplicateSectionAnswers).toEqual([]);
  expect(audit.replacementMappingErrors).toEqual([]);
  expect(audit.writingPracticeCount).toBe(65);
  expect(audit.originalWritingPracticeCount).toBe(41);
  expect(audit.replacedWritingPracticeCount).toBe(12);
  expect(audit.replacementRatio).toBeCloseTo(12 / 41);
  expect(() => assertChineseSeedAudit(chinese, requirements)).not.toThrow();

  for (const card of cards) {
    expect(card.broadcastText).toBe(card.answerText);
    expect(card.pinyinText).toMatch(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüa-z]/u);
    expect(card.hintText?.match(/（　　）/gu)).toHaveLength(1);
    expect(card.hintText).not.toContain(card.answerText);
  }
});

test("关键词界和用户确认读音保持锁定", () => {
  const chinese = validateSeedContent(loadJson(seedPath));
  const cards = new Map(chinese.units.flatMap((unit) => unit.sections.flatMap((section) => section.cards.map((card) => [card.answerText, card] as const))));

  expect(cards.get("皱纹")?.pinyinText).toBe("zhòu wén");
  expect(cards.get("掏钱")?.pinyinText).toBe("tāo qián");
  expect(cards.get("笙箫管笛")?.pinyinText).toBe("shēng xiāo guǎn dí");
  expect(cards.get("兴亡盛衰")?.pinyinText).toBe("xīng wáng shèng shuāi");
  expect(cards.has("兴亡")).toBe(false);
  expect(cards.has("盛衰")).toBe(false);
  expect(cards.get("一张一弛")?.pinyinText).toBe("yì zhāng yì chí");
  expect(cards.get("一知半解")?.pinyinText).toBe("yì zhī bàn jiě");
  expect(cards.get("纹丝不动")?.pinyinText).toBe("wén sī bú dòng");
  expect(cards.get("不卑不亢")?.pinyinText).toBe("bù bēi bú kàng");
});
