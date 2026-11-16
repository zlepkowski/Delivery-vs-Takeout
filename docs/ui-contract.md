# UI contract (v5, Phase 5; amended by D-036)

What the page shows and what each control calls: `src/js/render.js` (`POD.ui`), `src/js/app.js` (`POD.boot`, events, tiles, geolocation) and `src/css/app.css`. It fills in BUILD.md §3 and §10 on top of the state contract (D-031, D-033), the geography contract (D-030) and the insights contract (D-034). **Where it differs from BUILD.md, this file wins** (D-035). The e2e tests (`tests/e2e/`) check the hooks named here: ids, `data-testid`, `data-action` and the exact strings in quotes. Change them only by a decision, tests first.

*Amended 2026-11-14 after slice A:* `#side` wraps `results` + `insights` (no desktop gap, nothing clipped); `render` writes only the blocks that changed, so a click isn't lost when a text box commits on the same mouse press; `render(ctx)`; texts for no position, no routes, and "item"/"items"; manual car inputs only for "Other" or an unknown pair.

*Amended 2026-11-16 (Phase 7, D-037, D-038, D-039):* the car section gains the VIN box (§5.7, §6b), the model-year select and the EPA-year line (§5.7); the make and model lists come from both car tables; the fine print shows the EIA week and the VIN note (§5.10).

*Amended 2026-11-16 (Phase 9, D-041, `docs/links-contract.md` §3):* each result row gets its hand-off links (§5.5 step 3), and the fine print gains the links line (§5.10). `src/data/links.js` and `src/js/links.js` are loaded (after `defaults.js`, and after `insights.js`).

*Amended 2026-11-16 (Phase 11, D-042, D-043):* the quick flow. The page has three steps: Where (`loc`), What (`near` with a search box, and `order` with quick totals) and the answer (`results` as an answer card, then `insights`). The trip, the car, the wallet and the settings move into a **Personalize** drawer (`section#more`), closed by default and rendered only when it's open (§2). Open and closed are `view` flags; `<details>` is gone (§3, §5.5). Estimates carry an "est." label (`POD.state.sourceOf`, state contract §4.8). The look and the budgets are in §10. `aria-live` moves from `#app` to `#results`.

## 0. Rules

