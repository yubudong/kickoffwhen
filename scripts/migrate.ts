import { Pool } from "pg";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { readEnv } from "@/config/env";
import { assertTestDatabaseSafety } from "@/config/test-database-guard";

async function main() {
  const env = readEnv();
  const testMode = process.env.FAMILY_LEARNING_TEST_MODE;
  if (testMode === "integration" || testMode === "e2e") {
    assertTestDatabaseSafety(process.env, testMode);
  }
  const pool = new Pool({ connectionString: env.databaseUrl });

  try {
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  } finally {
    await pool.end();
  }
}

void main();
