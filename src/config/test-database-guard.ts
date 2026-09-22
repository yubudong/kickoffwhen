type TestEnvironmentSource = Record<string, string | undefined>;

export type TestMode = "unit" | "integration" | "e2e";

export function assertTestDatabaseSafety(
  source: TestEnvironmentSource,
  expectedMode: TestMode,
): { databaseName: string } {
  if (source.FAMILY_LEARNING_TEST_MODE !== expectedMode) {
    throw new Error("TEST_MODE_REQUIRED");
  }

  let databaseName = "";
  try {
    const databaseUrl = new URL(source.DATABASE_URL ?? "");
    databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("TEST_DATABASE_REQUIRED");
  }

  if (!databaseName.endsWith("_test")) {
    throw new Error("TEST_DATABASE_REQUIRED");
  }

  return { databaseName };
}
