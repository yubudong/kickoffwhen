import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, test, vi } from "vitest";

import { db, type DbTransaction } from "@/db/client";
import { familyOwnerActorForAuthUser } from "@/modules/auth/actor";
import { user as authUsers } from "@/modules/auth/schema";
import {
  createFamilyService,
  type FamilyService,
} from "@/modules/families/service";
import {
  children,
  families,
  guardians,
  parentPins,
} from "@/modules/families/schema";
import { withDatabaseRollback } from "../helpers/database";

const fixedNow = new Date("2026-09-01T08:00:00.000Z");
const createdAuthUserIds = new Set<string>();

const fastPins = {
  hashChildPin: async (pin: string) => `child-test-hash-${pin.length}`,
  hashParentPin: async (pin: string) => `parent-test-hash-${pin.length}`,
  verifyPinHash: async (hash: string, pin: string) =>
    hash === "parent-test-hash-6" && pin === "482731",
};

async function insertAuthUser(
  database: typeof db | DbTransaction,
  suffix: string,
  trackForCleanup = false,
) {
  const authUserId = `task4-${suffix}-${crypto.randomUUID()}`;
  await database.insert(authUsers).values({
    id: authUserId,
    name: `家长 ${suffix}`,
    email: `${authUserId}@example.test`,
  });
  if (trackForCleanup) createdAuthUserIds.add(authUserId);
  return authUserId;
}

async function createOwner(service: FamilyService, authUserId: string, suffix: string) {
  return service.createFamilyOwner(authUserId, {
    familyName: `家庭 ${suffix}`,
    ownerName: `家长 ${suffix.slice(0, 20)}`,
  });
}

afterEach(async () => {
  for (const authUserId of createdAuthUserIds) {
    const membership = await db.query.guardians.findFirst({
      where: eq(guardians.authUserId, authUserId),
    });
    if (membership) {
      await db.delete(families).where(eq(families.id, membership.familyId));
    }
    await db.delete(authUsers).where(eq(authUsers.id, authUserId));
    createdAuthUserIds.delete(authUserId);
  }
});

