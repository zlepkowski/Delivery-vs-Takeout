---
name: reflect
description: End-of-phase retrospective procedure for Pickup or Delivery. Turns the phase's real failures (issues, review findings, blocked tasks, fix rounds) into short, evidence-backed rules in the other skills, and prunes rules that no longer earn their place. Load only for the reflector's end-of-phase pass.
---

# Reflect: rewrite the other skills from evidence

The skills are the workers' memory. Each worker starts cold and knows only its skill. A mistake that isn't written into a skill will happen again next phase. A skill that keeps growing gets skimmed, so pruning matters as much as adding.

## What you may edit

- **Yes:** `.claude/skills/{frontend,backend,data-research,test-runner,code-review}/SKILL.md`, but only the `## Learned rules` section. You may also sharpen a sentence elsewhere when the evidence shows it was misread.
- **No:** this skill, any agent file, `CLAUDE.md`, source code, tests, or the frontmatter `name` of any skill.
- **Never remove or weaken** an invariant that comes from BUILD.md: the §4.2 engine order, the §9 traps, ES5, the never-invent-a-number rule, or the test-integrity rules. You may add clarifications to them.

## Procedure

1. **Gather evidence** for the phase:
   - `docs/issues.md` entries opened or closed in the phase
   - the review findings and BLOCKED reports the orchestrator gives you
   - `git log --oneline <range>` and `git show` on commits that were fix rounds
2. **Group by root cause, not symptom.** "Used `Array.includes` in geo.js" and "used `Object.assign` in state.js" are one cause: ES2015 APIs slipping past the syntax gate.
3. **Decide what earns a rule.** A cause needs at least one of these:
   - it happened **2+ times**, or
   - it cost a worker its **whole loop budget**, or
   - it was a **blocker** in review.
4. **Write the rule in the skill of the agent who would have prevented it.** That's the one who made the mistake, or the reviewer if review should have caught it earlier.
   - Make it imperative and specific, 1–2 lines, followed by the evidence:
     `- Pass `now` into syncCredits; never call new Date() inside it. (evidence: ISS-004, 3f2a1bc)`
   - If an existing rule already covers it and was ignored, **reword that rule** to be harder to miss. Don't add a duplicate.
5. **Prune** every skill you touch:
   - merge duplicate or overlapping rules
   - delete rules made obsolete by later decisions (cite the decision)
   - keep each SKILL.md **≤ 250 lines**
6. **Log** to `docs/decisions.md`:

```
## Skill updates — Phase N (YYYY-MM-DD)
- frontend: + "Pass now into syncCredits…" (ISS-004, 3f2a1bc)
- test-runner: ~ merged two fixture-size rules
- code-review: − removed "check ZIP3" (obsolete: D-009)
```

## Don't learn from

- one-off typos, or a mistake that was caught and fixed in the same loop
- environment noise: network blips, a flaky tool or a sandbox limit (the orchestrator tracks those in issues.md)
- anything you can't point to evidence for

## Output

Return the report format from your agent file. If nothing qualifies, return `NOTHING-TO-LEARN` and list what you looked at. That's a fine result.
