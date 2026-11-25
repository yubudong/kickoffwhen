import type { ReactElement } from "react";

import { afterEach, beforeEach, expect, test, vi } from "vitest";

const view = vi.hoisted(() => ({ stateIndex: 0, values: [] as unknown[] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual,
    useCallback: (callback: unknown) => callback,
    useEffect: () => undefined,
    useRef: (initial: unknown) => ({ current: initial }),
    useState: (initial: unknown) => [view.values[view.stateIndex++] ?? initial, vi.fn()],
  };
});

import Link from "next/link";
import { DictationEvidenceSubmit } from "@/components/dictation/dictation-evidence-submit";
import { TaskManagementControls } from "@/components/dictation/task-management-controls";
import { TodoBoard } from "@/components/todos/todo-board";
import { TodoSubmission } from "@/components/todos/todo-submission";

const task = {
  id: "018f3b5d-1111-7111-8111-111111111111", title: "教材听写", requirements: "完成听写", date: "2026-10-13",
  updatedAt: "2026-10-13T00:00:00.000Z", childName: "孩子", kind: "dictation",
  dictationTaskId: "018f3b5d-2222-7222-8222-222222222222", dictationAudioStatus: "ready",
  dictationSessionStatus: "active", dictationPhase: "awaiting_parent", gradingMode: "parent",
  status: "open", submissionNumber: 0, reviewNote: "", points: null, attachment: null as { id: string; mimeType: string } | null,
};

function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children)];
}
function textContent(node: unknown): string {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!node || typeof node !== "object" || !("props" in node)) return "";
  return textContent((node as ReactElement<Record<string, unknown>>).props.children);
}
function render(role: "parent" | "child", overrides: Partial<typeof task> = {}, selected = false) {
  view.stateIndex = 0;
  view.values = ["2026-10-13", "", { tasks: [{ ...task, ...overrides }], points: 0 }, "", false, null, null, null, true];
  if (selected) view.values[12] = task.id;
  return TodoBoard({ role });
}

beforeEach(() => { view.stateIndex = 0; view.values = []; });
afterEach(() => { vi.unstubAllGlobals(); });

test("待家长批改的听写清单显示等待状态和照片批改入口", () => {
  const tree = render("parent", {}, true);
  expect(textContent(tree)).toContain("听写已提交，等待家长批改");
  const link = elements(tree).find((element) => element.type === Link && element.props.href === "/parent/dictation-reviews");
  expect(link?.props.href).toBe("/parent/dictation-reviews");
  expect(elements(tree).some((element) => element.type === TaskManagementControls)).toBe(true);
});

test("孩子从待办可查看已上传听写的批改进度", () => {
  const tree = render("child");
  const button = elements(tree).find((element) => element.type === "button" && textContent(element) === "查看批改进度");
  expect(button?.props.disabled).toBe(false);
  expect(elements(tree).some((element) => element.type === TodoSubmission || element.type === DictationEvidenceSubmit)).toBe(false);
});

test("听写完成后仍可手动提交凭证，家长可复查原附件和审核", () => {
  const completed = render("child", { dictationSessionStatus: "completed", dictationPhase: "completed", gradingMode: "self" }, true);
  expect(elements(completed).find((element) => element.type === DictationEvidenceSubmit)?.props.todo)
    .toEqual({ id: task.id, date: task.date, number: 0 });
  const attachment = { id: "photo", mimeType: "image/png" };
  const submitted = render("parent", { status: "submitted", dictationSessionStatus: "completed", dictationPhase: "completed", attachment }, true);
  expect(elements(submitted).find((element) => typeof element.type === "function" && element.type.name === "Evidence")?.props.attachment).toEqual(attachment);
  expect(elements(submitted).some((element) => typeof element.type === "function" && element.type.name === "ReviewForm")).toBe(true);
});

test("撤回的听写不再显示照片批改入口", () => {
  expect(elements(render("parent", { status: "cancelled", dictationSessionStatus: "cancelled" })).some((element) => element.type === Link)).toBe(false);
});

test("周视图按天列出范围内每一天，日视图仍直接添加到所选日期", () => {
  expect(textContent(render("parent"))).not.toContain("添加到哪一天");
  view.stateIndex = 0;
  view.values = ["2026-10-13", "", { tasks: [
    { ...task, date: "2026-10-13" },
    { ...task, id: "018f3b5d-3333-7333-8333-333333333333", title: "阅读", date: "2026-10-12", kind: "manual", dictationTaskId: null, dictationPhase: null, dictationSessionStatus: null, dictationAudioStatus: null },
  ], points: 4 }, "", false, null, null, null, true, "week"];
  const tree = TodoBoard({ role: "parent" });
  const text = textContent(tree);
  expect(text).toContain("本周 10月12日 周一 至 10月18日 周日");
  expect(text).toContain("10月14日 周三");
  expect(text).toContain("无任务");
  expect(text).toContain("阅读");
  expect(text).toContain("教材听写");
  expect(text).toContain("本范围获得星币：4");
  view.values[13] = true;
  view.stateIndex = 0;
  expect(textContent(TodoBoard({ role: "parent" }))).toContain("添加到哪一天");
  expect(text).toContain("导出 PDF");
  expect(text).toContain("打印");
  const pressed = elements(tree).find((element) => element.type === "button" && element.props["aria-pressed"] === true);
  expect(textContent(pressed)).toBe("周视图");
});
