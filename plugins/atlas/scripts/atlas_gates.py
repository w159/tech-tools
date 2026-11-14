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
    "p": "Team channel used",
    "q": "Worker branches merged",
    "s": "Team gate",
}
# Stop-only gates: they refuse a Stop but are not a row on the gates tab.
_STOP_ONLY = {"r": "Done claimed early"}
# Gates that completion_gate.evaluate() can fail but _GISTS has no one-line fix for.
_FIXES = {
    "s": "in-process workers without a tmux team: run atlas_mux.py spawn-team, or set ATLAS_TEAM_GATE=off",
}
_NATIVE = ("Read", "Grep", "Glob", "Bash")
_CONTEXT_SERVERS = (
    ("lean-ctx", ("lean-ctx", "lean_ctx")),
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


def stop_verdict_line(session: str, root: Path):
    """The completion gate's last Stop verdict for `session`, as one informational line (ok is always
    true: it is a record, not a check). None when no verdict is stored. completion_gate_core writes it."""
    try:
        rec = json.loads(
            (Path(root) / ".atlas" / ".run" / "stop-verdict.json").read_text(
                encoding="utf-8"
            )
        )["sessions"][session]
        blocked = bool(rec["blocked"])
        why = [str(x) for x in rec.get("why") or [] if str(x).strip()]
        # the recorded plain words win (`1 todo open`); a letter without a label never reaches the band bare
        names = why or [
            _LABELS.get(str(x)) or _STOP_ONLY.get(str(x)) or "gate"
            for x in rec.get("letters") or []
        ]
    except Exception:  # noqa: BLE001 -- no record, or an unreadable one, means no line
        return None
    if blocked:
        return _line(
            "stop-verdict", "Last Stop blocked", True, ", ".join(names) or "gate"
        )
    return _line("stop-verdict", "Last Stop allowed", True)


def _find_transcript(session: str) -> str:
    """~/.claude/projects/*/<session>.jsonl when it exists, else "". Cheap: one glob, no reads."""
    try:
        if not session or not session.replace("-", "").replace("_", "").isalnum():
            return ""
        import glob

        hits = glob.glob(os.path.join(os.path.expanduser("~"), ".claude", "projects", "*", session + ".jsonl"))
        return max(hits, key=os.path.getmtime) if hits else ""
    except Exception:  # noqa: BLE001 -- display only
        return ""


def completion_group(session: str, root: Path, transcript: str) -> dict:
    g = _completion_group(session, root, transcript)
    line = stop_verdict_line(session, root)
    if line is not None:
        g["lines"].append(line)
    return g


def _completion_group(session: str, root: Path, transcript: str) -> dict:
    import completion_gate as cg

    g = {"id": "completion", "title": "Completion gate", "lines": []}
    if os.environ.get("ATLAS_GATE", "").lower() == "off":
        g["error"] = "gate is off"
        return g
    transcript = transcript or _find_transcript(session)
    # display_only: this view waives nothing, so with no transcript a crew proof is judged on the engine's
    # own files (marked launch_checked False); the Stop gate always checks the transcript.
    data = {"session_id": session, "cwd": str(root), "transcript_path": transcript, "display_only": True}
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
    # (s) is the Stop gate's own decision, not a copy of it: red exactly when Stop would block on it
    # (an advisory, a used-once marker, a read-only-only run or a team record all read green).
    team_count, team_advisory = cg._team_gate(
        root, session, cg._run_started_at(session)
    )
    team_failing = bool(team_count) and not team_advisory
    # `Todos drained` and `Evidence captured` read the same store and rule as Stop's open-item count
    # and the mod's core tab, so a gates row can never read green over a row Stop counts open.
    open_n = cg._open_work_count(transcript, root, session)
    ev_ok, ev_total = _plan_evidence(root, session)
    code_changed = _code_changed(cg, session, root)
    for letter in sorted(_LABELS):
        failing = team_failing if letter == "s" else letter in ev["failed"]
        detail = None
        if letter == "i":
            failing = failing or open_n > 0
            detail = f"{open_n} open" if open_n else None
        elif letter == "a":
            # Stop's own (a) applies once the run changed non-docs code; a read-only run whose plan rows carry
            # no evidence is not failing here (an amber row beside a Stop that allowed). The figure stays in the detail.
            failing = failing or (ev_ok < ev_total and code_changed)
            detail = f"{ev_ok} of {ev_total} done with evidence" if ev_total else None
        g["lines"].append(
            _line(
                letter,
                _LABELS[letter],
                not failing,
                detail,
                (cg._GISTS.get(letter) or _FIXES.get(letter)) if failing else None,
            )
        )
    return g


def _code_changed(cg, session: str, root: Path) -> bool:
    """True when this run changed non-docs code, as completion_gate_core.evaluate() decides it for (a)/(b).
    An unreadable record fails toward True (the strict reading)."""
    try:
        paths = list(cg._run_written_paths(session, root))
        paths += [p for p in cg._shell_changed_code(root, session) if p not in paths]
        return bool(cg._nondocs_changed(paths))
    except Exception:  # noqa: BLE001
        return True


def _plan_evidence(root: Path, session: str):
    try:
        import atlas_todo

        return atlas_todo.plan_evidence(atlas_todo.load(str(root)), session)
    except Exception:  # noqa: BLE001 -- an unreadable board is no evidence claim either way
        return 0, 0


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
            _line(
                "armed", "Team mode", True, "on" if armed else "off"
            )
        )
        g["lines"].append(
            _line(
                "inline",
                "Lead hands work to subagents",
                n < limit,
                f"{n} direct calls since the last dispatch, limit {limit}",
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


def _routed(root) -> bool:
    """True when native Read/Grep/Glob/Bash have a routed replacement here: the
    lean-ctx binary on PATH and a lean-ctx MCP server configured for `root` (the
    tripwire's own reachability test). Without one, a native call is the only
    route and not a routing miss; counting it made the band read "gates ✖" on
    every project without lean-ctx. root None keeps the strict count. Unreadable
    config fails toward counting."""
    if root is None:
        return True
    try:
        import shutil

        import dispatch_tripwire_core as dt

        return (
            bool(shutil.which("lean-ctx"))
            and dt._lean_ctx_server_key(Path(root)) is not None
        )
    except Exception:  # noqa: BLE001
        return True


def routing_group(session: str, root=None) -> dict:
    g = {"id": "routing", "title": "Tool routing", "lines": []}
    conn = _ro_conn()
    try:
        rows = conn.execute(
            "SELECT kind, server, tool_name, denied FROM tool_calls WHERE session_id=?",
            (session,),
        ).fetchall()
        agent = conn.execute(
            "SELECT agent FROM session_logs WHERE session_id=?", (session,)
        ).fetchone()
    finally:
        conn.close()
    # omp has no Read/Grep/Glob-equivalent shell policy for Bash (its bash is the primary
    # shell tool), so native Bash is not a routing miss there; other natives and denies count.
    native = _NATIVE if not agent or agent[0] != "omp" else _NATIVE[:-1]
    for name, keys in _CONTEXT_SERVERS:
        n = sum(1 for k, s, t, d in rows if k == "mcp" and (s or "").lower() in keys)
        g["lines"].append(_line(name, f"{name} calls", True, f"{n} {_ROUTING_NOTE}"))
    routed = _routed(root)
    for tool in native:
        n = sum(1 for k, s, t, d in rows if k == "builtin" and t == tool)
        detail = f"{n} {_ROUTING_NOTE}"
        if not routed:
            detail += "; lean-ctx is not configured here, so native is the route"
        g["lines"].append(
            _line(
                f"native-{tool}", f"Native {tool} calls", n == 0 or not routed, detail
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
        ("routing", "Tool routing", lambda: routing_group(session, root)),
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
