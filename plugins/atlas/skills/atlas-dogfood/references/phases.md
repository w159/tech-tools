# Phases

Read this before Phase 0. Each phase states what it consumes, what it produces, and when it stops the run. The order is invariant: the flow model precedes the matrix, and the matrix precedes any browser work.

Arguments: `<target>` is a PR number, a branch name, or `current`/blank for the active branch. Flags: `--port PORT` pins the dev-server port; `--fix-budget N` caps repair attempts per scenario (default 2).

## Phase 0 - Scope

1. Resolve the target to a diffable pair:
   - PR number -> `gh pr view <n> --json headRefName,baseRefName` and keep the PR identity (never collapse it to its head ref, whose name may itself be `main`). Diff: `git diff --name-only <base>...<head-ref>` (or `gh pr diff --name-only <n>`).
   - Branch name -> `git diff --name-only <trunk>...<branch>` where trunk is the repo's mainline (`main`/`master`/as configured).
   - `current`/blank -> `git diff --name-only <trunk>...HEAD` plus uncommitted changes (`git diff --name-only HEAD; git ls-files --others --exclude-standard`). Never dogfood the trunk itself on a blank/branch target - there is no diff.
2. If the diff is empty for a blank/branch target: **stop the run**, report "no diff to dogfood", and suggest the user name a PR or branch.
3. If the target is not the current checkout: confirm with the user before checking it out in place; if uncommitted changes would be disturbed, offer an isolated worktree instead. A numeric target stays a PR identity through checkout.
4. Record the scope in the run checkpoint: target, diff base, changed-file list. If atlas-test-browser ran earlier against the same diff, read its summary and seed this run's scope with its `Fail` routes.

## Phase 1 - Analyze the diff

Produce a change inventory, not a code review. For each changed file classify: new feature surface, behavior change, pure refactor (rename/move, no behavior change), dependency/config, test-only, docs-only. Note shared components/layouts the diff touches - a shared change propagates to every consumer route in Phase 2. Cite `file:line` for behavior-affecting claims. Test-only and docs-only changes contribute no scenarios on their own but can change what edge inputs are realistic for a flow they cover.

## Phase 2 - Map the flows

Map the change inventory to the **user-facing routes and flows** the diff can actually affect - never the whole app.

- Use the project's real router config / route definitions plus `docs/architecture/` to connect changed files to the URLs that render them.
- A flow is a user journey, not a URL: "submit the new import form and land back on the list, seeing the imported row" beats "GET /import". For each affected route, write the flow as steps a user performs, including the new inputs the diff introduces.
- Boundary rule: a route touched only via a pure refactor with provably identical behavior (verified by the existing suite) still loads in Phase 5, but its flow steps collapse to "renders and core interaction works".
- Prefer one atlas:explorer dispatch over reading the tree yourself when the mapping is non-obvious (shared components, dynamic routes, deep prop drilling). One dispatch, GOAL/DELIVERABLE/SUCCESS CRITERIA/OUT OF SCOPE/STOP CONDITIONS shape per `atlas-orchestrate/references/subagent-kit.md`.
- Write the flow model into the report's matrix section now (scenarios `Pending`).

## Phase 3 - Derive the matrix

From the flow model, derive one matrix row per scenario. A scenario = flow x input class. Input classes, in priority order when time is short:

1. **Happy path** - the exact journey the diff makes possible or changed.
2. **Edge inputs** - boundary values, empty submits, over-long strings, special characters, duplicate/invalid entries, back-navigation, double-submit. Derive these from what the diff actually handles (its validation, parsing, state transitions), not a generic checklist.
3. **Regression neighbors** - the closest existing behavior the diff could have broken (the shared component's other consumers, the pre-existing flow that the diff modified).

Cap the matrix: with `--fix-budget N` and more than ~12 scenarios, cut scenario 3 rows to the neighbors the diff files directly import. Every row gets: id, flow, input class, steps (brief), state (`Pending`), evidence path, fix attempts used (0). Create the report from `references/report-template.md` with every row `Pending` before any browser work - the checkpoint rule.

## Phase 4 - Serve

Resolve the dev server exactly as atlas-test-browser does (manual mode: user-run server; use its `scripts/resolve-port.sh` approach or the project's documented dev command; pipeline-style unattended runs may start one). Pin `--port` if given.

- Manual default: if no server is running on the resolved port, stop and tell the user how to start it - do not start one behind their back unless the user asked for a hands-off run (that is what dogfood usually is; when explicitly hands-off, start the project's dev command, log the PID, and tear it down at the end).
- Verify the root serves before iterating. A dead root is a preflight blocker, not a scenario failure.
- One environment note per run, not per scenario: if auth or seed data is required, establish it once and record how.

## Phase 5 - Execute (drive the flows)

Work **one scenario at a time**. Dispatch `atlas:ui-runtime-tester` per scenario batch (one tester owns one navigation session; batch scenarios sharing a journey - e.g. login - into one dispatch).

Dispatch shape: the subagent-kit template with `atlas:ui-runtime-tester` as the role. Give it: the scenario steps verbatim from the matrix, the base URL, the evidence directory (`.atlas/evidence/<YYYY-MM-DD>-dogfood-<branch-slug>/`), and this requirement: drive as a real user - navigate, click, fill, submit, including the edge inputs - and capture for every step a screenshot, the console log, and the network calls fired. The tester never edits code; restate that boundary in the dispatch.

Accept the tester's per-scenario report only when each claim has a resolvable evidence path. Then judge the scenario:

- **Pass** - all steps observed working, evidence cited.
- **Broken** - a step failed or a genuine break observed (console error, failed network call, wrong render, data not persisted, broken state). Enter the fix loop (`references/fix-loop.md`). While the loop runs, do not start scenarios that depend on the broken flow; independent scenarios may proceed in parallel.
- **Blocked (needs human verify)** - a step needs outside interaction (OAuth, real email, payment, SMS, third-party approval) and cannot be driven. Record what a human must do and end the scenario.
- **Skipped** - cut by the matrix cap or made moot by a fix; state the reason.

Update the report after every scenario - checkpoint, not a final write.

## Phase 6 - Fix loop

Policy, dispatch templates, escalation, and the regression-test requirement: `references/fix-loop.md`. Summary: diagnose -> dispatch `atlas:implementer` (bounded fix + regression test) -> fresh `atlas:verifier` confirms -> re-drive the scenario with a fresh tester -> mark `Fixed` only when the re-drive is green with evidence. Budget `--fix-budget` attempts per scenario (default 2); over budget, or a fix needing a product decision -> `Blocked (human decision)` + Decisions for a human.

## Phase 7 - Report

Finalize the report (template: `references/report-template.md`): matrix final, verdict Ready/Not ready, fixes with regression tests, escalations, Decisions for a human, working-tree state. Write findings via `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py` (one per fix, one overall). Tear down any server this run started. Leave the working tree with fixes uncommitted and say so explicitly - commits happen only on user confirmation.
