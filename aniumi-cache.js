/**
 * aniumi-cache.js  v2.0
 * Global Supabase media cache for aniumi.vercel.app
 *
 * Key behaviours:
 *  • Global 2h TTL for index/info main body (set once by FIRST visitor, all others read)
 *  • Global 8h TTL for sidebar sections
 *  • Global 24h TTL for schedule
 *  • Partial-failure safe: if a section fails/times out for one visitor, only THAT
 *    section falls back to live API → result written to Supabase → next visitor
 *    gets it from cache. The 2h timer is NOT reset; it was already set by the
 *    first visitor who succeeded for that section.
 *  • Methods: get, set, getOrFetch, findShow, save, saveDetails, getDetails,
 *             stampSection, isSectionFresh, saveSchedule
 */
(function () {
  'use strict';

  const SUPA_URL = 'https://uhjucwqiadymmogmwkxc.supabase.co';
  const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVoanVjd3FpYWR5bW1vZ213a3hjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MTY0NDcsImV4cCI6MjA5NzA5MjQ0N30.nJZQftmkbu0Ix-4lgtfzJcm_qIkI32e3SykF49XPrlg';

  // ── TTL map (hours) ──────────────────────────────────────────────
  const TTL = {
    // Index + info main body — global 2h
    hero_slider: 2, top_airing: 2, new_releases: 2,
    new_on_aniumi: 2, recently_completed: 2, trending_now: 2,
    show_info: 6,
    // Sidebar — global 8h
    top_ranking: 8, most_popular: 8, popular_anime: 8,
    hidden_gem: 8, most_favourite: 8, recommended_for_you: 8,
    water_temple: 8, sunken_treasure: 8,
    // Schedule — global 24h
    schedule: 24,
  };

  // ── Low-level helpers ────────────────────────────────────────────
  const HDR = {
    'apikey':        SUPA_KEY,
    'Authorization': `Bearer ${SUPA_KEY}`,
    'Content-Type':  'application/json',
  };

  async function supa(path, opts = {}) {
    try {
      const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
        ...opts,
        headers: { ...HDR, ...(opts.headers || {}) },
        signal: opts.signal || AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`${res.status} ${txt.slice(0,100)}`);
      }
      const ct = res.headers.get('content-type') || '';
      return ct.includes('json') ? res.json() : null;
    } catch (e) {
      // Network timeout or Supabase down → silently return null
      // Site continues with live API; next visitor will still benefit once cached
      console.warn('[AniCache] Supabase unreachable:', path, e.message);
      return null;
    }
  }

  async function rpc(fn, params) {
    return supa(`rpc/${fn}`, {
      method: 'POST',
      body: JSON.stringify(params),
      headers: { Prefer: 'return=representation' },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // CORE READ/WRITE
  // ═══════════════════════════════════════════════════════════════

  /**
   * get(cacheKey) → data | null
   * Returns cached JSON only if expires_at > now().
   * Null means cache miss — caller must fetch from API.
   */
  async function get(cacheKey) {
    const rows = await rpc('get_media_cache', { p_cache_key: cacheKey });
    if (Array.isArray(rows) && rows[0]?.data) return rows[0].data;
    return null;
  }

  /**
   * set({ cacheKey, pageSource, section, subKey?, showId?, malId?,
   *        tmdbId?, anikotoId?, data, itemCount? })
   *
   * IMPORTANT: TTL is determined by `section` → TTL map.
   * The expires_at is set to now() + TTL — this is the GLOBAL expiry
   * shared by all visitors. No visitor can reset the timer;
   * only a full cache miss (expires_at < now()) triggers a new write.
   */
  async function set({ cacheKey, pageSource, section, subKey = null,
    showId = null, malId = null, tmdbId = null, anikotoId = null,
    data, itemCount = null }) {
    const ttl = TTL[section] || 2;
    return rpc('upsert_media_cache', {
      p_cache_key:      cacheKey,
      p_page_source:    pageSource,
      p_section:        section,
      p_sub_key:        subKey,
      p_show_id:        showId,
      p_mal_id:         malId   ? Number(malId)  : null,
      p_tmdb_id:        tmdbId  ? Number(tmdbId) : null,
      p_anikoto_id:     anikotoId || null,
      p_data:           data,
      p_item_count:     itemCount ?? (Array.isArray(data) ? data.length : null),
      p_interval_hours: ttl,
    });
  }

  /**
   * getOrFetch({ cacheKey, pageSource, section, subKey?, showId?,
   *              malId?, tmdbId?, anikotoId?, fetcher })
   *
   * Try cache → on miss run fetcher() → store result → return data.
   *
   * Partial-failure behaviour:
   *   If fetcher() throws (network error, API rate-limit, timeout):
   *     → returns null, logs warning
   *     → does NOT write anything to Supabase
   *     → next visitor will also miss cache for this section → retries API
   *     → once ANY visitor succeeds → written to Supabase → all subsequent use cache
   *   The 2h global timer for OTHER sections is unaffected.
   */
  async function getOrFetch({ cacheKey, pageSource, section, subKey,
    showId, malId, tmdbId, anikotoId, fetcher }) {
    // 1) Cache hit
    const cached = await get(cacheKey);
    if (cached !== null) {
      console.log(`[AniCache] ✅ HIT  ${cacheKey}`);
      return cached;
    }
    console.log(`[AniCache] ⬇️  MISS ${cacheKey}`);

    // 2) Fetch from live API
    let fresh;
    try {
      fresh = await fetcher();
    } catch (e) {
      console.warn(`[AniCache] ❌ fetcher failed (${cacheKey}):`, e.message);
      // Partial failure — return null; this section alone falls back to API
      // for next visitor. All other sections remain cached.
      return null;
    }
    if (!fresh) return null;

    // 3) Write to Supabase (non-blocking — page renders while this happens)
    set({ cacheKey, pageSource, section, subKey, showId, malId,
          tmdbId, anikotoId, data: fresh }).catch(() => {});
    return fresh;
  }

  // ═══════════════════════════════════════════════════════════════
  // SHOW TABLE HELPERS (used by info.html fetchShowData)
  // ═══════════════════════════════════════════════════════════════

  /**
   * findShow(showId) → show row | null
   * Reads from `shows` table. Returns null if not found or expired (>6h).
   */
  async function findShow(showId) {
    const rows = await supa(
      `shows?show_id=eq.${encodeURIComponent(showId)}&select=*&limit=1`
    );
    if (!Array.isArray(rows) || !rows[0]) return null;
    const row = rows[0];
    // Check freshness — show_info must be < 6h old
    if (row.show_info_fetched_at) {
      const age = Date.now() - new Date(row.show_info_fetched_at).getTime();
      if (age > 6 * 3600 * 1000) return null; // stale — let API refresh
    }
    return row;
  }

  /**
   * save(rows) — upsert show-level data into `shows` table.
   * Each row: { id/show_id, title, mal_id, tmdb_id, ... }
   */
  async function save(rows) {
    if (!rows?.length) return;
    // Normalise: ensure show_id field
    const normalised = rows.map(r => ({
      show_id:     r.show_id || r.id || r.media_id,
      mal_id:      r.mal_id  ? Number(r.mal_id)  : null,
      tmdb_id:     r.tmdb_id ? Number(r.tmdb_id) : null,
      anikoto_id:  r.anikoto_id || null,
      title:       r.title || null,
      title_english: r.title_english || r.eng_title || r.title || null,
      show_type:   r.type ? r.type.toLowerCase() : null,
      status:      r.show_status || r.status || null,
      poster_url:  r.poster || r.poster_url || null,
      backdrop_url:r.backdrop || r.backdrop_url || null,
      score:       r.score != null ? Number(r.score) : null,
      year:        r.year ? Number(r.year) : null,
      fetched_at:  new Date().toISOString(),
      updated_at:  new Date().toISOString(),
    })).filter(r => r.show_id);

    return supa('shows', {
      method: 'POST',
      body: JSON.stringify(normalised),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
  }

  /**
   * saveDetails(showId, detailsObj)
   * Patches specific JSONB columns on the shows row.
   * detailsObj keys map to columns: cast_crew, artwork, trailer, themes,
   *   statistics, recommended_for_you, water_temple, sunken_treasure, show_info
   */
  async function saveDetails(showId, detailsObj) {
    if (!showId || !detailsObj) return;
    const patch = { updated_at: new Date().toISOString() };

    const COL_MAP = {
      cast_crew:           'show_info',   // merged into show_info JSON
      artwork:             'show_info',
      trailer:             'show_info',
      themes:              'show_info',
      statistics:          'show_info',
      recommended_for_you: 'recommended_for_you',
      water_temple:        'water_temple',
      sunken_treasure:     'sunken_treasure',
      show_info:           'show_info',
    };

    // Group sub-keys that all go into show_info together
    let showInfoMerge = {};
    for (const [k, v] of Object.entries(detailsObj)) {
      const col = COL_MAP[k];
      if (!col) continue;
      if (col === 'show_info') {
        showInfoMerge[k] = v;
      } else {
        patch[col] = v;
      }
    }
    if (Object.keys(showInfoMerge).length > 0) {
      // Merge into existing show_info JSONB via SQL concat
      // We'll store as a separate media_cache entry and let trigger sync it
      await set({
        cacheKey:    `info:show_info_details:${showId}`,
        pageSource:  'info',
        section:     'show_info',
        subKey:      'details',
        showId,
        data:        showInfoMerge,
      }).catch(() => {});
      patch.show_info_fetched_at = new Date().toISOString();
    }

    if (Object.keys(patch).length <= 1) return; // nothing to patch
    return supa(`shows?show_id=eq.${encodeURIComponent(showId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
      headers: { Prefer: 'return=minimal' },
    });
  }

  /**
   * getDetails(showId) → show row | null
   * Used by info.html to load cast/artwork/trailer/themes without re-fetching.
   */
  async function getDetails(showId) {
    const rows = await supa(
      `shows?show_id=eq.${encodeURIComponent(showId)}&select=show_info,recommended_for_you,water_temple,sunken_treasure,show_info_fetched_at&limit=1`
    );
    if (!Array.isArray(rows) || !rows[0]) return null;
    return rows[0];
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION FRESHNESS STAMPS (used by sidebar functions)
  // isSectionFresh / stampSection check media_cache directly
  // ═══════════════════════════════════════════════════════════════

  /**
   * isSectionFresh(cacheKey) → boolean
   * True if a non-expired entry exists in media_cache for this key.
   * Used to skip API calls for sidebar sections when already cached.
   */
  async function isSectionFresh(cacheKey) {
    const rows = await supa(
      `media_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=expires_at&limit=1`
    );
    if (!Array.isArray(rows) || !rows[0]) return false;
    return new Date(rows[0].expires_at) > new Date();
  }

  /**
   * stampSection(cacheKey, itemCount)
   * Writes/updates a lightweight stamp entry for a section.
   * Used after sidebar API calls to mark section as fresh.
   * Does NOT overwrite data if already exists (MISS only writes).
   */
  async function stampSection(cacheKey, itemCount) {
    // Derive section from cacheKey (e.g. "info:hidden_gem:jikan-123" → "hidden_gem")
    const parts = cacheKey.split(':');
    const section = parts[1] || 'misc';
    const pageSource = parts[0] || 'info';
    return set({ cacheKey, pageSource, section, data: { stamped: true, count: itemCount }, itemCount });
  }

  // ═══════════════════════════════════════════════════════════════
  // SCHEDULE (24h TTL, global)
  // ═══════════════════════════════════════════════════════════════

  /**
   * saveSchedule(scheduleData)
   * scheduleData: { monday:[...], tuesday:[...], ... }
   */
  async function saveSchedule(scheduleData) {
    return set({
      cacheKey:    'index:schedule',
      pageSource:  'index',
      section:     'schedule',
      data:        scheduleData,
      itemCount:   Object.keys(scheduleData).length,
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // EXPORT
  // ═══════════════════════════════════════════════════════════════
  window.AniCache = {
    get, set, getOrFetch,
    findShow, save, saveDetails, getDetails,
    isSectionFresh, stampSection,
    saveSchedule,
    TTL,
  };

  console.log('[AniCache] v2.0 loaded — global Supabase cache active');
})();
