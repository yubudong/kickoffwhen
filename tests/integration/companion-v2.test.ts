import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { expect, test } from 'vitest';
import type { DbTransaction } from '@/db/client';
import { user } from '@/modules/auth/schema';
import { families, guardians, children } from '@/modules/families/schema';
import { wallets } from '@/modules/engagement/schema';
import { changeWallet } from '@/modules/engagement/wallet';
import { createEngagementService } from '@/modules/engagement/service';
import { companionCatalog, humanStylesFor, legacyStageToCurrent, speciesKeys, stages } from '@/modules/engagement/companion-catalog';
import { withDatabaseRollback } from '../helpers/database';

async function fixture(tx: DbTransaction) {
  const id = crypto.randomUUID();
  await tx.insert(user).values({ id, name: '四阶段测试', email: id + '@example.test' });
  const [f] = await tx.insert(families).values({ name: '伙伴家庭' }).returning();
  const [g] = await tx.insert(guardians).values({ familyId: f.id, authUserId: id }).returning();
  const [c] = await tx.insert(children).values({ familyId: f.id, nickname: '伙伴孩子', grade: 5 }).returning();
  return { scope: { familyId: f.id, childId: c.id }, child: { role: 'child' as const, familyId: f.id, childId: c.id, deviceId: crypto.randomUUID() }, parent: { role: 'guardian' as const, familyId: f.id, guardianId: g.id } };
}

test.each(speciesKeys)('%s完整经历四个成长阶段，外观切换不影响真实成长与余额', species => withDatabaseRollback(async tx => {
  const { scope, child } = await fixture(tx);
  const service = createEngagementService(tx);
  await changeWallet(tx, scope, 'fixture', 'fixture', { coins: 42, growth: 2000 });
  await service.choosePet(child, { species, name: '伙伴' });
  for (let stage = 1; stage <= 4; stage++) {
    const command = { commandId: crypto.randomUUID(), amount: 2000 };
    await service.feed(child, command); await service.feed(child, command);
    let state = await service.list(child);
    expect(state.wallet.fed).toBe(stages[stage]);
    expect(state.wallet.coins).toBe(42);
    expect(state.pet!.stage).toBe(stage - 1);
    await expect(service.feed(child, { ...command, commandId: crypto.randomUUID() })).rejects.toThrow('EVOLUTION_READY');
    await service.evolve(child);
    state = await service.list(child);
    expect(state.pet).toMatchObject({ stage, displayStage: stage });
    expect(state.memories).toHaveLength(stage);
    if (stage === 2) await expect(service.appearance(child, { appearance: 'human', humanStyle: 'girl' })).rejects.toThrow('TRANSFORM_UNAVAILABLE');
    if (stage === 3 && companionCatalog[species].canTransform) {
      await service.appearance(child, { appearance: 'human', humanStyle: 'boy' });
      expect((await service.list(child)).pet!.appearance).toBe('human');
    }
  }
  if (!companionCatalog[species].canTransform) {
    await expect(service.appearance(child, { appearance: 'human', humanStyle: 'girl' })).rejects.toThrow('TRANSFORM_UNAVAILABLE');
  } else {
    await service.appearance(child, { appearance: 'human', humanStyle: humanStylesFor(species).includes('girl') ? 'girl' : 'boy' });
    expect((await service.list(child)).pet).toMatchObject({ stage: 4, displayStage: 4, appearance: 'human' });
  }
  await service.appearance(child, { displayStage: 1, appearance: 'animal' });
  await expect(service.appearance(child, { displayStage: 1, appearance: 'human', humanStyle: 'girl' })).rejects.toThrow('TRANSFORM_UNAVAILABLE');
  await service.feed(child, { commandId: crypto.randomUUID(), amount: 7 });
  const state = await service.list(child);
  expect(state.pet).toMatchObject({ stage: 4, displayStage: 1, appearance: 'animal' });
  expect(state.wallet).toMatchObject({ coins: 42, growth: 193, fed: 1807 });
}));

test('未解锁年龄不能越级，孩子不能通过其他childId修改另一位伙伴', () => withDatabaseRollback(async tx => {
  const { child, scope } = await fixture(tx);
  const service = createEngagementService(tx);
  await changeWallet(tx, scope, 'fixture', 'fixture', { growth: 50 });
  await service.choosePet(child, { species: 'phoenix', name: '星羽' });
  await service.feed(child, { commandId: crypto.randomUUID(), amount: 50 }); await service.evolve(child);
  await expect(service.appearance(child, { displayStage: 4, appearance: 'animal' })).rejects.toThrow('FORM_LOCKED');
  const other = await fixture(tx);
  await service.choosePet(other.child, { species: 'dragon', name: '青龙' });
  await service.appearance(child, { childId: other.child.childId, displayStage: 1, appearance: 'animal' });
  expect((await service.list(other.child)).pet).toMatchObject({ species: 'dragon', stage: 0, displayStage: 0 });
  await expect(service.appearance({ ...child, familyId: other.child.familyId }, { displayStage: 1, appearance: 'animal' })).rejects.toThrow('NOT_FOUND');
}));

