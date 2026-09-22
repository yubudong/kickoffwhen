import { expect, it } from "vitest";

import { validateStartupEnvironment } from "@/config/startup";

it("生产启动预检在监听端口前拒绝缺少 SMTP 的配置", () => {
  expect(() =>
    validateStartupEnvironment({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://app:app@localhost:5433/family_learning_test",
      APP_URL: "https://family.example.test",
      BETTER_AUTH_SECRET: "12345678901234567890123456789012",
    }),
  ).toThrow("SMTP_URL_REQUIRED");
});
