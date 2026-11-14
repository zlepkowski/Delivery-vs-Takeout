# Engine contract (v5, Phase 2; amended by D-033 and D-036)

The exact definition of `POD.engine` that `src/js/engine.js` and the Python oracle (`tests/oracle/engine.py`) both implement. It fills in what BUILD.md §4 leaves open. **Where this file and BUILD.md §4 differ, this file wins** (D-029). Change it only by a decision. The oracle and the receipts change first, the engine after.

*Amended 2026-11-14 (D-036, Phase 6):* menu items are objects with an optional per-item markup (§2.1); app food is a sum over cart lines (§5.2); a `bogo` promo type (§5.4) and its note (§6).

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
    dd: { on, noDelivery, markup, delFee, svc, svcMin, member, memberSvc, memberMin, pickDisc },   // noDelivery: optional, set only on forEngine's copy, never in S (D-033)
    ue: { … same keys … },
    gh: { … same keys … }
  },
  promos: { dd: { type, value, cap, min, item }, ue: {…}, gh: {…} },  // type: "none"|"percent"|"dollar"|"freedel"|"bogo"; item: a menu index (bogo only)
  credits: [ { key, name, amount, plats, modes, restricted, locked, goldPartner, used } ],
  creditOptIn: { "<key>": true }
}
```

Percent fields (`tax`, `markup`, `svc`, `memberSvc`, `pickDisc`, `tipDel`, `tipPick`, promo `value` for `percent`) are percents: 15 means 15%. **Every numeric field above is required**, because the state layer's `fresh()` supplies defaults. The only optional ones are promo `cap` (≤ 0 or missing means no cap), promo `min` (missing means 0), promo `item` (§5.4), a menu item's `markup` (§2.1), and `directSvc`'s `flat`, `pct` (missing means 0) and `max`. Missing booleans are false. A missing credit `modes` means both modes. Cart keys must be canonical non-negative integers (`"0"`, `"12"`): any other key (`"x"`, `"01"`) or an index past the menu is ignored.

### 2.1 `S.rest` and `restFor(brandId, D)`

```
rest = { id, name, profiled, menu, deal, directDelivery, directFee, directSvc,
         amexGoldDirect, platforms, markup, markupEst }
