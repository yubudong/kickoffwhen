/**
 * Timezone & date formatting helpers — pure browser APIs, no dependencies.
 *
 * 所有比赛时间在 JSON 里都是 UTC ISO（如 "2026-06-11T19:00:00Z"）。
 * 这个文件负责把 UTC 转成"用户/指定时区"下的人类可读字符串。
 */

/** 用户当前浏览器的 IANA 时区（如 "Asia/Tokyo"）。SSR 阶段调用会返回 "UTC"。 */
export function detectUserTimezone() {
  if (typeof Intl === 'undefined') return 'UTC';
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** 我们 UI 顶部时区切换器的几个固定亚洲选项 */
export const ASIA_TIMEZONES = [
  { id: 'Asia/Tokyo',     label: 'JST',  cityJa: '東京',   cityEn: 'Tokyo'    },
  { id: 'Asia/Seoul',     label: 'KST',  cityJa: 'ソウル', cityEn: 'Seoul'    },
  { id: 'Asia/Shanghai',  label: 'CST',  cityJa: '上海',   cityEn: 'Shanghai' },
  { id: 'Asia/Taipei',    label: 'TWT',  cityJa: '台北',   cityEn: 'Taipei'   },
  { id: 'Asia/Hong_Kong', label: 'HKT',  cityJa: '香港',   cityEn: 'Hong Kong'},
  { id: 'Asia/Singapore', label: 'SGT',  cityJa: 'シンガポール', cityEn: 'Singapore' },
  { id: 'Asia/Bangkok',   label: 'ICT',  cityJa: 'バンコク', cityEn: 'Bangkok' },
];

/**
 * 把 UTC ISO 字符串格式化为指定时区下的 "MM/DD HH:mm"。
 * locale 决定星期几等子模式（zh/ja 不同）。
 * @returns {string} 例 "06/12 04:00"
 */
export function formatLocalTime(utcIso, timezone, locale = 'en') {
  if (!utcIso) return '';
  const d = new Date(utcIso);
  const fmt = new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    timeZone: timezone,
    month:    '2-digit',
    day:      '2-digit',
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false,
  });
  return fmt.format(d);
}

/**
 * 拿到指定时区下的日期对象拆分（年月日时分 + 周几）。
 * 比 formatLocalTime 灵活，调用方可以自行拼字符串。
 */
export function getLocalParts(utcIso, timezone, locale = 'en') {
  if (!utcIso) return null;
  const d = new Date(utcIso);
  const parts = new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    timeZone: timezone,
    year:     'numeric',
    month:    '2-digit',
    day:      '2-digit',
    hour:     '2-digit',
    minute:   '2-digit',
    weekday:  'short',
    hour12:   false,
  }).formatToParts(d);
  const out = {};
  for (const p of parts) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  return {
    year:    out.year,
    month:   out.month,
    day:     out.day,
    hour:    parseInt(out.hour, 10),
    minute:  out.minute,
    weekday: out.weekday,
    iso:     `${out.year}-${out.month}-${out.day}T${out.hour}:${out.minute}`,
  };
}

/**
 * 拿到指定时区下的"当地小时"。供熬夜评分的 sleepPain 用。
 * @returns {number} 0-23
 */
export function getLocalHour(utcIso, timezone) {
  const parts = getLocalParts(utcIso, timezone);
  return parts ? parts.hour : -1;
}

/**
 * 距开赛还有多少天/小时/分钟。负数表示已开赛。
 * 用于倒计时显示。
 */
export function getCountdown(utcIso, now = Date.now()) {
  if (!utcIso) return null;
  const diff = new Date(utcIso).getTime() - now;
  const past = diff < 0;
  const abs = Math.abs(diff);
  return {
    past,
    diffMs:  diff,
    days:    Math.floor(abs / 86400000),
    hours:   Math.floor((abs % 86400000) / 3600000),
    minutes: Math.floor((abs % 3600000) / 60000),
    seconds: Math.floor((abs % 60000) / 1000),
  };
}

/**
 * 判断某场比赛在指定时区下是不是"深夜场"。
 * sleepPain 评分会用这个的分级。
 * @returns {'late'|'deep'|'early'|'normal'}
 */
export function categorizeKickoff(utcIso, timezone) {
  const h = getLocalHour(utcIso, timezone);
  if (h < 0) return 'normal';
  if (h >= 0 && h <= 2)  return 'late';   // 晚睡型，硬撑可看
  if (h >= 3 && h <= 5)  return 'deep';   // 深夜真痛苦
  if (h >= 6 && h <= 8)  return 'early';  // 起早型也算熬
  return 'normal';
}
