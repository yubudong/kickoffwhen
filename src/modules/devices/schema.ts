import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { children, families, guardians } from "@/modules/families/schema";

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    tokenHash: text("token_hash").notNull(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("devices_token_hash_unique").on(table.tokenHash),
    unique("devices_family_id_id_unique").on(table.familyId, table.id),
    index("devices_family_id_idx").on(table.familyId),
  ],
);

export const pairingCodes = pgTable(
  "pairing_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    childIds: uuid("child_ids").array().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pairing_codes_code_hash_unique").on(table.codeHash),
    unique("pairing_codes_family_id_id_unique").on(table.familyId, table.id),
    index("pairing_codes_family_id_idx").on(table.familyId),
    index("pairing_codes_claimable_idx")
      .on(table.expiresAt)
      .where(sql`${table.claimedAt} is null`),
  ],
);

export const pairingCodeChildAccess = pgTable(
  "pairing_code_child_access",
  {
    pairingCodeId: uuid("pairing_code_id").notNull(),
    familyId: uuid("family_id").notNull(),
    childId: uuid("child_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "pairing_code_child_access_pairing_code_id_child_id_pk",
      columns: [table.pairingCodeId, table.childId],
    }),
    foreignKey({
      name: "pairing_code_child_access_family_pairing_code_fk",
      columns: [table.familyId, table.pairingCodeId],
      foreignColumns: [pairingCodes.familyId, pairingCodes.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "pairing_code_child_access_family_child_fk",
      columns: [table.familyId, table.childId],
      foreignColumns: [children.familyId, children.id],
    }).onDelete("cascade"),
    index("pairing_code_child_access_family_id_idx").on(table.familyId),
    index("pairing_code_child_access_child_id_idx").on(table.childId),
  ],
);

export const deviceChildAccess = pgTable(
  "device_child_access",
  {
    deviceId: uuid("device_id").notNull(),
    familyId: uuid("family_id").notNull(),
    childId: uuid("child_id").notNull(),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "device_child_access_device_id_child_id_pk",
      columns: [table.deviceId, table.childId],
    }),
    foreignKey({
      name: "device_child_access_family_device_fk",
      columns: [table.familyId, table.deviceId],
      foreignColumns: [devices.familyId, devices.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "device_child_access_family_child_fk",
      columns: [table.familyId, table.childId],
      foreignColumns: [children.familyId, children.id],
    }).onDelete("cascade"),
    unique("device_child_access_family_device_child_unique").on(
      table.familyId,
      table.deviceId,
      table.childId,
    ),
    index("device_child_access_family_id_idx").on(table.familyId),
    index("device_child_access_child_id_idx").on(table.childId),
  ],
);

export const pairingRateLimits = pgTable(
  "pairing_rate_limits",
  {
    keyHash: text("key_hash").primaryKey(),
    attemptCount: integer("attempt_count").notNull(),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("pairing_rate_limits_window_started_at_idx").on(
      table.windowStartedAt,
    ),
  ],
);

export const childSessions = pgTable(
  "child_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    childId: uuid("child_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("child_sessions_token_hash_unique").on(table.tokenHash),
    foreignKey({
      name: "child_sessions_family_device_fk",
      columns: [table.familyId, table.deviceId],
      foreignColumns: [devices.familyId, devices.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "child_sessions_family_child_fk",
      columns: [table.familyId, table.childId],
      foreignColumns: [children.familyId, children.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "child_sessions_family_device_child_access_fk",
      columns: [table.familyId, table.deviceId, table.childId],
      foreignColumns: [
        deviceChildAccess.familyId,
        deviceChildAccess.deviceId,
        deviceChildAccess.childId,
      ],
    }).onDelete("cascade"),
    index("child_sessions_device_id_idx").on(table.deviceId),
    index("child_sessions_child_id_idx").on(table.childId),
  ],
);

export const parentModeUnlocks = pgTable(
  "parent_mode_unlocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    familyId: uuid("family_id").notNull(),
    guardianId: uuid("guardian_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("parent_mode_unlocks_token_hash_unique").on(table.tokenHash),
    foreignKey({
      name: "parent_mode_unlocks_family_device_fk",
      columns: [table.familyId, table.deviceId],
      foreignColumns: [devices.familyId, devices.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "parent_mode_unlocks_family_guardian_fk",
      columns: [table.familyId, table.guardianId],
      foreignColumns: [guardians.familyId, guardians.id],
    }).onDelete("cascade"),
    index("parent_mode_unlocks_device_id_idx").on(table.deviceId),
    index("parent_mode_unlocks_expires_at_idx").on(table.expiresAt),
  ],
);
