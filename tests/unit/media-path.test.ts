import path from "node:path";

import { describe, expect, test } from "vitest";

import type { Actor } from "@/modules/auth/actor";
import { authorizePrivateMediaAccess } from "@/modules/media/service";
import { mediaDiskPath } from "@/modules/media/store";

const guardian: Actor = {
  role: "guardian",
  familyId: "018f3b5d-1111-7111-8111-111111111111",
  guardianId: "018f3b5d-2222-7222-8222-222222222222",
};
const child: Actor = {
  role: "child",
  familyId: guardian.familyId,
  childId: "018f3b5d-3333-7333-8333-333333333333",
  deviceId: "018f3b5d-4444-7444-8444-444444444444",
};

test("媒体ID不能逃出私密目录", () => {
  expect(() => mediaDiskPath("../etc/passwd")).toThrow("INVALID_MEDIA_ID");

  const resolved = mediaDiskPath(
    "018f3b5d-1111-7111-8111-111111111111",
    "/srv/private/var/media",
  );
  expect(resolved).toContain(path.join("var", "media", "01", "8f", "018f3b5d"));
  expect(path.relative("/srv/private/var/media", resolved)).not.toMatch(/^\.\./);
});

describe("私密媒体授权", () => {
  test("家长只能读取本家庭媒体", () => {
    expect(
      authorizePrivateMediaAccess(guardian, {
        familyId: guardian.familyId,
        childId: null,
        kind: "ocr_source",
        deletedAt: null,
      }),
    ).toBe(true);
    expect(
      authorizePrivateMediaAccess(guardian, {
        familyId: "018f3b5d-9999-7999-8999-999999999999",
        childId: null,
        kind: "ocr_source",
        deletedAt: null,
      }),
    ).toBe(false);
  });

  test("没有活动任务关联证明时，儿童读取 TTS 默认拒绝", () => {
    expect(
      authorizePrivateMediaAccess(child, {
        familyId: child.familyId,
        childId: child.childId,
        kind: "tts_audio",
        deletedAt: null,
      }),
    ).toBe(false);
  });

  test("儿童仅在有活动任务证明且 TTS 绑定本人时通过", () => {
    expect(
      authorizePrivateMediaAccess(
        child,
        {
          familyId: child.familyId,
          childId: child.childId,
          kind: "tts_audio",
          deletedAt: null,
        },
        true,
      ),
    ).toBe(true);
    expect(
      authorizePrivateMediaAccess(
        child,
        {
          familyId: child.familyId,
          childId: null,
          kind: "ocr_source",
          deletedAt: null,
        },
        true,
      ),
    ).toBe(false);
  });

  test("儿童不能读取OCR原图且已删除媒体对所有角色拒绝", () => {
    expect(
      authorizePrivateMediaAccess(child, {
        familyId: child.familyId,
        childId: child.childId,
        kind: "ocr_source",
        deletedAt: null,
      }),
    ).toBe(false);
    expect(
      authorizePrivateMediaAccess(guardian, {
        familyId: guardian.familyId,
        childId: null,
        kind: "ocr_source",
        deletedAt: new Date(),
      }),
    ).toBe(false);
  });
});