test('家长更换伙伴保留全部已解锁年龄、钱包与原相册事实', () => withDatabaseRollback(async tx => {
  const { child, parent, scope } = await fixture(tx);
  const service = createEngagementService(tx);
  await changeWallet(tx, scope, 'fixture', 'fixture', { coins: 19, growth: 2000 });
  await service.choosePet(child, { species: 'fox', name: '月月' });
  for (let i = 0; i < 4; i++) { await service.feed(child, { commandId: crypto.randomUUID(), amount: 2000 }); await service.evolve(child); }
  await service.appearance(child, { appearance: 'human', humanStyle: 'girl' });
  const before = await service.list(child);
  await service.choosePet(parent, { childId: child.childId, species: 'capybara', name: '慢慢' });
  const after = await service.list(child);
  expect(after.wallet).toEqual(before.wallet);
  expect(after.memories).toEqual(before.memories);
  expect(after.pet).toMatchObject({ species: 'capybara', stage: 4, displayStage: 4, appearance: 'animal' });
}));

test('0026真实SQL迁移保留旧宠物年龄、相册ID与日期，补入低年龄且不改钱包', () => withDatabaseRollback(async tx => {
  const { scope } = await fixture(tx);
  await changeWallet(tx, scope, 'fixture', 'fixture', { coins: 42, growth: 70, fed: 1800 });
  const [before] = await tx.select().from(wallets).where(eq(wallets.childId, scope.childId));
  await tx.execute(sql.raw(`
    CREATE TEMP TABLE companions (child_id uuid PRIMARY KEY, family_id uuid NOT NULL, species text NOT NULL, name text NOT NULL, stage integer NOT NULL DEFAULT 0, appearance text NOT NULL DEFAULT 'animal', human_style text NOT NULL DEFAULT 'girl', equipped jsonb NOT NULL DEFAULT '{}', CONSTRAINT companion_rules CHECK (species IN ('dragon','fox','phoenix') AND stage BETWEEN 0 AND 3));
    CREATE TEMP TABLE companion_memories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), family_id uuid NOT NULL, child_id uuid NOT NULL, stage integer NOT NULL, species text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(child_id,stage));
  `));
  const cases = [0, 1, 2, 3].map(stage => ({ id: crypto.randomUUID(), stage }));
  const memories: Array<{ id: string; childId: string; stage: number; createdAt: Date }> = [];
  for (const c of cases) {
    await tx.execute(sql`INSERT INTO companions (child_id,family_id,species,name,stage,appearance) VALUES (${c.id},${scope.familyId},'fox','旧伙伴',${c.stage},${c.stage === 3 ? 'human' : 'animal'})`);
    for (let stage = 1; stage <= c.stage; stage++) {
      const m = { id: crypto.randomUUID(), childId: c.id, stage, createdAt: new Date(`2026-01-0${stage}T00:00:00Z`) };
      memories.push(m);
      await tx.execute(sql`INSERT INTO companion_memories (id,family_id,child_id,stage,species,created_at) VALUES (${m.id},${scope.familyId},${c.id},${stage},'fox',${m.createdAt.toISOString()})`);
    }
  }
  const migration = readFileSync('drizzle/0026_lyrical_switch.sql', 'utf8');
  for (const statement of migration.split('--> statement-breakpoint')) if (statement.trim()) await tx.execute(sql.raw(statement));
  const pets = (await tx.execute<{ child_id: string; stage: number; display_stage: number; appearance: string }>(sql`SELECT * FROM companions`)).rows;
  const album = (await tx.execute<{ id: string; child_id: string; stage: number; origin: string; created_at: string }>(sql`SELECT * FROM companion_memories`)).rows;
  for (const c of cases) {
    const pet = pets.find(p => p.child_id === c.id)!;
    expect(pet.stage).toBe(legacyStageToCurrent(c.stage)); expect(pet.display_stage).toBe(pet.stage);
    expect(pet.appearance).toBe(c.stage === 3 ? 'human' : 'animal');
    expect(album.filter(m => m.child_id === c.id)).toHaveLength(pet.stage);
  }
  for (const old of memories) {
    const current = album.find(m => m.id === old.id)!;
    expect(current.stage).toBe(legacyStageToCurrent(old.stage)); expect(current.origin).toBe('growth');
    expect(new Date(current.created_at).toISOString()).toBe(old.createdAt.toISOString());
  }
  expect(album.filter(m => m.origin === 'upgrade')).toHaveLength(3);
  const [after] = await tx.select().from(wallets).where(eq(wallets.childId, scope.childId));
  expect(after).toEqual(before);
  await expect(tx.transaction(sub => sub.execute(sql`UPDATE companions SET species='dragon',appearance='human' WHERE stage=4`))).rejects.toThrow();
}));

