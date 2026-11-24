import { expect, test } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { user } from '@/modules/auth/schema';
import { families, guardians, children } from '@/modules/families/schema';
import { todoTasks, todoRewards, todoReviews, todoSubmissions } from '@/modules/todos/schema';
import { habits, wallets, growthEntries, companions, companionMemories, inventories, growthBoosts, rewardRequests, familyRewards } from '@/modules/engagement/schema';
import { createEngagementService } from '@/modules/engagement/service';
import { createTodoService } from '@/modules/todos/service';
import { changeWallet } from '@/modules/engagement/wallet';
import { todayShanghai } from '@/modules/todos/validation';
test('真实并发购买防超花，投喂只执行一次，两项任务并行发奖不丢失余额', async () => {
    const authId = crypto.randomUUID();
    let familyId = '';
    try {
        await db.insert(user).values({ id: authId, name: '并发养成', email: authId + '@example.test' });
        const [f] = await db.insert(families).values({ name: '并发养成测试' }).returning();
        familyId = f.id;
        const [g] = await db.insert(guardians).values({ familyId, authUserId: authId }).returning();
        const [c] = await db.insert(children).values({ familyId, nickname: '测试孩子', grade: 5 }).returning();
        const parent = { role: 'guardian' as const, familyId, guardianId: g.id };
        const child = { role: 'child' as const, familyId, childId: c.id, deviceId: crypto.randomUUID() };
        const scope = { familyId, childId: c.id };
        const s = createEngagementService();
        await db.transaction(tx => changeWallet(tx, scope, 'fixture', 'fixture', { coins: 12, growth: 100 }));
        const buys = await Promise.allSettled([s.buy(child, { commandId: crypto.randomUUID(), itemKey: 'focus' }), s.buy(child, { commandId: crypto.randomUUID(), itemKey: 'courage' })]);
        expect(buys.filter(b => b.status === 'fulfilled')).toHaveLength(1);
        expect((await s.list(child)).wallet.coins).toBe(0);
        await s.choosePet(child, { species: 'dragon', name: '青团' });
        const command = { commandId: crypto.randomUUID(), amount: 100 };
        await Promise.all([s.feed(child, command), s.feed(child, command)]);
        expect((await s.list(child)).wallet).toMatchObject({ growth: 50, fed: 50 });
        const todos = createTodoService();
        const tasks = await Promise.all([1, 2].map(n => todos.create(parent, { childId: c.id, title: '任务' + n, date: todayShanghai(), commandId: crypto.randomUUID(), rewardCoins: 3, rewardGrowth: 10 })));
        await Promise.all(tasks.map(t => todos.submit(child, t.id, 0)));
        await Promise.all(tasks.map(t => todos.review(parent, t.id, { number: 1, decision: 'approved', bonus: 2, note: '' })));
        const wallet = (await s.list(child)).wallet;
        expect(wallet).toMatchObject({ coins: 10, growth: 70, fed: 50 });
        const entries = await db.select().from(growthEntries).where(and(eq(growthEntries.childId, c.id), eq(growthEntries.kind, 'task_reward')));
        expect(entries).toHaveLength(2);
    }
    finally {
        if (familyId) {
            const ids = (await db.select({ id: todoTasks.id }).from(todoTasks).where(eq(todoTasks.familyId, familyId))).map(r => r.id);
            if (ids.length) {
                await db.delete(todoReviews).where(inArray(todoReviews.todoId, ids));
                await db.delete(todoSubmissions).where(inArray(todoSubmissions.todoId, ids));
                await db.delete(todoRewards).where(inArray(todoRewards.todoId, ids));
                await db.delete(todoTasks).where(inArray(todoTasks.id, ids));
            }
            for (const table of [rewardRequests, companionMemories, companions, inventories, growthBoosts, growthEntries, wallets, habits, familyRewards])
                await db.delete(table).where(eq(table.familyId, familyId));
            await db.delete(children).where(eq(children.familyId, familyId));
            await db.delete(guardians).where(eq(guardians.familyId, familyId));
            await db.delete(families).where(eq(families.id, familyId));
        }
        await db.delete(user).where(eq(user.id, authId));
    }
});
