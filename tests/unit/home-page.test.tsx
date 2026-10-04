import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import HomePage from "@/app/page";

describe("HomePage", () => {
  it("只展示中文标题和家长登录入口", () => {
    const html = renderToStaticMarkup(<HomePage />);

    expect(html).toContain("家庭学习工具");
    expect(html).toContain('href="/sign-in"');
    expect(html).toContain("进入家长登录");
    expect(html).not.toContain("Family Learning MVP");
    expect(html).not.toContain("先完成基础登录、设备识别与环境校验");
  });
});
