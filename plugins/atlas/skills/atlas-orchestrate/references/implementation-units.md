# Implementation-unit discipline

Load from atlas-orchestrate when a Dispatch step will send work to `atlas:implementer` - especially multi-unit plans, resumed runs, and parallel implementer waves. The four disciplines here (idempotency, evidence strategy, bounded parallel waves, evidence receipts) are adapted from CE's `ce-work` implementation loop and execution strategy, ported onto atlas's existing dispatch and findings mechanisms. CE's external-CLI transport does NOT port: atlas dispatches `atlas:implementer` subagents, never a named external binary. The host-ownership principles do port (see §3 close).

## The unit is the atom

A stage in the stage map is one verifiable artifact with one failable check; it may decompose into several **implementation units**. When it does, give each unit a stable ID `<stage>-U<n>` (e.g. `S2-U1`) written into the `docs/plans/` stage map (date-first naming per `docs-ssot.md`), and use that ID everywhere: dispatch prompts, `.atlas/evidence/` filenames, findings entries, and unit-scoped commit messages. Do not invent IDs the plan does not supply; never renumber on resume - the ID is what makes a unit resumable, parallelizable, and auditable across sessions.

## 1. Idempotency: check before you redo

Before dispatching a unit to `atlas:implementer` - **mandatory when resuming an interrupted run**, cheap enough to always do:

1. Read the unit's acceptance criterion (its failable check) from the stage map.
2. Determine whether the criterion **already holds** on the current tree: run the check, or verify the expected capability exists at the expected files. A repository-derived criterion (files, tests, behavior observable from the checkout) is decided from the tree, in your context or a cheap `atlas:explorer` dispatch - never from memory of a previous session.
3. **Already satisfied and matching intent** - likely shipped by a prior session or an earlier partial run: dispatch nothing to redo it. Record the check (findings entry with the observed result, or a note on the stage), mark the unit complete, move on. Do not silently reimplement; do not let "it's probably done" skip the check either - the check IS the evidence.
4. **Partially satisfied**: dispatch only the remaining slice, and say in the dispatch prompt exactly which part already holds so the implementer does not redo it.
5. **Out-of-repo criteria** (a DNS record, a console setting, live-system rows, a deployed flag) have no git-derived completion signal: decide from the observed state of the deliverable, never from a clean tree or a tracker write. Re-execute only when observably unsatisfied and re-applying is safe or the user authorized it; otherwise ask (`AskUserQuestion`) or block the unit.

## 2. Name the evidence strategy per unit - in the dispatch prompt

Before any behavior-bearing dispatch, decide the evidence strategy and state it explicitly in the dispatch prompt. The choice is the orchestrator's, not the implementer's guess:

| Strategy | When | Dispatch instruction |
|---|---|---|
| `proof-first` | The desired behavior is knowable up front: a known contract, a reproduced bug, a specified feature | Write/strengthen the test FIRST, run it, observe the expected **red failure for the right reason**, then implement, then observe green. Never write test and implementation in the same step; never over-implement past the behavior slice. |
| `characterization` | Refactoring or touching **poorly-specified legacy code** where current behavior is the only spec | Capture current behavior in a passing test FIRST (the characterization baseline), verify it passes unchanged, then refactor; the baseline stays green unless the plan explicitly changes that behavior. |
| `no-test-exception` | Testing is genuinely inappropriate: trivial rename, pure config/styling, generated artifacts, manual-only surface | Record the exception AND the named replacement verification (command, script, observed output) in the same dispatch. An exception without replacement verification is not an exception. |

**Test discovery first.** The dispatch names existing test files for every implementation file the unit will touch, or instructs the implementer to find them (test/spec files that import, reference, or share naming patterns with the target) before editing. If an existing test already covers the contract: use it as the red evidence, update it, or strengthen it - **never add a duplicate regression test beside a suitable existing home.**

**Scenario completeness for feature-bearing units.** Check the plan's scenarios cover: happy path (always), edge cases (boundaries, empty/nil, concurrency), error/failure paths (invalid input, permission denials, downstream failure), and integration (cross-layer chains exercised with real objects, no mocks for the interacting layers). Supplement gaps before writing tests - vague scenarios ("validates correctly") are not scenarios.

Related mechanism: `atlas-debug`'s RED gate is proof-first specialized to defects - use that skill for the bug route; use this table for planned feature/refactor work. Skip proof-first discipline entirely only for the `no-test-exception` cases above, and record why even then.

## 3. Independent-unit bounded parallel waves

Multiple `atlas:implementer` calls for genuinely independent units in the same readiness layer dispatch **together in one message** (Law 2) - but independence is earned by check, not assumed. Run the **Parallel Safety Check** per unit before the wave:

1. **Dependencies committed.** A unit starts only when every unit it depends on is verified and its changes landed canonically.
2. **Write sets disjoint - then reason beyond declarations.** Shared types/APIs/interfaces, migrations, lockfiles, generated artifacts/clients, registry/config/schema surfaces all create contention a file-path comparison misses.
3. **No shared runtime singleton.** One dev server/port, shared DB state, browser session, package install, or rate limit - two units touching one singleton are not independent.
4. **Merge and verification cost acceptable.** Even isolated workers serialize when they share a contract and reconciling their likely outputs is not obviously smaller and safer than serial authoring.
5. **Resolve uncertainty by inspection** - read the actual files and contracts; minutes of reading beat hours of serial waiting. Contention that survives inspection: **decline parallelism for exactly the contending units** and dispatch the rest of the layer in parallel. One uncertain unit never serializes its whole layer.
6. **Batch small units.** Every dispatched worker pays a context ramp-up before its first write; a unit too small to outweigh it is batched into one worker's packet or folded into a sibling dispatch.

