# Geography contract (v5, Phase 3)

The exact definition of `POD.geo` that `src/js/geo.js` and the Python reference (`tests/oracle/geo.py`) both implement. It fills in what BUILD.md §8 and D-005/D-021 leave open. **Where this file and BUILD.md §8 differ, this file wins** (D-030). Change it only by a decision; the reference and the fixtures change first, the code after.

## 0. Rules for every function

- **Pure.** A function reads only its arguments. No `POD.data`, no `POD.S`, no DOM, no `Date`, no network. The data tables come in as the argument `D` (in the app, `POD.data`). Memo caches are allowed (§3, §4), but a cached value is never returned for data it wasn't computed from.
- **Never mutates its arguments.** Every record or store it returns is a new object that shares nothing with `D`, `opts` or a cache.
- **Bad input → `null`, never a throw.** A latitude or longitude that isn't a finite number, a latitude outside [−90, 90], a longitude outside [−180, 180], a missing or wrong-typed `D` table, or a malformed field (each section names its cases) makes the function return `null` (`zipCount` returns `0`). A malformed *record* inside a table is skipped, and the rest of the table is used.
- "Finite number" means `typeof x === "number" && isFinite(x)`. Strings are not converted.

## 1. API (`POD.geo`)

| Function | Returns |
|---|---|
| `distMi(lat1, lon1, lat2, lon2)` | great-circle miles, unrounded (§2) |
| `zipCount(D)` | number of usable ZIP records (§3); `0` if none |
| `zipByCode(code, D)` | a new ZIP record (§3) or `null` |
| `nearestZip(lat, lon, D)` | a new ZIP record for the nearest centroid, or `null` |
| `zipSpacing(rec, D)` | mean miles to the 6 nearest other centroid points (§4), or `null` |
| `estimateMiles(rec, brandId, D)` | `{one, round, spacing, zipsPerStore}` (§5) or `null` |
| `tripMiles(straightMi)` | the round trip for a straight-line distance (§6) |
| `cellOf(lat, lon)` | the tile cell key containing a point (§7) |
| `cellsFor(lat, lon, radiusMi, D)` | the cells a search circle may touch that have tiles (§7) |
| `tilePath(cell)` | `"src/data/stores/" + cell + ".js"` (§7) |
| `storesNear(lat, lon, D, opts)` | nearby brands, one store each (§9) |
| `nearestStore(lat, lon, brandId, D, opts)` | the nearest store of one brand (§10) |
| `R_MI` | `3958.8` |
| `ROAD` | `1.25` (road winding factor) |
| `RADII` | `[5, 10, 25, 50]` (search radii, miles) |
| `WANT` | `15` (brands wanted before the search stops widening) |
| `NEIGHBORS` | `6` |

The constants are plain values. A caller that changes them gets undefined behavior.

## 2. Distance

```
rad(x)  = x * Math.PI / 180                       (left to right: (x * PI) / 180)
dLat    = rad(lat2 - lat1)
dLon    = rad(lon2 - lon1)
s1      = Math.sin(dLat / 2)
s2      = Math.sin(dLon / 2)
a       = s1 * s1 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * s2 * s2
distMi  = 2 * R_MI * Math.asin(Math.min(1, Math.sqrt(a)))
```

Products are evaluated left to right as written. `distMi` returns `null` if any argument isn't a finite number (no range check here). Two implementations can still differ in the last bit of `sin`/`cos`/`asin`, so tests compare unrounded distances with a relative tolerance of 1e-9. Values that this contract rounds (§5, §6) compare exactly.

## 3. ZIP table

`D.ZIP_PACKED` is a string of records joined by `;`, fields by `,`: `zip,la,lo,cityIndex,ST` (BUILD.md §2). `D.ZIP_CITIES` is an array of city names.

A record is **usable** when it has exactly 5 fields, `zip` matches `/^\d{5}$/`, `la` and `lo` match `/^-?\d+$/`, `cityIndex` matches `/^\d+$/` and is a valid index into `ZIP_CITIES`, and `ST` matches `/^[A-Z]{2}$/`. Unusable records are skipped. An empty string has no records. If `D` isn't an object, `ZIP_PACKED` isn't a string or `ZIP_CITIES` isn't an array, there are no records.

A **ZIP record** is `{z, la, lo, c, st}`: `z` the 5-digit string, `la = laInt / 1000` and `lo = loInt / 1000` in degrees (numbers), `c` the city name, `st` the state code.

