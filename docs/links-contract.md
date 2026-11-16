# Links contract (v5, Phase 9, D-041)

Where each result row hands off: `POD.links` (`src/js/links.js`, ES5), the data `POD.data.LINKS` (`src/data/links.js`), and the hand-off block the page puts in each result row (UI contract §5.5, §5.10). BUILD.md §11 Phase E asked for "the cart pre-built where the platform allows it"; **no platform publicly allows it (D-016)**, so a link opens the app, the restaurant's own site, or a map, and the user rebuilds the order there. **Where this differs from BUILD.md, this file wins** (D-041). `src/js/links.js` and the Python reference `tests/oracle/links.py` both implement it; `tests/fixtures/links/` holds hand-worked cases, and `tests/oracle/run.py` compares the JS with the reference on them and on seeded random calls. Change it only by a decision, with the reference and the fixtures first.

## 0. Rules

- **Pure.** `POD.links` reads only its arguments: no `POD.data`, `POD.S`, `Date`, `document` or `window`. It never throws, never changes its arguments, and returns new objects. Bad input gives `[]`.
- **Nothing invented.** Every URL and every URL format comes from `D.LINKS`, which records how and when each was seen working (`source`, `checked`). A format nobody has confirmed is `null` there, and the row falls back to something that was confirmed (§2). A link that can't be built is left out, never guessed.
- **A link carries only the restaurant's name or the store's point.** Never the user's address, ZIP, position, cart, prices or anything saved. (The map link's directions start from the device's own location: Google's format needs no origin.)
- **Only `https:`.** Every `href` returned starts with `"https://"`; anything else is dropped.
- **Own properties only.** Every property read below is an own property (`Object.prototype.hasOwnProperty`); an inherited one (`constructor`, `toString`, `__proto__` as a brand id) counts as absent. That's also what the Python reference's dicts do.

Helpers (the reference mirrors each):

- `isObj(x)`: `x !== null`, `typeof x === "object"`, not an array.
- `isStr(x)`: `typeof x === "string"`. `nonEmpty(x)`: `isStr(x) && x !== ""`.
- `fin(x)`: `typeof x === "number" && isFinite(x)` (booleans are not numbers).
- `enc(s)`: `encodeURIComponent(s)` inside `try`; it throws `URIError` on a lone surrogate (an unpaired `\uD800`–`\uDFFF`), and then `enc` is `null`. *Reference:* `urllib.parse.quote(s, safe="-_.!~*'()")` (the same unescaped set: letters, digits and `-_.!~*'()`, UTF-8 bytes `%XX` in upper case), with `UnicodeEncodeError` → `None`.
- `fill(t, key, v)`: every occurrence of `key` in `t` replaced by `v` (`t.split(key).join(v)`; Python `t.replace(key, v)`).
- `https(h)`: `isStr(h) && h.indexOf("https://") === 0`.
- `fix5(x)`: `x.toFixed(5)`. *Reference:* `("-" if x < 0 else "") + format(Decimal(abs(x)).quantize(Decimal("0.00001"), ROUND_HALF_UP), "f")`. `toFixed` rounds the exact binary value and takes the larger digit string on an exact tie (`(0.015625).toFixed(5)` is `"0.01563"`), which Python's own `format(x, ".5f")` doesn't (it gives `"0.01562"`); `-0` gives `"0.00000"` and `-0.000001` gives `"-0.00000"` in both.

## 1. The data: `POD.data.LINKS` (`src/data/links.js`)

Written by hand by the orchestrator (the `cards.js` pattern, D-013), with the provenance header every data file has.

```
LINKS = {
  asOf: "YYYY-MM-DD",
  apps:  { dd|ue|gh: { home, search, source, checked } },
  maps:  { name, dir, search, source, checked },
  order: { <brandId>: { url, source, checked } }
}
```

