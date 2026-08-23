import { readSection } from './_lib/cache.js';
import { assertValidSection } from './_lib/sections.js';

export const config = { runtime: 'edge' };

const CACHE_CYCLE_HOURS = 6;

function json(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

export default async function handler(req) {
  const url = new URL(req.url);
  const section = url.searchParams.get('section');

  try {
    assertValidSection(section);
  } catch (e) {
    return json({ error: e.message }, e.statusCode || 400);
  }

  let result;
  try {
    result = await readSection(section);
  } catch (e) {
    return json({ error: `read failed: ${e.message}` }, 500);
  }

  const envelope = result?.envelope ?? null;
  const cycleStart = result?.cache_cycle_started_at ? new Date(result.cache_cycle_started_at) : null;
  const cachedAt = envelope?.cached_at ? new Date(envelope.cached_at) : null;

  const isStale =
    !envelope ||
    envelope.is_complete !== true ||
    !cachedAt ||
    !cycleStart ||
    cachedAt < cycleStart ||
    Date.now() - cachedAt.getTime() > CACHE_CYCLE_HOURS * 3600 * 1000;

  // Don't make THIS visitor wait on a refresh — fire a background trigger
  // (not awaited) so the NEXT request gets fresh data instead. Cheap and
  // safe to call repeatedly: claimSectionForRefresh() inside /refresh is
  // the actual gate that stops duplicate work, this is just the trigger.
  if (isStale && process.env.CACHE_REFRESH_SECRET) {
    const origin = url.origin;
    fetch(`${origin}/api/cache/refresh?section=${encodeURIComponent(section)}&secret=${process.env.CACHE_REFRESH_SECRET}`, {
      method: 'GET',
    }).catch(() => {
      // Best-effort only — a failed trigger just means the next stale read tries again.
    });
  }

  if (!envelope) {
    // Nothing cached yet at all (e.g. brand new section) — say so plainly,
    // don't pretend there's data.
    return json(
      { section, envelope: null, refreshing: isStale },
      200,
      { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=30' }
    );
  }

  return json(
    { section, envelope, refreshing: isStale },
    200,
    // Edge-cached response — this is what protects Neon under real traffic:
    // regardless of how many visitors hit this in the same window, Neon
    // itself only actually gets queried once every ~30s per section.
    { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' }
  );
}
