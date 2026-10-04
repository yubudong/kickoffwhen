import { and, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, test } from "vitest";

import { db, type DbTransaction } from "@/db/client";
import type { FamilyOwnerActor } from "@/modules/auth/actor";
import { hashChildPin } from "@/modules/auth/parent-pin";
import { user as authUsers } from "@/modules/auth/schema";
import {
  createParentModeAccessService,
} from "@/modules/devices/parent-mode-access";
import {
  childSessions,
  deviceChildAccess,
  pairingRateLimits,
  parentModeUnlocks,
} from "@/modules/devices/schema";
import { createDeviceService } from "@/modules/devices/service";
import { hashOpaqueToken } from "@/modules/devices/token";
import {
  children,
  families,
  guardians,
} from "@/modules/families/schema";
import { createFamilyService } from "@/modules/families/service";

import { withDatabaseRollback } from "../helpers/database";

const now = new Date("2026-09-02T04:00:00.000Z");
const childPin = "246810";
const parentPin = "482731";

type FamilyFixture = {
  actor: FamilyOwnerActor;
  authUserId: string;
  childIds: string[];
};

async function familyWithChildren(
  tx: DbTransaction,
  label: string,
  count = 2,
): Promise<FamilyFixture> {
  const authUserId = `final-fix-${crypto.randomUUID()}`;
  await tx.insert(authUsers).values({
    id: authUserId,
    name: `${label}家长`,
    email: `${authUserId}@example.test`,
  });
  const [family] = await tx
    .insert(families)
    .values({ name: `${label}家庭` })
    .returning();
  const [guardian] = await tx
    .insert(guardians)
    .values({
      authUserId,
      displayName: `${label}家长`,
      familyId: family.id,
      isOwner: true,
    })
    .returning();
  const childRows = await tx
    .insert(children)
    .values(
      Array.from({ length: count }, (_, index) => ({
        familyId: family.id,
        nickname: `${label}孩子${index + 1}`,
        avatarKey: index === 0 ? "child-1" : "rocket-blue",
        grade: index + 1,
      })),
    )
    .returning({ id: children.id });

  return {
    actor: {
      role: "guardian",
      familyRole: "owner",
      familyId: family.id,
      guardianId: guardian.id,
    },
    authUserId,
    childIds: childRows.map((child) => child.id),
  };
}

async function withCommittedFamily(
  label: string,
  run: (fixture: FamilyFixture) => Promise<void>,
) {
  const fixture = await db.transaction((tx) => familyWithChildren(tx, label));
  try {
    await run(fixture);
  } finally {
    await db.delete(families).where(eq(families.id, fixture.actor.familyId));
    await db.delete(authUsers).where(eq(authUsers.id, fixture.authUserId));
  }
}

function childRequest(rawChildSessionToken: string) {
  return new Request("http://example.test/child", {
    headers: {
      cookie: `family_learning_child_session=${rawChildSessionToken}`,
    },
  });
}

