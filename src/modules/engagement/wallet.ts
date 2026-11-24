import { and, eq, gt, lte, sql } from 'drizzle-orm';
import type { DbTransaction } from '@/db/client';
import { children } from '@/modules/families/schema';
import { wallets, growthEntries, growthBoosts } from './schema';
import { boostedGrowth } from './rules';
export type Scope = {
    familyId: string;
    childId: string;
};
export async function lockWallet(tx: DbTransaction, scope: Scope) {
    const [child] = await tx.select({ id: children.id }).from(children).where(and(eq(children.familyId, scope.familyId), eq(children.id, scope.childId), eq(children.active, true))).for('update');
    if (!child)
        throw new Error('NOT_FOUND');
    await tx.insert(wallets).values(scope).onConflictDoNothing();
    const [wallet] = await tx.select().from(wallets).where(and(eq(wallets.familyId, scope.familyId), eq(wallets.childId, scope.childId))).for('update');
    return wallet;
}
export async function entryExists(tx: DbTransaction, scope: Scope, key: string) { const [entry] = await tx.select().from(growthEntries).where(and(eq(growthEntries.childId, scope.childId), eq(growthEntries.familyId, scope.familyId), eq(growthEntries.sourceKey, key))); return entry; }
export async function changeWallet(tx: DbTransaction, scope: Scope, key: string, kind: string, delta: {
    coins?: number;
    held?: number;
    growth?: number;
    fed?: number;
}, details: Record<string, unknown> = {}) {
    const wallet = await lockWallet(tx, scope);
    if (await entryExists(tx, scope, key))
        return false;
    const next = { coins: wallet.coins + (delta.coins ?? 0), held: wallet.held + (delta.held ?? 0), growth: wallet.growth + (delta.growth ?? 0), fed: wallet.fed + (delta.fed ?? 0) };
    if (next.coins < next.held || Object.values(next).some(v => v < 0 || !Number.isSafeInteger(v) || v > 2000000000))
        throw new Error('INSUFFICIENT_BALANCE');
    await tx.insert(growthEntries).values({ ...scope, sourceKey: key, kind, ...delta, details });
    await tx.update(wallets).set(next).where(eq(wallets.childId, scope.childId));
    return true;
}
export async function boostAt(tx: DbTransaction, scope: Scope, at: Date) { const [r] = await tx.select({ total: sql<number> `coalesce(sum(${growthBoosts.percent}),0)::int` }).from(growthBoosts).where(and(eq(growthBoosts.familyId, scope.familyId), eq(growthBoosts.childId, scope.childId), lte(growthBoosts.startsAt, at), gt(growthBoosts.expiresAt, at))); return Math.min(30, r.total); }
export async function grantTodo(tx: DbTransaction, row: {
    id: string;
    familyId: string;
    childId: string;
    rewardCoins: number;
    rewardGrowth: number;
    submittedBoost: number;
}, bonus: number) { return changeWallet(tx, row, 'todo:' + row.id, 'task_reward', { coins: row.rewardCoins + bonus, growth: boostedGrowth(row.rewardGrowth, row.submittedBoost) }, { baseCoins: row.rewardCoins, bonusCoins: bonus, baseGrowth: row.rewardGrowth, boostPercent: row.submittedBoost }); }
