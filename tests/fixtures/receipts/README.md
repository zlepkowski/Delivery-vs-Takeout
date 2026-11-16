# Hand-worked receipts

The orchestrator works these out by hand from [`docs/engine-contract.md`](../../../docs/engine-contract.md), with the arithmetic shown in each case's `work`. They are the expected values for the engine tests (test-runner skill: expected values come from the spec, these receipts or the oracle, never from the code under test). `python3 -I tests/oracle/run.py` checks every case against the Python oracle and, once `src/js/engine.js` exists, against the JS engine.

## Format

- `_base.json`: `{about, S}`, the base engine state. Menu items are objects `{name, price, dealItem, markup?}` (D-036); a receipt that changes the menu gives the whole array.
- `rNN-*.json`: `{id, title, refs, dataNote?, patch, cases}`.
  - The receipt's state is `merge(base.S, patch)`, and each case's state is `merge(thatState, case.patch)`.
  - **merge:** objects merge key by key, except `cart`, `creditOptIn` and `markup`, which replace whole (their keys are data). Anything else (numbers, strings, arrays, null) replaces.
- A case is `{call, channel?, override?, patch?, expect, work?}`, where `call` is `calc`, `allResults` or `cartInfo`.
  - `calc`: `expect` names the result fields to check (any subset of the contract's §6 result). Lines are compared exactly, in order. `{"result": null}` means the channel must be unavailable.
  - `allResults`: `expect.order` is the channel ids in ranked order, and `expect.net` maps ids to nets.
  - `cartInfo`: `expect` is a subset of `{menuSub, dealSub, qty, eligQty, dealReady, shortBy}`.
- Money compares with exact equality: every value is already rounded to the cent (D-012).

## Adding one

Work it by hand first, write the arithmetic in `work`, then run the oracle. If the two disagree, find out which is wrong before changing either.
