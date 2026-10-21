import { neon } from '@neondatabase/serverless';

let _sql = null;

/** Lazily creates (once per warm function instance) the Neon HTTP client. */
export function getSql() {
  if (!_sql) {
    if (!process.env.NEON_DATABASE_URL) {
      throw new Error('NEON_DATABASE_URL is not configured');
    }
    _sql = neon(process.env.NEON_DATABASE_URL);
  }
  return _sql;
}

/**
 * Recursively flattens any {key: array-or-object, ...} shape into one flat
 * array. Handles two real data quirks in this view:
 *   - `tmdbTV` sub-keys are sometimes an object keyed by rotating page/genre
 *     numbers (e.g. {"13":[...], "14":[...]}) instead of a plain array.
 *   - `ani_schedule.Anime.<Day>` is nested one level deeper again.
 * Plain arrays pass through untouched.
 */
export function toArray(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return Object.values(v).flatMap(toArray);
  return [];
}
