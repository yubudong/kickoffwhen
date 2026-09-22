import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { children, families } from "@/modules/families/schema";

export const privateMedia = pgTable(
  "private_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    childId: uuid("child_id"),
    kind: text("kind").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    relativePath: text("relative_path").notNull(),
    dedupeKey: text("dedupe_key"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "private_media_family_child_fk",
      columns: [table.familyId, table.childId],
      foreignColumns: [children.familyId, children.id],
    }).onDelete("cascade"),
    uniqueIndex("private_media_relative_path_unique").on(table.relativePath),
    unique("private_media_family_child_id_unique").on(
      table.familyId,
      table.childId,
      table.id,
    ),
    uniqueIndex("private_media_dedupe_key_unique")
      .on(table.dedupeKey)
      .where(sql`${table.dedupeKey} is not null`),
    index("private_media_family_id_idx").on(table.familyId),
    index("private_media_family_child_idx").on(table.familyId, table.childId),
    index("private_media_expires_at_idx").on(table.expiresAt),
    check(
      "private_media_kind_check",
      sql`${table.kind} in ('tts_audio', 'ocr_source', 'habit_photo')`,
    ),
    check(
      "private_media_mime_type_check",
      sql`${table.mimeType} in ('audio/mpeg', 'image/jpeg', 'image/png')`,
    ),
    check(
      "private_media_kind_mime_check",
      sql`(
        (${table.kind} = 'tts_audio' and ${table.mimeType} = 'audio/mpeg')
        or
        (${table.kind} in ('ocr_source', 'habit_photo') and ${table.mimeType} in ('image/jpeg', 'image/png'))
      )`,
    ),
    check(
      "private_media_tts_child_check",
      sql`${table.kind} <> 'tts_audio' or ${table.childId} is not null`,
    ),
    check(
      "private_media_byte_size_check",
      sql`${table.byteSize} > 0 and ${table.byteSize} <= 10485760`,
    ),
    check(
      "private_media_sha256_check",
      sql`${table.sha256} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
