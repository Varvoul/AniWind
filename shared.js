// shared.js – Complete header, footer, search, and authentication system
(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════
     CONSTANTS
  ═══════════════════════════════════════════════════════════ */
  const SUPABASE_URL      = 'https://uhjucwqiadymmogmwkxc.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVoanVjd3FpYWR5bW1vZ213a3hjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MTY0NDcsImV4cCI6MjA5NzA5MjQ0N30.nJZQftmkbu0Ix-4lgtfzJcm_qIkI32e3SykF49XPrlg';
  const supabase          = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const CF_WORKER_URL     = 'https://aniocen.bionmovies47.workers.dev';
  const PROFILE_BUCKET_URL= `${SUPABASE_URL}/storage/v1/object/public/Aniumi/`;
  // NOTE: Frieren.jpeg lives inside the `profile_ava/` folder of the Aniumi bucket,
  // not at the bucket root.  Verified publicly accessible (HTTP 200, 80KB JPEG).
  const DEFAULT_AVATAR    = 'https://uhjucwqiadymmogmwkxc.supabase.co/storage/v1/object/public/Aniumi/profile_ava/Frieren.jpeg';
  const HCAPTCHA_SITEKEY  = '2dd853ec-9482-4bf6-b2e6-f5f478d0bf86';
  const SESSION_MAX_AGE   = 30 * 24 * 60 * 60 * 1000; // 1 month in ms
  // Dedicated permanent bucket for user-uploaded & Google-downloaded avatars.
  // Public bucket, no lifecycle policy → URLs NEVER expire.
  const AVATAR_BUCKET     = 'AniumiAvatars';
  const AVATAR_BUCKET_URL = `${SUPABASE_URL}/storage/v1/object/public/${AVATAR_BUCKET}/`;

  // Landscape images for the MOBILE auth modal carousel (crossfade every 3s).
  // Desktop keeps its static left-column image — these are mobile-only.
  const AUTH_CAROUSEL_IMAGES = [
    'https://i.postimg.cc/KjK0mCTK/9cde8b5c-129b-4019-8bb0-65c91b52191a.jpg',
    'https://i.postimg.cc/9MNCs2mn/c6a0dae09f9141a402966858be6768ae.jpg',
    'https://i.postimg.cc/h46KrK3c/0f71ce1f0c0dfb357586848e2000be96.jpg',
    'https://i.postimg.cc/7ZyDFm4f/12fc1dce99f4f6f2a345fcea1a2b2a27.jpg',
    'https://i.postimg.cc/JhpLB8Bv/d28e7da6684d2f604733f1b8f25e83af.jpg',
    'https://i.postimg.cc/nrjpJWMM/9a0d0fda049ebcc44e5cb64b38c5a2f7.jpg'
  ];

  let searchDebounceTimer = null;
  let currentSearchMode   = 'non-anime';
  let currentUser         = null;
  let hcaptchaToken       = '';
  let cachedGeo           = null;   // { ip, country, country_code, state, city, timezone }

  /* ═══════════════════════════════════════════════════════════
     GEO / IP CAPTURE  — used by both signup & login
     Caches the result so we don't hit the free API multiple times.
  ═══════════════════════════════════════════════════════════ */
  async function getUserGeo() {
    if (cachedGeo) return cachedGeo;
    // Browser local timezone (always available, no API needed)
    const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    // Compute UTC offset string e.g. "UTC+6" or "UTC-5"
    const offsetMin  = -new Date().getTimezoneOffset();
    const offsetSign = offsetMin >= 0 ? '+' : '-';
    const offsetHrs  = Math.floor(Math.abs(offsetMin) / 60);
    const offsetMins = Math.abs(offsetMin) % 60;
    const utcOffset  = 'UTC' + offsetSign + offsetHrs + (offsetMins ? ':' + String(offsetMins).padStart(2,'0') : '');
    const fallback = {
      ip: null, country: null, country_code: null,
      state: null, city: null,
      local_timezone: localTz, utc_offset: utcOffset, timezone: localTz
    };
    try {
      // ipapi.co via Cloudflare Worker proxy — no CORS issues
      const res = await fetch('https://ipapi-proxy.bionmovies47.workers.dev/json/', { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        if (j.success !== false && !j.error) {
          cachedGeo = {
            ip:             j.ip || null,
            country:        j.country_name || null,
            country_code:   j.country_code || null,
            state:          j.region || null,
            city:           j.city || null,
            local_timezone: localTz,
            utc_offset:     utcOffset,
            timezone:       localTz   // kept for backward compat
          };
          return cachedGeo;
        }
      }
    } catch (e) { /* network error — fall through */ }
    try {
      const r2 = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
      if (r2.ok) {
        const j2 = await r2.json();
        cachedGeo = { ...fallback, ip: j2.ip || null };
        return cachedGeo;
      }
    } catch (e) { /* give up gracefully */ }
    cachedGeo = fallback;
    return cachedGeo;
  }

  window.onHcaptchaSuccess = (t) => { hcaptchaToken = t; };
  window.onHcaptchaExpired = ()  => { hcaptchaToken = ''; };
  window.onHcaptchaError   = ()  => { hcaptchaToken = ''; };

  /* ═══════════════════════════════════════════════════════════
     SVG ICONS
  ═══════════════════════════════════════════════════════════ */
  const SVG = {
    discord:  `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M20.317 4.492c-1.53-.69-3.17-1.2-4.885-1.49a.075.075 0 0 0-.079.036c-.21.369-.444.85-.608 1.23a18.566 18.566 0 0 0-5.487 0 12.36 12.36 0 0 0-.617-1.23A.077.077 0 0 0 8.562 3c-1.714.29-3.354.8-4.885 1.491a.07.07 0 0 0-.032.027C.533 9.093-.32 13.555.099 17.961a.08.08 0 0 0 .031.055 20.03 20.03 0 0 0 5.993 2.98.078.078 0 0 0 .084-.026c.462-.62.874-1.275 1.226-1.963a.075.075 0 0 0-.041-.104 13.2 13.2 0 0 1-1.872-.878.075.075 0 0 1-.008-.125c.126-.093.252-.19.372-.287a.075.075 0 0 1 .078-.01c3.927 1.764 8.18 1.764 12.061 0a.075.075 0 0 1 .079.009c.12.098.245.195.372.288a.075.075 0 0 1-.006.125c-.598.344-1.22.635-1.873.877a.075.075 0 0 0-.041.105c.36.687.772 1.341 1.225 1.962a.077.077 0 0 0 .084.028 19.963 19.963 0 0 0 6.002-2.981.076.076 0 0 0 .032-.054c.5-5.094-.838-9.52-3.549-13.442a.06.06 0 0 0-.031-.028zM8.02 15.278c-1.182 0-2.157-1.069-2.157-2.38 0-1.312.956-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.956 2.38-2.157 2.38zm7.975 0c-1.183 0-2.157-1.069-2.157-2.38 0-1.312.955-2.38 2.157-2.38 1.21 0 2.176 1.077 2.157 2.38 0 1.312-.946 2.38-2.157 2.38z"/></svg>`,
    tumblr:   `<svg viewBox="0 0 512 512" fill="currentColor" width="18" height="18"><path d="M412.904,405.777c0.123-0.088,0.225-0.213,0.324-0.313v0.313v89.785c-17.043,9.107-31.264,15.932-105.418,15.932c-10.729,0-20.66-0.074-31.713,0c-48.542,0.324-119.016-13.697-119.016-92.305v-185.1v-22.767h-58.31v-84.222H109.5c17.278,0,33.491-6.362,47.582-17.44c8.745-6.862,16.623-15.606,23.447-25.774c14.858-22.157,24.502-51.187,26.254-83.386h69.527v126.601h121.422v62.453v21.769H276.311v84.658v107.514c0,10.779,36.314,26.859,62.775,26.859S391.496,419.414,412.904,405.777z"/></svg>`,
    bluesky:  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" fill="currentColor" width="18" height="18"><path d="M407.8 294.7c-3.3-.4-6.7-.8-10-1.3 3.4 .4 6.7 .9 10 1.3zM288 227.1C261.9 176.4 190.9 81.9 124.9 35.3 61.6-9.4 37.5-1.7 21.6 5.5 3.3 13.8 0 41.9 0 58.4S9.1 194 15 213.9c19.5 65.7 89.1 87.9 153.2 80.7 3.3-.5 6.6-.9 10-1.4-3.3 .5-6.6 1-10 1.4-93.9 14-177.3 48.2-67.9 169.9 120.3 124.6 164.8-26.7 187.7-103.4 22.9 76.7 49.2 222.5 185.6 103.4 102.4-103.4 28.1-156-65.8-169.9-3.3-.4-6.7-.8-10-1.3 3.4 .4 6.7 .9 10 1.3 64.1 7.1 133.6-15.1 153.2-80.7 5.9-19.9 15-138.9 15-155.5s-3.3-44.7-21.6-52.9c-15.8-7.1-40-14.9-103.2 29.8-66.1 46.6-137.1 141.1-163.2 191.8z"/></svg>',
    search:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
    user:     `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path opacity="0.4" d="M12 22.01C17.52 22.01 22 17.53 22 12.01C22 6.49 17.52 2.01 12 2.01C6.48 2.01 2 6.49 2 12.01C2 17.53 6.48 22.01 12 22.01Z" fill="currentColor"/><path d="M12 6.94C9.93 6.94 8.25 8.62 8.25 10.69C8.25 12.72 9.84 14.37 11.95 14.43C12.02 14.43 12.09 14.43 12.13 14.43C14.15 14.36 15.74 12.72 15.75 10.69C15.75 8.62 14.07 6.94 12 6.94Z" fill="currentColor"/><path d="M18.78 19.36C17 21 14.62 22.01 12 22.01C9.38 22.01 7 21 5.22 19.36C5.46 18.45 6.11 17.62 7.06 16.98C9.79 15.16 14.23 15.16 16.94 16.98C17.9 17.62 18.54 18.45 18.78 19.36Z" fill="currentColor"/></svg>`,
    close:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
    eye:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    eyeOff:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
    google:   `<svg width="18" height="18" viewBox="-0.5 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M9.827,24C9.827,22.476 10.08,21.014 10.532,19.644L2.624,13.604C1.082,16.734 0.214,20.26 0.214,24C0.214,27.736 1.081,31.261 2.62,34.388L10.525,28.337C10.077,26.973 9.827,25.517 9.827,24" fill="#FBBC05"/><path d="M23.714,10.133C27.025,10.133 30.016,11.307 32.366,13.227L39.202,6.4C35.036,2.773 29.695,0.533 23.714,0.533C14.427,0.533 6.445,5.844 2.624,13.604L10.532,19.644C12.355,14.112 17.549,10.133 23.714,10.133" fill="#EB4335"/><path d="M23.714,37.867C17.549,37.867 12.355,33.888 10.532,28.356L2.624,34.395C6.445,42.156 14.427,47.467 23.714,47.467C29.417,47.467 34.918,45.431 39.025,41.618L31.518,35.814C29.4,37.149 26.732,37.867 23.714,37.867" fill="#34A853"/><path d="M46.145,24C46.145,22.613 45.932,21.12 45.611,19.733L23.714,19.733L23.714,28.8L36.318,28.8C35.688,31.891 33.972,34.268 31.518,35.814L39.025,41.618C43.339,37.614 46.145,31.649 46.145,24" fill="#4285F4"/></svg>`,
    logout:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
    profile:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    film:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/></svg>`,
    list:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
    bar:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    upload:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>`,
    arrow:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="m9 18 6-6-6-6"/></svg>`,
    star:     `<svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`
  };

  /* ═══════════════════════════════════════════════════════════
     CSS
  ═══════════════════════════════════════════════════════════ */
  const css = `
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    a{text-decoration:none;color:inherit;}
    button{cursor:pointer;font-family:inherit;}

    /* ── HEADER ── */
    .site-header{
      background:var(--bg-header,#0d1117);
      padding:0 20px;display:flex;align-items:center;gap:10px;
      border-bottom:1px solid var(--border-subtle,rgba(255,255,255,0.08));
      position:sticky;top:0;z-index:200;height:64px;flex-wrap:nowrap;
    }

    /* ── LOGO ── */
    .header-logo{flex-shrink:0;display:flex;align-items:center;}
    .header-logo img{width:clamp(98px,13vw,212px);height:auto;object-fit:contain;max-height:63px;}

    /* ── DESKTOP NAV (hover-only) ── */
    .main-nav{display:flex;align-items:center;gap:2px;flex-shrink:0;}
    .nav-link-item{
      padding:7px 10px;font-size:0.78rem;font-weight:500;
      color:var(--text-secondary,#ccc);border-radius:6px;
      transition:background .18s,color .18s;white-space:nowrap;display:block;
    }
    .nav-link-item:hover,.nav-link-item:focus{background:rgba(255,255,255,0.08);color:#fff;}
    .nav-dd-wrap{position:relative;}
    .nav-dd-label{
      padding:7px 10px;font-size:0.78rem;color:var(--text-secondary,#ccc);
      border-radius:6px;transition:background .18s,color .18s;
      white-space:nowrap;user-select:none;cursor:default;display:flex;align-items:center;gap:3px;
    }
    .nav-dd-wrap:hover .nav-dd-label,.nav-dd-wrap:focus-within .nav-dd-label{background:rgba(255,255,255,0.08);color:#fff;}
    /* Desktop dropdown: ONLY shown on hover of parent wrapper */
    .nav-dropdown{
      display:none;position:absolute;top:calc(100% + 4px);left:0;
      background:var(--bg-body,#13191f);
      border:1px solid var(--border-medium,rgba(255,255,255,0.12));
      border-radius:14px;padding:14px;z-index:300;
      box-shadow:0 16px 48px rgba(0,0,0,.6);
      pointer-events:none;
    }
    .nav-dd-wrap:hover .nav-dropdown{display:grid;pointer-events:auto;}
    .nav-dropdown.grid-4{min-width:560px;grid-template-columns:repeat(4,1fr);gap:2px;}
    .nav-dropdown.grid-1{min-width:160px;grid-template-columns:1fr;}
    .nav-dropdown a{
      display:block;padding:6px 10px;font-size:0.74rem;
      color:var(--text-secondary,#aaa);border-radius:7px;
      transition:background .15s,color .15s;
    }
    .nav-dropdown a:hover{background:rgba(255,255,255,0.08);color:#fff;}

    /* ── SEARCH ── */
    .header-search-wrap{flex:1;max-width:330px;position:relative;min-width:0;}
    .header-search-bar{
      display:flex;align-items:center;
      background:var(--bg-surface,rgba(255,255,255,0.05));
      border-radius:50px;overflow:hidden;
      transition:box-shadow .2s;
    }
    .header-search-bar:focus-within{box-shadow:0 0 0 2px var(--btn-primary,#3b82f6);}
    .search-toggle-tabs{display:flex;padding:4px;gap:2px;flex-shrink:0;}
    .search-toggle-tab{
      padding:4px 9px;font-size:0.6rem;font-weight:700;border-radius:50px;
      cursor:pointer;color:var(--text-muted,#888);white-space:nowrap;
      letter-spacing:.03em;transition:background .18s,color .18s;user-select:none;
    }
    .search-toggle-tab.active{background:var(--btn-primary,#3b82f6);color:#fff;}
    .search-input-field{
      flex:1;padding:9px 6px 9px 2px;background:transparent;
      border:none;outline:none;color:#fff;font-size:0.78rem;min-width:0;
    }
    .search-input-field::placeholder{color:var(--text-muted,#666);}

    /* ── SUGGESTIONS ── */
    .search-suggestions{
      display:none;position:absolute;top:calc(100% + 8px);left:0;right:0;
      background:var(--bg-body,#13191f);
      border:1px solid var(--border-medium,rgba(255,255,255,0.1));
      border-radius:14px;max-height:430px;
      overflow-y:auto;overflow-x:hidden;
      z-index:350;box-shadow:0 20px 60px rgba(0,0,0,.7);
      scrollbar-width:none;
    }
    .search-suggestions::-webkit-scrollbar{display:none;}
    .suggestion-item{
      display:flex;align-items:center;gap:10px;padding:8px 12px;
      cursor:pointer;transition:background .15s;
      border-bottom:1px solid rgba(255,255,255,0.04);
    }
    .suggestion-item:last-of-type{border-bottom:none;}
    .suggestion-item:hover{background:rgba(255,255,255,0.06);}
    .suggestion-poster{
      width:38px;height:54px;border-radius:5px;
      object-fit:cover;flex-shrink:0;background:var(--bg-surface,#1e2633);
    }
    .suggestion-info{flex:1;min-width:0;}
    .sug-title{font-size:10px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .sug-orig{font-size:9px;color:var(--text-muted,#888);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;}
    .sug-meta{font-size:8.5px;color:var(--text-muted,#666);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .sug-score{display:inline-flex;align-items:center;gap:2px;color:#f59e0b;}
    .view-all-btn{
      display:flex;align-items:center;justify-content:center;gap:5px;
      padding:9px 0;margin:4px 12px 8px;
      border:1.5px solid var(--btn-primary,#3b82f6);border-radius:50px;
      color:var(--btn-primary,#3b82f6);font-size:0.72rem;font-weight:600;
      cursor:pointer;background:transparent;width:calc(100% - 24px);
      transition:background .18s,color .18s;
    }
    .view-all-btn:hover{background:var(--btn-primary,#3b82f6);color:#fff;}

    /* ── SOCIALS ── */
    .header-socials{display:flex;gap:4px;flex-shrink:0;}
    .social-icon-btn{
      width:32px;height:32px;border-radius:50%;display:flex;
      align-items:center;justify-content:center;
      color:var(--text-muted,#aaa);background:transparent;
      border:none;transition:background .18s,color .18s;flex-shrink:0;
    }
    .social-icon-btn:hover{background:rgba(255,255,255,0.1);color:#fff;}

    /* ── LOGIN BTN ── */
    .btn-login{
      padding:7px 18px;background:transparent;color:var(--text-secondary,#ccc);
      border-radius:50px;font-weight:600;font-size:0.75rem;
      border:none;white-space:nowrap;transition:color .18s;flex-shrink:0;
    }
    .btn-login:hover{color:#fff;}

    /* ── AVATAR & DROPDOWN – right edge only ── */
    .user-avatar-wrap{position:relative;flex-shrink:0;}
    .user-avatar{
      width:34px;height:34px;border-radius:50%;object-fit:cover;
      cursor:pointer;border:2px solid var(--btn-primary,#3b82f6);display:none;
    }
    .profile-dropdown{
      display:none;position:absolute;top:calc(100% + 10px);right:0;
      background:var(--bg-body,#13191f);
      border:1px solid var(--border-medium,rgba(255,255,255,0.1));
      border-radius:14px;min-width:210px;padding:8px;
      z-index:350;box-shadow:0 16px 40px rgba(0,0,0,.6);
      /* Smooth fade-out when closing — no more abrupt disappearance. */
      opacity:0;transform:translateY(-4px);
      transition:opacity .15s ease-out,transform .15s ease-out;
    }
    .profile-dropdown.open{display:block;opacity:1;transform:translateY(0);}
    .profile-dd-header{
      display:flex;align-items:center;gap:10px;
      padding:10px 10px 12px;
      border-bottom:1px solid rgba(255,255,255,0.07);margin-bottom:6px;
    }
    .profile-dd-header img{width:38px;height:38px;border-radius:50%;object-fit:cover;}
    .profile-dd-uname{font-size:0.82rem;font-weight:700;color:#fff;}
    .dd-sign-out{
      background:none;border:none;color:var(--text-muted,#888);
      display:flex;align-items:center;gap:4px;font-size:0.7rem;
      cursor:pointer;padding:4px 0;margin-top:3px;transition:color .15s;
    }
    .dd-sign-out:hover{color:#ef4444;}
    /* Sign-out button goes RED the instant the user clicks it, then
       fades back.  This gives immediate visual feedback while the
       async signOut() network call is in flight. */
    .dd-sign-out:active{color:#ef4444;transform:scale(.97);}
    .dd-sign-out.signing-out{color:#ef4444;pointer-events:none;opacity:.7;}
    .profile-dd-item{
      display:flex;align-items:center;gap:8px;padding:8px 10px;
      border-radius:8px;font-size:0.76rem;color:var(--text-secondary,#ccc);
      transition:background .15s,color .15s;
    }
    .profile-dd-item:hover{background:rgba(255,255,255,0.07);color:#fff;}

    /* ── HAMBURGER ── */
    .hamburger-btn{
      display:none;flex-direction:column;justify-content:center;
      align-items:center;gap:5px;width:38px;height:38px;
      border:none;background:none;cursor:pointer;flex-shrink:0;padding:0;
    }
    .hamburger-btn span{
      display:block;width:22px;height:2px;background:#fff;
      border-radius:2px;transition:transform .3s,opacity .3s;
    }
    .hamburger-btn.open span:nth-child(1){transform:translateY(7px) rotate(45deg);}
    .hamburger-btn.open span:nth-child(2){opacity:0;}
    .hamburger-btn.open span:nth-child(3){transform:translateY(-7px) rotate(-45deg);}

    /* ── MOBILE NAV PANEL ── */
    .mobile-nav-overlay{
      display:none;position:fixed;inset:0;
      background:rgba(0,0,0,.6);z-index:400;
    }
    .mobile-nav-overlay.open{display:block;}
    .mobile-nav-panel{
      position:fixed;top:0;left:0;bottom:0;
      width:min(300px,80vw);
      background:var(--bg-header,#0d1117);
      border-right:1px solid var(--border-subtle,rgba(255,255,255,0.08));
      z-index:401;padding:16px;overflow-y:auto;
      transform:translateX(-100%);transition:transform .3s cubic-bezier(.4,0,.2,1);
      scrollbar-width:none;
    }
    .mobile-nav-panel::-webkit-scrollbar{display:none;}
    .mobile-nav-panel.open{transform:translateX(0);}
    .mob-nav-close-row{display:flex;justify-content:flex-end;margin-bottom:14px;}
    .mob-nav-close-btn{
      width:30px;height:30px;border-radius:50%;border:none;
      background:rgba(255,255,255,0.06);color:#fff;
      display:flex;align-items:center;justify-content:center;
    }
    .mob-forum-item{
  display:flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  padding:12px 14px;
  margin-bottom:12px;
  border-radius:14px;
  border:1px solid rgba(255,255,255,0.18);
  background:rgba(255,255,255,0.08);
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
  font-size:0.84rem;
  font-weight:600;
  color:#fff;
  transition:background .18s, border-color .18s;
  text-align:center;
}
.mob-forum-item:hover{
  background:rgba(255,255,255,0.15);
  border-color:rgba(255,255,255,0.3);
}   
    .mob-nav-item{
      display:block;padding:9px 10px;font-size:0.82rem;
      color:var(--text-secondary,#ccc);border-radius:8px;
      transition:background .15s,color .15s;
    }
    .mob-nav-item:hover{background:rgba(255,255,255,0.07);color:#fff;}
    /* Mobile sub-triggers (click to open) */
    .mob-sub-trigger{
      display:flex;align-items:center;justify-content:space-between;
      padding:9px 10px;font-size:0.82rem;color:var(--text-secondary,#ccc);
      border-radius:8px;cursor:pointer;
      transition:background .15s,color .15s;user-select:none;
    }
    .mob-sub-trigger:hover{background:rgba(255,255,255,0.07);color:#fff;}
    .mob-sub-arr{transition:transform .25s;font-size:.7rem;flex-shrink:0;}
    .mob-sub-trigger.open .mob-sub-arr{transform:rotate(90deg);}
    .mob-sub-menu{
      display:none;padding:4px 0 4px 10px;
      grid-template-columns:1fr 1fr;gap:1px;
    }
    .mob-sub-menu.show{display:grid;}
    .mob-sub-menu.single{grid-template-columns:1fr;}
    .mob-sub-menu a{
      display:block;padding:6px 8px;font-size:0.74rem;
      color:var(--text-muted,#888);border-radius:6px;
      transition:background .15s,color .15s;
    }
    .mob-sub-menu a:hover{background:rgba(255,255,255,0.07);color:#fff;}

    /* ── MOBILE RIGHT CONTROLS ── */
    .mobile-right{display:none;align-items:center;gap:4px;margin-left:auto;}
    .mob-icon-btn{
      width:36px;height:36px;border-radius:50%;border:none;
      background:none;color:var(--text-secondary,#ccc);
      display:flex;align-items:center;justify-content:center;
      position:relative;cursor:pointer;flex-shrink:0;
    }
    .mob-icon-btn:hover{background:rgba(255,255,255,0.08);color:#fff;}

    /* ── MOBILE SEARCH PANEL ── */
    .mob-search-panel{
      display:none;position:fixed;
      top:64px;left:0;right:0;
      background:var(--bg-body,#13191f);
      border-bottom:1px solid var(--border-medium,rgba(255,255,255,0.1));
      padding:12px 16px;z-index:300;
      box-shadow:0 10px 30px rgba(0,0,0,.5);
    }
    .mob-search-panel.open{display:block;}
    .mob-search-bar{
      display:flex;align-items:center;
      background:var(--bg-surface,rgba(255,255,255,0.06));
      border-radius:50px;overflow:hidden;margin-bottom:8px;
    }
    .mob-search-bar .search-toggle-tabs{padding:3px;}
    .mob-search-input{
      flex:1;padding:8px 12px 8px 2px;background:transparent;
      border:none;outline:none;color:#fff;font-size:0.78rem;
    }
    .mob-suggestions{
      max-height:320px;overflow-y:auto;overflow-x:hidden;
      scrollbar-width:none;
    }
    .mob-suggestions::-webkit-scrollbar{display:none;}

    /* ── AUTH MODAL ── */
    .auth-overlay{
      display:none;position:fixed;inset:0;
      background:rgba(0,0,0,.78);z-index:600;
      align-items:center;justify-content:center;padding:16px;
      /* Prevent scroll-chaining: when the user scrolls inside the
         modal and hits the edge, the scroll event should NOT bubble
         up to the body / page behind the modal. */
      overscroll-behavior:contain;
    }
    .auth-overlay.open{display:flex;}
    /* When any auth modal is open, lock the body so the page behind
       cannot scroll.  JS toggles this class on <body> in openModal /
       closeModal.  This is what makes "the scrolling should not
       affect the background/page content" actually true. */
    body.aniumi-modal-open{
      overflow:hidden;
      /* On iOS Safari, overflow:hidden alone does NOT prevent
         background scroll — position:fixed + a remembered scroll
         offset does.  JS handles the offset save/restore. */
      position:fixed;
      left:0;right:0;top:0;bottom:0;
    }
    .auth-modal{
      background:var(--bg-body,#13191f);
      border:1px solid var(--border-medium,rgba(255,255,255,0.1));
      border-radius:18px;
      width:100%;max-width:840px;
      max-height:94vh;overflow:hidden;
      display:flex;position:relative;
      box-shadow:0 40px 100px rgba(0,0,0,.85);
    }
    /* LEFT IMAGE – DESKTOP ONLY (mobile uses carousel instead) */
    .auth-img-col{
      flex:0 0 400px;
      position:relative;overflow:hidden;
    }
    .auth-img-col img{
      width:100%;height:100%;object-fit:cover;display:block;
    }
    /* Form column — sticky image stays put, only this column scrolls */
    .auth-form-col{
      flex:1;overflow-y:auto;padding:32px 28px;
      display:flex;flex-direction:column;justify-content:flex-start;min-width:0;
      position:relative;
      /* CRITICAL: without min-height:0 a flex child with overflow:auto
         expands to its content's natural height instead of staying
         inside the parent's max-height, which makes the bottom of the
         form (hCaptcha, terms, submit button, switch link) get clipped
         by the modal's overflow:hidden — and unscrollable.  */
      min-height:0;
      scrollbar-width:none;             /* Firefox: hide scrollbar */
      -ms-overflow-style:none;
      /* Smooth scrolling: programmatic scrollIntoView animates nicely. */
      scroll-behavior:smooth;
      /* iOS < 13 Safari needs this for momentum touch scrolling.  No-op
         on modern browsers but harmless. */
      -webkit-overflow-scrolling:touch;
      /* When the form column is scrolled to its top/bottom limit, do
         NOT chain the scroll to the body / page behind the modal. */
      overscroll-behavior:contain;
      /* Decouple the form column's scroll from the page — wheel events
         inside this element should not bubble to the document. */
      touch-action:pan-y;
    }
    .auth-form-col::-webkit-scrollbar{display:none;}  /* WebKit: hide scrollbar */
    /* Vertically center the slides ONLY when content fits.
       When it overflows, flex-start keeps the top visible & scrollable. */
    .form-slides-wrapper{margin-top:auto;margin-bottom:auto;}
    .auth-close-btn{
      position:absolute;top:12px;right:12px;
      width:30px;height:30px;border-radius:50%;
      border:none;background:rgba(255,255,255,0.08);
      color:#fff;display:flex;align-items:center;
      justify-content:center;z-index:50;transition:background .18s;
    }
    .auth-close-btn:hover{background:rgba(255,255,255,0.15);}

    /* Slides — each slide CLIPS its own content so the inactive slide's
       hCaptcha widget cannot bleed into the visible slide. */
    .form-slides-wrapper{overflow:hidden;position:relative;width:100%;}
    .form-slides{display:flex;transition:transform .42s cubic-bezier(.4,0,.2,1);width:300%;}
    .form-slide{flex:0 0 33.333%;min-width:0;overflow:hidden;}
    .form-slide:not(.active){pointer-events:none;}

    /* hCaptcha responsive scaling — smaller on mobile, normal on desktop */
    .cf-wrap{display:flex;justify-content:center;min-height:0;align-items:center;}
    .cf-wrap iframe{max-width:100%;transform-origin:center center;border:0;}

    /* Password + Confirm password side-by-side (saves vertical space) */
    .pwd-pair{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start;}
    .pwd-pair .field-group{margin-bottom:0;}
    .pwd-pair .field-group label{font-size:0.62rem;}
    .pwd-pair .pwd-bar{margin-top:4px;}
    .pwd-pair .pwd-label{font-size:0.6rem;}
    .pwd-pair .field-err{font-size:0.6rem;}
    @media(max-width:480px){
      .pwd-pair{gap:8px;}
      .pwd-pair .field-input{padding:9px 10px;font-size:0.76rem;}
      .pwd-pair .field-input{padding-right:30px !important;}
      .pwd-pair .eye-btn{right:6px;}
    }

    /* "← Back to Sign In" link — top of sign-up form, always visible */
    .auth-back-link{
      display:inline-flex;align-items:center;gap:4px;
      font-size:0.7rem;color:var(--text-muted,#888);
      background:none;border:none;cursor:pointer;padding:4px 0;
      margin-bottom:10px;font-family:inherit;transition:color .18s;
    }
    .auth-back-link:hover{color:var(--btn-primary,#3b82f6);}

    /* "Forgot password?" inline link — sits below the password field, right-aligned */
    .forgot-inline{
      display:block;width:100%;text-align:right;
      font-size:0.68rem;color:var(--btn-primary,#3b82f6);
      background:none;border:none;cursor:pointer;padding:2px 0 0;
      font-family:inherit;margin-top:5px;line-height:1;
      transition:opacity .18s;
    }
    .forgot-inline:hover{opacity:.72;}

    /* ─── MOBILE CAROUSEL (hidden on desktop) ─── */
    .auth-mobile-carousel{
      display:none;position:relative;width:100%;
      aspect-ratio:16/9;overflow:hidden;background:#000;flex-shrink:0;
      transition:aspect-ratio .3s ease;
    }
    /* Sign-in has less content → taller carousel looks balanced */
    /* Sign-in & forgot: taller image — less form content below */
    .auth-mobile-carousel.carousel-signin{ aspect-ratio:16/6.5; }
    /* Sign-up: short — avatar + 4 fields need the space */
    .auth-mobile-carousel.carousel-signup{ aspect-ratio:16/4; }
    /* Forgot: tallest — only 1 field */
    .auth-mobile-carousel.carousel-forgot{ aspect-ratio:16/7; }
    .auth-mobile-carousel .mc-slide{
      position:absolute;inset:0;background-size:cover;background-position:center;
      opacity:0;transform:scale(1.06);
      transition:opacity 1.6s cubic-bezier(.4,0,.2,1),transform 6s ease-out;
      will-change:opacity,transform;
    }
    .auth-mobile-carousel .mc-slide.active{opacity:1;transform:scale(1);}
    /* Gradient merges image bottom into the form below — no visual seam */
    .auth-mobile-carousel::after{
      content:'';position:absolute;left:0;right:0;bottom:0;height:55%;
      background:linear-gradient(to bottom,transparent 0%,var(--bg-body,#13191f) 95%);
      pointer-events:none;z-index:2;
    }

    /* === MOBILE: single column with carousel on top === */
    @media(max-width:680px){
      /* Center the modal vertically with breathing room on all sides
         so it no longer "covers the full display". */
      .auth-overlay{padding:12px;align-items:center;justify-content:center;}
      .auth-modal{
        flex-direction:column;
        max-width:94vw;             /* was 100% — leaves 3vw margin each side */
        max-height:90vh;            /* was 96vh — leaves breathing room top/bottom */
        width:100%;border-radius:16px;
      }
      .auth-img-col{display:none;}
      .auth-mobile-carousel{
        display:block;flex-shrink:0;
        /* Carousel slightly taller than 16/5 (was too thin) but still
           well below the original 16/9.  16/6 ≈ 38vw tall — enough to
           show the anime character's face clearly without consuming
           the vertical space the form fields need. */
        border-top-left-radius:16px;border-top-right-radius:16px;
      }
      .auth-mobile-carousel.carousel-signin{ aspect-ratio:16/7.5; }
      .auth-mobile-carousel.carousel-signup{ aspect-ratio:16/3.5; }
      .auth-mobile-carousel.carousel-forgot{ aspect-ratio:16/6; }
      .auth-form-col{
        padding:10px 16px 12px;flex:1;
        border-radius:0 0 16px 16px;
        /* Mobile scroll fix: allow shrinking below content height so
           overflow-y:auto actually engages. */
        min-height:0;
        overflow-y:auto;
        justify-content:flex-start;
        /* Smooth + contained scroll on mobile too (mirrors desktop rules). */
        scroll-behavior:smooth;
        -webkit-overflow-scrolling:touch;
        overscroll-behavior:contain;
        touch-action:pan-y;
      }
      /* On mobile, keep the slides at the top so users see the first
         field immediately rather than the middle of the form. */
      .form-slides-wrapper{margin-top:0;margin-bottom:0;}
      .auth-close-btn{top:6px;right:6px;width:26px;height:26px;background:rgba(0,0,0,.55);}

      /* ── COMPACT ELEMENT SPACING (mobile) ──
         Goal: every element of the SIGN IN slide fits on one screen
         (heading + 2 fields + forgot link + hCaptcha + Sign In button +
         divider + Google button + "No account? Sign up" link).
         For SIGN UP (which has 4 fields + avatar + captcha + terms),
         the form is still scrollable as a fallback on very small phones. */
      .auth-heading{font-size:1.05rem;margin-bottom:2px;}
      .auth-subheading{font-size:0.7rem;margin-bottom:10px;}
      .field-group{margin-bottom:8px;}
      .field-group label{font-size:0.62rem;margin-bottom:3px;}
      .field-input{padding:8px 12px;font-size:0.78rem;border-radius:8px;}
      .eye-btn{right:8px;}
      .field-err{font-size:0.62rem;margin-top:2px;}
      .form-err{font-size:0.66rem;margin-bottom:4px;min-height:14px;}
      .forgot-btn{font-size:0.66rem;margin-top:2px;margin-bottom:8px;}
      .forgot-inline{font-size:0.66rem;margin-top:4px;margin-bottom:6px;}
      .terms-row{font-size:0.65rem;margin-bottom:8px;gap:6px;}
      .terms-row input[type=checkbox]{width:13px;height:13px;margin-top:1px;}

      /* Buttons — slightly shorter to save vertical pixels. */
      .btn-primary-full{padding:9px;font-size:0.78rem;border-radius:40px;}
      .btn-google{padding:8px;font-size:0.73rem;margin-bottom:8px;border-radius:40px;gap:7px;}
      .divider{margin:8px 0;font-size:0.66rem;gap:8px;}
      .auth-switch{margin-top:10px;font-size:0.68rem;}
      .auth-switch-btn{font-size:0.68rem;}

      /* Avatar picker — pre-set with Frieren, click to change.
         Made slightly bigger (60→72) so the Frieren avatar is clearly
         visible as the default profile picture. */
      .avatar-pick-wrap{margin-bottom:2px;}
      .avatar-frame{width:56px;height:56px;}
      .avatar-frame::after{width:20px;height:20px;font-size:11px;}
      .avatar-pick-lbl{font-size:0.62rem;margin-top:5px;}

      /* Compact hCaptcha on mobile — minimum viable size. */
      .cf-wrap{min-height:0;margin:2px 0 3px;}
      .cf-wrap iframe{transform:scale(.72);}

      /* Password strength bar — tighter. */
      .pwd-bar{height:2px;margin-top:3px;}
      .pwd-label{font-size:0.58rem;margin-top:1px;}
    }

    /* ── EVEN SMALLER PHONES (≤ 480px) — super-compact ── */
    @media(max-width:480px){
      .auth-overlay{padding:8px;}
      .auth-modal{max-width:96vw;max-height:92vh;}
      .auth-mobile-carousel.carousel-signin{ aspect-ratio:16/4.8; }
      .auth-mobile-carousel.carousel-signup{ aspect-ratio:16/3; }
      .auth-mobile-carousel.carousel-forgot{ aspect-ratio:16/5.2; }
      .auth-form-col{padding:8px 12px 10px;}
      .auth-heading{font-size:0.98rem;}
      .auth-subheading{font-size:0.66rem;margin-bottom:8px;}
      .field-group{margin-bottom:6px;}
      .field-input{padding:7px 10px;font-size:0.74rem;}
      .forgot-btn{font-size:0.62rem;margin-bottom:6px;}
      .forgot-inline{font-size:0.62rem;margin-top:3px;margin-bottom:5px;}
      .btn-primary-full{padding:8px;font-size:0.74rem;}
      .btn-google{padding:7px;font-size:0.7rem;margin-bottom:6px;}
      .divider{margin:6px 0;font-size:0.62rem;}
      .auth-switch{margin-top:8px;font-size:0.64rem;}
      .avatar-frame{width:50px;height:50px;}
      .avatar-pick-wrap{margin-bottom:2px;}
      .cf-wrap{min-height:0;margin:1px 0 3px;}
      .cf-wrap iframe{transform:scale(.66);}
      .terms-row{font-size:0.62rem;margin-bottom:6px;}
      /* Username + Email row — tighten gap on small phones. */
      .field-row-2{gap:8px;margin-bottom:8px;}
    }

    /* ── TINY PHONES (≤ 380px) — minimal ── */
    @media(max-width:380px){
      .auth-modal{max-width:98vw;max-height:94vh;}
      .auth-mobile-carousel.carousel-signin{ aspect-ratio:16/4.2; }
      .auth-mobile-carousel.carousel-signup{ aspect-ratio:16/2.5; }
      .auth-mobile-carousel.carousel-forgot{ aspect-ratio:16/4.5; }
      .auth-form-col{padding:6px 10px 8px;}
      .auth-heading{font-size:0.92rem;}
      .auth-subheading{font-size:0.62rem;margin-bottom:6px;}
      .field-group{margin-bottom:5px;}
      .field-input{padding:6px 9px;font-size:0.7rem;}
      .btn-primary-full{padding:7px;font-size:0.7rem;}
      .btn-google{padding:6px;font-size:0.66rem;margin-bottom:5px;}
      .cf-wrap{min-height:0;}
      .cf-wrap iframe{transform:scale(.6);}
      .auth-switch{margin-top:6px;}
      .avatar-frame{width:46px;height:46px;}
      .avatar-frame::after{width:18px;height:18px;font-size:10px;}
    }

    /* Fields */
    .auth-heading{font-size:1.25rem;font-weight:800;color:#fff;margin-bottom:4px;}
    .auth-subheading{font-size:0.76rem;color:var(--text-muted,#888);margin-bottom:10px;}
    .auth-subheading span{color:var(--btn-primary,#3b82f6);font-weight:600;}
    .field-group{margin-bottom:12px;}
    .field-group label{
      display:block;font-size:0.68rem;font-weight:700;
      color:var(--text-muted,#888);margin-bottom:4px;
      letter-spacing:.05em;text-transform:uppercase;
    }
    .field-wrap{position:relative;}
    .field-input{
      width:100%;padding:10px 14px;
      background:var(--bg-surface,rgba(255,255,255,0.05));
      border:1px solid var(--border-medium,rgba(255,255,255,0.1));
      border-radius:10px;color:#fff;font-size:0.82rem;
      outline:none;transition:border-color .2s,box-shadow .2s;
      font-family:inherit;
    }
    .field-input:focus{
      border-color:var(--btn-primary,#3b82f6);
      box-shadow:0 0 0 3px rgba(59,130,246,.15);
    }
    .eye-btn{
      position:absolute;right:10px;top:50%;transform:translateY(-50%);
      background:none;border:none;color:var(--text-muted,#888);
      display:flex;align-items:center;cursor:pointer;padding:2px;
    }
    .field-err{font-size:0.67rem;color:#ef4444;margin-top:3px;}
    .form-err{
      font-size:0.72rem;color:#ef4444;text-align:center;
      margin-bottom:8px;min-height:18px;
    }

    /* Avatar frame */
    .avatar-pick-wrap{display:flex;flex-direction:column;align-items:center;margin-bottom:6px;}
    /* Two-column field row (username + email side-by-side on Sign Up) */
    .field-row-2{
      display:grid;grid-template-columns:1fr 1fr;gap:10px;
      margin-bottom:12px;
    }
    .field-row-2 .field-group{margin-bottom:0;}  /* the row handles spacing */
    .avatar-frame{
      width:84px;height:84px;border-radius:50%;
      border:2px solid var(--btn-primary,#3b82f6);
      display:flex;align-items:center;justify-content:center;
      cursor:pointer;overflow:hidden;position:relative;
      background:var(--bg-surface,rgba(255,255,255,0.05));
      transition:border-color .2s,transform .15s,box-shadow .2s;flex-shrink:0;
      box-shadow:0 4px 14px rgba(59,130,246,.25);
    }
    .avatar-frame:hover{transform:scale(1.04);box-shadow:0 6px 20px rgba(59,130,246,.4);}
    .avatar-frame:active{transform:scale(.98);}
    .avatar-frame img{width:100%;height:100%;object-fit:cover;border-radius:50%;}
    /* Tiny "edit" badge in the corner so the user knows the pre-set
       Frieren avatar is clickable to change. */
    .avatar-frame::after{
      content:'✎';position:absolute;right:-2px;bottom:-2px;
      width:24px;height:24px;border-radius:50%;
      background:var(--btn-primary,#3b82f6);color:#fff;
      font-size:12px;display:flex;align-items:center;justify-content:center;
      border:2px solid var(--bg-body,#13191f);pointer-events:none;
    }
    .avatar-pick-lbl{font-size:0.62rem;color:var(--text-muted,#888);margin-top:3px;text-align:center;}

    /* Avatar popup */
    .avatar-popup-overlay{
      display:none;position:fixed;inset:0;
      background:rgba(0,0,0,.72);z-index:700;
      align-items:center;justify-content:center;padding:16px;
    }
    .avatar-popup-overlay.open{display:flex;}
    .avatar-popup{
      background:var(--bg-body,#13191f);
      border:1px solid var(--border-medium,rgba(255,255,255,0.12));
      border-radius:16px;padding:16px;
      width:min(320px,90vw);max-height:400px;
      overflow-y:auto;position:relative;scrollbar-width:none;
    }
    .avatar-popup::-webkit-scrollbar{display:none;}
    .avatar-popup-hdr{
      display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;
    }
    .avatar-popup-title{font-size:0.82rem;font-weight:700;color:#fff;}
    .avatar-upload-btn{
      display:flex;align-items:center;gap:4px;
      padding:5px 10px;border-radius:8px;font-size:0.7rem;font-weight:600;
      border:1px solid var(--btn-primary,#3b82f6);
      color:var(--btn-primary,#3b82f6);background:transparent;
      cursor:pointer;transition:background .18s,color .18s;
    }
    .avatar-upload-btn:hover{background:var(--btn-primary,#3b82f6);color:#fff;}
    .avatar-action-btn{transition:all .18s;}
    .avatar-action-btn:hover{filter:brightness(1.15);transform:scale(1.02);}
    .avatar-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}
    .avatar-opt{
      width:64px;height:64px;border-radius:50%;overflow:hidden;
      cursor:pointer;border:2px solid transparent;
      transition:border-color .18s,transform .18s;
    }
    .avatar-opt:hover{border-color:var(--btn-primary,#3b82f6);transform:scale(1.08);}
    .avatar-opt.selected{border-color:#10b981;}
    .avatar-opt img{width:100%;height:100%;object-fit:cover;}

    /* Cloudflare Turnstile wrapper */
    .cf-wrap{margin-bottom:4px;display:flex;justify-content:center;}

    /* Forgot password link */
    .forgot-btn{
      display:block;text-align:right;font-size:0.7rem;
      color:var(--btn-primary,#3b82f6);cursor:pointer;
      margin-top:3px;margin-bottom:12px;
      background:none;border:none;font-family:inherit;
      transition:opacity .18s;
    }
    .forgot-btn:hover{opacity:.75;}

    /* Terms row */
    .terms-row{
      display:flex;align-items:flex-start;gap:8px;
      margin-bottom:14px;font-size:0.71rem;color:var(--text-muted,#888);
    }
    .terms-row input[type=checkbox]{
      width:15px;height:15px;flex-shrink:0;margin-top:2px;
      accent-color:var(--btn-primary,#3b82f6);cursor:pointer;
    }
    .terms-row a{color:var(--btn-primary,#3b82f6);text-decoration:underline;}

    /* Buttons */
    .btn-primary-full{
      width:100%;padding:11px;border-radius:50px;
      background:var(--btn-primary,#3b82f6);color:#fff;
      font-weight:700;font-size:0.82rem;border:none;
      transition:opacity .2s,transform .1s;letter-spacing:.03em;
    }
    .btn-primary-full:hover{opacity:.88;}
    .btn-primary-full:active{transform:scale(.98);}
    .btn-primary-full:disabled{opacity:.5;cursor:not-allowed;}
    .btn-google{
      width:100%;padding:10px;border-radius:50px;
      background:var(--bg-surface,rgba(255,255,255,0.06));
      border:1px solid var(--border-medium,rgba(255,255,255,0.1));
      color:#fff;font-weight:600;font-size:0.78rem;
      display:flex;align-items:center;justify-content:center;gap:9px;
      margin-bottom:12px;transition:background .18s;
    }
    .btn-google:hover{background:rgba(255,255,255,0.1);}
    .divider{
      display:flex;align-items:center;gap:10px;
      margin:12px 0;color:var(--text-muted,#666);font-size:0.72rem;
    }
    .divider::before,.divider::after{
      content:'';flex:1;height:1px;background:rgba(255,255,255,0.09);
    }
    .auth-switch{text-align:center;font-size:0.73rem;color:var(--text-muted,#888);margin-top:16px;}
    .auth-switch-btn{
      background:none;border:none;color:var(--btn-primary,#3b82f6);
      font-weight:600;cursor:pointer;font-size:0.73rem;font-family:inherit;padding:0;
    }
    .auth-switch-btn:hover{text-decoration:underline;}

    /* Password strength */
    .pwd-bar{height:3px;border-radius:3px;margin-top:4px;background:rgba(255,255,255,0.08);overflow:hidden;}
    .pwd-fill{height:100%;border-radius:3px;transition:width .3s,background .3s;width:0;}
    .pwd-label{font-size:0.63rem;margin-top:2px;}

    /* Reset success */
    .reset-success{
      text-align:center;padding:16px 8px;
      color:var(--text-secondary,#ccc);font-size:0.8rem;line-height:1.6;
    }
    .reset-success .big{font-size:1.6rem;display:block;margin-bottom:8px;}

    /* ── RESPONSIVE BREAKPOINTS ── */
    @media(max-width:900px){
  .main-nav,.header-search-wrap,.header-socials,.btn-login,#desktopAvatarWrap{display:none!important;}
  .hamburger-btn{display:flex!important;}
  .mobile-right{display:flex!important;}
}
    
    @media(min-width:901px){
      .hamburger-btn,.mobile-right{display:none!important;}
    }
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ═══════════════════════════════════════════════════════════
     HELPERS
  ═══════════════════════════════════════════════════════════ */
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  /* ═══════════════════════════════════════════════════════════
     BUILD NAV LINKS
  ═══════════════════════════════════════════════════════════ */
  const GENRES = [
    ['Action','action'],['Adventure','adventure'],['Animation','animation'],['Apocalyptic','apocalyptic'],
    ['Avant Garde','avant-garde'],['Biography','biography'],['Boys Love','boys-love'],['Comedy','comedy'],
    ['Cult','cult'],['Demons','demons'],['Documentary','documentary'],['Drama','drama'],
    ['Ecchi','ecchi'],['Family','family'],['Fantasy','fantasy'],['Film-Noir','film-noir'],
    ['Girls Love','girls-love'],['Gourmet','gourmet'],['Harem','harem'],['Horror','horror'],
    ['Isekai','isekai'],['Iyashikei','iyashikei'],['Josei','josei'],['Kids','kids'],
    ['Kodomomuke','kodomomuke'],['Magic','magic'],['Mahou Shoujo','mahou-shoujo'],['Martial Arts','martial-arts'],
    ['Mecha','mecha'],['Military','military'],['Music','music'],['Music &amp; Musical','music-musical'],
    ['Mystery','mystery'],['Parody','parody'],['Psychological','psychological'],['Reverse Harem','reverse-harem'],
    ['Rom-Com','rom-com'],['Romance','romance'],['School','school'],['Sci-Fi','sci-fi'],
    ['Seinen','seinen'],['Shoujo','shoujo'],['Shounen','shounen'],['Slice of Life','slice-of-life'],
    ['Space','space'],['Sports','sports'],['Super Power','super-power'],['Supernatural','supernatural'],
    ['Suspense','suspense'],['Thriller','thriller'],['Vampire','vampire']
  ];
  const COUNTRIES = [
    ['Argentina','argentina'],['Australia','australia'],['Austria','austria'],['Belgium','belgium'],
    ['Brazil','brazil'],['Canada','canada'],['China','china'],['Colombia','colombia'],
    ['Czech Republic','czech-republic'],['Denmark','denmark'],['Finland','finland'],['France','france'],
    ['Germany','germany'],['Hong Kong','hong-kong'],['Hungary','hungary'],['India','india'],
    ['Ireland','ireland'],['Israel','israel'],['Italy','italy'],['Japan','japan'],
    ['Luxembourg','luxembourg'],['Mexico','mexico'],['Netherlands','netherlands'],['New Zealand','new-zealand'],
    ['Nigeria','nigeria'],['Norway','norway'],['Philippines','philippines'],['Poland','poland'],
    ['Romania','romania'],['Russia','russia'],['South Africa','south-africa'],['South Korea','south-korea'],
    ['Spain','spain'],['Sweden','sweden'],['Switzerland','switzerland'],['Taiwan','taiwan'],
    ['Thailand','thailand'],['Turkey','turkey'],['United Kingdom','united-kingdom'],['United States','united-states']
  ];
  const genreLinks    = GENRES.map(([n,s])=>`<a href="/genre/${s}">${n}</a>`).join('');
  const countryLinks  = COUNTRIES.map(([n,s])=>`<a href="/country/${s}">${n}</a>`).join('');
  const genreMob      = GENRES.map(([n,s])=>`<a href="/genre/${s}">${n}</a>`).join('');
  const countryMob    = COUNTRIES.map(([n,s])=>`<a href="/country/${s}">${n}</a>`).join('');

  /* ═══════════════════════════════════════════════════════════
     HEADER HTML
  ═══════════════════════════════════════════════════════════ */
  const HEADER = `
<header class="site-header" id="siteHeader">
  <!-- Hamburger (mobile only) -->
  <button class="hamburger-btn" id="hamburgerBtn" aria-label="Menu">
    <span></span><span></span><span></span>
  </button>

  <!-- Logo -->
  <a href="/" class="header-logo">
    <img src="https://i.postimg.cc/X7d0fPtJ/1778142012237-removebg-preview.png" alt="AniOcean">
  </a>

  <!-- Desktop Nav -->
  <nav class="main-nav" id="mainNav">
    <a href="/" class="nav-link-item">Home</a>

    <div class="nav-dd-wrap">
      <span class="nav-dd-label">Genre ▾</span>
      <div class="nav-dropdown grid-4">${genreLinks}</div>
    </div>

    <div class="nav-dd-wrap">
      <span class="nav-dd-label">Country ▾</span>
      <div class="nav-dropdown grid-4">${countryLinks}</div>
    </div>

    <div class="nav-dd-wrap">
      <span class="nav-dd-label">Type ▾</span>
      <div class="nav-dropdown grid-1">
        <a href="/type/anime">Anime</a>
        <a href="/type/drama">Drama</a>
        <a href="/type/movie">Movie</a>
        <a href="/type/tv-show">TV Show</a>
      </div>
    </div>

    <a href="/status/ongoing" class="nav-link-item">Ongoing</a>
    <a href="/search?q=updates" class="nav-link-item">Updates</a>
    <a href="#" class="nav-link-item">News</a>
    <a href="#" class="nav-link-item">Forum</a>
  </nav>

  <!-- Desktop Search -->
  <div class="header-search-wrap" id="desktopSearchWrap">
    <div class="header-search-bar">
      <div class="search-toggle-tabs" id="desktopTabs">
        <span class="search-toggle-tab active" data-mode="non-anime">Non-Anime</span>
        <span class="search-toggle-tab" data-mode="anime">Anime</span>
      </div>
      <input type="text" class="search-input-field" id="searchInput" placeholder="Search shows…" autocomplete="off">
    </div>
    <div class="search-suggestions" id="searchSuggestions"></div>
  </div>

  <!-- Desktop Socials -->
  <div class="header-socials">
    <a href="https://discord.com" target="_blank" class="social-icon-btn" title="Discord">${SVG.discord}</a>
    <a href="https://tumblr.com" target="_blank" class="social-icon-btn" title="Tumblr">${SVG.tumblr}</a>
    <a href="https://bsky.app" target="_blank" class="social-icon-btn" title="Bluesky">${SVG.bluesky}</a>
  </div>

  <!-- Desktop Login / Avatar (RIGHT EDGE) -->
  <button class="btn-login" id="btnLogin">Sign In</button>
  <div class="user-avatar-wrap" id="desktopAvatarWrap">
    <img class="user-avatar" id="desktopAvatar" src="${DEFAULT_AVATAR}" alt="Profile">
    <div class="profile-dropdown" id="desktopDropdown">
      <div class="profile-dd-header">
        <img id="ddAvatarImg" src="${DEFAULT_AVATAR}" alt="">
        <div>
          <div class="profile-dd-uname" id="ddUsername">—</div>
          <button class="dd-sign-out" id="btnLogoutDesktop">${SVG.logout} Sign out</button>
        </div>
      </div>
      <a href="" class="profile-dd-item">${SVG.profile}&nbsp;Profile</a>
      <a href="" class="profile-dd-item">${SVG.film}&nbsp;Continue Watching</a>
      <a href="" class="profile-dd-item">${SVG.list}&nbsp;Watchlist</a>
      <a href="" class="profile-dd-item">${SVG.bar}&nbsp;Stats</a>
      <a href="" class="profile-dd-item">${SVG.settings}&nbsp;Settings</a>
    </div>
  </div>

  <!-- Mobile right controls -->
  <div class="mobile-right" id="mobileRight">
    <a href="https://discord.com" target="_blank" class="mob-icon-btn">${SVG.discord}</a>
    <a href="https://tumblr.com" target="_blank" class="mob-icon-btn">${SVG.tumblr}</a>
    <a href="https://bsky.app" target="_blank" class="mob-icon-btn">${SVG.bluesky}</a>
    <button class="mob-icon-btn" id="mobSearchBtn" aria-label="Search">${SVG.search}</button>
    <!-- Mobile profile / avatar -->
    <button class="mob-icon-btn" id="mobProfileBtn" aria-label="Profile">${SVG.user}</button>
    <div class="user-avatar-wrap" id="mobAvatarWrap" style="display:none;">
      <img class="user-avatar" id="mobAvatar" src="${DEFAULT_AVATAR}" alt="Profile" style="display:block;">
      <div class="profile-dropdown" id="mobDropdown">
        <div class="profile-dd-header">
          <img id="mobDdAvatarImg" src="${DEFAULT_AVATAR}" alt="">
          <div>
            <div class="profile-dd-uname" id="mobDdUsername">—</div>
            <button class="dd-sign-out" id="btnLogoutMob">${SVG.logout} Sign out</button>
          </div>
        </div>
        <a href="" class="profile-dd-item">${SVG.profile}&nbsp;Profile</a>
        <a href="" class="profile-dd-item">${SVG.film}&nbsp;Continue Watching</a>
        <a href="" class="profile-dd-item">${SVG.list}&nbsp;Watchlist</a>
        <a href="" class="profile-dd-item">${SVG.bar}&nbsp;Stats</a>
        <a href="" class="profile-dd-item">${SVG.settings}&nbsp;Settings</a>
      </div>
    </div>
  </div>
</header>

<!-- Mobile search panel (drops below header) -->
<div class="mob-search-panel" id="mobSearchPanel">
  <div class="mob-search-bar">
    <div class="search-toggle-tabs" id="mobTabs">
      <span class="search-toggle-tab active" data-mode="non-anime">Non-Anime</span>
      <span class="search-toggle-tab" data-mode="anime">Anime</span>
    </div>
    <input type="text" class="mob-search-input" id="mobSearchInput" placeholder="Search…" autocomplete="off">
  </div>
  <div class="mob-suggestions" id="mobSuggestions"></div>
</div>

<!-- Mobile Nav Overlay -->
<div class="mobile-nav-overlay" id="mobNavOverlay">
  <div class="mobile-nav-panel" id="mobNavPanel">
    <div class="mob-nav-close-row">
      <button class="mob-nav-close-btn" id="mobNavClose">${SVG.close}</button>
    </div>
    <a href="#" class="mob-forum-item"><svg fill="currentColor" width="15px" height="15px" viewBox="0 0 128 128" id="Layer_1" version="1.1" xml:space="preserve" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <g> <path d="M64,42c-13.2,0-24,10.8-24,24s10.8,24,24,24s24-10.8,24-24S77.2,42,64,42z M64,82c-8.8,0-16-7.2-16-16s7.2-16,16-16 s16,7.2,16,16S72.8,82,64,82z"></path> <path d="M64,100.8c-14.9,0-29.2,6.2-39.4,17.1l-2.7,2.9l5.8,5.5l2.7-2.9c8.8-9.4,20.7-14.6,33.6-14.6s24.8,5.2,33.6,14.6l2.7,2.9 l5.8-5.5l-2.7-2.9C93.2,107.1,78.9,100.8,64,100.8z"></path> <path d="M97,47.9v8c9.4,0,18.1,3.8,24.6,10.7l5.8-5.5C119.6,52.7,108.5,47.9,97,47.9z"></path> <path d="M116.1,20c0-10.5-8.6-19.1-19.1-19.1S77.9,9.5,77.9,20S86.5,39.1,97,39.1S116.1,30.5,116.1,20z M85.9,20 c0-6.1,5-11.1,11.1-11.1s11.1,5,11.1,11.1s-5,11.1-11.1,11.1S85.9,26.1,85.9,20z"></path> <path d="M31,47.9c-11.5,0-22.6,4.8-30.4,13.2l5.8,5.5c6.4-6.9,15.2-10.7,24.6-10.7V47.9z"></path> <path d="M50.1,20C50.1,9.5,41.5,0.9,31,0.9S11.9,9.5,11.9,20S20.5,39.1,31,39.1S50.1,30.5,50.1,20z M31,31.1 c-6.1,0-11.1-5-11.1-11.1S24.9,8.9,31,8.9s11.1,5,11.1,11.1S37.1,31.1,31,31.1z"></path> </g> </g></svg> Community</a>
    <a href="/" class="mob-nav-item">Home</a>

    <div class="mob-sub-trigger" data-target="mobGenreMenu">Genre <span class="mob-sub-arr">▶</span></div>
    <div class="mob-sub-menu" id="mobGenreMenu">${genreMob}</div>

    <div class="mob-sub-trigger" data-target="mobCountryMenu">Country <span class="mob-sub-arr">▶</span></div>
    <div class="mob-sub-menu" id="mobCountryMenu">${countryMob}</div>

    <div class="mob-sub-trigger" data-target="mobTypeMenu">Type <span class="mob-sub-arr">▶</span></div>
    <div class="mob-sub-menu single" id="mobTypeMenu">
      <a href="/type/anime">Anime</a>
      <a href="/type/drama">Drama</a>
      <a href="/type/movie">Movie</a>
      <a href="/type/tv-show">TV Show</a>
    </div>

    <a href="/status/ongoing" class="mob-nav-item">Ongoing</a>
    <a href="/search?q=updates" class="mob-nav-item">Updates</a>
    <a href="#" class="mob-nav-item">News</a>
  </div>
</div>
`;

  /* ═══════════════════════════════════════════════════════════
     FOOTER HTML
  ═══════════════════════════════════════════════════════════ */
  const FOOTER = `
<footer style="background:var(--bg-header,#0d1117);padding:28px 20px;margin-top:50px;border-top:1px solid var(--border-subtle,rgba(255,255,255,0.07));display:flex;flex-wrap:wrap;gap:24px;justify-content:space-between;align-items:flex-start;">
  <div style="flex:1;min-width:260px;">
        <img src="https://i.postimg.cc/X7d0fPtJ/1778142012237-removebg-preview.png" alt="AniOcean" style="max-width:190px; height:auto; margin-bottom:8px;">
    <p style="font-size:0.82rem;color:var(--text-muted,#888);margin-bottom:12px;line-height:1.6;">Stream free anime, movies, and TV shows on AniOcean. Enjoy fast, high-quality streaming with multi-language subtitles and real-time updates.</p>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
      <span style="font-size:0.78rem;color:#fff;font-weight:600;">Follow us!</span>
      <a href="https://t.me" target="_blank" class="social-icon-btn"><svg fill="currentColor" viewBox="0 0 24 24" width="20" height="20"><path d="M19.2,4.4L2.9,10.7c-1.1,0.4-1.1,1.1-0.2,1.3l4.1,1.3l1.6,4.8c0.2,0.5,0.1,0.7,0.6,0.7c0.4,0,0.6-0.2,0.8-0.4c0.1-0.1,1-1,2-2l4.2,3.1c0.8,0.4,1.3,0.2,1.5-0.7l2.8-13.1C20.6,4.6,19.9,4,19.2,4.4z M17.1,7.4l-7.8,7.1L9,17.8L7.4,13l9.2-5.8C17,6.9,17.4,7.1,17.1,7.4z"/></svg></a>
      <a href="https://bsky.app" target="_blank" class="social-icon-btn"><svg viewBox="0 0 16 16" fill="currentColor" width="20" height="20"><path d="M3 1H0V5C0 6.65685 1.34315 8 3 8L2.03553 8.96447C1.37249 9.62751 1 10.5268 1 11.4645C1 13.4171 2.58291 15 4.53553 15C5.47322 15 6.37249 14.6275 7.03553 13.9645L8 13L8.96447 13.9645C9.62751 14.6275 10.5268 15 11.4645 15C13.4171 15 15 13.4171 15 11.4645C15 10.5268 14.6275 9.62751 13.9645 8.96447L13 8C14.6569 8 16 6.65685 16 5V1H13L8 6L3 1Z"/></svg></a>
      <a href="https://discord.com" target="_blank" class="social-icon-btn">${SVG.discord}</a>
      <a href="https://x.com" target="_blank" class="social-icon-btn"><svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a>
      <a href="https://tumblr.com" target="_blank" class="social-icon-btn">${SVG.tumblr}</a>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:0.72rem;margin-bottom:8px;">
      <a href="/" style="color:var(--text-secondary,#ccc);">Home</a>
      <a href="#" style="color:var(--text-secondary,#ccc);">Blog</a>
      <a href="#" style="color:var(--text-secondary,#ccc);">Forum</a>
      <a href="#" style="color:var(--text-secondary,#ccc);">Report</a>
      <a href="/terms" target="_blank" style="color:var(--text-secondary,#ccc);">Terms &amp; Conditions</a>
      <a href="/privacy" target="_blank" style="color:var(--text-secondary,#ccc);">Privacy Policy</a>
      <a href="#" style="color:var(--text-secondary,#ccc);">Support</a>
    </div>
    <p style="font-size:0.67rem;color:var(--text-muted,#666);">This site does not store any files on its server. All contents are provided by non-affiliated third parties.</p>
    <p style="font-size:0.67rem;color:var(--text-muted,#666);">Copyright © ${new Date().getFullYear()} AniOcean. All Rights Reserved</p>
  </div>
  <div style="flex-shrink:0;">
    <img src="https://i.postimg.cc/hPqN8Q8v/Chisato-bow-Lycoris-Recoil-01-removebg-preview.png" alt="Mascot" style="height:180px;object-fit:contain;">
  </div>
</footer>`;

  /* ═══════════════════════════════════════════════════════════
     AUTH MODAL HTML  (3 slides: Login | Sign Up | Forgot Pwd)
  ═══════════════════════════════════════════════════════════ */
  const AUTH_MODAL = `
<div class="auth-overlay" id="authOverlay">
  <div class="auth-modal" id="authModal">

    <!-- Left image column – DESKTOP ONLY (mobile uses carousel below) -->
    <div class="auth-img-col">
      <img src="https://i.postimg.cc/pr6CQhM8/e1223c0a1599b039da4ac536a39f0223.jpg" alt="AniOcean">
    </div>

    <!-- MOBILE-ONLY landscape image carousel — direct child of .auth-modal
         so it stays FULLY VISIBLE at the top while the form scrolls below.
         The gradient on the carousel merges seamlessly with the form column. -->
    <div class="auth-mobile-carousel" id="authMobileCarousel" aria-hidden="true">
      ${AUTH_CAROUSEL_IMAGES.map((url,i) => `<div class="mc-slide${i===0?' active':''}" style="background-image:url('${url}')"></div>`).join('')}
    </div>

    <!-- Right form column -->
    <div class="auth-form-col">
      <button class="auth-close-btn" id="authClose">${SVG.close}</button>

      <div class="form-slides-wrapper">
        <div class="form-slides" id="formSlides">

          <!-- ── SLIDE 0 · LOGIN ──
               Field order: username → password (+inline forgot) → hCaptcha →
                            Sign In button → Google auth → nav button (Sign up) -->
          <div class="form-slide active" id="slideLogin">
            <div class="auth-heading">Welcome back 👋</div>
            <div class="auth-subheading">Sign in to continue your anime journey.</div>

            <!-- 1. Username -->
            <div class="field-group">
              <label>Username or Email</label>
              <input class="field-input" type="text" id="loginUsername" placeholder="Your username or email" autocomplete="username">
            </div>

            <!-- 2. Password -->
            <div class="field-group" style="margin-bottom:4px;">
              <label>Password</label>
              <div class="field-wrap">
                <input class="field-input" type="password" id="loginPassword" placeholder="Your password" autocomplete="current-password" style="padding-right:38px;">
                <button class="eye-btn" type="button" data-target="loginPassword">${SVG.eye}</button>
              </div>
            </div>
            <!-- Forgot password link — outside field-group so it never gets clipped -->
            <button class="forgot-inline" id="forgotLink" type="button">Forgot password?</button>

            <!-- 3. hCaptcha -->
            <div class="cf-wrap">
              <div class="h-captcha" data-sitekey="${HCAPTCHA_SITEKEY}" data-theme="dark" data-callback="onHcaptchaSuccess" data-expired-callback="onHcaptchaExpired" data-error-callback="onHcaptchaError"></div>
            </div>

            <div class="form-err" id="loginErr"></div>

            <!-- 4. Sign In button -->
            <button class="btn-primary-full" id="btnSignIn">Sign In</button>

            <!-- 5. Google auth -->
            <div class="divider">or</div>
            <button class="btn-google" id="btnGoogleLogin">${SVG.google} Continue with Google</button>

            <!-- 6. Navigate to Sign Up -->
            <div class="auth-switch">No account? <button class="auth-switch-btn" id="goSignUp">Sign up</button></div>
          </div>

          <!-- ── SLIDE 1 · SIGN UP ──
               Field order: username → email → password|confirm (side-by-side) →
                            terms → hCaptcha → Sign Up button → Google → nav (Sign in)
               Avatar picker removed to save vertical space (DEFAULT_AVATAR used;
               users can change avatar from profile page after signup). -->
          <div class="form-slide" id="slideSignUp">
            <!-- Always-visible back link at the TOP so user is never trapped -->
            <button class="auth-back-link" id="backLoginTop" type="button">← Back to Sign In</button>

            <div class="auth-heading">Create account ✨</div>
            <div class="auth-subheading">Join <span>Aniumi</span> — it's free forever.</div>

            <!-- Avatar picker — Frieren.jpeg pre-set, click to change
                 (upload from device OR choose from bucket collection). -->
            <div class="avatar-pick-wrap">
              <div class="avatar-frame" id="avatarFrame">
                <img src="${DEFAULT_AVATAR}" id="selectedAvatar" alt="avatar">
              </div>
              <div class="avatar-pick-lbl">Tap the avatar to change it</div>
            </div>

            <!-- Username + Email side-by-side (saves vertical space
                 so the avatar picker can stay prominent). -->
            <div class="field-row-2">
              <div class="field-group">
                <label>Username <span style="font-size:.6rem;text-transform:none;letter-spacing:0;">(max 12)</span></label>
                <input class="field-input" type="text" id="regUsername" placeholder="OtakuNinja" maxlength="12" autocomplete="off">
                <div class="field-err" id="errUsername"></div>
              </div>
              <div class="field-group">
                <label>Email</label>
                <input class="field-input" type="email" id="regEmail" placeholder="you@example.com" autocomplete="email">
              </div>
            </div>

            <!-- 3. Password + Confirm Password (SIDE-BY-SIDE) -->
            <div class="pwd-pair">
              <div class="field-group">
                <label>Password <span style="font-size:.58rem;text-transform:none;letter-spacing:0;">(max 20)</span></label>
                <div class="field-wrap">
                  <input class="field-input" type="password" id="regPassword" placeholder="Min 8 chars" maxlength="20" style="padding-right:30px;" autocomplete="new-password">
                  <button class="eye-btn" type="button" data-target="regPassword">${SVG.eye}</button>
                </div>
                <div class="pwd-bar"><div class="pwd-fill" id="pwdFill"></div></div>
                <div class="pwd-label" id="pwdLabel"></div>
              </div>
              <div class="field-group">
                <label>Confirm</label>
                <div class="field-wrap">
                  <input class="field-input" type="password" id="regConfirm" placeholder="Repeat" maxlength="20" style="padding-right:30px;" autocomplete="new-password">
                  <button class="eye-btn" type="button" data-target="regConfirm">${SVG.eye}</button>
                </div>
                <div class="field-err" id="errConfirm"></div>
              </div>
            </div>

            <!-- 4. Terms checkbox -->
            <div class="terms-row">
              <input type="checkbox" id="termsCheck">
              <label for="termsCheck">I have read and agree to the
                <a href="/terms" target="_blank">Terms &amp; Conditions</a> and
                <a href="/privacy" target="_blank">Privacy Policy</a>.
              </label>
            </div>

            <!-- 5. hCaptcha -->
            <div class="cf-wrap">
              <div class="h-captcha" data-sitekey="${HCAPTCHA_SITEKEY}" data-theme="dark" data-callback="onHcaptchaSuccess" data-expired-callback="onHcaptchaExpired" data-error-callback="onHcaptchaError"></div>
            </div>

            <div class="form-err" id="signUpErr"></div>

            <!-- 6. Sign Up button -->
            <button class="btn-primary-full" id="btnSignUp">Create Account</button>

            <!-- 7. Google auth -->
            <div class="divider">or</div>
            <button class="btn-google" id="btnGoogleSignUp">${SVG.google} Sign up with Google</button>

            <!-- 8. Navigate to Sign In (also at top — bottom is a fallback) -->
            <div class="auth-switch">Already have an account? <button class="auth-switch-btn" id="goLogin">Sign in</button></div>
          </div>

          <!-- ── SLIDE 2 · FORGOT PASSWORD ── -->
          <div class="form-slide" id="slideForgot">
            <div class="auth-heading">Reset password 🔑</div>
            <div class="auth-subheading">Enter your email and we'll send a reset link.</div>

            <div class="field-group">
              <label>Email Address</label>
              <input class="field-input" type="email" id="resetEmail" placeholder="you@example.com" autocomplete="email">
            </div>
            <div class="form-err" id="resetErr"></div>
            <div class="reset-success" id="resetOk" style="display:none;">
              <span class="big">📧</span>
              Check your inbox! We've sent a password reset link to your email.
            </div>
            <button class="btn-primary-full" id="btnReset">Reset Password</button>
            <div class="auth-switch"><button class="auth-switch-btn" id="backLogin">← Back to Sign In</button></div>
          </div>

        </div><!-- /form-slides -->
      </div><!-- /form-slides-wrapper -->
    </div><!-- /auth-form-col -->
  </div><!-- /auth-modal -->
</div><!-- /auth-overlay -->

<!-- Avatar picker popup -->
<div class="avatar-popup-overlay" id="avatarPopupOverlay">
  <div class="avatar-popup" id="avatarPopup">
    <div class="avatar-popup-hdr">
      <span class="avatar-popup-title">Choose Avatar</span>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px;">
      <label class="avatar-action-btn" for="avatarFileInput" style="flex:1;text-align:center;cursor:pointer;border-radius:20px;padding:8px 12px;font-size:0.75rem;font-weight:600;background:var(--btn-primary,#3b82f6);color:#fff;border:none;display:flex;align-items:center;justify-content:center;gap:6px;">${SVG.upload} Upload from Device</label>
      <button class="avatar-action-btn" id="btnChooseFromBucket" type="button" style="flex:1;border-radius:20px;padding:8px 12px;font-size:0.75rem;font-weight:600;background:transparent;color:var(--text,#e2e8f0);border:2px solid var(--btn-primary,#3b82f6);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">Choose from Collection</button>
    </div>
    <input type="file" id="avatarFileInput" accept="image/*" style="display:none;">
    <div class="avatar-grid" id="avatarGrid" style="display:none;">
      <div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted,#888);font-size:0.76rem;">Loading avatars…</div>
    </div>
  </div>
</div>
`;

  /* ═══════════════════════════════════════════════════════════
     DOM INJECTION
  ═══════════════════════════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', () => {
    document.body.insertAdjacentHTML('afterbegin', HEADER);
    document.body.insertAdjacentHTML('beforeend', FOOTER);
    document.body.insertAdjacentHTML('beforeend', AUTH_MODAL);

    // Load hCaptcha script
    if (!document.querySelector('script[src*="hcaptcha"]')) {
      const s = document.createElement('script');
      s.src = 'https://js.hcaptcha.com/1/api.js';
      s.async = true; s.defer = true;
      document.head.appendChild(s);
    }

    initHeader();
    initSearch();
    initAuthModal();
    initAvatarPicker();

    // Auth state listener with session expiry
    supabase.auth.onAuthStateChange(async (evt, session) => {
      currentUser = session?.user || null;
      // Session expiry check
      if (session) {
        const lastActivity = localStorage.getItem('aniumi_last_activity');
        const now = Date.now();
        if (lastActivity && (now - parseInt(lastActivity)) > SESSION_MAX_AGE) {
          await supabase.auth.signOut();
          currentUser = null;
        } else {
          localStorage.setItem('aniumi_last_activity', now.toString());
        }
      }
      // Pass the auth event so handleOAuthCallback only increments
      // login_count on a genuine new sign-in, not on every page load.
      updateUserUI(evt);
    });
    // Track activity for session expiry
    ['click', 'keydown', 'scroll', 'mousemove'].forEach(evt => {
      document.addEventListener(evt, () => {
        if (currentUser) localStorage.setItem('aniumi_last_activity', Date.now().toString());
      }, { passive: true });
    });
    updateUserUI();
  });

  /* ═══════════════════════════════════════════════════════════
     HEADER LOGIC
  ═══════════════════════════════════════════════════════════ */
  function initHeader() {
    /* ── Login button ── */
    document.getElementById('btnLogin')?.addEventListener('click', () => openModal(0));

    /* ── Desktop avatar toggle ── */
    document.getElementById('desktopAvatar')?.addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('desktopDropdown').classList.toggle('open');
    });

    /* ── Mobile avatar toggle ── */
    document.getElementById('mobAvatar')?.addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('mobDropdown').classList.toggle('open');
    });

    /* ── Close dropdowns on outside click ── */
    document.addEventListener('click', e => {
      if (!e.target.closest('#desktopAvatarWrap')) {
        document.getElementById('desktopDropdown')?.classList.remove('open');
      }
      if (!e.target.closest('#mobAvatarWrap')) {
        document.getElementById('mobDropdown')?.classList.remove('open');
      }
    });

    /* ── Logout ──
       FIXED (v3): previously the dropdown stayed open during the
       await supabase.auth.signOut() network call, then updateUserUI()
       ran (which calls auth.getUser() + profiles.select() — TWO more
       network calls) before finally hiding the avatar wrap.  That
       200–600ms async gap is what caused the visible "flicker" the
       user saw: dropdown-open → wait → dropdown-suddenly-disappears.

       Now: the dropdown closes IMMEDIATELY on click (synchronously,
       before any await), the button turns red instantly, and the
       signOut + UI refresh runs in the background.  The user sees
       one smooth transition: click → dropdown closes → header
       reverts to "Sign In" button.  No flicker, no multiple-click
       needed. */
    document.getElementById('btnLogoutDesktop')?.addEventListener('click', handleLogoutClick);
    document.getElementById('btnLogoutMob')?.addEventListener('click', handleLogoutClick);

    function handleLogoutClick(e) {
      e.stopPropagation();
      e.preventDefault();
      const btn = e.currentTarget;
      // 1) Instant red feedback so the user knows the click registered.
      btn.classList.add('signing-out');
      // 2) Close BOTH dropdowns immediately (synchronous, before any await).
      document.getElementById('desktopDropdown')?.classList.remove('open');
      document.getElementById('mobDropdown')?.classList.remove('open');
      // 3) Clear the local user state synchronously so the header
      //    reverts to "Sign In" instantly — don't wait for the network.
      currentUser = null;
      // Clear OAuth login-counted flag so next sign-in is counted properly
      try {
        Object.keys(sessionStorage)
          .filter(k => k.startsWith('aniumi_oauth_counted_'))
          .forEach(k => sessionStorage.removeItem(k));
      } catch(e) {}
      // 4) Update UI synchronously: hide avatar, show Sign In button.
      //    We pass { skipNetwork:true } so updateUserUI doesn't re-fetch
      //    the user from Supabase (which would still return the old
      //    session for ~100ms until signOut resolves).
      updateUserUIImmediate();
      // 5) Fire-and-forget the actual signOut network call.  The auth
      //    state change listener will also fire updateUserUI() when
      //    signOut completes, but by then the UI is already correct.
      supabase.auth.signOut().catch(err => {
        console.warn('[signOut] network call failed (UI already updated):', err);
      }).finally(() => {
        btn.classList.remove('signing-out');
      });
    }

    /* Synchronous UI update — used by handleLogoutClick so the header
       reverts to the signed-out state instantly.  No network calls. */
    function updateUserUIImmediate() {
      const btnLogin      = document.getElementById('btnLogin');
      const deskAvatar    = document.getElementById('desktopAvatar');
      const mobProfileBtn = document.getElementById('mobProfileBtn');
      const mobAvatarWrap = document.getElementById('mobAvatarWrap');
      if (btnLogin)      btnLogin.style.display = '';
      if (deskAvatar)    deskAvatar.style.display = 'none';
      if (mobProfileBtn) mobProfileBtn.style.display = 'flex';
      if (mobAvatarWrap) mobAvatarWrap.style.display = 'none';
    }

    /* Kept for backward compatibility (any external callers). */
    async function doLogout() { handleLogoutClick({ currentTarget:{ classList:{add(){},remove(){}}, stopPropagation(){}, preventDefault(){} } }); }

    /* ── Mobile profile button ── */
    document.getElementById('mobProfileBtn')?.addEventListener('click', e => {
      e.stopPropagation();
      if (currentUser) {
        document.getElementById('mobDropdown')?.classList.toggle('open');
      } else {
        openModal(0);
      }
    });

    /* ── Hamburger ── */
    const hBtn    = document.getElementById('hamburgerBtn');
    const overlay = document.getElementById('mobNavOverlay');
    const panel   = document.getElementById('mobNavPanel');
    const closeBtn= document.getElementById('mobNavClose');

    const openNav  = () => { hBtn.classList.add('open'); overlay.classList.add('open'); panel.classList.add('open'); };
    const closeNav = () => { hBtn.classList.remove('open'); overlay.classList.remove('open'); panel.classList.remove('open'); };

    hBtn?.addEventListener('click', openNav);
    closeBtn?.addEventListener('click', closeNav);
    overlay?.addEventListener('click', e => { if (!e.target.closest('#mobNavPanel')) closeNav(); });

    /* ── Mobile sub-menus (click only) ── */
    document.querySelectorAll('.mob-sub-trigger').forEach(trigger => {
      trigger.addEventListener('click', () => {
        const menuId = trigger.dataset.target;
        const menu   = document.getElementById(menuId);
        const isOpen = menu.classList.contains('show');
        // close all
        document.querySelectorAll('.mob-sub-menu').forEach(m => m.classList.remove('show'));
        document.querySelectorAll('.mob-sub-trigger').forEach(t => t.classList.remove('open'));
        if (!isOpen) {
          menu.classList.add('show');
          trigger.classList.add('open');
        }
      });
    });

    /* ── Mobile search ── */
    document.getElementById('mobSearchBtn')?.addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('mobSearchPanel').classList.toggle('open');
      if (document.getElementById('mobSearchPanel').classList.contains('open')) {
        setTimeout(() => document.getElementById('mobSearchInput')?.focus(), 100);
      }
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#mobSearchPanel') && !e.target.closest('#mobSearchBtn')) {
        document.getElementById('mobSearchPanel')?.classList.remove('open');
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════
     SEARCH  (uses CF Worker for TMDB, Jikan direct for anime)
  ═══════════════════════════════════════════════════════════ */
  function initSearch() {
    /* Desktop tabs */
    document.querySelectorAll('#desktopTabs .search-toggle-tab').forEach(tab => {
      tab.addEventListener('click', function () {
        document.querySelectorAll('#desktopTabs .search-toggle-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        currentSearchMode = this.dataset.mode;
        const q = document.getElementById('searchInput').value.trim();
        if (q.length >= 3) handleSearchInput(q, document.getElementById('searchSuggestions'));
      });
    });
    /* Mobile tabs */
    document.querySelectorAll('#mobTabs .search-toggle-tab').forEach(tab => {
      tab.addEventListener('click', function () {
        document.querySelectorAll('#mobTabs .search-toggle-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        currentSearchMode = this.dataset.mode;
        const q = document.getElementById('mobSearchInput').value.trim();
        if (q.length >= 3) handleSearchInput(q, document.getElementById('mobSuggestions'));
      });
    });

    /* Desktop input */
    document.getElementById('searchInput')?.addEventListener('input', function () {
      handleSearchInput(this.value, document.getElementById('searchSuggestions'));
    });
    /* Mobile input */
    document.getElementById('mobSearchInput')?.addEventListener('input', function () {
      handleSearchInput(this.value, document.getElementById('mobSuggestions'));
    });

    /* Close desktop suggestions on outside click */
    document.addEventListener('click', e => {
      if (!e.target.closest('#desktopSearchWrap')) {
        document.getElementById('searchSuggestions').style.display = 'none';
      }
    });
  }

  function handleSearchInput(rawQ, container) {
    const q = rawQ.trim();
    clearTimeout(searchDebounceTimer);
    if (q.length < 3) { container.style.display = 'none'; return; }
    container.innerHTML = '<div style="padding:14px 12px;font-size:0.76rem;color:var(--text-muted,#888);">Searching…</div>';
    container.style.display = 'block';
    searchDebounceTimer = setTimeout(() => fetchSuggestions(q, container), 300);
  }

  async function fetchSuggestions(q, container) {
    try {
      const results = currentSearchMode === 'anime'
        ? await fetchJikan(q)
        : await fetchTMDB(q);
      renderSuggestions(results.slice(0, 6), q, container);
    } catch (err) {
      container.innerHTML = `<div style="padding:14px 12px;font-size:0.76rem;color:var(--text-muted,#888);">Failed to fetch. Try again.</div>`;
      console.error('Search error:', err);
    }
  }

  /* ── Jikan (Anime) ── */
  async function fetchJikan(q) {
    const res  = await fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=6&order_by=score&sort=desc`);
    if (!res.ok) throw new Error('Jikan error');
    const data = await res.json();
    return (data.data || []).map(item => {
      const aired = item.aired?.from ? new Date(item.aired.from) : null;
      const monthYear = aired ? aired.toLocaleDateString('en-US',{month:'long',year:'numeric'}) : '—';
      let dur = item.duration || '—';
      if (dur === 'Unknown') dur = '—';
      return {
        poster:   item.images?.jpg?.image_url || '',
        title:    item.title_english || item.title || '—',
        original: item.title_japanese || item.title || '',
        meta:     `${monthYear} · ${item.type||'—'} · ${dur}`,
        score:    item.score ? `★ MAL ${item.score}` : null,
        id:       item.mal_id,
        source:   'jikan'
      };
    });
  }

  /* ── TMDB via Cloudflare Worker ── */
  async function fetchTMDB(q) {
    const [movieRes, tvRes] = await Promise.all([
      fetch(`${CF_WORKER_URL}/3/search/movie?query=${encodeURIComponent(q)}&language=en-US&page=1`),
      fetch(`${CF_WORKER_URL}/3/search/tv?query=${encodeURIComponent(q)}&language=en-US&page=1`)
    ]);

    const movieData = await movieRes.json();
    const tvData    = await tvRes.json();

    const movieResults = (movieData.results || []).map(r => ({ ...r, media_type: 'movie' }));
    const tvResults    = (tvData.results    || []).map(r => ({ ...r, media_type: 'tv' }));

    const combined = [...movieResults, ...tvResults]
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
      .slice(0, 6);

    return combined.map(item => {
      const date      = item.release_date || item.first_air_date || '';
      const monthYear = date ? new Date(date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—';
      const typeLabel = item.media_type === 'movie' ? 'Movie' : 'TV';
      const poster    = item.poster_path ? `https://image.tmdb.org/t/p/w92${item.poster_path}` : '';
      const score     = item.vote_average ? `★ TMDB ${Number(item.vote_average).toFixed(1)}` : null;
      return {
        poster,
        title:    item.title || item.name || '—',
        original: item.original_title || item.original_name || '',
        meta:     `${monthYear} · ${typeLabel}`,
        score,
        id:       item.id,
        source:   'tmdb',
        mediaType: item.media_type
      };
    });
  }

  function renderSuggestions(results, q, container) {
    if (!results.length) {
      container.innerHTML = `<div style="padding:14px 12px;font-size:0.76rem;color:var(--text-muted,#888);">No results for "${esc(q)}"</div>`;
      return;
    }

    const slugify = (title) => {
      if (!title) return '';
      return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    };

    const html = results.map(r => {
      let detailsUrl = '#';
      const slug = slugify(r.title);

      if (r.source === 'jikan') {
        detailsUrl = `/info/anime/jikan-${r.id}`;
        if (slug) detailsUrl += `/${slug}`;
      } else if (r.source === 'tmdb') {
        const type = r.mediaType === 'movie' ? 'movie' : 'tv';
        const prefix = r.mediaType === 'movie' ? `tmdb-movie-${r.id}` : `tmdb-tv-${r.id}`;
        detailsUrl = `/info/${type}/${prefix}`;
        if (slug) detailsUrl += `/${slug}`;
      }

      const img = r.poster
        ? `<img class="suggestion-poster" src="${esc(r.poster)}" alt="" loading="lazy" onerror="this.style.background='#1e2633';">`
        : `<div class="suggestion-poster"></div>`;
      const orig = r.original && r.original !== r.title
        ? `<div class="sug-orig">${esc(r.original)}</div>` : '';
      const score = r.score
        ? `<span class="sug-score">${esc(r.score)}</span>` : '';
      const meta = [r.meta, score].filter(Boolean).join(' · ');

      return `<a href="${detailsUrl}" class="suggestion-item">
        ${img}
        <div class="suggestion-info">
          <div class="sug-title">${esc(r.title)}</div>
          ${orig}
          <div class="sug-meta">${meta}</div>
        </div>
      </a>`;
    }).join('');

    container.innerHTML = html
      + `<button class="view-all-btn" onclick="location.href='/search?q=${encodeURIComponent(q)}&type=${currentSearchMode}'">${SVG.arrow} View all results</button>`;
    container.style.display = 'block';
  }

  /* ═══════════════════════════════════════════════════════════
     AUTH MODAL
  ═══════════════════════════════════════════════════════════ */
  let currentSlide = 0;

  let carouselTimer = null;
  function startCarousel() {
    stopCarousel();
    const slides = document.querySelectorAll('#authMobileCarousel .mc-slide');
    if (slides.length < 2) return;
    let idx = 0;
    carouselTimer = setInterval(() => {
      slides[idx].classList.remove('active');
      idx = (idx + 1) % slides.length;
      slides[idx].classList.add('active');
    }, 3000);  // 3-second morphine crossfade
  }
  function stopCarousel() {
    if (carouselTimer) { clearInterval(carouselTimer); carouselTimer = null; }
  }

  // Body scroll-lock state — saved so we can restore the exact scroll
  // position when the modal closes (iOS Safari quirk: position:fixed on
  // <body> resets the scroll offset, so we have to put it back manually).
  let aniumiSavedScrollY = 0;

  function openModal(n = 0) {
    document.getElementById('authOverlay').classList.add('open');
    // Set initial carousel class based on which slide we're opening
    const _carousel = document.getElementById('authMobileCarousel');
    if (_carousel) {
      _carousel.classList.remove('carousel-signin','carousel-signup','carousel-forgot');
      _carousel.classList.add(n === 0 ? 'carousel-signin' : n === 1 ? 'carousel-signup' : 'carousel-forgot');
    }
    // Lock the body so the page behind the modal cannot scroll.
    // Save the current scroll offset first so we can restore it on close.
    aniumiSavedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.classList.add('aniumi-modal-open');
    // The body is now position:fixed — nudge it so the user still
    // appears to be at the same scroll position rather than the top.
    document.body.style.top = `-${aniumiSavedScrollY}px`;
    slideTo(n);
    ['loginErr','signUpErr','resetErr','errUsername','errConfirm'].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = '';
    });
    document.getElementById('resetOk').style.display = 'none';
    // Kick off the mobile image carousel
    startCarousel();
  }
  window.openLoginModal = () => openModal(0);

  function closeModal() {
    document.getElementById('authOverlay').classList.remove('open');
    stopCarousel();
    // Unlock the body & restore the saved scroll offset.
    document.body.classList.remove('aniumi-modal-open');
    document.body.style.top = '';
    window.scrollTo(0, aniumiSavedScrollY);
  }

  function slideTo(n) {
    currentSlide = n;
    document.getElementById('formSlides').style.transform = `translateX(-${n * 33.333}%)`;
    // Toggle .active so the inactive slide can't be interacted with
    document.querySelectorAll('.form-slide').forEach((s, i) => {
      s.classList.toggle('active', i === n);
    });
    // Update carousel aspect-ratio class per slide so sign-in gets a
    // taller image (less form content) and sign-up gets a shorter one.
    const carousel = document.getElementById('authMobileCarousel');
    if (carousel) {
      carousel.classList.remove('carousel-signin','carousel-signup','carousel-forgot');
      if (n === 0) carousel.classList.add('carousel-signin');
      else if (n === 1) carousel.classList.add('carousel-signup');
      else carousel.classList.add('carousel-forgot');
    }
    resetHCaptcha();
  }

  function initAuthModal() {
    document.getElementById('authClose')?.addEventListener('click', closeModal);
    document.getElementById('authOverlay')?.addEventListener('click', e => {
      if (e.target.id === 'authOverlay') closeModal();
    });

    document.getElementById('goSignUp')?.addEventListener('click', () => slideTo(1));
    document.getElementById('goLogin')?.addEventListener('click',  () => slideTo(0));
    document.getElementById('forgotLink')?.addEventListener('click', () => slideTo(2));
    document.getElementById('backLogin')?.addEventListener('click',  () => slideTo(0));
    // New "← Back to Sign In" link at the top of the sign-up form
    document.getElementById('backLoginTop')?.addEventListener('click', () => slideTo(0));

    document.querySelectorAll('.eye-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        const inp = document.getElementById(this.dataset.target);
        if (!inp) return;
        const show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        this.innerHTML = show ? SVG.eyeOff : SVG.eye;
      });
    });

    document.getElementById('regUsername')?.addEventListener('input', function () {
      this.value = this.value.replace(/[^a-zA-Z0-9]/g, '');
      document.getElementById('errUsername').textContent =
        this.value.length > 0 && this.value.length < 3 ? 'Minimum 3 characters.' : '';
    });

    document.getElementById('regPassword')?.addEventListener('input', function () {
      updatePwdStrength(this.value);
    });

    document.getElementById('regConfirm')?.addEventListener('input', function () {
      const pwd = document.getElementById('regPassword')?.value || '';
      document.getElementById('errConfirm').textContent =
        this.value && this.value !== pwd ? 'Passwords do not match.' : '';
    });

    document.getElementById('btnSignIn')?.addEventListener('click', async () => {
      const username = document.getElementById('loginUsername').value.trim();
      const password = document.getElementById('loginPassword').value;
      const errEl   = document.getElementById('loginErr');
      errEl.textContent = '';
      if (!username || !password) { errEl.textContent = 'Please fill in all fields.'; return; }
      if (!hcaptchaToken) {
        errEl.textContent = 'Please complete the captcha verification below.';
        // Scroll the form column so the captcha widget is visible — most
        // users click submit before realising the captcha hasn't verified.
        document.getElementById('slideLogin')?.querySelector('.cf-wrap')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        document.getElementById('loginErr')?.parentElement?.querySelector('.cf-wrap')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const btn = document.getElementById('btnSignIn');
      btn.disabled = true; btn.textContent = 'Signing in…';
      try {
        let email = username;
        if (!username.includes('@')) {
          const { data: p } = await supabase.from('profiles').select('email').eq('username', username).maybeSingle();
          if (p?.email) email = p.email;
          else { errEl.textContent = 'Username not found.'; return; }
        }
        const { data, error } = await supabase.auth.signInWithPassword({
          email, password,
          options: { captchaToken: hcaptchaToken }
        });
        if (error) {
          // Supabase captcha errors come back with `error.code` like
          // "captcha_failed" or with the word "captcha" in the message.
          // Give the user a friendly explanation + scroll to the widget.
          const msg = (error.message || '').toLowerCase();
          if (msg.includes('captcha') || (error.code || '').includes('captcha')) {
            errEl.textContent = 'Captcha verification failed. Please solve it again.';
            document.getElementById('slideLogin')?.querySelector('.cf-wrap')
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } else {
            errEl.textContent = error.message;
          }
          return;
        }
        localStorage.setItem('aniumi_last_activity', Date.now().toString());
        // Record login metadata (IP / country / state / count / last-login)
        if (data.user) await recordLogin(data.user.id);
        closeModal();
      } catch { errEl.textContent = 'An error occurred. Try again.'; }
      finally { btn.disabled = false; btn.textContent = 'Sign In'; resetHCaptcha(); }
    });

    document.getElementById('btnGoogleLogin')?.addEventListener('click', async () => {
        // Login — no geo needed
        await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: window.location.origin }
        });
      });
    document.getElementById('btnGoogleSignUp')?.addEventListener('click', async () => {
        // Sign-up — collect geo for new user profile
        const geo = await getUserGeo();
        try { localStorage.setItem('aniumi_pending_geo', JSON.stringify(geo)); } catch(e){}
        await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: window.location.origin }
        });
      });

    document.getElementById('btnSignUp')?.addEventListener('click', async () => {
      const username = document.getElementById('regUsername').value.trim();
      const email    = document.getElementById('regEmail').value.trim();
      const password = document.getElementById('regPassword').value;
      const confirm  = document.getElementById('regConfirm').value;
      const terms    = document.getElementById('termsCheck').checked;
      const errEl    = document.getElementById('signUpErr');
      errEl.textContent = '';

      if (!username || !email || !password || !confirm) { errEl.textContent = 'Please fill in all fields.'; return; }
      if (!/^[a-zA-Z0-9]+$/.test(username))             { errEl.textContent = 'Username: letters and numbers only.'; return; }
      if (username.length < 3)                           { errEl.textContent = 'Username must be at least 3 characters.'; return; }
      if (password !== confirm)                          { errEl.textContent = 'Passwords do not match.'; return; }
      if (!isStrongPwd(password))                        { errEl.textContent = 'Password must include upper, lower, number, and symbol.'; return; }
      if (!terms)                                        { errEl.textContent = 'Please accept the Terms & Conditions.'; return; }
      if (!hcaptchaToken)                                {
        errEl.textContent = 'Please complete the captcha verification below.';
        // Auto-scroll the form column so the captcha widget is visible.
        document.getElementById('slideSignUp')?.querySelector('.cf-wrap')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const btn = document.getElementById('btnSignUp');
      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        // Check username uniqueness
        const { data: exUser } = await supabase.from('profiles').select('user_id').eq('username', username).maybeSingle();
        if (exUser) { errEl.textContent = 'Username already taken.'; return; }

        // Check email uniqueness
        const { data: exEmail } = await supabase.from('profiles').select('user_id').eq('email', email).maybeSingle();
        if (exEmail) { errEl.textContent = 'This email address is already registered. Please sign in instead.'; return; }

        // Avatar picker was removed from the sign-up form to save space.
        // New users get the DEFAULT_AVATAR; they can change it later from
        // their profile page (avatar upload UI lives elsewhere).
        const avatarUrl = DEFAULT_AVATAR;
        const geo = await getUserGeo();

        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: {
            // hCaptcha token — REQUIRED when "Attack Protection → Captcha"
            // is enabled in Supabase.  Without it Supabase rejects the
            // request with `captcha_failed`.  Frontend already checks the
            // token is non-empty before we get here.
            captchaToken: hcaptchaToken,
            data: {
              username,
              avatar_url: avatarUrl,
              has_password:  true,
              ip_address_text: geo.ip,
              country:         geo.country,
              country_code:    geo.country_code,
              state:           geo.state,
              city:            geo.city,
              timezone:        geo.timezone
            }
          }
        });
        if (error) {
          const msg = (error.message || '').toLowerCase();
          // Captcha-specific error → friendly message + scroll to widget.
          if (msg.includes('captcha') || (error.code || '').includes('captcha')) {
            errEl.textContent = 'Captcha verification failed. Please solve it again.';
            document.getElementById('slideSignUp')?.querySelector('.cf-wrap')
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          // Supabase may return "User already registered" error
          else if (msg.includes('already registered') || msg.includes('already been registered')) {
            errEl.textContent = 'This email address is already registered. Please sign in instead.';
          } else {
            errEl.textContent = error.message;
          }
          return;
        }

        // The handle_new_user trigger auto-creates the profile row.
        // We also persist the chosen avatar to the PERMANENT bucket so it
        // never expires (the on-screen URL might be from a private bucket
        // or an external source).
        if (data.user) {
          await persistAvatarPermanently(data.user.id, avatarUrl);
        }
        localStorage.setItem('aniumi_last_activity', Date.now().toString());
        closeModal();
        alert('Account created! Check your email to verify your account.');
      } catch { errEl.textContent = 'An error occurred. Try again.'; }
      finally { btn.disabled = false; btn.textContent = 'Create Account'; resetHCaptcha(); }
    });

    document.getElementById('btnReset')?.addEventListener('click', async () => {
      const email = document.getElementById('resetEmail').value.trim();
      const errEl = document.getElementById('resetErr');
      errEl.textContent = '';
      document.getElementById('resetOk').style.display = 'none';
      if (!email) { errEl.textContent = 'Please enter your email.'; return; }

      const btn = document.getElementById('btnReset');
      btn.disabled = true; btn.textContent = 'Sending…';
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/update-password`
      });
      btn.disabled = false; btn.textContent = 'Reset Password';
      if (error) errEl.textContent = error.message;
      else document.getElementById('resetOk').style.display = 'block';
    });
  }

  function isStrongPwd(p) {
    return p.length >= 8 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p);
  }

  function updatePwdStrength(p) {
    let score = 0;
    if (p.length >= 8) score++;
    if (/[A-Z]/.test(p)) score++;
    if (/[a-z]/.test(p)) score++;
    if (/[0-9]/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    const lvls = [
      {pct:0,  color:'',        label:''},
      {pct:20, color:'#ef4444', label:'Very weak'},
      {pct:40, color:'#f97316', label:'Weak'},
      {pct:60, color:'#eab308', label:'Fair'},
      {pct:80, color:'#22c55e', label:'Strong'},
      {pct:100,color:'#10b981', label:'Very strong'},
    ];
    const l = lvls[score] || lvls[0];
    const fill = document.getElementById('pwdFill');
    const lbl  = document.getElementById('pwdLabel');
    if (fill) { fill.style.width = l.pct+'%'; fill.style.background = l.color; }
    if (lbl)  { lbl.textContent = l.label; lbl.style.color = l.color; }
  }

  /* ═══════════════════════════════════════════════════════════
     AVATAR PICKER
  ═══════════════════════════════════════════════════════════ */
  let selectedAvatarUrl = DEFAULT_AVATAR;

  function initAvatarPicker() {
    document.getElementById('avatarFrame')?.addEventListener('click', async () => {
      document.getElementById('avatarPopupOverlay').classList.add('open');
      document.getElementById('avatarGrid').style.display = 'none'; // hidden until "Choose from" is clicked
    });
    document.getElementById('avatarPopupOverlay')?.addEventListener('click', e => {
      if (!e.target.closest('#avatarPopup')) {
        document.getElementById('avatarPopupOverlay').classList.remove('open');
      }
    });

    // "Choose from Collection" button — fetches from profile_ava folder
    document.getElementById('btnChooseFromBucket')?.addEventListener('click', async () => {
      const grid = document.getElementById('avatarGrid');
      grid.style.display = 'grid';
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted,#888);font-size:0.76rem;">Loading…</div>';
      await loadBucketAvatars();
    });

    // Upload from device — unique path per user, PERMANENT public URL
    document.getElementById('avatarFileInput')?.addEventListener('change', async function () {
      const file = this.files[0];
      if (!file) return;
      const dataUrl = await resizeImage(file, 256, 256);
      const blob    = await (await fetch(dataUrl)).blob();
      const ext     = file.name.split('.').pop() || 'jpg';
      // Use user-specific folder path in the PERMANENT public bucket.
      const uid     = currentUser?.id || 'guest_' + Date.now();
      const path    = `${uid}/${Date.now()}.${ext}`;
      const { data, error } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(path, blob, { upsert: true, contentType: file.type });
      if (!error && data) {
        // PUBLIC URL — never expires (no signed URL anymore).
        setAvatar(`${AVATAR_BUCKET_URL}${path}`);
      } else {
        setAvatar(dataUrl);
      }
      document.getElementById('avatarPopupOverlay').classList.remove('open');
    });
  }

  async function loadBucketAvatars() {
    const grid = document.getElementById('avatarGrid');
    grid.style.display = 'grid';
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted,#888);font-size:0.76rem;">Loading…</div>';
    // Fetch pre-uploaded avatars from the "profile_ava" folder in the
    // (now PUBLIC) 'Aniumi' bucket. Public URLs never expire.
    const { data, error } = await supabase.storage.from('Aniumi').list('profile_ava', { limit: 60 });
    if (error || !data?.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted,#888);font-size:0.76rem;">No avatars found in collection.</div>';
      return;
    }
    const imgs = data.filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f.name));
    if (!imgs.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted,#888);font-size:0.76rem;">No images in collection yet.</div>';
      return;
    }
    // PUBLIC URLs — no more signed URLs (which expired after 1 year).
    grid.innerHTML = imgs.map(f => {
      const url = `${PROFILE_BUCKET_URL}profile_ava/${f.name}`;
      return `<div class="avatar-opt${url===selectedAvatarUrl?' selected':''}" data-url="${url}">
        <img src="${url}" alt="${f.name}" loading="lazy">
      </div>`;
    }).join('');
    grid.querySelectorAll('.avatar-opt').forEach(opt => {
      opt.addEventListener('click', function () {
        grid.querySelectorAll('.avatar-opt').forEach(o => o.classList.remove('selected'));
        this.classList.add('selected');
        setAvatar(this.dataset.url);
        document.getElementById('avatarPopupOverlay').classList.remove('open');
      });
    });
  }

  function setAvatar(url) {
    selectedAvatarUrl = url;
    document.getElementById('selectedAvatar').src = url;
  }

  function resizeImage(file, maxW, maxH) {
    return new Promise(resolve => {
      const img = new Image();
      const fr  = new FileReader();
      fr.onload  = e => { img.src = e.target.result; };
      img.onload = () => {
        let w = img.width, h = img.height;
        const scale = Math.min(maxW / w, maxH / h, 1);
        w = Math.round(w * scale); h = Math.round(h * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL(file.type || 'image/jpeg', 0.85));
      };
      fr.readAsDataURL(file);
    });
  }

  /* ═══════════════════════════════════════════════════════════
     USER UI UPDATE
  ═══════════════════════════════════════════════════════════ */
  async function updateUserUI(authEvent) {
    const { data: { user } } = await supabase.auth.getUser();
    currentUser = user;

    const btnLogin      = document.getElementById('btnLogin');
    const deskAvatar    = document.getElementById('desktopAvatar');
    const mobProfileBtn = document.getElementById('mobProfileBtn');
    const mobAvatarWrap = document.getElementById('mobAvatarWrap');
    const mobAvatar     = document.getElementById('mobAvatar');

    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('username,avatar_url,google_account_username,gmail_address,google_profile_image,first_login_date,last_login_date,login_count,ip_address_text,country,state,city')
        .eq('user_id', user.id)
        .maybeSingle();

      const username  = profile?.username  || user.user_metadata?.username  || user.email?.split('@')[0] || 'User';
      const avatarUrl = profile?.avatar_url || user.user_metadata?.avatar_url || DEFAULT_AVATAR;

      if (btnLogin)   btnLogin.style.display = 'none';
      if (deskAvatar) { deskAvatar.style.display = 'block'; deskAvatar.src = avatarUrl; }

      const ddAv  = document.getElementById('ddAvatarImg');
      const ddUn  = document.getElementById('ddUsername');
      if (ddAv) ddAv.src = avatarUrl;
      if (ddUn) ddUn.textContent = username;

      if (mobProfileBtn) mobProfileBtn.style.display = 'none';
      if (mobAvatarWrap) mobAvatarWrap.style.display = 'flex';
      if (mobAvatar)     mobAvatar.src = avatarUrl;

      const mobDdAv = document.getElementById('mobDdAvatarImg');
      const mobDdUn = document.getElementById('mobDdUsername');
      if (mobDdAv) mobDdAv.src = avatarUrl;
      if (mobDdUn) mobDdUn.textContent = username;

      // ─── OAuth redirect: pick up stashed geo & persist Google avatar ───
      await handleOAuthCallback(user, profile, authEvent);

      // ─── Start realtime subscriptions for this user ───
      initRealtime(user.id);

    } else {
      if (btnLogin)      btnLogin.style.display = '';
      if (deskAvatar)    deskAvatar.style.display = 'none';
      if (mobProfileBtn) mobProfileBtn.style.display = 'flex';
      if (mobAvatarWrap) mobAvatarWrap.style.display = 'none';
    }
  }

  /* ═══════════════════════════════════════════════════════════
     RECORD LOGIN  — updates last_login_date, login_count, IP/geo
     on every password sign-in.
  ═══════════════════════════════════════════════════════════ */
  async function recordLogin(userId) {
    // Uses an atomic Postgres RPC so login_count is never double-counted
    // even if the function is called twice (tab restore, strict-mode etc.).
    try {
      const now = new Date().toISOString();
      // Atomic increment in one round-trip — no SELECT race.
      const { error } = await supabase.rpc('increment_login', {
        p_user_id:       userId,
        p_now:           now,
        p_ip:            null,
        p_country:       null,
        p_country_code:  null,
        p_state:         null,
        p_city:          null,
        p_local_tz:      null,
        p_utc_offset:    null
      });
      if (error) {
        // RPC not deployed yet — fall back to safe client-side increment
        console.warn('[recordLogin] RPC failed, using fallback:', error.message);
        const { data: cur } = await supabase
          .from('profiles').select('login_count,first_login_date').eq('user_id', userId).maybeSingle();
        const patch = {
          last_login_date:  now,
          // COALESCE(login_count,0)+1 — never set to 1 if already > 0
          login_count:      (cur?.login_count != null ? cur.login_count + 1 : 1),
          first_login_date: cur?.first_login_date || now,
          updated_at:       now
        };
        await supabase.from('profiles').update(patch).eq('user_id', userId);
      }
    } catch (e) { console.warn('[recordLogin] failed:', e); }
  }

  /* ═══════════════════════════════════════════════════════════
     PERSIST AVATAR PERMANENTLY  — uploads chosen/Google avatar to
     the PUBLIC 'AniumiAvatars' bucket. Objects here have NO lifecycle
     policy → URLs NEVER expire. Returns the new permanent URL.
  ═══════════════════════════════════════════════════════════ */
  async function persistAvatarPermanently(userId, sourceUrl) {
    if (!userId || !sourceUrl) return null;
    // Already in our permanent bucket? Skip.
    if (sourceUrl.includes(`/${AVATAR_BUCKET}/`)) return sourceUrl;
    // Default avatar? Skip — defaults live in the public 'Aniumi' bucket permanently.
    if (sourceUrl === DEFAULT_AVATAR) return sourceUrl;
    try {
      const resp = await fetch(sourceUrl, { mode: 'cors', credentials: 'omit' });
      if (!resp.ok) return sourceUrl;
      const blob = await resp.blob();
      const ext  = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const path = `${userId}/avatar_${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(path, blob, { upsert: true, contentType: blob.type });
      if (error) { console.warn('[persistAvatar] upload failed:', error); return sourceUrl; }
      const permanentUrl = `${AVATAR_BUCKET_URL}${path}`;
      // Update the profile row to use the permanent URL
      await supabase.from('profiles')
        .update({ avatar_url: permanentUrl, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      return permanentUrl;
    } catch (e) {
      console.warn('[persistAvatar] fetch failed (likely CORS):', e);
      return sourceUrl;
    }
  }

  /* ═══════════════════════════════════════════════════════════
     HANDLE OAUTH CALLBACK  — runs after Google OAuth redirect.
     • Grabs stashed geo from localStorage (set before the redirect).
     • Copies Google name/gmail/avatar_url into profile columns.
     • Downloads the Google avatar into our permanent bucket so
       it lives forever (Google's URL can disappear if the user
       changes their Google photo).
  ═══════════════════════════════════════════════════════════ */
  async function handleOAuthCallback(user, profile, authEvent) {
    if (!user) return;
    // Only run the login-count increment on a genuine new OAuth sign-in.
    // 'SIGNED_IN' fires on fresh login AND on page-load token refresh —
    // we distinguish them with a sessionStorage flag so refreshes don't
    // double-count. 'USER_UPDATED' and 'TOKEN_REFRESHED' are never logins.
    const isGenuineLogin = (authEvent === 'SIGNED_IN') &&
      !sessionStorage.getItem('aniumi_oauth_counted_' + user.id);
    if (isGenuineLogin) {
      sessionStorage.setItem('aniumi_oauth_counted_' + user.id, '1');
    }
    let geo = null;
    try { geo = JSON.parse(localStorage.getItem('aniumi_pending_geo') || 'null'); } catch(e){}
    try { localStorage.removeItem('aniumi_pending_geo'); } catch(e){}
    // Only fetch geo on sign-up (first login). If no stashed geo, skip it.
    // Login sessions don't need to re-collect geo data.
    const isFirstLogin = isGenuineLogin && (!profile?.login_count || profile.login_count === 0);
    if (!geo && isFirstLogin) {
      try { geo = await getUserGeo(); } catch(e) { geo = null; }
    } else if (!geo) {
      geo = null; // existing user login — skip geo fetch
    }

    const meta = user.user_metadata || {};
    const googleName  = meta.full_name || meta.name || null;
    const gmail       = meta.email || (user.email && user.email.endsWith('@gmail.com') ? user.email : null);
    const googleImg   = meta.avatar_url || meta.picture || null;
    const currentAvatar = profile?.avatar_url || googleImg || DEFAULT_AVATAR;

    const now = new Date().toISOString();
    const patch = {
      last_login_date:         now,
      google_account_username: profile?.google_account_username || googleName,
      gmail_address:           profile?.gmail_address           || gmail,
      google_profile_image:    profile?.google_profile_image    || googleImg,
      updated_at:              now
    };
    if (geo) {
      patch.ip_address_text = geo.ip             || null;
      patch.country         = geo.country        || null;
      patch.country_code    = geo.country_code   || null;
      patch.state           = geo.state          || null;
      patch.city            = geo.city           || null;
      patch.local_timezone  = geo.local_timezone || geo.timezone || null;
      patch.utc_offset      = geo.utc_offset     || null;
    }
    // Only increment login_count on a genuine new sign-in (not page refresh)
    if (isGenuineLogin) {
      if (profile?.login_count != null) {
        patch.login_count = profile.login_count + 1;
      } else {
        patch.login_count    = 1;
        patch.first_login_date = now;
        patch.account_created_at = now;
      }
    }
    try {
      await supabase.from('profiles').update(patch).eq('user_id', user.id);
    } catch (e) { console.warn('[handleOAuthCallback] update failed:', e); }

    // Persist the Google avatar into the permanent bucket ONCE.
    const alreadyPermanent = currentAvatar && currentAvatar.includes(`/${AVATAR_BUCKET}/`);
    const isDefault        = currentAvatar === DEFAULT_AVATAR;
    if (!alreadyPermanent && !isDefault && googleImg) {
      // Use the original Google URL at higher resolution
      const hiRes = googleImg.replace(/=s\d+-c$/, '=s512-c');
      const permanentUrl = await persistAvatarPermanently(user.id, hiRes);
      // Live-update any visible avatar elements so the user immediately
      // sees the permanent copy.
      if (permanentUrl && permanentUrl !== currentAvatar) {
        ['desktopAvatar','mobAvatar','ddAvatarImg','mobDdAvatarImg','selectedAvatar'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.src = permanentUrl;
        });
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════
     REALTIME  — subscribe to profiles + user_bookmarks.
     When ANY row belonging to this user changes (insert/update/delete),
     the callback fires; we re-fetch the affected data live.
     No manual refresh needed.
  ═══════════════════════════════════════════════════════════ */
  let realtimeInitialised = false;
  function initRealtime(userId) {
    if (realtimeInitialised === userId) return;     // already subscribed for this user
    if (realtimeInitialised) {
      try { supabase.channel('profiles-realtime').unsubscribe(); } catch(e){}
      try { supabase.channel('bookmarks-realtime').unsubscribe(); } catch(e){}
    }
    realtimeInitialised = userId;

    // ── Profile changes (e.g. admin updated avatar, or another device edited) ──
    supabase
      .channel('profiles-realtime')
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'profiles', filter: `user_id=eq.${userId}` },
          (payload) => {
            updateUserUI();
            try { window.dispatchEvent(new CustomEvent('aniumi:profile-changed', { detail: payload })); } catch(e){}
          })
      .subscribe();

    // ── Bookmark changes (this device, another tab, or another device) ──
    supabase
      .channel('bookmarks-realtime')
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'user_bookmarks', filter: `user_id=eq.${userId}` },
          (payload) => {
            try { window.dispatchEvent(new CustomEvent('aniumi:bookmark-changed', { detail: payload })); } catch(e){}
          })
      .subscribe();
  }

  /* ═══════════════════════════════════════════════════════════
     hCAPTCHA RESET HELPER
  ═══════════════════════════════════════════════════════════ */
  function resetHCaptcha() {
    hcaptchaToken = '';
    try {
      // Reset all hCaptcha widgets on the page
      if (window.hcaptcha) {
        document.querySelectorAll('.h-captcha').forEach(el => {
          try { window.hcaptcha.reset(el); } catch(e) {}
        });
      }
    } catch(e) {}
  }

  /* ═══════════════════════════════════════════════════════════
     GLOBAL EXPORTS
  ═══════════════════════════════════════════════════════════ */
  window.supabaseClient   = supabase;
  window.openLoginModal   = () => openModal(0);
  window.signInWithGoogle = () => supabase.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: window.location.origin } });
  window.recordLogin      = recordLogin;
  window.persistAvatar    = persistAvatarPermanently;
  window.getUserGeo       = getUserGeo;
  window.AVATAR_BUCKET    = AVATAR_BUCKET;
  window.AVATAR_BUCKET_URL= AVATAR_BUCKET_URL;

})();
