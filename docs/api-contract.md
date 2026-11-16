# API contract (v5, Phase 8)

The exact definition of the optional backend (D-004, D-040): a Cloudflare Worker under `worker/`, and the browser seam `POD.api` in `src/js/api.js`. The Worker answers three questions with OpenStreetMap data: the **driving distance** to a store (OSRM), a **street address** (Nominatim), and the **independent restaurants** near a point (Overpass). **Where this file and the backend skill or BUILD.md §11 Phase A differ, this file wins.** Change it only by a decision. The references (`tests/fixtures/api/build.py`, the state scenarios) change first, the code after.

**The one rule above all: with the Worker off, the site is exactly what it was.** "Off" means `POD.config.apiBase` is `""` (the committed value). Then `POD.opts.api` is never created, every state function takes its Phase 7 path (each amendment below starts with "if `opts.api` is an object"), `POD.api.asks` returns `[]`, and the page makes no request it didn't make before. A Worker that is on but slow, failing or answering garbage gives the same prices as off.

## 0. Rules for the Worker (`worker/`)

- **Modern JS**: ES2022 modules (`worker/package.json` is `{"private": true, "type": "module"}`). The ES5 gate covers `src/` only. **No dependencies**, runtime or dev: tests run on Node 22's own `fetch`, `Request`, `Response`, `URL`, `URLSearchParams`, `TextEncoder`, `crypto.subtle` and `AbortSignal.timeout`, which Workers also provide.
- **Injected I/O.** `worker/src/index.js` exports `handle(request, env, deps)` and `export default { fetch(request, env, ctx) { return handle(request, env, { fetch: globalThis.fetch, now: Date.now }); } }`. Every upstream call goes through `deps.fetch`, so tests never touch the network. **No live calls in tests, ever.**
- **`env`** (Worker vars and bindings; none are committed with real values):
  - `USER_AGENT`: required. OSM's services ask each deployment to identify itself; it's set at deploy time (`wrangler secret put USER_AGENT` or a dashboard variable), never committed. Missing or empty → every data endpoint answers **503 `not_configured`** before any upstream call or cache read.
  - `ALLOW_ORIGINS`: comma-separated exact origins (e.g. `https://zlepkowski.github.io`); whitespace around commas ignored. Missing → only `null`.
  - `OSRM_URL` (default `https://router.project-osrm.org`), `NOMINATIM_URL` (default `https://nominatim.openstreetmap.org`), `OVERPASS_URL` (default `https://overpass-api.de/api/interpreter`). A trailing `/` is removed. Any `https://` host running the same software works (Overpass mirrors exist; ISS-040).
  - `POD_CACHE`: an optional Workers KV binding (§5). Missing → no caching; everything else is the same.
- **Secrets:** none are needed: OSRM, Nominatim and Overpass take no key. Never put a key, token or contact address in source, `wrangler.toml`, fixtures or tests.
- Files: `worker/src/index.js` (router, validation, CORS, responses), `worker/src/providers/osrm.js`, `nominatim.js`, `overpass.js` (§4), `worker/src/cache.js` (§5), `worker/src/util.js` (shared helpers), `worker/wrangler.toml`, `worker/README.md` (deploy steps).

## 1. HTTP rules (every request)

| Request | Response |
|---|---|
| `OPTIONS` any path | **204**, empty body, CORS headers + `Access-Control-Allow-Methods: GET, OPTIONS` + `Access-Control-Max-Age: 86400` |
| method other than `GET`/`OPTIONS` | **405** `method`, plus `Allow: GET, OPTIONS` |
| `GET /drive`, `/geocode`, `/nearby` | §2, §3, §4 |
| `GET` any other path (including `/`) | **404** `no_endpoint` |

- **JSON responses** (every status except 204): `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store` (the KV cache, §5, is the cache). An error is `{"error": {"code": C, "message": M}}` with the status below, never a 200. `M` is a fixed non-empty English sentence per code.

