/**
 * favorites — 用户收藏的球队 slug，存 localStorage。
 *
 * Schema:  ["japan", "argentina"]  (array of team slug strings)
 *
 * 设计：完全客户端，无服务器，刷新页面会重新读 localStorage。
 * 跨 page 同步用 'storage' event 监听（其他 tab 修改时自动更新当前 tab UI）。
 */

const KEY = 'kickoffwhen.favorites';

export function getFavorites() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function isFavorite(slug) {
  return getFavorites().includes(slug);
}

export function toggleFavorite(slug) {
  const list = getFavorites();
  const idx = list.indexOf(slug);
  if (idx === -1) list.push(slug);
  else list.splice(idx, 1);
  localStorage.setItem(KEY, JSON.stringify(list));
  // Notify same-tab listeners (storage event only fires for other tabs)
  window.dispatchEvent(new CustomEvent('favorites-change', { detail: list }));
  return list.includes(slug);
}