- `apps[p].home`: the app's home page. `apps[p].search`: a URL with `{q}` where the restaurant's name goes, or `null` when no search format has been confirmed. On 2026-11-16 the user confirmed DoorDash's (`https://www.doordash.com/search/store/{q}/`); Uber Eats' and Grubhub's sample searches went to their home pages, so those are `null`.
- `maps.name`: the map's name, as the labels show it. `maps.dir`: directions to a point, with `{lat}` and `{lon}`. `maps.search`: a map search, with `{q}`. Google Maps (the user's choice; Google documents both formats, with no key).
- `order[brand].url`: the chain's own site, where ordering direct starts: its home page on the chain's own domain, the one its profile was researched on, not a deep path. (Little Caesars' profile was researched on `order.littlecaesars.com`, and its link is `https://littlecaesars.com/`, where `www.littlecaesars.com` permanently redirects; a data test checks each link's domain appears in the chain's evidence file. *Clarified after the 9.5 test review.*) **Exactly the profiled chains** (`PROFILES`' keys), each checked; a newly profiled chain needs its entry (a data test pins the key sets equal).
- Every `source` says what was seen; every `checked` is a `YYYY-MM-DD` date.

## 2. `POD.links.forChannel(ch, S, D)` → `[{kind, label, href}]`

The hand-off for one result row: `ch` is the row's channel id (`r.id`), `S` the page's state, `D` the data tables.

1. **Guards.** `ch` is one of `"direct-d"`, `"direct-p"`, `"dd-d"`, `"dd-p"`, `"ue-d"`, `"ue-p"`, `"gh-d"`, `"gh-p"`; `S` and `D` are objects (`isObj`); `L = D.LINKS` is an object; `brand = S.brand` is a string; `S.rest` is an object whose `name` is non-empty: `name = S.rest.name`. Otherwise return `[]`. (`S.rest.name` is the name the engine and the page use: the brand's, or the independent's, D-040.)
2. `p` = the part of `ch` before `"-"`, `m` = the part after.
3. **An app** (`p` is `dd`, `ue` or `gh`), either mode: `a = L.apps[p]` (both `L.apps` and `a` objects, else `[]`), and `App` = `{dd: "DoorDash", ue: "Uber Eats", gh: "Grubhub"}[p]`.
   - When `a.search` is a string containing `"{q}"`, `q = enc(name)` isn't `null`, and `h = fill(a.search, "{q}", q)` passes `https(h)`: `[{kind: "search", label: "Search " + App + " for " + name, href: h}]`.
   - Else when `https(a.home)`: `[{kind: "app", label: "Open " + App, href: a.home}]`.
   - Else `[]`.
   The two modes get the same link: the user picks delivery or pickup in the app.
4. **Ordering direct** (`p` is `direct`): `out = []`.
   - **The chain's site:** when `L.order` is an object, `o = L.order[brand]` is an object and `https(o.url)`: push `{kind: "order", label: "Order from " + name, href: o.url}`.
   - **Pickup only (`m === "p"`), the map:** when `mp = L.maps` is an object and `nonEmpty(mp.name)`, push the first of these that can be built, else nothing:
     1. **Directions to the store**, when `st = S.store` is an object whose `id` is a string starting with `brand + "@"` (the rule `autoMiles` uses for a picked store) and whose `lat` and `lon` pass `fin`, with `-90 ≤ lat ≤ 90` and `-180 ≤ lon ≤ 180`; `mp.dir` is a string containing both `"{lat}"` and `"{lon}"`; and `h = fill(fill(mp.dir, "{lat}", fix5(lat)), "{lon}", fix5(lon))` passes `https(h)`: `{kind: "dir", label: "Directions in " + mp.name, href: h}`. This is the store the trip was measured to (or the one the user picked); a pinned distance keeps it (state contract §6).
     2. **A map search by name**, when `mp.search` is a string containing `"{q}"`, `q = enc(name)` isn't `null` and `h = fill(mp.search, "{q}", q)` passes `https(h)`: `{kind: "map", label: "Find " + name + " in " + mp.name, href: h}`. That's the row with no store: an estimated or pinned distance with no store found, or a stored point out of range.
   - Return `out` (order link first). Direct delivery gets no map link: the restaurant brings it.