- `zipCount(D)`: the number of usable records (duplicates of a code included).
- `zipByCode(code, D)`: `code` must be a string matching `/^\d{5}$/` (no trimming, no numbers: `11201` as a number → `null`). Returns a new record for the **first** usable record with that `zip`, or `null`.
- `nearestZip(lat, lon, D)`: the usable record with the smallest `distMi(lat, lon, rec.la, rec.lo)`. Ties go to the smallest `zip` (string order). `null` on bad input or no records.

Unpacking may be memoized, keyed by the `ZIP_PACKED` string itself, so a different table (a test's synthetic one) is never answered from another table's cache.

## 4. `zipSpacing(rec, D)`: the density proxy

`rec` is any object with finite numbers `rec.la`, `rec.lo` in range (§0); other fields are ignored.

1. The **points** are the distinct `(laInt, loInt)` pairs among the usable records. Several ZIPs at one point count once.
2. Drop every point whose distance from `rec` is exactly `0` (that is the query's own point, and any ZIPs stacked on it).
3. If fewer than `NEIGHBORS` (6) points remain, return `null`.
4. Take the 6 smallest distances `d1 ≤ … ≤ d6` and return `(d1 + d2 + d3 + d4 + d5 + d6) / 6`, summed left to right in ascending order.

*Why distinct points:* the ZIP source stacks many ZIPs on one coordinate (ISS-032: 452 Los Angeles ZIPs share one point). Counting each stacked ZIP would make any such point look like the densest place in the country.

The result may be memoized by `(rec.la, rec.lo)` for a given `ZIP_PACKED` (§3's rule). **Speed:** after the table is unpacked, an uncached call must average under 10 ms (Phase 3 done-when). A full scan of 42k points is allowed only as the exact fallback: e.g. scan a ±1.2° latitude band of a latitude-sorted point list, and fall back to a full scan when the 6th distance in the band exceeds the band's guaranteed reach (`1.2 × π/180 × R_MI` ≈ 82.9 mi).

## 5. `estimateMiles(rec, brandId, D)`: the fallback estimator (BUILD.md §8)

```
stores        = D.BRANDS[brandId].stores        must be a finite number > 0, else null
total         = zipCount(D)                     must be > 0, else null
spacing       = zipSpacing(rec, D)              null → null
zipsPerStore  = total / stores
raw           = 0.45 * Math.sqrt(zipsPerStore) * Math.pow(spacing, 0.75)
one           = clamp(raw, 0.4, 30)
return { one: round1(one), round: round1(one * 2 * ROAD), spacing: spacing, zipsPerStore: zipsPerStore }
```

- `brandId` must be a string that is an own key of `D.BRANDS` (an object), else `null`.
- `round` is computed from the **unrounded** `one`. `spacing` and `zipsPerStore` are unrounded.
- `round1(x) = Math.round(x * 10) / 10` (half up). The store counts are All The Places counts (`BRANDS[id].stores`), which undercount some chains (ISS-007), so the estimate runs long for them.

## 6. `tripMiles(straightMi)`

`round1(straightMi * 2 * ROAD)`: out and back, times the road winding factor (D-005). `null` unless `straightMi` is a finite number ≥ 0.

## 7. Cells and tiles (D-021)

- A store with integer coordinates `(la, lo)` lives in cell `Math.floor(la / 1000) + "_" + Math.floor(lo / 1000)`.
- `cellOf(lat, lon)` = `Math.floor(lat) + "_" + Math.floor(lon)` for a point in degrees (`null` on bad input).
- `cellsFor(lat, lon, r, D)`: `r` must be a finite number > 0 and `D.TILE_INDEX` an object, else `null`.

  ```
  delta  = r / R_MI                                   the circle's angular radius, radians
  EPS    = 1e-9                                       degrees of slack against rounding
  dLat   = delta * 180 / Math.PI + EPS
  latLo  = lat - dLat,  latHi = lat + dLat
  x      = Math.sin(delta) / Math.cos(lat * Math.PI / 180)
  if Math.abs(lat) + dLat >= 90 or x >= 1:  lonLo = -180, lonHi = 180      (the circle holds a pole)
  else:  dLon = Math.asin(x) * 180 / Math.PI + EPS;  lonLo = lon - dLon,  lonHi = lon + dLon
  cells  = every a in floor(latLo)..floor(latHi), o in floor(lonLo)..floor(lonHi)
           whose key a + "_" + o is an own key of D.TILE_INDEX
  ```

  Sorted by `a` ascending, then `o` ascending, **numerically** (`"9_-1"` comes before `"10_0"`). `asin(sin δ / cos φ)` is the exact longitude reach of a spherical circle of angular radius δ centered at latitude φ, so the box holds the whole circle and every cell the circle touches is in the list (D-021: never only the user's own cell). A cheaper `dLat / cos(lat)` is *not* allowed: it falls short by up to about 0.0002° at Fairbanks, which drops an edge cell. Known limit: a circle that crosses ±180° (the far Aleutians) doesn't wrap.
- `tilePath(cell)` = `"src/data/stores/" + cell + ".js"` (the deploy path, D-011). `null` unless `cell` matches `/^-?\d+_-?\d+$/`.

## 8. Reading a tile

`D.TILES[cell]` (if `D.TILES` is an object and has that own key) is the tile. It is **usable** when it's an object, its `run` equals `D.BRANDS_RUN` (a string), and its `s` is a string. A tile from another run is not usable: its brand indexes may point at different brands.

`s` splits on `;` into records, and each record on `,` into fields. A record is used when it has exactly 3 fields, each matching `/^-?\d+$/`, with `b` an index into `D.BRAND_IDS` whose id is an own key of `D.BRANDS`. Other records (including the empty string) are skipped. A store's point is `(la / 1000, lo / 1000)` and its distance from the user is `distMi(lat, lon, la / 1000, lo / 1000)`.

Parsing may be memoized per cell, but only while the tile's `s` and `run` are the same strings.

## 9. `storesNear(lat, lon, D, opts)`

Returns `null` on bad input, or when `D.TILE_INDEX` isn't an object, `D.BRAND_IDS` isn't an array, `D.BRANDS` isn't an object or `D.BRANDS_RUN` isn't a string. `opts` is optional; `opts.failed`, if it's an object, names cells the page couldn't load (`{cell: true}`). Anything else in `opts` is ignored.

```
for r in RADII:
  cells = cellsFor(lat, lon, r, D)
  need  = [c in cells with no own key c in D.TILES (a missing or non-object D.TILES has none) and opts.failed[c] !== true]
  if need is not empty:
    return { status: "need", radius: r, need: need, stores: [], partial: false }
  partial = (some c in cells has opts.failed[c] === true and no tile)  or  (some c in cells has a tile that isn't usable)
  for each usable record in the usable tiles of cells with distance ≤ r:
    keep, per brand, its nearest store                 ties: smaller la, then smaller lo
  list = those stores sorted by distance ascending, then brand id ascending (plain string order)
  if list.length >= WANT or r == the last radius:
    return { status: "ok", radius: r, need: [], stores: list, partial: partial }
```

`need` keeps the order of `cells`. A tile present in `D.TILES` always wins over `opts.failed`. The page loads every cell in `need` (with `tilePath`), adds cells it couldn't load to `opts.failed`, and calls again.

A **store** is a new object:

```
{ id: brandId + "@" + la + "," + lo,        e.g. "dominos@40694,-73990"
  brand: brandId, name: BRANDS[brandId].name, category: BRANDS[brandId].category,
  profiled: (D.PROFILES is an object and brandId is an own key of it),
  lat: la / 1000, lon: lo / 1000,
  mi: distance (unrounded), trip: tripMiles(mi) }
```

## 10. `nearestStore(lat, lon, brandId, D, opts)`

Same inputs and `null` cases as §9, plus `null` when `brandId` isn't a string in `D.BRAND_IDS`.

```
for r in RADII:
  cells, need, partial as in §9 (need non-empty → { status: "need", radius: r, need: need, store: null, partial: false })
  best = brandId's nearest usable store within distance ≤ r      ties: smaller la, then smaller lo
  if best: return { status: "ok", radius: r, need: [], store: best (§9 shape), partial: partial }
return { status: "ok", radius: 50, need: [], store: null, partial: partial-at-50 }
```

`store: null` with `status: "ok"` means no store of that brand within 50 miles (or none in the usable tiles), and the page falls back to `estimateMiles`.

## 11. What this contract leaves to later phases

- Loading tiles (script injection over `file://`), geolocation and the picker: Phase 5 (`app.js`, UI).
- Turning `miles` into `minutes`, `S.milesAuto`, `S.milesBy` and pinning: Phase 4 (`state.js`).
- Driving distance from a routing API instead of straight line × 1.25: Phase 8 (`api.js`).
