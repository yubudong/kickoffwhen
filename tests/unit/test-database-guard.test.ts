import { describe, expect, test } from "vitest";

import { assertTestDatabaseSafety } from "@/config/test-database-guard";

describe("assertTestDatabaseSafety", () => {
  test("integration startup rejects a missing explicit test mode", () => {
    expect(() =>
      assertTestDatabaseSafety(
        {
          DATABASE_URL:
            "postgres://app:app@127.0.0.1:5433/family_learning_test",
        },
        "integration",
      ),
    ).toThrow("TEST_MODE_REQUIRED");
  });

  test.each([
    "postgres://app:app@127.0.0.1:5433/family_learning",
    "postgres://app:app@127.0.0.1:5433/family_learning_test_shadow",
    "not-a-database-url",
  ])("integration startup rejects unsafe database URL %s", (databaseUrl) => {
    expect(() =>
      assertTestDatabaseSafety(
        {
          DATABASE_URL: databaseUrl,
          FAMILY_LEARNING_TEST_MODE: "integration",
        },
        "integration",
      ),
    ).toThrow("TEST_DATABASE_REQUIRED");
  });

  test("integration startup accepts only the requested mode and a _test database", () => {
    expect(
      assertTestDatabaseSafety(
        {
          DATABASE_URL:
            "postgres://app:app@127.0.0.1:5433/family_learning_test",
          FAMILY_LEARNING_TEST_MODE: "integration",
        },
        "integration",
      ),
    ).toEqual({ databaseName: "family_learning_test" });
  });
});