**On real data every row hands off.** Every app has a home page; direct delivery exists only for profiled chains (D-006), and each has an `order` entry; direct pickup always gets the map (a real brand name always encodes). The unit tests check this for every brand in `BRAND_IDS` on every channel.

| Row | Hand-off on 2026-11-16's data |
|---|---|
| `dd-d`, `dd-p` | "Search DoorDash for {name}" |
| `ue-d`, `ue-p` | "Open Uber Eats" (home page) |
| `gh-d`, `gh-p` | "Open Grubhub" (home page) |
| `direct-d` | "Order from {name}" (profiled chains only) |
| `direct-p` | "Order from {name}" when profiled, then "Directions in Google Maps" to the store, or "Find {name} in Google Maps" when there's no store |

## 3. On the page (UI contract §5.5 step 3, §5.10)

- In each `li[data-testid="result-row"]`, after the head and the notes and before the `<details>` receipt: when `links = POD.links.forChannel(r.id, S, D)` (the page's `S` and `D`, not the engine's copy) isn't empty, `p.handoff[data-testid="handoff"]` holding one `a` per link, in order: `class="handoff-link"`, `data-testid="handoff-link"`, `data-kind="{kind}"`, `href="{esc(href)}"`, `target="_blank"`, `rel="noopener noreferrer"`, text `esc(label)`. An empty list writes nothing at all.
- No `data-action`: a hand-off click is the browser following a link, and `app.js` does nothing with it.
- The fine print gains `p[data-testid="fine-links"]` (after the `"Every app fee left blank…"` line, before `fine-osm`): `"Links open each app, the restaurant's own site or Google Maps. Your order doesn't carry over, so add your items there. A link carries only the restaurant's name or the store's location, never your address."`
- Phone: no horizontal scroll; a long label wraps inside its link (`overflow-wrap` on the link, the text element), and the links wrap onto more lines.

## 4. The Phase 7 baseline e2e (`tests/e2e/worker.e2e.js`)

*Retired by D-043 (Phase 11):* after the re-layout no earlier page is byte-equal, so the comparison with `BASE_REV` goes. What stays: with the Worker off the page makes no Worker request, and with the Worker failing `#app` equals the Worker-off page of the same build byte for byte, hand-offs included. The paragraph below is the Phase 9 rule, kept for the record.

Phase 8's "with the Worker off, `#app` is byte-identical to the Phase 7 page" (`BASE_REV = '556bc34'`) changes by this decision, not by loosening: before comparing, the new page's copy of `#app` has every `[data-testid="handoff"]` and `[data-testid="fine-links"]` element removed (a no-op on the Phase 7 page, which has neither), and the test first checks that the off page has one hand-off per result row, so the removal can't hide a missing one. **Everything else stays Phase 7's byte for byte.** And "the Worker adds nothing": with the Worker failing, the new page's whole `#app`, hand-offs included, equals the Worker-off page's on the same code.

## 5. Tests

- `tests/oracle/links.py`: the reference. `tests/fixtures/links/build.py` writes `cases.json`: hand-worked calls, each expected value written out in `build.py` and asserted against the reference there.
- `tests/oracle/links_runner.js` and `run.py`'s links checks: the cases, and `ORACLE_LINKS_N` (default 2,000) seeded random calls (names with `&`, `'`, `/`, `%`, accents, emoji and lone surrogates; stores valid and not; broken `LINKS` entries; junk channels and brand ids like `constructor`), JS vs the reference, exactly, with the purity checks of the other runners.
- `tests/unit/links.test.js` and `tests/unit/data-links.test.js` (the tester): every case, the rules by name, every brand × channel hands off, and the data's provenance and key sets.
- `tests/e2e/links.e2e.js`: on the real page, every result row hands off, with the exact links for the example, an unprofiled chain, a profiled chain with no store nearby, direct delivery, and (in `worker.e2e.js`) an independent; a click opens a new tab at the link and leaves the page as it was; no horizontal scroll at 390 px; 0 console errors.
