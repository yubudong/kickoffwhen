import { expect, test } from "vitest";

import { buildContentLibrary, type CatalogEdition } from "@/modules/learning-content/library-tree";
import type { LearningCard } from "@/modules/learning-content/types";

const edition: CatalogEdition = {
  id: "edition-1", publisher: "人民教育出版社", series: "统编版", editionText: "2024版",
  subject: "chinese", grade: 5, volume: "上册",
  units: [
    { id: "unit-2", title: "第二单元", order: 2, sections: [{ id: "lesson-3", title: "第三课", order: 1 }] },
    { id: "unit-1", title: "第一单元", order: 1, sections: [
      { id: "lesson-2", title: "第二课", order: 2 },
      { id: "lesson-1", title: "第一课", order: 1 },
    ] },
  ],
};

function card(answerText: string, sourceOrder: number | null, placement: Partial<LearningCard> = {}): LearningCard {
  return {
    id: answerText, familyId: null, subject: "chinese", answerText, broadcastText: answerText,
    hintText: null, pinyinText: null, curriculumSource: null, sourceOrder,
    textbookEditionId: "edition-1", unitId: "unit-1", sectionId: "lesson-1", source: "builtin",
    ...placement,
  };
}

test("按教材路径和原始顺序归位所有卡片，并统计真实卡片数", () => {
  const cards = [
    card("桂花", 2),
    card("故乡", 1),
    card("花生", 1, { sectionId: "lesson-2" }),
    card("未分课", null, { unitId: null, sectionId: null }),
    card("hello", null, { familyId: "family-1", subject: "english", textbookEditionId: null, unitId: null, sectionId: null, source: "manual" }),
  ];
  const tree = buildContentLibrary([edition], cards);

  expect(tree.total).toBe(5);
  expect(tree.editions[0]!.count).toBe(4);
  expect(tree.editions[0]!.units.map((unit) => unit.title)).toEqual(["第一单元", "第二单元"]);
  expect(tree.editions[0]!.units[0]!.count).toBe(3);
  expect(tree.editions[0]!.units[0]!.sections.map((section) => section.title)).toEqual(["第一课", "第二课"]);
  expect(tree.editions[0]!.units[0]!.sections[0]!.cards.map((item) => item.answerText)).toEqual(["故乡", "桂花"]);
  expect(tree.editions[0]!.unplaced.map((item) => item.answerText)).toEqual(["未分课"]);
  expect(tree.personal.english.map((item) => item.answerText)).toEqual(["hello"]);
  expect(cards.map((item) => item.answerText)).toEqual(["桂花", "故乡", "花生", "未分课", "hello"]);
  expect(edition.units.map((unit) => unit.title)).toEqual(["第二单元", "第一单元"]);
});

test("无目录时按科目保留个人卡片，英文组保持为空", () => {
  const tree = buildContentLibrary([], [card("个人词语", null, {
    familyId: "family-1", textbookEditionId: null, unitId: null, sectionId: null, source: "manual",
  })]);
  expect(tree).toMatchObject({ editions: [], total: 1 });
  expect(tree.personal.chinese.map((item) => item.answerText)).toEqual(["个人词语"]);
  expect(tree.personal.english).toEqual([]);
});

test("路径不完整或跨单元时放入最近的教材未分课", () => {
  const tree = buildContentLibrary([edition], [
    card("单元未分课", null, { sectionId: null }),
    card("跨单元小节", null, { sectionId: "lesson-3" }),
    card("教材未分单元", null, { unitId: "unknown", sectionId: "lesson-1" }),
    card("无效教材", null, { textbookEditionId: "unknown" }),
  ]);
  expect(tree.editions[0]!.units[0]!.unplaced.map((item) => item.answerText)).toEqual(["单元未分课", "跨单元小节"]);
  expect(tree.editions[0]!.unplaced.map((item) => item.answerText)).toEqual(["教材未分单元"]);
  expect(tree.personal.chinese.map((item) => item.answerText)).toEqual(["无效教材"]);
  expect(tree.total).toBe(4);
});

test("卡片科目与教材科目不一致时归入卡片自身科目的个人组", () => {
  const tree = buildContentLibrary([edition], [card("hello", 1, {
    familyId: "family-1", subject: "english", source: "manual",
  })]);

  expect(tree.editions[0]!.count).toBe(0);
  expect(tree.editions[0]!.units[0]!.sections[0]!.cards).toEqual([]);
  expect(tree.personal.english.map((item) => item.answerText)).toEqual(["hello"]);
  expect(tree.total).toBe(1);
});
