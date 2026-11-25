export const speciesKeys = ['dragon', 'fox', 'phoenix', 'capybara', 'rabbit', 'cat', 'wolf', 'unicorn', 'ape', 'tortoise'] as const;
export type Species = typeof speciesKeys[number];
export type HumanStyle = 'boy' | 'girl';
export type CompanionRoute = 'animal' | 'dual' | 'male';
export const stages = [0, 50, 300, 900, 1800] as const;
export const maxStage = 4;
export const stageNames = ['宠物蛋', '初生期', '幼年期', '少年期', '成年期'] as const;
export const speciesNames: Record<Species, string> = {
  dragon: '青龙', fox: '月灵狐', phoenix: '星羽凤凰', capybara: '森屿水豚',
  rabbit: '绒云兔', cat: '墨星猫', wolf: '霜岚狼', unicorn: '虹光独角兽',
  ape: '赤焰灵猿', tortoise: '曜石玄龟',
};
export const companionCatalog: Record<Species, {
  canTransform: boolean; humanStyles: readonly HumanStyle[]; description: string; personality: string;
  forms: readonly [string, string, string, string];
}> = {
  dragon: { canTransform: false, humanStyles: [], description: '从小奶龙长成腾云青龙，一直以神兽形态陪伴。', personality: '勇敢 · 帅气 · 可靠', forms: ['小奶龙', '灵动幼龙', '御风青龙', '腾云青龙'] },
  fox: { canTransform: true, humanStyles: ['boy', 'girl'], description: '月光下的小狐狸，少年期解锁男女人形，也能一直保持灵狐模样。', personality: '灵巧 · 神秘 · 温柔', forms: ['小奶狐', '月光幼狐', '月灵伙伴', '月华灵使'] },
  phoenix: { canTransform: true, humanStyles: ['boy', 'girl'], description: '从绒羽雏鸟长成凤凰，少年期解锁逐星少年或少女形态。', personality: '自由 · 明亮 · 优雅', forms: ['绒羽雏鸟', '星羽幼鸟', '逐星伙伴', '星羽守望者'] },
  capybara: { canTransform: false, humanStyles: [], description: '带着叶子和小背包，慢慢长成森林向导，始终保留水豚模样。', personality: '松弛 · 呆萌 · 安心', forms: ['水豚宝宝', '活泼幼豚', '旅行水豚', '森林向导'] },
  rabbit: { canTransform: false, humanStyles: [], description: '从小绒球长成云境灵兔，长耳朵和软毛一直都在。', personality: '软萌 · 轻盈 · 热心', forms: ['小绒球', '长耳幼兔', '踏云灵兔', '云境灵兔'] },
  cat: { canTransform: true, humanStyles: ['boy', 'girl'], description: '追逐星光的小猫，少年期可以化为俏皮的男性或女性魔法师。', personality: '机灵 · 酷萌 · 俏皮', forms: ['星点奶猫', '追星幼猫', '墨星伙伴', '星夜魔法师'] },
  wolf: { canTransform: true, humanStyles: ['boy', 'girl'], description: '风雪中的小奶狼，少年期解锁男女人形，长大成为可靠的守护者。', personality: '勇敢 · 精神 · 可靠', forms: ['银白奶狼', '踏雪幼狼', '霜岚伙伴', '风雪守护者'] },
  unicorn: { canTransform: false, humanStyles: [], description: '晶角、鬃毛与羽翼一起长大，最终成为虹光天马，始终保持神兽形态。', personality: '梦幻 · 优雅 · 温暖', forms: ['初生幼驹', '晶角小马', '展翼灵驹', '虹光天马'] },
  ape: { canTransform: true, humanStyles: ['boy'], description: '从调皮小猿长成烈阳行者，少年期解锁男性化形；热血、灵巧、有担当。', personality: '热血 · 机灵 · 坚持', forms: ['小奶猿', '赤焰幼猿', '赤焰少年', '烈阳行者'] },
  tortoise: { canTransform: true, humanStyles: ['boy'], description: '从小龟宝宝长成玄甲守护者，少年期解锁男性化形，稳稳守护每一份努力。', personality: '沉稳 · 可靠 · 坚定', forms: ['小龟宝宝', '曜石幼龟', '玄甲少年', '玄甲守护者'] },
};
export function humanStylesFor(species: string): readonly HumanStyle[] {
  return speciesKeys.includes(species as Species) ? companionCatalog[species as Species].humanStyles : [];
}
export function companionRoute(species: Species): CompanionRoute {
  const count = humanStylesFor(species).length;
  return count === 0 ? 'animal' : count === 1 ? 'male' : 'dual';
}
export function canTransform(species: string, stage: number) {
  return humanStylesFor(species).length > 0 && stage >= 3 && stage <= maxStage;
}
export function canUseHumanStyle(species: string, stage: number, style: string) {
  return canTransform(species, stage) && humanStylesFor(species).includes(style as HumanStyle);
}
export function companionAsset(species: Species, stage: number, appearance = 'animal', humanStyle = 'boy') {
  const safeStage = Math.max(0, Math.min(maxStage, Math.trunc(stage)));
  const human = appearance === 'human' && canTransform(species, safeStage);
  const available = humanStylesFor(species);
  const requested = humanStyle === 'girl' ? 'girl' : 'boy';
  const style = available.includes(requested) ? requested : available[0] ?? 'boy';
  return `/pets/v2/${species}-${safeStage}${human ? `-human-${style}` : ''}.webp`;
}
export function legacyStageToCurrent(stage: number) {
  return [0, 2, 3, 4][stage] ?? 0;
}
