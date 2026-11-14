# State contract (v5, Phase 4)

The exact definition of `POD.state` in `src/js/state.js`: the state object `S`, the derivation cascade, the wallet, and persistence. It fills in BUILD.md §3 and §5. **Where this file and BUILD.md §5 differ, this file wins** (D-031). Change it only by a decision; the hand-worked scenarios (`tests/fixtures/state/`) change first, the code after.

## 0. Rules for every function

- **Reads only its arguments.** The data tables come in as `D` (in the app, `POD.data`), the clock as `now` (a `Date`), storage as `storage`. No `POD.S`, no `POD.data`, no `Date` of its own, no DOM, no `localStorage` of its own. It may call `POD.engine.restFor` and the `POD.geo` functions, which follow the same rule.
- **Mutates only `S`.** The derivation and action functions change the `S` they're given, in place, and nothing else: never `D`, `opts`, `storage` or an argument object (a store, a credit). Every object or array they put into `S` is new: it shares nothing with `D` or with an argument.
- **Never throws.** Bad input leaves `S` as the section says (usually unchanged) and the function returns `false` or `null` where it has a return value.
- Words as in the geography contract §0: "finite number" = `typeof x === "number" && isFinite(x)`; "object" = not null, `typeof "object"`, not an array; "own key" = `hasOwnProperty`; no `instanceof`.
- `APPS = ["dd", "ue", "gh"]`. `round1(x) = Math.round(x * 10) / 10`.

## 1. API (`POD.state`)

| Function | Does | Returns |
|---|---|---|
| `fresh(D)` | a new blank state (§2) | `S` |
| `getPath(S, path)` | reads a dotted path (§3) | the value, or `undefined` |
| `setPath(S, path, v)` | writes a dotted path that `fresh` has (§3) | `true`, or `false` (nothing written) |
| `applyCar(S, D)` | car → `fuel`, `mpg`, `miPerKwh`, then `applyState` (§4.1) | — |
| `applyState(S, D)` | `state` + `fuel` → `tax`, `gas` (§4.2) | — |
| `applyAddress(S, D)` | `address` or a GPS `pos` → `zip`, `zipRec`, `state`, `pos`, then `applyState` (§4.3) | — |
| `applyBrand(S, D)` | `brand` → `rest`, the apps' `markup` (§4.4) | — |
| `autoMiles(S, D, opts)` | the trip, from a store or the estimator (§4.5) | a trip status |
| `applyMinutes(S)` | `minutes` from `miles` and `speed` (§4.6) | — |
| `syncCredits(S, D, now)` | `cards` → `credits`, and the apps' `member` (§5) | — |
| `derive(S, D, now, opts)` | every derived field, in cascade order (§4.7) | a trip status |
| `setAddress(S, D, text, opts)` | user typed an address (§6) | a trip status |
| `setPosition(S, D, lat, lon, opts)` | the browser gave a position (§6) | a trip status, or `null` |
| `setCar(S, D, make, model)` | user picked a car (§6) | — |
| `setBrand(S, D, brandId, opts)` | user picked a restaurant brand (§6) | a trip status |
| `pickStore(S, D, store, opts)` | user picked one store from `storesNear` (§6) | a trip status, or `null` |
| `setQty(S, index, qty)` | a menu item's quantity in the cart (§6) | `true` / `false` |
| `pinMiles(S, miles)` | user typed the trip distance (§6) | `true` / `false` |
| `unpinMiles(S, D, opts)` | user went back to the automatic distance (§6) | a trip status |
| `toggleCard(S, D, cardId, on, now)` | add or remove a card (§6) | `true` / `false` |
| `setOptIn(S, D, key, on, now)` | "Qualifies here" for a restricted credit (§6) | `true` / `false` |
| `markUsed(S, D, key, used, now)` | "Used this period" (§6) | `true` / `false` |
| `addManualCredit(S, D, credit, now)` | a credit the user typed (§6) | its key, or `null` |
| `removeManualCredit(S, D, key, now)` | (§6) | `true` / `false` |
| `periodOf(cadence, now)` | the period a date falls in (§5.2) | a string, or `null` |
| `missing(S)` | which shared inputs the engine still needs (§7) | an array of paths |
| `appMissing(S, p)` | which of app `p`'s fees are still empty (§7) | an array of paths |
| `forEngine(S)` | the copy of `S` the page prices: an app missing a pickup input switched off, one missing only delivery inputs marked `noDelivery` (§7, D-033) | a new object, or `null` |
| `load(storage, D, now, opts)` | saved state merged over `fresh`, then `derive` (§8) | `S` |
| `save(S, storage)` | writes the user fields (§8) | `true` / `false` |

