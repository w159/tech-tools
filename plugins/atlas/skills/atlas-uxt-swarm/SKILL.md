---
name: atlas-uxt-swarm
description: Use when asked to run a UX test swarm, full UI/UX test pass, persona testing review, or pre-release frontend sweep on the first responders app, or to re-test after fixes from a previous run. Drives persona generation, scripted data entry, real-browser walkthroughs, fuzzing, and an independent calc oracle, then gates on whether the CLIENT surface (the profile the app reads + resolving dashboard cards) is actually correct.
---

# UX Test Swarm

This skill is the single authority for the UX test swarm. It supersedes the old
`docs/claude_testers/RUNBOOK.md` (now a stub). It orchestrates persona generation,
scripted data entry, real-browser walks, fuzzing, and an independent calc oracle, then
enforces three hard gates before reporting a verdict.

You orchestrate and verify only. Never navigate the app, enter data, or edit app source
yourself. The swarm DETECTS and REPORTS app bugs with evidence; it never fixes
`frontend/`/`backend/` code. Your only writes are under `.claude/skills/atlas-uxt-swarm/`,
`docs/claude_testers/harness/`, `templates/`, and the run dir.

## Why this exists

A prior run wrote salary to budget/planner tables, read those back, saw HTTP 200, and
declared "COMPLETE" while `profile.current_salary` was null for all personas and the app
showed "needs work". It graded the wrong surface. Every rule below makes the swarm grade
the surface the CLIENT actually reads.

## Invocation options (args -> env knobs)

Parse `key=value` args from the user prompt. Apply defaults for anything omitted, then map
to env knobs passed to `run_all.sh`.

| Option | Values | Default | Env knob |
|---|---|---|---|
| `users` | integer or preset 6/12/24 | `12` | `COUNT` |
| `coverage` | `smoke` / `standard` / `full` | `standard` | `COVERAGE` |
| `profile` | `valid` / `mixed` | `mixed` | `PROFILE` |
| `speed` | `fast` / `thorough` | `fast` | `FAST` (fast -> `FAST=1`) |
| `seed` | integer | random | `GEN_SEED` |

Conflict rule: `smoke` caps users at 2. If the requested `users` exceeds a tier cap (e.g.
`users=24 coverage=smoke`), the coverage cap wins for the user count and you WARN in the
run log (`notes/`) so the discrepancy is visible.

## Coverage tiers (which phases run)

Default is `standard`.

- `smoke`: Discover (cached ok) + Generate (cap users at 2) + Enter data + Verify accuracy.
  No browser walk, no fuzz. Fast sanity check.
- `standard`: smoke phases + Browser walk WITH screenshots over key routes
  (route-matrix priority >= high) + completion metric. No fuzz.
- `full`: standard + Fuzz/boundary + accessibility (axe) scan + every route and every
  field in the matrices.

## Lifecycle (6 phases, in order)

```
0. Discover -> 1. Generate users -> 2. Enter data (scripted) -> 3. Walk UI (browser) ->
4. Fuzz/boundary [full only] -> 5. Verify accuracy (calc oracle) -> 6. Synthesize + gate
```

Each phase records start/end epoch into `RUN_DIR/notes/timing.json`. A phase with no work
for the chosen tier is recorded as `skipped`, never silently absent.

## Discover first (non-negotiable)

Before ANY data entry, phase 0 must:

1. Regenerate the route + field coverage matrices from `frontend/src` (cartographer).
2. Probe the LIVE client contract: read `frontend/src` for the real onboarding/profile-save
   call that populates `profile.current_salary` (endpoint, method, payload field names) and
   write it to `RUN_DIR/coverage/contract-snapshot.json`.

The scripted harness MUST mirror that exact call. Do NOT assume the backend derives salary
from grade; it does not. Skipping this step is how the swarm graded the wrong surface last
time. See `references/discovery.md`.

## Agent roster

The skill dispatches `general-purpose` subagents, pasting the matching
`references/roles/<role>.md` file as the prompt prefix. Run independent personas and roles
in parallel: one message, multiple Agent dispatches.

