import { timingSafeEqual } from "node:crypto";

import { FakeEmailSender, type EmailSender } from "./email-sender";

type TestEmailAccessEnvironment = {
  nodeEnv: "development" | "test" | "production";
  authTestEmailEnabled: boolean;
  authTestEmailSecret?: string;
};

export function canAccessTestEmail(
  config: TestEmailAccessEnvironment,
  sender: EmailSender,
  providedSecret: string | undefined,
): boolean {
  if (
    config.nodeEnv === "production" ||
    !config.authTestEmailEnabled ||
    !(sender instanceof FakeEmailSender) ||
    !config.authTestEmailSecret ||
    !providedSecret
  ) {
    return false;
  }

  const expected = Buffer.from(config.authTestEmailSecret);
  const provided = Buffer.from(providedSecret);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
