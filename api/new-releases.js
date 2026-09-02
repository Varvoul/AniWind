import { getSql } from './_lib/neon.js';
import { makeColumnHandler } from './_lib/column-handler.js';

export default makeColumnHandler('new_releases', async () => {
  const sql = getSql();
  const rows = await sql`SELECT new_releases AS col, new_releases_updated_at AS ts FROM public.public_frontend_data LIMIT 1`;
  return rows && rows[0];
});
