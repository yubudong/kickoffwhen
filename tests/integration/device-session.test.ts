import { createHash } from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, expect, test } from "vitest";

import { db, type DbTransaction } from "@/db/client";
import * as databaseSchema from "@/db/schema";
import type { FamilyOwnerActor } from "@/modules/auth/actor";
import { user as authUsers } from "@/modules/auth/schema";
import {
  CHILD_SESSION_COOKIE,
  requireChildActor,
} from "@/modules/devices/child-actor";
import {
  childSessions,
  deviceChildAccess,
  devices,
  pairingCodeChildAccess,
  pairingCodes,
} from "@/modules/devices/schema";
import { createDeviceService } from "@/modules/devices/service";
import { hashChildPin } from "@/modules/auth/parent-pin";
import { children, families, guardians } from "@/modules/families/schema";

import { withDatabaseRollback } from "../helpers/database";

const issuedAt = new Date("2026-09-01T08:00:00.000Z");

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

type FamilyFixture = {
  actor: FamilyOwnerActor;
  authUserId: string;
  childIds: string[];
};

async function familyWithChildren(
  tx: DbTransaction,
  suffix: string,
  count = 2,
): Promise<FamilyFixture> {
  const authUserId = `device-${suffix}-${crypto.randomUUID()}`;
  await tx.insert(authUsers).values({
    id: authUserId,
    name: `家长 ${suffix}`,
    email: `${authUserId}@example.test`,
  });
  const [family] = await tx
    .insert(families)
    .values({ name: `设备测试家庭 ${suffix}` })
    .returning();
  const [guardian] = await tx
    .insert(guardians)
    .values({
      authUserId,
      displayName: `家长 ${suffix}`,
      familyId: family.id,
      isOwner: true,
    })
    .returning();
  const childRows = await tx
    .insert(children)
    .values(
      Array.from({ length: count }, (_, index) => ({
        familyId: family.id,
        nickname: `${suffix}孩子${index + 1}`,
        avatarKey: index === 0 ? "child-1" : "rocket-blue",
        grade: index + 1,
      })),
    )
    .returning();

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

async function withCommittedFamily<T>(
  suffix: string,
  count: number,
  run: (family: FamilyFixture) => Promise<T>,
): Promise<T> {
  const family = await db.transaction((tx) =>
    familyWithChildren(tx, suffix, count),
  );
  try {
    return await run(family);
  } finally {
    await db.delete(families).where(eq(families.id, family.actor.familyId));
    await db.delete(authUsers).where(eq(authUsers.id, family.authUserId));
  }
}

function timeoutAfter(milliseconds: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    promise: new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    }),
    clear: () => {
      if (timer) clearTimeout(timer);
    },
  };
}

function createQueryBarrierDatabase(
  stage: "candidate" | "session-update" | "final-session",
  applicationName?: string,
) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const pool = new Pool({
    application_name: applicationName,
    connectionString,
  });
  let queryObservedFlag = false;
  let signalQuery: (() => void) | undefined;
  let releaseQuery: (() => void) | undefined;
  const queryObserved = new Promise<void>((resolve) => {
    signalQuery = resolve;
  });
  const queryRelease = new Promise<void>((resolve) => {
    releaseQuery = resolve;
  });

  pool.on("connect", (client) => {
    type QueryCallback = (error: Error | null, result?: unknown) => void;
    type FlexibleQueryClient = {
      query: (...args: unknown[]) => unknown;
    };
    const queryClient = client as unknown as FlexibleQueryClient;
    const originalQuery = queryClient.query.bind(client);
    queryClient.query = (...receivedArgs) => {
      const args = [...receivedArgs];
      const possibleCallback = args.at(-1);
      const callback =
        typeof possibleCallback === "function"
          ? (args.pop() as QueryCallback)
          : undefined;
      const input = args[0] as string | { text?: string };
      const text = typeof input === "string" ? input : input.text ?? "";
      const result = Promise.resolve(originalQuery(...args)).then(
        async (queryResult) => {
          const isCandidate =
            text.includes('from "child_sessions"') &&
            text.includes('inner join "devices"') &&
            text.includes('"child_sessions"."token_hash" = $1') &&
            !text.includes("for share");
          const isFinalSession =
            text.includes('from "child_sessions"') &&
            text.includes("for share");
          const isSessionUpdate = text.startsWith('update "child_sessions"');
          if (
            !queryObservedFlag &&
            (stage === "candidate"
              ? isCandidate
              : stage === "session-update"
                ? isSessionUpdate
                : isFinalSession)
          ) {
            queryObservedFlag = true;
            signalQuery?.();
            await queryRelease;
          }
          return queryResult;
        },
      );
      if (callback) {
        void result.then(
          (queryResult) => callback(null, queryResult),
          (error: Error) => callback(error),
        );
        return undefined;
      }
      return result;
    };
  });

  return {
    database: drizzle({ client: pool, schema: databaseSchema }),
    queryObserved,
    releaseQuery: () => releaseQuery?.(),
    close: () => pool.end(),
  };
}

