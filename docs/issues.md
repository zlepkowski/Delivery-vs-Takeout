# Issues

Open blockers, bugs and unresolved questions. Workers append entries; the orchestrator closes them.

## Format

```
### ISS-nnn — Title
- **Opened:** YYYY-MM-DD by <agent|orchestrator> · **Phase:** n · **Status:** open | closed (YYYY-MM-DD, commit/decision)
- **What:** the symptom, with the command and the relevant output lines
- **Why it matters:** what it blocks or gets wrong
- **Next step:** who does what
```

---

## Open

### ISS-001 — The network allowlist blocks every data source
- **Opened:** 2026-11-11 by orchestrator · **Phase:** 1 · **Status:** open
- **What:** The proxy refuses (`connect_rejected`) `www.fueleconomy.gov`, `gasprices.aaa.com`, `data.alltheplaces.xyz`, `vpic.nhtsa.dot.gov`, `api.eia.gov`, `router.project-osrm.org` and `api.mapbox.com`. Card issuer and chain menu sites are presumably blocked too. `raw.githubusercontent.com` (ZIP data) and the npm registry are reachable.
- **Re-checked 2026-11-12** in the new repo's session: same result. Only the npm registry and `raw.githubusercontent.com` answer; every data host gets `CONNECT tunnel failed, response 403`.
- **Why it matters:** blocks all of Phase 1 except ZIPs.
- **Update 2026-11-12 (task 1.7):** removed the issuer and tax hosts (research committed); added the 12 profiled chains' `www.` sites; then, because store menus come from per-chain ordering APIs that exceed the 20-host cap, the user approved switching the environment to **unrestricted for the profile research only**. **Revert afterwards** to: www.fueleconomy.gov, data.alltheplaces.xyz, alltheplaces-data.openaddresses.io, www.eia.gov, plus the 12 chain sites (www.dominos.com, www.tacobell.com, www.chipotle.com, www.papajohns.com, www.wingstop.com, www.pizzahut.com, www.fiveguys.com, www.buffalowildwings.com, www.littlecaesars.com, www.thecheesecakefactory.com, www.subway.com, www.dunkindonuts.com).
- **Update 2026-11-12, partly resolved:** the user approved a new personal environment, **Delivery-vs-Takeout**, saved for this repo. It allows `www.fueleconomy.gov`, `gasprices.aaa.com`, `www.alltheplaces.xyz`, `data.alltheplaces.xyz`, `alltheplaces-data.openaddresses.io`, `www.americanexpress.com`, `creditcards.chase.com`, `www.chase.com`, `www.capitalone.com` and `taxfoundation.org`, and all ten answered. Still not allowed: `vpic.nhtsa.dot.gov` and `api.eia.gov` (Phase 7), the chain menu sites (request them once the 12 profiles are picked), and the bare `alltheplaces.xyz` that `www.` redirects to (not needed so far). The environment caps the list at 20 exact hosts, so the menu sites may need trimming. **Later the same day:** removed `gasprices.aaa.com` (Cloudflare blocks automated requests, D-022) and `www.alltheplaces.xyz` (not needed); added `www.eia.gov`, `www.revenue.nh.gov`, `tax.vermont.gov`, `www.tax.virginia.gov` and `otr.cfo.dc.gov`. EIA, VA and DC answer. The NH and VT sites return their own 403 to automated requests.
- **Next step:** at the start of Phase 1, the orchestrator calls `get_environment` and requests the exact hosts in one approval: EPA, AAA, All The Places, NHTSA, the tax sources, the issuer sites (americanexpress.com, chase.com, capitalone.com) and the menu sites for the chosen profiles.

### ISS-004 — Phase 8 deployment needs the user's accounts
- **Opened:** 2026-11-11 by orchestrator · **Phase:** 8 · **Status:** open
- **What:** The Worker needs a Cloudflare account to deploy, and a Mapbox token (free tier) or a Google Places key.
- **Next step:** build and test against recorded fixtures; deploy once the user provides the accounts.

