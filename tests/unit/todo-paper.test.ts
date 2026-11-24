import { expect, test } from "vitest";

import { filterTodoTasks, paperSections, pdfFromJpegs, sortTodoTasks } from "@/modules/todos/paper";

test("状态筛选和排序把待完成放在前面", () => {
  const tasks = [
    { status: "approved", date: "2026-11-13", title: "已通过", requirements: "" },
    { status: "submitted", date: "2026-11-13", title: "待审核", requirements: "交照片" },
    { status: "cancelled", date: "2026-11-12", title: "撤回", requirements: "" },
    { status: "open", date: "2026-11-14", title: "阅读", requirements: "  " },
  ];
  expect(filterTodoTasks(tasks, "remaining").map(task => task.title)).toEqual(["阅读"]);
  expect(filterTodoTasks(tasks, "all")).toHaveLength(4);
  expect(sortTodoTasks(tasks).map(task => task.title)).toEqual(["阅读", "待审核", "已通过", "撤回"]);
  expect(paperSections(["2026-11-14"], filterTodoTasks(tasks, "remaining"), day => day)[0]).toEqual({
    label: "2026-11-14", tasks: [{ title: "阅读", requirements: "按要求完成即可。" }],
  });
});

test("待办 PDF 是可下载的单页文档", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = pdfFromJpegs([{ jpeg, pixelWidth: 4, pixelHeight: 4 }]);
  const text = new TextDecoder().decode(pdf);
  expect(text.startsWith("%PDF-1.4")).toBe(true);
  expect(text).toContain("/Filter /DCTDecode");
  expect(pdf.includes(jpeg[0])).toBe(true);
  expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
});