- **ES5, no framework, no runtime dependencies, `file://` works** (CLAUDE.md, D-007). Only `app.js` touches `document`, and only after `DOMContentLoaded`. `render.js` builds HTML strings from its arguments and holds no state of its own; `POD.ui.render(ctx)` (`ctx = {S, D, opts, view, now}`, where `view` holds the page-only flags of `app.js`) is the one function that writes the DOM.
- **One state object** `POD.S`. It changes only through `POD.state` functions (state contract §1). `S.tax`, `S.gas`, `S.rest`, `S.credits` and the other derived fields are never written by the page.
- **Every string from data or the user is escaped** with `POD.util.esc` before it goes into HTML (§9). Money is formatted only with `POD.util.money`.
- **Storage:** `window.localStorage`, read inside `try/catch` (accessing the property can throw). If it throws, storage is `null` and the page runs the same with nothing saved. Saving is `POD.state.save`, which never throws.
- **0 console errors** in every e2e flow (D-017), with two exceptions the browser makes, which page code can't suppress: a tile file that doesn't exist logs a resource error (§4; locally, without built tiles, that's expected; on Pages every tile in `TILE_INDEX` exists), a VIN request that fails at the network or comes back with an HTTP error status logs one too (§6b; the page still shows its own message), and so does a Worker request that does (D-040: a `/drive` with no road route answers 404, a failing Worker 5xx, an unreachable one `net::ERR_FAILED`; the seam itself only warns, once). The e2e allows each only in the test that causes it, matched exactly and counted.
- **No horizontal scroll** at 390 px and 1280 px.

*Amended 2026-11-16 (Phase 8, D-040, `docs/api-contract.md` §8):* the optional Worker. Boot sets up `D.PLACES` and, only when `POD.api.enabled()`, `opts.api` (§1); `afterChange` sends the seam's asks (§3); a street-address status line (§5.1); the independents list, `pick-place` and the brand option (§3, §5.2); the independents' category (§5.3); the road-distance line (§5.4); the OpenStreetMap fine print (§5.10). **With `POD.config.apiBase` empty (the committed value), the page is exactly as before.**

## 1. Boot (`POD.boot`, in `app.js`)

```
storage = safeStorage()                      // try { window.localStorage } catch → null
POD.opts = { failed: {} }                    // passed to every POD.state / POD.geo call that takes opts
POD.S = POD.state.load(storage, POD.data, new Date(), POD.opts)
POD.data.PLACES = POD.data.PLACES || {}       // D-040: independents the Worker returned
if (POD.S.place) POD.data.PLACES[POD.S.place.id] = {name, category, lat, lon} of it   // unless already there
if (POD.api.enabled()) POD.opts.api = { drive: {}, geo: {}, nearby: {} }
afterChange(POD.state.derive(POD.S, POD.data, new Date(), POD.opts))   // load doesn't return the trip status
```

A saved independent is put back in `D.PLACES` even with the Worker off, so a returning user's pick still prices.

`view` is the page's own state, never saved. It starts as `{moreStores: false, geoError: false, loading: false, canLocate: false, mcError: false, vin: "", vinMsg: "", drawer: false, open: {}, q: ""}` (D-043: `drawer` is whether Personalize is open; `open[ch] === true` when route `ch`'s row is expanded; `q` is the search box's text).

`afterChange(status)` (§3) then loads any tiles the trip or the "Near you" list needs, saves and renders. `POD.boot` is also callable again (the e2e doesn't need it).

## 2. Page layout and sections

*Amended by D-043 (Phase 11).* `<main id="app">` holds, in this DOM order: `section#loc`, `section#near`, `section#order`, `div#side` (holding `section#results` then `section#insights`), `section#more`, `section#fine`. `#more` is the **Personalize** drawer. Its first child is always its toggle (§5.11). Only while `view.drawer` is `true` it also holds, after the toggle and in this order, `section#trip`, `section#car`, `section#wallet` and `section#settings`. They're absent otherwise, not hidden. Since they're the tail of `#more`, opening and closing only appends or removes them; the toggle keeps its place.

Phone (≤ 760 px): one column in DOM order. Desktop (> 760 px): two columns, `loc`, `near`, `order` and `more` on the left and `#side` on the right, spanning those rows, sticky at the top, and scrolling on its own (`max-height` the viewport, `overflow-y: auto`) when it's taller than the window, so nothing in it is ever cut off; `fine` spans both columns at the bottom.

| id | Heading | Shows |
|---|---|---|
| `loc` | Where are you? | §5.1 |
| `near` | What are you getting? | §5.2 |
| `order` | Your order | §5.3 |
| `results` | Your best way to order | §5.5 |
| `insights` | Worth knowing | §5.6 |
| `more` | (none: the toggle is its head) | §5.11 |
| `trip` | The trip | §5.4 (in `#more`) |
| `car` | Your car | §5.7 (in `#more`) |
| `wallet` | Memberships and cards | §5.8 (in `#more`) |
| `settings` | Fees, tips and costs | §5.9 (in `#more`) |
| `fine` | Where the numbers come from | §5.10 |

A heading is an `h2`, the section's first child; `#trip`, `#car`, `#wallet` and `#settings` keep `h2` too. `section#results` has `aria-live="polite"`, and `#app` no longer does (`index.html`).

`index.html` keeps its header (`<h1>Pickup or Delivery</h1>`) and the empty `<main id="app">`; `render` fills it. **Writes only what changed** (BUILD.md §3's full replace, per block): `render` builds every section's HTML, and for each section replaces only the top-level child elements whose HTML differs from what's there (comparing the `outerHTML` of a freshly parsed copy with the current one). When the number of children differs, the leading children are compared pair by pair the same way and only the extra tail is appended or removed (*amended 2026-11-16, D-040*: the independents block arrives last in `#near`, and replacing the whole section would take the chain rows and the brand select from under a click; before, a different count replaced the section's content). Inside the car section the VIN block (`div.vin`) is patched the same way, one level down (*Phase 7*: a Look up click changes `view.vin`, and replacing the whole block would replace the button being clicked), and inside the settings section the app blocks (`div.app-settings`) and their `div.fields` grids are patched the same way, one level down (*amended after the 6.4 review, D-036*: replacing a whole app block when one of its number boxes committed lost a click on a select in the same block). An unchanged button or select at an unchanged position is never replaced (a block whose own tag and attributes differ is replaced, not patched; *review of 8.4b*), so a click that starts while a text box commits (mouse down → the box loses focus → `change` → render) still lands. `render` also remembers the `id` of `document.activeElement` and focuses the element with that `id` afterwards if it was replaced.

*D-043:* `#more` is a `section`, so it's patched like the others: a click on the drawer toggle replaces only the toggle (its `aria-expanded` changed) and appends or removes the tail. The new blocks keep a constant number of children whatever their state, with an empty `<div></div>` in a slot that has nothing to show (the car section's pattern, §5.7), except where this contract says a block is the tail (`#more`'s sections). `#near` is as in v5: its rows and status lines vary, so `select#brand` can shift and be replaced. A control whose own HTML changes because of the commit (a row head whose price changed, the answer's button when the cheapest route changed) is replaced, and a click that started on it is dropped. That's intended: the user sees the new answer before acting on it. The drawer toggle's HTML depends only on `view.drawer`, so a click on it while a box inside the drawer commits always lands (§5.11).

## 3. Events (three document listeners, BUILD.md §3)

`app.js` adds exactly three listeners on `document`: `change`, `click` and `input`. Adding a control means adding markup.

- **`change`** on an element with `data-bind="path"`: `v` = the parsed value (below); `POD.state.setPath(S, path, v)`; then `afterChange(POD.state.derive(S, D, new Date(), opts))`. Parsing: a checkbox → `checked`; an element with `data-type="text"` → its string `value`; otherwise `value.trim()` empty → `null`, else `parseFloat`, and `NaN` → `null` (an empty or bad box is a missing value, and the page asks for it).
- **`change`** on an element with `data-action` (selects, checkboxes, the address box):

| `data-action` | Element | Calls |
|---|---|---|
| `address` | `input#address` | `setAddress(S, D, value, opts)` |
| `brand` | `select#brand` | `setBrand(S, D, value === "" ? null : value, opts)` |
| `make` | `select#make` | `setCar(S, D, value, "", null)` |
| `model` | `select#model` | `setCar(S, D, S.make, value, S.year)` (the year stays: after a VIN names the year but not the model, picking the model keeps it) |
| `year` | `select#year` | `setCar(S, D, S.make, S.model, value === "" ? null : parseInt(value, 10))` |
| `toggle-card` | checkbox, `data-card` | `toggleCard(S, D, card, checked, new Date())` |
| `opt-in` | checkbox, `data-key` | `setOptIn(S, D, key, checked, new Date())` |
| `used` | checkbox, `data-key` | `markUsed(S, D, key, checked, new Date())` |

- **`click`** on an element (or inside one, via `closest`) with `data-action`:

| `data-action` | Attributes | Calls |
|---|---|---|
| `locate` | | geolocation (§6) |
| `example` | | the first-visit example (§7) |
| `pick-store` | `data-store` = index into the last `storesNear` list | `pickStore(S, D, store, opts)` |
| `pick-place` | `data-place` = index into the last `POD.api.placesFor` list (`POD.ui.placeAt(i)`) | `pickStore(S, D, row, opts)` (D-040) |
| `qty` | `data-index`, `data-delta` (`1` or `-1`) | `setQty(S, index, max(0, current + delta))` |
| `pin` | | `pinMiles(S, parseFloat(#pinMiles.value))`; a bad number changes nothing |
| `unpin` | | `unpinMiles(S, D, opts)` |
| `add-credit` | | `addManualCredit(S, D, credit from the form, new Date())` (§5.8) |
| `remove-credit` | `data-key` | `removeManualCredit(S, D, key, new Date())` |
| `more-stores` | | shows every row of the "Near you" list (page-only flag, not saved) |
| `vin` | | the VIN lookup (§6b) |
| `drawer` | | `view.drawer = !view.drawer`; render (D-043). `S` is unchanged, so nothing is saved. |
| `receipt` | `data-channel` | `view.open[ch] = view.open[ch] !== true`; render (D-043). |
| `chip` | `data-amount` (`15`, `25`, `40`) | `setPath(S, "manualSubtotal", parseFloat(amount))`, then `afterChange(derive)` (D-043) |

- **`input`**: nothing is committed while typing (values commit on `change`), with one exception (D-043): on `input#search` (`data-action="search"`), `view.q = el.value`, then render. `S` is unchanged and nothing is saved. A `change` on `input#search` does nothing. `view.q` is reset to `""`, and `#search`'s value cleared when it's on the page, by an `address` change, a successful locate (§6) and the example (§7): a new place starts with an empty box and an unfiltered list, so the box and the list never disagree.
- **`afterChange(status)`** runs after every one of these: when `status` is a trip status with `status === "need"`, load its cells (§4). Also run `POD.geo.storesNear(S.pos.lat, S.pos.lon, D, opts)` when `S.pos` is a position, and load its `need` cells if its status is `"need"`. Then, only when `opts.api` exists (D-040), for each ask of `POD.api.asks(S, D, opts)` whose `kind + ":" + key` isn't in flight: mark it in flight and `POD.api.send(ask, cb)`, where `cb(value)` clears the mark, runs `POD.api.remember(D, opts, ask, value)` and then `afterChange(derive())`. Nothing waits for an answer. Then `POD.state.save(S, storage)` and `POD.ui.render()`.

## 4. Tiles (geography contract §9, D-021, D-030)

- A cell loads by appending `<script src="src/data/stores/<cell>.js?v=<encodeURIComponent(POD.data.BRANDS_RUN)>">` (`POD.geo.tilePath(cell)` + the query; the query works over `file://`). A cell is requested at most once per page load: keep a `loading` and a `done` set.
- `onload`: mark it done. `onerror`: `opts.failed[cell] = true`. When the last pending cell settles, call `afterChange(POD.state.derive(S, D, new Date(), opts))` again: the trip and the list are re-measured with the new tiles, and any further cells they need are loaded the same way. A cell that's failed or done is never requested again, so this ends.
- While cells load, `S.miles` is `null` (state contract §4.5) and the results ask for "the trip distance (finding stores near you…)".

## 5. Sections

Strings in quotes are exact. `{x}` is a value; `mi1(x)` = `(Math.round(x * 10) / 10).toFixed(1)`.

### 5.1 `loc`

- `input#address` (`data-action="address"`, `type="text"`, `autocomplete="postal-code"` not required) with its `value` = `S.address`, and a button `data-action="locate"` "Use my location" (shown only when `navigator.geolocation` exists).
- A button `data-action="example"` "Show me an example" when `S.brand` is `null` (§7).
- `[data-testid="loc-status"]`:
  - `S.pos.src === "gps"` and `S.zipRec`: `"Your location · near ZIP {zip}, {city}, {st}"`
  - `S.pos.src === "addr"` and `S.zipRec`: `"Street address · ZIP {zip}, {city}, {st}"` (D-040)
  - `S.zipRec`: `"ZIP {zip} · {city}, {st}"` (`city` = `zipRec.c`)
  - `S.zip` and no `zipRec`: `"ZIP {zip} not found"`
  - otherwise `"Type your ZIP or address, or use your location."`
- `[data-testid="tax-gas"]` when `S.tax` is a number: `"Meal tax {tax}%"`, then when `S.fuel !== "ev"` and `S.gas` is a number `" · {fuel} gas {money(gas)}/gal"` (`fuel` = `S.fuel`).
- `[data-testid="geo-error"]` after a failed geolocation (§6).

### 5.2 `near`

- With a position: `near = POD.geo.storesNear(S.pos.lat, S.pos.lon, D, opts)`.
  - `null`: `[data-testid="near-status"]` `"No store data is available for this area."`
  - `status "need"`: `[data-testid="near-status"]` `"Finding restaurants near you…"`
  - `status "ok"`: `ol[data-testid="near-list"]` with the first 15 stores (all of them after `more-stores`), each an `li` holding a `button` with `data-action="pick-store"`, `data-store="{i}"`, `data-brand="{brand}"`, `aria-pressed` = `"true"` when `S.store` and `S.store.id === store.id`, else `"false"`. The button shows the brand's `name` (or the brand id when `name` is `null`), `mi1(store.mi) + " mi"`, and a tag `"Estimate"` when `store.profiled` is false. Then a `button[data-action="more-stores"]` `"Show all {n}"` when there are more than 15. `partial` adds `[data-testid="near-status"]` `"Some store data didn't load, so the list may be incomplete."`. An empty list says `"No restaurants found within {radius} miles."`.
- **Independents (D-040):** the **last** thing in `#near`, after `select#brand`, and only when `rows = POD.api.placesFor(S, D, opts)` isn't empty. With no rows nothing at all is written: no wrapper, no empty element, so with the Worker failing `#near` is byte for byte the Worker-off `#near` of the same build (*amended 2026-11-16 after review of 8.4b*, and by D-043, which retired the comparison with Phase 7; being last, its arrival shifts no control the user may be pressing). It holds an `h3` `"Independent restaurants"`, then `ol[data-testid="indie-list"]` with one `li` per row, each holding a `button` with `data-action="pick-place"`, `data-place="{i}"`, `data-brand="{brand}"`, `aria-pressed` = `"true"` when `S.store` and `S.store.id === row.id`, else `"false"`, showing the `name`, `mi1(row.mi) + " mi"` and the tag `"Estimate"` laid out like the chain rows (the tag never breaks inside a word; only the name wraps); then `[data-testid="indie-note"]` `"From OpenStreetMap. We don't know which apps list these places: turn off any app that doesn't."`. `POD.ui.placeAt(i)` returns row `i` of the list last rendered (a copy), or `null`.
- Without a position: `"Type a ZIP or address, or use your location, to see restaurants near you."`
- **Search (D-043).** With `status "ok"` and at least one store, `input#search` comes right after the heading: `type="search"`, `data-action="search"`, `autocomplete="off"`, `spellcheck="false"`, `placeholder="Search restaurants near you"`, `aria-label="Search restaurants near you"`, **no `value` attribute and nothing else that depends on `view.q`**. Its HTML never changes while the user types, so it's never replaced and keeps focus and caret (D-035's rule).
  - With `q` = `view.q` trimmed and lower-cased, not empty: the list shows only the stores whose shown name, lower-cased, contains `q`. Each row keeps `data-store` = its index in the **whole** `storesNear` list, so `POD.ui.storeAt` is unchanged. "Show all {n}" counts the matching rows. No match: `[data-testid="near-empty"]` `"Nothing near you matches “{view.q trimmed}”."` in place of the list. The independents (D-040) are filtered the same way; when none matches, nothing is written for them.
  - `q` empty: as before.
