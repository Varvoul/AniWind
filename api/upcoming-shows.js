import { getSql } from './_lib/neon.js';
import { makeColumnHandler } from './_lib/column-handler.js';

export default makeColumnHandler('upcoming_shows', async () => {
  const sql = getSql();
  const rows = await sql`SELECT upcoming_shows AS col, upcoming_shows_updated_at AS ts FROM public.public_frontend_data LIMIT 1`;
  return rows && rows[0];
});
