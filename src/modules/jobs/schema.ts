import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    dedupeKey: text("dedupe_key").notNull(),
  },
  (table) => [
    uniqueIndex("jobs_dedupe_key_unique").on(table.dedupeKey),
    check(
      "jobs_type_check",
      sql`${table.type} in ('generate_tts', 'run_ocr', 'delete_media', 'build_weekly_report')`,
    ),
    check(
      "jobs_status_check",
      sql`${table.status} in ('queued', 'running', 'succeeded', 'failed')`,
    ),
    check(
      "jobs_attempts_check",
      sql`${table.attempts} >= 0 and ${table.attempts} <= 5`,
    ),
    check(
      "jobs_last_error_safe_check",
      sql`${table.lastError} is null or length(${table.lastError}) <= 128`,
    ),
  ],
);
