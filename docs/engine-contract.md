# Engine contract (v5, Phase 2)

The exact definition of `POD.engine` that `src/js/engine.js` and the Python oracle (`tests/oracle/engine.py`) both implement. It fills in what BUILD.md §4 leaves open. **Where this file and BUILD.md §4 differ, this file wins** (D-029). Change it only by a decision. The oracle and the receipts change first, the engine after.

Everything here is pure. The engine reads only its arguments: no `POD.S`, no `POD.data`, no DOM, no `Date`.

## 1. API

| Function | Returns |
|---|---|
| `calc(S, channelId, override)` | one result (§6), or `null` if the channel isn't available (§3) |
| `allResults(S, override)` | the results for every available channel, sorted by `net` ascending; ties keep `CHANNELS` order |
| `cartInfo(S, override)` | `{menuSub, dealSub, qty, eligQty, dealReady, shortBy}` (§4) |
| `perMile(S)` | the running cost per mile, unrounded (§5.7) |
| `restFor(brandId, D)` | the restaurant object `S.rest` for a brand, built from data tables `D` (`PROFILES`, `CATEGORY_DEFAULTS`, `BRANDS`); `null` for an unknown brand (§2.1) |
| `CHANNELS` | `["direct-d","direct-p","dd-d","dd-p","ue-d","ue-p","gh-d","gh-p"]` |

`override` is optional, may be `undefined`, and may set any of `cart`, `manualSubtotal`, `miles`, `minutes`. Each one present replaces the matching `S` field for that call only, and everywhere below, `cart`, `manualSubtotal`, `miles` and `minutes` mean these overridden values. `calc` never mutates `S` or `override`.

## 2. Inputs

```
S = {
  rest,                         // §2.1
  cart: { "0": 2, "3": 1 },     // menu index (string key) → integer qty ≥ 0; unknown indexes are ignored
  manualSubtotal,               // $; the cart for an unprofiled restaurant
  dealOn,                       // bool; the user's switch for the direct-only deal
  tax,                          // percent, e.g. 8.875
  fuel,                         // "regular" | "premium" | "diesel" | "ev"
  gas,                          // $/gal for this car's grade (already grade-adjusted)
  mpg, miPerKwh, kwh,           // kwh = $/kWh
  miles, minutes,               // the pickup trip (round trip)
  wear, hourly,                 // $/mile; $/hour (default 0)
  tipDel, tipPick,              // percent
  regFee, smallMin, smallFee,   // $; app delivery only
  plats: {
    direct: { on },
    dd: { on, markup, delFee, svc, svcMin, member, memberSvc, memberMin, pickDisc },
    ue: { … same keys … },
    gh: { … same keys … }
  },
  promos: { dd: { type, value, cap, min }, ue: {…}, gh: {…} },  // type: "none"|"percent"|"dollar"|"freedel"
  credits: [ { key, name, amount, plats, modes, restricted, locked, goldPartner, used } ],
  creditOptIn: { "<key>": true }
}
```

Percent fields (`tax`, `markup`, `svc`, `memberSvc`, `pickDisc`, `tipDel`, `tipPick`, promo `value` for `percent`) are percents: 15 means 15%. **Every numeric field above is required**, because the state layer's `fresh()` supplies defaults. The only optional ones are promo `cap` (≤ 0 or missing means no cap), promo `min` (missing means 0), and `directSvc`'s `flat`, `pct` (missing means 0) and `max`. Missing booleans are false. A missing credit `modes` means both modes. Cart keys must be canonical non-negative integers (`"0"`, `"12"`): any other key (`"x"`, `"01"`) or an index past the menu is ignored.

### 2.1 `S.rest` and `restFor(brandId, D)`

```
rest = { id, name, profiled, menu, deal, directDelivery, directFee, directSvc,
         amexGoldDirect, platforms, markup, markupEst }
```

- **Profiled** (`D.PROFILES[brandId]` exists): copy `menu`, `deal`, `directDelivery`, `directFee` (only when `directDelivery`), `amexGoldDirect`, `platforms`, `markup`, `markupEst` from the profile. `directSvc` = the profile's `directSvc` or `null`. `profiled: true`.
- **Unprofiled** (in `D.BRANDS` but not in `PROFILES`), per D-006: `menu: []`, `deal: null`, `directDelivery: false` (the route is removed, §9.3), `directSvc: null`, `amexGoldDirect: false`, `platforms: ["dd","ue","gh"]`, `markup` = `D.CATEGORY_DEFAULTS[category].markup`, `markupEst: true`, `profiled: false`.
- `name` is `D.BRANDS[brandId].name` in both cases. A brand in neither table gives `null`.
- `directSvc` (D-029, ISS-031) is `null` or `{ flat, pct, max, modes }`: a restaurant-imposed service fee on direct orders. `flat` and `pct` default to 0, `max` ≤ 0 or missing means no cap, and `modes` (`["d"]`, `["p"]` or `["d","p"]`) says which direct channels pay it.

