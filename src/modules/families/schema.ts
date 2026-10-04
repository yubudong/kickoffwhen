import {
  boolean,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { user as authUsers } from "@/modules/auth/schema";

export const families = pgTable("families", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const guardians = pgTable(
  "guardians",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    authUserId: text("auth_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "restrict" }),
    displayName: text("display_name").notNull().default("家长"),
    isOwner: boolean("is_owner").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("guardians_auth_user_unique").on(table.authUserId),
    uniqueIndex("guardians_one_owner_per_family_unique")
      .on(table.familyId)
      .where(sql`${table.isOwner} = true`),
    unique("guardians_family_id_id_unique").on(table.familyId, table.id),
  ],
);

export const children = pgTable(
  "children",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    nickname: text("nickname").notNull(),
    avatarKey: text("avatar_key").notNull().default("child-1"),
    grade: integer("grade").notNull(),
    textbookEditionIds: text("textbook_edition_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    childPinHash: text("child_pin_hash"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("children_family_id_id_unique").on(table.familyId, table.id),
  ],
);

export const parentPins = pgTable(
  "parent_pins",
  {
    guardianId: uuid("guardian_id")
      .primaryKey()
      .references(() => guardians.id, { onDelete: "cascade" }),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    pinHash: text("pin_hash").notNull(),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "parent_pins_family_id_guardian_id_guardians_family_id_id_fk",
      columns: [table.familyId, table.guardianId],
      foreignColumns: [guardians.familyId, guardians.id],
    }).onDelete("cascade"),
  ],
);
