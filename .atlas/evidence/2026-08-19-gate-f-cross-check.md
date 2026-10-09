# Condition (f) git cross-check: red -> green on live session state

Captured 2026-08-19 while shipping atlas 5.14.0.

## The failing case

The Stop gate blocked this session twice on condition (f) while
`docs/CHANGELOG.md` and `docs/ROADMAP.md` were both genuinely modified and
visible in `git status`. Cause: (f)'s signal is `run_changed_paths`, fed by tool
calls carrying a `file_path`. Both docs files had been written by a Python
script invoked through `Bash`, which produces no such path, so the gate saw code
move and docs not move.

## Method

Both gate versions were run against the *same live session state* - real
`session_id`, real `cwd`, real transcript - with `ATLAS_DB` pointed at a copy of
`~/.atlas/atlas.db` so live telemetry was not mutated, and an isolated
`ATLAS_HOOKSTATE_DIR` so neither run tripped the other's circuit breaker.

```
SID=b8710de8-bb7d-45c3-b3ad-55b889e0b5e5
PAYLOAD="{\"session_id\":\"$SID\",\"cwd\":\"$PWD\",\"transcript_path\":\"...$SID.jsonl\"}"
```

## Red - installed 5.13.0 (no cross-check)

```
$ echo "$PAYLOAD" | ATLAS_DB=<copy> python3 \
    ~/.claude/plugins/cache/tech-tools/atlas/5.13.0/hooks/completion_gate.py
decision: block
conditions: ['(f) ']
```

## Green - repo 5.14.0 (with the cross-check)

```
$ echo "$PAYLOAD" | ATLAS_DB=<copy> python3 plugins/atlas/hooks/completion_gate.py
PASS - silent, no block
```

Same input, same session, same docs state. The only difference is the
`_docs_moved_in_git` cross-check added in 5.14.0.

## What this does NOT prove

Conditions (i) and (j) were both inert during this capture and are therefore
untested here: this session's transcript contains no `TodoWrite` tool_use (so
`_open_todos` returned 0, the designed pass-through for a run with no list) and
no `isolation: "worktree"` dispatch was recorded (so (j) never consulted
`git worktree list`). Both remain fixture- and mutation-verified only. See
`docs/ROADMAP.md` for the exact live check that closes them.
