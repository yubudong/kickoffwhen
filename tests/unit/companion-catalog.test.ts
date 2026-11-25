import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { canTransform, companionAsset, companionCatalog, legacyStageToCurrent, speciesKeys, stageNames, stages } from '@/modules/engagement/companion-catalog';

test('八种伙伴明确分为四种可化形和四种动物神兽路线', () => {
  expect(speciesKeys).toEqual(['dragon', 'fox', 'phoenix', 'capybara', 'rabbit', 'cat', 'wolf', 'unicorn']);
  expect(speciesKeys.filter(s => companionCatalog[s].canTransform)).toEqual(['fox', 'phoenix', 'cat', 'wolf']);
  expect(speciesKeys.filter(s => !companionCatalog[s].canTransform)).toEqual(['dragon', 'capybara', 'rabbit', 'unicorn']);
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

test('56个成长和化形素材完整且不同年龄不共用同一张图', () => {
  const files: string[] = [];
  for (const species of speciesKeys) for (let stage = 0; stage <= 4; stage++) {
    files.push(companionAsset(species, stage));
    if (canTransform(species, stage)) for (const style of ['boy', 'girl']) files.push(companionAsset(species, stage, 'human', style));
  }
  expect(new Set(files).size).toBe(56);
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
