# UX Test Swarm

The UX test swarm is a multi-persona, browser-driven, full UI/UX test pass over any web app the orchestrator points it at. It synthesizes personas, drives the real sign-up and data-entry flow through a live browser, walks the UI capturing screenshots, fuzzes boundaries, and independently recomputes every client-facing number with its own oracle, then gates on whether the surface the CLIENT actually reads is correct. The orchestrator coordinates and verifies only. It never navigates the app, enters data, or edits the target app's source. The swarm DETECTS and REPORTS app bugs with evidence backed by screenshots and reproduction steps; fixing the app is out of scope. The only writes the orchestrator and its agents make are to the run dir and the durable audit dir described below.

## Discover first (non-negotiable)

Phase 0 runs before any data entry. It has two jobs, and nothing about the target app is assumed; it is all discovered at runtime from live source and the live browser:

1. **Coverage cartography.** Scan the app's router and page tree for routes and scan all client source for user-editable fields. Build a route coverage matrix and a field coverage matrix (each row carries a `status` column starting at untested and an `evidence_ref` column), diff against the previous run if one exists, and write both into the run dir.
2. **Live client-contract probe.** Observe the REAL sign-up / enroll plus data-entry flow and the surface the client reads back, by watching the browser network panel while the flow runs. Capture the write endpoint, method, and payload field names; the read-back endpoint and the fields it returns; and whether each stored value is sent explicitly or derived server-side. Cite a source reference (file:line or the observed request) for every claim; write "unknown" rather than guess, and treat an unresolved contract as a blocker for data entry.

Why this is non-negotiable: the classic failure this prevents is grading the wrong surface. A swarm that watches a write call return HTTP 200 and declares success, while the surface the client actually reads back is still empty or null, has graded the network response instead of the user-visible result. HTTP 200 on a write is necessary, never sufficient. The contract probe forces every later phase to mirror the exact call the real client makes and to assert on the exact surface the client reads.

## Browser automation surface (detect what is live)

The swarm drives a REAL browser. Detect and use whatever automation surface is available this session, in this order of preference, and never assume one is present:

- Chrome DevTools MCP
- Claude_Preview MCP
- the browser-harness skill (coordinate clicks, `capture_screenshot`, `new_tab`, `wait_for_load`)
- the webapp-testing skill / Playwright

Data entry and enrollment happen through the real UI, not a back-channel API. The network panel is observed to capture and confirm the contract, but the actions that change state are the same actions a user takes.

## Lifecycle (6 phases, in order)

```
0 Discover -> 1 Generate personas -> 2 Enroll + enter data (browser-driven) ->
3 Walk UI (browser, screenshots) -> 4 Fuzz/boundary [full tier only] ->
5 Verify accuracy (independent oracle) -> 6 Synthesize + gate
```

Each phase records start/end timing into `RUN_DIR/notes/timing.json`. A phase with no work for the chosen tier is recorded as `skipped` with its reason, never silently absent.

## Coverage tiers

Default is `standard`.

| Tier | Phases that run |
|---|---|
| `smoke` | Discover + Generate (small persona set) + Enroll/enter data + Verify accuracy. No browser walk, no fuzz. Fast sanity check. |
| `standard` | smoke phases + Browser walk WITH screenshots over high-priority routes (matrix priority >= high) + completion metric. No fuzz. |
| `full` | standard + Fuzz/boundary + accessibility scan + every route and every field in the matrices. |

## Invocation knobs

Parse `key=value` args from the prompt, apply defaults for anything omitted, and pass the result to the run as parameters the orchestrator sets (map them to whatever generation mechanism the run uses; do not hardcode env-var names).

| Knob | Values | Default | Effect |
|---|---|---|---|
| `users` | integer or preset 6/12/24 | `12` | persona count to generate |
| `coverage` | `smoke` / `standard` / `full` | `standard` | which phases run (see tiers) |
| `profile` | `valid` / `mixed` | `mixed` | `valid` is clean happy-path data; `mixed` makes a fraction of personas boundary-trap rows |
| `speed` | `fast` / `thorough` | `fast` | walk depth and wait budget |
| `seed` | integer | random | deterministic generation; same seed + count + profile = identical personas, so runs are repeatable and diffable |

Conflict rule: a smaller tier caps the user count. `smoke` caps personas at a small number regardless of the requested `users`. If the request conflicts (e.g. `users=24 coverage=smoke`), the coverage cap wins for the user count and you WARN in the run log (`notes/`) so the discrepancy is visible. `standard` and `full` honor the requested count.

