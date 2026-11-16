# Pickup or Delivery

Is it cheaper to have food delivered, order pickup through a delivery app, or
order direct from the restaurant once gas, fees, menu markup, promos, card
credits and direct-only deals are all priced in?

**Status:** v5. The spec is [`docs/BUILD.md`](docs/BUILD.md); history and next steps are in
[`docs/progress.md`](docs/progress.md). Live at <https://zlepkowski.github.io/Delivery-vs-Takeout/>
once `main` is deployed (Settings → Pages → Source: GitHub Actions).

## Run

Open `index.html` directly in a browser. `file://` works, with no server and
no build step. On GitHub Pages it's served from `/Delivery-vs-Takeout/`.

## Test

```bash
npm install          # dev-only: acorn (ES5 gate) + playwright
npm test             # es5 → unit → oracle → e2e
```

If Playwright can't find a browser on your machine, run `npx playwright install chromium`.

## Layout

```
index.html        page shell + the single source of truth for script load order
src/js/           ES5 app code, all under the POD namespace
src/data/         reference data, each file with a provenance header
src/css/          styles
tools/            data generators, the Pages site build and its gates, the ES5 gate
worker/           the optional Cloudflare Worker (off unless src/js/config.js sets apiBase)
tests/            unit (node:test), e2e (Playwright), oracle (Python), fixtures
docs/             BUILD.md (the v5 spec), the contracts, decisions, issues, progress
```

Development is orchestrated by the agents and skills in `.claude/`.
See `CLAUDE.md`.
