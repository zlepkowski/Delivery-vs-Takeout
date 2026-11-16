# Geography fixtures

Expected values for `POD.geo` ([`docs/geo-contract.md`](../../../docs/geo-contract.md), D-030). `python3 -I tests/oracle/run.py` checks both files against the Python reference (`tests/oracle/geo.py`), and, once `src/js/geo.js` is in `index.html`, against the JS too.

## `synthetic.json`: hand-worked

Small made-up tables where every expected value is closed-form arithmetic, shown in the case's `work`. Distances run along a meridian (`R × π/180 × |Δlat|`), or along one parallel for the exact-tie cases.

- `datasets`: named `D` tables. `Z1` is a 10-ZIP table on longitude 0 with 8 malformed records mixed in; `Z2` has too few points for a spacing; `E` is empty; `T1` is a store search around (10.5, 0.5) with 17 brands in tiles `10_0` and `11_0`.
- A case is `{id, data, patch?, call, args, expect, work}`. `data` names the dataset (`null` when the call takes no `D`). `patch` replaces whole top-level keys of the dataset (a `null` value sets the key to `null`). `args` leave `D` out; it goes where the contract's signature puts it.

## `real.json`: from the reference

Calls on the real data (`POD.data` with the fixture tiles in `tests/fixtures/stores/`), whose expected values come from `tests/oracle/geo.py`. Regenerate it with `python3 -I tests/oracle/geo.py --write` after the data or the contract changes. The oracle fails when the committed file is stale.

- `data: "real"`. `tiles` lists which fixture tiles are in `D.TILES` (all six when absent), and `tileRun` overrides a tile's run id.

## Comparing

Unrounded numbers (`mi`, `spacing`, `zipsPerStore`, `distMi`) compare with a relative tolerance of 1e-9 (1e-9 absolute below 1), because two `sin` implementations can differ in the last bit (contract §2). Everything else, including the rounded `trip`, `one` and `round`, compares exactly.