async function waitForDatabaseCondition(
  condition: () => Promise<boolean>,
  message: string,
) {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

function childRequest(rawChildSessionToken: string, spoofedChildId?: string) {
  return new Request(
    `http://example.test/child${
      spoofedChildId ? `?childId=${encodeURIComponent(spoofedChildId)}` : ""
    }`,
    {
      headers: {
        cookie: `${CHILD_SESSION_COOKIE}=${rawChildSessionToken}`,
        "content-type": "application/json",
      },
      method: spoofedChildId ? "POST" : "GET",
      body: spoofedChildId ? JSON.stringify({ childId: spoofedChildId }) : undefined,
    },
  );
}

describe("device pairing and child sessions", () => {
  test("配对授权必须全部属于 owner 家庭且 active，不能部分静默接受", async () => {
    await withDatabaseRollback(async (tx) => {
      const familyA = await familyWithChildren(tx, "授权A");
      const familyB = await familyWithChildren(tx, "授权B", 1);
      await tx
        .update(children)
        .set({ active: false })
        .where(eq(children.id, familyA.childIds[1]));
      const service = createDeviceService(tx);

      await expect(
        service.createPairingCode(familyA.actor, [
          familyA.childIds[0],
          familyB.childIds[0],
        ], issuedAt),
      ).rejects.toThrow("INVALID_CHILD_ACCESS");
      await expect(
        service.createPairingCode(familyA.actor, familyA.childIds, issuedAt),
      ).rejects.toThrow("INVALID_CHILD_ACCESS");

      expect(
        await tx
          .select()
          .from(pairingCodes)
          .where(eq(pairingCodes.familyId, familyA.actor.familyId)),
      ).toHaveLength(0);
    });
  });

  test("配对码十分钟内只能并发领取一次且数据库不保存明文秘密", async () => {
    const family = await db.transaction((tx) =>
      familyWithChildren(tx, "并发领取", 1),
    );
    try {
      const service = createDeviceService(db, { now: () => issuedAt });
      const pairing = await service.createPairingCode(
        family.actor,
        family.childIds,
        issuedAt,
      );

      expect(pairing.expiresAt).toEqual(
        new Date(issuedAt.getTime() + 10 * 60 * 1000),
      );
      const [storedCode] = await db
        .select()
        .from(pairingCodes)
        .where(eq(pairingCodes.familyId, family.actor.familyId));
      expect(storedCode.codeHash).toBe(sha256(pairing.code));
      expect(JSON.stringify(storedCode)).not.toContain(pairing.code);

      const claims = await Promise.allSettled([
        service.claimPairingCode(pairing.code, "共享 iPad"),
        service.claimPairingCode(pairing.code, "重复请求"),
      ]);
      const successful = claims.filter(
        (result) => result.status === "fulfilled",
      );
      const rejected = claims.filter((result) => result.status === "rejected");

      expect(successful).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        reason: expect.objectContaining({ message: "PAIRING_CODE_INVALID" }),
      });
      const claim = successful[0];
      if (claim.status !== "fulfilled") throw new Error("unreachable");
      const [storedDevice] = await db
        .select()
        .from(devices)
        .where(eq(devices.id, claim.value.deviceId));
      expect(storedDevice.tokenHash).toBe(
        sha256(claim.value.rawDeviceToken),
      );
      expect(JSON.stringify(storedDevice)).not.toContain(
        claim.value.rawDeviceToken,
      );
      expect(
        await db
          .select()
          .from(deviceChildAccess)
          .where(eq(deviceChildAccess.deviceId, storedDevice.id)),
      ).toHaveLength(1);
    } finally {
      await db.delete(families).where(eq(families.id, family.actor.familyId));
      await db.delete(authUsers).where(eq(authUsers.id, family.authUserId));
    }
  });

  test("过期、已领取和不存在的配对码返回同一错误", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await familyWithChildren(tx, "统一错误", 1);
      const createdService = createDeviceService(tx, { now: () => issuedAt });
      const pairing = await createdService.createPairingCode(
        family.actor,
        family.childIds,
        issuedAt,
      );
      const expiredService = createDeviceService(tx, {
        now: () => new Date(issuedAt.getTime() + 10 * 60 * 1000 + 1),
      });

      await expect(
        expiredService.claimPairingCode(pairing.code, "过期设备"),
      ).rejects.toThrow("PAIRING_CODE_INVALID");
      await expect(
        expiredService.claimPairingCode("不存在的配对码", "未知设备"),
      ).rejects.toThrow("PAIRING_CODE_INVALID");
    });
  });

  test("领取时任一规范化授权孩子已停用则整笔回滚而非部分授权", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await familyWithChildren(tx, "领取全量校验");
      const service = createDeviceService(tx, { now: () => issuedAt });
      const pairing = await service.createPairingCode(
        family.actor,
        family.childIds,
        issuedAt,
      );
      await tx
        .update(children)
        .set({ active: false })
        .where(eq(children.id, family.childIds[1]));

      await expect(
        service.claimPairingCode(pairing.code, "不应部分授权的设备"),
      ).rejects.toThrow("PAIRING_CODE_INVALID");
      const [storedCode] = await tx
        .select({ claimedAt: pairingCodes.claimedAt })
        .from(pairingCodes)
        .where(eq(pairingCodes.codeHash, sha256(pairing.code)));
      expect(storedCode.claimedAt).toBeNull();
      expect(
        await tx
          .select()
          .from(devices)
          .where(eq(devices.familyId, family.actor.familyId)),
      ).toHaveLength(0);
    });
  });

  test("领取后写入设备授权失败会回滚 claimed_at", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await familyWithChildren(tx, "领取回滚", 1);
      const service = createDeviceService(tx, { now: () => issuedAt });
      const pairing = await service.createPairingCode(
        family.actor,
        family.childIds,
        issuedAt,
      );
      await tx.execute(sql.raw(`
        create function task5_reject_device_child_access() returns trigger
        language plpgsql as $$
        begin
          raise exception 'forced device child access failure';
        end;
        $$
      `));
      await tx.execute(sql.raw(`
        create trigger task5_reject_device_child_access_trigger
        before insert on device_child_access
        for each row execute function task5_reject_device_child_access()
      `));

      await expect(
        service.claimPairingCode(pairing.code, "会回滚的设备"),
      ).rejects.toThrow();
      const [storedCode] = await tx
        .select({ claimedAt: pairingCodes.claimedAt })
        .from(pairingCodes)
        .where(eq(pairingCodes.codeHash, sha256(pairing.code)));
      expect(storedCode.claimedAt).toBeNull();
      expect(
        await tx
          .select()
          .from(devices)
          .where(eq(devices.familyId, family.actor.familyId)),
      ).toHaveLength(0);
    });
  });

  test("配对码孩子授权由规范化关系保存且领取不读取遗留数组", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await familyWithChildren(tx, "规范化授权");
      const service = createDeviceService(tx, { now: () => issuedAt });
      const pairing = await service.createPairingCode(
        family.actor,
        [family.childIds[0]],
        issuedAt,
      );
      const storedRelations = await tx.execute(sql<{
        child_id: string;
      }>`
        select child_id
        from pairing_code_child_access
        where pairing_code_id = (
          select id from pairing_codes where code_hash = ${sha256(pairing.code)}
        )
      `);
      expect(storedRelations.rows).toEqual([{ child_id: family.childIds[0] }]);

      await tx
        .update(pairingCodes)
        .set({ childIds: [family.childIds[1]] })
        .where(eq(pairingCodes.codeHash, sha256(pairing.code)));
      const device = await service.claimPairingCode(pairing.code, "规范化设备");

      await expect(
        service.selectChild(device.rawDeviceToken, family.childIds[0]),
      ).resolves.toHaveProperty("rawChildSessionToken");
      await expect(
        service.selectChild(device.rawDeviceToken, family.childIds[1]),
      ).rejects.toThrow("CHILD_ACCESS_DENIED");
    });
  });

  test("数据库拒绝跨家庭配对授权与没有设备授权的儿童会话", async () => {
    await withDatabaseRollback(async (tx) => {
      const familyA = await familyWithChildren(tx, "数据库关系A");
      const familyB = await familyWithChildren(tx, "数据库关系B", 1);
      const service = createDeviceService(tx, { now: () => issuedAt });
      const pairing = await service.createPairingCode(
        familyA.actor,
        [familyA.childIds[0]],
        issuedAt,
      );
      const [storedCode] = await tx
        .select({ id: pairingCodes.id })
        .from(pairingCodes)
        .where(eq(pairingCodes.codeHash, sha256(pairing.code)));

      await expect(
        tx.transaction((savepoint) =>
          savepoint.insert(pairingCodeChildAccess).values({
            pairingCodeId: storedCode.id,
            familyId: familyB.actor.familyId,
            childId: familyB.childIds[0],
            createdAt: issuedAt,
          }),
        ),
      ).rejects.toThrow();

      const device = await service.claimPairingCode(pairing.code, "关系约束设备");
      await expect(
        tx.transaction((savepoint) =>
          savepoint.insert(childSessions).values({
            familyId: familyA.actor.familyId,
            deviceId: device.deviceId,
            childId: familyA.childIds[1],
            tokenHash: sha256("没有授权的会话"),
            lastActiveAt: issuedAt,
            createdAt: issuedAt,
          }),
        ),
      ).rejects.toThrow();
    });
  });

  test("共享设备可切换两个孩子且只撤销本设备旧会话，另一设备不受影响", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await familyWithChildren(tx, "共享设备");
      const service = createDeviceService(tx, { now: () => issuedAt });
      const sharedCode = await service.createPairingCode(
        family.actor,
        family.childIds,
        issuedAt,
      );
      const personalCode = await service.createPairingCode(
        family.actor,
        [family.childIds[1]],
        issuedAt,
      );
      const shared = await service.claimPairingCode(sharedCode.code, "客厅 iPad");
      const personal = await service.claimPairingCode(
        personalCode.code,
        "学习桌电脑",
      );

      const sharedA = await service.selectChild(
        shared.rawDeviceToken,
        family.childIds[0],
      );
      const personalB = await service.selectChild(
        personal.rawDeviceToken,
        family.childIds[1],
      );
      const sharedB = await service.selectChild(
        shared.rawDeviceToken,
        family.childIds[1],
      );

      await expect(
        service.requireChildActor(childRequest(sharedA.rawChildSessionToken)),
      ).rejects.toThrow("CHILD_SESSION_INVALID");
      await expect(
        service.requireChildActor(childRequest(personalB.rawChildSessionToken)),
      ).resolves.toMatchObject({
        familyId: family.actor.familyId,
        childId: family.childIds[1],
        deviceId: personal.deviceId,
      });
      await expect(
        service.requireChildActor(
          childRequest(sharedB.rawChildSessionToken, family.childIds[0]),
        ),
      ).resolves.toMatchObject({
        childId: family.childIds[1],
        deviceId: shared.deviceId,
      });
      const [storedSharedSession] = await tx
        .select()
        .from(childSessions)
        .where(
          and(
            eq(childSessions.deviceId, shared.deviceId),
            eq(childSessions.childId, family.childIds[1]),
            isNull(childSessions.revokedAt),
          ),
        );
      expect(storedSharedSession.tokenHash).toBe(
        sha256(sharedB.rawChildSessionToken),
      );
      expect(JSON.stringify(storedSharedSession)).not.toContain(
        sharedB.rawChildSessionToken,
      );
    });
  });

  test("未授权孩子被拒绝；无口令孩子直接进入，有口令孩子执行真实 Argon2 校验", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await familyWithChildren(tx, "儿童口令");
      await tx
        .update(children)
        .set({ childPinHash: await hashChildPin("246810") })
        .where(eq(children.id, family.childIds[1]));
      const service = createDeviceService(tx, { now: () => issuedAt });
      const code = await service.createPairingCode(
        family.actor,
        [family.childIds[0]],
        issuedAt,
      );
      const device = await service.claimPairingCode(code.code, "单人设备");

      await expect(
        service.selectChild(device.rawDeviceToken, family.childIds[0]),
      ).resolves.toHaveProperty("rawChildSessionToken");
      await expect(
        service.selectChild(device.rawDeviceToken, family.childIds[1], "246810"),
      ).rejects.toThrow("CHILD_ACCESS_DENIED");

      const pinCode = await service.createPairingCode(
        family.actor,
        [family.childIds[1]],
        issuedAt,
      );
      const pinDevice = await service.claimPairingCode(
        pinCode.code,
        "口令设备",
      );
      await expect(
        service.selectChild(pinDevice.rawDeviceToken, family.childIds[1]),
      ).rejects.toThrow("CHILD_PIN_REQUIRED");
      await expect(
        service.selectChild(pinDevice.rawDeviceToken, family.childIds[1], "000000"),
      ).rejects.toThrow("CHILD_PIN_INVALID");
      await expect(
        service.selectChild(pinDevice.rawDeviceToken, family.childIds[1], "246810"),
      ).resolves.toHaveProperty("rawChildSessionToken");
    });
  });

  test("撤销本家庭设备在同一事务撤销全部儿童会话，越权和不存在统一错误", async () => {
    await withDatabaseRollback(async (tx) => {
      const familyA = await familyWithChildren(tx, "撤销A");
      const familyB = await familyWithChildren(tx, "撤销B", 1);
      const service = createDeviceService(tx, { now: () => issuedAt });
      const code = await service.createPairingCode(
        familyA.actor,
        familyA.childIds,
        issuedAt,
      );
      const device = await service.claimPairingCode(code.code, "将撤销设备");
      const session = await service.selectChild(
        device.rawDeviceToken,
        familyA.childIds[0],
      );

      await expect(
        service.revokeDevice(familyB.actor, device.deviceId),
      ).rejects.toThrow("DEVICE_NOT_FOUND");
      await expect(
        service.revokeDevice(familyA.actor, crypto.randomUUID()),
      ).rejects.toThrow("DEVICE_NOT_FOUND");

      await service.revokeDevice(familyA.actor, device.deviceId);
      await expect(
        service.requireChildActor(childRequest(session.rawChildSessionToken)),
      ).rejects.toThrow("CHILD_SESSION_INVALID");
      const [storedSession] = await tx
        .select()
        .from(childSessions)
        .where(eq(childSessions.deviceId, device.deviceId));
      expect(storedSession.revokedAt).toEqual(issuedAt);
      const [storedDevice] = await tx
        .select()
        .from(devices)
        .where(
          and(
            eq(devices.id, device.deviceId),
            eq(devices.familyId, familyA.actor.familyId),
          ),
        );
      expect(storedDevice.revokedAt).toEqual(issuedAt);
    });
  });

  test("授权删除会永久删除旧会话，重新授权也不会复活旧 token", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await familyWithChildren(tx, "逐请求校验");
      const service = createDeviceService(tx, { now: () => issuedAt });
      const code = await service.createPairingCode(
        family.actor,
        family.childIds,
        issuedAt,
      );
      const device = await service.claimPairingCode(code.code, "校验设备");
      const selected = await service.selectChild(
        device.rawDeviceToken,
        family.childIds[0],
      );

      await tx
        .delete(deviceChildAccess)
        .where(
          and(
            eq(deviceChildAccess.deviceId, device.deviceId),
            eq(deviceChildAccess.childId, family.childIds[0]),
          ),
        );
      expect(
        await tx
          .select()
          .from(childSessions)
          .where(eq(childSessions.deviceId, device.deviceId)),
      ).toHaveLength(0);

      await tx.insert(deviceChildAccess).values({
        deviceId: device.deviceId,
        familyId: family.actor.familyId,
        childId: family.childIds[0],
        createdAt: new Date(issuedAt.getTime() + 1_000),
      });
      await expect(
        service.requireChildActor(childRequest(selected.rawChildSessionToken)),
      ).rejects.toThrow("CHILD_SESSION_INVALID");
    });
  });

  test("停用孩子入口在同一事务停用档案并撤销全部儿童会话", async () => {
    await withDatabaseRollback(async (tx) => {
      const family = await familyWithChildren(tx, "停用校验", 1);
      const service = createDeviceService(tx, { now: () => issuedAt });
      const code = await service.createPairingCode(
        family.actor,
        family.childIds,
        issuedAt,
      );
      const device = await service.claimPairingCode(code.code, "停用校验设备");
      const selected = await service.selectChild(
        device.rawDeviceToken,
        family.childIds[0],
      );

      await service.deactivateChild(family.actor, family.childIds[0]);
      await expect(
        service.requireChildActor(childRequest(selected.rawChildSessionToken)),
      ).rejects.toThrow("CHILD_SESSION_INVALID");
      const [storedChild] = await tx
        .select({ active: children.active })
        .from(children)
        .where(eq(children.id, family.childIds[0]));
      const [storedSession] = await tx
        .select({ revokedAt: childSessions.revokedAt })
        .from(childSessions)
        .where(eq(childSessions.deviceId, device.deviceId));
      expect(storedChild.active).toBe(false);
      expect(storedSession.revokedAt).toEqual(issuedAt);
    });
  });
});

