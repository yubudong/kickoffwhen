import type { ReactElement } from "react";

import { afterEach, beforeEach, expect, test, vi } from "vitest";

const componentState = vi.hoisted(() => ({
  refresh: vi.fn(),
  setters: [] as Array<ReturnType<typeof vi.fn>>,
  stateIndex: 0,
  values: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: componentState.refresh }),
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useMemo: (calculate: () => unknown) => calculate(),
    useRef: (initial: unknown) => ({ current: initial }),
    useState: (initial: unknown) => {
      const index = componentState.stateIndex;
      componentState.stateIndex += 1;
      const setter = vi.fn();
      componentState.setters[index] = setter;
      return [componentState.values[index] ?? initial, setter];
    },
  };
});

import { TaskBuilderForm } from "@/app/(parent)/parent/tasks/new/task-builder-form";

const childId = "018f3b5d-1111-7111-8111-111111111111";
const newCardId = "018f3b5d-2222-7222-8222-222222222222";
const dueCardId = "018f3b5d-3333-7333-8333-333333333333";

function renderForm(subject: "chinese" | "english" = "chinese") {
  componentState.stateIndex = 0;
  componentState.values = [childId, [newCardId], "", false, "all", "all", "", subject, "all"];
  return TaskBuilderForm({
    childOptions: [{ id: childId, nickname: "孩子", dueCount: 3, dueCounts: { chinese: 1, english: 2 } }],
    cards: [{
      id: newCardId,
      answerText: "桂花",
      subject: "chinese",
      source: "builtin",
      unitId: "cn-unit",
      unitTitle: "第一单元",
      sectionId: "cn-lesson",
      sectionTitle: "第1课",
      startedChildIds: [],
    }, {
      id: "english-card", answerText: "mountain", subject: "english", source: "builtin",
      unitId: "en-unit", unitTitle: "Unit 1", sectionId: "en-part-a", sectionTitle: "Part A",
      startedChildIds: [],
    }],
  }) as ReactElement<{ action: (formData: FormData) => Promise<void> }>;
}

function taskFormData() {
  const formData = new FormData();
  formData.set("maxReviewCards", "20");
  formData.set("mode", "continuous_batch");
  formData.set("order", "source");
  formData.set("intervalSeconds", "8");
  formData.set("repeatCount", "1");
  formData.set("speechRate", "1");
  formData.set("allowManualReplay", "on");
  return formData;
}

function successfulResponse() {
  return Response.json({
    task: {
      id: "018f3b5d-4444-7444-8444-444444444444",
      childId,
      mode: "continuous_batch",
      order: "source",
      intervalSeconds: 8,
      repeatCount: 1,
      speechRate: 1,
      allowManualReplay: true,
      maxReviewCards: 20,
      audioStatus: "preparing",
      items: [
        {
          cardId: dueCardId,
          kind: "due_review",
          position: 0,
          ttsDedupeKey: "tts:due",
          audioStatus: "queued",
          mediaId: null,
        },
        {
          cardId: newCardId,
          kind: "new",
          position: 1,
          ttsDedupeKey: "tts:new",
          audioStatus: "queued",
          mediaId: null,
        },
      ],
    },
  }, { status: 201 });
}

beforeEach(() => {
  componentState.refresh.mockReset();
  componentState.setters = [];
});

function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children)];
}

test("科目和教材单元变化重置下级筛选和已选卡片", () => {
  const tree = elements(renderForm());
  const subject = tree.find(e => e.type === "select" && e.props["aria-label"] === "科目");
  expect(subject).toBeDefined();
  (subject!.props.onChange as (e: unknown) => void)({ target: { value: "english" } });
  expect(componentState.setters[7]).toHaveBeenCalledWith("english");
  expect(componentState.setters[5]).toHaveBeenCalledWith("all");
  expect(componentState.setters[8]).toHaveBeenCalledWith("all");
  expect(componentState.setters[1]).toHaveBeenCalledWith([]);
  componentState.setters.forEach(s => s.mockClear());
  const unit = tree.find(e => e.type === "select" && e.props["aria-label"] === "教材单元");
  (unit!.props.onChange as (e: unknown) => void)({ target: { value: "unit-1" } });
  expect(componentState.setters[5]).toHaveBeenCalledWith("unit-1");
  expect(componentState.setters[8]).toHaveBeenCalledWith("all");
  expect(componentState.setters[1]).toHaveBeenCalledWith([]);
});

test("提交包含所选科目", async () => {
  const request = vi.fn(async () => successfulResponse());
  vi.stubGlobal("fetch", request);
  await renderForm().props.action(taskFormData());
  expect(JSON.parse((request.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ subject: "chinese" });
});

test("仅显示当前科目的单元、小节、卡片和到期数，保留英语原始小节名", () => {
  const tree = elements(renderForm("english"));
  const units = tree.find(e => e.type === "select" && e.props["aria-label"] === "教材单元")!;
  expect(elements(units).filter(e => e.type === "option").map(e => e.props.value)).toEqual(["all", "en-unit"]);
  const sections = tree.find(e => e.type === "select" && e.props["aria-label"] === "课次或教材小节")!;
  expect(elements(sections).filter(e => e.type === "option").map(e => e.props.children)).toEqual(["全部小节", "Part A"]);
  const text = (node: unknown): string => Array.isArray(node) ? node.map(text).join("")
    : node && typeof node === "object" && "props" in node ? text((node as ReactElement<{ children: unknown }>).props.children)
    : typeof node === "string" || typeof node === "number" ? String(node) : "";
  const labels = tree.filter(e => e.type === "label").map(text);
  expect(labels.some(label => label.includes("mountain · 英语 · Unit 1 · Part A"))).toBe(true);
  expect(labels.some(label => label.includes("桂花"))).toBe(false);
  expect(tree.filter(e => e.type === "p").map(text)).toContain("当前孩子有 2 张英语到期卡片，会优先排在新卡片前。");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("含 due 与 new 的任务创建成功后刷新服务端卡片与到期数快照", async () => {
  let resolveResponse!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  })));
  const form = renderForm();

  const submission = form.props.action(taskFormData());
  await Promise.resolve();
  expect(componentState.setters[3]).toHaveBeenLastCalledWith(true);
  expect(componentState.refresh).not.toHaveBeenCalled();

  resolveResponse(successfulResponse());
  await submission;

  expect(componentState.refresh).toHaveBeenCalledTimes(1);
  expect(componentState.setters[1]).toHaveBeenCalledWith([]);
  expect(componentState.setters[3].mock.calls).toEqual([[true], [false]]);
});

test("创建失败时恢复按钮但不刷新服务端快照", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(
    { error: "TASK_EMPTY" },
    { status: 409 },
  )));
  const form = renderForm();

  await form.props.action(taskFormData());

  expect(componentState.refresh).not.toHaveBeenCalled();
  expect(componentState.setters[2]).toHaveBeenCalledWith("创建失败：TASK_EMPTY");
  expect(componentState.setters[3].mock.calls).toEqual([[true], [false]]);
});
