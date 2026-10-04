import { describe, expect, test } from "vitest";

import {
  hashChildPin,
  hashParentPin,
  verifyPinHash,
} from "@/modules/auth/parent-pin";

describe("PIN 哈希", () => {
  test("家长 PIN 使用 Argon2id 哈希且只有正确 PIN 能通过", async () => {
    const hash = await hashParentPin("482731");

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("482731");
    await expect(verifyPinHash(hash, "000000")).resolves.toBe(false);
    await expect(verifyPinHash(hash, "482731")).resolves.toBe(true);
  });

  test("家长 PIN 必须恰好是 6 位数字", () => {
    expect(() => hashParentPin("12345")).toThrow("PIN_MUST_BE_6_DIGITS");
    expect(() => hashParentPin("12345a")).toThrow("PIN_MUST_BE_6_DIGITS");
  });

  test("可选儿童口令也只保存可验证的 Argon2id 哈希", async () => {
    const hash = await hashChildPin("246810");

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("246810");
    await expect(verifyPinHash(hash, "246810")).resolves.toBe(true);
  });
});
