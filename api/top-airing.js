import { getSql } from './_lib/neon.js';
import { makeColumnHandler } from './_lib/column-handler.js';

export default makeColumnHandler('top_airing', async () => {
  const sql = getSql();
  const rows = await sql`SELECT top_airing AS col, top_airing_updated_at AS ts FROM public.public_frontend_data LIMIT 1`;
  return rows && rows[0];
});
