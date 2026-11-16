# CLAUDE.md

## What this repo is

**Pickup or Delivery**: is delivery, app pickup or ordering direct cheapest once fees, markup, deals, card credits and gas are priced in? The whole repo is this one app (decision D-018): `index.html`, `src/`, `tests/`, `tools/` and `docs/` sit at the root, next to `.claude/` and this file.

## Read first, in this order

1. `docs/progress.md`: which phase we're in, what's done and the next step
2. `docs/decisions.md`: v5 decisions. **These override BUILD.md** where they differ
3. `docs/issues.md`: open blockers and questions
4. `docs/BUILD.md`: the spec. Read the sections the current phase needs, not all of it

## How work gets done

**The main session (Opus) orchestrates. The Haiku workers in `.claude/agents/` build.** Each worker preloads exactly one skill from `.claude/skills/`:

| Agent | Skill | Use for |
|---|---|---|
| `builder` | `frontend` | engine, geography, state, UI, insights, deep links |
| `api-builder` | `backend` | Worker and `api.js` (Phase 8) |
| `researcher` | `data-research` | datasets and generator scripts. **Never `cards.js`** |
| `tester` | `test-runner` | writing tests; running the suite at the end of a phase |
| `reviewer` | `code-review` | a read-only review of every change before commit |
| `reflector` | `reflect` | end of phase: rewrites the other skills from that phase's evidence |

### The orchestrator does these itself

- writes task cards and decides scope
- writes the Python oracle (`tests/oracle/`) and the hand-worked receipts (`tests/fixtures/receipts/`), **before** the builder touches the engine
- researches and authors `src/data/cards.js` (§9.1 risk is too high to delegate)
- re-verifies everything, reviews screenshots, approves the reflector's edits, commits

### Dispatching a worker

If the named agents (`builder`, `researcher`, ...) are loaded in this session, call them by name. If they aren't (agents load only at session start, so a session that began before `.claude/agents/` existed can't see them), dispatch a `general-purpose` agent with `model: haiku` and start its prompt with: *"You are the `<name>` worker. First read `.claude/agents/<name>.md` and `.claude/skills/<skill>/SKILL.md` and follow them exactly."* followed by the task card. Same rules, same report format (D-019).

### Task card (every worker dispatch)

```
GOAL:      one observable end state
DONE WHEN: exact commands (run from the repo root) that must all exit 0
SCOPE:     files the worker may create or edit
MAX LOOPS: 4 unless there's a reason
CONTEXT:   spec sections (§n), decision IDs (D-nnn), known traps
```

### The verification loop

1. **Dispatch** the worker with its card. It loops verify→fix, up to MAX LOOPS, then returns DONE, BLOCKED or NEEDS-CARD.
2. **Re-run every DONE WHEN command yourself.** Never trust a worker's report. If the output doesn't match what it reported, treat the task as failed.
3. **Dispatch the reviewer** with the card and the diff.
4. If there are findings or failures, write a **new card** back to the worker, for at most **2 fix rounds**. After that, fix it yourself or log it in `issues.md` and re-plan.
5. **Commit** one verified task per commit, then update `docs/progress.md`.
6. **End of phase:** the tester runs the full suite → the orchestrator reviews the e2e screenshots → the reflector proposes skill edits → the orchestrator approves or reverts them → progress.md is updated → the user sets the next `/goal`.

## Hard rules (every agent)

- **ES5 only in `src/`.** No framework, no runtime dependencies, and `index.html` must work from `file://`.
- **`calc` is pure**, and the §4.2 order is load-bearing. Respect the §9 traps.
- **Never invent a data number.** Every data file carries a provenance header.
- **Never skip, loosen or delete a test** to get green. Expected values never come from the code under test.
- **No secrets in the repo.**
- **Only the orchestrator commits.** Branch: the session's assigned branch; `docs/progress.md` names the current one (merges to `main` by PR, only when the user asks). Push with `git push -u origin <branch>`.

## Commands (from the repo root)

```
npm test               # es5 gate → unit → oracle → e2e
npm run test:unit      # node:test
npm run test:e2e       # Playwright over file://
npm run test:oracle    # Python reference engine vs JS (Phase 2+)
npm run test:es5       # syntax gate on src/
```

## Context hygiene

- Auto-compact fires at 60% (`.claude/settings.json` → `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`; see ISS-006 if that file is missing). It takes effect at session start.
- Keep `docs/progress.md` current enough that a **fresh session can resume from it alone**. Start a new session at each phase boundary.
- Ask workers for short reports (≤30 lines). Don't paste whole files into worker prompts; give paths.
