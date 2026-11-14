# Atlas

Atlas is a Claude Code plugin that runs coding work under a written operating
contract. One model does the work, a separate model in a fresh context tries to
refute it, and a Stop hook refuses a "done" claim until evidence and an
independent verdict exist. Parallel work runs as tmux workers outside your
session, so your context window holds reports instead of raw output.

|            |                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| Version    | 17.21.0 (`.claude-plugin/plugin.json`)                                                                              |
| License    | Apache-2.0                                                                                                           |
| Ships      | 40 skills, 11 agents, 19 hook programs / 24 bindings, 11 JSON contracts                                              |
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
   Atlas ready (run /atlas:atlas-setup to complete setup)
   ```

3. Run `/atlas:atlas-setup` once per project. It is invoked by name, not
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

   Output: `dry-run team <id> build/medium: 3 members, max_parallel 3, isolation
   shared, scope src/a.py`, then two `implementer` lines and one `verifier` line.
   Every member works in the one tree, with no worktree or branch. Add `--json` to
   see each member's `tools_profile` (`edit` for implementers, `exec` for the
   verifier).

To update to a new release, refresh the catalog first and then update the
plugin, and restart the session so the hooks resolve again:

```bash
claude plugin marketplace update tech-tools && claude plugin update atlas@tech-tools
```

On omp: `omp plugin marketplace update tech-tools && omp plugin upgrade atlas`.

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
                                (edit tools, leased   (no write tools, fresh
                                 files, one tree)      context, refutes)
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

The gate checks the work itself before it asks for paperwork. When (a), (b),
(g), (k), (m) or (o) would block, it re-runs the session's last plain test
command (`pytest`, `npm test`, `go test`, `cargo test`, `make test` and the like,
no shell operators, from the transcript of this run; `hooks/gate_rerun.py`). A
green re-run writes its own evidence file and a verified finding and clears
those six letters; a red one blocks with the command, exit code and output tail.
A crew whose `summary.json` is green for this session counts the same way. Any
code edit after the re-run voids it; a docs edit does not. The docs letters
still apply. `ATLAS_GATE_RERUN=off` restores the old behavior;
`ATLAS_GATE_RERUN_TIMEOUT` caps the re-run (default 90 s).

What the re-run trusts (17.17.0):

- It re-runs only a command whose transcript result shows it executed (a
  non-error result, or one Claude Code marks `Exit code N`), never one a hook or
  you denied, or one that never ran. A project venv runner
  (`.venv/bin/python -m pytest`) counts only when its realpath is inside the
  project, or it is a symlink onto python3 or pytest under a standard prefix, and
  only when the session ran that exact command.
- A timeout (124), a missing pytest (127) and pytest usage or nothing collected
  (4, 5) are inconclusive, not a test failure: they are recorded once and not
  retried, and the gate takes the paperwork path. The cap is 100 s inside the
  150 s hook.
- A crew counts green or red only if this session ran the plugin's own
  `atlas_crew.py run` (checked by realpath) and that call printed that run id,
  and the run's summary seal verifies (17.18.0). A `wait` alone, a `python -c` or a
  copied script earns nothing. A killed run is not an engine-verified red. A
  hand-written or edited `summary.json` proves nothing. The seal does not stop
  code running as the same user from forging: it catches edited or copied
  summaries, and the launch check catches forged run dirs.
  `atlas_gates.py` and the omp panel have no transcript to check and show the
  proof marked `launch_checked: false`.
- A session that ends blocked, with a `blocked` header and an engine-verified red
  re-run or crew, is not asked for the (a), (b), (g), (k), (m) and (o) paperwork.
  A self-made red (pytest exit 4 or 5, a forged summary) does not count.
- The circuit breaker counts the main Stop only, not SubagentStop, so workers
  finishing cannot trip it, and it re-arms after a quiet window. Bypass rows are
  kept as their own type and are not counted as hook crashes by the doctor or the
  dashboard.

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
  A file moves to a peer live: `irc give <path> <peer>` hands it over and
  announces `LEASE <path> -> <peer>` on the channel, `irc claim <path>` takes an
  unowned one, and fix rounds follow the moved lease.
- A worker cannot stop until its own check passes: the Stop hook re-runs the
  check instead of taking the worker's word. After all workers exit, the
  global check runs and only the owners of failing tests are resumed.
- The summary's `ok` means the global check is green, no worker failed and the
  run was not killed. It also lists `failed_workers`, `late_exits`,
  `pending_exits` and `killed`. A worker whose files changed after its DONE has
  its unit check re-run and fails the crew if it is red.
- `run --wait` and `wait` print a short verdict line for the lead: `ok`, the
  check, `check_exit`, `check_tail`, `wall_s`, the worker names, the files they
  own, the token total and the path of the full `summary.json`. The failure
  fields above appear only when set. Per-worker rows, rounds and IRC counters
  stay in `summary.json`.
- Dead workers are noticed: each launch writes a pid file, and a dead pid is
  recorded within 0.5 s as exit 137 `died` (no pid after 60 s is `died` too). A
  failed `tmux new-window` is exit 126 `launch_error`. The supervisor no longer
  waits out `--wait` for a worker that is gone.
- `atlas_crew.py kill --run <id>` stops everything: the supervisor, every worker
  process group, the wrappers and the IRC gateway, and it writes a killed summary
  (`killed: true`). On a finished run it leaves the real summary alone and says
  `already_finished`. Each worker's claude starts in its own process group and is made the pane's
  foreground group, so Ctrl-C in a tmux pane reaches claude again (17.17.0 had
  moved workers to their own session, which cut it off). A SIGTERM or SIGHUP
  handler installed before the launch stops the group, so a kill between launch
  and the pid-file write no longer leaves claude running.
- `wait` refuses a run directory the engine never started (no `supervisor.pid`).
  On a green check the summary is published at once: workers that posted DONE are
  stopped (SIGTERM, SIGKILL after 3 s) and late exits are recorded for up to 30 s.
- Crew summaries are HMAC-sealed (`scripts/atlas_crew_seal.py`, 17.18.0): a
  per-run key in `$ATLAS_HOME/crew-seals` (mode 0600; the seal home is stored in
  `run.json`, so a different `ATLAS_HOME` still verifies; records are pruned when
  the run dir is gone or after 14 days). `wait` and `run --wait` refuse an
  unsealed or edited summary, and `run --wait` returns at once with
  `no seal record under <home>` instead of spinning its budget. A run id cannot be
  reused. A worker the supervisor stops after its verified DONE is marked
  `stopped_after_done` and is not a late exit; its turns and tokens are counted
  from the stream when no result event exists.
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

Routed from a plain prompt (17.17.0): the lead is told to start the crew and does it in one Bash call.
Same model and flags, one task with 8 modules and 434 tests, two runs per cell with the 17.16.0 and 17.17.0
arms alternated in one session; cold is process start to exit, warm is a lead already running. Method and
every run: [2026-11-14_atlas-17.17.0-silent-failures.md](../../docs/audits/2026-11-14_atlas-17.17.0-silent-failures.md).

| Run                                | Atlas 17.16.0                    | Atlas 17.17.0                     |
| ---------------------------------- | -------------------------------- | --------------------------------- |
| fixture-p cold                     | 29.2, 30.9 s / about 158k tokens | 27.2, 27.7 s / about 158k tokens  |
| fixture-8b cold                    | 31.3, 34.0 s                     | 29.9, 28.3 s                      |
| fixture-p warm                     | 27.8, 28.6 s                     | 26.3, 25.4 s                      |
| fixture-red cold (one test fails)  | 86.3 s, 5 lead turns, 725k tokens | 71.6 s, 3 lead turns, 614k tokens |

On the green fixtures 17.17.0 is 1 to 3 s faster, within the run-to-run spread: read it as no regression, not
a speedup. On the red fixture the blocked-report fix saves two lead turns (17% of wall time, 15% of tokens).
Against one plain prompt on fixture-p (51.7 and 55.7 s, 307,662 and 364,959 tokens), 17.17.0 cold is 51% of
the wall time and 47% of the tokens; warm it is 48% of the wall time. 1/4 of the single prompt's wall time is
still not met. The 17.16.0 numbers (cold 62% of the wall time and 53% of the tokens against one prompt) are in
[2026-11-14_atlas-17.16.0-team-performance.md](../../docs/audits/2026-11-14_atlas-17.16.0-team-performance.md).

Atlas 17.18.0 (same model, effort and harness; n=2 per cell at 8 modules, n=3 at 16 modules). 8 modules: cold
25.9, 27.9 s (mean 26.9 s, 48% of plain), warm 27.1, 25.3 s (mean 26.2 s, 47%), 151k tokens (43%), all 434
passed. 16 modules (842 tests): cold 25.4, 27.3, 27.1 s (mean 26.6 s, 29% of plain), warm 26.3, 25.8, 25.6 s
(mean 25.9 s, 28%), 202-217k tokens (mean about 213k, 49%), all 842 passed. Plain one prompt: 55.9 s mean and
353k tokens at 8 modules (n=4), 92.4 s mean and 438k tokens at 16 modules (n=4). 50% of the tokens is met at
both sizes. 1/4 of the wall time is not met: the floor is the slowest worker's own model time (about 14 s) plus
about 11 s of lead time. Crew time stayed flat from 8 to 16 modules while plain time grew; that is a trend from
two sizes, not a measured 1/4. Method and trials that did not help:
[2026-11-14_atlas-17.18.0-crew-time.md](../../docs/audits/2026-11-14_atlas-17.18.0-crew-time.md).

Atlas 17.21.0 (n=3 per cell, same model and harness, 4 CPUs, all runs green). 8 modules (434 tests): cold mean 28.1 s (53% of plain), warm mean 25.1 s (49%), tokens 57% cold and 46% warm. 16 modules (869 tests): cold mean 34.8 s (31%), warm mean 31.1 s (26%), tokens 38% cold and 36% warm. An interleaved A/B against the 17.20.0 tree showed no speed change from this release. Tables:
[2026-11-14_atlas-round2-expert-audit.md](../../docs/audits/2026-11-14_atlas-round2-expert-audit.md).

A cold crew costs more dollars than one prompt (about $0.26 against $0.19 on 17.16.0): each worker pays its own
cache creation.

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
- Every team works in the one tree (`isolation: shared` in every scope-matrix
  cell): no worktree or branch per member, so nothing waits on a merge. Writers
  that build together belong in a crew (below), where file leases keep them
  apart and `irc give` hands a file to a peer live.
- Claude workers get `--allowedTools` scoped by their `tools_profile` (`read`,
  `edit`, `exec`), so an exec worker can run test runners and read-only git
  without a permission prompt.
- Workers share one durable todo board at `<project>/.atlas/.run/todos.json`
  (file lock plus temp-file rename) and an append-only notes file per worker at
  `.atlas/.run/board/<name>.jsonl`. `scripts/atlas_todo.py` has the `note`,
  `notes`, `inbox`, `claim` and channel commands. An unknown flag (for example
  `--title` on `note`) exits 2 instead of becoming part of the note text; `--`
  ends the options.

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
   The class and effort in the arming nudge come from the same model:
   `route_scope` in `hooks/prompt_optimizer_core.py` asks `task_class` (a
   choice over the scope-matrix classes) and `effort` (low, medium, high) in
   the same request as the arming question, so a prompt costs one round trip.
   It uses an answer only when its confidence is at least 0.8 and the value is
   valid; otherwise the `classify_scope` keyword heuristic answers, which
   ignores a class word after a negation ("do not audit, just implement x" is
   implement). Counters `decision.route.model` and `decision.route.fallback`.
   Verify check: the completion gate (`hooks/completion_gate_core.py`, letter
   `v`) sends the final reply to the same endpoint as two noul questions (the
   reply claims the work is done or fixed; the reply quotes an observed result
   such as command output, a test count, a file:line or query rows). By default
   it runs in shadow: it asks the model and records `decision.verify.block-would`
   when the claim is at least 0.8 and the observed result at most 0.3, but never
   blocks, because those thresholds are uncalibrated. With
   `ATLAS_DECISION_VERIFY=block` it blocks on that verdict, at most once per turn (the continuation Stop passes), and only after the
   deterministic checks pass. The call has a 1.5 second budget; an endpoint
   that is off, slow, refused or answers badly never blocks.
   `ATLAS_DECISION_VERIFY=off` turns the check off. Counters
   `decision.verify.block`, `.block-would`, `.pass` and `.skip`.
2. Which team, at what cost. `scripts/atlas_resolve.py <class> <effort>` reads
   `contracts/scope-matrix.json` and returns the roles, counts, model tier,
   effort and isolation for the task. It is deterministic: the same input gives
   the same team. Example:

   ```
   $ python3 scripts/atlas_resolve.py build medium --paths src/a.py
   {"effort": "medium", "file_scope": ["src/a.py"], "isolation": "shared",
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

19 hook programs / 24 bindings. `hooks/hooks.json` holds 15 commands on 9 events
(SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, SubagentStart,
SubagentStop, SessionEnd, PreCompact); two of them are `event_dispatch.py`, which
runs the other hooks in-process, and the count of bindings is the 13 other commands
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
| `recall_gate.py`                | PreToolUse                                                         | With claude-mem enabled, denies tool calls until one real claude-mem recall happens (`ATLAS_MANDATES=off`). A configured memory server that comes from the plugin, or whose recall tool is missing, is denied once and then released; a mounted server is denied on every call until recall happens                                                                                                                                                                                                                                                                                                                                   |
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
| `worker_report_gate.py`         | SubagentStop, PostToolUse (SubagentHandback)                       | Blocks an `atlas:*` subagent whose final message is not the fixed report (once per agent)                                                                                                                                                                                                                                                                                                                                                    |

`chronicle_facet.py` writes one facets row per session, `memory_capture.py`
saves lessons to `<project>/.atlas/memory/MEMORY.md` (`ATLAS_MEMORY_CAPTURE=off`), and `nudge.py` prompts a lesson capture when
none was written. For installs outside the plugin system,
`scripts/install_hooks.py` wires the hooks into settings. It skips hooks the plugin
already wires, so they do not run twice; `--list` marks those `[w]`.

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

`mod/register.ts`, wired by the `modules` entry in `hooks/hooks.json`, draws four
things in Claude Code: a band above the prompt, the TODO and SUBAGENTS HUD under
it, a side panel with a tab strip, and cards in the transcript. `/atlas-cc` opens
and focuses the panel. `ATLAS_MOD=off` disables the whole mod. Gate readings come
from `scripts/atlas_gates.py --session <id> --root <repo> --json`, which shares
its evaluation with the Stop hook. Detail:
[docs/architecture/atlas-mod.md](../../docs/architecture/atlas-mod.md). The
blocks below were rendered by running the mod's own layout code at the widths
named, not typed by hand; a spinner shows its first frame. In a colour terminal
each segment, row and rule also carries a fill or a colour that plain text cannot
show.

**One clock and one glyph key.** A single 100 ms frame loop (`FRAME_MS` in
`mod/band-motion.ts`, armed in `mod/register.ts`) advances one spinner index: at
most 10 redraws a second, the host's cap. The band, the HUD and the side panel
all read that index (`sharedSpinFrame`, `withSpinFrame`), so every spinner on
screen shows the same frame. One glyph set turns on it: the band, the TODO and
SUBAGENTS rows and titles, the side panel, the board and the dispatch cards all
draw the four circle quarters `◐◓◑◒` (`SPIN_FRAMES` in `mod/atlas-ui.ts`); ASCII
mode draws `|/-\`. The capture scorer reads a row's state from these marks.
`ATLAS_REDUCED_MOTION` and `NO_COLOR` stop the row transitions; the spinner still
steps.

| Glyph | Meaning | Glyph | Meaning |
| ----- | ------- | ----- | ------- |
| `◐ ◓ ◑ ◒` | running, on every surface (`\| / - \` in ASCII mode) | `■` | failed (killed workers read the same) |
| `▲` | blocked, it needs you | `◇` | queued |
| `◉` | waiting | `●` | done |
| `○` | idle | `△` | a gate warning |
| `▰▱` | a meter, filled and empty cells | | |

The row marks are `STATE_GLYPHS` in `mod/atlas-ui.ts`. No row is struck through:
a done row is dim and keeps its green `●`.

**The band.** The band is one row above the prompt, drawn as three filled
segments after the `◖ ◆ ATLAS ◗` pill, with a half block `▌` at each seam:

```
STATE (glyph, word, clock)  |  PLAN (todo n/m)  |  WORKERS (counts)
```

The STATE segment reads one of four words (`runStateOf` in
`mod/mission-layout.ts`) and is filled to match: `working` with a turning spinner
(fill 141), `done` (114, bold dark ink), `blocked` (203), or `idle` (240, with 252
text). The pill is a fixed 97. The PLAN segment is `todo n/m` with a `▰▱` meter
when the row is 120 columns or wider, and a `■1` beside it when a worker failed.
The WORKERS segment prints the same counts as the SUBAGENTS title: running first,
then waiting, done and failed (`◐ 2 running · ● 1 done · ■1`), or `no agents`
when there are none. A gate that fails while Stop has not refused shows as a
`△ gates 2/3` chip at the end of that segment.

Rules the band follows:

- **Working** is shown whenever the host reports its turn is on, a worker runs or a
  plan row is running, until the host reports the turn over. The run clock starts at your prompt, never steps
  back, and ends when the host reports the turn idle (`stepRun`,
  `mod/band-motion.ts`). A closed run has one total, set when it closed and
  never raised after (`closedTotal`): the band, the run card, the side panel's
  phase row, the board footer and axis all print that same figure. A host turn with no live run, such as a slash command
  typed after a run finished, reads `◐ working` with no clock and opens no run
  (`hostOnly` in `mod/band.tsx`).
- **Done** shows the run total, frozen (`● done 1:08` stays 1:08 and does not count on), for 30 seconds
  (`IDLE_AFTER_SECS`), then the segment turns idle (`○ idle · 1:08`).
- **Blocked** reads `▲ blocked · stop refused 0:37` when the Stop hook refused (or
  a dispatch row Stop will refuse on is still open), and `▲ blocked · 1 failed
  0:37` when workers failed. Those are the only two reasons. A run that ends with a
  failed worker (its dispatch row not closed) or a refused stop reads blocked from
  the end of the run until a new run starts, never `idle` (`failedOpen` in
  `runStateOf`, `mod/mission-layout.ts`). The band and the side
  panel read the Stop verdict on the same beat, so both switch on the same update.
- **Width.** Below the full form the meter goes first, then `todo`, then the
  counts shrink to bare figures, then the state word goes and the clock stays.
  The host draws its own `[-]` handle at the right end of the row; the band does
  not draw one.

At 150 columns (`mod/mission-layout.ts` `standardForms`, via `bandLines`):

```
◖ ◆ ATLAS ◗ ◐ working 0:42 ▌ todo ▰▰▰▰▱▱▱▱▱▱ 3/7 ■1 ▌ ◐ 2 running · ● 1 done · ■1
◖ ◆ ATLAS ◗ ● done 1:08 ▌ todo ▰▰▰▰▰▰▰▰▰▰ 7/7 ▌ no agents · △ gates 2/3
◖ ◆ ATLAS ◗ ○ idle · 1:08 ▌ todo ▰▰▰▰▰▰▰▰▰▰ 7/7 ▌ no agents
◖ ◆ ATLAS ◗ ▲ blocked · stop refused 0:37 ▌ todo ▰▰▰▰▰▰▰▱▱▱ 5/7 ▌ no agents
◖ ◆ ATLAS ◗ ◐ working ▌ todo ▰▰▰▰▰▰▰▰▰▰ 7/7 ▌ no agents
```

The lines are working, done with a failing gate, idle, blocked by a Stop refusal,
and a host turn with no live run. At 110 columns the meter is gone, at 60 the
counts are bare figures, and at 40 the state word and `todo` go:

```
◖ ◆ ATLAS ◗ ◐ working 0:42 ▌ todo 3/7 ■1 ▌ ◐ 2 running · ● 1 done · ■1
◖ ◆ ATLAS ◗ ◐ working 0:42 ▌ todo 3/7 ■1 ▌ ◐2 ●1 ■1
◖ ◆ ATLAS ◗ ◐ 0:42 ▌ 3/7 ■1 ▌ ◐2 ●1 ■1
```

With no colour (`NO_COLOR`) or in ASCII mode there are no fills, and the band
reads as one dot-joined row. `ATLAS_BAND_RICH=1` draws a tall three-row form when
the slot has at least three rows, with a phase rail and a todo meter
(`richBand`):

```
◖ ◆ ATLAS ◗  ◐ working 0:42   ● 1 plan  ──  ▸ 2 research  ──  ◇ 3 build  ──  ◇ 4 verify

todo ▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱ 3/7 · 43%         ctx ▰▰▰▰▰▰▱▱▱▱ 62%    agents ◐ 2 running   ◇ 1 queued
```

At rest, at 80 columns or wider and with room in the slot, rows under the bar show the last run, the
contract verdicts, the gate checks and the key row (`r: status  t: team
c: channel  g: gates  k: core  o: board`, then `ctrl+x tab` when it fits). Their
text, from `contracts/band-golden.ts`:

```
 last run  1 worker · 0:42 · 1 failed
 verdicts  1 claim · 1 verified · 1 refuted · 0 open · 0 unchecked
 checks  ● lint  ● test  △ doctor  2/3 green
```

**TODO and SUBAGENTS.** `mod/hud.ts` and `mod/hud-surface.ts` draw the HUD under
the band as closed rounded boxes with one blank row between them. The slot above
the prompt is exactly the rows drawn: the band row, then the HUD rows, with no
spacer rows above or below (`composeFixed` in `mod/slot.ts`). The HUD takes every
row of the slot's budget the band leaves and folds when the plan is longer, so a
host clip eats HUD rows and never the band. 17.15.0 padded the slot to the whole
budget with blank rows under the HUD; that left an empty gap between the mod and
the prompt and is removed.
`ATLAS_HUD=off` (exactly that value) hides both blocks.

*TODO.* The title carries the done count and a `▰▱` meter (`3/7 ▰▰▰▱▱▱▱▱`, with
`· ■1` after the count when a row failed). Every row has the same fixed columns:
glyph, title (it fills, at most 40 cells), state word (8), owner (16, 12 at 110
columns) and a right-aligned time (5). A queued row shows `-` in the owner and
time cells. An item owned by the lead, or by no worker, reads `running` while the
lead's turn is on and the plan has started, and `waiting` if the turn stopped; it
is never `queued` once work on it began. When the slot has fewer rows than the
plan, the rows that do not fit are counted on one dim summary row inside the box,
by state, each with its own glyph (`● 2 done  ◇ 1 queued`). Finished rows go
first, then queued rows; failed rows hide last, so a failure is never folded into
the done count. There is no `+N more` on the TODO title or anywhere else in the
HUD.

*SUBAGENTS.* A table with the columns `AGENT`, `STATE`, `TIME`, `CALLS`, `FN`
and `LAST`, one row per agent in dispatch order (the order never changes while the
block lives):

- `STATE` is a spinner and `running`, `● done` or `■ failed`.
- `TIME` is measured from the worker's start on the band's clock, so a running
  worker's TIME and the band's run clock move together. It freezes when the
  worker ends.
- `CALLS` is the worker's tool-call count and `FN` the function count its report
  states; an unknown count reads `-`.
- `LAST` is the worker's last tool action as verb and file name (`edit gamma.py`),
  `finished` for a done row with nothing else to say, and `stopped` for a failed
  one. It is never the dispatch title.

The title carries the same tally as the band (`◐ 1 running · 1 failed · 2 done`).
Below 80 cells the numeric columns shrink to their header widths so `LAST` keeps
at least 14 cells. From the first running worker, the table always shows its title
and one row per running worker; finished workers fold first and the column header
goes before any running row does. When the slot is short, the SUBAGENTS box folds
to its title and rides the TODO box's closing rule before any running row is
hidden.

The same plan, rendered at 150 columns with an explorer and a runner done, an
implementer running and a runner failed:

```
╭─ ◖ ◆ ATLAS ◗ ▸ TODO  2/5 ▰▰▰▱▱▱▱▱ ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
  ● T1 read alpha.py                         done     alpha-explorer    0:22
  ● T2 read beta.py                          done     beta-explorer     0:22
▸ ◐ T3 edit gamma.py                         running  gamma-implement…  0:42
  ◇ T4 combine the reports                   queued   -                    -
  ◇ T5 run the gates                         queued   -                    -
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ ◖ ◆ ATLAS ◗ ▸ SUBAGENTS ◐ 1 running · 1 failed · 2 done ──────────────────────────────────────────────────────────────────────────────────────────╮
  AGENT             STATE       TIME  CALLS   FN  LAST
  alpha-explorer    ● done      0:22      -    -  finished
  beta-explorer     ● done      0:22      -    -  finished
  gamma-implement…  ◐ running   0:42      -    -  edit gamma.py
  delta-runner      ■ failed    0:22      -    -  stopped
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

At 110 columns with a 12-row slot the plan folds to its open rows and the
summary row, and the table keeps every agent:

```
╭─ ◖ ◆ ATLAS ◗ ▸ TODO  2/5 ▰▰▰▱▱▱▱▱ ─────────────────────────────────────────────────────────────────────────╮
▸ ◐ T3 edit gamma.py                         running  gamma-implement…  0:42
  ◇ T4 combine the reports                   queued   -                    -
  ● 2 done  ◇ 1 queued
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ ◖ ◆ ATLAS ◗ ▸ SUBAGENTS ◐ 1 running · 1 failed · 2 done ──────────────────────────────────────────────────╮
  AGENT             STATE       TIME  CALLS   FN  LAST
  alpha-explorer    ● done      0:22      -    -  finished
  beta-explorer     ● done      0:22      -    -  finished
  gamma-implement…  ◐ running   0:42      -    -  edit gamma.py
  delta-runner      ■ failed    0:22      -    -  stopped
╰────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

The selected row is a full-width bar (xterm 236) with the `▸ ` cursor kept. A done
plan row whose worker was killed reads `closed · worker killed` in the error
colour. The TODO block needs the legacy `TodoWrite` tool: set
`CLAUDE_CODE_ENABLE_TODO_TOOLS=1` (TodoWrite on every model) and
`CLAUDE_CODE_ENABLE_TASKS=0` (without it Claude Code uses TaskCreate and
TaskUpdate and draws its own checklist above the prompt, re-expanding it on every
update, which squeezes the Atlas blocks to about 6 rows). Claude Code's fullscreen
renderer gives everything under the transcript (prompt, status line, mode line,
agent list) one slot capped at half the terminal, and a status line command is
told no row budget. The mod writes `.atlas/.run/hud-state.json`
(`{ts, maxRows, wanted, shown, fullscreen, starved}`, `wanted` being the rows the
HUD would draw unrestricted). Since 17.15.1 `starved` is always `false`: the mod
never asks the status line to shrink, and a plan longer than the slot folds
inside the HUD. The status line prints its full grid whenever it is configured;
`atlas_statusline.py` still prints one row (folder, timer, model, `· ctx N%`)
when it reads a fresh file with `starved` set, which only an older mod writes.
`atlas_statusline.py install` and
`atlas_doctor.py --fix` set `refreshInterval: 5` on the statusLine entry (other
keys are kept) so the switch lands within seconds. `atlas_doctor.py` reports this
and the other display settings as `display-` checks (`display-hud` flags
`ATLAS_HUD=off`; `display-omp-todo` flags `todo.enabled=false` in omp settings),
and `atlas_doctor.py --fix` sets both env flags and the status line, removes
`ATLAS_HUD=off` and sets omp `todo.enabled` true. On omp the lead records the plan
with omp's own `todo` tool; when it never calls it, the extension draws a fallback
TODO tree from the board until the first native todo result.

**The side panel.** The panel is a ribbon (`◖ ◆ ATLAS ◗ ▸ SIDEPANEL`), a tab strip
with the lit tab bold and ruled, and one view under it. The strip names six tabs
and binds one key to each (`PANEL_TABS` and `STRIP_TABS` in
`mod/panel-layout.ts`): `r` status, `t` team, `c` channel, `g` gates, `k` core and
`o` board. The key hint (`r: status  t: team  c: channel  g: gates  k: core
o: board  ctrl+x tab`) sits on the pane's last spare row, cut to the pane's width.
The panel draws the snapshot as it is, with no hold: the Stop verdict is read on
every frame beat, and the phase is never `done` while a dispatch row is open or a
worker runs (`currentPhase` in `mod/data/todos.ts`). The views, from
`contracts/panel-world.ts` at 60 columns:

```
◖ ◆ ATLAS ◗ ▸ SIDEPANEL ───────────────────────────────────

 status  team  channel  gates  core  board
 ━━━━━━
 phase  ◐ research
 gates  ● lint   ● test   △ doctor   2/3 green
 agents ◇ 1 queued  ◐ 1 running  ● 2 done  ■ 1 failed

 todo   ▰▰▰▱▱▱▱▱ 3/7
  ● Wire band to host     done            implementer-layout
  ● Layout grid tiers     done            implementer-layout
  ● Gate golden tests     done             implementer-gates
  ◐ Subagents block       running           implementer-band
  ◇ Gate tests            queued                 runner-land
  ■ Changelog             failed            implementer-live
  ▲ Ship board mod        blocked                        you
```

- **status** (key `r`, the tab id is still `route`): the phase row wears the band's
  own glyph, word and clock (`phase  ● done 0:29`, `phase  ▲ blocked 0:29`), built
  from the band's own inputs and the same glyph function (`phaseRow` with
  `phaseGlyph`, `mod/panel-layout.ts`), so the two never differ on one frame; then the numbered phase
  rail, a row per agent with a 12-cell braille activity line and its time, the
  gates, an events list of workers starting and finishing (`+0:13  alpha-explorer
  done`), and the todo rows.
- **team**: every seat has glyph, role, state word, elapsed time (the lead too)
  and a 12-cell activity line.
- **channel**: the channel name with people and unread counts, each post with its
  own time on the run clock (`+0:13`), a `posts` summary and a `senders` block.
  With a senders block shown, an empty channel reads `0 messages` under it.
- **gates**: the Stop gate's checks grouped, each group with an `n/m` count.
- **core**: the contract verdicts and the `verified n/m` figure
  (`verifiedFigure`), or `no verdicts, workers or gates yet`.
- **board** (key `o`): see below.

**The board.** The board tab (`mod/board-model.ts`, drawn by `mod/pane/sidebar.tsx`)
lists one row per plan item with state and owner, under a title row that counts
the items and carries the same `▰▱` meter, then a Gantt timeline: one lane per
agent, the lead's lane first, a bar (`▇`, ended exactly to the clock) in the
state colour from the agent's start offset, a `┊` gridline every 10 seconds, and a
caption under each bar (`0:11 · 4 calls`). The lead's lane follows the run: 141
while it works, 114 when done, 203 with `▲` while blocked. An axis closes the
chart and ends at the run's total, the figure the band shows. Under it a `recent`
list and a footer (`● 2 done  ■ 1 failed · total 0:29 · 9 worker calls`). At 57
columns (a 150-column terminal with the panel docked), five plan rows, a failed
worker and a finished run:

```
◖ ◆ ATLAS ◗ ▸ SIDEPANEL ▸ BOARD ───────────────────────

 status  team  channel  gates  core  board
                                     ━━━━━
  5 items                                      ▰▰▰▰▰▰▰▰

  ● T1 read alpha.py            done    alpha-explorer
  ■ T2 read ghost.py            failed  ghost-explorer
  ● T3 read beta.py             done    beta-explorer
  ● T4 combine the reports      done    lead
  ● T5 write the final summary  done    lead

 ● lead      ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇
             0:29 · 3 calls

 ● alpha     ┊    ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇       ┊
                  0:11 · 4 calls

 ■ ghost     ┊     ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇       ┊
                   0:10 · 2 calls

 ● beta      ┊             ┊        ▇▇▇▇▇▇▇▇▇▇
                                    0:07 · 3 calls
             ┬─────────────┬─────────────┬───────────┬──
             0:00          0:10          0:20       0:29

    recent
    +0:02    alpha-explorer  started
    +0:03    ghost-explorer  started
    +0:13    alpha-explorer  done
    +0:15    beta-explorer   started
    +0:22    beta-explorer   done

  ● 2 done  ■ 1 failed · total 0:29 · 9 worker calls
```

A failed worker reads `■ failed` on every tab. A dispatch row that a plan row owns
folds into that plan row; the rest list under a `dispatches` group.

**Transcript cards.** Cards are one row each, `min(56, cols - 4)` cells wide and
never wrapped (`finishRow` in `mod/transcript/cards.tsx`). Each starts with a bar
`▌` that is 141 for its first moments and 245 afterwards, then the dim brand mark.
A worker's finish card shows the state glyph and word, the worker name and, flush
right, the run time and call count from the worker's SUBAGENTS row (`-` where the
count is unknown). The run card is placed once per clean run and reads `done`,
the plan count and worker count, and the band's run time. A blocked card is
placed once per blocked spell, with a 203 bar, in the band's own words:

```
▌ ◆ ATLAS  ● done  beta-explorer          0:13 · 3 calls
▌ ◆ ATLAS  ■ failed  ghost-explorer             0:05 · -
▌ ◆ ATLAS  ● done  5/5 · 3 workers                  1:08
▌ ◆ ATLAS  ▲ blocked · stop refused                 0:36
```

A placed card is never removed, replaced or rewritten. The lead's `ATLAS | ...`
header line is rewritten for the screen by the classic `MessageDisplay` hook to
`phase n/m · state` in lower case (`displayLine` in
`mod/transcript/leadheader.ts`); the stored message and the Stop gate keep the
contract form. A turn footer is frozen at its first draw and prints the band's
run clock (`run 4:12`, `durationTree` in `mod/restyle.tsx`). Worker
cards are drawn only on omp, where a running worker is a 44-cell box
(`cardLines` and `CARD_W` in `mod/panel-layout.ts`, painted by `omp/panel-view.ts`):

```
┌─ ◆ running implementer-band ────── opus ─┐
│ last  read runs.ts:17                    │
│ steps ▰▰▰▰▱▱▱▱ 4 of 9 · 44%              │
│                                          │
│ ctx   ▰▰▰▰▰▱▱▱ 62%                       │
└──────────────────────────────────────────┘
```

**Palette.** The mod draws with accent 141, ok 114, warn 179, error 203, the pill
97 and a short list of neutrals. `mod/palette.test.ts` fails on any
other literal colour in a non-test file under `mod/` or `omp/`, apart from the
Mocha and Latte token sets, white, the contract persona colours and the sprites.
On a 256-colour terminal the host maps each hex to the nearest xterm index, and
every surface is limited to `PALETTE_INDICES` in `mod/surface_indices.ts`.

**Motion.** A row that turns done holds its first state for one 200 ms beat
(`DONE_HOLD_MS`, `mod/motion.ts`), then eases over up to four more
200 ms beats (`MOTION_STEP_MS`, `MAX_BEATS` in `mod/motion.ts`). The motion timer runs at 100 ms
(`MOTION_FRAME_MS`), at most 10 redraws a second.

**Host load rules.** The mod loads in the host only if its files keep the host's
rules, among them that the hook context `$` is never assigned, stored, returned or
spread (rule 3) and that mod code imports no `.json` file and calls no dynamic
`import()` (rule 4). `mod/host-load-rules.test.ts` checks them, and
`test_mod_never_stores_the_host_context` in `hooks/test_atlas_contract.py` pins
the same invariant in the contract suite.

### Terminal variables

These are read by the mod (`mod/atlas-ui.ts`, `mod/motion.ts`, `mod/look.ts`,
`mod/register.ts`) and by the omp extension (`omp/`). Unset means the default.

| Variable | Default | Effect |
| -------- | ------- | ------ |
| `ATLAS_MOD` | on | `off` makes every mod handler a pass-through (`mod/register.ts`) |
| `ATLAS_HUD` | on | `off` hides the TODO and SUBAGENTS blocks (`mod/register.ts`) |
| `ATLAS_BAND_RICH` | off | `1` draws the tall band when the rows allow (`mod/band.tsx`, `mod/look.ts`) |
| `ATLAS_THEME` | auto | `latte` or `light`, `mocha` or `dark`; otherwise `COLORFGBG` (background 7 or 15 is light), else mocha (`themeName`, `mod/atlas-ui.ts`) |
| `ATLAS_ASCII` | off | Set and not `0` or `false` forces ASCII marks; unset, ASCII is used when `LC_ALL`, `LC_CTYPE` or `LANG` is set and is not UTF-8 (`asciiMode`, `mod/atlas-ui.ts`) |
| `NO_COLOR` | unset | Any non-empty value turns colour off and also stops row transitions (`colorMode`, `mod/atlas-ui.ts`; `reducedMotion`, `mod/motion.ts`) |
| `COLORTERM` | unset | `truecolor` or `24bit` selects 24-bit colour; with `TERM` containing `256` and `COLORTERM` unset the mod uses the 256-colour palette; otherwise truecolor (`mod/atlas-ui.ts`) |
| `ATLAS_REDUCED_MOTION` | off | `1`, `true`, `yes` or `on` draws the resting render only: no state-change fade and no reveal of a new row; the spinner still steps (`mod/motion.ts`) |
| `ATLAS_PROJECT_ROOT` | unset | A project root that contains `.atlas`; it wins over the search. Unset, the mod walks up from the working directory to the nearest `.git` or `.atlas` (`mod/data/root.ts`) |
| `ATLAS_HOME`, `ATLAS_DB` | `~/.atlas`, `<home>/atlas.db` | Where the mod looks for the gate database (`mod/register.ts`) |
| `ATLAS_STATUSLINE` | on | omp only: `off` skips the usage statusline (`omp/index.ts`) |
| `ATLAS_ADVISOR_GATE` | on | omp only: `off` disables the advisor gate (`omp/advisor.ts`) |

The omp advisor gate (`omp/advisor.ts`) turns every advisor note, of any severity,
into a board item for the session, appends a reminder to the system prompt while
items are open, and refuses to stop while any is open, at most 3 times per prompt
(`MAX_STOP_BLOCKS`, `omp/advisor.ts`). With no `docs/` ancestor, no session id or
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
  against the same metric. `--set-status <id> <status>` exits 2 for an unknown
  status or a non-numeric id and 1 for an unknown id; its help lists the statuses
  the database holds, `wontfix` and `resolved` included.
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
team runs end), summed per ISO week and sent as a week-to-date snapshot, then once more when the week has ended (when an endpoint is configured). No install id, no prompts, code, paths or names
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

New in 17.19.0: the client sends the current week as a week-to-date snapshot (`partial: true`, schema 3) and each finished
week once as final, in the background at session start, at most once an hour. A failed send keeps the week and is counted; `status` shows the
last send result. `send --test`, `preview --test`, `prove --test` or `ATLAS_ANALYTICS_TEST=1` mark a payload as a test, which
the public report ignores. The owner reads the data on a dashboard at `/dashboard` of the telemetry server, behind a secret
(`telemetry/server/README.md`).

| New counters | Meaning |
|---|---|
| `delivery.ok.<urllib\|curl>`, `delivery.fail.<ssl\|timeout\|network\|http4xx\|http5xx\|refused\|other>` | Send results; a TLS failure retries with curl. |
| `command.<skill>`, `active.day.<mon..sun>` | Slash commands used; weekdays with activity. |
| `fault.<component>.<errclass>` | Component faults by closed error class. |
| `mod.open.*`, `mod.command.*`, `mod.error.*` | Mod panels opened, mod commands run, mod errors. |
| `crew.workers.*`, `crew.outcome.*`, `crew.wall.*`, `crew.rounds.*`, `crew.check.*` | Crew size, outcome, wall time, fix rounds, unit check result. |

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
| `ATLAS_DECISION_VERIFY`                                        | on                       | `off` disables the decision-model done-claim check (gate v)   |
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
|-- .claude-plugin/plugin.json   manifest, version 17.21.0
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
