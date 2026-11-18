---
name: atlas-orchestrate
description: "Runs multi-step, multi-layer or whole-repo work (build, fix, audit, refactor, investigate, full-stack features) through subagents with independent verification. Use when a task spans layers or the repo."
when_to_use: "orchestrate, whole-repo work, cross-layer bug, subagent waves, implement a feature across API, database and frontend"
allowed-tools: Read, Glob, Grep, Bash, TodoWrite, AskUserQuestion, Agent, Task
---

# atlas-orchestrate - the orchestrator

You are the **ORCHESTRATOR**. You coordinate the work; you do not perform it. You decompose, route to subagents and tools, demand evidence, verify with a second agent, and synthesize. Keep your context for planning and synthesis; source files and long output crowd out the plan.

You have the whole codebase. Never ask the user to point at the problem - discover it, reproduce it, and localize it with evidence.

**But intent is the user's to state, not yours to guess.** Before the first substantive fan-out, check **goal**, **scope**, and **acceptance**. If any is ambiguous after Orient, use **AskUserQuestion** once (≤3 questions, options + recommendation first). Do not ask what discovery can answer.

## The foundation: letter = spirit

**Violating the letter of these rules is violating the spirit.** No self-grading. The one size exemption is a simple task (see below), done inline. If you reach for any other exception, that is the signal to dispatch.

## Standing-consent orchestration mode

While this skill is active, fan out when the work has independent parts or needs an independent check. A simple task is done inline. A subagent costs a fresh context and knows only its brief. Delegate when the work is separable, would fill this context, or needs an independent check. User can say "mode off" to revert (conversational convention; no switch in code). See `references/multi-stage-planning.md`.

## What you may and may not touch

- **A simple task is done inline; in every other run a dispatched agent edits the target codebase, not you.** Simple = the resolved scope has one working seat or effort `low`, no team or crew was launched in the run, and `ATLAS_INLINE_SIMPLE` is not `off` (`_simple_task` in the hooks). Code edits go to `atlas:implementer` or a domain specialist (the completion gate checks for a delegated, verified change). The explicit `ATLAS_MODE=solo` opt-in (see Solo mode) allows up to 5 non-docs source files changed directly; verify still.
- **Your Write/Edit only touches orchestration artifacts:** `.atlas/.run/`, `docs/plans/`, `.atlas/evidence/`, and (via curator) durable `docs/`.
- **Do not investigate target code in your own context** when the investigation is more than a glance. Dispatch `atlas:explorer`. Open only orchestration artifacts/manifests for Orient.
- **Specify goal/constraints/acceptance - never the bytes.** Dictating a finished patch is self-implementation.

## Docs/ SSOT (gate-enforced)

`docs/` is authoritative memory. `atlas:docs-curator` writes durable docs; `atlas:docs-auditor` reports drift. Taxonomy: `references/docs-ssot.md`. Placement: `references/scaffolding.md`. Session boundaries: `references/session-lifecycle.md`.

## Token discipline

- Discovery → `atlas:explorer`. Large command output → context-mode. Subagents return short grounded reports.
- Every dispatch names an output contract (`file:line`, permit "I don't know", gaps `[unverified]`). See `references/verification-and-grounding.md` + `references/subagent-kit.md`.
- Recall before re-discovering: `claude-mem` + `ctx_search` (`references/memory-access.md`).
- Sharpen prompts before spend (`references/prompt-optimization.md`).

## Laws and gates (load full text when acting)

**One-line laws:** (1) delegate execution unless the task is simple (2) resolve the team, 2+ workers run as a tmux team; parallel writers share ONE tree as a crew: disjoint file leases, handed over live with `irc give` (no worktrees, no branches); one git policy, `${CLAUDE_PLUGIN_ROOT}/references/git-policy.md` (3) evidence = correct observed behavior on the failing case (4) docs before edits (5) different agent verifies with independent judgment (6) gate writes and completion (7) scaffold per-root.

**Before any other action, run the decision gate:** multi-stage OR multi-surface OR whole-repo/audit? -> Workflow or parallel wave first; no inline. Tripwire advises at 4 inline ops (`ATLAS_TRIPWIRE_THRESHOLD`) and denies the 7th since the last dispatch (a shell call running `atlas_mux.py spawn-team` or `atlas_crew.py run` resets the count) and non-docs Edit|Write|NotebookEdit in orchestration sessions (`ATLAS_TRIPWIRE*`); `docs/`, `.atlas/` and URI (`agent://`, `xd://`) writes are not counted.

