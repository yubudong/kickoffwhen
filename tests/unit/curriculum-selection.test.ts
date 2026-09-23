import { expect, test } from "vitest";

import { buildCurriculumTree, toggleUnitSections } from "@/modules/dictation/curriculum-selection";
import type { TaskCardOption } from "@/modules/dictation/task-card-filter";

const editionId = "018f3b5d-1111-7111-8111-111111111111";
const unitId = "018f3b5d-2222-7222-8222-222222222222";
const first = "018f3b5d-3333-7333-8333-333333333333";
const second = "018f3b5d-4444-7444-8444-444444444444";
const child = "018f3b5d-5555-7555-8555-555555555555";
const cards: TaskCardOption[] = [
  { id: crypto.randomUUID(), answerText: "桂花", subject: "chinese", source: "builtin", editionId, grade: 5, volume: "上册", unitId, unitTitle: "第一单元", unitOrder: 1, sectionId: first, sectionTitle: "第1课", sectionOrder: 1, startedChildIds: [] },
  { id: crypto.randomUUID(), answerText: "故乡", subject: "chinese", source: "builtin", editionId, grade: 5, volume: "上册", unitId, unitTitle: "第一单元", unitOrder: 1, sectionId: first, sectionTitle: "第1课", sectionOrder: 1, startedChildIds: [child] },
  { id: crypto.randomUUID(), answerText: "浇水", subject: "chinese", source: "builtin", editionId, grade: 5, volume: "上册", unitId, unitTitle: "第一单元", unitOrder: 1, sectionId: second, sectionTitle: "第2课", sectionOrder: 2, startedChildIds: [] },
];

test("教材树只按单元与课展示可用词数，整单元勾选可半选", () => {
  const tree = buildCurriculumTree(cards, child, "chinese");
  expect(tree).toHaveLength(1);
  expect(tree[0]).toMatchObject({ grade: 5, volume: "上册", units: [{ title: "第一单元", sections: [
    { id: first, title: "第1课", availableCount: 1, totalCount: 2 },
    { id: second, title: "第2课", availableCount: 1, totalCount: 1 },
  ] }] });
  expect(toggleUnitSections([], [first, second])).toEqual([first, second]);
  expect(toggleUnitSections([first, second], [first, second])).toEqual([]);
  expect(toggleUnitSections([first], [first, second])).toEqual([first, second]);
});