### ISS-005 — Pages serves only from `main`
- **Opened:** 2026-11-11 by orchestrator · **Phase:** 10 · **Status:** open
- **What:** Pages will deploy from `main`. Work happens on `claude/sharp-heisenberg-tbo63x`. **Update 2026-11-12:** the new repo (D-018) has no Pages workflow at all; the old `pages.yml` belonged to `zlepkowski/test`.
- **Next step:** Phase 1 adds `.github/workflows/pages.yml` with the store-tile build step (D-011). The user turns Pages on in the repo settings (Settings → Pages → Source: GitHub Actions). The user also sets the default branch to `main` (Settings → General → Default branch). GitHub made `claude/sharp-heisenberg-tbo63x` the default because it was pushed first. Open a PR to `main` when the user asks. **Update 2026-11-12:** `.github/workflows/pages.yml` now exists (`69b429b`). It deploys only after the user turns Pages on and something is merged to `main`.

### ISS-007 — All The Places has gaps for some big chains
- **Opened:** 2026-11-12 by orchestrator · **Phase:** 1 · **Status:** open
- **What:** In run `2026-10-31-13-32-34`, `stats/_insights.json` shows **no US stores for McDonald's** (Q38076: no `US` entry in `atp_splits`). Some chains are partial: Pizza Hut 2,200 and Little Caesars 2,316 against roughly 6,500 and 4,200 real US stores. Qdoba shows 5,786 against well under 1,000 real, which is probably duplicates. **Wonder isn't in ATP at all.**
- **Why it matters:** the nearest-store search will miss chains or stores, so distances come out too long, and a missing brand can't be picked. Wonder and McDonald's are in the proposed profile list.
- **Next step:** dedupe (D-021) may fix Qdoba. When the profiles are picked, the orchestrator weighs coverage. Later, possibly let `build-stores.py` take a brand from the newest earlier run where its US count looks healthy (Phase 7 refresh).

### ISS-010 — NH, VT and DC meal-tax rates read from search results, not fetched from the state site
- **Opened:** 2026-11-12 by researcher · **Phase:** 1 · **Status:** open
- **What:** revenue.nh.gov and tax.vermont.gov return 403 to automated fetch, so NH 8.5%, VT 9% and DC 10% (otr.cfo.dc.gov, which also refused the direct fetch) were read from web search results on the official domains. The NH 2026 booklet also lists 8.5%. HB 1480 (2026) proposed 9.0% for NH, and enactment was not confirmed.
- **Why it matters:** the rates match BUILD.md §6 but are not confirmed from the live pages.
- **Next step:** a human checks the four pages (and the NH HB 1480 status) and confirms or corrects the rates in `tools/data/state-tax.csv`.

### ISS-011 — No unit tests for the data generators' rules
- **Opened:** 2026-11-12 by orchestrator (reviewer should-fix on 087d79c) · **Phase:** 1 → 7 · **Status:** open
- **What:** the schema tests check the generated files' shape, counts and ranges, but nothing pins `tools/build-cars.py`'s tie order, half-up rounding, hydrogen/CNG drop or name cleaning. Switching `round_half_up` to Python's `round()` would still pass 11/11.
- **Why it matters:** Phase 7 rewrites the generators for the scheduled refresh, and a silent rule change would ship.
- **Next step:** before Phase 7 touches a generator, add a stdlib Python test per generator that runs it on a hand-written fixture with hand-computed expected output.

## Closed

<!-- Move entries here with the closing commit or decision. -->

### ISS-002 — Confirm the All The Places license allows redistributing the tiles
- **Opened:** 2026-11-11 by orchestrator · **Phase:** 1 · **Status:** closed (2026-11-12, D-020)
- **What:** The tiles redistribute derived store coordinates on a public site.
- **Next step:** check the license terms of the ATP output before the first deploy, and record the result as a decision.
- **Resolution:** the data is CC-0 (ATP README, "License"). Publishing the tiles is allowed.