A **trip status** is `{ status, need, partial }`: `status` is `"ok"`, `"need"` (tiles must be loaded first: `need` lists the cells, as in geography contract §9) or `"off"` (the distance is pinned); `need` is `[]` unless `"need"`; `partial` is `true` when a tile failed or was unusable.

## 2. `fresh(D)`

```
{
  address: "",  pos: null,  zip: null,  zipRec: null,  state: null,  tax: null,  gas: null,
  make: "",  model: "",  fuel: "regular",  mpg: null,  miPerKwh: null,  kwh: T.kwh,
  brand: null,  rest: null,  store: null,  storePicked: false,
  cart: {},  manualSubtotal: 0,  dealOn: true,
  miles: null,  minutes: null,  speed: T.speed,  milesAuto: true,  milesSrc: null,  milesBy: {},
  tipDel: TIPS.tipDel,  tipPick: TIPS.tipPick,  wear: T.wear,  hourly: 0,
  regFee: F.regFee,  smallMin: F.smallMin,  smallFee: F.smallFee,
  cards: [],  credits: [],  creditOptIn: {},  usedIn: {},  manualCredits: [],
  plats: {
    direct: { on: true },
    dd: { on: true, markup: null, delFee, svc, svcMin, memberSvc, memberMin, pickDisc,   ← from P.dd
          member: false, memberOwn: false, cardMember: true },
    ue: { … from P.ue … },  gh: { … from P.gh … }
  },
  promos: { dd: { type: "none", value: 0, cap: 0, min: 0 }, ue: { … }, gh: { … } }
}
```

`T = D.DEFAULTS.trip`, `TIPS = D.DEFAULTS.tips`, `F = D.DEFAULTS.fees`, `P = D.DEFAULTS.plats` (the sourced defaults in `src/data/defaults.js`, D-032). **Each default is copied only if it's a finite number; anything else (missing, `null`) becomes `null`**, and `missing(S)` (§7) then asks the user for it. A default is never replaced by a made-up number. `hourly: 0` is BUILD.md §4.2's "time is not priced by default", not data.

An empty default is expected, not an error: on 2026-11-13 every app's delivery fee is `null` (D-032).

Field meanings beyond BUILD.md §5: `pos` = `{lat, lon, src}` with `src` `"zip"` (a ZIP centroid) or `"gps"`; `storePicked` = the user chose `store` (not the nearest); `milesSrc` = `"store"`, `"estimate"`, `"pinned"` or `null`; `usedIn` = `{creditKey: periodId}`; `manualCredits` = the user's own credits (§5.3); `memberOwn` = "I pay for this membership"; `cardMember` = "use the membership my card includes" (D-024: on by default, the user can turn it off); `member` is derived (§5.4).

## 3. `getPath` / `setPath`

A path is a non-empty string of `.`-separated segments, e.g. `"plats.dd.delFee"`. A segment `__proto__`, `constructor` or `prototype` makes the path invalid.

