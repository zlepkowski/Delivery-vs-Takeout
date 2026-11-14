---
name: frontend
description: Code rules for the Pickup or Delivery browser app. Covers the ES5 file pattern, state, binding and render conventions, the pricing engine's order of operations, the location-based restaurant model, and the BUILD.md §9 traps. Load before writing or changing anything under src/ or index.html.
---

# Frontend rules: Pickup or Delivery

The spec is `docs/BUILD.md`. Where this skill and the spec differ, this skill wins: it carries the v5 decisions in `docs/decisions.md`.

## Where things live

| File | Namespace | Holds |
|---|---|---|
| `src/js/pod.js` | `POD`, `POD.util` | namespace, `round2`, `money`, `clamp` |
| `src/data/*.js` | `POD.data.*` | reference tables (written by researcher or orchestrator, not by you) |
| `src/js/engine.js` | `POD.engine` | `calc`, `allResults`, `cartInfo`, `perMile`, `CHANNELS`. **Pure** |
| `src/js/geo.js` | `POD.geo` | ZIP unpacking, `zipByCode`, `nearestZip`, `zipSpacing`, `estimateMiles`, `tripMiles`, tile cells and paths, `storesNear`, `nearestStore`. Pure. The spec is `docs/geo-contract.md` (D-030), which overrides BUILD.md §8 |
| `src/js/state.js` | `POD.state` | `fresh`, `load`, `save`, `setPath`, `getPath`, `apply*`, `syncCredits` |
| `src/js/render.js` | `POD.ui` | `render(ctx)`, the one function that writes the DOM. `ctx = {S, D, opts, view, now}`; holds no state (ui-contract.md, D-035) |
| `src/js/insights.js` | `POD.insights` | `build(F, R, now)` → `[{id, label, cls, text, data}]`: plain text and numbers, no HTML. Escape `text` once, in render (insights-contract.md, D-034) |
| `src/js/links.js` | `POD.links` | deep-link builders (Phase 9) |
| `src/js/api.js` | `POD.api` | optional backend seam (Phase 8) |
| `src/js/app.js` | `POD.boot` | event delegation + boot. Loaded last |

## File pattern (every file in src/js and src/data)

```js
/* one-line purpose. For data files, the provenance header (data-research skill). */
(function (root) {
  "use strict";
  var POD = root.POD;            // pod.js created it; it loads first
  // ... private functions ...
  POD.engine = { calc: calc, allResults: allResults };
})(typeof window !== "undefined" ? window : this);
```

- **Never create bare globals.** Everything hangs off `POD`.
- **No DOM at load time.** Only `app.js` touches `document`, and only after `DOMContentLoaded`. Tests load every file in a VM with no `document`; a top-level DOM access fails the suite.
- **Load order lives in one place:** the `<script>` tags in `index.html`. Add a new file there; `tests/helpers/load.js` reads the same list.

## ES5 only (§3)

The gate (`npm run test:es5`) rejects newer **syntax**: `let`/`const`, arrow functions, template literals, classes, destructuring, spread/rest, default params, `for…of`, shorthand properties, computed keys, trailing commas in calls.

The gate does **not** catch newer **APIs**. Don't use `Array.prototype.includes/find/findIndex/fill`, `Object.assign/values/entries`, `String.prototype.includes/startsWith/padStart/repeat`, `Map`, `Set`, `Symbol`, `Number.isFinite/isNaN`. Use `indexOf`, loops, `for (k in o) if (o.hasOwnProperty(k))`, and `isFinite`. The exceptions are browser APIs that have no ES5 version (`fetch`, `Promise`, `navigator.geolocation`): **feature-detect** them and keep a working fallback.

## State, binding, events (§3, §5)

- **One state object.** `POD.S`, created by `POD.state.fresh()` and merged with saved data by `load()`.
- **Two-way binding:** `data-bind="path.to.field"`. `setPath`/`getPath` walk dotted paths. Values parse as numbers unless the element has `data-type="text"`.
- **Three document-level listeners** (`input`, `change`, `click`) in `app.js`. They dispatch on `data-bind` and `data-action`. Adding a control means adding markup, never another listener.
- **Derived fields change only through the `apply*()` functions**, in the order of the §5 derivation table. Setting `S.tax` or `S.gas` by hand is a bug.
- **`syncCredits()` is destructive by design.** It rebuilds `S.credits` from `S.cards` and must carry over three things: `used` flags, `manual: true` credits, and `S.creditOptIn`. Any new per-credit user state must be carried over explicitly too.
- **Persistence:** `localStorage[POD.STORAGE_KEY]` (`pod.v5`). **Every** storage access goes in `try/catch`, and the page must render with storage throwing. `load()` merges over `fresh()`, so adding a field is safe. Bump the key only for an incompatible change.

## Render

