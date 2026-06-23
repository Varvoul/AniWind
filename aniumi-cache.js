/**
 * aniumi-cache.js  v5.0
 * Global Supabase media cache — aniumi.vercel.app
 *
 * Tables used:
 *   media_cache  — section-level JSON blobs (hero, schedule, sidebar lists etc.)
 *   shows        — one row per unique show (main info page data)
 *   show_details — cast/artwork/trailers/themes per show
 *
 * CACHING STRATEGY (v5.0):
 *   Finished Airing / Ended / Released  →  PERMANENT cache (year 2099 expiry)
 *   Currently Airing / Returning Series →  8h TTL (refreshes until status changes)
 *   All other (unknown status)         →  8h TTL
 *
 * TTL for non-permanent entries:
 *   2h  : main body sections (hero, top_airing, new_releases, etc.)
 *   8h  : info page sections (show_info, water_temple, sunken, etc.)
 *   72h : sidebar sections (hidden_gem, top_ranking, most_favourite)
 *   24h : schedule
 *
 * v3.1: Replaced broken RPC calls with direct REST API calls.
 * v3.2: Increased show_info TTL to 8h, req timeout to 15s.
 * v4.0: Permanent cache for finished airing anime. 8h for currently airing.
 * v5.0: Fixed set() 409 handling (was reported as failure).
 *        Sidebar TTL changed to 72h (3 days).
 *        Larger timeout (25s) for cache saves to handle big TMDB payloads.
 *        Added trimTMDBData() helper for reducing cache payload size.
 */
