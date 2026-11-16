# VIN fixtures

Inputs and hand-worked expectations for `POD.vin` ([`docs/vin-contract.md`](../../../docs/vin-contract.md), D-038) and the car-table helpers of the state contract §4.0 (D-037). `python3 -I tests/oracle/run.py` checks `cases.json` against the Python reference (`tests/oracle/vin.py`), and, once `src/js/vin.js` is in `index.html`, the JS against both.

## `cases.json`: hand-worked

Written by `build.py` (`python3 -I tests/fixtures/vin/build.py tests/fixtures/vin/cases.json`). Every expectation is a literal written by hand from the contracts, with the rule or the arithmetic in `work`; `build.py` imports nothing from `src/` or `tests/oracle/`. The datasets `T1`, `T2`, `T3` are small made-up car tables, so the cases don't move when `cars.js` is rebuilt. Change an expectation only after the contract changes.

## `vpic/`: recorded answers

NHTSA vPIC `DecodeVinValues/<VIN>?format=json`, fetched 2026-11-16 (pretty-printed, otherwise as received; the live answer also carried `Access-Control-Allow-Origin: *`). Except NHTSA's published sample, the VINs are built from real VIN patterns with an arbitrary serial number and a correct check digit, so no one's car is in the repo.

| File | VIN | vPIC says | EPA (vehicles.csv, sha256 1d553896…) |
|---|---|---|---|
| `accord2003.json` | 1HGCM82633A004352 (NHTSA's sample) | 2003 HONDA Accord | Accord 2003: 21, 22, 25, 26 → 24 |
| `camry2018.json` | 4T1B11HK7JU512345 | 2018 TOYOTA Camry | Camry 2018: 26, 26, 32, 32, 34, 46, 52 → 32 |
| `model3_2019.json` | 5YJ3E1EA0KF312345 | 2019 TESLA Model 3 | electric, 1000/combE → 37.51 → 38e (3.8 mi/kWh) |
| `f150_2019.json` | 1FTEW1E56KFA12345 | 2019 FORD F-150 | EPA's `F150`; 25 regular records → 19 |
| `bolt2020.json` | 1G1FZ6S03L4112345 | 2020 CHEVROLET Bolt EV | 1000/28.6629 = 34.89 → 35e (3.5 mi/kWh) |
| `civic2015.json` | 19XFB2F50FE012345 | 2015 HONDA Civic | regular 31, 32, 33, 34, 44 → 33 |
| `bmw330i_2019.json` | WBA5R1C55KA712345 | 2019 BMW 330i | EPA calls it `3 Series`: no model match (D-038) |
| `ram2500d_2018.json` | 3C6UR5DL4JG112345 | 2018 RAM 2500 (diesel) | not rated by EPA: no model match |
| `accord1999.json` | 1HGCG5656XA012345 | 1999 HONDA Accord | before 2000: no `CAR_YEARS` figure (D-037) |
| `undecodable.json` | ZZZZZZZZ9ZZZZZZZZ | empty year, make and model (manufacturer not registered) | `decode` → `null` |

The e2e (`tests/e2e/vin.e2e.js`) answers the page's requests with these files through Playwright, CORS header included, so no test reaches the network.
