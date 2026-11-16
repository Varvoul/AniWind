#!/usr/bin/env python3
"""t194 - AnimeThemes.moe site scraper (dataset builder).

The official AnimeThemes APIs are down (REST api.animethemes.moe -> 503,
GraphQL graphql.animethemes.moe -> 404), but their static Next.js site is
freshly built and serves FULL per-anime theme payloads at
  https://animethemes.moe/_next/data/{buildId}/anime/{slug}.json
plus a complete slug index embedded in the /anime page's __NEXT_DATA__.

This crawler:
  1. reads the /anime index -> buildId + every anime slug
  2. fetches every per-anime JSON (polite, checkpointed, resumable)
  3. normalizes each record into the v1 (JSON:API) response shape the
     site already consumes: anime.mal_id / anilist_id / kitsu_id /
     anidb_id from embedded resources, themes -> song(artists) ->
     animethemeentries -> videos(with link https://v.animethemes.moe/...)

Outputs (download/t194/dataset/):
  index.json                      - searchable rows for all anime
  chunks/chunk_{k}.json           - full normalized records, 100/chunk
  raw/{slug}.json                 - untouched site payloads (re-run cache)
  crawl_report.json               - coverage + fill-rate stats

Tokens: none used. Supabase: not touched.
"""
import json, os, re, sys, time, random, threading, urllib.request, urllib.error

BASE = 'https://animethemes.moe'
OUT = '/home/z/my-project/download/t194/dataset'
RAW = os.path.join(OUT, 'raw')
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
CHUNK = 100
WORKERS = 3
DELAY = 0.12

os.makedirs(RAW, exist_ok=True)
os.makedirs(os.path.join(OUT, 'chunks'), exist_ok=True)


def fetch(url, timeout=25):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*'})
    last = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode('utf-8'))
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return None
            last = f'HTTP {e.code}'
        except Exception as e:
            last = str(e)[:120]
        time.sleep((attempt + 1) * 1.5 + random.random())
    raise RuntimeError(f'fetch failed {url}: {last}')


def fetch_bytes(url, timeout=25):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception:
            if attempt == 3:
                raise
            time.sleep((attempt + 1) * 1.2)
    raise RuntimeError('unreachable')


def get_index():
    html_bytes = fetch_bytes(BASE + '/anime')
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json"[^>]*>(.*?)</script>',
                  html_bytes.decode('utf-8', 'replace'), re.S)
    if not m:
        raise RuntimeError('no __NEXT_DATA__ in /anime index')
    d = json.loads(m.group(1))
    pp = d['props']['pageProps']
    nodes = pp['animeConnection']['nodes']
    return d['buildId'], pp.get('lastBuildAt'), nodes


def ext_ids(resources):
    ids = {}
    for e in (resources or {}).get('edges', []):
        n = e.get('node') or {}
        site, link = n.get('site'), n.get('link') or ''
        m = re.search(r'/(\d+)(?:/?$|\?)', link)
        if site and m:
            ids[site.lower()] = int(m.group(1))
    return ids.get('mal'), ids.get('anilist'), ids.get('kitsu'), ids.get('anidb')


def theme_slug(a_slug, t_type, seq, prior_same_type=0):
    # v1 convention: "{anime-slug}-{TYPE}{sequence}" — sequence null -> number
    # by position among the anime's same-type themes (first OP => OP1 etc.)
    n = seq if seq else (prior_same_type + 1)
    return f"{a_slug}-{t_type}{n}" if t_type else a_slug