- `POD.ui.render(ctx)` **writes only the blocks whose HTML changed**, and is idempotent. Never replace the whole page: a full replace removed the button under the pointer when a text box committed on mousedown, so the click was lost (5f60686, 2f657df; ui-contract amendment). Restore focus by element `id` (D-035).
- **Escape** every string from data or user input before it goes into `innerHTML` (`POD.util.esc`, added in Phase 5).
- A block re-render (`isBlock`) that replaces a container holding a control the user clicks right after typing loses that click. Patch the sub-block: `.app-settings` and `.fields` are blocks too (3502730, b45868b).
- Format money only with `POD.util.money`. Negative receipt lines render green, and `0` renders as "waived".
- A box commits on `change`. An empty or unparsable number box is `null`, so the page asks for it; a typed `0` is a real value (D-035; the manualSubtotal 0 BLOCKED report, 2f657df).
- A sticky panel needs `max-height` and `overflow-y: auto`. The sticky results card clipped the fee inputs until screenshots were reviewed (5f60686).

## The engine (§4): the order is load-bearing

The exact definition is `docs/engine-contract.md` (D-029), which overrides BUILD.md §4 where they differ. Implement from it.

`POD.engine.calc(S, channelId, override)` is **pure**. It reads only its arguments: no `POD.S`, no DOM, no `new Date()` (pass dates in). The convenience wrapper `POD.calc(ch, o)` supplies `POD.S`.

