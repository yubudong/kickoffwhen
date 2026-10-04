import { expect, test } from "vitest";
import { sql } from "drizzle-orm";

import { children, families, guardians } from "@/modules/families/schema";
import { user as authUsers } from "@/modules/auth/schema";
import { withDatabaseRollback } from "../helpers/database";

test("孩子必须属于一个家庭且昵称在家庭内可重复以外不串号", async () => {
  await withDatabaseRollback(async (tx) => {
    const [familyA] = await tx.insert(families).values({ name: "测试家庭 A" }).returning();
    const [familyB] = await tx.insert(families).values({ name: "测试家庭 B" }).returning();

    const [childA] = await tx
      .insert(children)
      .values({
        familyId: familyA.id,
        nickname: "小雨",
        grade: 5,
      })
      .returning();
    const [childB] = await tx
      .insert(children)
      .values({
        familyId: familyB.id,
        nickname: "小雨",
        grade: 3,
      })
      .returning();

    expect(childA.familyId).toBe(familyA.id);
    expect(childB.familyId).toBe(familyB.id);
    expect(childA.id).not.toBe(childB.id);
  });
});

test("家长 PIN 必须保存所属家庭并接受与 guardian 一致的家庭配对", async () => {
  await withDatabaseRollback(async (tx) => {
    await tx.insert(authUsers).values({
      id: "guardian-valid-parent-pin",
      name: "PIN 家长",
      email: "guardian-valid-parent-pin@example.test",
    });
    const [family] = await tx.insert(families).values({ name: "PIN 家庭" }).returning();
    const [guardian] = await tx
      .insert(guardians)
      .values({
        familyId: family.id,
        authUserId: "guardian-valid-parent-pin",
      })
      .returning();

    await tx.execute(sql`
      insert into parent_pins (guardian_id, family_id, pin_hash)
      values (${guardian.id}, ${family.id}, 'hash-valid')
    `);
  });
});

test("家长 PIN 不能引用与 guardian 不一致的家庭", async () => {
  await withDatabaseRollback(async (tx) => {
    await tx.insert(authUsers).values({
      id: "guardian-invalid-parent-pin",
      name: "PIN 家长",
      email: "guardian-invalid-parent-pin@example.test",
    });
    const [familyA] = await tx.insert(families).values({ name: "PIN 家庭 A" }).returning();
    const [familyB] = await tx.insert(families).values({ name: "PIN 家庭 B" }).returning();
    const [guardian] = await tx
      .insert(guardians)
      .values({
        familyId: familyA.id,
        authUserId: "guardian-invalid-parent-pin",
      })
      .returning();

    await expect(
      tx.execute(sql`
        insert into parent_pins (guardian_id, family_id, pin_hash)
        values (${guardian.id}, ${familyB.id}, 'hash-invalid')
      `),
    ).rejects.toThrow();
  });
});

test("guardian 不能引用不存在的认证用户", async () => {
  await withDatabaseRollback(async (tx) => {
    const [family] = await tx
      .insert(families)
      .values({ name: "完整性测试家庭" })
      .returning();

    await expect(
      tx.insert(guardians).values({
        familyId: family.id,
        authUserId: "missing-auth-user",
      }),
    ).rejects.toThrow();
  });
});

test("已有 guardian membership 时禁止删除认证用户", async () => {
  await withDatabaseRollback(async (tx) => {
    const authUserId = "guardian-delete-restricted";
    await tx.insert(authUsers).values({
      id: authUserId,
      name: "保留家长",
      email: "guardian-delete-restricted@example.test",
    });
    const [family] = await tx
      .insert(families)
      .values({ name: "防孤儿记录家庭" })
      .returning();
    await tx.insert(guardians).values({ familyId: family.id, authUserId });

    await expect(
      tx.delete(authUsers).where(sql`${authUsers.id} = ${authUserId}`),
    ).rejects.toThrow();
  });
});
