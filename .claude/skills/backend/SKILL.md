---
name: backend
description: Rules for the optional Pickup or Delivery backend, a Cloudflare Worker under worker/, and its browser seam src/js/api.js. Covers endpoint contracts, provider adapters, caching, CORS, secrets and fixture-based testing. Load before touching worker/ or api.js.
---

# Backend rules: Pickup or Delivery

The site is **static-first** (decision D-004). Everything must work with no backend. The Worker is an optional upgrade behind one seam. It adds true driving distance, street-level geocoding and independent restaurants. When it's absent, slow or failing, the page silently falls back to the static path.

## Layout

```
worker/
  src/index.js           router: one function per endpoint
  src/providers/*.js     adapters (mapbox.js first). Each exports the same interface
  src/cache.js           Cache API helpers
  wrangler.toml          no secrets in here
tests/unit/worker-*.test.js
tests/fixtures/api/<provider>/<case>.json   recorded upstream responses
```

The Worker never ships to the browser, so **modern JS (ES2022 modules) is allowed in `worker/`**. `src/js/api.js` ships to the browser, so it follows the `frontend` skill: ES5, with `fetch` feature-detected.

## Endpoint contracts

All endpoints are `GET`, return JSON, and use real HTTP status codes. An error is `{"error": {"code": "...", "message": "..."}}` with a 4xx/5xx status, never a 200.

| Endpoint | Returns |
|---|---|
| `/nearest?lat&lon&brand` | `{storeId, address, lat, lon, drivingMiles, drivingMinutes}` |
| `/nearby?lat&lon&radiusMi` | `{places: [{id, name, category, lat, lon, miles}], source}`, which adds independents |
| `/geocode?q=` | `{lat, lon, city, state, zip}` |
| `/fuel?zip&grade` | `{price, asOf, source}` |
| `/vehicle?vin=` | `{year, make, model, mpgCombined, fuelGrade}` |

Validate every parameter (numeric ranges, a 17-character VIN, a known `grade`) and return 400 on bad input.

## Providers

- Each adapter implements the same functions and takes an injected `fetch`, so tests can replace it.
- Store a normalized shape in the cache, never a provider's raw response.
- Cache keys and TTLs: `/nearest` by (ZIP, brand) for 7 days, `/geocode` by normalized query for 30 days, `/fuel` by (state, grade) for 12 hours, `/vehicle` by VIN for 90 days.

## Secrets

- Keys exist only as Worker secrets (`wrangler secret put`) and are read from `env`. **Never** in source, `wrangler.toml`, fixtures or tests.
- Before recording a fixture, scrub tokens out of any URL in it.
- `.dev.vars` is gitignored.

## CORS

Allow the GitHub Pages origin and `null` (the page opened from `file://` sends `Origin: null`). `GET` and `OPTIONS` only.

## The browser seam (api.js)

- It's active only when `POD.config.apiBase` is set. Otherwise every function returns `null` immediately.
- Each call gets a **4-second timeout**. On a timeout, non-2xx status or bad JSON, the seam returns `null`, the caller uses the static path, and at most one `console.warn` is logged per session. Never `console.error`: the e2e tests fail on it.
- Never block the first render on the network.

## Testing

- `node:test`, with the injected `fetch` returning the recorded fixtures. **No live calls in tests, ever.**
- Every endpoint gets a happy path, a bad-input 400, an upstream-failure case and a cache-hit case.
- The browser seam gets tests with the Worker missing, timing out and returning garbage. In each case the page result must equal the static result.

## Learned rules

<!-- The reflector adds rules here. Each one cites its evidence. -->
