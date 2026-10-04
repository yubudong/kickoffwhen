import { describe, expect, it } from "vitest";

import {
  isRegistrationAllowed,
  parseRegistrationAllowedEmails,
} from "@/modules/auth/registration-policy";
import { guardRegistrationRequest } from "@/modules/auth/registration-guard";

describe("家庭试用注册限制", () => {
  it("按大小写不敏感的完整邮箱允许注册", () => {
    const allowed = parseRegistrationAllowedEmails("tom@example.com, parent@example.com");

    expect(isRegistrationAllowed(" TOM@example.com ", allowed)).toBe(true);
    expect(isRegistrationAllowed("other@example.com", allowed)).toBe(false);
  });

  it("生产配置不允许空白名单", () => {
    expect(() => parseRegistrationAllowedEmails("  , ")).toThrow(
      "REGISTRATION_ALLOWED_EMAILS_REQUIRED",
    );
  });

  it("拒绝白名单外的注册请求且不调用认证处理器", async () => {
    let handled = false;
    const response = await guardRegistrationRequest(
      new Request("https://kickoffwhen.com/api/auth/sign-up/email", {
        method: "POST",
        body: JSON.stringify({ email: "other@example.com" }),
        headers: { "content-type": "application/json" },
      }),
      async () => {
        handled = true;
        return new Response(null, { status: 204 });
      },
      new Set(["tom@example.com"]),
    );

    expect(response.status).toBe(403);
    expect(handled).toBe(false);
  });

  it("允许白名单内邮箱进入认证处理器", async () => {
    const response = await guardRegistrationRequest(
      new Request("https://kickoffwhen.com/api/auth/sign-up/email", {
        method: "POST",
        body: JSON.stringify({ email: "Tom@example.com" }),
        headers: { "content-type": "application/json" },
      }),
      async () => new Response(null, { status: 204 }),
      new Set(["tom@example.com"]),
    );

    expect(response.status).toBe(204);
  });
});
