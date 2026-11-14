# Decisions

Where these differ from `BUILD.md` (the v4 spec), **these win**. Each entry has a stable ID, so code, tests and skills can cite it.

Format: **D-nnn — Title** · date · *status*, then the decision, then why.

---

**D-001 — Rebuild from the spec, not a port** · 2026-11-11 · *accepted*
Only BUILD.md was available; the v4 `index.html`/`data.js` were not. All data gets re-researched. The v4 receipts ($15.62 / $52.13) won't be reproduced. New receipts are worked out by hand from the new data, with the arithmetic shown, in `tests/fixtures/receipts/`.

**D-002 — Repo layout** · 2026-11-11 · *superseded by D-018*
The app lives in `pickup-or-delivery/`. `.claude/` and `CLAUDE.md` sit at the repo root, because sessions start there and agents and skills load from there. Pointscanner, at the root, stays frozen.

**D-003 — Hosting on GitHub Pages** · 2026-11-11 · *superseded by D-018*
The existing `pages.yml` deploys the repo root, so the app is served at `/test/pickup-or-delivery/` once merged to `main`. Opening `index.html` from `file://` must still work.

**D-004 — Static-first, optional backend later** · 2026-11-11 · *accepted*
Phase A ships with no server: store data, VIN lookup through NHTSA from the browser, and a gas refresh in CI. A Cloudflare Worker (Phase 8) sits behind the `estimateMiles` / `api.js` seam and is used only when it's configured. With the Worker off, the site behaves identically.

**D-005 — Restaurants come from the user's location, not a fixed list** · 2026-11-11 · *accepted*
All The Places store data is split into 1° grid tiles. The page loads the tiles around the user and lists the food brands nearby, sorted by distance, widening the radius 5 → 10 → 25 → 50 mi until there are about 15 results. Picking a store sets the trip distance from that store (straight line × 2 × 1.25). The §8 density estimator becomes a fallback. Chains only until the Phase 8 Worker adds independents.
*Why:* the user asked for it, and it fixes the rural under-estimate (Big Timber: estimated 9 mi vs ~33 mi real).

**D-006 — Profiled and unprofiled brands** · 2026-11-11 · *accepted*
**Profiled** brands get a full menu, deal, per-platform markup and the Amex Gold flag. **Unprofiled** brands use category defaults and the user-entered cart total, and are labeled as estimates. Unprofiled brands get **no direct-delivery channel**, per §9.3 (remove the route; never price it at $0). The 12 v4-style chains become the first profiles. They're chosen from the store data by how often a brand is nearby across the US, weighted toward chains with direct-only deals.

**D-007 — Keep ES5, no framework, no runtime dependencies** · 2026-11-11 · *accepted*
GitHub Pages removes the CSP reason in §10, but we keep the §3 conventions for portability and `file://` support. Dev-only dependencies are pinned: `acorn` (the ES5 syntax gate) and `playwright@1.63.0` (it matches the preinstalled browser in cloud sessions).

**D-008 — The `POD` namespace and an explicit-state `calc`** · 2026-11-11 · *accepted*
All code and data attach to one `POD` global, replacing v4's bare globals. `POD.engine.calc(S, channel, override)` takes state as an argument, so it can be tested in Node. `POD.calc(channel, override)` is the convenience wrapper that supplies `POD.S`.

**D-009 — Drop dead code** · 2026-11-11 · *accepted*
`ZIP3` and the `STATES` lat/lon columns (indices 4–5) are not rebuilt (§6 marks them dead).

**D-010 — Storage key `pod.v5`** · 2026-11-11 · *accepted*
A new implementation, so a new key. Bump it on any incompatible state change.

**D-011 — Store tiles are built at deploy time, not committed** · 2026-11-11 · *accepted*
They're a few MB across about 1,000 files, and weekly commits would bloat git. The Pages workflow runs `tools/build-stores.py` before uploading, on a weekly schedule. Locally, run the script once; without tiles the page falls back to the estimator. A few fixture tiles are committed for tests.

**D-012 — Rounding per component** · 2026-11-11 · *accepted*
Each receipt component (food, each fee, tax, tip, drive, each discount, credit) is rounded to the cent with `round2` when it's computed. `gross` and `net` are sums of the rounded components. The Python oracle does the same, so the two match exactly.
*Why:* that's how a real receipt works, and it makes the differential test exact.

**D-013 — The orchestrator owns card credits** · 2026-11-11 · *accepted*
`src/data/cards.js` is researched and written by the orchestrator, not a Haiku worker. Every credit records its tier (universal / restricted / locked), source URL and as-of date. When unsure, it's `restricted` (§9.1).

**D-014 — Agent roster** · 2026-11-11 · *accepted*
Six Haiku workers, each preloading one skill: builder→frontend, api-builder→backend, researcher→data-research, tester→test-runner, reviewer→code-review, reflector→reflect. api-builder and researcher were added beyond the original sketch so that "one skill per agent" still holds. Workers never commit. The orchestrator re-runs every check.

**D-015 — Auto-compact at 60%** · 2026-11-11 · *accepted, applied 2026-11-12 (ISS-006 closed)*
`.claude/settings.json` sets `env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = "60"`. Environment variables are read at session start, so a session picks it up only after it's committed. That's one reason to start a fresh session at each phase boundary.

**D-016 — Deep links don't pre-fill carts** · 2026-11-11 · *accepted*
DoorDash, Uber Eats and Grubhub don't publicly support links that pre-build a cart. Links go to the chain's store page or a search; direct links go to the restaurant's order page. BUILD.md §11 Phase E gets corrected in Phase 10.

**D-017 — Test harness** · 2026-11-11 · *accepted*
- Unit tests run the real `src/` scripts in a DOM-less `vm`, in the order `index.html` lists them (`tests/helpers/load.js`). One source of truth for load order, and no test-only exports.
- e2e uses Playwright over `file://` at phone (390×844) and desktop (1280×800) widths, and fails on any console error.
- The oracle is Python standard library only.

