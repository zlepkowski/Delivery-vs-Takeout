# Insights contract (v5, Phase 5)

The exact definition of `POD.insights` in `src/js/insights.js`: the nine advice cards of BUILD.md §4.5. **Where this file and BUILD.md §4.5 differ, this file wins** (D-034). `src/js/insights.js` and the Python reference `tests/oracle/insights.py` both implement it. Change it only by a decision: the reference and the fixtures (`tests/fixtures/insights/`) change first, the code after.

*Amended 2026-11-14 after the 5.2 review:* a restricted gold-partner credit counts for Wallet and Timing only once opted in (§3.5, §3.6); the never-throw guards are written out (§1, §3.4).

## 0. Rules

- **Pure.** `build` reads only its arguments and calls only `POD.engine` (`calc`, `cartInfo`, `perMile`) and `POD.util` (`round2`, `money`). No `POD.S`, no `POD.data`, no DOM, no `Date` (neither `new Date()` nor `Date.now()`: the clock comes in as `now`). It never changes `F`, `R` or `now`.
- **Never throws.** Bad input gives `[]`.
- **Text is plain text**, not HTML. The page escapes it (UI contract). Every template below is exact, character for character: `·` is U+00B7, `×` is U+00D7, `“ ”` are U+201C/U+201D.
- Words: "finite number" = `typeof x === "number" && isFinite(x)`; "object" = not null, `typeof "object"`, not an array.
- **Every number in `data` is written as `x + 0`**, so a negative zero (from `Math.round` or `round2` of a tiny negative) is stored as `0`.
- `round1(x) = Math.round(x * 10) / 10`. `mi(x) = round1(x).toFixed(1)`. `money` = `POD.util.money` (it rounds to the cent itself). `APP_NAME = {dd: "DoorDash", ue: "Uber Eats", gh: "Grubhub"}`.

## 1. API

`POD.insights.build(F, R, now)` → an array of insight objects, in the order of §3 (unlock, distance, fuel, minimum, wallet, timing, locked, nuance, spread), each present at most once.

