import { claimSectionForRefresh, commitSectionData, releaseClaim } from './_lib/cache.js';
import { assertValidSection, SECTION_COLUMNS } from './_lib/sections.js';
import { SECTION_FETCHERS } from './_lib/registry.js';

/**
 * Refreshes one section (?section=hero_slider) or every implemented
 * section (no query param — used by the daily cron safety-net sweep).
 * Sections run SEQUENTIALLY, never in parallel, so a multi-section sweep
 * never bursts several sections' worth of upstream API calls at once.
 *
 * Authorization: Vercel's own Cron requests are recognized automatically
 * (x-vercel-cron header). Any other caller — including read.js's
 * fire-and-forget trigger — must present CACHE_REFRESH_SECRET.
 */
export default async function handler(req, res) {
  const isVercelCron = req.headers['x-vercel-cron'] != null;
  const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  const providedSecret = bearer || req.query.secret;
  const secretConfigured = !!process.env.CACHE_REFRESH_SECRET;
  const isAuthorized = isVercelCron || (secretConfigured && providedSecret === process.env.CACHE_REFRESH_SECRET);

  if (!isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let sectionsToRun;
  if (req.query.section) {
    try {
      sectionsToRun = [assertValidSection(req.query.section)];
    } catch (e) {
      return res.status(e.statusCode || 400).json({ error: e.message });
    }
  } else {
    sectionsToRun = Array.from(SECTION_COLUMNS);
  }

  const results = {};
  for (const section of sectionsToRun) {
    const fetcher = SECTION_FETCHERS[section];
    if (!fetcher) {
      results[section] = { skipped: true, reason: 'not implemented yet' };
      continue;
    }

    let won = false;
    try {
      won = await claimSectionForRefresh(section);
    } catch (e) {
      results[section] = { error: `claim failed: ${e.message}` };
      continue;
    }

    if (!won) {
      results[section] = { skipped: true, reason: 'already fresh or currently being refreshed elsewhere' };
      continue;
    }

    try {
      const { data, isComplete } = await fetcher();
      await commitSectionData(section, data, { isComplete, source: 'live' });
      results[section] = {
        refreshed: true,
        isComplete,
        count: Array.isArray(data) ? data.length : undefined,
      };
    } catch (e) {
      await releaseClaim(section).catch(() => {});
      results[section] = { error: e.message };
    }
  }

  return res.status(200).json({ results, ranAt: new Date().toISOString() });
}
