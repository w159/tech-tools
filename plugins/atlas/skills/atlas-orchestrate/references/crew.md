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
| Interfaces   | Each worker's context holds the public skeleton (classes, signatures, constants) of every planned file it imports, or its own test file imports (all are waited on), so it codes against peers without reading them. |
| Delivery     | `hooks/crew_worker.py` PostToolUse pushes unread channel lines into the worker's context; workers use `irc say`, `irc say --to <nick>`, `irc wait --from <nick> --match` (new messages only; `--all` scans history), `irc check`. Files are written with the Write tool into the worker's stage dir `.atlas/tmp/<run>/<nick>/` (`ATLAS_CREW_STAGE`), not with shell heredocs: Claude Code's Bash safety check refuses some of them ("Contains brace with quote character (expansion obfuscation)"), which cost 4 workers per 30-module run a whole file generation (10-25 s) plus a failed Edit ("File has not been read yet"). `irc check` and `irc done` first install each staged owned file over the real one when the staged copy is newer and the bytes differ (`atlas_irc.install_staged`), printing `installed <p> from staged copy`. |
| Leases       | PreToolUse denies Edit/Write outside the worker's `owns`, and a Bash command that plainly writes a peer's file, naming the owner to ask instead. Edit/Write inside the worker's own stage dir is allowed; a peer's stage dir stays denied. One tree, no worktrees. The hook grants nothing past Claude Code's own safety checks. |
| Check gate   | Stop re-runs the worker's own `check` and refuses to let it stop while the check fails (3 refusals, then GAVE UP is posted). A claim of done is never taken as evidence. Skipped when the DONE's owned-file digest still matches (`done_current`). |
| Verified DONE | A worker's check is `irc check`: it waits for `ATLAS_CREW_NEEDS` (as `irc need --done`, exit 2/3/4), runs `ATLAS_CREW_UNIT_CHECK` in the project root, prints the output and posts DONE only when that exits 0, so piping it cannot fake a DONE. Before it runs the unit check it restores the stub docstrings the worker's rewrite dropped (`ATLAS_CREW_STUBS` maps each owned file to the pristine copy the run saved under `<rundir>/stubs/`): only where the stub has one and the worker's module, class, function or method has none, and only a result that parses. The unit check then runs once, on the files with docstrings: a pass keeps them and posts DONE; a failure puts back the exact pre-restore bytes and prints one line saying the output is from the run with docstrings. (A second unit-check run after the restore cost the store worker's DONE hop 8.9-9.6 s instead of one 3.3-4.8 s check, on the critical chain.) A manual `irc done` follows the same single-run order and refuses (exit 1) on failure. The supervisor does not wait for worker processes before the global check (exit tails run 1-8 s under load): it starts the check once every worker has exited or holds a current verified DONE, snapshots the sha256 of every owned file, then waits for the exits (cap `RESULT_GRACE_S` + 10 s) and re-runs the check if an owned file changed meanwhile. Round 0 reports `all_exited` and `check_started_before_exit`; the stage dirs are removed after `summary.json`. A failing check voids the worker's earlier DONE, and a later pass posts a fresh one. |
| No sleeping  | PreToolUse denies `sleep N` with N >= 3 s; workers wait with `irc wait --from <peer> --timeout <s>` or `irc check`. |
| Fix rounds   | After all workers exit, the supervisor runs the global check and resumes only the owners of failing tests (`--fix-rounds`, default 2). Sharded final check: When the global check is a plain `pytest` command (no `\|`, `&&`, `;`, `>`) and the workers' `tests` name at least 2 existing files, the supervisor (round 0 and fix rounds) runs it as `min(ncpu, files)` parallel shards of those files, balanced by file size, plus one rest shard with `--ignore=<file>` for each so other tests still run (rest exit 5, nothing collected, counts as a pass). Failing shards' output comes first, so `route_failures` still sees the test file names; the round records `check_shards`. Reason: the 784-test `python3 -m pytest -q` took 3.95 s in one benchmark run and 8.5-8.9 s in two others (one test file had a 5.1 s test), after the last DONE. `ATLAS_CREW_SHARD=off` runs the command once. A test file is also skipped (round records `check_cached`) when its worker's standing DONE carries `digest`, `peer_digests` (its needs closure) and `test_digest` (its tests plus conftest.py/pytest.ini/pyproject.toml/setup.cfg/tox.ini) equal to the bytes now on disk and its `unit_check` is plain pytest (only `-q`, `-qq`, `-x`, `-p no:cacheprovider`, literal test files) (1.4-4.4 s on the critical path measured at 18-30 modules); `ATLAS_CREW_CHECK_CACHE=off` disables it. |
| Early exit   | PostToolUse ends the worker's session right after a Bash call whose check posted DONE and whose check, re-run by the hook, passes: no final model turn. The re-run is skipped when `done_current` proves the DONE (stored `digest`) matches the owned files. |
| Lean workers | Each worker is `claude -p` with its own session id, `--strict-mcp-config`, project settings only, tools `Bash,Edit,Write`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` and a short replacement system prompt. |

## Launch priority

`atlas_crew.launch_order` starts the critical workers first. 30 `claude -p` workers started at once on 4 CPUs:
median init 10.6 s, first result 19.4 s (alone: init 0.7 s, result 4.1 s). With 8 of the 30 at nice 0 and 22 at
nice 15, those 8 got init 2.1 s and result 6.6 s. Weight = chars of the `path#Heading` context sections only (162 runs: API time
corr 0.8 with spec chars, negative with owned stubs); gen time = weight / 400 chars/s, 1.5 s per dependency hop. A forward and a backward pass
over `needs` give each worker its slack (how late it may finish without delaying the end). Workers launch by
ascending slack (ties: heavier first, then name) at `nice = min(19, 4 * (rank // ncpu))`; the order is stored in
`run.json` as `launch`, and `worker --nice N` applies it before `claude` starts. Fix rounds run at nice 0.
`ATLAS_CREW_PRIORITY=off` launches in plan order at nice 0. Stagger: a worker whose needs finish later waits `min(8, wait - 7.5)` s (`worker --delay`, round 0; `ATLAS_CREW_STAGGER=off` disables). Worker prompt toggles: `ATLAS_CREW_SKIP_DOCSTRINGS=off` drops the omit-stub-docstrings line; `ATLAS_CREW_WORKER_EFFORT=low|medium|high` overrides every worker's effort.

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