The state layer (Phase 4) copies `rest.markup[p]` into `S.plats[p].markup` and a card's `membership` into `S.plats[p].member`. **The engine reads markup and membership only from `S.plats`.**

## 3. Channel availability

A channel `plat-mode` is available when:

| Channel | Condition |
|---|---|
| `direct-p` | `S.plats.direct.on` |
| `direct-d` | `S.plats.direct.on` and `S.rest.directDelivery === true` |
| `dd-*`, `ue-*`, `gh-*` | `S.plats[p].on` and `S.rest.platforms` contains `p` |

An unavailable channel is **left out**: `calc` returns `null` and `allResults` skips it. Never price it at $0 (§9.3).

## 4. The cart (`cartInfo`)

- Profiled: `menuSub = round2(Σ price * qty)` over cart lines whose index is in the menu, accumulated from 0 in **ascending menu-index order** (the order JS iterates integer-like keys). The same order applies to `dealSub`, `qty` and `eligQty`. `qty` = Σ qty. `eligQty` = Σ qty of lines whose item has `isDealItem`.
- Unprofiled: `menuSub = round2(manualSubtotal)`, `qty = 0`, `eligQty = 0`.
- `dealReady` = `rest.deal` is non-null **and** `eligQty ≥ deal.minItems`.
- `dealSub` = when `dealReady`: `round2(Σ (isDealItem ? min(price, deal.price) : price) × qty)` (a deal never raises an item's price); otherwise `menuSub`.
- `shortBy` = `rest.deal ? max(deal.minItems − eligQty, 0) : 0`.

## 5. `calc`: the steps, in order (BUILD.md §4.2)

Every component is rounded with `round2` when it is computed (D-012). `round2(n)` is `POD.util.round2`: half away from zero at the cent after a ±1e-9 nudge. Write each formula exactly as below, in this order of operations, so the JS and Python doubles agree.

Let `p` = the platform (`direct`, `dd`, `ue`, `gh`), `m` = the mode (`d` or `p`), `app` = `p !== "direct"`, `P = S.plats[p]`.

**5.1 Deal.** `dealApplied` = `!app` and `S.dealOn` and `dealReady` and `deal.scope` is `"both"`, or `"delivery"` with `m = d`, or `"pickup"` with `m = p`. Then `base = dealApplied ? dealSub : menuSub`.

**5.2 Markup.** `food = app ? round2(base * (1 + P.markup / 100)) : base`.

**5.3 Fees.** All are 0 unless listed.
- App delivery (`app` and `m = d`):
  - `memberOn = P.member && food >= P.memberMin`
  - `delivery = memberOn ? 0 : round2(P.delFee)`
  - `service = round2(Math.max(food * (memberOn ? P.memberSvc : P.svc) / 100, P.svcMin))`
  - `small = food < S.smallMin ? round2(S.smallFee) : 0`
  - `reg = round2(S.regFee)`
- App pickup: no fees.
- Direct delivery: `delivery = round2(rest.directFee)`.
- Direct, either mode, when `rest.directSvc` lists `m` in its `modes`: `dsvc = round2(cap(flat + food * pct / 100))`, where `cap(x) = max > 0 ? Math.min(x, max) : x`.
- `fees = round2(delivery + service + small + reg + dsvc)`, summed in that order.

**5.4 Discounts** (apps only; direct has none). `pr = S.promos[p]`, with `promoOn = pr.type !== "none" and food >= pr.min`. The minimum is tested against the **marked-up** `food` (§9.2).
- When `promoOn` is false, `promo = 0`. Otherwise, by `pr.type`:
- `percent`: `promo = round2(cap(food * pr.value / 100))`, with `cap` as in 5.3 using `pr.cap`
- `dollar`: `promo = round2(pr.value)`
- `freedel`: `promo = m === "d" ? delivery : 0` (the fee actually charged, so 0 when a membership waived it)
- `pick = m === "p" ? round2(food * P.pickDisc / 100) : 0`
- **Joint clamp:** `promo = Math.min(promo, food)`, then `pick = round2(Math.min(pick, food - promo))`, then `disc = round2(promo + pick)`.

**5.5 Tax.** `tax = round2((food - taxDisc) * S.tax / 100)`: on the **discounted** subtotal, where `taxDisc = pr.type === "freedel" ? pick : disc` for apps and `0` for direct. A free-delivery promo takes money off the delivery fee, not the food, so it doesn't lower the taxable amount.

**5.6 Tip.** `tip = round2(food * (m === "d" ? S.tipDel : S.tipPick) / 100)`: on the **pre-discount** `food` (§9.4).

**5.7 Drive** (pickup modes only, direct and app):
- `ev = S.fuel === "ev"`
- `energy = ev ? (S.miPerKwh > 0 ? round2(miles / S.miPerKwh * S.kwh) : 0) : (S.mpg > 0 ? round2(miles / S.mpg * S.gas) : 0)`
- `wearC = round2(miles * S.wear)`, `time = round2(S.hourly * minutes / 60)`
- `drive = round2(energy + wearC + time)`
- `perMile(S)` = `(ev ? (S.miPerKwh > 0 ? S.kwh / S.miPerKwh : 0) : (S.mpg > 0 ? S.gas / S.mpg : 0)) + S.wear`

**5.8 Gross.** `gross = round2(food + fees + tax + tip + drive)`, summed in that order.

**5.9 Credits.** A credit `c` is eligible for this channel when **all** of these hold:
- not `c.locked`, and not `c.used`
- not `c.restricted`, or `S.creditOptIn[c.key]` is true (§9.1)
- `c.plats` contains `p`, **or** `p === "direct"` and `c.goldPartner` and `rest.amexGoldDirect`
- `c.modes` is missing, or contains `m`

`credit = round2(Math.min(Σ eligible c.amount, Math.max(gross - disc, 0)))`. Amounts are summed in `S.credits` order before the min.

**5.10 Net.** `net = Math.max(round2(gross - disc - credit), 0)` and `off = round2(disc + credit)`.

## 6. The result

```
{ id, plat, mode, name,
  parts: { food, fees, tax, tip, drive },
  gross, net, disc, credit, off,
  lines, notes, member }
```

- `id` is the channel id. `plat` is `p`. `mode` is `"d"` or `"p"`.
- `name` = `{direct: "Order direct", dd: "DoorDash", ue: "Uber Eats", gh: "Grubhub"}[p] + " · " + (m === "d" ? "delivery" : "pickup")`.
- `member` = `{dd: "DashPass", ue: "Uber One", gh: "Grubhub+"}[p]` when `memberOn`, else `null`.
- `notes`: `"Deal: " + deal.label` when `dealApplied`, then `"Estimate"` when `rest.profiled` is false. Otherwise empty.
- `lines`: `[label, amount]` pairs in exactly this order. A row marked *if > 0* is left out when its amount is 0.

| # | Label | Amount | When |
|---|---|---|---|
| 1 | `Food` | `food` | always |
| 2 | `Delivery fee` | `delivery` | delivery modes (0 renders "waived") |
| 3 | `Service fee` | `service` | app delivery |
| 3b | `Service fee` | `dsvc` | direct, when `directSvc` lists `m` |
| 4 | `Small-order fee` | `small` | if > 0 |
| 5 | `Regulatory fee` | `reg` | if > 0 |
| 6 | `Tax` | `tax` | always |
| 7 | `Tip` | `tip` | if > 0 |
| 8 | `Charging` (EV) or `Gas` | `energy` | pickup modes |
| 9 | `Wear` | `wearC` | pickup modes, if > 0 |
| 10 | `Time` | `time` | pickup modes, if > 0 |
| 11 | `Promo` | `−promo` | if `promo` > 0 |
| 12 | `Pickup discount` | `−pick` | if `pick` > 0 |
| 13 | `Card credits` | `−credit` | if `credit` > 0 |
| 14 | `TOTAL` | `net` | always |

Negative amounts are written as `round2(-x)`, never `-0`: a zero row is left out instead.

## 7. Judgment calls (D-029)

These fill gaps in BUILD.md §4. They're product choices, recorded so they can be revisited.
- **App pickup has no fees.** DoorDash and Grubhub charge none on pickup. Uber Eats sometimes does; when a researched pickup fee exists, it becomes a field.
- **Fees on app delivery only.** The small-order and regulatory fees apply only to app delivery. Direct delivery pays `directFee` plus `directSvc`.
- **Membership:** it applies at `food >= memberMin`. The spec's "above $12" becomes a per-app setting whose default comes from the state layer. It zeroes the delivery fee and uses `memberSvc` for the service rate; the `svcMin` floor still applies.
- **Promos.** A promo applies to both modes of its app except `freedel` (delivery only). The pickup discount is pickup only. The clamp takes the promo first, then the pickup discount.
- **EVs pay wear too.** §4.2's EV formula omits it, but wear is per mile driven, whatever the fuel.
- **A deal never raises an item's price** (`min(price, deal.price)`).
- **Free delivery isn't a food discount for tax:** a `freedel` promo is still a step-4 discount (it shows as `Promo`), but tax is computed as if it weren't there.
- **Credits:** the engine enforces the §9.1 tiers itself, as defence in depth behind `syncCredits`. A `goldPartner` credit also counts at `direct` when `rest.amexGoldDirect`. `modes` limits a credit to delivery or pickup.
- **`directSvc` (ISS-031)** is modeled; its data stays `null` until a chain's fee is researched. Until then direct orders are understated for Wingstop, Subway and Little Caesars (ISS-031 stays open for the data).
