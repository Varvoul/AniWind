# AnimeThemes Scraper API (t194)

A self-hosted, JSON:API v1-compatible mirror of the AnimeThemes API, built by
scraping the static animethemes.moe site — so theme data stays available while
the official APIs are down (api.animethemes.moe → 503, graphql.animethemes.moe
→ 404 since 2026-11-14).

- **Data source**: static site `_next/data/{buildId}/anime/{slug}.json` payloads
  (full theme → song → entries → videos trees + MAL/AniList/Kitsu/AniDB resource links).
- **Coverage**: 5,022 anime · 14,773 themes · 20,024 videos · 5,021 with MAL id ·
  5,016 with AniList id (crawl 2026-11-16, buildId nQtDWU29EFZEDmbrsjLwh).
- **Live deployment**: `https://ruristream.vercel.app/api/animethemes/*` (Vercel
  serverless, same-origin with the site — no CORS needed). The full API handler
  lives at `api/animethemes/[[...path]].js` in this repo.
- **Cloudflare variant**: `workers/animethemes-scraper.js` — identical surface,
  deployable by the owner with one command:
  `npx wrangler deploy workers/animethemes-scraper.js --name animethemes-scraper --compatibility-date 2024-01-01`
  (agent sandbox has no Cloudflare token, so the owner deploys workers).

## Endpoints (official JSON:API surface)

| Endpoint | Description |
|---|---|
| `/anime` | Index. `filter[has]` `filter[site]` `filter[external_id]` `filter[id]` `filter[slug]` `filter[name]` `filter[year]` (`1995` or `1995-2000`) `filter[season]` `filter[format]` `filter[q]`, `include=`, `sort=`, `page[number]`/`page[size]`, `fields[anime]=` |
| `/anime/{slug\|internal-id\|mal-id}` | Show (bare record unless `include=`) |
| `/theme`, `/theme/{id}` | Theme index/show. `filter[type]=OP\|ED` `filter[slug]` `filter[anime]` `filter[title]` `filter[artist]` `filter[sequence]` `filter[id]` |
| `/song` | Song index. `filter[title]` `filter[artist]`, `q=` |
| `/artist`, `/artist/{slug}` | Artist index/show. `filter[name]` `filter[slug]` `filter[id]`, `q=` |
| `/video` | Video index. `filter[basename]` `filter[resolution]` `filter[source]` `filter[subbed]` `filter[lyrics]` `filter[nc]` `filter[uncen]` `filter[id]` |
| `/audio` | Audio index (derived `.ogg` tracks) |
| `/series`, `/studio` | Series/studio indexes |
| `/image` | Anime covers/banners. `filter[facet]=LARGE_COVER\|SMALL_COVER\|...` |
| `/search?q=term` | Global search: `{ search: { anime, artists, songs, themes } }` |
| `/year`, `/year/{year}` | Year + season catalog |
| `/resource` | External-site catalog (MAL/AniList/Kitsu/AniDB/OS/...) |
| `/playlist` `/user` `/role` ... | **501** — auth-only on the official API, cannot exist in a public scrape |

`filter[site]` accepts `MyAnimeList`/`MAL`, `AniList`, `Kitsu`, `AniDB`.
`include=` accepts dot paths (`animethemes.song`, `animethemes.animethemeentries.videos`,
and the newer `entries`/`entries.videos` aliases).
Responses keep the official envelope: resource-name key (`anime`/`theme`/...),
Laravel-style `links` + `meta` pagination on indexes.
Video `link` fields point at the real CDN `https://v.animethemes.moe/{basename}`.

## Example (exactly what the site's Themes tab calls)

```
/api/animethemes/anime?filter[has]=resources&filter[site]=MyAnimeList&filter[external_id]=61987&include=animethemes.song,animethemes.animethemeentries.videos
```

## Refresh the dataset

```
python3 tools/animethemes-scraper/crawler.py        # ~15 min, resumable, 5k pages
# (crawler writes dataset to download/t194/dataset/ — copy index.json + chunks/
#  into data/animethemes/ then commit; raw pages are cached locally)
node tools/animethemes-scraper/api.test.js          # 41-check suite must pass
```

Dataset files: `data/animethemes/index.json` (id map, 1.1MB) +
`data/animethemes/chunks/chunk_000..050.json` (full records, 100 anime/chunk).
The API computes the chunk for a row from its index position — never edit
chunks without re-running the crawler's normalize pass.
