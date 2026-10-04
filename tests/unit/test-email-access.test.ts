import { describe, expect, it } from "vitest";

import { FakeEmailSender } from "@/modules/auth/email-sender";
import { canAccessTestEmail } from "@/modules/auth/test-email-access";

const sender = new FakeEmailSender();

describe("canAccessTestEmail", () => {
  it("默认关闭时拒绝读取", () => {
    expect(
      canAccessTestEmail(
        {
          nodeEnv: "test",
          authTestEmailEnabled: false,
          authTestEmailSecret: undefined,
        },
        sender,
        undefined,
      ),
    ).toBe(false);
  });

  it("开启后仍拒绝错误的请求密钥", () => {
    expect(
      canAccessTestEmail(
        {
          nodeEnv: "test",
          authTestEmailEnabled: true,
          authTestEmailSecret: "test-only-mailbox-secret-1234567890",
        },
        sender,
        "wrong-test-secret",
      ),
    ).toBe(false);
  });

  it("生产环境即使配置和请求密钥一致也拒绝", () => {
    expect(
      canAccessTestEmail(
        {
          nodeEnv: "production",
          authTestEmailEnabled: true,
          authTestEmailSecret: "test-only-mailbox-secret-1234567890",
        },
        sender,
        "test-only-mailbox-secret-1234567890",
      ),
    ).toBe(false);
  });

  it("只有非生产 Fake sender 和正确密钥同时满足才允许", () => {
    expect(
      canAccessTestEmail(
        {
          nodeEnv: "test",
          authTestEmailEnabled: true,
          authTestEmailSecret: "test-only-mailbox-secret-1234567890",
        },
        sender,
        "test-only-mailbox-secret-1234567890",
      ),
    ).toBe(true);
  });
});