- **Monograms (D-043).** Each store row and independent row starts with `span.mono[aria-hidden="true"]` holding the first character of the shown name, upper-cased, with `style="--h:{h}"`, where `h` = the sum of the brand id's character codes × 37, mod 360. It's decoration only: no logos.
- Always: `select#brand` (`data-action="brand"`): first option `value=""` `"Choose any chain…"`, then every `BRAND_IDS` brand sorted by name (plain `<` on the names), the selected one `S.brand`. Each option's text is the name, plus `" (estimate)"` when the brand isn't in `PROFILES`. When `S.brand` is an own key of `D.PLACES` and not of `D.BRANDS` (an independent, D-040), one more option right after the first: `value` = `S.brand`, text `"{D.PLACES[brand].name} (estimate)"`, selected.

### 5.3 `order`

- No `S.rest`: `"Pick a restaurant first."`
- Profiled (`S.rest.profiled`): one row `[data-testid="menu-item"]` per menu index `i` (an item `{name, price, dealItem}`, D-036): the `name`, `money(price)`, a tag `"Deal item"` when `dealItem === true`, buttons `data-action="qty" data-index="{i}" data-delta="-1"` (label `"−"`, `aria-label="Remove one"`) and `data-delta="1"` (`"+"`, `aria-label="Add one"`), and the quantity in `[data-testid="qty-{i}"]` (`S.cart[i]` or 0). A footer `[data-testid="order-total"]` `"Menu total {money(menuSub)}"` from `POD.engine.cartInfo(S)` (pure; reads only `S`).
- When `S.rest.deal`: a checkbox `#dealOn` (`data-bind="dealOn"`) labeled `"Use the {deal.label} deal"`, and `[data-testid="deal-status"]`: `"Deal applies"` when `dealReady`, else `"Add {shortBy} more deal item for the deal"` (`items` when `shortBy > 1`).
- Unprofiled: **quick totals** first (D-043): `div.chips` holding three `button.chip` with `data-action="chip"`, `data-amount` `15`, `25` and `40`, texts `"$15"`, `"$25"`, `"$40"`, and `aria-pressed` = `"true"` when `S.manualSubtotal` equals that amount, else `"false"`. They're the user's own choice of total, not data. Then `input#manualSubtotal` (`data-bind="manualSubtotal"`, `type="number"`, `step="0.01"`, `min="0"`) labeled `"Your order's menu total ($)"`, and the note `"{name} isn't profiled: app prices use a typical {category} markup, so these totals are estimates."` (`category` = `D.BRANDS[brand].category`, or `D.PLACES[brand].category` for an independent, D-040).

