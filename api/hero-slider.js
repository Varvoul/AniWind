import { getSql } from './_lib/neon.js';
import { makeColumnHandler } from './_lib/column-handler.js';

export default makeColumnHandler('hero_slider', async () => {
  const sql = getSql();
  const rows = await sql`SELECT hero_slider AS col, hero_slider_updated_at AS ts FROM public.public_frontend_data LIMIT 1`;
  return rows && rows[0];
});