| Code | Status | When |
|---|---|---|
| `bad_param` | 400 | a parameter is missing, repeated, malformed or out of range |
| `too_far` | 400 | `/drive`'s two points are more than 100 mi apart in a straight line |
| `no_endpoint` | 404 | unknown path |
| `no_route` | 404 | OSRM found no road route |
| `not_found` | 404 | Nominatim found nothing |
| `method` | 405 | not `GET`/`OPTIONS` |
| `upstream` | 502 | the provider failed, timed out, or answered something §4 doesn't accept |
| `not_configured` | 503 | `USER_AGENT` missing or empty |

- **CORS.** Let `o` = the request's `Origin` header. If `o` is `"null"` (a page opened from `file://`) or one of `ALLOW_ORIGINS`: add `Access-Control-Allow-Origin: o`. Otherwise add none (the browser then refuses to read it; the Worker still answers, since the data is public). Always add `Vary: Origin`. No `Access-Control-Allow-Headers`: the seam sends simple GETs with no custom headers, so there's no preflight.
- **Parameters** come from `URLSearchParams`. Each named parameter must appear **exactly once**; extra unknown parameters are ignored. Order of checks for an endpoint: method/path, then `USER_AGENT` (503), then parameters (400), then the cache (§5), then the provider.
- **Coordinates.** A coordinate parameter matches `^-?[0-9]{1,3}(\.[0-9]{1,6})?$`; the latitude is in [−90, 90], the longitude in [−180, 180]. Its **canonical string** is `String(Number(s))` (`"45.830"` → `"45.83"`, `"-0"` → `"0"`). Canonical strings are used in upstream URLs and cache keys.
- **Rounding.** `round2(x) = Math.round(x * 100) / 100`, `round1(x) = Math.round(x * 10) / 10` (JS `Math.round`: halves go up). `distMi` is geography contract §2 exactly (`R_MI` 3958.8).

## 2. `GET /drive?from=LAT,LON&to=LAT,LON`

