/*!
 * aniumi-cache.js v2.0.0 — permanent browser cache for RuriStream info pages
 * ---------------------------------------------------------------------------
 * localStorage-backed implementation of the AniCache API the info page was
 * written against. Data persists until the user clears browser/site data.
 *
 *   AniCache.get(key)                     -> Promise<data|null>
 *   AniCache.set({cacheKey, data, permanent, section, ...}) -> Promise<bool>
 *   AniCache.getDetails(mediaId, {permanent})  -> Promise<details|null>
 *   AniCache.saveDetails(mediaId, patch, {permanent}) -> Promise<bool>
 *   AniCache.findShow(mediaId)            -> Promise<showRow|null>
 *   AniCache.save([rows])                 -> Promise<bool>
 *   AniCache.stampSection(name, count, {permanent}) -> Promise<bool>
 *   AniCache.isPermanentStatus(status)    -> bool
 *   AniCache.trimTMDBData(payload)        -> trimmed payload
 *   AniCache.debug()                      -> {keys, bytes} for ops checks
 *
 * Storage layout (localStorage):
 *   aniumi:v2:lru                     -> LRU index [{k, sz, perm, ts}]
 *   aniumi:v2:cache:{cacheKey}        -> meta JSON {t, ttl, nc}  (ttl 0 = forever)
 *   aniumi:v2:cache:{cacheKey}#{i}    -> chunk i of JSON.stringify(data)
 *   aniumi:v2:det:{mediaId}           -> show_details blob (same meta/chunks)
 *   aniumi:v2:show:{mediaId}          -> shows row (small, no chunks)
 *   aniumi:v2:stamp:{name}            -> section stamp {t, n, perm}
 *
 * v2 MIGRATION: on first load every legacy key is swept — anything under
 * aniumi:v1:* (previous lib generation) plus bare "info:" / "sidebar_html:"
 * keys (older raw-writing generations). Stale payloads from those eras can
 * carry outdated markup/data shapes that render wrong under the current UI,
 * so they are deleted once and rebuilt through live calls on next visit.
 *
 * TTL policy: permanent:true -> never expires; otherwise 24h default,
 * 72h for sidebar_* sections (pre-existing semantics). Expired entries are
 * removed lazily; quota pressure evicts LRU (non-permanent first).
 * Large payloads are chunked (~380k chars per key). Writes are meta-last so a
 * quota failure can never leave a half-written entry readable; orphan chunks
 * are swept on the next quota error.
 */