### ISS-003 — Gas price source for the automated refresh
- **Opened:** 2026-11-11 by orchestrator · **Phase:** 7 · **Status:** closed (2026-11-12, D-022)
- **What:** AAA has state-level prices but means scraping (fragile, terms unclear). EIA is official and has an API (free key) but is regional (PADD), with only about 9 states broken out.
- **Next step:** decide in Phase 7. Fuel rarely changes the answer (BUILD.md §1), so robustness beats precision here.
- **Resolution:** EIA. AAA blocks automated requests (Cloudflare), so it can't be the scripted source.

### ISS-006 — `.claude/settings.json` (auto-compact at 60%) created
- **Opened:** 2026-11-11 by orchestrator · **Phase:** 0 · **Status:** closed (2026-11-12, the user told the orchestrator to write it; D-015 applied)
- **What:** The auto-mode classifier blocked the orchestrator from creating `.claude/settings.json` (self-modification). The first attempt also carried a permission allowlist the user hadn't asked for, which has been dropped. The `update-config` skill says the user should create the file when it doesn't exist.
- **Why it matters:** without it, auto-compact fires at the default threshold instead of 60% (D-015).
- **Next step:** the user creates the file with exactly this content, or explicitly tells the orchestrator to write it:
  ```json
  { "env": { "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "60" } }
  ```
  It takes effect from the next session start.

### ISS-008 — `tests/unit/data-cars.test.js` fails on a cross-realm array comparison (not a data error)
- **Opened:** 2026-11-12 by researcher (Phase 1, task 3) · **Phase:** 1 · **Status:** closed (2026-11-12, 8962e13)
- **What:** The first test "§6 CAR_DATA is an array of strings in the Make|Model:value format" runs `assert.deepEqual(bad.slice(0, 5), [])`. `CAR_DATA` comes from `loadData` (a `vm` context), so `bad.slice()` is a VM-realm array and fails `deepStrictEqual` against the main-realm `[]` even when empty ("Values have same structure but are not reference-equal"). `tests/unit/data-brands.test.js` has the same pattern, and every `deepEqual(bad, [])` there fails the same way. The data itself passes: all 48 makes match ROW_RE.
- **Why it matters:** the DONE WHEN for cars.js cannot exit 0 until the test is fixed. The test was not changed (task card: never weaken a test).
- **Next step:** the tester or orchestrator changes the comparisons to `assert.equal([...bad.slice(0, 5)].length, 0)` or `assert.deepEqual([...bad], [])`, or `tests/helpers/data.js` returns realm-neutral arrays. Confirmed with `node -e` on 2026-11-12: `[...bad.slice(0,5)]` passes `deepEqual([])`.
- **Also:** `tests/unit/data-provenance.test.js` "every src/data/*.js is listed in index.html" fails for `src/data/cars.js` because `index.html` doesn't load it yet (index.html is outside the researcher's scope).
- **Resolution:** `tests/helpers/data.js` `loadData()` now returns `structuredClone(...)` of the VM data, so every data test compares values from its own realm. No assertion changed.

### ISS-009 — Virginia meal tax rate has no primary source
- **Opened:** 2026-11-12 by researcher (Phase 1, task 4) · **Phase:** 1 · **Status:** closed (2026-11-12, D-025)
- **What:** BUILD.md §6 uses VA 10.5 as the meal rate. The state sales rate on prepared food is 5.3% (4.3% state + 1% local, tax.virginia.gov). The rest is a local meals tax set by each locality (0 to about 10%, per search-result reporting). No primary source gives a typical or average figure, so `src/data/states.js` writes `mealTaxPct: null` for VA.
- **Why it matters:** with no sourced meal rate, VA was written as null, which would break every Virginia calculation.
- **Resolution:** D-025. Virginia has no statewide meal tax, so it uses the Tax Foundation's published combined rate (5.77%), with a note that local meals taxes are excluded. A locality-level rate could come later from a Virginia source (e.g. the Cooper Center's local tax survey) if the host becomes reachable.

