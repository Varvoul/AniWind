import { getSql } from './_lib/neon.js';
import { makeColumnHandler } from './_lib/column-handler.js';

export default makeColumnHandler('recently_completed', async () => {
  const sql = getSql();
  const rows = await sql`SELECT recently_completed AS col, recently_completed_updated_at AS ts FROM public.public_frontend_data LIMIT 1`;
  return rows && rows[0];
});
