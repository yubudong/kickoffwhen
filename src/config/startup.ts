import nextEnvironment from "@next/env";

import { createEmailSender } from "@/modules/auth/email-sender";

import { readEnv } from "./env";

export function validateStartupEnvironment(
  source: NodeJS.ProcessEnv = process.env,
) {
  const environment = readEnv(source);
  createEmailSender(environment);
  return environment;
}

export function validateProductionStartup(projectDirectory = process.cwd()) {
  Object.assign(process.env, { NODE_ENV: "production" });
  nextEnvironment.loadEnvConfig(projectDirectory, false, console, true);
  return validateStartupEnvironment(process.env);
}