- `F`: the engine-ready copy, `POD.state.forEngine(S)` (never `null` here: the page doesn't call `build` then).
- `R`: `POD.engine.allResults(F)`.
- `now`: a `Date` (only `getFullYear`, `getMonth`, `getDate` and `getTime` are read).

Returns `[]` when `F` isn't an object, `F.rest` isn't an object, `F.rest.profiled === true` and `F.rest.menu` isn't an array, `R` isn't an array or is empty, or `POD.engine.cartInfo(F).menuSub` isn't a finite number > 0 (an empty order gets no advice). Every read of a nested field checks its parent is an object first (a missing `F.plats`, `F.promos` or `F.credits` means none), so a malformed `F` never throws.

An insight is `{ id, label, cls, text, data }`: `id` as in §3, `label` its title, `cls` one of `""`, `"good"`, `"hot"`, `text` the sentence(s), `data` the numbers behind it (the tests compare `data` exactly and `text` exactly).

## 2. Shared terms

- `bp` = the first entry of `R` whose `mode` is `"p"` (the cheapest pickup); `bd` = the first whose `mode` is `"d"` (the cheapest delivery). Either may be missing.
- `find(id)` = the entry of `R` with that `id`, or missing.
- "the cheapest item" of a list of menu indexes = the one with the lowest price (`menu[i][1]`); ties go to the lowest index.
- "cart plus k of item j" = a new object with every own key of `F.cart` copied, then key `String(j)` set to `(that key's value if it's a finite number, else 0) + k`.

## 3. The insights

### 3.1 `unlock` · label `Unlock`: you're N items from a direct-only deal

Shows when all hold: `deal = F.rest.deal` is an object; `F.dealOn === true`; `ci = cartInfo(F)` has `ci.shortBy > 0`; the menu has at least one deal item (`menu[i][2] === true`).

- `j` = the cheapest deal item. `cart2` = cart plus `ci.shortBy` of `j`.
- For `ch` in `["direct-d", "direct-p"]`, in that order: `a = calc(F, ch, {cart: cart2})`; keep it when it's non-null and its `notes` contain `"Deal: " + deal.label`. No kept result → no insight. `best` = the kept result with the lowest `net` (a tie keeps the first).
- `was` = `find(best.id).net`.
- `data = {n: ci.shortBy, item: menu[j][0], channel: best.id, net: best.net, was: was}`
- `cls` = `"good"` when `best.net <= R[0].net`, else `""`.
- `text` = `"Add " + n + " × " + item + " and " + deal.label + " applies: " + best.name + " comes to " + money(best.net) + " (now " + money(was) + ")."`

### 3.2 `distance` · label `Distance`: the round trip at which delivery starts to win

Shows when `bp` and `bd` both exist and `rate > 0`, where `rate = perMile(F) + (F.hourly > 0 && F.speed > 0 ? F.hourly / F.speed : 0)` (the cost of one more mile: running cost plus time).

- `fixed = calc(F, bp.id, {miles: 0, minutes: 0}).net`; `be = (bd.net - fixed) / rate`.
- `data = {breakEven: round1(be), miles: round1(F.miles), pickup: bp.id, delivery: bd.id}`
- `be <= 0`: `cls ""`, `text` = `"Delivery (" + bd.name + ", " + money(bd.net) + ") costs less than picking up, even from next door."`
- `be >= F.miles`: `cls "good"`, `text` = `"Picking up stays cheaper than delivery up to a " + mi(be) + " mi round trip. Yours is " + mi(F.miles) + " mi."`
- otherwise: `cls ""`, `text` = `"Delivery wins once the round trip passes " + mi(be) + " mi, and yours is " + mi(F.miles) + " mi."`

(Credits that clamp at the total make the real line bend; this is the straight-line estimate the spec asks for.)

### 3.3 `fuel` · label `Fuel`: the gas price at which delivery would win

Shows when `F.fuel !== "ev"`, `F.mpg > 0`, `F.miles > 0`, `bp` and `bd` exist, and `bp.net < bd.net`.

- `be = F.gas + (bd.net - bp.net) / (F.miles / F.mpg)` ($/gal).
- `capped = be > 12` (BUILD.md §4.5: "even at $12/gal pickup still wins").
- `data = {gas: F.gas, breakEven: round2(be), capped: capped}`; `cls ""`.
- `capped`: `text` = `"Even at $12.00/gal, picking up still wins."`
- otherwise: `text` = `"Picking up wins until gas reaches " + money(round2(be)) + "/gal. Yours costs " + money(F.gas) + "/gal."`

### 3.4 `minimum` · label `Minimum`: a promo just out of reach

A **candidate** is each entry `r` of `R`, in order, with all of: `r.plat !== "direct"`; `pr = F.promos[r.plat]` is an object; `pr.type` is `"percent"`, `"dollar"` or `"freedel"`; `min = pr.min` is a finite number > 0; `r.parts.food < min`; not (`pr.type === "freedel"` and `r.mode === "p"`).

For a candidate, the counterfactual:
- **Profiled** (`F.rest.profiled === true`): `j` = the cheapest item of the whole menu (none → not a candidate). For `k` = 1, 2, … 20: `a = calc(F, r.id, {cart: cart plus k of j})`; stop at the first `k` with `a.parts.food >= min`. None by 20 → not a candidate. `addQty = k`, `addItem = menu[j][0]`, `addAmount = round2(k * menu[j][1])`.
- **Unprofiled:** when `F.plats[r.plat].markup` isn't a finite number, not a candidate. Otherwise `ms = Math.ceil(min / (1 + markup / 100) * 100) / 100`. Up to 5 tries (two always suffice: the ceiling puts `ms × (1 + markup)` at or above `min`, so only rounding to the cent can fall short, by less than one step; the cap is a guard): `a = calc(F, r.id, {manualSubtotal: ms})`; stop when `a.parts.food >= min`, else `ms = round2(ms + 0.01)`. None in 5 → not a candidate. `addQty = null`, `addItem = null`, `addAmount = round2(ms - F.manualSubtotal)`.
- `delta = round2(a.net - r.net)`.

Shows the candidate with the **smallest `delta`** (a tie keeps the earlier in `R`). None → no insight.
- `data = {channel: r.id, min: min, short: round2(min - r.parts.food), addQty, addItem, addAmount, net: a.net, was: r.net, delta}`
- `cls` = `"good"` when `delta < 0`, else `""`.
- `text` = `r.name + " is " + money(short) + " short of its " + money(min) + " promo minimum. " + add + " brings it to " + money(a.net) + ": " + change + " than now."`, where `add` = `"Adding " + addQty + " × " + addItem + " (" + money(addAmount) + ")"` when profiled, else `"Adding " + money(addAmount) + " of food"`, and `change` = `money(-delta) + " less"` when `delta < 0`, else `money(delta) + " more"`.

### 3.5 `wallet` · label `Wallet`: an Amex Gold dining partner

Shows when `F.rest.amexGoldDirect === true`, `F.plats.direct` is an object with `on === true`, and `F.credits` (an array) has a credit `c` with `c.goldPartner === true`, `c.locked !== true`, and not (`c.restricted === true` and `F.creditOptIn[c.key] !== true`) (a restricted credit counts only once opted in, §9.1, as in engine contract §5.9): the first such `c`.

- `data = {credit: c.key, amount: c.amount, used: c.used === true}`
- not used: `cls "good"`, `text` = `F.rest.name + " is an Amex Gold dining partner, so your " + money(c.amount) + " " + c.name + " works when you order direct."`
- used: `cls ""`, `text` = `F.rest.name + " is an Amex Gold dining partner, but your " + c.name + " is marked used this period."`

### 3.6 `timing` · label `Timing`: unused credits and when they reset

Needs `now` to be an object whose `getTime` is a function returning a finite number (anything else, including `null`, `{}` or an invalid `Date`: no Timing, and no throw). The **items** are the credits `c` of `F.credits`, in order, with all of: `c.locked !== true`; `c.used !== true`; `c.cadence` is `"monthly"`, `"quarterly"`, `"semiannual"` or `"annual"`; and `c.plats` is a non-empty array **or** (`c.goldPartner === true` and `F.rest.amexGoldDirect === true` and not (`c.restricted === true` and `F.creditOptIn[c.key] !== true`)). No items → no insight.

- `days(c)`: with `y = now.getFullYear()`, `m = now.getMonth()` (0–11), `d = now.getDate()`, the next period starts on the 1st of month `s`: monthly `s = m + 1`; quarterly `s = (Math.floor(m / 3) + 1) * 3`; semiannual `s = (Math.floor(m / 6) + 1) * 6`; annual `s = 12` (months past 11 run into the next year). `days = dim(y, m) - d + 1 + Σ dim(y, t)` for `t = m + 1 … s - 1`, where `dim(y, t)` is the number of days in month `t` of year `y` (`t` ≤ 11 here), with February 29 days when `y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)`. Pure arithmetic: no `Date` is built.
- Sort the items by `days` ascending, then `key` ascending (plain string order).
- `data = {items: [{key, name, amount, days}, …], total: round2(Σ amount, summed in the sorted order)}`
- `cls` = `"hot"` when the first item's `days <= 7`, else `""`.
- `text` = `"Unused this period: " + the first (up to) 3 items, each name + " (" + money(amount) + ", resets in " + (days === 1 ? "1 day" : days + " days") + ")", joined by "; " + (more than 3 ? "; and " + (count - 3) + " more" : "") + "."`

### 3.7 `locked` · label `Locked`: credits that can't pay for this order

- `locked` = the credits of `F.credits` with `locked === true`; `restricted` = those with `restricted === true`, `locked !== true`, and `F.creditOptIn[key] !== true` (own key). Both in `F.credits` order. Both empty → no insight.
- `data = {locked: [their keys], restricted: [their keys]}`; `cls ""`.
- `text` = the non-empty parts joined by a space: `"Can't be used on a restaurant order: " + names(locked) + "."` and `"Only at some restaurants (tick “Qualifies here” if this one takes it): " + names(restricted) + "."`, where `names` joins the credits' `name`s with `", "`, each name listed once (its first time).

### 3.8 `nuance` · label `Nuance`: app pickup beats the counter

Shows when `dp = find("direct-p")` exists, `ap` = the first entry of `R` with `plat !== "direct"` and `mode === "p"` exists, and `ap.net < dp.net`.

- `why` = `"credit"` when `ap.credit > 0`, else `"promo"` when `ap.disc > 0`, else `"other"`.
- `data = {channel: ap.id, net: ap.net, direct: dp.net, diff: round2(dp.net - ap.net), why}`; `cls "good"`.
- `text` = `"Ordering pickup in " + APP_NAME[ap.plat] + " beats ordering direct for pickup by " + money(diff) + tail`, with `tail` = `", because your card credit works there."` (credit), `", thanks to its promo."` (promo) or `"."` (other).

### 3.9 `spread` · label `Spread`: best vs worst

Shows when `R.length >= 2` and `gap = round2(R[last].net - R[0].net) > 0`.

- `data = {lo: R[0].id, hi: R[last].id, gap}`; `cls ""`.
- `text` = `"The same order costs " + money(R[0].net) + " (" + R[0].name + ") to " + money(R[last].net) + " (" + R[last].name + "): a " + money(gap) + " spread."`

## 4. What this leaves out

- Suggesting *which* items to add beyond the cheapest one (BUILD.md §11 "cart quantization").
- A Fuel insight for EVs (the $/gal framing doesn't apply; the receipt's Charging line shows the cost).
- Insights about apps the comparison left out (their missing fees are shown by the page, UI contract).
