import type { ReactElement } from "react";

import { afterEach, beforeEach, expect, test, vi } from "vitest";

const componentState = vi.hoisted(() => ({
  refresh: vi.fn(),
  setters: [] as Array<ReturnType<typeof vi.fn>>,
  stateIndex: 0,
  values: [] as unknown[],
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: componentState.refresh }) }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual,
    useMemo: (calculate: () => unknown) => calculate(),
    useRef: (initial: unknown) => ({ current: initial }),
    useState: (initial: unknown) => {
      const index = componentState.stateIndex++;
      const setter = vi.fn();
      componentState.setters[index] = setter;
      return [componentState.values[index] ?? initial, setter];
    },
  };
});

import { TaskBuilderForm } from "@/app/(parent)/parent/tasks/new/task-builder-form";
import { CurriculumTree } from "@/components/dictation/curriculum-tree";

const childId = "018f3b5d-1111-7111-8111-111111111111";
const cardId = "018f3b5d-2222-7222-8222-222222222222";
const sectionId = "018f3b5d-3333-7333-8333-333333333333";

function renderForm(subject: "chinese" | "english" = "chinese") {
  componentState.stateIndex = 0;
  componentState.values = [childId, [sectionId], [], "", false, subject];
  return TaskBuilderForm({
    childOptions: [{ id: childId, nickname: "孩子", dueCount: 3, dueCounts: { chinese: 1, english: 2 } }],
    catalog: [
      { id: "cn-edition", publisher: "统编", series: "语文", editionText: "测试版", subject: "chinese", grade: 5, volume: "上册",
        units: [{ id: "cn-unit", title: "第一单元", order: 1, sections: [{ id: sectionId, title: "第1课", order: 1 }] }] },
      { id: "en-edition", publisher: "测试社", series: "英语", editionText: "测试版", subject: "english", grade: 5, volume: "上册",
        units: [{ id: "en-unit", title: "Unit 1", order: 1, sections: [{ id: "en-part-a", title: "Part A", order: 1 }] }] },
    ],
    cards: [
      { id: cardId, answerText: "桂花", subject: "chinese", source: "builtin", editionId: "cn-edition", grade: 5, volume: "上册",
        unitId: "cn-unit", unitTitle: "第一单元", unitOrder: 1, sectionId, sectionTitle: "第1课", sectionOrder: 1, startedChildIds: [] },
      { id: "english-card", answerText: "mountain", subject: "english", source: "builtin", editionId: "en-edition", grade: 5, volume: "上册",
        unitId: "en-unit", unitTitle: "Unit 1", unitOrder: 1, sectionId: "en-part-a", sectionTitle: "Part A", sectionOrder: 1, startedChildIds: [] },
    ],
  }) as ReactElement<{ action: (formData: FormData) => Promise<void> }>;
}

function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children)];
}

function formData() {
  const data = new FormData();
  data.set("mode", "continuous_batch"); data.set("order", "source");
  data.set("intervalSeconds", "8"); data.set("repeatCount", "1");
  data.set("speechRate", "1"); data.set("allowManualReplay", "on");
  return data;
}

function success() {
  return Response.json({ tasks: [{ id: crypto.randomUUID(), childId, mode: "continuous_batch", order: "source",
    intervalSeconds: 8, repeatCount: 1, speechRate: 1, allowManualReplay: true, maxReviewCards: 0,
    audioStatus: "preparing", items: [{ cardId, kind: "new", position: 0, ttsDedupeKey: "tts:new", audioStatus: "queued", mediaId: null }],
  }] }, { status: 201 });
}

beforeEach(() => { componentState.refresh.mockReset(); componentState.setters = []; });
afterEach(() => { vi.unstubAllGlobals(); });

test("切换科目或孩子会清除先前选中的课次和加练词", () => {
  const tree = elements(renderForm());
  const subject = tree.find((element) => element.type === "select" && element.props["aria-label"] === "科目")!;
  (subject.props.onChange as (event: unknown) => void)({ target: { value: "english" } });
  expect(componentState.setters[5]).toHaveBeenCalledWith("english");
  expect(componentState.setters[1]).toHaveBeenCalledWith([]);
  expect(componentState.setters[2]).toHaveBeenCalledWith([]);
  const childSelect = tree.find((element) => element.type === "select" && element.props.value === childId)!;
  (childSelect.props.onChange as (event: unknown) => void)({ target: { value: "other-child" } });
  expect(componentState.setters[0]).toHaveBeenCalledWith("other-child");
  expect(componentState.setters[1]).toHaveBeenCalledWith([]);
});

test("批量提交包含科目与课次 ID", async () => {
  const request = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe("/api/parent/task-batches");
    expect(JSON.parse(init.body as string))
      .toMatchObject({ subject: "chinese", sectionIds: [sectionId], extraCardIds: [] });
    return success();
  });
  vi.stubGlobal("fetch", request);
  await renderForm().props.action(formData());
  expect(request).toHaveBeenCalledOnce();
});

test("教材树按科目展示，保留英语教材的 Part A 名称", () => {
  const tree = elements(renderForm("english"));
  const curriculum = tree.find((element) => element.type === CurriculumTree)!;
  const editions = curriculum.props.editions as Array<{ subject: string; units: Array<{ sections: Array<{ title: string }> }> }>;
  expect(editions).toHaveLength(1);
  expect(editions[0].subject).toBe("english");
  expect(editions[0].units[0].sections[0].title).toBe("Part A");
});

test("成功后刷新服务端快照并清空选择", async () => {
  let resolveResponse!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveResponse = resolve; })));
  const submission = renderForm().props.action(formData());
  await Promise.resolve();
  expect(componentState.setters[4]).toHaveBeenLastCalledWith(true);
  expect(componentState.refresh).not.toHaveBeenCalled();
  resolveResponse(success());
  await submission;
  expect(componentState.refresh).toHaveBeenCalledOnce();
  expect(componentState.setters[1]).toHaveBeenCalledWith([]);
  expect(componentState.setters[2]).toHaveBeenCalledWith([]);
  expect(componentState.setters[4].mock.calls).toEqual([[true], [false]]);
});

test("创建失败时恢复按钮且不刷新", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "TASK_EMPTY" }, { status: 400 })));
  await renderForm().props.action(formData());
  expect(componentState.refresh).not.toHaveBeenCalled();
  expect(componentState.setters[3]).toHaveBeenCalledWith("创建失败：TASK_EMPTY");
  expect(componentState.setters[4].mock.calls).toEqual([[true], [false]]);
});
