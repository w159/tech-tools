#!/usr/bin/env python3
"""Run-state bridge for omp: the atlas.db writes Claude's hooks do implicitly.

On Claude Code the SessionStart hook (session_boot) creates the run and the
dirty-tree snapshot, and PostToolUse (dispatch_tripwire) logs events, dispatches
and arms orchestration. omp has no such hooks, so the TypeScript bridge shells
out to this CLI at the matching moments. Every subcommand reuses the same
atlas_db / session_boot functions those hooks call, with the same guards, so the
rows are indistinguishable from a Claude session's.

    omp_runstate.py begin    --session-id S --cwd D
    omp_runstate.py arm      --session-id S --cwd D [--agent-type T] [--model M] [--worktree]
    omp_runstate.py event    --session-id S --cwd D --tool <ClaudeToolName> [--path P] [--dispatch AGENT]
    omp_runstate.py snapshot --session-id S --cwd D
    omp_runstate.py rebaseline --session-id S --cwd D

Each prints one JSON line and exits 0 (fail-open: a broken bridge must never
wedge a session). Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
sys.path.insert(0, os.path.join(_HERE, "..", "hooks"))

# Mirrors dispatch_tripwire.INLINE_TOOLS / DISPATCH_TOOLS: the only tools it logs.
INLINE_TOOLS = {"Read", "Grep", "Glob", "Edit", "Write", "Bash"}
DISPATCH_TOOLS = {"Agent", "Task"}


def _tool_state_dirs() -> tuple:
    """Dirs agent tooling writes by itself (contracts/native-tools.json `ompToolStateDirs`).
    Read by omp code only: the Claude hooks never look at this key. Unreadable -> ()."""
    try:
        path = os.path.join(_HERE, "..", "contracts", "native-tools.json")
        with open(path, encoding="utf-8") as fh:
            dirs = json.load(fh)["ompToolStateDirs"]
        return tuple(d for d in dirs if isinstance(d, str) and d)
    except (OSError, ValueError, KeyError, TypeError):
        return ()


def _connect():
    import atlas_db

    conn = atlas_db.connect()
    atlas_db.init(conn)
    return atlas_db, conn


def cmd_begin(args) -> dict:
    """Create the run row for this session if none is open. Idempotent: the same
    guard session_boot uses (`current_run_id is None`), plus the empty-session-id
    refusal that stops a phantom run keyed by ''."""
    if not args.session_id:
        return {"ok": False, "error": "empty session id"}
    atlas_db, conn = _connect()
    try:
        pid = atlas_db.register_project(conn, args.cwd, os.path.basename(os.path.abspath(args.cwd)))
        rid = atlas_db.current_run_id(conn, args.session_id)
        created = False
        if rid is None:
            rid = atlas_db.start_run(conn, pid, args.session_id)
            created = True
        return {"ok": True, "run_id": rid, "created": created}
    finally:
        conn.close()


def cmd_arm(args) -> dict:
    """Flag the run orchestrating (what dispatch_tripwire._arm_orchestrating and
    the orchestration skills do) and, when an agent type is given, log that
    dispatch so completion-gate (g)/(m) see it."""
    if not args.session_id:
        return {"ok": False, "error": "empty session id"}
    atlas_db, conn = _connect()
    try:
        rid = atlas_db.mark_orchestrating(conn, args.session_id, args.cwd)
        if args.agent_type:
            atlas_db.log_dispatch(conn, rid, args.agent_type, args.model)
        if args.worktree:
            atlas_db.mark_used_worktrees(conn, args.session_id)
        return {
            "ok": True,
            "run_id": rid,
            "orchestrating": atlas_db.is_orchestrating(conn, args.session_id),
        }
    finally:
        conn.close()


def cmd_event(args) -> dict:
    """Log one tool event the way dispatch_tripwire's PostToolUse does: dispatch
    tools go to `dispatches` (resolved against current-or-last run, since a late
    dispatch can land after finalize); inline tools to `events` against the open
    run; anything else is ignored."""
    if not args.session_id:
        return {"ok": False, "error": "empty session id"}
    atlas_db, conn = _connect()
    try:
        tool = args.tool
        if tool in DISPATCH_TOOLS:
            rid = atlas_db.current_or_last_run_id(conn, args.session_id)
            if rid is None:
                return {"ok": True, "logged": False, "reason": "no run"}
            atlas_db.log_dispatch(conn, rid, args.dispatch or tool, args.model)
            return {"ok": True, "logged": True, "kind": "dispatch", "run_id": rid}
        if tool not in INLINE_TOOLS:
            return {"ok": True, "logged": False, "reason": "untracked tool"}
        rid = atlas_db.current_run_id(conn, args.session_id)
        if rid is None:
            return {"ok": True, "logged": False, "reason": "no open run"}
        atlas_db.log_event(conn, rid, tool, "main", 1, args.path)
        return {"ok": True, "logged": True, "kind": "event", "run_id": rid}
    finally:
        conn.close()


def cmd_snapshot(args) -> dict:
    """Write .atlas/.run/dirty-snapshot-<sid>.json via session_boot's own writer
    (first snapshot per session wins; None means already written, not a git tree,
    or no session id)."""
    import session_boot

    target = session_boot.write_dirty_snapshot(args.cwd, args.session_id)
    return {"ok": True, "path": target, "written": bool(target)}


def cmd_rebaseline(args) -> dict:
    """Fold tool state written AFTER the SessionStart snapshot into that snapshot.

    MCP servers (serena, ...) write `.serena/` only once they start, which on omp is
    after the snapshot was taken, so completion_gate's shell-dirt check (m) would count
    those files as code the lead wrote. Only paths under `ompToolStateDirs` are merged;
    every other path, and every path the snapshot already holds, is left exactly as is,
    so a real code edit still counts. No snapshot, no git tree, or no dirs: no-op."""
    import session_boot

    dirs = _tool_state_dirs()
    path = session_boot.snapshot_path(args.cwd, args.session_id)
    absorbed: list = []
    if dirs and args.session_id:
        try:
            with open(path, encoding="utf-8") as fh:
                snap = json.load(fh)
            held = snap["paths"]
            now = session_boot.dirty_map(args.cwd) or {}
            absorbed = sorted(p for p in now if p not in held and any(seg in dirs for seg in p.split("/")))
            if absorbed:
                held.update({p: now[p] for p in absorbed})
                with open(path, "w", encoding="utf-8") as fh:
                    json.dump(snap, fh)
        except (OSError, ValueError, KeyError, TypeError):
            absorbed = []
    return {"ok": True, "absorbed": absorbed}


COMMANDS = {"begin": cmd_begin, "arm": cmd_arm, "event": cmd_event, "snapshot": cmd_snapshot, "rebaseline": cmd_rebaseline}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="omp_runstate")
    sub = parser.add_subparsers(dest="cmd")
    for name in COMMANDS:
        p = sub.add_parser(name)
        p.add_argument("--session-id", default="")
        p.add_argument("--cwd", default=os.getcwd())
        if name == "arm":
            p.add_argument("--agent-type", default=None)
            p.add_argument("--model", default=None)
            p.add_argument("--worktree", action="store_true")
        if name == "event":
            p.add_argument("--tool", required=True)
            p.add_argument("--path", default=None)
            p.add_argument("--dispatch", default=None)
            p.add_argument("--model", default=None)
    try:
        args = parser.parse_args(argv)
        if args.cmd not in COMMANDS:
            raise ValueError("usage: omp_runstate.py begin|arm|event|snapshot ...")
        result = COMMANDS[args.cmd](args)
    except SystemExit:
        result = {"ok": False, "error": "bad arguments"}
    except Exception as exc:  # noqa: BLE001 -- fail open
        result = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
