# Deploying supabase-search-proxy

I don't have a tool that can deploy Cloudflare Workers directly (my Cloudflare
access is read-only — list/get workers and search docs only), so this last
step needs to happen on your side. It's short:

## 1. Get the two files onto your machine
Copy `wrangler.toml` and `src/index.js` from this folder into a new local
directory called `supabase-search-proxy/`.

## 2. Set the Supabase anon key as a secret
From inside that folder:

    npx wrangler secret put SUPABASE_ANON_KEY

When prompted, paste the same anon key that's already in `shared.js`
(`SUPABASE_ANON_KEY` constant, near the top of the file). This keeps the key
out of the committed Worker source — it lives only in Cloudflare's secret
store for this Worker.

## 3. Deploy

    npx wrangler deploy

Wrangler will print the live URL, something like:

    https://supabase-search-proxy.<your-subdomain>.workers.dev

Your `<your-subdomain>` is account-specific — I saw two different ones across
your existing workers (`bionmovies47` and `zeraf`), so I can't guess it
correctly. You can also find it any time at:
Cloudflare dashboard → Workers & Pages → Overview (top right corner shows
"yoursubdomain.workers.dev").

## 4. Send me that URL
Paste the deployed URL back to me and I'll make the one-line update in
`shared.js` (the `SEARCH_PROXY_URL` placeholder) and commit it — search will
then be fully routed through the rate-limited proxy.

## Sanity-check it yourself (optional)
Once deployed, this should return real results:

    curl -X POST https://supabase-search-proxy.<your-subdomain>.workers.dev/search_anime_data \
      -H "Content-Type: application/json" \
      -d '{"p_query":"one piece","p_match_mode":"contains","p_order_by":"score_desc","p_limit":5}'

And firing that same command ~35 times in a row within a minute should start
returning `429 Rate limit exceeded` partway through — that's the edge limiter
working as intended.