def normalize(payload):
    a = (payload.get('pageProps') or {}).get('anime') or {}
    mal, anilist, kitsu, anidb = ext_ids(a.get('resources'))
    titles = a.get('title') or {}
    themes_out = []
    type_counts = {}
    for t in a.get('themes') or []:
        t_type = t.get('type')
        if t_type in type_counts:
            type_counts[t_type] += 1
        else:
            type_counts[t_type] = 0
        song = t.get('song') or {}
        st = song.get('title') or {}
        artists = []
        seen = set()
        for s in song.get('staff') or []:
            if (s.get('role') or '').lower() != 'performance':
                continue
            art = s.get('artist') or {}
            nm = (art.get('name') or {}).get('main')
            if nm and nm not in seen:
                seen.add(nm)
                artists.append({'name': nm, 'slug': art.get('slug')})
        entries_out = []
        for e in t.get('entries') or []:
            vids_out = []
            for v in (e.get('videos') or {}).get('nodes') or []:
                bn = v.get('basename')
                if not bn:
                    continue
                vids_out.append({
                    'id': v.get('id'),
                    'basename': bn,
                    'filename': v.get('filename'),
                    'link': f'https://v.animethemes.moe/{bn}',
                    'resolution': v.get('resolution'),
                    'nc': v.get('nc'), 'subbed': v.get('subbed'),
                    'lyrics': v.get('lyrics'), 'uncen': v.get('uncen'),
                    'source': v.get('source'), 'overlap': v.get('overlap'),
                    'tags': v.get('tags'),
                })
            eps = e.get('episodes')
            if isinstance(eps, list):
                eps = ','.join(str(x) for x in eps) if eps else None
            entries_out.append({
                'id': e.get('id'),
                'episodes': eps,
                'version': e.get('version'),
                'nsfw': e.get('nsfw'), 'spoiler': e.get('spoiler'),
                'notes': e.get('notes'),
                'videos': vids_out,
            })
        themes_out.append({
            'id': t.get('id'),
            'type': t.get('type'),
            'sequence': t.get('sequence'),
            'group': t.get('group'),
            'slug': theme_slug(a.get('slug'), t_type, t.get('sequence'), type_counts[t_type]),
            'song': {
                'id': song.get('id'),
                'title': st.get('romaji') or st.get('english') or st.get('native'),
                'artists': artists,
            },
            'animethemeentries': entries_out,
        })
    img = {}
    for n in (a.get('images') or {}).get('nodes') or []:
        f = (n.get('facet') or '').lower()
        if f in ('large_cover', 'small_cover', 'large_banner', 'small_banner'):
            img[f] = n.get('link')
    series = []
    for s in (a.get('series') or {}).get('nodes') or []:
        nm = s.get('title') or s.get('name')
        nm = nm.get('romaji') if isinstance(nm, dict) else nm
        series.append({'id': s.get('id'), 'slug': s.get('slug'), 'name': nm})
    studios = []
    for s in (a.get('studios') or {}).get('nodes') or []:
        studios.append({'id': s.get('id'), 'slug': s.get('slug'), 'name': s.get('name')})
    syns = []
    for s in a.get('synonyms') or []:
        syns.append(s.get('text') if isinstance(s, dict) else str(s))
    rec = {
        'id': a.get('id'),
        'slug': a.get('slug'),
        'name': titles.get('romaji'),
        'english': titles.get('english'),
        'native': titles.get('native'),
        'synonyms': syns,
        'season': a.get('season'),
        'year': a.get('year'),
        'format': a.get('formatLocalized'),
        'synopsys': a.get('synopsis'),
        'mal_id': mal, 'anilist_id': anilist, 'kitsu_id': kitsu, 'anidb_id': anidb,
        'series': series,
        'studios': studios,
        'images': img,
        'animethemes': themes_out,
    }
    return rec