### 5.4 `trip`

- `[data-testid="trip"]`: when `S.miles` is a number, `"{mi1(miles)} mi round trip · about {minutes} min"`, then a source line `[data-testid="trip-src"]`:
  - `milesSrc "store"`: `"To the nearest {name}, {mi1(straight)} mi away in a straight line (× 2 × 1.25 for the road)."` where `straight` = `POD.geo.distMi(S.pos.lat, S.pos.lon, S.store.lat, S.store.lon)`; with `S.storePicked`, `"To the {name} you picked, …"` with the same tail.
  - `milesSrc "drive"` (D-040): `"To the nearest {name}, {mi1(S.miles / 2)} mi each way by road."`; with `S.storePicked`, `"To the {name} you picked, {mi1(S.miles / 2)} mi each way by road."`
  - `"estimate"`: `"Estimated from how close together restaurants are around your ZIP."`
  - `"pinned"`: `"You set this distance."`
- When `S.miles` is `null`: `"No trip yet."`
- `input#pinMiles` (`type="number"`, `step="0.1"`, `min="0"`, value = `S.miles` or empty), a button `data-action="pin"` `"Use this distance"`, and when `milesSrc === "pinned"` a button `data-action="unpin"` `"Measure it for me"`.
- *D-043:* this section is in the drawer. The answer card repeats the trip line (§5.5, `answer-trip`).

### 5.5 `results`

