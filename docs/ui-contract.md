# UI contract (v5, Phase 5)

What the page shows and what each control calls: `src/js/render.js` (`POD.ui`), `src/js/app.js` (`POD.boot`, events, tiles, geolocation) and `src/css/app.css`. It fills in BUILD.md §3 and §10 on top of the state contract (D-031, D-033), the geography contract (D-030) and the insights contract (D-034). **Where it differs from BUILD.md, this file wins** (D-035). The e2e tests (`tests/e2e/`) check the hooks named here: ids, `data-testid`, `data-action` and the exact strings in quotes. Change them only by a decision, tests first.

*Amended 2026-11-14 after slice A:* `#side` wraps `results` + `insights` (no desktop gap, nothing clipped); `render` writes only the blocks that changed, so a click isn't lost when a text box commits on the same mouse press; `render(ctx)`; texts for no position, no routes, and "item"/"items"; manual car inputs only for "Other" or an unknown pair.

## 0. Rules

- **ES5, no framework, no runtime dependencies, `file://` works** (CLAUDE.md, D-007). Only `app.js` touches `document`, and only after `DOMContentLoaded`. `render.js` builds HTML strings from its arguments and holds no state of its own; `POD.ui.render(ctx)` (`ctx = {S, D, opts, view, now}`, where `view` holds the page-only flags of `app.js`) is the one function that writes the DOM.
- **One state object** `POD.S`. It changes only through `POD.state` functions (state contract §1). `S.tax`, `S.gas`, `S.rest`, `S.credits` and the other derived fields are never written by the page.
- **Every string from data or the user is escaped** with `POD.util.esc` before it goes into HTML (§9). Money is formatted only with `POD.util.money`.
- **Storage:** `window.localStorage`, read inside `try/catch` (accessing the property can throw). If it throws, storage is `null` and the page runs the same with nothing saved. Saving is `POD.state.save`, which never throws.
- **0 console errors** in every e2e flow (D-017), with one exception the browser makes: a tile file that doesn't exist logs a resource error we can't suppress (§4). Locally, without built tiles, that's expected; on Pages every tile in `TILE_INDEX` exists.
- **No horizontal scroll** at 390 px and 1280 px.

## 1. Boot (`POD.boot`, in `app.js`)

```
storage = safeStorage()                      // try { window.localStorage } catch → null
POD.opts = { failed: {} }                    // passed to every POD.state / POD.geo call that takes opts
POD.S = POD.state.load(storage, POD.data, new Date(), POD.opts)
afterChange(POD.state.derive(POD.S, POD.data, new Date(), POD.opts))   // load doesn't return the trip status
```