test.each(['ape', 'tortoise'] as const)('%s默认男性且不能选择女性，换自女性伙伴不丢成长与余额', species => withDatabaseRollback(async tx => {
  const { child, parent, scope } = await fixture(tx); const service = createEngagementService(tx);
  await expect(service.choosePet(child, { species, name: '男伙伴', humanStyle: 'girl' })).rejects.toThrow('HUMAN_STYLE_UNAVAILABLE');
  await service.choosePet(child, { species: 'fox', name: '原伙伴', humanStyle: 'girl' });
  await changeWallet(tx, scope, 'fixture', 'fixture', { coins: 42, growth: 2000 });
  for (let i = 0; i < 4; i++) { await service.feed(child, { commandId: crypto.randomUUID(), amount: 2000 }); await service.evolve(child); }
  await service.appearance(child, { appearance: 'human', humanStyle: 'girl' }); const before = await service.list(child);
  await service.choosePet(parent, { childId: child.childId, species, name: '新伙伴' });
  let state = await service.list(child); expect(state.pet).toMatchObject({ species, stage: 4, displayStage: 4, humanStyle: 'boy', appearance: 'animal' });
  expect(state.wallet).toEqual(before.wallet); expect(state.memories).toEqual(before.memories);
  await service.appearance(child, { displayStage: 3, appearance: 'human' });
  await expect(service.appearance(child, { appearance: 'human', humanStyle: 'girl' })).rejects.toThrow('HUMAN_STYLE_UNAVAILABLE');
  await expect(service.appearance(child, { appearance: 'animal', humanStyle: 'girl' })).rejects.toThrow('HUMAN_STYLE_UNAVAILABLE');
  state = await service.list(child); expect(state.pet).toMatchObject({ appearance: 'human', humanStyle: 'boy', displayStage: 3 });
  await expect(tx.transaction(sub => sub.execute(sql`UPDATE companions SET human_style='girl' WHERE child_id=${child.childId}`))).rejects.toThrow();
}));

test('0027仅扩展约束，原有男女外观和钱包记录完全不改写', () => withDatabaseRollback(async tx => {
  const { scope } = await fixture(tx);
  await changeWallet(tx, scope, 'fixture', 'fixture', { coins: 42, growth: 100, fed: 900 });
  const [beforeWallet] = await tx.select().from(wallets).where(eq(wallets.childId, scope.childId));
  await tx.execute(sql.raw('CREATE TEMP TABLE companions (LIKE public.companions INCLUDING DEFAULTS);'));
  const oldConstraint = readFileSync('drizzle/0026_lyrical_switch.sql', 'utf8').split('--> statement-breakpoint').find(statement => statement.trim().startsWith('ALTER TABLE "companions" ADD CONSTRAINT "companion_rules"'))!;
  await tx.execute(sql.raw(oldConstraint));
  for (const [species, stage, appearance, humanStyle] of [['fox', 4, 'human', 'girl'], ['phoenix', 3, 'human', 'boy'], ['wolf', 2, 'animal', 'girl'], ['dragon', 4, 'animal', 'girl']] as const) {
    await tx.execute(sql`INSERT INTO companions (child_id,family_id,species,name,stage,display_stage,appearance,human_style) VALUES (${crypto.randomUUID()},${scope.familyId},${species},'原伙伴',${stage},${stage},${appearance},${humanStyle})`);
  }
  const before = (await tx.execute(sql`SELECT * FROM companions ORDER BY child_id`)).rows;
  for (const statement of readFileSync('drizzle/0027_slippery_wild_child.sql', 'utf8').split('--> statement-breakpoint')) await tx.execute(sql.raw(statement));
  expect((await tx.execute(sql`SELECT * FROM companions ORDER BY child_id`)).rows).toEqual(before);
  const [afterWallet] = await tx.select().from(wallets).where(eq(wallets.childId, scope.childId)); expect(afterWallet).toEqual(beforeWallet);
  const id = crypto.randomUUID();
  await tx.execute(sql`INSERT INTO companions (child_id,family_id,species,name,stage,display_stage,appearance,human_style) VALUES (${id},${scope.familyId},'ape','新男性伙伴',3,3,'human','boy')`);
  await expect(tx.transaction(sub => sub.execute(sql`UPDATE companions SET human_style='girl' WHERE child_id=${id}`))).rejects.toThrow();
}));

test('原有女性形态在省略性别的动物/人形切换中仍然保留', () => withDatabaseRollback(async tx => {
  const { child, scope } = await fixture(tx); const service = createEngagementService(tx);
  await changeWallet(tx, scope, 'fixture', 'fixture', { growth: 2000 });
  await service.choosePet(child, { species: 'phoenix', name: '星羽', humanStyle: 'girl' });
  for (let i = 0; i < 3; i++) { await service.feed(child, { commandId: crypto.randomUUID(), amount: 2000 }); await service.evolve(child); }
  await service.appearance(child, { appearance: 'human' }); expect((await service.list(child)).pet!.humanStyle).toBe('girl');
  await service.appearance(child, { appearance: 'animal' }); expect((await service.list(child)).pet!.humanStyle).toBe('girl');
}));
