/**
 * AniOcean · supabase-cache.js  v3.0  — GLOBAL SHARED CACHE
 * ─────────────────────────────────────────────────────────────────────────────
 * KEY DESIGN: The 15-minute interval is GLOBAL, stored in Supabase cache_meta.
 *
 * HOW IT WORKS (for all visitors worldwide):
 *   1. User A visits at 7:25pm → section cache_meta.fetched_at is old/missing
 *      → fetches from API → saves to media_cache + shows → stamps cache_meta
 *   2. User B visits at 7:30pm → cache_meta says fetched 5 min ago → SKIP API
 *      → reads directly from shows table (zero external API calls)
 *   3. User C visits at 7:41pm → cache_meta says fetched 16 min ago → stale
 *      → fetches from API again → updates only volatile fields in existing rows
 *
 * DEDUP (3-tier, no duplicate writes):
 *   NEW    → full INSERT into media_cache + shows
 *   STALE  → update only volatile fields (score, status, episodes, poster)
 *   FRESH  → SKIP entirely (no write at all)
 *
 * TABLE USAGE:
 *   media_cache  ← raw API data lands here (primary write target)
 *   shows        ← mirror of media_cache (site reads from here)
 *   schedule     ← weekly broadcast schedule
 *   show_details ← info page tabs: cast/artwork/trailer/themes/stats
 *   cache_meta   ← global section timestamps (shared across all users)
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  const REFRESH_MS = 15 * 60 * 1000;   // 15 minutes
  const DETAIL_MS  = 60 * 60 * 1000;   // 1 hour for show_details tabs

  // ── Supabase client (created by shared.js) ────────────────────────────────
  const supa = window.supabaseClient || null;
  if (!supa) {
    console.warn('[AniCache] supabaseClient not found. Load shared.js first.');
    window.AniCache = {
      save:()=>Promise.resolve(), get:()=>Promise.resolve([]),
      findShow:()=>Promise.resolve(null), saveDetails:()=>Promise.resolve(),
      getDetails:()=>Promise.resolve(null), saveSchedule:()=>Promise.resolve(),
      getSchedule:()=>Promise.resolve([]), isSectionFresh:()=>Promise.resolve(false),
      stampSection:()=>Promise.resolve(), buildInfoUrl:s=>'#',
    };
    return;
  }

  // ── TMDB image helper ─────────────────────────────────────────────────────
  const TMDB_IMG = 'https://image.tmdb.org/t/p/';
  function tmdbPoster(p, size='w500')  { return p ? TMDB_IMG+size+p : null; }
  function tmdbBackdrop(p, size='w1280'){ return p ? TMDB_IMG+size+p : null; }

  // ── GLOBAL cache check via cache_meta table ────────────────────────────────
  // Returns true if section was fetched within REFRESH_MS by ANY user globally
  async function isSectionFresh(section) {
    try {
      const { data } = await supa
        .from('cache_meta')
        .select('fetched_at')
        .eq('section', section)
        .maybeSingle();
      if (!data?.fetched_at) return false;
      return (Date.now() - new Date(data.fetched_at).getTime()) < REFRESH_MS;
    } catch { return false; }
  }

  // Stamps a section as just fetched (called after successful API fetch)
  async function stampSection(section, count = 0) {
    try {
      await supa.from('cache_meta').upsert(
        { section, fetched_at: new Date().toISOString(), item_count: count, updated_at: new Date().toISOString() },
        { onConflict: 'section' }
      );
    } catch (e) { console.warn('[AniCache] stampSection error:', e); }
  }

  // ── CANONICAL media_id ─────────────────────────────────────────────────────
  function canonicalId(raw) {
    const id = String(raw.id || raw.media_id || '');
    const mt = (raw.type || raw.media_type || '').toLowerCase();

    // Already canonical
    if (/^jikan-\d+$/.test(id))       return id;
    if (/^tmdb-movie-\d+$/.test(id))  return id;
    if (/^tmdb-tv-\d+$/.test(id))     return id;

    // Anime (all jikan- prefix variants)
    if (/^jikan-/.test(id)) {
      const num = id.replace(/^jikan-[a-z]*-?/, '');
      return `jikan-${num}`;
    }

    // TMDB — use the type field to disambiguate movie vs tv
    const num = id.replace(/^tmdb-[a-z]*-?/, '');
    if (mt === 'movie') return `tmdb-movie-${num}`;
    if (mt === 'tv')    return `tmdb-tv-${num}`;

    // Fallback: check id prefix hints
    if (/^tmdb-(mv|movie|up|tr|pop)-\d+$/.test(id)) {
      const n = id.replace(/^tmdb-[a-z]*-/, '');
      return mt === 'movie' ? `tmdb-movie-${n}` : `tmdb-tv-${n}`;
    }
    return id;
  }

  function mediaTypeOf(raw) {
    const t = (raw.type || raw.media_type || '').toLowerCase();
    if (t === 'anime') return 'anime';
    if (t === 'movie') return 'movie';
    return 'tv';
  }

  function buildPremiered(raw) {
    const from = raw.aired?.from || raw.aired_from || raw.releaseDate || '';
    if (!from) return null;
    const d = new Date(from);
    if (isNaN(d)) return null;
    const S = ['Winter','Winter','Spring','Spring','Spring','Summer','Summer','Summer','Fall','Fall','Fall','Winter'];
    return `${S[d.getMonth()]}-${d.getFullYear()}`;
  }

  // ── ROW BUILDER ───────────────────────────────────────────────────────────
  function toRow(raw) {
    const mid = canonicalId(raw);
    const mt  = mediaTypeOf(raw);
    const isA = mt === 'anime';
    const ts  = new Date().toISOString();

    // Extract numeric IDs
    let mal_id  = raw.mal_id  ? String(raw.mal_id)  : null;
    let tmdb_id = raw.tmdb_id ? String(raw.tmdb_id) : null;
    if (!mal_id  && isA) { const m=mid.match(/^jikan-(\d+)$/);             if(m) mal_id  = m[1]; }
    if (!tmdb_id && !isA){ const m=mid.match(/^tmdb-(?:movie|tv)-(\d+)$/); if(m) tmdb_id = m[1]; }

    // Build full poster/backdrop URLs
    const rawPoster   = raw.poster   || raw.show_poster_link   || raw.images?.jpg?.large_image_url || null;
    const rawBackdrop = raw.backdrop || raw.show_backdrop_landscape_image_link || null;
    // If it's a TMDB path (starts with /), make full URL
    const poster   = rawPoster   && rawPoster.startsWith('/')   ? tmdbPoster(rawPoster)   : rawPoster;
    const backdrop = rawBackdrop && rawBackdrop.startsWith('/') ? tmdbBackdrop(rawBackdrop) : rawBackdrop;

    const studios   = Array.isArray(raw.studios)   ? raw.studios.map(s=>s?.name||s).filter(Boolean)   : [];
    const producers = Array.isArray(raw.producers) ? raw.producers.map(p=>p?.name||p).filter(Boolean) : [];
    const genreArr  = Array.isArray(raw.genres)    ? raw.genres.map(g=>g?.name||g).filter(Boolean)    : [];

    const score = parseFloat(raw.score || raw.mal_score || raw.tmdb_average_score || raw.vote_average || 0) || null;

    return {
      media_id:    mid,
      show_id:     mid,
      media_type:  mt,
      mal_id,
      tmdb_id,
      ani_id:      raw.ani_id   ? String(raw.ani_id)   : null,
      aniko_id:    raw.aniko_id ? String(raw.aniko_id) : null,

      // Titles
      eng_title:      raw.title || raw.eng_title || raw.name || raw.title_english || null,
      default_title:  raw.title || raw.name || raw.default_title || null,
      original_title: raw.original_title || raw.title_japanese || null,
      romanji_title:  raw.romanji_title  || null,
      japanese_title: raw.title_japanese || raw.japanese_title || null,
      synonyms:       Array.isArray(raw.synonyms) ? raw.synonyms.join(', ') : (raw.synonyms||null),

      // Description
      synopsis: raw.synopsis || (isA  ? null : raw.overview) || null,
      overview: raw.overview || (!isA ? null : raw.synopsis) || null,

      // Metadata
      labels:             null,
      country_name:       raw.country_name || null,
      genres:             genreArr.join(', ') || null,
      aired_date:         raw.aired_date || raw.aired?.from?.slice(0,10) || raw.releaseDate || raw.release_date || raw.first_air_date || null,
      broadcast_day_time: raw.broadcast_day_time || (raw.broadcast?.day ? `${raw.broadcast.day} at ${raw.broadcast.time||'?'} (JST)` : null),
      source:             raw.source_material || raw.source || null,
      rank:               raw.rank ? parseInt(raw.rank,10) : null,
      popularity:         raw.popularity ? parseInt(raw.popularity,10) : (raw.members ? parseInt(raw.members,10) : null),

      // Production
      studio_name:    studios.join(', ')   || raw.studio_name  || raw.studio  || null,
      producers_name: producers.join(', ') || raw.producers_name || null,

      // Season
      season_eng_title: raw.season_eng_title || null,
      season_slug:      raw.season_slug      || null,
      season_badge:     raw.season_badge     || null,
      season_num:       raw.season_num ? parseInt(raw.season_num,10) : null,
      season_backdrop_landscape_image_link: raw.season_backdrop_landscape_image_link || null,

      // Episodes
      total_episodes: raw.total_epi_num || raw.total_episodes || raw.episodes || null,
      dub_epi:  raw.dub_epi  != null ? parseInt(raw.dub_epi,10)  : null,
      sub_epi:  raw.sub_epi  != null ? parseInt(raw.sub_epi,10)  : null,
      is_sub:   raw.is_sub   != null ? parseInt(raw.is_sub,10)   : (raw.sub_epi ? 1 : 0),
      is_dub:   raw.is_dub   != null ? parseInt(raw.is_dub,10)   : (raw.dub_epi ? 1 : 0),

      // Skip times
      intro_skip_start: raw.intro_skip_start || null,
      intro_skip_end:   raw.intro_skip_end   || null,
      outro_skip_start: raw.outro_skip_start || null,
      outro_skip_end:   raw.outro_skip_end   || null,

      // Scores & format
      format:             raw.format || raw.type_label || (isA ? raw.type : null) || null,
      mal_score:          raw.mal_score  || (isA  ? score : null),
      tmdb_average_score: raw.tmdb_average_score || (raw.vote_average ? parseFloat(raw.vote_average) : null) || (!isA ? score : null),
      rating_score:       score,
      content_rating:     raw.content_rating || raw.certification || raw.rating || null,
      anime_duration_time:    isA  ? (raw.anime_duration_time || raw.duration || null) : null,
      tmdb_movie_tv_runtime: !isA  ? String(raw.tmdb_movie_tv_runtime || raw.runtime || raw.duration || '') || null : null,
      release_year:
        raw.release_year ||
        (raw.aired?.from    ? parseInt(raw.aired.from.slice(0,4),10)    : null) ||
        (raw.releaseDate    ? parseInt(raw.releaseDate.slice(0,4),10)   : null) ||
        (raw.release_date   ? parseInt(raw.release_date.slice(0,4),10) : null) ||
        (raw.first_air_date ? parseInt(raw.first_air_date.slice(0,4),10) : null) ||
        null,

      // Images — always store full URLs, also keep path columns for compatibility
      show_poster_link:                   poster,
      show_backdrop_landscape_image_link: backdrop,
      poster_path:                        poster,
      backdrop_path:                      backdrop,

      // Links
      external_link:      raw.external_link  || raw.url     || null,
      trailer_video_link: raw.trailer_video_link || raw.trailer || null,

      // Status
      show_status: raw.show_status || raw.status || raw.airing_status || null,
      premiered:   isA ? buildPremiered(raw) : null,

      // Timestamps
      fetched_at: ts,
      updated_at: ts,
    };
  }

  // Volatile fields — updated on stale refresh (not a full rewrite)
  const VOLATILE = ['mal_score','tmdb_average_score','rating_score','popularity','rank',
    'show_status','total_episodes','dub_epi','sub_epi','is_sub','is_dub',
    'show_poster_link','show_backdrop_landscape_image_link','poster_path','backdrop_path',
    'fetched_at','updated_at'];

  // ── DEDUP: check which media_ids already exist in media_cache ─────────────
  async function existingInCache(ids) {
    if (!ids.length) return new Map();
    try {
      const { data } = await supa.from('media_cache')
        .select('media_id,fetched_at').in('media_id', ids);
      return new Map((data||[]).map(r=>[r.media_id, r.fetched_at]));
    } catch { return new Map(); }
  }

  // ── UPSERT helpers ─────────────────────────────────────────────────────────
  async function _upsertCache(rows) {
    if (!rows.length) return;
    const { error } = await supa.from('media_cache')
      .upsert(rows, { onConflict: 'media_id' });
    if (error) console.error('[AniCache] media_cache upsert:', error.message);
    else console.log(`[AniCache] ✓ media_cache: ${rows.length} rows`);
  }

  async function _upsertShows(rows) {
    if (!rows.length) return;
    // SHOWS columns that exist — strip anything media_cache-only
    const SHOWS_ONLY = new Set([
      'id','tmdb_id','imdb_id','mal_id','media_type','eng_title','poster_path',
      'added_at','ani_id','backdrop_path','total_episodes','is_sub','is_dub',
      'rating_score','release_year','show_id','media_id','aniko_id','default_title',
      'original_title','romanji_title','japanese_title','synonyms','synopsis',
      'overview','country_name','genres','aired_date','broadcast_day_time','source',
      'rank','popularity','studio_name','producers_name','season_eng_title',
      'season_slug','season_badge','season_num','season_backdrop_landscape_image_link',
      'dub_epi','sub_epi','intro_skip_start','intro_skip_end','outro_skip_start',
      'outro_skip_end','format','mal_score','tmdb_average_score','content_rating',
      'anime_duration_time','tmdb_movie_tv_runtime','show_poster_link',
      'show_backdrop_landscape_image_link','external_link','trailer_video_link',
      'updated_at','labels','show_status','premiered','fetched_at',
    ]);
    const clean = rows.map(r => {
      const out = {};
      for (const [k,v] of Object.entries(r)) { if (SHOWS_ONLY.has(k)) out[k]=v; }
      return out;
    });
    const { error } = await supa.from('shows')
      .upsert(clean, { onConflict: 'media_id' });
    if (error) console.error('[AniCache] shows upsert:', error.message);
    else console.log(`[AniCache] ✓ shows: ${clean.length} rows`);
  }

  // ── PUBLIC: save items → media_cache + shows (with 3-tier dedup) ──────────
  async function save(items) {
    if (!items?.length) return;
    const rows = items.filter(Boolean).map(toRow).filter(r => r.media_id);
    if (!rows.length) return;

    const staleTs   = new Date(Date.now() - REFRESH_MS).toISOString();
    const existMap  = await existingInCache(rows.map(r=>r.media_id));

    const brandNew  = rows.filter(r => !existMap.has(r.media_id));
    const stale     = rows.filter(r =>  existMap.has(r.media_id) && existMap.get(r.media_id) < staleTs);
    const fresh     = rows.filter(r =>  existMap.has(r.media_id) && existMap.get(r.media_id) >= staleTs);

    if (fresh.length) console.log(`[AniCache] Skipped ${fresh.length} fresh rows`);

    if (brandNew.length) {
      await _upsertCache(brandNew);
      await _upsertShows(brandNew);
    }

    if (stale.length) {
      const volatileOnly = stale.map(r => {
        const out = { media_id: r.media_id };
        VOLATILE.forEach(k => { if (r[k] != null) out[k] = r[k]; });
        return out;
      });
      await _upsertCache(volatileOnly);
      // Use UPDATE (not upsert) — avoids NOT NULL violations on partial rows
      const updatePromises = volatileOnly.map(r => {
        const { media_id, fetched_at, ...fields } = r;
        // Always include updated_at; include fetched_at if present
        if (fetched_at) fields.fetched_at = fetched_at;
        return supa.from('shows').update(fields).eq('media_id', media_id);
      });
      const results = await Promise.all(updatePromises);
      const errs = results.filter(r => r.error).map(r => r.error.message);
      if (errs.length) console.error('[AniCache] shows update errors:', errs.join(', '));
      else console.log(`[AniCache] ✓ Updated ${stale.length} stale rows in shows`);
    }
  }

  // ── PUBLIC: read from shows with section-specific status filters ───────────
  async function get(opts = {}) {
    const { section, media_type, limit = 30 } = opts;
    let q = supa.from('shows').select('*');

    // media_type filter
    if (media_type) {
      const types = media_type.split(',').map(t=>t.trim());
      q = types.length === 1 ? q.eq('media_type', types[0]) : q.in('media_type', types);
    }

    switch (section) {
      case 'top_airing':
        q = q.or(
          'and(media_type.eq.anime,show_status.eq.Currently Airing),' +
          'and(media_type.eq.tv,show_status.in.(Returning Series,Ongoing,Airing))'
        ).order('popularity', { ascending: false });
        break;

      case 'upcoming':
        q = q.or(
          'and(media_type.eq.anime,show_status.eq.Not yet aired),' +
          'and(media_type.eq.tv,show_status.in.(Planned,In Production)),' +
          'and(media_type.eq.movie,show_status.in.(Planned,In Production,Post Production))'
        ).order('release_year', { ascending: true, nullsFirst: false });
        break;

      case 'completed':
        q = q.or(
          'and(media_type.eq.anime,show_status.eq.Finished Airing),' +
          'and(media_type.eq.tv,show_status.in.(Ended,Canceled))'
        ).order('release_year', { ascending: false, nullsFirst: false });
        break;

      case 'new_releases':
        q = q.or(
          'and(media_type.eq.anime,show_status.in.(Currently Airing,Finished Airing)),' +
          'and(media_type.eq.tv,show_status.in.(Returning Series,Ended,Airing)),' +
          'and(media_type.eq.movie,show_status.eq.Released)'
        ).order('release_year', { ascending: false, nullsFirst: false });
        break;

      case 'hero':
        q = q.or(
          'and(media_type.eq.anime,show_status.eq.Currently Airing),' +
          'and(media_type.eq.tv,show_status.in.(Returning Series,Airing)),' +
          'and(media_type.eq.movie,show_status.eq.Released)'
        ).not('show_backdrop_landscape_image_link', 'is', null)
         .order('popularity', { ascending: false });
        break;

      case 'schedule':
        q = q.eq('media_type','anime').eq('show_status','Currently Airing')
          .not('broadcast_day_time','is',null)
          .order('popularity', { ascending: false });
        break;

      case 'hidden_gem':
        // Good score but NOT the most popular — genuinely underrated/hidden
        // Filter score > 7.4, then sort by score DESC but EXCLUDE zero-score rows
        q = q.gt('rating_score', 7.4)
          .gt('popularity', 0)
          .order('rating_score',  { ascending: false, nullsFirst: false })
          .order('popularity',    { ascending: true,  nullsFirst: false });
        break;

      case 'top_ranking':
        // Highest rated — sort purely by score DESC
        q = q.gt('rating_score', 0)
          .order('rating_score', { ascending: false, nullsFirst: false })
          .order('popularity',   { ascending: false, nullsFirst: false });
        break;

      case 'trending':
        q = q.order('popularity', { ascending: false });
        break;

      case 'popular':
        // Most Favourite — sort by popularity/members DESC
        q = q.gt('popularity', 0)
          .order('popularity',   { ascending: false, nullsFirst: false })
          .order('rating_score', { ascending: false, nullsFirst: false });
        break;

      default:
        q = q.order('popularity', { ascending: false });
    }

    const { data, error } = await q.limit(limit);
    if (error) { console.warn('[AniCache] get error:', error.message); return []; }
    return (data||[]).map(normalise);
  }

  // ── PUBLIC: find single show by media_id ─────────────────────────────────
  async function findShow(mediaId) {
    if (!mediaId) return null;
    const { data } = await supa.from('shows').select('*')
      .eq('media_id', mediaId).maybeSingle();
    return data ? normalise(data) : null;
  }

  // ── SCHEDULE table ────────────────────────────────────────────────────────
  async function saveSchedule(animeList) {
    if (!animeList?.length) return;
    const ts  = new Date().toISOString();
    const staleTs = new Date(Date.now() - REFRESH_MS).toISOString();

    const rows = animeList.map(a => ({
      media_id:         `jikan-${a.mal_id}`,
      mal_id:           String(a.mal_id),
      eng_title:        a.title_english || a.title,
      default_title:    a.title,
      japanese_title:   a.title_japanese || null,
      show_poster_link: a.images?.jpg?.large_image_url || null,
      broadcast_day:    (a.broadcast?.day||'').toLowerCase() || null,
      broadcast_time:   a.broadcast?.time || null,
      total_episodes:   a.episodes || null,
      show_status:      a.status   || null,
      aired_date:       a.aired?.from ? a.aired.from.slice(0,10) : null,
      format:           a.type     || null,
      genres:           (a.genres||[]).map(g=>g.name).join(', ') || null,
      synopsis:         a.synopsis || null,
      studio_name:      (a.studios||[]).map(s=>s.name).join(', ') || null,
      mal_score:        a.score ? parseFloat(a.score) : null,
      content_rating:   a.rating  || null,
      fetched_at: ts, updated_at: ts,
    }));

    // Dedup: only write new/stale rows
    const ids = rows.map(r=>r.media_id);
    const { data: existing } = await supa.from('schedule')
      .select('media_id,fetched_at').in('media_id', ids);
    const existMap = new Map((existing||[]).map(r=>[r.media_id, r.fetched_at]));
    const toWrite  = rows.filter(r => {
      const t = existMap.get(r.media_id);
      return !t || t < staleTs;
    });
    if (!toWrite.length) return;
    const { error } = await supa.from('schedule')
      .upsert(toWrite, { onConflict: 'media_id' });
    if (error) console.error('[AniCache] schedule upsert:', error.message);
    else console.log(`[AniCache] ✓ schedule: ${toWrite.length} rows`);
  }

  async function getSchedule(day) {
    const { data, error } = await supa.from('schedule').select('*')
      .eq('broadcast_day', day.toLowerCase())
      .order('broadcast_time', { ascending: true });
    if (error) return [];
    return data || [];
  }

  // ── SHOW_DETAILS table (info page tabs) ──────────────────────────────────
  async function saveDetails(mediaId, payload) {
    if (!mediaId || !payload) return;
    const staleTs = new Date(Date.now() - DETAIL_MS).toISOString();
    // Check if fresh
    const { data: ex } = await supa.from('show_details')
      .select('media_id,fetched_at').eq('media_id', mediaId).maybeSingle();
    if (ex?.fetched_at && ex.fetched_at > staleTs) {
      console.log('[AniCache] show_details fresh, skip write for', mediaId);
      return;
    }
    const ts  = new Date().toISOString();
    const row = { media_id: mediaId, fetched_at: ts, updated_at: ts };
    ['cast_crew','artwork','trailers','themes','stats','seasons','recommendations']
      .forEach(k => { if (payload[k] != null) row[k] = payload[k]; });
    const { error } = await supa.from('show_details')
      .upsert(row, { onConflict: 'media_id' });
    if (error) console.error('[AniCache] show_details upsert:', error.message);
    else console.log('[AniCache] ✓ show_details:', mediaId);
  }

  async function getDetails(mediaId) {
    const { data } = await supa.from('show_details').select('*')
      .eq('media_id', mediaId).maybeSingle();
    if (!data) return null;
    const staleTs = new Date(Date.now() - DETAIL_MS).toISOString();
    return data.fetched_at > staleTs ? data : null;
  }

  // ── NORMALISE DB row → render-ready shape ─────────────────────────────────
  function normalise(r) {
    const score = parseFloat(r.mal_score || r.tmdb_average_score || r.rating_score || 0);
    const type  = r.media_type === 'anime' ? 'Anime' : r.media_type === 'movie' ? 'Movie' : 'TV';
    const poster = r.show_poster_link || r.poster_path || '';
    const backdrop = r.show_backdrop_landscape_image_link || r.backdrop_path || '';
    // Handle genres: DB may return string, array, or null
    const genresRaw = r.genres;
    const genresArr = Array.isArray(genresRaw)
      ? genresRaw.map(g => (typeof g === 'string' ? g : g?.name || String(g)).trim()).filter(Boolean)
      : typeof genresRaw === 'string' && genresRaw
        ? genresRaw.replace(/^[{\[\s]+|[}\]\s]+$/g,'').split(',').map(g=>g.trim().replace(/^"|"$/g,'')).filter(Boolean)
        : [];

    return {
      id:           r.media_id,
      media_id:     r.media_id,
      mal_id:       r.mal_id,
      tmdb_id:      r.tmdb_id,
      type,
      media_type:   r.media_type,
      title:        r.eng_title || r.default_title || '—',
      eng_title:    r.eng_title || r.default_title,
      default_title:r.default_title,
      original_title: r.original_title || '',
      japanese_title: r.japanese_title || '',
      romanji_title:  r.romanji_title  || '',
      poster,
      backdrop,
      show_poster_link:                   poster,
      show_backdrop_landscape_image_link: backdrop,
      poster_path:  poster,
      backdrop_path: backdrop,
      score:        score,            // NUMBER — callers use .toFixed() themselves
      scoreStr:     score ? score.toFixed(1) : '0.0',  // pre-formatted string
      rating_score: score,
      year:         String(r.release_year || ''),
      release_year: r.release_year,
      genres:       genresArr,
      synopsis:     r.synopsis  || r.overview || '',
      overview:     r.overview  || r.synopsis || '',
      duration:     r.anime_duration_time || r.tmdb_movie_tv_runtime || '?',
      certification: r.content_rating || 'PG-13',
      studio:       r.studio_name || '',
      studio_name:  r.studio_name || '',
      episodes:     r.total_episodes,
      total_episodes: r.total_episodes,
      show_status:  r.show_status || '',
      status:       r.show_status || '',
      premiered:    r.premiered   || '',
      broadcast_day_time: r.broadcast_day_time || '',
      aired_date:   r.aired_date  || '',
      releaseDate:  r.aired_date  || '',
      source:       r.source      || '',
      popularity:   r.popularity  || 0,
      members:      r.popularity  || 0,
      rank:         r.rank        || 0,
      is_sub:       r.is_sub      || 0,
      is_dub:       r.is_dub      || 0,
      dub_epi:      r.dub_epi     || 0,
      sub_epi:      r.sub_epi     || 0,
      quality:      'HD',
      format:       r.format      || '',
    };
  }

  // ── URL builder ────────────────────────────────────────────────────────────
  function buildInfoUrl(s) {
    const id   = s.id || s.media_id || '';
    const slug = (s.title||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
    if (/^jikan-\d+$/.test(id))       return `/info/anime/${id}/${slug}`;
    if (/^tmdb-movie-\d+$/.test(id))  return `/info/movie/${id}/${slug}`;
    if (/^tmdb-tv-\d+$/.test(id))     return `/info/tv/${id}/${slug}`;
    return `/${slug}`;
  }

  // ── PUBLIC API ─────────────────────────────────────────────────────────────
  window.AniCache = {
    save, get, findShow,
    saveSchedule, getSchedule,
    saveDetails, getDetails,
    isSectionFresh, stampSection,
    buildInfoUrl, normalise, toRow, canonicalId,
    REFRESH_MS, DETAIL_MS,
  };

  console.log('[AniCache] v3.0 ready ✓ (global shared cache)');
})();
