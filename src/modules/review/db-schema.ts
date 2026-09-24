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
import { learningCards } from "@/modules/learning-content/schema";

export const childCardStates = pgTable(
  "child_card_states",
  {
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    childId: uuid("child_id").notNull(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => learningCards.id, { onDelete: "cascade" }),
    cardJson: jsonb("card_json").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "child_card_states_family_child_card_pk",
      columns: [table.familyId, table.childId, table.cardId],
    }),
    foreignKey({
      name: "child_card_states_family_child_fk",
      columns: [table.familyId, table.childId],
      foreignColumns: [children.familyId, children.id],
    }).onDelete("cascade"),
    index("child_card_states_due_idx").on(table.familyId, table.childId, table.dueAt),
  ],
);

export const reviewEvents = pgTable(
  "review_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    childId: uuid("child_id").notNull(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => learningCards.id, { onDelete: "restrict" }),
    eventType: text("event_type").notNull(),
    correct: boolean("correct").notNull(),
    fsrsRating: integer("fsrs_rating").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    cardJson: jsonb("card_json").notNull(),
    sourceReviewEventId: uuid("source_review_event_id"),
    commandId: uuid("command_id").notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "review_events_family_child_fk",
      columns: [table.familyId, table.childId],
      foreignColumns: [children.familyId, children.id],
    }).onDelete("cascade"),
    unique("review_events_scope_id_unique").on(
      table.familyId,
      table.childId,
      table.cardId,
      table.id,
    ),
    uniqueIndex("review_events_scope_command_unique").on(
      table.familyId,
      table.childId,
      table.commandId,
    ),
    uniqueIndex("review_events_source_once_unique")
      .on(table.sourceReviewEventId)
      .where(sql`${table.sourceReviewEventId} is not null`),
    foreignKey({
      name: "review_events_source_scope_fk",
      columns: [
        table.familyId,
        table.childId,
        table.cardId,
        table.sourceReviewEventId,
      ],
      foreignColumns: [table.familyId, table.childId, table.cardId, table.id],
    }).onDelete("restrict"),
    check(
      "review_events_type_check",
      sql`${table.eventType} in ('new_first', 'scheduled_first', 'manual_first', 'same_session_relearning')`,
    ),
    check(
      "review_events_rating_check",
      sql`${table.fsrsRating} in (1, 3)`,
    ),
    check(
      "review_events_relearning_source_check",
      sql`(
        (${table.eventType} = 'same_session_relearning' and ${table.sourceReviewEventId} is not null)
        or
        (${table.eventType} <> 'same_session_relearning' and ${table.sourceReviewEventId} is null)
      )`,
    ),
    check(
      "review_events_relearning_shape_check",
      sql`${table.eventType} <> 'same_session_relearning' or (${table.correct} = true and ${table.fsrsRating} = 3)`,
    ),
    check(
      "review_events_input_fingerprint_check",
      sql`${table.inputFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    index("review_events_child_reviewed_idx").on(
      table.familyId,
      table.childId,
      table.reviewedAt,
    ),
    index("review_events_card_idx").on(table.familyId, table.childId, table.cardId),
  ],
);