describe("family service", () => {
  test("真实数据库中的非 owner guardian 不能获得家庭 owner actor", async () => {
    await withDatabaseRollback(async (tx) => {
      const ownerAuthUserId = await insertAuthUser(tx, "real-owner");
      const memberAuthUserId = await insertAuthUser(tx, "non-owner");
      const [family] = await tx
        .insert(families)
        .values({ name: "真实非 owner 测试家庭" })
        .returning();
      await tx.insert(guardians).values([
        {
          authUserId: ownerAuthUserId,
          displayName: "Owner",
          familyId: family.id,
          isOwner: true,
        },
        {
          authUserId: memberAuthUserId,
          displayName: "Member",
          familyId: family.id,
          isOwner: false,
        },
      ]);

      await expect(
        familyOwnerActorForAuthUser(memberAuthUserId, tx),
      ).rejects.toThrow("FAMILY_OWNER_REQUIRED");
      await expect(
        familyOwnerActorForAuthUser(ownerAuthUserId, tx),
      ).resolves.toMatchObject({
        familyId: family.id,
        familyRole: "owner",
      });
    });
  });

  test("建立家庭时在同一事务保存家庭和唯一 owner membership", async () => {
    await withDatabaseRollback(async (tx) => {
      const authUserId = await insertAuthUser(tx, "owner");
      const service = createFamilyService(tx, fastPins);

      const actor = await createOwner(service, authUserId, "A");
      const family = await tx.query.families.findFirst({
        where: eq(families.id, actor.familyId),
      });
      const owner = await tx.query.guardians.findFirst({
        where: eq(guardians.id, actor.guardianId),
      });

      expect(actor).toEqual({
        role: "guardian",
        familyRole: "owner",
        familyId: family?.id,
        guardianId: owner?.id,
      });
      expect(family?.name).toBe("家庭 A");
      expect(owner).toMatchObject({
        authUserId,
        displayName: "家长 A",
        isOwner: true,
      });
    });
  });

  test("已有 membership 的用户顺序重复建家返回 FAMILY_ALREADY_EXISTS", async () => {
    await withDatabaseRollback(async (tx) => {
      const authUserId = await insertAuthUser(tx, "sequential-family");
      const service = createFamilyService(tx, fastPins);
      const actor = await createOwner(service, authUserId, "顺序 A");

      await expect(
        createOwner(service, authUserId, "顺序 B"),
      ).rejects.toThrow("FAMILY_ALREADY_EXISTS");
      const memberships = await tx
        .select()
        .from(guardians)
        .where(eq(guardians.authUserId, authUserId));
      const ownedFamilies = await tx
        .select()
        .from(families)
        .where(eq(families.id, actor.familyId));
      expect(memberships).toHaveLength(1);
      expect(ownedFamilies).toHaveLength(1);
    });
  });

  test("同一认证用户并发建立家庭不会留下孤儿家庭", async () => {
    const authUserId = await insertAuthUser(db, "concurrent-owner", true);
    const service = createFamilyService(db, fastPins);
    const familySuffix = crypto.randomUUID();
    const familyNames = [
      `家庭 并发 A-${familySuffix}`,
      `家庭 并发 B-${familySuffix}`,
    ];

    const results = await Promise.allSettled([
      createOwner(service, authUserId, `并发 A-${familySuffix}`),
      createOwner(service, authUserId, `并发 B-${familySuffix}`),
    ]);

    const memberships = await db
      .select()
      .from(guardians)
      .where(eq(guardians.authUserId, authUserId));
    const candidateFamilies = await db
      .select()
      .from(families)
      .where(inArray(families.name, familyNames));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({ message: "FAMILY_ALREADY_EXISTS" }),
    });
    expect(memberships).toHaveLength(1);
    expect(candidateFamilies).toHaveLength(1);
  });

  test("其他唯一约束的 23505 保持原错误且不转换为重复建家", async () => {
    const otherConstraint = Object.assign(new Error("other unique conflict"), {
      code: "23505",
      constraint: "guardians_one_owner_per_family_unique",
    });
    const wrapped = new Error("query failed", { cause: otherConstraint });
    const database = {
      transaction: async () => {
        throw wrapped;
      },
    } as unknown as typeof db;
    const service = createFamilyService(database, fastPins);

    await expect(
      service.createFamilyOwner("auth-user", {
        familyName: "不应被吞掉的冲突",
        ownerName: "Owner",
      }),
    ).rejects.toBe(wrapped);
  });

  test("创建孩子只使用 actor 家庭并持久化教材 ID 和可选口令哈希", async () => {
    await withDatabaseRollback(async (tx) => {
      const authUserId = await insertAuthUser(tx, "child");
      const service = createFamilyService(tx, fastPins);
      const actor = await createOwner(service, authUserId, "孩子");

      const child = await service.createChild(actor, {
        nickname: "小北",
        avatarKey: "rocket-blue",
        grade: 4,
        textbookEditionIds: ["cn-pep-4a", "math-pep-4a"],
        childPin: "246810",
      });
      const stored = await tx.query.children.findFirst({
        where: eq(children.id, child.id),
      });

      expect(child).toEqual({
        id: stored?.id,
        familyId: actor.familyId,
        nickname: "小北",
        avatarKey: "rocket-blue",
        grade: 4,
        active: true,
      });
      expect(stored?.textbookEditionIds).toEqual([
        "cn-pep-4a",
        "math-pep-4a",
      ]);
      expect(stored?.childPinHash).toBe("child-test-hash-6");
      expect(stored?.childPinHash).not.toContain("246810");
    });
  });

  test("统一家庭入门状态按 PIN、首个孩子、完成依次推进", async () => {
    await withDatabaseRollback(async (tx) => {
      const authUserId = await insertAuthUser(tx, "setup-stage");
      const service = createFamilyService(tx, fastPins);
      const actor = await createOwner(service, authUserId, "状态");

      await expect(service.getFamilySetupStage(actor)).resolves.toBe("pin");
      await service.setParentPin(actor, "482731");
      await expect(service.getFamilySetupStage(actor)).resolves.toBe("child");
      await service.createChild(actor, {
        nickname: "小星",
        avatarKey: "child-1",
        grade: 2,
        textbookEditionIds: [],
      });
      await expect(service.getFamilySetupStage(actor)).resolves.toBe("complete");
    });
  });

  test("家长不能修改其他家庭的孩子且错误不泄露孩子是否存在", async () => {
    await withDatabaseRollback(async (tx) => {
      const service = createFamilyService(tx, fastPins);
      const userA = await insertAuthUser(tx, "isolation-a");
      const userB = await insertAuthUser(tx, "isolation-b");
      const actorA = await createOwner(service, userA, "A");
      const actorB = await createOwner(service, userB, "B");
      const childB = await service.createChild(actorB, {
        nickname: "小北",
        avatarKey: "child-1",
        grade: 3,
        textbookEditionIds: [],
      });

      await expect(
        service.renameChild(actorA, childB.id, "越权"),
      ).rejects.toThrow("CHILD_NOT_FOUND");
      await expect(
        service.renameChild(actorA, crypto.randomUUID(), "不存在"),
      ).rejects.toThrow("CHILD_NOT_FOUND");
    });
  });

  test("连续 5 次错误 PIN 锁定 15 分钟，成功后清零", async () => {
    await withDatabaseRollback(async (tx) => {
      const authUserId = await insertAuthUser(tx, "pin-lock");
      const verifyPinHash = vi.fn(fastPins.verifyPinHash);
      const service = createFamilyService(tx, { ...fastPins, verifyPinHash });
      const actor = await createOwner(service, authUserId, "PIN");
      await service.setParentPin(actor, "482731");

      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await expect(
          service.verifyParentPin(actor, "000000", fixedNow),
        ).resolves.toBe(false);
      }

      const locked = await tx.query.parentPins.findFirst({
        where: and(
          eq(parentPins.guardianId, actor.guardianId),
          eq(parentPins.familyId, actor.familyId),
        ),
      });
      expect(locked?.failedAttempts).toBe(5);
      expect(locked?.lockedUntil?.toISOString()).toBe(
        "2026-09-01T08:15:00.000Z",
      );
      verifyPinHash.mockClear();
      await expect(
        service.verifyParentPin(actor, "482731", new Date("2026-09-01T08:14:59Z")),
      ).resolves.toBe(false);
      expect(verifyPinHash).not.toHaveBeenCalled();
      await expect(
        service.verifyParentPin(actor, "482731", new Date("2026-09-01T08:15:00Z")),
      ).resolves.toBe(true);
      expect(verifyPinHash).toHaveBeenCalledOnce();

      const reset = await tx.query.parentPins.findFirst({
        where: eq(parentPins.guardianId, actor.guardianId),
      });
      expect(reset?.failedAttempts).toBe(0);
      expect(reset?.lockedUntil).toBeNull();
    });
  });

  test("更新家长 PIN 也不能绕过 guardian 与家庭的一致性约束", async () => {
    await withDatabaseRollback(async (tx) => {
      const service = createFamilyService(tx, fastPins);
      const userA = await insertAuthUser(tx, "pin-family-a");
      const userB = await insertAuthUser(tx, "pin-family-b");
      const actorA = await createOwner(service, userA, "PIN A");
      const actorB = await createOwner(service, userB, "PIN B");
      await service.setParentPin(actorA, "482731");

      await expect(
        service.setParentPin(
          { ...actorA, familyId: actorB.familyId },
          "135790",
        ),
      ).rejects.toThrow();
    });
  });

  test("并发 PIN 错误验证不丢失计数并在第 5 次锁定", async () => {
    const authUserId = await insertAuthUser(db, "concurrent-pin", true);
    const service = createFamilyService(db, fastPins);
    const actor = await createOwner(service, authUserId, "并发 PIN");
    await service.setParentPin(actor, "482731");

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.verifyParentPin(actor, "000000", fixedNow),
      ),
    );
    const stored = await db.query.parentPins.findFirst({
      where: eq(parentPins.guardianId, actor.guardianId),
    });

    expect(results).toEqual([false, false, false, false, false]);
    expect(stored?.failedAttempts).toBe(5);
    expect(stored?.lockedUntil?.toISOString()).toBe(
      "2026-09-01T08:15:00.000Z",
    );
  });
});
