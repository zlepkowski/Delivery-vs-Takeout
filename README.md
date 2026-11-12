# Pickup or Delivery

Is it cheaper to have food delivered, order pickup through a delivery app, or
order direct from the restaurant once gas, fees, menu markup, promos, card
credits and direct-only deals are all priced in?

**Status:** v5 rebuild in progress. See [`docs/progress.md`](docs/progress.md).

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
tools/            data generators + the ES5 gate
tests/            unit (node:test), e2e (Playwright), oracle (Python), fixtures
docs/             BUILD.md (v4 spec), progress, decisions, issues
```

Development is orchestrated by the agents and skills in `.claude/`.
See `CLAUDE.md`.
