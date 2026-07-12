---
name: atlas-odysseus
description: Use when asked to run a UX test swarm, full UI/UX test pass, persona testing review, or pre-release frontend sweep on any web app, or to re-test after fixes from a previous run. Discovers the target app from the repo automatically and adapts to any frontend stack. Drives persona generation, scripted data entry, real-browser walkthroughs, fuzzing, and an independent calc oracle, then gates on whether the CLIENT surface is actually correct.
when_to_use: asked to run a UX test swarm, full UI/UX test pass, persona testing review, or pre-release frontend sweep on any web app, or to re-test after fixes from a previous run. Discovers the target app from the repo automatically and adapts to any frontend stack. Drives persona generation, scripted data entry, real-browser walkthroughs, fuzzing, and an independent calc oracle, then gates on whether the CLIENT surface is actually correct
allowed-tools: Read, Glob, Grep, Bash
---


# UX Test Swarm

This skill is the single authority for the UX test swarm. It supersedes the old
`docs/claude_testers/RUNBOOK.md` (now a stub). It orchestrates persona generation,
scripted data entry, real-browser walks, fuzzing, and an independent calc oracle, then
enforces three hard gates before reporting a verdict.

**Elicitation:** if discovery cannot settle the target unambiguously - multiple runnable
apps in the repo, an already-running instance vs a fresh boot, prod-like vs local URL -
ask ONE AskUserQuestion naming the real candidates before the swarm launches. Fold in a
tier question (full swarm - recommended pre-release - vs smoke-tier persona walk) when
the ask did not fix it. Everything the live app can reveal (routes, forms, stack) is
discovered by the cartographer phase, never asked.

You orchestrate and verify only. Never navigate the app, enter data, or edit app source
yourself. The swarm DETECTS and REPORTS app bugs with evidence; it never fixes
`frontend/`/`backend/` code. Your only writes are under `.claude/skills/atlas-odysseus/`,
`docs/claude_testers/harness/`, `templates/`, and the run dir.

## Why this exists

A prior run wrote salary to budget/planner tables, read those back, saw HTTP 200, and
declared "COMPLETE" while the primary profile field was null for all personas and the app
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

## Phase 0 - discover the app (non-negotiable)

Before ANY data entry, phase 0 must discover the target app from the repo. Do NOT use
baked-in URLs or endpoint constants. All values come from reading the repo.

### 0a. Find the dev URL

Read the repo to discover how and where the app is served in development:
- Check `package.json` scripts (dev, start, serve), `vite.config.ts` / `next.config.js` /
  `angular.json` / `webpack.config.js`, `.env.development`, `.env.local`, `.env`,
  `firebase.json` / `vercel.json` / `netlify.toml`, and any CI scripts that launch the app.
- Extract the hostname and port (e.g. `localhost:5173`, a Firebase Hosting preview URL, a
  Cloud Run URL from `.env.development`).
- If the dev URL cannot be determined from the repo alone, ask the user for it once and
  record it in `RUN_DIR/notes/discovery.json` as `"dev_url_source": "user-provided"`.
- Target the DEV environment only, never production.

### 0b. Find the API base

Read the repo to discover the API base URL used by the frontend:
- Check `frontend/src/utils/api.ts` (or equivalent), `.env.development`, `.env`,
  `vite.config.ts` proxy/rewrite rules, `next.config.js` rewrites, and any config files
  that set `VITE_API_URL`, `REACT_APP_API_URL`, `NEXT_PUBLIC_API_URL`, or equivalent.
- If the app is a SPA with a backend-for-frontend on the same host, the API base may be
  relative (e.g. `/api`); record that.
- If the API base cannot be determined from the repo alone, ask the user for it once.

### 0c. Probe the REAL save/read-back contract

Read `frontend/src` (or equivalent) to capture how the real client persists the primary
onboarding/profile record and reads it back (the surface the dashboard displays). This
probe prevents the swarm from grading the wrong surface:
- Start at the setup/onboarding wizard entry point. Find the component(s) that drive the
  primary data-entry flow (look for `Setup`, `Onboarding`, `Wizard`, or `Profile` in
  component names under the frontend source tree).
