"""Read-only /api/v2/gates: the completion-gate lines for one session.

GET /api/v2/gates?session=<id>        lines for that session
GET /api/v2/gates?project=<abs root>  lines for the project's most recent
                                      orchestrating session (runs.orchestrating=1,
                                      set by atlas_db.mark_orchestrating)

The live agents payload carries no session id, so the project form resolves it
server-side. Evaluation is atlas_gates.completion_group, passed through as is.
"""

from __future__ import annotations

import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import atlas_gates  # noqa: E402
from atlas_dash_work import _err  # noqa: E402


def _first(conn, sql, args):
    return conn.execute(sql, args).fetchone()


def _session_row(conn, sid):
    """(root, transcript_path) for a known session, else None."""
    row = _first(
        conn,
        "SELECT COALESCE(p.root_path, sl.cwd), sl.transcript_path FROM session_logs sl "
        "LEFT JOIN projects p ON p.id = sl.project_id WHERE sl.session_id = ?",
        (sid,),
    )
    if row:
        return row[0] or "", row[1] or ""
    row = _first(
        conn,
        "SELECT p.root_path FROM runs r LEFT JOIN projects p ON p.id = r.project_id "
        "WHERE r.session_id = ? ORDER BY r.started_at DESC LIMIT 1",
        (sid,),
    )
    return (row[0] or "", "") if row else None


def h_gates(ctx):
    q = ctx.query
    sid = str(q.get("session") or "")
    project = str(q.get("project") or "")
    if not sid and not project:
        return _err(
            400,
            "session_or_project_required",
            "no session or project given",
            "pass ?session=<id> or ?project=<absolute root>",
        )
    conn = ctx.db()
    root_param = None
    if not sid:
        root_param = ctx.project_root(project)
        row = (
            _first(
                conn,
                "SELECT r.session_id FROM runs r JOIN projects p ON p.id = r.project_id "
                "WHERE r.orchestrating = 1 AND r.session_id IS NOT NULL "
                "AND p.root_path = ? ORDER BY r.started_at DESC LIMIT 1",
                (root_param,),
            )
            if root_param
            else None
        )
        if not row:
            return _err(
                404,
                "no_session_for_project",
                f"no orchestrating session for {project!r}",
                "run atlas in that project first",
            )
        sid = row[0]
    found = _session_row(conn, sid)
    if not found:
        return _err(404, "session_not_found", f"{sid!r} has no row", "check the id")
    root, transcript = found
    group = atlas_gates.completion_group(sid, Path(root_param or root or "."), transcript)
    out = {"ok": True, "session": sid, "project": root_param, "lines": group.get("lines", [])}
    if "error" in group:
        out["error"] = group["error"]
    return 200, out


ROUTES = [("GET", r"/api/v2/gates", h_gates)]
