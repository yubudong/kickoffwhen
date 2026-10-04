import {
  and,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { db, type DbTransaction } from "@/db/client";
import type { ChildActor, FamilyOwnerActor } from "@/modules/auth/actor";
import { verifyPinHash } from "@/modules/auth/parent-pin";
import { children } from "@/modules/families/schema";

import {
  childSessions,
  deviceChildAccess,
  devices,
  pairingCodeChildAccess,
  pairingCodes,
  pairingRateLimits,
} from "./schema";
import {
  CHILD_SESSION_COOKIE,
  createOpaqueToken,
  hashOpaqueToken,
  readCookie,
} from "./token";

const PAIRING_LIFETIME_MS = 10 * 60 * 1000;
const PAIRING_RATE_WINDOW_MS = 15 * 60 * 1000;
const PAIRING_RATE_RETENTION_BATCH = 100;
const PAIRING_ADDRESS_LIMIT = 20;
const PAIRING_CODE_LIMIT = 10;
const CHILD_PIN_LOCK_MS = 15 * 60 * 1000;
const CHILD_PIN_FAILURE_LIMIT = 5;
const ACTIVITY_WRITE_INTERVAL_MS = 5 * 60 * 1000;

const childIdsSchema = z
  .array(z.string().uuid())
  .min(1)
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length);
const pairingCodeSchema = z.string().trim().min(8).max(64).transform((code) => code.toUpperCase());
const deviceLabelSchema = z.string().trim().min(1).max(80);
const childIdSchema = z.string().uuid();
const childPinSchema = z.string().regex(/^\d{6}$/);
const clientAddressSchema = z.string().trim().min(1).max(128);

type DeviceDatabase = typeof db | DbTransaction;

type DeviceDependencies = {
  createOpaqueToken: () => string;
  hashOpaqueToken: (token: string) => string;
  now: () => Date;
  verifyPinHash: (hash: string, pin: string) => Promise<boolean>;
};

export type AuthorizedChild = {
  id: string;
  nickname: string;
  avatarKey: string;
  requiresPin: boolean;
};

export type FamilyDevice = {
  id: string;
  label: string;
  lastActiveAt: Date;
  revokedAt: Date | null;
  children: Array<{ id: string; nickname: string }>;
};

function invalidChildSession(): never {
  throw new Error("CHILD_SESSION_INVALID");
}

