import { memoize, setCacheHeaders, getCacheInfo } from '../_lib/cache.js';

// ─────────────────────────────────────────────────────────────────────────
// TVMaze Schedule API Endpoint
// 
// Fetches TV show schedules from TVMaze API for multiple countries
// Returns day-based schedule data (similar to anime schedule structure)
// Server-side cached for 24 hours
//
// ENDPOINT: /api/tvmaze-schedule/[day]
// EXAMPLE: /api/tvmaze-schedule/monday
//
// Countries supported: US, GB, JP, AU, DE, FR, CA (major markets)
// Rate limiting: 200ms delay between country requests to respect TVMaze API
//
// V4.7.2 FIXED: Uses correct TVMaze API date format (YYYY-MM-DD)
// ─────────────────────────────────────────────────────────────────────────

const VALID_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Day name to TVMaze day index (0=Sunday, 1=Monday, etc.)
const DAY_TO_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};

// Countries to fetch schedules for (ISO 3166-1 alpha-2 codes)
const SCHEDULE_COUNTRIES = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'JP', name: 'Japan' },
  { code: 'AU', name: 'Australia' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'CA', name: 'Canada' }
];

// TVMaze API base URL
const TVMAZE_BASE = 'https://api.tvmaze.com';

// Cache TTL for TVMaze data (24 hours)
const TVMAZE_CACHE_MS = 24 * 60 * 60 * 1000;
const TVMAZE_CACHE_SECONDS = TVMAZE_CACHE_MS / 1000;

// In-memory store for TVMaze cache (separate from main cache)
const tvmazeStore = new Map();

/**
 * Get today's date or a nearby date for the given day of week
 * Returns a Date object set to the specified day of the current week
 */
function getDateForDay(dayName) {
  const now = new Date();
  const currentDay = now.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
  const targetDay = DAY_TO_INDEX[dayName];
  
  if (targetDay === undefined) return now;
  
  // Calculate difference in days
  let diff = targetDay - currentDay;
  
  // If diff is negative, we want next week's day; if positive, this week or last week
  // We want the closest future occurrence (or today if it matches)
  if (diff < 0) diff += 7;
  
  const result = new Date(now);
  result.setDate(now.getDate() + diff);
  return result;
}

/**
 * Format date as YYYY-MM-DD for TVMaze API
 */
function formatDateForTVMaze(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Fetch TV schedule for a specific country and date from TVMaze API
 * TVMaze API: /schedule?country={code}&date={YYYY-MM-DD}
 */
async function fetchTVMazeSchedule(countryCode, dateString) {
  const url = `${TVMAZE_BASE}/schedule?country=${countryCode}&date=${encodeURIComponent(dateString)}`;
  
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Ruristream/1.0 (https://ruristream.vercel.app)'
    },
    // 10 second timeout for TVMaze API
    signal: AbortSignal.timeout(10000)
  });
  
  if (!response.ok) {
    throw new Error(`TVMaze API error: ${response.status} ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Fetch and cache TVMaze schedule for ALL countries for a specific day
 * Returns object with country codes as keys and arrays of shows as values
 */
async function loadTVMazeScheduleForDay(day) {
  const dayLower = day.toLowerCase();
  const cacheKey = `tvmaze_${dayLower}`;
  
  // Check cache first
  const cached = tvmazeStore.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    cached.hitCount = (cached.hitCount || 0) + 1;
    return cached.data;
  }
  
  // Get the date for this day of week
  const targetDate = getDateForDay(dayLower);
  const dateString = formatDateForTVMaze(targetDate);
  
  const scheduleByCountry = {};
  const errors = [];
  
  // Fetch from all countries with rate limiting
  for (let i = 0; i < SCHEDULE_COUNTRIES.length; i++) {
    const country = SCHEDULE_COUNTRIES[i];
    
    try {
      const shows = await fetchTVMazeSchedule(country.code, dateString);
      
      // Transform TVMaze data to our format
      scheduleByCountry[country.code] = (shows || []).map(show => ({
        id: show.id,
        name: show.show?.name || 'Unknown Show',
        original_name: show.show?.name,
        poster: show.show?.image?.medium || show.show?.image?.original || null,
        backdrop: show.show?.image?.original || null,
        type: 'TV',
        sub_type: 'tvmaze',
        episode_number: show.number || null,
        season_number: show.season || null,
        episode_name: show.name || null,
        airtime: show.airtime || '',
        airstamp: show.airstamp || null,
        runtime: show.show?.runtime || null,
        genres: show.show?.genres || [],
        rating: show.show?.rating?.average || null,
        network: show.show?.network?.name || show.show?.webChannel?.name || null,
        country: country.code,
        country_name: country.name,
        show_id: show.show?.id,
        status: show.show?.status || 'Running',
        summary: show.show?.summary?.replace(/<[^>]*>/g, '') || '',
        url: show.show?.url || `https://www.tvmaze.com/shows/${show.show?.id}`,
        _source: 'tvmaze',
        _fetchedAt: new Date().toISOString()
      }));
      
      console.log(`[TVMaze] Fetched ${scheduleByCountry[country.code].length} shows for ${country.code} ${dayLower} (${dateString})`);
      
    } catch (error) {
      errors.push({ country: country.code, error: error.message });
      console.error(`[TVMaze] Error fetching ${country.code} ${dayLower}:`, error.message);
    }
    
    // Rate limiting: wait 200ms between requests (except after last one)
    if (i < SCHEDULE_COUNTRIES.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  const result = {
    day: dayLower,
    date: dateString,
    countries: scheduleByCountry,
    total_shows: Object.values(scheduleByCountry).reduce((sum, shows) => sum + shows.length, 0),
    countries_with_data: Object.keys(scheduleByCountry).length,
    errors: errors.length > 0 ? errors : undefined,
    fetched_at: new Date().toISOString(),
    cache_ttl_hours: 24
  };
  
  // Cache the result
  tvmazeStore.set(cacheKey, {
    data: result,
    expiresAt: Date.now() + TVMAZE_CACHE_MS,
    fetchedAt: new Date().toISOString(),
    hitCount: 1
  });
  
  return result;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed, use GET' });
  }

  const day = String(req.query.day || '').toLowerCase();
  
  if (!VALID_DAYS.includes(day)) {
    return res.status(400).json({ 
      error: `Invalid day "${req.query.day}". Use one of: ${VALID_DAYS.join(', ')}`,
      valid_days: VALID_DAYS,
      _version: '4.7.2'
    });
  }

  try {
    const scheduleData = await loadTVMazeScheduleForDay(day);
    
    // Set cache headers (24h for TVMaze data)
    res.setHeader('Cache-Control', `public, s-maxage=${TVMAZE_CACHE_SECONDS}, stale-while-revalidate=43200`);
    res.setHeader('Vercel-CDN-Cache-Control', `public, s-maxage=${TVMAZE_CACHE_SECONDS}`);
    
    // Return response with cache info
    const response = {
      ...scheduleData,
      _cache: getCacheInfo(`tvmaze_${day}`),
      _version: '4.7.2',
      _timestamp: new Date().toISOString(),
      _endpoint: 'tvmaze-schedule'
    };
    
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('[TVMaze Schedule] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch TVMaze schedule',
      message: error.message,
      _version: '4.7.2',
      _timestamp: new Date().toISOString()
    });
  }
}