describe("child PIN lock", () => {
  test("five concurrent wrong attempts preserve every count and lock for 15 minutes", async () => {
    await withCommittedFamily("并发儿童口令", async (fixture) => {
      await db
        .update(children)
        .set({ childPinHash: await hashChildPin(childPin) })
        .where(eq(children.id, fixture.childIds[0]));
      const service = createDeviceService(db, { now: () => now });
      const pairing = await service.createPairingCode(
        fixture.actor,
        [fixture.childIds[0]],
        now,
      );
      const device = await service.claimPairingCode(
        pairing.code,
        "儿童口令并发设备",
        `pin-concurrency-${crypto.randomUUID()}`,
      );

      const attempts = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          service.selectChild(device.rawDeviceToken, fixture.childIds[0], "000000"),
        ),
      );
      expect(attempts).toEqual(
        Array.from({ length: 5 }, () =>
          expect.objectContaining({
            status: "rejected",
            reason: expect.objectContaining({ message: "CHILD_PIN_INVALID" }),
          }),
        ),
      );

      const state = await db
        .select({
          failedAttempts: deviceChildAccess.failedAttempts,
          lockedUntil: deviceChildAccess.lockedUntil,
        })
        .from(deviceChildAccess)
        .where(
          and(
            eq(deviceChildAccess.deviceId, device.deviceId),
            eq(deviceChildAccess.childId, fixture.childIds[0]),
          ),
        );
      expect(state).toEqual([
        {
          failedAttempts: 5,
          lockedUntil: new Date(now.getTime() + 15 * 60 * 1000),
        },
      ]);
    });
  });

  test("correct PIN stays rejected during lock and succeeds exactly at expiry", async () => {
    await withDatabaseRollback(async (tx) => {
      const fixture = await familyWithChildren(tx, "儿童口令边界", 1);
      await tx
        .update(children)
        .set({ childPinHash: await hashChildPin(childPin) })
        .where(eq(children.id, fixture.childIds[0]));
      const setup = createDeviceService(tx, { now: () => now });
      const pairing = await setup.createPairingCode(
        fixture.actor,
        fixture.childIds,
        now,
      );
      const device = await setup.claimPairingCode(
        pairing.code,
        "儿童口令边界设备",
        "198.51.100.41",
      );
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(
          setup.selectChild(device.rawDeviceToken, fixture.childIds[0], "000000"),
        ).rejects.toThrow("CHILD_PIN_INVALID");
      }

      const beforeExpiry = createDeviceService(tx, {
        now: () => new Date(now.getTime() + 15 * 60 * 1000 - 1),
      });
      await expect(
        beforeExpiry.selectChild(
          device.rawDeviceToken,
          fixture.childIds[0],
          childPin,
        ),
      ).rejects.toThrow("CHILD_PIN_INVALID");

      const atExpiry = createDeviceService(tx, {
        now: () => new Date(now.getTime() + 15 * 60 * 1000),
      });
      await expect(
        atExpiry.selectChild(
          device.rawDeviceToken,
          fixture.childIds[0],
          childPin,
        ),
      ).resolves.toHaveProperty("rawChildSessionToken");

      const state = await tx.execute<{
        failed_attempts: number;
        locked_until: Date | null;
      }>(sql`
        select failed_attempts, locked_until
        from device_child_access
        where device_id = ${device.deviceId}
          and child_id = ${fixture.childIds[0]}
      `);
      expect(state.rows).toEqual([{ failed_attempts: 0, locked_until: null }]);
    });
  });

  test("a successful PIN before lock clears previous failures", async () => {
    await withDatabaseRollback(async (tx) => {
      const fixture = await familyWithChildren(tx, "儿童口令清零", 1);
      await tx
        .update(children)
        .set({ childPinHash: await hashChildPin(childPin) })
        .where(eq(children.id, fixture.childIds[0]));
      const service = createDeviceService(tx, { now: () => now });
      const pairing = await service.createPairingCode(
        fixture.actor,
        fixture.childIds,
        now,
      );
      const device = await service.claimPairingCode(
        pairing.code,
        "儿童口令清零设备",
        "198.51.100.42",
      );
      await expect(
        service.selectChild(device.rawDeviceToken, fixture.childIds[0], "000000"),
      ).rejects.toThrow("CHILD_PIN_INVALID");
      await expect(
        service.selectChild(device.rawDeviceToken, fixture.childIds[0], childPin),
      ).resolves.toHaveProperty("rawChildSessionToken");

      const state = await tx.execute<{ failed_attempts: number }>(sql`
        select failed_attempts
        from device_child_access
        where device_id = ${device.deviceId}
          and child_id = ${fixture.childIds[0]}
      `);
      expect(state.rows).toEqual([{ failed_attempts: 0 }]);
    });
  });
});

