#!/usr/bin/env node
/* t194 — local API test suite for api/animethemes/[[...path]].js
 * Spins up a tiny static server over the crawled dataset, overrides
 * AT_DATASET_BASE to it, and exercises every endpoint + parameter group.
 * Evidence: /home/z/my-project/download/t194/api_test_results.json
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const DATASET = '/home/z/my-project/download/t194/dataset';
const HANDLER_PATH = '/home/z/my-project/aniwind/api/_lib/animethemes.js';
const DISPATCH_PATH = '/home/z/my-project/aniwind/api/tmdb-proxy.js';

function startStatic(dir, port) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const p = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(dir) || !fs.existsSync(p)) { res.writeHead(404); return res.end('nope'); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      fs.createReadStream(p).pipe(res);
    });
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

function makeReq(url, pathSegs) {
  // parse the query string like Vercel would (at_path/path arrive decoded)
  const sp = new URL(url).searchParams;
  const query = { path: pathSegs };
  for (const [k, v] of sp) query[k] = v;
  return { url, query, headers: { host: 'localhost' }, method: 'GET' };
}
function makeRes() {
  let code = null, body = null;
  const headers = {};
  return {
    headers,
    setHeader(k, v) { headers[k] = v; },
    status(c) { code = c; return this; },
    json(b) { body = b; return this; },
    _result: () => ({ code, body, headers }),
  };
}

async function call(handler, pathStr, qs = '', viaDispatch = false) {
  const res = makeRes();
  if (viaDispatch) {
    // simulate the vercel.json rewrite: /api/animethemes/:path* -> tmdb-proxy?at_path=:path*
    const url = `http://localhost/api/tmdb-proxy?at_path=${encodeURIComponent(pathStr || 'anime')}${qs}`;
    await handler(makeReq(url, []), res);
  } else {
    const segs = pathStr ? pathStr.split('/') : [];
    await handler(makeReq(`http://localhost/api/animethemes${pathStr ? '/' + pathStr : ''}${qs}`, segs), res);
  }
  return res._result();
}

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; failures.push({ name, detail }); console.log('  FAIL', name, '—', detail); }
}

(async () => {
  const srv = await startStatic(DATASET, 8899);
  process.env.AT_DATASET_BASE = 'http://127.0.0.1:8899';
  const handler = require(HANDLER_PATH);
  const dispatchHandler = (await import(DISPATCH_PATH)).default;

  console.log('== site-critical path: MAL id lookup with include chain ==');
  {
    const { code, body } = await call(handler, 'anime',
      '?filter%5Bhas%5D=resources&filter%5Bsite%5D=MyAnimeList&filter%5Bexternal_id%5D=61987&include=animethemes.song,animethemes.animethemeentries.videos');
    const a = body && body.anime && body.anime[0];
    check('MAL 61987 → Kusuriya S3', code === 200 && a && a.slug === 'kusuriya_no_hitorigoto_3rd_season',
      JSON.stringify(body).slice(0, 200));
    check('themes included: OP+ED', a && a.animethemes && a.animethemes.length === 2 &&
      a.animethemes[0].type === 'OP' && a.animethemes[1].type === 'ED',
      a && a.animethemes && a.animethemes.map(t => t.type).join(','));
    const t0 = a.animethemes[0];
    check('song title + artists present', t0.song && t0.song.title && Array.isArray(t0.song.artists),
      JSON.stringify(t0.song).slice(0, 120));
    check('entries + videos + link', t0.animethemeentries && t0.animethemeentries[0].videos[0].link ===
      'https://v.animethemes.moe/KusuriyaNoHitorigotoS3-OP1.webm',
      t0.animethemeentries && JSON.stringify(t0.animethemeentries[0].videos[0]));
    check('meta/links pagination keys', body.meta && body.links &&
      body.meta.total === 1 && typeof body.links.first === 'string', JSON.stringify(body.meta));
    check('t194c links carry no internal routing params', body.links.first &&
      !body.links.first.includes('at_path=') && !body.links.first.includes('path=anime'),
      body.links.first);
  }

  console.log('== AniList id lookup ==');
  {
    const { code, body } = await call(handler, 'anime',
      '?filter[site]=AniList&filter[external_id]=195516&include=animethemes');
    check('AniList 195516 → same anime', code === 200 && body.anime[0].mal_id === 61987,
      JSON.stringify(body).slice(0, 150));
  }

  console.log('== anime show by slug / internal id / mal id ==');
  {
    const r1 = await call(handler, 'anime/kusuriya_no_hitorigoto_3rd_season', '?include=animethemes.song');
    check('show by slug', r1.code === 200 && r1.body.anime.id === 4962, r1.code + ' ' + JSON.stringify(r1.body).slice(0, 120));
    const r2 = await call(handler, 'anime/48', '?include=animethemes');
    check('show by MAL id 48 → .hack//Sign', r2.code === 200 && r2.body.anime.slug === 'hacksign',
      JSON.stringify(r2.body).slice(0, 120));
    const r3 = await call(handler, 'anime/3');
    check('show by internal id 3', r3.code === 200 && r3.body.anime.slug === 'hacksign', r3.code);
    const r4 = await call(handler, 'anime/definitely_not_a_real_slug_xyz');
    check('404 unknown slug', r4.code === 404, r4.code);
  }

  console.log('== anime index filters ==');
  {
    const r1 = await call(handler, 'anime', '?filter[year]=1995&page[size]=5');
    check('filter[year]=1995', r1.code === 200 && r1.body.meta.total >= 1 &&
      r1.body.anime.every(a => a.year === 1995), JSON.stringify(r1.body.meta));
    const r2 = await call(handler, 'anime', '?filter[season]=SPRING&filter[year]=2002&page[size]=5');
    check('filter[season]+year', r2.code === 200 && r2.body.anime.every(a => a.season === 'SPRING'), r2.code);
    const r3 = await call(handler, 'anime', '?sort=-year&page[size]=5');
    check('sort=-year desc', r3.code === 200 && r3.body.anime[0].year >= r3.body.anime[4].year,
      r3.body.anime.map(a => a.year).join(','));
    const r4 = await call(handler, 'anime', '?filter[name]=hack&page[size]=5');
    check('filter[name] fuzzy', r4.code === 200 && r4.body.anime.some(a => a.slug === 'hacksign'),
      r4.code + ' ' + r4.body.meta.total);
    const r5 = await call(handler, 'anime', '?fields[anime]=id,slug,name&page[size]=2');
    check('fields[anime] sparse', r5.code === 200 && r5.body.anime[0].id !== undefined &&
      r5.body.anime[0].synopsys === undefined, JSON.stringify(r5.body.anime[0]));
    const r6 = await call(handler, 'anime', '?filter[external_id]=61987');
    check('400 external_id without site', r6.code === 400, r6.code);
    const r7 = await call(handler, 'anime', '?filter[site]=NotARealSite&filter[external_id]=1');
    check('400 unknown site', r7.code === 400, r7.code);
    const r8 = await call(handler, 'anime', '?include=animethemes.animethemeentries.videos&page[size]=2');
    check('index page include works', r8.code === 200 && r8.body.anime[0].animethemes !== undefined, r8.code);
    const r9 = await call(handler, 'anime', '?page[size]=200&page[number]=2');
    check('pagination page 2', r9.code === 200 && r9.body.meta.current_page === 2 &&
      r9.body.meta.per_page === 200, JSON.stringify(r9.body.meta));
  }

  console.log('== theme endpoint ==');
  {
    const r1 = await call(handler, 'theme', '?filter[type]=OP&page[size]=3');
    check('theme index OP', r1.code === 200 && r1.body.theme.length === 3 &&
      r1.body.theme.every(t => t.type === 'OP') && r1.body.meta.total >= 5000, r1.code + ' total=' + (r1.body.meta || {}).total);
    const r2 = await call(handler, 'theme', '?filter[anime]=kusuriya_no_hitorigoto_3rd_season');
    check('theme filter[anime]=slug → 2', r2.code === 200 && r2.body.meta.total === 2, r2.code + ' ' + JSON.stringify(r2.body.meta));
    const r3 = await call(handler, 'theme', '?filter[slug]=hacksign-OP1');
    check('theme filter[slug]', r3.code === 200 && r3.body.theme[0].song.title === 'Obsession', JSON.stringify(r3.body.theme).slice(0, 100));
    const r4 = await call(handler, 'theme', '?filter[artist]=See-Saw&page[size]=5');
    check('theme filter[artist]', r4.code === 200 && r4.body.theme.every(t =>
      t.song && t.song.artists && t.song.artists.some(a => a.name === 'See-Saw')), r4.code);
    const r5 = await call(handler, 'theme/1553');
    check('theme show by id 1553', r5.code === 200 && r5.body.theme[0].slug === 'hacksign-OP1', r5.code + ' ' + JSON.stringify(r5.body).slice(0, 120));
    const r6 = await call(handler, 'theme', '?include=entries.videos&filter[type]=ED&page[size]=2');
    check('theme include entries.videos alias', r6.code === 200 && r6.body.theme[0].entries !== undefined, r6.code);
  }

  console.log('== search ==');
  {
    const r1 = await call(handler, 'search', '?q=kusuriya');
    check('search anime hits', r1.code === 200 && r1.body.search.anime.some(a => a.mal_id === 61987) &&
      r1.body.search.themes.length >= 2 && r1.body.search.songs.length >= 2,
      JSON.stringify(r1.body.search.anime).slice(0, 120));
    const r2 = await call(handler, 'search', '?q=');
    check('400 empty q', r2.code === 400, r2.code);
  }

  console.log('== song / artist ==');
  {
    const r1 = await call(handler, 'song', '?filter[title]=Kumo wo Nuke&page[size]=5');
    check('song filter[title]', r1.code === 200 && r1.body.song.some(s =>
      s.title === 'Kumo wo Nuke Kazashimo e Watashi dake'), JSON.stringify(r1.body).slice(0, 150));
    const r2 = await call(handler, 'artist', '?filter[name]=See-Saw');
    check('artist filter[name]', r2.code === 200 && r2.body.artist.length >= 1 &&
      r2.body.artist[0].songs.length >= 1, JSON.stringify(r2.body.artist).slice(0, 120));
    const r3 = await call(handler, 'artist/see-saw');
    check('artist show by slug', r3.code === 200 && r3.body.artist[0].name === 'See-Saw', r3.code);
  }

  console.log('== video / audio / image ==');
  {
    const r1 = await call(handler, 'video', '?filter[basename]=KusuriyaNoHitorigotoS3-OP1.webm');
    check('video by basename + link', r1.code === 200 && r1.body.video[0].link ===
      'https://v.animethemes.moe/KusuriyaNoHitorigotoS3-OP1.webm' && r1.body.video[0].resolution === 720,
      JSON.stringify(r1.body).slice(0, 160));
    const r2 = await call(handler, 'video', '?filter[resolution]=720&filter[source]=WEB&page[size]=3');
    check('video res+source filters', r2.code === 200 && r2.body.video.every(v => v.resolution === 720 &&
      v.source === 'WEB'), r2.code + ' total=' + (r2.body.meta || {}).total);
    const r3 = await call(handler, 'audio', '?page[size]=2');
    check('audio index', r3.code === 200 && r3.body.audio[0].basename.endsWith('.ogg'), JSON.stringify(r3.body.audio[0]));
    const r4 = await call(handler, 'image', '?filter[facet]=LARGE_COVER&page[size]=2');
    check('image facet filter', r4.code === 200 && r4.body.image[0].facet === 'LARGE_COVER', r4.code);
  }

  console.log('== series / studio / year / resource / errors ==');
  {
    const r1 = await call(handler, 'series', '?filter[name]=hack&page[size]=5');
    check('series index', r1.code === 200 && r1.body.series.length >= 1, r1.code);
    const r2 = await call(handler, 'studio', '?filter[name]=Kyoto Animation&page[size]=5');
    check('studio KyoAni', r2.code === 200 && r2.body.studio.some(s => s.name === 'Kyoto Animation'),
      JSON.stringify(r2.body).slice(0, 120));
    const r3 = await call(handler, 'year');
    check('year catalog', r3.code === 200 && r3.body.years[0].year >= 2026, r3.body.years && r3.body.years[0]);
    const r4 = await call(handler, 'year/2026');
    check('year/2026 show', r4.code === 200 && r4.body.year.year === 2026, r4.code);
    const r5 = await call(handler, 'resource');
    check('resource catalog', r5.code === 200 && r5.body.resource[0].site === 'MAL', r5.code);
    const r6 = await call(handler, 'playlist');
    check('501 auth-only resource', r6.code === 501, r6.code);
    const r7 = await call(handler, 'no_such_endpoint');
    check('404 unknown endpoint', r7.code === 404, r7.code);
  }

  console.log('== dispatch chain (tmdb-proxy at_path -> core) ==');
  {
    const r = await call(dispatchHandler, 'anime',
      '&filter%5Bsite%5D=MyAnimeList&filter%5Bexternal_id%5D=61987&include=animethemes.song,animethemes.animethemeentries.videos', true);
    const a = r.body && r.body.anime && r.body.anime[0];
    check('dispatch: MAL 61987 through tmdb-proxy', r.code === 200 && a && a.slug === 'kusuriya_no_hitorigoto_3rd_season',
      r.code + ' ' + JSON.stringify(r.body).slice(0, 120));
    const r2 = await call(dispatchHandler, 'theme', '&filter[type]=OP&page[size]=2', true);
    check('dispatch: theme index', r2.code === 200 && r2.body.theme.length === 2, r2.code);
    const r3 = await call(dispatchHandler, 'search', '&q=kusuriya', true);
    check('dispatch: search', r3.code === 200 && r3.body.search.anime.length >= 1, r3.code);
  }


  console.log('== t194b cache: exact-URL keying + status/TTL behavior ==');
  {
    const rc = handler._respCache;
    check('resp cache hook exported', !!rc && rc.map instanceof Map && rc.ttlMs > 0, String(rc && typeof rc));

    const qs1 = '?filter[site]=MyAnimeList&filter[external_id]=61987&include=animethemes&z=t194bA';
    const rA1 = await call(handler, 'anime', qs1);
    const rA2 = await call(handler, 'anime', qs1);
    const hA1 = rA1.headers || {}, hA2 = rA2.headers || {};
    check('first compute = miss (no X-AT-Cache)', rA1.code === 200 && !hA1['X-AT-Cache'],
      rA1.code + ' ' + JSON.stringify(hA1['X-AT-Cache']));
    check('same URL twice -> fresh-hit', rA2.code === 200 &&
      String(hA2['X-AT-Cache'] || '').startsWith('fresh-hit'), JSON.stringify(hA2));
    check('fresh-hit body identical to compute', JSON.stringify(rA1.body) === JSON.stringify(rA2.body), 'body diff');
    check('X-AT-Url-Key present + stable', hA1['X-AT-Url-Key'] && hA1['X-AT-Url-Key'] === hA2['X-AT-Url-Key'],
      hA1['X-AT-Url-Key'] + ' vs ' + hA2['X-AT-Url-Key']);
    check('Cache-Control raised (6h edge + SWR 7d)', String(hA1['Cache-Control']).includes('s-maxage=21600') &&
      String(hA1['Cache-Control']).includes('stale-while-revalidate=604800'), String(hA1['Cache-Control']));

    // one character different in the URL -> different key -> fresh compute
    const qs2 = '?filter[site]=MyAnimeList&filter[external_id]=61988&include=animethemes&z=t194bA';
    const rB = await call(handler, 'anime', qs2);
    check('URL differing by one char -> cache miss (fresh scrape)', rB.code === 200 && !rB.headers['X-AT-Cache'],
      rB.code + ' hdr=' + JSON.stringify(rB.headers['X-AT-Cache']));
    check('different URL-key for different URL', rB.headers['X-AT-Url-Key'] !== hA1['X-AT-Url-Key'], 'key collision');

    // extra param = its own cache entry (exact-URL semantics)
    const rC = await call(handler, 'anime', qs1 + '&sort=id');
    check('extra param -> own fresh entry (exact key)', rC.code === 200 && !rC.headers['X-AT-Cache'], rC.code);
    check('extra param -> different URL-key', rC.headers['X-AT-Url-Key'] !== hA1['X-AT-Url-Key'], 'key collision');

    // TTL expiry: age every entry past the fresh window, then re-request —
    // upstream is alive, so the entry must RECOMPUTE (not serve stale)
    rc.map.forEach((v) => { v.at -= (rc.ttlMs + 1000); });
    const rD = await call(handler, 'anime', qs1);
    check('expired entry recomputes (no stale while upstream alive)',
      rD.code === 200 && !rD.headers['X-AT-Cache'], rD.code + ' ' + JSON.stringify(rD.headers['X-AT-Cache']));

    // stale-serve on upstream failure: fresh module instance over a dead
    // dataset, with a pre-seeded EXPIRED entry for the exact URL
    process.env.AT_DATASET_BASE = 'http://127.0.0.1:1';
    delete require.cache[HANDLER_PATH];
    const handler2 = require(HANDLER_PATH);
    const rc2 = handler2._respCache;
    const deadKey = '/anime?dead=t194b';
    rc2.set(deadKey, 200, { seeded: 'stale-body' });
    rc2.map.get(deadKey).at -= (rc2.ttlMs + 1000);
    const rE = await call(handler2, 'anime', '?dead=t194b');
    check('STALE served when upstream fails (status-based cache)',
      rE.code === 200 && rE.body.seeded === 'stale-body' &&
      String(rE.headers['X-AT-Cache']).startsWith('stale-upstream-fail'),
      rE.code + ' ' + JSON.stringify(rE.headers));
    const rF = await call(handler2, 'anime', '?nothing_cached=t194b');
    check('503 when upstream fails AND no cache entry', rF.code === 503, rF.code);
    process.env.AT_DATASET_BASE = 'http://127.0.0.1:8899';
  }

  srv.close();
  const results = { pass, fail, failures, handler: HANDLER_PATH,
    dataset: DATASET, at: new Date().toISOString() };
  fs.mkdirSync('/home/z/my-project/download/t194', { recursive: true });
  fs.writeFileSync('/home/z/my-project/download/t194/api_test_results.json', JSON.stringify(results, null, 1));
  console.log(`\nAPI TEST: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(1); });
