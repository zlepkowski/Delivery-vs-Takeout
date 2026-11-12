# Progress

**Current phase:** 1 (Data rebuild), not started
**Last updated:** 2026-11-12
**Repo:** `zlepkowski/Delivery-vs-Takeout` · **Branch:** `claude/sharp-heisenberg-tbo63x` (base: `main`)

## Resume here

1. Read `CLAUDE.md` (repo root), then this file, then `decisions.md` and `issues.md`.
2. Ask the user to type the goal for the current phase (template below). Only the user can set `/goal`.
3. **ISS-006** is closed: `.claude/settings.json` sets auto-compact at 60%.
4. Before Phase 1 can start, **ISS-001** has to be resolved: the network allowlist blocks every data source. Request the hosts listed there with the environment tools, in one approval.

### Goal template

```
/goal Phase N is checked off in docs/progress.md and `npm test` exits 0
```

## Phases

| # | Phase | Owner | Status | Done when |
|---|---|---|---|---|
| 0 | Scaffold | Opus | ✅ done | `npm test` green; the empty page loads from file:// with 0 console errors; agents and skills in place |
| 1 | Data rebuild | researcher + Opus (cards) | ⬜ | Schema tests pass. ZIPs = 42,354 / 18,908. Every credit has a tier, source URL and date. Store tiles build; fixtures committed |
| 2 | Engine (§4) | Opus (oracle) → builder | ⬜ | Matches the Python oracle on 500 seeded scenarios; hand-worked receipts and §9 trap tests pass |
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
