import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z.string().url(),
    APP_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    SMTP_URL: z.string().optional(),
    SMTP_FROM: z.string().min(3).optional(),
    REGISTRATION_ALLOWED_EMAILS: z.string().optional(),
    MEDIA_ROOT: z.string().default("./var/media"),
    AUTH_TEST_EMAIL_ENABLED: z.enum(["true", "false"]).default("false"),
    AUTH_TEST_EMAIL_SECRET: z.string().min(32).optional(),
  })
  .superRefine((value, context) => {
    if (
      value.AUTH_TEST_EMAIL_ENABLED === "true" &&
      !value.AUTH_TEST_EMAIL_SECRET
    ) {
      context.addIssue({
        code: "custom",
        message: "AUTH_TEST_EMAIL_SECRET is required when test email access is enabled",
        path: ["AUTH_TEST_EMAIL_SECRET"],
      });
    }

    if (
      value.NODE_ENV === "production" &&
      value.AUTH_TEST_EMAIL_ENABLED === "true"
    ) {
      context.addIssue({
        code: "custom",
        message: "AUTH_TEST_EMAIL_ENABLED cannot be enabled in production",
        path: ["AUTH_TEST_EMAIL_ENABLED"],
      });
    }
  });

export type AppEnv = ReturnType<typeof readEnv>;

export function readEnv(source: NodeJS.ProcessEnv = process.env) {
  const value = schema.parse(source);

  return {
    nodeEnv: value.NODE_ENV,
    databaseUrl: value.DATABASE_URL,
    appUrl: value.APP_URL,
    betterAuthSecret: value.BETTER_AUTH_SECRET,
    smtpUrl: value.SMTP_URL,
    smtpFrom: value.SMTP_FROM,
    registrationAllowedEmails: value.REGISTRATION_ALLOWED_EMAILS,
    mediaRoot: value.MEDIA_ROOT,
    authTestEmailEnabled: value.AUTH_TEST_EMAIL_ENABLED === "true",
    authTestEmailSecret: value.AUTH_TEST_EMAIL_SECRET,
  } as const;
}