### ISS-012 — Category default markups are menu-only estimates with no per-platform split
- **Opened:** 2026-11-12 by researcher (Phase 1, task 1.7 part D) · **Phase:** 1 · **Status:** open
- **What:** `tools/data/categories.json` sets dd/ue/gh to the same value for every category, all marked `est: true`. The only menu-only measures found are Self Financial (McDonald's food-only +19.3%, Apr 2025, blended across apps), Gordon Haskett (fast food 15.3%, fast casual 12.6%, casual dining ~3%, Chick-fil-A 29.8%, Starbucks 20.3%, 2020, via Fox Business and Restaurant Dive) and Credit Suisse (limited-service ~20%; Papa John's third-party equal to first-party, date given as 2022 or 2023). The per-app totals in FinanceBuzz (2024; 2026 update) and Self include fees and tips, so they were not used as markups. Pizza is 0 on one chain's measure, which may be too low for a category default.
- **Why it matters:** the defaults are weak for the platform split and dated (2020 for most category values). They drive the estimate for every unprofiled brand.
- **Next step:** orchestrator decides whether to accept the pizza value of 0 or override it. A per-app menu-only study (or a Plott Data methodology check, which was not reachable from WebFetch) would give real platform and category splits.
- **Also:** WebFetch could not resolve several hosts (foodspark.io, cheaperly.ai, yahoo.com, plottdata.com) even though curl through the proxy reached them. Source text was read with curl. The Plott Data page carried no category markup figures.
- **Orchestrator decision 2026-11-12:** pizza is overridden from 0 to the fast-food average (15.3%). One chain's parity pricing shouldn't set the default for every unprofiled pizza place; that would understate app costs. The other nine categories are accepted as researched. Revisit with a per-app, menu-only study.

### ISS-013 — Taco Bell profile blocked: www.tacobell.com returns 502 (task 1.7 batch B, 2026-11-12)
- www.tacobell.com returned HTTP 502 "upstream request failed" on two loads, and a page.goto timeout on a third. The proxy status shows no policy denial for this host (`curl` gives HTTP/2 INTERNAL_ERROR). Not a bot-challenge page, so not worked around.
- Next step: retry later, or the user allows the host and confirms the gateway can reach it. Then research 5+ items at 2+ stores in 2+ states.
- Status: no tools/data/profiles/taco_bell.json written.

### ISS-014 — Subway profile incomplete (task 1.7 batch B, 2026-11-12)
- Pickup menu prices read from one store only (store 19027-0, 165 Church St, NY 10007, subway.com menu API). A second state is missing.
- Delivery fee: subway.com shows "Delivery fee of $2.99-$6.49" plus a 12% service fee for 100 Maiden Ln NY 10038 (store 24130-0). It is a range, not one fee, and the cart was not reached, so directDelivery is not set.
- Deal: the only published Subway app BOGO (Oct 27 to Nov 8 2026) has expired. No current direct-only offer was confirmed.
- Next step: price the same 5-8 items at a Chicago or Phoenix store, and confirm the single delivery fee from the bag view.

### ISS-015 — Dunkin' profile incomplete (task 1.7 batch B, 2026-11-12)
- www.dunkindonuts.com loads without a challenge. The locations page lists stores (nearby NYC), but ORDER HERE does not open a store menu, and no store-level prices were captured.
- Delivery: a first-party delivery page exists at /dunkin-delivers, fee not read.
- Next step: find the store ordering URL (or the menu/bag flow after store selection) and read a coffee and a donut price at 2 stores in 2 states.

### ISS-016 — Domino's direct delivery fee not observed (profile `dominos`)
- **Opened:** 2026-11-12 by researcher (Phase 1, task 1.7 batch A) · **Phase:** 1 · **Status:** open
- **What:** `tools/data/profiles/dominos.json` has `directDelivery: false`. On 2026-11-12 every nearby store showed "Closed, opens at 10:30am" and the NYC delivery address (City Hall Park, 10007) returned "Delivery not available", so no first-party delivery fee was observed. No fee range is used.
- **Why it matters:** Domino's has first-party delivery, so the direct-delivery route is left out of the Domino's comparison until a fee is observed.
- **Next step:** re-run the delivery check with an open store and a deliverable address, then set `directDelivery: true` with `directFee.observed` at 2+ states (D-027).

