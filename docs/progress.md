# Progress

**Current phase:** 2 (Engine, §4), **in progress** in the same session as Phase 1, at the user's request. Phase 3 starts in a fresh session
**Last updated:** 2026-11-12
**Repo:** `zlepkowski/Delivery-vs-Takeout` · **Branch:** `claude/sharp-heisenberg-tbo63x` (base: `main`)

## Resume here

1. Read `CLAUDE.md` (repo root), then this file, then `decisions.md` and `issues.md`.
2. Ask the user to type the goal for the current phase (template below). Only the user can set `/goal`.
3. **ISS-006** is closed: `.claude/settings.json` sets auto-compact at 60%.
4. **Phase 2 starts with the orchestrator, not a worker** (CLAUDE.md): write the Python oracle in `tests/oracle/` and the hand-worked receipts in `tests/fixtures/receipts/` *before* the builder touches the engine. Read BUILD.md §4 (engine, the §4.2 order) and §9 (traps) for it.
5. **Phase 2 open questions to settle first:** **ISS-031**, how direct-channel service fees are modeled (Wingstop $2.00, Subway 12%, Little Caesars up to $4); §4.2 has none for direct orders today. Also decide how the engine prices **unprofiled** brands (D-006: category markup est, typed subtotal, no direct delivery), since 3 of the 12 D-026 chains are unprofiled (D-028).
6. **Later-phase notes from Phase 1:** ISS-030 (platform evidence dates, Phase 3), D-028's question of whether `amexGoldDirect` becomes brand-level (Phase 3), and no profiled chain has a confirmed direct-only deal (all 9 `deal: null`). That is the biggest gap in the product's premise, so research it again before Phase 5's insights.
7. **Network:** the personal environment **Delivery-vs-Takeout** is back to **limited**, with the 16 hosts in ISS-001. Phase 2 needs no network. A fresh session should start on that environment.
8. **User actions pending:** ISS-005 (set GitHub's default branch to `main` and Pages Source to GitHub Actions). Merge to `main` only by a PR the user asks for.

### Goal template

```
/goal Phase N is checked off in docs/progress.md and `npm test` exits 0
```

## Phases

| # | Phase | Owner | Status | Done when |
|---|---|---|---|---|
| 0 | Scaffold | Opus | ✅ done | `npm test` green; the empty page loads from file:// with 0 console errors; agents and skills in place |
| 1 | Data rebuild | researcher + Opus (cards) | ✅ done (`32dae9b`) | Schema tests pass. ZIPs = 42,354 / 18,908. Every credit has a tier, source URL and date. Store tiles build; fixtures committed |
| 2 | Engine (§4) | Opus (oracle) → builder | 🟡 in progress | Matches the Python oracle on 500 seeded scenarios; hand-worked receipts and §9 trap tests pass |
| 3 | Geography + stores near you | builder | ⬜ | 59011 vs 10118 estimates differ ≥10×; `storesNear` passes fixture tests; an uncached ZIP takes <10 ms |
| 4 | State, derivations, wallet (§5) | builder | ⬜ | Cascade tests pass; `syncCredits` keeps used/manual/opt-in; a throwing storage falls back to defaults |
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

### Phase 2: Engine (2026-11-12, in progress)

| Task | Status | Commit |
|---|---|---|
| 2.1 Engine contract `docs/engine-contract.md` (D-029): exact formulas, float order, channel availability, credit tiers, lines; resolves ISS-031's model (`directSvc`) | ✅ | `72db287` (+ amendment below) |
| 2.2 Python oracle `tests/oracle/engine.py` + `run.py` (receipts self-check; 500 seeded scenarios vs JS) + `js_runner.js` (purity check) | ✅ | `72db287` |
| 2.3 12 hand-worked receipts, 58 cases, `tests/fixtures/receipts/` | ✅ 58/58 vs oracle | `72db287` |
| 2.4 Builder: `src/js/engine.js` | 🟡 built; 58/58 receipts and 0/10,000 scenarios differ (orchestrator, fresh seed); reviewer running; fix card next (restFor null on a missing category default, name fallback) | — |
| 2.5 Tester: `tests/unit/engine.test.js` (receipts, §9 traps by name, restFor, purity) | ⬜ | |
| 2.6 Close: full suite, reviewer, reflector, progress | ⬜ | |

**Phase 2 notes for a resuming session.**
- The contract is the spec. Change it only by a decision, and change the oracle and receipts **before** the engine.
- The builder implements from the contract and must not read `tests/oracle/engine.py` (independence).
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