export function createDeviceService(
  database: DeviceDatabase = db,
  overrides: Partial<DeviceDependencies> = {},
) {
  const dependencies: DeviceDependencies = {
    createOpaqueToken,
    hashOpaqueToken,
    now: () => new Date(),
    verifyPinHash,
    ...overrides,
  };

  async function createPairingCode(
    actor: FamilyOwnerActor,
    childIds: string[],
    now = dependencies.now(),
  ): Promise<{ code: string; expiresAt: Date }> {
    const parsedChildIds = childIdsSchema.safeParse(childIds);
    if (!parsedChildIds.success) throw new Error("INVALID_CHILD_ACCESS");

    const code = dependencies.createOpaqueToken().slice(0, 12).toUpperCase();
    const expiresAt = new Date(now.getTime() + PAIRING_LIFETIME_MS);
    await database.transaction(async (tx) => {
      const authorized = await tx
        .select({ id: children.id })
        .from(children)
        .where(
          and(
            eq(children.familyId, actor.familyId),
            eq(children.active, true),
            inArray(children.id, parsedChildIds.data),
          ),
        );
      if (authorized.length !== parsedChildIds.data.length) {
        throw new Error("INVALID_CHILD_ACCESS");
      }

      const [pairingCode] = await tx
        .insert(pairingCodes)
        .values({
          familyId: actor.familyId,
          codeHash: dependencies.hashOpaqueToken(code),
          childIds: parsedChildIds.data,
          expiresAt,
          createdAt: now,
        })
        .returning({ id: pairingCodes.id });
      await tx.insert(pairingCodeChildAccess).values(
        parsedChildIds.data.map((childId) => ({
          pairingCodeId: pairingCode.id,
          familyId: actor.familyId,
          childId,
          createdAt: now,
        })),
      );
    });
    return { code, expiresAt };
  }

  async function claimPairingCode(
    code: string,
    label: string,
    clientAddress = `internal:${dependencies.hashOpaqueToken(`${code}:${label}`)}`,
  ): Promise<{ rawDeviceToken: string; deviceId: string }> {
    const normalizedCode = code.trim().toUpperCase();
    const parsedCode = pairingCodeSchema.safeParse(normalizedCode);
    const parsedLabel = deviceLabelSchema.safeParse(label);
    const parsedClientAddress = clientAddressSchema.safeParse(clientAddress);
    const normalizedClientAddress = parsedClientAddress.success
      ? parsedClientAddress.data.toLowerCase()
      : "unknown";
    const now = dependencies.now();

    const result = await database.transaction(async (tx) => {
      const resetBefore = new Date(now.getTime() - PAIRING_RATE_WINDOW_MS);
      await tx.execute(sql`
        with expired as (
          select ${pairingRateLimits.keyHash}
          from ${pairingRateLimits}
          where ${pairingRateLimits.windowStartedAt} <= ${resetBefore}
          order by ${pairingRateLimits.windowStartedAt}, ${pairingRateLimits.keyHash}
          limit ${PAIRING_RATE_RETENTION_BATCH}
          for update skip locked
        )
        delete from ${pairingRateLimits}
        using expired
        where ${pairingRateLimits.keyHash} = expired.key_hash
      `);

      async function consumeLimit(keyHash: string, limit: number) {
        const [state] = await tx
          .insert(pairingRateLimits)
          .values({
            keyHash,
            attemptCount: 1,
            windowStartedAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: pairingRateLimits.keyHash,
            set: {
              attemptCount: sql`case
                when ${pairingRateLimits.windowStartedAt} <= ${resetBefore}
                  then 1
                else ${pairingRateLimits.attemptCount} + 1
              end`,
              windowStartedAt: sql`case
                when ${pairingRateLimits.windowStartedAt} <= ${resetBefore}
                  then ${now}
                else ${pairingRateLimits.windowStartedAt}
              end`,
              updatedAt: now,
            },
          })
          .returning({ attemptCount: pairingRateLimits.attemptCount });
        return state.attemptCount <= limit;
      }

      const addressAllowed = await consumeLimit(
        dependencies.hashOpaqueToken(
          `pairing-address:${normalizedClientAddress}`,
        ),
        PAIRING_ADDRESS_LIMIT,
      );
      if (!addressAllowed) return { status: "limited" as const };

      const codeAllowed = await consumeLimit(
        dependencies.hashOpaqueToken(`pairing-code:${normalizedCode}`),
        PAIRING_CODE_LIMIT,
      );
      if (!codeAllowed) return { status: "limited" as const };
      if (!parsedCode.success || !parsedLabel.success) {
        return { status: "invalid" as const };
      }

      try {
        const claimedDevice = await tx.transaction(async (claimTx) => {
          const [claimed] = await claimTx
            .update(pairingCodes)
            .set({ claimedAt: now })
            .where(
              and(
                eq(
                  pairingCodes.codeHash,
                  dependencies.hashOpaqueToken(parsedCode.data),
                ),
                isNull(pairingCodes.claimedAt),
                gt(pairingCodes.expiresAt, now),
              ),
            )
            .returning({
              id: pairingCodes.id,
              familyId: pairingCodes.familyId,
            });
          if (!claimed) throw new Error("PAIRING_CODE_INVALID");

          const activeChildren = await claimTx
            .select({ id: children.id, active: children.active })
            .from(pairingCodeChildAccess)
            .innerJoin(
              children,
              and(
                eq(children.id, pairingCodeChildAccess.childId),
                eq(children.familyId, pairingCodeChildAccess.familyId),
              ),
            )
            .where(
              and(
                eq(pairingCodeChildAccess.pairingCodeId, claimed.id),
                eq(pairingCodeChildAccess.familyId, claimed.familyId),
                eq(children.familyId, claimed.familyId),
              ),
            );
          if (
            activeChildren.length === 0 ||
            activeChildren.some((child) => !child.active)
          ) {
            throw new Error("PAIRING_CODE_INVALID");
          }

          const rawDeviceToken = dependencies.createOpaqueToken();
          const [device] = await claimTx
            .insert(devices)
            .values({
              familyId: claimed.familyId,
              label: parsedLabel.data,
              tokenHash: dependencies.hashOpaqueToken(rawDeviceToken),
              lastActiveAt: now,
              createdAt: now,
            })
            .returning({ id: devices.id });
          await claimTx.insert(deviceChildAccess).values(
            activeChildren.map(({ id: childId }) => ({
              deviceId: device.id,
              familyId: claimed.familyId,
              childId,
              createdAt: now,
            })),
          );
          return { rawDeviceToken, deviceId: device.id };
        });
        return { status: "claimed" as const, claimedDevice };
      } catch (error) {
        if (error instanceof Error && error.message === "PAIRING_CODE_INVALID") {
          return { status: "invalid" as const };
        }
        throw error;
      }
    });
    if (result.status === "limited") throw new Error("PAIRING_RATE_LIMITED");
    if (result.status === "invalid") throw new Error("PAIRING_CODE_INVALID");
    return result.claimedDevice;
  }

  async function selectChild(
    rawDeviceToken: string,
    childId: string,
    childPin?: string,
  ): Promise<{ rawChildSessionToken: string }> {
    const parsedChildId = childIdSchema.safeParse(childId);
    if (!rawDeviceToken || !parsedChildId.success) {
      throw new Error("CHILD_ACCESS_DENIED");
    }
    const now = dependencies.now();

    const result = await database.transaction(async (tx) => {
      const [device] = await tx
        .select({ id: devices.id, familyId: devices.familyId })
        .from(devices)
        .where(
          and(
            eq(
              devices.tokenHash,
              dependencies.hashOpaqueToken(rawDeviceToken),
            ),
            isNull(devices.revokedAt),
          ),
        )
        .limit(1)
        .for("update");
      if (!device) throw new Error("DEVICE_INVALID");

      const [authorized] = await tx
        .select({
          childPinHash: children.childPinHash,
          failedAttempts: deviceChildAccess.failedAttempts,
          lockedUntil: deviceChildAccess.lockedUntil,
        })
        .from(deviceChildAccess)
        .innerJoin(
          children,
          and(
            eq(children.id, deviceChildAccess.childId),
            eq(children.familyId, deviceChildAccess.familyId),
          ),
        )
        .where(
          and(
            eq(deviceChildAccess.deviceId, device.id),
            eq(deviceChildAccess.familyId, device.familyId),
            eq(deviceChildAccess.childId, parsedChildId.data),
            eq(children.active, true),
          ),
        )
        .limit(1);
      if (!authorized) throw new Error("CHILD_ACCESS_DENIED");

      if (authorized.childPinHash) {
        if (!childPin) throw new Error("CHILD_PIN_REQUIRED");
        if (authorized.lockedUntil && authorized.lockedUntil > now) {
          return { status: "pin-invalid" as const };
        }
        const parsedPin = childPinSchema.safeParse(childPin);
        if (
          !parsedPin.success ||
          !(await dependencies.verifyPinHash(
            authorized.childPinHash,
            parsedPin.data,
          ))
        ) {
          const previousFailures =
            authorized.lockedUntil && authorized.lockedUntil <= now
              ? 0
              : authorized.failedAttempts;
          const failedAttempts = previousFailures + 1;
          await tx
            .update(deviceChildAccess)
            .set({
              failedAttempts,
              lockedUntil:
                failedAttempts >= CHILD_PIN_FAILURE_LIMIT
                  ? new Date(now.getTime() + CHILD_PIN_LOCK_MS)
                  : null,
            })
            .where(
              and(
                eq(deviceChildAccess.deviceId, device.id),
                eq(deviceChildAccess.familyId, device.familyId),
                eq(deviceChildAccess.childId, parsedChildId.data),
              ),
            );
          return { status: "pin-invalid" as const };
        }
        await tx
          .update(deviceChildAccess)
          .set({ failedAttempts: 0, lockedUntil: null })
          .where(
            and(
              eq(deviceChildAccess.deviceId, device.id),
              eq(deviceChildAccess.familyId, device.familyId),
              eq(deviceChildAccess.childId, parsedChildId.data),
            ),
          );
      }

      await tx
        .update(childSessions)
        .set({ revokedAt: now })
        .where(
          and(
            eq(childSessions.deviceId, device.id),
            isNull(childSessions.revokedAt),
          ),
        );
      const rawChildSessionToken = dependencies.createOpaqueToken();
      await tx.insert(childSessions).values({
        familyId: device.familyId,
        deviceId: device.id,
        childId: parsedChildId.data,
        tokenHash: dependencies.hashOpaqueToken(rawChildSessionToken),
        lastActiveAt: now,
        createdAt: now,
      });
      await tx
        .update(devices)
        .set({ lastActiveAt: now })
        .where(eq(devices.id, device.id));
      return { status: "selected" as const, rawChildSessionToken };
    });
    if (result.status === "pin-invalid") throw new Error("CHILD_PIN_INVALID");
    return { rawChildSessionToken: result.rawChildSessionToken };
  }

  async function setDeviceChildAccess(
    actor: FamilyOwnerActor,
    deviceId: string,
    childIds: string[],
  ): Promise<void> {
    const parsedDeviceId = z.string().uuid().safeParse(deviceId);
    const parsedChildIds = childIdsSchema.safeParse(childIds);
    if (!parsedDeviceId.success) throw new Error("DEVICE_NOT_FOUND");
    if (!parsedChildIds.success) throw new Error("INVALID_CHILD_ACCESS");
    const now = dependencies.now();

    await database.transaction(async (tx) => {
      const [device] = await tx
        .select({ id: devices.id, familyId: devices.familyId })
        .from(devices)
        .where(
          and(
            eq(devices.id, parsedDeviceId.data),
            eq(devices.familyId, actor.familyId),
            isNull(devices.revokedAt),
          ),
        )
        .limit(1)
        .for("update");
      if (!device) throw new Error("DEVICE_NOT_FOUND");

      const authorizedChildren = await tx
        .select({ id: children.id })
        .from(children)
        .where(
          and(
            eq(children.familyId, actor.familyId),
            eq(children.active, true),
            inArray(children.id, parsedChildIds.data),
          ),
        )
        .orderBy(children.id)
        .for("share");
      if (authorizedChildren.length !== parsedChildIds.data.length) {
        throw new Error("INVALID_CHILD_ACCESS");
      }

      const existing = await tx
        .select({ childId: deviceChildAccess.childId })
        .from(deviceChildAccess)
        .where(
          and(
            eq(deviceChildAccess.deviceId, device.id),
            eq(deviceChildAccess.familyId, device.familyId),
          ),
        );
      const requested = new Set(parsedChildIds.data);
      const existingIds = new Set(existing.map((access) => access.childId));
      const removedIds = existing
        .map((access) => access.childId)
        .filter((childId) => !requested.has(childId));
      const addedIds = parsedChildIds.data.filter(
        (childId) => !existingIds.has(childId),
      );

      if (removedIds.length > 0) {
        await tx
          .delete(deviceChildAccess)
          .where(
            and(
              eq(deviceChildAccess.deviceId, device.id),
              eq(deviceChildAccess.familyId, device.familyId),
              inArray(deviceChildAccess.childId, removedIds),
            ),
          );
      }
      if (addedIds.length > 0) {
        await tx.insert(deviceChildAccess).values(
          addedIds.map((childId) => ({
            deviceId: device.id,
            familyId: device.familyId,
            childId,
            createdAt: now,
          })),
        );
      }
    });
  }

  async function actorFromChildSessionToken(
    rawChildSessionToken: string,
  ): Promise<ChildActor> {
    if (!rawChildSessionToken) invalidChildSession();
    const tokenHash = dependencies.hashOpaqueToken(rawChildSessionToken);
    const now = dependencies.now();

    const candidate = await database.transaction(async (tx) => {
      const [candidate] = await tx
        .select({
          id: childSessions.id,
          familyId: childSessions.familyId,
          deviceId: childSessions.deviceId,
          childId: childSessions.childId,
        })
        .from(childSessions)
        .innerJoin(
          devices,
          and(
            eq(devices.id, childSessions.deviceId),
            eq(devices.familyId, childSessions.familyId),
          ),
        )
        .innerJoin(
          deviceChildAccess,
          and(
            eq(deviceChildAccess.deviceId, childSessions.deviceId),
            eq(deviceChildAccess.familyId, childSessions.familyId),
            eq(deviceChildAccess.childId, childSessions.childId),
          ),
        )
        .innerJoin(
          children,
          and(
            eq(children.id, childSessions.childId),
            eq(children.familyId, childSessions.familyId),
          ),
        )
        .where(
          and(
            eq(childSessions.tokenHash, tokenHash),
            isNull(childSessions.revokedAt),
            isNull(devices.revokedAt),
            eq(children.active, true),
          ),
        )
        .limit(1);
      if (!candidate) invalidChildSession();

      const writeBefore = new Date(
        now.getTime() - ACTIVITY_WRITE_INTERVAL_MS,
      );
      await tx
        .update(devices)
        .set({ lastActiveAt: now })
        .where(
          and(
            eq(devices.id, candidate.deviceId),
            eq(devices.familyId, candidate.familyId),
            isNull(devices.revokedAt),
            lt(devices.lastActiveAt, writeBefore),
          ),
        );
      await tx
        .update(childSessions)
        .set({ lastActiveAt: now })
        .where(
          and(
            eq(childSessions.id, candidate.id),
            isNull(childSessions.revokedAt),
            lt(childSessions.lastActiveAt, writeBefore),
          ),
        );

      return candidate;
    });

    return database.transaction(async (tx) => {
      const [lockedDevice] = await tx
        .select({ id: devices.id })
        .from(devices)
        .where(
          and(
            eq(devices.id, candidate.deviceId),
            eq(devices.familyId, candidate.familyId),
            isNull(devices.revokedAt),
          ),
        )
        .limit(1)
        .for("share");
      if (!lockedDevice) invalidChildSession();

      const [lockedAccess] = await tx
        .select({ deviceId: deviceChildAccess.deviceId })
        .from(deviceChildAccess)
        .where(
          and(
            eq(deviceChildAccess.deviceId, candidate.deviceId),
            eq(deviceChildAccess.familyId, candidate.familyId),
            eq(deviceChildAccess.childId, candidate.childId),
          ),
        )
        .limit(1)
        .for("share");
      if (!lockedAccess) invalidChildSession();

      const [lockedChild] = await tx
        .select({ id: children.id })
        .from(children)
        .where(
          and(
            eq(children.id, candidate.childId),
            eq(children.familyId, candidate.familyId),
            eq(children.active, true),
          ),
        )
        .limit(1)
        .for("share");
      if (!lockedChild) invalidChildSession();

      const [lockedSession] = await tx
        .select({ id: childSessions.id })
        .from(childSessions)
        .where(
          and(
            eq(childSessions.id, candidate.id),
            eq(childSessions.familyId, candidate.familyId),
            eq(childSessions.deviceId, candidate.deviceId),
            eq(childSessions.childId, candidate.childId),
            eq(childSessions.tokenHash, tokenHash),
            isNull(childSessions.revokedAt),
          ),
        )
        .limit(1)
        .for("share");
      if (!lockedSession) invalidChildSession();

      return {
        role: "child",
        familyId: candidate.familyId,
        childId: candidate.childId,
        deviceId: candidate.deviceId,
      };
    });
  }

  async function deactivateChild(
    actor: FamilyOwnerActor,
    childId: string,
  ): Promise<void> {
    const parsedChildId = childIdSchema.safeParse(childId);
    if (!parsedChildId.success) throw new Error("CHILD_NOT_FOUND");
    const now = dependencies.now();

    await database.transaction(async (tx) => {
      await tx
        .select({ id: devices.id })
        .from(devices)
        .innerJoin(
          deviceChildAccess,
          and(
            eq(deviceChildAccess.deviceId, devices.id),
            eq(deviceChildAccess.familyId, devices.familyId),
          ),
        )
        .where(
          and(
            eq(deviceChildAccess.familyId, actor.familyId),
            eq(deviceChildAccess.childId, parsedChildId.data),
          ),
        )
        .orderBy(devices.id)
        .for("update", { of: devices });

      const [deactivated] = await tx
        .update(children)
        .set({ active: false })
        .where(
          and(
            eq(children.id, parsedChildId.data),
            eq(children.familyId, actor.familyId),
          ),
        )
        .returning({ id: children.id });
      if (!deactivated) throw new Error("CHILD_NOT_FOUND");

      await tx
        .update(childSessions)
        .set({ revokedAt: now })
        .where(
          and(
            eq(childSessions.familyId, actor.familyId),
            eq(childSessions.childId, parsedChildId.data),
            isNull(childSessions.revokedAt),
          ),
        );
    });
  }

  async function requireChildActor(request: Request): Promise<ChildActor> {
    const rawToken = readCookie(request, CHILD_SESSION_COOKIE);
    if (!rawToken) invalidChildSession();
    return actorFromChildSessionToken(rawToken);
  }

  async function revokeDevice(
    actor: FamilyOwnerActor,
    deviceId: string,
  ): Promise<void> {
    const parsedDeviceId = z.string().uuid().safeParse(deviceId);
    if (!parsedDeviceId.success) throw new Error("DEVICE_NOT_FOUND");
    const now = dependencies.now();

    await database.transaction(async (tx) => {
      const [device] = await tx
        .select({ id: devices.id })
        .from(devices)
        .where(
          and(
            eq(devices.id, parsedDeviceId.data),
            eq(devices.familyId, actor.familyId),
          ),
        )
        .limit(1)
        .for("update");
      if (!device) throw new Error("DEVICE_NOT_FOUND");

      await tx
        .update(devices)
        .set({ revokedAt: now })
        .where(eq(devices.id, device.id));
      await tx
        .update(childSessions)
        .set({ revokedAt: now })
        .where(
          and(
            eq(childSessions.deviceId, device.id),
            isNull(childSessions.revokedAt),
          ),
        );
    });
  }

  async function listAuthorizedChildren(
    rawDeviceToken: string,
  ): Promise<AuthorizedChild[]> {
    if (!rawDeviceToken) throw new Error("DEVICE_INVALID");
    const rows = await database
      .select({
        id: children.id,
        nickname: children.nickname,
        avatarKey: children.avatarKey,
        childPinHash: children.childPinHash,
      })
      .from(devices)
      .innerJoin(
        deviceChildAccess,
        and(
          eq(deviceChildAccess.deviceId, devices.id),
          eq(deviceChildAccess.familyId, devices.familyId),
        ),
      )
      .innerJoin(
        children,
        and(
          eq(children.id, deviceChildAccess.childId),
          eq(children.familyId, deviceChildAccess.familyId),
        ),
      )
      .where(
        and(
          eq(
            devices.tokenHash,
            dependencies.hashOpaqueToken(rawDeviceToken),
          ),
          isNull(devices.revokedAt),
          eq(children.active, true),
        ),
      );
    if (rows.length === 0) throw new Error("DEVICE_INVALID");
    return rows.map((row) => ({
      id: row.id,
      nickname: row.nickname,
      avatarKey: row.avatarKey,
      requiresPin: row.childPinHash !== null,
    }));
  }

  async function listDevices(actor: FamilyOwnerActor): Promise<FamilyDevice[]> {
    const deviceRows = await database
      .select({
        id: devices.id,
        label: devices.label,
        lastActiveAt: devices.lastActiveAt,
        revokedAt: devices.revokedAt,
      })
      .from(devices)
      .where(eq(devices.familyId, actor.familyId));
    if (deviceRows.length === 0) return [];

    const accessRows = await database
      .select({
        deviceId: deviceChildAccess.deviceId,
        childId: children.id,
        nickname: children.nickname,
      })
      .from(deviceChildAccess)
      .innerJoin(
        children,
        and(
          eq(children.id, deviceChildAccess.childId),
          eq(children.familyId, deviceChildAccess.familyId),
        ),
      )
      .where(
        and(
          eq(deviceChildAccess.familyId, actor.familyId),
          inArray(
            deviceChildAccess.deviceId,
            deviceRows.map((device) => device.id),
          ),
        ),
      );
    return deviceRows.map((device) => ({
      ...device,
      children: accessRows
        .filter((access) => access.deviceId === device.id)
        .map((access) => ({ id: access.childId, nickname: access.nickname })),
    }));
  }

  async function getChildProfile(actor: ChildActor) {
    const [child] = await database
      .select({ id: children.id, nickname: children.nickname, avatarKey: children.avatarKey })
      .from(children)
      .where(
        and(
          eq(children.id, actor.childId),
          eq(children.familyId, actor.familyId),
          eq(children.active, true),
        ),
      )
      .limit(1);
    if (!child) invalidChildSession();
    return child;
  }

  return {
    actorFromChildSessionToken,
    claimPairingCode,
    createPairingCode,
    deactivateChild,
    getChildProfile,
    listAuthorizedChildren,
    listDevices,
    requireChildActor,
    revokeDevice,
    selectChild,
    setDeviceChildAccess,
  };
}

const deviceService = createDeviceService();

export const actorFromChildSessionToken =
  deviceService.actorFromChildSessionToken;
export function claimPairingCode(
  code: string,
  label: string,
  clientAddress: string,
) {
  return deviceService.claimPairingCode(code, label, clientAddress);
}
export const createPairingCode = deviceService.createPairingCode;
export const deactivateChild = deviceService.deactivateChild;
export const getChildProfile = deviceService.getChildProfile;
export const listAuthorizedChildren = deviceService.listAuthorizedChildren;
export const listDevices = deviceService.listDevices;
export const requireChildActorFromRequest = deviceService.requireChildActor;
export const revokeDevice = deviceService.revokeDevice;
export const selectChild = deviceService.selectChild;
export const setDeviceChildAccess = deviceService.setDeviceChildAccess;
