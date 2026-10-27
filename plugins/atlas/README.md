# Atlas

Atlas is a Claude Code plugin that runs coding work under a written operating
contract. One model does the work, a separate model in a fresh context tries to
refute it, and a Stop hook refuses a "done" claim until evidence and an
independent verdict exist. Parallel work runs as tmux workers outside your
session, so your context window holds reports instead of raw output.

|            |                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| Version    | 16.2.0 (`.claude-plugin/plugin.json`)                                                                                |
| License    | Apache-2.0                                                                                                           |
| Ships      | 39 skills, 14 agents, 18 hook programs / 22 bindings, 8 JSON contracts                                               |
| Harnesses  | Claude Code (native), omp (extension package), codex (as a colony worker)                                            |
| Runtime    | Python 3 standard library for hooks and scripts; TypeScript for the mod and the omp extension; tmux for worker teams |
| Connectors | None. The 13 vendor MCP connectors moved to the `armada` plugin in 16.0.0                                            |

## Contents

- [What Atlas does](#what-atlas-does)
- [Quick start](#quick-start)
- [How a run works](#how-a-run-works)
- [The operating contract](#the-operating-contract)
- [Adversarial verification](#adversarial-verification)
- [Context offload to tmux workers](#context-offload-to-tmux-workers)
- [Decision models](#decision-models)
- [Skills](#skills)
- [Agents](#agents)
- [Hooks](#hooks)
- [Command Center, statusline and in-terminal mod](#command-center-statusline-and-in-terminal-mod)
- [omp and codex](#omp-and-codex)
- [Self-improvement and telemetry](#self-improvement-and-telemetry)
- [Security and data handling](#security-and-data-handling)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Layout](#layout)
- [Release notes and license](#release-notes-and-license)

## What Atlas does

Atlas is built on four ideas. Each one is enforced by code, not only described
in a prompt.

| Pillar                   | What it means in practice                                                                                                                         | Enforced by                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Operating contract       | Every task follows research, document, implement, verify, report. Every reply carries a phase header. "Done" needs evidence.                      | `references/operating-contract.md`, `contracts/operating-contract.json`, `hooks/completion_gate.py`           |
| Adversarial verification | The agent that writes code never grades it. A verifier with no write tools re-derives the check in a fresh context and confirms or refutes.       | `agents/verifier.md`, `scripts/atlas_finding.py`, completion gate conditions (b) and (g)                      |
| Context offload          | Parallel workers run as separate harness processes in tmux. Each posts one fixed-format report; full output goes to a log file, not your session. | `scripts/atlas_mux.py`, `contracts/worker-protocol.json`, `hooks/worker_report_gate.py`                       |
| Decision models          | Deterministic and model-backed choosers decide when to orchestrate, which team and model tier to use, and which technical option wins.            | `hooks/prompt_decision.py`, `scripts/atlas_resolve.py`, `contracts/scope-matrix.json`, `skills/atlas-bakeoff` |

## Quick start

Requirements: Claude Code, Python 3, git. tmux is needed for worker teams; without
it Atlas falls back to `claude --bg` workers.

1. Add the marketplace and install the plugin:

   ```bash
   claude plugin marketplace add w159/tech-tools
   claude plugin install atlas@tech-tools
   ```

   Expected: `Successfully installed plugin: atlas@tech-tools (scope: user)`.

2. Start a session in a git repository. The SessionStart hook prints
   `Atlas ready`. Until claude-mem and context-mode are both installed it adds
   a pointer to setup:

   ```
   Atlas ready (run the `atlas-setup` skill to complete setup)
   ```

3. Run `atlas-setup` once per project. It is invoked by name, not
   loaded automatically. Onboard mode
   scaffolds `docs/` and `.atlas/`, install mode wires claude-mem and
   context-mode if you approve, and tour mode walks one dispatch and one gate
   event.

4. Point a shell variable at the installed copy, then check health:

   ```bash
   ATLAS=$(ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/tech-tools/atlas/* | sort -V | tail -1)
   python3 "$ATLAS/scripts/atlas_doctor.py"
   ```

   The last line is `HEALTHY - atlas` or a count of problems. `--fix` repairs what
   the check finds.

5. Optional: preview the team Atlas would launch for a task, without starting it:

   ```bash
   python3 "$ATLAS/scripts/atlas_mux.py" spawn-team \
     --class build --effort medium --paths src/a.py --task "demo" --dry-run
   ```

   Output (trimmed): two `implementer` members with `tools_profile: edit`, one
   `verifier` with `tools_profile: exec`, `max_parallel: 3`,
   `isolation: worktree`, and one git worktree per implementer.

Install from a local checkout instead with
`claude plugin marketplace add /path/to/tech-tools`. Org connectors are a
separate install: `claude plugin install armada@tech-tools`
(see [plugins/armada/README.md](../armada/README.md)).

## How a run works

```
 prompt
   |
   v
 UserPromptSubmit: prompt_optimizer classifies (regex, then local decision model
   |                on ambiguous prompts) and arms orchestration for real work
   v
 research -> theory -> test -> validate -> implement -> verify -> done
                                             |            |
                                atlas:implementer     atlas:verifier
                                (edit tools, own      (no write tools, fresh
                                 worktree)             context, refutes)
                                             |            |
                                             +---- findings.json verdict
                                                          |
                                                          v
 Stop: completion_gate checks evidence, verdict, todos, docs, worktrees
       -> blocks with the failing condition letters, or stays silent on pass
```

Phases and glyphs come from `contracts/operating-contract.json`. The header
format is `ATLAS | <glyph> <phase> | <state>`, defined in
`output-styles/atlas-orchestrator.md`, which sets `force-for-plugin: true` so it
applies whenever Atlas is enabled.

## The operating contract

`references/operating-contract.md` is the text every skill and agent loads. In
short:

- The loop is research, document, implement, verify, report, in that order.
- APIs are looked up (Context7, Microsoft Learn) before they are used, never
  rebuilt from memory.
- A claim without evidence is marked `[unverified]` with the command that
  would test it.
- An N-part request is done when all N parts are done. Two failures with one
  strategy means changing strategy.
- A blocked task stops with a fixed `BLOCKED: / Tried: / Need:` block. A
  dispatched worker uses the fixed report container instead.
- Prose is U.S.-keyboard ASCII with no promotional language.

The contract ships neutral. Put your stack, brand tokens and compliance rules in
your project `CLAUDE.md` or `AGENTS.md`; the skills follow them.

The completion gate (`hooks/completion_gate.py`, logic in
`hooks/completion_gate_core.py`) turns the contract into checks. When a run
blocks, it names the letters:

| Letter | Blocks when                                      | Letter | Blocks when                                |
| ------ | ------------------------------------------------ | ------ | ------------------------------------------ |
| a      | no `.atlas/evidence` artifact                    | j      | worktrees left open                        |
| b      | no verified finding                              | k      | no plan (todo list) was made               |
| c      | CHANGELOG missing                                | l      | dated docs not named `<YYYY-MM-DD>_<slug>` |
| d      | ROADMAP missing                                  | m      | code shipped with zero subagent dispatches |
| e      | README missing                                   | n      | status header missing                      |
| f      | docs drift (no CHANGELOG entry for shipped code) | o      | required phases missing                    |
| g      | implementer work not independently verified      | p      | colony channel unused                      |
| h      | ROADMAP not reconciled                           | q      | unmerged worker branches                   |
| i      | open todos                                       |        |                                            |

The gate arms inside a project: a directory with `docs/`, or one under a
project marker (`.git`, `.claude`, `.atlas`, `package.json`, `pyproject.toml`,
`Cargo.toml`, `go.mod`, `CLAUDE.md`, `AGENTS.md`) found by walking up to
`$HOME`, outside `/tmp` and other scratch roots. `ATLAS_GATES=always|off`
overrides the detection (`scripts/atlas_scope.py`). In a session not flagged as an orchestration run only (m) applies; a flagged run
gets every condition. The docs checks (c, d, e, f, h) need `docs/` and apply
only when the run shipped code. The gate stays silent while subagents, workflows or teammates are
still running. `ATLAS_GATE=off` disables it.

Codex runs no Claude Code hooks, so `scripts/atlas_codex_contract.py --write`
renders the same contract into a fenced block in the repo `AGENTS.md`, which
codex reads.

## Adversarial verification

Atlas does not let a model grade its own work. The pattern appears at several
levels:

| Where             | How the models are set against each other                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every code change | `atlas:implementer` makes the change. `atlas:verifier` runs in a fresh context, has Write, Edit and Agent removed (`disallowedTools` in `agents/verifier.md`), re-opens the cited lines, re-runs the tests and returns confirm or refute. The verdict is written with `scripts/atlas_finding.py --status verified\|rejected\|needs-evidence`. Gate conditions (b) and (g) block "done" without it. |
| Before "done"     | `atlas:completeness-critic` hunts unverified claims, unread sources and unmet requirements, and refutes "done" on a load-bearing gap.                                                                                                                                                                                                                                                              |
| Reviews           | `atlas-review` selects reviewer personas by risk from 13 lenses, one of them `adversarial`, and verifies P0/P1 findings before the verdict.                                                                                                                                                                                                                                                        |
| Fan-out review    | The `fan-out-adversarial-verify` loop (`skills/atlas-loop/loops/`) runs one reviewer per lens in parallel, then a separate verifier per finding that is given the symptom, never the reviewer's conclusion.                                                                                                                                                                                        |
| Technical choices | `atlas-bakeoff` builds 2 or 3 candidates as fresh-context dispatches and has `atlas:verifier` judge them against named criteria.                                                                                                                                                                                                                                                                   |
| Across vendors    | `atlas_mux.py spawn --harness claude\|omp\|codex` is set per worker, so an implementer on one harness and model can be checked by a verifier on another.                                                                                                                                                                                                                                           |

The orchestrator keeps the verdict out of reach of the worker that produced the
code: the worker report gate (`hooks/worker_report_gate.py`) rejects a subagent
whose final message is not the fixed report, and the dispatch tripwire
(`hooks/dispatch_tripwire.py`) denies any subagent that tries to dispatch
another subagent.

## Context offload to tmux workers

A long task run inline fills the main context window with file reads and tool
output. Atlas moves that work out:

```bash
# Size a team from the scope matrix and start it as tmux panes
python3 "$ATLAS/scripts/atlas_mux.py" spawn-team \
  --class build --effort medium --paths src/a.py,src/b.py --task "..."
# Block until every member has posted its report
python3 "$ATLAS/scripts/atlas_mux.py" wait --team <team_id>
# Kill the tmux session and archive the team record
python3 "$ATLAS/scripts/atlas_mux.py" reap --team <team_id>
```

- Each worker is its own headless process (`claude -p --agent atlas:<role>`,
  `omp -p`, or `codex exec`) in tmux session `atlas-<team_id>`, one pane per
  member.
- A worker posts exactly one note to the lead: the STATUS, DELIVERABLE,
  EVIDENCE and NEXT report from `contracts/worker-protocol.json`. Full stdout and
  stderr go to `<project>/.atlas/.run/logs/<worker>.log`. The lead reads the
  report; the log stays on disk.
- Implementers get their own git worktree and branch
  (`atlas/<team>/<member>`). Gate condition (q) blocks until worker branches are
  merged.
- Claude workers get `--allowedTools` scoped by their `tools_profile` (`read`,
  `edit`, `exec`), so an exec worker can run test runners and read-only git
  without a permission prompt.
- Workers share one durable todo board at `<project>/.atlas/.run/todos.json`
  (file lock plus temp-file rename) and an append-only notes file per worker at
  `.atlas/.run/board/<name>.jsonl`. `scripts/atlas_todo.py` has the `note`,
  `notes`, `inbox`, `claim` and channel commands.

A 2-member team run over tmux (both workers exit 0 in 26-27 s, report
posted, `wait` ok, `reap` leaves no session) is recorded in
[docs/audits/2026-10-27_atlas-16.0.0-evidence.md](../../docs/audits/2026-10-27_atlas-16.0.0-evidence.md).

Transport is tmux when installed, `claude --bg` otherwise; `ATLAS_COLONY_TRANSPORT`
forces `tmux`, `herdr` or `claude-bg`. `ATLAS_MUX=off` turns colony mode off.
Inside the main session, the context-mode and lean-ctx routing described under
[Hooks](#hooks) keeps large tool output out of the window as well.

## Decision models

Atlas makes three kinds of decisions with a defined chooser instead of free
judgment:

1. When to orchestrate. `hooks/prompt_optimizer.py` classifies each prompt with a
   regex. Prompts the regex leaves ambiguous go to a local decision model
   (`hooks/prompt_decision.py`): Ollama at `http://127.0.0.1:11434`, model
   `nimble`, 4 second timeout. A confident `code_change` or `investigation`
   label can arm a regex miss; a confident conversation label vetoes a regex
   arm, and only when the prompt also names an engineering object. Timeout, low
   confidence or `ATLAS_DECISION=off` keeps the regex answer. The default
   endpoint is local; `ATLAS_DECISION_URL` and `ATLAS_DECISION_MODEL` change it.
2. Which team, at what cost. `scripts/atlas_resolve.py <class> <effort>` reads
   `contracts/scope-matrix.json` and returns the roles, counts, model tier,
   effort and isolation for the task. It is deterministic: the same input gives
   the same team. Example:

   ```
   $ python3 scripts/atlas_resolve.py build medium --paths src/a.py
   {"effort": "medium", "file_scope": ["src/a.py"], "isolation": "worktree",
    "max_parallel": 3, "task_class": "implement", "team": [
     {"count": 2, "effort": "medium", "model": "sonnet", "role": "implementer", "tools_profile": "edit"},
     {"count": 1, "effort": "medium", "model": "sonnet", "role": "verifier", "tools_profile": "exec"}]}
   ```

   The dispatch tripwire denies an `atlas:*` dispatch that overrides the
   agent's pinned `model:`, so the resolved tier is the tier that runs.

3. Which option wins. `atlas-bakeoff` compares 2 or 3 approaches against named
   criteria, or grades one option Adopt, Trial, Hold or Reject.

## Skills

39 skills. Three are invoked by name only (`disable-model-invocation: true`):
`atlas-setup`, `atlas-prompt` and `atlas-tui`. The other 36 load on relevance
from their `description`. Overlapping capabilities are modes of one skill, not
separate skills; each multi-mode skill documents its modes in its `SKILL.md` or
its `references/`.

| Area    | Skill                     | What it does                                                                                                                                    |
| ------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine  | atlas-orchestrate         | Runs multi-step or whole-codebase work through subagents with independent verification; feature mode builds one feature across UI, API and data |
| Engine  | atlas-autopilot           | Consent-gated pipeline: runs a ready plan, simplifies, reviews, fixes under a budget, stops at the local commit                                 |
| Engine  | atlas-loop                | Matches a recurring or iterative task to a library loop (interval via `/loop`, or a parallel fan-out verify)                                    |
| Plan    | atlas-brainstorm          | Asks one hard question at a time until requirements are clear; writes a requirements-only plan or a product strategy                            |
| Plan    | atlas-plan                | Writes an implementation-ready plan to `docs/plans/` with numbered units and a verification contract                                            |
| Plan    | atlas-prompt              | Rewrites a vague request into a structured prompt, asking up to three questions                                                                 |
| Plan    | atlas-bakeoff             | Decides a costly technical choice with evidence (bakeoff or verdict mode)                                                                       |
| Plan    | atlas-prototype           | Builds a throwaway prototype to answer one product-shape question                                                                               |
| Build   | atlas-debug               | Finds and fixes the root cause of a reproducible failure, with evidence                                                                         |
| Build   | atlas-refactor            | Restructures code without changing behavior, with before and after evidence                                                                     |
| Build   | atlas-simplify            | Behavior-preserving simplification of a fresh diff, then re-runs the gate                                                                       |
| Build   | atlas-optimize            | One baseline, one hypothesis, one change, one identical re-measure                                                                              |
| Build   | atlas-frontend            | Builds, refactors or polishes UI on one design system, verified in a browser                                                                    |
| Build   | atlas-harden              | Writes an idempotent CHECK/SET/VERIFY endpoint remediation script for RMM or MDM                                                                |
| Build   | atlas-gitignore           | Generates a deny-by-default `.gitignore` for a named stack                                                                                      |
| Verify  | atlas-review              | Risk-selected multi-persona diff review; verdict Ready, Ready-with-fixes or Not-ready                                                           |
| Verify  | atlas-testing             | Detects the stack, maps test gaps across types, writes and runs the highest-value next test                                                     |
| Verify  | atlas-ux-test             | Persona-driven browser walkthroughs and fuzzing of a web app                                                                                    |
| Verify  | atlas-dogfood             | Drives the branch diff in a live browser; full mode repairs, smoke mode reports                                                                 |
| Verify  | atlas-test-xcode          | Builds and tests an iOS app on the simulator (macOS only)                                                                                       |
| Verify  | atlas-validate            | Checks a finished Claude Code plugin's structure, manifest and content                                                                          |
| Audit   | atlas-audit               | Code, architecture, self (Atlas run health) or act (remediate one finding)                                                                      |
| Audit   | atlas-db-audit            | Read-only live database audit: schema, schema-to-code, privileges, naming                                                                       |
| Audit   | atlas-explain             | Explains how existing code behaves, with file:line evidence; read-only                                                                          |
| Ship    | atlas-ship                | Verifier checks a clean tree, makes the local commit, stops before any push or PR                                                               |
| Ship    | atlas-worktree            | Creates, reuses and tears down linked git worktrees with dirty-state protection                                                                 |
| Ship    | atlas-run-watch           | Watches a long job or one PR's CI; repairs genuine CI failures, asks before pushing, never merges                                               |
| Ship    | atlas-resolve-pr-feedback | Triages PR review threads, applies approved fixes, confirms before posting                                                                      |
| Docs    | atlas-readme              | Generates a README by inspecting the repo, every claim traced to a file                                                                         |
| Docs    | atlas-wiki                | Refreshes `docs/wiki/` diagrams from `docs/architecture/`                                                                                       |
| Docs    | atlas-compound            | Captures one verified, non-obvious lesson into `docs/lessons/`                                                                                  |
| Docs    | atlas-proof               | Publishes a doc for human review and folds anchored comments back                                                                               |
| Docs    | atlas-handoff             | Writes a dense handoff so a fresh session resumes without re-discovery                                                                          |
| Report  | atlas-status              | Status rollup labeled verified or assumed; announce mode drafts release notes                                                                   |
| Report  | atlas-pulse               | Read-only, time-windowed usage, performance and error pulse into `docs/pulses/`                                                                 |
| Report  | atlas-sweep               | Triages GitHub issues (never auto-closes) or turns transcripts into quoted findings                                                             |
| Operate | atlas-setup               | Manual: onboard, install, connectors, repair, tour, menu                                                                                        |
| Operate | atlas-doctor              | Mines cross-session telemetry into findings, applies accepted changes, records a baseline                                                       |
| Operate | atlas-tui                 | Opens a terminal UI over the colony's tmux workers                                                                                              |

## Agents

14 agents, registered as `atlas:<role>`. Each pins its model and effort in
frontmatter (a fork inherits the parent's instead); read-only agents have every
write and edit tool removed.

| Agent                 | Model / effort  | Job                                                               | Writes code |
| --------------------- | --------------- | ----------------------------------------------------------------- | ----------- |
| explorer              | haiku / low     | Maps where code lives and how it connects                         | No          |
| planner               | sonnet / high   | Numbered stage map, one failable check per stage                  | No          |
| implementer           | sonnet / medium | One bounded change as a minimal diff, then the project gate       | Yes         |
| runner                | haiku / low     | Runs at most 7 exact numbered steps on at most 5 files            | Yes         |
| test-engineer         | sonnet / medium | Writes tests, proves each fails on a seeded fault, runs the suite | Tests only  |
| verifier              | sonnet / medium | Confirms or refutes a claimed fix in a fresh context              | No          |
| completeness-critic   | sonnet / medium | Gap list before "done"                                            | No          |
| ui-runtime-tester     | sonnet / low    | Runs the app in a real browser and checks observed states         | No          |
| docs-curator          | sonnet / low    | Maintains `docs/`, `.atlas/` and root entry files                 | Docs only   |
| docs-auditor          | haiku / low     | Docs-versus-code drift verdict per area                           | No          |
| db-prober             | sonnet / low    | Schema, RLS, grants, indexes, EXPLAIN plans                       | No          |
| schema-inventory      | haiku / low     | PostgreSQL catalog inventory                                      | No          |
| rls-privilege-audit   | sonnet / medium | RLS and grants against least privilege                            | No          |
| naming-glossary-audit | haiku / low     | Table and column names against a glossary                         | No          |

`atlas:planner`, `atlas:completeness-critic` and `atlas:docs-curator` are meant
to run as forks to inherit history (needs `CLAUDE_CODE_FORK_SUBAGENT=1`). `atlas:verifier` and `atlas:explorer` never
fork, so their judgment starts clean.

## Hooks

18 hook programs / 22 bindings, wired from `hooks/hooks.json` when the plugin is
enabled. `hooks/event_dispatch.py` runs the PreToolUse and PostToolUse hooks in
one process per tool event, each with its original matcher and a time slice;
`hooks/stop_tail.py` does the same for four Stop hooks. Measured on 16.0.0,
median Pre+Post blocking time per Bash call fell from 289 ms to 174 ms
([evidence](../../docs/audits/2026-10-27_atlas-16.0.0-evidence.md)).

Most hooks fail open on an internal error. Five deny or block on purpose:
`dispatch_tripwire.py`, `recall_gate.py`, `completion_gate.py`,
`worker_report_gate.py`, and `fallow_gate.py` (when the fallow CLI returns
`verdict: fail` or is older than `FALLOW_GATE_MIN_VERSION`, default 2.85.0;
fail-open when the CLI is absent).

| Hook                            | Event                                                              | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_boot.py`               | SessionStart                                                       | Activates the runtime, reports missing companions, surfaces lessons, carries the todo board over, repairs an existing `docs/` tree                                                                                                                                                                                                                                                                                                           |
| `atlas_doctor.py --hook`        | SessionStart                                                       | Warn-only health check: downgrade, forked marketplace, missing hooks or assets                                                                                                                                                                                                                                                                                                                                                               |
| `prompt_optimizer.py`           | UserPromptSubmit                                                   | Optional prompt rewrite; arms orchestration for engineering prompts (see [Decision models](#decision-models))                                                                                                                                                                                                                                                                                                                                |
| `event_dispatch.py`             | PreToolUse, PostToolUse                                            | One process per tool event that runs the hooks below in-process                                                                                                                                                                                                                                                                                                                                                                              |
| `recall_gate.py`                | PreToolUse                                                         | With claude-mem enabled, denies tool calls until one real claude-mem recall happens (`ATLAS_MANDATES=off`)                                                                                                                                                                                                                                                                                                                                   |
| `bash_advisor.py`               | PreToolUse (Bash)                                                  | Warns on catastrophic commands; never denies                                                                                                                                                                                                                                                                                                                                                                                                 |
| `edit_read_nudge.py`            | PreToolUse, PostToolUse                                            | Nudges when an edit targets a file read only through `ctx_read`                                                                                                                                                                                                                                                                                                                                                                              |
| `dispatch_tripwire.py`          | PreToolUse, PostToolUse, SubagentStart                             | Routes native Grep and Glob to lean-ctx where it is configured; counts inline work and denies past the threshold in orchestration runs; names an unnamed `atlas:*` dispatch (denies it instead with `ATLAS_AUTONAME=off`); denies model-overriding `atlas:*` dispatches, dispatches missing the GOAL / DELIVERABLE / SUCCESS CRITERIA / OUT OF SCOPE / STOP CONDITIONS spec or bundling more than one GOAL, and any nested subagent dispatch |
| `fallow_gate.py`                | PreToolUse (Bash)                                                  | Runs `fallow audit` on `git commit` and `git push` and denies on `verdict: fail` or a CLI below the minimum version (`ATLAS_FALLOW=off`)                                                                                                                                                                                                                                                                                                     |
| `todo_capture.py`               | PostToolUse                                                        | Mirrors TodoWrite plans to the durable board (`ATLAS_TODO=off`)                                                                                                                                                                                                                                                                                                                                                                              |
| `docs_drift_watch.py`           | PostToolUse                                                        | Warns as soon as code ships without a `docs/CHANGELOG.md` entry (debounced per session)                                                                                                                                                                                                                                                                                                                                                      |
| `delegation_prewarn.py`         | PostToolUse                                                        | Once per session, warns that an inline code edit will trip gate condition (m)                                                                                                                                                                                                                                                                                                                                                                |
| `connector_credential_watch.py` | PostToolUse                                                        | On the first 401 or 403 from an armada connector, says to restart the server instead of retrying (`ATLAS_CONNECTOR_WATCH=off`)                                                                                                                                                                                                                                                                                                               |
| `format_after_edit.py`          | PostToolUse (Edit, Write)                                          | Runs the repo's formatter                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `completion_gate.py`            | Stop                                                               | Blocks a premature "done" (conditions a to q above)                                                                                                                                                                                                                                                                                                                                                                                          |
| `stop_tail.py`                  | Stop                                                               | Runs `ingest_session.py`, `chronicle_facet.py`, `memory_capture.py` and `nudge.py` in one interpreter                                                                                                                                                                                                                                                                                                                                        |
| `ingest_session.py`             | SubagentStop, SessionEnd, PreCompact (and Stop via `stop_tail.py`) | Mirrors the transcript into the observability DB (`ATLAS_INGEST=off`)                                                                                                                                                                                                                                                                                                                                                                        |
| `worker_report_gate.py`         | SubagentStop                                                       | Blocks an `atlas:*` subagent whose final message is not the fixed report (once per agent)                                                                                                                                                                                                                                                                                                                                                    |

`chronicle_facet.py` writes one facets row per session, `memory_capture.py`
saves lessons to `<project>/.atlas/memory/MEMORY.md` (`ATLAS_MEMORY_CAPTURE=off`), and `nudge.py` prompts a lesson capture when
none was written. For installs outside the plugin system,
`scripts/install_hooks.py` wires the hooks into settings.

## Command Center, statusline and in-terminal mod

Command Center. A local web dashboard on `http://127.0.0.1:7421/`. It is off
by default; set `ATLAS_DASHBOARD=on` to start it at session start, or run:

```bash
python3 "$ATLAS/scripts/atlas_dashboard.py" serve --port 7421
```

It shows the colony roster, the todo board, per-branch channels, live terminal
seats, doctor findings and settings, updated over Server-Sent Events. It binds
loopback only unless `--allow-remote` is passed; every request checks the
`Host` and `Origin`, and mutations and the live stream need a per-daemon
`X-Atlas-Token`. API reference:
`skills/atlas-orchestrate/references/dashboard-api.md`.

Statusline. Project, model, effort, context meter, rate-limit meters and session
cost in one widget:

```bash
python3 "$ATLAS/scripts/atlas_statusline.py" install
python3 "$ATLAS/scripts/atlas_statusline.py" uninstall
```

`install` saves your previous `statusLine` and `uninstall` restores it.

In-terminal mod. `mod/register.ts`, wired by the `modules` entry in
`hooks/hooks.json`, draws a one-row band above the prompt (phase, progress,
live workers, gate count) and a sidebar with route, team, channel and gates
views; `/atlas-cc` opens it. Gate readings come from
`scripts/atlas_gates.py --session <id> --root <repo> --json`, which shares its
evaluation with the Stop hook. `ATLAS_MOD=off` disables it. Detail:
[docs/architecture/atlas-mod.md](../../docs/architecture/atlas-mod.md).

## omp and codex

omp. Load the extension package by directory:

```bash
omp --extension /abs/path/to/tech-tools/plugins/atlas/omp
```

or add that directory to `extensions:` in `~/.omp/agent/config.yml`. The same
rules apply on both harnesses because both read `contracts/native-tools.json`,
`contracts/mandates.json`, `contracts/tool-names.json` and
`contracts/hook-bridge.json`, and both test suites run the shared cases. omp
runs the Stop-family gates through a bridge (`omp/stop-bridge.ts`). What is and
is not yet verified on a live omp run is tracked row by row in
[docs/architecture/atlas-harness-parity.md](../../docs/architecture/atlas-harness-parity.md).
See [omp/README.md](omp/README.md) for agent generation and model roles.

codex. Codex runs as a colony worker (`--harness codex`) and reads the contract
from `AGENTS.md` (written by `scripts/atlas_codex_contract.py --write`). Its own
config picks the model.

## Self-improvement and telemetry

- `ingest_session.py` mirrors each transcript into a local SQLite database
  (`~/.atlas/atlas.db` unless `ATLAS_DB` or `ATLAS_HOME` is set).
- `atlas_doctor.py --mine` turns that telemetry into findings, which the
  `atlas-doctor` skill walks through. `--baseline` and `--remeasure` prove a fix
  against the same metric.
- `atlas-audit` self mode reports verifier coverage, inline work and parallel
  waves from the same database.
- `scripts/atlas_context_optimizer.py` disables skills and agents that real
  usage shows are unused.
- Optional turn scoring: with `TYPESAFE_API_KEY` set, recent replies are sent to
  api.typesafe.ai and scored. Excerpts leave the machine with secrets scrubbed.
  `ATLAS_TYPESAFE_SCORING=off` disables it. Without the key nothing is sent.
  Detail: [docs/architecture/atlas-turn-scoring.md](../../docs/architecture/atlas-turn-scoring.md).

No hook creates a skill or a slash command. Learned knowledge goes to findings,
`docs/lessons/` and memory.

## Security and data handling

- No push without consent. `atlas-ship`, `atlas-run-watch` and
  `atlas-resolve-pr-feedback` stop before any push, PR or posted reply;
  `atlas-run-watch` never merges.
- Untrusted input stays labeled. Board notes and recalled memory reach agents
  wrapped as untrusted data, a forged closing tag cannot escape the wrapper, and
  SSN and NPI patterns are redacted at ingest (16.0.0 evidence, fix 5).
- Least privilege for workers. Read-only agents have write tools removed in
  frontmatter. Colony workers get `--allowedTools` scoped to their profile.
- Loopback dashboard with Host, Origin and token checks (see above).
- No connector processes. A plain Atlas install starts zero MCP servers; vendor
  connectors are opt-in through armada (16.0.0 evidence: 0 processes and 0 MB
  versus 12 processes and 901.6 MB on 15.2.1).

## Configuration

Settings are environment variables. The Command Center Settings page writes
them to `~/.atlas/settings.json`, which hooks overlay on the next run. Common
switches:

| Variable                                                       | Default                  | Effect                                                        |
| -------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------- |
| `ATLAS_GATE`                                                   | on                       | `off` disables the completion gate                            |
| `ATLAS_GATE_HEADER`, `ATLAS_GATE_PHASES`, `ATLAS_GATE_COLONY`  | on                       | Turn off gate conditions n, o, p individually                 |
| `ATLAS_WT_GATE`                                                | on                       | `off` disables condition (q)                                  |
| `ATLAS_TRIPWIRE`, `ATLAS_TRIPWIRE_HARD`                        | on                       | `off` disables the tripwire, or only its deny tier            |
| `ATLAS_ENGINE_ARM`                                             | on                       | `off` stops prompts from arming orchestration                 |
| `ATLAS_DECISION`, `ATLAS_DECISION_URL`, `ATLAS_DECISION_MODEL` | on, loopback, `nimble`   | Local decision model                                          |
| `ATLAS_MANDATES`                                               | on                       | `off` drops the recall gate and companion nudges              |
| `ATLAS_MUX`, `ATLAS_COLONY_TRANSPORT`                          | on, auto                 | Colony mode and transport                                     |
| `ATLAS_DASHBOARD`                                              | off                      | `on` starts the Command Center at session start               |
| `ATLAS_MOD`                                                    | on                       | Claude Code in-terminal mod                                   |
| `ATLAS_CHANNELS`                                               | on                       | Colony channels: dispatch steering and the omp channel widget |
| `ATLAS_STATUSLINE`                                             | on                       | omp statusline only                                           |
| `ATLAS_INGEST`, `ATLAS_TODO`, `ATLAS_DOCS_REPAIR`              | on                       | Telemetry ingest, board mirror, docs repair                   |
| `ATLAS_FALLOW`, `ATLAS_CONNECTOR_WATCH`                        | on                       | Commit gate, connector credential advice                      |
| `ATLAS_TYPESAFE_SCORING`                                       | on (inert without a key) | Turn scoring                                                  |

Companions, recommended by `atlas-setup` and used when present: claude-mem
(cross-session memory), context-mode (keeps large output out of the context
window), serena (symbol navigation and edits), lean-ctx (shaped search and
read), ponytail (optional), and Fallow for JS and TS trees. Atlas uses only the
tools present in the session.

## Troubleshooting

| Symptom                                                                                 | Cause and fix                                                                                                                                                               |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Doctor warns `cannot read plugin config: installed_plugins.json`                        | Atlas 15.x and earlier on a claude.ai synced or `--plugin-dir` load. 16.0.0 recognizes both loads. Update the plugin.                                                       |
| Stop blocks with `conditions: a b`                                                      | Code shipped without an evidence artifact or a verified finding. Dispatch `atlas:verifier` and record the verdict with `scripts/atlas_finding.py`.                          |
| An `atlas:*` dispatch is denied                                                         | The prompt is missing the TOOLS block or a spec block, has no `name` with `ATLAS_AUTONAME=off`, overrides the pinned model, or has two GOALs. The deny message names which. |
| `spawn-team` reports `worktree: fatal: invalid reference: HEAD`                         | The repo has no commit yet. Make the first commit, then spawn again.                                                                                                        |
| Connector tools return 401 after a key rotation                                         | The server cached old credentials. Restart the session.                                                                                                                     |

Run `python3 "$ATLAS/scripts/atlas_doctor.py" --fix` first for any
wiring problem.

## Layout

```
atlas/
|-- .claude-plugin/plugin.json   manifest, version 16.2.0
|-- agents/                      14 agents (atlas:<role>)
|-- skills/                      39 skills, one directory each
|-- hooks/                       hook programs, hooks.json, tests
|-- scripts/                     CLIs: doctor, mux, resolve, todo, finding, gates,
|                                dashboard, statusline, worktrees, telemetry
|-- contracts/                   operating contract, scope matrix, worker protocol,
|                                native-tools, mandates, tool names, hook bridge,
|                                MCP server name lists
|-- references/                  operating-contract.md and shared references
|-- output-styles/               atlas-orchestrator.md (force-for-plugin)
|-- mod/                         Claude Code in-terminal mod
|-- omp/                         omp extension package
|-- colony/                      herdr transport and its web UI
`-- package.json                 omp extension entry for marketplace installs
```

## Release notes and license

Changes by version: [CHANGELOG.md](CHANGELOG.md). Before and after measurements
for 16.0.0:
[docs/audits/2026-10-27_atlas-16.0.0-evidence.md](../../docs/audits/2026-10-27_atlas-16.0.0-evidence.md).

Licensed under Apache-2.0, as declared in `.claude-plugin/plugin.json`.
