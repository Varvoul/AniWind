// Every column in the `page_cache` table that holds section data.
// This is the single source of truth for valid section names across the
// whole caching system — refresh, read, and status endpoints all validate
// against this list before touching the database.
export const SECTION_COLUMNS = new Set([
  'hero_slider',
  'top_airing',
  'new_releases_all',
  'new_releases_hidden',
  'new_on_aniumi',
  'upcoming',
  'recently_completed',
  'trending_now',
  'most_favourite',
  'popular_anime',
  'schedule',
]);

export function assertValidSection(section) {
  if (typeof section !== 'string' || !SECTION_COLUMNS.has(section)) {
    const err = new Error(`Unknown cache section: ${JSON.stringify(section)}`);
    err.statusCode = 400;
    throw err;
  }
  return section;
}
