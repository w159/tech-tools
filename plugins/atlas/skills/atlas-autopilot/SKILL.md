---
name: atlas-autopilot
description: Atlas's autonomous end-to-end pipeline and its SAFER, consent-gated equivalent of Compound Engineering's `lfg` - NOT a literal behavioral clone. Routes an incoming request to a verified work source (an atlas-plan implementation-ready plan artifact, or a diagnosed atlas-debug fix), executes it through atlas-orchestrate with independent verification, runs atlas-simplify, runs atlas-review in report-only mode and applies only high-confidence mechanical fixes through atlas:implementer under a bounded repair budget, persists residual findings, runs atlas-compound when durable learning exists, runs atlas-dogfood/atlas-test-browser where the change is UI-shaped, and reaches the shipping tail - where it hard-stops after local commit and requires explicit user confirmation before any push, PR, or merge (CE's lfg auto-pushes, auto-opens PRs, and auto-babysits CI; atlas-autopilot never does). Use when the user wants the whole loop run end to end with minimal interruption but still wants to be asked before anything externally visible.
when_to_use: the user wants a complete plan or diagnosed fix executed end to end autonomously through execution, simplification, review, and local commit, with an explicit confirmation stop before any push/PR/merge
allowed-tools: Read, Glob, Grep, Bash, Edit, Write, Agent, Task
argument-hint: '[plan-path | debug finding | task description] [budget:3]'
---

# atlas-autopilot

**This skill is atlas's safer, consent-gated equivalent of Compound Engineering's `lfg`: it diverges from `lfg` in one load-bearing way - after a local commit it STOPS and requires your explicit confirmation before any push, pull request, or merge; `lfg` auto-pushes and auto-opens PRs, and atlas-autopilot never does, no exceptions.** Everything else about the pipeline preserves `lfg`'s machine gates in spirit: only a genuinely complete, independently verified implementation return advances the pipeline; a divergent or ambiguous product-shape question routes to `atlas-brainstorm` for a human decision instead of being silently guessed; and bounded repair budgets (default 3 rounds) mean a loop that exhausts its budget states so plainly and stops rather than spinning forever or silently declaring success.

## What this is

`atlas-autopilot` is the composition skill atlas currently lacks: it runs the whole loop - source gating, execution, simplification, review, residual capture, learning, UI testing, local commit - with minimal interruption, then parks at the shipping gate and asks. It is a **dispatcher and gate-keeper, not a worker**: it never edits target source code itself, it routes each stage to the skill or agent that owns it, and it owns the stop conditions.

## How it differs from its neighbors

| | atlas-autopilot (this skill) | atlas-orchestrate | atlas-loop | atlas-ship |
|---|---|---|---|---|
| Scope | one full work item, source to local commit | any multi-stage task, plans its own stages | recurring/iterative work on a cadence | push + PR + babysit, consent-gated |
| Intelligence | pipeline is fixed; it routes and gates | plans stages per task | matches a loop spec | none; executes the tail |
| Autonomy | autonomous until the shipping gate | autonomous after activation, evidence-gated | bounded by stop condition | never acts without confirmation |
| Push/PR | **never without explicit user consent** | never (orchestrator consent model) | gated per loop | push/PR is its whole job, on consent |

Use this skill when the user says "run the whole thing," "take it from plan to done," or names a plan artifact and wants it shipped to local commit. If the work is recurring rather than one-shot, use `atlas-loop`. If it needs a bespoke multi-stage plan rather than the fixed pipeline, use `atlas-orchestrate` directly.

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

## Hard behavioral lines

1. **Push, PR, and merge always require explicit user confirmation.** The pipeline runs autonomously through local commit and then STOPS. `atlas-ship` and `atlas-babysit-pr` are invoked only after the user says yes at the gate. There is no flag, budget, or CI pressure that waives this.
2. **Only a verified, complete work return advances.** Execution (via `atlas-orchestrate`) must return with independent verification evidence - verifier verdicts stamped in `.atlas/.run/findings.json`, red/green or runtime proof under `.atlas/evidence/`. A partial, unverified, or self-graded return does not advance to simplify/review/commit; recover or re-dispatch first.
3. **Ambiguous product shape routes to a human, never to a guess.** If mid-pipeline the work forks into a genuine product decision (divergent fix choice, unsettled scope, competing UX shapes), stop the pipeline and route to `atlas-brainstorm`. Do not pick silently; do not implement the most convenient branch.
4. **Repair budgets are hard.** The review-fix loop and (post-consent) CI-repair loop each get a bounded budget, default 3 rounds. On exhaustion with issues remaining: write the residual state, state plainly what failed and why, and stop. Never loop forever, never declare success with known issues.
5. **Review is report-only; mutation is filtered and delegated.** `atlas-review` findings are applied only when they are high-confidence AND mechanically safe, and only through `atlas:implementer` dispatches - never by editing inline in this skill, never because severity looked scary.
6. **Residuals are persisted, not dropped.** Every finding not applied, every deferred decision, every budget exhaustion lands in `.atlas/.run/findings.json` and, where durable, in `docs/ROADMAP.md` - the next session must be able to see what was left on the table and why.

## The pipeline

Eleven steps, in order. Each step has a machine gate; a failed gate stops the pipeline at that step with a plain-language report. The full per-step contracts - routing precedence, source gates, the simplify skip threshold, the mechanical-fix filter, residual formats, and the shipping-gate dialogue - live in the references. Read each reference at the step that needs it, not upfront.

| Step | What happens | Gate | Reference |
|---|---|---|---|
| 1. Intake & route | Classify the input: named plan artifact, diagnosed defect, or raw task | A verified source exists or is produced | `references/pipeline.md` § Intake routing |
| 2. Execute | Run the plan's units or the debug fix through `atlas-orchestrate` | Complete + independently verified return, findings stamped | `references/pipeline.md` § Execution gate |
| 3. Simplify | `atlas-simplify` on the change (skip docs-only or < ~10 changed lines) | Behavior-preserving; blast-radius check passes | `references/pipeline.md` § Simplify |
| 4. Review | `atlas-review` in report-only mode | Report produced; P0/P1 validated | `references/pipeline.md` § Review |
| 5. Apply mechanical fixes | High-confidence + mechanical findings only, via `atlas:implementer`, budget-bounded | Budget not exhausted, or residuals persisted | `references/pipeline.md` § Fix loop |
| 6. Persist residuals | Unapplied findings and deferred decisions into findings ledger + ROADMAP | Every residual written with its reason | `references/pipeline.md` § Residuals |
| 7. Compound | `atlas-compound` only when durable learning exists that code/tests/plan do not already carry | One qualifying learning, or explicit skip | `references/pipeline.md` § Compound |
| 8. UI testing | `atlas-dogfood` / `atlas-test-browser` when the change is UI-shaped | Live-browser evidence, or step skipped with reason | `references/pipeline.md` § UI testing |
| 9. Local commit | `atlas-commit` (local only, run-owned files) | Commit lands clean | `references/shipping-gate.md` |
| 10. **STOP: consent gate** | Present the run summary; ask before any push/PR/merge | **Explicit user yes, or the run ends here** | `references/shipping-gate.md` § The gate |
| 11. Ship & babysit (consent only) | `atlas-ship`, then `atlas-babysit-pr` with a bounded CI-repair budget; close out with residuals and DONE | Post-consent only | `references/shipping-gate.md` § After consent |

## No-source behavior

If the input names no plan artifact and no diagnosed defect, do not improvise an execution. Route per the intake table: an implementable-but-underspecified task goes to `atlas-plan` first (and to `atlas-brainstorm` first if the product shape itself is unsettled); a non-code request routes to its owning skill and the pipeline ends. The pipeline consumes verified sources; it does not manufacture them.

## Budget

The repair budget applies to the review-fix loop (step 5) and, after explicit consent, the CI-repair loop (step 11). Default: **3 rounds each**, override with `budget:N` in the invocation. A round is one implementer dispatch plus its verification. Count every round, even ones that fix nothing. Exhaustion is a normal, reportable outcome - the failure mode this gate exists to prevent is silent infinite repair.

## REPORT

- The routing decision (source used, why) and the plan/defect path.
- Per-step outcomes with evidence: verification verdicts and finding paths from execution, simplify counts, review verdict, fixes applied/skipped with the filter reasons, residuals written (paths), compound skip-or-write, UI evidence or skip reason.
- The commit SHA and changed-file summary.
- The consent-gate summary as it will be presented to the user, and - if the user consented - the push/PR outcome, CI/babysit rounds used against budget, and the closeout residuals.
- If the pipeline stopped early: which gate failed, exactly what is unverified or unresolved, and what the user needs to decide.