**D-018 — Its own repo, with the app at the root** · 2026-11-12 · *accepted*
The project moved from `zlepkowski/test` to `zlepkowski/Delivery-vs-Takeout`, a repo of its own. The app lives at the repo root, next to `.claude/` and `CLAUDE.md`; there's no `pickup-or-delivery/` folder. `main` starts at the Phase 0 scaffold, and work happens on `claude/sharp-heisenberg-tbo63x` and merges by PR when the user asks. GitHub Pages will serve the app at `/Delivery-vs-Takeout/` from `main`. This repo has no Pages workflow yet: Phase 1 adds one together with the store-tile build step (D-011), and the user turns Pages on (Settings → Pages → Source: GitHub Actions). Opening `index.html` from `file://` must still work.
*Why:* the subfolder existed only because the old repo also held Pointscanner.

**D-019 — Dispatching workers when the named agents aren't loaded** · 2026-11-12 · *accepted*
Agents in `.claude/agents/` load only at session start, so a session that began before they existed can't call `builder`, `researcher` and the rest by name. In that case the orchestrator dispatches a `general-purpose` agent with `model: haiku`, tells it to read its agent file and skill first, and gives it the task card. The rules, the report format and the orchestrator's re-verification are unchanged. A fresh session calls them by name.

**D-020 — All The Places data is CC-0, so the tiles can be published** · 2026-11-12 · *accepted*
The ATP README (`raw.githubusercontent.com/alltheplaces/alltheplaces/master/README.md`, "License", read 2026-11-12) says the data its spiders generate is released under the Creative Commons CC-0 waiver. The spider code is MIT. Publishing derived store coordinates on Pages is allowed. Credit ATP in the `brands.js` provenance header and on the page anyway. Closes ISS-002.
*Also found:* the latest run (`2026-10-31-13-32-34`, from `data.alltheplaces.xyz/runs/latest.json`) is one 2.9 GB `output.zip` covering 5,781 spiders worldwide. The host answers HTTP `Range` requests (206), so `tools/build-stores.py` should read the zip's central directory by range and download only the members it needs, not the whole file.

**D-021 — Store data: selection, brands and the tile format** · 2026-11-12 · *accepted*
Finalizes the store-tile proposal in the data-research skill. Where they differ, this wins.
- **Run.** `tools/build-stores.py --run <run_id|latest>`. `latest` resolves through `https://data.alltheplaces.xyz/runs/latest.json`. The run id is recorded in every output.
- **Download only what's needed.** Read `output.zip` through HTTP `Range` requests: `zipfile.ZipFile` over a small seekable reader object whose `read()` issues ranged GETs. The central directory takes about 3 requests. Downloaded members are cached in a `--cache` directory outside the repo.
- **Which brands are restaurants.** A `brand:wikidata` is a food brand if it appears in the Name Suggestion Index files `data/brands/amenity/{fast_food,restaurant,cafe,ice_cream}.json` (`raw.githubusercontent.com/osmlab/name-suggestion-index/<ref>/…`, `--nsi-ref`, default `main`).
- **Which members.** The run's `stats/_insights.json` lists, per Wikidata ID, the spiders holding its stores in each country (`atp_splits.US`). Download the union of the US spiders for the food brands only. That was 339 members for 338 brands in run `2026-10-31-13-32-34`.
- **Which features.** `amenity` ∈ {fast_food, restaurant, cafe, ice_cream}; `brand:wikidata` in the food set; in the US (`addr:country` = `US`, or no `addr:country` and the spider name ends in `_us`); valid coordinates. Dedupe on (brand, lat×1000, lon×1000), rounded half away from zero. A brand is its `brand:wikidata`, so two spiders for one brand merge.
- **Fixture cells with no stores** get no file and no `TILE_INDEX` entry.
- **Brands kept:** at least 25 deduped US stores.
- **Brand name:** the most common `brand` property among the brand's kept US features; ties go to the alphabetically first.
- **Brand id:** that name lowercased, `&` → `and`, apostrophes dropped, every other run of non-alphanumerics → `_`, trimmed of `_`. On a collision, the brand with fewer stores gets `_` + its lowercased Wikidata ID appended; on an exact tie, every tied brand gets it. (In run `2026-10-31-13-32-34` the only collisions are taco_bell vs Q111972226 and taco_time vs Q7673970, neither a tie.)
- **Category:** from the first `;`-separated token of `cuisine`. pizza → `pizza`; burger → `burger`; chicken, wings, fried_chicken → `chicken`; mexican, tex-mex, tacos, burrito → `mexican`; sandwich, sub, deli, bagel → `sandwich`; chinese, japanese, asian, sushi, thai, korean, vietnamese, indian, ramen, noodle → `asian`; coffee_shop, coffee, donut, tea, bubble_tea → `coffee`; ice_cream, frozen_yogurt, dessert, cake, cookies, juice, smoothie → `dessert`. With no match it falls back on `amenity`: restaurant → `casual`, cafe → `coffee`, ice_cream → `dessert`, fast_food → `other`. A brand's category is its most common store category; ties go to the alphabetically first. The 10 categories are the keys `categories.js` must cover.
- **`brands.js`** assigns:
  - `POD.data.BRANDS = { id: {name, category, wikidata, stores} }`. `profiled` is **not** stored: the page derives it from `POD.data.PROFILES`, so the generator doesn't depend on profiles.
  - `POD.data.BRAND_IDS`: the ids, sorted. Tiles index into it.
  - `POD.data.BRANDS_RUN`: the run id.
  - `POD.data.TILE_INDEX = { cell: storeCount }` for every tile the run produced.
- **Tiles.** Cell = `floor(la/1000)_floor(lo/1000)` of the stored ×1000 integers, e.g. `40_-74`, so every record sits inside its own cell. *Amended 2026-11-12:* this was "floor of the float degrees". The two rules disagree for 194 stores within 0.0005° of a cell edge, and the integer rule keeps tiles self-consistent. **The geography lookup (Phase 3) must load every cell the search circle touches, never only the user's own cell**, so an edge store is always found. File `<tiles-out>/<cell>.js`: a provenance comment, then the ES5 wrapper assigning `POD.data.TILES["<cell>"] = { run: "<run_id>", s: "b,la,lo;b,la,lo;…" }`, creating `POD.data.TILES` if absent. `b` indexes `BRAND_IDS`; `la`/`lo` are ×1000 integers. Records sorted by (b, la, lo) and unique. Store id = `<brandId>@<la>,<lo>`.
- **Fixtures** (`--cells … --tiles-out tests/fixtures/stores`): NYC `40_-74` and `40_-75`; around Big Timber, MT, `45_-111`, `45_-110`, `45_-109`, `46_-111`, `46_-110`, `46_-109`. The committed `brands.js` and the fixtures come from the same run.
- **Deploy (D-011):** the Pages workflow regenerates `brands.js` *and* the tiles together, so the indexes always match.
*Why:* 24 MB of downloads instead of 2.9 GB (339 members, 223 MB uncompressed, measured 2026-11-12), a brand list grounded in OSM tagging, and tiles that can't drift from the brand index.

