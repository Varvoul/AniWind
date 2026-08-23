import { readAllSectionStatus } from './_lib/cache.js';

const CACHE_CYCLE_HOURS = 6;

export default async function handler(req, res) {
  try {
    const row = await readAllSectionStatus();
    if (!row) return res.status(404).json({ error: 'cache row not found — has the migration been applied?' });

    const cycleStart = new Date(row.cache_cycle_started_at);
    const serverNow = new Date(row.server_now);
    const ageSeconds = Math.floor((serverNow - cycleStart) / 1000);
    const expiresInSeconds = Math.max(0, CACHE_CYCLE_HOURS * 3600 - ageSeconds);

    return res.status(200).json({
      cache_cycle_started_at: row.cache_cycle_started_at,
      last_full_refresh_at: row.last_full_refresh_at,
      cycle_age_seconds: ageSeconds,
      cycle_expires_in_seconds: expiresInSeconds,
      sections: row.sections,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
