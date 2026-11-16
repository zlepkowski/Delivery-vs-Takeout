# VIN contract (v5, Phase 7, D-038)

The exact definition of `POD.vin` in `src/js/vin.js`: checking a VIN the user typed, the URL of NHTSA's decoder, reading its answer, and matching it onto the car tables (D-023, D-037). The request itself and the messages are the page's job (UI contract §5.7, §6b). `src/js/vin.js` and the Python reference `tests/oracle/vin.py` both implement this file, and `tests/oracle/run.py` compares them on `tests/fixtures/vin/`. Change it only by a decision, with the reference and the fixtures first.

## 0. Rules

- **Pure.** Every function reads only its arguments. No `POD.S`, no `POD.data`, no DOM, no network, no `Date`. `match` may call `POD.state.carMakes` and `POD.state.carModels` (state contract §4.0), which follow the same rule. `vin.js` loads after `state.js`.
- **Never throws.** Bad input gives the value each section names (`""`, `"length"`, `null`).
- Words as in the state contract §0: "string" = `typeof x === "string"`; "object" = not null, `typeof "object"`, not an array; "integer" = a finite number `x` with `Math.floor(x) === x`.
- Characters are UTF-16 code units. Only ASCII is ever changed: `toUpperCase`/`toLowerCase` are **not** used (they map other scripts, and JS and Python disagree on some), so `ß` stays `ß` and is then refused by `check`.

## 1. API (`POD.vin`)

| Function | Does | Returns |
|---|---|---|
| `clean(text)` | what the user typed → a candidate VIN (§2) | a string |
| `check(vin)` | is it a well-formed VIN? (§3) | `"ok"`, `"length"`, `"chars"` or `"digit"` |
| `url(vin)` | vPIC's decode URL for a VIN that checks (§4) | a string, or `null` |
| `decode(body)` | vPIC's parsed JSON → the car (§5) | `{year, make, model}`, or `null` |
| `key(s)` | the matching key of a name (§6) | a string |
| `match(dec, D)` | a decoded car → `setCar`'s arguments in the tables' own spelling (§7) | `{make, model, year}`, or `null` |

## 2. `clean(text)`

Not a string → `""`. Otherwise, unit by unit: `a`–`z` (0x61–0x7A) become `A`–`Z` (minus 0x20); a space (0x20), tab (0x09), line feed (0x0A), carriage return (0x0D) or hyphen-minus `-` (0x2D) is dropped; every other unit is kept as it is. `" 1hgcm8-2633a004352\n"` → `"1HGCM82633A004352"`.

## 3. `check(vin)`

In this order, the first that applies:

1. Not a string, or its length isn't 17 → `"length"`.
2. Any unit not in `ALLOWED = "0123456789ABCDEFGHJKLMNPRSTUVWXYZ"` (no `I`, `O`, `Q`, no lowercase) → `"chars"`.
3. The check digit (49 CFR 565.15). Each character's value: a digit is itself; letters are `A1 B2 C3 D4 E5 F6 G7 H8 J1 K2 L3 M4 N5 P7 R9 S2 T3 U4 V5 W6 X7 Y8 Z9`. Weights by position 1–17: `8 7 6 5 4 3 2 10 0 9 8 7 6 5 4 3 2`. `r = (Σ value × weight) % 11`; the expected 9th character is `"X"` when `r === 10`, else `String(r)`. `vin.charAt(8)` isn't it → `"digit"`.
4. Otherwise `"ok"`.

`check` doesn't `clean` first: the page calls `check(clean(text))`.

Worked: `1HGCM82633A004352` (NHTSA's sample, a 2003 Honda Accord). Values 1 8 7 3 4 8 2 6 3 3 1 0 0 4 3 5 2; products 8 56 42 15 16 24 4 60 0 27 8 0 0 20 12 15 4; sum 311; 311 % 11 = 3; the 9th character is `3` → `"ok"`.

## 4. `url(vin)`

`check(vin) === "ok"` → `"https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/" + vin + "?format=json"`. Else `null`.

## 5. `decode(body)`

`body` is whatever `JSON.parse` returned for vPIC's answer (any value). `null` unless all of these hold:

- `body` is an object; `body.Results` is an array with at least one element; `r = body.Results[0]` is an object.
- `r.ModelYear` is a string whose trimmed text is four digits `[0-9]{4}`, and that number is in 1900–2100. That's `year` (an integer).
- `r.Make` and `r.Model` are strings whose trimmed text isn't empty. Those trimmed strings are `make` and `model`. "Trimmed" removes leading and trailing spaces, tabs, line feeds and carriage returns only.

Returns the new object `{year, make, model}`. vPIC's `ErrorCode` and `ErrorText` are not read: an answer that names a year, make and model is used, and one that doesn't (an unknown manufacturer gives empty strings) is `null`. Nothing else in `r` is read; in particular vPIC's fuel type is not used for any number (D-038).

## 6. `key(s)`

Not a string → `""`. Otherwise, unit by unit: `A`–`Z` become `a`–`z`; `a`–`z` and `0`–`9` are kept; every other unit is dropped. `"F-150"` → `"f150"`, `"MERCEDES-BENZ"` → `"mercedesbenz"`, `"Bolt EV"` → `"boltev"`, `"330i"` → `"330i"`.

## 7. `match(dec, D)`

`null` unless `dec` is an object with `year` an integer in 1900–2100 and `make`, `model` strings (the shape `decode` returns).

1. `mk = key(dec.make)`. Walk `POD.state.carMakes(D)` in its order and take the **first** make `m` with `key(m) === mk`, when `mk !== ""`. None → return `{make: "Other", model: "", year: dec.year}`.
2. `md = key(dec.model)`. Walk `POD.state.carModels(D, m)` in its order and take the first model `n` with `key(n) === md`, when `md !== ""`. None → `n = ""`.
3. Return the new object `{make: m, model: n, year: dec.year}`.

There's no prefix, substring or fuzzy step (D-038): vPIC's `330i` doesn't become EPA's `3 Series`, and `F-150` doesn't become `F-150 Lightning`. The page passes the result to `POD.state.setCar(S, D, make, model, year)` and then reads `carLookup` to say what it found (UI contract §6b).

## 8. The fixtures

`tests/fixtures/vin/`:

- `vpic/*.json`: vPIC's own answers, recorded 2026-11-16 from `DecodeVinValues` (README lists each VIN and what it decodes to). They are inputs to `decode` and to the e2e. Their VINs are made from real VIN patterns with a correct check digit and an arbitrary serial number, except NHTSA's published sample `1HGCM82633A004352`, so no one's car is in the repo.
- `cases.json`: hand-worked cases `{id, fn, args, expect, work}` for every function, with the arithmetic or the rule in `work`. `D` for `match` is a small made-up table in the file (`datasets`), so the cases don't move when `cars.js` is rebuilt.

`run.py` checks the reference against every case, then the JS against the reference on the cases and on seeded random strings (`clean`, `check`, `key`). A JS result that differs, or a `vin.js` that's missing while `index.html` loads it, fails the run.
