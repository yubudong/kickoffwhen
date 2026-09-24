import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { children, families } from "@/modules/families/schema";
import { reviewEvents } from "@/modules/review/db-schema";

import { learningTaskItems, learningTasks } from "./task-schema";
import type { DictationSnapshot } from "./session-types";

export const dictationSessions = pgTable(
  "dictation_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    childId: uuid("child_id").notNull(),
    taskId: uuid("task_id").notNull(),
    mode: text("mode").notNull(),
    status: text("status").notNull().default("active"),
    phase: text("phase").notNull().default("listening"),
    version: integer("version").notNull().default(0),
    roundNumber: integer("round_number").notNull().default(1),
    currentRoundItemIds: jsonb("current_round_item_ids").$type<string[]>().notNull(),
    playedItemIds: jsonb("played_item_ids").$type<string[]>().notNull().default([]),
    markedItemIds: jsonb("marked_item_ids").$type<string[]>().notNull().default([]),
    firstPassMarks: jsonb("first_pass_marks")
      .$type<Record<string, boolean>>()
      .notNull()
      .default({}),
    latestMarks: jsonb("latest_marks")
      .$type<Record<string, boolean>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    unique("dictation_sessions_family_child_id_unique").on(
      table.familyId,
      table.childId,
      table.id,
    ),
    unique("dictation_sessions_scope_task_unique").on(
      table.familyId,
      table.childId,
      table.taskId,
    ),
    unique("dictation_sessions_scope_id_task_unique").on(
      table.familyId,
      table.childId,
      table.id,
      table.taskId,
    ),
    foreignKey({
      name: "dictation_sessions_family_child_fk",
      columns: [table.familyId, table.childId],
      foreignColumns: [children.familyId, children.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "dictation_sessions_task_scope_fk",
      columns: [table.familyId, table.childId, table.taskId],
      foreignColumns: [learningTasks.familyId, learningTasks.childId, learningTasks.id],
    }).onDelete("cascade"),
    check("dictation_sessions_mode_check", sql`${table.mode} in ('continuous_batch', 'item_by_item')`),
    check("dictation_sessions_status_check", sql`${table.status} in ('active', 'completed', 'cancelled')`),
    check("dictation_sessions_phase_check", sql`${table.phase} in ('listening', 'grading', 'completed')`),
    check("dictation_sessions_version_check", sql`${table.version} >= 0`),
    check("dictation_sessions_round_check", sql`${table.roundNumber} >= 1`),
    check(
      "dictation_sessions_lifecycle_check",
      sql`(
        (${table.status} = 'active' and ${table.completedAt} is null and ${table.cancelledAt} is null and ${table.phase} <> 'completed') or
        (${table.status} = 'completed' and ${table.completedAt} is not null and ${table.cancelledAt} is null and ${table.phase} = 'completed') or
        (${table.status} = 'cancelled' and ${table.cancelledAt} is not null and ${table.completedAt} is null)
      )`,
    ),
    index("dictation_sessions_child_status_idx").on(table.familyId, table.childId, table.status),
  ],
);

export const dictationRounds = pgTable(
  "dictation_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id").notNull(),
    childId: uuid("child_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    roundNumber: integer("round_number").notNull(),
    itemIds: jsonb("item_ids").$type<string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    unique("dictation_rounds_scope_number_unique").on(table.sessionId, table.roundNumber),
    unique("dictation_rounds_full_scope_number_unique").on(
      table.familyId,
      table.childId,
      table.sessionId,
      table.roundNumber,
    ),
    foreignKey({
      name: "dictation_rounds_session_scope_fk",
      columns: [table.familyId, table.childId, table.sessionId],
      foreignColumns: [dictationSessions.familyId, dictationSessions.childId, dictationSessions.id],
    }).onDelete("cascade"),
    check("dictation_rounds_number_check", sql`${table.roundNumber} >= 1`),
  ],
);