describe("pairing attempt rate limits", () => {
  test("submitted normalized code is limited to ten attempts per 15 minutes", async () => {
    await withDatabaseRollback(async (tx) => {
      const service = createDeviceService(tx, { now: () => now });
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await expect(
          service.claimPairingCode(
            "  missing-code  ",
            "未知设备",
            "203.0.113.21",
          ),
        ).rejects.toThrow("PAIRING_CODE_INVALID");
      }
      await expect(
        service.claimPairingCode(
          "MISSING-CODE",
          "未知设备",
          "203.0.113.21",
        ),
      ).rejects.toThrow("PAIRING_RATE_LIMITED");

      const rows = await tx.execute(sql`
        select key_hash, attempt_count, window_started_at
        from pairing_rate_limits
        where key_hash in (
          ${hashOpaqueToken("pairing-address:203.0.113.21")},
          ${hashOpaqueToken("pairing-code:MISSING-CODE")}
        )
        order by key_hash
      `);
      expect(rows.rows).toHaveLength(2);
      expect(JSON.stringify(rows.rows)).not.toContain("203.0.113.21");
      expect(JSON.stringify(rows.rows)).not.toContain("MISSING-CODE");
    });
  });

  test("one client address is limited to twenty attempts and recovers at the exact boundary", async () => {
    await withDatabaseRollback(async (tx) => {
      const clientAddress = "203.0.113.22";
      const service = createDeviceService(tx, { now: () => now });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await expect(
          service.claimPairingCode(
            `missing-${attempt.toString().padStart(2, "0")}`,
            "未知设备",
            clientAddress,
          ),
        ).rejects.toThrow("PAIRING_CODE_INVALID");
      }
      await expect(
        service.claimPairingCode("missing-20", "未知设备", clientAddress),
      ).rejects.toThrow("PAIRING_RATE_LIMITED");

      const atBoundary = createDeviceService(tx, {
        now: () => new Date(now.getTime() + 15 * 60 * 1000),
      });
      await expect(
        atBoundary.claimPairingCode("missing-21", "未知设备", clientAddress),
      ).rejects.toThrow("PAIRING_CODE_INVALID");
    });
  });

  test("blocked addresses cannot allocate rows for additional submitted codes", async () => {
    await withDatabaseRollback(async (tx) => {
      await tx.delete(pairingRateLimits);
      const clientAddress = "203.0.113.23";
      const service = createDeviceService(tx, { now: () => now });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await expect(
          service.claimPairingCode(
            `bounded-${attempt.toString().padStart(2, "0")}`,
            "未知设备",
            clientAddress,
          ),
        ).rejects.toThrow("PAIRING_CODE_INVALID");
      }
      const before = await tx.$count(pairingRateLimits);

      for (let attempt = 20; attempt < 60; attempt += 1) {
        await expect(
          service.claimPairingCode(
            `bounded-${attempt.toString().padStart(2, "0")}`,
            "未知设备",
            clientAddress,
          ),
        ).rejects.toThrow("PAIRING_RATE_LIMITED");
      }

      expect(await tx.$count(pairingRateLimits)).toBe(before);
    });
  });

  test("expired limiter rows are removed in a bounded batch without touching live rows", async () => {
    await withDatabaseRollback(async (tx) => {
      await tx.delete(pairingRateLimits);
      const expiredAt = new Date(now.getTime() - 15 * 60 * 1000);
      const liveAt = new Date(now.getTime() - 15 * 60 * 1000 + 1);
      await tx.insert(pairingRateLimits).values([
        ...Array.from({ length: 105 }, (_, index) => ({
          keyHash: `expired-${index.toString().padStart(3, "0")}`,
          attemptCount: 1,
          windowStartedAt: expiredAt,
          updatedAt: expiredAt,
        })),
        {
          keyHash: "live-row-one",
          attemptCount: 1,
          windowStartedAt: liveAt,
          updatedAt: liveAt,
        },
        {
          keyHash: "live-row-two",
          attemptCount: 2,
          windowStartedAt: now,
          updatedAt: now,
        },
      ]);

      const service = createDeviceService(tx, { now: () => now });
      await expect(
        service.claimPairingCode(
          "cleanup-missing",
          "未知设备",
          "203.0.113.24",
        ),
      ).rejects.toThrow("PAIRING_CODE_INVALID");

      expect(
        await tx.$count(
          pairingRateLimits,
          sql`${pairingRateLimits.keyHash} like 'expired-%'`,
        ),
      ).toBe(5);
      expect(
        await tx
          .select({ keyHash: pairingRateLimits.keyHash })
          .from(pairingRateLimits)
          .where(inArray(pairingRateLimits.keyHash, ["live-row-one", "live-row-two"]))
          .orderBy(pairingRateLimits.keyHash),
      ).toEqual([{ keyHash: "live-row-one" }, { keyHash: "live-row-two" }]);
    });
  });
});