**D-022 — Gas prices come from EIA, not AAA** · 2026-11-12 · *accepted*
AAA's site sits behind Cloudflare bot protection. A plain request on 2026-11-12 got "Sorry, you have been blocked", and getting around that isn't acceptable. EIA's weekly retail prices (`www.eia.gov`) are official and free. Where EIA publishes a state series (CA, CO, FL, MA, MN, NY, OH, TX, WA), use it. Every other state uses its PADD region, or the PADD 1 sub-region (1A New England, 1B Central Atlantic, 1C Lower Atlantic), per EIA's own PADD definitions. A comment on each `STATES` row names the series used. `GRADE_ADD` = EIA's U.S. midgrade, premium and diesel averages minus U.S. regular, for the same week. Closes ISS-003: the Phase 7 refresh uses the same source. *Refined 2026-11-12:* PADD 5 states with no series of their own (AK, AZ, HI, NV, OR) use EIA's "West Coast (PADD 5) Except California" series. The plain PADD 5 average is pulled up by California, which is none of them.
*Why:* robustness beats precision here (BUILD.md §1: fuel rarely decides the answer).

**D-023 — Which cars `cars.js` lists** · 2026-11-12 · *accepted*
Source: EPA `https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip`.
- **Models:** every (make, `baseModel`) with at least one record in model year ≥ `--since` (2025 for this build). Use only the records from that model's latest model year.
- **Fuel:** the most common `fuelType1` among those records; ties go Regular > Premium > Diesel > Electricity. Regular or Midgrade Gasoline → no suffix; Premium Gasoline → `*`; Diesel → `d`; Electricity → `e`. Models whose fuel is anything else (hydrogen, natural gas) are dropped.
- **Value:** the median, over those records with that fuel, of `comb08` (gas, diesel), or of `1000 / combE` for electric (mi/kWh × 10). Round half up to an integer.
- **Names:** makes merged case-insensitively (`MINI` / `Mini` → `MINI`). Any `,` `:` `|` in a name becomes a space; whitespace collapsed. Makes and models sorted.
- **Expected:** about 48 makes and 347 models (the spec's v4 figures were ~39 / ~330).

**D-024 — cards.js: which cards, which credits, and the shape** · 2026-11-12 · *accepted*
Researched by the orchestrator on 2026-11-12 from the issuers' own card pages (D-013). Supersedes the spec's "27 cards".
- **Cards (22):**
  - every American Express consumer card with a live page on americanexpress.com (13): Platinum, Gold, Blue Cash Preferred, Blue Cash Everyday, Delta SkyMiles Blue/Gold/Platinum/Reserve, Hilton Honors/Surpass/Aspire, Marriott Bonvoy Bevy/Brilliant. Green, EveryDay, EveryDay Preferred and Cash Magnet now redirect to the card hub, so they're no longer offered and aren't listed.
  - every Chase card whose page lists a DoorDash benefit (7): Sapphire Reserve, Sapphire Preferred, Freedom Unlimited, Freedom Flex, Freedom Rise, DoorDash Rewards Mastercard, Ink Business Preferred.
  - Capital One Venture X and Savor (2). Neither has a food or delivery credit; they're listed so holders can see that.
- **Only food-relevant credits are listed:** dining, restaurant, Resy, OpenTable, Uber Cash, DoorDash promos, Dunkin', and rideshare credits. Rideshare credits are listed as **locked** because people mistake them for Uber Eats money. Hotel, airline, streaming and retail credits are left out. A card with none has `credits: []`.
- **`POD.data.CARDS`** is an ordered array of card objects (display order: Amex, Chase, Capital One). Card ids are unique.
- **Card:** `{ id, issuer, name, url, asOf, membership?, note?, credits: [] }`. `membership` ("dd" | "ue" | "gh") means the card *provides* that platform's membership. A card that only reimburses a membership the user must buy (Platinum's Uber One credit) does **not** set it. The page turns it on by default, and the user can turn it off.
- **Credit:** `{ id, name, amount, cadence, plats, modes?, goldPartner?, restricted?, locked?, source, asOf, note }`.
  - The key for opt-ins and `used` flags is `cardId + "." + creditId`.
  - `amount` is per `cadence` period ("monthly" | "quarterly" | "semiannual" | "annual"), never annualized.
  - **Tier** (§9.1): universal = neither flag; `restricted: true` = applies only after the user opts in; `locked: true` = never applies, and `plats` is `[]`. Never both.
  - A restricted credit's `plats` lists where it would apply after opt-in.
  - **New `modes`:** `["d"]` or `["p"]` limits a credit to delivery or pickup channels of its `plats`; absent means both. The Phase 2 engine and oracle must honor it.
