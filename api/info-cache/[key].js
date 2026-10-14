// ─────────────────────────────────────────────────────────────────────────
// /api/info-cache/<key>   — server-side 3-hour TTL cache for info pages
//
// WHY: finished/released shows are cached permanently in the visitor's
// browser (AniCache localStorage). AIRING / NOT-YET-AIRED / UPCOMING shows
// change too often for that — their info page payload is stored HERE for
// 3 hours instead, and ALL visitors share that one cached copy. After the
// TTL expires the payload is dropped; the next visitor's live fetch
// re-saves it, restarting the 3-hour window.
//
// GET  → { found: true, data, savedAt, expiresAt }   (404 {found:false} on miss/expired)
// POST → body: { data: <payload object> }             (upsert, restarts TTL)
//
// Storage layers:
//   1. Warm-instance memory Map (instant, survives between nearby requests)
//   2. Neon Postgres `info_page_cache` table (durable across cold starts)
//   3. Vercel edge CDN via short s-maxage=60 + stale-while-revalidate (burst
//      absorption; kept SHORT on purpose so a fresh POST becomes visible
//      quickly instead of serving a stale miss for hours)
//
// Degradation: with NEON_DATABASE_URL unset (or a DB error) the endpoint
// falls back to memory-only — the feature keeps working inside a warm
// window and simply rebuilds after cold starts.
// ─────────────────────────────────────────────────────────────────────────

import { getSql } from '../_lib/neon.js';

const TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
const MAX_PAYLOAD_CHARS = 1800000; // ~1.8MB JSON — mirrors the browser cap
const KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{2,119}$/;

const mem = new Map();        // key -> { data, savedAt }
let tableReady = false;       // CREATE TABLE attempted once per warm instance

async function ensureTable(sql) {
  if (tableReady || !sql) return;
  try {
    await sql`CREATE TABLE IF NOT EXISTS info_page_cache (
      cache_key  text PRIMARY KEY,
      payload    jsonb NOT NULL,
      saved_at   timestamptz NOT NULL DEFAULT now()
    )`;
    tableReady = true;
  } catch (e) {
    console.error('[info-cache] ensureTable failed:', e.message);
  }
}

function validPayload(d) {
  return !!d && typeof d === 'object' && !Array.isArray(d) &&
    (typeof d.title === 'string' || typeof d.name === 'string' ||
     typeof d.title_english === 'string');
}

function serveHit(res, key, entry) {
  const savedAt = entry.savedAt;
  const expiresAt = savedAt + TTL_MS;
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  res.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=60');
  res.status(200).json({
    found: true,
    key,
    savedAt: new Date(savedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    data: entry.data,
  });
}

function serveMiss(res, key) {
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
  res.status(404).json({ found: false, key });
}

export default async function handler(req, res) {
  const key = String((req.query && req.query.key) || '');
  if (!KEY_RE.test(key)) {
    return res.status(400).json({ error: 'invalid cache key' });
  }

  if (req.method === 'GET') {
    const now = Date.now();
    const m = mem.get(key);
    if (m && now - m.savedAt < TTL_MS) return serveHit(res, key, m);
    if (m) mem.delete(key); // expired in memory

    try {
      const sql = getSql();
      if (sql) {
        await ensureTable(sql);
        const rows = await sql`
          SELECT payload, saved_at FROM info_page_cache
          WHERE cache_key = ${key} AND saved_at > now() - interval '3 hours'
          LIMIT 1`;
        if (rows && rows.length) {
          const entry = { data: rows[0].payload, savedAt: new Date(rows[0].saved_at).getTime() };
          mem.set(key, entry);
          return serveHit(res, key, entry);
        }
        // expired or never-saved row — best-effort cleanup of stale rows
        try { await sql`DELETE FROM info_page_cache WHERE cache_key = ${key} AND saved_at <= now() - interval '3 hours'`; } catch (e) {}
      }
    } catch (e) {
      console.error('[info-cache] GET db error:', e.message);
    }
    return serveMiss(res, key);
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const data = body.data !== undefined ? body.data : body;
    if (!validPayload(data)) {
      return res.status(400).json({ error: 'payload must be an object with title/name' });
    }
    let json;
    try { json = JSON.stringify(data); } catch (e) {
      return res.status(400).json({ error: 'payload not serializable' });
    }
    if (json.length > MAX_PAYLOAD_CHARS) {
      return res.status(413).json({ error: 'payload too large', chars: json.length });
    }

    const savedAt = Date.now();
    mem.set(key, { data, savedAt });

    try {
      const sql = getSql();
      if (sql) {
        await ensureTable(sql);
        await sql`
          INSERT INTO info_page_cache (cache_key, payload, saved_at)
          VALUES (${key}, ${JSON.stringify(data)}::jsonb, now())
          ON CONFLICT (cache_key)
          DO UPDATE SET payload = EXCLUDED.payload, saved_at = now()`;
      }
    } catch (e) {
      console.error('[info-cache] POST db error (memory-only this round):', e.message);
    }
    return res.status(200).json({
      ok: true,
      key,
      expiresAt: new Date(savedAt + TTL_MS).toISOString(),
    });
  }

  return res.status(405).json({ error: 'method not allowed — use GET or POST' });
}
