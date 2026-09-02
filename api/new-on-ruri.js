import { getSql } from './_lib/neon.js';
import { makeColumnHandler } from './_lib/column-handler.js';

export default makeColumnHandler('new_on_ruri', async () => {
  const sql = getSql();
  const rows = await sql`SELECT new_on_ruri AS col, new_on_ruri_updated_at AS ts FROM public.public_frontend_data LIMIT 1`;
  return rows && rows[0];
});
