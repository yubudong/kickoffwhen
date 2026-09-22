import { hash, verify } from "argon2";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";

import type { db } from "@/db/client";

import type { EmailSender } from "./email-sender";
import * as schema from "./schema";

type AuthEnvironment = {
  appUrl: string;
  betterAuthSecret: string;
  nodeEnv: "development" | "test" | "production";
};

export function createAuth(input: {
  database: typeof db;
  emailSender: EmailSender;
  environment: AuthEnvironment;
}) {
  const { database, emailSender, environment } = input;

  return betterAuth({
    baseURL: environment.appUrl,
    secret: environment.betterAuthSecret,
    database: drizzleAdapter(database, {
      provider: "pg",
      schema,
      transaction: true,
    }),
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await emailSender.send({
          to: user.email,
          subject: "验证邮箱",
          text: url,
        });
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: environment.nodeEnv === "production",
      revokeSessionsOnPasswordReset: true,
      password: {
        hash,
        verify: ({ hash: passwordHash, password }) =>
          verify(passwordHash, password),
      },
      sendResetPassword: async ({ user, url }) => {
        await emailSender.send({
          to: user.email,
          subject: "重置密码",
          text: url,
        });
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 10, max: 3 },
      },
    },
  });
}