In order, the first that applies:
1. `missing = POD.state.missing(S)` isn't `[]`: `[data-testid="missing"]` `"To compare, we still need: "` + the friendly names joined by `", "` + `"."`. Names, each listed once in this order: `rest` → `"a restaurant"`; `tax` → `"your ZIP or address"`; `fuel`, `mpg`, `gas`, `miPerKwh`, `kwh` → `"your car"`; `miles`, `minutes` → `"the trip distance"` (when tiles are loading: `"the trip distance (finding stores near you…)"`); `manualSubtotal` → `"your order's menu total"`; `tipDel` → `"the delivery tip"`; `tipPick` → `"the pickup tip"`; `wear` → `"wear per mile"`; `hourly` → `"the value of your time"`.
2. `F = POD.state.forEngine(S)`; `POD.engine.cartInfo(F).menuSub <= 0`: `[data-testid="empty-order"]` `"Add something to your order to compare."`
3. Otherwise `R = POD.engine.allResults(F)`:
   - `R` empty (every route switched off): `"Nothing to compare: every way to order from this restaurant is switched off."`
   - **The answer card (D-043)** `div.answer[data-testid="answer"]`, built from `best = R[0]` and `other` = the first route in `R` whose `mode` differs from `best.mode` (pickup vs delivery), or `null`. Its children, in this order, each slot an empty `<div></div>` when it has nothing:
     1. `p.answer-kicker` `"Cheapest way"`.
     2. `h3.answer-title[data-testid="verdict"]` = `title(best)`. Titles: `direct-p` → `"Pick it up from {rest}"`; `direct-d` → `"Delivery from {rest}"`; `{p}-d` → `"{App} delivery"`; `{p}-p` → `"{App} pickup"`. Here `rest` = `S.rest.name` and `App` = DoorDash, Uber Eats or Grubhub.
     3. `p.answer-net[data-testid="answer-net"]` = `money(best.net)`.
     4. `p.save[data-testid="save"]`, when `other` isn't `null`: with `d = round2(other.net − best.net)`, `"Saves {money(d)} vs {title(other)}"` when `d > 0`, else `"Same price as {title(other)}"`.
     5. The hand-off, when `links = POD.links.forChannel(best.id, S, D)` isn't empty: `a.cta[data-testid="cta"]` for `links[0]`, then `a.cta-alt[data-testid="cta-alt"]` for `links[1]` when there is one. Each has `href` = the escaped `href`, `target="_blank"`, `rel="noopener noreferrer"` and text = the escaped `label`, as in the rows. One slot, holding both links.
     6. `p.est-note[data-testid="est-note"]`, when `estOf(best)` or (`other` and `estOf(other)`): `"Based on estimates (marked est.). Make them yours in Personalize."` (D-042).
     7. `p.answer-trip[data-testid="answer-trip"]`, when some route in `R` has `mode === "p"` and `S.miles` is a number: the trip line of §5.4 (`"{mi1(miles)} mi round trip · about {minutes} min"`).
   - `ol.results-list[data-testid="results-list"]`, one `li[data-testid="result-row"][data-channel="{id}"]` per result in `R` order, with class `result`, plus `best` on the first and `open` when `view.open[id] === true`. Its children:
     1. `button.result-head[data-action="receipt"][data-channel="{id}"]` with `id="row-{id}"`, `aria-expanded` = `"true"` or `"false"` as `open`, holding `span.result-name` (`title(r)`, then the `member` badge `span.badge` when non-null), `span.est[data-testid="est"]` `"est."` when `estOf(r)` (an empty `span.est-none` otherwise), `span.net[data-testid="net"]` = `money(net)`, and the comparison bar `span.meter` holding `span.meter-fill[data-testid="meter"]` with `style="width:{w}%"`, where `w` = `Math.round(Math.max(r.net, 0) / M * 100)` and `M` = the largest `net` in `R` (`w` = 0 when `M <= 0`).
     2. `p.notes` with each note as a `span.tag`, or an empty `<div></div>`.
     3. `div.row-more[data-testid="row-more"]`, with the `hidden` attribute unless `open`, holding the **hand-offs (D-041)** when `links = POD.links.forChannel(r.id, S, D)` isn't empty (`p.handoff[data-testid="handoff"]` with one `a.handoff-link[data-testid="handoff-link"][data-kind="{kind}"]` per link, `href` = the escaped `href`, `target="_blank"`, `rel="noopener noreferrer"`, text = the escaped `label`, links contract §3; nothing when the list is empty), then the receipt `ul.receipt[data-testid="receipt"]`, whose rows are `li[data-testid="line"]` with `[data-testid="line-label"]` = the label and `[data-testid="line-amount"]` = `money(amount)`, except a `Delivery fee` of 0, which shows `"waived"`. Negative amounts get the class `neg` (green).
     - The row text names the route by `title(r)`; `r.name` isn't shown.
     - A tap on the head opens or closes the row (§3). An open row stays open across renders, since `view.open` is rendered. That's why `<details>` is gone: an open `<details>` differs from its fresh copy, so block patching closed it.
   - **`estOf(r)`** is `true` when `POD.state.sourceOf(S, D, path) === "est"` for some path the route uses (state contract §4.8):
     - `{p}-d` for an app `p`: `plats.{p}.delFee`, `plats.{p}.svc`, `plats.{p}.svcMin`, `regFee`, `smallMin`, `smallFee`, `tipDel`, and also `plats.{p}.memberSvc` and `plats.{p}.memberMin` when `S.plats[p].member` is truthy.
     - `{p}-p` for an app `p`: `plats.{p}.pickDisc`, `tipPick`, and the car.
     - `direct-d`: `tipDel`. `direct-p`: `tipPick` and the car.
     - The car: `kwh` when `S.fuel === "ev"`, else `mpg`; `wear`; and `speed` when `S.hourly` is a number above 0.
     - And for every app route (`{p}-d` and `{p}-p`), whatever the paths: `S.rest.markupEst === true`, since the app's menu prices then use the category's typical markup (engine contract §1, ISS-012).
     - These are the inputs the engine uses for that route (engine contract §5.3–§5.7). A pickup row never carries an app's delivery fees.
   - **The sticky bar (D-043)**, the last child of `#results`: `a.sticky[data-testid="sticky"][href="#results"]` holding `span` = `title(best)` and `strong` = `money(best.net)`. It's shown only on a phone (CSS, §10) and is an empty `<div></div>` when there's no answer card.
4. Below whichever of 1–3 showed, **apps waiting for fees** `[data-testid="app-fees"]`, when some app `p` in `S.rest.platforms` with `S.plats[p].on === true` has a non-empty `appMissing(S, p)`: the heading `"Add what your app's checkout shows"`, then per such app (in `dd`, `ue`, `gh` order) `[data-testid="app-fees-{p}"]` with `"{App}: delivery isn't compared until you enter these."` (or `"{App} isn't compared until you enter these."` when its list has its `markup` or `pickDisc`), and one labeled `input type="number" step="0.01" min="0"` per missing path of that app, `id="need-{path with . replaced by -}"`, `data-bind="{path}"`. The shared paths (`regFee`, `smallMin`, `smallFee`) get one input each, after the apps, under `"Shared by all three apps"`. Labels: `delFee` "Delivery fee ($)", `svc` "Service fee (%)", `svcMin` "Minimum service fee ($)", `memberSvc` "Service fee with membership (%)", `memberMin` "Order minimum for membership benefits ($)", `pickDisc` "Pickup discount (%)", `markup` "Menu markup (%)", `regFee` "Regulatory fee ($, 0 if none)", `smallMin` "Small-order fee applies under ($)", `smallFee` "Small-order fee ($, 0 if none)".

### 5.6 `insights`

When step 3 of §5.5 showed results: `POD.insights.build(F, R, new Date())`, each as `div[data-testid="insight"][data-id="{id}"]` with class `insight` plus `cls` when non-empty, holding `<strong>{label}</strong>` and the escaped `text`. None, or no results: *amended by D-043*, the section is `<section id="insights" hidden>` holding only its heading (it has no controls, so replacing it loses nothing). "Nothing to flag yet." is gone.

### 5.7 `car`

The section's top-level blocks, in this order; an optional block keeps its slot as an empty `<div></div>` when absent, so the number of blocks never changes (§2: a changed count replaces the whole section, which would take the VIN button from under a click).

