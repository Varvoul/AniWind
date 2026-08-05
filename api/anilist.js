export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed, use POST' });
  }

  try {
    // Read the raw request stream ourselves — Vercel's automatic body
    // parser can come back empty for requests sent without Content-Length
    // (e.g. from Cloudflare Workers' fetch(), which streams chunked).
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString('utf-8');

    let parsed;
    try {
      parsed = rawBody ? JSON.parse(rawBody) : null;
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON body', rawPreview: rawBody.slice(0, 200) });
    }

    const { query, variables } = parsed || {};

    if (!query) {
      return res.status(400).json({ error: 'Missing query in request body', receivedKeys: parsed ? Object.keys(parsed) : null });
    }

    const anilistRes = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ query, variables })
    });

    const data = await anilistRes.json();
    return res.status(anilistRes.status).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Proxy error', message: err.message });
  }
}