### ISS-017 — Five Guys profile blocked by a Cloudflare challenge (task 1.7 batch C)
- **Opened:** 2026-11-12 by researcher (Phase 1, task 1.7 batch C) · **Phase:** 1 · **Status:** open
- **What:** `order.fiveguys.com` (the ordering site, which the store menus link to) returned HTTP 403 with a Cloudflare "Just a moment..." page loading `brunhild.challenges.cloudflare.com` (a Turnstile CAPTCHA). The public menu pages (`www.fiveguys.com/menu`, `/menu/burgers`) show no prices, so pickup prices, the delivery fee and any deal could not be observed. Per the hard rules, nothing was worked around.
- **Why it matters:** no `tools/data/profiles/five_guys.json`, so Five Guys is unprofiled (category default used by the app).
- **Next step:** a human or the user supplies prices from a store page (option 2 in D-027), or accepts Five Guys as unprofiled (option 3).

### ISS-018 — The Cheesecake Factory profile not researched (task 1.7 batch C)
- **Opened:** 2026-11-12 by researcher (Phase 1, task 1.7 batch C) · **Phase:** 1 · **Status:** open
- **What:** Ran out of tool budget before its ordering site was probed. The homepage loaded without a challenge. No menu, delivery-fee or deal data was collected, and no `tools/data/profiles/the_cheesecake_factory.json` was written.
- **Next step:** a fresh researcher session follows the Wingstop method (store menu API at three cities, cart summary for the fee, the chain's own deal page, and a platform/markup source).

### ISS-019 — Buffalo Wild Wings: no direct delivery fee observed, no direct-only deal confirmed
- **Opened:** 2026-11-12 by researcher (Phase 1, task 1.7 batch C) · **Phase:** 1 · **Status:** open
- **What:** `tools/data/profiles/buffalo_wild_wings.json` has `directDelivery: false`. The bag summary (own site, delivery set to 121 N La Salle St) shows subtotal and "taxes, fees, and total will be calculated at checkout" with no delivery fee line. No direct-only offer was confirmed (`deal: null`). Platforms are empty: the FAQ says "some third-party delivery sites" without naming them. Bot protection (PerimeterX, kaptcha) loaded but did not challenge.
- **Next step:** read the delivery fee from the checkout summary before the payment step (the bag page did not show it), and check the promotions pages for a web-only offer.

### ISS-020 — Wingstop DoorDash evidence is dated (2018)
- **Opened:** 2026-11-12 by researcher (Phase 1, task 1.7 batch C) · **Phase:** 1 · **Status:** open
- **What:** The only citable platform evidence for Wingstop is a 2018 franchising.com press release on the DoorDash rollout. Current DoorDash status was not re-verified. No Uber Eats or Grubhub evidence meets the rules (the Uber Eats store pages were not used as evidence). Markup is the category default (est).
- **Next step:** confirm current app presence from a dated Wingstop statement or a 2026 news source.

### ISS-021 — Pizza Hut profile blocked: www.pizzahut.com returns 502 (task 1.7 follow-up, 2026-11-12)
- **Opened:** 2026-11-12 by researcher (Phase 1.7 follow-up) · **Phase:** 1 · **Status:** open
- **What:** `https://www.pizzahut.com/menu` returned HTTP 502 "upstream request failed" on every load (3 browser loads: first with a 60 s timeout and `waitUntil: domcontentloaded`, then two more after a wait). curl gets `HTTP/2 stream 1 was not closed cleanly: INTERNAL_ERROR`. `order.pizzahut.com` fails its TLS certificate check (expired certificate). Control hosts (chipotle.com, dominos.com) load with HTTP 200 in the same session. Not a bot-challenge page, so not worked around. Same failure pattern as ISS-013 (Taco Bell).
- **Why it matters:** no menu prices, deal, direct delivery fee or platform evidence could be read for `pizza_hut`. No `tools/data/profiles/pizza_hut.json` was written, because a profile needs 5-10 menu items observed in 2 states (D-027).
- **Next step:** retry later, or the user confirms the gateway can reach www.pizzahut.com. Then research the menu at the three city-hall stores (NYC 10007, Chicago 60602, Phoenix 85003), the direct-only app/phone offer if one exists, and the first-party delivery fee before any payment step.
