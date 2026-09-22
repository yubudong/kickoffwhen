import { and, eq, gt, isNull } from "drizzle-orm";

import { db, type DbTransaction } from "@/db/client";
import type { FamilyOwnerActor } from "@/modules/auth/actor";
import { guardians } from "@/modules/families/schema";
import { createFamilyService } from "@/modules/families/service";

import { devices, parentModeUnlocks } from "./schema";
import { createOpaqueToken, hashOpaqueToken } from "./token";

const PARENT_MODE_LIFETIME_MS = 15 * 60 * 1000;

type ParentModeDatabase = typeof db | DbTransaction;

type ParentModeDependencies = {
  createOpaqueToken: () => string;
  hashOpaqueToken: (token: string) => string;
  now: () => Date;
};

function invalidParentUnlock(): never {
  throw new Error("PARENT_UNLOCK_INVALID");
}

export function createParentModeAccessService(
  database: ParentModeDatabase = db,
  overrides: Partial<ParentModeDependencies> = {},
) {
  const dependencies: ParentModeDependencies = {
    createOpaqueToken,
    hashOpaqueToken,
    now: () => new Date(),
    ...overrides,
  };

  async function unlockWithParentPin(
    rawDeviceToken: string,
    pin: string,
  ): Promise<{ rawUnlockToken: string; expiresAt: Date }> {
    if (!rawDeviceToken) throw new Error("DEVICE_INVALID");
    const currentTime = dependencies.now();

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

      const [owner] = await tx
        .select({ id: guardians.id, familyId: guardians.familyId })
        .from(guardians)
        .where(
          and(
            eq(guardians.familyId, device.familyId),
            eq(guardians.isOwner, true),
          ),
        )
        .limit(1);
      if (!owner) throw new Error("PARENT_UNLOCK_INVALID");

      const actor: FamilyOwnerActor = {
        role: "guardian",
        familyRole: "owner",
        familyId: owner.familyId,
        guardianId: owner.id,
      };
      const verified = await createFamilyService(tx).verifyParentPin(
        actor,
        pin,
        currentTime,
      );
      if (!verified) return { verified: false as const };

      const rawUnlockToken = dependencies.createOpaqueToken();
      const expiresAt = new Date(
        currentTime.getTime() + PARENT_MODE_LIFETIME_MS,
      );
      await tx.insert(parentModeUnlocks).values({
        familyId: actor.familyId,
        guardianId: actor.guardianId,
        deviceId: device.id,
        tokenHash: dependencies.hashOpaqueToken(rawUnlockToken),
        expiresAt,
        createdAt: currentTime,
      });

      return { verified: true as const, rawUnlockToken, expiresAt };
    });
    if (!result.verified) throw new Error("PARENT_PIN_INVALID");
    return {
      rawUnlockToken: result.rawUnlockToken,
      expiresAt: result.expiresAt,
    };
  }

  async function actorFromParentUnlock(
    rawDeviceToken: string,
    rawUnlockToken: string,
  ): Promise<FamilyOwnerActor> {
    if (!rawDeviceToken || !rawUnlockToken) invalidParentUnlock();
    const currentTime = dependencies.now();

    return database.transaction(async (tx) => {
      const [unlock] = await tx
        .select({
          familyId: parentModeUnlocks.familyId,
          guardianId: parentModeUnlocks.guardianId,
        })
        .from(parentModeUnlocks)
        .innerJoin(
          devices,
          and(
            eq(devices.id, parentModeUnlocks.deviceId),
            eq(devices.familyId, parentModeUnlocks.familyId),
          ),
        )
        .innerJoin(
          guardians,
          and(
            eq(guardians.id, parentModeUnlocks.guardianId),
            eq(guardians.familyId, parentModeUnlocks.familyId),
          ),
        )
        .where(
          and(
            eq(
              devices.tokenHash,
              dependencies.hashOpaqueToken(rawDeviceToken),
            ),
            isNull(devices.revokedAt),
            eq(
              parentModeUnlocks.tokenHash,
              dependencies.hashOpaqueToken(rawUnlockToken),
            ),
            gt(parentModeUnlocks.expiresAt, currentTime),
            eq(guardians.isOwner, true),
          ),
        )
        .limit(1)
        .for("share", { of: devices });
      if (!unlock) invalidParentUnlock();

      return {
        role: "guardian",
        familyRole: "owner",
        familyId: unlock.familyId,
        guardianId: unlock.guardianId,
      };
    });
  }

  async function revokeParentUnlock(rawUnlockToken: string): Promise<void> {
    if (!rawUnlockToken) return;
    await database
      .delete(parentModeUnlocks)
      .where(
        eq(
          parentModeUnlocks.tokenHash,
          dependencies.hashOpaqueToken(rawUnlockToken),
        ),
      );
  }

  return {
    actorFromParentUnlock,
    revokeParentUnlock,
    unlockWithParentPin,
  };
}

const parentModeAccessService = createParentModeAccessService();

export const actorFromParentUnlock =
  parentModeAccessService.actorFromParentUnlock;
export const revokeParentUnlock =
  parentModeAccessService.revokeParentUnlock;
export const unlockWithParentPin = parentModeAccessService.unlockWithParentPin;