- **When unsure, under-credit:** bonuses with odd timing (Platinum's extra $20 Uber Cash in December) aren't counted. A credit whose pickup eligibility isn't stated is limited to `modes: ["d"]`.
*Why:* the spec's list was v4's. Issuer lineups changed, and listing non-food credits would only add noise to the Locked insight.

**D-025 — Virginia's tax is its combined sales rate** · 2026-11-12 · *accepted*
BUILD.md §6 listed VA among the meal-tax states at 10.5%. Virginia has no statewide meal tax: its meals taxes are levied by counties and cities at different rates, and no primary source for a "typical" local rate was reachable. Per §6's own rule (a state without a meal tax uses the combined sales rate), VA uses the Tax Foundation's published combined state + average local rate, with a note that local meals taxes are not included. All "combined" rows use the Tax Foundation's published combined figure as-is, not a re-added state + local sum. Resolves ISS-009.
*Why:* a sourced number beats a null that breaks every Virginia calculation. Tax is applied the same way on every channel, so understating it barely moves the ranking.

**D-026 — The 12 profiled chains** · 2026-11-12 · *accepted (user confirmed)*
`dominos`, `taco_bell`, `chipotle`, `papa_johns`, `wingstop`, `pizza_hut`, `five_guys`, `buffalo_wild_wings`, `little_caesars`, `the_cheesecake_factory`, `subway`, `dunkin`.
Picked per D-006. "How often a brand is nearby" was measured as the share of the 42,354 US ZIP centroids with a store of that brand within 5 miles (straight line), using run `2026-10-31-13-32-34`'s tiles. Subway 54.9% (#1), Taco Bell 43.9% (#2), Domino's 43.7% (#3), Dunkin' 38.2% (#5), Chipotle 31.8% (#8), Papa Johns 30.2% (#9), Wingstop 27.7% (#14), Pizza Hut 24.8% (#16), Five Guys 23.8% (#18), Buffalo Wild Wings 22.9% (#20), Little Caesars 19.2% (#27), The Cheesecake Factory 7.2% (#63).
Changes from the handoff's list: **Wonder** (not in All The Places) and **McDonald's** (no US stores in this run, ISS-007) are replaced by **Subway** (top coverage, app-only deals) and **Dunkin'** (exercises the Amex Gold Dunkin' credit, a restricted credit). The Cheesecake Factory stays despite low coverage: it's an Amex Gold dining partner and the only sit-down chain in the set. Five Guys, Buffalo Wild Wings and The Cheesecake Factory are the `amexGoldDirect` profiles.

**D-027 — How profiles and category defaults are researched and stored** · 2026-11-12 · *accepted*
- **Inputs are hand-entered JSON with evidence, one file per chain:** `tools/data/profiles/<brandId>.json`, plus `tools/data/categories.json`. `tools/build-profiles.py` validates them and writes `src/data/profiles.js` and `src/data/categories.js`. Parallel researchers never touch the same file, and every number keeps its evidence in the repo.
- **Chain file:**
  - `id` must be a `BRAND_IDS` entry from D-026, and `asOf`.
  - `menu`: 5–10 popular items, each `{name, dealItem, prices: [{zip, state, price, url}]}`, observed at **2–3 stores in different states** on the chain's own ordering site (pickup prices). The generator computes each item's price as the **median** of its observations (even count: mean of the middle two, rounded half up to the cent). It needs ≥ 2 observations from ≥ 2 states.
  - `deal`: `null`, or a published **direct-only** offer `{label, price, minItems, scope, url, terms}`. `price` is per eligible item; `scope` ∈ both / pickup / delivery.
  - `directDelivery`: true or false. When true, `directFee` = `{observed: [{zip, state, fee, url}]}`, and the generator takes the median fee, which must be > 0 (§9.3). If the fee can't be observed, `directDelivery` is false with a note, and an issue is logged. The route is left out, never priced at $0.
  - `platforms`: `{dd|ue|gh: evidence}`, listing only apps with evidence that the chain is on them.
  - `markup`: `{dd, ue, gh}` in percent for the listed platforms, with `source` (a URL) for chain-specific published reporting. Otherwise `{"useCategory": true}`: the generator then fills in the chain's category default from `categories.json` (category from `brands.js`) and marks it `est`.
  - `amexGoldDirect`: true only for five_guys, buffalo_wild_wings and the_cheesecake_factory.
  - `notes`.
- **Output `PROFILES[id]`** (*menu shape amended by D-036: items are `{name, price, dealItem, markup?}`; an input item may carry a sourced per-item `markup`*) = `{ menu: [[name, price, isDealItem]], deal: {label, price, minItems, scope} | null, markup: {dd?, ue?, gh?}, markupEst, directDelivery, directFee?, amexGoldDirect, platforms: [...] }` (§6 shape, keyed by brand id).
- **`categories.json`** holds `{ markup: {dd, ue, gh}, est, reason, sources }` per D-021 category. The generated **`CATEGORY_DEFAULTS[category]`** is just `{ markup: {dd, ue, gh}, est }`: reasons and sources stay in the JSON in the repo, and the sources are also listed in the file header. Estimates are allowed here (data-research skill) when flagged.
- **Browser research rules:** Playwright through the proxy. **No getting around bot protection**: no user-agent spoofing, stealth plugins or CAPTCHA solving. A chain that blocks automated access is reported BLOCKED, for option 2 (prices from the user) or option 3 (unprofiled). Don't create accounts or place orders. Use a public address (e.g. a city hall) to see a store's prices and delivery fee. Don't scrape the delivery apps' menus; platform presence is shown by the chain's own site or a citable statement.
- **Network:** during this research the environment is temporarily **unrestricted** (approved by the user 2026-11-12). Afterwards it goes back to the 16-host list in ISS-001.

**D-028 — Pizza Hut and Five Guys ship unprofiled for now** · 2026-11-12 · *accepted (user confirmed)*
Of the 12 D-026 chains, `pizza_hut` (connection resets and timeouts from this environment over HTTP/2 and HTTP/1.1, ISS-021) and `five_guys` (Cloudflare bot check, ISS-017) can't be researched under D-027's no-workaround rule. They ship as **unprofiled** brands per D-006: category-default markup (est), the user's typed cart total, no direct-delivery channel. `taco_bell` and `papa_johns`, whose earlier failures were transient (502s, ChunkLoadError), get one more research pass; if either is still blocked, it ships unprofiled the same way. All of them stay open issues for a later retry, and D-026's list stays the target.
Consequence: an unprofiled Five Guys has no `amexGoldDirect`, so the Amex Gold dining credit isn't applied to ordering Five Guys direct. That under-credits, the safe direction (§9.1's trap is over-crediting). Buffalo Wild Wings and The Cheesecake Factory still carry the flag. Whether `amexGoldDirect` should become a brand-level flag independent of profiles is a Phase 3 question.
**Retry outcome (same day):** `papa_johns` was profiled (`7af787d`). `taco_bell` stayed blocked: it answers only browser-like user agents, which D-027 rules out working around (ISS-013), so it ships unprofiled. Final Phase 1 set: **9 profiled**, with `taco_bell`, `pizza_hut` and `five_guys` unprofiled.
*Why:* the user chose to retry the two transient failures and not hold Phase 1 for the two hard blocks. Shipping 8–10 sourced profiles beats shipping 12 with guessed numbers.

