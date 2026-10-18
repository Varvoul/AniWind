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

// ── Neon resilience (t110) ──────────────────────────────────────────────
// A sick Neon (e.g. the recurring HTTP 402 quota outage) makes every DB
// call burn ~1.5-2s before failing — a tax paid on EVERY request that
// touches the DB path. The circuit breaker turns that into "at most one
// probe per 5 minutes pays it": after 2 consecutive failures the circuit
// opens and callers skip the DB entirely (their memory/CDN/fallback layers
// keep serving — the documented degradation mode). When Neon answers
// normally the breaker is a no-op and the timeout never fires.
let _neonFailures = 0;
let _neonOpenUntil = 0;

export function neonCircuitOpen() {
  return Date.now() < _neonOpenUntil;
}

/**
 * Runs one Neon operation under the shared circuit breaker + timeout.
 *   - circuit open  -> throws immediately (no network attempt)
 *   - op exceeds timeoutMs -> rejects (the underlying call is not
 *     cancellable in the HTTP driver, but the caller stops waiting)
 *   - any failure increments the failure streak; 2 in a row opens the
 *     circuit for 5 minutes; a success resets the streak.
 */
export async function withNeon(op, { timeoutMs = 3500 } = {}) {
  if (neonCircuitOpen()) throw new Error('neon circuit open');
  let timer = null;
  try {
    const result = await Promise.race([
      Promise.resolve().then(op),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`neon timeout ${timeoutMs}ms`)), timeoutMs); }),
    ]);
    _neonFailures = 0;
    return result;
  } catch (e) {
    _neonFailures++;
    if (_neonFailures >= 2) {
      _neonOpenUntil = Date.now() + 5 * 60 * 1000;
      _neonFailures = 0;
      console.error('[neon] circuit OPEN for 5min after repeated failures:', e.message);
    }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
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
