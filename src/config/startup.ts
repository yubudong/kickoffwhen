import nextEnvironment from "@next/env";

import { createEmailSender } from "@/modules/auth/email-sender";
import { parseRegistrationAllowedEmails } from "@/modules/auth/registration-policy";

import { readEnv } from "./env";

export function validateStartupEnvironment(
  source: NodeJS.ProcessEnv = process.env,
) {
  const environment = readEnv(source);
  createEmailSender(environment);
  if (environment.nodeEnv === "production") {
    parseRegistrationAllowedEmails(environment.registrationAllowedEmails ?? "");
  }
  return environment;
}

export function validateProductionStartup(projectDirectory = process.cwd()) {
  Object.assign(process.env, { NODE_ENV: "production" });
  nextEnvironment.loadEnvConfig(projectDirectory, false, console, true);
  return validateStartupEnvironment(process.env);
}