## Agent roster

The phases map to five atlas subagents. Run independent personas and roles in parallel: one message, many Agent dispatches.

| Agent | Phase | Owns |
|---|---|---|
| `atlas:ux-cartographer` | 0 | route + field matrices, live client-contract probe |
| `atlas:ux-persona` | 1-3 | generate persona, enroll, enter data through the UI, walk the UI, file bugs / user-stories / feedback / feature-requests |
| `atlas:ux-fuzzer` | 4 | boundary and fuzz inputs against fields and cross-field constraints (full tier only) |
| `atlas:ux-accuracy-oracle` | 5 | independently recompute every client-facing figure and check metamorphic relations |
| `atlas:ux-reporter` | 6 | synthesize evidence into deliverables, enforce gates, write the verdict |

Reconcile every agent claim against the evidence files it cites before accepting it. A claim with no resolvable evidence path is not a result.

## The three hard gates

The reporter enforces all three. The release gate is zero unresolved Blockers and zero accuracy mismatches.

| Gate | Definition |
|---|---|
| **G1 client-surface success** | A persona counts as "setup complete" only when the surface the client reads back returns a fully populated record AND, in standard+/full, a screenshot shows the corresponding UI (dashboard cards, computed views) resolving. HTTP 200 on a write is necessary, never sufficient. "Route visited" is not "client sees correct data." |
| **G2 evidence-complete** | Every bug entry carries: before + after screenshot path (files must exist), reproduction steps, expected-vs-actual, computed severity, route + selector, persona id, and the layer the symptom points to. Missing any field rejects the entry and flags the run. User-stories and persona-feedback each link at least one screenshot. |
| **G3 accuracy** | Every client-facing number is independently recomputed by the oracle AND checked against at least one metamorphic relation. Any mismatch beyond a one-cent tolerance is a Blocker. |

Headline metric = completion rate (personas meeting G1 / total), reported as a percentage with the raw fraction (e.g. `9/24 (37.5%)`). Counts in every report must reconcile with the files on disk; a claimed total that does not equal the count of matching artifacts makes the verdict INCOMPLETE.

### Accuracy oracle rules (G3)

- The oracle is a pseudo-oracle: NEVER read the app's own calculator source to derive an expected value. That verifies the code against itself and proves nothing. Expected values come only from the persona's submitted inputs, published reference facts the app exposes, and any ground-truth reference files supplied for the run.
- Use exact decimal arithmetic for money (no binary float), quantize to the cent, and treat anything beyond one cent as a Blocker. Reserve a small relative tolerance only for intermediate multi-year projections and note it on the row.
- Assert at least one metamorphic relation per figure (definitional identities, monotonicity, boundary sign-flips), so figures whose exact value is uncertain are still checked.
- Diff against the number the UI DISPLAYS, not only the raw API value. When the screen value and the API value disagree for the same inputs, that disagreement is itself a finding.

### Severity (G2)

Severity is computed, not guessed, from frequency, impact, and persistence. A common, hard-to-overcome, repeated problem is the top level (Blocker). A G1 client-surface failure (entered value not displayed, or a computed view that will not resolve) and any accuracy mismatch beyond one cent are automatically Blockers. A run carrying only cosmetic findings may proceed.

## Run dir + setup

1. Target dev or staging only, never production unless explicitly told. Ask for a base URL only if it is not already known this session.
2. Create an ephemeral run dir `docs/.run/ux-swarm/run-YYYYMMDD[-nn]/` with subdirs `coverage/ evidence/ notes/ reports/`. If `run-YYYYMMDD` already exists for today, suffix `-02`, `-03`, and so on.
3. If a prior run exists, read its bug log first and make those findings explicit regression targets in the agent briefs.
4. No agent deletes data it did not create. List the test accounts created (`notes/test-accounts-created.txt`) when reporting back; the user purges them.

The reporter promotes the final report set into the durable `docs/audits/ux-swarm/<run-id>/`, aligning with the atlas orchestrator's docs/ single source of truth. The deliverable set includes a results table, an ordered bug log (Blocker > Major > Minor > Cosmetic, deduplicated), a feature backlog tagged free-tier vs premium, user-stories with acceptance verdicts, friction and feedback notes, a coverage report naming every untested route and field with a reason, and a run summary that leads with the completion rate.

## Reporting back

Lead with the reporter's verdict and the headline completion rate, name the single most important finding, and point to the report dir by path. If the verdict is INCOMPLETE, dispatch targeted agents to close the named gaps and re-run synthesis. Do not report a run as done with open gaps.
