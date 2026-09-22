import "server-only";

import { toNextJsHandler } from "better-auth/next-js";

import { env } from "@/config/runtime";
import { db } from "@/db/client";

import { createEmailSender } from "./email-sender";
import { createAuth } from "./factory";

export const emailSender = createEmailSender(env);

export const auth = createAuth({
  database: db,
  emailSender,
  environment: env,
});

export const authHandler = toNextJsHandler(auth);
