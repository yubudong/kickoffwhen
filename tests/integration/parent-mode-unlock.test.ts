import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";

import type { DbTransaction } from "@/db/client";
import type { FamilyOwnerActor } from "@/modules/auth/actor";
import { user as authUsers } from "@/modules/auth/schema";
import { parentModeUnlocks } from "@/modules/devices/schema";
import { createDeviceService } from "@/modules/devices/service";
import { createParentModeAccessService } from "@/modules/devices/parent-mode-access";
import {
  children,
  families,
  guardians,
  parentPins,
} from "@/modules/families/schema";
import { createFamilyService } from "@/modules/families/service";

import { withDatabaseRollback } from "../helpers/database";

const now = new Date("2026-09-02T02:00:00.000Z");
const parentPin = "482731";

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function familyWithPairedDevice(tx: DbTransaction): Promise<{
  actor: FamilyOwnerActor;
  childId: string;
  rawDeviceToken: string;
}> {
  const authUserId = `parent-unlock-${crypto.randomUUID()}`;
  await tx.insert(authUsers).values({
    id: authUserId,
    name: "解锁测试家长",
    email: `${authUserId}@example.test`,
  });
  const [family] = await tx
    .insert(families)
    .values({ name: "家长模式测试家庭" })
    .returning();
  const [guardian] = await tx
    .insert(guardians)
    .values({
      authUserId,
      displayName: "测试家长",
      familyId: family.id,
      isOwner: true,
    })
    .returning();
  const actor: FamilyOwnerActor = {
    role: "guardian",
    familyRole: "owner",
    familyId: family.id,
    guardianId: guardian.id,
  };
  const [child] = await tx
    .insert(children)
    .values({
      familyId: family.id,
      nickname: "小雨",
      avatarKey: "child-1",
      grade: 2,
    })
    .returning();
  await createFamilyService(tx).setParentPin(actor, parentPin);

  const deviceService = createDeviceService(tx, { now: () => now });
  const pairing = await deviceService.createPairingCode(
    actor,
    [child.id],
    now,
  );
  const device = await deviceService.claimPairingCode(
    pairing.code,
    "客厅 iPad",
  );
  return { actor, childId: child.id, rawDeviceToken: device.rawDeviceToken };
}

describe("device-bound parent mode unlock", () => {
  test("正确家长 PIN 创建 15 分钟解锁，数据库只保存令牌摘要", async () => {
    await withDatabaseRollback(async (tx) => {
      const fixture = await familyWithPairedDevice(tx);
      const service = createParentModeAccessService(tx, { now: () => now });

      const unlocked = await service.unlockWithParentPin(
        fixture.rawDeviceToken,
        parentPin,
      );

      expect(unlocked.expiresAt).toEqual(
        new Date(now.getTime() + 15 * 60 * 1000),
      );
      expect(
        await service.actorFromParentUnlock(
          fixture.rawDeviceToken,
          unlocked.rawUnlockToken,
        ),
      ).toEqual(fixture.actor);

      const [stored] = await tx
        .select()
        .from(parentModeUnlocks)
        .where(eq(parentModeUnlocks.familyId, fixture.actor.familyId));
      expect(stored.tokenHash).toBe(sha256(unlocked.rawUnlockToken));
      expect(JSON.stringify(stored)).not.toContain(unlocked.rawUnlockToken);
      expect(JSON.stringify(stored)).not.toContain(parentPin);
    });
  });

  test("解锁只在原设备未撤销且 15 分钟未到期时有效", async () => {
    await withDatabaseRollback(async (tx) => {
      const fixture = await familyWithPairedDevice(tx);
      const service = createParentModeAccessService(tx, { now: () => now });
      const unlocked = await service.unlockWithParentPin(
        fixture.rawDeviceToken,
        parentPin,
      );

      const deviceService = createDeviceService(tx, { now: () => now });
      const secondPairing = await deviceService.createPairingCode(
        fixture.actor,
        [fixture.childId],
        now,
      );
      const secondDevice = await deviceService.claimPairingCode(
        secondPairing.code,
        "第二台 iPad",
      );

      await expect(
        service.actorFromParentUnlock(
          secondDevice.rawDeviceToken,
          unlocked.rawUnlockToken,
        ),
      ).rejects.toThrow("PARENT_UNLOCK_INVALID");

      const expiredService = createParentModeAccessService(tx, {
        now: () => new Date(now.getTime() + 15 * 60 * 1000),
      });
      await expect(
        expiredService.actorFromParentUnlock(
          fixture.rawDeviceToken,
          unlocked.rawUnlockToken,
        ),
      ).rejects.toThrow("PARENT_UNLOCK_INVALID");

      const [unlockRow] = await tx
        .select({ deviceId: parentModeUnlocks.deviceId })
        .from(parentModeUnlocks)
        .where(eq(parentModeUnlocks.tokenHash, sha256(unlocked.rawUnlockToken)));
      await deviceService.revokeDevice(fixture.actor, unlockRow.deviceId);
      await expect(
        service.actorFromParentUnlock(
          fixture.rawDeviceToken,
          unlocked.rawUnlockToken,
        ),
      ).rejects.toThrow("PARENT_UNLOCK_INVALID");
    });
  });

  test("连续 5 次错误解锁会保留失败计数并锁定 15 分钟", async () => {
    await withDatabaseRollback(async (tx) => {
      const fixture = await familyWithPairedDevice(tx);
      const service = createParentModeAccessService(tx, { now: () => now });

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(
          service.unlockWithParentPin(fixture.rawDeviceToken, "000000"),
        ).rejects.toThrow("PARENT_PIN_INVALID");
      }

      const [lockedPin] = await tx
        .select({
          failedAttempts: parentPins.failedAttempts,
          lockedUntil: parentPins.lockedUntil,
        })
        .from(parentPins)
        .where(eq(parentPins.guardianId, fixture.actor.guardianId));
      expect(lockedPin).toEqual({
        failedAttempts: 5,
        lockedUntil: new Date(now.getTime() + 15 * 60 * 1000),
      });

      const stillLocked = createParentModeAccessService(tx, {
        now: () => new Date(now.getTime() + 15 * 60 * 1000 - 1),
      });
      await expect(
        stillLocked.unlockWithParentPin(fixture.rawDeviceToken, parentPin),
      ).rejects.toThrow("PARENT_PIN_INVALID");

      const lockExpired = createParentModeAccessService(tx, {
        now: () => new Date(now.getTime() + 15 * 60 * 1000),
      });
      await expect(
        lockExpired.unlockWithParentPin(fixture.rawDeviceToken, parentPin),
      ).resolves.toMatchObject({
        expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
      });
    });
  });
});