(function (root) {
  'use strict';

  var PREFIX     = 'aniumi:v2:';
  var IDX_KEY    = PREFIX + 'lru';
  var CHUNK      = 380000;            // max chars per storage value
  var MAX_ENTRY  = 2000000;           // refuse single payloads above this
  var DAY        = 24 * 3600 * 1000;
  var DEFAULT_TTL   = DAY;            // non-permanent entries
  var SIDEBAR_TTL   = 3 * DAY;        // sidebar lists — 72h
  var IDX_CAP    = 400;               // hard cap on tracked entries

  var ls = null;
  try {
    ls = root.localStorage;
    ls.setItem(PREFIX + 'probe', '1');
    ls.removeItem(PREFIX + 'probe');
  } catch (e) { ls = null; }          // private mode / disabled — all no-ops

  // ── one-time legacy sweep (v2 migration) ─────────────────────────────
  // Removes every payload written by older cache generations: aniumi:v1:*
  // (previous lib) and bare info:*/sidebar_html:* (older raw-key eras).
  // shared.js keys (aniumi_last_activity / aniumi_pending_geo — no colon
  // after "aniumi") and the current aniumi:v2:* namespace are untouched.
  (function sweepLegacy() {
    if (!ls) return;
    var dead = [];
    try {
      for (var i = 0; i < ls.length; i++) {
        var k = ls.key(i);
        if (!k) continue;
        if (k.indexOf('aniumi:') === 0 && k.indexOf(PREFIX) !== 0) dead.push(k);
        else if (k.indexOf('info:') === 0 || k.indexOf('sidebar_html:') === 0) dead.push(k);
      }
    } catch (e) { return; }
    for (var j = 0; j < dead.length; j++) {
      try { ls.removeItem(dead[j]); } catch (e2) {}
    }
  })();

  function _now() { return Date.now(); }

  // ── LRU index ────────────────────────────────────────────────────────────
  function idxLoad() {
    if (!ls) return [];
    try { return JSON.parse(ls.getItem(IDX_KEY)) || []; } catch (e) { return []; }
  }
  function idxSave(list) {
    if (!ls) return;
    try { ls.setItem(IDX_KEY, JSON.stringify(list)); } catch (e) { /* best effort */ }
  }
  function idxTouch(key, sz, perm) {
    var list = idxLoad().filter(function (e) { return e.k !== key; });
    list.unshift({ k: key, sz: sz || 0, perm: !!perm, ts: _now() });
    if (list.length > IDX_CAP) list.length = IDX_CAP;
    idxSave(list);
  }
  function idxRemove(key) {
    idxSave(idxLoad().filter(function (e) { return e.k !== key; }));
  }

  // ── chunked value plumbing ───────────────────────────────────────────────
  function baseKey(kind, k) { return PREFIX + kind + ':' + k; }

  function writeValue(kind, k, data, ttl) {
    var str = JSON.stringify(data);
    if (str.length > MAX_ENTRY) return false;
    var bKey = baseKey(kind, k);
    // remove any previous version first (chunk counts may differ)
    var oldMeta = null;
    try { oldMeta = JSON.parse(ls.getItem(bKey)); } catch (e) { oldMeta = null; }
    removeKeys(bKey, oldMeta && oldMeta.nc > 1 ? oldMeta.nc : 0);

    var n = Math.ceil(str.length / CHUNK) || 1;
    var i;
    if (n === 1) {
      ls.setItem(bKey + '#d', str);                    // payload chunk first…
    } else {
      for (i = 0; i < n; i++) {
        ls.setItem(bKey + '#' + i, str.slice(i * CHUNK, (i + 1) * CHUNK));
      }
    }
    // …meta LAST — readers trust the base key only (atomic-ish writes)
    var meta = { t: _now(), ttl: ttl || 0, nc: n, sz: str.length };
    ls.setItem(bKey, JSON.stringify(meta));
    return meta;
  }

  function readValue(kind, k) {
    if (!ls) return null;
    var bKey = baseKey(kind, k);
    var meta;
    try { meta = JSON.parse(ls.getItem(bKey)); } catch (e) { meta = null; }
    if (!meta || typeof meta.t !== 'number') return null;
    if (meta.ttl && _now() - meta.t > meta.ttl) {   // expired — lazy delete
      removeKeys(bKey, meta.nc > 1 ? meta.nc : 0);
      try { ls.removeItem(bKey + '#d'); } catch (e) {}
      idxRemove(bKey);
      return null;
    }
    try {
      if (meta.nc <= 1) {
        var one = ls.getItem(bKey + '#d');
        if (one == null) return null;
        return JSON.parse(one);
      }
      var parts = new Array(meta.nc), ok = true;
      for (var i = 0; i < meta.nc; i++) {
        var p = ls.getItem(bKey + '#' + i);
        if (p == null) { ok = false; break; }
        parts[i] = p;
      }
      return ok ? JSON.parse(parts.join('')) : null;
    } catch (e) { return null; }
  }

  function removeKeys(bKey, chunkCount) {
    try {
      ls.removeItem(bKey);                                 // meta itself
      ls.removeItem(bKey + '#d');
      if (chunkCount > 0) for (var i = 0; i < chunkCount; i++) ls.removeItem(bKey + '#' + i);
    } catch (e) {}
  }
  function dropEntry(kind, k) {
    var bKey = baseKey(kind, k);
    var meta = null;
    try { meta = JSON.parse(ls.getItem(bKey)); } catch (e) {}
    removeKeys(bKey, meta && meta.nc > 1 ? meta.nc : 0);
    idxRemove(bKey);
  }

  // ── quota recovery ───────────────────────────────────────────────────────
  function sweepOrphans() {
    if (!ls) return;
    var idx = idxLoad(), known = {};
    idx.forEach(function (e) { known[e.k] = true; });
    var junk = [];
    for (var i = 0; i < ls.length; i++) {
      var k = ls.key(i);
      if (!k || k.indexOf(PREFIX + 'cache:') !== 0 && k.indexOf(PREFIX + 'det:') !== 0) continue;
      if (k.slice(-2) === '#d' || /#\d+$/.test(k)) {
        // chunk without a live base key?
        var b = k.split('#')[0];
        if (!known[b]) junk.push(k);
      } else if (!known[k]) {
        junk.push(k);
      }
    }
    junk.forEach(function (k) { try { ls.removeItem(k); } catch (e) {} });
    if (junk.length) { /* orphans freed */ }
  }

  function evictOne() {
    var list = idxLoad();
    // 1) expired entries first — free space without losing fresh data
    for (var i = list.length - 1; i >= 0; i--) {
      var meta = null;
      try { meta = JSON.parse(ls.getItem(list[i].k)); } catch (e) {}
      if (!meta || (meta.ttl && _now() - meta.t > meta.ttl)) {
        removeKeys(list[i].k, meta && meta.nc > 1 ? meta.nc : 0);
        list.splice(i, 1);
        idxSave(list);
        return true;
      }
    }
    // 2) least-recently-used non-permanent, 3) oldest permanent
    for (var pass = 0; pass < 2; pass++) {
      for (var j = list.length - 1; j >= 0; j--) {
        if (pass === 0 && list[j].perm) continue;
        removeKeys(list[j].k, 0);
        try { var m2 = JSON.parse(ls.getItem(list[j].k)); removeKeys(list[j].k, m2 && m2.nc > 1 ? m2.nc : 0); } catch (e) {}
        list.splice(j, 1);
        idxSave(list);
        return true;
      }
    }
    return false;
  }

  function writeWithRetry(kind, k, data, ttl, perm) {
    if (!ls) return false;
    var bKey = baseKey(kind, k);
    for (var attempt = 0; attempt < 8; attempt++) {
      try {
        var meta = writeValue(kind, k, data, ttl);
        if (!meta) return false;             // payload too large — don't cache
        idxTouch(bKey, meta.sz, perm);
        return true;
      } catch (e) {
        sweepOrphans();
        if (!evictOne()) return false;       // nothing left to free
      }
    }
    return false;
  }

  function sectionTtl(section) {
    // sidebar lists (Hidden Gem / Top Ranking / Most Favourite) refresh on a
    // 72h cycle — their call sites stamp section hidden_gem|top_ranking|most_favourite
    if (section && /^(hidden_gem|top_ranking|most_favourite)$/.test(section)) return SIDEBAR_TTL;
    return DEFAULT_TTL;
  }

  // ── public API ───────────────────────────────────────────────────────────
  var AniCache = {

    get: function (key) {
      return new Promise(function (res) {
        if (!ls || !key) return res(null);
        try { res(readValue('cache', key)); } catch (e) { res(null); }
      });
    },

    set: function (opts) {
      return new Promise(function (res) {
        if (!ls || !opts || !opts.cacheKey || opts.data === undefined) return res(false);
        var ttl = opts.permanent ? 0 : sectionTtl(opts.section);
        try {
          res(writeWithRetry('cache', opts.cacheKey, opts.data, ttl, !!opts.permanent));
        } catch (e) { res(false); }
      });
    },

    getDetails: function (mediaId) {
      return new Promise(function (res) {
        if (!ls || !mediaId) return res(null);
        try { res(readValue('det', String(mediaId))); } catch (e) { res(null); }
      });
    },

    saveDetails: function (mediaId, patch, opts) {
      return new Promise(function (res) {
        if (!ls || !mediaId || !patch || typeof patch !== 'object') return res(false);
        var mid = String(mediaId);
        var existing = null;
        try { existing = readValue('det', mid); } catch (e) {}
        var merged = existing || {};
        for (var f in patch) if (Object.prototype.hasOwnProperty.call(patch, f)) merged[f] = patch[f];
        var permanent = !!(opts && opts.permanent);
        var ttl = permanent ? 0 : ((existing && existing.__ttl === 0) ? 0 : DEFAULT_TTL);
        merged.__ttl = ttl;                  // remember for merges
        try {
          res(writeWithRetry('det', mid, merged, ttl, permanent));
        } catch (e) { res(false); }
      });
    },

    findShow: function (mediaId) {
      return new Promise(function (res) {
        if (!ls || !mediaId) return res(null);
        try {
          var raw = ls.getItem(baseKey('show', String(mediaId)));
          res(raw ? JSON.parse(raw) : null);
        } catch (e) { res(null); }
      });
    },

    save: function (rows) {
      return new Promise(function (res) {
        if (!ls || !Array.isArray(rows)) return res(false);
        var ok = true;
        rows.forEach(function (r) {
          if (!r || !r.id) { ok = false; return; }
          try { ls.setItem(baseKey('show', String(r.id)), JSON.stringify(r)); }
          catch (e) { ok = false; }
        });
        res(ok);
      });
    },

    stampSection: function (name, count, opts) {
      return new Promise(function (res) {
        if (!ls || !name) return res(false);
        try {
          ls.setItem(baseKey('stamp', String(name)),
            JSON.stringify({ t: _now(), n: count || 0, perm: !!(opts && opts.permanent) }));
          res(true);
        } catch (e) { res(false); }
      });
    },

    isPermanentStatus: function (status) {
      var s = String(status || '').toLowerCase();
      if (!s) return false;
      if (/not yet|upcoming|announced|pre-?production|planned|in production|post production/.test(s)) return false;
      return /\bfinished airing\b|\baired\b|\breleased\b|\bended\b|\bcancell?ed\b|\bcompleted\b/.test(s);
    },

    trimTMDBData: function (d) {
      // Drop known-heavy fields the info page never renders (mapple combined
      // payloads carry huge translations/reviews blocks). Shallow copy — the
      // live page keeps using the original object.
      if (!d || typeof d !== 'object') return d;
      var out = Object.assign({}, d);
      delete out.translations;
      delete out.reviews;
      return out;
    },

    debug: function () {
      if (!ls) return { keys: 0, bytes: 0, available: false };
      var n = 0, bytes = 0;
      for (var i = 0; i < ls.length; i++) {
        var k = ls.key(i);
        if (k && k.indexOf(PREFIX) === 0) { n++; bytes += (ls.getItem(k) || '').length + k.length; }
      }
      return { keys: n, bytes: bytes, available: true };
    }
  };

  root.AniCache = AniCache;
  if (typeof module !== 'undefined' && module.exports) module.exports = AniCache;
})(typeof window !== 'undefined' ? window : globalThis);
