#!/usr/bin/env python3
"""Atlas multi-session local dashboard.

One shared loopback daemon for all concurrent coding-agent terminals.
SessionStart ensures it is up and injects the URL; it does not open a browser
per terminal.

  python3 atlas_dashboard.py ensure|serve|status|stop|url

UI:  http://127.0.0.1:7421/
"""

from __future__ import annotations

import argparse
import atexit
import json
import os
import re
import signal
import socket
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse, unquote

SCRIPTS_DIR = Path(__file__).resolve().parent
PLUGIN_ROOT = SCRIPTS_DIR.parent
sys.path.insert(0, str(SCRIPTS_DIR))

import atlas_db  # noqa: E402

DEFAULT_PORT = int(os.environ.get("ATLAS_DASHBOARD_PORT", "7421"))
LOOPBACK = ".".join(["127", "0", "0", "1"])
STATE_DIR = Path(os.environ.get("ATLAS_HOME") or Path.home() / ".atlas")
PID_PATH = STATE_DIR / "dashboard.pid"
LOG_PATH = STATE_DIR / "dashboard.log"
CANONICAL_DB = STATE_DIR / "atlas.db"
# Local markers for secrets saved via the dashboard (values NOT stored here).
# Claude keeps sensitive userConfig in OS secure storage; settings.json often
# only retains non-sensitive fields, so the UI needs another set-signal.
CRED_MARKS_PATH = STATE_DIR / "credential_marks.json"

# Live = real tool/event activity inside this window only.
LIVE_WINDOW_S = 10 * 60
# Dropdowns only show work inside this horizon by default.
RECENT_PROJECT_S = 14 * 24 * 3600
RECENT_SESSION_S = 7 * 24 * 3600
MAX_PROJECTS = 40
MAX_SESSIONS = 40


def dashboard_db_path() -> str:
    override = os.environ.get("ATLAS_DASHBOARD_DB")
    if override:
        return os.path.expanduser(override)
    return str(CANONICAL_DB)


def _db():
    path = dashboard_db_path()
    os.environ["ATLAS_DB"] = path
    conn = atlas_db.connect(path)
    atlas_db.init(conn)
    return conn, path


def _q(conn, sql, args=(), one=False):
    cur = conn.execute(sql, args)
    cols = [c[0] for c in cur.description] if cur.description else []
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    return rows[0] if one and rows else (rows if not one else None)


def _folder_name(path: str | None) -> str | None:
    if not path:
        return None
    p = str(path).rstrip("/").rstrip("\\")
    if not p:
        return None
    return os.path.basename(p) or None


def _is_generic_folder(name: str | None) -> bool:
    if not name:
        return True
    home = os.path.basename(os.path.expanduser("~"))
    return name.lower() in {
        ".",
        "users",
        "home",
        home.lower(),
        "tmp",
        "var",
        "private",
        "downloads",
        "documents",
        "desktop",
        "outputs",
    }


def _best_folder(session: dict) -> str:
    candidates = [
        _folder_name(session.get("cwd")),
        session.get("project_name"),
        _folder_name(session.get("project_root")),
    ]
    for c in candidates:
        if c and not _is_generic_folder(c):
            return c
    if any(c and _is_generic_folder(c) for c in candidates):
        # Prefer a clearer home label over username.
        return "home"
    for c in candidates:
        if c:
            return c
    return "unknown-project"


def _ago(ts: float | None) -> str:
    if not ts:
        return ""
    s = max(0, time.time() - float(ts))
    if s < 60:
        return "%ds ago" % int(s)
    if s < 3600:
        return "%dm ago" % int(s / 60)
    if s < 86400:
        return "%dh ago" % int(s / 3600)
    return "%dd ago" % int(s / 86400)


def _label_for(session: dict) -> str:
    folder = _best_folder(session)
    sid = (session.get("session_id") or "")[:8]
    live = "LIVE · " if session.get("is_live") else ""
    branch = session.get("git_branch")
    branch_bit = f" · {branch}" if branch else ""
    age = _ago(session.get("last_activity_at") or session.get("started_at"))
    age_bit = f" · {age}" if age else ""
    return f"{live}{folder}{branch_bit}{age_bit} · {sid}"


def _plugin_manifest():
    path = PLUGIN_ROOT / ".claude-plugin" / "plugin.json"
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _mcp_json():
    path = PLUGIN_ROOT / ".mcp.json"
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _settings_path() -> Path:
    return Path.home() / ".claude" / "settings.json"


def _plugin_config_options() -> dict:
    """Claude Code stores plugin userConfig under settings.json pluginConfigs."""
    path = _settings_path()
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    pc = data.get("pluginConfigs") or {}
    # Prefer marketplace-qualified key; fall back to bare name.
    for key in ("atlas@tech-tools", "atlas"):
        block = pc.get(key)
        if isinstance(block, dict):
            opts = block.get("options")
            if isinstance(opts, dict):
                return opts
    return {}


def _env_example_keys():
    path = PLUGIN_ROOT / ".env.example"
    keys = []
    if not path.is_file():
        return keys
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        keys.append(line.split("=", 1)[0].strip())
    return keys


def _env_candidate_paths() -> list:
    """Plugin .env path for this plugin root only.

    PLUGIN_ROOT is derived from this script's location. In the marketplace
    source tree that is `plugins/atlas/`. In a consumer install Claude sets
    CLAUDE_PLUGIN_ROOT to the installed copy — still one root, never a
    hardcoded ~/.claude/plugins/cache path list. Agents developing this
    marketplace must not write install caches.
    """
    return [PLUGIN_ROOT / ".env"]


def _parse_env_keys(path: Path) -> set:
    present = set()
    if not path.is_file():
        return present
    try:
        text = path.read_text(encoding="utf-8")
    except Exception:
        return present
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        if v.strip().strip('"').strip("'"):
            present.add(k.strip())
    return present


def _env_file_present_keys() -> set:
    present: set = set()
    for path in _env_candidate_paths():
        present |= _parse_env_keys(path)
    return present


