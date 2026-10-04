import { Pool } from "pg";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

import { readEnv } from "@/config/env";
import { assertTestDatabaseSafety } from "@/config/test-database-guard";

import * as schema from "./schema";

const env = readEnv();
if (
  process.env.FAMILY_LEARNING_TEST_MODE === "integration" ||
  process.env.FAMILY_LEARNING_TEST_MODE === "e2e"
) {
  assertTestDatabaseSafety(
    process.env,
    process.env.FAMILY_LEARNING_TEST_MODE,
  );
}
const pool = new Pool({ connectionString: env.databaseUrl });

export const db: NodePgDatabase<typeof schema> = drizzle({
  client: pool,
  schema,
});

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ROLLBACK_ERROR = new Error("test transaction rollback");

export async function withTestTransaction<T>(
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  let completed = false;
  let result!: T;

  try {
    await db.transaction(async (tx) => {
      result = await fn(tx);
      completed = true;
      throw ROLLBACK_ERROR;
    });
  } catch (error) {
    if (error !== ROLLBACK_ERROR) {
      throw error;
    }
  }

  if (!completed) {
    throw new Error("test transaction did not complete");
  }

  return result;
}
