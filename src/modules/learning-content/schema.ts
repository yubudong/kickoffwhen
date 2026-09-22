import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { families, guardians } from "@/modules/families/schema";

export const textbookEditions = pgTable(
  "textbook_editions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publisher: text("publisher").notNull(),
    series: text("series").notNull(),
    subject: text("subject").notNull(),
    grade: integer("grade").notNull(),
    volume: text("volume").notNull(),
    editionText: text("edition_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "textbook_editions_subject_check",
      sql`${table.subject} in ('chinese', 'english')`,
    ),
    uniqueIndex("textbook_editions_edition_unique").on(
      table.publisher,
      table.series,
      table.subject,
      table.grade,
      table.volume,
      table.editionText,
    ),
  ],
);

export const textbookUnits = pgTable(
  "textbook_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    textbookEditionId: uuid("textbook_edition_id")
      .notNull()
      .references(() => textbookEditions.id, { onDelete: "cascade" }),
    unitOrder: integer("unit_order").notNull(),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("textbook_units_edition_id_order_unique").on(
      table.textbookEditionId,
      table.unitOrder,
    ),
  ],
);

export const textbookSections = pgTable(
  "textbook_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unitId: uuid("unit_id").notNull().references(() => textbookUnits.id, { onDelete: "cascade" }),
    sectionKey: text("section_key").notNull(),
    sectionOrder: integer("section_order").notNull(),
    title: text("title").notNull(),
    sectionType: text("section_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("textbook_sections_type_check", sql`${table.sectionType} in ('lesson', 'language_garden', 'other')`),
    unique("textbook_sections_unit_key_unique").on(table.unitId, table.sectionKey),
    unique("textbook_sections_unit_order_unique").on(table.unitId, table.sectionOrder),
  ],
);

export const learningCards = pgTable(
  "learning_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id").references(() => families.id, {
      onDelete: "cascade",
    }),
    subject: text("subject").notNull(),
    answerText: text("answer_text").notNull(),
    broadcastText: text("broadcast_text").notNull(),
    hintText: text("hint_text"),
    pinyinText: text("pinyin_text"),
    curriculumSource: text("curriculum_source"),
    sourceOrder: integer("source_order"),
    textbookEditionId: uuid("textbook_edition_id").references(
      () => textbookEditions.id,
      { onDelete: "set null" },
    ),
    unitId: uuid("unit_id").references(() => textbookUnits.id, {
      onDelete: "set null",
    }),
    sectionId: uuid("section_id").references(() => textbookSections.id, { onDelete: "set null" }),
    source: text("source").notNull(),
    builtinKey: text("builtin_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "learning_cards_subject_check",
      sql`${table.subject} in ('chinese', 'english')`,
    ),
    check(
      "learning_cards_source_check",
      sql`${table.source} in ('manual', 'bulk', 'ocr', 'builtin')`,
    ),
    check("learning_cards_curriculum_source_check", sql`${table.curriculumSource} is null or ${table.curriculumSource} in ('required_vocabulary', 'writing_practice')`),
    check(
      "learning_cards_builtin_scope_check",
      sql`(
        (${table.source} = 'builtin' and ${table.familyId} is null and ${table.builtinKey} is not null)
        or
        (${table.source} <> 'builtin' and ${table.familyId} is not null and ${table.builtinKey} is null)
      )`,
    ),
    uniqueIndex("learning_cards_builtin_key_unique")
      .on(table.builtinKey)
      .where(sql`${table.builtinKey} is not null`),
    unique("learning_cards_family_id_id_unique").on(table.familyId, table.id),
    index("learning_cards_family_id_idx").on(table.familyId),
    index("learning_cards_family_subject_idx").on(table.familyId, table.subject),
    index("learning_cards_unit_id_idx").on(table.unitId),
    index("learning_cards_section_id_idx").on(table.sectionId),
  ],
);

export const ocrDrafts = pgTable(
  "ocr_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id").notNull(),
    guardianId: uuid("guardian_id").notNull(),
    subject: text("subject").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "ocr_drafts_subject_check",
      sql`${table.subject} in ('chinese', 'english')`,
    ),
    unique("ocr_drafts_family_id_id_unique").on(table.familyId, table.id),
    foreignKey({
      name: "ocr_drafts_family_guardian_fk",
      columns: [table.familyId, table.guardianId],
      foreignColumns: [guardians.familyId, guardians.id],
    }).onDelete("cascade"),
    index("ocr_drafts_family_id_idx").on(table.familyId),
  ],
);

export const ocrDraftLines = pgTable(
  "ocr_draft_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id").notNull(),
    draftId: uuid("draft_id").notNull(),
    sourceText: text("source_text").notNull(),
    sourceOrder: integer("source_order").notNull(),
    status: text("status").notNull().default("draft"),
    confirmedCardId: uuid("confirmed_card_id").references(
      () => learningCards.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "ocr_draft_lines_status_check",
      sql`${table.status} in ('draft', 'confirmed', 'rejected')`,
    ),
    foreignKey({
      name: "ocr_draft_lines_family_draft_fk",
      columns: [table.familyId, table.draftId],
      foreignColumns: [ocrDrafts.familyId, ocrDrafts.id],
    }).onDelete("cascade"),
    unique("ocr_draft_lines_draft_id_order_unique").on(
      table.draftId,
      table.sourceOrder,
    ),
    index("ocr_draft_lines_family_id_idx").on(table.familyId),
    index("ocr_draft_lines_draft_id_idx").on(table.draftId),
    index("ocr_draft_lines_status_idx").on(table.status),
  ],
);
