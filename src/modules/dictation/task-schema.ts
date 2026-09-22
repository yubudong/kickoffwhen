import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { children, families, guardians } from "@/modules/families/schema";
import { learningCards } from "@/modules/learning-content/schema";

export const learningTasks = pgTable(
  "learning_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    childId: uuid("child_id").notNull(),
    guardianId: uuid("guardian_id").notNull(),
    commandId: uuid("command_id").notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    mode: text("mode").notNull(),
    taskOrder: text("task_order").notNull(),
    intervalSeconds: integer("interval_seconds").notNull(),
    repeatCount: integer("repeat_count").notNull(),
    speechRate: numeric("speech_rate", { precision: 4, scale: 2 }).notNull(),
    allowManualReplay: boolean("allow_manual_replay").notNull(),
    maxReviewCards: integer("max_review_cards").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    unique("learning_tasks_family_child_id_unique").on(
      table.familyId,
      table.childId,
      table.id,
    ),
    uniqueIndex("learning_tasks_family_command_unique").on(table.familyId, table.commandId),
    foreignKey({
      name: "learning_tasks_family_child_fk",
      columns: [table.familyId, table.childId],
      foreignColumns: [children.familyId, children.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "learning_tasks_family_guardian_fk",
      columns: [table.familyId, table.guardianId],
      foreignColumns: [guardians.familyId, guardians.id],
    }).onDelete("restrict"),
    check("learning_tasks_mode_check", sql`${table.mode} in ('continuous_batch', 'item_by_item')`),
    check("learning_tasks_order_check", sql`${table.taskOrder} in ('source', 'random')`),
    check("learning_tasks_interval_check", sql`${table.intervalSeconds} between 2 and 120`),
    check("learning_tasks_repeat_check", sql`${table.repeatCount} between 1 and 3`),
    check("learning_tasks_speech_rate_check", sql`${table.speechRate} between 0.5 and 2`),
    check("learning_tasks_review_cap_check", sql`${table.maxReviewCards} between 0 and 100`),
    check("learning_tasks_status_check", sql`${table.status} in ('active', 'completed', 'cancelled')`),
    index("learning_tasks_child_status_idx").on(table.familyId, table.childId, table.status),
  ],
);

export const learningTaskItems = pgTable(
  "learning_task_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    familyId: uuid("family_id").notNull(),
    childId: uuid("child_id").notNull(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => learningCards.id, { onDelete: "restrict" }),
    cardFamilyId: uuid("card_family_id"),
    kind: text("kind").notNull(),
    position: integer("position").notNull(),
    ttsDedupeKey: text("tts_dedupe_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "learning_task_items_task_scope_fk",
      columns: [table.familyId, table.childId, table.taskId],
      foreignColumns: [learningTasks.familyId, learningTasks.childId, learningTasks.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "learning_task_items_custom_card_scope_fk",
      columns: [table.cardFamilyId, table.cardId],
      foreignColumns: [learningCards.familyId, learningCards.id],
    }).onDelete("restrict"),
    check(
      "learning_task_items_card_family_check",
      sql`${table.cardFamilyId} is null or ${table.cardFamilyId} = ${table.familyId}`,
    ),
    check("learning_task_items_kind_check", sql`${table.kind} in ('due_review', 'new')`),
    check("learning_task_items_position_check", sql`${table.position} >= 0`),
    unique("learning_task_items_task_position_unique").on(table.taskId, table.position),
    unique("learning_task_items_task_card_unique").on(table.taskId, table.cardId),
    unique("learning_task_items_scope_task_item_unique").on(
      table.familyId,
      table.childId,
      table.taskId,
      table.id,
    ),
    index("learning_task_items_tts_dedupe_idx").on(table.ttsDedupeKey),
    index("learning_task_items_child_idx").on(table.familyId, table.childId),
  ],
);
