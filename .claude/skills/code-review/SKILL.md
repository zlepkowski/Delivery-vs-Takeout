---
name: code-review
description: Review checklist and output format for Pickup or Delivery changes. Covers engine order, the credit tiers, missing-channel handling, purity, ES5 APIs, storage safety, escaping, data provenance, secrets, test integrity and scope. Load when reviewing a diff in this project.
---

# Code review: Pickup or Delivery

You review **one change** against its task card. Your job is to find problems that make the app give a **wrong answer**, crash or leak something, not to restyle code.

A finding needs a **concrete failure scenario**: specific inputs, and then the wrong output or crash. If you can't write one, drop it.

## Blockers (any one means CHANGES-REQUESTED)

1. **Engine order (§4.2, as amended by `docs/engine-contract.md` §5; D-029).** A step moved, tax isn't on the *discounted* subtotal, tip isn't on the *pre-discount* subtotal, credits aren't last, or discounts aren't jointly clamped to `food`.
2. **Credit tiers (§9.1).** A `restricted` credit applied without `S.creditOptIn[key]`, a `locked` credit applied at all, or a missing `amexGoldDirect` check on the partner path.
3. **`syncCredits` loses user state:** `used` flags, `manual` credits or opt-ins.
4. **A $0 fee or 0% markup used to stand in for a missing route or value (§9.3, ba25e38).** That includes an unprofiled brand getting a direct-delivery channel, and a code default such as `markup {}` for a missing category.
5. **Impure `calc`.** It reads `POD.S`, the DOM or `new Date()` instead of its arguments, or it mutates `S` or `override`.
6. **DOM access at load time,** or a new bare global outside `POD`.
7. **An ES2015+ API in `src/`** that the syntax gate can't see (`includes`, `find`, `Object.assign`, `Map`, `padStart`, …) and that isn't feature-detected.
8. **`localStorage` touched outside `try/catch`.**
9. **Unescaped data or user text going into `innerHTML`.**
10. **Data problems:** a missing provenance header, a number with no source, an estimate without `est: true`, or `cards.js` edited by anyone but the orchestrator.
11. **A secret or API key** anywhere in the diff, including fixtures and URLs.
12. **Test integrity:** a skipped, loosened or deleted test; an expected value that's evidently copied from the code's output; an assertion that can't fail; a test that still passes on the old shape after a data shape change (0f907b5).
13. **Scope:** a file outside the card's SCOPE was changed. Docs count too: an entry appended to `docs/issues.md` or `docs/decisions.md` outside SCOPE is a blocker (Phase 4 builder's ISS-031 append).

## Should-fix (they don't block alone; several together do)

- New behavior with no test that would catch its regression.
- Logic that duplicates something already in `POD.util` or another module.
- Money formatted outside `POD.util.money`, or rounded outside `round2`.
- A magic number that belongs in a data table (a fee, a rate, a threshold).
- A render change that replaces the whole page, or a subtree holding a control the user may click, instead of writing only the changed blocks (ui-contract amendment, 5f60686).

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
- **Blocker, mapping tables: check each changed row against the source, not against the tests.** DE, DC and MD on the wrong PADD passed every test (c539fc3).
- **Blocker, platform citations: a `platforms` claim cited to Drive, a "powered by" story, a white-label deal or an unopened snippet is a phantom platform.** Open the URL and check it's a marketplace listing. Little Caesars cited a Drive deal (e1bc046); Domino's cited a snippet (ec5e627).
- **Profile diffs: spot-check every item name (size, piece count, spelling) against the cited page, and open one URL per platform.** The 1.7 medians re-fetched correctly; the errors were in names and citations (ec5e627, 7af787d, 0a4262b).
- **Blocker, credits: each `cards.js` row's "included" claim must match the issuer sentence.** Amex Platinum was marked as including Uber One, which the card only reimburses (83f24d7).
- **Should-fix, issue log: a new `ISS-nnn` must be unused and sit under `## Open`.** Check `grep -o '^### ISS-[0-9]*' docs/issues.md | sort | uniq -d` prints nothing. Duplicate IDs (2fbdac1, c5f8b19, e1bc046) and open issues filed under Closed (3f44708) each needed a renumber.
- **Blocker, stale derived value: when an input changes, check that every derived field it feeds is recomputed or cleared, never kept.** Switching brand while tiles loaded kept the previous trip and priced the new brand. The 4.3 code review found it; the contract was amended (9a17357). The same holds when a field switches between derived and typed: a listed car changed to "Other" kept 46 mpg (e705a87, da81998).
- **Blocker, credit readers: check that every module that reads credits applies the §9.1 tier, not only `calc`.** Wallet and Timing needed the restricted gold-partner gate too; the reviewer caught it before it shipped (f10e69f).
- **Should-fix, re-render: a change that replaces a control the user can click right after typing needs a type-then-click e2e that checks the element survived with focus.** Without it a click is lost when a text box commits on the same mousedown. The second Phase 6 review found a select detached by a settings commit that the first review missed (5f60686, 2f657df, 3502730).
- **Should-fix, test integrity: a new test file must catch its own mutants.** A hole covered only by another file's tests is still a hole. The Phase 4 state tests missed four such holes (a7861b6).
- **Should-fix, optional inputs: review a missing and a malformed value for each optional field, not only the fuzzer's shapes.** The first engine passed 10,000 scenarios, yet a `directSvc` with no `modes` threw and a deal with no `scope` never applied (793577b, c4e21c4). Phase 6's per-item generator rules had untested rejections, and review found a dropped `0 <= v` check that every test passed (0f907b5). A throw inside `calc` or `allResults` is a blocker, because it takes the page down.