```

- **A menu item** is `{ name, price, dealItem, markup }` (D-036): `name` a string, `price` a finite number > 0, `dealItem` a boolean (missing means false), and `markup` optional: an object (not null, not an array) `{dd?, ue?, gh?}` of percents, the item's own markup on that app. **The item's markup on app `p`**, `mk(it, p)`, is `it.markup[p]` when `it.markup` is such an object with an own key `p` whose value is a finite number ≥ 0, else `S.plats[p].markup`. A missing or malformed override falls back to the app's markup; it never throws and never becomes 0%.
- **Profiled** (`D.PROFILES[brandId]` exists): copy (deep, so the result never shares an array or object with `D`) `menu`, `deal`, `directDelivery`, `directFee` (only when `directDelivery`), `amexGoldDirect`, `platforms`, `markup`, `markupEst` from the profile. `directSvc` = the profile's `directSvc` or `null`. `profiled: true`.
- **Unprofiled** (in `D.BRANDS` but not in `PROFILES`), per D-006: `menu: []`, `deal: null`, `directDelivery: false` (the route is removed, §9.3), `directSvc: null`, `amexGoldDirect: false`, `platforms: ["dd","ue","gh"]`, `markup` = `D.CATEGORY_DEFAULTS[category].markup`, `markupEst: true`, `profiled: false`. **If the brand's category has no default, `restFor` returns `null`:** the brand can't be priced, and a missing markup must never become 0%.
- `name` is `D.BRANDS[brandId].name`, or the `brandId` itself for a profiled brand missing from `BRANDS`. A brand in neither table gives `null`.
- `directSvc` (D-029, ISS-031) is `null` or `{ flat, pct, max, modes }`: a restaurant-imposed service fee on direct orders. `flat` and `pct` default to 0, `max` ≤ 0 or missing means no cap, and `modes` (`["d"]`, `["p"]` or `["d","p"]`) says which direct channels pay it. **A `directSvc` without a `modes` array applies to no channel**, never a crash. The generator rejects such an entry when the field is added (ISS-031).

The state layer (Phase 4) copies `rest.markup[p]` into `S.plats[p].markup` and a card's `membership` into `S.plats[p].member`. **The engine reads the app's markup and membership only from `S.plats`**, and a per-item override only from `S.rest.menu[i].markup` (D-036).

## 3. Channel availability

A channel `plat-mode` is available when:

| Channel | Condition |
|---|---|
| `direct-p` | `S.plats.direct.on` |
| `direct-d` | `S.plats.direct.on` and `S.rest.directDelivery === true` |
| `dd-p`, `ue-p`, `gh-p` | `S.plats[p].on` and `S.rest.platforms` contains `p` |
| `dd-d`, `ue-d`, `gh-d` | as the app's pickup, and `S.plats[p].noDelivery !== true` (D-033) |

An unavailable channel is **left out**: `calc` returns `null` and `allResults` skips it. Never price it at $0 (§9.3).

`noDelivery` (D-033) is set only on the copy `POD.state.forEngine` builds, for an app whose delivery fees the user hasn't entered yet (D-032): its pickup is still priced, because app pickup reads none of those fees (§7). Like every boolean here, a missing `noDelivery` is false.

## 4. The cart (`cartInfo`)

- The **cart lines** are the entries of `cart` whose key is a canonical non-negative integer `i` with `i < menu.length`, in **ascending menu-index order** (the order JS iterates integer-like keys); line `i` has item `menu[i]` and quantity `q = cart[i]`.
- Profiled: `menuSub = round2(Σ price * q)` over the cart lines, accumulated from 0 in that order. The same order applies to `dealSub`, `qty` and `eligQty` (and to app food, §5.2). `qty` = Σ q. `eligQty` = Σ q of lines whose item has `dealItem === true`.
- Unprofiled: `menuSub = round2(manualSubtotal)`, `qty = 0`, `eligQty = 0`.
- `dealReady` = `rest.deal` is non-null **and** `eligQty ≥ deal.minItems`.
- `dealSub` = when `dealReady`: `round2(Σ (dealItem ? min(price, deal.price) : price) × q)` (a deal never raises an item's price); otherwise `menuSub`.
- `shortBy` = `rest.deal ? max(deal.minItems − eligQty, 0) : 0`.

## 5. `calc`: the steps, in order (BUILD.md §4.2)

Every component is rounded with `round2` when it is computed (D-012). `round2(n)` is `POD.util.round2`: half away from zero at the cent after a ±1e-9 nudge. Write each formula exactly as below, in this order of operations, so the JS and Python doubles agree.

Let `p` = the platform (`direct`, `dd`, `ue`, `gh`), `m` = the mode (`d` or `p`), `app` = `p !== "direct"`, `P = S.plats[p]`.

**5.1 Deal.** `dealApplied` = `!app` and `S.dealOn` and `dealReady` and `deal.scope` is `"both"`, or `"delivery"` with `m = d`, or `"pickup"` with `m = p`. Any other scope, including a missing one, never applies; `tools/build-profiles.py` rejects such deals. Then `base = dealApplied ? dealSub : menuSub`.

**5.2 Markup** (D-036).
- Direct: `food = base`.
- App, unprofiled: `food = round2(base * (1 + P.markup / 100))`.
- App, profiled: a sum over the cart lines (§4), in ascending menu-index order: `acc = 0`, then for each line `acc = acc + it.price * q * (1 + mk(it, p) / 100)` (multiplied in that order: `(price * q) * (1 + mk / 100)`), then `food = round2(acc)`. Rounded once, not per item. When no item has an override this equals the old `round2(menuSub * (1 + P.markup / 100))` up to floating-point order (every hand-worked receipt kept its value).

**5.3 Fees.** All are 0 unless listed.
- App delivery (`app` and `m = d`):
  - `memberOn = P.member && food >= P.memberMin`. In every other channel `memberOn` is false, so `member` is `null` on pickup and direct.
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
- `bogo` (D-036): `j = pr.item`. When `rest.profiled`, `j` is an integer (`typeof j === "number"`, finite, `Math.floor(j) === j`) with `0 <= j < menu.length`, and `cart` has an own key `String(j)` with quantity `q`: `free = Math.floor(q / 2)` and `promo = round2(cap(menu[j].price * free * (1 + mk(menu[j], p) / 100), pr.cap))`. Otherwise `promo = 0`. `pr.value` isn't read.
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
- `notes`: `"Deal: " + deal.label` when `dealApplied`, then `"BOGO: " + menu[pr.item].name` when `pr.type === "bogo"` and `promo > 0` after the clamp (D-036), then `"Estimate"` when `rest.profiled` is false. Otherwise empty.
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
- **Per-item markup is a sum, rounded once (D-036).** An app's menu shows each item at a price in cents, so rounding each item first would be the literal receipt. It isn't done: the markups are estimates (every profile uses its category default), and per-item rounding moved 150 of the 190 hand-worked app totals by a cent for no gain in accuracy.
- **`bogo` (D-036)** is an app promo the user enters from the app's offer: each pair of the chosen item makes one free (`floor(q / 2)`), at that item's own marked-up price. Both modes, like `percent`. It's a food discount, so it lowers the taxed amount (§5.5) and not the tip base (§9.4). How many items an offer makes free isn't modeled; `cap` limits the dollars. A direct-channel BOGO deal isn't modeled: `deal` stays a price per eligible item.
- **`directSvc` (ISS-031)** is modeled; its data stays `null` until a chain's fee is researched. Until then direct orders are understated for Wingstop, Subway and Little Caesars (ISS-031 stays open for the data).
