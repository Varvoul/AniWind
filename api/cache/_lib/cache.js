import { getSql } from './db.js';
import { assertValidSection } from './sections.js';

export const CACHE_CYCLE_HOURS = 6;
export const CLAIM_STALE_AFTER_MINUTES = 2; // a crashed/hung refresh releases its claim after this long

/**
 * Atomically attempts to claim the right to refresh a section.
 *
 * Returns true  → THIS call won the claim. Caller MUST proceed to fetch,
 *                  filter, and call commitSectionData() (or releaseClaim()
 *                  on failure) so the claim doesn't stay held.
 * Returns false → section is already fresh for the current cycle, OR
 *                  another request is already refreshing it right now.
 *                  Caller should do nothing further.
 *
 * This is a plain conditional UPDATE ... WHERE ... RETURNING — Postgres
 * guarantees only one concurrent request can ever see rows affected > 0,
 * so this is safe under real concurrency without needing advisory locks
 * (which don't survive across the stateless HTTP queries this driver uses).
 */
export async function claimSectionForRefresh(section) {
  assertValidSection(section);
  const sql = getSql();
  const col = sql.unsafe(section);

  const rows = await sql`
    UPDATE page_cache
    SET ${col} = jsonb_set(
      COALESCE(${col}, '{}'::jsonb),
      '{refreshing_since}',
      to_jsonb(now()::text)
    )
    WHERE id = 1
      AND (
        ${col} IS NULL
        OR (${col}->>'is_complete')::boolean IS DISTINCT FROM true
        OR (${col}->>'cached_at') IS NULL
        OR (${col}->>'cached_at')::timestamptz < cache_cycle_started_at
      )
      AND (
        ${col}->>'refreshing_since' IS NULL
        OR (${col}->>'refreshing_since')::timestamptz < now() - interval '${sql.unsafe(String(CLAIM_STALE_AFTER_MINUTES))} minutes'
      )
    RETURNING id
  `;
  return rows.length > 0;
}

/**
 * Writes the final, already-fetched-and-filtered payload for a section.
 * `isComplete` should be false if the fetch was partial (e.g. one of
 * several tabs/pages failed) — a partial write is still stored and served,
 * but will be re-claimed and retried by the next refresh sweep instead of
 * being treated as done for the full 6h cycle.
 *
 * Also advances the shared 6h cycle clock the first time any section
 * writes fresh data past the previous cycle's expiry, so every section's
 * staleness check lines up against the same clock rather than drifting.
 */
export async function commitSectionData(section, data, { isComplete = true, source = 'live' } = {}) {
  assertValidSection(section);
  const sql = getSql();
  const col = sql.unsafe(section);
  const payload = JSON.stringify(data ?? null);

  const rows = await sql`
    UPDATE page_cache
    SET ${col} = jsonb_build_object(
          'data', ${payload}::jsonb,
          'is_complete', ${isComplete},
          'cached_at', now()::text,
          'source', ${source}
        ),
        cache_cycle_started_at = CASE
          WHEN cache_cycle_started_at < now() - interval '${sql.unsafe(String(CACHE_CYCLE_HOURS))} hours'
          THEN now()
          ELSE cache_cycle_started_at
        END,
        last_full_refresh_at = CASE
          WHEN ${isComplete} THEN now()
          ELSE last_full_refresh_at
        END
    WHERE id = 1
    RETURNING id, cache_cycle_started_at
  `;
  return rows[0] ?? null;
}

/** Releases a claim without writing data — used when a refresh attempt throws,
 *  so the next request can retry immediately instead of waiting out the
 *  2-minute stale-claim window. */
export async function releaseClaim(section) {
  assertValidSection(section);
  const sql = getSql();
  const col = sql.unsafe(section);

  await sql`
    UPDATE page_cache
    SET ${col} = ${col} - 'refreshing_since'
    WHERE id = 1 AND ${col} IS NOT NULL
  `;
}

/** Reads one section's envelope as-is (data + metadata). */
export async function readSection(section) {
  assertValidSection(section);
  const sql = getSql();
  const col = sql.unsafe(section);

  const rows = await sql`SELECT ${col} AS value, cache_cycle_started_at FROM page_cache WHERE id = 1`;
  const row = rows[0];
  if (!row) return null;
  return { envelope: row.value, cache_cycle_started_at: row.cache_cycle_started_at };
}

/** Reads freshness/completeness metadata for every section, for the status endpoint. */
export async function readAllSectionStatus() {
  const sql = getSql();

  // Build one SELECT that pulls just the small metadata fields (not the
  // potentially-large `data` payload) from every section column, keeping
  // this diagnostic call cheap even if some sections hold a lot of data.
  // Column names come only from the hardcoded SECTION_COLUMNS allowlist,
  // never from request input, so plain string building here is safe.
  const { SECTION_COLUMNS } = await import('./sections.js');
  const fields = Array.from(SECTION_COLUMNS)
    .map((c) => `'${c}', jsonb_build_object(
        'is_complete', ${c}->>'is_complete',
        'cached_at', ${c}->>'cached_at',
        'source', ${c}->>'source',
        'refreshing_since', ${c}->>'refreshing_since'
      )`)
    .join(', ');

  const rows = await sql.query(
    `SELECT jsonb_build_object(${fields}) AS sections, cache_cycle_started_at, last_full_refresh_at, now() AS server_now FROM page_cache WHERE id = 1`
  );
  return rows[0] ?? null;
}
