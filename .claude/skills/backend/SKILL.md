---
name: backend
description: Rules for the optional Pickup or Delivery backend, a Cloudflare Worker under worker/, and its browser seam src/js/api.js. Covers endpoint contracts, provider adapters, caching, CORS, secrets and fixture-based testing. Load before touching worker/ or api.js.
---

# Backend rules: Pickup or Delivery

The site is **static-first** (decision D-004). Everything must work with no backend. The Worker is an optional upgrade behind one seam. It adds true driving distance, street-level geocoding and independent restaurants. When it's absent, slow or failing, the page silently falls back to the static path.

## Layout

```
worker/
  src/index.js                 router: handle(request, env, deps); validation, CORS, responses
  src/providers/osrm.js        one adapter per provider: nominatim.js, overpass.js
  src/cache.js                 Workers KV helpers (env.POD_CACHE)
  src/util.js                  shared helpers
  wrangler.toml                no secrets in here
  README.md                    deploy steps
tests/unit/worker.test.js, worker-cases.test.js, api-cases.test.js, api-send.test.js
tests/e2e/worker.e2e.js
tests/fixtures/api/build.py -> cases.json     the case table (references first)
tests/fixtures/api/{osrm,nominatim,overpass}/ recorded answers (the overpass ones are constructed, ISS-040)
```

The Worker never ships to the browser, so **modern JS (ES2022 modules) is allowed in `worker/`**. `src/js/api.js` ships to the browser, so it follows the `frontend` skill: ES5, and it talks to the Worker with `XMLHttpRequest` (no `fetch`), like the VIN lookup.

## Endpoint contracts

**`docs/api-contract.md` (D-040) is the spec, and it wins over this skill wherever they differ.** Read its §0–§5 before touching `worker/`. In short:

- `GET /drive?from=LAT,LON&to=LAT,LON`: one-way road miles and minutes (OSRM). A straight line over 100 mi is 400 `too_far`.
- `GET /geocode?q=TEXT`: a typed street address to a point, US only (Nominatim). The ZIP still comes from the ZIP table (frontend skill).
- `GET /nearby?lat=&lon=&radius=2|5|10`: independent restaurants only; chains are dropped, since the store tiles list them (Overpass).
- Errors: `{"error": {"code", "message"}}` with the real status. Codes: `bad_param` 400, `too_far` 400, `no_endpoint` 404, `no_route` 404, `not_found` 404, `method` 405, `upstream` 502, `not_configured` 503 (`USER_AGENT` missing). `OPTIONS` is 204; every JSON response is `Cache-Control: no-store`.
- Validate every parameter (each named one exactly once, in range) before any upstream call or cache read.

## Providers

- OpenStreetMap only (D-040): OSRM, Nominatim, Overpass. No keys. Each adapter exports the same shape and takes `deps.fetch`, so tests replace it.
- Every upstream call sends `User-Agent: {USER_AGENT}` and an `AbortSignal.timeout`: 3.5 s for OSRM and Nominatim, 9 s for Overpass.
- Return the normalized body (contract §2–§4), never the provider's raw answer.

## Cache

- Workers KV (`env.POD_CACHE`), not the Cache API, which does nothing on a `workers.dev` address. Keys and TTLs: contract §5. A 200 stores `{"ok": body}`, a `no_route` or `not_found` stores `{"miss": code}`, nothing else is stored.
- The cache is optional. A missing binding, or a `get`/`put` that throws or doesn't settle within 1 s, means "uncached": it never fails the request.

## Secrets

- No keys exist. `USER_AGENT` (a site name and a contact, per OSM's policy) is set at deploy time: never in source, `wrangler.toml`, fixtures or tests.
- Before recording a fixture, scrub tokens and contact details out of any URL in it.
- `.dev.vars` is gitignored.

## CORS

Allow `null` (a page opened from `file://` sends `Origin: null`) and the exact origins in `ALLOW_ORIGINS`. Always send `Vary: Origin`. `GET` and `OPTIONS` only. No `Access-Control-Allow-Headers`: the seam sends no custom headers.

## The browser seam (api.js)

Spec: contract §6. In short:

- Active only when `POD.config.apiBase` is an `http(s)://` string. The committed value is `""`, so the Worker is off and the page is Phase 7's, byte for byte.
- Timeouts: 4 s for drive and geocode, 10 s for nearby. A timeout, non-200 status, bad JSON or failed check gives `null`, and the caller uses the static estimate.
- One `console.warn` per page load. Never `console.error`: the e2e tests fail on it.
- Answers are stored under the exact inputs they were asked with, so a late answer is never read for a newer position. Never block the first render on the network.

## Testing

- `node:test` on fakes: the Worker takes `deps.fetch`, and `worker.test.js` also installs a throwing global `fetch` guard (f53891b). **No live calls in tests, ever.**
- Every endpoint gets a happy path, a bad-input 400, an upstream failure (502), a cache hit and a cache miss. Every provider's timeout is checked.
- `worker-cases.test.js` runs `cases.json`; `api-cases.test.js` runs the seam cases in the VM; `api-send.test.js` pins `send()` with a fake XHR.
- The Worker-off guarantee is an e2e against the page built from `556bc34`, not against the new code (test-runner skill).

## Learned rules

<!-- The reflector adds rules here. Each one cites its evidence. -->
- **Bound every upstream and KV call in time.** A KV `get` that never settled held a request open forever (blocker). Each KV call now races a 1 s timer, and each provider call has its own `AbortSignal` timeout that a test checks (eaa7be9 blocker; per-provider tests in f53891b).
- **A cached value is a hit only if it has the shape the code stored.** A KV `{"ok": null}` was served as a 200 (7c0ab6d, found in review of f53891b). Anything else is a miss and goes upstream.
- **Parse provider and user values by an explicit grammar, never by `Number()` alone.** `Number("")` and `Number(null)` are 0, and Nominatim sends lat/lon as strings. Lengths count UTF-16 units (`.length`) in the Worker and the seam alike (eaa7be9 review; contract §1 and §3 clarified in be8813f).
- **An OSM id must be a safe integer.** A `1e21` id printed as `osm:n1e+21` (eaa7be9 review): check `Number.isSafeInteger` before building the id.
