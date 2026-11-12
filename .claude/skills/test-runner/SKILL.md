---
name: test-runner
description: How Pickup or Delivery is tested. Covers the layout, commands, the VM script loader, the e2e harness on file://, the differential oracle, and the rules for where expected values come from. Load before writing, running or diagnosing tests under tests/.
---

# Test rules: Pickup or Delivery

## Layout

```
tests/
  helpers/load.js        loadApp(): runs the real src/ scripts in a DOM-less VM, in index.html order
  unit/*.test.js         node:test. Engine, geography, state, data schemas, tools
  e2e/*.e2e.js           node:test + Playwright, loading index.html from file://
  e2e/screenshots/       written by e2e (gitignored)
  oracle/                Python reference engine + fuzzer (Phase 2)
  fixtures/              small committed inputs: store tiles, receipts, API recordings
```

## Commands (run from the repo root)

| Command | Runs |
|---|---|
| `npm test` | everything, in order: es5 → unit → oracle → e2e |
| `npm run test:es5` | the ES5 syntax gate over `src/` |
| `npm run test:unit` | `node --test "tests/unit/**/*.test.js"` |
| `npm run test:oracle` | `python3 -I tests/oracle/run.py` |
| `npm run test:e2e` | Playwright, one file at a time |
| `node --test tests/unit/x.test.js` | a single file |
| `node --test --test-name-pattern="§9.4" "tests/unit/**/*.test.js"` | by name |

## Loading the app in unit tests

```js
const { loadApp } = require('../helpers/load');
const { POD } = loadApp();                                 // all scripts
const { POD } = loadApp({ only: ['pod.js', 'engine.js'] }); // a subset, still in index.html order
const sb = loadApp({ globals: { localStorage: throwingStorage, Date: FixedDate } });
const sb2 = loadApp({ extra: ['tests/fixtures/stores/40_-74.js'] });
```

- Each `loadApp()` call gives a fresh, isolated sandbox. Don't share state between tests.
- **Inject time.** Anything date-dependent (the `syncCredits` dated-credit branch, credit reset timing) is tested with a fixed `Date` passed through `globals`.
- To test storage failures, pass a `localStorage` whose methods throw.

## Where expected values come from

This is the rule that matters most:

- **Allowed:** the spec, the orchestrator's hand-worked receipts in `tests/fixtures/receipts/` (each shows its arithmetic), and the Python oracle.
- **Never:** running the code under test and pasting what it printed. That tests nothing.
- Compare money with exact equality after `round2`, e.g. `assert.equal(r.net, 15.62)`. The engine already rounds each component (D-012), so there's no tolerance.

## Writing a test

- **Start the name with its spec reference:** `'§9.4 tip uses the pre-discount subtotal'`. Use `'D-006 …'` for a decision, or `'ISS-012 …'` for a regression test.
- **One behavior per test.** Make the arrange step readable: build the state with `POD.state.fresh()` and set only the fields that matter.
- **Every new behavior gets a test that would fail if the behavior broke.** Check this by reasoning through the mutation: "if step 5 used the pre-discount subtotal, this test's expected tax would be X, not Y."
- **Fixtures stay small.** Use a few store tiles (NYC `40_-74`, which covers both Brooklyn and Midtown, and Big Timber `45_-110`), never the full dataset.

## e2e

- Load `index.html` over `file://` (`pathToFileURL`). That's the strictest environment the page has to support.
- **Fail on any** `console` error or `pageerror`. Collect them from the first navigation onward.
- Two viewports: phone 390×844 and desktop 1280×800. Assert there's no horizontal overflow.
- Use `data-testid` selectors, and wait with `waitForSelector` or `locator.waitFor`. **Never a fixed sleep.**
- Screenshots go to `tests/e2e/screenshots/<test>-<viewport>.png`, which the orchestrator reviews.

## Oracle (Phase 2 on)

- `tests/oracle/engine.py` is an independent Python version of §4.2, written by the orchestrator. **Don't edit it to match the JS.** If they disagree, report it: one of them is wrong, and the orchestrator decides which.
- `run.py` generates N seeded random scenarios, runs both engines and diffs every receipt line. On a failure it prints the seed and the first mismatching line.

## Never

- `test.skip`, `.todo`, commenting out, loosening an assertion or deleting a test to get green.
- Editing `src/` from a test task.
- Network access in unit tests.

## Reporting a failure

```
FAIL tests/unit/engine.test.js:88  '§9.4 tip uses the pre-discount subtotal'
  expected 4.20, actual 3.78
  diagnosis: tip is being computed after the promo is applied (engine.js:142)
```

## Learned rules

<!-- The reflector adds rules here. Each one cites its evidence. -->
- **Pin every lookup table to the source's own list, item by item.** A test that checks shape and range passes a state filed under the wrong PADD. Assert the expected group for each row from the source (c539fc3: DE, DC, MD on 1C, 12/12 green).
- **Pin aggregates by value, with independent expected numbers.** Cover an even count, a .5 rounding case and a min-vs-median case. A shape test passes a median that returns the minimum (1.7 review, findings 1 and 2).
- **Quote the issuer sentence beside every pinned credit amount.** A reimbursed membership is not an included one. The Platinum test pinned an over-credit because the card row said so (83f24d7, blocker).
- **Read data through `tests/helpers/data.js` `loadData()`, and compare with literals.** A `deepEqual` against `[]` fails on VM-realm arrays even when they're empty (ISS-008, 8962e13).
- **Run destructive negative tests on a throwaway copy in the scratch directory, never the real repo, even when a card's DONE WHEN says to.** The task 1.8 fix card ran `rm -rf` guard tests against the real repo. The guard held by luck (69b429b). If the card says otherwise, report NEEDS-CARD.
- **Every generator rule that rejects input gets a failing-input test,** a fixture that must exit non-zero with the rule's message (platform evidence with no https URL: 56cc487, 1.7 review 3a; ISS-011 is still open for the cars generator). **A rule enforced only by a test gets a mutation check:** break the data in a scratch copy and show the test fails (observation ZIP vs state, 1.7 review 3b).
