import { eq } from 'drizzle-orm';
import type { db, DbTransaction } from '@/db/client';
import { rewardRequests, companionMemories, companions, inventories, growthBoosts, growthEntries, wallets, habits, familyRewards } from '@/modules/engagement/schema';
// Tests call this after deleting their todo aggregate; production history is never relaxed for cleanup.
export async function cleanupEngagement(database: typeof db | DbTransaction, familyId: string) {
    for (const table of [rewardRequests, companionMemories, companions, inventories, growthBoosts, growthEntries, wallets, habits, familyRewards])
        await database.delete(table).where(eq(table.familyId, familyId));
}
