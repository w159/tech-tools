# Polish loop: iterate and converge

The core iteration protocol. The orchestrator (this skill) runs it; subagents execute single bounded steps and never talk to the user.

## Wait for observations

The user browses the live page and reports what could be better. Collect their observations verbatim; do not translate them into your own backlog, and do not start any review pass of your own while they browse. Scope-check each observation against the polish boundary: visual, spacing, motion, transitions, micro-interactions, or the *feel* of existing loading/empty/error states are in scope. New functionality, new components, or new screens route to `atlas-frontend` / `atlas-component` / `atlas-feature` - tell the user and skip the item.

## Iteration protocol (per requested change)

One loop per change; never batch unrelated surfaces:

1. **Inspect only as needed.** Locate the component/token governing the observation. A quick `Glob`/`Grep`/`ctx_search` on the named surface is enough for a one-file CSS tweak; dispatch `atlas:explorer` only when the change spans several unknown files.
2. **Dispatch `atlas:implementer`** with the subagent-kit brief shape (ROLE / GOAL / CONTEXT / TOOLS / DELIVERABLE / SUCCESS CRITERIA / OUT OF SCOPE / STOP CONDITIONS / REPORT BACK) for one bounded edit: the observation in the user's words, the file(s) and line(s), and the constraint that behavior stays frozen. Tiny related tweaks to the same component may share one dispatch; unrelated surfaces never do. The implementer runs the local gate and captures a screenshot of the changed state to `.atlas/evidence/<YYYY-MM-DD>-polish-<slug>/`.
3. **Re-observe live.** Dispatch `atlas:ui-runtime-tester` to confirm the change on the running page after hot reload: the edit is visible, the console is clean, adjacent interactions still work, and before/after screenshots land in the same evidence directory. Its report cites evidence paths, not impressions.
4. **Show the user.** Present the before/after evidence and ask whether to accept, refine, or revert. They are the acceptance gate; a rejected change goes back to a fresh `atlas:implementer` dispatch with their refinement attached, or is reverted outright. Three failed attempts on one change: mark it blocked, move on, report it at close.
5. **Next observation.** Return to step 1 until the user says they are done.

Subagents cannot reach the user; every acceptance/rejection decision flows through you. Batch your questions to the user rather than interrupting per micro-change when several iterations are in flight.

For empty/loading/error-state polish, hold the quality bar in `${CLAUDE_PLUGIN_ROOT}/skills/atlas-frontend/references/frontend-states.md` (all four states reachable, no dead screen during latency) but change only styling and feel - the states already exist.

## Convergence gate (user says done)

Run this in order; do not skip to the commit:

1. **Final observation sweep.** Dispatch `atlas:ui-runtime-tester` once more over every changed surface: edit visible, console clean, no regression at mobile width, reduced-motion respected where motion was touched. Evidence to `.atlas/evidence/<YYYY-MM-DD>-polish-<slug>/`.
2. **Independent verify.** Dispatch `atlas:verifier` in a fresh context with the list of accepted changes and the evidence directory. It re-observes each change live and stamps one verdict per change into `.atlas/.run/findings.json` via `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py"` (`--status verified` with `--evidence <screenshot path>`, `--surface <route/component>`; `rejected` or `needs-evidence` for anything not reflected live). A response without a findings.json write is invalid - re-read the file after the return and re-dispatch if a verdict is missing.
3. **Close locally.** Invoke `atlas-commit` for the polish changes. This skill's close step is a local commit, so that proceeds without asking - but commit only files the polish touched, and never push or open a PR; anything beyond a local commit is `atlas-ship`'s job.
4. **Report.** The commit hash(es), the still-running server URL, each change with its verified/rejected verdict and evidence path, and any residual blocker or route-to-another-skill redirect.

Uncommitted leftover polish (user reverted it, or never accepted it) is reported as-is, not silently committed.
