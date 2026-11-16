# API fixtures

Provider answers for the Worker ([`docs/api-contract.md`](../../../docs/api-contract.md), D-040), and `cases.json`: the hand-worked expectations for the Worker and the browser seam `POD.api`. `cases.json` is written by `build.py`, an independent Python reading of the contract that never runs `worker/` or `src/js/api.js`. To change an expectation, change the contract first (by a decision), then `build.py`, then regenerate:

```
python3 -I tests/fixtures/api/build.py tests/fixtures/api/cases.json
```

## The provider files

Each file is `{provider, case, recorded, request: {method, url}, response: {status, contentType, bodyKind, body}}`. `bodyKind` is `json` (the body as parsed) or `text`.

| File | Source |
|---|---|
| `osrm/bigtimber_livingston.json` | **recorded 2026-11-16**: 59011's centroid → the Livingston, MT Domino's, 54,552.2 m (33.9 mi), 2,176.1 s |
| `osrm/nyc_empire_dominos.json` | **recorded 2026-11-16**: 10118's centroid → the nearest Domino's, 1,377.8 m |
| `osrm/oahu_molokai_noroute.json` | **recorded 2026-11-16**: Honolulu → Kaunakakai, status 400 `NoRoute` |
| `nominatim/empire_state.json` | **recorded 2026-11-16**: `350 5th Ave, New York, NY 10118` |
| `nominatim/big_timber.json` | **recorded 2026-11-16**: `Big Timber, MT` (a town: `address.town`, no `city`) |
| `nominatim/not_found.json` | **recorded 2026-11-16**: a made-up street, `[]` |
| `overpass/constructed_*.json` | **constructed**, not recorded: see below |

The recordings were plain GETs with a generic `User-Agent`, no key and no personal details; no header was saved. OSRM's `hint` strings are its own opaque routing hints, kept as sent.

**Overpass (ISS-040).** From the recording session `overpass-api.de` reset every TLS handshake and the mirror `overpass.kumi.systems` never answered, so the Overpass files are written by hand to Overpass's documented JSON output (<https://dev.overpass-api.de/output_formats.html#json>): `version`, `generator`, `osm3s`, `elements` (each `type`, `id`, `lat`/`lon` for a node or `center` for a way or relation under `out center`, `tags`), and `remark` when a query hits a runtime error. **Every place, id and coordinate in them is made up** ("Fixture Diner" and so on), except one deliberately untagged "Subway" that tests the chain-name filter. To record a real answer, run the request the `"nearby: a small town"` case names in `cases.json` (its `upstream` URL) with your own `User-Agent`, save it in the format above as `overpass/recorded_<case>.json`, and add a case for it in `build.py`.

Other bad answers (an HTML 502, a string distance, a lowercase ISO code, a rejected fetch, …) are written inline in `build.py` as small variations of the recorded ones.

## Running the cases

`cases.json`'s `about` is the full protocol: how to build the request, the fake `fetch` (it answers only the listed upstream URLs and checks the `User-Agent`), the fake KV, and what to compare. Values JSON can't hold are tagged `{"$": "NaN" | "Infinity" | "-Infinity" | "-0" | "undefined" | "D"}`.