**D-029 — The engine contract** · 2026-11-12 · *accepted*
[`docs/engine-contract.md`](engine-contract.md) defines `POD.engine` exactly: the inputs, channel availability, every formula in §4.2 order with its rounding, the credit rules and the receipt lines. Both `src/js/engine.js` and the Python oracle implement it, and **where it differs from BUILD.md §4, the contract wins.** Changes go through a decision, and the oracle and receipts change before the engine. Its §7 lists the judgment calls that fill the spec's gaps: app pickup has no fees; small-order and regulatory fees apply to app delivery only; a membership applies at `food >= memberMin`; promos apply to both modes except `freedel`; EVs pay wear; a deal never raises an item's price; the engine enforces the §9.1 credit tiers itself; and a direct-channel service fee `directSvc` is modeled (ISS-031). `calc` reads `S.rest`, a resolved restaurant built by the pure `restFor(brandId, D)`, so the engine never touches `POD.data`.
*Why:* the oracle can only match the JS to the cent if both follow one unambiguous definition. Writing the formulas once, with the order of floating-point operations fixed, makes the differential test exact.

**D-030 — The geography contract** · 2026-11-13 · *accepted*
[`docs/geo-contract.md`](geo-contract.md) defines `POD.geo` exactly, and **where it differs from BUILD.md §8, the contract wins.** `src/js/geo.js` and the Python reference `tests/oracle/geo.py` both implement it, and changes go through a decision, with the reference and fixtures changing before the code. The judgment calls that fill the spec's gaps:
- **Every function takes the data tables as an argument `D`** and reads nothing global, like `restFor(brandId, D)` (D-029). It never throws: bad input gives `null`.
- **`zipSpacing` averages the 6 nearest *distinct* centroid points, not records.** Many ZIPs sit stacked on one coordinate (ISS-032), and counting each would make those spots look like the densest in the country.
- **`storesNear` lists one row per brand (its nearest store)**, sorted by distance then brand id. It widens 5 → 10 → 25 → 50 mi until at least `WANT` = 15 brands are found, and returns every brand within that radius (the UI decides how many to show).
- **Tile loading stays outside `geo.js`.** `storesNear` and `nearestStore` say which cells they still `need`, and the page loads those (Phase 5) and calls again. A cell that fails to load is passed back in `opts.failed` and makes the result `partial`. A tile from another All The Places run is never read, because its brand indexes would point at the wrong brands.
- **The cells for a search are the exact bounding box of the circle** (latitude ± δ, longitude ± asin(sin δ / cos φ)), so every cell the circle touches is loaded (D-021).
- **Distances shown or priced are rounded to 0.1 mi:** a trip is `round1(straight × 2 × 1.25)`, and the estimator's `one` and `round` are rounded the same way. Unrounded distances are kept for sorting.
*Why:* the same reason as D-029. An independent reference can only check the code if both follow one exact definition, and pure functions with `D` passed in can be tested on small hand-worked tables.

**D-031 — The state contract** · 2026-11-13 · *accepted*
[`docs/state-contract.md`](state-contract.md) defines `POD.state` exactly: the fields of `S`, the derivation cascade (`applyCar` → `applyState`, `applyAddress`, `applyBrand`, `autoMiles`, `syncCredits`, all run by `derive`), the user actions that reset things (`setBrand` empties the cart, `pinMiles`/`unpinMiles`, `pickStore`), the wallet, and persistence. Where it differs from BUILD.md §3/§5, the contract wins. The judgment calls:
- **Functions read only their arguments** (`D`, `now`, `storage`) and mutate only `S`, so they run in Node with a fake clock and a throwing storage.
- **`derive` never resets a user field**, so `load` = merge the saved user fields over `fresh`, then `derive`. Derived fields (`rest`, `tax`, `gas`, `credits`, `member`, `markup`) are never saved, so a data refresh can't leave stale copies behind.
- **A used flag belongs to a period** (`usedIn[key] = "2026-11"`), so it resets by itself when the month, quarter or half-year turns.
- **Restricted and locked credits get `plats: []` in `syncCredits`** (unless opted in), and the engine checks the tiers again (§9.1, defence in depth).
- **A card's membership turns the app's membership on**, and the user can turn that off (`cardMember`) or say they pay for it (`memberOwn`), per D-024.
- **The ZIP is the last 5-digit run in the address**, so a 5-digit house number doesn't win.
- **A picked store survives a reload** (`storePicked`); the trip is then re-measured from wherever the user is.
- **`autoMiles` never invents a distance while tiles load**: it reports `need` and clears the trip (`miles`, `minutes`, `milesSrc`, `store` → `null`), so `missing(S)` holds the page back until the tiles arrive.
*Amended 2026-11-13 after review of 4.3:* `need` used to "leave `miles` alone". That kept the **previous brand's** distance (or the previous address's, or an unpinned pin), and the page would have priced the new brand at it. Also: `setPath` takes only plain values (null, boolean, string, finite number), so `S` never holds an object the caller still owns and a cyclic value can't overflow the copy. `pickStore` refuses a store whose `id` isn't `brand + "@…"`. Manual-credit keys have at most 9 digits, so `n + 1` never turns into `1e+21`.
*Why:* the same reason as D-029 and D-030. Hand-worked scenarios can only test the cascade if every rule is written down once.

**D-032 — Default values: official numbers only** · 2026-11-13 · *accepted (user decision)*
`src/data/defaults.js` (generated by `tools/build-defaults.py` from `tools/data/defaults-platforms.json` and `tools/data/defaults-trip.json`) holds the values `fresh()` starts with. The user chose **official numbers only** for the delivery apps' fees: a fee an app doesn't publish (on a page readable from here) is `null`, the page asks the user for it, and **that app is left out of the comparison until it's filled in** (`forEngine`, state contract §7). On 2026-11-13 that leaves DoorDash with 15% service, 5% with DashPass and a $12 DashPass minimum (published for markets not yet on DoorDash's new fee model; the page must say so) and every app's delivery fee empty. Uber Eats' only readable page was a grocery guide, so none of its values are used. Other defaults:
- Wear $0.1104/mi (AAA Your Driving Costs 2025), home electricity $0.1816/kWh (EIA Table 5.6.A, Aug 2026), speed 27 mph (FHWA NHTS 2022 Table 7-4: private-vehicle commute speed 26.59 mph, `est` because a commute stands in for an errand).
- **Tips 15% delivery, 0% pickup: the user's product choice**, since no reachable page states a typical tip (ISS-033).
- **Pickup discount 0**: no standing app pickup discount is assumed; promos are entered by the user. That's the conservative direction (it never makes an app look cheaper).
*Why:* the user preferred empty fields the user fills to estimates the page would have to label. Switching an app's defaults to labeled estimates later is a change to the evidence files only (ISS-034).

