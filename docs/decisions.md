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

---

## Skill updates

<!-- The reflector appends here at the end of each phase. -->
