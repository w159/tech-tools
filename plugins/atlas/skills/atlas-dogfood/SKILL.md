---
name: atlas-dogfood
description: "Drives the branch or PR diff in a live browser via atlas:ui-runtime-tester: full mode repairs genuine breaks in a bounded loop, smoke mode only reports Pass, Fail or Skip per route. Use for end-to-end flow checks or a quick render check."
when_to_use: "dogfood this change, drive the changed flows, find and fix UI breakage, smoke test, check changed routes, does it load, console errors, quick browser check"
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
argument-hint: "[smoke] [PR number, branch name, or 'current'] [--port PORT] [--fix-budget N]"
---



Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

# atlas-dogfood

Two modes share one diff scope and one browser agent. **Full** (default) drives flows and repairs breaks. **Smoke** (argument `smoke`, or "quick render check") loads each touched route once, reports Pass, Fail or Skip, and never fixes: read `${CLAUDE_SKILL_DIR}/references/smoke.md` and follow it instead of the phases below. The rest of this file describes full mode.

Act as a QA engineer who dogfoods the active branch's changes end to end, autonomously, until the diff's user-visible behavior genuinely works.

**Outcome:** every user-facing route/flow this diff touches has been driven live in a real browser along its whole journey - happy path plus edge inputs - and small breakages are fixed, regression-tested, and re-verified. **Done:** every matrix scenario is `Pass`, `Fixed`, `Skipped` (with reason), or in a terminal `Blocked` state, and the report is finalized (template in `references/report-template.md`). A green matrix does not excuse an unexercised scenario: a scenario nobody could reach is `Blocked` with the reason, never silently dropped.

**This is diff-scoped, never whole-app exploration.** You test what this branch/PR introduced or modified versus the trunk. If the argument is a branch name or `current` and the diff against the merge base is empty, stop: there is no diff to dogfood. A PR number always has a base, so it is always diffable even when its head branch is `main`.

## Routing: where this sits among its neighbors

The browser-testing surfaces differ on two axes: **scope** (the diff vs the whole app) and **behavior on failure** (report-only vs autonomous repair).

| Surface | Scope | On failure | Weight |
|---|---|---|---|
| **atlas-dogfood smoke** | Routes touched by the current diff/PR | Captures evidence, marks `Fail`, hands off | Lightest: one load per route |
| **atlas-dogfood full** (this) | **Flows** touched by the current diff/PR | **Bounded repair loop**: diagnose, dispatch `atlas:implementer`, verify with a fresh `atlas:verifier`, re-drive until green or escalation | Middle |
| **atlas-ux-test** | The **whole app**, multi-persona | Reports with evidence | Heaviest: personas, scripted data entry, fuzzing, accessibility |

Routing:

- Quick green/red signal on the touched routes, no repair wanted -> smoke mode. Feed its `Fail` routes into a full run when repair is wanted.
- The diff's flows must work end to end before you report back, with small breakages fixed in the same run -> full mode.
- Pre-release full-app UX sweep, personas, fuzzing, accessibility -> **atlas-ux-test** (a separate run).
- Single known issue, root-cause fix outside a QA run -> **atlas-debug**.

atlas-dogfood never edits app source itself - repairs happen only through dispatched `atlas:implementer` agents, and every fix is confirmed by an independent `atlas:verifier` that did not see the fix being made. When the user may only want a report, ask which mode, and default to full only when "make it work" is plausibly implied.

## Phase order

Scope -> analyze the diff -> map the flows -> derive the matrix -> serve -> execute -> fix loop -> report. The order is the invariant: the flow model precedes the matrix, and the matrix precedes any browser work.

Read `${CLAUDE_SKILL_DIR}/references/phases.md` before starting Phase 0 (Scope) and follow it phase by phase; the run cannot be executed correctly from the list above. The fix loop's policy and dispatch templates are in `references/fix-loop.md`.

## Boundaries

- **Browser via the atlas agent only.** All live driving is dispatched to `atlas:ui-runtime-tester` (one tester owns one navigation session), which uses the harness's own browser surface (Claude_Preview MCP / `webapp-testing`). Never shell out to an external browser CLI or a third browser stack; if the harness exposes no browser surface at all, report that as a preflight blocker rather than faking the drive.
- **Repairs only via the fix loop.** The orchestrator never edits app source. Auto-fix only what is small, well-understood, and low-risk (policy in `references/fix-loop.md`); anything architectural, schema-level, behavior-defining, or with plausible competing solutions is escalated to the report's **Decisions for a human** section and the scenario ends `Blocked (human decision)`.
- **Never auto-commit or auto-push.** Fixes land in the working tree. Committing, pushing, or opening a PR happens only on explicit user confirmation. Regressions tests the implementer writes are part of the fix and stay in the working tree with it.
- **Never switch the primary checkout out from under the user.** A PR/branch target differing from the current checkout: confirm with the user before checking it out in place; offer an isolated worktree instead when uncommitted changes would be disturbed.
- **Screenshots and transient artifacts go to `.atlas/evidence/<YYYY-MM-DD>-<slug>/`** at the moment of capture (per the docs SSOT), never to the repo root; the report references those paths.
- **A fix is not done until a regression test fails before it and passes after**, or the report records why no automated regression test was meaningful for that fix.
- **Terminal states end the scenario, not the run.** `Blocked (needs human verify)` (a step needing outside interaction: OAuth, real email, payments, SMS, third-party approvals) and `Blocked (human decision)` (a fix too big to make autonomously) each end that scenario; continue the rest of the matrix and never silently re-queue a blocked scenario on resume.

## Checkpoint, not a final write

Create the report from `references/report-template.md` as soon as the matrix exists - every scenario `Pending` - and update it after each scenario is judged and each fix lands. Report path: `docs/audits/atlas-dogfood-<branch-slug>-<YYYY-MM-DD>/report.md` (create the directory on demand; the docs-curator reconciles it into the wiki on its next pass). `<branch-slug>` is the branch name lowercased with every run of non-alphanumeric characters collapsed to one `-`. The task list is session-scoped; the report on disk is what a later run or teammate resumes from, so an interrupted run must leave a template-shaped checkpoint rather than a bare matrix. Findings entries for the run land in `.atlas/.run/findings.json` via `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py` (one per fix, one for the overall verdict).

## Experience judgment (lightweight)

This is the middle-weight skill: judge each scenario for correctness first, and for feel only against expectations the project itself has written down (`docs/features/`, `docs/standards/`, UI conventions in `AGENTS.md`). Do not invent personas - a full persona-based experience pass is atlas-ux-test's job. A mismatch with a written product expectation enters the fix loop like any other break, cited as `(<doc path>, <claim>)`; if the branch intends to change that expectation, that is a decision for a human about the doc, not a fix. Observations worth generalizing (recurring UX patterns, gotchas) are handed to `atlas:docs-curator` / the compound pipeline in the report, never written inline mid-run.

## REPORT

- Verdict: Ready / Not ready, with the matrix table (every scenario, its state, its evidence path).
- Fixes applied: file-level summary per fix, the regression test that proves it, and the verifier's confirmation.
- Escalations: every `Blocked` scenario with what a human must decide or verify, and the **Decisions for a human** section from the template.
- What was NOT tested and why (skip/block reasons), and the working-tree state (files changed by fixes, uncommitted).

## Mode references

Open each when its mode reaches that step:

- `references/route-and-report.md`: smoke mode: route mapping, port and server commands, dispatch template, summary format
- `references/pipeline-mode.md`: smoke mode when invoked by an automated runner
- `scripts/resolve-port.sh`: smoke mode: prints the dev-server port (run it, do not read it)
