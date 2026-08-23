# 🎬 COMPLETE API ENDPOINTS LIST - AniWind/Rowana

## 📋 TABLE OF CONTENTS
1. [Base URLs & Proxies](#base-urls--proxies)
2. [TMDB Endpoints (The Movie Database)](#tmdb-endpoints)
3. [AniList Endpoints (GraphQL)]#anilist-endpoints-graphql
4. [Jikan Endpoints (MyAnimeList API)]#jikan-endpoints
5. [TVMaze Endpoints]#tvmaze-endpoints
6. [Anikoto Endpoints]#anikoto-endpoints
7. [Other Services]#other-services

---

## 🔗 BASE URLS & PROXIES

### Primary Proxies (Cloudflare Workers)
| Proxy | URL | Purpose |
|-------|-----|---------|
| **ROWANA_PROXY** | `https://aniumi.bionmovies47.workers.dev` | Universal proxy for all APIs |
| **TMDB_PROXY** | `https://t-umi.bionmovies47.workers.dev` | Primary TMDB proxy |
| **TMDB_LEGACY** | `https://aniocen.bionmovies47.workers.dev` | Fallback TMDB proxy |

### Direct API Base URLs
| Service | Base URL | Auth Method |
|---------|----------|-------------|
| **TMDB API** | `https://api.themoviedb.org/3` | API Key (via proxy) |
| **TMDB Images** | `https://image.tmdb.org/t/p` | None (public) |
| **AniList** | `https://graphql.anilist.co` | GraphQL POST |
| **Jikan v4** | `https://api.jikan.moe/v4` | Rate-limited (3 req/sec) |
| **Jikan Search** | `https://jikan-api-bohb.onrender.com/v4/anime` | Alternative Jikan endpoint |
| **TVMaze** | `https://api.tvmaze.com/schedule` | None (public) |
| **Anikoto** | `https://anikoto.bionmovies47.workers.dev` | Direct fallback |
| **Accent Worker** | `https://hero-accent-cache.zeraf.workers.dev` | Hero color cache |

---

## 🎬 TMDB ENDPOINTS (The Movie Database)

### Used in These Sections:
- ✅ Hero Slider
- ✅ Top Airing
- ✅ New Releases
- ✅ Upcoming (Movies & TV)
- ✅ Recently Completed
- ✅ Trending Now
- ✅ Most Favourite / Popular Anime
- ✅ Search Functionality
- ✅ TVMaze → TMDB Bridge

---

### 1. **TV Shows - Currently Airing**
```
GET /tv/on_the_air?page={1-6}
```
**Full URL:** `https://api.themoviedb.org/3/tv/on_the_air?page={1-6}`

**Used By:**
- **Hero Slider** (pages 1-6, parallel fetch)
- **Top Airing** (page 1, fallback if TVMaze fails)
- **New Releases** (pages 1-2, fallback if TVMaze fails)

**Parameters:**
- `page` = 1-6 (pagination)

---

### 2. **Search - TV Shows**
```
GET /search/tv?query={showName}&page={page}
```
**Full URL:** `https://api.themoviedb.org/3/search/tv?query={showName}&page={page}`

**Used By:**
- **TVMaze→TMDB Bridge** (finds TMDB ID from show name)
- **Search/Discovery Section**

**Parameters:**
- `query` = Show name (URL encoded)
- `page` = Page number
- Optional: `first_air_date_year` = Filter by year

---

### 3. **Discover - Movies (Various)**
```
GET /discover/movie?{params}
```
**Full URL:** `https://api.themoviedb.org/3/discover/movie?{params}`

**Used By:**
- **Popular Movies / Country Content** (`with_origin_country`, date range)
- **Recently Completed** (sort by release_date, with_release_type)
- **Trending Now - Month** (popularity sort, 30-day window)
- **Most Favourite / Popular** (vote_count filter)

**Parameter Combinations:**

| Section | Parameters |
|---------|-----------|
| Country Movies | `with_origin_country={code}&release_date.gte={year}-01-01&release_date.lte={year}-12-31&page={n}` |
| Recently Completed | `sort_by=release_date.desc&with_release_type=2\|3&release_date.gte={6mo ago}&release_date.lte={today}&page={n}` |
| Trending (Month) | `primary_release_date.gte={30 days ago}&sort_by=popularity.desc` |
| Popular/Favourite | `sort_by=vote_count.desc&vote_count.gte=5000&language=en-US&page=1` |

---

### 4. **Discover - TV Shows (Various)**
```
GET /discover/tv?{params}
```
**Full URL:** `https://api.themoviedb.org/3/discover/tv?{params}`

**Used By:**
- **Country TV Content** (with_origin_country, date range)
- **Upcoming TV** (popularity sort, future air dates)
- **Recently Completed TV** (ended status, date range)
- **Most Favourite / Popular TV** (vote_count filter)

**Parameter Combinations:**

| Section | Parameters |
|---------|-----------|
| Country TV | `with_origin_country={code}&first_air_date.gte={year}-01-01&first_air_date.lte={year}-12-31&page={n}` |
| Upcoming TV | `sort_by=popularity.desc&first_air_date.gte={today}&page={n}` |
| Recently Completed TV | `sort_by=first_air_date.desc&with_status=ended&first_air_date.gte={6mo ago}&first_air_date.lte={today}&page={n}` |
| Popular/Favourite TV | `sort_by=vote_count.desc&vote_count.gte=2000&language=en-US&page=1` |

---

### 5. **Movies - Upcoming**
```
GET /movie/upcoming?page={page}
```
**Full URL:** `https://api.themoviedb.org/3/movie/upcoming?page={page}`

**Used By:**
- **Upcoming Movies Section**

**Parameters:**
- `page` = Page number

---

### 6. **Trending - All Content**
```
GET /trending/all/{time_window}
```
**Full URL:** `https://api.themoviedb.org/3/trending/all/{time_window}`

**Used By:**
- **Trending Now Section**

**Time Windows:**
- `/trending/all/day` - Today's trending
- `/trending/all/week` - This week's trending

---

### 7. **Find by External ID**
```
GET /find/{external_id}?external_source={source}
```
**Full URL:** `https://api.themoviedb.org/3/find/{external_id}?external_source={source}`

**Used By:**
- **TVMaze→TMDB Bridge** (IMDb/TheTVDB lookup)

**External Sources:**
- `external_source=imdb_id` (IMDb ID)
- `external_source=tvdb_id` (TheTVDB ID)

**Examples:**
```
/find/tt1234567?external_source=imdb_id
/find/123456?external_source=tvdb_id
```

---

### 8. **TMDB Image URLs**
```
Base: https://image.tmdb.org/t/p/{size}{path}
```

**Sizes Used:**
| Size | Usage |
|------|-------|
| `w500` | Poster images |
| `w780` | Backdrop (mobile) |
| `w1280` | Backdrop (desktop) |
| `original` | Backdrop (full quality) |

**Examples:**
```
https://image.tmdb.org/t/p/w500/poster_path.jpg
https://image.tmdb.org/t/p/w1280/backdrop_path.jpg
```

---

## 📺 ANILIST ENDPOINTS (GraphQL)

### Base URL: `https://graphql.anilist.co`
### Method: `POST`
### Headers: `Content-Type: application/json`

---

### 1. **Trending Anime (Currently Releasing)**
```graphql
POST https://graphql.anilist.co

query {
  Page(page: 1, perPage: 10) {
    media(type: ANIME, status: RELEASING, isAdult: false, sort: TRENDING_DESC) {
      id
      title { romaji, english }
      coverImage { large, extraLarge }
      episodes
      status
      averageScore
      genres
      description
      startDate { year, month, day }
      # ... more fields
    }
  }
}
```
**Used By:** Trending Now (Today/Week tabs) - AniList portion

---

### 2. **Popular Anime (All Time)**
```graphql
POST https://graphql.anilist.co

query {
  Page(page: 1, perPage: 10) {
    media(type: ANIME, isAdult: false, sort: POPULARITY_DESC) {
      id
      title { romaji, english }
      coverImage { large }
      episodes
      averageScore
      genres
      # ... more fields
    }
  }
}
```
**Used By:** 
- Trending Now (Month tab)
- Most Favourite / Popular Anime section

---

### 3. **Search/Query Anime (Generic)**
```graphql
POST https://graphql.anilist.co

query ($search: String) {
  Page(page: 1, perPage: 10) {
    media(type: ANIME, search: $search, isAdult: false) {
      id
      title { romaji, english, native }
      coverImage { large }
      # ... fields
    }
  }
}
```
**Used By:** Search functionality, data enrichment

---

### 4. **Proxy Fallback**
```
POST https://aniumi.bionmovies47.workers.dev/anilist
```
**Used When:** Direct AniList API fails (CORS/rate-limit issues)

---

## 📗 JIKAN ENDPOINTS (MyAnimeList API)

### Base URL: `https://api.jikan.moe/v4`
### Alternative: `https://jikan-api-bohb.onrender.com/v4/anime`

⚠️ **Rate Limit:** 3 requests/second (strict!)
⚠️ **Usage:** Fallback when AniList unavailable

---

### 1. **Anime Search**
```
GET https://jikan-api-bohb.onrender.com/v4/anime?q={query}&page={page}&limit=10
```
**Used By:** MAL ID backfill for anime without MyAnimeList IDs

**Parameters:**
- `q` = Search query (anime title)
- `page` = Page number
- `limit` = Results per page (default: 10)

---

### 2. **Via Universal Proxy**
```
GET https://aniumi.bionmovies47.workers.dev/jikan/{endpoint}
```
**Example:** `/jikan/anime?q=naruto&page=1`

**Used When:** Direct Jikan fails (504 errors common)

---

## 📺 TVMAZE ENDPOINTS

### Base URL: `https://api.tvmaze.com/schedule`

---

### 1. **TV Schedule by Country**
```
GET https://api.tvmaze.com/schedule?country={country}&date={YYYY-MM-DD}
```
**Used By:**
- Top Airing (primary data source)
- Sidebar TV Schedule
- New Releases (fallback source)

**Countries (Rotation System):**
- US, GB, FR, DE, JP, KR, CN, SG, IN, VN, MM, TH, PH, ID, MY

**Parameters:**
- `country` = ISO country code (required)
- `date` = Date in YYYY-MM-DD format (optional, defaults to today)

**Examples:**
```
https://api.tvmaze.com/schedule?country=US
https://api.tvmaze.com/schedule?country=GB&date=2024-01-15
```

**Note:** No Japan in rotation (AniList covers anime airing)

---

## 🎌 ANIKOTO ENDPOINTS

### Base URL: `https://anikoto.bionmovies47.workers.dev`

---

### 1. **Recent Anime**
```
GET https://anikoto.bionmovies47.workers.dev/recent-anime?page=1&per_page=100
```
**Used By:** New on Aniocean / New on Rowana section

**Response:** Array of recent anime with metadata

---

### 2. **Via Universal Proxy**
```
GET https://aniumi.bionmovies47.workers.dev/anikoto/recent-anime?page=1&per_page=100
```
**Used When:** Direct Anikoto fails

---

## 🎨 OTHER SERVICES

### 1. **Hero Accent Color Cache**
```
GET  https://hero-accent-cache.zeraf.workers.dev/accent?key={image_key}
POST https://hero-accent-cache.zeraf.workers.dev/accent
```
**Used By:** Hero slider accent color extraction (neon-cached)

**Purpose:** Extracts dominant color from hero images for UI theming

---

## 📊 COMPLETE ENDPOINT SUMMARY BY SECTION

| Section | TMDB | AniList | TVMaze | Jikan | Anikoto |
|---------|------|---------|--------|-------|----------|
| **Hero Slider** | ✅ /tv/on_the_air (×6 pages) | ❌ | ❌ | ❌ | ❌ |
| **Top Airing** | ✅ /tv/on_the_air (fallback) | ❌ | ✅ /schedule (primary) | ❌ | ❌ |
| **New Releases** | ✅ /tv/on_the_air (fallback) | ❌ | ✅ /schedule (primary) | ❌ | ❌ |
| **New on Rowana** | ❌ | ❌ | ❌ | ❌ | ✅ /recent-anime |
| **Upcoming** | ✅ /movie/upcoming | ❌ | ❌ | ❌ | ❌ |
| **Upcoming TV** | ✅ /discover/tv | ❌ | ❌ | ❌ | ❌ |
| **Recently Completed** | ✅ /discover/tv + /discover/movie | ❌ | ❌ | ❌ | ❌ |
| **Trending Now** | ✅ /trending/all + /discover/movie | ✅ GraphQL | ❌ | ❌ | ❌ |
| **Most Favourite** | ✅ /discover/movie + /discover/tv | ✅ GraphQL | ❌ | ❌ | ❌ |
| **Popular Anime** | ✅ /discover/movie + /discover/tv | ✅ GraphQL | ❌ | ❌ | ❌ |
| **Schedule/Sidebar** | ❌ | ❌ | ✅ /schedule | ❌ | ❌ |
| **Search** | ✅ /search/tv + /find/{id} | ✅ GraphQL | ❌ | ✅ /anime?q= | ❌ |
| **TVMaze Bridge** | ✅ /find/{id} + /search/tv | ❌ | ✅ Source | ❌ | ❌ |
| **Hero Accent** | ❌ | ❌ | ❌ | ❌ | ✅ Worker API |

---

## 🔐 AUTHENTICATION NOTES

| API | Auth Method | Where Stored |
|-----|-------------|--------------|
| **TMDB** | API Key via Bearer token | Proxy workers (t-umi, aniocen) |
| **AniList** | None (public GraphQL) | N/A |
| **Jikan** | None (rate-limited public) | N/A |
| **TVMaze** | None (public) | N/A |
| **Anikoto** | None (public) | N/A |

**Security:** All API keys are stored server-side in Cloudflare Workers, never exposed to client-side JavaScript.

---

## ⚡ PROXY FALLBACK CHAIN

For TMDB requests, the system uses this priority order:

```
1. t-umi proxy (NEW primary)     → https://t-umi.bionmovies47.workers.dev
2. Legacy proxy (fallback)       → https://aniocen.bionmovies47.workers.dev  
3. Direct TMDB API (if key avail) → https://api.themoviedb.org/3
4. Rowana universal proxy        → https://aniumi.bionmovies47.workers.dev/tmdb
```

Each fallback is tried only if the previous one fails!

---

## 📝 NOTES

- **Total Unique Endpoints:** ~25+ different API endpoints
- **APIs Used:** 6 different services (TMDB, AniList, Jikan, TVMaze, Anikoto, Accent Worker)
- **Rate Limiting:** Built-in queuing system prevents API abuse
- **Caching:** Cloudflare Workers cache responses (5 min TTL typical)
- **Error Handling:** Multi-fallback system ensures content always loads

---

*Generated: 2026-08-22*
*Source: index.html (7487 lines)*
