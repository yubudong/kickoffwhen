import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { canTransform, canUseHumanStyle, humanStylesFor, companionRoute, companionAsset, companionCatalog, legacyStageToCurrent, speciesKeys, stageNames, stages } from '@/modules/engagement/companion-catalog';

test('十种伙伴分为四种男女可选、两种男性化形和四种动物神兽路线', () => {
  expect(speciesKeys).toEqual(['dragon', 'fox', 'phoenix', 'capybara', 'rabbit', 'cat', 'wolf', 'unicorn', 'ape', 'tortoise']);
  expect(speciesKeys.filter(s => companionCatalog[s].canTransform)).toEqual(['fox', 'phoenix', 'cat', 'wolf', 'ape', 'tortoise']);
  expect(speciesKeys.filter(s => !companionCatalog[s].canTransform)).toEqual(['dragon', 'capybara', 'rabbit', 'unicorn']);
  expect(speciesKeys.filter(s => companionRoute(s) === 'male')).toEqual(['ape', 'tortoise']);
  expect(speciesKeys.filter(s => companionRoute(s) === 'dual')).toEqual(['fox', 'phoenix', 'cat', 'wolf']);
  expect(stages).toEqual([0, 50, 300, 900, 1800]);
  expect(stageNames).toEqual(['宠物蛋', '初生期', '幼年期', '少年期', '成年期']);
});

test('化形只在可化形伙伴的少年和成年期开放', () => {
  for (const species of speciesKeys) for (let stage = 0; stage <= 4; stage++) {
    expect(canTransform(species, stage)).toBe(companionCatalog[species].canTransform && stage >= 3);
    const asset = companionAsset(species, stage, 'human', 'boy');
    expect(asset.includes('-human-boy')).toBe(canTransform(species, stage));
  }
  expect(canTransform('unknown', 4)).toBe(false);
});

test('旧宠物按语义保留已解锁年龄，最终形态仍为成年，成长门槛总量不增加', () => {
  expect([0, 1, 2, 3].map(legacyStageToCurrent)).toEqual([0, 2, 3, 4]);
  expect(stages[4]).toBe(1800);
});

test('70个成长和化形素材完整且不同年龄不共用同一张图', () => {
  const files: string[] = [];
  for (const species of speciesKeys) for (let stage = 0; stage <= 4; stage++) {
    files.push(companionAsset(species, stage));
    if (canTransform(species, stage)) for (const style of humanStylesFor(species)) files.push(companionAsset(species, stage, 'human', style));
  }
  expect(new Set(files).size).toBe(70);
  for (const file of files) {
    expect(existsSync('public' + file), file).toBe(true);
    const bytes = readFileSync('public' + file);
    expect(bytes.length, file).toBeGreaterThan(1000);
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString()).toBe('WEBP');
  }
  for (const species of speciesKeys) {
    const teen = readFileSync('public' + companionAsset(species, 3));
    const adult = readFileSync('public' + companionAsset(species, 4));
    expect(teen.equals(adult), species).toBe(false);
  }
});

test('男性路线不能选择女性，资产解析也不会返回不存在的女性文件', () => {
  for (const species of ['ape', 'tortoise'] as const) for (const stage of [3, 4]) {
    expect(humanStylesFor(species)).toEqual(['boy']);
    expect(canUseHumanStyle(species, stage, 'boy')).toBe(true);
    expect(canUseHumanStyle(species, stage, 'girl')).toBe(false);
    expect(companionAsset(species, stage, 'human', 'girl')).toBe(`/pets/v2/${species}-${stage}-human-boy.webp`);
  }
  expect(canUseHumanStyle('fox', 3, 'girl')).toBe(true);
  expect(canUseHumanStyle('fox', 3, 'boy')).toBe(true);
  expect(canUseHumanStyle('ape', 2, 'boy')).toBe(false);
});