describe("existing device child access management", () => {
  test("setting a non-empty subset deletes removed-child sessions immediately", async () => {
    await withDatabaseRollback(async (tx) => {
      const fixture = await familyWithChildren(tx, "设备授权子集");
      const service = createDeviceService(tx, { now: () => now });
      const pairing = await service.createPairingCode(
        fixture.actor,
        fixture.childIds,
        now,
      );
      const device = await service.claimPairingCode(
        pairing.code,
        "授权子集设备",
        "198.51.100.51",
      );
      const removedSession = await service.selectChild(
        device.rawDeviceToken,
        fixture.childIds[0],
      );

      await service.setDeviceChildAccess(
        fixture.actor,
        device.deviceId,
        [fixture.childIds[1]],
      );

      expect(
        await tx
          .select({ childId: deviceChildAccess.childId })
          .from(deviceChildAccess)
          .where(eq(deviceChildAccess.deviceId, device.deviceId)),
      ).toEqual([{ childId: fixture.childIds[1] }]);
      expect(
        await tx
          .select()
          .from(childSessions)
          .where(eq(childSessions.deviceId, device.deviceId)),
      ).toHaveLength(0);
      await expect(
        service.requireChildActor(childRequest(removedSession.rawChildSessionToken)),
      ).rejects.toThrow("CHILD_SESSION_INVALID");
      await expect(
        service.selectChild(device.rawDeviceToken, fixture.childIds[1]),
      ).resolves.toHaveProperty("rawChildSessionToken");
    });
  });

  test("cross-family, inactive-child, revoked-device and empty grant updates are rejected", async () => {
    await withDatabaseRollback(async (tx) => {
      const familyA = await familyWithChildren(tx, "设备授权拒绝A");
      const familyB = await familyWithChildren(tx, "设备授权拒绝B", 1);
      const service = createDeviceService(tx, { now: () => now });
      const pairing = await service.createPairingCode(
        familyA.actor,
        familyA.childIds,
        now,
      );
      const device = await service.claimPairingCode(
        pairing.code,
        "授权拒绝设备",
        "198.51.100.52",
      );

      await expect(
        service.setDeviceChildAccess(familyB.actor, device.deviceId, familyB.childIds),
      ).rejects.toThrow("DEVICE_NOT_FOUND");
      await expect(
        service.setDeviceChildAccess(familyA.actor, device.deviceId, []),
      ).rejects.toThrow("INVALID_CHILD_ACCESS");
      await tx
        .update(children)
        .set({ active: false })
        .where(eq(children.id, familyA.childIds[1]));
      await expect(
        service.setDeviceChildAccess(
          familyA.actor,
          device.deviceId,
          familyA.childIds,
        ),
      ).rejects.toThrow("INVALID_CHILD_ACCESS");

      await service.revokeDevice(familyA.actor, device.deviceId);
      await expect(
        service.setDeviceChildAccess(
          familyA.actor,
          device.deviceId,
          [familyA.childIds[0]],
        ),
      ).rejects.toThrow("DEVICE_NOT_FOUND");
    });
  });

  test("concurrent selection and grant removal linearize to no removed access or session", async () => {
    await withCommittedFamily("设备授权并发", async (fixture) => {
      const setup = createDeviceService(db, { now: () => now });
      const pairing = await setup.createPairingCode(
        fixture.actor,
        fixture.childIds,
        now,
      );
      const device = await setup.claimPairingCode(
        pairing.code,
        "授权并发设备",
        `grant-concurrency-${crypto.randomUUID()}`,
      );

      const outcomes = await Promise.allSettled([
        setup.selectChild(device.rawDeviceToken, fixture.childIds[0]),
        createDeviceService(db, { now: () => new Date(now.getTime() + 1_000) })
          .setDeviceChildAccess(
            fixture.actor,
            device.deviceId,
            [fixture.childIds[1]],
          ),
      ]);
      const selection = outcomes[0];
      if (selection.status === "fulfilled") {
        await expect(
          setup.requireChildActor(childRequest(selection.value.rawChildSessionToken)),
        ).rejects.toThrow("CHILD_SESSION_INVALID");
      } else {
        expect(selection.reason).toEqual(
          expect.objectContaining({ message: "CHILD_ACCESS_DENIED" }),
        );
      }

      expect(
        await db
          .select({ childId: deviceChildAccess.childId })
          .from(deviceChildAccess)
          .where(eq(deviceChildAccess.deviceId, device.deviceId)),
      ).toEqual([{ childId: fixture.childIds[1] }]);
      expect(
        await db
          .select()
          .from(childSessions)
          .where(
            and(
              eq(childSessions.deviceId, device.deviceId),
              eq(childSessions.childId, fixture.childIds[0]),
            ),
          ),
      ).toHaveLength(0);
    });
  });
});

describe("parent mode sign-out", () => {
  test("revoking the current unlock deletes it server-side and invalidates it", async () => {
    await withDatabaseRollback(async (tx) => {
      const fixture = await familyWithChildren(tx, "家长模式退出", 1);
      await createFamilyService(tx).setParentPin(fixture.actor, parentPin);
      const deviceService = createDeviceService(tx, { now: () => now });
      const pairing = await deviceService.createPairingCode(
        fixture.actor,
        fixture.childIds,
        now,
      );
      const device = await deviceService.claimPairingCode(
        pairing.code,
        "家长模式退出设备",
        "198.51.100.61",
      );
      const parentAccess = createParentModeAccessService(tx, { now: () => now });
      const unlocked = await parentAccess.unlockWithParentPin(
        device.rawDeviceToken,
        parentPin,
      );

      await parentAccess.revokeParentUnlock(unlocked.rawUnlockToken);

      await expect(
        parentAccess.actorFromParentUnlock(
          device.rawDeviceToken,
          unlocked.rawUnlockToken,
        ),
      ).rejects.toThrow("PARENT_UNLOCK_INVALID");
      expect(
        await tx
          .select()
          .from(parentModeUnlocks)
          .where(
            inArray(parentModeUnlocks.tokenHash, [
              hashOpaqueToken(unlocked.rawUnlockToken),
            ]),
          ),
      ).toHaveLength(0);
    });
  });
});