def main():
    t0 = time.time()
    build_id, build_at, nodes = get_index()
    slugs = [n['slug'] for n in nodes]
    print(f'index: buildId={build_id} lastBuildAt={build_at} slugs={len(slugs)}')
    prog_path = os.path.join(OUT, 'crawl_progress.tsv')
    done = {}
    if os.path.exists(prog_path):
        with open(prog_path) as f:
            for line in f:
                s, st = line.rstrip('\n').split('\t')
                done[s] = st
    todo = [s for s in slugs if s not in done]
    print(f'resumable: {len(done)} already fetched, {len(todo)} to go')

    lock = threading.Lock()
    log = []

    def work(slug):
        rp = os.path.join(RAW, slug + '.json')
        status = 'ok'
        try:
            if not os.path.exists(rp) or os.path.getsize(rp) < 100:
                d = fetch(f'{BASE}/_next/data/{build_id}/anime/{slug}.json')
                if d is None:
                    status = 'missing'
                else:
                    with open(rp, 'w', encoding='utf-8') as f:
                        json.dump(d, f, ensure_ascii=False)
                    time.sleep(DELAY + random.random() * 0.08)
        except Exception as e:
            status = 'error:' + str(e)[:80]
        with lock:
            done[slug] = status
            log.append((slug, status))
            if len(log) % 25 == 0:
                with open(prog_path, 'w') as f:
                    for s2, st2 in done.items():
                        f.write(f'{s2}\t{st2}\n')
                ok = sum(1 for v in done.values() if v == 'ok')
                print(f'  progress {ok}/{len(slugs)} ({time.time()-t0:.0f}s)', flush=True)

    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for _ in list(ex.map(work, todo)):
            pass
    with open(prog_path, 'w') as f:
        for s2, st2 in done.items():
            f.write(f'{s2}\t{st2}\n')

    missing = [s for s, v in done.items() if v != 'ok']
    print(f'crawl done in {time.time()-t0:.0f}s; ok={len(done)-len(missing)} bad={len(missing)}')
    if missing:
        print('bad slugs:', missing[:20])

    # normalize pass
    records = []
    for slug in slugs:
        rp = os.path.join(RAW, slug + '.json')
        if not os.path.exists(rp) or os.path.getsize(rp) < 100:
            continue
        try:
            records.append(normalize(json.load(open(rp, encoding='utf-8'))))
        except Exception as e:
            print('normalize fail', slug, e)

    # dataset: index + chunks
    index_rows = [{
        'id': r['id'], 'slug': r['slug'], 'name': r['name'], 'english': r['english'],
        'mal_id': r['mal_id'], 'anilist_id': r['anilist_id'], 'kitsu_id': r['kitsu_id'],
        'year': r['year'], 'season': r['season'], 'format': r['format'],
        'themes': len(r['animethemes']),
    } for r in records]
    index = {'generated_at': int(time.time() * 1000), 'build_id': build_id,
             'total': len(records), 'anime': index_rows}
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, separators=(',', ':'))
    nchunks = 0
    for k in range(0, len(records), CHUNK):
        with open(os.path.join(OUT, 'chunks', f'chunk_{k // CHUNK:03d}.json'), 'w', encoding='utf-8') as f:
            json.dump({'k': k // CHUNK, 'anime': records[k:k + CHUNK]}, f,
                      ensure_ascii=False, separators=(',', ':'))
        nchunks += 1
    for f2 in os.listdir(os.path.join(OUT, 'chunks')):
        if int(f2.split('_')[1].split('.')[0]) >= nchunks:
            os.remove(os.path.join(OUT, 'chunks', f2))

    have_mal = sum(1 for r in records if r['mal_id'])
    have_al = sum(1 for r in records if r['anilist_id'])
    themes_total = sum(len(r['animethemes']) for r in records)
    videos_total = sum(len(e['videos']) for r in records
                       for t in r['animethemes'] for e in t['animethemeentries'])
    report = {
        'slugs_total': len(slugs), 'crawled_ok': len(done) - len(missing),
        'bad': len(missing), 'bad_slugs': missing[:50],
        'normalized': len(records), 'chunks': nchunks,
        'with_mal_id': have_mal, 'with_anilist_id': have_al,
        'themes_total': themes_total, 'videos_total': videos_total,
        'build_id': build_id, 'elapsed_sec': round(time.time() - t0, 1),
    }
    json.dump(report, open(os.path.join(OUT, 'crawl_report.json'), 'w'), indent=1)
    print(json.dumps(report, indent=1))
    print('T194 CRAWL RESULT:', 'OK' if records and not missing else
          ('OK_WITH_GAPS' if records else 'ISSUES'))
    sys.exit(0 if records else 1)


if __name__ == '__main__':
    main()
