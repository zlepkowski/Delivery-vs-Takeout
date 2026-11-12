---
name: code-review
description: Review checklist and output format for Pickup or Delivery changes. Covers engine order, the credit tiers, missing-channel handling, purity, ES5 APIs, storage safety, escaping, data provenance, secrets, test integrity and scope. Load when reviewing a diff in this project.
---

# Code review: Pickup or Delivery

You review **one change** against its task card. Your job is to find problems that make the app give a **wrong answer**, crash or leak something, not to restyle code.

A finding needs a **concrete failure scenario**: specific inputs, and then the wrong output or crash. If you can't write one, drop it.

## Blockers (any one means CHANGES-REQUESTED)

1. **Engine order (§4.2).** A step moved, tax isn't on the *discounted* subtotal, tip isn't on the *pre-discount* subtotal, credits aren't last, or discounts aren't jointly clamped to `food`.
2. **Credit tiers (§9.1).** A `restricted` credit applied without `S.creditOptIn[key]`, a `locked` credit applied at all, or a missing `amexGoldDirect` check on the partner path.
3. **`syncCredits` loses user state:** `used` flags, `manual` credits or opt-ins.
4. **A $0 fee used to stand in for a missing route (§9.3).** That includes an unprofiled brand getting a direct-delivery channel.
5. **Impure `calc`.** It reads `POD.S`, the DOM or `new Date()` instead of its arguments, or it mutates `S` or `override`.
6. **DOM access at load time,** or a new bare global outside `POD`.
7. **An ES2015+ API in `src/`** that the syntax gate can't see (`includes`, `find`, `Object.assign`, `Map`, `padStart`, …) and that isn't feature-detected.
8. **`localStorage` touched outside `try/catch`.**
9. **Unescaped data or user text going into `innerHTML`.**
10. **Data problems:** a missing provenance header, a number with no source, an estimate without `est: true`, or `cards.js` edited by anyone but the orchestrator.
11. **A secret or API key** anywhere in the diff, including fixtures and URLs.
12. **Test integrity:** a skipped, loosened or deleted test; an expected value that's evidently copied from the code's output; an assertion that can't fail.
13. **Scope:** a file outside the card's SCOPE was changed.

## Should-fix (they don't block alone; several together do)

- New behavior with no test that would catch its regression.
- Logic that duplicates something already in `POD.util` or another module.
- Money formatted outside `POD.util.money`, or rounded outside `round2`.
- A magic number that belongs in a data table (a fee, a rate, a threshold).
- A render function that patches the DOM instead of replacing the subtree.

## Nits

Only if they genuinely impair reading. Cap them at 3.

## Output format (exactly this)

```
VERDICT: APPROVE | CHANGES-REQUESTED
FINDINGS:
1. [blocker] src/js/engine.js:142 — tip is computed on food − disc
   Scenario: $30 food, 20% promo, 15% tip → expected tip 4.50, code gives 3.60; DoorDash drops below direct pickup
   Fix: compute tip from food before step 4
2. [should-fix] ...
OUT-OF-SCOPE:
- (problems you saw in code this change didn't touch; they don't block)
CHECKED: the checklist items that apply to this diff and passed, e.g. 1, 4, 5, 8, 12, 13
```

"FINDINGS: none" with `VERDICT: APPROVE` is a complete review.

## Learned rules

<!-- The reflector adds rules here. Each one cites its evidence. -->
