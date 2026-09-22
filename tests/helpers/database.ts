import type { DbTransaction } from "@/db/client";
import { withTestTransaction } from "@/db/client";

export async function withDatabaseRollback<T>(
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return withTestTransaction(fn);
}
