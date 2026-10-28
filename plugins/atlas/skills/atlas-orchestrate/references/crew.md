# Crew: a parallel build team on tmux and IRC

Use a crew when one deliverable spans several files that can be written in
parallel (a spec with one section per module, a feature that touches N
independent files, a port of N modules). Use `atlas_mux.py spawn-team` for
read-only and review teams (audit, explore, verify), where nothing is merged.

## Start it in one call

From a Claude session the entry point is the manual skill `/atlas:atlas-crew`,
which takes the flags below (`/atlas:atlas-crew --spec SPEC.md --files 'pkg/*.py'
--tests 'tests/test_{stem}.py' --check 'python3 -m pytest -q'`). Its body runs
`atlas_crew.py run $ARGUMENTS --wait 100` as pre-executed shell, so the crew is
running before the lead's first model call and the lead is one turn. If the
summary has not appeared after 100 s it prints only the start line; run
`atlas_crew.py wait --run <id>` as below. The direct call:

```bash
# spec-driven: one worker per file, each gets only its own spec section
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_crew.py" run \
  --spec SPEC.md --files 'pkg/*.py' --tests 'tests/test_{stem}.py' \
  --check 'python3 -m pytest -q' --model <model> --effort <effort> --wait 580
# hand-written plan (see "Plan" below)
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_crew.py" run --plan plan.json --wait 580
```

Set the Bash timeout to 600000. `--wait` prints the final JSON summary; if it
prints only the start line, run `atlas_crew.py wait --run <id>` until it does.
Do not read worker logs while it runs. If `check_exit` is 0 the build is done;
otherwise read `check_tail` and route what remains.

`--tests` takes `{stem}`, `{name}` and `{parent}` (for `tests/{parent}/test_{stem}.py`
in a multi-package tree). `atlas_crew.py plan ...` prints the plan without
starting anything.

## What runs

| Piece        | What it does                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| tmux         | Session `atlas-<run>`: one window per worker (rendered feed), an `irc` window tailing the channel, an `ircd` window running the gateway. `tmux attach -t atlas-<run>`.     |
| IRC channel  | `scripts/atlas_irc.py`: an append-only log (`irc/log.jsonl`) with a real RFC 1459 gateway on 127.0.0.1 (`irc/port`). Any IRC client can join `#<run>` and talk to the crew. |
| Interfaces   | Each worker's context holds the public skeleton (classes, signatures, constants) of every planned file it imports, so it codes against peers without reading them. |
| Delivery     | `hooks/crew_worker.py` PostToolUse pushes unread channel lines into the worker's context; workers use `irc say`, `irc say --to <nick>`, `irc wait --from <nick> --match` (new messages only; `--all` scans history), `irc check`. |
| Leases       | PreToolUse denies Edit/Write outside the worker's `owns`, and a Bash command that plainly writes a peer's file, naming the owner to ask instead. One tree, no worktrees.     |
| Check gate   | Stop re-runs the worker's own `check` and refuses to let it stop while the check fails (3 refusals, then GAVE UP is posted). A claim of done is never taken as evidence.    |
| Verified DONE | A worker's check is `irc check`: it waits for `ATLAS_CREW_NEEDS` (as `irc need --done`, exit 2/3/4), runs `ATLAS_CREW_UNIT_CHECK` in the project root, prints the output and posts DONE only when that exits 0, so piping it cannot fake a DONE. A manual `irc done` re-runs the unit check and refuses (exit 1) on failure. A failing check voids the worker's earlier DONE, and a later pass posts a fresh one. |
| No sleeping  | PreToolUse denies `sleep N` with N >= 3 s; workers wait with `irc wait --from <peer> --timeout <s>` or `irc check`. |
| Fix rounds   | After all workers exit, the supervisor runs the global check and resumes only the owners of failing tests (`--fix-rounds`, default 2).                                      |
| Early exit   | PostToolUse ends the worker's session right after a Bash call whose check posted DONE and whose check, re-run by the hook, passes: no final model turn. |
| Lean workers | Each worker is `claude -p` with its own session id, `--strict-mcp-config`, project settings only, tools `Bash,Edit`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` and a short replacement system prompt. |

The lead's context holds the start line and one summary: per-worker tokens,
cost, wall time, gate refusals, and channel counts (messages, READY
announcements, direct worker-to-worker messages, messages from IRC clients).

## Plan

```json
{"goal": "...", "check": "python3 -m pytest -q", "context": ["SPEC.md#Overview"],
 "workers": [{"name": "semver", "owns": ["pkg/semver.py"], "tests": ["tests/test_semver.py"],
              "task": "Implement pkg/semver.py per its spec section.",
              "context": ["SPEC.md#1. `pkg/semver.py`", "pkg/semver.py"],
              "check": "python3 -m pytest -q tests/test_semver.py"}]}
```

`load_plan` turns a worker's `check` into `irc check`: the plain command becomes
its `unit_check` and an optional `"needs": ["peer", ...]` lists the workers it
waits for (none by default). The automatic plan fills `needs` from the imports
between the planned files. The supervisor's fix rounds re-run `unit_check`.
A check that already calls `irc need`, `irc done` or `irc check` is kept as written.

- `owns` must not overlap; `lead` is a reserved name.
- A context entry `file#Heading` hands over exactly that markdown section
  (fenced code is skipped when finding headings); a bare path hands over the
  file; anything else is literal text.
- Split by file ownership, not by role. A planner/implementer/verifier split
  of one file set serializes the work and multiplies context.

## Why this shape

Measured against one Claude prompt on the same task and model, see the
benchmark in `docs/audits/2026-10-28_atlas-16.4.0-crew-benchmark.md` (repo root)
(16.4.0: 13-16% of the tokens and 28-30% of the wall time of the single prompt;
the 25% wall-time target is still missed). The savings come from three things: the
lead never reads the spec or code; each worker carries only its own section
and file; and every per-call floor the worker does not need (MCP tools, user
settings, the stock system prompt, unused tool schemas) is removed, because
it is re-sent on every model call.