| # | Step | Rule |
|---|---|---|
| 1 | Direct-only deal | Only for `plat === "direct"`, and only when the cart has `deal.minItems` flagged items. Produces `dealSub` |
| 2 | Markup | Menu entries are objects `{name, price, dealItem, markup?}`. App food for a profiled brand is `round2(Σ price × qty × (1 + markup_i/100))` over the cart lines in menu-index order, rounded once. `markup_i` is the item's own `markup[p]` when a finite number ≥ 0, else the app's markup. Direct is 0%. Unprofiled: `round2(subtotal × (1 + markup/100))` (D-036, engine-contract §5.2) |
| 3 | Fees | delivery, service (% with a `svcMin` floor), `directSvc` (a restaurant fee on the direct modes it lists), small-order (`food < smallMin`) and regulatory (both app delivery only). A membership (`food >= memberMin`, the app's own threshold, not a fixed $12) zeroes delivery and swaps `svc` → `memberSvc` |
| 4 | Subtotal discounts | promo (`percent` with cap / `dollar` / `freedel` / `bogo`: `floor(qty/2)` of `promos[p].item` at its marked-up price, capped) + pickup discount. **Clamped jointly to ≤ food** |
| 5 | Tax | `(food − disc) × tax%`, on the **discounted** subtotal, except that a `freedel` promo doesn't lower taxable food (contract §5.5) |
| 6 | Tip | on the **pre-discount** subtotal. Separate rates for delivery and pickup |
| 7 | Drive | pickup only: `miles × (fuel/mpg + wear)`, or `miles ÷ miPerKwh × kwh` for an EV, + `hourly × minutes/60` |
| 8 | Credits | flat, last, clamped to `gross − disc` |

`gross = food + fees + tax + tip + drive`. `net = max(gross − disc − credit, 0)`.

**Rounding (decision D-012):** round each component to the cent with `POD.util.round2` when it's computed, the way a receipt does. `gross` and `net` are sums of rounded components. The Python oracle does the same, so the two must match exactly.

The return shape is in §4.3. `lines` ends with `["TOTAL", net]`. The `override` argument (`cart`, `manualSubtotal`, `miles`, `minutes`) exists for counterfactuals: never mutate `S` or `override` inside `calc`.

## Restaurant model (v5: decisions D-005 and D-006)

- Restaurants come **from the user's location**, not a fixed list. State holds `S.brand` (a brand id) and `S.store` (`{id, lat, lon}`). The trip distance comes from the picked store: straight line × 2 × 1.25, rounded to 0.1 mi (`tripMiles`, geo-contract §6). `estimateMiles()` is only the fallback.
- **Every `POD.geo` function takes the data tables as `D`** (`POD.data` in the app), reads nothing global, and returns `null` on bad input (D-030).
- **Tile loading is the page's job (Phase 5).** `storesNear`/`nearestStore` return `status: "need"` with the cells to load. `app.js` loads each with `tilePath(cell)`, puts a failed load in `opts.failed[cell] = true`, and calls again. A tile from another `BRANDS_RUN` is never reloaded: the result stays `partial`. Tile URLs carry `?v=<BRANDS_RUN>` so a cached tile can't pair with a newer `brands.js`; that query string is checked to load over `file://` (D-035, geo-contract §9).
- **Profiled brands** (`POD.data.PROFILES[brandId]`) have a menu, deal, per-platform markup, `directFee`, the `amexGoldDirect` flag and an optional `directSvc`.
- **Unprofiled brands** use `POD.data.CATEGORY_DEFAULTS[category]`, and the user's `manualSubtotal` as the cart. **Their direct-delivery channel is removed, not priced at $0** (§9.3). Label the numbers as estimates.
- A channel a brand doesn't offer is **left out** of `allResults`, never priced at zero.

## Traps (§9). Read these before touching credits or the engine.

- **9.1** A credit valid at *some* merchants is not valid at *this* one. `restricted` → `plats: []` unless `S.creditOptIn[key]`. `locked` → never applies. Default to not applying.
- **9.2** Promo minimums are tested against the **marked-up** `food`. It's deliberate; don't "fix" it.
- **9.3** Never use a $0 fee to mean "this route doesn't exist." Remove the route.
- **9.4** Tip is on the **pre-discount** subtotal. Moving it shifts the rankings.
- **9.5** `STATES` and `CAR_DATA` are **positional arrays**. `PROFILES`, `BRANDS`, `CARDS` and `CATEGORY_DEFAULTS` are **objects**. Check which one you're iterating.

## Verify before reporting DONE

- Always: `npm run test:es5 && npm run test:unit`
- UI or `app.js` changes: also `npm run test:e2e`
- Engine or geo changes (Phase 2 and 3 on): also `npm run test:oracle`

## Learned rules

<!-- The reflector adds rules here. Each one cites its evidence. -->
- **Never put a neutral number in a code fallback.** A missing table value makes the brand unpriceable (`null`). `restFor` gave `markup {}` (0%) for a missing category, so the apps looked cheaper (ba25e38, c4e21c4).
- **A malformed optional input has no effect; it never throws.** A `directSvc` with no `modes` took down `allResults`, and a deal with no `scope` silently never applied. Guard each optional field (793577b, c4e21c4).
- **Return copies, never references, and key every memo cache by the table it came from.** `restFor` shared `directSvc.modes` with `D` until it deep-copied (c4e21c4). A global spacing cache answered from another table, caught only by a file-order test (97ce6fe, c8e1e5c).
- **When an input changes, clear every derived field it feeds unless the same call recomputes it; never keep the old value.** Switching brand, moving or unpinning while tiles loaded kept the old trip and priced the new brand (9a17357). Every unsaved derived field must be set by `derive` on every branch, including after a reload of a pinned trip, where `milesSrc` came back `null` (5cbada0). A field that is derived in one mode and typed in another is cleared when the mode switches: a listed car changed to "Other" kept Camry's 46 mpg, so the page priced the old car silently (e705a87, D-031 amendment).
- **Every module that reads credits applies the §9.1 tier itself, not only `calc`.** Wallet and the Timing insight would have counted a restricted gold-partner credit as working direct until it was gated (f10e69f; progress.md Phase 5 review).
- **Setters that take a value accept plain values only (null, boolean, string, finite number).** Never store or copy an object the caller still owns: `setPath` deep-copied any value, and a cycle overflowed the stack (9a17357, D-031 amendment).
- **Report an issue in your report; never append to `docs/issues.md` unless your card's SCOPE lists it.** The builder appended ISS-031 under an ID already in use, and the orchestrator reverted it (Phase 4 review). Phase 1 had the same slip.
- **A DONE WHEN that `deepStrictEqual`s `loadApp()`/`loadData()` output is a card bug: report BLOCKED with that diagnosis and don't edit the test** (ISS-008: c4e21c4, a5b725d). The copy rule is in test-runner.
- **Work in the stored ×1000 integers: identify a point by its integer key, and range-check every parsed coordinate.** A 400-digit field parsed to `Infinity` and became a phantom store at `mi: null` that displaced the real nearest store. Own-point detection by a float distance of 0 was also wrong (197acd1, the geo.js should-fix and contract review). Bad coordinates are skipped or give `null`, never a result.
- **Implement the engine from `docs/engine-contract.md` alone; don't open `tests/oracle/`.** The differential test only means something if the engine wasn't written from the oracle. The Phase 2 builder didn't read it and all 500 scenarios matched (be9e129).
- **A defensive guard the contract doesn't name is a contract gap: list it under ASSUMPTIONS, naming the input and what the code does with it,** so the orchestrator writes it into the contract and the oracle (you can't edit either). The Phase 6 engine skipped a non-number quantity and a non-object menu entry; the ASSUMPTIONS line was the only trace, and the oracle would have thrown on both (f3af8a8).
- **An insight's promise must hold in its counterfactual, not only its trigger.** Minimum offered "Adding 1 × Coke … $6.24 more" for a BOGO whose minimum frees nothing. A `bogo` candidate counts only when the counterfactual has a "BOGO: " note (insights-contract §3.4, d5c7f2e).
- **A new note or control inside a grid takes a whole row, and is checked at desktop width in every state (unprofiled too).** An unprofiled BOGO note took one cell and shifted every promo label off its input; screenshot review caught it, not a test (0f907b5). Phase 5 had the same class.