**D-033 — App pickup is priced without the app's delivery fees** · 2026-11-14 · *accepted (orchestrator; the open question in state contract §7)*
Under D-032 every app's delivery fee starts empty, and `forEngine` switched a whole app off when any fee was missing, so the first screen priced no app at all, not even app pickup, which reads none of those fees (engine contract §7: app pickup has no fees). Now:
- **Engine contract §3:** an app's delivery channel `p-d` is also unavailable when `S.plats[p].noDelivery === true` (a missing value is false, as for every boolean). Pickup `p-p` is unaffected.
- **State contract §7:** `forEngine` switches an app off (`on = false`) only when a **pickup input** is missing (`plats.p.markup`, `plats.p.pickDisc`). When only **delivery inputs** are missing (`delFee`, `svc`, `svcMin`, `memberSvc`, `memberMin`, `regFee`, `smallMin`, `smallFee`), it sets `noDelivery = true` on the copy instead. `noDelivery` lives only on that copy: never in `fresh`, never saved or loaded.
- The oracle, a new receipt (`r13-app-delivery-off`) and the state scenarios changed first; the fuzzer now sets `noDelivery` on 15% of apps.
*Why:* it's the smallest change that lets the page price everything the user has given it. A delivery fee is still never invented (D-032): the app's delivery row is simply left out until the user enters its fees.

**D-034 — The insights contract** · 2026-11-14 · *accepted*
[`docs/insights-contract.md`](insights-contract.md) defines `POD.insights.build(F, R, now)` exactly: the nine cards of BUILD.md §4.5 (Unlock, Distance, Fuel, Minimum, Wallet, Timing, Locked, Nuance, Spread), when each shows, its numbers, and its sentence character for character. **Where it differs from BUILD.md §4.5, the contract wins.** `src/js/insights.js` and the Python reference `tests/oracle/insights.py` (built on the engine oracle) both implement it; `tests/fixtures/insights/` holds 34 cases whose key numbers are worked by hand, and `run.py` compares the JS with the reference on them and on 500 seeded scenarios. The judgment calls:
- **Insights return plain text and numbers, not HTML** (`{id, label, cls, text, data}`), so the page escapes once and tests compare numbers exactly.
- **Counterfactuals add the cheapest item:** Unlock adds the cheapest deal item, Minimum the cheapest menu item (up to 20) or, for an unprofiled brand, the smallest typed subtotal that reaches the minimum. Minimum shows the candidate whose total moves least.
- **Distance and Fuel compare the cheapest pickup with the cheapest delivery**, as straight lines (credits that clamp at the total make the real line bend). Fuel caps its message at $12/gal (BUILD.md §4.5) and is skipped for EVs.
- **Timing counts calendar days to the next period** (the same calendar periods as `periodOf`, D-031), with no `Date` built inside, and lists unused credits that can apply here.
- **Locked lists both locked credits and restricted credits not opted in**, the second with a pointer to "Qualifies here" (§9.1).
- An empty order gets no advice.
*Why:* the same reason as D-029 to D-031: an independent reference can only check the code if both follow one exact definition.

**D-035 — The UI contract** · 2026-11-14 · *accepted*
[`docs/ui-contract.md`](ui-contract.md) defines the page: ten sections in a fixed order (one column on a phone, inputs left and results right on a desktop), what each control calls in `POD.state`, what each section reads and the exact strings the e2e checks, tile loading by script injection with a `?v=<BRANDS_RUN>` query (checked to work over `file://`), geolocation with a typed-ZIP fallback, and `POD.util.esc`. **Where it differs from BUILD.md §3/§10, it wins.** The judgment calls:
- **Values commit on `change`**, not on every keystroke; an empty or unparsable number box is `null`, so the page asks for it rather than pricing a 0.
- **Every change re-renders, writing only the blocks whose HTML changed**, and focus is restored by element `id`. *(Amended 2026-11-14 after slice A: a whole-section replace removed the button under the pointer when a text box committed on mouse down, so the click was lost.)*
- **Apps waiting for fees get inline inputs under the results** (D-032, D-033): each app lists only the fees it's missing, labeled as "what your app's checkout shows"; shared fees appear once.
- **A first-visit example** ("Show me an example": ZIP 10118, a Toyota Camry, Domino's, one pizza) runs the same actions a user would. It sets inputs, not data, so no number is invented.
- **A tile that fails to load** makes the list "may be incomplete"; the browser's own resource error for the missing file is the one console error the e2e allows, in that test only. Locally without built tiles it's expected; on Pages every indexed tile exists.
- **ISS-030** (dated platform evidence) is handled in the page's fine print for now: app listings are flagged as coming from announcements, some years old. A per-platform evidence date in `PROFILES` stays open for a later data pass.
*Why:* the same as D-029 to D-034. The e2e checks this file's hooks and strings, written before the builder.

**D-036 — Per-item markup and buy-one-get-one promos (BUILD.md §11 Phase B)** · 2026-11-14 · *accepted (orchestrator)*
- **Menu items become objects** `{name, price, dealItem, markup?}` in `PROFILES`, `S.rest` and every fixture, replacing `[name, price, isDealItem]`. `markup` is optional, `{dd?, ue?, gh?}` in percent (15 = 15%, like every percent here; BUILD.md's `0.30` fractions are not used).
- **An item's markup on app `p`** is its own `markup[p]` when that's a finite number ≥ 0, else the app's markup `S.plats[p].markup` (the chain's or category default). A malformed override falls back; it never throws and never becomes 0%.
- **App food is a sum over cart lines, rounded once:** `food = round2(Σ price × qty × (1 + markup_i / 100))`, in ascending menu-index order (engine contract §5.2). Unprofiled brands keep `round2(subtotal × (1 + markup / 100))`. *Rejected:* rounding each item's app price to the cent first (as an app's menu shows it). It would move every app total by up to a cent per line on markups that are estimates (all 9 profiles use the category default), which is precision the data doesn't have, and it changed 150 of the 190 hand-worked app totals in the receipts. The sum changes none of them.
- **A new app promo type `bogo`** ("Buy one, get one free"), entered by the user like every promo (D-032), on the item `promos[p].item` (a menu index): every two of that item in the cart make one free, `free = floor(qty / 2)`, priced at that item's own marked-up price (which is why per-item markup comes first), capped by `cap` dollars when `cap > 0`, after the usual minimum test on the marked-up food (§9.2). It applies to both modes, like `percent` and `dollar`; it lowers the taxed amount and not the tip base (§9.4). No item, an item not on the menu, an unprofiled brand or fewer than 2 in the cart → no promo, never a throw. A result with a `bogo` promo > 0 gets the note `"BOGO: " + item name`. A limit on how many items an offer makes free isn't modeled: `cap` limits the dollars.
- **Not in this phase:** a direct-channel BOGO deal (no profiled chain has a direct-only deal, ISS-035; `deal` stays a price per eligible item) and per-item app prices typed by the user (a later UI decision, ISS-036).
- **Data:** `tools/build-profiles.py` writes the object shape and accepts an item `markup` only for listed platforms, 0–60, with an https `source` (never estimated per item: an estimate already exists at the chain level). No current profile has one: the migration changes the shape, not a number.
- **State:** `promos[p]` gains `item: null`; `load` accepts `type` `bogo` and an integer `item` ≥ 0; `setBrand` clears every `item` (an index into the old menu would name a different item in the new one). **Insights:** Minimum also counts a `bogo` promo when the brand is profiled. **UI:** the promo select gains "Buy one, get one free" and, for it, an item select.
*Why:* BUILD.md §11 calls per-item markup the most valuable modeling change and a prerequisite for BOGO. The contracts, the oracle and the receipts change first (Phases 2–5 pattern).

