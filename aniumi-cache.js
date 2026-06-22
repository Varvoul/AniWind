/**
 * aniumi-cache.js  v3.0
 * Global Supabase media cache — aniumi.vercel.app
 *
 * Tables used:
 *   media_cache  — section-level JSON blobs (hero, schedule, sidebar lists etc.)
 *   shows        — one row per unique show (main info page data)
 *   show_details — cast/artwork/trailers/themes per show
 *
 * TTL (global — set by FIRST visitor, all others read from cache):
 *   2h  : main body sections (hero, top_airing, new_releases, etc.)
 *   6h  : show_info (info page main body)
 *   8h  : sidebar sections (hidden_gem, top_ranking, most_favourite etc.)
 *   24h : schedule
 *
 * Partial-failure safe: if fetcher() throws, nothing is written and the
 * NEXT visitor retries. Other sections are unaffected.
 */
(function () {
  'use strict';

  const URL  = 'https://uhjucwqiadymmogmwkxc.supabase.co';
  const KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVoanVjd3FpYWR5bW1vZ213a3hjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MTY0NDcsImV4cCI6MjA5NzA5MjQ0N30.nJZQftmkbu0Ix-4lgtfzJcm_qIkI32e3SykF49XPrlg';

  const TTL = {
    hero_slider:2, top_airing:2, new_releases:2, new_on_aniumi:2,
    recently_completed:2, trending_now:2,
    show_info:6,
    top_ranking:8, most_popular:8, popular_anime:8,
    hidden_gem:8, most_favourite:8, recommended_for_you:8,
    water_temple:8, sunken_treasure:8,
    schedule:24,
  };

  const H = () => ({
    'apikey': KEY, 'Authorization': `Bearer ${KEY}`,
    'Content-Type': 'application/json',
  });

  async function req(path, opts = {}) {
    try {
      const r = await fetch(`${URL}/rest/v1/${path}`, {
        ...opts,
        headers: { ...H(), ...(opts.headers || {}) },
        signal: opts.signal || AbortSignal.timeout(9000),
      });
      if (r.status === 409) return null; // duplicate — already exists, OK
      if (!r.ok) {
        console.warn('[AniCache]', r.status, path, await r.text().catch(()=>''));
        return null;
      }
      const ct = r.headers.get('content-type') || '';
      return ct.includes('json') ? r.json() : null;
    } catch (e) {
      console.warn('[AniCache] unreachable:', path, e.message);
      return null;
    }
  }

  async function rpc(fn, params) {
    return req(`rpc/${fn}`, {
      method: 'POST', body: JSON.stringify(params),
      headers: { Prefer: 'return=representation' },
    });
  }

  // ══════════════════════════════════════════════════════════════
  // CORE CACHE  (media_cache table)
  // ══════════════════════════════════════════════════════════════

  /**
   * get(keyOrQuery)
   *   string  → look up by cache_key, return data if not expired
   *   object  → { section, media_type, limit } → query sidebar items
   */
  async function get(keyOrQuery) {
    if (typeof keyOrQuery === 'string') {
      const rows = await rpc('get_media_cache', { p_cache_key: keyOrQuery });
      if (Array.isArray(rows) && rows[0]?.data) return rows[0].data;
      return null;
    }
    // Object query — used by loadHiddenGems / loadTopRanking / loadMostFavourite
    // to fetch previously stored sidebar item arrays
    const { section, media_type, limit = 20 } = keyOrQuery;
    const rows = await rpc('get_sidebar_items', {
      p_section: section, p_media_type: media_type, p_limit: limit
    });
    // rows may be the data jsonb directly or an array of rows
    if (!rows) return [];
    if (Array.isArray(rows)) return rows;
    if (typeof rows === 'object' && !Array.isArray(rows) && rows !== null) {
      // single jsonb value returned
      return Array.isArray(rows.data) ? rows.data : [];
    }
    return [];
  }

  /**
   * set({ cacheKey, pageSource, section, subKey?, showId?,
   *        malId?, tmdbId?, anikotoId?, mediaType?, data, itemCount? })
   */
  async function set({ cacheKey, pageSource, section, subKey = null,
    showId = null, malId = null, tmdbId = null, anikotoId = null,
    mediaType = null, data, itemCount = null }) {
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
      p_media_type:     mediaType,
    });
  }

  /**
   * getOrFetch — cache-aside pattern with partial-failure safety
   */
  async function getOrFetch({ cacheKey, pageSource, section, subKey,
    showId, malId, tmdbId, anikotoId, mediaType, fetcher }) {
    const cached = await get(cacheKey);
    if (cached !== null) {
      console.log(`[AniCache] ✅ HIT  ${cacheKey}`);
      return cached;
    }
    console.log(`[AniCache] ⬇️  MISS ${cacheKey}`);
    let fresh;
    try { fresh = await fetcher(); } catch (e) {
      console.warn(`[AniCache] ❌ fetch failed (${cacheKey}):`, e.message);
      return null; // partial failure — only this section falls back to API
    }
    if (!fresh) return null;
    set({ cacheKey, pageSource, section, subKey, showId, malId,
          tmdbId, anikotoId, mediaType, data: fresh }).catch(()=>{});
    return fresh;
  }

  // ══════════════════════════════════════════════════════════════
  // SHOWS TABLE  (one row per unique show)
  // ══════════════════════════════════════════════════════════════

  /**
   * findShow(mediaId) → show row | null
   * Returns null if not found OR if show_info_fetched_at > 6h ago (stale)
   */
  async function findShow(mediaId) {
    const rows = await req(
      `shows?show_id=eq.${encodeURIComponent(mediaId)}&select=*&limit=1`
    );
    if (!Array.isArray(rows) || !rows[0]) return null;
    const row = rows[0];
    // Freshness check — 6h
    if (row.show_info_fetched_at) {
      const age = Date.now() - new Date(row.show_info_fetched_at).getTime();
      if (age > 6 * 3600 * 1000) return null;
    }
    return row;
  }

  /**
   * save(rows) — upsert array of show objects into `shows` table.
   * Each row must have: id or show_id (e.g. "jikan-123")
   * Handles 409 gracefully (already exists with same PK).
   */
  async function save(rows) {
    if (!rows?.length) return;
    const now = new Date().toISOString();
    const normalised = rows.map(r => {
      const sid = r.show_id || r.id || r.media_id;
      if (!sid) return null;
      const isAnime = r.type === 'Anime' || r.source === 'jikan';
      return {
        show_id:              sid,
        media_id:             sid,
        mal_id:               r.mal_id   ? String(r.mal_id)   : null,
        tmdb_id:              r.tmdb_id  ? String(r.tmdb_id)  : null,
        anikoto_id:           r.anikoto_id || null,
        type:                 r.type     || null,
        title:                r.title    || null,
        eng_title:            r.eng_title || r.title_english || r.title || null,
        default_title:        r.title    || null,
        japanese_title:       r.japanese_title || r.title_japanese || null,
        synopsis:             r.synopsis || null,
        overview:             r.overview || r.synopsis || null,
        genres:               Array.isArray(r.genres)
          ? JSON.stringify(r.genres)
          : (r.genres ? JSON.stringify([r.genres]) : null),
        studios:              Array.isArray(r.studios)
          ? JSON.stringify(r.studios)
          : null,
        studio_name:          Array.isArray(r.studios)
          ? r.studios.join(', ')
          : (r.studio_name || null),
        score:                r.score != null ? Number(r.score) : null,
        mal_score:            isAnime && r.score != null ? Number(r.score) : null,
        tmdb_average_score:   !isAnime && r.score != null ? Number(r.score) : null,
        rating_score:         r.score != null ? Number(r.score) : null,
        content_rating:       r.content_rating || r.certification || r.rating || null,
        certification:        r.certification || r.content_rating || null,
        show_status:          r.show_status || r.status || null,
        aired_date:           r.aired_date || r.aired?.from || r.release_date || r.first_air_date || null,
        premiered:            r.premiered || null,
        total_episodes:       r.episodes != null ? Number(r.episodes) : (r.total_episodes != null ? Number(r.total_episodes) : null),
        anime_duration_time:  r.duration || r.anime_duration_time || null,
        tmdb_movie_tv_runtime:r.runtime ? String(r.runtime) : (r.episode_run_time?.[0] ? String(r.episode_run_time[0]) : null),
        poster:               r.poster || r.poster_url || null,
        poster_url:           r.poster || r.poster_url || null,
        poster_path:          r.poster_path || null,
        backdrop:             r.backdrop || r.backdrop_url || null,
        backdrop_url:         r.backdrop || r.backdrop_url || null,
        backdrop_path:        r.backdrop_path || null,
        popularity:           r.popularity || r.members != null ? Number(r.popularity || r.members) : null,
        rank:                 r.rank != null ? Number(r.rank) : null,
        show_info_fetched_at: now,
        fetched_at:           now,
        updated_at:           now,
      };
    }).filter(Boolean);

    if (!normalised.length) return;

    // Upsert one row at a time to handle 409 per-row (not all-or-nothing)
    for (const row of normalised) {
      await req('shows', {
        method: 'POST',
        body: JSON.stringify(row),
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      });
    }
  }

  /**
   * saveDetails(showId, details)
   * details: { cast_crew?, artwork?, trailers?, themes?, statistics? }
   * Upserts into show_details table.
   */
  async function saveDetails(showId, details) {
    if (!showId || !details) return;
    const now = new Date().toISOString();
    const patch = { show_id: showId, updated_at: now, fetched_at: now };
    if (details.cast_crew  !== undefined) patch.cast_crew  = details.cast_crew;
    if (details.artwork    !== undefined) patch.artwork    = details.artwork;
    if (details.trailers   !== undefined) patch.trailers   = details.trailers;
    if (details.themes     !== undefined) patch.themes     = details.themes;
    if (details.statistics !== undefined) patch.statistics = details.statistics;
    // Merge show_info sub-keys into show_details
    if (details.show_info  !== undefined) {
      Object.assign(patch, details.show_info);
    }
    return req('show_details', {
      method: 'POST',
      body: JSON.stringify(patch),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
  }

  /**
   * getDetails(showId) → show_details row | null
   * renderTabs() uses this to skip API calls for cast/artwork/trailers/themes.
   */
  async function getDetails(showId) {
    const rows = await req(
      `show_details?show_id=eq.${encodeURIComponent(showId)}&select=*&limit=1`
    );
    if (!Array.isArray(rows) || !rows[0]) return null;
    const row = rows[0];
    // Freshness: 8h for details
    if (row.fetched_at) {
      const age = Date.now() - new Date(row.fetched_at).getTime();
      if (age > 8 * 3600 * 1000) return null;
    }
    return row;
  }

  // ══════════════════════════════════════════════════════════════
  // SECTION STAMPS  (used by sidebar freshness checks)
  // ══════════════════════════════════════════════════════════════

  /**
   * isSectionFresh(cacheKey) → boolean
   * True if media_cache has a non-expired row for this key.
   */
  async function isSectionFresh(cacheKey) {
    const rows = await req(
      `media_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=expires_at&limit=1`
    );
    if (!Array.isArray(rows) || !rows[0]) return false;
    return new Date(rows[0].expires_at) > new Date();
  }

  /**
   * stampSection(cacheKey, itemCount)
   * Writes a lightweight freshness stamp into media_cache.
   * Sidebar code calls this AFTER saving items to `shows` table
   * so isSectionFresh returns true next time.
   */
  async function stampSection(cacheKey, itemCount) {
    const parts   = cacheKey.split(':');
    const section = parts[1] || cacheKey.split('_').slice(0,-1).join('_') || 'misc';
    const page    = parts[0] || 'info';
    const ttl     = TTL[section] || 8;
    return set({
      cacheKey, pageSource: page, section,
      data: { stamped: true, count: itemCount },
      itemCount,
    });
  }

  /**
   * saveSchedule(scheduleData)
   * { monday:[...], tuesday:[...], ... wednesday, thursday, friday, saturday, sunday }
   */
  async function saveSchedule(scheduleData) {
    return set({
      cacheKey: 'index:schedule', pageSource: 'index',
      section: 'schedule', data: scheduleData,
      itemCount: Object.keys(scheduleData).length,
    });
  }

  // ══════════════════════════════════════════════════════════════
  // EXPORT
  // ══════════════════════════════════════════════════════════════
  window.AniCache = {
    get, set, getOrFetch,
    findShow, save, saveDetails, getDetails,
    isSectionFresh, stampSection, saveSchedule,
    TTL,
  };

  console.log('[AniCache] v3.0 ready — Supabase cache active');
})();