export const dictationSessionItems = pgTable(
  "dictation_session_items",
  {
    familyId: uuid("family_id").notNull(),
    childId: uuid("child_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    taskItemId: uuid("task_item_id")
      .notNull()
      .references(() => learningTaskItems.id, { onDelete: "restrict" }),
    taskId: uuid("task_id").notNull(),
    cardId: uuid("card_id").notNull(),
    kind: text("kind").notNull(),
    position: integer("position").notNull(),
    firstCorrect: boolean("first_correct"),
    finalCorrect: boolean("final_correct").notNull().default(false),
    replayCount: integer("replay_count").notNull().default(0),
    firstReviewEventId: uuid("first_review_event_id").references(() => reviewEvents.id, {
      onDelete: "restrict",
    }),
  },
  (table) => [
    primaryKey({
      name: "dictation_session_items_pk",
      columns: [table.familyId, table.childId, table.sessionId, table.taskItemId],
    }),
    unique("dictation_session_items_session_task_item_unique").on(table.sessionId, table.taskItemId),
    foreignKey({
      name: "dictation_session_items_session_scope_fk",
      columns: [table.familyId, table.childId, table.sessionId],
      foreignColumns: [dictationSessions.familyId, dictationSessions.childId, dictationSessions.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "dictation_session_items_task_scope_fk",
      columns: [table.familyId, table.childId, table.taskId],
      foreignColumns: [learningTasks.familyId, learningTasks.childId, learningTasks.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "dictation_session_items_session_task_fk",
      columns: [table.familyId, table.childId, table.sessionId, table.taskId],
      foreignColumns: [
        dictationSessions.familyId,
        dictationSessions.childId,
        dictationSessions.id,
        dictationSessions.taskId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "dictation_session_items_task_item_scope_fk",
      columns: [table.familyId, table.childId, table.taskId, table.taskItemId],
      foreignColumns: [
        learningTaskItems.familyId,
        learningTaskItems.childId,
        learningTaskItems.taskId,
        learningTaskItems.id,
      ],
    }).onDelete("restrict"),
    check("dictation_session_items_kind_check", sql`${table.kind} in ('due_review', 'new', 'manual_review')`),
    check("dictation_session_items_position_check", sql`${table.position} >= 0`),
    check("dictation_session_items_replay_check", sql`${table.replayCount} >= 0`),
    check(
      "dictation_session_items_first_review_check",
      sql`(${table.firstCorrect} is null and ${table.firstReviewEventId} is null) or (${table.firstCorrect} is not null and ${table.firstReviewEventId} is not null)`,
    ),
  ],
);

export const dictationRoundItems = pgTable(
  "dictation_round_items",
  {
    familyId: uuid("family_id").notNull(),
    childId: uuid("child_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    roundNumber: integer("round_number").notNull(),
    taskItemId: uuid("task_item_id").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({
      name: "dictation_round_items_pk",
      columns: [
        table.familyId,
        table.childId,
        table.sessionId,
        table.roundNumber,
        table.taskItemId,
      ],
    }),
    unique("dictation_round_items_session_round_position_unique").on(
      table.sessionId,
      table.roundNumber,
      table.position,
    ),
    foreignKey({
      name: "dictation_round_items_round_scope_fk",
      columns: [table.familyId, table.childId, table.sessionId, table.roundNumber],
      foreignColumns: [
        dictationRounds.familyId,
        dictationRounds.childId,
        dictationRounds.sessionId,
        dictationRounds.roundNumber,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "dictation_round_items_session_item_scope_fk",
      columns: [table.familyId, table.childId, table.sessionId, table.taskItemId],
      foreignColumns: [
        dictationSessionItems.familyId,
        dictationSessionItems.childId,
        dictationSessionItems.sessionId,
        dictationSessionItems.taskItemId,
      ],
    }).onDelete("cascade"),
    check("dictation_round_items_round_check", sql`${table.roundNumber} >= 1`),
    check("dictation_round_items_position_check", sql`${table.position} >= 0`),
  ],
);

export const dictationCommands = pgTable(
  "dictation_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id").notNull(),
    childId: uuid("child_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    commandId: uuid("command_id").notNull(),
    commandType: text("command_type").notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    resultingVersion: integer("resulting_version").notNull(),
    resultSnapshot: jsonb("result_snapshot").$type<DictationSnapshot>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("dictation_commands_session_command_unique").on(table.sessionId, table.commandId),
    foreignKey({
      name: "dictation_commands_session_scope_fk",
      columns: [table.familyId, table.childId, table.sessionId],
      foreignColumns: [dictationSessions.familyId, dictationSessions.childId, dictationSessions.id],
    }).onDelete("cascade"),
    check("dictation_commands_type_check", sql`${table.commandType} in ('playback', 'grading')`),
    check("dictation_commands_fingerprint_check", sql`${table.inputFingerprint} ~ '^[0-9a-f]{64}$'`),
    check("dictation_commands_version_check", sql`${table.resultingVersion} >= 1`),
  ],
);

export const dictationPlaybackEvents = pgTable(
  "dictation_playback_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id").notNull(),
    childId: uuid("child_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    commandId: uuid("command_id").notNull(),
    roundNumber: integer("round_number").notNull(),
    taskItemId: uuid("task_item_id").notNull(),
    playedAt: timestamp("played_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("dictation_playback_command_item_unique").on(table.sessionId, table.commandId, table.taskItemId),
    foreignKey({
      name: "dictation_playback_item_scope_fk",
      columns: [table.familyId, table.childId, table.sessionId, table.taskItemId],
      foreignColumns: [
        dictationSessionItems.familyId,
        dictationSessionItems.childId,
        dictationSessionItems.sessionId,
        dictationSessionItems.taskItemId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "dictation_playback_round_item_fk",
      columns: [
        table.familyId,
        table.childId,
        table.sessionId,
        table.roundNumber,
        table.taskItemId,
      ],
      foreignColumns: [
        dictationRoundItems.familyId,
        dictationRoundItems.childId,
        dictationRoundItems.sessionId,
        dictationRoundItems.roundNumber,
        dictationRoundItems.taskItemId,
      ],
    }).onDelete("restrict"),
    check("dictation_playback_round_check", sql`${table.roundNumber} >= 1`),
    index("dictation_playback_session_idx").on(table.sessionId, table.roundNumber),
  ],
);

export const dictationAnswerEvents = pgTable(
  "dictation_answer_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id").notNull(),
    childId: uuid("child_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    commandId: uuid("command_id").notNull(),
    roundNumber: integer("round_number").notNull(),
    taskItemId: uuid("task_item_id").notNull(),
    correct: boolean("correct").notNull(),
    eventRole: text("event_role").notNull(),
    reviewEventId: uuid("review_event_id").references(() => reviewEvents.id, { onDelete: "restrict" }),
    replayCount: integer("replay_count").notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("dictation_answer_command_item_unique").on(table.sessionId, table.commandId, table.taskItemId),
    foreignKey({
      name: "dictation_answer_item_scope_fk",
      columns: [table.familyId, table.childId, table.sessionId, table.taskItemId],
      foreignColumns: [
        dictationSessionItems.familyId,
        dictationSessionItems.childId,
        dictationSessionItems.sessionId,
        dictationSessionItems.taskItemId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "dictation_answer_round_item_fk",
      columns: [
        table.familyId,
        table.childId,
        table.sessionId,
        table.roundNumber,
        table.taskItemId,
      ],
      foreignColumns: [
        dictationRoundItems.familyId,
        dictationRoundItems.childId,
        dictationRoundItems.sessionId,
        dictationRoundItems.roundNumber,
        dictationRoundItems.taskItemId,
      ],
    }).onDelete("restrict"),
    check("dictation_answer_round_check", sql`${table.roundNumber} >= 1`),
    check("dictation_answer_role_check", sql`${table.eventRole} in ('first_pass', 'continued_error', 'same_session_relearning')`),
    check("dictation_answer_replay_check", sql`${table.replayCount} >= 1`),
    check(
      "dictation_answer_review_shape_check",
      sql`(${table.eventRole} = 'continued_error' and ${table.reviewEventId} is null) or (${table.eventRole} <> 'continued_error' and ${table.reviewEventId} is not null)`,
    ),
    index("dictation_answer_session_idx").on(table.sessionId, table.roundNumber),
  ],
);

export const dictationCompletionEvents = pgTable(
  "dictation_completion_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id").notNull(),
    childId: uuid("child_id").notNull(),
    taskId: uuid("task_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    eventType: text("event_type").notNull().default("LearningTaskCompleted"),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("dictation_completion_session_unique").on(table.sessionId),
    unique("dictation_completion_task_unique").on(table.taskId),
    foreignKey({
      name: "dictation_completion_session_scope_fk",
      columns: [table.familyId, table.childId, table.sessionId],
      foreignColumns: [dictationSessions.familyId, dictationSessions.childId, dictationSessions.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "dictation_completion_task_scope_fk",
      columns: [table.familyId, table.childId, table.taskId],
      foreignColumns: [learningTasks.familyId, learningTasks.childId, learningTasks.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "dictation_completion_session_task_fk",
      columns: [table.familyId, table.childId, table.sessionId, table.taskId],
      foreignColumns: [
        dictationSessions.familyId,
        dictationSessions.childId,
        dictationSessions.id,
        dictationSessions.taskId,
      ],
    }).onDelete("cascade"),
    check("dictation_completion_type_check", sql`${table.eventType} = 'LearningTaskCompleted'`),
  ],
);
