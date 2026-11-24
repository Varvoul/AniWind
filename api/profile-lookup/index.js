// Vercel Serverless Function: Profile Lookup
// Server-side proxy for the ONLY two profile reads that the client needs
// but can't do through RLS-protected direct queries:
//
//   1. check_exists  — signup flow: is this username/email already taken?
//   2. get_email     — login flow: user entered a username, look up their email
//                      (needed because Supabase Auth only supports email login)
//
// SECURITY:
// - Uses SUPABASE_SERVICE_ROLE_KEY (env var, never client-side) to bypass RLS.
// - Returns MINIMAL data: just { exists: bool } or { email: string|null }.
//   No IPs, locations, login counts, or any other profile fields are exposed.
// - Before this fix, the client could download ALL profiles with all fields.
//   Now the only access is one-at-a-time lookups via this endpoint.
//
// POST /api/profile-lookup
// Body: { action: 'check_exists', field: 'username'|'email', value: '...' }
//   → { exists: true|false }
// Body: { action: 'get_email', username: '...' }
//   → { email: 'user@example.com' | null }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed — use POST' });
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://uhjucwqiadymmogmwkxc.supabase.co';
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_ROLE_KEY) {
    console.error('[profile-lookup] SUPABASE_SERVICE_ROLE_KEY env var is not set');
    return res.status(500).json({ error: 'Server not configured' });
  }

  const { action } = req.body || {};

  try {
    if (action === 'check_exists') {
      // ── Signup uniqueness check ──
      const { field, value } = req.body;
      if (!field || !value) {
        return res.status(400).json({ error: 'Missing field or value' });
      }
      // Whitelist allowed fields to prevent SQL injection via arbitrary column names
      if (!['username', 'email'].includes(field)) {
        return res.status(400).json({ error: 'Invalid field — must be username or email' });
      }

      const url = `${SUPABASE_URL}/rest/v1/profiles?select=user_id&${field}=eq.${encodeURIComponent(value)}&limit=1`;
      const resp = await fetch(url, {
        headers: {
          'apikey': SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'Range': '0-0',
        },
      });

      if (!resp.ok) {
        console.error('[profile-lookup] check_exists failed:', resp.status, await resp.text());
        return res.status(500).json({ error: 'Lookup failed' });
      }

      const data = await resp.json();
      return res.status(200).json({ exists: Array.isArray(data) && data.length > 0 });
    }

    if (action === 'get_email') {
      // ── Login flow: username → email lookup ──
      const { username } = req.body;
      if (!username) {
        return res.status(400).json({ error: 'Missing username' });
      }

      const url = `${SUPABASE_URL}/rest/v1/profiles?select=email&username=eq.${encodeURIComponent(username)}&limit=1`;
      const resp = await fetch(url, {
        headers: {
          'apikey': SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'Range': '0-0',
        },
      });

      if (!resp.ok) {
        console.error('[profile-lookup] get_email failed:', resp.status, await resp.text());
        return res.status(500).json({ error: 'Lookup failed' });
      }

      const data = await resp.json();
      const email = Array.isArray(data) && data.length > 0 ? data[0].email : null;
      return res.status(200).json({ email });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (e) {
    console.error('[profile-lookup] Error:', e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
