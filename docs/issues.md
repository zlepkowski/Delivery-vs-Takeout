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
- **Update 2026-11-12, partly resolved:** the user approved a new personal environment, **Delivery-vs-Takeout**, saved for this repo. It allows `www.fueleconomy.gov`, `gasprices.aaa.com`, `www.alltheplaces.xyz`, `data.alltheplaces.xyz`, `alltheplaces-data.openaddresses.io`, `www.americanexpress.com`, `creditcards.chase.com`, `www.chase.com`, `www.capitalone.com` and `taxfoundation.org`, and all ten answered. Still not allowed: `vpic.nhtsa.dot.gov` and `api.eia.gov` (Phase 7), the chain menu sites (request them once the 12 profiles are picked), and the bare `alltheplaces.xyz` that `www.` redirects to (not needed so far). The environment caps the list at 20 exact hosts, so the menu sites may need trimming.
- **Next step:** at the start of Phase 1, the orchestrator calls `get_environment` and requests the exact hosts in one approval: EPA, AAA, All The Places, NHTSA, the tax sources, the issuer sites (americanexpress.com, chase.com, capitalone.com) and the menu sites for the chosen profiles.

### ISS-003 — Gas price source for the automated refresh
- **Opened:** 2026-11-11 by orchestrator · **Phase:** 7 · **Status:** open
- **What:** AAA has state-level prices but means scraping (fragile, terms unclear). EIA is official and has an API (free key) but is regional (PADD), with only about 9 states broken out.
- **Next step:** decide in Phase 7. Fuel rarely changes the answer (BUILD.md §1), so robustness beats precision here.

### ISS-004 — Phase 8 deployment needs the user's accounts
- **Opened:** 2026-11-11 by orchestrator · **Phase:** 8 · **Status:** open
- **What:** The Worker needs a Cloudflare account to deploy, and a Mapbox token (free tier) or a Google Places key.
- **Next step:** build and test against recorded fixtures; deploy once the user provides the accounts.

### ISS-005 — Pages serves only from `main`
- **Opened:** 2026-11-11 by orchestrator · **Phase:** 10 · **Status:** open
- **What:** Pages will deploy from `main`. Work happens on `claude/sharp-heisenberg-tbo63x`. **Update 2026-11-12:** the new repo (D-018) has no Pages workflow at all; the old `pages.yml` belonged to `zlepkowski/test`.
- **Next step:** Phase 1 adds `.github/workflows/pages.yml` with the store-tile build step (D-011). The user turns Pages on in the repo settings (Settings → Pages → Source: GitHub Actions). The user also sets the default branch to `main` (Settings → General → Default branch). GitHub made `claude/sharp-heisenberg-tbo63x` the default because it was pushed first. Open a PR to `main` when the user asks.

## Closed

<!-- Move entries here with the closing commit or decision. -->

### ISS-002 — Confirm the All The Places license allows redistributing the tiles
- **Opened:** 2026-11-11 by orchestrator · **Phase:** 1 · **Status:** closed (2026-11-12, D-020)
- **What:** The tiles redistribute derived store coordinates on a public site.
- **Next step:** check the license terms of the ATP output before the first deploy, and record the result as a decision.
- **Resolution:** the data is CC-0 (ATP README, "License"). Publishing the tiles is allowed.

### ISS-006 — `.claude/settings.json` (auto-compact at 60%) created
- **Opened:** 2026-11-11 by orchestrator · **Phase:** 0 · **Status:** closed (2026-11-12, the user told the orchestrator to write it; D-015 applied)
- **What:** The auto-mode classifier blocked the orchestrator from creating `.claude/settings.json` (self-modification). The first attempt also carried a permission allowlist the user hadn't asked for, which has been dropped. The `update-config` skill says the user should create the file when it doesn't exist.
- **Why it matters:** without it, auto-compact fires at the default threshold instead of 60% (D-015).
- **Next step:** the user creates the file with exactly this content, or explicitly tells the orchestrator to write it:
  ```json
  { "env": { "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "60" } }
  ```
  It takes effect from the next session start.
