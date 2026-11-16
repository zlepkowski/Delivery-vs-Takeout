# The Pickup or Delivery Worker

The optional backend behind the site (D-004, D-040). It answers three questions with OpenStreetMap data:

| Endpoint | Answers |
|---|---|
| `GET /drive?from=LAT,LON&to=LAT,LON` | the driving distance and time between two points (OSRM) |
| `GET /geocode?q=TEXT` | a street address or town to a point (Nominatim) |
| `GET /nearby?lat=LAT&lon=LON&radius=2\|5\|10` | independent restaurants near a point (Overpass) |

The site works with no Worker at all. The Worker is an upgrade: the page falls back to its built-in estimates whenever the Worker is off, slow or failing. The full contract is [`docs/api-contract.md`](../docs/api-contract.md).

No API keys are needed. The Worker has no runtime or dev dependencies.

## Deploy

1. Have a Cloudflare account, and install Wrangler (`npm install -g wrangler`) or use `npx wrangler`.
2. Create the cache namespace and copy the id it prints:
   ```sh
   cd worker
   wrangler kv namespace create POD_CACHE
   ```
   Uncomment the `[[kv_namespaces]]` block in `wrangler.toml` and replace the placeholder `id` with that id.
3. Set the User-Agent. OSM's services ask each deployment to identify itself, so use an app name and a contact address you're willing to publish:
   ```sh
   wrangler secret put USER_AGENT
   ```
   The Worker answers `503 not_configured` until this is set. Never commit the value.
4. Check `ALLOW_ORIGINS` in `wrangler.toml` (default `https://zlepkowski.github.io`). It's a comma-separated list of exact origins. The page opened from `file://` (origin `null`) is always allowed.
5. Deploy:
   ```sh
   wrangler deploy
   ```
6. Point the site at the Worker. In `src/js/config.js`, set `POD.config.apiBase` to the Worker's URL, for example `"https://pickup-or-delivery.<your-subdomain>.workers.dev"`, with no trailing slash. Leaving it `""` turns the Worker off.

## Configuration

Set in `wrangler.toml` `[vars]` (not secret):

- `OSRM_URL`, `NOMINATIM_URL`, `OVERPASS_URL`: the provider base URLs. Defaults are the public servers. A trailing `/` is removed. Any `https://` host running the same software works, for example a mirror of Overpass or your own OSRM.
- `ALLOW_ORIGINS`: the origins allowed to read responses from the browser.

Set as a secret: `USER_AGENT` (see step 3).

Bound in `wrangler.toml`: `POD_CACHE`, a Workers KV namespace. It's optional. Without it, every request goes upstream.

## Cache

The KV cache keeps the normalized answers (never a provider's raw response):

| Endpoint | Key | Answer TTL | Miss TTL |
|---|---|---|---|
| `/drive` | the two canonical points | 7 days | 1 day (no route) |
| `/geocode` | SHA-256 of the lowercase query | 30 days | 1 day (not found) |
| `/nearby` | the point and radius | 7 days | none |

A KV error is ignored: the request is answered as if it were uncached.

## Usage limits

The Worker uses the public OSM services, so keep within their policies:

- **OSRM** (`router.project-osrm.org`): reasonable non-commercial use, about 1 request per second, with no uptime promise.
- **Nominatim** (`nominatim.openstreetmap.org`): at most 1 request per second, with caching. Results must be cached and the OSM attribution shown.
- **Overpass** (`overpass-api.de`): fair use, with query-rate limits. A `429` or `504` shows up as a `502 upstream` to the page.
- **OpenStreetMap data** is © OpenStreetMap contributors, licensed under ODbL. The site's fine print credits it.

The KV cache keeps a small site well under these limits. A busy site should run its own OSRM server or switch providers. Each provider lives behind one adapter in `src/providers/`.

## Develop and test

From the repo root:

```sh
node --test tests/unit/worker-cases.test.js
```

The tests run the Worker's `handle()` against the recorded fixtures in `tests/fixtures/api/` with an injected `fetch`. Nothing reaches the network. Never add a live call to a test.

## Files

- `src/index.js`: the router, parameter checks, CORS and the cache flow (`handle`, and the default `fetch` export).
- `src/providers/osrm.js`, `nominatim.js`, `overpass.js`: one adapter per provider. Each returns `{ok}`, `{miss}` or `{error}`.
- `src/cache.js`: the KV helpers and the SHA-256 cache key.
- `src/util.js`: responses, CORS, coordinates, the distance and the upstream GET.
- `wrangler.toml`: the non-secret configuration.
