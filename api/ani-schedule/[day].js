import { getSql, toArray } from '../_lib/neon.js';
import { memoize, setCacheHeaders } from '../_lib/cache.js';

const VALID_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// DB stores day keys capitalized (e.g. "Monday"), matching AniList's own
// day-of-week naming.
function toDbDayKey(day) {
  return day.charAt(0).toUpperCase() + day.slice(1).toLowerCase();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed, use GET' });
  }

  const day = String(req.query.day || '').toLowerCase();
  if (!VALID_DAYS.includes(day)) {
    return res.status(400).json({ error: `Invalid day "${req.query.day}". Use one of: ${VALID_DAYS.join(', ')}` });
  }

  try {
    // One column fetch (+ own timestamp), cached once and shared across all
    // 7 day requests this function instance serves — the /api/ani-schedule/
    // [day] route is a single function handling every day, so this memo
    // really is shared, not duplicated per-day like the column endpoints.
    const scheduleByDay = await memoize('ani_schedule', async () => {
      const sql = getSql();
      const rows = await sql`SELECT ani_schedule AS col, ani_schedule_updated_at AS ts FROM public.public_frontend_data LIMIT 1`;
      const row = rows && rows[0];
      if (!row) return null;
      const raw = (row.col && row.col.Anime) || {};
      const byDay = {};
      for (const [dbDay, val] of Object.entries(raw)) byDay[dbDay] = toArray(val);
      return { byDay, updated_at: row.ts };
    });

    if (!scheduleByDay) {
      return res.status(404).json({ error: 'ani_schedule has no row' });
    }

    setCacheHeaders(res);
    return res.status(200).json({
      data: scheduleByDay.byDay[toDbDayKey(day)] || [],
      updated_at: scheduleByDay.updated_at, // this column's own timestamp — never the row's
    });
  } catch (err) {
    return res.status(500).json({ error: 'DB fetch failed', message: err.message });
  }
}
