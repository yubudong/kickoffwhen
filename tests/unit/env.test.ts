import { describe, expect, it } from "vitest";

import { readEnv } from "@/config/env";

describe("readEnv", () => {
  it("拒绝缺少数据库地址的配置", () => {
    expect(() => readEnv({ NODE_ENV: "test" })).toThrow("DATABASE_URL");
  });

  it("解析完整的测试配置", () => {
    expect(
      readEnv({
        NODE_ENV: "test",
        DATABASE_URL: "postgres://app:app@localhost:5433/family_learning_test",
        APP_URL: "http://localhost:3000",
        BETTER_AUTH_SECRET: "12345678901234567890123456789012",
      }).appUrl,
    ).toBe("http://localhost:3000");
  });

  it("测试邮箱开关开启时必须提供专用密钥", () => {
    expect(() =>
      readEnv({
        NODE_ENV: "test",
        DATABASE_URL: "postgres://app:app@localhost:5433/family_learning_test",
        APP_URL: "http://localhost:3000",
        BETTER_AUTH_SECRET: "12345678901234567890123456789012",
        AUTH_TEST_EMAIL_ENABLED: "true",
      }),
    ).toThrow("AUTH_TEST_EMAIL_SECRET");
  });

  it("生产环境永远拒绝开启测试邮箱", () => {
    expect(() =>
      readEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://app:app@localhost:5433/family_learning_test",
        APP_URL: "https://family.example.test",
        BETTER_AUTH_SECRET: "12345678901234567890123456789012",
        SMTP_URL: "smtp://localhost:2525",
        AUTH_TEST_EMAIL_ENABLED: "true",
        AUTH_TEST_EMAIL_SECRET: "test-only-mailbox-secret-1234567890",
      }),
    ).toThrow("AUTH_TEST_EMAIL_ENABLED");
  });
});
