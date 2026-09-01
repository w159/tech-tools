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
import atlas_control  # noqa: E402

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
    """Keys from .env.example / .env.template.

    Templates in this repo often comment every assignment (`# AUVIK_API_KEY=`).
    Those lines still declare allowlisted keys.
    """
    keys: list[str] = []
    seen: set[str] = set()
    for name in (".env.example", ".env.template"):
        path = PLUGIN_ROOT / name
        if not path.is_file():
            # marketplace root template is one level up from plugins/atlas
            alt = PLUGIN_ROOT.parent.parent / name
            path = alt if alt.is_file() else path
        if not path.is_file():
            continue
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line == "#":
                continue
            # strip one leading comment marker used for template assignments
            if line.startswith("#"):
                rest = line.lstrip("#").strip()
                # keep pure section headers out (no '=')
                if "=" not in rest:
                    continue
                line = rest
            if "=" not in line:
                continue
            key = line.split("=", 1)[0].strip()
            if not key or not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key):
                continue
            if key not in seen:
                seen.add(key)
                keys.append(key)
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


def _env_file_values() -> dict:
    """Plaintext values from the plugin .env. Only non-sensitive keys reach the UI."""
    values: dict = {}
    for path in _env_candidate_paths():
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except Exception:
            continue
        for line in text.splitlines():
            s = line.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            k, v = s.split("=", 1)
            v = v.strip().strip('"').strip("'")
            if v:
                values[k.strip()] = v
    return values


def _field_value(user_config_key, env_key, opts: dict, env_values: dict) -> str:
    """Current value for a non-secret field, so the UI can show and edit it."""
    for candidate in (user_config_key, env_key, (user_config_key or "").upper()):
        if candidate and opts.get(candidate) not in (None, ""):
            return str(opts[candidate])
    for candidate in (env_key, (user_config_key or "").upper(), user_config_key):
        if candidate and env_values.get(candidate):
            return str(env_values[candidate])
    return ""


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


def _key_is_set(
    user_config_key: str | None,
    env_key: str | None,
    opts: dict,
    env_present: set,
    marks: dict,
) -> tuple[bool, str]:
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
    env_values = _env_file_values()
    marks = _load_cred_marks()
    disabled = set(atlas_control._disabled_servers())
    out = []
    for name, cfg in servers.items():
        bundle, _launch = atlas_control.connector_entry(name)
        env_map = cfg.get("env") or {}
        # user_config refs in ${user_config.foo}
        uc_refs = []
        for v in env_map.values():
            if isinstance(v, str):
                for m in re.finditer(r"\$\{user_config\.([a-z0-9_]+)\}", v):
                    if m.group(1) not in uc_refs:
                        uc_refs.append(m.group(1))
        # also CFG_* keys as env fallbacks
        cfg_env = [
            k[4:] for k in env_map if isinstance(k, str) and k.startswith("CFG_")
        ]
        fields = []
        for uk in uc_refs:
            meta = user_config.get(uk) or {}
            is_set, source = _key_is_set(uk, uk.upper(), opts, env_present, marks)
            sensitive = (
                bool(meta.get("sensitive"))
                if isinstance(meta, dict)
                else any(
                    s in uk.lower() for s in ("key", "secret", "token", "password")
                )
            )
            fields.append(
                {
                    "user_config_key": uk,
                    "env_key": uk.upper(),
                    # Secrets are never read back; everything else is editable in place.
                    "value": (
                        ""
                        if sensitive
                        else _field_value(uk, uk.upper(), opts, env_values)
                    ),
                    "title": (meta.get("title") if isinstance(meta, dict) else None)
                    or uk,
                    "description": (
                        meta.get("description") if isinstance(meta, dict) else ""
                    )
                    or "",
                    "sensitive": sensitive,
                    "is_set": is_set,
                    "source": source,
                }
            )
        # env-only extras not in userConfig
        for ek in cfg_env:
            if any(
                f["env_key"] == ek
                or (f.get("user_config_key") or "").lower() == ek.lower()
                for f in fields
            ):
                continue
            is_set, source = _key_is_set(None, ek, opts, env_present, marks)
            sensitive = any(
                s in ek for s in ("KEY", "SECRET", "TOKEN", "PASSWORD", "PRIVATE")
            )
            fields.append(
                {
                    "user_config_key": None,
                    "env_key": ek,
                    "value": ""
                    if sensitive
                    else _field_value(None, ek, opts, env_values),
                    "title": ek,
                    "description": "Legacy .env key (also accepted)",
                    "sensitive": sensitive,
                    "is_set": is_set,
                    "source": source,
                }
            )

        def _optional_key(key: str | None) -> bool:
            if not key:
                return True
            k = key.lower()
            return (
                any(
                    s in k
                    for s in (
                        "base_url",
                        "region",
                        "platform",
                        "auth_mode",
                        "sandbox",
                        "organization_id",
                        "tenant_id",  # sometimes optional depending on vendor; still not the secret
                    )
                )
                and not k.endswith("_api_key")
                and "secret" not in k
                and "token" not in k
                and "password" not in k
                and "private" not in k
            )

        # Auth is "configured" when every non-optional credential field is set.
        # Optional URL/region/platform fields do not block readiness.
        must = [
            f
            for f in fields
            if (f.get("user_config_key") or f.get("env_key"))
            and not _optional_key(f.get("user_config_key") or f.get("env_key"))
        ]
        # Prefer sensitive/required fields when present
        sensitive_must = [
            f
            for f in must
            if f.get("sensitive")
            or (user_config.get(f.get("user_config_key") or "") or {}).get("required")
        ]
        check = sensitive_must or must
        configured = bool(check) and all(f.get("is_set") for f in check)
        server_name = f"plugin:atlas:{name}"
        out.append(
            {
                "name": name,
                "server_name": server_name,
                "enabled": server_name not in disabled,
                "bundle_exists": bundle.is_file(),
                "bundle_bytes": bundle.stat().st_size if bundle.is_file() else 0,
                "user_config_fields": uc_refs,
                "fields": fields,
                "configured_hint": configured,
                "missing_required": [
                    (f.get("user_config_key") or f.get("env_key"))
                    for f in check
                    if not f.get("is_set")
                ],
            }
        )
    return out


def _connector_env(name: str) -> dict:
    """Resolve one connector's .mcp.json env map into real values.

    The bundle reads CFG_* vars whose .mcp.json values are ${user_config.x}
    placeholders; a connection test has to substitute them the way Claude Code
    would, or the server starts unconfigured and the test proves nothing.
    """
    cfg = (_mcp_json().get("mcpServers") or {}).get(name) or {}
    opts = _plugin_config_options()
    env_values = _env_file_values()
    resolved = {}
    for env_key, template in (cfg.get("env") or {}).items():
        if not isinstance(template, str):
            continue

        def substitute(m):
            uk = m.group(1)
            return _field_value(uk, uk.upper(), opts, env_values)

        value = re.sub(r"\$\{user_config\.([a-z0-9_]+)\}", substitute, template)
        if not value and env_key.startswith("CFG_"):
            value = env_values.get(env_key[4:], "")
        if value:
            resolved[env_key] = value
    return resolved


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
        r["folder"] = (
            folder
            if not _is_generic_folder(folder)
            else (
                "home"
                if folder
                and folder.lower() == os.path.basename(os.path.expanduser("~")).lower()
                else folder
            )
        )
        if _is_generic_folder(r.get("name")) and r["folder"] == os.path.basename(
            os.path.expanduser("~")
        ):
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
    totals = (
        _q(
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
        )
        or {}
    )
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
        sessions = _sessions(
            conn, project_id=project_id, limit=MAX_SESSIONS, recent_only=True
        )
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


def _allowlisted_credential_keys() -> tuple[set[str], set[str], dict[str, str]]:
    """Return (user_config_keys, env_keys, env_to_user_config)."""
    manifest = _plugin_manifest()
    uc = set((manifest.get("userConfig") or {}).keys())
    env_keys = set(_env_example_keys())
    env_to_uc = {k.upper(): k for k in uc}
    # Every userConfig key has an UPPER env form
    for k in uc:
        env_keys.add(k.upper())
        env_keys.add(k)
    # CFG_* and ${user_config.*} from .mcp.json
    mcp = _mcp_json()
    for cfg in (mcp.get("mcpServers") or {}).values():
        env_map = (cfg or {}).get("env") or {}
        for ek, ev in env_map.items():
            if isinstance(ek, str) and ek.startswith("CFG_"):
                env_keys.add(ek[4:])
                env_keys.add(ek)
            if isinstance(ev, str):
                for m in re.finditer(r"\$\{user_config\.([a-z0-9_]+)\}", ev):
                    uk = m.group(1)
                    uc.add(uk)
                    env_keys.add(uk.upper())
                    env_to_uc[uk.upper()] = uk
    return uc, env_keys, env_to_uc