(function () {
  'use strict';

  const URL  = 'https://uhjucwqiadymmogmwkxc.supabase.co';
  const KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVoanVjd3FpYWR5bW1vZ213a3hjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MTY0NDcsImV4cCI6MjA5NzA5MjQ0N30.nJZQftmkbu0Ix-4lgtfzJcm_qIkI32e3SykF49XPrlg';

  // Far-future expiry for permanent cache entries
  const PERMANENT_EXPIRY = '2099-12-31T23:59:59.000Z';

  const TTL = {
    hero_slider:2, top_airing:2, new_releases:2, new_on_aniumi:2,
    recently_completed:2, trending_now:2,
    show_info:8, info_full_data:8,
    water_temple:8, sunken_treasure:8, show_recs:8,
    // Sidebar sections: 72h (3 days) — these lists change very slowly
    top_ranking:72, most_popular:72, popular_anime:72,
    hidden_gem:72, most_favourite:72,
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
        signal: opts.signal || AbortSignal.timeout(15000),
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

  // ══════════════════════════════════════════════════════════════
  // STATUS HELPERS
  // ══════════════════════════════════════════════════════════════

  /**
   * isPermanentStatus(status) → boolean
   * Returns true if the anime/show status means data won't change.
   * Jikan: "Finished Airing"
   * TMDB:  "Ended", "Released"
   */
  function isPermanentStatus(status) {
    if (!status) return false;
    const s = String(status).trim();
    return s === 'Finished Airing' || s === 'Ended' || s === 'Released';
  }

  // ══════════════════════════════════════════════════════════════
  // TMDB DATA TRIMMER
  // ══════════════════════════════════════════════════════════════

  /**
   * trimTMDBData(data) → trimmed copy
   * TMDB responses with append_to_response can be 2-5MB.
   * Trim to essential fields to keep payload under 200KB for DB storage.
   */
  function trimTMDBData(data) {
    if (!data || typeof data !== 'object') return data;
    const trimmed = { ...data };

    // Trim images: keep first 20 posters, 10 backdrops, 3 logos
    if (trimmed.images) {
      const imgs = { ...trimmed.images };
      if (Array.isArray(imgs.posters))  imgs.posters  = imgs.posters.slice(0, 20);
      if (Array.isArray(imgs.backdrops)) imgs.backdrops = imgs.backdrops.slice(0, 10);
      if (Array.isArray(imgs.logos))    imgs.logos    = imgs.logos.slice(0, 3);
      trimmed.images = imgs;
    }

    // Trim credits: keep first 50 cast, 20 crew
    if (trimmed.credits) {
      const cr = { ...trimmed.credits };
      if (Array.isArray(cr.cast)) cr.cast = cr.cast.slice(0, 50);
      if (Array.isArray(cr.crew)) cr.crew = cr.crew.slice(0, 20);
      trimmed.credits = cr;
    }

    // Trim videos: keep first 20
    if (trimmed.videos?.results) {
      trimmed.videos = { ...trimmed.videos, results: trimmed.videos.results.slice(0, 20) };
    }

    // Trim seasons: keep all (needed for Watch More), but remove episode-level data
    if (Array.isArray(trimmed.seasons)) {
      trimmed.seasons = trimmed.seasons.map(s => {
        const { episode_count, id, name, overview, poster_path, season_number, air_date, vote_average } = s;
        return { episode_count, id, name, overview, poster_path, season_number, air_date, vote_average };
      });
    }

    // Remove alternative_titles if present (not used in rendering)
    delete trimmed.alternative_titles;
    // Remove changes (not needed)
    delete trimmed.changes;
    // Remove keywords (not used in rendering)
    delete trimmed.keywords;
    // Remove translation data (not used)
    delete trimmed.translations;

    return trimmed;
  }

  // ══════════════════════════════════════════════════════════════
  // CORE CACHE  (media_cache table — direct REST, no RPC)
  // ══════════════════════════════════════════════════════════════

  /**
   * get(keyOrQuery)
   *   string  → look up by cache_key in media_cache, return data if not expired
   *   object  → { section, media_type, limit } → query shows table for sidebar items
   */
  async function get(keyOrQuery) {
    if (typeof keyOrQuery === 'string') {
      const rows = await req(
        `media_cache?cache_key=eq.${encodeURIComponent(keyOrQuery)}&select=data,expires_at&limit=1`
      );
      if (!Array.isArray(rows) || !rows[0]) return null;
      // Check expiry (permanent entries have 2099 expiry — always fresh)
      if (rows[0].expires_at && new Date(rows[0].expires_at) <= new Date()) return null;
      return rows[0].data;
    }
    // Object query — query shows table for sidebar items
    const { section, media_type, limit = 20 } = keyOrQuery;
    const typeMap = { anime: 'Anime', movie: 'Movie', tv: 'TV' };
    const typeValue = media_type ? (typeMap[media_type.toLowerCase()] || media_type) : null;

    let query = `shows?select=*&limit=${limit}`;
    switch (section) {
      case 'hidden_gem':
        query += '&rating_score=gt.7.4&popularity=gt.0&order=rating_score.desc.nullslast,popularity.asc';
        break;
      case 'top_ranking':
        query += '&rating_score=gt.0&order=rating_score.desc.nullslast,popularity.desc';
        break;
      case 'most_favourite':
      case 'popular':
        query += '&popularity=gt.0&order=popularity.desc.nullslast,rating_score.desc';
        break;
      default:
        query += '&order=popularity.desc.nullslast';
    }
    if (typeValue) {
      query += `&type=eq.${encodeURIComponent(typeValue)}`;
    }

    const rows = await req(query);
    if (!Array.isArray(rows)) return [];
    return rows;
  }

  /**
   * set({ cacheKey, ..., permanent? })
   *   permanent = true  → expires_at set to 2099 (cache forever)
   *   permanent = false → uses section TTL (default)
   *
   * Uses a longer timeout (25s) for large payloads (TMDB data with images).
   * Properly handles HTTP 409 (merge-duplicate) as SUCCESS.
   */
  async function set({ cacheKey, pageSource, section, subKey = null,
    showId = null, malId = null, tmdbId = null, anikotoId = null,
    mediaType = null, data, itemCount = null, permanent = false }) {
    const ttl = TTL[section] || 8;
    const now = new Date().toISOString();
    const expiresAt = permanent ? PERMANENT_EXPIRY : new Date(Date.now() + ttl * 3600 * 1000).toISOString();

    const row = {
      cache_key:     cacheKey,
      page_source:   pageSource,
      section:       section,
      sub_key:       subKey,
      show_id:       showId,
      mal_id:        malId   ? Number(malId)  : null,
      tmdb_id:       tmdbId  ? Number(tmdbId) : null,
      anikoto_id:    anikotoId || null,
      data:          data,
      item_count:    itemCount ?? (Array.isArray(data) ? data.length : null),
      interval_hours: permanent ? 876000 : ttl, // ~100 years vs actual TTL
      media_type:    mediaType,
      fetched_at:    now,
      expires_at:    expiresAt,
      updated_at:    now,
    };

    // Direct fetch with 25s timeout for large payloads, proper 409 handling
    try {
      const r = await fetch(`${URL}/rest/v1/media_cache`, {
        method: 'POST',
        headers: { ...H(), 'Prefer': 'resolution=merge-duplicates,return=minimal', 'Content-Type': 'application/json' },
        body: JSON.stringify(row),
        signal: AbortSignal.timeout(25000),
      });
      if (r.status === 409 || r.status === 201) return { ok: true, status: r.status };
      if (!r.ok) {
        const errText = await r.text().catch(() => '');
        console.warn('[AniCache] set() failed:', r.status, cacheKey, errText.slice(0, 200));
        return null;
      }
      return { ok: true, status: r.status };
    } catch (e) {
      console.warn('[AniCache] set() error:', cacheKey, e.message);
      return null;
    }
  }

  /**
   * getOrFetch — cache-aside pattern with partial-failure safety
   */
  async function getOrFetch({ cacheKey, pageSource, section, subKey,
    showId, malId, tmdbId, anikotoId, mediaType, permanent, fetcher }) {
    const cached = await get(cacheKey);
    if (cached !== null) {
      console.log(`[AniCache] HIT ${cacheKey}`);
      return cached;
    }
    console.log(`[AniCache] MISS ${cacheKey}`);
    let fresh;
    try { fresh = await fetcher(); } catch (e) {
      console.warn(`[AniCache] fetch failed (${cacheKey}):`, e.message);
      return null;
    }
    if (!fresh) return null;
    set({ cacheKey, pageSource, section, subKey, showId, malId,
          tmdbId, anikotoId, mediaType, data: fresh, permanent }).catch(()=>{});
    return fresh;
  }

  // ══════════════════════════════════════════════════════════════
  // SHOWS TABLE  (one row per unique show)
  // ══════════════════════════════════════════════════════════════

  /**
   * findShow(mediaId) → show row | null
   * Finished Airing → always return (permanent cache, no freshness check)
   * Currently Airing / unknown → 8h freshness check
   */
  async function findShow(mediaId) {
    const rows = await req(
      `shows?media_id=eq.${encodeURIComponent(mediaId)}&select=*&limit=1`
    );
    if (!Array.isArray(rows) || !rows[0]) return null;
    const row = rows[0];

    // Permanent cache: finished airing anime data never changes
    if (isPermanentStatus(row.show_status)) {
      console.log(`[AniCache] findShow permanent: ${mediaId} (${row.show_status})`);
      return row;
    }

    // Time-based freshness for airing / unknown status
    if (row.fetched_at) {
      const age = Date.now() - new Date(row.fetched_at).getTime();
      if (age > 8 * 3600 * 1000) return null;
    }
    return row;
  }

  /**
   * save(rows) — upsert array of show objects into `shows` table.
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
        default_title:        r.default_title || r.title || null,
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
        poster_path:          r.poster_path || r.poster || r.poster_url || null,
        backdrop:             r.backdrop || r.backdrop_url || null,
        backdrop_url:         r.backdrop || r.backdrop_url || null,
        backdrop_path:        r.backdrop_path || r.backdrop || r.backdrop_url || null,
        popularity:           r.popularity || r.members != null ? Number(r.popularity || r.members) : null,
        rank:                 r.rank != null ? Number(r.rank) : null,
        show_info_fetched_at: now,
        fetched_at:           now,
        updated_at:           now,
      };
    }).filter(Boolean);

    if (!normalised.length) return;

    for (const row of normalised) {
      await req('shows', {
        method: 'POST',
        body: JSON.stringify(row),
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      });
    }
  }

  /**
   * saveDetails(showId, details, { permanent? })
   * Upserts into show_details table.
   * permanent → sets fetched_at to far future so getDetails() always returns it.
   */
  async function saveDetails(showId, details, { permanent = false } = {}) {
    if (!showId || !details) return;
    const now = permanent ? PERMANENT_EXPIRY : new Date().toISOString();
    const patch = { show_id: showId, updated_at: new Date().toISOString(), fetched_at: now };
    if (details.cast_crew  !== undefined) patch.cast_crew  = details.cast_crew;
    if (details.artwork    !== undefined) patch.artwork    = details.artwork;
    if (details.trailers   !== undefined) patch.trailers   = details.trailers;
    if (details.themes     !== undefined) patch.themes     = details.themes;
    if (details.statistics !== undefined) patch.statistics = details.statistics;
    return req('show_details', {
      method: 'POST',
      body: JSON.stringify(patch),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
  }

  /**
   * getDetails(showId, { permanent? }) → show_details row | null
   * permanent=true → always return if row exists (skip freshness check)
   */
  async function getDetails(showId, { permanent = false } = {}) {
    const rows = await req(
      `show_details?show_id=eq.${encodeURIComponent(showId)}&select=*&limit=1`
    );
    if (!Array.isArray(rows) || !rows[0]) return null;
    const row = rows[0];
    if (permanent) return row; // Finished airing — always fresh
    // 8h freshness for airing shows
    if (row.fetched_at) {
      const age = Date.now() - new Date(row.fetched_at).getTime();
      if (age > 8 * 3600 * 1000) return null;
    }
    return row;
  }

  // ══════════════════════════════════════════════════════════════
  // SECTION STAMPS
  // ══════════════════════════════════════════════════════════════

  async function isSectionFresh(cacheKey) {
    const rows = await req(
      `media_cache?cache_key=eq.${encodeURIComponent(cacheKey)}&select=expires_at&limit=1`
    );
    if (!Array.isArray(rows) || !rows[0]) return false;
    return new Date(rows[0].expires_at) > new Date();
  }

  async function stampSection(cacheKey, itemCount, { permanent = false, section: explicitSection } = {}) {
    const parts   = cacheKey.split(':');
    const section = explicitSection || parts[1] || cacheKey.split('_').slice(0,-1).join('_') || 'misc';
    const page    = parts[0] || 'info';
    return set({
      cacheKey, pageSource: page, section,
      data: { stamped: true, count: itemCount },
      itemCount, permanent,
    });
  }

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
    isPermanentStatus, trimTMDBData,
    TTL, PERMANENT_EXPIRY,
  };

  console.log('[AniCache] v5.0 ready — permanent cache, 72h sidebar, 409 fix, TMDB trim');
})();