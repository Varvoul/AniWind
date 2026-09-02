import { getSql } from './_lib/neon.js';
import { makeColumnHandler } from './_lib/column-handler.js';

export default makeColumnHandler('trending_now', async () => {
  const sql = getSql();
  const rows = await sql`SELECT trending_now AS col, trending_now_updated_at AS ts FROM public.public_frontend_data LIMIT 1`;
  return rows && rows[0];
});