- `getPath(S, path)`: walks own keys; `undefined` when a segment is missing or a non-object is in the way.
- `setPath(S, path, v)`: writes only when **every segment but the last is an existing own-key object**, **the last segment is an existing own key** of it, and **`v` is a plain value**: `null`, a boolean, a string or a finite number (an object, array, `undefined`, `NaN` or `±Infinity` → `false`). It never creates keys. Returns `true` when it wrote. Beyond that it doesn't validate `v` (a negative tip is written, and `missing` reports it) or re-derive anything: the caller runs the matching `apply*` function (the page does this in Phase 5).

## 4. The derivation cascade

### 4.1 `applyCar(S, D)`

Parse `D.CAR_DATA` (BUILD.md §6): each row `"Make|Model:val,Model:val…"`; a value is digits with an optional suffix `*` (premium), `d` (diesel), `e` (electric, value = mi/kWh × 10), none = regular. Find the row whose make equals `S.make` and the model equal to `S.model` (exact strings).

- Found, not electric: `fuel` = `"regular"`, `"premium"` or `"diesel"`; `mpg` = the value; `miPerKwh = null`.
- Found, electric: `fuel = "ev"`; `miPerKwh` = value / 10; `mpg = null`.
- Not found (including `make` `"Other"` or empty): `fuel`, `mpg` and `miPerKwh` are the user's own and are **left unchanged**.

Then `applyState(S, D)`.

### 4.2 `applyState(S, D)`

Find the `D.STATES` row `[code, name, gasRegular, mealTaxPct]` whose code equals `S.state`.

- Found: `tax = row[3]`; `gas = Math.round((row[2] + add) * 1000) / 1000`, where `add` = `D.GRADE_ADD.premium` for `"premium"`, `D.GRADE_ADD.diesel` for `"diesel"`, else 0 (regular, and EV, whose `gas` is unused).
- Not found (`null`, unknown): `tax = null`, `gas = null`.

### 4.3 `applyAddress(S, D)`

- If `S.pos` is a GPS position (`src === "gps"` with finite `lat`, `lon`): `zipRec = geo.nearestZip(lat, lon, D)`, `zip = zipRec ? zipRec.z : null`, `state = zipRec ? zipRec.st : null`. `pos` is unchanged.
- Otherwise the ZIP comes from `S.address`: the **last** run of exactly 5 digits that isn't part of a longer digit run, optionally followed by `-` and 4 digits (`"12345 Main St, Town MT 20003"` → `20003`; `"NY 10004-1234"` → `10004`). Then `zip` = that code or `null`; `zipRec = geo.zipByCode(zip, D)` (or `null`); `state = zipRec ? zipRec.st : null`; `pos = zipRec ? {lat: zipRec.la, lon: zipRec.lo, src: "zip"} : null`.

Then `applyState(S, D)`. (An unknown ZIP keeps `zip` so the page can say "ZIP 99999 not found", with `zipRec`, `state` and `pos` `null`.)

### 4.4 `applyBrand(S, D)`

`rest = (typeof S.brand === "string") ? POD.engine.restFor(S.brand, D) : null` (engine contract §2.1). Then for each app `p`: `plats[p].markup` = `rest.markup[p]` when `rest` is non-null and that's a finite number, else `null`. Nothing else changes (resets belong to `setBrand`, §6).

### 4.5 `autoMiles(S, D, opts)`

