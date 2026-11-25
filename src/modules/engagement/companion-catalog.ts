export const speciesKeys = ['dragon', 'fox', 'phoenix', 'capybara', 'rabbit', 'cat', 'wolf', 'unicorn'] as const;
export type Species = typeof speciesKeys[number];
export const stages = [0, 50, 300, 900, 1800] as const;
export const maxStage = 4;
export const stageNames = ['宠物蛋', '初生期', '幼年期', '少年期', '成年期'] as const;
export const speciesNames: Record<Species, string> = {
  dragon: '青龙', fox: '月灵狐', phoenix: '星羽凤凰', capybara: '森屿水豚',
  rabbit: '绒云兔', cat: '墨星猫', wolf: '霜岚狼', unicorn: '虹光独角兽',
};
export const companionCatalog: Record<Species, {
  canTransform: boolean; description: string; personality: string;
  forms: readonly [string, string, string, string];
}> = {
  dragon: { canTransform: false, description: '从小奶龙长成腾云青龙，一直以神兽形态陪伴。', personality: '勇敢 · 帅气 · 可靠', forms: ['小奶龙', '灵动幼龙', '御风青龙', '腾云青龙'] },
  fox: { canTransform: true, description: '月光下的小狐狸，少年期解锁人形，也能一直保持灵狐模样。', personality: '灵巧 · 神秘 · 温柔', forms: ['小奶狐', '月光幼狐', '月灵伙伴', '月华灵使'] },
  phoenix: { canTransform: true, description: '从绒羽雏鸟长成凤凰，少年期解锁逐星人形。', personality: '自由 · 明亮 · 优雅', forms: ['绒羽雏鸟', '星羽幼鸟', '逐星伙伴', '星羽守望者'] },
  capybara: { canTransform: false, description: '带着叶子和小背包，慢慢长成森林向导，始终保留水豚模样。', personality: '松弛 · 呆萌 · 安心', forms: ['水豚宝宝', '活泼幼豚', '旅行水豚', '森林向导'] },
  rabbit: { canTransform: false, description: '从小绒球长成云境灵兔，长耳朵和软毛一直都在。', personality: '软萌 · 轻盈 · 热心', forms: ['小绒球', '长耳幼兔', '踏云灵兔', '云境灵兔'] },
  cat: { canTransform: true, description: '追逐星光的小猫，少年期可以化为俏皮的小魔法师。', personality: '机灵 · 酷萌 · 俏皮', forms: ['星点奶猫', '追星幼猫', '墨星伙伴', '星夜魔法师'] },
  wolf: { canTransform: true, description: '风雪中的小奶狼，少年期解锁人形，长大成为可靠的守护者。', personality: '勇敢 · 精神 · 可靠', forms: ['银白奶狼', '踏雪幼狼', '霜岚伙伴', '风雪守护者'] },
  unicorn: { canTransform: false, description: '晶角、鬃毛与羽翼一起长大，最终成为虹光天马，始终保持神兽形态。', personality: '梦幻 · 优雅 · 温暖', forms: ['初生幼驹', '晶角小马', '展翼灵驹', '虹光天马'] },
};
export function canTransform(species: string, stage: number) {
  return speciesKeys.includes(species as Species) && companionCatalog[species as Species].canTransform && stage >= 3 && stage <= maxStage;
}
export function companionAsset(species: Species, stage: number, appearance = 'animal', humanStyle = 'girl') {
  const safeStage = Math.max(0, Math.min(maxStage, Math.trunc(stage)));
  const human = appearance === 'human' && canTransform(species, safeStage);
  return `/pets/v2/${species}-${safeStage}${human ? `-human-${humanStyle === 'boy' ? 'boy' : 'girl'}` : ''}.webp`;
}
export function legacyStageToCurrent(stage: number) {
  return [0, 2, 3, 4][stage] ?? 0;
}
