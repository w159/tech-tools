# Fix loop

The repair loop is what makes atlas-dogfood a dogfood run rather than a smoke check - and it is also the boundary the skill polices most carefully. The orchestrator never edits app source; every repair goes through dispatched agents, every fix is confirmed independently, and every fix is bounded.

## Entry

A scenario enters the loop exactly once it is judged **Broken** (Phase 5): a genuine, observed break - console error, failed network call, wrong render, data not persisted, broken navigation state. It does NOT enter on: styling taste, unfired curiosity about unrelated routes, or a step blocked by outside interaction (that is `Blocked (needs human verify)`).

## Step 1 - Diagnose (read-only)

Before dispatching any fix, pin the fault to a layer. Use the tester's captured evidence (exact console line, failing request with method/URL/status/response) and a quick read of the implicated files. Classify:

- **FE render/logic** - component crash, wrong prop, bad state transition.
- **API contract** - request shape mismatch, missing endpoint, wrong status handling.
- **Data/validation** - edge input not handled, persistence lost.
- **Environment** - missing env var, unseeded data, stale build. These are not fixes: correct the environment, re-drive, and note it in the report.

If the diagnosis is not obvious within a few minutes of reading, dispatch one `atlas:explorer` with the evidence to localize it. Do not guess-fix.

## Step 2 - Dispatch the fix (`atlas:implementer`)

One implementer per fix, subagent-kit template, with the failure attached verbatim:

```
ROLE: atlas:implementer
GOAL: Fix <one-line symptom> in <file/area> so scenario <id> passes: <the failing step>.
CONTEXT: Evidence: <console line / network entry / screenshot path>. Suspected cause: <your diagnosis>. Repo conventions: AGENTS.md.
TOOLS (required): <batched ToolSearch line per subagent-kit>
DELIVERABLE: Minimal fix + a regression test that fails without the fix and passes with it.
SUCCESS CRITERIA: Targeted test for the affected area fails pre-fix, passes post-fix (paste both outputs); no other test in the affected area regresses.
OUT OF SCOPE: Refactoring, style changes, anything outside the implicated files, product behavior changes.
STOP CONDITIONS: The fix requires a schema change, a new dependency, or a product decision - stop and return DECISION NEEDED.
```

## Step 3 - Independent verification (`atlas:verifier`)

Every fix is confirmed by a fresh `atlas:verifier` that did not see the fix being made (never the implementer grading itself). Give it: the original failure evidence, the diff of the fix, and the regression test. It re-runs the targeted tests and adversarially checks the fix does what is claimed and nothing else. A `rejected` verdict sends the item back to a fresh implementer with the failure attached.

## Step 4 - Re-drive the scenario

Marking `Fixed` requires an observed green re-drive, not a passing test alone: dispatch a fresh `atlas:ui-runtime-tester` with the original scenario steps and the same evidence directory (suffix the evidence slug `-refix-<n>`). Only an observed pass with cited evidence flips the matrix row to `Fixed` (with fix summary + regression test path). If the re-drive fails, count it as an attempt and re-enter at Step 1 with the new evidence.

## Budget and escalation

- Budget: `--fix-budget N` attempts per scenario, default **2**. An attempt = one implementer dispatch + verifier + re-drive. Over budget -> the scenario ends `Blocked (human decision)`.
- Three failed implementer attempts on one problem is the subagent-kit signal regardless of budget: stop and mark `Blocked (human decision)`.
- Escalate to the report's **Decisions for a human** section (never implement to clear the matrix) any fix that: needs an architectural or schema decision, alters product behavior or UX intent, spans many files, or has plausible competing solutions. State the observed failure, the diagnosis, and 2-3 options.
- The loop fixes the diff's scope only. A break in a route the diff cannot affect is recorded as a finding (`atlas_finding.py`, status as observed) and left for `atlas-debug` / the user - out of dogfood scope.

## Regression test rule

A fix is not done until a regression test **fails before the fix and passes after** (implementer proves both outputs), or the report records why no automated regression test was meaningful (e.g. purely visual layout fix with no DOM delta). The test lives in the project's existing test suite, follows its conventions, and stays uncommitted with the fix.

## Committed state

Nothing in the loop commits. At run end the working tree carries: the fixes, the regression tests, and nothing else. The report's working-tree section lists the changed files and states explicitly that commit/push awaits user confirmation.
