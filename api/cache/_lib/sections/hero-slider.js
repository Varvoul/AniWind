import { fetchTMDB, fetchAniList } from '../http.js';

const HERO_CONFIG = {
  maxTotalSlides: 60,
  tmdbTargetCount: 15,
  anilistPerPage: 50,
  anilistTargetCount: 45,
};

const ANILIST_MEDIA_FIELDS = `
  id
  idMal
  title { romaji english native }
  bannerImage
  coverImage { large medium }
  averageScore
  episodes
  format
  genres
  tags { name rank }
  startDate { year month day }
  studios(isMain: true) { nodes { name } }
  description
  nextAiringEpisode { episode airingAt timeUntilAiring }
`;

const slugify = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Fetches, filters, and assembles the Hero Slider dataset exactly as
 * loadHero() does client-side in index.html, so cached output is a
 * drop-in replacement for what the frontend currently builds itself.
 * Throws on total failure; returns { data, isComplete } otherwise —
 * isComplete is false if one of the two sources failed but the other
 * still produced usable slides (a genuine partial cache).
 */
export async function fetchHeroSliderData() {
  const [tmdbTvResults, anilistResults] = await Promise.allSettled([
    Promise.allSettled(
      [1, 2, 3, 4, 5, 6].map((page) => fetchTMDB('/tv/on_the_air', `page=${page}`))
    ),
    Promise.allSettled(
      [1, 2].map((page) =>
        fetchAniList(
          `query ($page: Int) {
            Page(page: $page, perPage: ${HERO_CONFIG.anilistPerPage}) {
              media(type: ANIME, status: RELEASING, isAdult: false, sort: POPULARITY_DESC) {
                ${ANILIST_MEDIA_FIELDS}
              }
            }
          }`,
          { page }
        )
      )
    ),
  ]);

  let tmdbOk = false;
  let anilistOk = false;

  // ── TMDB TV: current-year filter for freshness ──
  let topTmdbShows = [];
  if (tmdbTvResults.status === 'fulfilled') {
    let rawTmdbShows = [];
    for (const t of tmdbTvResults.value) {
      if (t.status === 'fulfilled' && t.value?.results) rawTmdbShows.push(...t.value.results);
    }
    const seenTmdb = new Set();
    const uniqueTmdb = rawTmdbShows.filter((t) => {
      if (!t.id || seenTmdb.has(t.id)) return false;
      seenTmdb.add(t.id);
      return true;
    });
    const currentYear = new Date().getFullYear().toString();
    const freshTmdbShows = uniqueTmdb.filter(
      (show) => show.backdrop_path && show.first_air_date?.startsWith(currentYear)
    );
    freshTmdbShows.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    topTmdbShows = freshTmdbShows.slice(0, HERO_CONFIG.tmdbTargetCount);
    tmdbOk = topTmdbShows.length > 0;
  }

  // ── AniList: currently airing anime with a banner image ──
  let topAnilistAnime = [];
  if (anilistResults.status === 'fulfilled') {
    let rawAnilistAnime = [];
    for (const pageResult of anilistResults.value) {
      if (pageResult.status === 'fulfilled' && pageResult.value?.Page?.media) {
        rawAnilistAnime.push(...pageResult.value.Page.media);
      }
    }
    const filtered = rawAnilistAnime.filter((m) => m.bannerImage);
    const seenAnilist = new Set();
    const uniqueAnilistAnime = filtered.filter((a) => {
      if (seenAnilist.has(a.id)) return false;
      seenAnilist.add(a.id);
      return true;
    });
    uniqueAnilistAnime.sort((a, b) => {
      const timeA = a.nextAiringEpisode?.timeUntilAiring ?? Infinity;
      const timeB = b.nextAiringEpisode?.timeUntilAiring ?? Infinity;
      if (timeA !== timeB) return timeA - timeB;
      return (b.averageScore || 0) * (b.popularity || 0) - (a.averageScore || 0) * (a.popularity || 0);
    });
    topAnilistAnime = uniqueAnilistAnime.slice(0, HERO_CONFIG.anilistTargetCount);
    anilistOk = topAnilistAnime.length > 0;
  }

  if (!tmdbOk && !anilistOk) {
    throw new Error('Hero Slider: both TMDB and AniList sources failed or returned nothing usable');
  }

  // ── Map to slide shape ──
  const tmdbSlides = topTmdbShows.map((t) => ({
    id: `tmdb-tv-${t.id}`,
    title: t.name || t.original_name || 'Unknown',
    source: 'tmdb',
    type: 'TV Show',
    genres: [],
    themes: [],
    score: t.vote_average ? Number(t.vote_average).toFixed(1) : 'N/A',
    year: (t.first_air_date || '').slice(0, 4) || '',
    duration: '',
    episodes: '?',
    synopsis: (t.overview || '').slice(0, 320),
    backdrop: `https://image.tmdb.org/t/p/w1280${t.backdrop_path}`,
    backdrop_orig: `https://image.tmdb.org/t/p/original${t.backdrop_path}`,
    backdrop_mobile: `https://image.tmdb.org/t/p/w780${t.backdrop_path}`,
    poster: t.poster_path ? `https://image.tmdb.org/t/p/w500${t.poster_path}` : '',
    certification: 'TV-14',
    studio: '',
    tmdb_id: t.id,
    status_color: '#818cf8',
    status_label: '● Ongoing',
    infoHref: `/info/tv/tmdb-tv-${t.id}/${slugify(t.name)}-season-1`,
  }));

  const anilistSlides = topAnilistAnime.map((m) => {
    const genres = (m.genres || []).filter(Boolean);
    const themes = (m.tags || []).filter((t) => t.rank >= 60).map((t) => t.name).slice(0, 2);
    const year = m.startDate?.year?.toString() || '';
    const studio = m.studios?.nodes?.[0]?.name || '';
    const formatMap = { TV: 'TV', TV_SHORT: 'TV Short', MOVIE: 'Movie', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Special' };

    return {
      id: `anilist-${m.id}`,
      title: m.title?.romaji || m.title?.english || 'Unknown Anime',
      source: 'anilist',
      type: formatMap[m.format] || m.format || 'Anime',
      genres,
      themes,
      score: m.averageScore ? Number(m.averageScore / 10).toFixed(1) : 'N/A',
      year,
      duration: '',
      episodes: m.episodes ? String(m.episodes) : m.nextAiringEpisode ? String(m.nextAiringEpisode.episode - 1) : '?',
      synopsis: (m.description || '').replace(/<[^>]*>/g, '').slice(0, 320),
      backdrop: m.bannerImage,
      backdrop_orig: m.bannerImage,
      backdrop_mobile: m.bannerImage,
      poster: m.coverImage?.large || m.coverImage?.medium || '',
      certification: 'TV-14',
      studio,
      mal_id: m.idMal,
      anilist_id: m.id,
      image_source: 'anilist-banner',
      image_confidence: 100,
      status_color: '#38bdf8',
      status_label: '● Airing Now',
      infoHref: `/info/anime/jikan-${m.idMal}/${slugify(m.title?.romaji || m.title?.english)}`,
    };
  });

  // ── Merge: anime-first alternating pattern, then remaining anime ──
  const merged = [];
  let tmdbIdx = 0;
  let anilistIdx = 0;
  while (anilistIdx < anilistSlides.length && tmdbIdx < tmdbSlides.length) {
    if ((merged.length % 2 === 0 || tmdbIdx >= tmdbSlides.length) && anilistIdx < anilistSlides.length) {
      merged.push(anilistSlides[anilistIdx++]);
    }
    if (tmdbIdx < tmdbSlides.length && merged.length % 2 === 1) {
      merged.push(tmdbSlides[tmdbIdx++]);
    }
  }
  while (anilistIdx < anilistSlides.length && merged.length < HERO_CONFIG.maxTotalSlides) {
    merged.push(anilistSlides[anilistIdx++]);
  }

  const data = merged.slice(0, HERO_CONFIG.maxTotalSlides);
  const isComplete = tmdbOk && anilistOk; // both sources contributed → fully complete cycle

  return { data, isComplete };
}
