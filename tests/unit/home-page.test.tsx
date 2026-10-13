import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import HomePage from "@/app/page";

describe("HomePage", () => {
  it("展示家长和孩子登录入口，默认收起孩子列表", () => {
    const html = renderToStaticMarkup(<HomePage />);

    expect(html).toContain("家庭学习工具");
    expect(html).toContain('href="/sign-in"');
    expect(html).toContain("家长登录");
    expect(html).toContain("孩子登录");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("今天是谁来学习");
    expect(html).not.toContain("Family Learning MVP");
    expect(html).not.toContain("先完成基础登录、设备识别与环境校验");
  });
});