test("同设备并发 select/select 串行完成且最终只有一个有效会话", async () => {
  await withCommittedFamily("并发选择", 2, async (family) => {
    const service = createDeviceService(db, { now: () => issuedAt });
    const code = await service.createPairingCode(
      family.actor,
      family.childIds,
      issuedAt,
    );
    const device = await service.claimPairingCode(code.code, "并发选择设备");

    const selections = await Promise.all([
      service.selectChild(device.rawDeviceToken, family.childIds[0]),
      service.selectChild(device.rawDeviceToken, family.childIds[1]),
    ]);
    const actors = await Promise.allSettled(
      selections.map((selection) =>
        service.requireChildActor(childRequest(selection.rawChildSessionToken)),
      ),
    );
    expect(actors.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(actors.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      await db
        .select()
        .from(childSessions)
        .where(
          and(
            eq(childSessions.deviceId, device.deviceId),
            isNull(childSessions.revokedAt),
          ),
        ),
    ).toHaveLength(1);
  });
});

test("同设备并发 select/revoke 不死锁且撤销最终状态优先", async () => {
  await withCommittedFamily("并发撤销", 1, async (family) => {
    const service = createDeviceService(db, { now: () => issuedAt });
    const code = await service.createPairingCode(
      family.actor,
      family.childIds,
      issuedAt,
    );
    const device = await service.claimPairingCode(code.code, "并发撤销设备");

    const [selection] = await Promise.allSettled([
      service.selectChild(device.rawDeviceToken, family.childIds[0]),
      service.revokeDevice(family.actor, device.deviceId),
    ]);
    if (selection.status === "fulfilled") {
      await expect(
        service.requireChildActor(
          childRequest(selection.value.rawChildSessionToken),
        ),
      ).rejects.toThrow("CHILD_SESSION_INVALID");
    } else {
      expect(selection.reason).toEqual(
        expect.objectContaining({ message: "DEVICE_INVALID" }),
      );
    }
    const [storedDevice] = await db
      .select({ revokedAt: devices.revokedAt })
      .from(devices)
      .where(eq(devices.id, device.deviceId));
    expect(storedDevice.revokedAt).toEqual(issuedAt);
    expect(
      await db
        .select()
        .from(childSessions)
        .where(
          and(
            eq(childSessions.deviceId, device.deviceId),
            isNull(childSessions.revokedAt),
          ),
        ),
    ).toHaveLength(0);
  });
});

const invalidatingWriterCases: Array<{
  name: string;
  write: (
    family: FamilyFixture,
    deviceId: string,
  ) => Promise<void>;
}> = [
  {
    name: "revoke",
    write: async (family, deviceId) => {
      await createDeviceService(db, {
        now: () => new Date(issuedAt.getTime() + 30_000),
      }).revokeDevice(family.actor, deviceId);
    },
  },
  {
    name: "deactivate",
    write: async (family) => {
      await createDeviceService(db, {
        now: () => new Date(issuedAt.getTime() + 30_000),
      }).deactivateChild(family.actor, family.childIds[0]);
    },
  },
  {
    name: "delete-access",
    write: async (family, deviceId) => {
      await db
        .delete(deviceChildAccess)
        .where(
          and(
            eq(deviceChildAccess.deviceId, deviceId),
            eq(deviceChildAccess.familyId, family.actor.familyId),
            eq(deviceChildAccess.childId, family.childIds[0]),
          ),
        );
    },
  },
];

test.each(invalidatingWriterCases)(
  "candidate 读取后 $name 已提交时认证不得返回旧 actor",
  async ({ name, write }) => {
    await withCommittedFamily(`线性化-${name}`, 1, async (family) => {
      const setupService = createDeviceService(db, { now: () => issuedAt });
      const code = await setupService.createPairingCode(
        family.actor,
        family.childIds,
        issuedAt,
      );
      const device = await setupService.claimPairingCode(
        code.code,
        `线性化-${name}-设备`,
      );
      const session = await setupService.selectChild(
        device.rawDeviceToken,
        family.childIds[0],
      );
      const barrier = createQueryBarrierDatabase("candidate");
      const actorPromise = createDeviceService(barrier.database, {
        now: () => new Date(issuedAt.getTime() + 60_000),
      }).requireChildActor(childRequest(session.rawChildSessionToken));
      try {
        const candidateTimeout = timeoutAfter(
          1_000,
          `未观察到 ${name} 场景的 candidate 查询`,
        );
        try {
          await Promise.race([barrier.queryObserved, candidateTimeout.promise]);
        } finally {
          candidateTimeout.clear();
        }

        const writerTimeout = timeoutAfter(
          1_000,
          `${name} writer 未在 candidate 暂停期间提交`,
        );
        try {
          await Promise.race([
            write(family, device.deviceId),
            writerTimeout.promise,
          ]);
        } finally {
          writerTimeout.clear();
        }
        barrier.releaseQuery();
        const actorTimeout = timeoutAfter(
          1_000,
          `${name} release 后认证未结束`,
        );
        try {
          await expect(
            Promise.race([actorPromise, actorTimeout.promise]),
          ).rejects.toThrow("CHILD_SESSION_INVALID");
        } finally {
          actorTimeout.clear();
        }
      } finally {
        barrier.releaseQuery();
        await actorPromise.catch(() => undefined);
        await barrier.close();
      }
    });
  },
);

test("stale 活动更新与授权级联删除交叉时无锁环且最终认证失效", async () => {
  await withCommittedFamily("活动锁序", 1, async (family) => {
    const setupService = createDeviceService(db, { now: () => issuedAt });
    const code = await setupService.createPairingCode(
      family.actor,
      family.childIds,
      issuedAt,
    );
    const device = await setupService.claimPairingCode(code.code, "活动锁序设备");
    const session = await setupService.selectChild(
      device.rawDeviceToken,
      family.childIds[0],
    );
    const suffix = crypto.randomUUID();
    const authApplicationName = `task5_activity_auth_${suffix}`;
    const writerApplicationName = `task5_activity_writer_${suffix}`;
    const barrier = createQueryBarrierDatabase(
      "session-update",
      authApplicationName,
    );
    const actorOutcome = createDeviceService(barrier.database, {
      now: () => new Date(issuedAt.getTime() + 6 * 60_000),
    })
      .requireChildActor(childRequest(session.rawChildSessionToken))
      .then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    const writerPool = new Pool({
      application_name: writerApplicationName,
      connectionString,
    });
    const writerDatabase = drizzle({
      client: writerPool,
      schema: databaseSchema,
    });
    let writerOutcome:
      | Promise<
          | { status: "fulfilled"; value: unknown }
          | { status: "rejected"; reason: unknown }
        >
      | undefined;
    try {
      await waitForDatabaseCondition(async () => {
        const result = await db.execute(sql<{ observed: boolean }>`
          select exists (
            select 1
            from pg_stat_activity
            where application_name = ${authApplicationName}
              and query like 'update "child_sessions"%'
              and state = 'idle in transaction'
          ) as observed
        `);
        return result.rows[0]?.observed === true;
      }, "认证未在持有 stale session 更新锁时暂停");

      writerOutcome = writerDatabase
        .delete(deviceChildAccess)
        .where(
          and(
            eq(deviceChildAccess.deviceId, device.deviceId),
            eq(deviceChildAccess.familyId, family.actor.familyId),
            eq(deviceChildAccess.childId, family.childIds[0]),
          ),
        )
        .then(
          (value) => ({ status: "fulfilled" as const, value }),
          (reason: unknown) => ({ status: "rejected" as const, reason }),
        );
      await waitForDatabaseCondition(async () => {
        const result = await db.execute(sql<{ blocked: boolean }>`
          select exists (
            select 1
            from pg_stat_activity writer
            join pg_stat_activity auth
              on auth.application_name = ${authApplicationName}
            where writer.application_name = ${writerApplicationName}
              and writer.query like 'delete from "device_child_access"%'
              and auth.pid = any(pg_blocking_pids(writer.pid))
          ) as blocked
        `);
        return result.rows[0]?.blocked === true;
      }, "授权级联删除未等待 stale session 更新锁");

      barrier.releaseQuery();
      const completionTimeout = timeoutAfter(
        3_000,
        "活动更新与授权删除未在释放锁后完成",
      );
      try {
        const [actorResult, writerResult] = await Promise.race([
          Promise.all([actorOutcome, writerOutcome]),
          completionTimeout.promise,
        ]);
        if (writerResult.status === "rejected") throw writerResult.reason;
        expect(writerResult.status).toBe("fulfilled");
        expect(actorResult.status).toBe("rejected");
        if (actorResult.status === "rejected") {
          expect(actorResult.reason).toEqual(
            expect.objectContaining({ message: "CHILD_SESSION_INVALID" }),
          );
        }
      } finally {
        completionTimeout.clear();
      }
    } finally {
      barrier.releaseQuery();
      await actorOutcome;
      await writerOutcome;
      await barrier.close();
      await writerPool.end();
    }
  });
});

test("认证先取得最终共享锁时 writer 等待，认证提交后撤销再生效", async () => {
  await withCommittedFamily("共享锁线性化", 1, async (family) => {
    const setupService = createDeviceService(db, { now: () => issuedAt });
    const code = await setupService.createPairingCode(
      family.actor,
      family.childIds,
      issuedAt,
    );
    const device = await setupService.claimPairingCode(
      code.code,
      "共享锁线性化设备",
    );
    const session = await setupService.selectChild(
      device.rawDeviceToken,
      family.childIds[0],
    );
    const barrier = createQueryBarrierDatabase("final-session");
    const actorPromise = createDeviceService(barrier.database, {
      now: () => new Date(issuedAt.getTime() + 60_000),
    }).requireChildActor(childRequest(session.rawChildSessionToken));
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    const applicationName = `task5_linear_writer_${crypto.randomUUID()}`;
    const writerPool = new Pool({
      application_name: applicationName,
      connectionString,
    });
    const writerDatabase = drizzle({
      client: writerPool,
      schema: databaseSchema,
    });
    let writerPromise: Promise<void> | undefined;
    try {
      const validationTimeout = timeoutAfter(
        1_000,
        "认证未到达最终 session 共享锁",
      );
      try {
        await Promise.race([
          barrier.queryObserved,
          validationTimeout.promise,
        ]);
      } finally {
        validationTimeout.clear();
      }

      writerPromise = createDeviceService(writerDatabase, {
        now: () => new Date(issuedAt.getTime() + 30_000),
      }).revokeDevice(family.actor, device.deviceId);
      await waitForDatabaseCondition(async () => {
        const blocked = await db.execute(sql<{ blocked: boolean }>`
          select exists (
            select 1
            from pg_stat_activity
            where application_name = ${applicationName}
              and cardinality(pg_blocking_pids(pid)) > 0
          ) as blocked
        `);
        return blocked.rows[0]?.blocked === true;
      }, "writer 未等待认证事务的共享锁");

      barrier.releaseQuery();
      await expect(actorPromise).resolves.toMatchObject({
        childId: family.childIds[0],
        deviceId: device.deviceId,
      });
      await writerPromise;
      await expect(
        setupService.requireChildActor(
          childRequest(session.rawChildSessionToken),
        ),
      ).rejects.toThrow("CHILD_SESSION_INVALID");
    } finally {
      barrier.releaseQuery();
      await actorPromise.catch(() => undefined);
      await writerPromise?.catch(() => undefined);
      await barrier.close();
      await writerPool.end();
    }
  });
});

test("12 个同设备读取共享锁并发且最近活跃仅在阈值外原子更新一次", async () => {
  await withCommittedFamily("读取节流", 1, async (family) => {
    const initialService = createDeviceService(db, { now: () => issuedAt });
    const code = await initialService.createPairingCode(
      family.actor,
      family.childIds,
      issuedAt,
    );
    const device = await initialService.claimPairingCode(code.code, "读取节流设备");
    const session = await initialService.selectChild(
      device.rawDeviceToken,
      family.childIds[0],
    );
    const withinThresholdService = createDeviceService(db, {
      now: () => new Date(issuedAt.getTime() + 60_000),
    });

    await db.transaction(async (lockTx) => {
      await lockTx
        .select({ id: devices.id })
        .from(devices)
        .where(eq(devices.id, device.deviceId))
        .for("share");
      await lockTx
        .select({ deviceId: deviceChildAccess.deviceId })
        .from(deviceChildAccess)
        .where(
          and(
            eq(deviceChildAccess.deviceId, device.deviceId),
            eq(deviceChildAccess.familyId, family.actor.familyId),
            eq(deviceChildAccess.childId, family.childIds[0]),
          ),
        )
        .for("share");
      await lockTx
        .select({ id: children.id })
        .from(children)
        .where(eq(children.id, family.childIds[0]))
        .for("share");
      await lockTx
        .select({ id: childSessions.id })
        .from(childSessions)
        .where(eq(childSessions.tokenHash, sha256(session.rawChildSessionToken)))
        .for("share");
      const timeout = timeoutAfter(
        1_000,
        "child actor reads were serialized by an exclusive device lock",
      );
      try {
        const reads = Promise.all(
          Array.from({ length: 12 }, () =>
            withinThresholdService.requireChildActor(
              childRequest(session.rawChildSessionToken),
            ),
          ),
        );
        await expect(
          Promise.race([reads, timeout.promise]),
        ).resolves.toHaveLength(12);
      } finally {
        timeout.clear();
      }
    });

    const suffix = crypto.randomUUID().replaceAll("-", "");
    const auditTable = `task5_activity_audit_${suffix}`;
    const auditFunction = `task5_activity_audit_fn_${suffix}`;
    const deviceTrigger = `task5_device_activity_trigger_${suffix}`;
    const sessionTrigger = `task5_session_activity_trigger_${suffix}`;
    await db.execute(sql.raw(`create table "${auditTable}" (source text not null)`));
    await db.execute(sql.raw(`
      create function "${auditFunction}"() returns trigger
      language plpgsql as $$
      begin
        insert into "${auditTable}" (source) values (TG_TABLE_NAME);
        return NEW;
      end;
      $$
    `));
    await db.execute(sql.raw(`
      create trigger "${deviceTrigger}"
      after update of last_active_at on devices
      for each row when (NEW.id = '${device.deviceId}'::uuid)
      execute function "${auditFunction}"()
    `));
    await db.execute(sql.raw(`
      create trigger "${sessionTrigger}"
      after update of last_active_at on child_sessions
      for each row when (NEW.token_hash = '${sha256(session.rawChildSessionToken)}')
      execute function "${auditFunction}"()
    `));
    try {
      const afterThreshold = new Date(issuedAt.getTime() + 6 * 60_000);
      const afterThresholdService = createDeviceService(db, {
        now: () => afterThreshold,
      });
      await Promise.all(
        Array.from({ length: 12 }, () =>
          afterThresholdService.requireChildActor(
            childRequest(session.rawChildSessionToken),
          ),
        ),
      );
      await Promise.all(
        Array.from({ length: 12 }, () =>
          afterThresholdService.requireChildActor(
            childRequest(session.rawChildSessionToken),
          ),
        ),
      );

      const audit = await db.execute(sql.raw(`
        select source, count(*)::integer as updates
        from "${auditTable}"
        group by source
        order by source
      `));
      expect(audit.rows).toEqual([
        { source: "child_sessions", updates: 1 },
        { source: "devices", updates: 1 },
      ]);
      const [storedSession] = await db
        .select({ lastActiveAt: childSessions.lastActiveAt })
        .from(childSessions)
        .where(eq(childSessions.tokenHash, sha256(session.rawChildSessionToken)));
      const [storedDevice] = await db
        .select({ lastActiveAt: devices.lastActiveAt })
        .from(devices)
        .where(eq(devices.id, device.deviceId));
      expect(storedSession.lastActiveAt).toEqual(afterThreshold);
      expect(storedDevice.lastActiveAt).toEqual(afterThreshold);
    } finally {
      await db.execute(sql.raw(`drop trigger if exists "${sessionTrigger}" on child_sessions`));
      await db.execute(sql.raw(`drop trigger if exists "${deviceTrigger}" on devices`));
      await db.execute(sql.raw(`drop function if exists "${auditFunction}"()`));
      await db.execute(sql.raw(`drop table if exists "${auditTable}"`));
    }
  });
});

test("公开 requireChildActor 从 HttpOnly cookie 对应的会话推导 actor", async () => {
  const family = await db.transaction((tx) =>
    familyWithChildren(tx, "公开Actor", 1),
  );
  try {
    const service = createDeviceService(db, { now: () => issuedAt });
    const code = await service.createPairingCode(
      family.actor,
      family.childIds,
      issuedAt,
    );
    const device = await service.claimPairingCode(code.code, "公开Actor设备");
    const selected = await service.selectChild(
      device.rawDeviceToken,
      family.childIds[0],
    );

    await expect(
      requireChildActor(childRequest(selected.rawChildSessionToken)),
    ).resolves.toMatchObject({
      role: "child",
      familyId: family.actor.familyId,
      childId: family.childIds[0],
      deviceId: device.deviceId,
    });
  } finally {
    await db.delete(families).where(eq(families.id, family.actor.familyId));
    await db.delete(authUsers).where(eq(authUsers.id, family.authUserId));
  }
});
