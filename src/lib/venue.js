import venues from '../data/venues.json';

export function getLocalizedVenue(venueName, locale) {
  if (!venueName) return { name: '', city: '' };
  const v = venues[venueName];
  if (!v) return { name: venueName, city: '' };
  const key = locale === 'ja' || locale === 'ko' || locale === 'zh' ? locale : null;
  return {
    name: key ? v[`name_${key}`] || venueName : venueName,
    city: key ? v[`city_${key}`] || v.city : v.city,
  };
}