---

## Skill updates

<!-- The reflector appends here at the end of each phase. -->

### Phase 1 (2026-11-12): reflector proposal, approved by the orchestrator with citation fixes
- data-research: + map each state to its PADD from EIA's glossary, row by row (c539fc3)
- data-research: + write the chain JSON after each store; one chain per run; stop exploring by call 60 (progress.md 1.7 turn budget, ISS-018)
- data-research: + platforms cite a dated page opened and read; Drive, "powered by" and white-label are not platform evidence (e1bc046, ec5e627, ISS-023, ISS-024)
- data-research: + copy item names with size or piece count as shown (ec5e627)
- data-research: + record every bag or checkout fee line with amount or range and type (ISS-031, ISS-027, ISS-014)
- data-research: + reachability checks use the default user agent only (ISS-013, D-027)
- data-research: + new issue IDs are max+1 at write time, under `## Open` (2fbdac1, c5f8b19, e1bc046, 3f44708)
- data-research: ~ profiles and categories are generated from JSON (D-027), not hand-entered; the table and profile bullets say so
- data-research: ~ tax and gas sources: VA is 5.77 (D-025), gas is EIA by PADD (D-022); NH/VT/DC flagged as unconfirmed (ISS-010)
- data-research: − removed "Wonder" from the amexGoldDirect list (D-027 names three brands)
- test-runner: + pin lookup tables to the source item by item (c539fc3)
- test-runner: + pin aggregates by value, with even-count and .5 cases (1.7 review findings 1, 2)
- test-runner: + quote the issuer sentence beside each pinned credit amount (83f24d7)
- test-runner: + read data via loadData(), compare with literals (ISS-008, 8962e13)
- test-runner: + destructive negative tests run on a scratch copy, never the real repo (69b429b)
- test-runner: + every generator rejection rule gets a failing-input test; a test-only rule gets a mutation check (56cc487, 1.7 review 3a/3b, ISS-011)
- code-review: + blocker, mapping tables checked against the source (c539fc3)
- code-review: + blocker, platform citations that are Drive, white-label or unopened snippets (e1bc046, ec5e627)
- code-review: + profile diffs spot-check item names and one URL per platform (ec5e627, 1.7 review)
- code-review: + blocker, credit "included" claims match the issuer sentence (83f24d7)
- code-review: + should-fix, new ISS ids unused and under `## Open` (2fbdac1, c5f8b19, 3f44708)
- frontend: no change (no Phase 1 frontend evidence)
- backend: no change (Phase 8, no evidence yet)

### Phase 2 (2026-11-12): reflector proposal, approved by the orchestrator with one addition (step 5's freedel exception)
- frontend: ~ engine section names docs/engine-contract.md as the spec over BUILD.md §4 (D-029, ba25e38)
- frontend: ~ step 3 fees: membership is `food >= memberMin` per app, not "above $12"; small-order and regulatory are app delivery only; `directSvc` added (contract §5, §7, D-029)
- frontend: ~ `override` lists its four fields (contract §1)
- frontend: + "Never put a neutral number in a code fallback" (ba25e38, c4e21c4)
- frontend: + "A malformed optional input has no effect; it never throws" (793577b, c4e21c4)
- frontend: + "Return copies of table data" (c4e21c4)
- frontend: + "Implement the engine from the contract alone; don't open tests/oracle/" (be9e129)
- frontend: + "Realm-sensitive compares…; a DONE WHEN with deepStrictEqual on loadApp/loadData is a card bug, report BLOCKED" (ISS-008, c4e21c4)
- test-runner: + "Named missing-value and malformed-value test per optional engine field" (793577b, c4e21c4)
- test-runner: + "Pin each threshold at its exact value with a receipt or named test" (memberMin `>=`→`>`: 15/500 fuzz, 0 receipts; progress.md Phase 2, be9e129)
- code-review: ~ blocker 1 cites the contract as amended (D-029)
- code-review: ~ blocker 4 covers a 0% markup or code default standing in for a missing value (ba25e38)
- code-review: + should-fix "review a missing and malformed value for each optional field"; a throw in calc/allResults is a blocker (793577b, c4e21c4)
- data-research: no change (no researcher work in Phase 2; directSvc data stays open under ISS-031)
- backend: no change (Phase 8, no evidence yet)

