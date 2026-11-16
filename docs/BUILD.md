# Pickup or Delivery — Build Guide (v5)

> **v5 (2026-11-16).** This is the spec for the v5 rebuild as shipped. It replaces the v4 build guide, which described a single-file prototype and is kept in git history (`git show 2a84085:docs/BUILD.md`). v5 folds in every decision from D-001 to D-041 ([`decisions.md`](decisions.md)) and points to the nine contracts below for the exact rules. **Where this file and a contract or decision differ, the contract or decision wins**: they're the definitions the code and the independent references are tested against, and this file is the map.

A decision engine that answers one question: **is it cheaper to have food delivered, to order pickup through a delivery app, or to order direct from the restaurant**, once gas, fees, menu markup, promos, card credits and direct-only deals are all priced in?

**Status:** v5, shipped from `main` to GitHub Pages at `/Delivery-vs-Takeout/`. ES5, no framework, no runtime dependencies, no build step for the page. `file://` works.
**Last verified:** 16 Nov 2026. Several datasets are time-sensitive: see [§7](#7-data-provenance-and-staleness).

| Contract | Defines | Decision |
|---|---|---|
| [`engine-contract.md`](engine-contract.md) | `POD.engine`: channels, the §4.2 order, every formula and its rounding, credits, receipt lines | D-029 (amended by D-033, D-036, D-040) |
| [`geo-contract.md`](geo-contract.md) | `POD.geo`: ZIPs, the estimator, cells and tiles, `storesNear`, `nearestStore` | D-030 |
| [`state-contract.md`](state-contract.md) | `POD.state`: `S`, the derivation cascade, user actions, the wallet, persistence | D-031 (amended by D-033, D-036, D-037, D-040) |
| [`insights-contract.md`](insights-contract.md) | `POD.insights.build`: the nine advice cards, their numbers and sentences | D-034 (amended by D-036) |
| [`ui-contract.md`](ui-contract.md) | the page: sections, events, tiles, geolocation, the example, escaping | D-035 (amended by D-036 to D-041) |
| [`vin-contract.md`](vin-contract.md) | `POD.vin`: checking a VIN, NHTSA's decoder, matching onto the car tables | D-038 |
| [`api-contract.md`](api-contract.md) | the optional Worker (`worker/`) and the browser seam `POD.api` | D-040 |
| [`links-contract.md`](links-contract.md) | `POD.links` and `POD.data.LINKS`: where each result row hands off | D-041 |
| [`decisions.md`](decisions.md) | every product and engineering choice, D-001 to D-041 | — |

---

## 1. Why this exists

Ordering food has four or five plausible routes and no way to compare them without building the same cart in four apps. The spread is large and non-obvious, and the routes differ in ways a naive calculator misses.

The headline finding that shapes the product: **fuel almost never decides the answer.** Menu markup, fees and card credits do. A short round trip costs well under a dollar in gas; one app's markup and fees on a $28 order cost $12–20. The page leads with the ranked total, not with gas.

Three things the engine gets right that a naive calculator doesn't:

1. **Direct-only deals** reprice the cart before anything else (engine contract §5.1). On the shipped data no profiled chain has a confirmed direct-only deal yet (all nine `deal: null`, ISS-035), so the deal path is exercised by the receipts and the Unlock insight, and waits for data.
2. **App pickup is a distinct route from direct pickup.** Ordering pickup inside an app keeps you on the app's payment rail, so a platform card credit still fires, and app pickup pays no delivery fees (D-033).
3. **Most published "food credits" can't be spent on takeout.** See [§9.1](#91-merchant-restricted-credits-applied-universally).

The v4 receipts ($15.62 / $52.13 for two Domino's pizzas in Brooklyn) are not reproduced: v5 re-researched every number (D-001), and its receipts are worked by hand from the new data in `tests/fixtures/receipts/`.

---

## 2. Files and running it

```
index.html            page shell; its <script> tags are the single source of truth for load order
src/js/               ES5 app code, all under one POD global (D-008)
src/data/             reference data; every file has a provenance header
src/data/stores/      store tiles, built at deploy time (D-011); gitignored
src/css/app.css       styles
tools/                data generators, the site build and its gates, the ES5 gate
tools/data/           hand-entered inputs with evidence (profiles, categories, defaults, tax)
worker/               the optional Cloudflare Worker (D-040); modern JS, not served by Pages
tests/                unit (node:test), e2e (Playwright), oracle (Python references), fixtures
docs/                 this file, the contracts, decisions, issues, progress
.github/workflows/    test.yml (CI on every push and PR), pages.yml (deploy and the weekly refresh)
```

**Run it:** open `index.html` in a browser. `file://` works, with no server and no build step. Without built tiles each tile fails to load (the browser logs it), the "Near you" list says it may be incomplete, and the trip falls back to the estimator; to build tiles locally, run `tools/build-stores.py` once (D-011) or build the whole site (below).

**Load order** (`index.html`):

```
src/js/pod.js            POD namespace, POD.util (round2, money, esc, clamp), POD.STORAGE_KEY
src/js/config.js         POD.config.apiBase ("" = Worker off, the committed value)
src/data/zips.js         ZIP_CITIES, ZIP_PACKED
src/data/cars.js         CAR_DATA, CAR_YEARS
src/data/states.js       STATES, GRADE_ADD, GAS_WEEK
src/data/cards.js        CARDS
src/data/brands.js       BRANDS, BRAND_IDS, BRANDS_RUN, TILE_INDEX
src/data/profiles.js     PROFILES
src/data/categories.js   CATEGORY_DEFAULTS
src/data/defaults.js     DEFAULTS (fees, plats, tips, trip)
src/data/links.js        LINKS
src/js/engine.js         POD.engine
src/js/geo.js            POD.geo
src/js/api.js            POD.api (the Worker seam)
src/js/state.js          POD.state
src/js/vin.js            POD.vin
src/js/insights.js       POD.insights
src/js/links.js          POD.links
src/js/render.js         POD.ui (HTML strings; render(ctx) is the one DOM writer)
src/js/app.js            POD.boot, the three document listeners, tile loading, geolocation
```

Every file is a classic script that attaches to `POD`. `tests/helpers/load.js` parses these tags, so a new file is added to `index.html` and nowhere else.

**Build the Pages site** (what `pages.yml` runs): `ATP_RUN=latest bash tools/build-site.sh <out>`. It copies `index.html` and `src/` into `<out>`, regenerates `src/data/brands.js` and the tiles from the latest All The Places run and `src/data/states.js` from EIA's latest week, then runs the gates in `tools/check-site.js` ([§10](#10-deployment)). The repo's own `src/` is never written.

**Test it:** see [§13](#13-testing).

### Regenerating data

Data files are generated, never hand-edited, except `cards.js` and `links.js` (written by the orchestrator, D-013, D-041). Each generator records its source, date and method in the file's header (`data-research` skill).

| File | Generator | Input |
|---|---|---|
| `src/data/zips.js` | `tools/build-zips.py` | `midwire/free_zipcode_data`: 42,354 ZIPs, 18,908 cities |
| `src/data/cars.js` | `tools/build-cars.py --since 2025 --years-since 2000` | EPA `vehicles.csv.zip` (D-023, D-037) |
| `src/data/states.js` | `tools/build-states.py` | EIA weekly prices (D-022) + `tools/data/state-tax.csv` (D-025) |
| `src/data/brands.js` + tiles | `tools/build-stores.py --run <id\|latest>` | All The Places run + Name Suggestion Index (D-020, D-021) |
| `src/data/profiles.js`, `categories.js` | `tools/build-profiles.py` | `tools/data/profiles/<brandId>.json`, `tools/data/categories.json` (D-027) |
| `src/data/defaults.js` | `tools/build-defaults.py` | `tools/data/defaults-platforms.json`, `defaults-trip.json` (D-032) |

**ZIP format** (unchanged from v4): `ZIP_PACKED` is records joined by `;`, fields by `,`: `zip,lat×1000,lon×1000,cityIndex,ST`. Integer coordinates (3 d.p. ≈ 110 m) keep the file at about 1.4 MB. The v4 constant `ZIP_TOTAL` is gone: the estimator counts usable records (`zipCount`, geo contract §3).

---

## 3. Architecture

Still deliberately boring: one state object, pure functions that take everything as arguments, and one render function that writes only what changed.

```
   src/data/* (POD.data = D)          tiles: D.TILES[cell], loaded on demand
              │
              ▼
   POD.state (pure; mutates only S) ── derive(S, D, now, opts) ──┐
     applyCar → applyState, applyAddress, applyBrand,            │
     autoMiles, syncCredits                                       │
              │                                                   ▼
              │                          forEngine(S) → F ── POD.engine.allResults(F) → R
              │                                                   │
              │                          POD.insights.build(F, R, now)   POD.links.forChannel
              ▼                                                   │
   POD.ui.render({S, D, opts, view, now})  ◄──────────────────────┘
     writes only the blocks whose HTML changed
```

**Conventions worth keeping** (UI contract §0, D-007, D-008):

- **ES5 only in `src/`, no framework, no runtime dependencies.** `var`, `function`, no arrow functions or template literals. `npm run test:es5` (acorn) enforces it on every file in `src/`. GitHub Pages removed v4's CSP reason, but ES5 keeps `file://` and old browsers working.
- **Everything is pure except `app.js`.** The engine, geography, state, insights, VIN and links modules read only their arguments: no `POD.S`, no `POD.data`, no DOM, no `Date` of their own (the clock comes in as `now`). That's what lets each one be checked to the cent against an independent Python reference.
- **Bad input never throws.** Each contract says what bad input returns (`null`, `[]`, `false`, unchanged `S`).
- **Event delegation.** Exactly three document listeners (`change`, `click`, `input`) dispatch on `data-bind` and `data-action`. Adding a control means adding markup.
- **Binding:** `data-bind="path.to.field"` → `POD.state.setPath`, which writes only plain values on paths `fresh()` has. Values commit on `change`; an empty or unparsable box is `null`, so the page asks for it rather than pricing a 0 (D-035).
- **Render writes only what changed.** v4's full replace lost clicks when a text box committed on mouse down; v5 compares each block's HTML and replaces only blocks that differ, and restores focus by `id` (UI contract §2).
- **Every string from data or the user is escaped** with `POD.util.esc`; money is formatted only with `POD.util.money`.
- **Persistence** is `localStorage` under one key, `POD.STORAGE_KEY = "pod.v5"` (D-010). Only user fields are saved; derived fields (`rest`, `tax`, `gas`, `credits`, `member`, `markup`) never are, so a data refresh can't leave stale copies (D-031). Storage access is wrapped in `try/catch`; a throwing storage runs the page on defaults with nothing saved.

---

## 4. The pricing engine

`POD.engine.calc(S, channel, override)` is the whole product (D-008: state is an argument, so it runs in Node). **The exact definition is [`engine-contract.md`](engine-contract.md) (D-029).** This section is its summary.

### 4.1 Channels

Eight routes, four platforms × two modes, unchanged from v4:

```
direct-d  direct-p    // the restaurant's own site or app
dd-d      dd-p        // DoorDash
ue-d      ue-p        // Uber Eats
gh-d      gh-p        // Grubhub
```

A channel that doesn't exist for this restaurant is **left out**, never priced at $0 (§9.3): direct delivery needs `rest.directDelivery`; an app needs the restaurant on that app (`rest.platforms`) and the app switched on; an app whose delivery fees the user hasn't entered keeps its pickup and loses only its delivery row (D-033). `allResults(S, override)` returns the available channels sorted by `net`, ties in `CHANNELS` order.

### 4.2 Order of operations

**This sequence is load-bearing.** Every component is rounded to the cent when it's computed, and `gross` and `net` are sums of rounded components (D-012), so the JS and the Python oracle agree exactly.

| # | Step | v5 rule (engine contract §5) |
|---|------|--------|
| 1 | **Direct-only deal** | Direct channels only, when the user's deal switch is on, the cart has `deal.minItems` eligible items and the deal's `scope` covers the mode. A deal never raises an item's price. |
| 2 | **Markup** | Direct: none. Apps: a sum over cart lines, `Σ price × qty × (1 + markup_i/100)`, rounded once, where `markup_i` is the item's own markup on that app or else the app's (D-036). Unprofiled brands mark up the typed subtotal by the category default. |
| 3 | **Fees** | App delivery: delivery fee, service fee (% with a `svcMin` floor), small-order fee, regulatory fee. A membership at `food >= memberMin` waives the delivery fee and uses `memberSvc`. App pickup: none. Direct delivery: `directFee`. Direct either mode: `directSvc` when modeled (ISS-031). |
| 4 | **Discounts** (apps) | One promo per app (`percent` with cap, `dollar`, `freedel`, `bogo`) tested against the **marked-up** food (§9.2), plus the app's pickup discount; jointly clamped to the food. |
| 5 | **Tax** | On the **discounted** food. A `freedel` promo comes off the delivery fee, so it doesn't lower the tax. |
| 6 | **Tip** | On the **pre-discount** food (§9.4); delivery and pickup rates differ. |
| 7 | **Drive** | Pickup modes only: energy (`miles / mpg × gas`, or `miles / miPerKwh × kwh` for an EV) + wear (EVs pay wear too) + `hourly × minutes / 60` (default $0/hr). |
| 8 | **Card credits** | Off the very end, the way a statement credit lands; only eligible credits (§9.1 tiers, platform, mode, Amex Gold partner); clamped so the total never goes negative. |

```
gross = food + fees + tax + tip + drive
net   = max(gross − disc − credit, 0)
```

### 4.3 Return shape

```js
{ id, plat, mode, name,
  parts: { food, fees, tax, tip, drive },
  gross, net, disc, credit, off,          // off = disc + credit
  lines: [[label, amount], ...],          // the itemized receipt, in a fixed order, ending ["TOTAL", net]
  notes: [],                              // "Deal: …", "BOGO: …", "Estimate"
  member }                                // "DashPass" | "Uber One" | "Grubhub+" | null
```

### 4.4 The `override` parameter

`calc(S, ch, {cart, manualSubtotal, miles, minutes})` replaces those fields for one call without mutating `S`. The insights use it for counterfactuals ("add one more item", "clear the minimum"). Keep it pure.

### 4.5 Insights

`POD.insights.build(F, R, now)` turns the ranked results into advice. **The exact definition is [`insights-contract.md`](insights-contract.md) (D-034):** when each card shows, its numbers and its sentence character for character. Insights return plain text and numbers; the page escapes them.

| Card | Says |
|---|---|
| **Unlock** | you're N items from a direct-only deal; here's the total with the cheapest deal item added |
| **Distance** | the round trip at which delivery starts to win |
| **Fuel** | the gas price at which delivery would win (capped at $12/gal; skipped for an EV) |
| **Minimum** | a promo just out of reach, and what adding the cheapest item does to the total (counts a `bogo` promo at a profiled brand when reaching the minimum makes something free) |
| **Wallet** | the restaurant is an Amex Gold dining partner, so the credit works ordering direct |
| **Timing** | unused credits that apply here, and the days until each resets |
| **Locked** | credits on your cards that can't pay for this order, and restricted ones not opted in |
| **Nuance** | app pickup beats the counter |
| **Spread** | the gap between the best and worst route |

An empty order gets no advice. The bar for a new insight is unchanged: it must say something the ranked list doesn't already show.

---

## 5. State (`POD.state`)

**The exact definition is [`state-contract.md`](state-contract.md) (D-031).** Every function reads only its arguments (`D`, `now`, `storage`, `opts`) and mutates only `S`, so the whole cascade runs in Node with a fake clock and a throwing storage.

### 5.1 `fresh(D)`

```js
{
  // location
  address, pos,                 // pos: {lat, lon, src: "zip"|"gps"|"addr"}
  zip, zipRec, state, tax, gas,

  // car (D-037: year-aware)
  make, model, year, fuel, mpg, miPerKwh, kwh,

  // restaurant and order
  brand, rest,                  // rest = POD.engine.restFor(brand, D); derived, never saved
  store, storePicked, place,    // place: a picked independent (D-040)
  cart, manualSubtotal, dealOn, // cart: { menuIndex: qty }

  // trip
  miles, minutes, speed,
  milesAuto, milesSrc, milesBy, // milesSrc: "store"|"drive"|"estimate"|"pinned"|null

  // money
  tipDel, tipPick, wear, hourly, regFee, smallMin, smallFee,

  // wallet
  cards, credits, creditOptIn, usedIn, manualCredits,

  plats: { direct: {on}, dd: {...}, ue: {...}, gh: {...} },
  promos: { dd: {type, value, cap, min, item}, ue: {...}, gh: {...} }
}
```

Defaults come from `src/data/defaults.js` and are **official numbers only** (D-032): a fee an app doesn't publish starts `null`, the page asks the user for it, and that app's delivery row waits until it's filled (D-033). On the shipped data every app's delivery fee starts empty.

### 5.2 The derivation cascade

`derive(S, D, now, opts)` runs these in order. It never resets a user field, so `load` = the saved user fields merged over `fresh`, then `derive`.

| Function | Sets |
|---|---|
| `applyCar` | `fuel`, `mpg`/`miPerKwh` from `carLookup(make, model, year)`, then `applyState` |
| `applyState` | `tax`, `gas` (the state's EIA price + the grade spread) |
| `applyAddress` | `zip` (the last 5-digit run in the address), `zipRec`, `state`, `pos`, then `applyState` |
| `applyBrand` | `rest`, the apps' markups |
| `autoMiles` | the trip: from the nearest (or picked) store, the road distance when the Worker answered, or the estimator; a pinned distance wins. While tiles load it reports `need` and clears the trip rather than price a stale distance (D-031 amendment). |
| `syncCredits` | `credits` from `cards`, keeping used flags, manual credits and opt-ins; a card's membership turns the app's membership on |

User actions (`setAddress`, `setPosition`, `setCar`, `setBrand`, `pickStore`, `setQty`, `pinMiles`, `unpinMiles`, `toggleCard`, `setOptIn`, `markUsed`, `addManualCredit`, `removeManualCredit`) are the only way the page changes `S`. `setBrand` empties the cart and clears every BOGO item. `forEngine(S)` builds the copy the engine prices (D-033).

**`syncCredits` is still destructive by design**: it rebuilds credits from the cards and must explicitly carry over every piece of per-credit user state. A used flag now belongs to a period (`usedIn[key] = "2026-11"`), so it resets by itself when the month, quarter or half-year turns.

---

## 6. Data tables (`POD.data`)

Every file starts with a provenance header (source, as-of date, method, nulls, estimates). `src/data/` never holds an invented number: a value nobody published is `null` or an `est`-flagged default with a recorded reason.

### `STATES`, `GRADE_ADD`, `GAS_WEEK`
`STATES` rows are `[code, name, gasRegular, mealTaxPct]`: 50 states and DC. Gas is EIA's weekly retail regular price for the state where EIA publishes one, else its PADD or PADD 1 sub-region, else "West Coast except California" for AK, AZ, HI, NV and OR (D-022). `GRADE_ADD` is EIA's U.S. midgrade, premium and diesel minus regular for the same week. Tax is the state meal tax where one exists, else the Tax Foundation's combined state + average local rate; Virginia uses its combined rate (D-025). `GAS_WEEK` is the EIA week, shown in the fine print. v4's `lat`/`lon` columns and `ZIP3` are gone (D-009).

### `CAR_DATA`, `CAR_YEARS`
`CAR_DATA`: one packed string per make, `"Make|Model:value,Model:value*"`, each model's newest EPA figure (48 makes, D-023). `CAR_YEARS`: the same per model year from 2000 on, `"Make|Model:runs"`, runs newest first (86 makes, D-037), so a VIN's model year gets that year's figure. Suffixes:

| Suffix | Meaning | Value |
|---|---|---|
| *(none)* | regular gas | EPA combined MPG |
| `*` | premium | EPA combined MPG |
| `d` | diesel | EPA combined MPG |
| `e` | electric | mi/kWh × 10 (`41e` = 4.1) |

Model names never contain `,` `:` or `|`. A car not in the tables is "Other", and the user enters its figure.

### `CARDS`
An ordered array of 22 cards (13 Amex, 7 Chase with a DoorDash benefit, Capital One Venture X and Savor) with 21 food-relevant credits (D-024). Written by the orchestrator from the issuers' own pages (D-013).

```js
{ id, issuer, name, url, asOf, membership?, note?, credits: [
  { id, name, amount, cadence, plats, modes?, goldPartner?, restricted?, locked?, source, asOf, note } ] }
```

- `amount` is per `cadence` period, never annualized. The key for opt-ins and used flags is `cardId + "." + creditId`.
- **Tier** (§9.1): universal (neither flag), `restricted` (applies only after the user opts in), `locked` (never applies; `plats: []`). Never both.
- `membership` means the card **provides** the app's membership. A card that only reimburses one the user must buy doesn't set it (§9.7).
- `modes` limits a credit to delivery (`["d"]`) or pickup (`["p"]`). When pickup eligibility isn't stated, it's delivery only.

### `BRANDS`, `BRAND_IDS`, `BRANDS_RUN`, `TILE_INDEX`, `TILES`
v4's fixed `CHAINS` list is replaced by **restaurants near the user** (D-005). `BRANDS` holds the 273 US food brands with at least 25 stores in an All The Places run (`{id: {name, category, wikidata, stores}}`), from 182,567 deduplicated stores in 847 one-degree tiles (run `2026-10-31-13-32-34` in the committed copy; the Pages build uses the latest run). A brand's `category` (one of 10: pizza, burger, chicken, mexican, sandwich, asian, coffee, dessert, casual, other) comes from its stores' `cuisine` tags (D-021). Tiles (`src/data/stores/<cell>.js`) assign `POD.data.TILES[cell] = {run, s: "b,la,lo;…"}` and are loaded by script injection with `?v=<BRANDS_RUN>`, which works over `file://` (D-035).

### `PROFILES`, `CATEGORY_DEFAULTS`
**Profiled** brands have a researched menu, deal, direct delivery fee, app markup and the Amex Gold flag; **unprofiled** brands use their category's default markup (`est`), the user's typed cart total, no direct-delivery channel, and are labeled estimates (D-006). Nine chains are profiled (D-026, D-028): `buffalo_wild_wings`, `chipotle`, `dominos`, `dunkin`, `little_caesars`, `papa_johns`, `subway`, `the_cheesecake_factory`, `wingstop`. `taco_bell`, `pizza_hut` and `five_guys` were chosen but couldn't be researched from here: Taco Bell answers only browser-like user agents (ISS-013), Five Guys sits behind a Cloudflare bot check (ISS-017), and Pizza Hut's site reset or timed out every connection (ISS-021). Getting around a block isn't done (§9.10), so they ship unprofiled.

```js
PROFILES[brandId] = {
  menu: [{ name, price, dealItem, markup? }],   // prices: medians of 2–3 stores in different states (D-027)
  deal: { label, price, minItems, scope } | null,
  markup: { dd?, ue?, gh? }, markupEst,           // percent, a key for each listed platform only; every value today is the
                                                   // category default (markupEst: true, ISS-012); no platform → {} (Buffalo Wild Wings)
  directDelivery, directFee?,                      // no observed fee → directDelivery: false, never directFee: 0 (only Wingstop has one, $2.99)
  directSvc?,                                      // a direct-channel service fee; none researched yet (ISS-031)
  amexGoldDirect,                                  // buffalo_wild_wings, the_cheesecake_factory (five_guys is unprofiled)
  platforms: ["dd", "ue", "gh"]                    // only apps with dated evidence (none for Buffalo Wild Wings)
}
CATEGORY_DEFAULTS[category] = { markup: { dd, ue, gh }, est }
```

A brand in `BRANDS` whose category has no default can't be priced: `restFor` returns `null`, because a missing markup must never become 0% (§9.6).

### `DEFAULTS`
`{fees, plats, tips, trip}`: the sourced starting values (D-032). Wear $0.1104/mi (AAA 2025), home electricity $0.1816/kWh (EIA), speed 27 mph (FHWA NHTS, `est`), tips 15% delivery / 0% pickup (the user's product choice, ISS-033), and DoorDash's published service rates. Unpublished fees are `null`.

### `LINKS`
Where each result row hands off ([`links-contract.md`](links-contract.md), D-041): each app's home page and confirmed search format, Google Maps' directions and search formats, and each profiled chain's home page, every URL with how and when it was seen working.

---

## 7. Data provenance and staleness

| Data | Source | As of (committed) | Refresh | Staleness risk |
|---|---|---|---|---|
| State gas | EIA weekly retail (D-022) | week of 2026-11-09 | **weekly, by the Pages build** (D-039) | High, handled |
| Store locations, brands | All The Places, CC-0 (D-020, D-021) | run 2026-10-31 | **weekly, by the Pages build**, with a fallback to an older run that passes the gates (D-039) | Medium, handled |
| Meal and sales tax | state rates; Tax Foundation combined (D-025) | 2026 | by hand (`tools/data/state-tax.csv`) | Low (NH, VT, DC read from search results, ISS-010) |
| ZIP centroids | `midwire/free_zipcode_data` | 2026-11-12 | by hand | Low (stacked coordinates, ISS-032) |
| Fuel economy | EPA `vehicles.csv` (D-023, D-037) | 2026-11-16 | by hand | Low |
| Card credits | issuers' card pages (D-024) | 2026-11-12 | by hand, orchestrator only | **High**: terms change often |
| Menu prices, fees | chains' own ordering sites (D-027) | 2026-11-12 | by hand | **High**: franchise-variable |
| App markups | category defaults from published reporting (ISS-012) | 2026-11-12 | by hand | Medium: estimates, labeled |
| App fees | apps' own fee pages (D-032) | 2026-11-13 | by hand | Medium: most are `null` and entered by the user (ISS-034) |
| App platform presence | dated announcements (ISS-030) | various | by hand | Medium: flagged in the fine print |
| Link formats | seen working (D-041) | 2026-11-16 | by hand | Medium |

**Date-dependent logic:** v4's Sapphire Reserve branch on a fixed date is gone. Credits carry a `cadence`; `periodOf(cadence, now)` gives the period a date falls in, and used flags belong to a period, so nothing is hard-coded to a date. A future scheduled benefit change is a data edit with a new `asOf`.

---

## 8. Distance: stores near you, the road, and the fallback estimator

v4 only estimated distance from ZIP density, which under-estimated rural trips badly (Big Timber, MT: 9 mi estimated, ~33 real). **v5 looks the store up** (D-005; [`geo-contract.md`](geo-contract.md), D-030):

1. **Stores near you.** `storesNear(lat, lon, D, opts)` searches the tiles around the user's position, one row per brand (its nearest store), widening 5 → 10 → 25 → 50 mi until at least 15 brands are found. It loads **every** cell the search circle touches, never only the user's own, so a store just across a cell edge is always found (D-021). Tile loading stays outside `geo.js`: it reports which cells it still `need`s, the page loads them and calls again, and a cell that fails makes the result `partial` ("may be incomplete").
2. **The trip.** Picking a brand measures to its nearest store (or the store the user picked): `round1(straight line × 2 × 1.25)`, out and back with a road winding factor. With the optional Worker on, the road distance from OSRM replaces it (`2 × road miles`, no winding factor; D-040). The user can always pin a real distance, remembered per restaurant.
3. **The fallback estimator** (`estimateMiles`, geo contract §5) runs only when no store is known (no tiles locally, or the brand has none nearby):

```
zipsPerStore = zipCount / BRANDS[brand].stores
spacing      = mean distance to the 6 nearest distinct ZIP centroid points   // density proxy
oneWay       = clamp(0.45 × √zipsPerStore × spacing^0.75, 0.4, 30)
roundTrip    = oneWay × 2 × 1.25
```

Distances shown or priced are rounded to 0.1 mi; unrounded values are kept for sorting. An uncached `zipSpacing` takes about 4 ms.

**Calibration** (the Phase 3 and Phase 7 done-whens): the estimator still separates rural from urban (59011 Big Timber 10.4 mi vs 10118 Midtown 0.4 mi, 26×), and the store lookup fixes the rural case: Big Timber → the Livingston, MT Domino's is 30.9 mi straight, 38.6 one way by the 1.25 factor, and 33.9 mi by road from OSRM, against ~33 real.

**The seam:** the Worker sits behind `POD.api` (`/drive`, `/geocode`, `/nearby`; [`api-contract.md`](api-contract.md)). With `POD.config.apiBase = ""` (the committed value) the page makes no Worker request and behaves exactly as with no Worker; a slow, failing or garbage-answering Worker gives the same prices as off (D-004, D-040).

---

## 9. Traps that have already bitten

Read this section before touching the credits, the fallbacks or the data.

### 9.1 Merchant-restricted credits applied universally

**The bug (v4):** the Amex Gold **Resy** credit was modeled as working when ordering direct. The engine spent it at Domino's and reported a $0.00 total. Domino's is not a Resy restaurant.

**The fix:** three tiers, enforced twice (in `syncCredits` and again in the engine, as defence in depth).

| Tier | Flag | Behavior |
|---|---|---|
| Universal | *(none)* | applies wherever `plats` and `modes` match |
| Restricted | `restricted: true` | applies only after the user ticks "Qualifies here" (`creditOptIn[key]`) |
| Locked | `locked: true` | never applies; listed under Locked (rideshare credits are locked: people mistake them for Uber Eats money) |

**The rule:** a credit that works at *some* merchants is not a credit that works at *this* merchant. When unsure, it's `restricted`, and when pickup eligibility isn't stated, it's delivery only. Under-crediting is the safe direction.

### 9.2 Promo minimums test the marked-up subtotal

A $25 minimum is checked against `food` *after* markup, not the menu price. That's how the apps work, and it means a markup makes minimums easier to clear. Deliberate; don't "fix" it. The Minimum insight uses the same test.

### 9.3 Zero fees read as free

`directFee: 0` for a chain without first-party delivery made "Order direct · delivery" look cheapest. If a channel doesn't exist, remove it; never price it at zero. In v5: unprofiled brands and chains without an observed fee have `directDelivery: false`, and an app without its delivery fees keeps only its pickup row.

### 9.4 Tip base

Tip is on the **pre-discount** food. Moving it after discounts silently lowers every delivery total by a dollar or two and shifts rankings.

### 9.5 Positional arrays vs objects

v4 built a dropdown from `CHAINS` as if it were an array of arrays and got `undefined`. In v5 `STATES` rows and the `CAR_DATA`/`CAR_YEARS` strings are positional; `CARDS`, `BRANDS`, `PROFILES` and menu items (`{name, price, dealItem}`, D-036) are objects. Check which you're iterating.

### 9.6 A missing number must never become a default, in data or in code

The never-invent rule applies to code fallbacks too. `restFor` once fell back to `markup {}` (0%) for a missing category default, so the apps looked cheaper; it now returns `null`. Likewise an empty fee box is `null` and the page asks (D-032), `autoMiles` clears the trip rather than keep the previous brand's distance while tiles load (D-031), and a per-item markup override that's malformed falls back to the app's markup, never to 0% (D-036).

### 9.7 "Provides" vs "reimburses" a membership

Amex Platinum reimburses Uber One; it doesn't include it. Marking the card as providing the membership would waive fees the user still pays. `membership` is set only for a card that provides it (D-024).

### 9.8 "Powered by" isn't platform presence

A chain's own delivery fulfilled by DoorDash Drive, or a white-label "powered by" deal, is evidence for the **direct** channel, never for listing the chain on the app's marketplace. Platform evidence is a dated page someone opened and read.

### 9.9 Tiles from another run

A tile's brand indexes point into one run's `BRAND_IDS`. A tile from another run is never read (geo contract §8), and the Pages build regenerates `brands.js` and the tiles together, so the indexes always match.

### 9.10 Bot protection

Several chain sites and AAA block automated access. Getting around bot protection (spoofed user agents, stealth plugins, CAPTCHA solving) isn't done: the source is replaced (EIA for AAA, D-022), the user supplies the value, or the chain ships unprofiled (D-027, D-028).

### 9.11 Encoding and rounding traps between JS and Python

The references caught these: `encodeURIComponent` throws on a lone surrogate (an OpenStreetMap name can hold one), `toFixed` rounds an exact tie up where Python's `format` rounds to even, and Python's `round` is banker's rounding where `round2` is half away from zero. Each contract names the exact operation, in order.

---

## 10. Deployment

**GitHub Pages** serves `main` at `/Delivery-vs-Takeout/` (D-018). `.github/workflows/pages.yml` runs on every push to `main`, weekly (Mondays 07:17 UTC) and by hand; a `dry_run` input builds and checks without deploying. It runs `tools/build-site.sh`, which regenerates the store data and gas from live sources into the site folder, then **fails closed** on any gate in `tools/check-site.js` (D-039), so Pages keeps serving the last good deploy and GitHub notifies the owner:

1. brands: at least 150; every profiled brand present; the tile index and tile files agree; the counts sum.
2. drift against the committed `brands.js`: total stores ≥ 80%, each profiled brand ≥ 50%.
3. a canary through the real `geo.js`: ZIP 10118 finds ≥ 15 brands within 5 mi, not partial.
4. states: the same 51 codes, gas in [1.50, 8.00], tax unchanged from the committed file, grade spreads in [0, 2.50], `GAS_WEEK` at most 14 days old.
5. the ES5 gate over the site's `src/`.

One-time repo settings (the owner's, ISS-005): the default branch is `main`, and Settings → Pages → Source is "GitHub Actions".

**What the page may do at runtime:**

- **Scripts only from its own folder.** No CDN, no npm at runtime. Tiles are classic scripts injected on demand.
- **Two optional network calls, both from the browser:** the VIN lookup to NHTSA vPIC (a CORS-simple GET, 10 s timeout; vPIC answers `Access-Control-Allow-Origin: *`, D-038), and the Worker, only when `POD.config.apiBase` is set. Links open in a new tab and carry only the restaurant's name or the store's point, never the user's address or order (D-041).
- **`localStorage` may throw** (private windows, blocked site data): the page runs on defaults with nothing saved.
- **Geolocation may be unavailable or denied:** "Use my location" falls back to a typed ZIP or address with a message, not an error.
- **0 console errors** in every flow, except the browser's own resource error for a tile, VIN or Worker request that fails, each allowed only in the e2e that causes it.
- **Page budget:** `src/data/zips.js` is about 1.4 MB; the other data files are under 60 KB each; tiles load a few at a time.

**The Worker** (`worker/`, optional, ISS-004): a Cloudflare Worker with no dependencies and no secrets in the repo. Deploy steps are in `worker/README.md`; then set `apiBase` in `src/js/config.js`.

---

## 11. Roadmap

### Phase A: replace the estimators with real calls — **done** (D-004, D-005, D-037 to D-040)

Static first, then an optional backend:

- **Stores near you** from All The Places tiles, rebuilt weekly with gates (D-005, D-021, D-039). v4's `GET /nearest?lat&lon&brand` became `GET /drive?from&to`: the page already knows the nearest store from the tiles, so the Worker is asked only for the road distance to it (OSRM). A Places search by brand would have found a different store than the list shows.
- **`GET /geocode?q`** (Nominatim) refines a typed street address; a bare ZIP stays on the ZIP table, which stays the authority for state and tax.
- **`GET /nearby?lat&lon&radius`** (Overpass) adds independent restaurants, priced as unprofiled brands.
- **Gas:** EIA weekly in the Pages build, not a `/fuel` endpoint (D-022, D-039).
- **VIN:** from the browser to NHTSA vPIC, not a `/vehicle` endpoint, with the model year's own EPA figure (D-037, D-038).
- OpenStreetMap was chosen over Google and Mapbox: no key, and answers may be cached (D-040). Each provider sits behind one adapter.

### Phase B: per-item markup — **done** (D-036)

Menu items are objects `{name, price, dealItem, markup?}`; `markup` is per app, in percent (15 = 15%; v4's `0.30` fractions aren't used). App food is a sum over cart lines, rounded once. A `bogo` app promo prices "buy one, get one free" at the item's own marked-up price. No profile has a sourced per-item markup yet (ISS-036).

### Phase C: real menu and price data — open

The hard problem, in increasing order of defensibility: scraping the apps (fragile, against their terms; not done), crowdsourced receipts (users forward order confirmations; teaches real per-market markup), official rails (DoorDash and Uber Eats partner APIs, Olo for direct ordering). Nearest steps: per-item app prices typed by the user (ISS-036), direct service fees per chain (ISS-031), and confirmed direct-only deals (ISS-035).

### Phase D: the wallet becomes the moat — open

Credit tracking is the retention hook. Used flags already reset by period; next would be detecting spend from issuer feeds and a reminder before credits expire.

### Phase E: deep links — **done** (D-016, D-041)

v4 asked for a hand-off "with the cart pre-built where the platform allows it". **No platform publicly allows it** (D-016), so every result row is a button that opens the app, the restaurant's own site or a map, and the fine print says the order doesn't carry over:

- **DoorDash** rows search DoorDash for the restaurant by name (the format was seen working).
- **Uber Eats and Grubhub** rows open the app's home page: their sample searches didn't search, so their search format is `null` until someone confirms one (a data change only).
- **Ordering direct** opens a profiled chain's own home page (not a deep path: those break). Unprofiled chains and independents have no checked site yet (ISS-042).
- **Pickup from the restaurant** also gets Google Maps directions to the store the trip was measured to, or a map search by name.

### Open product questions

- **Cart quantization.** The cheapest channel changes with cart size; Unlock and Minimum suggest the cheapest item to add, not yet the best one.
- **Coverage.** Direct-only deals are where savings live, which argues for depth on chains with strong first-party deals. On the shipped data none is confirmed (ISS-035).
- **Time valuation.** Defaults to $0/hr by explicit choice.
- **Open issues** carried past v5 are in [`issues.md`](issues.md): the Worker's deploy (ISS-004), Overpass fixtures recorded live (ISS-040), app fees and evidence dates (ISS-030, ISS-034), and the data gaps above.

---

## 12. Extending it

Every change follows the v5 pattern: **the contract (by a decision) and its reference and fixtures change first, the code after**, and no number goes in without a source.

- **Profile a chain:** add `tools/data/profiles/<brandId>.json` (menu prices from the chain's own site at 2–3 stores in different states, deal, fees, dated platform evidence; data-research skill), run `tools/build-profiles.py`, and add its `LINKS.order` entry (a data test pins `LINKS.order`'s keys to `PROFILES`'). Set `amexGoldDirect` only for an actual Amex Gold dining partner.
- **Add a card or credit:** the orchestrator edits `src/data/cards.js` from the issuer's own page, classifying every credit against §9.1 (when in doubt, `restricted`) and setting `membership` only for a card that provides one (§9.7).
- **Add a vehicle:** rebuild `src/data/cars.js` with `tools/build-cars.py`; don't hand-edit the packed strings.
- **Add a platform:** add it to `S.plats` and `S.promos` (state contract), two entries to `CHANNELS` and its names (engine contract), a markup key to every category default and profile, its `LINKS.apps` entry, and the UI's labels. The engine is platform-agnostic; the data and contracts are not.
- **Add an insight:** amend the insights contract by a decision, add the case to the Python reference and hand-worked fixtures, then the code. Use `override` for counterfactuals.
- **Add a link format:** a data change in `src/data/links.js`, recorded with how and when it was seen working.

---

## 13. Testing

`npm test` runs four stages and must exit 0 (`npm ci` first in a fresh clone):

```
npm run test:es5      # acorn ES5 syntax gate over every file in src/ (with a negative fixture)
npm run test:unit     # node:test over tests/unit/: the real src/ scripts in a vm, in index.html's order
npm run test:oracle   # python3 tests/oracle/run.py: independent Python references vs the JS
npm run test:e2e      # Playwright over file:// at 390×844 and 1280×800; any console error fails
```

- **Oracle (differential tests):** each pure module has a standard-library Python reference written from its contract (`tests/oracle/engine.py`, `geo.py`, `insights.py`, `vin.py`, `links.py`, and `tests/fixtures/api/build.py` for the seam) and hand-worked fixtures. `run.py` checks the references against the fixtures first, then the JS against the references on the fixtures and on thousands of seeded random scenarios. Expected values never come from the code under test.
- **Receipts:** `tests/fixtures/receipts/` holds receipts worked by hand, with the arithmetic shown, from the real data.
- **Unit:** schema and provenance tests for every data file (pinned to the sources item by item), generator rules, the §9 traps by name, purity, never-throw guards, the gates in `tools/check-site.js`, the Pages workflow, and the Worker (no live calls, ever).
- **e2e:** the v4 manual checklist automated (switch restaurant, an EV, three cards, a ZIP in another state, pin a distance, reload), the first-visit example, geolocation, a failing tile, escaping, the VIN lookup (recorded vPIC answers), BOGO, every row's hand-off, and the Worker on, off and failing (the page with the Worker off is byte-for-byte the Phase 7 page, after removing exactly the Phase 9 hand-offs and the fine-print links line).
- **CI** (`.github/workflows/test.yml`) runs `npm test` on every push and pull request and keeps the e2e screenshots as an artifact.

The v4 "scenarios worth pinning" are each pinned (`checklist.e2e.js` names them "§13 scenario n"):

1. **Domino's in Brooklyn ranks every route**: `checklist.e2e.js` (v4's $15.62 / $52.13 aren't reproduced, D-001; the receipts hold v5's hand-worked totals).
2. **Amex Gold's Resy credit never drops a total by $50** until opted in (§9.1): `checklist.e2e.js` and receipt `r05-credit-tiers-and-clamp`.
3. **The Amex Gold partner path**: the credit applies ordering direct at a partner, receipt `r06-gold-partner-direct` at Buffalo Wild Wings (The Cheesecake Factory carries the same flag but no receipt prices it; Five Guys is unprofiled, D-028).
4. **An EV's pickup** prices kWh and the receipt line says "Charging": receipt `r07-ev-and-time`.
5. **Rural 59011 vs urban 10118** differ by ≥10×: `geo.test.js` for the estimator, `checklist.e2e.js` for the page.
6. **A promo with an unmet minimum** shows the Minimum insight with its delta: `checklist.e2e.js` and the insights fixtures.
7. **A `localStorage` that throws**: defaults render, no console error: `checklist.e2e.js` and `state.test.js`.

---

## Appendix: quick reference

```js
// Pricing (pure; F = POD.state.forEngine(S))
POD.engine.calc(F, "dd-d", override?)     // one route, or null if unavailable
POD.engine.allResults(F, override?)       // every available route, sorted by net
POD.engine.cartInfo(F, override?)         // { menuSub, dealSub, qty, eligQty, dealReady, shortBy }
POD.engine.perMile(F)                     // $/mile for the current vehicle
POD.engine.restFor(brandId, POD.data)     // S.rest for a brand, or null

// Geography (pure; D = POD.data)
POD.geo.zipByCode("11201", D)             // → {z, la, lo, c, st} | null
POD.geo.nearestZip(lat, lon, D)
POD.geo.zipSpacing(rec, D)                // mean miles to the 6 nearest distinct centroid points
POD.geo.estimateMiles(rec, brandId, D)    // → {one, round, spacing, zipsPerStore} | null
POD.geo.storesNear(lat, lon, D, opts)     // nearby brands, one store each, or the cells it still needs
POD.geo.nearestStore(lat, lon, brandId, D, opts)

// State (mutates only S)
POD.state.derive(S, D, new Date(), opts)  // every derived field, in cascade order
POD.state.setPath(S, "plats.dd.markup", 20)
POD.state.getPath(S, "tipDel")
POD.state.load(storage, D, now, opts) / POD.state.save(S, storage)

// Advice and hand-offs
POD.insights.build(F, R, now)             // the nine cards, plain text
POD.links.forChannel("dd-d", S, D)        // [{kind, label, href}]
POD.vin.check(POD.vin.clean(text))        // "ok" | "length" | "chars" | "digit"

// Page
POD.boot()                                // load, derive, load tiles, render
POD.ui.render({S, D, opts, view, now})    // writes only the blocks that changed
```

**localStorage key:** `pod.v5` (`POD.STORAGE_KEY`); bump it on an incompatible state change (D-010).
