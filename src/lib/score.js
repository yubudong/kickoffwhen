/**
 * Night-owl score — 综合"比赛吸引力 + 用户偏好 + 熬夜痛苦"算出一个 1-5 星。
 *
 * 分三层：
 *   matchAppeal  — 来自 matches.json 的 `match_appeal` 字段（中立比赛吸引力，预计算）
 *   personalBoost — 基于用户语言 / favoriteTeams / 是否亚洲队加分
 *   sleepPain    — 基于用户时区下开球小时的痛苦加分
 *
 * 显示分（1-5 星）= clamp(roundToHalf(matchAppeal + personalBoost + sleepPain), 1, 5)
 * 内部保留 raw 分供"今夜 TOP 3"排序使用。
 */

import { categorizeKickoff } from './timezone.js';

// locale → 本国 ISO 三字母代码（其他语言不加 localeHomeTeam 分）
const LOCALE_HOME = {
  ja: 'JPN',
  ko: 'KOR',
};

// 亚洲足球协会 (AFC) + 大洋洲东道主 — 任何一方在内 → personalBoost +0.5
const ASIAN_CODES = new Set([
  'JPN', 'KOR', 'AUS', 'IRN', 'KSA', 'UZB', 'JOR', 'IRQ', 'QAT',
]);

/** 半精度四舍五入 */
function roundHalf(n) {
  return Math.round(n * 2) / 2;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * 计算 personalBoost。
 * @param {{home_code: string, away_code: string}} match
 * @param {{locale?: string, favoriteTeams?: string[]}} ctx
 *   - locale: 'ja' | 'ko' | 'en' | 'zh'，按 URL 前缀拿
 *   - favoriteTeams: 用户主动收藏的球队 slug 数组（从 localStorage）
 * @returns {{ score: number, reason: string|null }}
 */
export function calcPersonalBoost(match, ctx = {}) {
  const { locale, favoriteTeams = [] } = ctx;
  const codes = [match.home_code, match.away_code].filter(Boolean);

  // 优先：用户收藏（需要 slug 而不是 code，由 team 名转 slug）
  // 简化：调用方应已用 team.slug 数组传入
  if (favoriteTeams.length && match.home_slug && match.away_slug) {
    if (favoriteTeams.includes(match.home_slug) || favoriteTeams.includes(match.away_slug)) {
      return { score: 2.0, reason: 'favorite' };
    }
  }

  // 次：locale 对应本国
  const homeCode = LOCALE_HOME[locale];
  if (homeCode && codes.includes(homeCode)) {
    return { score: 1.5, reason: 'home_country' };
  }

  // 再次：任意亚洲队参赛
  if (codes.some(c => ASIAN_CODES.has(c))) {
    return { score: 0.5, reason: 'asian_team' };
  }

  return { score: 0, reason: null };
}

/**
 * 计算 sleepPain。基于本地开球小时分级。
 * @returns {{ score: number, reason: string|null }}
 */
export function calcSleepPain(utcIso, timezone) {
  const cat = categorizeKickoff(utcIso, timezone);
  switch (cat) {
    case 'late':   return { score: 0.5, reason: 'late_night' };   // 0-2 点
    case 'deep':   return { score: 1.5, reason: 'deep_night' };   // 3-5 点
    case 'early':  return { score: 0.5, reason: 'early_morning' };// 6-8 点
    default:       return { score: 0, reason: null };
  }
}

/**
 * 综合算分。
 * @returns {{
 *   raw: number,           // 内部排序用，不封顶
 *   display: number,       // UI 显示 1-5，0.5 精度
 *   stars: string,         // "🌙🌙🌙🌙☆"
 *   reasons: string[]      // 多个加分理由的 key 集合，UI 可用于本地化
 * }}
 */
export function calcNightOwlScore(match, ctx = {}) {
  const matchAppeal = match.match_appeal ?? 2;
  const tz = ctx.timezone || 'UTC';

  const personal = calcPersonalBoost(match, ctx);
  const sleep    = calcSleepPain(match.kickoff_utc, tz);

  const raw     = matchAppeal + personal.score + sleep.score;
  const display = clamp(roundHalf(raw), 1, 5);

  const reasons = [];
  if (matchAppeal >= 4) reasons.push('high_appeal');
  if (personal.reason)  reasons.push(personal.reason);
  if (sleep.reason)     reasons.push(sleep.reason);

  return {
    raw,
    display,
    stars: toStars(display),
    reasons,
  };
}

/**
 * 1-5 数字 → 月亮 emoji 字符串。半星用 ☾，空星用 ☆。
 * 例：3.5 → "🌙🌙🌙☾☆"
 */
export function toStars(score) {
  const full = Math.floor(score);
  const half = score - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return '🌙'.repeat(full) + '☾'.repeat(half) + '☆'.repeat(empty);
}