### Phase 3 (2026-11-13): reflector proposal, approved by the orchestrator with two fixes (frontend: the `?v=` tile URL needs a `file://` check first, as the contract says; test-runner: the NYC fixtures are `40_-74` and `40_-75`)
- frontend: ~ geo.js row and Restaurant model name docs/geo-contract.md as the spec over BUILD.md §8 (D-030)
- frontend: ~ every POD.geo function takes D and returns null on bad input (D-030)
- frontend: + tile-loading protocol for Phase 5: need → tilePath → opts.failed → call again; a foreign-run tile stays partial; `?v=BRANDS_RUN` (geo-contract §9)
- frontend: ~ trip distance rounded to 0.1 mi (tripMiles, geo-contract §6)
- frontend: ~ "Return copies" also covers memo caches keyed by table (97ce6fe, c8e1e5c, 197acd1)
- frontend: + "Work in the stored ×1000 integers; range-check every parsed coordinate" (197acd1: phantom store at mi null; own point by float distance)
- frontend: ~ verify step: geo changes also run the oracle (D-030)
- test-runner: ~ layout and oracle sections name geo.py, geo_runner.js and tests/fixtures/geo/ (3.1, D-030)
- test-runner: ~ fixtures bullet: Big Timber search cells 45_-111, 45_-110, 45_-109, 46_-110; 45_-110 holds 2 stores (tests/fixtures/stores/45_-110.js)
- test-runner: ~ merged "named missing-value test per optional engine field" with the wrong-typed rule: assert the documented output type (c8e1e5c blocker, 793577b, c4e21c4)
- test-runner: + cache/order tests build their own collision and sandbox; pass under --test-name-pattern (97ce6fe, c8e1e5c)
- test-runner: + differential runner fails, never skips; tags NaN/±Infinity; poisons POD.data/POD.S/Date; [0-9] + fullmatch in Python regexes (197acd1 contract review)
- data-research: ~ tile section replaced by D-021's format (cell from ×1000 integers, POD.data.TILES[cell] = {run, s}); the addTile/floor(lat) text predates D-021
- data-research: − removed `profiled` from the brands.js shape (D-021: not stored; the page derives it from PROFILES)
- code-review: no change (every Phase 3 blocker and should-fix was caught by review: 197acd1, c8e1e5c)
- backend: no change (Phase 8, no evidence yet)

### Phase 4 (2026-11-13): reflector proposal, approved by the orchestrator with three fixes (code-review: the stale-derived finding came from the 4.3 code review, not the contract review; "each test file bites alone" is should-fix, as the review rated it, not a blocker; test-runner: wording of the `map` rule)
- test-runner: ~ realm rule: copy VM arrays with `Array.from(v, f)`, a loop into `[]`, or JSON; never `map`/`filter`/`slice` (ISS-008: 8962e13, c4e21c4, a5b725d)
- test-runner: ~ wrong-typed input: a value-taking setter also gets an object and a cyclic object (9a17357)
- test-runner: + each test file must catch its own mutants, run alone (a7861b6)
- frontend: + clear a derived field when its input changes and the new value isn't known; `derive` sets every unsaved derived field on every branch (9a17357, 5cbada0)
- frontend: + value setters take plain values only (9a17357, D-031 amendment)
- frontend: + report issues; no `docs/issues.md` appends outside SCOPE (Phase 4 ISS-031 append, reverted)
- frontend: ~ the realm rule now points to test-runner; the BLOCKED-on-card-bug rule stays (ISS-008, c4e21c4, a5b725d)
- data-research: ~ core rule 1: report a gap; write `docs/issues.md` only when SCOPE lists it
- data-research: + use the source's own figure rather than deriving one (FHWA 26.59 mph, 7d3d496, D-032)
- data-research: + fee and platform evidence must be for restaurant delivery (Uber grocery guide withdrawn, 7d3d496, ISS-034)
- code-review: ~ blocker 13 (scope) covers docs appends (Phase 4 ISS-031 append)
- code-review: + blocker: a derived field fed by a changed input is recomputed or cleared, never kept (9a17357)
- code-review: + should-fix: a new test file catches its own mutants (a7861b6)
- backend: no change (Phase 8, no evidence yet)

### Phase 5 (2026-11-14): reflector proposal, approved by the orchestrator with one change (code-review: "a re-render without a type-then-click e2e" is should-fix, not blocker: the finding came from a builder, and a missing test isn't a wrong answer)
- frontend: ~ file table: `render(ctx)`, `build(F, R, now)` → `{id, label, cls, text, data}` (D-034, D-035)
- frontend: ~ Render: write only the changed blocks, restore focus by id; − syncStatic / full-subtree replace (5f60686, 2f657df)
- frontend: + an empty or bad number box is null; a typed 0 is a value (D-035, 2f657df)
- frontend: + a sticky panel needs max-height + overflow-y auto (5f60686)
- frontend: ~ derived-value rule extended to fields that switch between derived and typed (setCar, e705a87, da81998)
- frontend: + every module that reads credits applies the §9.1 tier itself (f10e69f)
- frontend: ~ tile URLs carry `?v=<BRANDS_RUN>`, checked over file:// (D-035)
- test-runner: + the one allowed console error is a deliberately omitted tile's ERR_FILE_NOT_FOUND, in that test only (D-035, 2f657df)
- test-runner: + e2e builds with `helpers.buildSite()`; expected prices from `H.expected(saved state)` (2f657df)
- test-runner: + run the data path in Node before an e2e names a store, row or missing field (2f657df)
- test-runner: + type-then-click test for any control a re-render can replace (5f60686, 2f657df)
- test-runner: ~ pin every boundary at equality; check every insight's condition for the state; −0 before JSON (f10e69f)
- code-review: ~ render should-fix: whole-page or control-subtree replace (5f60686)
- code-review: + blocker: credit readers apply the §9.1 tier (f10e69f)
- code-review: + should-fix: type-then-click e2e for a re-render that can replace a clickable control (5f60686, 2f657df)
- code-review: ~ stale-derived blocker covers derived/typed mode switches (e705a87)
- test-runner: + (orchestrator addition) a scratch copy never links to the repo's node_modules; `npm ci` in one emptied the real node_modules at the Phase 5 close
- data-research, backend: no change