`afterChange(status)` (§3) then loads any tiles the trip or the "Near you" list needs, saves and renders. `POD.boot` is also callable again (the e2e doesn't need it).

## 2. Page layout and sections

One `<main id="app">` holding these sections in this DOM order, each a `<section>` with this `id`; `results` and `insights` sit together inside `<div id="side">`, placed after `trip`. Phone (≤ 760 px): one column in DOM order. Desktop (> 760 px): two columns, the input sections on the left (`loc`, `near`, `order`, `trip`, `car`, `wallet`, `settings`) and `#side` on the right, spanning every row, sticky at the top, and scrolling on its own (`max-height` the viewport, `overflow-y: auto`) when it's taller than the window, so nothing in it is ever cut off; `fine` spans both columns at the bottom.

| id | Heading | Shows |
|---|---|---|
| `loc` | Where are you? | §5.1 |
| `near` | Near you | §5.2 |
| `order` | Your order | §5.3 |
| `trip` | The trip | §5.4 |
| `results` | Cheapest way to get it | §5.5 |
| `insights` | Worth knowing | §5.6 |
| `car` | Your car | §5.7 |
| `wallet` | Your cards and credits | §5.8 |
| `settings` | Fees, tips and costs | §5.9 |
| `fine` | Where the numbers come from | §5.10 |

`index.html` keeps its header (`<h1>Pickup or Delivery</h1>`) and the empty `<main id="app">`; `render` fills it. **Writes only what changed** (BUILD.md §3's full replace, per block): `render` builds every section's HTML, and for each section replaces only the top-level child elements whose HTML differs from what's there (comparing the `outerHTML` of a freshly parsed copy with the current one; a different number of children replaces the section's content). An unchanged button is never replaced, so a click that starts while a text box commits (mouse down → the box loses focus → `change` → render) still lands. `render` also remembers the `id` of `document.activeElement` and focuses the element with that `id` afterwards if it was replaced.

## 3. Events (three document listeners, BUILD.md §3)

`app.js` adds exactly three listeners on `document`: `change`, `click` and `input`. Adding a control means adding markup.

- **`change`** on an element with `data-bind="path"`: `v` = the parsed value (below); `POD.state.setPath(S, path, v)`; then `afterChange(POD.state.derive(S, D, new Date(), opts))`. Parsing: a checkbox → `checked`; an element with `data-type="text"` → its string `value`; otherwise `value.trim()` empty → `null`, else `parseFloat`, and `NaN` → `null` (an empty or bad box is a missing value, and the page asks for it).
- **`change`** on an element with `data-action` (selects, checkboxes, the address box):

| `data-action` | Element | Calls |
|---|---|---|
| `address` | `input#address` | `setAddress(S, D, value, opts)` |
| `brand` | `select#brand` | `setBrand(S, D, value === "" ? null : value, opts)` |
| `make` | `select#make` | `setCar(S, D, value, "")` |
| `model` | `select#model` | `setCar(S, D, S.make, value)` |
| `toggle-card` | checkbox, `data-card` | `toggleCard(S, D, card, checked, new Date())` |
| `opt-in` | checkbox, `data-key` | `setOptIn(S, D, key, checked, new Date())` |
| `used` | checkbox, `data-key` | `markUsed(S, D, key, checked, new Date())` |

- **`click`** on an element (or inside one, via `closest`) with `data-action`:

| `data-action` | Attributes | Calls |
|---|---|---|
| `locate` | | geolocation (§6) |
| `example` | | the first-visit example (§7) |
| `pick-store` | `data-store` = index into the last `storesNear` list | `pickStore(S, D, store, opts)` |
| `qty` | `data-index`, `data-delta` (`1` or `-1`) | `setQty(S, index, max(0, current + delta))` |
| `pin` | | `pinMiles(S, parseFloat(#pinMiles.value))`; a bad number changes nothing |
| `unpin` | | `unpinMiles(S, D, opts)` |
| `add-credit` | | `addManualCredit(S, D, credit from the form, new Date())` (§5.8) |
| `remove-credit` | `data-key` | `removeManualCredit(S, D, key, new Date())` |
| `more-stores` | | shows every row of the "Near you" list (page-only flag, not saved) |

- **`input`**: nothing is committed while typing (values commit on `change`). The listener exists only so the count stays three; it may stay empty.
- **`afterChange(status)`** runs after every one of these: when `status` is a trip status with `status === "need"`, load its cells (§4). Also run `POD.geo.storesNear(S.pos.lat, S.pos.lon, D, opts)` when `S.pos` is a position, and load its `need` cells if its status is `"need"`. Then `POD.state.save(S, storage)` and `POD.ui.render()`.

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
- Without a position: `"Type a ZIP or address, or use your location, to see restaurants near you."`
- Always: `select#brand` (`data-action="brand"`): first option `value=""` `"Choose any chain…"`, then every `BRAND_IDS` brand sorted by name (plain `<` on the names), the selected one `S.brand`. Each option's text is the name, plus `" (estimate)"` when the brand isn't in `PROFILES`.

### 5.3 `order`

- No `S.rest`: `"Pick a restaurant first."`
- Profiled (`S.rest.profiled`): one row `[data-testid="menu-item"]` per menu index `i`: the name, `money(price)`, a tag `"Deal item"` when `isDealItem`, buttons `data-action="qty" data-index="{i}" data-delta="-1"` (label `"−"`, `aria-label="Remove one"`) and `data-delta="1"` (`"+"`, `aria-label="Add one"`), and the quantity in `[data-testid="qty-{i}"]` (`S.cart[i]` or 0). A footer `[data-testid="order-total"]` `"Menu total {money(menuSub)}"` from `POD.engine.cartInfo(S)` (pure; reads only `S`).
- When `S.rest.deal`: a checkbox `#dealOn` (`data-bind="dealOn"`) labeled `"Use the {deal.label} deal"`, and `[data-testid="deal-status"]`: `"Deal applies"` when `dealReady`, else `"Add {shortBy} more deal item for the deal"` (`items` when `shortBy > 1`).
- Unprofiled: `input#manualSubtotal` (`data-bind="manualSubtotal"`, `type="number"`, `step="0.01"`, `min="0"`) labeled `"Your order's menu total ($)"`, and the note `"{name} isn't profiled: app prices use a typical {category} markup, so these totals are estimates."` (`category` = `D.BRANDS[brand].category`).

### 5.4 `trip`

- `[data-testid="trip"]`: when `S.miles` is a number, `"{mi1(miles)} mi round trip · about {minutes} min"`, then a source line `[data-testid="trip-src"]`:
  - `milesSrc "store"`: `"To the nearest {name}, {mi1(straight)} mi away in a straight line (× 2 × 1.25 for the road)."` where `straight` = `POD.geo.distMi(S.pos.lat, S.pos.lon, S.store.lat, S.store.lon)`; with `S.storePicked`, `"To the {name} you picked, …"` with the same tail.
  - `"estimate"`: `"Estimated from how close together restaurants are around your ZIP."`
  - `"pinned"`: `"You set this distance."`
- When `S.miles` is `null`: `"No trip yet."`
- `input#pinMiles` (`type="number"`, `step="0.1"`, `min="0"`, value = `S.miles` or empty), a button `data-action="pin"` `"Use this distance"`, and when `milesSrc === "pinned"` a button `data-action="unpin"` `"Measure it for me"`.

### 5.5 `results`

In order, the first that applies:
1. `missing = POD.state.missing(S)` isn't `[]`: `[data-testid="missing"]` `"To compare, we still need: "` + the friendly names joined by `", "` + `"."`. Names, each listed once in this order: `rest` → `"a restaurant"`; `tax` → `"your ZIP or address"`; `fuel`, `mpg`, `gas`, `miPerKwh`, `kwh` → `"your car"`; `miles`, `minutes` → `"the trip distance"` (when tiles are loading: `"the trip distance (finding stores near you…)"`); `manualSubtotal` → `"your order's menu total"`; `tipDel` → `"the delivery tip"`; `tipPick` → `"the pickup tip"`; `wear` → `"wear per mile"`; `hourly` → `"the value of your time"`.
2. `F = POD.state.forEngine(S)`; `POD.engine.cartInfo(F).menuSub <= 0`: `[data-testid="empty-order"]` `"Add something to your order to compare."`
3. Otherwise `R = POD.engine.allResults(F)`:
   - `R` empty (every route switched off): `"Nothing to compare: every way to order from this restaurant is switched off."`
   - `[data-testid="verdict"]`: `"Cheapest: {R[0].name} at {money(R[0].net)}"`.
   - `ol[data-testid="results-list"]`, one `li[data-testid="result-row"][data-channel="{id}"]` per result in `R` order: the name, `[data-testid="net"]` = `money(net)`, the `member` badge when non-null, each note as a tag, and a `<details>` receipt whose `<summary>` is `"Receipt"` and whose rows are `[data-testid="line"]` with `[data-testid="line-label"]` = the label and `[data-testid="line-amount"]` = `money(amount)`, except a `Delivery fee` of 0, which shows `"waived"`. Negative amounts get the class `neg` (green). The first row also has the class `best`.
4. Below whichever of 1–3 showed, **apps waiting for fees** `[data-testid="app-fees"]`, when some app `p` in `S.rest.platforms` with `S.plats[p].on === true` has a non-empty `appMissing(S, p)`: the heading `"Add what your app's checkout shows"`, then per such app (in `dd`, `ue`, `gh` order) `[data-testid="app-fees-{p}"]` with `"{App}: delivery isn't compared until you enter these."` (or `"{App} isn't compared until you enter these."` when its list has its `markup` or `pickDisc`), and one labeled `input type="number" step="0.01" min="0"` per missing path of that app, `id="need-{path with . replaced by -}"`, `data-bind="{path}"`. The shared paths (`regFee`, `smallMin`, `smallFee`) get one input each, after the apps, under `"Shared by all three apps"`. Labels: `delFee` "Delivery fee ($)", `svc` "Service fee (%)", `svcMin` "Minimum service fee ($)", `memberSvc` "Service fee with membership (%)", `memberMin` "Order minimum for membership benefits ($)", `pickDisc` "Pickup discount (%)", `markup` "Menu markup (%)", `regFee` "Regulatory fee ($, 0 if none)", `smallMin` "Small-order fee applies under ($)", `smallFee` "Small-order fee ($, 0 if none)".

### 5.6 `insights`

When step 3 of §5.5 showed results: `POD.insights.build(F, R, new Date())`, each as `div[data-testid="insight"][data-id="{id}"]` with class `insight` plus `cls` when non-empty, holding `<strong>{label}</strong>` and the escaped `text`. None, or no results: the section shows `"Nothing to flag yet."`.

### 5.7 `car`

- `select#make` (`data-action="make"`): `""` `"Choose a make…"`, every make of `D.CAR_DATA` in its order, then `"Other"`. `select#model` (`data-action="model"`): `""` `"Choose a model…"` then the make's models in data order; shown when a listed make is chosen.
- When the make is `"Other"`, or a make and a model are chosen and the pair isn't in `D.CAR_DATA`: `select#fuel` (`data-bind="fuel"`, `data-type="text"`: `regular`, `premium`, `diesel`, `ev` labeled "Regular", "Premium", "Diesel", "Electric"), and `input#mpg` (`data-bind="mpg"`) or, for `ev`, `input#miPerKwh` (`data-bind="miPerKwh"`).
- `[data-testid="car-summary"]`: `S.fuel === "ev"` and `miPerKwh`: `"{miPerKwh} mi/kWh · electric"`; else when `mpg`: `"{mpg} mpg · {fuel}"`; else `"No car yet."`.

### 5.8 `wallet`

- Every card of `D.CARDS`, grouped under its `issuer` (in data order): `input type="checkbox"` with `data-action="toggle-card"`, `data-card="{id}"`, `id="card-{id}"`, checked when `S.cards` has it, labeled with `name`.
- After the list, for each entry `c` of `S.credits` (state contract §5.1), `[data-testid="credit"][data-key="{key}"]`: the name, `money(amount) + " " + cadence`, and its tier tag: `"Locked"` (`locked`), `"Some restaurants"` (`restricted`), else `"Works on {plats}"` (plats as app names, `direct` → "ordering direct"). Restricted: checkbox `data-action="opt-in" data-key` `"Qualifies here"` (checked when `S.creditOptIn[key] === true`). Not locked: checkbox `data-action="used" data-key` `"Used this period"` (checked when `c.used`). Manual credits also get `button data-action="remove-credit" data-key` `"Remove"`.
- Memberships, per app `p`: when a held card provides it (`D.CARDS` `membership === p`), a checkbox `id="cardMember-{p}"` `data-bind="plats.{p}.cardMember"` `"Use the {member name} my card includes"`; always a checkbox `id="memberOwn-{p}"` `data-bind="plats.{p}.memberOwn"` `"I pay for {member name}"` (DashPass, Uber One, Grubhub+).
- Add a credit: `input#mc-name` (text), `input#mc-amount` (number), `select#mc-cadence` (`once`, `monthly`, `quarterly`, `semiannual`, `annual`), checkboxes `#mc-plat-direct`, `#mc-plat-dd`, `#mc-plat-ue`, `#mc-plat-gh`, and `button[data-action="add-credit"]` `"Add credit"`. The credit is `{name, amount: parseFloat, cadence, plats: the checked ones}`; a refusal (`null`) shows `[data-testid="mc-error"]` `"Give the credit a name, an amount above $0 and where it works."`

### 5.9 `settings`

Each a labeled `input type="number"` with `data-bind` and `id` = the path with `.` → `-`: `tipDel` "Delivery tip (%)", `tipPick` "Pickup tip (%)", `wear` "Wear per mile ($)", `hourly` "Value of your time ($/hour)", `speed` "Average driving speed (mph)", `kwh` "Electricity ($/kWh)". Per app `p` (DoorDash, Uber Eats, Grubhub): a checkbox `id="plats-{p}-on"` (`data-bind="plats.{p}.on"`) "Compare {App}", the inputs for `delFee`, `svc`, `svcMin`, `memberSvc`, `memberMin`, `pickDisc` (labels as §5.5), and the promo: `select id="promos-{p}-type"` (`data-bind="promos.{p}.type"`, `data-type="text"`: `none` "No promo", `percent` "% off", `dollar` "$ off", `freedel` "Free delivery") and inputs `promos-{p}-value`, `promos-{p}-cap`, `promos-{p}-min`. Shared: `regFee`, `smallMin`, `smallFee`. `id="plats-direct-on"` "Compare ordering direct". Under DoorDash, the note `"DoorDash publishes 15% service (5% with DashPass, on orders of $12 or more) for markets not yet on its newer fee model; check your own checkout."` (D-032).

### 5.10 `fine`

Plain text: the store data `"Restaurant locations: All The Places (CC-0), run {BRANDS_RUN}."`, `"App listings come from the chains' and apps' own announcements, some several years old: check the app."` (ISS-030), `"Card credits: each issuer's card page, as of {the latest asOf in D.CARDS}."`, `"Gas: U.S. EIA weekly retail prices. Meal tax: state rates. Fuel economy: EPA."`, and `"Every app fee left blank is one the app doesn't publish (D-032): enter what your checkout shows."`.

## 6. Geolocation (BUILD.md §10)

`data-action="locate"`: when `navigator.geolocation` and its `getCurrentPosition` exist, call it (`{timeout: 10000, maximumAge: 600000}`). Success: `afterChange(POD.state.setPosition(S, D, coords.latitude, coords.longitude, opts))` (a `null` status, for an out-of-range position, renders unchanged). Failure (or no geolocation): `[data-testid="geo-error"]` `"Couldn't get your location. Type your ZIP instead."` (a page-only message, cleared by the next change). Never a console error.

## 7. The first-visit example

`data-action="example"` runs, in order: `setAddress(S, D, "10118", opts)`, `setCar(S, D, "Toyota", "Camry")`, `setBrand(S, D, "dominos", opts)`, `setQty(S, 0, 1)`, then `afterChange` with the last trip status. These are the user's own kinds of input (a ZIP, a car, a restaurant, one item), not data: no number is invented. If a step fails (data changed), the page shows whatever it got.

## 8. What the page leaves to later phases

Deep links on result rows (Phase 9), per-item markup (Phase 6), the Worker (Phase 8), a VIN box (Phase 7).

## 9. `POD.util.esc`

`esc(s)`: `String(s)` with `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`, `'` → `&#39;`, in that order (`&` first). `null` and `undefined` → `""`. Added to `pod.js`.