**Isolation and mechanics:** use the `atlas-worktree` skill for worktree creation, registry tracking (`.atlas/.run/worktrees.json`), and teardown - do not hand-roll worktree commands here and do not reinvent its mechanics. Dispatch-time `isolation: "worktree"` where the harness supports it (register the harness-made path per that skill's Step 1). Give each wave worker its intended **base commit SHA** and have it verify its checkout's HEAD matches that SHA before editing (a harness-managed copy may be cut from a different base; on mismatch the worker stops and reports, and the unit runs serially instead). A unit depending on uncommitted state cannot use this route. Cap in-flight implementers at **3-5**.

**Shared-tree fallback** (workers in one working directory, no worktrees) is permitted only while all of these hold; a unit that cannot meet one gets a worktree or runs serially:

- Clean **committed baseline**, so output is attributable and an aborted wave restores to it.
- **Exclusive ownership** of every write surface, including hidden ones: lockfiles, snapshots, generated artifacts, formatter sweeps - each assigned to exactly one worker or excluded from all.
- Workers **never touch the index** (no `git add`/commit - concurrent index writes corrupt it) and run **no mutating verification** (full suites, installs, builds); a single focused unit test is fine only if it touches no shared state.
- The orchestrator stages, commits, and runs the authoritative verification after the wave.
- **Abort on any write outside every worker's owned set.** A delta no worker accounts for may be the user's: preserve it and stop for reconciliation, never discard it. Any abort disables further shared-tree waves for the run.

**Commit ownership:** worktree-isolated implementers may stage and commit inside their own worktree branch (unit-scoped: stage only the unit's files, never `git add .`); the orchestrator merges those branches in dependency order. Shared-tree workers never commit; the orchestrator commits each unit after verification.

**After the wave, integrate in dependency order - never trust the reports alone:**

1. Wait for every worker in the wave.
2. **Inspect the actual tree** (`git status`/diff per worktree), not the reported paths; reports are the starting hint, declared file lists are often incomplete.
3. **Detect real collisions**: actual paths PLUS shared contracts and generated surfaces. A conflict-free merge is not proof the results are compatible - re-dispatch a stale or colliding unit on the advanced base, resolve it explicitly, or finish it serially.
4. **Verify and land unit by unit in dependency order**, revalidating remaining results against the advancing tree. Repeated collisions or broad unplanned edits disable further parallel waves for the run - finish serially.
5. Worktree close-out is the completion gate's step 2 (commit-if-dirty, merge, remove) - closing worktrees is part of done, not cleanup garnish.

**Host ownership** (from CE's cross-model protocol, minus its CLI transport): the dispatched implementer is an author only. It never makes the canonical commit in the shared tree, never pushes (law 6 + push consent), and its return is a report, not proof. Integration, authoritative verification, canonical commits, and the verdict stay with the orchestrator and the independent verifier - always.

## 4. Per-unit evidence receipts

Every implementer dispatch owes a machine-readable **evidence receipt** per unit. This is CE's worker-result contract folded into atlas's existing findings pipeline - one ledger (`atlas_finding.py` -> `.atlas/.run/findings.json`), not a parallel return-to-caller schema.

**The implementer writes:**

- A receipt file at `.atlas/evidence/<YYYY-MM-DD>-<unit-id>-receipt.md` containing: `changed_files` (actual paths), `evidence_strategy` (`proof-first | characterization | no-test-exception` + exception reason and replacement verification when applicable), `behavior_changed` (yes/no), `verification` (exact command + observed result + captured output), and - when behavior changed - `tests` (existing tests inspected; tests added/changed/used unchanged; the red failure or characterization baseline observed, when applicable).
- The same fields, condensed, in its final REPORT BACK - they are the orchestrator's reading copy.

**The orchestrator stamps** one findings entry per unit via the existing CLI (the mechanical rule's "you record the outcome"), mapping the receipt onto the standard schema:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py" \
  --id S2-U1 --status verified \
  --title "auth retry path: proof-first, behavior_changed=yes" \
  --evidence "src/auth/retry.py" \
  --evidence "src/auth/retry.test.ts::test_retry_backoff_red_then_green" \
  --evidence ".atlas/evidence/2026-09-23-S2-U1-receipt.md" \
  --reproduction "pnpm test src/auth/retry.test.ts -> fail(pre) then pass(post)"
```

Unit id in `--id`; strategy and `behavior_changed` in `--title` (machine-greppable); changed files, test id, and receipt path in repeatable `--evidence`; verification command + actual result in `--reproduction`. Bulky detail lives in the receipt file under `.atlas/evidence/`, referenced not inlined.

**Why the receipt is mandatory:** the red-before-green (or characterization-baseline) observation exists only in the worker's witness - it is NOT reconstructable from the tree afterward. A report missing receipt fields forces re-derivation: recover what the tree allows, mark the rest unverified, **never fabricate the observation the worker never reported.**

**The stage gate is unchanged and still sovereign.** A per-unit receipt is the implementer's self-report feeding the ledger; it never substitutes for the step-3 independent check (deterministic test run recorded by you, or an `atlas:verifier` dispatch). A stage with receipts but no independent check is `pending`, exactly as before. Receipts make coverage measurable per unit; verification doctrine stays in `verification-and-grounding.md`.
