import { getSql } from './_lib/neon.js';
import { makeColumnHandler } from './_lib/column-handler.js';

export default makeColumnHandler('most_favourite', async () => {
  const sql = getSql();
  const rows = await sql`SELECT most_favourite AS col, most_favourite_updated_at AS ts FROM public.public_frontend_data LIMIT 1`;
  return rows && rows[0];
});
