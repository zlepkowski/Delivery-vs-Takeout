# State fixtures

Hand-worked scenarios for `POD.state` ([`docs/state-contract.md`](../../../docs/state-contract.md), D-031). `scenarios.json` is written by `build.py`, whose expected values are closed-form arithmetic shown in each scenario's `work`. It never runs or imports `state.js`. To change an expectation, change the contract first (by a decision), then `build.py`, then regenerate:

```
python3 -I tests/fixtures/state/build.py tests/fixtures/state/scenarios.json
```

## The dataset

`S1` is made up and small. Its NY ZIPs sit on longitude −74 at latitudes 40.000 … 40.060, and its MT ZIPs on −110. One store tile (`40_-74`) holds Burger Co at 40.100 and Pizza Co at 40.030 and 40.050, so every distance is `R × π/180 × Δlat`. Pizza Co is profiled; Burger Co prices from its category default; Mystery's category has none, so it can't be priced. Two cards cover the credit tiers (open, `goldPartner`, `restricted`, `locked`), a card membership and every cadence. Grubhub's fees are `null`, like the real defaults (D-032).

## Running a scenario

The top-level `about` is the full protocol. In short:

- `D` is a deep copy of `datasets[data]`, with `patch` replacing whole top-level keys.
- `now` is `new Date(step.now || doc.now)`. The strings are local date-times with no zone, so a period never depends on the machine's time zone.
- Steps run in order on one `S`. `signatures[call]` lists each call's arguments, with `"*"` standing for the step's `args`.
- `returns` is the expected return value. Each `expect` key is either a dotted path into `S` or a `$` check. The `$` checks are `$missing`, `$appMissing.<app>`, `$forEngine…`, `$calc.<channel>.<field>`, `$allResults.ids`, `$getPath.<path>`, `$saved.<path>`, `$savedKeys`, `$has.<path>`, `$storageWrites` and `$protoClean`.
- Numbers compare exactly: every expected number is rounded or copied from the data.

`periods` lists `[cadence, now, expected]` cases for `periodOf`. A `now` string becomes `new Date(now)`, and `null` is passed as `null`.

The `$calc` expectations were also checked against the Python reference engine (`tests/oracle/engine.py`) on the same inputs. They agree to the cent.