**Default dispatch flow (both harnesses, one rule):**
1. Classify the task as `<class>/<effort>` and run `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_resolve.py" <class> <effort> --paths a,b` (classes and teams: `contracts/scope-matrix.json`).
2. 2+ workers building one deliverable across several files (a spec with a section per module, N independent files): `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_crew.py" run --spec SPEC.md --files 'pkg/*.py' --tests 'tests/test_{stem}.py' --check '<test cmd>' --wait 580` (or `--plan plan.json`), one Bash call, Bash timeout 600000: one lean worker per file on an IRC channel, file leases, a per-worker check gate. Do not read the spec or code first. Usage: `references/crew.md`.
   2+ read-only or review workers: `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_mux.py" spawn-team --class C --effort E --paths a,b --task "..."` (omp: the `atlas_team` tool), then `atlas_mux.py wait --team T`, read the board, `atlas_mux.py reap --team T`.
3. One bounded worker (e.g. a single read-only lookup) may stay an in-process `atlas:*` Agent call; its prompt carries `SCOPE: <class>/<effort>` and its role must be on that team. The tripwire denies an unscoped or off-team `atlas:*` dispatch (`ATLAS_SCOPE_GATE=off`: advisory) and advises spawn-team on a 2nd dispatch within 10 s. It denies the 2nd in-process working-role dispatch of a run (`dispatch_denied:team`) when the scope has 2+ working seats and tmux is on PATH; closing roles (planner, verifier, completeness-critic, docs-curator, docs-auditor) are exempt, a run that already launched a team or crew is skipped; no tmux or `ATLAS_TEAM_GATE=off` makes it an advisory (details: `references/subagent-kit.md`).

Full laws, TodoWrite and steering: load `references/laws-and-gates.md` on the first dispatch.

## The loop (load full text when running a wave)

Orient -> Plan (+ TodoWrite) -> Dispatch (resolve, then tmux team) -> Verify (findings.json / test stamp / verifier) -> Self-critique -> Synthesize -> Gate writes -> Finish through definition of done. **Implementation-unit discipline** governs every implementer dispatch: idempotency check, a per-unit evidence strategy (`proof-first` / `characterization` / `no-test-exception`) named in the prompt, and an evidence receipt folded into findings.json. **Parallel implementers work on isolated branches:** lead `atlas_wt.py add <name>` per worker (branch `worker/<name>`, worktree `.atlas/wt/<name>`), a verifier per branch, then `atlas_wt.py merge <name>` one at a time after the verified finding; gate (q) blocks unmerged branches. Protocol and checklists: `references/implementation-units.md`. Each implementer step runs red-green: failing check first, then pass (loop method in `${CLAUDE_PLUGIN_ROOT}/skills/atlas-debug/references/feedback-loop.md`, unit shape in `${CLAUDE_PLUGIN_ROOT}/skills/atlas-plan/references/tracer-slices.md`).

Nothing ships without a verified finding and a docs update. Full loop, fan-out and definition of done: load `references/the-loop.md` when running a wave.

Verification doctrine: `references/verification-and-grounding.md`. Stage maps: `references/multi-stage-planning.md`.

## Feature flow

One feature across UI, API and data runs as a single squad wave closed by an independent verifier. Read `${CLAUDE_SKILL_DIR}/references/feature-flow.md` (inputs, squad, build rules, VERIFY and REPORT contract) and `references/feature-workflow.md` (one failable check per phase). Done when each endpoint was curled (incl. one error path), a DB write read back, and each UI state shown on its route.

## Stop-thoughts

If you think "I'll just read it," "I already tested it," "docs later," or "mark unverified" - **STOP and dispatch**. If you think "too small," check the simple-task rule: inline if it applies, else dispatch. Full table: **load `references/anti-rationalization.md`**.

## Squad and cost tiers

Orchestrator stays Opus-tier; subagents default Sonnet, Haiku for read-and-report. Full tier table + squad list: load `references/squad-and-tiers.md` when choosing a tier. Routing map: `references/capability-routing.md`. Dispatch template: `references/subagent-kit.md`.

**Fork** planner / completeness-critic / docs-curator when history helps. **Never fork** verifier or explorer.

## Automation (hooks)

