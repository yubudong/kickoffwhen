import { expect, test } from "vitest";

import { isFamilyAlreadyExistsConflict } from "@/modules/families/errors";

test("只把 guardians_auth_user_unique 的 23505 视为重复建家", () => {
  const expected = Object.assign(new Error("expected membership conflict"), {
    code: "23505",
    constraint: "guardians_auth_user_unique",
  });
  const other = Object.assign(new Error("other unique conflict"), {
    code: "23505",
    constraint: "guardians_one_owner_per_family_unique",
  });

  expect(isFamilyAlreadyExistsConflict(new Error("wrapped", { cause: expected }))).toBe(
    true,
  );
  expect(isFamilyAlreadyExistsConflict(new Error("wrapped", { cause: other }))).toBe(
    false,
  );
});

test("解包 cause 链遇到循环引用会停止并返回 false", () => {
  const cyclic: Error & { cause?: unknown } = new Error("cyclic wrapper");
  cyclic.cause = cyclic;

  expect(isFamilyAlreadyExistsConflict(cyclic)).toBe(false);
});