| Role file | Runs in tiers |
|---|---|
| `references/roles/cartographer.md` | all (phase 0) |
| `references/roles/scripted-persona.md` | all (phase 2) |
| `references/roles/browser-persona.md` | standard, full (phase 3) |
| `references/roles/fuzz-boundary.md` | full only (phase 4) |
| `references/roles/calc-verifier.md` | all (phase 5) |
| `references/roles/synthesis-reporter.md` | all (phase 6) |

Reconcile every agent claim against the evidence files it cites before accepting it. A
claim with no resolvable evidence path is not a result.

## The three hard gates (synthesis-reporter enforces)

G1 CLIENT-SURFACE SUCCESS. A persona counts as "setup complete" ONLY when the
profile/setup-status endpoint the client reads returns a fully populated record (salary,
filing/tax, net worth, debt, household) AND, in standard+/full, a screenshot shows the
dashboard cards resolving. HTTP 200 on a write is necessary, never sufficient. "Route
visited" is not "client sees correct data".

G2 EVIDENCE-COMPLETE. Every bug entry MUST carry: before + after screenshot path, repro
steps, expected-vs-actual, Nielsen severity, route + selector, persona id. Missing any
field rejects the entry and flags the run. User-stories and persona-feedback each link at
least one screenshot.

G3 ACCURACY. Every client-facing number is independently recomputed (pseudo-oracle) AND
checked against at least one metamorphic relation. Any mismatch beyond a 1-cent tolerance
is a Blocker. Release gate: zero unresolved Nielsen-4 (Blocker) and zero accuracy
mismatches.

Headline metric = completion rate (personas meeting G1 / total). Counts in every report
MUST reconcile with files on disk; `aggregate_results.py` asserts this.

## Setup

1. Target the DEV environment only, never production. Known dev defaults:
   `BASE_URL=https://first-responders-dev.firebaseapp.com`,
   `API_BASE=https://firstresponders-api-dev-decm6u6gqa-uc.a.run.app/api`. Ask the user for
   a base URL only if it is not already known this session.
2. Create `docs/claude_testers/run-YYYYMMDD[-nn]/` with subdirs
   `coverage/ harness/ evidence/ notes/ reports/`. If `run-YYYYMMDD` exists for today,
   suffix `-02`, `-03`, and so on (the unsuffixed dir is the day's first run).
3. Copy `docs/claude_testers/harness/` into the run's `harness/`.
4. If a previous run exists, read its `reports/bug-log.md` (and `coverage-report.md` where
   present) first; those findings become explicit regression targets in the agent briefs.
5. Run the swarm through `RUN_DIR/harness/run_all.sh` with the mapped env knobs, e.g.
   `COUNT=12 COVERAGE=standard PROFILE=mixed FAST=1 GEN_SEED=<seed> bash run_all.sh`.

No agent deletes data it did not create. The user purges test accounts; you never delete.
List the test accounts created (`notes/test-accounts-created.txt`) when you report back.

## References (loaded on demand)

- `references/discovery.md` - phase 0: cartographer + live-contract probe; the
  `coverage/contract-snapshot.json` output.
- `references/personas.md` - `datagen.py` generation, the 42-column schema, profile/seed
  semantics, user-count presets.
- `references/data-entry-contract.md` - the corrected ordered API contract; the canonical
  reference the scripted role and harness both obey.
- `references/evidence-severity.md` - evidence requirements, Nielsen 0-4 severity, the
  bug/story/feedback template required fields.
- `references/accuracy-oracle.md` - metamorphic relations, Decimal/cents rules, the
  compare-to-displayed-number rule.
- `references/reporting.md` - deliverable shapes, completion-rate headline metric,
  count-reconciliation gate, timing rollup format.
- `references/roles/<role>.md` - the six folded agent prompts (see roster above).

## Reporting back

Lead with the synthesis reporter's verdict and headline completion rate, name the single
most important finding, and point to `RUN_DIR/reports/` by path. If the verdict is
INCOMPLETE, dispatch targeted agents to close the named gaps and re-run synthesis; do not
report a run as done with open gaps.
