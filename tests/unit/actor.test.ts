import { describe, expect, it } from "vitest";

import {
  actorFromSession,
  familyOwnerActorFromSession,
  onboardingDestination,
} from "@/modules/auth/actor";

describe("actorFromSession", () => {
  it("没有家庭成员记录时拒绝家长身份", async () => {
    await expect(actorFromSession({ user: { id: "user-1" } }, null)).rejects.toThrow(
      "GUARDIAN_MEMBERSHIP_REQUIRED",
    );
  });

  it("将已登录用户的家庭成员记录转为家长身份", async () => {
    await expect(
      actorFromSession(
        { user: { id: "user-1" } },
        { id: "guardian-1", familyId: "family-1" },
      ),
    ).resolves.toEqual({
      role: "guardian",
      guardianId: "guardian-1",
      familyId: "family-1",
    });
  });

  it("没有登录会话时拒绝家长身份", async () => {
    await expect(
      actorFromSession(null, { id: "guardian-1", familyId: "family-1" }),
    ).rejects.toThrow("GUARDIAN_MEMBERSHIP_REQUIRED");
  });
});

describe("familyOwnerActorFromSession", () => {
  it("拒绝已有家庭但不是 owner 的监护人", async () => {
    await expect(
      familyOwnerActorFromSession(
        { user: { id: "user-2" } },
        {
          id: "guardian-2",
          familyId: "family-1",
          isOwner: false,
        },
      ),
    ).rejects.toThrow("FAMILY_OWNER_REQUIRED");
  });

  it("只为 owner membership 生成明确的家庭 owner actor", async () => {
    await expect(
      familyOwnerActorFromSession(
        { user: { id: "user-1" } },
        {
          id: "guardian-1",
          familyId: "family-1",
          isOwner: true,
        },
      ),
    ).resolves.toEqual({
      role: "guardian",
      familyRole: "owner",
      guardianId: "guardian-1",
      familyId: "family-1",
    });
  });
});

describe("onboardingDestination", () => {
  it("未登录用户去登录页", () => {
    expect(onboardingDestination(null, null)).toBe("sign-in");
  });

  it("已有家庭成员记录的家长去家长中心", () => {
    expect(
      onboardingDestination(
        { user: { id: "user-1" } },
        { id: "guardian-1", familyId: "family-1" },
      ),
    ).toBe("parent");
  });

  it("仅已认证但无成员记录的用户留在 onboarding", () => {
    expect(onboardingDestination({ user: { id: "user-1" } }, null)).toBe(
      "onboarding",
    );
  });
});