def write_settings_updates(updates: dict):
    """Write connector credentials to Claude pluginConfigs options.

    `updates` keys are userConfig keys (e.g. auvik_api_key) OR UPPER_ENV keys.
    """
    allowed_uc, allowed_env, env_to_uc = _allowlisted_credential_keys()

    normalized = {}
    env_updates = {}
    bad = []
    for k, v in list(updates.items()):
        if not isinstance(v, str):
            v = str(v)
        v = v.replace("\n", "").replace("\r", "")
        key = (k or "").strip()
        if not key:
            bad.append(k)
            continue
        if key in allowed_uc:
            normalized[key] = v
            env_updates[key.upper()] = v
        elif key in env_to_uc:
            uk = env_to_uc[key]
            normalized[uk] = v
            env_updates[key if key.isupper() else uk.upper()] = v
        elif key.upper() in env_to_uc:
            uk = env_to_uc[key.upper()]
            normalized[uk] = v
            env_updates[key.upper()] = v
        elif key in allowed_env or key.upper() in allowed_env:
            ek = key if key in allowed_env else key.upper()
            env_updates[ek] = v
            low = ek.lower()
            if low in allowed_uc:
                normalized[low] = v
            elif ek.lower().replace("-", "_") in allowed_uc:
                normalized[ek.lower().replace("-", "_")] = v
        else:
            bad.append(key)
    if bad:
        return {
            "ok": False,
            "error": "keys_not_allowlisted",
            "keys": bad,
            "hint": "Use plugin userConfig keys (auvik_api_key) or ENV keys (AUVIK_API_KEY).",
            "allowed_user_config_sample": sorted(allowed_uc)[:12],
        }
    if not normalized and not env_updates:
        return {"ok": False, "error": "no_valid_updates"}

    settings_path = _settings_path()
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        data = (
            json.loads(settings_path.read_text(encoding="utf-8"))
            if settings_path.is_file()
            else {}
        )
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
    _uc, allowed, _map = _allowlisted_credential_keys()
    # normalize update keys to UPPER env form when possible
    norm_updates = {}
    bad = []
    for k, v in updates.items():
        if k in allowed or k.upper() in allowed:
            norm_updates[k if k in allowed else k.upper()] = v
        elif k.lower() in _uc:
            norm_updates[k.upper()] = v
        else:
            bad.append(k)
    if bad:
        return {"ok": False, "error": "keys_not_allowlisted", "keys": bad}
    updates = norm_updates
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
/* ===== Design tokens (8px grid) ===== */
:root{
  --s1:8px; --s2:16px; --s3:24px; --s4:32px;
  --sidebar:240px;
  --bg:#080d18; --bg-elev:#0e1626; --panel:#121b2e; --panel-2:#182338;
  --border:#273552; --border-soft:#1e2b44;
  --text:#edf2ff; --muted:#8b9bb8; --faint:#5f6f8c;
  --accent:#4f8cff; --accent-2:#6ea1ff; --cyan:#35d6c7;
  --good:#34d399; --warn:#fbbf24; --bad:#f87171;
  --radius:12px; --radius-sm:8px;
  --shadow:0 8px 24px rgba(0,0,0,.35);
  --font:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --control-h:36px;
  --header-h:64px;
}
*,*::before,*::after{box-sizing:border-box}
html,body{height:100%; margin:0; overflow-x:hidden}
body{
  font:13.5px/1.4 var(--font); color:var(--text); background:var(--bg);
  background-image:
    radial-gradient(900px 480px at 0% -10%, rgba(79,140,255,.14), transparent 60%),
    radial-gradient(700px 400px at 100% 0%, rgba(53,214,199,.08), transparent 55%);
  background-attachment:fixed;
}
img,svg{display:block; max-width:100%}
button,input,select,textarea{
  font:inherit; color:var(--text); background:var(--panel-2);
  border:1px solid var(--border); border-radius:var(--radius-sm);
  height:var(--control-h); padding:0 12px; margin:0;
}
button{cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:6px; white-space:nowrap}
button:hover{border-color:var(--accent); background:#1c2c4a}
button.primary{background:linear-gradient(180deg,#3b6fd0,#2a56ad); border-color:#5b8fff; font-weight:600}
button.ghost{background:transparent}
input,select{width:100%; min-width:0}
input:focus,select:focus,button:focus{outline:2px solid rgba(79,140,255,.35); outline-offset:1px}
.mono{font-family:var(--mono); font-size:12px}
.muted{color:var(--muted)} .faint{color:var(--faint)}
.good{color:var(--good)} .warn{color:var(--warn)} .bad{color:var(--bad)}
.hidden{display:none !important}
.truncate{overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0}
.sr-only{position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); border:0}

/* ===== App shell ===== */
.app{
  display:grid;
  grid-template-columns:var(--sidebar) minmax(0,1fr);
  min-height:100vh;
  width:100%;
  max-width:100vw;
  overflow-x:hidden;
}
@media(max-width:960px){
  .app{grid-template-columns:minmax(0,1fr)}
  .side{position:relative !important; height:auto !important; border-right:0 !important; border-bottom:1px solid var(--border)}
}

/* Sidebar */
.side{
  position:sticky; top:0; height:100vh; overflow:auto;
  padding:var(--s2);
  border-right:1px solid var(--border);
  background:linear-gradient(180deg, #0b1322 0%, #090f1b 100%);
  display:flex; flex-direction:column; gap:var(--s2);
}
.brand{display:grid; grid-template-columns:40px minmax(0,1fr); gap:12px; align-items:center; padding:4px}
.brand img{width:40px; height:40px; border-radius:10px; box-shadow:0 0 0 1px rgba(79,140,255,.35)}
.brand b{font-size:14px; line-height:1.2}
.brand span{font-size:11px; color:var(--muted)}
.nav{display:flex; flex-direction:column; gap:4px}
.nav button{
  width:100%; height:40px; justify-content:flex-start;
  padding:0 12px; background:transparent; border-color:transparent; color:var(--muted);
}
.nav button svg{width:16px; height:16px; flex:0 0 16px}
.nav button.active,.nav button:hover{color:var(--text); background:rgba(79,140,255,.12); border-color:rgba(79,140,255,.25)}
.side-meta{
  margin-top:auto; padding:12px; border:1px solid var(--border-soft); border-radius:var(--radius);
  background:rgba(255,255,255,.02); display:grid; gap:8px;
}
.side-meta .row{display:grid; grid-template-columns:72px minmax(0,1fr); gap:8px; align-items:center; font-size:12px}
.side-meta .row span:last-child{min-width:0; overflow:hidden; text-overflow:ellipsis}

/* Main column */
.main{min-width:0; max-width:100%; display:flex; flex-direction:column; overflow-x:hidden}
.topbar{
  position:sticky; top:0; z-index:30;
  height:var(--header-h); min-height:var(--header-h);
  display:grid; grid-template-columns:minmax(0,1fr) auto; gap:var(--s2); align-items:center;
  padding:0 var(--s3); border-bottom:1px solid var(--border);
  background:rgba(8,13,24,.9); backdrop-filter:blur(10px);
}
.topbar h1{margin:0; font-size:16px; font-weight:650; line-height:1.2}
.topbar .sub{margin:2px 0 0; font-size:12px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.toolbar{
  display:grid; grid-auto-flow:column; grid-auto-columns:minmax(140px,180px) minmax(160px,220px) auto auto;
  gap:10px; align-items:end;
}
.field-ctl{display:grid; gap:4px; min-width:0}
.field-ctl > span{font-size:11px; color:var(--muted); line-height:1}
.field-ctl select{width:100%}
.toolbar > button{align-self:end}
@media(max-width:1100px){
  .topbar{height:auto; min-height:var(--header-h); padding:12px var(--s2); grid-template-columns:1fr}
  .toolbar{grid-auto-flow:row; grid-auto-columns:1fr; grid-template-columns:1fr 1fr; width:100%}
  .toolbar > button{grid-column:span 1}
}

.content{
  padding:var(--s3);
  display:grid; gap:var(--s2);
  width:100%; max-width:100%;
  min-width:0; overflow-x:hidden;
}
@media(max-width:960px){.content{padding:var(--s2)}}

/* Surfaces */
.card{
  background:var(--panel); border:1px solid var(--border); border-radius:var(--radius);
  padding:var(--s2); min-width:0; overflow:hidden;
}
.card-title{
  margin:0 0 12px; font-size:11px; letter-spacing:.06em; text-transform:uppercase;
  color:var(--muted); display:flex; align-items:center; gap:8px; min-width:0;
}
.card-title svg{width:14px; height:14px; color:var(--accent-2); flex:0 0 auto}
.pill{
  display:inline-flex; align-items:center; gap:6px; height:22px; padding:0 8px;
  border-radius:999px; border:1px solid var(--border); background:rgba(255,255,255,.04);
  color:var(--muted); font-size:11px; white-space:nowrap;
}
.pill.live{color:var(--good); border-color:rgba(52,211,153,.35); background:rgba(52,211,153,.08)}
.dot{width:6px; height:6px; border-radius:50%; background:var(--good); box-shadow:0 0 0 0 rgba(52,211,153,.5); animation:pulse 1.6s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(52,211,153,.5)}70%{box-shadow:0 0 0 8px transparent}100%{box-shadow:0 0 0 0 transparent}}

/* Overview */
.hero{
  display:grid; grid-template-columns:minmax(0,1.4fr) minmax(0,.9fr); gap:var(--s2); align-items:stretch;
  min-height:140px; padding:var(--s3); border-radius:16px; border:1px solid rgba(79,140,255,.28);
  background:
    linear-gradient(105deg, rgba(10,16,30,.88) 0%, rgba(10,16,30,.55) 48%, rgba(10,16,30,.72) 100%),
    url('/assets/hero.jpg') right center / cover no-repeat;
  overflow:hidden;
}
.hero h2{margin:0 0 8px; font-size:20px; line-height:1.25}
.hero p{margin:0; color:#c5d2ec; max-width:48ch}
.hero-stats{display:grid; grid-template-columns:1fr 1fr; gap:8px; min-width:0}
.stat{
  background:rgba(8,13,24,.55); border:1px solid rgba(255,255,255,.1); border-radius:var(--radius-sm);
  padding:10px 12px; min-width:0;
}
.stat b{display:block; font-size:18px; line-height:1.2}
.stat span{display:block; margin-top:2px; font-size:11px; color:#b7c5e4}
@media(max-width:900px){.hero{grid-template-columns:1fr}}

.kpis{display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:var(--s2)}
@media(max-width:1100px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
.kpi{
  background:var(--panel); border:1px solid var(--border); border-radius:var(--radius);
  padding:14px; min-width:0; display:grid; gap:10px;
}
.kpi-top{display:flex; justify-content:space-between; align-items:center; gap:8px}
.kpi-ico{
  width:32px; height:32px; border-radius:8px; display:grid; place-items:center;
  background:rgba(79,140,255,.12); border:1px solid rgba(79,140,255,.25); color:var(--accent-2);
}
.kpi-ico svg{width:16px; height:16px}
.kpi-val{font-size:24px; font-weight:700; letter-spacing:-.02em; line-height:1}
.kpi-bar{height:6px; border-radius:99px; background:rgba(255,255,255,.06); overflow:hidden}
.kpi-bar > i{display:block; height:100%; width:0; background:linear-gradient(90deg,var(--accent),var(--cyan))}

.grid-2{display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:var(--s2); min-width:0}
@media(max-width:1100px){.grid-2{grid-template-columns:minmax(0,1fr)}}

/* Live page */
.live-layout{display:grid; grid-template-columns:minmax(0,320px) minmax(0,1fr); gap:var(--s2); min-width:0; align-items:start}
@media(max-width:1100px){.live-layout{grid-template-columns:minmax(0,1fr)}}
.session-list{display:grid; gap:8px; max-height:calc(100vh - 220px); overflow:auto; padding-right:2px}
.session-item{
  border:1px solid var(--border); border-radius:var(--radius-sm); padding:12px;
  background:rgba(255,255,255,.02); cursor:pointer; min-width:0;
}
.session-item:hover,.session-item.active{border-color:rgba(79,140,255,.5); background:rgba(79,140,255,.08)}
.session-item .t{display:flex; justify-content:space-between; gap:8px; align-items:center; min-width:0}
.session-item .t strong{min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.chip{
  display:inline-flex; align-items:center; height:20px; padding:0 8px; border-radius:999px;
  border:1px solid var(--border); background:rgba(255,255,255,.04); color:var(--muted);
  font-size:11px; white-space:nowrap; margin:0 4px 4px 0;
}
.chip.live{color:var(--good); border-color:rgba(52,211,153,.35)}
.chips{display:flex; flex-wrap:wrap; gap:0; margin-top:8px}

table{width:100%; border-collapse:collapse; table-layout:fixed}
th,td{text-align:left; padding:8px 8px; border-bottom:1px solid var(--border-soft); vertical-align:top; overflow:hidden; text-overflow:ellipsis}
th{color:var(--muted); font-size:11px; letter-spacing:.04em; text-transform:uppercase; font-weight:600}
.scroll{max-height:280px; overflow:auto; min-width:0}
.banner{
  padding:10px 12px; border-radius:var(--radius-sm); border:1px solid rgba(79,140,255,.28);
  background:rgba(79,140,255,.08); color:#d3e2ff; font-size:12.5px;
}
.empty{
  padding:20px; text-align:center; color:var(--muted);
  border:1px dashed var(--border); border-radius:var(--radius-sm);
}

/* Connectors: equal-height 1/3 cards */
.connector-grid{
  display:grid;
  grid-template-columns:repeat(3, minmax(0, 1fr));
  gap:var(--s2);
  align-items:stretch;
  width:100%;
  min-width:0;
}
@media(max-width:1100px){.connector-grid{grid-template-columns:repeat(2, minmax(0,1fr))}}
@media(max-width:720px){.connector-grid{grid-template-columns:minmax(0,1fr)}}
.conn-card{
  min-width:0; min-height:320px; height:100%;
  display:grid;
  grid-template-rows:auto minmax(0,1fr) auto;
  gap:10px;
  padding:12px;
  border:1px solid var(--border);
  border-radius:var(--radius);
  background:var(--panel-2);
  overflow:hidden;
}
.conn-card .hdr{
  display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:start;
  min-height:40px;
}
.conn-card .name{display:grid; grid-template-columns:28px minmax(0,1fr); gap:8px; align-items:center; min-width:0}
.conn-card .avatar{
  width:28px; height:28px; border-radius:8px; display:grid; place-items:center;
  font-size:10px; font-weight:700; color:#e8efff;
  background:linear-gradient(135deg, rgba(79,140,255,.4), rgba(53,214,199,.2));
  border:1px solid rgba(79,140,255,.3);
}
.conn-card .name strong{font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.conn-card .fields{
  min-height:0; overflow:auto;
  display:grid; gap:8px; align-content:start;
  padding-right:2px;
}
.field{display:grid; gap:4px; min-width:0}
.field label{
  display:grid; grid-template-columns:minmax(0,1fr) auto; gap:6px; align-items:center;
  font-size:10px; color:var(--muted); font-family:var(--mono);
}
.field label span:first-child{overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.field input{height:32px; padding:0 8px; font-size:12px; width:100%; min-width:0}
.conn-card .actions{display:grid; grid-template-columns:1fr; gap:8px}
.conn-card .actions button{width:100%; height:34px}

.sec-note{margin:0 0 12px; color:var(--muted); font-size:12.5px; line-height:1.45}
.flash{padding:10px 12px; border-radius:var(--radius-sm); margin:0 0 12px; border:1px solid var(--border)}
.flash.ok{border-color:rgba(52,211,153,.4); background:rgba(52,211,153,.08)}
.flash.err{border-color:rgba(248,113,113,.4); background:rgba(248,113,113,.08)}
.toast{
  position:fixed; right:16px; bottom:16px; z-index:80; max-width:min(360px, calc(100vw - 32px));
  padding:12px 14px; border-radius:var(--radius); border:1px solid var(--border);
  background:rgba(18,28,46,.96); box-shadow:var(--shadow); display:none;
}
.toast.show{display:block}

/* ===== Controls shared by the Behavior and Ecosystem pages ===== */
textarea{
  width:100%; min-height:180px; height:auto; padding:10px 12px; resize:vertical;
  font:12px/1.5 var(--mono);
}
.switch{
  position:relative; flex:0 0 auto; width:42px; height:24px; padding:0; border-radius:999px;
  background:var(--panel-2); border:1px solid var(--border); cursor:pointer;
}
.switch::after{
  content:""; position:absolute; top:3px; left:3px; width:16px; height:16px; border-radius:50%;
  background:var(--faint); transition:transform .16s ease, background .16s ease;
}
.switch[aria-checked="true"]{background:rgba(52,211,153,.16); border-color:rgba(52,211,153,.5)}
.switch[aria-checked="true"]::after{transform:translateX(18px); background:var(--good)}
.switch:disabled{opacity:.45; cursor:not-allowed}
@media(prefers-reduced-motion:reduce){.switch::after{transition:none}}

/* Behavior page */
.knob-grid{display:grid; gap:10px}
.knob{
  display:grid; grid-template-columns:minmax(0,1fr) minmax(150px,260px);
  gap:12px; align-items:start;
  padding:12px; border:1px solid var(--border-soft); border-radius:var(--radius-sm);
  background:rgba(255,255,255,.02);
}
.knob .k-name{display:flex; align-items:center; gap:8px; flex-wrap:wrap}
.knob .k-name strong{font-size:13px; font-weight:600}
.knob p{margin:6px 0 0; color:var(--muted); font-size:12.5px; line-height:1.45; max-width:74ch}
.knob .k-ref{margin-top:6px; font-family:var(--mono); font-size:11px; color:var(--faint)}
.knob .k-ctl{display:flex; justify-content:flex-end; align-items:center; gap:8px; min-width:0}
.knob .k-ctl input,.knob .k-ctl select{max-width:100%}
@media(max-width:760px){.knob{grid-template-columns:minmax(0,1fr)} .knob .k-ctl{justify-content:flex-start}}
.src{font-family:var(--mono); font-size:10px; letter-spacing:.04em; text-transform:uppercase; color:var(--faint)}
.src.settings{color:var(--accent-2)}
.sticky-save{
  position:sticky; bottom:0; z-index:20; margin-top:var(--s2);
  display:flex; gap:10px; align-items:center; justify-content:flex-end; flex-wrap:wrap;
  padding:12px; border:1px solid var(--border); border-radius:var(--radius);
  background:rgba(18,28,46,.96); backdrop-filter:blur(8px);
}
.sticky-save .msg{margin-right:auto; color:var(--muted); font-size:12.5px}

/* Ecosystem page */
.eco-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:var(--s2)}
.eco-card{
  display:grid; grid-template-rows:auto auto 1fr auto; gap:8px;
  padding:12px; border:1px solid var(--border); border-radius:var(--radius);
  background:var(--panel-2); min-width:0;
}
.eco-card.off{opacity:.62}
.eco-card .hdr{display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:center}
.eco-card .hdr strong{font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block}
.eco-card p{margin:0; color:var(--muted); font-size:12px; line-height:1.45;
  display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden}
.eco-card.host{border-color:rgba(79,140,255,.45); background:rgba(79,140,255,.06)}
.subnav{display:flex; gap:6px; flex-wrap:wrap; margin-bottom:var(--s2)}
.subnav button{height:30px; padding:0 12px; font-size:12px; background:transparent; color:var(--muted)}
.subnav button.active{color:var(--text); background:rgba(79,140,255,.14); border-color:rgba(79,140,255,.35)}
.tag-list{display:flex; flex-wrap:wrap; gap:6px}
.tag{
  font-family:var(--mono); font-size:11px; padding:3px 8px; border-radius:6px;
  border:1px solid var(--border-soft); background:rgba(255,255,255,.03); color:var(--muted);
}
.tag.ok{color:var(--good); border-color:rgba(52,211,153,.3)}
.tag.no{color:var(--bad); border-color:rgba(248,113,113,.3)}
.form-row{display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; align-items:end}
.form-row .field-ctl span{font-size:11px}
</style>
</head>
<body>
<div class="app">
  <aside class="side">
    <div class="brand">
      <img src="/assets/mark.svg" alt="Atlas mark" width="40" height="40"/>
      <div class="truncate">
        <b>Atlas</b>
        <span>Command Center</span>
      </div>
    </div>
    <nav class="nav" id="nav" aria-label="Primary">
      <button class="active" data-tab="overview" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z"/></svg>
        Overview
      </button>
      <button data-tab="live" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h3l2-7 4 14 2-7h3"/></svg>
        Live sessions
      </button>
      <button data-tab="settings" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>
        Connectors
      </button>
      <button data-tab="behavior" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>
        Behavior
      </button>
      <button data-tab="ecosystem" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="4" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M12 6.5v3M10 13.5 6.6 16.4M14 13.5l3.4 2.9"/></svg>
        Ecosystem
      </button>
      <button data-tab="findings" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 4 7v5c0 4.5 3.4 7.6 8 8 4.6-.4 8-3.5 8-8V7l-8-4z"/></svg>
        Findings
      </button>
    </nav>
    <div class="side-meta">
      <div class="row"><span class="muted">Daemon</span><span class="pill live"><span class="dot"></span>online</span></div>
      <div class="row"><span class="muted">Plugin</span><span class="mono truncate" id="sideVer">—</span></div>
      <div class="row"><span class="muted">Updated</span><span class="truncate" id="sideUpdated">—</span></div>
      <div class="row"><span class="muted">DB</span><span class="mono truncate" id="sideDb" title="">—</span></div>
    </div>
  </aside>

  <div class="main">
    <header class="topbar">
      <div class="truncate">
        <h1 id="pageTitle">Overview</h1>
        <div class="sub">Shared multi-session observability · <span class="mono" id="url"></span></div>
      </div>
      <div class="toolbar">
        <label class="field-ctl">
          <span>Project</span>
          <select id="project" aria-label="Project filter"></select>
        </label>
        <label class="field-ctl">
          <span>Session</span>
          <select id="session" aria-label="Session selector"></select>
        </label>
        <button type="button" id="refresh" class="ghost">Refresh</button>
        <button type="button" id="gotoSettings" class="primary">Credentials</button>
      </div>
    </header>

    <main class="content">
      <section id="tab-overview">
        <div class="hero">
          <div>
            <div class="pill live" style="margin-bottom:10px"><span class="dot"></span> Marketplace command center</div>
            <h2>See what every terminal is doing</h2>
            <p>Live sessions, tool activity, savings proxies, and connector credentials in one loopback UI.</p>
          </div>
          <div class="hero-stats">
            <div class="stat"><b id="heroLive">0</b><span>Live sessions (10m)</span></div>
            <div class="stat"><b id="heroTools">0</b><span>Tool calls (10m)</span></div>
            <div class="stat"><b id="heroConn">0</b><span>Connectors ready</span></div>
            <div class="stat"><b id="heroFindings">0</b><span>Open findings</span></div>
          </div>
        </div>
        <div class="kpis" id="kpis"></div>
        <div class="grid-2">
          <section class="card">
            <h3 class="card-title">Savings proxies</h3>
            <div id="savings" class="muted">—</div>
          </section>
          <section class="card">
            <h3 class="card-title">Live activity pulse</h3>
            <div id="pulse" class="muted">—</div>
          </section>
        </div>
        <section class="card">
          <h3 class="card-title">Recent runs</h3>
          <div class="scroll">
            <table>
              <thead><tr><th style="width:18%">When</th><th style="width:28%">Project</th><th style="width:14%">Kind</th><th style="width:12%">Disp</th><th style="width:12%">Inline</th><th style="width:16%">Verifier</th></tr></thead>
              <tbody id="recentRuns"></tbody>
            </table>
          </div>
        </section>
      </section>

      <section id="tab-live" class="hidden">
        <div class="banner" id="hint"></div>
        <div class="live-layout">
          <section class="card">
            <h3 class="card-title">Sessions <span class="pill" id="sessionCount">0</span></h3>
            <div class="session-list" id="sessionList"></div>
          </section>
          <div style="display:grid; gap:16px; min-width:0">
            <section class="card">
              <h3 class="card-title">Selected session</h3>
              <div id="detail" class="muted">Pick a session…</div>
            </section>
            <div class="grid-2">
              <section class="card">
                <h3 class="card-title">Recent tools</h3>
                <div class="scroll">
                  <table>
                    <thead><tr><th style="width:28%">When</th><th style="width:32%">Tool</th><th>Target</th></tr></thead>
                    <tbody id="tools"></tbody>
                  </table>
                </div>
              </section>
              <section class="card">
                <h3 class="card-title">Events / dispatches</h3>
                <div class="scroll">
                  <table>
                    <thead><tr><th style="width:28%">When</th><th style="width:24%">Kind</th><th>Detail</th></tr></thead>
                    <tbody id="events"></tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        </div>
      </section>

      <section id="tab-settings" class="hidden">
        <section class="card">
          <h3 class="card-title">Connector credentials</h3>
          <p class="sec-note">
            Equal-height cards at one-third width. Saves to
            <span class="mono" id="settingsPath">~/.claude/settings.json</span>
            <span class="mono">pluginConfigs["atlas@tech-tools"].options</span>
            and this plugin’s <span class="mono">.env</span>.
            Secrets are never read back. Drafts survive auto-refresh. Reload Claude Code after save.
          </p>
          <div id="settingsFlash"></div>
          <div class="connector-grid" id="connectorForms"></div>
        </section>

        <section class="card">
          <h3 class="card-title">Bulk import and export</h3>
          <p class="sec-note">
            Paste a block of <span class="mono">KEY=VALUE</span> lines to fill many connectors at once.
            Only keys this plugin declares are accepted; anything else is rejected by name.
            Export writes a template with secrets blanked out.
          </p>
          <textarea id="bulkEnv" spellcheck="false" autocomplete="off"
            placeholder="AUVIK_USERNAME=you@example.com&#10;AUVIK_API_KEY=..."></textarea>
          <div class="sticky-save">
            <span class="msg" id="bulkMsg">Nothing pasted yet.</span>
            <button type="button" class="ghost" id="bulkExport">Load template</button>
            <button type="button" class="primary" id="bulkImport">Import pasted keys</button>
          </div>
        </section>
      </section>

      <section id="tab-behavior" class="hidden">
        <section class="card">
          <h3 class="card-title">How atlas behaves</h3>
          <p class="sec-note">
            These are the environment variables the atlas hooks read at runtime. Saving writes them to
            <span class="mono" id="behaviorPath">~/.claude/settings.json</span> under
            <span class="mono">"env"</span>, which Claude Code exports into every hook process.
            Each knob shows the file and line that reads it. Reload Claude Code for a change to reach a running session.
          </p>
          <div id="behaviorFlash"></div>
          <div id="behaviorGroups"></div>
          <div class="sticky-save">
            <span class="msg" id="behaviorMsg">No changes.</span>
            <button type="button" class="ghost" id="behaviorReset">Discard changes</button>
            <button type="button" class="primary" id="behaviorSave">Save behavior</button>
          </div>
        </section>

        <section class="card">
          <h3 class="card-title">Advanced variables</h3>
          <p class="sec-note">
            Every other <span class="mono">ATLAS_*</span> variable found in the shipped hooks and scripts.
            Blank means the code falls back to its built-in default. Clear a field to remove the override.
          </p>
          <div class="scroll" style="max-height:min(50vh,420px)">
            <table>
              <thead><tr><th style="width:32%">Variable</th><th style="width:40%">Value</th><th style="width:28%">Read at</th></tr></thead>
              <tbody id="behaviorAdvanced"></tbody>
            </table>
          </div>
        </section>
      </section>

      <section id="tab-ecosystem" class="hidden">
        <div class="subnav" id="ecoNav" role="tablist">
          <button type="button" class="active" data-eco="wiring">Atlas wiring</button>
          <button type="button" data-eco="plugins">Plugins</button>
          <button type="button" data-eco="mcp">MCP servers</button>
          <button type="button" data-eco="capabilities">Skills &amp; agents</button>
        </div>
        <div id="ecoFlash"></div>

        <section class="card" id="eco-wiring">
          <h3 class="card-title">Atlas wiring</h3>
          <p class="sec-note" id="ecoWiringNote">—</p>
          <div class="scroll" style="max-height:min(60vh,520px)">
            <table>
              <thead><tr><th style="width:22%">Event</th><th style="width:16%">Matcher</th><th style="width:44%">Program</th><th style="width:18%">On disk</th></tr></thead>
              <tbody id="ecoBindings"></tbody>
            </table>
          </div>
        </section>

        <section class="card hidden" id="eco-plugins">
          <h3 class="card-title">Installed plugins <span class="pill" id="pluginCount">0</span></h3>
          <p class="sec-note">
            Toggling writes <span class="mono">enabledPlugins</span> in settings.json. Reload Claude Code to apply.
            Atlas serves this page, so it cannot switch itself off here.
          </p>
          <div class="eco-grid" id="pluginGrid"></div>
        </section>

        <section class="card hidden" id="eco-mcp">
          <h3 class="card-title">MCP servers <span class="pill" id="mcpCount">0</span></h3>
          <p class="sec-note">
            Plugin servers and the user-scope servers in <span class="mono" id="claudeJsonPath">~/.claude.json</span>.
            Turning one off adds it to <span class="mono">disabledMcpServers</span>; the config stays intact.
          </p>
          <div class="eco-grid" id="mcpGrid"></div>
          <h3 class="card-title" style="margin-top:var(--s3)">Add a user-scope server</h3>
          <div class="form-row">
            <label class="field-ctl"><span>Name</span><input id="mcpName" placeholder="my-server" autocomplete="off"/></label>
            <label class="field-ctl"><span>Command</span><input id="mcpCommand" placeholder="npx" autocomplete="off"/></label>
            <label class="field-ctl"><span>Arguments</span><input id="mcpArgs" placeholder="-y @scope/package" autocomplete="off"/></label>
            <label class="field-ctl"><span>Or HTTP URL</span><input id="mcpUrl" placeholder="https://example.com/mcp" autocomplete="off"/></label>
            <button type="button" class="primary" id="mcpAdd">Add server</button>
          </div>
        </section>

        <section class="card hidden" id="eco-capabilities">
          <h3 class="card-title">Skills, agents and output styles</h3>
          <p class="sec-note">What this install can reach, grouped by where it comes from.</p>
          <div class="grid-2" id="capabilityGrid"></div>
        </section>
      </section>

      <section id="tab-findings" class="hidden">
        <section class="card">
          <h3 class="card-title">Findings</h3>
          <div class="scroll" style="max-height:min(70vh,640px)">
            <table>
              <thead><tr><th style="width:12%">Sev</th><th style="width:46%">Title</th><th style="width:24%">Dimension</th><th style="width:18%">Status</th></tr></thead>
              <tbody id="findings"></tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  </div>
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>

<script>
const $ = id => document.getElementById(id);
const state = {
  snapshot:null, selectedSession:null, selectedProject:null, tab:'overview',
  drafts:{}, settingsDirty:false, settingsFocus:false,
  behavior:null, behaviorEdits:{}, ecosystem:null, ecoPane:'wiring'
};
// Plugin manifests and MCP configs are third-party text rendered into innerHTML.
const esc = v => String(v==null?'':v).replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ICO = {
  users:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><circle cx="16" cy="9" r="2.5"/><path d="M3 19a6 6 0 0 1 12 0"/><path d="M13 19a5 5 0 0 1 8 0"/></svg>`,
  tools:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m14 7 3-3 3 3-3 3"/><path d="m4 20 8-8"/><path d="M10 7a4.5 4.5 0 0 0 6 6"/></svg>`,
  bolt:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13 2 4 14h7l-1 8 10-12h-7l1-8z"/></svg>`,
  shield:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 4 7v5c0 4.5 3.4 7.6 8 8 4.6-.4 8-3.5 8-8V7l-8-4z"/></svg>`,
};

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
function folder(p){ if(!p) return ''; const parts=String(p).replace(/\\\\/g,'/').split('/').filter(Boolean); return parts[parts.length-1]||''; }
function toast(msg, ok){
  const el=$('toast');
  el.textContent=msg;
  el.style.borderColor = ok ? 'rgba(52,211,153,.45)' : 'rgba(248,113,113,.45)';
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t=setTimeout(()=>el.classList.remove('show'), 3000);
}
async function api(path, opts){
  const r = await fetch(path, Object.assign({cache:'no-store'}, opts||{}));
  const data = await r.json();
  if(!r.ok) throw new Error(data.error || (path+' '+r.status));
  return data;
}
function avatar(name){
  return `<div class="avatar">${(name||'?').slice(0,2).toUpperCase()}</div>`;
}
function kpi(icon, label, value, bar){
  const w = Math.max(0, Math.min(100, bar||0));
  return `<div class="kpi"><div class="kpi-top"><div class="kpi-ico">${icon}</div><span class="pill">${label}</span></div>
    <div class="kpi-val">${value}</div><div class="kpi-bar"><i style="width:${w}%"></i></div></div>`;
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
  $('kpis').innerHTML = [
    kpi(ICO.users, 'Live sessions', num(live), Math.min(100, live*25)),
    kpi(ICO.tools, 'Tools / 10m', num(act.tool_calls||0), Math.min(100, (act.tool_calls||0)*4)),
    kpi(ICO.bolt, 'Dispatches', num(t.sum_dispatches), Math.min(100, (t.sum_dispatches||0)/10)),
    kpi(ICO.shield, 'Avg verifier', pct(t.avg_verifier_coverage), (t.avg_verifier_coverage==null?0:Number(t.avg_verifier_coverage)*100)),
  ].join('');
  const v = s.savings||{};
  $('savings').innerHTML = `
    <div class="chips">
      <span class="chip">dispatch/inline ${v.dispatch_ratio==null?'—':Number(v.dispatch_ratio).toFixed(2)}</span>
      <span class="chip">recall ${pct(v.recall_hit_rate)}</span>
      <span class="chip">verifier ${pct(v.avg_verifier_coverage)}</span>
    </div>
    <div class="muted" style="margin:8px 0">${v.note||''}</div>
    <div>Dispatches <strong>${num(v.dispatches)}</strong> · Inline <strong>${num(v.inline_ops)}</strong> · Est tokens <strong>${num(v.est_context_tokens)}</strong></div>`;
  const tools = act.tool_calls||0, events = act.events||0;
  $('pulse').innerHTML = `
    <div class="grid-2" style="margin-bottom:8px">
      <div class="stat"><b>${num(tools)}</b><span>tool_calls · 10m</span><div class="kpi-bar" style="margin-top:8px"><i style="width:${Math.min(100,tools*5)}%"></i></div></div>
      <div class="stat"><b>${num(events)}</b><span>events · 10m</span><div class="kpi-bar" style="margin-top:8px"><i style="width:${Math.min(100,events*8)}%;background:linear-gradient(90deg,#9b7bff,var(--accent))"></i></div></div>
    </div>
    <div class="muted">LIVE requires tool/event activity in the last 10 minutes.</div>`;
  const runs = (s.health?.recent_runs||[]).slice(0,12);
  $('recentRuns').innerHTML = runs.map(r => `
    <tr>
      <td class="muted">${ago(r.started_at)}</td>
      <td class="truncate" title="${r.project_name||''}">${r.project_name || folder(r.root_path) || '—'}</td>
      <td class="mono truncate">${r.kind||'—'}</td>
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
      const label = `${p.folder||p.name||'project'}${p.age?(' · '+p.age):''}`;
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
    const name = x.project_folder || x.project_name || folder(x.cwd) || 'project';
    return `<div class="session-item ${active}" data-sid="${x.session_id}">
      <div class="t"><strong title="${name}">${name}</strong>${live}</div>
      <div class="mono muted">${shortId(x.session_id)} · ${ago(x.last_activity_at || x.started_at)}</div>
      <div class="muted truncate" style="margin-top:4px" title="${x.cwd||x.project_root||''}">${x.cwd||x.project_root||''}</div>
      <div class="chips">
        <span class="chip">tools ${num(x.recent_tool_calls)}</span>
        <span class="chip">disp ${num(x.dispatches)}</span>
        <span class="chip">inline ${num(x.inline_ops)}</span>
      </div>
    </div>`;
  }).join('') || '<div class="empty">No recent sessions (last 7 days).</div>';
  document.querySelectorAll('#sessionList .session-item').forEach(el => {
    el.onclick = () => { state.selectedSession = el.dataset.sid; loadDetail(); renderSessionList(state.snapshot); };
  });
}
function renderFindings(s){
  $('findings').innerHTML = (s.findings||[]).slice(0,50).map(f =>
    `<tr><td class="${f.severity==='high'||f.severity==='critical'?'bad':'warn'}">${f.severity||''}</td>
     <td class="truncate" title="${(f.title||'').replace(/"/g,'&quot;')}">${f.title||''}</td>
     <td class="muted truncate">${f.dimension||''}</td><td>${f.status||''}</td></tr>`
  ).join('') || '<tr><td colspan="4" class="muted">No findings</td></tr>';
}

function renderSettings(s){
  if(state.settingsDirty || state.settingsFocus){ updateSettingsBadges(s); return; }
  $('settingsPath').textContent = s.settings_path || '~/.claude/settings.json';
  const connectors = s.connectors||[];
  // Normalize visual density: always render a stable field stack height via scroll area
  $('connectorForms').innerHTML = connectors.map(c => {
    const fields = (c.fields||[]).map(f => {
      const key = f.user_config_key || f.env_key;
      const set = !!f.is_set;
      const src = f.source && f.source !== 'missing' ? f.source : '';
      // Secrets come back empty by design; everything else prefills so it can be edited.
      const current = state.drafts[key] != null ? state.drafts[key] : (f.value || '');
      return `<div class="field">
        <label><span title="${esc(key)}">${esc(key)}</span><span class="${set?'good':'warn'}">${set?'set':'missing'}${src?(' · '+esc(src)):''}</span></label>
        <input data-key="${esc(key)}" data-original="${esc(f.value||'')}" type="${f.sensitive?'password':'text'}" value="${esc(current)}"
          placeholder="${f.sensitive?(set?'set — type to replace':'enter secret'):'not set'}" autocomplete="off" spellcheck="false"/>
      </div>`;
    }).join('') || '<div class="muted">No fields</div>';
    const on = c.enabled !== false;
    return `<article class="conn-card${on?'':' off'}" data-connector="${esc(c.name)}">
      <div class="hdr">
        <div class="name">${avatar(c.name)}
          <div class="truncate"><strong class="mono" title="${esc(c.name)}">${esc(c.name)}</strong>
          <div class="faint" style="font-size:11px">${(c.fields||[]).length} keys</div></div>
        </div>
        <div style="display:grid; gap:6px; justify-items:end">
          <button type="button" class="switch" role="switch" aria-checked="${on}"
            aria-label="Enable ${esc(c.name)}" data-toggle-connector="${esc(c.server_name||('plugin:atlas:'+c.name))}"></button>
          <span class="chip ${c.configured_hint?'live':''}" data-configured-chip="${esc(c.name)}">${c.configured_hint?'ready':'needs keys'}</span>
        </div>
      </div>
      <div class="fields">${fields}</div>
      <div class="actions" style="grid-template-columns:1fr 1fr">
        <button type="button" class="ghost" data-test-connector="${esc(c.name)}">Test</button>
        <button type="button" class="primary" data-save-connector="${esc(c.name)}">Save</button>
      </div>
    </article>`;
  }).join('') || '<div class="empty">No connectors in .mcp.json</div>';
  bindSettingsHandlers();
}
function updateSettingsBadges(s){
  const byName={}; (s.connectors||[]).forEach(c => byName[c.name]=c);
  document.querySelectorAll('[data-configured-chip]').forEach(el => {
    const c=byName[el.dataset.configuredChip]; if(!c) return;
    el.textContent = c.configured_hint ? 'ready' : 'needs keys';
    el.classList.toggle('live', !!c.configured_hint);
  });
  const fieldMap={};
  (s.connectors||[]).forEach(c => (c.fields||[]).forEach(f => { fieldMap[f.user_config_key||f.env_key]=f; }));
  document.querySelectorAll('#connectorForms input[data-key]').forEach(inp => {
    const f=fieldMap[inp.dataset.key]; if(!f) return;
    const label=inp.parentElement.querySelector('label span:last-child'); if(!label) return;
    const src = f.source && f.source !== 'missing' ? (' · '+f.source) : '';
    label.className = f.is_set ? 'good' : 'warn';
    label.textContent = (f.is_set?'set':'missing') + src;
  });
}
function bindSettingsHandlers(){
  document.querySelectorAll('#connectorForms input[data-key]').forEach(inp => {
    inp.oninput = () => {
      // A prefilled value that has not been touched is not a draft.
      if(inp.value === (inp.dataset.original||'')) delete state.drafts[inp.dataset.key];
      else state.drafts[inp.dataset.key] = inp.value;
      state.settingsDirty = Object.keys(state.drafts).length > 0;
    };
    inp.onfocus = () => { state.settingsFocus = true; };
    inp.onblur = () => { state.settingsFocus = false; };
  });
  document.querySelectorAll('[data-test-connector]').forEach(btn => {
    btn.onclick = async () => {
      const name = btn.dataset.testConnector;
      btn.disabled = true; btn.textContent = 'Testing…';
      try{
        const r = await api('/api/connectors/test', {
          method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name})
        });
        if(r.ok){
          flash(`${name}: ${r.server} v${r.version||'?'} started and listed ${r.tool_count} tools in ${r.elapsed_ms}ms. ${r.note}`, true);
          toast(`${name} responded with ${r.tool_count} tools`, true);
        } else {
          flash(`${name} failed: ${r.error}${r.stderr?(' — '+r.stderr.slice(-200)):''}${r.hint?(' '+r.hint):''}`, false);
          toast(`${name} test failed`, false);
        }
      }catch(e){ flash(String(e.message||e), false); }
      finally{ btn.disabled=false; btn.textContent='Test'; }
    };
  });
  document.querySelectorAll('[data-toggle-connector]').forEach(btn => {
    btn.onclick = async () => {
      const name = btn.dataset.toggleConnector;
      const next = btn.getAttribute('aria-checked') !== 'true';
      btn.disabled = true;
      try{
        const r = await api('/api/mcp/toggle', {
          method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name, enabled:next})
        });
        if(!r.ok){ flash(r.error || 'toggle failed', false); return; }
        btn.setAttribute('aria-checked', String(next));
        btn.closest('.conn-card').classList.toggle('off', !next);
        flash(`${name} ${next?'enabled':'disabled'}. ${r.note}`, true);
      }catch(e){ flash(String(e.message||e), false); }
      finally{ btn.disabled=false; }
    };
  });
  document.querySelectorAll('[data-save-connector]').forEach(btn => {
    btn.onclick = async () => {
      const card = btn.closest('.conn-card');
      const updates = {};
      card.querySelectorAll('input[data-key]').forEach(inp => {
        // Prefilled non-secret values are only sent when actually edited.
        if(inp.value !== '' && inp.value !== (inp.dataset.original||'')) updates[inp.dataset.key]=inp.value;
      });
      if(!Object.keys(updates).length){ flash('Nothing changed in this connector.', false); return; }
      btn.disabled = true;
      try{
        const res = await api('/api/connectors/env', {
          method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({updates})
        });
        if(!res.ok){ flash(res.error || 'save failed', false); return; }
        Object.keys(updates).forEach(k => { delete state.drafts[k]; });
        state.settingsDirty = Object.values(state.drafts).some(v => String(v||'').length > 0);
        card.querySelectorAll('input[data-key]').forEach(inp => {
          if(updates[inp.dataset.key]==null) return;
          // Clear secrets (never read back); keep visible values and rebaseline them.
          if(inp.type === 'password') inp.value = '';
          else inp.dataset.original = inp.value;
        });
        flash((res.note||'Saved') + ' · ' + (res.updated_user_config_keys||res.updated_keys||[]).join(', '), true);
        toast('Credentials saved — reload Claude Code', true);
        state.settingsDirty=false; state.settingsFocus=false;
        await refresh(true);
        renderSettings(state.snapshot);
      }catch(e){ flash(String(e.message||e), false); }
      finally{ btn.disabled=false; }
    };
  });
}
function flash(msg, ok){ $('settingsFlash').innerHTML = `<div class="flash ${ok?'ok':'err'}">${msg}</div>`; }

async function loadDetail(){
  if(!state.selectedSession){
    $('detail').textContent='Pick a session…'; $('tools').innerHTML=''; $('events').innerHTML=''; return;
  }
  const d = await api('/api/sessions/'+encodeURIComponent(state.selectedSession));
  const s = d.session||{};
  $('detail').innerHTML = `
    <div class="chips" style="margin-bottom:8px">
      ${s.is_live?'<span class="chip live">LIVE</span>':''}
      <span class="chip">${s.project_folder||s.project_name||folder(s.cwd)||'—'}</span>
      <span class="chip">${s.agent||'claude'}</span>
      <span class="chip truncate">${s.model||'—'}</span>
      ${s.git_branch?`<span class="chip">${s.git_branch}</span>`:''}
      <span class="chip">${ago(s.last_activity_at||s.started_at)}</span>
    </div>
    <div class="mono truncate" title="${s.session_id||''}">${s.session_id||''}</div>
    <div class="muted truncate" style="margin:6px 0" title="${s.cwd||s.project_root||''}">${s.cwd||s.project_root||''}</div>
    <div>Task: <strong>${s.task_summary||s.brief_summary||'—'}</strong></div>
    <div class="chips" style="margin-top:8px">
      <span class="chip">dispatches ${num(s.dispatches)}</span>
      <span class="chip">inline ${num(s.inline_ops)}</span>
      <span class="chip">verifier ${pct(s.verifier_coverage)}</span>
      <span class="chip">tokens ~${num(s.est_context_tokens)}</span>
      <span class="chip">tools10m ${num(s.recent_tool_calls)}</span>
    </div>`;
  $('tools').innerHTML = (d.tools||[]).map(t =>
    `<tr><td class="muted">${ago(t.ts)}</td><td class="mono truncate">${t.tool_name||''}</td>
     <td class="mono muted truncate" title="${(t.target||t.server||'')}">${(t.target||t.server||'')}</td></tr>`
  ).join('') || '<tr><td colspan="3" class="muted">No tool_calls yet</td></tr>';
  const ev = []
    .concat((d.dispatches||[]).map(x => ({ts:x.ts, kind:'dispatch', detail:(x.agent_type||'')+' '+(x.model||'')})))
    .concat((d.events||[]).map(x => ({ts:x.ts, kind:x.is_inline_op?'inline':'event', detail:(x.tool||'')+' '+(x.path||x.context||'')})))
    .sort((a,b)=> (b.ts||0)-(a.ts||0)).slice(0,80);
  $('events').innerHTML = ev.map(e =>
    `<tr><td class="muted">${ago(e.ts)}</td><td>${e.kind}</td><td class="mono muted truncate" title="${e.detail||''}">${e.detail||''}</td></tr>`
  ).join('') || '<tr><td colspan="3" class="muted">No events/dispatches</td></tr>';
}

/* ===== Bulk credential import / export ===== */
$('bulkExport').onclick = async () => {
  try{
    const r = await api('/api/connectors/export');
    $('bulkEnv').value = r.text || '';
    $('bulkMsg').textContent = 'Template loaded. Secrets are blanked; fill them in and import.';
  }catch(e){ $('bulkMsg').textContent = String(e.message||e); }
};
$('bulkImport').onclick = async () => {
  const text = $('bulkEnv').value || '';
  if(!text.trim()){ $('bulkMsg').textContent = 'Paste some KEY=VALUE lines first.'; return; }
  const btn = $('bulkImport'); btn.disabled = true;
  try{
    const r = await api('/api/connectors/import', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({text})
    });
    if(!r.ok){
      $('bulkMsg').textContent = r.error === 'keys_not_allowlisted'
        ? ('Rejected unknown keys: ' + (r.keys||[]).join(', '))
        : (r.hint || r.error || 'import failed');
      toast('Import rejected', false);
      return;
    }
    $('bulkMsg').textContent = 'Imported ' + (r.parsed_keys||[]).length + ' keys. Reload Claude Code.';
    $('bulkEnv').value = '';
    toast('Credentials imported — reload Claude Code', true);
    await refresh(true);
    if(state.tab==='settings') renderSettings(state.snapshot);
  }catch(e){ $('bulkMsg').textContent = String(e.message||e); }
  finally{ btn.disabled = false; }
};

/* ===== Behavior ===== */
function knobControl(k){
  const val = state.behaviorEdits[k.key] != null ? state.behaviorEdits[k.key] : k.value;
  if(k.kind === 'toggle'){
    const on = String(val) === String(k.on);
    return `<button type="button" class="switch" role="switch" aria-checked="${on}"
      aria-label="${esc(k.title)}" data-knob-toggle="${esc(k.key)}"
      data-on="${esc(k.on)}" data-off="${esc(k.off)}"></button>`;
  }
  if(k.kind === 'choice'){
    return `<select data-knob="${esc(k.key)}">${(k.options||[]).map(o =>
      `<option value="${esc(o)}"${String(o)===String(val)?' selected':''}>${esc(o)}</option>`).join('')}</select>`;
  }
  const type = k.kind === 'number' ? 'number' : 'text';
  return `<input type="${type}" data-knob="${esc(k.key)}" value="${esc(val)}"
    placeholder="${esc(k.default||'not set')}" autocomplete="off" spellcheck="false"/>`;
}
function renderBehavior(b){
  $('behaviorPath').textContent = b.settings_path || '~/.claude/settings.json';
  $('behaviorGroups').innerHTML = (b.groups||[]).map(g => `
    <h3 class="card-title" style="margin-top:var(--s3)">${esc(g.title)}</h3>
    <div class="knob-grid">${(g.knobs||[]).map(k => `
      <div class="knob">
        <div>
          <div class="k-name"><strong>${esc(k.title)}</strong>
            <span class="mono faint">${esc(k.key)}</span>
            <span class="src ${esc(k.source)}">${esc(k.source)}</span></div>
          <p>${esc(k.description)}</p>
          <div class="k-ref">${esc(k.ref||'')} · default ${esc(k.default||'(unset)')}</div>
        </div>
        <div class="k-ctl">${knobControl(k)}</div>
      </div>`).join('')}</div>`).join('');
  $('behaviorAdvanced').innerHTML = (b.advanced||[]).map(a => `
    <tr>
      <td class="mono truncate" title="${esc(a.key)}">${esc(a.key)}</td>
      <td><input data-knob="${esc(a.key)}" value="${esc(state.behaviorEdits[a.key] != null ? state.behaviorEdits[a.key] : a.value)}"
        placeholder="(default)" autocomplete="off" spellcheck="false" style="height:30px; font-size:12px"/></td>
      <td class="mono faint truncate" title="${esc(a.ref)}">${esc(a.ref)}</td>
    </tr>`).join('') || '<tr><td colspan="3" class="muted">No additional variables found</td></tr>';
  bindBehaviorHandlers();
  updateBehaviorMsg();
}
function updateBehaviorMsg(){
  const n = Object.keys(state.behaviorEdits).length;
  $('behaviorMsg').textContent = n ? `${n} unsaved change${n===1?'':'s'}.` : 'No changes.';
}
function markKnob(key, value, original){
  if(String(value) === String(original==null?'':original)) delete state.behaviorEdits[key];
  else state.behaviorEdits[key] = value;
  updateBehaviorMsg();
}
function knobOriginal(key){
  const b = state.behavior || {};
  for(const g of (b.groups||[])) for(const k of (g.knobs||[])) if(k.key===key) return k.value;
  for(const a of (b.advanced||[])) if(a.key===key) return a.value;
  return '';
}
function bindBehaviorHandlers(){
  document.querySelectorAll('[data-knob-toggle]').forEach(btn => {
    btn.onclick = () => {
      const key = btn.dataset.knobToggle;
      const next = btn.getAttribute('aria-checked') !== 'true';
      btn.setAttribute('aria-checked', String(next));
      markKnob(key, next ? btn.dataset.on : btn.dataset.off, knobOriginal(key));
    };
  });
  document.querySelectorAll('[data-knob]').forEach(el => {
    const handler = () => markKnob(el.dataset.knob, el.value, knobOriginal(el.dataset.knob));
    el.oninput = handler; el.onchange = handler;
  });
}
async function loadBehavior(){
  state.behavior = await api('/api/behavior');
  renderBehavior(state.behavior);
}
$('behaviorReset').onclick = () => { state.behaviorEdits = {}; renderBehavior(state.behavior||{}); };
$('behaviorSave').onclick = async () => {
  const updates = state.behaviorEdits;
  if(!Object.keys(updates).length){ behaviorFlash('Nothing to save.', false); return; }
  const btn = $('behaviorSave'); btn.disabled = true;
  try{
    const r = await api('/api/behavior', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({updates})
    });
    if(!r.ok){ behaviorFlash((r.hint||r.error) + ' ' + (r.keys||[]).join(', '), false); return; }
    state.behaviorEdits = {};
    behaviorFlash(`Set ${(r.set||[]).join(', ')||'nothing'}${(r.cleared||[]).length?(' · cleared '+r.cleared.join(', ')):''}. ${r.note}`, true);
    toast('Behavior saved — reload Claude Code', true);
    await loadBehavior();
  }catch(e){ behaviorFlash(String(e.message||e), false); }
  finally{ btn.disabled = false; }
};
function behaviorFlash(msg, ok){ $('behaviorFlash').innerHTML = `<div class="flash ${ok?'ok':'err'}">${esc(msg)}</div>`; }

/* ===== Ecosystem ===== */
function ecoFlash(msg, ok){ $('ecoFlash').innerHTML = `<div class="flash ${ok?'ok':'err'}">${esc(msg)}</div>`; }
function showEcoPane(pane){
  state.ecoPane = pane;
  document.querySelectorAll('#ecoNav button').forEach(b => b.classList.toggle('active', b.dataset.eco===pane));
  ['wiring','plugins','mcp','capabilities'].forEach(p => {
    const el = $('eco-'+p); if(el) el.classList.toggle('hidden', p!==pane);
  });
}
function renderEcosystem(e){
  const a = e.atlas || {};
  $('ecoWiringNote').innerHTML = [
    `Plugin <span class="tag ${a.plugin_enabled?'ok':'no'}">${a.plugin_enabled?'enabled':'disabled'}</span>`,
    `Hooks <span class="tag ${a.hooks_disabled_globally?'no':'ok'}">${a.hooks_disabled_globally?'disabled globally':'active'}</span>`,
    `Output style <span class="tag">${esc(e.user?.active_output_style||'default')}</span>`,
    `<span class="mono faint">${esc(a.plugin_root||'')}</span>`
  ].join(' · ');
  $('ecoBindings').innerHTML = (a.bindings||[]).map(b => `
    <tr>
      <td>${esc(b.event)}</td>
      <td class="mono muted">${esc(b.matcher)}</td>
      <td class="mono truncate" title="${esc(b.script)}">${esc(b.script)}${b.timeout?` <span class="faint">(${esc(b.timeout)}s)</span>`:''}</td>
      <td class="${b.present?'good':'bad'}">${b.present?'present':'MISSING'}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="muted">No hook bindings declared</td></tr>';

  const plugins = e.plugins||[];
  $('pluginCount').textContent = `${plugins.filter(p=>p.enabled).length}/${plugins.length} on`;
  $('pluginGrid').innerHTML = plugins.map(p => {
    const counts = [
      p.skills ? `${p.skills} skills` : '', p.agents ? `${p.agents} agents` : '',
      p.commands ? `${p.commands} commands` : '', p.mcp_servers.length ? `${p.mcp_servers.length} MCP` : '',
      p.hooks ? 'hooks' : ''
    ].filter(Boolean);
    const host = p.key.startsWith('atlas@');
    return `<article class="eco-card${p.enabled?'':' off'}${host?' host':''}">
      <div class="hdr">
        <div class="truncate"><strong title="${esc(p.key)}">${esc(p.name)}</strong>
          <span class="mono faint" style="font-size:11px">${esc(p.marketplace)}${p.version?(' · v'+esc(p.version)):''}</span></div>
        <button type="button" class="switch" role="switch" aria-checked="${p.enabled}"
          aria-label="Enable ${esc(p.name)}" data-toggle-plugin="${esc(p.key)}" ${host?'disabled':''}></button>
      </div>
      <div class="tag-list">${counts.map(c=>`<span class="tag">${esc(c)}</span>`).join('')}
        ${p.installed?'':'<span class="tag no">not installed</span>'}</div>
      <p>${esc(p.description||'No description in the plugin manifest.')}</p>
      <div class="mono faint truncate" title="${esc(p.path)}">${esc(p.path||'—')}</div>
    </article>`;
  }).join('') || '<div class="empty">No plugins found</div>';

  const servers = (e.mcp||{}).servers||[];
  $('mcpCount').textContent = `${servers.filter(s=>s.enabled).length}/${servers.length} on`;
  $('claudeJsonPath').textContent = e.claude_json_path || '~/.claude.json';
  $('mcpGrid').innerHTML = servers.map(s => `
    <article class="eco-card${s.enabled?'':' off'}">
      <div class="hdr">
        <div class="truncate"><strong class="mono" title="${esc(s.name)}">${esc(s.bare_name)}</strong>
          <span class="faint" style="font-size:11px">${esc(s.origin)} · ${esc(s.origin_detail)}</span></div>
        <button type="button" class="switch" role="switch" aria-checked="${s.enabled}"
          aria-label="Enable ${esc(s.name)}" data-toggle-mcp="${esc(s.name)}"></button>
      </div>
      <div class="tag-list">
        <span class="tag">${esc(s.transport)}</span>
        ${s.plugin_enabled===false?'<span class="tag no">plugin off</span>':''}
        ${(s.env_keys||[]).length?`<span class="tag">${s.env_keys.length} env</span>`:''}
      </div>
      <p class="mono">${esc(s.command||'—')}</p>
      <div>${s.removable?`<button type="button" class="ghost" data-remove-mcp="${esc(s.name)}" style="height:30px">Remove</button>`:'<span class="faint" style="font-size:11px">Provided by a plugin</span>'}</div>
    </article>`).join('') || '<div class="empty">No MCP servers found</div>';

  const u = e.user||{};
  const list = (label, items) => `
    <section class="card">
      <h3 class="card-title">${esc(label)} <span class="pill">${items.length}</span></h3>
      <div class="tag-list">${items.map(i=>`<span class="tag">${esc(i)}</span>`).join('') || '<span class="muted">none</span>'}</div>
    </section>`;
  $('capabilityGrid').innerHTML = [
    list('Atlas skills', a.skills||[]),
    list('Atlas agents', a.agents||[]),
    list('Atlas output styles', a.output_styles||[]),
    list('Your ~/.claude agents', u.agents||[]),
    list('Your ~/.claude skills', u.skills||[]),
    list('Your hook events', u.hook_events||[]),
  ].join('');
  bindEcosystemHandlers();
}
function bindEcosystemHandlers(){
  const toggle = async (btn, path, body, label) => {
    btn.disabled = true;
    try{
      const r = await api(path, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
      if(!r.ok){ ecoFlash((r.hint || r.error) + (r.key||r.name?(': '+(r.key||r.name)):''), false); return; }
      ecoFlash(`${label} ${body.enabled?'enabled':'disabled'}. ${r.note||''}`, true);
      await loadEcosystem();
    }catch(e){ ecoFlash(String(e.message||e), false); }
    finally{ btn.disabled = false; }
  };
  document.querySelectorAll('[data-toggle-plugin]').forEach(btn => {
    btn.onclick = () => toggle(btn, '/api/plugins/toggle',
      {key: btn.dataset.togglePlugin, enabled: btn.getAttribute('aria-checked') !== 'true'},
      btn.dataset.togglePlugin);
  });
  document.querySelectorAll('[data-toggle-mcp]').forEach(btn => {
    btn.onclick = () => toggle(btn, '/api/mcp/toggle',
      {name: btn.dataset.toggleMcp, enabled: btn.getAttribute('aria-checked') !== 'true'},
      btn.dataset.toggleMcp);
  });
  document.querySelectorAll('[data-remove-mcp]').forEach(btn => {
    btn.onclick = async () => {
      const name = btn.dataset.removeMcp;
      if(!window.confirm(`Remove the user-scope MCP server "${name}" from ~/.claude.json?`)) return;
      btn.disabled = true;
      try{
        const r = await api('/api/mcp/remove', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name})});
        if(!r.ok){ ecoFlash(r.error || 'remove failed', false); return; }
        ecoFlash(`Removed ${name} from ${r.path}.`, true);
        await loadEcosystem();
      }catch(e){ ecoFlash(String(e.message||e), false); }
      finally{ btn.disabled = false; }
    };
  });
}
async function loadEcosystem(){
  state.ecosystem = await api('/api/ecosystem');
  renderEcosystem(state.ecosystem);
  showEcoPane(state.ecoPane);
}
document.querySelectorAll('#ecoNav button').forEach(b => b.onclick = () => showEcoPane(b.dataset.eco));
$('mcpAdd').onclick = async () => {
  const spec = {
    name: $('mcpName').value.trim(),
    command: $('mcpCommand').value.trim(),
    args: $('mcpArgs').value.trim(),
    url: $('mcpUrl').value.trim(),
  };
  const btn = $('mcpAdd'); btn.disabled = true;
  try{
    const r = await api('/api/mcp/add', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(spec)});
    if(!r.ok){ ecoFlash((r.hint || r.error), false); return; }
    ['mcpName','mcpCommand','mcpArgs','mcpUrl'].forEach(id => $(id).value = '');
    ecoFlash(`${r.replaced?'Replaced':'Added'} ${r.name} in ${r.path}. ${r.note}`, true);
    toast('MCP server saved — reload Claude Code', true);
    await loadEcosystem();
  }catch(e){ ecoFlash(String(e.message||e), false); }
  finally{ btn.disabled = false; }
};

const TITLES = {
  overview:'Overview', live:'Live sessions', settings:'Connectors & credentials',
  behavior:'Behavior & hooks', ecosystem:'Ecosystem', findings:'Findings'
};
function showTab(tab){
  state.tab = tab;
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.tab===tab));
  ['overview','live','settings','behavior','ecosystem','findings'].forEach(t => {
    const el=$('tab-'+t); if(el) el.classList.toggle('hidden', t!==tab);
  });
  $('pageTitle').textContent = TITLES[tab] || 'Atlas';
  // Deep-linkable: /#behavior opens straight to that page across terminals.
  if(location.hash.slice(1) !== tab) history.replaceState(null, '', '#'+tab);
  if(tab==='settings' && state.snapshot) renderSettings(state.snapshot);
  if(tab==='live' && state.selectedSession) loadDetail();
  if(tab==='behavior') loadBehavior().catch(e => behaviorFlash(String(e.message||e), false));
  if(tab==='ecosystem') loadEcosystem().catch(e => ecoFlash(String(e.message||e), false));
}

async function refresh(forceSettings){
  const q = state.selectedProject ? ('?project_id='+encodeURIComponent(state.selectedProject)) : '';
  const s = await api('/api/status'+q);
  state.snapshot = s;
  $('url').textContent = s.url || location.origin;
  $('sideUpdated').textContent = new Date((s.generated_at||Date.now()/1000)*1000).toLocaleTimeString();
  $('sideVer').textContent = s.plugin?.version || '—';
  const db = s.db_path || '—';
  $('sideDb').textContent = db;
  $('sideDb').title = db;
  $('hint').textContent = (s.ui_hints && s.ui_hints.note) || 'LIVE = activity in the last 10 minutes. Lists are recent-only.';
  renderProjects(s);
  renderOverview(s);
  renderFindings(s);
  renderSessionList(s);
  if(state.tab==='settings'){
    if(forceSettings){ state.settingsDirty=false; state.settingsFocus=false; }
    renderSettings(s);
  } else {
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
$('session').onchange = async e => {
  state.selectedSession = e.target.value || null;
  if(state.tab!=='live') showTab('live');
  renderSessionList(state.snapshot||{sessions:[]});
  await loadDetail();
};
$('refresh').onclick = () => refresh(true);
window.addEventListener('hashchange', () => {
  const tab = location.hash.slice(1);
  if(TITLES[tab] && tab !== state.tab) showTab(tab);
});
if(TITLES[location.hash.slice(1)]) showTab(location.hash.slice(1));
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

    def _bytes(
        self,
        code: int,
        body: bytes,
        content_type: str,
        cache: str = "public, max-age=3600",
    ):
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
        if u.path == "/api/behavior":
            return self._json(200, {"ok": True, **atlas_control.behavior_state()})
        if u.path == "/api/ecosystem":
            return self._json(200, {"ok": True, **atlas_control.ecosystem_inventory()})
        if u.path == "/api/connectors/export":
            return self._json(
                200,
                {
                    "ok": True,
                    "text": atlas_control.env_export(_connector_status()),
                    "env_path": str(PLUGIN_ROOT / ".env"),
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
        if u.path == "/api/connectors/import":
            updates = atlas_control.parse_env_block(data.get("text") or "")
            if not updates:
                return self._json(
                    400,
                    {
                        "ok": False,
                        "error": "no_assignments_found",
                        "hint": "Paste lines shaped like AUVIK_API_KEY=value.",
                    },
                )
            result = write_settings_updates(updates)
            result["parsed_keys"] = sorted(updates)
            return self._json(200, result)
        if u.path == "/api/connectors/test":
            name = str(data.get("name") or "")
            return self._json(
                200, atlas_control.test_connector(name, env=_connector_env(name))
            )
        if u.path == "/api/behavior":
            return self._json(
                200, atlas_control.write_behavior_updates(data.get("updates") or {})
            )
        if u.path == "/api/mcp/toggle":
            return self._json(
                200,
                atlas_control.set_mcp_enabled(
                    data.get("name"), bool(data.get("enabled"))
                ),
            )
        if u.path == "/api/mcp/add":
            return self._json(200, atlas_control.add_mcp_server(data))
        if u.path == "/api/mcp/remove":
            return self._json(200, atlas_control.remove_mcp_server(data.get("name")))
        if u.path == "/api/plugins/toggle":
            return self._json(
                200,
                atlas_control.set_plugin_enabled(
                    data.get("key"), bool(data.get("enabled"))
                ),
            )
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
