# Pickup or Delivery — Build Guide

> **v5 rebuild note (2026-11-11).** This is the v4 spec, kept unchanged as the reference. v5 is a rebuild from this document, and where the two differ, [`decisions.md`](decisions.md) wins. The main changes: restaurants are discovered from the user's location (D-005/D-006), all code lives under the `POD` namespace (D-008), the storage key is `pod.v5`, Phase A is static-first (D-004), and deep links don't pre-fill carts (D-016). This file is brought up to date in Phase 10.

A decision engine that answers one question: **is it cheaper to have food delivered, to order pickup through a delivery app, or to order direct from the restaurant** — once gas, fees, menu markup, promos, card credits, and direct-only deals are all priced in.

This document is the working spec for continuing development. It covers what exists, how the engine works, where the data comes from, what's deliberately unfinished, and the traps that have already cost a rewrite.

**Status:** working single-page prototype, v4. No build step, no dependencies, no backend.
**Last verified:** 11 Nov 2026. Several embedded datasets are time-sensitive — see [Data provenance & staleness](#7-data-provenance--staleness).

---

## 1. Why this exists

Ordering food has four or five plausible routes and no way to compare them without building the same cart in four apps. The spread is large and non-obvious: in the default scenario (two medium pizzas from Domino's in Brooklyn) the cheapest route is **$15.62** and the most expensive is **$52.13** — a **$36.50 spread on identical food**.

The headline finding that shapes the product: **fuel almost never decides the answer.** Menu markup, fees, and card credits do. A typical 3-mile round trip costs about $0.40 in gas. A single app's markup and fees on a $28 order costs $12–20. Any version of this product that leads with gas prices is solving the wrong problem.

Three things the engine gets right that a naive calculator doesn't:

1. **Direct-only deals** are usually the biggest single lever (Domino's Mix & Match reprices $29.98 of food to $13.98).
2. **App pickup is a distinct route from direct pickup** — ordering pickup inside Grubhub keeps you in Grubhub's payment rail, so a platform card credit still fires.
3. **Most published "food credits" can't be spent on takeout.** See [§9](#9-traps-that-have-already-bitten).

---

## 2. Files & running it

```
index.html        # the entire app: markup, styles, engine, render layer
data.js           # reference data (states, cars, cards, chains)
data-zips.js      # generated: 42,354 US ZIP centroids (~1.35 MB)
```

Open `index.html` directly — `file://` works. No server, no build, no npm.

Load order matters: `data.js` and `data-zips.js` are plain `<script>` tags that must execute before the inline module.

### Regenerating `data-zips.js`

This file is generated, not hand-written, and is large enough that it may not travel with the other two. Rebuild it with:

```python
import csv, json, urllib.request

URL = "https://raw.githubusercontent.com/midwire/free_zipcode_data/master/all_us_zipcodes.csv"
urllib.request.urlretrieve(URL, "zips.csv")

rows, cities, clist = [], {}, []
with open("zips.csv") as f:
    for r in csv.DictReader(f):
        try:
            la, lo = float(r["lat"]), float(r["lon"])
        except ValueError:
            continue
        if not (-180 < lo < 180 and -90 < la < 90) or (la == 0 and lo == 0):
            continue
        c, st = r["city"].strip().title(), r["state"].strip()
        if not st or len(st) != 2:
            continue
        if c not in cities:
            cities[c] = len(clist); clist.append(c)
        rows.append("%s,%d,%d,%d,%s" % (
            r["code"].strip(), round(la*1000), round(lo*1000), cities[c], st))

with open("data-zips.js", "w") as f:
    f.write("var ZIP_CITIES=%s;\nvar ZIP_PACKED=%s;\n" % (
        json.dumps(clist, separators=(",", ":")),
        json.dumps(";".join(rows))))

print(len(rows), "zips,", len(clist), "cities")
```

Expected output: `42354 zips, 18908 cities`. If the row count drifts materially, update `ZIP_TOTAL` in `index.html` — the nearest-store estimator divides by it.

**Packed format:** records joined by `;`, fields by `,` — `zip,lat*1000,lon*1000,cityIndex,ST`. Coordinates are integers (3 d.p. ≈ 110 m) to keep the file under ~1.4 MB. `zips()` unpacks lazily on first use and memoizes into `ZIPS` (array) and `ZBY` (code-keyed map).

---

## 3. Architecture

Deliberately boring: one global state object, pure calculation functions, and render functions that rebuild DOM subtrees from scratch.

```
            data.js + data-zips.js   (static reference data)
                      │
                      ▼
        ┌──── S (single state object) ────┐
        │                                 │
   apply*() derive                   calc(channel)
   dependent fields                  pure, no DOM
   (applyCar, applyState,                 │
    applyAddress, applyChain,             ▼
    autoMiles, syncCredits)          allResults()
        │                            sorted by net
        └──────────► render() ◄───────────┘
                         │
          renderVerdict / renderLadder / renderInsights
          renderLoc / renderNear / renderCar / renderFine
```

**Conventions worth keeping:**

- **ES5 only, no framework.** `var`, `function`, no arrow functions, no template literals. The file is CSP-constrained (see §10) and this keeps it portable.
- **Event delegation.** Three document-level listeners (`input`, `change`, `click`) dispatch on `data-*` attributes. Adding a control means adding markup, not a listener.
- **Two-way binding via `data-bind="path.to.field"`.** `setPath`/`getPath` walk dotted paths into `S`. Add `data-type="text"` for strings; everything else is parsed as a number.
- **Render functions are idempotent and full-replace.** They never diff. `syncStatic()` pushes `S` back into inputs, skipping `document.activeElement` so typing isn't clobbered.
- **Persistence is `localStorage` under one key** (`pod.v4`). Bump the key when the state shape changes incompatibly — `load()` merges over `fresh()` so additive changes are safe without a bump.

---

## 4. The pricing engine

`calc(channel, override)` is the whole product. Everything else is input collection and presentation.

### 4.1 Channels

Eight routes — four platforms × two modes:

```js
direct-d  direct-p    // the restaurant's own site/app
dd-d      dd-p        // DoorDash
ue-d      ue-p        // Uber Eats
gh-d      gh-p        // Grubhub
```

`allResults()` maps `calc` over all eight and sorts ascending by `net`. Rank 1 is the answer.

### 4.2 Order of operations

**This sequence is load-bearing. Changing the order changes the answer, and each step is ordered to match how the real receipts work.**

| # | Step | Detail |
|---|------|--------|
| 1 | **Direct-only deal reprices the cart** | Only when `plat === "direct"` and the cart satisfies `deal.minItems` of flagged items. Produces `dealSub`. |
| 2 | **Platform markup** | `food = menu × (1 + markup/100)`. Direct is 0%; apps run 15–25%. |
| 3 | **Fees** | Delivery fee, service fee (% with a `svcMin` floor), small-order fee (`food < 12`), city regulatory fee. Membership (DashPass/Uber One/Grubhub+) zeroes the delivery fee above $12 and swaps `svc` → `memberSvc`. |
| 4 | **Subtotal discounts** | Platform promo (`percent` with cap / `dollar` / `freedel`) plus any platform pickup discount. Jointly clamped so they can't exceed `food`. |
| 5 | **Tax** | On the **discounted** subtotal: `(food − disc) × tax%`. |
| 6 | **Tip** | On the **pre-discount** subtotal, which is how the apps actually compute it. Separate rates for delivery and pickup. |
| 7 | **Drive** | Pickup only. `miles × (fuel/mpg + wear)`, or `miles ÷ miPerKwh × kwh` for EVs. Plus `hourly × minutes/60` if time is priced (default $0). |
| 8 | **Card credits** | Flat, off the very end — the way a statement credit lands on the charge. Clamped to `gross − disc` so a total never goes negative. |

```
gross = food + fees + tax + tip + drive + time
net   = max(gross − disc − credit, 0)
```

### 4.3 Return shape

```js
{
  id, plat, mode, name,
  parts: { food, fees, tax, tip, drive },  // bar segments; drive includes time
  gross,                                   // before discounts
  net,                                     // after discounts + credits — the ranked value
  disc, credit, off,                       // off = disc + credit
  lines: [[label, amount], ...],           // itemized receipt, ends with ["TOTAL", net]
  notes: [],                               // e.g. the deal label
  member                                   // membership name if it applied
}
```

Negative `lines` amounts render green; `0` renders as "waived".

### 4.4 The `override` parameter

`calc(ch, {cart, miles})` lets the insight layer run counterfactuals without mutating state — "what if you added one more item", "what if you cleared the $25 minimum". `renderInsights` uses this for the **Unlock** and **Minimum** cards. Keep it pure; several insights depend on it.

### 4.5 Insights

`renderInsights` is where the product stops being a calculator and starts giving advice. Current cards:

- **Unlock** — you're N items from a direct deal; here's the resulting total.
- **Distance** — break-even miles: solve `(bestDelivery − pickupFixed) / costPerMile`.
- **Fuel** — break-even $/gal before delivery wins. Usually reports "even at $12/gal pickup still wins."
- **Minimum** — you're $X short of a promo threshold; here's the net effect of adding it.
- **Wallet** — fires when the restaurant is an Amex Gold dining partner, so the credit works direct.
- **Timing** — unspent credits and days until reset.
- **Locked** — credits on your cards that can't touch a takeout order.
- **Nuance** — app pickup beating the counter.
- **Spread** — the gap between best and worst.

New insights go here. The bar: it must say something the ranked list doesn't already show.

---

## 5. State shape (`fresh()`)

```js
{
  // car — set by applyCar() from MAKES[make]
  make, model, mpg, fuel,       // fuel: "regular" | "premium" | "diesel" | "ev"
  miPerKwh, kwh,                // EV path; mpg is 0 when fuel === "ev"

  // location — set by applyAddress()
  address,                      // free text; the ZIP is regex-extracted from it
  zip, zipRec,                  // zipRec: {z, la, lo, c, st} or null
  state, gas, tax,              // derived from STATES + GRADE_ADD

  // order
  chain, cart,                  // cart: { menuIndex: qty }
  manualSubtotal,               // used when the chain has no menu ("custom")
  dealOn,

  // trip
  miles, minutes, speed,        // miles ↔ minutes convert at speed
  milesAuto,                    // true = estimated; false = user-pinned
  milesBy,                      // { chainId: miles } — remembered per restaurant

  // money
  tipDel, tipPick, wear, hourly, regFee,
  smallMin, smallFee,

  // wallet
  cards,                        // [cardId]
  credits,                      // rebuilt by syncCredits(); never edit directly
  creditOptIn,                  // { creditKey: true } for restricted credits

  plats: { direct, dd, ue, gh },
  promos: { dd, ue, gh }
}
```

### Derivation chain

Call these in order; several cascade.

| Function | Sets | Triggered by |
|---|---|---|
| `applyCar()` | `fuel`, `mpg`/`miPerKwh`, then `applyState()` | make/model change |
| `applyState()` | `tax`, `gas` (state base + grade adder) | state or fuel change |
| `applyAddress()` | `zip`, `zipRec`, `state`, then `applyState()` + `autoMiles()` | address input |
| `autoMiles()` | `miles`, `minutes` — **no-ops unless `milesAuto`** | address/chain change |
| `applyChain()` | platform markups, direct fee, resets cart, restores pinned miles, `syncCredits()` | restaurant change |
| `syncCredits()` | rebuilds `S.credits` from `S.cards` | card toggle, chain change |

**`syncCredits` is destructive by design.** It rebuilds the auto credits from scratch while preserving (a) `used` flags via `usedMap`, (b) manual credits via the `manual` flag. Any new per-credit user state must be preserved explicitly or it's lost on the next card toggle.

---

## 6. Data tables (`data.js`)

### `STATES`
`[code, name, gasRegular, mealTaxPct, lat, lon]`

Gas is the AAA state average for regular; other grades add `GRADE_ADD` (`midgrade +0.45`, `premium +0.85`, `diesel +0.60`). Tax is a *meal* tax where the state has one (NH 8.5, VT 9, VA 10.5, DC 10) and the typical combined sales rate otherwise.

> **Dead code:** `lat`/`lon` (indices 4–5) were used by a nearest-state-centroid lookup that v4 replaced with real ZIP centroids. Safe to drop.

### `ZIP3`
> **Dead code.** The USPS prefix→state range table, superseded by `data-zips.js`. Zero references in `index.html`. Safe to delete.

### `CAR_DATA`
Packed strings, one per make: `"Make|Model:value,Model:value*"`.

| Suffix | Meaning | Value |
|---|---|---|
| *(none)* | regular gas | EPA combined MPG |
| `*` | premium required | EPA combined MPG |
| `d` | diesel | EPA combined MPG |
| `e` | electric | mi/kWh × 10 (`41e` = 4.1) |

Parsed at boot into `MAKES` (make → sorted models) and `MAKE_NAMES` (alphabetical, `"Other"` forced last). ~39 makes, ~330 models. Model names must not contain commas or colons.

### `CARDS`
```js
{
  id, issuer, name,
  membership: "dd",          // optional: auto-enables that platform's membership
  credits: [{
    name, amount,
    cadence: "monthly" | "quarterly" | "semiannual" | "annual",
    plats: ["gh"],           // channels it can be spent on
    goldPartner: true,       // adds "direct" at amexGoldDirect chains
    restricted: true,        // merchant-limited — opt-in only (see §9)
    locked: true,            // can never apply to takeout
    dated: true,             // amount varies by date (CSR, see below)
    note: "shown in the UI"
  }]
}
```

27 cards: all Amex consumer + co-brand, all Chase cards with a DoorDash benefit, Capital One premium.

**`plats: []` means the credit is listed but never applied.** This is the correct state for `locked` credits and for `restricted` credits the user hasn't opted into.

### `CHAINS`
```js
{
  id, name, stores,                      // stores: US location count
  directFee,                             // first-party delivery fee
  markup: { dd, ue, gh },                // typical % menu markup
  amexGoldDirect: true,                  // Amex Gold dining partner
  deal: { label, price, minItems, scope },  // scope: "both"|"pickup"|"delivery"
  menu: [[name, price, isDealItem], ...]
}
```

12 chains plus a `custom` fallback with no menu (falls back to `manualSubtotal`).

---

## 7. Data provenance & staleness

Every embedded dataset is a snapshot. Flag these as the first thing to refresh.

| Data | Source | As of | Staleness risk |
|---|---|---|---|
| State gas averages | AAA via energyfactbook.com | 22 Sep 2026 | **High** — weekly drift |
| ZIP centroids | `midwire/free_zipcode_data` | stable | Low |
| Store counts | ScrapeHero 2026 location reports | 2026 | Low |
| Card credits | Issuer terms, published Sept 2026 | Sept 2026 | **High** — terms change often |
| Menu prices | National ballparks | Sept 2026 | **High** — franchise-variable |
| Platform fees/markups | Industry reporting | Sept 2026 | Medium |
| Meal tax rates | State published rates | 2026 | Low |
| MPG | EPA combined, recent model year | — | Low |

**Known date-dependent logic:** the Chase Sapphire Reserve credit (`dated: true`) is $5 restaurants-only before 1 Oct 2026 and $15 on any eligible order after. `syncCredits` branches on `new Date() >= new Date(2026, 9, 1)`. That date has now passed, so the branch is effectively dead — keep it or clean it, but don't delete the pattern; it's the template for future scheduled benefit changes.

---

## 8. The nearest-restaurant estimator

**The honest framing: this estimates, it does not look up.** No store database is embedded, and a static page can't query one.

```js
zipsPerStore = ZIP_TOTAL / chain.stores
spacing      = mean distance to the 6 nearest ZIP centroids   // density proxy
oneWay       = clamp(0.45 × √zipsPerStore × spacing^0.75, 0.4, 30)
roundTrip    = oneWay × 2 × 1.25                              // 1.25 = road winding factor
```

`spacing` works as a density measure because ZIP codes are allocated by mail volume, which tracks population. Midtown Manhattan ZIPs sit 0.2 mi apart; Big Timber, Montana's sit 17 mi apart.

**Calibration observed:**

| Location | Chain | Estimate | Reality |
|---|---|---|---|
| Midtown Manhattan | Domino's | 0.4 mi | good |
| Brooklyn 11201 | Domino's | 1.3 mi | good |
| Midtown Manhattan | Cheesecake Factory | 2.2 mi | conservative (~0.5 mi) |
| Big Timber, MT | Domino's | 9.2 mi | **optimistic** — nearest is ~33 mi |

**Known weakness:** rural. People cluster in towns in a way ZIP geography doesn't capture, so sparse areas are under-estimated. The UI labels it an estimate, shows its reasoning, and lets the user pin a real distance (which persists per restaurant in `milesBy`).

`zipSpacing` scans all 42k records with a ±1.2° latitude pre-filter and memoizes into `SPACING_CACHE`. ~5 ms per uncached ZIP.

**This whole function is the designated seam for a real API.** Replace `estimateMiles()` with a call to `/nearest` (§11) and nothing else changes.

---

## 9. Traps that have already bitten

Read this section before touching the credits logic.

### 9.1 Merchant-restricted credits applied universally

**The bug:** the Amex Gold **Resy** credit ($50, semiannual) was modeled as `plats: ["direct"]`, meaning "works when ordering direct." The engine spent it at Domino's and reported a **$0.00 total**. Domino's is not a Resy restaurant.

**The fix:** three tiers of credit eligibility.

| Tier | Flag | Behavior |
|---|---|---|
| Universal | *(none)* | Applies wherever `plats` matches |
| Restricted | `restricted: true` | `plats` forced to `[]` unless `creditOptIn[key]`; UI offers "Qualifies here" |
| Locked | `locked: true` | Never applies; listed under "not usable here" |

**The rule:** a credit that works at *some* merchants is not a credit that works at *this* merchant. Default to not applying it. A calculator that silently over-credits produces exactly the wrong answer it exists to prevent.

### 9.2 Promo minimums test the marked-up subtotal

A $25 minimum is checked against `food` *after* platform markup, not the menu price. This is correct — it's how the apps work — and it means a 15% markup makes minimums *easier* to clear. Counter-intuitive, deliberate, don't "fix" it.

### 9.3 Zero fees read as free

Setting `directFee: 0` for chains without first-party delivery made "Order direct · delivery" look artificially cheapest. Every chain now carries a realistic fee. If a channel genuinely doesn't exist for a restaurant, remove the channel — don't price it at zero.

### 9.4 Tip base

Tip is computed on the **pre-discount** subtotal. Moving it post-discount silently reduces every delivery total by a dollar or two and shifts rankings.

### 9.5 `CHAINS` is an array of objects

An early `<option>` builder used `x[0]`/`x[1]` as if it were an array-of-arrays, producing a dropdown of `undefined`. `STATES` and `CAR_DATA` *are* positional arrays; `CHAINS` and `CARDS` are objects. Check which you're iterating.

---

## 10. Deployment constraints

The prototype runs as a sandboxed static page, which imposes real limits. If you move to a server these mostly evaporate — but the code currently assumes them.

- **No outbound network calls.** CSP blocks `fetch`/XHR to every host. This is why all data is embedded and why there's no geocoding.
- **Scripts only from an allowlist** (cdnjs, jsdelivr). No npm at runtime.
- **`localStorage` may throw** — private windows, blocked site data. Every access is wrapped in try/catch and the page renders correctly with storage unavailable.
- **Geolocation may be unavailable** in a sandboxed iframe. `locBtn` has a failure path that falls back to typed-address entry. Keep it.
- **16 MB page budget.** `data-zips.js` is 1.35 MB of it.

---

## 11. Roadmap

### Phase A — replace the estimators with real calls

The highest-value work, and the architecture is already shaped for it.

```
GET /nearest?lat&lon&brand
→ { storeId, address, lat, lon, drivingMiles, drivingMinutes }
```
Backed by Google Places (nearby search by brand) + Distance Matrix, or Mapbox. Drop-in replacement for `estimateMiles()`. Cache by (ZIP, brand) — store locations don't move.

```
GET /geocode?q=<free text address>
→ { lat, lon, city, state, zip }
```
Gives true street-level precision instead of ZIP centroids. Feeds `/nearest`.

```
GET /fuel?zip&grade
→ { price, asOf }
```
GasBuddy or EIA. Replaces the static `STATES` gas column. Low value — fuel barely moves the answer — but cheap.

```
GET /vehicle?vin=<17 char>
→ { year, make, model, mpgCombined, fuelGrade }
```
NHTSA vPIC is free and unauthenticated. Turns the two dropdowns into one VIN scan.

### Phase B — per-item markup

**The most valuable modeling change.** Apps mark up a $3 drink and a $17 entrée at different rates, and a single per-restaurant percentage can't express that. Required before BOGOs model correctly.

Change `menu` entries from `[name, price, isDealItem]` to objects with optional per-platform overrides:

```js
{ name, price, dealItem, markup: { dd: 0.30, ue: 0.30, gh: 0.25 } }
```

Fall back to the chain-level percentage when absent. `calc` step 2 becomes a sum over cart lines rather than one multiplication.

### Phase C — real menu & price data

The hard problem, in increasing order of defensibility:

1. **Scraping the apps** — fast, fragile, against ToS. Fine personally, not as a business.
2. **Crowdsourced receipts** — users forward order confirmations to a parsing inbox. Teaches you real per-restaurant markup by market. Slow to start, compounds.
3. **Official rails** — Uber Eats and DoorDash partner APIs, Olo for direct ordering. Built for merchants, so the path is a merchant-side or aggregator pitch rather than a consumer app.

### Phase D — the wallet becomes the moat

Credit tracking is the retention hook, not the calculator. Auto-detect burn via Plaid or issuer feeds ("your $10 Grubhub credit posted on the 8th"). Push a reminder on the 25th: *"$25 of credits expire in 6 days."* The manual toggle already captures most of the value — this just removes the last bit of work.

### Phase E — deep links

The output should be a button, not a number. Hand off to the winning app with the cart pre-built where the platform allows it.

### Open product questions

- **Cart quantization.** The cheapest channel changes with cart size. The Unlock insight hints at this; a real version would suggest *what* to add, not just how much.
- **Coverage strategy.** Direct-only deals are where the savings live, which argues for depth on chains with strong first-party deals (pizza, fast food) over thin coverage of everything.
- **Time valuation.** Defaults to $0/hr by explicit choice. Worth testing whether users want it on.

---

## 12. Extending it

**Add a restaurant:** append to `CHAINS` with `stores` (drives the distance estimate), `markup` per platform, `directFee`, and a `menu`. Set `amexGoldDirect: true` only for the five actual Amex Gold partners (Grubhub, Five Guys, Buffalo Wild Wings, The Cheesecake Factory, Wonder).

**Add a card:** append to `CARDS`. Classify every credit against §9.1 before setting `plats` — when in doubt, `restricted: true`. If the card includes a delivery membership, set `membership: "dd" | "ue" | "gh"`.

**Add a vehicle:** append to the make's `CAR_DATA` string. Respect the suffix convention. No commas or colons in model names.

**Add a platform (e.g. Postmates, Seamless):** add to `S.plats`, add two entries to `CHANNELS`, add a `markup` key to every chain, add a `promos` entry, and extend the `PL` label map. The engine is platform-agnostic; the data tables are not.

**Add an insight:** append to `out` in `renderInsights` as `[label, html, className]` where className is `""`, `"good"`, or `"hot"`. Use the `override` parameter for counterfactuals.

---

## 13. Testing

There is no test suite. There should be. The engine is pure and trivially testable — extract `calc`, `cartInfo`, and `estimateMiles` into a module and assert against known receipts.

**Scenarios worth pinning first**, each of which has already caught a real bug:

1. **Domino's, 2 pizzas, Brooklyn, Amex Gold** → direct pickup $15.62, DoorDash delivery $52.13. Catches deal application and ranking.
2. **Any chain + Amex Gold with the Resy credit** → total must not drop by $50. Catches §9.1.
3. **Five Guys + Amex Gold** → credit applies to `direct`, not just `gh`. Catches the partner path.
4. **EV + any pickup route** → drive cost uses kWh, receipt line says "Charging". Catches the fuel branch.
5. **Rural ZIP (59011) vs urban (10118)** → estimates differ by an order of magnitude. Catches the estimator.
6. **Promo with an unmet minimum** → Minimum insight appears with a correct delta. Catches the override path.
7. **`localStorage` disabled** → page renders with defaults, no console error.

Manual regression checklist until then: load the page, switch restaurant, switch to an EV, toggle three cards, type a ZIP in another state, pin a distance, reload and confirm it persisted.

---

## Appendix: quick reference

```js
// Recompute everything
render()                    // results + derived displays, saves to localStorage
renderAll()                 // + rebuilds cart, wallet, inputs

// Pure calculation
calc(channel, override?)    // one route
allResults(override?)       // all eight, sorted by net ascending
cartInfo()                  // { menuSub, dealSub, qty, eligQty, dealReady, shortBy }
perMile()                   // $/mile for the current vehicle

// Geography
zipByCode("11201")          // → {z, la, lo, c, st} | null
nearestZip(lat, lon)        // → nearest centroid record
zipSpacing(rec)             // → mean miles to 6 nearest ZIPs (memoized)
estimateMiles()             // → {one, round, spacing} | null

// State
setPath("plats.dd.markup", 20)
getPath("tipDel")
```

**localStorage key:** `pod.v4` — bump on incompatible state changes.