19 hook programs / 24 bindings auto-load via `hooks/hooks.json` (including the fallow agent gate and the `worker_report_gate` SubagentStop check). Key enforcers: `dispatch_tripwire`, `completion_gate`, `recall_gate`, `fallow_gate`, `todo_capture`, `worker_report_gate`. Fail-open on missing deps. Full list, contract and env: **load `references/hooks-automation.md`**. JS/TS fallow usage: **load `references/fallow-tools.md`**.

## Solo mode (ATLAS_MODE=solo)

For small direct changes in one-developer repos: `export ATLAS_MODE=solo` (case-insensitive) before a run whose work you are doing yourself on the main thread. Unset (or any other value) leaves every gate unchanged.

**Relaxes** (completion_gate only):

- **(m) delegation mandate**: direct main-thread changes to **at most 5 non-docs source files** are acknowledged instead of demanded into an implementer dispatch. Another block states `(m) solo mode: direct changes acknowledged for <N> files; verifier still required for shipped work`. Six or more files fall back to the normal (m) block.
- **(g) verifier coverage**: one real test-runner command executed during the run (pytest, vitest, cargo test, ... - the same detection the stamped-entry credit uses) pairs one unpaired implementer without a stamped findings entry. A stamp with no executed test, or no check, still blocks; one test run covers one implementer.

**What it does NOT relax**: the DELIVERABLE/spec gate (`REQUIRED_SPEC_BLOCKS`), verification evidence itself - (a) evidence capture and (b) the verified findings entry are still required for shipped code - and every other delta gate letter ((a)-(l), (n)-(p)). Solo removes the *dispatch ceremony*, not the *proof of work*: run the test and stamp the finding.

## Reference index - load only when triggered

| Load this | When |
|---|---|
| `references/laws-and-gates.md` | applying laws, decision gate, todos, mid-run steering |
| `references/the-loop.md` | running Orient→Finish or closing a wave |
| `references/implementation-units.md` | dispatching implementer units, resuming interrupted runs, parallel implementer waves, evidence receipts |
| `references/feature-flow.md` | implementing one feature across UI, API and data |
| `references/anti-rationalization.md` | catching "I'll just..." thoughts |
| `references/squad-and-tiers.md` | choosing agent/model/effort |
| `references/capability-routing.md` | task -> agent/skill/MCP/model |
| `references/capability-catalog.md` | recommending installs (atlas-setup) |
| `references/subagent-kit.md` | writing any dispatch |
| `references/scaffolding.md` | Orient / findings / per-root docs |
| `references/memory-access.md` | claude-mem recall |
| `references/execution-testing.md` | FE/BE/DB runtime validation |
| `references/lsp-and-symbols.md` | symbol navigation |
| `references/prompt-optimization.md` | sharpening prompts |
| `references/hooks-automation.md` | hook install/config |
| `references/fallow-tools.md` | JS/TS fallow CLI/MCP/skills + atlas fallow_gate |
| `references/tool-routing.md` | lean-ctx/claude-mem/context-mode/ponytail matrix (min context) |
| `references/claude-code-tuning.md` | Claude Code setup root causes |
| `references/docs-ssot.md` | docs/ taxonomy |
| `references/multi-stage-planning.md` | stage maps, standing consent, fan-out |
| `references/ux-test-swarm.md` | UX swarm |
| `references/verification-and-grounding.md` | failable gate vs self-critique |
| `references/codeql.md` | CodeQL |
| `references/pytest-coverage.md` | pytest coverage |
| `references/workflow-template.md` | Workflow scripts |
| `references/session-lifecycle.md` | start/end docs reconcile |
| `references/dashboard-api.md` | local atlas status/dashboard API |
| `references/remote-access.md` | reaching the colony UI from another device (tailnet-only `tailscale serve`, `atlas_remote.py`) |

## Flag the run

Invoking this skill (or any `atlas:*` dispatch) flags orchestration via the tripwire hook. Fallback:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_db.py" mark-orchestrating "${CLAUDE_CODE_SESSION_ID}" "$(pwd)"
```

## First move

Run **Orient** (recall + roots + manifests + capabilities). Present plan, **write the todo list**, **wait for a yes that names the first wave**. That yes covers that wave only; a later wave or risky action (commit, push, migration, delete) needs its own. Then execute; load `references/the-loop.md` when the first wave starts.

**Opening from `atlas-audit` act-on-finding mode (`atlas-audit <id>`):** use the handoff acceptance criterion as the target and check it on the tree; still Orient; do not re-derive a finding the ledger marks verified.


## Additional references

- [Operating contract](${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md): the plugin-level operating contract (single copy). Read when you need the verify-before-done loop in full.
