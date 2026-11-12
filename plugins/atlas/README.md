# Atlas

Atlas is a Claude Code plugin that runs coding work under a written operating
contract. One model does the work, a separate model in a fresh context tries to
refute it, and a Stop hook refuses a "done" claim until evidence and an
independent verdict exist. Parallel work runs as tmux workers outside your
session, so your context window holds reports instead of raw output.

|            |                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| Version    | 17.14.0 (`.claude-plugin/plugin.json`)                                                                              |
| License    | Apache-2.0                                                                                                           |
| Ships      | 40 skills, 11 agents, 19 hook programs / 23 bindings, 11 JSON contracts                                              |
| Harnesses  | Claude Code (native), Codex (skills, hooks, and workers), omp (extension package)                                    |
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
- [Telemetry](#telemetry)
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

   Problems print first, passing checks fold into one `✓ N checks pass` line,
   and checks that do not apply on this machine fold into one
   `· N not applicable here; --verbose lists them` line (`--verbose` lists every
   check, the not-applicable ones as `SKIP`). The last line is the verdict, then the
   tally:

   ```
   4 warning(s) to review  ·  23 pass, 4 warnings, 0 failures, 10 not applicable
   ```

   The verdict is `Healthy` when nothing warns or fails, `N warning(s) to review`
   when a check warns, and `N problem(s) need attention` when a check fails.
   `--fix` repairs what the check finds.

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
| i      | open todos                                       | r      | `done` header while work is open           |
|        |                                                  | s      | 2+ in-process workers, no tmux team or crew |

The gate arms inside a project: a directory with `docs/`, or one under a
project marker (`.git`, `.claude`, `.atlas`, `package.json`, `pyproject.toml`,
`Cargo.toml`, `go.mod`, `CLAUDE.md`, `AGENTS.md`) found by walking up to
`$HOME`, outside `/tmp` and other scratch roots. `ATLAS_GATES=always|off`
overrides the detection (`scripts/atlas_scope.py`). In a session not flagged as an orchestration run only (m) applies; a flagged run
gets every condition. The docs checks (c, d, e, f, h) need `docs/` and apply
only when the run shipped code. While subagents, workflows or teammates are still running the gate
checks only the reply itself: (n) blocks a reply without the status header and (r) blocks a `done`
header. (n) blocks every such reply, up to the loop cap (`ATLAS_GATE_BLOCK_LOOP`, default 3).
`ATLAS_GATE=off` disables it.

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
output. Atlas moves that work out in two shapes: a crew for a parallel build,
and a team for read-only work. When the prompt optimizer arms a session it
names the resolved team and the next command. With tmux on PATH the dispatch
tripwire denies every in-process working-role dispatch (`dispatch_denied:team`),
the first one and a one-seat or `low` scope included; closing roles are exempt.
Without tmux, under omp or with `ATLAS_TEAM_GATE=off` the 2nd in-process
working-role dispatch of a run whose scope has 2+ working seats gets an advisory.
Completion gate (s) blocks once when a run ends with 2+ in-process working-role
dispatches and no team or crew record. `atlas_crew.py run` stamps `lead_session` into `run.json` (`--session`,
else the first set of `CLAUDE_CODE_SESSION_ID`, `CLAUDE_SESSION_ID`,
`ATLAS_SESSION_ID`, else empty, with a `warning` field in the output) so gate (p)
can tie a crew to its session. A team or crew launched in the run does not lift
the deny. `atlas_crew.py run` refuses a plan whose worker check already passes
before launch (a worker stops as soon as its check passes); `--allow-green-check`
overrides.

### Crew: a parallel build that talks over IRC

```bash
# One call: one worker per file, each with only its own spec section, waits for the result
python3 "$ATLAS/scripts/atlas_crew.py" run --spec SPEC.md --files 'pkg/*.py' \
  --tests 'tests/test_{stem}.py' --check 'python3 -m pytest -q' --wait 580
tmux attach -t atlas-<run>          # watch: one window per worker, plus the channel
# or from a Claude session, with the same flags: the crew runs before the lead's first model call
/atlas:atlas-crew --spec SPEC.md --files 'pkg/*.py' --tests 'tests/test_{stem}.py' --check 'python3 -m pytest -q'
```

- Workers share one IRC channel (`scripts/atlas_irc.py`): an append-only log
  plus a real IRC gateway on 127.0.0.1, so you can join `#<run>` from any IRC
  client and talk to the crew. A hook pushes new channel lines into each
  worker's context after every tool call. Each worker is handed the interfaces
  of the peer files it imports; `irc check` waits for those peers, runs the
  worker's check and posts DONE only if it passes. Workers send each other bug
  reports (`irc say --to <nick>`) and wait with `irc wait`, never `sleep`.
- Each worker owns a set of files on one tree. A hook denies edits to a peer's
  file and names the owner to ask. No worktrees, so nothing waits on a merge.
- A worker cannot stop until its own check passes: the Stop hook re-runs the
  check instead of taking the worker's word. After all workers exit, the
  global check runs and only the owners of failing tests are resumed.
- Workers are lean: their own session id, no MCP servers, project settings
  only, tools `Bash,Edit`, a short system prompt. The lead's context gets one
  JSON summary (tokens, cost, wall time, gate refusals, channel counts).

Measured on two spec-driven builds against one Claude prompt with the same
model (claude-sonnet-5-5, effort medium) and the same task text; all runs
passed every test. Numbers and method: [2026-10-28_atlas-16.4.0-crew-benchmark.md](../../docs/audits/2026-10-28_atlas-16.4.0-crew-benchmark.md).

| Task                                   | Single prompt (median) | Crew (median)       | Crew vs single |
| -------------------------------------- | ---------------------- | ------------------- | -------------- |
| 8 modules, 213 tests (3 runs each)     | 853k tokens, 144 s     | 137k tokens, 41 s   | 16% tokens, 28% time |
| 18 modules, 469 tests (3 runs each)    | 2.29M tokens, 181 s    | 307k tokens, 55 s   | 13% tokens, 30% time |

Usage and the plan format: `skills/atlas-orchestrate/references/crew.md`.

### Warm lead: a lead that is already started

```bash
python3 "$ATLAS/scripts/atlas_warm_lead.py" start --root . -- claude --model sonnet --effort medium
python3 "$ATLAS/scripts/atlas_warm_lead.py" send --root . --wait "/atlas:atlas-crew --spec SPEC.md --files 'pkg/*.py'"
python3 "$ATLAS/scripts/atlas_warm_lead.py" status --root .
python3 "$ATLAS/scripts/atlas_warm_lead.py" stop --root .
```

`start` runs the lead in a detached tmux session `atlas-warm-lead` and returns when it is idle.
`send --wait` returns when the task is finished: with background agents running it waits for the last
`result` (JSON: `result`, `is_error`, `results`, `handoff_s`). After each task the lead is recycled
(`--recycle off` keeps one conversation). Add no permission flags unless the lead needs them.

### Team: read-only and review work

```bash
# Size a team from the scope matrix and start it as tmux panes
python3 "$ATLAS/scripts/atlas_mux.py" spawn-team \
  --class build --effort medium --paths src/a.py,src/b.py --task "..."
# Block until every member has posted its report
python3 "$ATLAS/scripts/atlas_mux.py" wait --team <team_id>
# Kill the tmux session and archive the team record
python3 "$ATLAS/scripts/atlas_mux.py" reap --team <team_id>
```

Each of the three prints a few lines of text (team id, one line per member, the
next command). Add `--json` for the full JSON object.

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
   endpoint is local; `ATLAS_DECISION_URL` and `ATLAS_DECISION_MODEL` change it. The class and
   effort in the arming nudge do not come from this model: `classify_scope` in
   `hooks/prompt_optimizer_core.py` is a first-match keyword heuristic over the
   scope-matrix class names and aliases (so "do not audit, just implement x"
   classifies as audit). Moving it onto the decision model is open work.
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

40 skills. Three are invoked by name only (`disable-model-invocation: true`):
`atlas-setup`, `atlas-tui` and `atlas-crew`. The other 37 load on relevance
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
| Plan    | atlas-prompt              | Rewrites a rough prompt into a right-sized one; an independent judge model checks that every goal and limit survived                            |
| Plan    | atlas-bakeoff             | Decides a costly technical choice with evidence (bakeoff or verdict mode)                                                                       |
| Plan    | atlas-prototype           | Builds a throwaway prototype to answer one product-shape question                                                                               |
| Build   | atlas-debug               | Finds and fixes the root cause of a reproducible failure, with evidence                                                                         |
| Build   | atlas-refactor            | Restructures code, or simplifies a fresh diff, without changing behavior; before and after evidence, gate re-run                                |
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
| Ship    | atlas-security            | Triages Dependabot, code-scanning and secret alerts, fixes on one branch, a fresh verifier confirms each fix |
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
| Operate | atlas-crew                | Builds a multi-file deliverable with a parallel tmux + IRC crew, one worker per file, from a pre-executed run |

## Agents

11 agents, registered as `atlas:<role>`. Each pins its model and effort in
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
| db-prober             | sonnet / medium | Modes: catalog inventory, RLS and grants audit, glossary naming audit, EXPLAIN probe | No          |

`atlas:planner`, `atlas:completeness-critic` and `atlas:docs-curator` are meant
to run as forks to inherit history (needs `CLAUDE_CODE_FORK_SUBAGENT=1`). `atlas:verifier` and `atlas:explorer` never
fork, so their judgment starts clean.

## Hooks

19 hook programs / 23 bindings. `hooks/hooks.json` holds 14 commands on 9 events
(SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SubagentStart,
SubagentStop, SessionEnd, PreCompact); two of them are `event_dispatch.py`, which
runs the other hooks in-process, and the count of bindings is the 12 other commands
plus the 11 hooks the dispatcher runs. `hooks/event_dispatch.py` runs the PreToolUse and PostToolUse hooks in
one process per tool event, each with its original matcher and a time slice;
`hooks/stop_tail.py` does the same for four Stop hooks. Measured on 16.0.0,
median Pre+Post blocking time per Bash call fell from 289 ms to 174 ms
([evidence](../../docs/audits/2026-10-27_atlas-16.0.0-evidence.md)).

Most hooks fail open on an internal error. Six deny or block on purpose:
`dispatch_tripwire.py`, `recall_gate.py`, `completion_gate.py`, `crew_worker.py`,
`worker_report_gate.py`, and `fallow_gate.py` (when the fallow CLI returns
`verdict: fail` or is older than `FALLOW_GATE_MIN_VERSION`, default 2.85.0;
fail-open when the CLI is absent).

| Hook                            | Event                                                              | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session_boot.py`               | SessionStart                                                       | Activates the runtime, reports missing companions, surfaces lessons, carries the todo board over, repairs an existing `docs/` tree                                                                                                                                                                                                                                                                                                           |
| `atlas_doctor.py --hook`        | SessionStart                                                       | Warn-only health check: downgrade, forked marketplace, missing hooks or assets, misplaced `.atlas` paths (report only; `--fix` moves them)                                                                                                                                                                                                                                                                                                                                                               |
| `prompt_optimizer.py`           | UserPromptSubmit                                                   | Optional prompt rewrite; arms orchestration for engineering prompts (see [Decision models](#decision-models))                                                                                                                                                                                                                                                                                                                                |
| `event_dispatch.py`             | PreToolUse, PostToolUse                                            | One process per tool event that runs the hooks below in-process                                                                                                                                                                                                                                                                                                                                                                              |
| `recall_gate.py`                | PreToolUse                                                         | With claude-mem enabled, denies tool calls until one real claude-mem recall happens (`ATLAS_MANDATES=off`)                                                                                                                                                                                                                                                                                                                                   |
| `bash_advisor.py`               | PreToolUse (Bash)                                                  | Warns on catastrophic commands; never denies                                                                                                                                                                                                                                                                                                                                                                                                 |
| `git_guard.py`                  | PreToolUse (Bash, Write, Agent, Task, mcp__*)                      | Keeps commits and pushes off protected branches (the default branch, `production`, `release/*`, GitHub-protected) while other branches are in use, caps local branches and linked worktrees, and turns every pull-request creation into a permission prompt. Policy: `.atlas/git-policy.json`, `scripts/atlas_git.py policy` (`ATLAS_GIT_GUARD=off`)                                                                                         |
| `edit_read_nudge.py`            | PreToolUse, PostToolUse                                            | Nudges when an edit targets a file read only through `ctx_read`                                                                                                                                                                                                                                                                                                                                                                              |
| `dispatch_tripwire.py`          | PreToolUse, PostToolUse, SubagentStart                             | Routes native Grep and Glob to lean-ctx where it is configured; counts inline work and denies past the threshold in orchestration runs; names an unnamed `atlas:*` dispatch (denies it instead with `ATLAS_AUTONAME=off`); denies model-overriding `atlas:*` dispatches, dispatches missing the GOAL / DELIVERABLE / SUCCESS CRITERIA / OUT OF SCOPE / STOP CONDITIONS spec or bundling more than one GOAL, and any nested subagent dispatch; denies every in-process working-role dispatch when tmux is on PATH (`dispatch_denied:team`; closing roles exempt) |
| `fallow_gate.py`                | PreToolUse (Bash)                                                  | Runs `fallow audit` on `git commit` and `git push` and denies on `verdict: fail` or a CLI below the minimum version (`ATLAS_FALLOW=off`)                                                                                                                                                                                                                                                                                                     |
| `todo_capture.py`               | PostToolUse                                                        | Mirrors TodoWrite plans to the durable board (`ATLAS_TODO=off`)                                                                                                                                                                                                                                                                                                                                                                              |
| `docs_drift_watch.py`           | PostToolUse                                                        | Warns as soon as code ships without a `docs/CHANGELOG.md` entry (debounced per session)                                                                                                                                                                                                                                                                                                                                                      |
| `delegation_prewarn.py`         | PostToolUse                                                        | Once per session, warns that an inline code edit will trip gate condition (m)                                                                                                                                                                                                                                                                                                                                                                |
| `connector_credential_watch.py` | PostToolUse                                                        | On the first 401 or 403 from an armada connector, says to restart the server instead of retrying (`ATLAS_CONNECTOR_WATCH=off`)                                                                                                                                                                                                                                                                                                               |
| `format_after_edit.py`          | PostToolUse (Edit, Write)                                          | Runs the repo's formatter                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `crew_worker.py`                | PreToolUse, PostToolUse, Stop (crew worker settings, not `hooks.json`) | In crew workers only, delivers IRC context, enforces file leases and the check/report gate; guarded by `ATLAS_CREW_WORKER` elsewhere |
| `completion_gate.py`            | Stop                                                               | Blocks a premature "done" (conditions a to s above)                                                                                                                                                                                                                                                                                                                                                                                          |
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

### In-terminal mod

`mod/register.ts`, wired by the `modules` entry in `hooks/hooks.json`, draws a
band above the prompt, a TODO block and a SUBAGENTS block, and a side panel with
a tab strip and a board; `/atlas-cc` opens the panel. `ATLAS_MOD=off` disables the
whole mod. Gate readings come from
`scripts/atlas_gates.py --session <id> --root <repo> --json`, which shares its
evaluation with the Stop hook. Detail:
[docs/architecture/atlas-mod.md](../../docs/architecture/atlas-mod.md). The
blocks below were rendered by running the mod's own layout code, not typed by hand.

**One clock and one glyph key.** A single 100 ms frame loop (`FRAME_MS = 100`,
`mod/band-motion.ts:51`, armed in `mod/register.ts:1063`) advances one spinner
index: at most 10 redraws a second, the host's cap. The band, the HUD TODO and
SUBAGENTS blocks and the side panel all read that index, so every spinner on
screen shows the same frame. Two glyph sets turn on that index. The band lead, the
band's agents count, the SUBAGENTS title and the side panel's agent rows draw the
ten braille frames `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` (`LEAD_FRAMES`, `mod/atlas-ui.ts:601`; the
callers pass `braille`, for example `mod/hud-surface.ts:282` and
`mod/panel-layout.ts:397`). The TODO rows, the SUBAGENTS agent rows, the board rows
and the band's worker rows keep the four circle quarters (`SPIN_FRAMES`,
`mod/atlas-ui.ts:599`; `SCORER_READS_CIRCLES`, `mod/hud-surface.ts:21`), because
the capture scorer reads a row's state from those marks. `ATLAS_REDUCED_MOTION`
and `NO_COLOR` stop the row transitions; the spinner still steps (see the variables
below).

| Glyph | Meaning | Glyph | Meaning |
| ----- | ------- | ----- | ------- |
| `◐ ◓ ◑ ◒` | running on a row (the circle frames, `SPIN_FRAMES` in `mod/atlas-ui.ts:599`); `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` on the band lead, agents count, SUBAGENTS title and panel agent rows | `■` | failed |
| `◇` | queued | `▲` | blocked (it needs you) |
| `●` | done | `◉` | waiting |
| `△` | a gate warning (hollow; `▲` is reserved for blocked) | `▰▱` | a meter: filled and empty cells |

The state marks are `STATE_GLYPHS` in `mod/atlas-ui.ts:268`; the gate warning
mark is `gateMark` at `mod/atlas-ui.ts:309`. No row is struck through: a done row
is dim and keeps its green `●`.

**The band.** The band leads with one of four states (`runStateOf`,
`mod/mission-layout.ts:230`): working, done, idle or blocked. The brand is a solid
`◖ ◆ ATLAS ◗` pill. A finished run reads `done` with its frozen duration for 30 s
(`IDLE_AFTER_SECS`, `mod/mission-layout.ts:223`), then rests as
`idle · last run <duration>`. A gate warning is a trailing segment and never leads;
on a done or idle band its words are dim and only the `△` is amber
(`warnSeg`, `mod/mission-layout.ts:267`). The run starts at the person's prompt
(`armedAt`, `mod/register.ts:1206`; a background task notification does not arm
it) and ends when the host reports its turn idle, with no grace
(`mod/band-motion.ts:52-54`); the duration is then frozen. Work with no prompt
behind it does not turn an idle band back to done. The band and the side panel read
the Stop verdict on the same frame beat, so both switch to blocked on the same
update (`mod/register.ts:1051`, `mod/blocked-same-update.test.ts`). At 150 columns:

```
◖ ◆ ATLAS ◗  ⠋ working 0:42   todo ▰▰▰▰▰▰▱▱▱▱ 3/5   agents ⠋ 2 running
◖ ◆ ATLAS ◗  ● done · 1:08   todo ▰▰▰▰▰▰▰▰▰▰ 5/5
◖ ◆ ATLAS ◗  ○ idle · last run 1:08   todo ▰▰▰▰▰▰▰▰▰▰ 5/5
◖ ◆ ATLAS ◗  ▲ blocked · needs: close dispatch T2 · ⠋ fixing   todo ▰▰▰▰▰▰▱▱▱▱ 3/5   agents ⠋ 1 running
◖ ◆ ATLAS ◗  ● done · 1:08   todo ▰▰▰▰▰▰▰▰▰▰ 5/5 · △ 2 gates to check
```

The lines are: working, done, idle, blocked, and done with two failing gates. At
110 columns the same states drop the meter and keep `todo N/M` whole:

```
◖ ◆ ATLAS ◗ ⠋ working 0:42 · todo 3/5 · ⠋ 2 running
◖ ◆ ATLAS ◗ ● done · 1:08 · todo 5/5
◖ ◆ ATLAS ◗ ○ idle · last run 1:08 · todo 5/5
◖ ◆ ATLAS ◗ ▲ blocked · needs: close dispatch T2 · ⠋ fixing · todo 3/5 · ⠋ 1 running
◖ ◆ ATLAS ◗ ● done · 1:08 · todo 5/5 · △ 2 gates to check
```

The band is one row by default. `ATLAS_BAND_RICH=1` draws a tall form when the host
gives it rows (`mod/band.tsx:146`), with a phase rail and a todo meter:

```
◖ ◆ ATLAS ◗  ⠋ working 0:42   ● 1 research  ──  ● 2 plan  ──  ▸ 3 build  ──  ◇ 4 verify  ──  ◇ 5 done
todo ▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱ 3/5 · 60%                               agents ⠋ 2 running
```

**TODO and SUBAGENTS.** The band and its worker rows are the first rows of the
above-prompt slot; `mod/hud.ts` draws the TODO and SUBAGENTS blocks under them,
with one blank row between (`mod/register.ts:386`). A host clip therefore eats HUD
rows and never the band. They are the same blocks omp shows natively, so Claude
Code and omp present a run the same way. Each block is a closed rounded box: the
top edge carries the brand, the title, the count and, on TODO, a `▰▱` meter, and
ends in `╮`; a `╰───╯` rule closes it, in every state and slot height where the
block shows (`mod/hud-surface.ts:53-55`). When the slot is short, the fit ladder
drops the blank first, then the column names, then folds plan rows, before any
rule goes. A done row is dim, not struck through. The selected row is a
full-width bar (xterm 236) with a bold name and the `▸ ` cursor kept
(`mod/hud-surface.ts:118-120`). A task whose worker was killed reads
`closed · worker killed` in the error colour and keeps the `●` mark
(`mod/atlas-ui.ts:277-282`). SUBAGENTS is a table with the header
`AGENT STATE MODEL TASK LAST RESULT`, always printed
(`mod/hud-surface.ts:318-359`). MODEL shows from 120 columns (`MODEL_FROM`,
`mod/hud-surface.ts:323`); a narrower row drops RESULT, then MODEL, then TASK before
LAST is cut. LAST is always the elapsed clock, frozen when the agent ends
(`mod/hud-surface.ts:397`); RESULT is the dim last tool or outcome and shows only
when at least 10 cells remain. The two blocks below are the 120-column goldens
(`contracts/hud-golden.ts`, which `mod/hud-surface.test.ts` compares with the
drawn rows; the spinner glyph is the frame at index 0):

```
╭─ ◖ ◆ ATLAS ◗ ▸ TODO  3/7 ▰▰▰▱▱▱▱▱ ───────────────────────────────────────────────────────────────────────────────────╮
  ● Wire band to host         done          ran 03:10
  ● Layout grid tiers         done          ran 02:41
  ● Gate golden tests         done          ran 01:58
▸ ◐ Subagents block           running       elapsed 00:42 of 05:00
  ◇ Gate tests                queued        after Subagents block
  ■ Changelog                 failed        tests red 3
  ▲ Ship board mod            blocked       needs your approval
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ ◖ ◆ ATLAS ◗ ▸ SUBAGENTS ⠋ 1 running · 1 failed · 1 queued · 2 done ─────────────────────────────────────────────────╮
    AGENT                STATE       MODEL   TASK    LAST    RESULT
  ● implementer-layout   done        opus    T1,T2   5:51    9 of 9 steps
  ● implementer-gates    done        sonnet  T3      1:58    golden tests written
▸ ◐ implementer-band     running     opus    T4      0:42    read runs.ts:17
  ◇ runner-land          queued      opus    T5      0:00    waits on implementer-live
  ■ implementer-live     failed      opus    T6      1:35    tests red 3
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

`ATLAS_HUD=off` (exactly that value) hides both blocks. While an agent runs the
SUBAGENTS block is never dropped: the TODO rows shrink first and the HUD keeps at
least 2 rows (`hudBudget`, `mod/hud.ts:339`). `hudWantRows` (`mod/hud.ts:333`) asks the
host slot for the full form; the band gives up rows first but keeps its title row
(`hudSlotCap`, `mod/register.ts:414-424`). The TODO block needs the legacy
`TodoWrite` tool: set `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` (TodoWrite on every model)
and `CLAUDE_CODE_ENABLE_TASKS=0` (without it Claude Code uses TaskCreate and
TaskUpdate and draws its own checklist above the prompt, re-expanding it on every
update, which squeezes the Atlas blocks to about 6 rows). Claude Code's fullscreen renderer gives everything under the
transcript (prompt, status line, mode line, agent list) one slot capped at half the
terminal, and a status line command is told no row budget. So the mod writes
`.atlas/.run/hud-state.json` (`{ts, maxRows, wanted, shown, fullscreen}`, `wanted`
being the rows the HUD would draw unrestricted); while it is fresher than 15 s and
`shown < wanted` the status line prints one row only (folder, timer, model,
`· ctx N%`) and otherwise the full grid. `atlas_statusline.py install` and
`atlas_doctor.py --fix` set `refreshInterval: 5` on the statusLine entry (other keys
are kept) so the switch lands within seconds. `atlas_doctor.py` reports this and the
other display settings as `display-` checks (`display-hud` flags `ATLAS_HUD=off`;
`display-omp-todo` flags `todo.enabled=false` in omp settings), and
`atlas_doctor.py --fix` sets both env flags and the status line, removes
`ATLAS_HUD=off` and sets omp `todo.enabled` true. On omp the lead records the plan
with omp's own `todo` tool; when it never calls it, the extension draws a fallback
TODO tree from the board until the first native todo result.

**The side panel.** The panel has six tabs. The strip shows names only; the keys
stay bound (`r` route, `t` team, `c` channel, `g` gates, `k` core, `o` board,
`PANEL_TABS` and `STRIP_TABS` in `mod/panel-layout.ts:21-28`). The lit tab name is
bold with a rule under it. Route, team, gates and channel at 80 columns:

```
◖ ◆ ATLAS ◗ ▸ SIDEPANEL ───────────────────────────────────────────────────────

route  team  channel  gates  core  board
━━━━━
 phase  research
 gates  ● lint   ● test   △ doctor   2/3 green
 agents ◇ 1 queued  ⠋ 1 running  ● 2 done  ■ 1 failed
    ● implementer-layout done
    ● implementer-gates  done
    ⠋ implementer-band   running
    ◇ runner-land        queued
    ■ implementer-live   failed

 todo   ▰▰▰▰▱▱▱▱▱▱ 3/7
  ● Wire band to host     done                                implementer-layout
  ● Layout grid tiers     done                                implementer-layout
  ● Gate golden tests     done                                 implementer-gates
  ◐ Subagents block       running                               implementer-band
  ◇ Gate tests            queued                                     runner-land
  ■ Changelog             failed                                implementer-live
  ▲ Ship board mod        blocked                                            you

◖ ◆ ATLAS ◗ ▸ SIDEPANEL ───────────── 1 queued · 1 running · 2 done · 1 failed

route  team  channel  gates  core  board
       ━━━━
  ● implementer-layout  done     42s
  ● implementer-gates   done     42s
▸ ⠋ implementer-band    running  42s
  ◇ runner-land         queued
  ■ implementer-live    failed   42s

◖ ◆ ATLAS ◗ ▸ SIDEPANEL ────────────────────────────────────────────────── 2/3

route  team  channel  gates  core  board
                      ━━━━━
  ● lint    passing                                                          1/1
    ● lint
  ● test    passing                                                          1/1
    ● test
  △ doctor  warning                                                          0/1
    △ doctor

◖ ◆ ATLAS ◗ ▸ SIDEPANEL ───────────────────────────────────── #atlas-board-mod

route  team  channel  gates  core  board
             ━━━━━━━
    #atlas-board-mod  5 people · 2 unread
    lead                                                                   10:02
    ▸ implementer-band take T4, then run the gate tests
  ▲ implementer-live    blocked                                            10:05
    tests red 3, need a decision on the changelog
  ● implementer-layout  handoff T1 and T2 merged                           10:07
```

The route tab lists this session's tmux team records and in-process dispatches,
each with its transport (`tmux` or `in-process`); a dispatch without a `SCOPE:`
line shows class `-` and effort `-`; `no team this session` prints only with no
tmux rows and no dispatch rows. The gates tab groups the Stop gate's checks with an
`n/m` count each, and the core tab carries the `verified n/m` figure
(`verifiedFigure`, `mod/panel-layout.ts:697`). The channel tab shows the channel name and its messages.

**The board.** The board tab (key `o`, or the band's board button) lists one row
per plan item with its state, owner and detail, a count in the title row and a
footer that names dispatch rows folded into plan rows (`mod/board-model.ts:149`). Under the rows the board draws a Gantt timeline, one bar per agent at its start offset within the run; a time axis closes it and ends where the longest bar ends (`mod/board-model.ts:456`). A killed worker's row reads `closed` in the error colour on the HUD, the board and the panel (`mod/atlas-ui.ts:277-282`).
At 80 columns the board is:

```
◖ ◆ ATLAS ◗ ▸ BOARD ────────────────────────────────────────────────── 7 items

  ● Wire band to host     done     implementer-layout
  ● Layout grid tiers     done     implementer-layout
  ● Gate golden tests     done     implementer-gates
▸ ◐ Subagents block       running  implementer-band
  ◇ Gate tests            queued   runner-land
  ■ Changelog             failed   implementer-live
  ▲ Ship board mod        blocked  you
```

**Transcript cards and toasts.** A worker's card keeps its state colour on the
rail, glyph and word, and a failed card keeps the error colour as it ages. The
state word sits in a 7-cell column (`CARD_WORD_W`) so names line up. The lead's
header line is not streamed raw: the classic `MessageDisplay` hook rewrites the
`ATLAS | ...` batch to `▌ phase n/m · state` for the screen (the stored message
and the Stop gate keep the contract form), and the transcript draws it as a
fill-free bar, the phase word in bold and the state dim (`mod/restyle.tsx:405`,
`mod/transcript/leadheader.ts:1-9`). A turn footer is frozen at its first draw
and prints the band clock (`mod/restyle.tsx:343-353`). The card box and the
one-line toasts (`contracts/panel-golden.ts`):

```
┌─ ◆ running implementer-band ────── opus ─┐
│ last  read runs.ts:17                    │
│ steps ▰▰▰▰▱▱▱▱ 4 of 9 · 44%              │
│                                          │
│ ctx   ▰▰▰▰▰▱▱▱ 62%                       │
└──────────────────────────────────────────┘
▌ ● done     implementer-layout  9 of 9 steps
▌ ■ failed   implementer-live  tests red 3
```

**Palette and brand mark.** The mod draws with accent 141, ok 114, warn 179,
error 203 and the neutrals 236, 240, 245 and 252. `mod/palette.test.ts` fails on
any other literal colour in a non-test file under `mod/` or `omp/`, apart from the
Mocha and Latte token sets, white, the contract persona colours and the sprites.
The `◆ ATLAS` mark appears once per surface: on the band chip, the block ribbons,
the panel title and the finish cards (`brandMark`, `mod/atlas-ui.ts:396`; the
toast head takes it only when asked, `mod/panel-layout.ts:1112`), in grey 240
except on the chip.

**Host load rules.** The mod loads in the host only if its files keep the host's
rules, among them that the hook context `$` is never assigned, stored, returned or
spread (rule 3) and that mod code imports no `.json` file and calls no dynamic
`import()` (rule 4). `mod/host-load-rules.test.ts` checks them, and
`test_mod_never_stores_the_host_context` in `hooks/test_atlas_contract.py:1858`
pins the same invariant in the contract suite.

### Terminal variables

These are read by the mod (`mod/atlas-ui.ts`, `mod/motion.ts`, `mod/look.ts`,
`mod/register.ts`) and by the omp extension (`omp/`). Unset means the default.

| Variable | Default | Effect |
| -------- | ------- | ------ |
| `ATLAS_MOD` | on | `off` makes every mod handler a pass-through (`mod/register.ts:1086`) |
| `ATLAS_HUD` | on | `off` hides the TODO and SUBAGENTS blocks (`mod/register.ts:1303`) |
| `ATLAS_BAND_RICH` | off | `1` draws the tall band when the rows allow (`mod/band.tsx:146`, `mod/look.ts:34`) |
| `ATLAS_THEME` | auto | `latte` or `light`, `mocha` or `dark`; otherwise `COLORFGBG` (background 7 or 15 is light), else mocha (`themeName`, `mod/atlas-ui.ts:60`) |
| `ATLAS_ASCII` | off | Set and not `0` or `false` forces ASCII marks; unset, ASCII is used when `LC_ALL`, `LC_CTYPE` or `LANG` is set and is not UTF-8 (`asciiMode`, `mod/atlas-ui.ts:69`) |
| `NO_COLOR` | unset | Any non-empty value turns colour off and also stops row transitions (`colorMode`, `mod/atlas-ui.ts:77`; `reducedMotion`, `mod/motion.ts:38`) |
| `COLORTERM` | unset | `truecolor` or `24bit` selects 24-bit colour; with `TERM` containing `256` and `COLORTERM` unset the mod uses the 256-colour palette; otherwise truecolor (`mod/atlas-ui.ts:77-82`) |
| `ATLAS_REDUCED_MOTION` | off | `1`, `true`, `yes` or `on` draws the resting render only: no state-change fade and no reveal of a new row; the spinner still steps (`mod/motion.ts:8`, `:38`) |
| `ATLAS_PROJECT_ROOT` | unset | A project root that contains `.atlas`; it wins over the search. Unset, the mod walks up from the working directory to the nearest `.git` or `.atlas` (`mod/data/root.ts:43`) |
| `ATLAS_HOME`, `ATLAS_DB` | `~/.atlas`, `<home>/atlas.db` | Where the mod looks for the gate database (`mod/register.ts:607`) |
| `ATLAS_STATUSLINE` | on | omp only: `off` skips the usage statusline (`omp/index.ts:767`) |
| `ATLAS_ADVISOR_GATE` | on | omp only: `off` disables the advisor gate (`omp/advisor.ts:121`) |

The omp advisor gate (`omp/advisor.ts`) turns every advisor note, of any severity,
into a board item for the session, appends a reminder to the system prompt while
items are open, and refuses to stop while any is open, at most 3 times per prompt
(`MAX_STOP_BLOCKS`, `omp/advisor.ts:29`). With no `docs/` ancestor, no session id or
`ATLAS_ADVISOR_GATE=off` it does nothing.

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
config picks the model. Atlas also installs as a Codex plugin (Codex CLI 0.166):

```bash
codex plugin marketplace add w159/tech-tools
codex plugin add atlas@tech-tools
```

then trust the hooks with `/hooks`. Skills (`.codex-plugin/plugin.json` points at
the same `skills/`) and hooks (`hooks/hooks.codex.json`, generated from `hooks.json`
by `scripts/gen_codex_hooks.py` at the repository root, not under `plugins/atlas/scripts`) are shared with Claude Code. Differences:

- Codex rejects a PreToolUse `ask`, so a guard that would ask the human denies
  instead, with the same reason plus "re-run after confirming with the user"
  (`scripts/atlas_harness.py`). Claude Code behaviour is unchanged.
- Agents: a Codex plugin cannot ship agents, but Codex loads custom agents from
  `.codex/agents/*.toml`. Install the 11 atlas agents for a project with
  `python3 plugins/atlas/scripts/atlas_codex_agents.py [DIR]` (default
  `./.codex/agents`; add `--plugin-root /abs/path/to/plugins/atlas` so scripts
  named in the agents resolve). They appear as `atlas-<name>` and `spawn_agent`
  with that `agent_type` is gated like `atlas:<name>`.
- Tool names: Codex edits files with `apply_patch`, spawns agents with `spawn_agent`
  and has no Read, Grep or Glob tool. `scripts/atlas_harness.py` rewrites
  `apply_patch` / `spawn_agent` / `update_plan` payloads to the Claude shape before
  any hook logic runs, so the edit, tripwire and worker gates fire. Reads that go
  through the shell are not seen by the read-before-edit nudge.
- SessionEnd: Codex clamps it to 3 s, so the transcript ingest hands its work to a
  detached process and returns at once (also under Claude Code).
- Other plugins: `programmer` installs in Codex (skills only); `armada` does not.

`hooks/test_codex_parity.py` holds the contract tests.

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

## Telemetry

On by default: anonymous whole-number counters (which skills, hooks and gates fire, how long the hook pass takes, how
team runs end), summed per ISO week and sent once the week has ended (when an endpoint is configured). No install id, no prompts, code, paths or names
of yours. A counter is published only once at least 3 installs reported it. A one-time notice is shown the first time
(Claude Code and Codex: the SessionStart message; omp: a toast). Full detail, every counter and its purpose, and the
hosting caveat: [references/telemetry.md](references/telemetry.md).

Turn it off (any one): `DO_NOT_TRACK=1`, `ATLAS_ANALYTICS=off` (environment or `~/.atlas/settings.json` `env`), the
"Anonymous usage counters" switch in the Command Center, or `python3 scripts/atlas_analytics.py disable`.

```bash
python3 scripts/atlas_analytics.py explain    # what and why, in plain language
python3 scripts/atlas_analytics.py preview    # the exact payload that would be sent
python3 scripts/atlas_analytics.py prove      # check that payload against the anonymity rules
python3 scripts/atlas_analytics.py status     # state, files, event count, week range
python3 scripts/atlas_analytics.py export --out atlas-counts.json   # share by hand instead
python3 scripts/atlas_analytics.py delete     # remove ~/.atlas/analytics entirely
```

Installs send to `https://atlas-telemetry.vercel.app/api/ingest`; turn telemetry off with any option above and nothing
is sent. Reports land in `telemetry/REPORT.md` and `telemetry/reports/` of the tech-tools repository. The hosting platform may
keep request logs the code never reads.

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
| `ATLAS_GATE_HEADER`, `ATLAS_GATE_PHASES`, `ATLAS_GATE_COLONY`  | on                       | Turn off gate conditions n, o, p individually (p also skips s) |
| `ATLAS_WT_GATE`                                                | on                       | `off` disables condition (q)                                  |
| `ATLAS_TEAM_GATE`                                              | on                       | `off` turns `dispatch_denied:team` and gate (s) into advisories |
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
| `ATLAS_ANALYTICS`                                              | on                       | Anonymous usage counters (`off` or `DO_NOT_TRACK=1` stops them) |
| `ATLAS_FALLOW`, `ATLAS_CONNECTOR_WATCH`                        | on                       | Commit gate, connector credential advice                      |
| `ATLAS_TYPESAFE_SCORING`                                       | on (inert without a key) | Turn scoring                                                  |

Companions, recommended by `atlas-setup` and used when present: claude-mem
(cross-session memory), context-mode (keeps large output out of the context
window), lean-ctx (code navigation, shaped search and read), ponytail
(optional), and Fallow for JS and TS trees. Atlas uses only the
tools present in the session.

## Troubleshooting

| Symptom                                                                                 | Cause and fix                                                                                                                                                               |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Doctor warns `cannot read plugin config: installed_plugins.json`                        | Atlas 15.x and earlier on a claude.ai synced or `--plugin-dir` load. 16.0.0 recognizes both loads. Update the plugin.                                                       |
| Stop blocks with `conditions: a,b (no evidence artifact, no verified finding)`          | Code shipped without an evidence artifact or a verified finding. Dispatch `atlas:verifier` and record the verdict with `scripts/atlas_finding.py`. The letters are the stable part; the parenthesised names are the reason for each. |
| An `atlas:*` dispatch is denied                                                         | The prompt is missing the TOOLS block or a spec block, has no `name` with `ATLAS_AUTONAME=off`, overrides the pinned model, or has two GOALs. The deny message names which. |
| `spawn-team` reports `worktree: fatal: invalid reference: HEAD`                         | The repo has no commit yet. Make the first commit, then spawn again.                                                                                                        |
| Connector tools return 401 after a key rotation                                         | The server cached old credentials. Restart the session.                                                                                                                     |
| `claude plugin update atlas@tech-tools` says "already at the latest version" but a newer atlas is published | The local marketplace clone is stale; the update command does not refresh it. Run `claude plugin marketplace update tech-tools`, then `claude plugin update atlas@tech-tools`, then restart. The doctor's `clone-fresh` check detects this, and a session start shows a one-line notice (checked in the background at most once per 24 h; `ATLAS_UPDATE_CHECK=off` disables it). To refresh automatically, turn on `/plugin` > Marketplaces > tech-tools > Enable auto-update. |

Run `python3 "$ATLAS/scripts/atlas_doctor.py" --fix` first for any
wiring problem.

## Layout

```
atlas/
|-- .claude-plugin/plugin.json   manifest, version 17.14.0
|-- agents/                      11 agents (atlas:<role>)
|-- skills/                      40 skills, one directory each
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