The one-way driving distance and time between two points, for a store the page already found (D-005's tiles), replacing straight line × 1.25.

- `from` and `to` each `LAT,LON`: two coordinates (§1) joined by one comma, no spaces. Else 400 `bad_param`. `distMi(from, to) > 100` → 400 `too_far`.
- **Upstream** (`osrm.route`): `GET {OSRM_URL}/route/v1/driving/{fromLon},{fromLat};{toLon},{toLat}?overview=false&alternatives=false&steps=false` with canonical strings, header `User-Agent: {USER_AGENT}`, timeout 3.5 s (`AbortSignal.timeout(3500)`).
- **Normalizing:**
  - status 200, the body parses as JSON, `code === "Ok"`, and `routes[0].distance` and `routes[0].duration` are finite numbers ≥ 0 → **200** `{"miles": round2(distance / 1609.344), "minutes": round1(duration / 60), "source": "osrm"}`.
  - the body parses and `code === "NoRoute"` (OSRM sends it with status 400) → **404** `no_route`.
  - anything else (another status or code, unparsable body, a missing or non-finite field, a rejected or timed-out fetch) → **502** `upstream`.
- Recorded: Big Timber 59011's centroid (45.834, −109.95) → the Livingston Domino's (45.67, −110.546) is 54,552.2 m: **33.9 mi**. BUILD.md §8 says the real drive is ~33 mi; straight line × 1.25 said 38.6.

## 3. `GET /geocode?q=TEXT`

A street address (or town) to a point.

- `q`: trimmed, every run of whitespace (`/\s+/`) collapsed to one space; then 3–200 characters, none below U+0020. Else 400 `bad_param`. This normalized `q` keeps its case and goes upstream; its lowercase form is the cache key.
- **Upstream** (`nominatim.geocode`): `GET {NOMINATIM_URL}/search?` + `new URLSearchParams([["q", q], ["format", "jsonv2"], ["addressdetails", "1"], ["limit", "1"], ["countrycodes", "us"]])`, header `User-Agent`, timeout 3.5 s.
- **Normalizing:** status 200 and the body parses as a JSON array:
  - empty → **404** `not_found`.
  - first element `r`: `lat = Number(r.lat)`, `lon = Number(r.lon)` (Nominatim sends strings) must be finite and in range, and `r.address` an object, else 502 `upstream`. Then **200** `{"lat", "lon", "city", "state", "zip", "label", "source": "nominatim"}` with
    - `city`: the first of `address.city`, `address.town`, `address.village`, `address.hamlet` that is a non-empty string, else `null`;
    - `state`: the two letters of `address["ISO3166-2-lvl4"]` when it matches `^US-([A-Z]{2})$`, else `null`;
    - `zip`: the first 5 characters of `address.postcode` when it's a string matching `^[0-9]{5}`, else `null`;
    - `label`: `r.display_name` when a string, else `null`.
  - anything else → 502 `upstream`.

## 4. `GET /nearby?lat=LAT&lon=LON&radius=R`: independent restaurants

- `lat`, `lon`: coordinates (§1). `radius` is exactly `"2"`, `"5"` or `"10"` (miles). Else 400 `bad_param`.
- **Upstream** (`overpass.places`): `GET {OVERPASS_URL}?` + `new URLSearchParams([["data", Q]])`, header `User-Agent`, timeout 9 s, where `Q` is exactly
  `[out:json][timeout:8];nwr["amenity"~"^(restaurant|fast_food|cafe|ice_cream)$"]["name"](around:{M},{lat},{lon});out center tags;`
  with `M = Math.round(R * 1609.344)` (2 → 3219, 5 → 8047, 10 → 16093) and canonical `lat`, `lon`. (`URLSearchParams` encodes `~` as `%7E`, space as `+`.)
- **Normalizing:** status 200, the body parses as a JSON object, and `elements` is an array, else 502. If `remark` is a string containing `"runtime error"` → 502: Overpass sends a timed-out query's partial results with status 200, and a partial list would silently drop places. Then each element, in order:
  1. skip unless `type` is `"node"`, `"way"` or `"relation"`, `id` is an integer ≥ 1, and `tags` is a plain object;
  2. the point: a node's `lat`, `lon`; a way's or relation's `center.lat`, `center.lon`. Skip unless finite and in range;
  3. `name` = `tags.name` trimmed; skip unless a string of 1–120 characters;
  4. **skip chains**: an element with a non-empty string `tags.brand` or `tags["brand:wikidata"]`. Chains come from the store tiles (D-021), so a chain is never listed twice;
  5. skip unless `tags.amenity` is one of `restaurant`, `fast_food`, `cafe`, `ice_cream`;
  6. `category`: **D-021's rule** on this element: the first `;`-token of `tags.cuisine`, trimmed and lowercased: pizza → `pizza`; burger → `burger`; chicken, wings, fried_chicken → `chicken`; mexican, tex-mex, tacos, burrito → `mexican`; sandwich, sub, deli, bagel → `sandwich`; chinese, japanese, asian, sushi, thai, korean, vietnamese, indian, ramen, noodle → `asian`; coffee_shop, coffee, donut, tea, bubble_tea → `coffee`; ice_cream, frozen_yogurt, dessert, cake, cookies, juice, smoothie → `dessert`; else by `amenity`: restaurant → `casual`, cafe → `coffee`, ice_cream → `dessert`, fast_food → `other`;
  7. `id` = `"osm:"` + the type's first letter + the id (`osm:n123`, `osm:w45`, `osm:r6`); skip an id already kept;
  8. `d = distMi(lat, lon of the query (as numbers), point)`; skip if `d > R`.
  Sort the kept places by `d`, then by `id` (codepoint order); keep the first **40**. **200** `{"places": [{"id", "name", "category", "lat", "lon", "miles": round2(d)}], "radius": R (a number), "source": "osm"}` (`lat`, `lon` as Overpass gave them). An empty list is a 200.
  A rejected or timed-out fetch, or any other status (429 and 504 are common) → 502.

## 5. Cache (`worker/src/cache.js`, Workers KV)

- With `env.POD_CACHE`: before the provider, `await POD_CACHE.get(key, "json")`; a stored `{"ok": body}` → that 200; a stored `{"miss": code}` → that 404. After the provider: a 200 stores `{"ok": body}`, a `no_route`/`not_found` stores `{"miss": code}`, via `await POD_CACHE.put(key, JSON.stringify(v), {expirationTtl: ttl})`. Nothing else is stored (no 400, 502 or 503). A `get` or `put` that throws or rejects is ignored: the request goes on as if uncached, and never fails because of the cache.
- Keys and TTLs (seconds):

| Endpoint | Key | 200 TTL | miss TTL |
|---|---|---|---|
| `/drive` | `v1:drive:{from};{to}` (canonical `lat,lon` strings) | 604800 (7 d) | 86400 |
| `/geocode` | `v1:geocode:` + SHA-256 hex (lowercase) of the UTF-8 lowercase normalized `q` (KV keys are capped at 512 bytes) | 2592000 (30 d) | 86400 |
| `/nearby` | `v1:nearby:{lat},{lon}/{R}` | 604800 (7 d) | — |

- The stored body is the normalized response (§2–§4), never the provider's raw answer.

## 6. The browser seam `POD.api` (`src/js/api.js`, ES5)

`src/js/config.js` (new, loaded right after `pod.js`) sets `POD.config = POD.config || {}` and `POD.config.apiBase = ""` unless it's already a string. Deploying with the Worker means setting `apiBase` there (the Pages build may write it; §9). `api.js` loads after `geo.js` and before `state.js`.

**Pure functions** (read only their arguments; never throw; bad input → `null`, `asks` → `[]`):

| Function | Returns |
|---|---|
| `enabled()` | `true` iff `POD.config.apiBase` is a string matching `^https?://[^\s]+$` (reads `POD.config`; the only impure one besides `remember`, `send`) |
| `fmt3(x)` | `k = Math.round(x * 1000)`; the sign `"-"` when `k < 0`, then `Math.floor(|k| / 1000)`, `"."`, and `|k| % 1000` padded to 3 digits. `fmt3(45.834)` = `"45.834"`, `fmt3(-109.95)` = `"-109.950"`, `fmt3(-0.0004)` = `"0.000"`. `null` unless `x` is a finite number |
| `point(lat, lon)` | `fmt3(lat) + "," + fmt3(lon)`, `null` unless both are finite and in range |
| `driveKey(pos, store)` | `point(pos) + ";" + point(store)` for two objects with `lat`, `lon`; else `null` |
| `geoQuery(text)` | `text` trimmed with whitespace runs collapsed to one space, when it's a string of 3–200 characters with no character below U+0020 **and at least one letter `[A-Za-z]`**; else `null`. (Digits only, like a bare ZIP, stay on the ZIP table.) |
| `geoKey(text)` | `geoQuery(text).toLowerCase()`, or `null` |
| `nearbyKey(pos, r)` | `point(pos) + "/" + r` |
| `nameKey(s)` | `s` lowercased with everything but `[a-z0-9]` removed; `null` unless a string |
| `checkDrive(b)` | `{miles, minutes}` when `b` is an object with finite `miles` in [0, 1000] and finite `minutes` ≥ 0; else `null` |
| `checkGeocode(b)` | `{lat, lon, zip, state}` when `lat`, `lon` are finite and in range, `zip` is `null` or matches `^[0-9]{5}$`, `state` is `null` or matches `^[A-Z]{2}$`; else `null` |
| `checkNearby(b)` | `{places}` when `b.places` is an array, keeping (in order) each place with `id` matching `^osm:[nwr][1-9][0-9]{0,15}$`, `name` a string of 1–120 characters, `category` one of the 10 D-021 categories (`pizza burger chicken mexican sandwich asian coffee dessert casual other`), and valid `lat`, `lon`; each kept as a new `{id, name, category, lat, lon}`. Else `null` |
| `asks(S, D, opts)` | the requests the page should send now (§6.1) |
| `placesFor(S, D, opts)` | the independent rows to show (§6.2) |
| `NEARBY_RADII` `[2, 5, 10]`, `NEARBY_WANT` `10`, `NEARBY_SHOW` `10`, `TIMEOUT_MS` `4000`, `NEARBY_TIMEOUT_MS` `10000` | constants |

### 6.1 `asks(S, D, opts)`

`[]` unless `opts` is an object and `opts.api` is an object with object fields `drive`, `geo`, `nearby`. Otherwise, in this order:

1. **geocode**, when `S.pos` isn't a GPS position (`S.pos` is `null` or `S.pos.src !== "gps"`) and `k = geoKey(S.address)` isn't `null` and `opts.api.geo` has no own key `k`: `{kind: "geocode", key: k, q: geoQuery(S.address)}`.
2. **drive**, when `S.milesSrc === "store"`, `k = driveKey(S.pos, S.store)` isn't `null`, and `opts.api.drive` has no own key `k`: `{kind: "drive", key: k, from: point(S.pos), to: point(S.store)}`.
3. **nearby**, when `point(S.pos)` isn't `null`: for each `r` of `NEARBY_RADII` in order, `k = nearbyKey(S.pos, r)`: no own key `k` in `opts.api.nearby` → ask `{kind: "nearby", key: k, lat: fmt3(S.pos.lat), lon: fmt3(S.pos.lon), radius: r}` and stop; the value is `false` → stop; it has `places.length >= NEARBY_WANT` → stop; else try the next `r`.

An answer is stored under the key it was asked with, so an answer for an old position or store is simply never read again: **a late answer can't overwrite a newer action** (UI contract §6b's rule holds by construction).

