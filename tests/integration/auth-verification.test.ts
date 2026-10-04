import { expect, test } from "vitest";

import { db } from "@/db/client";
import { FakeEmailSender } from "@/modules/auth/email-sender";
import { createAuth } from "@/modules/auth/factory";

const origin = "http://localhost:3000";

function post(path: string, body: Record<string, string>) {
  return new Request(`${origin}/api/auth${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "x-forwarded-for": "203.0.113.24",
    },
    body: JSON.stringify(body),
  });
}

test("生产配置要求注册邮箱验证，验证回跳后才允许登录", async () => {
  const sender = new FakeEmailSender();
  const auth = createAuth({
    database: db,
    emailSender: sender,
    environment: {
      appUrl: origin,
      betterAuthSecret: "integration-only-secret-12345678901234567890",
      nodeEnv: "production",
    },
  });
  const email = `verification-${crypto.randomUUID()}@example.test`;
  const password = `Integration-${crypto.randomUUID()}`;

  const signUp = await auth.handler(
    post("/sign-up/email", {
      callbackURL: "/onboarding",
      email,
      name: "验证测试家长",
      password,
    }),
  );
  expect(signUp.status).toBe(200);
  expect((await signUp.json()).token).toBeNull();

  const beforeVerification = await auth.handler(
    post("/sign-in/email", { callbackURL: "/onboarding", email, password }),
  );
  expect(beforeVerification.status).toBe(403);

  const verificationMessage = sender.messages.findLast(
    (message) => message.to === email && message.subject === "验证邮箱",
  );
  expect(verificationMessage).toBeDefined();
  const verificationUrl = new URL(verificationMessage!.text);
  const verificationResponse = await auth.handler(
    new Request(verificationUrl, { redirect: "manual" }),
  );
  expect(verificationResponse.status).toBe(302);
  expect(new URL(verificationResponse.headers.get("location")!, origin).pathname).toBe(
    "/onboarding",
  );

  const afterVerification = await auth.handler(
    post("/sign-in/email", { callbackURL: "/onboarding", email, password }),
  );
  expect(afterVerification.status).toBe(200);
  expect(afterVerification.headers.get("set-cookie")).toContain("better-auth.session_token");
});