def _load_cred_marks() -> dict:
    if not CRED_MARKS_PATH.is_file():
        return {}
    try:
        data = json.loads(CRED_MARKS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_cred_marks(updates_keys: list[str]) -> None:
    """Record that keys were saved (no secret values)."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    marks = _load_cred_marks()
    now = time.time()
    for k in updates_keys:
        marks[k] = {"saved_at": now, "source": "dashboard"}
    CRED_MARKS_PATH.write_text(json.dumps(marks, indent=2) + "\n", encoding="utf-8")


def _key_is_set(user_config_key: str | None, env_key: str | None, opts: dict, env_present: set, marks: dict) -> tuple[bool, str]:
    """Return (is_set, source)."""
    if user_config_key and opts.get(user_config_key) not in (None, ""):
        return True, "pluginConfigs"
    # env UPPER forms
    candidates = []
    if env_key:
        candidates.append(env_key)
    if user_config_key:
        candidates.append(user_config_key.upper())
        candidates.append(user_config_key)
    for c in candidates:
        if c in env_present:
            return True, "env"
    # marks from prior dashboard saves (Claude may strip secrets from settings.json)
    for c in candidates + ([user_config_key] if user_config_key else []):
        if c and c in marks:
            return True, "dashboard_mark"
    return False, "missing"


def _user_config_schema():
    manifest = _plugin_manifest()
    uc = manifest.get("userConfig") or {}
    out = []
    opts = _plugin_config_options()
    env_present = _env_file_present_keys()
    marks = _load_cred_marks()
    for key, meta in uc.items():
        if not isinstance(meta, dict):
            continue
        is_set, source = _key_is_set(key, key.upper(), opts, env_present, marks)
        out.append(
            {
                "key": key,
                "title": meta.get("title") or key,
                "description": meta.get("description") or "",
                "sensitive": bool(meta.get("sensitive")),
                "required": bool(meta.get("required")),
                "default": meta.get("default", ""),
                "is_set": is_set,
                "source": source,
            }
        )
    return out


def _connector_status():
    """Group userConfig fields by MCP connector for the Settings UI."""
    manifest = _plugin_manifest()
    mcp = _mcp_json()
    user_config = manifest.get("userConfig") or {}
    servers = mcp.get("mcpServers") or {}
    opts = _plugin_config_options()
    env_present = _env_file_present_keys()
    marks = _load_cred_marks()
    out = []
    for name, cfg in servers.items():
        bundle = PLUGIN_ROOT / "mcp" / name / "server.mjs"
        env_map = cfg.get("env") or {}
        # user_config refs in ${user_config.foo}
        uc_refs = []
        for v in env_map.values():
            if isinstance(v, str):
                for m in re.finditer(r"\$\{user_config\.([a-z0-9_]+)\}", v):
                    if m.group(1) not in uc_refs:
                        uc_refs.append(m.group(1))
        # also CFG_* keys as env fallbacks
        cfg_env = [k[4:] for k in env_map if isinstance(k, str) and k.startswith("CFG_")]
        fields = []
        for uk in uc_refs:
            meta = user_config.get(uk) or {}
            is_set, source = _key_is_set(uk, uk.upper(), opts, env_present, marks)
            fields.append(
                {
                    "user_config_key": uk,
                    "env_key": uk.upper(),
                    "title": (meta.get("title") if isinstance(meta, dict) else None) or uk,
                    "description": (meta.get("description") if isinstance(meta, dict) else "")
                    or "",
                    "sensitive": bool(meta.get("sensitive"))
                    if isinstance(meta, dict)
                    else any(s in uk.lower() for s in ("key", "secret", "token", "password")),
                    "is_set": is_set,
                    "source": source,
                }
            )
        # env-only extras not in userConfig
        for ek in cfg_env:
            if any(f["env_key"] == ek or (f.get("user_config_key") or "").lower() == ek.lower() for f in fields):
                continue
            is_set, source = _key_is_set(None, ek, opts, env_present, marks)
            fields.append(
                {
                    "user_config_key": None,
                    "env_key": ek,
                    "title": ek,
                    "description": "Legacy .env key (also accepted)",
                    "sensitive": any(
                        s in ek for s in ("KEY", "SECRET", "TOKEN", "PASSWORD", "PRIVATE")
                    ),
                    "is_set": is_set,
                    "source": source,
                }
            )
        required_uc = [
            f
            for f in fields
            if f.get("user_config_key")
            and (user_config.get(f["user_config_key"]) or {}).get("required")
        ]
        configured = bool(fields) and all(
            f["is_set"]
            for f in fields
            if f.get("user_config_key")
            and not str(f.get("user_config_key")).endswith(("_region", "_base_url", "_url", "_platform", "_auth_mode", "_sandbox", "_organization_id"))
            and "base_url" not in str(f.get("user_config_key"))
            and "region" not in str(f.get("user_config_key"))
        )
        # softer: configured if any secret-ish field set
        if not configured:
            configured = any(
                f["is_set"] and f.get("sensitive") for f in fields
            )
        out.append(
            {
                "name": name,
                "bundle_exists": bundle.is_file(),
                "bundle_bytes": bundle.stat().st_size if bundle.is_file() else 0,
                "user_config_fields": uc_refs,
                "fields": fields,
                "configured_hint": configured,
                "missing_required": [
                    f["user_config_key"] for f in required_uc if not f["is_set"]
                ],
            }
        )
    return out


def _annotate_live(conn, sessions: list) -> list:
    now = time.time()
    for s in sessions:
        sid = s.get("session_id")
        recent_tools = 0
        recent_events = 0
        last_tool = None
        last_event = None
        if sid:
            row = (
                _q(
                    conn,
                    "SELECT COUNT(*) AS n, MAX(ts) AS last_ts FROM tool_calls "
                    "WHERE session_id=? AND ts > ?",
                    (sid, now - LIVE_WINDOW_S),
                    one=True,
                )
                or {}
            )
            recent_tools = row.get("n") or 0
            last_tool = row.get("last_ts")
            row = (
                _q(
                    conn,
                    """
                    SELECT COUNT(*) AS n, MAX(e.ts) AS last_ts
                    FROM events e JOIN runs r ON r.id=e.run_id
                    WHERE r.session_id=? AND e.ts > ?
                    """,
                    (sid, now - LIVE_WINDOW_S),
                    one=True,
                )
                or {}
            )
            recent_events = row.get("n") or 0
            last_event = row.get("last_ts")
            # absolute last activity for age display
            abs_last = (
                _q(
                    conn,
                    "SELECT MAX(ts) AS t FROM tool_calls WHERE session_id=?",
                    (sid,),
                    one=True,
                )
                or {}
            ).get("t")
        else:
            abs_last = None

        ended = s.get("ended_at")
        # Strict LIVE: only recent tool/event activity. Never mark ended-only
        # historical rows live, and never treat "open run with no activity" as live
        # beyond a short grace after start.
        last_activity = max(
            [t for t in (last_tool, last_event, abs_last, s.get("started_at")) if t],
            default=None,
        )
        s["last_activity_at"] = last_activity
        s["recent_tool_calls"] = recent_tools
        s["recent_events"] = recent_events
        s["is_live"] = bool(
            (not ended or (last_activity and last_activity > float(ended or 0)))
            and (recent_tools or recent_events)
        )
        # If session ended and no post-end activity, force not live.
        if ended and (not last_activity or float(last_activity) <= float(ended) + 1):
            s["is_live"] = False
        s["project_folder"] = _best_folder(s)
        s["label"] = _label_for(s)
        s["age"] = _ago(last_activity or s.get("started_at"))

    sessions.sort(
        key=lambda x: (
            0 if x.get("is_live") else 1,
            -(x.get("last_activity_at") or x.get("started_at") or 0),
        )
    )
    return sessions


def _projects(conn, recent_only=True):
    now = time.time()
    # Prefer projects with recent runs/session activity.
    rows = _q(
        conn,
        """
        SELECT p.id, p.root_path, p.name, p.stack, p.first_seen, p.last_seen,
               COUNT(DISTINCT r.id) AS run_count,
               MAX(r.started_at) AS last_run_at
        FROM projects p
        LEFT JOIN runs r ON r.project_id = p.id
        GROUP BY p.id
        ORDER BY COALESCE(MAX(r.started_at), p.last_seen, 0) DESC
        """,
    )
    out = []
    for r in rows:
        folder = r.get("name") or _folder_name(r.get("root_path"))
        if _is_generic_folder(folder) and _folder_name(r.get("root_path")):
            # still allow home but deprioritize
            folder = _folder_name(r.get("root_path")) or folder
        last = r.get("last_run_at") or r.get("last_seen") or 0
        if recent_only and last and (now - float(last)) > RECENT_PROJECT_S:
            continue
        if recent_only and _is_generic_folder(folder) and (r.get("run_count") or 0) < 3:
            continue
        r["folder"] = folder if not _is_generic_folder(folder) else (
            "home" if folder and folder.lower() == os.path.basename(os.path.expanduser("~")).lower() else folder
        )
        if _is_generic_folder(r.get("name")) and r["folder"] == os.path.basename(os.path.expanduser("~")):
            r["folder"] = "home"
        if r.get("name") == os.path.basename(os.path.expanduser("~")):
            r["folder"] = "home"
        r["label"] = f"{r['folder']} ({r.get('run_count') or 0})"
        r["age"] = _ago(last)
        out.append(r)
        if len(out) >= MAX_PROJECTS:
            break
    return out


def _sessions(conn, project_id=None, limit=MAX_SESSIONS, recent_only=True):
    args: list = []
    where_bits = []
    if project_id is not None:
        where_bits.append("COALESCE(sl.project_id, r.project_id) = ?")
        args.append(project_id)
    if recent_only:
        where_bits.append("COALESCE(sl.started_at, r.started_at, 0) > ?")
        args.append(time.time() - RECENT_SESSION_S)
    where = ("WHERE " + " AND ".join(where_bits)) if where_bits else ""
    args.append(limit)
    rows = _q(
        conn,
        f"""
        SELECT
          COALESCE(sl.session_id, r.session_id) AS session_id,
          COALESCE(sl.project_id, r.project_id) AS project_id,
          p.name AS project_name,
          p.root_path AS project_root,
          COALESCE(sl.cwd, p.root_path) AS cwd,
          sl.git_branch,
          COALESCE(sl.model, r.model) AS model,
          COALESCE(sl.agent, 'claude') AS agent,
          COALESCE(sl.started_at, r.started_at) AS started_at,
          COALESCE(sl.ended_at, r.ended_at) AS ended_at,
          sl.message_count, sl.user_prompt_count, sl.tool_call_count, sl.error_count,
          sl.input_tokens, sl.output_tokens, sl.cache_read_tokens,
          r.id AS run_id, r.orchestrating, r.kind AS run_kind, r.task_summary,
          m.inline_ops, m.dispatches, m.parallel_waves, m.verifier_coverage,
          m.est_context_tokens, m.recall_hits, m.recall_misses,
          f.brief_summary, f.outcome, f.gate_block_count, f.correction_count
        FROM (
          SELECT session_id FROM session_logs
          UNION
          SELECT session_id FROM runs WHERE session_id IS NOT NULL AND length(session_id) > 8
        ) s
        LEFT JOIN session_logs sl ON sl.session_id = s.session_id
        LEFT JOIN runs r ON r.id = (
          SELECT id FROM runs WHERE session_id = s.session_id
          ORDER BY started_at DESC LIMIT 1
        )
        LEFT JOIN projects p ON p.id = COALESCE(sl.project_id, r.project_id)
        LEFT JOIN metrics m ON m.run_id = r.id
        LEFT JOIN facets f ON f.session_id = s.session_id
        {where}
        ORDER BY COALESCE(sl.started_at, r.started_at, 0) DESC
        LIMIT ?
        """,
        tuple(args),
    )
    # Drop runs-only noise under home with no session_logs and no tools
    cleaned = []
    for row in rows:
        if not row.get("session_id"):
            continue
        cleaned.append(row)
    return _annotate_live(conn, cleaned)


def _session_detail(conn, session_id: str):
    session = _q(
        conn,
        """
        SELECT sl.*, p.name AS project_name, p.root_path AS project_root,
               r.id AS run_id, r.orchestrating, r.kind AS run_kind, r.task_summary,
               m.inline_ops, m.dispatches, m.parallel_waves, m.verifier_coverage,
               m.est_context_tokens, m.recall_hits, m.recall_misses,
               f.brief_summary, f.outcome, f.gate_block_count, f.correction_count,
               f.primary_success, f.friction_detail
        FROM session_logs sl
        LEFT JOIN projects p ON p.id = sl.project_id
        LEFT JOIN runs r ON r.id = (
          SELECT id FROM runs WHERE session_id = sl.session_id
          ORDER BY started_at DESC LIMIT 1
        )
        LEFT JOIN metrics m ON m.run_id = r.id
        LEFT JOIN facets f ON f.session_id = sl.session_id
        WHERE sl.session_id = ?
        """,
        (session_id,),
        one=True,
    )
    if not session:
        session = _q(
            conn,
            """
            SELECT r.session_id, r.project_id, p.name AS project_name, p.root_path AS project_root,
                   p.root_path AS cwd,
                   r.id AS run_id, r.orchestrating, r.kind AS run_kind, r.task_summary,
                   r.started_at, r.ended_at, r.model,
                   m.inline_ops, m.dispatches, m.parallel_waves, m.verifier_coverage,
                   m.est_context_tokens, m.recall_hits, m.recall_misses
            FROM runs r
            LEFT JOIN projects p ON p.id = r.project_id
            LEFT JOIN metrics m ON m.run_id = r.id
            WHERE r.session_id = ?
            ORDER BY r.started_at DESC LIMIT 1
            """,
            (session_id,),
            one=True,
        )
    if session:
        session = _annotate_live(conn, [session])[0]
    tools = _q(
        conn,
        """
        SELECT tool_name, kind, target, server, is_error, ts, input_summary, result_bytes
        FROM tool_calls WHERE session_id=? ORDER BY ts DESC LIMIT 100
        """,
        (session_id,),
    )
    prompts = _q(
        conn,
        """
        SELECT ts, char_len,
               CASE WHEN length(text) > 280 THEN substr(text,1,280) || '…' ELSE text END AS text
        FROM user_prompts WHERE session_id=? ORDER BY ts DESC LIMIT 30
        """,
        (session_id,),
    )
    events = _q(
        conn,
        """
        SELECT e.ts, e.tool, e.context, e.is_inline_op, e.path
        FROM events e JOIN runs r ON r.id=e.run_id
        WHERE r.session_id=? ORDER BY e.ts DESC LIMIT 80
        """,
        (session_id,),
    )
    dispatches = _q(
        conn,
        """
        SELECT d.ts, d.agent_type, d.model, d.wave_id
        FROM dispatches d JOIN runs r ON r.id=d.run_id
        WHERE r.session_id=? ORDER BY d.ts DESC LIMIT 50
        """,
        (session_id,),
    )
    return {
        "session": session,
        "tools": tools,
        "prompts": prompts,
        "events": events,
        "dispatches": dispatches,
    }


def _run_health(conn, limit=20, project_id=None):
    args: list = []
    where = ""
    if project_id is not None:
        where = "WHERE r.project_id = ?"
        args.append(project_id)
    args.append(limit)
    recent = _q(
        conn,
        f"""
        SELECT r.id, r.session_id, r.project_id, p.name AS project_name, p.root_path,
               r.started_at, r.ended_at, r.wall_clock_s,
               r.task_summary, r.model, r.kind, r.orchestrating, r.used_worktrees,
               m.inline_ops, m.dispatches, m.parallel_waves, m.verifier_coverage,
               m.est_context_tokens, m.recall_hits, m.recall_misses
        FROM runs r
        LEFT JOIN projects p ON p.id = r.project_id
        LEFT JOIN metrics m ON m.run_id = r.id
        {where}
        ORDER BY r.started_at DESC
        LIMIT ?
        """,
        tuple(args),
    )
    totals = _q(
        conn,
        """
        SELECT
          COUNT(*) AS runs,
          SUM(CASE WHEN orchestrating=1 THEN 1 ELSE 0 END) AS orchestrating_runs,
          AVG(m.verifier_coverage) AS avg_verifier_coverage,
          SUM(COALESCE(m.inline_ops,0)) AS sum_inline_ops,
          SUM(COALESCE(m.dispatches,0)) AS sum_dispatches,
          SUM(COALESCE(m.est_context_tokens,0)) AS sum_est_context_tokens
        FROM runs r
        LEFT JOIN metrics m ON m.run_id = r.id
        """,
        one=True,
    ) or {}
    open_findings = _q(
        conn, "SELECT COUNT(*) AS n FROM findings WHERE status='open'", one=True
    )
    now = time.time()
    live_tools = (
        _q(
            conn,
            "SELECT COUNT(*) AS n FROM tool_calls WHERE ts > ?",
            (now - LIVE_WINDOW_S,),
            one=True,
        )
        or {}
    ).get("n", 0)
    live_events = (
        _q(
            conn,
            "SELECT COUNT(*) AS n FROM events WHERE ts > ?",
            (now - LIVE_WINDOW_S,),
            one=True,
        )
        or {}
    ).get("n", 0)
    return {
        "totals": totals,
        "open_findings": (open_findings or {}).get("n", 0),
        "recent_runs": recent,
        "activity_last_10m": {"tool_calls": live_tools, "events": live_events},
        "server_time": now,
    }


def _savings_estimate(conn):
    row = (
        _q(
            conn,
            """
        SELECT
          SUM(COALESCE(m.dispatches,0)) AS dispatches,
          SUM(COALESCE(m.inline_ops,0)) AS inline_ops,
          SUM(COALESCE(m.parallel_waves,0)) AS parallel_waves,
          SUM(COALESCE(m.est_context_tokens,0)) AS est_context_tokens,
          SUM(COALESCE(m.recall_hits,0)) AS recall_hits,
          SUM(COALESCE(m.recall_misses,0)) AS recall_misses,
          AVG(m.verifier_coverage) AS avg_verifier_coverage
        FROM metrics m
        """,
            one=True,
        )
        or {}
    )
    dispatches = row.get("dispatches") or 0
    inline = row.get("inline_ops") or 0
    hits = row.get("recall_hits") or 0
    misses = row.get("recall_misses") or 0
    return {
        "note": "Proxies from atlas.db metrics - not vendor token invoices.",
        "dispatches": dispatches,
        "inline_ops": inline,
        "dispatch_ratio": (dispatches / inline) if inline else None,
        "parallel_waves": row.get("parallel_waves") or 0,
        "est_context_tokens": row.get("est_context_tokens") or 0,
        "recall_hits": hits,
        "recall_misses": misses,
        "recall_hit_rate": (hits / (hits + misses)) if (hits + misses) else None,
        "avg_verifier_coverage": row.get("avg_verifier_coverage"),
    }


def _findings(conn, limit=40):
    return _q(
        conn,
        """
        SELECT id, created_at, dimension, severity, title, detail, status,
               proposed_action, target_path
        FROM findings ORDER BY created_at DESC LIMIT ?
        """,
        (limit,),
    )


def snapshot(project_id=None):
    conn, dbpath = _db()
    try:
        manifest = _plugin_manifest()
        sessions = _sessions(conn, project_id=project_id, limit=MAX_SESSIONS, recent_only=True)
        return {
            "ok": True,
            "generated_at": time.time(),
            "url": dashboard_url(),
            "db_path": dbpath,
            "plugin": {
                "name": manifest.get("name"),
                "version": manifest.get("version"),
                "root": str(PLUGIN_ROOT),
            },
            "projects": _projects(conn, recent_only=True),
            "sessions": sessions,
            "live_sessions": [s for s in sessions if s.get("is_live")],
            "health": _run_health(conn, project_id=project_id),
            "savings": _savings_estimate(conn),
            "connectors": _connector_status(),
            "user_config": _user_config_schema(),
            "settings_path": str(_settings_path()),
            "findings": _findings(conn),
            "ui_hints": {
                "live_window_s": LIVE_WINDOW_S,
                "recent_sessions_days": RECENT_SESSION_S // 86400,
                "recent_projects_days": RECENT_PROJECT_S // 86400,
                "note": "LIVE means tool/event activity in the last 10 minutes only. Credentials save to ~/.claude/settings.json pluginConfigs (Claude Code source of truth).",
            },
        }
    finally:
        conn.close()


def write_settings_updates(updates: dict):
    """Write connector credentials to Claude pluginConfigs options.

    `updates` keys are userConfig keys (e.g. auvik_api_key) OR UPPER_ENV keys.
    """
    manifest = _plugin_manifest()
    uc = manifest.get("userConfig") or {}
    allowed_uc = set(uc.keys())
    # Map ENV-style to user_config
    env_to_uc = {k.upper(): k for k in allowed_uc}
    # also allow exact env keys from .env.example for dual-write
    allowed_env = set(_env_example_keys())

    normalized = {}
    env_updates = {}
    bad = []
    for k, v in updates.items():
        if not isinstance(v, str):
            v = str(v)
        v = v.replace("\n", "").replace("\r", "")
        if k in allowed_uc:
            normalized[k] = v
            env_updates[k.upper()] = v
        elif k in env_to_uc:
            normalized[env_to_uc[k]] = v
            env_updates[k] = v
        elif k in allowed_env:
            env_updates[k] = v
            # best-effort map to userConfig
            low = k.lower()
            if low in allowed_uc:
                normalized[low] = v
        else:
            bad.append(k)
    if bad:
        return {"ok": False, "error": "keys_not_allowlisted", "keys": bad}
    if not normalized and not env_updates:
        return {"ok": False, "error": "no_valid_updates"}

    settings_path = _settings_path()
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        data = json.loads(settings_path.read_text(encoding="utf-8")) if settings_path.is_file() else {}
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    pc = data.setdefault("pluginConfigs", {})
    block = pc.get("atlas@tech-tools")
    if not isinstance(block, dict):
        block = {}
        pc["atlas@tech-tools"] = block
    opts = block.get("options")
    if not isinstance(opts, dict):
        opts = {}
        block["options"] = opts
    for k, v in normalized.items():
        if v == "":
            opts.pop(k, None)
        else:
            opts[k] = v
    settings_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

    # Dual-write allowlisted env keys for local stdio servers that read .env
    env_result = None
    if env_updates:
        env_result = _write_env_file(env_updates)

    # Persist set-markers so UI still shows "set" after Claude strips secrets
    # from plain settings.json into OS secure storage.
    mark_keys = sorted(set(list(normalized.keys()) + list(env_updates.keys())))
    try:
        _save_cred_marks(mark_keys)
    except Exception:
        pass

    return {
        "ok": True,
        "updated_user_config_keys": sorted(normalized.keys()),
        "updated_env_keys": sorted((env_result or {}).get("updated_keys") or []),
        "env_paths": (env_result or {}).get("paths") or [],
        "settings_path": str(settings_path),
        "note": "Saved to pluginConfigs + plugin .env. Sensitive values may move into Claude secure storage; this UI keeps a local set-marker (not the secret). Reload Claude Code so MCP servers re-read credentials.",
    }


def _merge_env_file(path: Path, updates: dict) -> None:
    existing = {}
    order = []
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip() or line.strip().startswith("#") or "=" not in line:
                order.append(("raw", line))
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            existing[k] = v
            order.append(("kv", k))
    for k, v in updates.items():
        existing[k] = v
        if not any(kind == "kv" and key == k for kind, key in order):
            order.append(("kv", k))
    lines = []
    seen = set()
    for kind, key in order:
        if kind == "raw":
            lines.append(key)
        else:
            if key in seen:
                continue
            seen.add(key)
            lines.append(f"{key}={existing.get(key, '')}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _write_env_file(updates: dict):
    allowed = set(_env_example_keys())
    # allow userConfig UPPER names too
    for k in (_plugin_manifest().get("userConfig") or {}):
        allowed.add(k.upper())
        allowed.add(k)
    for c in _connector_status():
        for f in c.get("fields") or []:
            if f.get("env_key"):
                allowed.add(f["env_key"])
            if f.get("user_config_key"):
                allowed.add(f["user_config_key"].upper())
    bad = [k for k in updates if k not in allowed]
    if bad:
        return {"ok": False, "error": "keys_not_allowlisted", "keys": bad}
    path = PLUGIN_ROOT / ".env"
    _merge_env_file(path, updates)
    return {
        "ok": True,
        "updated_keys": sorted(updates.keys()),
        "paths": [str(path)],
    }


# keep old name for tests
def write_env_updates(updates: dict):
    # Prefer settings.json userConfig mapping
    return write_settings_updates(updates)


# --- singleton daemon -------------------------------------------------------

def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _port_open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.35):
            return True
    except OSError:
        return False


def _read_pidfile():
    if not PID_PATH.is_file():
        return None
    try:
        return json.loads(PID_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_pidfile(pid: int, port: int, db_path: str):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    PID_PATH.write_text(
        json.dumps(
            {
                "pid": pid,
                "port": port,
                "host": LOOPBACK,
                "db_path": db_path,
                "started_at": time.time(),
                "script": str(Path(__file__).resolve()),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def _clear_pidfile():
    try:
        PID_PATH.unlink(missing_ok=True)
    except Exception:
        pass


def dashboard_url(port: int | None = None) -> str:
    return f"http://{LOOPBACK}:{port or DEFAULT_PORT}/"


def _health_payload(port: int) -> dict | None:
    try:
        import urllib.request

        with urllib.request.urlopen(
            f"http://{LOOPBACK}:{port}/api/health", timeout=0.8
        ) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def _daemon_db_ok(port: int) -> bool:
    try:
        import urllib.request

        with urllib.request.urlopen(
            f"http://{LOOPBACK}:{port}/api/health", timeout=1.0
        ) as r:
            data = json.loads(r.read().decode())
        served = os.path.realpath(data.get("db_path") or "")
        want = os.path.realpath(dashboard_db_path())
        return bool(served) and served == want
    except Exception:
        return False


def stop_daemon() -> dict:
    info = _read_pidfile() or {}
    pid = int(info.get("pid") or 0)
    port = int(info.get("port") or DEFAULT_PORT)
    stopped = False
    if pid and _pid_alive(pid):
        try:
            os.kill(pid, signal.SIGTERM)
            stopped = True
        except OSError as e:
            return {"ok": False, "error": str(e)}
    if _port_open(LOOPBACK, port):
        try:
            out = subprocess.check_output(
                ["lsof", "-ti", f"tcp:{port}"], text=True
            ).strip()
            for p in out.splitlines():
                try:
                    os.kill(int(p), signal.SIGTERM)
                    stopped = True
                except Exception:
                    pass
        except Exception:
            pass
    time.sleep(0.15)
    _clear_pidfile()
    return {"ok": True, "stopped": stopped, "pid": pid or None, "port": port}


def ensure_daemon(port: int | None = None) -> dict:
    port = port or DEFAULT_PORT
    url = dashboard_url(port)
    want_db = dashboard_db_path()

    if _port_open(LOOPBACK, port):
        if _daemon_db_ok(port):
            h = _health_payload(port) or {}
            return {
                "ok": True,
                "already_running": True,
                "url": url,
                "pid": h.get("pid"),
                "port": port,
                "db_path": want_db,
            }
        stop_daemon()
        time.sleep(0.25)

    STATE_DIR.mkdir(parents=True, exist_ok=True)
    logf = open(LOG_PATH, "a", encoding="utf-8")
    env = os.environ.copy()
    env.pop("ATLAS_DB", None)
    env["ATLAS_DASHBOARD_PORT"] = str(port)
    env["ATLAS_DASHBOARD_DB"] = want_db
    env["ATLAS_DB"] = want_db
    proc = subprocess.Popen(
        [
            sys.executable,
            str(Path(__file__).resolve()),
            "serve",
            "--host",
            LOOPBACK,
            "--port",
            str(port),
            "--foreground",
        ],
        stdout=logf,
        stderr=logf,
        start_new_session=True,
        env=env,
    )
    for _ in range(60):
        if _port_open(LOOPBACK, port) and _daemon_db_ok(port):
            _write_pidfile(proc.pid, port, want_db)
            return {
                "ok": True,
                "already_running": False,
                "url": url,
                "pid": proc.pid,
                "port": port,
                "db_path": want_db,
            }
        time.sleep(0.05)
    return {
        "ok": False,
        "error": "daemon_did_not_bind_or_wrong_db",
        "pid": proc.pid,
        "port": port,
        "log": str(LOG_PATH),
        "db_path": want_db,
    }


UI_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Atlas Command Center</title>
<link rel="icon" href="/assets/mark.svg"/>
<style>
:root{
  --bg0:#070b14; --bg1:#0d1524; --bg2:#121c2e; --panel:#152036; --panel2:#1a2740;
  --line:#2a3b5c; --line2:#3a5178; --text:#eaf0ff; --muted:#91a0c0; --faint:#617089;
  --accent:#4f8cff; --accent2:#7aa2ff; --cyan:#3de0d0; --good:#3ddc97; --warn:#ffc857; --bad:#ff6b7a;
  --gold:#e6b84d; --violet:#9b7bff; --shadow:0 18px 50px rgba(0,0,0,.45);
  --r:16px; --r2:12px; --font:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0; font:14px/1.45 var(--font); color:var(--text);
  background:
    radial-gradient(1200px 700px at 10% -10%, rgba(79,140,255,.18), transparent 55%),
    radial-gradient(900px 500px at 90% 0%, rgba(61,224,208,.10), transparent 50%),
    radial-gradient(800px 600px at 50% 120%, rgba(155,123,255,.08), transparent 45%),
    linear-gradient(180deg, var(--bg0), var(--bg1) 40%, var(--bg0));
  background-attachment:fixed;
}
a{color:var(--accent2); text-decoration:none}
button,input,select,textarea{
  font:inherit; color:var(--text); background:var(--panel2);
  border:1px solid var(--line); border-radius:12px; padding:9px 12px;
}
button{cursor:pointer; transition:border-color .15s, background .15s, transform .1s}
button:hover{border-color:var(--accent); background:#1e2f4d}
button:active{transform:translateY(1px)}
button.primary{background:linear-gradient(180deg,#2b63c7,#1d4a9a); border-color:#4f8cff; font-weight:650}
button.primary:hover{filter:brightness(1.08)}
button.ghost{background:transparent}
button.iconbtn{padding:8px; width:36px; height:36px; display:inline-grid; place-items:center}
input:focus,select:focus,button:focus{outline:2px solid rgba(79,140,255,.35); outline-offset:1px}
.mono{font-family:var(--mono); font-size:12px}
.muted{color:var(--muted)} .faint{color:var(--faint)}
.good{color:var(--good)} .warn{color:var(--warn)} .bad{color:var(--bad)}
.hidden{display:none !important}

.app{display:grid; grid-template-columns:248px 1fr; min-height:100vh}
@media(max-width:980px){.app{grid-template-columns:1fr}}

/* Sidebar */
.side{
  position:sticky; top:0; height:100vh; padding:18px 14px;
  border-right:1px solid rgba(42,59,92,.8);
  background:linear-gradient(180deg, rgba(13,21,36,.92), rgba(7,11,20,.88));
  backdrop-filter:blur(14px);
  display:flex; flex-direction:column; gap:16px;
}
@media(max-width:980px){
  .side{position:relative; height:auto; border-right:0; border-bottom:1px solid var(--line)}
}
.brand{display:flex; gap:12px; align-items:center; padding:4px 6px}
.brand img, .brand .mark{
  width:42px; height:42px; border-radius:12px;
  box-shadow:0 0 0 1px rgba(79,140,255,.35), 0 8px 24px rgba(79,140,255,.2);
}
.brand .titles b{display:block; font-size:15px; letter-spacing:.02em}
.brand .titles span{display:block; color:var(--muted); font-size:11px}
.nav{display:flex; flex-direction:column; gap:6px}
.nav button{
  display:flex; align-items:center; gap:10px; width:100%;
  text-align:left; background:transparent; border:1px solid transparent;
  border-radius:12px; padding:10px 12px; color:var(--muted);
}
.nav button svg{width:18px; height:18px; flex:0 0 auto; opacity:.9}
.nav button.active, .nav button:hover{
  color:var(--text); background:rgba(79,140,255,.12); border-color:rgba(79,140,255,.28);
}
.side-foot{margin-top:auto; padding:10px; border-radius:14px; background:rgba(255,255,255,.03); border:1px solid var(--line)}
.side-foot .row{display:flex; justify-content:space-between; gap:8px; font-size:12px; margin:4px 0}
.pill{
  display:inline-flex; align-items:center; gap:6px; padding:3px 9px; border-radius:999px;
  background:rgba(255,255,255,.05); border:1px solid var(--line); color:var(--muted); font-size:11px;
}
.pill.live{color:var(--good); border-color:rgba(61,220,151,.35); background:rgba(61,220,151,.08)}
.dot{width:7px; height:7px; border-radius:50%; background:var(--good); box-shadow:0 0 0 0 rgba(61,220,151,.55); animation:pulse 1.6s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(61,220,151,.55)}70%{box-shadow:0 0 0 9px rgba(61,220,151,0)}100%{box-shadow:0 0 0 0 rgba(61,220,151,0)}}

/* Main */
.main{min-width:0; display:flex; flex-direction:column}
.top{
  position:sticky; top:0; z-index:20; display:flex; gap:12px; align-items:center; justify-content:space-between;
  padding:14px 18px; border-bottom:1px solid rgba(42,59,92,.75);
  background:rgba(7,11,20,.78); backdrop-filter:blur(12px);
}
.top h1{margin:0; font-size:16px; font-weight:700; letter-spacing:.01em}
.top .sub{color:var(--muted); font-size:12px; margin-top:2px}
.controls{display:flex; gap:8px; align-items:center; flex-wrap:wrap}
.controls label{display:flex; flex-direction:column; gap:4px; font-size:11px; color:var(--muted)}
.content{padding:18px; display:flex; flex-direction:column; gap:16px}

.hero{
  position:relative; overflow:hidden; border-radius:22px; border:1px solid rgba(79,140,255,.25);
  background:
    linear-gradient(120deg, rgba(21,32,54,.92), rgba(18,28,46,.75)),
    url('/assets/hero.jpg') center/cover no-repeat;
  box-shadow:var(--shadow); min-height:148px; padding:22px 24px;
  display:grid; grid-template-columns:1.3fr .7fr; gap:16px; align-items:center;
}
.hero::after{
  content:""; position:absolute; inset:0;
  background:linear-gradient(90deg, rgba(7,11,20,.78), rgba(7,11,20,.35) 55%, rgba(7,11,20,.55));
  pointer-events:none;
}
.hero > *{position:relative; z-index:1}
.hero h2{margin:0 0 6px; font-size:22px}
.hero p{margin:0; color:#c9d6f2; max-width:52ch}
.hero-stats{display:grid; grid-template-columns:1fr 1fr; gap:8px}
.hero-stat{
  background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.1);
  border-radius:14px; padding:10px 12px;
}
.hero-stat b{display:block; font-size:18px}
.hero-stat span{font-size:11px; color:#b7c5e4}
@media(max-width:900px){.hero{grid-template-columns:1fr}}

.kpis{display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px}
@media(max-width:1100px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
.kpi{
  border-radius:18px; padding:14px; border:1px solid var(--line);
  background:linear-gradient(180deg, rgba(26,39,64,.95), rgba(18,28,46,.9));
  box-shadow:0 10px 28px rgba(0,0,0,.22);
}
.kpi .head{display:flex; justify-content:space-between; align-items:center; margin-bottom:8px}
.kpi .ico{
  width:34px; height:34px; border-radius:11px; display:grid; place-items:center;
  background:rgba(79,140,255,.12); border:1px solid rgba(79,140,255,.25); color:var(--accent2);
}
.kpi .ico svg{width:18px; height:18px}
.kpi .val{font-size:26px; font-weight:750; letter-spacing:-.02em}
.kpi .lbl{color:var(--muted); font-size:12px}
.kpi .bar{margin-top:10px; height:6px; border-radius:99px; background:rgba(255,255,255,.06); overflow:hidden}
.kpi .bar > i{display:block; height:100%; border-radius:99px; background:linear-gradient(90deg,var(--accent),var(--cyan)); width:0%}

.grid-2{display:grid; grid-template-columns:1.05fr .95fr; gap:14px}
.grid-3{display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px}
@media(max-width:1100px){.grid-2,.grid-3{grid-template-columns:1fr}}

.card{
  border-radius:18px; border:1px solid var(--line);
  background:linear-gradient(180deg, rgba(21,32,54,.95), rgba(18,28,46,.92));
  box-shadow:0 12px 30px rgba(0,0,0,.2); padding:14px 16px;
}
.card h3{margin:0 0 10px; font-size:13px; letter-spacing:.04em; text-transform:uppercase; color:#b9c7e4; display:flex; align-items:center; gap:8px}
.card h3 svg{width:16px; height:16px; color:var(--accent2)}

.session-list{display:flex; flex-direction:column; gap:8px; max-height:62vh; overflow:auto; padding-right:2px}
.session-item{
  border:1px solid var(--line); border-radius:14px; padding:11px 12px; cursor:pointer;
  background:rgba(255,255,255,.02); transition:border-color .15s, background .15s;
}
.session-item:hover,.session-item.active{border-color:rgba(79,140,255,.55); background:rgba(79,140,255,.08)}
.session-item .t{display:flex; justify-content:space-between; gap:8px; align-items:center}
.session-item .t strong{font-size:13px}
.chip{
  display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:999px;
  background:rgba(255,255,255,.05); border:1px solid var(--line); color:var(--muted); font-size:11px; margin:0 4px 4px 0;
}
.chip.live{color:var(--good); border-color:rgba(61,220,151,.35)}

table{width:100%; border-collapse:collapse}
th,td{text-align:left; padding:8px 6px; border-bottom:1px solid rgba(42,59,92,.65); vertical-align:top}
th{color:var(--muted); font-size:11px; letter-spacing:.04em; text-transform:uppercase}
.scroll{max-height:320px; overflow:auto}

/* Connectors: 1/3 width cards */
.connector-grid{
  display:grid;
  grid-template-columns:repeat(3, minmax(0, 1fr));
  gap:12px;
  align-items:start;
}
@media(max-width:1100px){.connector-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:720px){.connector-grid{grid-template-columns:1fr}}
.conn-card{
  border:1px solid var(--line); border-radius:16px; padding:12px;
  background:linear-gradient(180deg, rgba(26,39,64,.9), rgba(15,23,40,.92));
  display:flex; flex-direction:column; gap:8px; min-width:0;
}
.conn-card .hdr{display:flex; justify-content:space-between; gap:8px; align-items:flex-start}
.conn-card .name{display:flex; gap:8px; align-items:center; min-width:0}
.conn-card .avatar{
  width:28px; height:28px; border-radius:9px; display:grid; place-items:center;
  font-size:11px; font-weight:700; color:#dfe9ff;
  background:linear-gradient(135deg, rgba(79,140,255,.35), rgba(61,224,208,.2));
  border:1px solid rgba(79,140,255,.3); flex:0 0 auto;
}
.conn-card .name strong{font-size:13px; overflow:hidden; text-overflow:ellipsis}
.conn-card .fields{display:flex; flex-direction:column; gap:6px}
.field{display:flex; flex-direction:column; gap:3px}
.field label{font-size:10px; color:var(--muted); font-family:var(--mono); display:flex; justify-content:space-between; gap:6px}
.field input{padding:7px 9px; border-radius:10px; font-size:12px; width:100%}
.conn-card .actions{display:flex; gap:6px; margin-top:2px}
.conn-card .actions button{flex:1; padding:8px 10px; font-size:12px}

.banner{
  border-radius:14px; padding:10px 12px; border:1px solid rgba(79,140,255,.3);
  background:rgba(79,140,255,.08); color:#cfe0ff; font-size:12.5px;
}
.flash{padding:10px 12px; border-radius:12px; margin:8px 0; border:1px solid var(--line)}
.flash.ok{border-color:rgba(61,220,151,.4); background:rgba(61,220,151,.08)}
.flash.err{border-color:rgba(255,107,122,.4); background:rgba(255,107,122,.08)}
.empty{padding:18px; text-align:center; color:var(--muted); border:1px dashed var(--line); border-radius:14px}
.toast{
  position:fixed; right:16px; bottom:16px; z-index:50; min-width:240px; max-width:360px;
  padding:12px 14px; border-radius:14px; border:1px solid var(--line);
  background:rgba(18,28,46,.96); box-shadow:var(--shadow); display:none;
}
.toast.show{display:block}
.sec-note{font-size:12px; color:var(--muted); margin:0 0 12px}
</style>
</head>
<body>
<div class="app">
  <aside class="side">
    <div class="brand">
      <img class="mark" src="/assets/mark.svg" alt="Atlas"/>
      <div class="titles">
        <b>Atlas</b>
        <span>Command Center</span>
      </div>
    </div>
    <nav class="nav" id="nav">
      <button class="active" data-tab="overview" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z"/></svg>
        Overview
      </button>
      <button data-tab="live" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h3l2-7 4 14 2-7h3"/><circle cx="12" cy="12" r="9"/></svg>
        Live sessions
      </button>
      <button data-tab="settings" type="button" id="navSettings">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path d="M19.4 13a7.8 7.8 0 0 0 .1-2l2-1.2-2-3.4-2.3.5a7.6 7.6 0 0 0-1.7-1L15 3h-6l-.5 2.9a7.6 7.6 0 0 0-1.7 1L4.5 6.4l-2 3.4L4.5 11a7.8 7.8 0 0 0 0 2l-2 1.2 2 3.4 2.3-.5a7.6 7.6 0 0 0 1.7 1L9 21h6l.5-2.9a7.6 7.6 0 0 0 1.7-1l2.3.5 2-3.4-2-1.2z"/></svg>
        Connectors
      </button>
      <button data-tab="findings" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 3 7v6c0 5 3.8 8.4 9 9 5.2-.6 9-4 9-9V7l-9-4z"/><path d="M12 8v5"/><circle cx="12" cy="16" r=".8" fill="currentColor"/></svg>
        Findings
      </button>
    </nav>
    <div class="side-foot">
      <div class="row"><span class="muted">Daemon</span><span class="pill live" id="daemonPill"><span class="dot"></span>online</span></div>
      <div class="row"><span class="muted">Plugin</span><span class="mono" id="sideVer">—</span></div>
      <div class="row"><span class="muted">Updated</span><span id="sideUpdated">—</span></div>
      <div class="row mono faint" id="sideDb" style="display:block;word-break:break-all;margin-top:6px">—</div>
    </div>
  </aside>

  <div class="main">
    <header class="top">
      <div>
        <h1 id="pageTitle">Overview</h1>
        <div class="sub">Shared multi-session observability · <span class="mono" id="url"></span></div>
      </div>
      <div class="controls">
        <label>Project
          <select id="project"></select>
        </label>
        <label>Session
          <select id="session"></select>
        </label>
        <button type="button" id="refresh" class="ghost">Refresh</button>
        <button type="button" id="gotoSettings" class="primary">Credentials</button>
      </div>
    </header>

    <div class="content">
      <section id="tab-overview">
        <div class="hero">
          <div>
            <div class="pill live" style="margin-bottom:10px"><span class="dot"></span> Atlas marketplace command center</div>
            <h2>See what every terminal is doing</h2>
            <p>Live sessions, tool activity, savings proxies, and connector credentials — one loopback UI for all concurrent agents.</p>
          </div>
          <div class="hero-stats">
            <div class="hero-stat"><b id="heroLive">0</b><span>Live sessions (10m)</span></div>
            <div class="hero-stat"><b id="heroTools">0</b><span>Tool calls (10m)</span></div>
            <div class="hero-stat"><b id="heroConn">0</b><span>Connectors ready</span></div>
            <div class="hero-stat"><b id="heroFindings">0</b><span>Open findings</span></div>
          </div>
        </div>
        <div class="kpis" id="kpis"></div>
        <div class="grid-2">
          <div class="card">
            <h3>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 15v4"/><path d="M12 11v8"/><path d="M16 8v11"/></svg>
              Savings proxies
            </h3>
            <div id="savings" class="muted">—</div>
          </div>
          <div class="card">
            <h3>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 3 4 14h7l-1 7 10-12h-7l1-6z"/></svg>
              Live activity pulse
            </h3>
            <div id="pulse" class="muted">—</div>
          </div>
        </div>
        <div class="card">
          <h3>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>
            Recent runs
          </h3>
          <div class="scroll">
            <table><thead><tr><th>When</th><th>Project</th><th>Kind</th><th>Disp</th><th>Inline</th><th>Verifier</th></tr></thead><tbody id="recentRuns"></tbody></table>
          </div>
        </div>
      </section>

      <section id="tab-live" class="hidden">
        <div class="banner" id="hint"></div>
        <div class="grid-2">
          <div class="card">
            <h3>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h6"/><path d="M7 12h10"/><path d="M7 16h8"/></svg>
              Sessions <span class="pill" id="sessionCount" style="margin-left:6px">0</span>
            </h3>
            <div class="session-list" id="sessionList"></div>
          </div>
          <div style="display:flex; flex-direction:column; gap:14px; min-width:0">
            <div class="card">
              <h3>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.5"/><path d="M5 19a7 7 0 0 1 14 0"/></svg>
                Selected session
              </h3>
              <div id="detail" class="muted">Pick a session…</div>
            </div>
            <div class="grid-2" style="grid-template-columns:1fr 1fr">
              <div class="card">
                <h3>Recent tools</h3>
                <div class="scroll">
                  <table><thead><tr><th>When</th><th>Tool</th><th>Target</th></tr></thead><tbody id="tools"></tbody></table>
                </div>
              </div>
              <div class="card">
                <h3>Events / dispatches</h3>
                <div class="scroll">
                  <table><thead><tr><th>When</th><th>Kind</th><th>Detail</th></tr></thead><tbody id="events"></tbody></table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="tab-settings" class="hidden">
        <div class="card">
          <h3>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><circle cx="12" cy="12" r="4"/></svg>
            Connector credentials
          </h3>
          <p class="sec-note">
            Compact cards (⅓ width). Saves to <span class="mono" id="settingsPath">~/.claude/settings.json</span>
            <span class="mono">pluginConfigs["atlas@tech-tools"].options</span> and this plugin’s
            <span class="mono">.env</span>. Secrets are never read back — only set/missing.
            Drafts survive auto-refresh. After save, reload Claude Code.
          </p>
          <div id="settingsFlash"></div>
          <div class="connector-grid" id="connectorForms"></div>
        </div>
      </section>

      <section id="tab-findings" class="hidden">
        <div class="card">
          <h3>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 3 7v6c0 5 3.8 8.4 9 9 5.2-.6 9-4 9-9V7l-9-4z"/></svg>
            Findings
          </h3>
          <div class="scroll" style="max-height:70vh">
            <table><thead><tr><th>Sev</th><th>Title</th><th>Dimension</th><th>Status</th></tr></thead><tbody id="findings"></tbody></table>
          </div>
        </div>
      </section>
    </div>
  </div>
</div>
<div class="toast" id="toast"></div>

<script>
const $ = id => document.getElementById(id);
const state = {
  snapshot:null, selectedSession:null, selectedProject:null, tab:'overview',
  drafts:{}, settingsDirty:false, settingsFocus:false
};
const ICONS = {
  sessions: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M3 19a5 5 0 0 1 10 0"/><path d="M11 19a5 5 0 0 1 10 0"/></svg>`,
  tools: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14.5 6.5 17 4l3 3-2.5 2.5"/><path d="m4 20 7.5-7.5"/><path d="M9 7a5 5 0 0 0 7 7"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 3 4 14h7l-1 7 10-12h-7l1-6z"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 3 7v6c0 5 3.8 8.4 9 9 5.2-.6 9-4 9-9V7l-9-4z"/></svg>`,
};

function fmtTime(epoch){ if(!epoch) return '—'; return new Date(epoch*1000).toLocaleString(); }
function ago(epoch){
  if(!epoch) return '';
  const s = Math.max(0, Date.now()/1000 - epoch);
  if(s<60) return Math.floor(s)+'s ago';
  if(s<3600) return Math.floor(s/60)+'m ago';
  if(s<86400) return Math.floor(s/3600)+'h ago';
  return Math.floor(s/86400)+'d ago';
}
function shortId(s){ return (s||'').slice(0,8); }
function pct(x){ return (x==null||Number.isNaN(Number(x))) ? '—' : (100*Number(x)).toFixed(0)+'%'; }
function num(x){ return x==null ? '—' : Number(x).toLocaleString(); }
function _folder(p){ if(!p) return ''; const parts=String(p).replace(/\\\\/g,'/').split('/').filter(Boolean); return parts[parts.length-1]||''; }
function toast(msg, ok){
  const el=$('toast'); el.textContent=msg; el.style.borderColor = ok? 'rgba(61,220,151,.45)':'rgba(255,107,122,.45)';
  el.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>el.classList.remove('show'), 3200);
}
async function api(path, opts){
  const r = await fetch(path, Object.assign({cache:'no-store'}, opts||{}));
  const data = await r.json();
  if(!r.ok) throw new Error(data.error || (path+' '+r.status));
  return data;
}
function avatar(name){
  const n=(name||'?').slice(0,2).toUpperCase();
  return `<div class="avatar" title="${name||''}">${n}</div>`;
}
function kpi(icon, label, value, barPct, tone){
  const w = Math.max(0, Math.min(100, barPct==null?0:barPct));
  return `<div class="kpi"><div class="head"><div class="ico" style="${tone||''}">${icon}</div><span class="pill">${label}</span></div>
    <div class="val">${value}</div><div class="bar"><i style="width:${w}%"></i></div></div>`;
}

function renderOverview(s){
  const t = s.health?.totals || {};
  const act = s.health?.activity_last_10m || {};
  const live = (s.live_sessions||[]).length;
  const connReady = (s.connectors||[]).filter(c=>c.configured_hint).length;
  const connTotal = (s.connectors||[]).length || 1;
  const findings = s.health?.open_findings || 0;
  $('heroLive').textContent = num(live);
  $('heroTools').textContent = num(act.tool_calls||0);
  $('heroConn').textContent = `${connReady}/${connTotal}`;
  $('heroFindings').textContent = num(findings);
  const toolBar = Math.min(100, (act.tool_calls||0)*4);
  const liveBar = Math.min(100, live*25);
  const connBar = (connReady/connTotal)*100;
  const ver = t.avg_verifier_coverage==null?0:Number(t.avg_verifier_coverage)*100;
  $('kpis').innerHTML = [
    kpi(ICONS.sessions, 'Live sessions', num(live), liveBar),
    kpi(ICONS.tools, 'Tools / 10m', num(act.tool_calls||0), toolBar),
    kpi(ICONS.bolt, 'Dispatches', num(t.sum_dispatches), Math.min(100,(t.sum_dispatches||0)/10)),
    kpi(ICONS.shield, 'Avg verifier', pct(t.avg_verifier_coverage), ver),
  ].join('');

  const v = s.savings||{};
  $('savings').innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
      <span class="chip">dispatch/inline ${v.dispatch_ratio==null?'—':Number(v.dispatch_ratio).toFixed(2)}</span>
      <span class="chip">recall ${pct(v.recall_hit_rate)}</span>
      <span class="chip">verifier ${pct(v.avg_verifier_coverage)}</span>
    </div>
    <div class="muted" style="margin-bottom:8px">${v.note||''}</div>
    <div>Dispatches <strong>${num(v.dispatches)}</strong> · Inline <strong>${num(v.inline_ops)}</strong> · Est tokens <strong>${num(v.est_context_tokens)}</strong></div>`;

  const tools = act.tool_calls||0, events = act.events||0;
  $('pulse').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="hero-stat" style="background:rgba(255,255,255,.03)"><b>${num(tools)}</b><span>tool_calls last 10m</span>
        <div class="bar" style="margin-top:8px"><i style="width:${Math.min(100,tools*5)}%"></i></div></div>
      <div class="hero-stat" style="background:rgba(255,255,255,.03)"><b>${num(events)}</b><span>events last 10m</span>
        <div class="bar" style="margin-top:8px"><i style="width:${Math.min(100,events*8)}%;background:linear-gradient(90deg,var(--violet),var(--accent))"></i></div></div>
    </div>
    <div class="muted" style="margin-top:10px">LIVE requires real tool/event activity in the last 10 minutes — not merely an open DB row.</div>`;

  const runs = (s.health?.recent_runs||[]).slice(0,12);
  $('recentRuns').innerHTML = runs.map(r => `
    <tr>
      <td class="muted">${ago(r.started_at)}</td>
      <td>${r.project_name || _folder(r.root_path) || '—'}</td>
      <td class="mono">${r.kind||'—'}</td>
      <td>${num(r.dispatches)}</td>
      <td>${num(r.inline_ops)}</td>
      <td>${pct(r.verifier_coverage)}</td>
    </tr>`).join('') || `<tr><td colspan="6" class="muted">No runs yet</td></tr>`;
}

function filteredSessions(s){
  let list = s.sessions||[];
  if(state.selectedProject) list = list.filter(x => String(x.project_id)===String(state.selectedProject));
  return list;
}
function renderProjects(s){
  const cur = state.selectedProject;
  $('project').innerHTML = [`<option value="">All recent projects</option>`].concat(
    (s.projects||[]).map(p => {
      const val = String(p.id);
      const label = `${p.folder||p.name||'project'} · ${p.age||''}`.trim();
      return `<option value="${val}" ${cur===val?'selected':''}>${label}</option>`;
    })
  ).join('');
}
function renderSessionList(s){
  const list = filteredSessions(s);
  $('sessionCount').textContent = list.length + ' shown';
  $('session').innerHTML = list.map(x => {
    const label = x.label || `${x.project_folder||x.project_name||'project'} · ${shortId(x.session_id)}`;
    return `<option value="${x.session_id}" ${state.selectedSession===x.session_id?'selected':''}>${label}</option>`;
  }).join('');
  $('sessionList').innerHTML = list.map(x => {
    const live = x.is_live ? '<span class="chip live">LIVE</span>' : '';
    const active = state.selectedSession===x.session_id ? 'active' : '';
    const folder = x.project_folder || x.project_name || _folder(x.cwd) || 'project';
    const when = ago(x.last_activity_at || x.started_at);
    return `<div class="session-item ${active}" data-sid="${x.session_id}">
      <div class="t"><strong>${folder}</strong>${live}</div>
      <div class="mono muted">${shortId(x.session_id)} · ${when}</div>
      <div class="muted" style="font-size:12px;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(x.cwd||x.project_root||'')}</div>
      <div style="margin-top:6px">
        <span class="chip">tools10m ${num(x.recent_tool_calls)}</span>
        <span class="chip">disp ${num(x.dispatches)}</span>
        <span class="chip">inline ${num(x.inline_ops)}</span>
      </div>
    </div>`;
  }).join('') || '<div class="empty">No recent sessions (last 7 days). Use atlas in a project; Stop/SubagentStop ingest fills history.</div>';
  document.querySelectorAll('#sessionList .session-item').forEach(el => {
    el.onclick = () => { state.selectedSession = el.dataset.sid; loadDetail(); renderSessionList(state.snapshot); };
  });
}
function renderFindings(s){
  $('findings').innerHTML = (s.findings||[]).slice(0,50).map(f =>
    `<tr><td class="${f.severity==='high'||f.severity==='critical'?'bad':'warn'}">${f.severity||''}</td><td>${f.title||''}</td><td class="muted">${f.dimension||''}</td><td>${f.status||''}</td></tr>`
  ).join('') || '<tr><td colspan="4" class="muted">No findings</td></tr>';
}

function renderSettings(s){
  if(state.settingsDirty || state.settingsFocus){
    updateSettingsBadges(s);
    return;
  }
  $('settingsPath').textContent = s.settings_path || '~/.claude/settings.json';
  const connectors = s.connectors||[];
  $('connectorForms').innerHTML = connectors.map(c => {
    const fields = (c.fields||[]).map(f => {
      const key = f.user_config_key || f.env_key;
      const set = !!f.is_set;
      const src = f.source && f.source !== 'missing' ? f.source : '';
      const ph = set ? 'set — type to replace' : 'enter value';
      const type = f.sensitive ? 'password' : 'text';
      const draft = state.drafts[key] || '';
      return `<div class="field">
        <label><span>${key}</span><span class="${set?'good':'warn'}">${set?'set':'missing'}${src?(' · '+src):''}</span></label>
        <input data-key="${key}" type="${type}" value="${String(draft).replace(/"/g,'&quot;')}" placeholder="${ph}" autocomplete="off" spellcheck="false"/>
      </div>`;
    }).join('') || '<div class="muted">No fields</div>';
    return `<div class="conn-card" data-connector="${c.name}">
      <div class="hdr">
        <div class="name">${avatar(c.name)}<div><strong class="mono">${c.name}</strong>
          <div class="faint" style="font-size:11px">${(c.fields||[]).length} keys</div></div></div>
        <span class="chip ${c.configured_hint?'live':''}" data-configured-chip="${c.name}">${c.configured_hint?'ready':'needs keys'}</span>
      </div>
      <div class="fields">${fields}</div>
      <div class="actions">
        <button type="button" class="primary" data-save-connector="${c.name}">Save</button>
      </div>
    </div>`;
  }).join('') || '<div class="empty">No connectors in .mcp.json</div>';
  bindSettingsHandlers();
}
function updateSettingsBadges(s){
  const byName = {};
  (s.connectors||[]).forEach(c => byName[c.name]=c);
  document.querySelectorAll('[data-configured-chip]').forEach(el => {
    const c = byName[el.dataset.configuredChip];
    if(!c) return;
    el.textContent = c.configured_hint ? 'ready' : 'needs keys';
    el.classList.toggle('live', !!c.configured_hint);
  });
  const fieldMap = {};
  (s.connectors||[]).forEach(c => (c.fields||[]).forEach(f => {
    fieldMap[f.user_config_key || f.env_key] = f;
  }));
  document.querySelectorAll('#connectorForms input[data-key]').forEach(inp => {
    const f = fieldMap[inp.dataset.key];
    if(!f) return;
    const label = inp.parentElement.querySelector('label span:last-child');
    if(!label) return;
    const src = f.source && f.source !== 'missing' ? (' · '+f.source) : '';
    label.className = f.is_set ? 'good' : 'warn';
    label.textContent = (f.is_set?'set':'missing') + src;
  });
}
function bindSettingsHandlers(){
  document.querySelectorAll('#connectorForms input[data-key]').forEach(inp => {
    inp.oninput = () => {
      state.drafts[inp.dataset.key] = inp.value;
      state.settingsDirty = Object.values(state.drafts).some(v => String(v||'').length > 0);
    };
    inp.onfocus = () => { state.settingsFocus = true; };
    inp.onblur = () => { state.settingsFocus = false; };
  });
  document.querySelectorAll('[data-save-connector]').forEach(btn => {
    btn.onclick = async () => {
      const card = btn.closest('.conn-card');
      const updates = {};
      card.querySelectorAll('input[data-key]').forEach(inp => {
        if(inp.value !== '') updates[inp.dataset.key] = inp.value;
      });
      if(!Object.keys(updates).length){
        flash('No new values entered (empty fields unchanged).', false);
        return;
      }
      btn.disabled = true;
      try{
        const res = await api('/api/connectors/env', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({updates})
        });
        if(!res.ok){ flash(res.error || 'save failed', false); return; }
        Object.keys(updates).forEach(k => { delete state.drafts[k]; });
        state.settingsDirty = Object.values(state.drafts).some(v => String(v||'').length > 0);
        card.querySelectorAll('input[data-key]').forEach(inp => {
          if(updates[inp.dataset.key] != null) inp.value = '';
        });
        flash((res.note||'Saved') + ' · ' + (res.updated_user_config_keys||res.updated_keys||[]).join(', '), true);
        toast('Credentials saved — reload Claude Code', true);
        state.settingsDirty = false; state.settingsFocus = false;
        await refresh(true);
        renderSettings(state.snapshot);
      }catch(e){ flash(String(e.message||e), false); }
      finally { btn.disabled = false; }
    };
  });
}
function flash(msg, ok){
  $('settingsFlash').innerHTML = `<div class="flash ${ok?'ok':'err'}">${msg}</div>`;
}

async function loadDetail(){
  if(!state.selectedSession){
    $('detail').textContent = 'Pick a session…';
    $('tools').innerHTML = '';
    $('events').innerHTML = '';
    return;
  }
  const d = await api('/api/sessions/'+encodeURIComponent(state.selectedSession));
  const s = d.session||{};
  $('detail').innerHTML = `
    <div style="margin-bottom:8px">
      ${s.is_live?'<span class="chip live">LIVE</span>':''}
      <span class="chip">${s.project_folder||s.project_name||_folder(s.cwd)||'—'}</span>
      <span class="chip">${s.agent||'claude'}</span>
      <span class="chip">${s.model||'—'}</span>
      ${s.git_branch?`<span class="chip">${s.git_branch}</span>`:''}
      <span class="chip">${ago(s.last_activity_at||s.started_at)}</span>
    </div>
    <div class="mono" style="margin:6px 0">${s.session_id||''}</div>
    <div class="muted" style="margin-bottom:8px">${s.cwd||s.project_root||''}</div>
    <div>Task: <strong>${s.task_summary||s.brief_summary||'—'}</strong></div>
    <div style="margin-top:8px">
      <span class="chip">dispatches ${num(s.dispatches)}</span>
      <span class="chip">inline ${num(s.inline_ops)}</span>
      <span class="chip">verifier ${pct(s.verifier_coverage)}</span>
      <span class="chip">tokens ~${num(s.est_context_tokens)}</span>
      <span class="chip">tools10m ${num(s.recent_tool_calls)}</span>
    </div>`;
  $('tools').innerHTML = (d.tools||[]).map(t =>
    `<tr><td class="muted">${ago(t.ts)}</td><td class="mono">${t.tool_name||''}</td>
     <td class="mono muted">${(t.target||t.server||'').toString().slice(0,48)}</td></tr>`
  ).join('') || '<tr><td colspan="3" class="muted">No tool_calls yet</td></tr>';
  const ev = []
    .concat((d.dispatches||[]).map(x => ({ts:x.ts, kind:'dispatch', detail:(x.agent_type||'')+' '+(x.model||'')})))
    .concat((d.events||[]).map(x => ({ts:x.ts, kind:x.is_inline_op?'inline':'event', detail:(x.tool||'')+' '+(x.path||x.context||'')})))
    .sort((a,b)=> (b.ts||0)-(a.ts||0)).slice(0,80);
  $('events').innerHTML = ev.map(e =>
    `<tr><td class="muted">${ago(e.ts)}</td><td>${e.kind}</td><td class="mono muted">${(e.detail||'').toString().slice(0,64)}</td></tr>`
  ).join('') || '<tr><td colspan="3" class="muted">No events/dispatches</td></tr>';
}

const TITLES = {overview:'Overview', live:'Live sessions', settings:'Connectors & credentials', findings:'Findings'};
function showTab(tab){
  state.tab = tab;
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.tab===tab));
  ['overview','live','settings','findings'].forEach(t => {
    const el = $('tab-'+t); if(el) el.classList.toggle('hidden', t!==tab);
  });
  $('pageTitle').textContent = TITLES[tab] || 'Atlas';
  if(tab==='settings' && state.snapshot) renderSettings(state.snapshot);
  if(tab==='live' && state.selectedSession) loadDetail();
}

async function refresh(forceSettings){
  const q = state.selectedProject ? ('?project_id='+encodeURIComponent(state.selectedProject)) : '';
  const s = await api('/api/status'+q);
  state.snapshot = s;
  $('url').textContent = s.url || location.origin;
  $('sideUpdated').textContent = new Date((s.generated_at||Date.now()/1000)*1000).toLocaleTimeString();
  $('sideVer').textContent = s.plugin?.version || '—';
  $('sideDb').textContent = s.db_path || '—';
  $('hint').textContent = (s.ui_hints && s.ui_hints.note) || 'LIVE = activity in the last 10 minutes. Lists are recent-only.';
  renderProjects(s);
  renderOverview(s);
  renderFindings(s);
  if(state.tab==='live' || state.tab==='overview'){
    renderSessionList(s);
  }
  if(state.tab==='settings'){
    if(forceSettings){ state.settingsDirty=false; state.settingsFocus=false; }
    renderSettings(s);
  } else {
    renderSessionList(s);
    if(!state.selectedSession){
      const live = (s.live_sessions||[])[0] || filteredSessions(s)[0];
      if(live) state.selectedSession = live.session_id;
    }
    if(state.selectedSession && !(s.sessions||[]).some(x=>x.session_id===state.selectedSession)){
      state.selectedSession = (filteredSessions(s)[0]||{}).session_id || null;
    }
    if(state.tab==='live' && state.selectedSession) await loadDetail();
  }
}

document.querySelectorAll('#nav button').forEach(btn => btn.onclick = () => showTab(btn.dataset.tab));
$('gotoSettings').onclick = () => showTab('settings');
$('project').onchange = async e => { state.selectedProject = e.target.value || null; state.selectedSession=null; await refresh(); };
$('session').onchange = async e => { state.selectedSession = e.target.value || null; if(state.tab!=='live') showTab('live'); renderSessionList(state.snapshot||{sessions:[]}); await loadDetail(); };
$('refresh').onclick = () => refresh(true);
refresh();
setInterval(() => refresh(false), 8000);
</script>
</body>
</html>
"""

class Handler(BaseHTTPRequestHandler):
    server_version = "AtlasDashboard/1.2"

    def _json(self, code: int, payload):
        body = json.dumps(payload, indent=2, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", f"http://{LOOPBACK}")
        self.end_headers()
        self.wfile.write(body)

    def _html(self, code: int, html: str):
        body = html.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _bytes(self, code: int, body: bytes, content_type: str, cache: str = "public, max-age=3600"):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        self.wfile.write(body)

    def _asset_mark(self):
        # Inline brand mark — no dependency on install cache or large PNGs.
        svg = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">\n  <defs>\n    <linearGradient id="g" x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">\n      <stop stop-color="#4F8CFF"/><stop offset="0.55" stop-color="#3DE0D0"/><stop offset="1" stop-color="#9B7BFF"/>\n    </linearGradient>\n  </defs>\n  <rect width="64" height="64" rx="16" fill="#0B1220"/>\n  <path d="M32 10 14 48h8.5l3.2-7.4h12.6L41.5 48H50L32 10zm0 14.2 4.4 10.2H27.6L32 24.2z" fill="url(#g)"/>\n  <circle cx="50" cy="14" r="3" fill="#3DE0D0"/>\n</svg>'
        return self._bytes(200, svg, "image/svg+xml; charset=utf-8")

    def _asset_hero(self):
        # Prefer marketplace img/ hero if present beside plugin; else SVG fallback.
        candidates = [
            PLUGIN_ROOT.parent.parent / "img" / "command-center-hero.png",
            PLUGIN_ROOT.parent.parent / "img" / "readme-hero-banner.png",
            PLUGIN_ROOT / "img" / "command-center-hero.png",
        ]
        for p in candidates:
            try:
                if p.is_file() and p.stat().st_size < 3_500_000:
                    data = p.read_bytes()
                    ctype = "image/png" if p.suffix.lower() == ".png" else "image/jpeg"
                    return self._bytes(200, data, ctype)
            except Exception:
                pass
        # Lightweight gradient placeholder
        svg = b'<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600" viewBox="0 0 1600 600">\n  <defs>\n    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">\n      <stop stop-color="#0B1220"/><stop offset="0.5" stop-color="#15284a"/><stop offset="1" stop-color="#0d1b2a"/>\n    </linearGradient>\n    <radialGradient id="glow" cx="0.2" cy="0.2" r="0.8">\n      <stop stop-color="#4F8CFF" stop-opacity="0.45"/><stop offset="1" stop-color="#4F8CFF" stop-opacity="0"/>\n    </radialGradient>\n  </defs>\n  <rect width="1600" height="600" fill="url(#bg)"/>\n  <rect width="1600" height="600" fill="url(#glow)"/>\n  <g fill="none" stroke="#3DE0D0" stroke-opacity="0.2" stroke-width="2">\n    <path d="M0 420 C300 360 500 500 800 420 S1300 300 1600 380"/>\n    <path d="M0 460 C350 400 550 520 850 450 S1350 340 1600 420"/>\n  </g>\n</svg>'
        return self._bytes(200, svg, "image/svg+xml; charset=utf-8")

    def log_message(self, fmt, *args):
        sys.stderr.write("[atlas-dashboard] " + (fmt % args) + "\n")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", f"http://{LOOPBACK}")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        if u.path in ("/", "/index.html", "/dashboard", "/dashboard/"):
            return self._html(200, UI_HTML)
        if u.path in ("/assets/mark.svg", "/assets/logo.svg"):
            return self._asset_mark()
        if u.path in ("/assets/hero.jpg", "/assets/hero.png"):
            return self._asset_hero()
        if u.path in ("/api/health", "/health"):
            return self._json(
                200,
                {
                    "ok": True,
                    "service": "atlas-dashboard",
                    "url": dashboard_url(),
                    "pid": os.getpid(),
                    "db_path": dashboard_db_path(),
                    "script": str(Path(__file__).resolve()),
                    "time": time.time(),
                },
            )
        if u.path == "/api/status":
            qs = parse_qs(u.query)
            project_id = qs.get("project_id", [None])[0]
            project_id = int(project_id) if project_id not in (None, "") else None
            try:
                return self._json(200, snapshot(project_id=project_id))
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
        if u.path == "/api/projects":
            conn, _ = _db()
            try:
                return self._json(200, {"ok": True, "projects": _projects(conn)})
            finally:
                conn.close()
        if u.path == "/api/sessions":
            qs = parse_qs(u.query)
            project_id = qs.get("project_id", [None])[0]
            project_id = int(project_id) if project_id not in (None, "") else None
            limit = int(qs.get("limit", [str(MAX_SESSIONS)])[0])
            conn, _ = _db()
            try:
                return self._json(
                    200,
                    {
                        "ok": True,
                        "sessions": _sessions(conn, project_id=project_id, limit=limit),
                    },
                )
            finally:
                conn.close()
        if u.path.startswith("/api/sessions/"):
            sid = unquote(u.path[len("/api/sessions/") :])
            conn, _ = _db()
            try:
                detail = _session_detail(conn, sid)
                if not detail.get("session"):
                    return self._json(404, {"ok": False, "error": "session_not_found"})
                return self._json(200, {"ok": True, **detail})
            finally:
                conn.close()
        if u.path == "/api/connectors":
            return self._json(
                200,
                {
                    "ok": True,
                    "connectors": _connector_status(),
                    "user_config": _user_config_schema(),
                    "settings_path": str(_settings_path()),
                },
            )
        if u.path == "/api/findings":
            conn, _ = _db()
            try:
                return self._json(200, {"ok": True, "findings": _findings(conn)})
            finally:
                conn.close()
        if u.path == "/api/runs":
            qs = parse_qs(u.query)
            limit = int(qs.get("limit", ["20"])[0])
            project_id = qs.get("project_id", [None])[0]
            project_id = int(project_id) if project_id not in (None, "") else None
            conn, _ = _db()
            try:
                return self._json(
                    200, {"ok": True, "health": _run_health(conn, limit, project_id)}
                )
            finally:
                conn.close()
        return self._json(404, {"ok": False, "error": "not_found", "path": u.path})

    def do_POST(self):
        u = urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return self._json(400, {"ok": False, "error": "invalid_json"})
        if u.path == "/api/connectors/env":
            updates = data.get("updates") or {}
            if not isinstance(updates, dict) or not updates:
                return self._json(400, {"ok": False, "error": "updates_required"})
            return self._json(200, write_settings_updates(updates))
        return self._json(404, {"ok": False, "error": "not_found"})


def serve(host: str, port: int):
    os.environ["ATLAS_DB"] = dashboard_db_path()
    os.environ["ATLAS_DASHBOARD_DB"] = dashboard_db_path()
    httpd = ThreadingHTTPServer((host, port), Handler)
    _write_pidfile(os.getpid(), port, dashboard_db_path())
    atexit.register(_clear_pidfile)

    def _stop(signum, frame):
        _clear_pidfile()
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    sys.stderr.write(
        f"[atlas-dashboard] {dashboard_url(port)} db={dashboard_db_path()} script={Path(__file__).resolve()}\n"
    )
    httpd.serve_forever()


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    sp = sub.add_parser("serve")
    sp.add_argument("--port", type=int, default=DEFAULT_PORT)
    sp.add_argument("--host", default=LOOPBACK)
    sp.add_argument("--foreground", action="store_true")
    ep = sub.add_parser("ensure")
    ep.add_argument("--port", type=int, default=DEFAULT_PORT)
    sub.add_parser("stop")
    sub.add_parser("url")
    args = p.parse_args(argv)

    if args.cmd == "status":
        json.dump(snapshot(), sys.stdout, indent=2, default=str)
        sys.stdout.write("\n")
        return 0
    if args.cmd == "url":
        if _port_open(LOOPBACK, DEFAULT_PORT):
            print(dashboard_url(DEFAULT_PORT))
            return 0
        return 1
    if args.cmd == "ensure":
        result = ensure_daemon(args.port)
        json.dump(result, sys.stdout, indent=2, default=str)
        sys.stdout.write("\n")
        return 0 if result.get("ok") else 1
    if args.cmd == "stop":
        json.dump(stop_daemon(), sys.stdout, indent=2, default=str)
        sys.stdout.write("\n")
        return 0
    if args.cmd == "serve":
        if _port_open(args.host, args.port) and not args.foreground:
            if not _daemon_db_ok(args.port):
                stop_daemon()
                time.sleep(0.2)
            else:
                print(dashboard_url(args.port))
                return 0
        serve(args.host, args.port)
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
