import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function lockStaffAccessChanges(
  transaction: DatabaseTransaction,
): Promise<void> {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('ololua:staff-access-changes', 0))`,
  );
}
