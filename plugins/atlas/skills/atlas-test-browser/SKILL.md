---
name: atlas-test-browser
description: 'Fast, no-fix-loop browser smoke check of the routes affected by the current branch or PR diff: maps the changed files to the routes/components they render, loads each affected route live via atlas:ui-runtime-tester, captures console errors, network failures, and render breaks, and reports Pass/Fail/Skip per route with evidence. Read-only diagnosis - it NEVER attempts fixes (that is atlas-dogfood, the same diff-scoping idea plus an autonomous repair loop) and is far lighter than the app-wide, persona-based atlas-ux-test swarm.'
when_to_use: quick browser smoke check of routes touched by the current change
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
argument-hint: "[PR number, branch name, 'current', or --port PORT]"
---

# atlas-test-browser

Affected-route browser smoke check. Given a diff or PR scope, this skill identifies exactly
which routes/components the change touches, loads each one live in a real browser, captures
console errors, network failures, and render breaks, and reports a per-route Pass/Fail/Skip
table with evidence. It is a **smoke check, not a repair loop**: on failure it captures the
error state and stops diagnosing - fixing is a different skill's job.

**Where this sits among its neighbors:**

| Skill | Scope | Behavior on failure |
|---|---|---|
| **atlas-test-browser** (this) | Routes touched by the current diff/PR only | Captures evidence, marks Fail, **never fixes** - reports and hands off |
| **atlas-dogfood** | Same diff-scoping idea | Adds an **autonomous repair loop** on top: diagnoses the failure, applies a fix, re-runs until green. Run atlas-test-browser first; if it reports failures and you want them fixed, invoke atlas-dogfood |
| **atlas-ux-test** | The **whole app**, persona-based, full UX sweep (walks, fuzzing, data entry, calc oracle) - much heavier | Deep findings per persona/route |
| atlas-frontend / atlas-feature | Build work | Dispatch ui-runtime-tester as one wave's verification |

Rule of thumb: smoke-check a change -> this. Smoke-check then fix -> this, then atlas-dogfood.
Full pre-release UX pass -> atlas-ux-test.

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

## Done condition

The run ends in exactly one of two states: (a) a summary in which **every affected route is
marked Pass, Fail, or Skip, each Skip carrying its reason**, or (b) a preflight blocker that
stopped testing before any route was exercised, stated with what would clear it. Reaching
neither, or silently dropping a route from the summary because nobody could reach it, is the
failure this done condition exists to prevent.

## Modes

- **Manual (default):** the user controls the dev server. If no server is running, stop and
  tell the user how to start it - do not start one behind their back.
- **Pipeline (`mode:pipeline`):** invoked by an automated runner. Unattended - never block on
  a question. Read `${CLAUDE_SKILL_DIR}/references/pipeline-mode.md` and follow it; it
  overrides port selection, server startup, and all user-facing prompts.

## Browser runtime policy

The browser work is never done inline and never via an external browser CLI.

1. **Dispatch `atlas:ui-runtime-tester`** (the atlas pink agent) to drive the live browser:
   it navigates, inspects rendered/interactive state, clicks/fills/presses, captures
   screenshots, and reads console + network - via the harness's own browser surface
   (Claude_Preview MCP / `webapp-testing`), not standalone Playwright/Puppeteer installs.
2. **One dispatched tester per batch of routes** (or one per route for large diffs). Do not
   mix browser sessions across testers; each tester owns its navigation session.
3. **Do not introduce a third browser stack.** Never shell out to `codex`/`cursor`/`grok`-style
   host CLIs or install ad hoc automation. If the harness exposes no browser surface at all,
   report that as a preflight blocker rather than faking the check.

The orchestrator (you) never opens routes yourself - mapping, dispatch, and synthesis are
yours; the live browser is the tester's.

## Workflow

Read `${CLAUDE_SKILL_DIR}/references/route-and-report.md` before step 3. It carries the
route-mapping patterns, the port/server commands, the per-page checks, the dispatch template,
and the summary format.

1. **Determine test scope** from the argument: a PR number -> `gh pr view <n> --json files -q
   '.files[].path'`; `current` or empty -> `git diff --name-only main...HEAD`; a branch ->
   `git diff --name-only main...<branch>`. Require a git repo with changes; otherwise report
   the preflight blocker.
2. **Map changed files to routes** and build the list of URLs to test, using the
   route-mapping table in the reference plus the project's actual layout (`docs/architecture/`,
   the framework's router config). Include every route whose rendering path the diff can
   affect - a shared component or layout change touches all its consumers.
3. **Resolve the dev-server port and verify the server is running.** In manual mode use
   `scripts/resolve-port.sh` (see the reference for the exact block); a manual run with no
   server on the port stops here with the start command printed. In pipeline mode
   `references/pipeline-mode.md` replaces this step.
4. **Verify the root.** Confirm `http://localhost:<port>` serves before iterating; a dead
   root is a preflight blocker, not a route failure.
5. **Dispatch the smoke checks** - one `atlas:ui-runtime-tester` per route batch using the
   GOAL/DELIVERABLE/SUCCESS CRITERIA/OUT OF SCOPE/STOP CONDITIONS template in the reference.
   Each tester: navigates, checks key elements render, exercises the critical interactions,
   captures console errors and failed network calls, saves evidence to
   `.atlas/evidence/<YYYY-MM-DD>-<slug>/`, and reports per-route status. The tester NEVER
   edits code - that boundary is in its agent definition; restate it in the dispatch.
6. **Human verification** where a flow needs external interaction (OAuth, email, payments,
   SMS, third-party APIs): in manual mode, pause and ask the user. **Pipeline mode does not
   pause** - log each such flow as Skip with the reason and continue.
7. **Handle failures WITHOUT fixing.** Capture the error state (screenshot, exact console
   line, failing network entry), record the exact repro, mark the route Fail, and continue
   testing the remaining routes. Do NOT dispatch `atlas:implementer`, do not propose patches,
   do not enter a debug loop - that is `atlas-dogfood`'s (or `atlas-debug`'s) job. The smoke
   check's value is speed and a clean handoff, not repair.
8. **Stamp the verdict and report the summary.** Write the run's outcome to
   `.atlas/.run/findings.json` via `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py"`
   (one entry per failed route, status `verified` with evidence paths; the overall run gets
   one entry too), then emit the summary in the reference's format, ending with the explicit
   handoff line for any failures (see below).

## Failure handoff

A Fail route is never a dead end and never an invitation to fix inline. The summary ends
with:

```
Remediation: run atlas-dogfood (same diff scope + autonomous repair loop) or
atlas-debug (single-issue root-cause fix) with the failed routes above as scope.
```

## Boundary

atlas-test-browser owns: diff-scoped route identification, live smoke loading, evidence
capture, pass/fail/skip reporting. It does NOT own: fixing (atlas-dogfood / atlas-debug),
app-wide UX/persona testing (atlas-ux-test), full state-matrix verification
(atlas-frontend's wave verification), or code review (atlas-review). If the user asked for a
pre-release sweep, route to atlas-ux-test instead.