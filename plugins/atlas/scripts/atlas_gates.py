#!/usr/bin/env python3
"""Live gate status for the Atlas sidebar: one JSON document, no side effects.

    atlas_gates.py --session <id> --root <repo> [--transcript <path>] --json

Three independent groups (completion, tripwire, routing); an exception in one
sets that group's "error" and the others still print. Exit 0 always except on
bad args. The DB is opened read-only; completion_gate.evaluate() is pure.
"""

import argparse
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
sys.path.insert(0, str(_HERE.parent / "hooks"))

import atlas_db  # noqa: E402

# Short plain-English names, one per gate letter.
_LABELS = {
    "a": "Evidence captured",
    "b": "Verified finding recorded",
    "c": "CHANGELOG present",
    "d": "ROADMAP present",
    "e": "README present",
    "f": "Docs updated for code changes",
    "g": "Implementer work verified",
    "h": "ROADMAP reconciled",
    "i": "Todos drained",
    "j": "Worktrees closed out",
    "k": "Plan written",
    "l": "Docs named date-first",
    "m": "Code changes delegated",
    "n": "Status header shown",
    "o": "Required phases marked",
    "p": "Colony channel used",
    "q": "Worker branches merged",
}
_NATIVE = ("Read", "Grep", "Glob", "Bash")
_CONTEXT_SERVERS = (
    ("lean-ctx", ("lean-ctx", "lean_ctx")),
    ("serena", ("serena",)),
    ("context-mode", ("context-mode", "context_mode")),
    ("claude-mem", ("claude-mem", "claude_mem", "mcp-search")),
)
_ROUTING_NOTE = "as of the last ingest (Stop, SubagentStop, PreCompact)"


def _ro_conn() -> sqlite3.Connection:
    path = atlas_db.db_path()
    if not os.path.isfile(path):
        raise FileNotFoundError(f"atlas DB not found: {path}")
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2.0)
    conn.execute("PRAGMA busy_timeout=2000")
    return conn


def _line(id_, label, ok, detail=None, fix=None) -> dict:
    out = {"id": id_, "label": label, "ok": bool(ok)}
    if detail:
        out["detail"] = detail
    if fix:
        out["fix"] = fix
    return out


def completion_group(session: str, root: Path, transcript: str) -> dict:
    import completion_gate as cg

    g = {"id": "completion", "title": "Completion gate", "lines": []}
    if os.environ.get("ATLAS_GATE", "").lower() == "off":
        g["error"] = "gate is off"
        return g
    data = {"session_id": session, "cwd": str(root), "transcript_path": transcript}
    missing_delegation, _paths, _note = cg._delegation_state(data, root)
    if not cg._session_is_orchestrating(session):
        g["lines"].append(
            _line(
                "m",
                _LABELS["m"],
                not missing_delegation,
                "Not an orchestrating session: only this condition applies",
                cg._GISTS["m"] if missing_delegation else None,
            )
        )
        return g
    ev = cg.evaluate(data, root, missing_delegation)
    for letter in sorted(_LABELS):
        failing = letter in ev["failed"]
        g["lines"].append(
            _line(
                letter,
                _LABELS[letter],
                not failing,
                None,
                cg._GISTS[letter] if failing else None,
            )
        )
    return g


def tripwire_group(session: str) -> dict:
    g = {"id": "tripwire", "title": "Dispatch tripwire", "lines": []}
    conn = _ro_conn()
    try:
        armed = atlas_db.is_orchestrating(conn, session)
        rid = atlas_db.current_run_id(conn, session) or atlas_db.latest_run_id(
            conn, session
        )
        try:
            limit = int(os.environ.get("ATLAS_TRIPWIRE_THRESHOLD", "4"))
        except ValueError:
            limit = 4
        n = (
            atlas_db.unsanctioned_inline_ops_since_last_dispatch(conn, rid)
            if rid is not None
            else 0
        )
        # Informational: a session that is simply not orchestrating is not failing.
        g["lines"].append(
            _line("armed", "Orchestration armed", True, "armed" if armed else "not armed")
        )
        g["lines"].append(
            _line(
                "inline", "Inline ops since last dispatch", n < limit, f"{n} of {limit}"
            )
        )
        rows = conn.execute(
            "SELECT category, snippet, ts FROM friction_events WHERE session_id=? "
            "AND category LIKE 'dispatch_denied:%' ORDER BY ts DESC LIMIT 5",
            (session,),
        ).fetchall()
    finally:
        conn.close()
    now = time.time()
    for i, (cat, snippet, ts) in enumerate(rows):
        age = max(0, int(now - (ts or now)))
        ago = f"{age}s ago" if age < 120 else f"{age // 60}m ago"
        g["lines"].append(
            _line(
                f"deny{i}",
                f"Denied: {cat.split(':', 1)[1]}",
                False,
                f"{(snippet or '')[:80]} ({ago})",
            )
        )
    return g


def routing_group(session: str) -> dict:
    g = {"id": "routing", "title": "Tool routing", "lines": []}
    conn = _ro_conn()
    try:
        rows = conn.execute(
            "SELECT kind, server, tool_name, denied FROM tool_calls WHERE session_id=?",
            (session,),
        ).fetchall()
    finally:
        conn.close()
    for name, keys in _CONTEXT_SERVERS:
        n = sum(1 for k, s, t, d in rows if k == "mcp" and (s or "").lower() in keys)
        g["lines"].append(_line(name, f"{name} calls", True, f"{n} {_ROUTING_NOTE}"))
    for tool in _NATIVE:
        n = sum(1 for k, s, t, d in rows if k == "builtin" and t == tool)
        g["lines"].append(
            _line(
                f"native-{tool}", f"Native {tool} calls", n == 0, f"{n} {_ROUTING_NOTE}"
            )
        )
    denies = sum(1 for r in rows if r[3])
    g["lines"].append(
        _line("denied", "Policy denies", denies == 0, f"{denies} {_ROUTING_NOTE}")
    )
    return g


def build(session: str, root: str, transcript: str = "") -> dict:
    jobs = (
        (
            "completion",
            "Completion gate",
            lambda: completion_group(session, Path(root), transcript),
        ),
        ("tripwire", "Dispatch tripwire", lambda: tripwire_group(session)),
        ("routing", "Tool routing", lambda: routing_group(session)),
    )
    groups = []
    for gid, title, fn in jobs:
        try:
            groups.append(fn())
        except Exception as exc:  # noqa: BLE001 -- each group fails independently
            groups.append(
                {
                    "id": gid,
                    "title": title,
                    "lines": [],
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )
    return {"groups": groups, "generatedAt": int(time.time() * 1000)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--session", required=True)
    ap.add_argument("--root", required=True)
    ap.add_argument("--transcript", default="")
    ap.add_argument("--json", action="store_true", required=True)
    args = ap.parse_args(argv)
    print(json.dumps(build(args.session, args.root, args.transcript)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