### 6.2 `placesFor(S, D, opts)`

`[]` unless `opts.api.nearby` is an object and `point(S.pos)` isn't `null`. Take the answer for the **largest** `r` in `NEARBY_RADII` whose key `nearbyKey(S.pos, r)` holds an object (not `false`); none → `[]`. From its `places`, drop any whose `nameKey(name)` equals `nameKey` of some `D.BRANDS` entry's `name` (a chain store OSM didn't tag with its brand). Each remaining place becomes a row `{brand: id, id: id + "@" + point(lat, lon), name, category, lat, lon, mi: geo.distMi(S.pos.lat, S.pos.lon, lat, lon), profiled: false}`; sort by `mi`, then `id`; return the first `NEARBY_SHOW`. A row is a valid `pickStore` argument (state contract §6).

### 6.3 `remember(D, opts, ask, value)` and `send(ask, cb)`

- `remember`: stores `value` (or `false` when it's `null`) at `opts.api[{drive: "drive", geocode: "geo", nearby: "nearby"}[ask.kind]][ask.key]`. For a `nearby` value, each place is also put in `D.PLACES` (created if missing) as `{name, category, lat, lon}` under its `id`, unless that id is already there. So every independent the page has seen can be priced, even after the position moves on.
- `send(ask, cb)`: `false` and no request when `!enabled()`. Else an `XMLHttpRequest` `GET` to `apiBase` (trailing `/` removed) + `/drive?from=…&to=…`, `/geocode?q=…` or `/nearby?lat=…&lon=…&radius=…` (values through `encodeURIComponent`), no custom headers, no credentials, `timeout` = `NEARBY_TIMEOUT_MS` for nearby and `TIMEOUT_MS` otherwise. Status 200 and a body that `JSON.parse`s → `cb(check…(body))`; anything else (another status, a parse error, `onerror`, `ontimeout`, a throw) → `cb(null)`. The first `null` of the page load logs **one** `console.warn("Pickup or Delivery: the map server didn't answer, so built-in estimates are used.")`; never `console.error` (the e2e fails on it). Returns `true`.

## 7. State, engine and geography amendments (D-040)

These are written into the state contract (§2, §4.3, §4.5, §6, §8) and the engine contract (§2.1). Summary:

- **Engine `restFor`, independents.** A `brandId` in neither `BRANDS` nor `PROFILES`, with `D.PLACES` an object holding an own key `brandId` whose value is an object with a string `name` and a string `category`: built as an unprofiled brand (D-006: no menu, no deal, no direct delivery, `platforms ["dd","ue","gh"]`, the category default markup with `markupEst: true`, `profiled: false`), `name` = the place's name. No default for the category → `null`.
- **`S.place`** (a new saved user field): `null`, or `{id, name, category, lat, lon}`, the independent the user picked. `pickStore` sets it from `D.PLACES` when the store's brand is an independent; `setBrand` clears it unless the new brand is that place.
- **`applyAddress(S, D, opts)`, a geocoded address.** For a non-GPS position, when `opts.api` is an object and `g = opts.api.geo[geoKey(S.address)]` is an object: `pos = {lat: g.lat, lon: g.lon, src: "addr"}`, and the ZIP record is the typed ZIP's when it's known, else `g.zip`'s when known, else `nearestZip(g.lat, g.lon)`.
- **`autoMiles`, driving distance.** In steps 3 and 4, when `opts.api` is an object and `a = opts.api.drive[driveKey(S.pos, S.store)]` is an object with finite `miles` ≥ 0: `miles = round1(2 * a.miles)` and `milesSrc = "drive"` instead of the straight-line trip. **`minutes` still comes from `speed`** (state contract §4.6): OSRM's times are free-flow, with no traffic or parking, and `speed` is the user's one sourced knob (D-032).

## 8. UI amendments (D-040)

Written into the UI contract (§1, §3, §5.1–§5.4, §5.10):

- Boot: `D.PLACES = D.PLACES || {}`; a loaded `S.place` is put in `D.PLACES` (so a saved independent prices again even with the Worker off); when `POD.api.enabled()`, `opts.api = {drive: {}, geo: {}, nearby: {}}`.
- `afterChange`: after the tiles, send each of `POD.api.asks(S, D, opts)` not already in flight (by `kind + key`). Each answer → `POD.api.remember(D, opts, ask, value)` → `afterChange(derive())`. Never blocks a render.
- `loc-status` for `S.pos.src === "addr"` with `S.zipRec`: `"Street address · ZIP {zip}, {city}, {st}"`.
- **Independents list** after the chain list: when `rows = POD.api.placesFor(S, D, opts)` isn't empty, `h3` `"Independent restaurants"`, `ol[data-testid="indie-list"]`, each `li` a `button data-action="pick-place" data-place="{i}" data-brand="{brand}"` with `aria-pressed` as for stores, the name, `mi1(mi) + " mi"` and the tag `"Estimate"`; then the note `"From OpenStreetMap. We don't know which apps list these places: turn off any app that doesn't."`. A click → `pickStore(S, D, row, opts)`.
- `select#brand`: when `S.brand` is an own key of `D.PLACES` and not of `D.BRANDS`, an option for it right after `"Choose any chain…"`, text `{name} (estimate)`, selected.
- Unprofiled note: the category is `D.PLACES[brand].category` for an independent.
- `trip-src` for `milesSrc "drive"`: `"To the nearest {name}, {mi1(S.miles / 2)} mi each way by road."`; with `S.storePicked`, `"To the {name} you picked, …"`.
- Fine print, when the page shows anything from the Worker (`milesSrc === "drive"`, `S.pos.src === "addr"`, or a non-empty independents list): `"Road distances, street addresses and independent restaurants: OpenStreetMap (© OpenStreetMap contributors, ODbL), through this site's server."`. With the Worker off or failing, nothing on the page changes.

## 9. Deploying (left to the user, ISS-004)

`worker/README.md`: a Cloudflare account; `wrangler kv namespace create POD_CACHE` and its id in `wrangler.toml`; `USER_AGENT` set as a secret (an app name and a contact, per OSM's policies); `ALLOW_ORIGINS`; `wrangler deploy`; then `apiBase` in `src/js/config.js` set to the Worker's URL. The public OSRM server allows reasonable non-commercial use at 1 request/s with no uptime promise, and Nominatim asks for at most 1 request/s with caching. The KV cache keeps a small site well under both. A busy site should run its own OSRM or switch providers: each lives behind one adapter.

## 10. What this leaves to later phases

- Mapbox or another provider: a second adapter with the same interface (D-040 chose OSM first: no key, and results may be cached).
- `/fuel` and `/vehicle` aren't built: gas refreshes weekly from EIA (D-039) and the VIN goes from the browser to NHTSA (D-038).
- Per-place menus or app listings for independents.
