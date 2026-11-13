# Progress

**Current phase:** 4 (State, derivations, wallet) is **done**. Next is **Phase 5 (UI + 9 insights + "Near you" picker)**, to start in a **fresh session**, with the user's `/goal`
**Last updated:** 2026-11-13
**Repo:** `zlepkowski/Delivery-vs-Takeout` · **Branch:** `claude/exciting-rubin-7evr9n` (the Phase 3–4 session branch, built on `claude/sharp-heisenberg-tbo63x` at `2a84085`; base: `main`). A new session may be given another branch name: it starts from this branch's tip.

## Resume here

1. Read `CLAUDE.md` (repo root), then this file, then `decisions.md` and `issues.md`.
2. Ask the user to type the goal for the current phase (template below). Only the user can set `/goal`.
3. **Phase 5 (UI + 9 insights + "Near you" picker, BUILD.md §7, §10–§13):** `render.js` and `app.js` wire the page to `POD.state`. Done when: the §13 manual checklist is automated in Playwright, 0 console errors, phone and desktop screenshots reviewed. Write the UI contract (what each control calls, what each view reads) and the e2e checklist **before** the builder, as in Phases 2–4.
4. **What Phase 5 gets from Phase 4** (`docs/state-contract.md`, D-031 + its amendment):
   - Boot: `S = POD.state.load(localStorage, POD.data, new Date(), opts)`. After **every** change call the matching action (`setAddress`, `setPosition`, `setCar`, `setBrand`, `pickStore`, `setQty`, `pinMiles`, `unpinMiles`, `toggleCard`, `setOptIn`, `markUsed`, `addManualCredit`, `removeManualCredit`), or `setPath` **followed by `derive`** (setPath re-derives nothing), then `save(S, localStorage)`.
   - A trip status `need` lists tile cells: load each with `POD.geo.tilePath`, add failures to `opts.failed`, then `derive` again. While tiles load the trip is cleared (`miles: null`), so `missing(S)` holds the comparison back. It never shows a stale distance.
   - Pricing: `F = POD.state.forEngine(S)`; `null` means show `missing(S)` (the shared inputs to ask for). Otherwise `POD.engine.allResults(F)`, and list each app that `forEngine` switched off with `appMissing(S, p)` (the fees to fill in).
   - **D-032: every app starts switched off.** The apps don't publish their delivery fee, and Uber/Grubhub publish no service fee either: `dd.delFee`, `dd.svcMin`, every `ue` fee but `pickDisc`, every `gh` fee but `pickDisc`, and `regFee`/`smallMin`/`smallFee` are `null`. The first screen must ask for these clearly (ISS-034), or offer labeled estimates if the user changes D-032. Pricing app pickup without delivery fees would need an engine change (state contract §7).
   - Tips default to 15% delivery / 0% pickup (the user's choice, D-032).
5. **Open questions carried forward:**
   - **ISS-032 (needs the user):** ~6,200 ZIPs share one coordinate with 9+ others in the ZIP source (452 California ZIPs from 118 cities on one point). Options are in the issue; browser geolocation in Phase 5 helps whatever is chosen.
   - **ISS-034:** app fees aren't published (D-032 nulls). Phase 5 decides how the page asks for them; the user may later allow labeled estimates.
   - D-028: whether `amexGoldDirect` becomes brand-level for unprofiled Five Guys (an engine contract change; `restFor` sets it `false` for every unprofiled brand today).
   - ISS-030 (platform evidence dates) is a Phase 5 item. ISS-031 (direct service fee data per chain). No profiled chain has a confirmed direct-only deal (all 9 `deal: null`). Research that before Phase 5's insights.
6. **Network:** the environment **Delivery-vs-Takeout** is limited to the 20 hosts in ISS-001 (at the cap). Phase 5 needs none.
7. **User actions pending:** ISS-005 (GitHub default branch `main`, Pages Source GitHub Actions). Merge to `main` only by a PR the user asks for.

### Goal template

```
/goal Phase N is checked off in docs/progress.md and `npm test` exits 0
```

## Phases

| # | Phase | Owner | Status | Done when |
|---|---|---|---|---|
| 0 | Scaffold | Opus | ✅ done | `npm test` green; the empty page loads from file:// with 0 console errors; agents and skills in place |
| 1 | Data rebuild | researcher + Opus (cards) | ✅ done (`32dae9b`) | Schema tests pass. ZIPs = 42,354 / 18,908. Every credit has a tier, source URL and date. Store tiles build; fixtures committed |
| 2 | Engine (§4) | Opus (oracle) → builder | ✅ done | Matches the Python oracle on 500 seeded scenarios; hand-worked receipts and §9 trap tests pass |
| 3 | Geography + stores near you | Opus (contract) → builder | ✅ done | 59011 vs 10118 estimates differ ≥10× (10.4 vs 0.4 mi, 26×); `storesNear` passes fixture tests (129 hand-worked + 71 real-data cases); an uncached ZIP takes <10 ms (mean ≈ 4 ms) |
| 4 | State, derivations, wallet (§5) | Opus (contract) → builder | ✅ done | Cascade tests pass (80 hand-worked scenarios + named tests); `syncCredits` keeps used/manual/opt-in; a throwing storage falls back to defaults |
| 5 | UI + 9 insights + "Near you" picker | builder | ⬜ | The §13 manual checklist is automated in Playwright; 0 console errors; phone and desktop screenshots reviewed |
| — | **v4 parity milestone** | | | |
| 6 | Phase B: per-item markup | Opus (oracle) → builder | ⬜ | Oracle updated first; BOGO cases pass; profiles migrated |
| 7 | Phase A static: VIN lookup, weekly gas + store refresh | researcher + builder | ⬜ | Big Timber → Domino's ≈ the real ~33 mi; the scheduled refresh passes a dry run |
| 8 | Phase A backend: Worker behind the seam | api-builder | ⬜ | Fixture tests pass; the site is identical with the Worker off |
| 9 | Phase E: deep links | builder | ⬜ | Link-builder tests pass; every result row hands off |
| 10 | Ship | tester + Opus | ⬜ | CI green; BUILD.md updated to v5; live on Pages after the merge to `main` |

## Log

### Phase 0: Scaffold (2026-11-11)

- Repo layout per D-002: `.claude/` + `CLAUDE.md` at the root, the app in `pickup-or-delivery/` (in `zlepkowski/test`; superseded by D-018).
- 6 Haiku agents, each preloading one skill (D-014). Auto-compact at 60% (D-015) is **pending ISS-006**: `.claude/settings.json` needs creating by the user.
- App skeleton: `index.html` → `src/js/pod.js` (namespace, `round2`, `money`, `clamp`) → `src/js/app.js` (placeholder boot).
- Test harness (D-017): VM loader that reads the `index.html` script order; ES5 gate (acorn) with a negative test; Playwright smoke at phone and desktop widths over `file://`; oracle runner stub.
- CI: `.github/workflows/test.yml` runs `npm test` on changes under `pickup-or-delivery/`.
- `npm test`: es5 OK, 8/8 unit, oracle stub, 2/2 e2e.

### Phase 0, continued: moved to its own repo (2026-11-12)

- Recreated the Phase 0 scaffold from the handoff (all 32 appendix files) in the new repo `zlepkowski/Delivery-vs-Takeout`, with the app at the repo root (D-018). Paths in `CLAUDE.md`, the agents, the skills, the docs and CI were updated to match. `package-lock.json` is now committed so CI's `npm ci` works.
- `main` created from this scaffold. Work continues on `claude/sharp-heisenberg-tbo63x`.
- `.claude/settings.json` written at the user's instruction (ISS-006 closed, D-015 applied).
- Workers are dispatched as `general-purpose` Haiku agents that read their agent file and skill first, until a fresh session loads them by name (D-019).
- No Pages workflow yet: it's added in Phase 1 with the store-tile build (ISS-005).
- `npm test` from a clean install: es5 OK, 8/8 unit, oracle stub, 2/2 e2e.

### Phase 4: State, derivations, wallet (2026-11-13, done)

Same branch as Phase 3 (`claude/exciting-rubin-7evr9n`).

| Task | Status | Commit |
|---|---|---|
| 4.1 Sourced defaults (D-032: official numbers only; tips 15/0 by the user): `tools/data/defaults-*.json` evidence, `tools/build-defaults.py` → `src/data/defaults.js`; state contract draft (D-031) | ✅ researcher + orchestrator corrections (speed 30 → 27; Uber fees from a grocery guide withdrawn); network swap approved by the user (ISS-001) | `7d3d496` |
| 4.2 Hand-worked scenarios `tests/fixtures/state/` (`build.py` → `scenarios.json`, 74 + 12 period cases; priced cases agree with `tests/oracle/engine.py`), contract wording made exact | ✅ | `9f5f449` |
| 4.3 Scenario runner (contract §0 checked on every step), builder `src/js/state.js`, review fix round (D-031 amendment: `need` clears the trip; `setPath` plain values; `pickStore` id check; 9-digit manual keys; 6 new scenarios) | ✅ 93/93 scenarios; 7 orchestrator mutants caught; reviewer CHANGES-REQUESTED → fixed | `cc1da6a`, `a5b725d`, `fc052cb`, `5cbada0`, `9a17357`, `36c734b` |
| 4.4 Tester: `tests/unit/state.test.js` (22: the three done-when conditions by name, round-trip property, junk input, pollution, forEngine, realms) and `tests/unit/data-defaults.test.js` (11: schema, evidence, header, byte-for-byte rebuild); 16 + 5 tester mutants and 3 orchestrator mutants caught; reviewer APPROVE + 4 should-fixes (fixed) | ✅ 590/590 unit | `858890d`, `a7861b6` |
| 4.5 Close: full suite in a clean worktree at `a7861b6` (es5 13 files, 590 unit, oracle 58/58 receipts + 0 of 500 scenarios + geo 129/71/330, 2 e2e); no UI change, so the screenshots show the same placeholder page, fine at phone and desktop | ✅ | latest |

**Phase 4 notes for a resuming session.**
- `docs/state-contract.md` is the spec for `POD.state`. Change it only by a decision: scenarios first (`tests/fixtures/state/build.py`, then regenerate), the code after.
- The real defaults leave all three apps switched off until the user enters their fees (D-032, ISS-034). That's deliberate, not a bug.

**Review evidence for the Phase 4 reflector** (all fixed unless noted):
- **The orchestrator's runner repeated ISS-008 a third time.** `plain()` copied arrays with `v.map(plain)`, and `map` builds its result with the VM array's own constructor, so 37 of 87 scenarios failed on prototypes. The builder diagnosed it and reported BLOCKED without touching the test (`a5b725d`). Lesson: realm-neutral means `Array.from(v, f)`, a `for` loop into `[]`, or JSON. Never `map`/`filter`/`slice` on a VM array.
- **"Change nothing while tiles load" kept a stale distance** (contract flaw, reviewer blocker). Switching brands, moving, or unpinning while tiles loaded left the previous trip in `S`, which then priced the new brand. Lesson: when an input changes, a derived field whose new value isn't known yet must be cleared, not kept. "Don't invent a number" includes "don't keep an old one" (`9a17357`).
- **A derived field that isn't saved has to be re-derived on every path.** `milesSrc` came back `null` after a reload of a pinned trip. The orchestrator caught it while drafting tests, not the scenarios (`5cbada0`). Lesson: for each unsaved field, check that `derive` sets it in every branch.
- **`setPath` deep-copied any value**, so a cyclic object overflowed the stack. Restricting it to plain values removed the copy and the bug (`9a17357`). `pickStore` trusted `id` and `brand` separately, and a mismatch silently dropped the pick.
- **The orchestrator's hand-worked expectation was wrong once:** it listed `gas` as missing for a state with no car, but `gas` comes from the state's row. The builder reported BLOCKED with the contract line instead of bending the code (`36c734b`). The rule "report, don't edit the fixture" worked as intended.
- **The test review found 4 holes the hand-worked scenarios happened to cover.** The new file alone missed a save without `cart`/`dealOn`, a `syncCredits` that ignores opt-ins, `setPath` accepting objects, and a regex that only matched 2-segment paths. Lesson: each test file should bite on its own; check it against mutants with the other files absent.
- **Scope slip:** the builder appended an issue to `docs/issues.md` (outside SCOPE) under an ID already in use (ISS-031). Reverted. Lesson from Phase 1 again: workers report and the orchestrator logs, at max+1.
- **Research (4.1):** the researcher computed an average speed as mean length ÷ mean time (30 mph) where the report gives the mean of per-trip speeds (26.59 → 27), and took Uber fees from a grocery-delivery guide (the wrong product). Both were caught by the orchestrator reading the sources. Lesson: a derived number needs the source's own figure if one exists, and fee evidence must be for restaurant delivery.
- **The orchestrator's question to the user understated an option's effect** ("Grubhub would start excluded"). In fact all three apps start excluded. Corrected in the next message. Lesson: before asking, compute what each option does to the first screen.
- **Stop hook vs review:** the hook forced commits of verified-but-unreviewed work twice (`fc052cb`, `858890d`). The orchestrator committed only what had passed every DONE WHEN, said so in the message, and landed the review fixes as follow-ups. It never committed a worker's half-finished edit.

### Phase 3: Geography + stores near you (2026-11-13, done)

Work is on branch `claude/exciting-rubin-7evr9n` (this session's branch; it started from `2a84085`, the tip of `claude/sharp-heisenberg-tbo63x`).

| Task | Status | Commit |
|---|---|---|
| 3.1 Geo contract `docs/geo-contract.md` (D-030), Python reference `tests/oracle/geo.py`, hand-worked `tests/fixtures/geo/synthetic.json` + reference-generated `real.json`, geo checks in `run.py` via `geo_runner.js` | ✅ reviewer CHANGES-REQUESTED → fixed (contract amended) | `f5f37f4`, `5829c9d`, `197acd1` |
| 3.2 Builder: `src/js/geo.js` + review fix round | ✅ hand-worked 129/129, real 71/71, random 330/330 (1,650/1,650 on a second seed); uncached zipSpacing mean ≈ 4 ms; 59011 vs 10118 Domino's 10.4 vs 0.4 mi (26×); reviewer APPROVE + one should-fix (fixed) | `8215c29`, `197acd1` |
| 3.3 Tester: `tests/unit/geo.test.js`, 224 tests (every fixture case with a purity check, a count guard, the done-when tests, malformed and non-finite input, cache isolation and bounds); 17 of 17 mutations caught; reviewer CHANGES-REQUESTED → fixed, the three review mutants verified caught by the orchestrator | ✅ 464/464 unit | `97ce6fe`, `c8e1e5c` |
| 3.4 Close: full suite in a clean worktree at `97ce6fe` (es5 OK, 463 unit, oracle 58/58 + 0 of 500 scenarios + geo 129/71/330, 2 e2e) and again after the test fix round (464 unit); no UI change, so the e2e screenshots show the same placeholder page, fine at phone and desktop; reflector approved with two fixes | ✅ | latest |

**Phase 3 notes for a resuming session.**
- `docs/geo-contract.md` is the spec for `POD.geo`. Every function takes the data tables as `D`. `storesNear`/`nearestStore` return `status: "need"` with the cells to load; Phase 5's page loads them (`tilePath`) and calls again, passing cells that failed in `opts.failed`.
- Real-data facts: Big Timber (59011) → nearest Domino's 30.9 mi straight line, trip 77.2 mi, from the fixture tiles (the estimator says 10.4 mi one way). Midtown (10118) → 82 brands within 5 mi.
- ISS-032 (new, needs the user): ~6,200 ZIPs sit 10+ to one coordinate in the ZIP source.
- ISS-030 moved to Phase 5 (UI). D-028's brand-level `amexGoldDirect` question is still open (engine/data, not geography).

**Review evidence for the Phase 3 reflector** (all fixed unless noted):
- **The contract review found two harness holes that would have let a wrong JS pass:** NaN/Infinity results serialized to `null` and matched expected nulls, and the JS comparison switched on only by one exact string in `index.html` (it would have printed "skipped" and exited 0). Lesson: a differential runner must encode non-finite numbers and must fail, not skip, when the code exists.
- **Python's `\d` and `$` aren't JavaScript's.** `\d` matches other scripts' digits and `$` matches before a final newline, so the reference accepted records the JS rejects. Use `[0-9]` with `fullmatch` when a Python reference mirrors a JS regex.
- **"Distance exactly 0" is a float test.** The own-point rule depended on how `rec.la` was represented (`0.1 * 3`). Identify points by their integer keys.
- **Parsed integers need a range check.** A 400-digit coordinate became `Infinity`, then a phantom store at `mi: null` that displaced the real nearest store (the `geo.js` reviewer; no fixture had it).
- **Rounded values were compared with a tolerance** that would have hidden a `round1` bug. Tolerance applies only to unrounded distances.
- **The purity check only saw arguments.** It now poisons `POD.data`, `POD.S` and `Date` during calls and calls twice with the first result scribbled over.
- **The orchestrator's own doc edit landed in the wrong place:** a string replace on `## Closed` hit the same words in the "Adding an entry" prose, so ISS-032 was committed inside that sentence (`f5f37f4`, fixed `5829c9d`). Anchor doc inserts on the whole heading line (`\n## Closed\n`).
- **The contract's first bounding box (`dLat / cos(poleward lat)`) overshot by 0.002°** and made the Big Timber 50-mile search ask for two non-fixture cells. The exact reach `asin(sin δ / cos φ)` fixed it. The cheaper `dLat / cos(lat)` undershoots by 0.0002° at Fairbanks, so a real-data case pins that edge.
- **A data defect surfaced only while designing a function:** stacked ZIP coordinates (ISS-032). Phase 1's row-count checks couldn't see it.
- **A type-confusion gap in a test:** the "non-string BRAND_IDS entry is skipped" test couldn't fail for `['s00']`. An array coerces to `'s00'` as a property key, and `brand !== 's00'` was true for the array (test review blocker, `c8e1e5c`). Lesson: when a test feeds a wrong-typed value, assert the output's type too, not just inequality with the right value.
- **Cache tests passed only because of file order.** The cross-table test never queried one point on two tables. A global spacing cache was caught only incidentally by a later fixture case, and passed when the test ran alone (`c8e1e5c`). Lesson: an isolation test must create the collision itself, and must pass or fail the same way under `--test-name-pattern`.
- **"Uncached" in a timing test was an assumption.** One of the 50 points was already cached by an earlier test in the same sandbox (`c8e1e5c`). Timing tests get their own sandbox.
- **The orchestrator's own mutant was broken once.** It referenced an undefined variable, so the 37 "catches" were ReferenceErrors. A mutant has to run cleanly and be wrong only in the intended way.

### Phase 2: Engine (2026-11-12, done)

| Task | Status | Commit |
|---|---|---|
| 2.1 Engine contract `docs/engine-contract.md` (D-029): exact formulas, float order, channel availability, credit tiers, lines; resolves ISS-031's model (`directSvc`) | ✅ | `72db287` (+ amendment below) |
| 2.2 Python oracle `tests/oracle/engine.py` + `run.py` (receipts self-check; 500 seeded scenarios vs JS) + `js_runner.js` (purity check) | ✅ | `72db287` |
| 2.3 12 hand-worked receipts, 58 cases, `tests/fixtures/receipts/` | ✅ 58/58 vs oracle | `72db287` |
| 2.4 Builder: `src/js/engine.js` (one loop) + review fix round 1 | ✅ 58/58 receipts; 0 of 500 + 10,000 + 10,000 scenarios differ on three seeds; reviewer APPROVE | `be9e129`, `c4e21c4` |
| 2.5 Tester: `tests/unit/engine.test.js`, 81 tests (58 receipt cases, §9 traps by name, purity, perMile, restFor on real data and isolation, a load guard); 17 mutations each caught; reviewer APPROVE + fix round | ✅ | `560eb54`, latest |
| 2.6 Close: full suite in a clean worktree (240 unit, oracle 58/58 + 0 of 5,500 scenarios, 2 e2e); no UI change, so the e2e screenshots are unchanged from Phase 1; reflector approved with one addition | ✅ | `2f7e05f` |

**Phase 2 notes for a resuming session.**
- The contract is the spec. Change it only by a decision, and change the oracle and receipts **before** the engine.
- The builder implements from the contract and must not read `tests/oracle/engine.py` (independence).
**Review evidence for the Phase 2 reflector** (all fixed unless noted):
- **Writing receipts by hand before any code found a spec flaw.** Under §4.2's literal order, a free-delivery promo lowered the tax on the food. The contract was amended (§5.5) before the engine existed (`72db287`).
- **The oracle self-check caught a harness bug, not an engine bug.** The receipt merge rule merged `cart` objects instead of replacing them: 11 of 58 cases failed with impossible totals. Map-like fields (`cart`, `creditOptIn`, `markup`) now replace whole (`72db287`).
- **The fuzzer only covers what it generates.** The first engine matched on 10,000 scenarios, yet the reviewer found that a `directSvc` with no `modes` threw and took down `allResults`, and a deal with no `scope` silently never applied. Neither shape is ever generated (`793577b`, `c4e21c4`). Lesson: review malformed and missing-field inputs separately from the differential test.
- **An invented number hid in a code default.** `restFor` fell back to `markup {}` (0%) for a missing category, so the apps looked cheaper. The never-invent rule applies to code fallbacks too: return null (`ba25e38`, `c4e21c4`).
- **The orchestrator's card repeated ISS-008.** A DONE WHEN compared VM-realm arrays with `deepStrictEqual`, so the builder reported BLOCKED on a correct engine. Compare with `JSON.stringify` or `loadData`'s clone (`c4e21c4` message).
- **Generated tests can vanish silently.** The 58 receipt tests are generated from files: an empty glob would remove them and the suite would still pass. A guard test now pins the floor (`560eb54`).
- **Stop hooks vs in-progress workers:** twice the hook asked to commit files a worker was still editing. The orchestrator waited for the worker and verified first; mid-edit commits would have pushed unverified code.
- Fuzzer power, measured: a `>=`→`>` change on `memberMin` was caught in 15/500 scenarios and by none of the receipts (boundary injection does that work). The receipts caught tip-after-discount (4 cases) and free-delivery-lowers-tax (1 case).

### Phase 1: Data rebuild (2026-11-12, done)

| Task | Status | Commit |
|---|---|---|
| 1.1 Schema tests first (tester) | ✅ committed with each dataset | — |
| 1.2 ZIPs: 42,354 / 18,908 | ✅ | `8962e13` |
| 1.3 Cars: 48 makes / 344 models (D-023) | ✅ | `087d79c` |
| 1.4 States: EIA gas (D-022) + tax (D-025) | ✅ | `c539fc3` |
| 1.5 Brands + tiles: 273 brands, 182,567 stores, 847 tiles (D-021) | ✅ | `2ebdc0d` |
| 1.6 Cards: 22 cards, 21 credits (D-024) | ✅ | `83f24d7` |
| 1.7 Profiles + `categories.js`: **9 profiled** (buffalo_wild_wings, chipotle, dominos, dunkin, little_caesars, papa_johns, subway, the_cheesecake_factory, wingstop); taco_bell, pizza_hut, five_guys unprofiled (D-028) | ✅ generated and loaded; reviewer APPROVE, should-fixes done | `bab5ce1`, `56cc487`, `b92ebb8`, `1fe89a6` |
| 1.8 Pages workflow with the tile build | ✅ | `69b429b` |
| 1.9 Close: full suite, e2e screenshots reviewed (placeholder page fine at phone and desktop), reflector approved with fixes, network reverted | ✅ | `32dae9b` |

`npm test` at Phase 1 close (`32dae9b`, clean worktree): es5 OK (9 files), **159/159 unit**, oracle stub, 2/2 e2e.

**Task 1.7 notes** (kept for the record; the rules now live in the data-research skill).
- The 12 chains are in D-026; their brand ids are in `src/data/brands.js`.
- Profile rules are in the data-research skill: menu prices from the chain's own site (median of 2–3 stores in different states, with ZIPs recorded); `deal` must be a published direct-only offer; `markup` cited, or the category default with `est: true`; `directDelivery: false` rather than `directFee: 0`; `amexGoldDirect` for Five Guys, Buffalo Wild Wings and The Cheesecake Factory.
- `categories.js` must cover the 10 categories in D-021.
- Chain sites are mostly JavaScript apps, so plain fetches return no prices. The researcher may need Playwright (Chromium is preinstalled) through the proxy.
- The chains' hosts aren't allowed yet. The environment caps the list at 20 exact hosts and 13 are in use: drop issuer and tax hosts that are no longer needed before adding chain hosts.

**Review evidence for the end-of-phase reflector** (every finding is fixed unless noted):
- **Test harness:** strict `deepEqual` failed on empty arrays from the VM realm, which blocked the cars worker. Fixed at the root with `structuredClone` in `loadData` (ISS-008, `8962e13`).
- **States:** DE, DC and MD were on PADD 1C instead of 1B (blocker; gas $0.54/gal too low), and all 12 tests passed anyway. Fixed, and the tester added a per-state EIA-series test from EIA's PADD glossary that fails on exactly those three (`c539fc3`). Lesson: shape and range tests don't catch wrong mappings, so pin mappings to the source.
- **Cards:** the orchestrator marked Amex Platinum as including Uber One, which the card only reimburses. That's an over-credit (blocker), and the tester's test pinned the wrong value because the card said so. Also missed: the Sapphire Reserve Lyft credit, and unpinned amounts. Fixed with a 21-row amount table (`83f24d7`). Lesson: "provides" vs "reimburses" a membership is a §9.1-class trap.
- **Brands:** the range reader would read a whole 2.9 GB body if a server ignored `Range`; `IncompleteRead` wasn't retried; remote URLs went into JS comments unvalidated. All fixed (`2ebdc0d`). The edge-cell rule was resolved by amending D-021.
- **Pages:** `build-site.sh`'s `rm -rf` guard didn't cover ancestors of the repo. **The orchestrator's fix card put destructive negative tests against the real repo in DONE WHEN, and the worker ran them before a correction arrived.** The guard held and nothing was lost (`69b429b`). Lesson: never put a destructive command aimed at a real path in a DONE WHEN; test guards on a throwaway copy.
- **Cars:** the generator's rules have no unit tests (ISS-011, open).
- **Profiles (1.7), turn budget:** three researchers given 3–4 chains each used all 80 turns exploring and wrote no files. Resumed with "stop exploring, write the JSON". After that, one chain per worker, write the file after each store, stop by call 60. Lesson: cards for browser research must cap exploration and require incremental writes.
- **Profiles (1.7), issue IDs:** workers appended issues under IDs already in use, five times (renumbered to ISS-016, 021, 024, 025, 026). Lesson: the skill must say "take max(ISS-n)+1 at write time" and the orchestrator checks `uniq -d` before every commit.
- **Profiles (1.7), D-027 shape:** the tester found D-027's `CATEGORY_DEFAULTS` shape didn't match the generator. D-027 fixed to `{markup, est}`.
- **Profiles (1.7), platform evidence:** the Little Caesars worker cited a Jan 2020 "delivery powered by DoorDash" story as DoorDash marketplace evidence. It was DoorDash Drive fulfilling the chain's own app orders. The orchestrator replaced it with the Oct 2020 marketplace announcement (`e1bc046`). Lesson: white-label/Drive/"powered by" deals are direct-channel evidence, never `platforms` evidence.
- **Profiles (1.7), platform evidence quality:** of the last four workers, Domino's listed dd from an unread search snippet and left out Uber Eats (a widely reported 2023 deal), Subway gathered no platform evidence at all, and Little Caesars cited a Drive deal. The orchestrator read the primary sources and fixed all three (`ec5e627`, `0a4262b`, `e1bc046`). Lesson: workers spend their budget on menus and treat platforms as an afterthought. Cards need a separate, required "platforms" step with a read (not snippet) source per platform, or the orchestrator does platforms itself.