`opts` is passed to the geography functions unchanged (its `failed` names tiles that couldn't load).

1. If `S.milesAuto` is not `true`: change nothing; return `{status: "off", need: [], partial: false}`.
2. If `S.pos` isn't a position, or `S.brand` isn't a string, or `S.rest` is `null`: `miles = null`, `milesSrc = null`, and `store = null` unless `storePicked`; `applyMinutes`; return `{status: "ok", need: [], partial: false}`.
3. **A picked store** (`storePicked` and `store` is `{id, lat, lon}` whose `id` starts with `S.brand + "@"`): `miles = geo.tripMiles(geo.distMi(pos.lat, pos.lon, store.lat, store.lon))`, `milesSrc = "store"`. `applyMinutes`; return `{status: "ok", need: [], partial: false}`.
4. Otherwise `r = geo.nearestStore(pos.lat, pos.lon, S.brand, D, opts)`, and `storePicked = false`.
   - `r` is `null` (no store index at all): go to step 5 with `partial = false`.
   - `r.status === "need"`: **clear the trip**: `store = null`, `miles = null`, `milesSrc = null`, `applyMinutes`; return `{status: "need", need: r.need (a copy), partial: false}`. A distance kept from before (another brand, another address, an unpinned pin) would be a made-up one for this trip, and `missing(S)` now holds the page back until the tiles arrive and `derive` runs again.
   - `r.store` non-null: `store = {id, lat, lon}` of it, `miles = r.store.trip`, `milesSrc = "store"`; `applyMinutes`; return `{status: "ok", need: [], partial: r.partial}`.
   - `r.store` null: go to step 5 with `partial = r.partial`.
5. **The estimator:** `store = null`; `e = geo.estimateMiles({la: pos.lat, lo: pos.lon}, S.brand, D)`; `miles = e ? e.round : null`; `milesSrc = e ? "estimate" : null`; `applyMinutes`; return `{status: "ok", need: [], partial}`.

### 4.6 `applyMinutes(S)`

`minutes = Math.round(miles / speed * 60)` when `miles` is a finite number ≥ 0 and `speed` a finite number > 0; else `null`.

### 4.7 `derive(S, D, now, opts)`

In this order: `applyCar`, `applyAddress` (which runs `applyState`), `applyBrand`, `syncCredits`, then the trip: if `milesAuto` is `true` run `autoMiles` and return its status; else `milesSrc = "pinned"` (it isn't saved, so a reload needs it back), `applyMinutes`, and return `{status: "off", need: [], partial: false}`. `derive` never resets a user field (cart, pins, picked store); that's what makes it safe to run after `load`.

## 5. The wallet

### 5.1 `syncCredits(S, D, now)`: destructive by design (BUILD.md §5)

1. `S.cards` keeps only strings that are the `id` of a card in `D.CARDS`, in their existing order, without duplicates.
2. `S.credits` is rebuilt from scratch: for each card in **`D.CARDS` order** whose id is in `S.cards`, each of its credits `c`, one entry
   ```
   { key: card.id + "." + c.id, cardId: card.id, name: c.name, amount: c.amount, cadence: c.cadence,
     plats: (c.locked || (c.restricted && S.creditOptIn[key] !== true)) ? [] : copy of c.plats,
     modes: copy of c.modes (only if c.modes is an array),
     restricted: !!c.restricted, locked: !!c.locked, goldPartner: !!c.goldPartner,
     used: S.usedIn[key] === periodOf(c.cadence, now), manual: false }
   ```
   then one entry per **manual credit** `m` (§5.3), in `S.manualCredits` order:
   ```
   { key: m.key, cardId: null, name: m.name, amount: m.amount, cadence: m.cadence, plats: copy of m.plats,
     modes: copy of m.modes (only if it has one), restricted: false, locked: false, goldPartner: false,
     used: S.usedIn[m.key] === periodOf(m.cadence, now), manual: true }
   ```
3. **Kept, never cleared by a sync:** `S.creditOptIn`, `S.usedIn` and `S.manualCredits`. That's how opt-ins, used flags and manual credits survive a card toggle (and come back when a card is re-added).
4. Memberships (§5.4).

The engine also enforces the tiers itself (engine contract §5.9): this is the first line of defence, not the only one (§9.1).

### 5.2 `periodOf(cadence, now)`

`now` must be a `Date` with a finite time, else `null`. From its **local** calendar date (`getFullYear`, `getMonth`): `"monthly"` → `"YYYY-MM"`; `"quarterly"` → `"YYYY-Qn"` (n = 1..4); `"semiannual"` → `"YYYY-Hn"` (n = 1, 2); `"annual"` → `"YYYY"`; `"once"` → `"once"`; any other cadence → `null`. A used flag counts only in the period it was set in, so it resets by itself on the 1st of the next period. (Credits that reset on the card anniversary are treated as calendar periods: an approximation.)

### 5.3 Manual credits

`addManualCredit(S, D, credit, now)`: `credit` must be an object with `name` a non-empty string, `amount` a finite number > 0, `plats` an array of strings each in `["direct","dd","ue","gh"]`; optional `modes` (`["d"]`, `["p"]` or both) and `cadence` (one of §5.2's; default `"once"`). Otherwise return `null` and change nothing. The key is `"manual." + n`, with `n` = 1 + the largest `n` among existing manual keys (1 for the first). The stored copy is `{key, name, amount, cadence, plats, modes?}`. Then `syncCredits`. Returns the key. As a credit it is universal (not restricted, not locked, not goldPartner).

### 5.4 Memberships

For each app `p`: `plats[p].member = plats[p].memberOwn === true || (cardHas(p) && plats[p].cardMember !== false)`, where `cardHas(p)` = some card in `S.cards` (after step 1) has `membership === p` in `D.CARDS`. The engine reads only `member` (engine contract §2.1).

## 6. Actions (what a user change runs)

- `setAddress(S, D, text, opts)`: `address = text` if it's a string, else `""`; `pos = null` (a typed address replaces a GPS position); `applyAddress`; then the trip (as in `derive`'s last step).
- `setPosition(S, D, lat, lon, opts)`: lat in [−90, 90] and lon in [−180, 180], finite, else return `null` and change nothing. `pos = {lat, lon, src: "gps"}`; `applyAddress`; the trip.
- `setCar(S, D, make, model)`: `make` and `model` are each the argument if it's a string, else `""`. If the new pair differs from the previous `(S.make, S.model)` and isn't in `D.CAR_DATA` (the §4.1 lookup), `mpg = null` and `miPerKwh = null` (`fuel` is kept): they belonged to the previous car, and the user now enters their own. Then `applyCar`. *(Amended 2026-11-14, review of 5.3: "Other" kept the previous car's 46 mpg, so the page priced the old car without asking. `applyCar` itself is unchanged, so a reload keeps the user's own values.)*
- `setBrand(S, D, brandId, opts)`: `brand` = the string, or `null`; `cart = {}`; `dealOn = true`; `store = null`; `storePicked = false`; `applyBrand`. Then, if `milesBy` has an own key `brand` with a finite number ≥ 0: `miles` = it, `milesAuto = false`, `milesSrc = "pinned"`, `applyMinutes`, return `{status: "off", …}`. Else `milesAuto = true` and return `autoMiles`. (`manualSubtotal` is kept.)
- `pickStore(S, D, store, opts)`: `store` must be an object with a string `brand`, a string `id` that starts with `brand + "@"`, and finite `lat` and `lon` in range (a `storesNear` row), else return `null` and change nothing. If `store.brand !== S.brand`, run `setBrand(S, D, store.brand, opts)` first. Then `S.store = {id, lat, lon}`, `storePicked = true`, `milesAuto = true`, delete `milesBy[brand]`; return `autoMiles` (which takes step 3).
- `setQty(S, index, qty)`: `S.rest` must be profiled, `index` an integer with `0 <= index < rest.menu.length`, and `qty` an integer ≥ 0, else `false`. `qty > 0` sets `cart[String(index)] = qty`; `0` deletes the key. `true`. (`setPath` can't do this: it never creates keys.)
- `pinMiles(S, miles)`: `miles` must be a finite number ≥ 0, else `false`. `S.miles = miles` (as given, not rounded), `milesAuto = false`, `milesSrc = "pinned"`; if `brand` is a string, `milesBy[brand] = miles`; `applyMinutes`; `true`.
- `unpinMiles(S, D, opts)`: `milesAuto = true`; delete `milesBy[brand]`; return `autoMiles`.
- `toggleCard(S, D, cardId, on, now)`: `cardId` must be a card id in `D.CARDS`, else `false`. `on` true appends it (if absent); false removes it. `syncCredits`; `true`.
- `setOptIn(S, D, key, on, now)`: `key` must be a string; `on` sets `creditOptIn[key] = true`, otherwise deletes it; `syncCredits`; `true`.
- `markUsed(S, D, key, used, now)`: `key` must be the key of an entry in `S.credits` and `periodOf(its cadence, now)` non-null, else `false`. `used` sets `usedIn[key]` to that period id; otherwise deletes it. `syncCredits`; `true`.
- `removeManualCredit(S, D, key, now)`: removes the manual credit with that key (else `false`), deletes `usedIn[key]` and `creditOptIn[key]`, `syncCredits`, `true`.

## 7. Is the engine ready? `missing`, `appMissing`, `forEngine`

D-032: a default an app doesn't publish starts empty (`null`). The page asks the user for it, and **that app is left out of the comparison until it's filled**; the rest of the page still prices.

`missing(S)`: the shared inputs. When it isn't `[]`, nothing is priced. Paths in this order, each at most once:

1. `"rest"` when `S.rest` is null.
2. `"tax"` unless a finite number ≥ 0.
3. `"fuel"` unless one of `regular`, `premium`, `diesel`, `ev`. For `ev`: `"miPerKwh"` unless finite > 0, `"kwh"` unless finite ≥ 0. Otherwise: `"mpg"` unless finite > 0, `"gas"` unless finite ≥ 0.
4. `"miles"`, `"minutes"`, `"wear"`, `"hourly"`, `"tipDel"`, `"tipPick"`: each unless a finite number ≥ 0.
5. `"manualSubtotal"` (finite ≥ 0) when `S.rest` exists and isn't profiled.

`appMissing(S, p)`: for `p` in `APPS`, the paths `"plats.p.markup"`, `"plats.p.delFee"`, `"plats.p.svc"`, `"plats.p.svcMin"`, `"plats.p.memberSvc"`, `"plats.p.memberMin"`, `"plats.p.pickDisc"`, then the shared app-delivery fees `"regFee"`, `"smallMin"`, `"smallFee"`, each unless a finite number ≥ 0, in that order. Any other `p` gives `[]`.

`forEngine(S)`: `null` when `missing(S)` isn't `[]`. Otherwise a **deep copy** of `S` (sharing nothing with it) in which, for every app `p` whose `plats[p].on` is `true` and whose `appMissing(S, p)` isn't `[]`:
- if that list contains `"plats.p.markup"` or `"plats.p.pickDisc"` (the **pickup inputs**: app pickup can't be priced without them), `plats[p].on = false`;
- otherwise (only **delivery inputs** are missing: `delFee`, `svc`, `svcMin`, `memberSvc`, `memberMin`, `regFee`, `smallMin`, `smallFee`), `plats[p].noDelivery = true`: the engine leaves out `p-d` and still prices `p-p` (engine contract §3, D-033).

The page passes this copy to `POD.engine.allResults` and lists each app that lost a channel with what it's missing. `S` itself is never changed, so the user's own on/off switch survives. `noDelivery` exists only on this copy: `fresh` has no such field, `setPath` can't create it, `save` never writes it and `load` drops it.

A missing `pickDisc` switches the whole app off, delivery included, although delivery never reads it: the engine has no pickup-only switch. That leaves a channel out (never misprices it), and `pickDisc` has a sourced default of 0 (D-032), so it's empty only when the user clears it.

*Amended 2026-11-14 (D-033):* this used to switch the whole app off when any of its fees was missing, so under D-032's empty delivery fees no app pickup was priced either.

## 8. Persistence

The key is `POD.STORAGE_KEY` (`"pod.v5"`, D-010). `storage` is any object with `getItem`/`setItem` (in the app, `window.localStorage`).

**The user fields** (everything else is derived and never saved): `address`, `pos` (only when `src` is `"gps"`), `make`, `model`, `fuel`, `mpg`, `miPerKwh`, `kwh`, `brand`, `store`, `storePicked`, `cart`, `manualSubtotal`, `dealOn`, `miles`, `speed`, `milesAuto`, `milesBy`, `tipDel`, `tipPick`, `wear`, `hourly`, `regFee`, `smallMin`, `smallFee`, `cards`, `creditOptIn`, `usedIn`, `manualCredits`, `plats` (per app: `on`, `delFee`, `svc`, `svcMin`, `memberSvc`, `memberMin`, `pickDisc`, `memberOwn`, `cardMember`; `direct.on`), `promos`.

- `save(S, storage)`: `storage.setItem(key, JSON.stringify(those fields))` inside try/catch. `pos` is written only when it's a GPS position; otherwise the key is left out. `plats` is written with only the fields listed above (never `markup` or `member`). `true` on success; `false` if anything throws or `storage` has no `setItem`.
- `load(storage, D, now, opts)`: `S = fresh(D)`. Read `storage.getItem(key)` and `JSON.parse` it inside try/catch; if anything throws, the value isn't a string, or the parse isn't an object, use `{}`. Then **merge field by field**: a saved field replaces the fresh one only when it has the right type, else the fresh value stays:
  - strings: `address`, `make`, `model`; `brand` a string or `null`; `fuel` one of the four.
  - numbers (finite, ≥ 0): `mpg`, `miPerKwh`, `kwh`, `manualSubtotal`, `miles`, `tipDel`, `tipPick`, `wear`, `hourly`, `regFee`, `smallMin`, `smallFee`; `speed` > 0. (`mpg`, `miPerKwh` and `miles` may also be `null`.)
  - booleans: `dealOn`, `milesAuto`, `storePicked`.
  - `pos`: `{lat, lon, src: "gps"}` with a valid position. `store`: `{id: string, lat, lon}` with finite numbers (or `null`).
  - `cart`: an object; keep each key that is a canonical non-negative integer (`"0"`, `"12"`) with an integer value ≥ 0. `milesBy`: keep string keys with finite numbers ≥ 0. `creditOptIn`: keep keys whose value is `true`. `usedIn`: keep keys whose value is a string.
  - `cards`: an array; keep the strings. `manualCredits`: an array; keep each entry `addManualCredit` would accept that also has a `key` matching `/^manual\.[1-9][0-9]{0,8}$/` (at most 9 digits, so the next key stays an exact integer), the first one with a given key only, stored as `addManualCredit` stores it (`{key, name, amount, cadence, plats, modes?}`, `cadence` defaulting to `"once"`, nothing else).
  - `plats`: per app and field as in `fresh`: numbers finite ≥ 0, booleans boolean (`markup` and `member` are derived and never loaded). `promos`: per app **and field**: `type` one of `none`, `percent`, `dollar`, `freedel`; `value`, `cap`, `min` finite ≥ 0. A bad field falls back alone (a bad `type` with a good `value` gives `{type: "none", value: …}`).
  - Unknown fields and unknown apps are dropped.
  Then `derive(S, D, now, opts)`. `load` never throws and never writes to `storage`. A storage that throws on every call gives exactly `derive(fresh(D))`.

## 9. What this leaves to later phases

- Event wiring, `data-bind`, rendering, tile loading and geolocation: Phase 5 (`app.js`, `render.js`). The page calls `save` after each change and runs `derive` again when tiles arrive.
- Which defaults to show when `missing(S)` isn't empty (and a first-visit example): Phase 5.
- Per-item markup: Phase 6.
