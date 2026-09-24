import { expect, test } from "vitest";

import { filterTaskCardOptions } from "@/modules/dictation/task-card-filter";

const cards = [
  {
    id: "builtin",
    answerText: "mountain",
    subject: "english" as const,
    source: "builtin" as const,
    unitId: "unit-1",
    unitTitle: "Unit 1",
    startedChildIds: [],
  },
  {
    id: "manual",
    answerText: "山峰",
    subject: "chinese" as const,
    source: "manual" as const,
    unitId: null,
    unitTitle: null,
    startedChildIds: ["child-a"],
  },
  {
    id: "ocr",
    answerText: "river",
    subject: "english" as const,
    source: "ocr" as const,
    unitId: null,
    unitTitle: null,
    startedChildIds: [],
  },
];

test("科目、单元和课次逐级筛选，不混入其他科目", () => {
  const textbookCards = [
    { ...cards[0]!, id: "cn-1", subject: "chinese" as const, answerText: "桂花", unitId: "cn-u1", sectionId: "lesson-1" },
    { ...cards[0]!, id: "cn-2", subject: "chinese" as const, answerText: "故乡", unitId: "cn-u1", sectionId: "garden-1" },
    { ...cards[0]!, id: "en-1", sectionId: "part-a" },
  ];
  const base = { childId: "child-a", sourceView: "textbook" as const, query: "", unitId: "all", sectionId: "all" };
  expect(filterTaskCardOptions(textbookCards, { ...base, subject: "chinese", unitId: "cn-u1", sectionId: "lesson-1" }).map(c => c.answerText)).toEqual(["桂花"]);
  expect(filterTaskCardOptions(textbookCards, { ...base, subject: "chinese", unitId: "cn-u1" }).map(c => c.answerText)).toEqual(["桂花", "故乡"]);
  expect(filterTaskCardOptions(textbookCards, { ...base, subject: "english" }).map(c => c.answerText)).toEqual(["mountain"]);
});

test("按教材单元、自建来源和搜索过滤，并排除当前孩子已开始卡片", () => {
  expect(filterTaskCardOptions(cards, {
    childId: "child-a",
    sourceView: "custom",
    unitId: "all",
    query: "riv",
  }).map((card) => card.id)).toEqual(["ocr"]);

  expect(filterTaskCardOptions(cards, {
    childId: "child-a",
    sourceView: "textbook",
    unitId: "unit-1",
    query: "mount",
  }).map((card) => card.id)).toEqual(["builtin"]);
});
