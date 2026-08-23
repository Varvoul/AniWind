import { neon } from '@neondatabase/serverless';

let sqlClient = null;

/**
 * Returns the shared Neon SQL tagged-template function. Reads the
 * privileged owner connection string from an env var that is ONLY ever
 * set in Vercel's server-side environment — never shipped to the browser,
 * never committed to the repo.
 */
export function getSql() {
  if (!sqlClient) {
    const url = process.env.NEON_DATABASE_URL;
    if (!url) {
      throw new Error(
        'NEON_DATABASE_URL is not set. Add it in Vercel → Project Settings → Environment Variables (server-side only, do not expose to the client).'
      );
    }
    sqlClient = neon(url);
  }
  return sqlClient;
}