1. **VIN** `div.vin`: `label for="vin"` `"VIN (optional)"`, `input#vin` (`type="text"`, `autocomplete="off"`, `spellcheck="false"`, `maxlength="24"`, **no** `data-bind`: the VIN isn't state and isn't saved, D-038) whose `value` is the page's `view.vin` (the cleaned VIN of the last lookup, `""` at first), and `button data-action="vin"` `"Look up"`. The block's HTML depends only on `view.vin`, so typing never re-renders it.
2. `[data-testid="vin-status"]` (a `<p>`): the page's current VIN message (§6b), when there is one.
3. `[data-testid="car-summary"]`, the first that applies: `S.fuel === "ev"` and `miPerKwh` is a number: `"{miPerKwh} mi/kWh · electric"`; `S.fuel !== "ev"`, `mpg` is a number and `POD.state.sourceOf(S, D, "mpg") === "est"` (the typical car, D-042): `"Typical car · {mpg} mpg · est."`; `S.fuel !== "ev"` and `mpg` is a number: `"{mpg} mpg · {fuel}"`; otherwise (including an electric car with no mi/kWh yet) `"No car yet."`. `{mpg}` is `String(S.mpg)`.
4. `[data-testid="car-epa"]` (a `<p>`): when `r = POD.state.carLookup(D, S.make, S.model, S.year)` isn't `null` and `r.year` is an integer: `"EPA figure for the {r.year} model."`.
5. `select#make` (`data-action="make"`): `""` `"Choose a make…"`, every make of `POD.state.carMakes(D)` in its order, then `"Other"`.
6. `select#model` (`data-action="model"`), when `S.make` is one of `carMakes(D)`: `""` `"Choose a model…"` then `POD.state.carModels(D, S.make)` in order.
7. `select#year` (`data-action="year"`, label `"Model year"`), when `runs = POD.state.carYears(D, S.make, S.model)` isn't empty: first `value=""` `"Newest ({newest})"` (`newest` = the largest `to` of the runs), then every year the runs cover, each once, newest first (`value` and text = the year); when `S.year` is an integer the runs don't cover, a last option `value="{S.year}"` `"{S.year} (no EPA figure)"`. The option equal to `S.year` (or `""` for `null`) is selected.
8. The manual inputs, when the make is `"Other"`, or `S.make` is one of `carMakes(D)`, `S.model !== ""` and `carLookup(D, S.make, S.model, S.year)` is `null` (an unlisted model, or a year with no figure): `select#fuel` (`data-bind="fuel"`, `data-type="text"`: `regular`, `premium`, `diesel`, `ev` labeled "Regular", "Premium", "Diesel", "Electric"), and `input#mpg` (`data-bind="mpg"`) or, for `ev`, `input#miPerKwh` (`data-bind="miPerKwh"`).

### 5.8 `wallet`

*Amended by D-043:* the heading is "Memberships and cards", and the memberships come **first**, before the cards; the rest of the order below is unchanged.

- Every card of `D.CARDS`, grouped under its `issuer` (in data order): `input type="checkbox"` with `data-action="toggle-card"`, `data-card="{id}"`, `id="card-{id}"`, checked when `S.cards` has it, labeled with `name`.
- After the list, for each entry `c` of `S.credits` (state contract §5.1), `[data-testid="credit"][data-key="{key}"]`: the name, `money(amount) + " " + cadence`, and its tier tag: `"Locked"` (`locked`), `"Some restaurants"` (`restricted`), else `"Works on {plats}"` (plats as app names, `direct` → "ordering direct"). Restricted: checkbox `data-action="opt-in" data-key` `"Qualifies here"` (checked when `S.creditOptIn[key] === true`). Not locked: checkbox `data-action="used" data-key` `"Used this period"` (checked when `c.used`). Manual credits also get `button data-action="remove-credit" data-key` `"Remove"`.
- Memberships, per app `p`: when a held card provides it (`D.CARDS` `membership === p`), a checkbox `id="cardMember-{p}"` `data-bind="plats.{p}.cardMember"` `"Use the {member name} my card includes"`; always a checkbox `id="memberOwn-{p}"` `data-bind="plats.{p}.memberOwn"` `"I pay for {member name}"` (DashPass, Uber One, Grubhub+).
- Add a credit: `input#mc-name` (text), `input#mc-amount` (number), `select#mc-cadence` (`once`, `monthly`, `quarterly`, `semiannual`, `annual`), checkboxes `#mc-plat-direct`, `#mc-plat-dd`, `#mc-plat-ue`, `#mc-plat-gh`, and `button[data-action="add-credit"]` `"Add credit"`. The credit is `{name, amount: parseFloat, cadence, plats: the checked ones}`; a refusal (`null`) shows `[data-testid="mc-error"]` `"Give the credit a name, an amount above $0 and where it works."`

### 5.9 `settings`