- Trace each form submission to its API client call: endpoint, HTTP method, and exact
  payload field names.
- Find the read-back endpoint the client uses to display the submitted values on the
  dashboard or profile screen.
- Record whether any derived value is sent explicitly or assumed computed by the backend.
  Never assume the backend derives a value from another field; verify from source.
- Cite `file:line` for every claim. Write `"unknown"` rather than guess.
- Write the result to `RUN_DIR/coverage/contract-snapshot.json`:
  ```json
  {
    "dev_url": "<discovered or user-provided>",
    "api_base": "<discovered or relative path>",
    "primary_write": {"endpoint": "...", "method": "...", "payload_fields": [...]},
    "secondary_writes": [...],
    "primary_read": {"endpoint": "...", "fields": [...]},
    "derived_fields": {},
    "source_refs": ["file:line", ...]
  }
  ```

### 0d. Coverage cartography

1. Regenerate the route + field coverage matrices from the frontend source (cartographer).
2. Copy both into `RUN_DIR/coverage/` with two extra columns: `status` (init `untested`)
   and `evidence_ref` (empty).

All downstream phases consume `contract-snapshot.json`. If any field in the snapshot is
`"unknown"`, that is a blocker for data entry; resolve it before running phase 2.

See `references/discovery.md`.

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
profile/setup-status endpoint the client reads returns a fully populated record AND, in
standard+/full, a screenshot shows the dashboard cards resolving. HTTP 200 on a write is
necessary, never sufficient. "Route visited" is not "client sees correct data".

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

## Run setup

1. Run phase 0 (discover) first. All URLs and contracts come from discovery, not from
   constants in this file.
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

## Driver script

`scripts/ux-swarm-driver.sh` sets up the run directory, maps the user-supplied
env knobs to the resolved values, applies tier caps, and emits the phase plan
for the chosen tier. The skill invokes it at the start of a run; the script
does not dispatch agents (the skill does that in one parallel message). The
script is read-only with respect to the app: it writes only under `RUN_DIR`.

## webapp-testing integration

The browser-walk (phase 3) and fuzz (phase 4) phases delegate the actual
browser work to `atlas:ui-runtime-tester` agents, which lean on the repo-root
`webapp-testing` skill (`skills/webapp-testing/SKILL.md`) for Playwright
primitives. See `references/webapp-testing-integration.md` for the boundary
and what odysseus passes down to each delegated agent. webapp-testing is only
invoked for `standard` and `full` tiers; `smoke` runs no browser walk.

## References (loaded on demand)

- `references/discovery.md` - phase 0: cartographer + live-contract probe; the
  `coverage/contract-snapshot.json` output.
- `references/personas.md` - `datagen.py` generation, the 42-column schema, profile/seed
  semantics, user-count presets.
- `references/data-entry-contract.md` - the canonical ordered API contract; the canonical
  reference the scripted role and harness both obey.
- `references/evidence-severity.md` - evidence requirements, Nielsen 0-4 severity, the
  bug/story/feedback template required fields.
- `references/accuracy-oracle.md` - metamorphic relations, Decimal/cents rules, the
  compare-to-displayed-number rule.
- `references/reporting.md` - deliverable shapes, completion-rate headline metric,
  count-reconciliation gate, timing rollup format.
- `references/webapp-testing-integration.md` - how odysseus relates to the
  repo-root `webapp-testing` skill, the delegation boundary, and what odysseus
  passes down to each ui-runtime-tester agent.
- `references/roles/<role>.md` - the six folded agent prompts (see roster above).
- `scripts/ux-swarm-driver.sh` - run-directory setup and phase-plan emission
  for the chosen tier.

## Reporting back

Lead with the synthesis reporter's verdict and headline completion rate, name the single
most important finding, and point to `RUN_DIR/reports/` by path. If the verdict is
INCOMPLETE, dispatch targeted agents to close the named gaps and re-run synthesis; do not
report a run as done with open gaps.
