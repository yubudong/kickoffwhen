import { and, eq, asc, desc, sql, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db, type DbTransaction } from '@/db/client';
import type { Actor, GuardianActor } from '@/modules/auth/actor';
import { children } from '@/modules/families/schema';
import { todoTasks } from '@/modules/todos/schema';
import { todayShanghai, dateSchema, eachTodoDate, todoDateRange } from '@/modules/todos/validation';
import { habits, habitVersions, growthEntries, companions, companionMemories, inventories, growthBoosts, familyRewards, rewardRequests } from './schema';
import { habitInput, rewardInput, speciesSchema, scheduled, weekOf, nextDate, feedAmount, stages, shopItems, shopItem } from './rules';
import { lockWallet, changeWallet, entryExists, type Scope } from './wallet';
import { habitConfig, habitChangeDate, effectiveHabit } from './habit-rules';
import { canTransform, canUseHumanStyle, humanStylesFor, maxStage } from './companion-catalog';
type Database = typeof db | DbTransaction;
const uuid = z.string().uuid();
const counted = ['pending', 'approved', 'completed'];
export function createEngagementService(database: Database = db, clock: () => Date = () => new Date()) {
    function parent(actor: Actor): asserts actor is GuardianActor { if (actor.role !== 'guardian')
        throw new Error('FORBIDDEN'); }
    function scopeFor(actor: Actor, childId?: string): Scope { if (actor.role === 'child')
        return { familyId: actor.familyId, childId: actor.childId }; return { familyId: actor.familyId, childId: uuid.parse(childId) }; }
    async function list(actor: Actor, childId?: string) {
        const scope = scopeFor(actor, childId);
        return database.transaction(async (tx) => {
            const wallet = await lockWallet(tx, scope);
            const scoped = (t: {
                familyId: AnyPgColumn;
                childId: AnyPgColumn;
            }) => and(eq(t.familyId, scope.familyId), eq(t.childId, scope.childId));
            const [pet] = await tx.select().from(companions).where(scoped(companions));
            const rows = await tx.select().from(habits).where(scoped(habits)).orderBy(asc(habits.createdAt));
            const versions = await tx.select().from(habitVersions).where(scoped(habitVersions));
            const today = todayShanghai(clock());
            const resolved = rows.map(h => {
                const future = versions.filter(v => v.habitId === h.id && v.effectiveFrom > today).sort((a,b) => b.version-a.version)[0];
                return { ...effectiveHabit(h, versions, today), pendingChange: !h.stoppedOn && future ? { config: future.config, effectiveFrom: future.effectiveFrom } : null };
            });
            return { wallet: { ...wallet, available: wallet.coins - wallet.held }, pet: pet ?? null, habits: resolved, inventory: await tx.select().from(inventories).where(scoped(inventories)), boosts: await tx.select().from(growthBoosts).where(scoped(growthBoosts)), memories: await tx.select().from(companionMemories).where(scoped(companionMemories)).orderBy(asc(companionMemories.stage)), entries: await tx.select().from(growthEntries).where(scoped(growthEntries)).orderBy(desc(growthEntries.createdAt)).limit(100), rewards: await tx.select().from(familyRewards).where(eq(familyRewards.familyId, scope.familyId)).orderBy(asc(familyRewards.createdAt)), requests: await tx.select().from(rewardRequests).where(scoped(rewardRequests)).orderBy(desc(rewardRequests.createdAt)), shop: shopItems, now: clock().toISOString() };
        });
    }
    async function createHabit(actor: Actor, input: unknown) {
        parent(actor);
        const v = habitInput.parse(input);
        return database.transaction(async (tx) => {
            await lockWallet(tx, { familyId: actor.familyId, childId: v.childId });
            const [existing] = await tx.select().from(habits).where(and(eq(habits.familyId, actor.familyId), eq(habits.commandId, v.commandId)));
            if (existing)
                return existing;
            const active = await tx.select().from(habits).where(and(eq(habits.familyId, actor.familyId), eq(habits.childId, v.childId), sql `${habits.stoppedOn} is null`));
            if (active.length >= 5)
                throw new Error('HABIT_LIMIT');
            const [row] = await tx.insert(habits).values({ ...v, familyId: actor.familyId, guardianId: actor.guardianId }).returning();
            await tx.insert(habitVersions).values({ familyId: row.familyId, childId: row.childId, habitId: row.id, version: 1, commandId: row.commandId, effectiveFrom: row.startDate, config: habitConfig(row) });
            return row;
        });
    }
    async function editHabit(actor: Actor, id: string, input: unknown) {
        parent(actor); uuid.parse(id);
        const v = z.object({ commandId: uuid, expectedRevision: z.number().int().positive() }).parse(input);
        const config = habitConfig(input);
        return database.transaction(async tx => {
            const [initial] = await tx.select().from(habits).where(and(eq(habits.id,id),eq(habits.familyId,actor.familyId)));
            if (!initial) throw new Error('NOT_FOUND');
            await lockWallet(tx,initial);
            const [h] = await tx.select().from(habits).where(and(eq(habits.id,id),eq(habits.familyId,actor.familyId))).for('update');
            if (!h) throw new Error('NOT_FOUND');
            const [replay] = await tx.select().from(habitVersions).where(and(eq(habitVersions.familyId,actor.familyId),eq(habitVersions.commandId,v.commandId)));
            if (replay) { if (replay.habitId !== id || JSON.stringify(habitConfig(replay.config)) !== JSON.stringify(config)) throw new Error('HABIT_STALE'); return replay; }
            if (h.stoppedOn) throw new Error('HABIT_STOPPED');
            if (h.revision !== v.expectedRevision) throw new Error('HABIT_STALE');
            const version = h.revision+1, effectiveFrom = habitChangeDate(todayShanghai(clock()),h.startDate);
            await tx.insert(habitVersions).values({ familyId:h.familyId,childId:h.childId,habitId:id,version:1,commandId:h.commandId,effectiveFrom:h.startDate,config:habitConfig(h) }).onConflictDoNothing();
            const [saved] = await tx.insert(habitVersions).values({ familyId:h.familyId,childId:h.childId,habitId:id,version,commandId:v.commandId,effectiveFrom,config }).returning();
            await tx.update(habits).set({ revision:version,updatedAt:clock() }).where(eq(habits.id,id));
            return saved;
        });
    }
    async function stopHabit(actor: Actor, id: string) {
        parent(actor);
        uuid.parse(id);
        return database.transaction(async (tx) => {
            const [initial] = await tx.select().from(habits).where(and(eq(habits.id, id), eq(habits.familyId, actor.familyId)));
            if (!initial)
                throw new Error('NOT_FOUND');
            await lockWallet(tx, initial);
            const [h] = await tx.select().from(habits).where(and(eq(habits.id, id), eq(habits.familyId, actor.familyId))).for('update');
            if (!h)
                throw new Error('NOT_FOUND');
            if (h.stoppedOn)
                return;
            const today = todayShanghai(clock());
            await tx.update(habits).set({ stoppedOn: today }).where(eq(habits.id, id));
            await tx.update(todoTasks).set({ status: 'cancelled', updatedAt: clock() }).where(and(eq(todoTasks.habitId, id), sql `${todoTasks.date}>=${today}`, inArray(todoTasks.status, ['open', 'rejected'])));
        });
    }
    async function ensureHabits(actor: Actor, from: string, to: string, childId?: string) {
        dateSchema.parse(from);
        dateSchema.parse(to);
        const today = todayShanghai(clock());
        const until = to < today ? to : today;
        if (from > until)
            return;
        const scope = scopeFor(actor, childId);
        await database.transaction(async (tx) => {
            await lockWallet(tx, scope);
            const rows = await tx.select().from(habits).where(and(eq(habits.familyId, scope.familyId), eq(habits.childId, scope.childId)));
            const versions = await tx.select().from(habitVersions).where(and(eq(habitVersions.familyId,scope.familyId),eq(habitVersions.childId,scope.childId)));
            for (const original of rows)
                for (const day of eachTodoDate(from, until)) {
                    const h = effectiveHabit(original,versions,day);
                    if (h.stoppedOn !== null) continue;
                    if (!scheduled(h, day))
                        continue;
                    if (h.schedule === 'weekly') {
                        // Weekly habits offer today's opportunity only; missed days never become a backlog.
                        if (day !== today)
                            continue;
                        const week = todoDateRange(day, 'week');
                        const [count] = await tx.select({ n: sql<number> `count(*)::int` }).from(todoTasks).where(and(eq(todoTasks.habitId, h.id), sql `${todoTasks.date} between ${week.from} and ${week.to}`, inArray(todoTasks.status, ['submitted', 'approved'])));
                        if (count.n >= h.weeklyTarget)
                            continue;
                    }
                    await tx.insert(todoTasks).values({ ...scope, guardianId: h.guardianId, commandId: crypto.randomUUID(), habitId: h.id, habitRevisionId: h.habitRevisionId, occurrenceDate: day, title: h.title, requirements: h.requirements, date: day, confirmation: h.confirmation, rewardCoins: h.coins, rewardGrowth: h.growth }).onConflictDoNothing();
                }
        });
    }
    async function adjustOccurrence(actor: Actor, id: string, action: 'skip' | 'postpone', expectedUpdatedAt?: string) {
        parent(actor);
        uuid.parse(id);
        if (expectedUpdatedAt)
            z.iso.datetime().parse(expectedUpdatedAt);
        return database.transaction(async (tx) => {
            const [initial] = await tx.select().from(todoTasks).where(and(eq(todoTasks.familyId, actor.familyId), eq(todoTasks.id, id)));
            if (!initial)
                throw new Error('NOT_FOUND');
            await lockWallet(tx, initial);
            const [row] = await tx.select().from(todoTasks).where(and(eq(todoTasks.familyId, actor.familyId), eq(todoTasks.id, id))).for('update');
            if (!row)
                throw new Error('NOT_FOUND');
            if (expectedUpdatedAt && row.updatedAt.toISOString() !== expectedUpdatedAt)
                throw new Error('TASK_NOT_OPEN');
            if (!['open', 'rejected'].includes(row.status))
                throw new Error('TASK_NOT_OPEN');
            if (row.kind === 'dictation')
                throw new Error('TODO_KIND');
            if (action === 'skip') {
                await tx.update(todoTasks).set({ status: 'cancelled', reviewNote: '家长跳过当次', updatedAt: clock() }).where(eq(todoTasks.id, id));
                return;
            }
            const tomorrow = nextDate(row.date);
            if (row.habitId) {
                const [other] = await tx.select().from(todoTasks).where(and(eq(todoTasks.habitId, row.habitId), eq(todoTasks.date, tomorrow), sql `${todoTasks.id}<>${id}`, sql `${todoTasks.status}<>'cancelled'`));
                if (other) {
                    await tx.update(todoTasks).set({ status: 'cancelled', reviewNote: '已合并至次日同一习惯', updatedAt: clock() }).where(eq(todoTasks.id, id));
                    return;
                }
                // Reserve the next occurrence key so lazy generation cannot duplicate the postponed task.
                await tx.insert(todoTasks).values({ familyId: row.familyId, childId: row.childId, guardianId: row.guardianId, commandId: crypto.randomUUID(), habitId: row.habitId, habitRevisionId: row.habitRevisionId, occurrenceDate: tomorrow, title: row.title, requirements: row.requirements, date: tomorrow, status: 'cancelled', reviewNote: '与延期任务合并' }).onConflictDoNothing();
            }
            await tx.update(todoTasks).set({ date: tomorrow, reviewNote: '家长延后一天', updatedAt: new Date(Math.max(clock().getTime(), row.updatedAt.getTime() + 1)) }).where(eq(todoTasks.id, id));
        });
    }
    async function choosePet(actor: Actor, input: unknown) {
        const v = z.object({ childId: uuid.optional(), species: speciesSchema, name: z.string().trim().min(1).max(24), humanStyle: z.enum(['boy', 'girl']).optional() }).parse(input);
        const scope = scopeFor(actor, v.childId);
        return database.transaction(async (tx) => {
            await lockWallet(tx, scope);
            const [pet] = await tx.select().from(companions).where(eq(companions.childId, scope.childId));
            if (pet && pet.stage > 0 && actor.role !== 'guardian')
                throw new Error('PARENT_CHANGE_REQUIRED');
            const styles = humanStylesFor(v.species);
            if (v.humanStyle && styles.length > 0 && !styles.includes(v.humanStyle)) throw new Error('HUMAN_STYLE_UNAVAILABLE');
            const requested = v.humanStyle ?? pet?.humanStyle ?? 'boy';
            const humanStyle = styles.length === 1 ? styles[0] : requested;
            await tx.insert(companions).values({ ...scope, species: v.species, name: v.name, humanStyle }).onConflictDoUpdate({ target: companions.childId, set: { species: v.species, name: v.name, appearance: 'animal', humanStyle } });
        });
    }
    async function feed(actor: Actor, input: unknown) {
        const v = z.object({ childId: uuid.optional(), commandId: uuid, amount: z.number().int().min(1).max(1000000) }).parse(input);
        const scope = scopeFor(actor, v.childId);
        return database.transaction(async (tx) => {
            const wallet = await lockWallet(tx, scope);
            const key = 'feed:' + v.commandId;
            if (await entryExists(tx, scope, key))
                return;
            const [pet] = await tx.select().from(companions).where(eq(companions.childId, scope.childId));
            if (!pet)
                throw new Error('PET_REQUIRED');
            const amount = feedAmount(pet.stage, wallet.fed, wallet.growth, v.amount);
            if (amount <= 0)
                throw new Error('NO_GROWTH');
            await changeWallet(tx, scope, key, 'feed', { growth: -amount, fed: amount });
        });
    }
    async function evolve(actor: Actor, childId?: string) {
        const scope = scopeFor(actor, childId);
        return database.transaction(async (tx) => {
            const wallet = await lockWallet(tx, scope);
            const [pet] = await tx.select().from(companions).where(eq(companions.childId, scope.childId));
            if (!pet)
                throw new Error('PET_REQUIRED');
            if (pet.stage >= maxStage || wallet.fed < stages[pet.stage + 1])
                throw new Error('NOT_READY');
            const stage = pet.stage + 1;
            await tx.update(companions).set({ stage, displayStage: stage }).where(eq(companions.childId, scope.childId));
            await tx.insert(companionMemories).values({ ...scope, stage, species: pet.species, createdAt: clock() }).onConflictDoNothing();
        });
    }
    async function appearance(actor: Actor, input: unknown) {
        const v = z.object({ childId: uuid.optional(), displayStage: z.number().int().min(1).max(maxStage).optional(), appearance: z.enum(['animal', 'human']), humanStyle: z.enum(['boy', 'girl']).optional() }).parse(input);
        const scope = scopeFor(actor, v.childId);
        return database.transaction(async tx => {
            await lockWallet(tx, scope);
            const [pet] = await tx.select().from(companions).where(eq(companions.childId, scope.childId));
            if (!pet || pet.stage === 0) throw new Error('NOT_READY');
            const displayStage = v.displayStage ?? pet.displayStage;
            if (displayStage > pet.stage) throw new Error('FORM_LOCKED');
            if (v.appearance === 'human' && !canTransform(pet.species, displayStage)) throw new Error('TRANSFORM_UNAVAILABLE');
            const humanStyle = v.humanStyle ?? pet.humanStyle;
            if ((v.appearance === 'human' && !canUseHumanStyle(pet.species, displayStage, humanStyle)) || (humanStylesFor(pet.species).length === 1 && humanStyle !== 'boy')) throw new Error('HUMAN_STYLE_UNAVAILABLE');
            await tx.update(companions).set({ displayStage, appearance: v.appearance, humanStyle }).where(eq(companions.childId, scope.childId));
        });
    }
    async function buy(actor: Actor, input: unknown) {
        const v = z.object({ childId: uuid.optional(), commandId: uuid, itemKey: z.string(), expectedPrice: z.number().int().optional() }).parse(input);
        const scope = scopeFor(actor, v.childId);
        const item = shopItem(v.itemKey);
        if (v.expectedPrice !== undefined && v.expectedPrice !== item.price)
            throw new Error('PRICE_CHANGED');
        return database.transaction(async (tx) => {
            await lockWallet(tx, scope);
            const key = 'buy:' + v.commandId;
            if (await entryExists(tx, scope, key))
                return;
            const [owned] = await tx.select().from(inventories).where(and(eq(inventories.childId, scope.childId), eq(inventories.itemKey, item.key)));
            if (item.type === 'decoration' && owned?.quantity)
                throw new Error('ALREADY_OWNED');
            await changeWallet(tx, scope, key, 'purchase', { coins: -item.price }, { itemKey: item.key, price: item.price });
            await tx.insert(inventories).values({ ...scope, itemKey: item.key, quantity: 1 }).onConflictDoUpdate({ target: [inventories.childId, inventories.itemKey], set: { quantity: sql `${inventories.quantity}+1` } });
        });
    }
    async function useItem(actor: Actor, input: unknown) {
        const v = z.object({ childId: uuid.optional(), commandId: uuid, itemKey: z.string() }).parse(input);
        const scope = scopeFor(actor, v.childId);
        const item = shopItem(v.itemKey);
        return database.transaction(async (tx) => {
            await lockWallet(tx, scope);
            const key = 'use:' + v.commandId;
            if (await entryExists(tx, scope, key))
                return;
            const [owned] = await tx.select().from(inventories).where(and(eq(inventories.childId, scope.childId), eq(inventories.itemKey, item.key)));
            if (!owned?.quantity)
                throw new Error('ITEM_NOT_OWNED');
            if (item.type === 'decoration') {
                const [pet] = await tx.select().from(companions).where(eq(companions.childId, scope.childId));
                if (!pet)
                    throw new Error('PET_REQUIRED');
                await tx.update(companions).set({ equipped: { ...pet.equipped, [item.slot!]: item.key } }).where(eq(companions.childId, scope.childId));
            }
            else {
                if (item.type === 'boost') {
                    const now = clock();
                    const boosts = await tx.select().from(growthBoosts).where(eq(growthBoosts.childId, scope.childId));
                    const active = boosts.filter(b => b.expiresAt > now);
                    const existing = boosts.find(b => b.itemKey === item.key);
                    if (!active.some(b => b.itemKey === item.key) && active.reduce((sum, b) => sum + b.percent, 0) + item.percent > 30)
                        throw new Error('BOOST_LIMIT');
                    const end = new Date(Math.max(now.getTime(), existing?.expiresAt.getTime() ?? 0) + 7 * 86400000);
                    await tx.insert(growthBoosts).values({ ...scope, itemKey: item.key, percent: item.percent, startsAt: now, expiresAt: end }).onConflictDoUpdate({ target: [growthBoosts.childId, growthBoosts.itemKey], set: { startsAt: existing && existing.expiresAt > now ? existing.startsAt : now, expiresAt: end } });
                }
                await tx.update(inventories).set({ quantity: owned.quantity - 1 }).where(eq(inventories.id, owned.id));
            }
            await changeWallet(tx, scope, key, item.type === 'food' ? 'interaction' : item.type === 'boost' ? 'activate' : 'equip', {}, { itemKey: item.key });
        });
    }
    async function saveReward(actor: Actor, input: unknown) {
        parent(actor);
        const v = rewardInput.extend({ id: uuid.optional(), active: z.boolean().optional() }).parse(input);
        return database.transaction(async (tx) => {
            if (v.id) {
                const [r] = await tx.update(familyRewards).set({ title: v.title, description: v.description, price: v.price, repeatable: v.repeatable, weeklyLimit: v.weeklyLimit, active: v.active ?? true }).where(and(eq(familyRewards.id, v.id), eq(familyRewards.familyId, actor.familyId))).returning();
                if (!r)
                    throw new Error('NOT_FOUND');
                return r;
            }
            const [r] = await tx.insert(familyRewards).values({ ...v, familyId: actor.familyId }).onConflictDoNothing().returning();
            return r;
        });
    }
    async function requestReward(actor: Actor, input: unknown) {
        const v = z.object({ childId: uuid.optional(), rewardId: uuid, commandId: uuid, expectedPrice: z.number().int().optional() }).parse(input);
        const scope = scopeFor(actor, v.childId);
        return database.transaction(async (tx) => {
            await lockWallet(tx, scope);
            const [existing] = await tx.select().from(rewardRequests).where(and(eq(rewardRequests.childId, scope.childId), eq(rewardRequests.commandId, v.commandId)));
            if (existing)
                return existing;
            const [reward] = await tx.select().from(familyRewards).where(and(eq(familyRewards.id, v.rewardId), eq(familyRewards.familyId, scope.familyId), eq(familyRewards.active, true))).for('update');
            if (!reward)
                throw new Error('NOT_FOUND');
            if (v.expectedPrice !== undefined && v.expectedPrice !== reward.price)
                throw new Error('PRICE_CHANGED');
            const previous = await tx.select().from(rewardRequests).where(and(eq(rewardRequests.childId, scope.childId), eq(rewardRequests.rewardId, reward.id)));
            if (previous.some(r => ['pending', 'approved'].includes(r.status)))
                throw new Error('REQUEST_EXISTS');
            if (!reward.repeatable && previous.some(r => r.status === 'completed'))
                throw new Error('REWARD_USED');
            const week = weekOf(todayShanghai(clock()));
            if (reward.weeklyLimit && previous.filter(r => r.week === week && counted.includes(r.status)).length >= reward.weeklyLimit)
                throw new Error('WEEKLY_LIMIT');
            const [row] = await tx.insert(rewardRequests).values({ ...scope, rewardId: reward.id, commandId: v.commandId, title: reward.title, price: reward.price, week, createdAt: clock() }).returning();
            await changeWallet(tx, scope, 'request:' + row.id, 'hold', { held: reward.price }, { rewardId: reward.id, title: reward.title });
            return row;
        });
    }
    async function decideReward(actor: Actor, input: unknown) {
        const v = z.object({ id: uuid, decision: z.enum(['approve', 'reject', 'cancel', 'complete']), note: z.string().trim().max(2000).default('') }).parse(input);
        if (actor.role === 'child' && v.decision !== 'cancel')
            throw new Error('FORBIDDEN');
        return database.transaction(async (tx) => {
            const [initial] = await tx.select().from(rewardRequests).where(and(eq(rewardRequests.id, v.id), eq(rewardRequests.familyId, actor.familyId), actor.role === 'child' ? eq(rewardRequests.childId, actor.childId) : undefined));
            if (!initial)
                throw new Error('NOT_FOUND');
            const scope = { familyId: initial.familyId, childId: initial.childId };
            await lockWallet(tx, scope);
            const [r] = await tx.select().from(rewardRequests).where(eq(rewardRequests.id, v.id)).for('update');
            const status = { approve: 'approved', reject: 'rejected', cancel: 'cancelled', complete: 'completed' }[v.decision];
            if (r.status === status)
                return;
            if (actor.role === 'child' && r.status !== 'pending')
                throw new Error('INVALID_STATE');
            const allowed = (r.status === 'pending' && ['approve', 'reject', 'cancel'].includes(v.decision)) || (r.status === 'approved' && ['cancel', 'complete'].includes(v.decision));
            if (!allowed)
                throw new Error('INVALID_STATE');
            const delta = v.decision === 'approve' ? { coins: -r.price, held: -r.price } : r.status === 'pending' ? { held: -r.price } : v.decision === 'cancel' ? { coins: r.price } : {};
            await changeWallet(tx, scope, 'request:' + r.id + ':' + v.decision, v.decision, delta, { rewardId: r.rewardId, note: v.note });
            await tx.update(rewardRequests).set({ status, note: v.note, updatedAt: clock() }).where(eq(rewardRequests.id, r.id));
        });
    }
    async function adjustBalance(actor: Actor, input: unknown) { parent(actor); const v = z.object({ childId: uuid, commandId: uuid, coins: z.number().int().min(-1000000).max(1000000), growth: z.number().int().min(0).max(1000000).default(0), reason: z.string().trim().min(1).max(500) }).refine(v => v.coins !== 0 || v.growth !== 0).parse(input); const scope = scopeFor(actor, v.childId); return database.transaction(tx => changeWallet(tx, scope, 'manual:' + v.commandId, 'manual_adjustment', { coins: v.coins, growth: v.growth }, { reason: v.reason, guardianId: actor.guardianId })); }
    async function childrenList(actor: Actor) { parent(actor); return database.select({ id: children.id, nickname: children.nickname }).from(children).where(and(eq(children.familyId, actor.familyId), eq(children.active, true))); }
    return { list, createHabit, editHabit, stopHabit, ensureHabits, adjustOccurrence, choosePet, feed, evolve, appearance, buy, useItem, saveReward, requestReward, decideReward, adjustBalance, childrenList };
}