Each a labeled `input type="number"` with `data-bind` and `id` = the path with `.` → `-`: `tipDel` "Delivery tip (%)", `tipPick` "Pickup tip (%)", `wear` "Wear per mile ($)", `hourly` "Value of your time ($/hour)", `speed` "Average driving speed (mph)", `kwh` "Electricity ($/kWh)". Per app `p` (DoorDash, Uber Eats, Grubhub): a checkbox `id="plats-{p}-on"` (`data-bind="plats.{p}.on"`) "Compare {App}", the inputs for `delFee`, `svc`, `svcMin`, `memberSvc`, `memberMin`, `pickDisc` (labels as §5.5), and the promo: `select id="promos-{p}-type"` (`data-bind="promos.{p}.type"`, `data-type="text"`: `none` "No promo", `percent` "% off", `dollar` "$ off", `freedel` "Free delivery", `bogo` "Buy one, get one free") and inputs `promos-{p}-value`, `promos-{p}-cap`, `promos-{p}-min`. **When `promos[p].type === "bogo"`** (D-036), right after the promo select: for a profiled `S.rest`, `select id="promos-{p}-item"` (`data-bind="promos.{p}.item"`, no `data-type`, so `""` commits `null` and `"3"` commits `3`) labeled `"Free item"`, with a first option `value=""` `"Pick the item…"` and then one option per menu index `i` (`value="{i}"`, text = the item's `name`), the one equal to `promos[p].item` selected; otherwise (no restaurant, or an unprofiled one) `[data-testid="bogo-note-{p}"]` `"Buy one, get one free needs a restaurant with a menu."`. A result whose BOGO applied shows its `"BOGO: {name}"` note as a tag (§5.5) and a `Promo` receipt line. Shared: `regFee`, `smallMin`, `smallFee`. `id="plats-direct-on"` "Compare ordering direct". Under DoorDash, the note `"DoorDash publishes 15% service (5% with DashPass, on orders of $12 or more) for markets not yet on its newer fee model; check your own checkout."` (D-032).

*Amended by D-042:* each number input in this section, and in §5.5 step 4, whose path is in the state contract §4.8 key map gets the badge `span.est[data-testid="est-{id}"]` `"est."` (`id` = the input's `id`) **inside its `label`**, after the label text, while `POD.state.sourceOf(S, D, path) === "est"`. Inside the label, so the `.fields` grid keeps its number of children and the input is never replaced when the badge comes or goes. The label text before the badge is unchanged. Typing a value that differs from the estimate removes the badge here and from the rows that used it (§5.5 `estOf`).

### 5.10 `fine`

Plain text: the store data `"Restaurant locations: All The Places (CC-0), run {BRANDS_RUN}."`, `"App listings come from the chains' and apps' own announcements, some several years old: check the app."` (ISS-030), `"Card credits: each issuer's card page, as of {the latest asOf in D.CARDS}."`, `"Gas: U.S. EIA weekly retail prices (week of {GAS_WEEK}). Meal tax: state rates. Fuel economy: EPA, by model year."` (when `D.GAS_WEEK` is a string matching `/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/`; otherwise the same without the parenthesis: `"Gas: U.S. EIA weekly retail prices. Meal tax: state rates. Fuel economy: EPA, by model year."`, D-039), `"A VIN lookup goes from your browser to NHTSA's free decoder (vPIC). The VIN isn't saved."` (D-038), and, *amended by D-042*, `[data-testid="fine-est"]` `"Numbers marked est. are estimates. Most app fees aren't published, so each comes from the app's own page, from real checkouts (the middle of at least two, in different places) or from a published survey. App menu prices use a typical markup for the restaurant's kind of food, an estimate too. The typical car is the U.S. on-road average from EIA. Make any of them yours in Personalize."` (in place of D-032's "Every app fee left blank…"), then `[data-testid="fine-links"]`: `"Links open each app, the restaurant's own site or Google Maps. Your order doesn't carry over, so add your items there. A link carries only the restaurant's name or the store's location, never your address."` (D-041). When the page shows anything from the Worker (`S.milesSrc === "drive"`, `S.pos.src === "addr"`, or a non-empty independents list), one more line `[data-testid="fine-osm"]`: `"Road distances, street addresses and independent restaurants: OpenStreetMap (© OpenStreetMap contributors, ODbL), through this site's server."` (D-040).

### 5.11 `more`: the Personalize drawer (D-043)

- First child, always: `button.drawer-btn#drawer` with `data-action="drawer"` and `aria-expanded` = `"true"` when `view.drawer`, else `"false"`, holding only `span.drawer-title` `"Personalize"` and `span.chevron[aria-hidden="true"]` (empty; CSS draws it). **Its HTML depends only on `view.drawer`**, so a commit inside the drawer never replaces it and a click on it always lands (§2).
- Second child, always: `p.more-summary[data-testid="more-summary"]` = `"{car} · {members}"`:
  - `car`, the first that applies:
    - `S.fuel === "ev"` and `miPerKwh` is a number → `"Electric car"`;
    - `S.fuel !== "ev"`, `mpg` is a number and `sourceOf(S, D, "mpg") === "est"` → `"Typical car (est.)"`;
    - `S.fuel !== "ev"` and `mpg` is a number → `"{mpg} mpg car"`;
    - otherwise `"No car yet"`.
  - `members`: the names (DashPass, Uber One, Grubhub+) of the apps `p`, in `dd`, `ue`, `gh` order, whose `S.plats[p].member` is truthy, joined by `", "`. With none, `"No memberships"`.
- Then, only while `view.drawer`, as the tail: `section#trip` (§5.4), `section#car` (§5.7), `section#wallet` (§5.8), `section#settings` (§5.9), as complete sections with their headings.
- Closed by default on every page load (`view` isn't saved). A value changed inside the drawer doesn't close it.

## 6. Geolocation (BUILD.md §10)

`data-action="locate"`: when `navigator.geolocation` and its `getCurrentPosition` exist, call it (`{timeout: 10000, maximumAge: 600000}`). Success: `afterChange(POD.state.setPosition(S, D, coords.latitude, coords.longitude, opts))` (a `null` status, for an out-of-range position, renders unchanged). Failure (or no geolocation): `[data-testid="geo-error"]` `"Couldn't get your location. Type your ZIP instead."` (a page-only message, cleared by the next change). Never a console error.

## 6b. The VIN lookup (D-038, vin contract)

`data-action="vin"`: `v = POD.vin.clean(document.getElementById("vin").value)`; `view.vin = v`; `c = POD.vin.check(v)`.

- `c !== "ok"`: the message is `"length"` → `"A VIN has 17 letters and digits."`, `"chars"` → `"A VIN uses only digits and the letters A–Z except I, O and Q."`, `"digit"` → `"That VIN's check digit (its 9th character) doesn't match: check for a typo."`. **No request is made.** Render.
- Otherwise: `seq` = a page counter + 1 (taken on every click, see below); the message `"Looking up {v} with NHTSA…"`; render; then one `XMLHttpRequest`: `open("GET", POD.vin.url(v), true)`, `timeout = 10000`, no `withCredentials`, no request headers (a simple CORS request: no preflight). When it ends, if `seq` isn't the latest lookup's, the answer is ignored (a newer lookup started). Else:
  - `onload` with `status === 200`: `body` = `JSON.parse(responseText)` inside `try` (a throw → the failure below); `dec = POD.vin.decode(body)`. `dec === null` → `"NHTSA couldn't decode that VIN. Pick your car below."`. Else `m = POD.vin.match(dec, D)`; `POD.state.setCar(S, D, m.make, m.model, m.year)`; then the message, with `{car}` = `dec.year + " " + dec.make + " " + dec.model` (vPIC's own words):
    - `m.make === "Other"` → `"NHTSA says {car}. That make isn't in the EPA list: enter its fuel and mpg below."`
    - `m.model === ""` → `"NHTSA says {car}. Pick the model below: EPA's list names it differently."`
    - `POD.state.carLookup(D, m.make, m.model, m.year) === null` → `"NHTSA says {car}. EPA's list has no {dec.year} figure for it: enter its mpg below."`
    - else → `"NHTSA says {car}."`
    Then `afterChange(POD.state.derive(S, D, new Date(), opts))`.
  - Any other status, `onerror`, `ontimeout`, or a parse failure: `"Couldn't reach NHTSA's VIN decoder. Pick your car below."`, and render. `S` is unchanged.
- The message lives in `view` (page-only, not saved) and is cleared by the next `make`, `model` or `year` change and by the first-visit example (§7). Never a console error, whatever vPIC answers.
- *Amended 2026-11-16 (review of 7.5):* **the latest action wins.** Every Look up click takes a new `seq`, including one refused locally, and so does every `make`, `model` or `year` change and the first-visit example. A pending answer whose `seq` is no longer the latest is ignored, so it can't overwrite a newer message or a car the user picked by hand while it was on its way.

## 7. The first-visit example

`data-action="example"` runs, in order: `setAddress(S, D, "10118", opts)`, `setCar(S, D, "Toyota", "Camry")`, `setBrand(S, D, "dominos", opts)`, `setQty(S, 0, 1)`, then `afterChange` with the last trip status. These are the user's own kinds of input (a ZIP, a car, a restaurant, one item), not data: no number is invented. If a step fails (data changed), the page shows whatever it got.

## 8. What the page leaves to later phases

Deep links on result rows are done (Phase 9, D-041); a website for unprofiled chains and independents is ISS-042. The Worker is done (Phase 8). Per-item markup (Phase 6, D-036) has no control of its own: an override comes from the profile data and shows only through the results; per-item app prices typed by the user are ISS-036. Importing a real checkout (a screenshot through the Worker, or pasted text) is Phase 12 (decisions to be written); a "follow the restaurant across sessions" summary and folding answered steps into chips are left for later.

## 9. `POD.util.esc`

`esc(s)`: `String(s)` with `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`, `'` → `&#39;`, in that order (`&` first). `null` and `undefined` → `""`. Added to `pod.js`.

## 10. The quick flow: budgets and the look (D-043)

### 10.1 Budgets the e2e enforces (`tests/e2e/quick.e2e.js`)

On a first visit (empty storage, the committed `config.js`):
- **Controls:** at 390×844, at most **8** visible controls in `#app`. A control is an `a[href]`, `button`, `input` or `select` (`textarea` too) with a non-empty bounding box whose computed `visibility` is `visible`.
- **Height:** at 390×844, `document.documentElement.scrollHeight` is at most **1.5 × 844 = 1266** px.
- **Interactions:** at most **3** user actions from the first visit to a priced answer card with its button (`[data-testid="verdict"]` and `a[data-testid="cta"]` visible):
  - by ZIP: type a ZIP into `#address` and commit it, tap a restaurant in the near list, then tap `+` on a menu item or a quick total;
  - by location: "Use my location", the same tap, then the same `+` or quick total.
  - Typing a ZIP and committing it (Enter or leaving the box) counts as one action.
- **No horizontal scroll** at 390 and 1280 px, on the first visit and with an answer and the drawer open.

### 10.2 The look (user decision: clean fintech)

`src/css/app.css` is rewritten. It's still plain CSS, with no build step and no dependency (D-007).
- **Tokens** on `:root`, redefined under `@media (prefers-color-scheme: dark)`:
  - color: `--bg`, `--surface`, `--surface-2`, `--text`, `--muted`, `--border`, `--accent`, `--accent-ink` (text on the accent), `--save` (green), `--est` (muted grey), `--warn`;
  - radius: `--r-s`, `--r`, `--r-l`;
  - elevation: `--shadow-1`, `--shadow-2`;
  - type: `--font`, the system stack `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. Money uses `font-variant-numeric: tabular-nums`.
  - Contrast: body text, `.answer-net` and the CTA's text meet WCAG AA (4.5:1) against their backgrounds in both themes (checked by `quick.e2e.js`).
- **The accent** is used only for the primary action (`a.cta`), the selected state (`[aria-pressed="true"]`) and focus rings (`:focus-visible`, never removed). Savings (`.save`, `.neg`) are `--save`. Estimates (`.est`, `.est-note`) are `--est`.
- **Cards:** each section is a card (`--surface`, `--r-l`, `--shadow-1`). The answer card is the boldest element on the page: `.answer-net` is the largest type, and `a.cta` is full-width on a phone.
- **Steps:** `#loc`, `#near` and `#order` headings carry a step number 1, 2, 3 from a CSS counter (no markup).
- **Rows:** `.result-head` is a full-width button: the name and its badges on the left, `.net` on the right, and `.meter` a thin bar under them, filled by `.meter-fill` (`.best` in the accent, the rest in `--border`). `.row-more` sits under the head when open.
- **Monograms:** `.mono` is a 32 px rounded square, `background: hsl(var(--h) 55% 45%)`, white bold letter.
- **Chips:** `.chip` is a pill. `[aria-pressed="true"]` is filled with the accent.
- **The sticky bar:** `.sticky` is `position: fixed` at the bottom on a phone (≤ 760 px) and `display: none` on desktop. While it's present, the page has bottom padding at least its height, so the end of the page can scroll clear of it.
- **The drawer:** `.drawer-btn` is a full-width card-style button with a chevron that turns when `aria-expanded="true"`.
- **Motion:** short transitions (≤ 200 ms) on hover, open and the meter width, all off under `@media (prefers-reduced-motion: reduce)`.
- **Classes the markup uses** (§5), all to be styled: `site-head`, `answer`, `answer-kicker`, `answer-title`, `answer-net`, `save`, `cta`, `cta-alt`, `est-note`, `answer-trip`, `results-list`, `result`, `best`, `open`, `result-head`, `result-name`, `badge`, `est`, `est-none`, `net`, `meter`, `meter-fill`, `notes`, `tag`, `row-more`, `handoff`, `handoff-link`, `receipt`, `neg`, `num`, `near-list`, `mono`, `chips`, `chip`, `drawer-btn`, `drawer-title`, `more-summary`, `chevron`, `sticky`, `fields`, `app-settings`, `app-fees`, `app-need`, `vin`, `insight`, `muted`, `warn`, plus the ones `render.js` already writes.
