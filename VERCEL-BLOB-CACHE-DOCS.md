# 🗄️ Vercel Blob Cache System - Complete Documentation

## 📋 Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Sections Cached](#sections-cached)
4. [API Reference](#api-reference)
5. [Frontend Client](#frontend-client)
6. [Recently Completed Pagination](#recently-completed-pagination)
7. [Deployment](#deployment)
8. [Testing](#testing)
9. [Troubleshooting](#troubleshooting)

---

## ## Overview

### What It Does
- **Caches COMPLETE raw JSON responses** from TMDB, AniList, TVMaze, Anikoto APIs
- **6-hour TTL** (Time-To-Live) - auto-expiry
- **Stores in Vercel Blob** - no external database needed
- **Simple integration** - works with existing proxy setup

### Benefits
| Metric | Without Cache | With Blob Cache |
|--------|--------------|-----------------|
| **First Visit** | 5-15 seconds | Same (must fetch) |
| **Repeat Visit** | 5-15 seconds | **< 1 second** |
| **API Calls/Day** | Unlimited | **~4-8** (refreshes only) |
| **Rate Limit Risk** | High | **Near Zero** |
| **Cost** | N/A | **Free** (1GB included) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      USER BROWSER                          │
│                                                             │
│  ┌──────────┐    ┌──────────────┐    ┌────────────────┐   │
│  │ index.html│───▶│blob-cache-  │───▶│ /api/blob-cache│   │
│  │          │    │client.js     │    │                │   │
│  └──────────┘    └──────────────┘    └───────┬────────┘   │
│                                               │            │
└───────────────────────────────────────────────┼────────────┘
                                                │
                                                ▼
┌─────────────────────────────────────────────────────────────┐
│                    VERCEL EDGE/SERVER                        │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              /api/blob-cache.js                     │   │
│  │                                                     │   │
│  │  Actions:                                           │   │
│  │  • read  → Check if cached, return URL/data        │   │
│  │  • write → Store raw JSON in Vercel Blob           │   │
│  │  • status→ Get cache metadata                       │   │
│  │  • clear → Delete specific section                  │   │
│  │  • list  → List all cached items                   │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                  │
│                         ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              VERCEL BLOB STORAGE                   │   │
│  │                                                     │   │
│  │  📁 cache/                                          │   │
│  │  ├── hero-slider.json          (~65KB)             │   │
│  │  ├── top-airing.json           (~12KB)             │   │
│  │  ├── new-releases/                                   │   │
│  │  │   ├── all.json                                   │   │
│  │  │   ├── anime.json                                 │   │
│  │  │   ├── movie.json                                 │   │
│  │  │   ├── series.json                                │   │
│  │  │   └── hidden.json                                │   │
│  │  ├── new-on-rowana.json                             │   │
│  │  ├── upcoming/                                      │   │
│  │  │   ├── movies.json                                │   │
│  │  │   └── tv.json                                    │   │
│  │  ├── recently-completed/  ← PAGINATED!              │   │
│  │  │   ├── page-1.json                                │   │
│  │  │   ├── page-2.json                                │   │
│  │  │   └── page-3.json                                │   │
│  │  ├── trending/                                      │   │
│  │  │   ├── today.json                                 │   │
│  │  │   ├── week.json                                  │   │
│  │  │   └── month.json                                 │   │
│  │  ├── most-favourite.json                            │   │
│  │  ├── popular-anime.json                             │   │
│  │  └── schedule/                                      │   │
│  │      ├── monday.json ~ sunday.json (7 files)       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Sections Cached

### Main Sections (10)
| Section | Source API | Blob Key | Est. Size |
|---------|-----------|----------|-----------|
| **Hero Slider** | TMDB `/tv/on_the_air` ×6 pages | `hero-slider.json` | ~65KB |
| **Top Airing** | TVMaze `/schedule` + TMDB fallback | `top-airing.json` | ~12KB |
| **New on Rowana** | Anikoto `/recent-anime` | `new-on-rowana.json` | ~40KB |
| **Upcoming Movies** | TMDB `/movie/upcoming` | `upcoming/movies.json` | ~30KB |
| **Upcoming TV** | TMDB `/discover/tv` | `upcoming/tv.json` | ~25KB |
| **Recently Completed** | TMDB `/discover/tv` + `/discover/movie` | `recently-completed/page-{n}.json` | ~50KB total |
| **Most Favourite** | TMDB + AniList | `most-favourite.json` | ~20KB |
| **Popular Anime** | TMDB + AniList | `popular-anime.json` | ~18KB |

### New Releases Tabs (5)
| Tab | Source | Blob Key |
|-----|--------|----------|
| **All** | TVMaze/TMDB | `new-releases/all.json` |
| **Anime** | Filtered | `new-releases/anime.json` |
| **Movie** | Filtered | `new-releases/movie.json` |
| **Series** | Filtered | `new-releases/series.json` |
| **Hidden** | Filtered | `new-releases/hidden.json` |

### Trending Now (3 tabs)
| Tab | Source | Blob Key |
|-----|--------|----------|
| **Today** | TMDB `/trending/all/day` + AniList | `trending/today.json` |
| **Week** | TMDB `/trending/all/week` + AniList | `trending/week.json` |
| **Month** | TMDB `/discover/movie` + AniList | `trending/month.json` |

### Schedule (7 days)
| Day | Source | Blob Key |
|-----|--------|----------|
| **Monday** | TVMaze `/schedule?country=X` | `schedule/monday.json` |
| **Tuesday** | TVMaze `/schedule?country=X` | `schedule/tuesday.json` |
| **Wednesday** | TVMaze `/schedule?country=X` | `schedule/wednesday.json` |
| **Thursday** | TVMaze `/schedule?country=X` | `schedule/thursday.json` |
| **Friday** | TVMaze `/schedule?country=X` | `schedule/friday.json` |
| **Saturday** | TVMaze `/schedule?country=X` | `schedule/saturday.json` |
| **Sunday** | TVMaze `/schedule?country=X` | `schedule/sunday.json` |

**Total: 25+ blob files cached**

---

## API Reference

### Endpoint: `POST /api/blob-cache`

#### Action: `write`
Store raw JSON data for a section.

```javascript
// Request
{
  action: "write",
  section: "hero-slider",        // Section name (required)
  data: { ... },                 // Raw data to cache (required)
  page: null                     // Page number (only for recently-completed)
}

// Response (Success)
{
  success: true,
  message: "Cached: hero-slider",
  section: "hero-slider",
  blobKey: "cache/hero-slider.json",
  url: "https://blob.vercel.sh.com/...",
  sizeBytes: 65536,
  uploadedAt: "2026-08-22T14:00:00Z",
  expiresAt: "2026-08-22T20:00:00Z"
}
```

#### Action: `read`
Read cached data for a section.

```javascript
// Request
{
  action: "read",
  section: "hero-slider",
  page: null
}

// Response (Cache HIT)
{
  success: true,
  data: {
    found: true,
    url: "https://blob.vercel.sh.com/...",
    downloaded: false,
    uploadedAt: "2026-08-22T14:00:00Z",
    sizeBytes: 65536,
    secondsUntilExpiry: 21599,
    contentType: "application/json"
  }
}

// Response (Cache MISS)
{
  success: true,
  data: {
    found: false,
    reason: "not_cached"  // or "expired"
  }
}
```

#### Action: `status`
Get cache status.

```javascript
// Request - Single section
{ action: "status", section: "hero-slider" }

// Request - All sections
{ action: "status" }

// Response
{
  success: true,
  overview: {
    totalSections: 25,
    valid: 15,
    expired: 3,
    missing: 7,
    totalSizeBytes: 450560,
    ttlSeconds: 21600
  },
  sections: {
    "hero-slider": { found: true, status: "valid", secondsUntilExpiry: 21599 },
    "top-airing": { found: false, status: "not_cached" },
    // ...
  }
}
```

#### Action: `list`
List all cached items.

```javascript
// Request
{ action: "list" }

// Response
{
  success: true,
  count: 18,
  items: [
    {
      pathname: "hero-slider.json",
      url: "https://...",
      sizeBytes: 65536,
      uploadedAt: "...",
      isExpired: false,
      secondsUntilExpiry: 21599
    },
    // ...
  ]
}
```

#### Action: `clear`
Clear specific section cache.

```javascript
// Request
{ action: "clear", section: "hero-slider" }

// Response
{ success: true, message: "Cleared cache for: hero-slider", cleared: true }
```

#### Action: `clear-all`
Clear ALL cache.

```javascript
// Request
{ action: "clear-all" }

// Response
{ success: true, message: "Cleared all cache", cleared: 18, failed: 0 }
```

---

## Frontend Client

### Global Instance
```javascript
window.BlobCache // Available globally after blob-cache-client.js loads
```

### Basic Usage

#### 1. Read from Cache
```javascript
const cached = await window.BlobCache.read('hero-slider');

if (cached.found) {
  console.log('Cache HIT!', cached.data);
  renderHeroSlider(cached.data);
} else {
  console.log('Cache MISS:', cached.reason);
  // Fetch fresh data...
}
```

#### 2. Write to Cache
```javascript
const apiData = await fetchTMDB('/tv/on_the_air', 'page=1');
await window.BlobCache.write('hero-slider', apiData);
```

#### 3. Get or Fetch (Recommended)
```javascript
// Automatically uses cache if valid, fetches and caches if not
const result = await window.BlobCache.getOrFetch('hero-slider', async () => {
  return await fetchTMDB('/tv/on_the_air', 'page=1');
});

console.log(result.source); // 'cache' or 'fresh'
console.log(result.cached); // true or false
renderHeroSlider(result.data);
```

### Convenience Methods

```javascript
// Hero Slider
await window.BlobCache.getHeroSlider(fetchFn);

// Top Airing
await window.BlobCache.getTopAiring(fetchFn);

// New Releases (by tab)
await window.BlobCache.getNewReleases('all', fetchFn);
await window.BlobCache.getNewReleases('anime', fetchFn);

// New on Rowana
await window.BlobCache.getNewOnRowana(fetchFn);

// Upcoming
await window.BlobCache.getUpcomingMovies(fetchFn);
await window.BlobCache.getUpcomingTV(fetchFn);

// Recently Completed (PAGINATED!)
await window.BlobCache.getRecentlyCompleted(1, fetchFn); // Page 1
await window.BlobCache.getRecentlyCompleted(2, fetchFn); // Page 2

// Trending (by period)
await window.BlobCache.getTrending('today', fetchFn);
await window.BlobCache.getTrending('week', fetchFn);
await window.BlobCache.getTrending('month', fetchFn);

// Popular
await window.BlobCache.getMostFavourite(fetchFn);
await window.BlobCache.getPopularAnime(fetchFn);

// Schedule (by day)
await window.BlobCache.getSchedule('monday', fetchFn);
await window.BlobCache.getSchedule('tuesday', fetchFn);
// ... etc for all 7 days
```

### Status & Management

```javascript
// Check status of all sections
const status = await window.BlobCache.status();
console.log(status.overview.valid); // Number of valid caches

// Check specific section
const sectionStatus = await window.BlobCache.status('hero-slider');

// Clear specific section
await window.BlobCache.clear('hero-slider');

// Clear everything (force refresh on next visit)
await window.BlobCache.clearAll();
```

---

## Recently Completed Pagination

The **Recently Completed** section is special because it supports pagination.

### How It Works

Instead of storing one file:
```
cache/recently-completed.json  ❌ (would be too large)
```

It stores multiple pages:
```
cache/recently-completed/
├── page-1.json  ✅ (TV shows that ended recently)
├── page-2.json  ✅ (More completed shows)
└── page-3.json  ✅ (Even more...)
```

### Writing Paginated Data

```javascript
// Write page 1
await window.BlobCache.write('recently-completed', page1Data, 1);

// Write page 2
await window.BlobCache.write('recently-completed', page2Data, 2);

// Write page 3
await window.BlobCache.write('recently-completed', page3Data, 3);
```

### Reading Paginated Data

```javascript
// Read page 1
const page1 = await window.BlobCache.read('recently-completed', 1);

// Read page 2
const page2 = await window.BlobCache.read('recently-completed', 2);

// Using convenience method
const result = await window.BlobCache.getRecentlyCompleted(1, fetchPage1Fn);
```

### Checking All Pages Status

```javascript
const status = await window.BlobCache.status();
console.log(status.sections['recently-completed']);
// {
//   pages: {
//     "1": { found: true, status: "valid", ... },
//     "2": { found: true, status: "expired", ... },
//     "3": { found: false, status: "not_cached" }
//   },
//   totalPages: 2
// }
```

---

## Deployment

### Prerequisites
- Vercel account with project set up
- `@vercel/blob` package installed

### Files to Deploy

```
your-project/
├── api/
│   └── blob-cache.js       ✅ API endpoint
├── blob-cache-client.js    ✅ Frontend client
├── index.html              ✅ Updated with script tag
├── package.json            ✅ @vercel/blob dependency
└── scripts/
    └── test-blob-cache.js  ✅ Test script (optional)
```

### Deploy Steps

```bash
# 1. Install dependencies
npm install

# 2. Test locally (optional)
node scripts/test-blob-cache.js

# 3. Commit changes
git add .
git commit -m "Add Vercel Blob cache system"

# 4. Push to GitHub
git push origin main

# 5. Vercel auto-deploys in ~2 minutes
```

### Vercel Configuration

No special configuration needed! Vercel Blob works out of the box with:

- ✅ Serverless Functions
- ✅ Edge Functions  
- ✅ Static exports
- ✅ Preview deployments

---

## Testing

### Run Test Suite

```bash
node scripts/test-blob-cache.js
```

This tests:
1. ✅ API endpoint health
2. ✅ Write operations for all 25+ sections
3. ✅ Read operations (cache hits)
4. ✅ Recently-completed pagination
5. ✅ Status overview

### Manual Browser Test

1. Open https://rowana.vercel.app
2. Press F12 (DevTools → Console)
3. Look for `[Blob Cache]` messages:
   ```
   ✅ Vercel Blob Cache Client initialized
   📖 Reading cache: hero-slider
   ⚠️ Cache MISS: hero-slider (not_cached)
   🔄 Fetching fresh data for: hero-slider
   💾 Writing cache: hero-slider (65.2KB)
   ✅ Cached successfully: hero-slider
   ```

4. Refresh page (within 6 hours):
   ```
   📖 Reading cache: hero-slider
   ✅ Cache HIT: hero-slider
   🎯 Serving hero-slider from BLOB CACHE
   ```

### Test All Sections Cached

```javascript
// In browser console:
const status = await BlobCache.status();
console.log(`Valid: ${status.overview.valid}/${status.overview.totalSections}`);
```

---

## Troubleshooting

### Issue: "Blob Cache not defined"
**Fix:** Ensure `blob-cache-client.js` loads before your code runs. Check `<script>` tag order in `index.html`.

### Issue: Cache always showing MISS
**Possible causes:**
1. First visit (expected - no cache yet)
2. Cache expired (TTL is 6 hours)
3. Section name mismatch (check SECTIONS object in API)

**Debug:**
```javascript
const status = await BlobCache.status('hero-slider');
console.log(status);
```

### Issue: Write succeeds but read fails
**Check:** Vercel Blob storage limits (free tier: 1GB)

**Debug:**
```javascript
const list = await BlobCache.list();
console.log(`Total cached items: ${list.count}`);
console.log(`Total size: ${list.items.reduce((sum, item) => sum + item.sizeBytes, 0)} bytes`);
```

### Issue: Recently Completed pagination not working
**Check:** Ensure you pass `page` parameter:

```javascript
// WRONG
BlobCache.write('recently-completed', data);

// CORRECT
BlobCache.write('recently-completed', data, 1); // Page 1
BlobCache.write('recently-completed', data, 2); // Page 2
```

### Issue: CORS errors
Vercel Blob URLs are public by default. If you see CORS errors, check the `access` option in `put()` call (should be `'public'`).

### Clear All Cache (Force Fresh Start)

```javascript
// In browser console:
await BlobCache.clearAll();
console.log('Cache cleared! Refresh page.');
location.reload();
```

---

## Performance Expectations

### First Visit (Cold Cache)
```
Timeline:
0.0s  → Page loads, BlobCache initializes
0.1s  → Checks cache for each section (all MISS)
0.2s  → Starts fetching from TMDB/AniList/TVMaze
3-8s  → API responses arrive (parallel fetches)
8-12s → Writes to Vercel Blob (fast, <100ms each)
12s   → Page renders with fresh data
12.1s → All sections now cached!
```

### Second Visit (Warm Cache - within 6 hours)
```
Timeline:
0.0s  → Page loads, BlobCache initializes
0.1s  → Checks cache for each section (all HIT!)
0.3s  → Downloads cached JSON from Vercel Blob (<50ms each)
0.8s  → Page renders from cache!
✅ 15x FASTER than first visit!
```

### After 6 Hours (Expired Cache)
Same as first visit - automatic refresh cycle.

---

## Cost & Limits

### Vercel Blob Free Tier
- **Storage:** 1 GB included
- **Bandwidth:** 100 GB/month included
- **Requests:** Unlimited

### Your Estimated Usage
- **Storage per cache cycle:** ~500KB (all sections)
- **Daily storage:** ~2MB (4 refresh cycles × 500KB)
- **Monthly storage:** ~60MB
- **Bandwidth:** Depends on traffic (very efficient)

**Verdict:** Well within free tier! 🎉

---

## Comparison: Previous Systems vs Vercel Blob

| Feature | Neon DB Cache (Removed) | Vercel Blob (Current) |
|---------|------------------------|----------------------|
| **Complexity** | High (SQL, RLS, transactions) | Low (simple key-value) |
| **Dependencies** | @neondatabase/serverless | @vercel/blob |
| **Data Format** | JSONB columns (parsed) | Raw JSON files |
| **Pagination Support** | Complex (arrays in cells) | Natural (separate files) |
| **Cost** | Free tier available | Free tier available |
| **Latency** | ~200-500ms (DB query) | ~50-100ms (edge CDN) |
| **Debugging** | Need DB client | Simple URL access |
| **Vercel Integration** | External service | **Native** |

---

*Last Updated: 2026-08-22*
*Version: 1.0.0*
