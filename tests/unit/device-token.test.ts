import { describe, expect, test } from "vitest";

import {
  createOpaqueToken,
  hashOpaqueToken,
  tokenCookieOptions,
} from "@/modules/devices/token";

describe("device tokens", () => {
  test("设备令牌只保存 SHA-256 摘要", () => {
    const token = createOpaqueToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashOpaqueToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashOpaqueToken(token)).not.toBe(token);
  });

  test("同一明文令牌产生稳定摘要且不同令牌不会复用", () => {
    const first = createOpaqueToken();
    const second = createOpaqueToken();

    expect(second).not.toBe(first);
    expect(hashOpaqueToken(first)).toBe(hashOpaqueToken(first));
    expect(hashOpaqueToken(second)).not.toBe(hashOpaqueToken(first));
  });

  test("令牌 Cookie 始终 HttpOnly 和 SameSite=Lax，生产环境额外 Secure", () => {
    expect(tokenCookieOptions("test")).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
    });
    expect(tokenCookieOptions("production")).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
    });
  });
});
