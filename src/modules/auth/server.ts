import "server-only";

import { toNextJsHandler } from "better-auth/next-js";

import { env } from "@/config/runtime";
import { db } from "@/db/client";

import { createEmailSender } from "./email-sender";
import { createAuth } from "./factory";
import { guardRegistrationRequest } from "./registration-guard";
import { parseRegistrationAllowedEmails } from "./registration-policy";

export const emailSender = createEmailSender(env);

export const auth = createAuth({
  database: db,
  emailSender,
  environment: env,
});

export const authHandler = toNextJsHandler(auth);

const allowedRegistrationEmails =
  env.nodeEnv === "production"
    ? parseRegistrationAllowedEmails(env.registrationAllowedEmails ?? "")
    : null;

export const guardedAuthPost = (request: Request) =>
  allowedRegistrationEmails
    ? guardRegistrationRequest(request, authHandler.POST, allowedRegistrationEmails)
    : authHandler.POST(request);
