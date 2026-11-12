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
- **Output `PROFILES[id]`** = `{ menu: [[name, price, isDealItem]], deal: {label, price, minItems, scope} | null, markup: {dd?, ue?, gh?}, markupEst, directDelivery, directFee?, amexGoldDirect, platforms: [...] }` (§6 shape, keyed by brand id).
- **`categories.json`** holds `{ markup: {dd, ue, gh}, est, reason, sources }` per D-021 category. The generated **`CATEGORY_DEFAULTS[category]`** is just `{ markup: {dd, ue, gh}, est }`: reasons and sources stay in the JSON in the repo, and the sources are also listed in the file header. Estimates are allowed here (data-research skill) when flagged.
- **Browser research rules:** Playwright through the proxy. **No getting around bot protection**: no user-agent spoofing, stealth plugins or CAPTCHA solving. A chain that blocks automated access is reported BLOCKED, for option 2 (prices from the user) or option 3 (unprofiled). Don't create accounts or place orders. Use a public address (e.g. a city hall) to see a store's prices and delivery fee. Don't scrape the delivery apps' menus; platform presence is shown by the chain's own site or a citable statement.
- **Network:** during this research the environment is temporarily **unrestricted** (approved by the user 2026-11-12). Afterwards it goes back to the 16-host list in ISS-001.

---

## Skill updates

<!-- The reflector appends here at the end of each phase. -->
