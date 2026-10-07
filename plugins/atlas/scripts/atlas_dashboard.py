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
import hmac
import json
import os
import re
import secrets
import signal
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse, unquote

SCRIPTS_DIR = Path(__file__).resolve().parent
PLUGIN_ROOT = SCRIPTS_DIR.parent
sys.path.insert(0, str(SCRIPTS_DIR))

import atlas_db  # noqa: E402
import atlas_control  # noqa: E402
import atlas_todo  # noqa: E402

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
    """The env files the connector preloaders read, lowest precedence first.

    PLUGIN_ROOT is derived from this script's location. In the marketplace
    source tree that is `plugins/atlas/`. In a consumer install Claude sets
    CLAUDE_PLUGIN_ROOT to the installed copy — still one root, never a
    hardcoded ~/.claude/plugins/cache path list. Agents developing this
    marketplace must not write install caches. The per-user default file is
    read-only here: mcp/_env/load.* load it first, so a key set only there is
    configured even though the dashboard never writes it.
    """
    return [Path.home() / ".config" / "atlas" / "atlas.env", PLUGIN_ROOT / ".env"]


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


def _connector_usage_map() -> dict:
    """tool_calls stats per connector (best effort: no DB means no usage)."""
    try:
        conn, _ = _db()
    except Exception:
        return {}
    try:
        return atlas_control.connector_usage(conn)
    finally:
        conn.close()


# What each connector needs before its server authenticates: a list of alternatives,
# each a list of env keys that must ALL be set (``KEY=value`` = field must equal value).
# Mirrors what each <vendor>_status tool names as required when unconfigured; the
# dashboard test asserts every .mcp.json server has an entry and every key exists.
CONNECTOR_AUTH = {
    "auvik": [["AUVIK_USERNAME", "AUVIK_API_KEY"]],
    "blumira": [
        ["BLUMIRA_JWT_TOKEN"],
        ["BLUMIRA_CLIENT_ID", "BLUMIRA_CLIENT_SECRET"],
    ],
    "cipp": [
        ["CIPP_BASE_URL", "CIPP_API_KEY"],
        ["CIPP_BASE_URL", "CIPP_TENANT_ID", "CIPP_CLIENT_ID", "CIPP_CLIENT_SECRET"],
    ],
    "connectwise": [
        [
            "CW_MANAGE_COMPANY_ID",
            "CW_MANAGE_PUBLIC_KEY",
            "CW_MANAGE_PRIVATE_KEY",
            "CW_MANAGE_CLIENT_ID",
        ]
    ],
    "spanning": [["SPANNING_ADMIN_EMAIL", "SPANNING_API_TOKEN"]],
    "falcon": [["FALCON_CLIENT_ID", "FALCON_CLIENT_SECRET"]],
    "knowbe4": [["KNOWBE4_API_KEY"]],
    "ninjaone": [
        ["NINJAONE_CLIENT_ID", "NINJAONE_CLIENT_SECRET"],
        ["NINJAONE_CLIENT_ID", "NINJAONE_AUTH_MODE=user"],
    ],
    "paylocity": [["PAYLOCITY_CLIENT_ID", "PAYLOCITY_CLIENT_SECRET"]],
    "threatlocker": [["THREATLOCKER_API_KEY"]],
    "vanta": [["VANTA_CLIENT_ID", "VANTA_CLIENT_SECRET"]],
    "panos": [["PANOS_HOST", "PANOS_API_KEY"]],
}


def _connector_auth_state(name: str, fields: list) -> tuple[bool, list]:
    """(configured, missing) for one connector from its CONNECTOR_AUTH alternatives.

    Unknown connector: not configured, nothing to name. ``missing`` is taken from
    the alternative closest to complete so the UI names the shortest fix.
    """
    by_key = {f["env_key"]: f for f in fields}

    def satisfied(req: str) -> bool:
        key, _, want = req.partition("=")
        f = by_key.get(key)
        if not f or not f.get("is_set"):
            return False
        return not want or (f.get("value") or "").strip().lower() == want

    best: list | None = None
    for alt in CONNECTOR_AUTH.get(name, []):
        gaps = [r for r in alt if not satisfied(r)]
        if not gaps:
            return True, []
        if best is None or len(gaps) < len(best):
            best = gaps
    return False, best or []


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
    usage = _connector_usage_map()
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

        configured, missing = _connector_auth_state(name, fields)
        server_name = f"plugin:atlas:{name}"
        enabled = server_name not in disabled
        u = usage.get(name) or {}
        out.append(
            {
                "name": name,
                "server_name": server_name,
                "enabled": enabled,
                "bundle_exists": bundle.is_file(),
                "bundle_bytes": bundle.stat().st_size if bundle.is_file() else 0,
                "user_config_fields": uc_refs,
                "fields": fields,
                "configured_hint": configured,
                "missing_required": missing,
                "usage": {
                    "calls": u.get("calls", 0),
                    "calls_total": u.get("calls_total", 0),
                    "errors": u.get("errors", 0),
                    "error_rate": u.get("error_rate", 0.0),
                    "last_used": u.get("last_used"),
                    "window_days": int(atlas_control.CONNECTOR_USAGE_WINDOW_S // 86400),
                },
                "health": atlas_control.connector_health(configured, enabled, u),
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


def _is_junk_project(root) -> bool:
    """Roots that can never hold a real `.claude/agents` override (fixtures, scratch, gone)."""
    return atlas_control.is_fixture_project(root)


def _projects(conn, recent_only=True, editable_only=False):
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
        if editable_only and _is_junk_project(r.get("root_path")):
            continue
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
    except Exception as exc:
        # Never overwrite a file we could not parse: that is the user's global Claude config.
        return {
            "ok": False,
            "error": "settings_unreadable",
            "why": f"{settings_path} is not valid JSON ({exc.__class__.__name__}); fix or remove it first",
        }
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
    atlas_control.write_private(settings_path, json.dumps(data, indent=2) + "\n")

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
    # A .env that predates this code may be world-readable; write_private tightens it.
    atlas_control.write_private(path, "\n".join(lines) + "\n")


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
    me = os.getpid()
    if pid and pid != me and _pid_alive(pid):
        try:
            os.kill(pid, signal.SIGTERM)
            stopped = True
        except OSError as e:
            return {"ok": False, "error": str(e)}
        # Let the old daemon release its port before deciding whether a
        # fallback is needed; checking at once would always see it still bound.
        for _ in range(20):
            if not _pid_alive(pid):
                break
            time.sleep(0.1)
    if _port_open(LOOPBACK, port):
        try:
            # LISTEN only: plain `tcp:<port>` also returns client sockets
            # (e.g. a browser holding an SSE connection), which must survive.
            out = subprocess.check_output(
                ["lsof", "-ti", f"tcp:{port}", "-sTCP:LISTEN"], text=True
            ).strip()
            for p in out.splitlines():
                try:
                    target = int(p)
                    if target == me:
                        continue
                    os.kill(target, signal.SIGTERM)
                    stopped = True
                except Exception:
                    pass
        except Exception:
            pass
    time.sleep(0.15)
    _clear_pidfile()
    return {"ok": True, "stopped": stopped, "pid": pid or None, "port": port}


def _version_tuple(value) -> tuple[int, ...] | None:
    """'10.1.2' -> (10, 1, 2); non-numeric parts count as 0; unparsable -> None."""
    if not isinstance(value, str) or not value.strip():
        return None
    out = []
    for part in value.strip().split("."):
        digits = ""
        for ch in part:
            if not ch.isdigit():
                break
            digits += ch
        out.append(int(digits) if digits else 0)
    return tuple(out) if any(out) else None


def ensure_daemon(port: int | None = None) -> dict:
    port = port or DEFAULT_PORT
    url = dashboard_url(port)
    want_db = dashboard_db_path()

    if _port_open(LOOPBACK, port):
        h = _health_payload(port) or {}
        # A daemon started by an older plugin version keeps serving its own UI
        # on this port until it dies. Compare plugin versions, not script paths:
        # harnesses install the plugin at different paths, so a path check would
        # make each SessionStart kill the other harness's healthy daemon. A
        # missing, older or unparsable version is replaced; a newer one is kept.
        daemon_ver = _version_tuple(h.get("version"))
        mine = _version_tuple(_plugin_manifest().get("version")) or ()
        if _daemon_db_ok(port) and daemon_ver is not None and daemon_ver >= mine:
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


# --- Work board (durable todos), agent overrides, memory snapshot ----------


def _project_root(project_id):
    """Resolve a project's root path from the dashboard DB, or None."""
    try:
        pid = int(str(project_id))
    except (TypeError, ValueError):
        return None
    conn, _ = _db()
    try:
        row = _q(conn, "SELECT root_path FROM projects WHERE id=?", (pid,), one=True)
    finally:
        conn.close()
    return (row or {}).get("root_path")


def _todo_payload(root):
    """Board + counts for one project. Fail-open: the Work tab still renders."""
    try:
        board = atlas_todo.load(root)
        return {
            "ok": True,
            "items": board.get("items", []),
            "counts": atlas_todo.counts(board),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _agent_name_ok(name):
    return (
        bool(name) and "/" not in name and "\\" not in name and not name.startswith(".")
    )


def _frontmatter(path) -> dict:
    """Flat ``key: value`` pairs from a markdown file's leading ``---`` block."""
    try:
        text = Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return {}
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    out = {}
    for raw in lines[1:]:
        if raw.strip() == "---":
            break
        if raw.startswith(("#", " ", "\t")) or ":" not in raw:
            continue
        key, _, value = raw.partition(":")
        out[key.strip()] = value.strip().strip("\"'")
    return out


def _omp_agent_info(path) -> dict:
    """Model chain, role and thinking level from a generated omp agent file."""
    fm = _frontmatter(path)
    chain = re.findall(r"@[A-Za-z0-9_-]+", fm.get("model", ""))
    role = next((c[1:] for c in chain if c.startswith("@atlas-")), "")
    return {
        "model_chain": chain,
        "tier": role or (chain[0][1:] if chain else ""),
        "effort": fm.get("thinkingLevel", ""),
    }


def _dispatch_stats() -> dict:
    """{agent_type: {total, last7d, last_used}} from the dispatches table."""
    try:
        conn, _ = _db()
    except Exception:
        return {}
    try:
        since = time.time() - 7 * 86400
        rows = _q(
            conn,
            "SELECT agent_type, COUNT(*) AS n, "
            "SUM(CASE WHEN ts>=? THEN 1 ELSE 0 END) AS n7, MAX(ts) AS last_ts "
            "FROM dispatches WHERE agent_type IS NOT NULL AND agent_type<>'' "
            "GROUP BY agent_type",
            (since,),
        )
    except Exception:
        return {}
    finally:
        conn.close()
    return {
        r["agent_type"]: {
            "total": r["n"] or 0,
            "last7d": r["n7"] or 0,
            "last_used": r["last_ts"],
        }
        for r in rows
    }


def _stats_for(name: str, stats: dict) -> dict:
    """Sum dispatches recorded as ``name`` or the plugin-qualified ``atlas:name``."""
    total = last7d = 0
    last = None
    for key in (name, "atlas:" + name):
        s = stats.get(key)
        if not s:
            continue
        total += s["total"]
        last7d += s["last7d"]
        if s["last_used"] and (last is None or s["last_used"] > last):
            last = s["last_used"]
    return {"total": total, "last7d": last7d, "last_used": last}


def _agents_payload(root):
    """Installed plugin agents plus this project's .claude/agents overrides.

    Each row carries frontmatter model/effort, the omp (oh-my-pi) model chain when
    a generated omp agent exists, and dispatch stats from the dispatches table.
    """
    plugin, overrides, omp = {}, {}, {}
    plugin_dir = PLUGIN_ROOT / "agents"
    if plugin_dir.is_dir():
        for p in sorted(plugin_dir.glob("*.md")):
            plugin[p.stem] = str(p)
    omp_dir = PLUGIN_ROOT / "omp" / "agents"
    if omp_dir.is_dir():
        for p in sorted(omp_dir.glob("*.md")):
            omp[p.stem] = str(p)
    if root:
        over_dir = Path(root) / ".claude" / "agents"
        if over_dir.is_dir():
            for p in sorted(over_dir.glob("*.md")):
                overrides[p.stem] = str(p)
    stats = _dispatch_stats()
    agents = []
    for name in sorted(set(plugin) | set(overrides) | set(omp)):
        fm = _frontmatter(overrides.get(name) or plugin.get(name) or "")
        row = {
            "name": name,
            "source": "override" if name in overrides else "plugin",
            "overridden": name in plugin and name in overrides,
            "plugin_path": plugin.get(name, ""),
            "override_path": overrides.get(name, ""),
            "model": fm.get("model", ""),
            "effort": fm.get("effort", ""),
            "omp": None,
            "dispatches": _stats_for(name, stats),
        }
        if name in omp:
            row["omp"] = dict(_omp_agent_info(omp[name]), path=omp[name])
        agents.append(row)
    return {"ok": True, "agents": agents}


def _agent_content(root, name):
    """The override file wins; the plugin source is the editing start point."""
    if not _agent_name_ok(name):
        return {"ok": False, "error": "invalid_name"}
    over = Path(root) / ".claude" / "agents" / (name + ".md") if root else None
    if over and over.is_file():
        try:
            return {
                "ok": True,
                "name": name,
                "source": "override",
                "content": over.read_text(encoding="utf-8", errors="replace"),
            }
        except OSError as e:
            return {"ok": False, "error": str(e)}
    src = PLUGIN_ROOT / "agents" / (name + ".md")
    if src.is_file():
        try:
            return {
                "ok": True,
                "name": name,
                "source": "plugin",
                "content": src.read_text(encoding="utf-8", errors="replace"),
            }
        except OSError as e:
            return {"ok": False, "error": str(e)}
    return {"ok": False, "error": "not_found"}


def _agent_save(root, name, content):
    """Write a same-name override under <root>/.claude/agents/."""
    if not _agent_name_ok(name):
        return {"ok": False, "error": "invalid_name"}
    if not root or not Path(root).is_dir():
        return {"ok": False, "error": "unknown_project"}
    text = str(content or "")
    if not text.lstrip().startswith("---"):
        return {
            "ok": False,
            "error": "frontmatter_required",
            "hint": "Agent files start with YAML frontmatter: --- on the first line.",
        }
    over_dir = Path(root) / ".claude" / "agents"
    try:
        over_dir.mkdir(parents=True, exist_ok=True)
        over = over_dir / (name + ".md")
        over.write_text(text, encoding="utf-8")
    except OSError as e:
        return {"ok": False, "error": str(e)}
    return {
        "ok": True,
        "name": name,
        "path": str(over),
        "note": "Override written to the project. Applies when Claude Code next loads agents for it.",
    }


def _agent_reset(root, name):
    """Delete the project override so the plugin's agent definition wins again."""
    if not _agent_name_ok(name):
        return {"ok": False, "error": "invalid_name"}
    if not root:
        return {"ok": False, "error": "unknown_project"}
    over = Path(root) / ".claude" / "agents" / (name + ".md")
    try:
        over.unlink(missing_ok=True)
    except OSError as e:
        return {"ok": False, "error": str(e)}
    return {
        "ok": True,
        "name": name,
        "note": "Override removed; the plugin agent definition applies again.",
    }


# --- v2 surface: security guard, static UI, route mounting, SSE -------------------

# Per-daemon secret. Injected into index.html (<meta name="atlas-token">) and
# required as X-Atlas-Token on mutations, /api/v2/stream and sensitive GETs.
DASH_TOKEN = secrets.token_urlsafe(32)
STATIC_DIR = SCRIPTS_DIR / "dashboard_ui"
TOKEN_PLACEHOLDER = "__ATLAS_TOKEN__"
# GETs that expose transcripts/agent output or live streams: token required.
_SENSITIVE_GET = re.compile(
    r"^/api/v2/(stream|irc|channels(/[^/]+)?|[^/]+/transcript)$|^/api/sessions/[^/]+/transcript$"
    r"|^/api/v2/(herd/)?agents/[^/]+/peek$"
)
_TOKEN_EXEMPT = ("/api/health", "/health")
_MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
    ".map": "application/json; charset=utf-8",
}

V2_ROUTES: list = []  # (method, compiled regex, callable)
V2_MOUNT_ERRORS: dict = {}


def _mount_v2_routes() -> None:
    """Tolerant mount: a missing or broken module never stops the server."""
    import importlib

    V2_ROUTES.clear()
    V2_MOUNT_ERRORS.clear()
    for name in (
        "atlas_dash_work",
        "atlas_dash_irc",
        "atlas_dash_insights",
        "atlas_dash_herd",
        "atlas_dash_integrations",
    ):
        try:
            mod = importlib.import_module(name)
            for method, pattern, fn in getattr(mod, "ROUTES", []):
                V2_ROUTES.append((method.upper(), re.compile(pattern), fn))
        except ImportError as e:
            V2_MOUNT_ERRORS[name] = f"not available: {e}"
        except Exception as e:  # a bad module must not take the daemon down
            V2_MOUNT_ERRORS[name] = f"{type(e).__name__}: {e}"
            sys.stderr.write(f"[atlas-dashboard] {name} failed to mount: {e}\n")


_mount_v2_routes()
try:  # Health reports connectors with the same definition Settings uses
    import atlas_dash_insights as _ins  # already imported by the mount above

    _ins.CONNECTOR_STATUS_PROVIDER = lambda: _connector_status()
except Exception:  # Health then reports connectors as unavailable
    pass


class _Ctx:
    """Per-request context handed to v2 route callables."""

    def __init__(self, query: dict, body: dict, groups: tuple):
        self.query = query
        self._body = body
        self.groups = groups

    def json(self) -> dict:
        return self._body

    def db(self):
        conn, _ = _db()
        return conn

    def project_root(self, project_param):
        """Absolute root path (has `.atlas/` or exists), or a numeric project id."""
        if project_param in (None, "", "all"):
            return None
        p = str(project_param)
        if p.isdigit():
            return _project_root(p)
        if os.path.isabs(p) and os.path.isdir(p):
            return os.path.realpath(p)
        return None


def _static_file(rel: str):
    """Resolve rel inside STATIC_DIR or None. Rejects traversal, symlink escape, dotfiles."""
    if not rel or "\x00" in rel or "\\" in rel:
        return None
    parts = [p for p in rel.split("/") if p not in ("", ".")]
    if any(p == ".." or p.startswith(".") for p in parts):
        return None
    base = STATIC_DIR.resolve()
    target = (base / "/".join(parts)).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        return None
    return target if target.is_file() else None


# Keys that change every tick without meaning anything changed. They are ignored for change
# detection only; the emitted payload is untouched. ``preview``/``last_ts`` are live output
# and activity stamps, ``fetched_ms`` is the herd sampler's own latency: each would re-emit
# a topic on every tick.
_VOLATILE_KEYS = frozenset(
    {
        "idle_seconds",
        "updated",
        "last_ok",
        "generated_at",
        "now",
        "age_seconds",
        "preview",
        "last_ts",
        "fetched_ms",
    }
)


def _strip_volatile(obj):
    if isinstance(obj, dict):
        return {
            k: _strip_volatile(v) for k, v in obj.items() if k not in _VOLATILE_KEYS
        }
    if isinstance(obj, list):
        return [_strip_volatile(v) for v in obj]
    return obj


def _snapshot_hash(obj) -> str:
    import hashlib

    return hashlib.sha256(
        json.dumps(_strip_volatile(obj), sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()


# Default page sizes for the heavy v2 reads (a full /improve was 571 KB, /todos 299 KB).
# ``?full=1`` returns everything; ``?limit=N|all&offset=N`` pages /improve findings and
# ``?done=N|all`` sizes the done tail of /todos. ``page`` in the reply says what was cut.
IMPROVE_PAGE = {"findings": 40, "ledger": 20, "lessons": 10}
TODOS_DONE_KEEP = 20


def _page_arg(query: dict, key: str, default):
    """int, None for 'all', else default."""
    raw = query.get(key)
    if raw in (None, ""):
        return default
    if raw == "all":
        return None
    try:
        return max(0, int(raw))
    except ValueError:
        return default


def _shape_payload(path: str, query: dict, body):
    """Trim a heavy v2 GET body to its default page (never mutates ``body``)."""
    if not isinstance(body, dict) or query.get("full") in ("1", "true"):
        return body
    if path == "/api/v2/improve":
        out, page = dict(body), {}
        offset = _page_arg(query, "offset", 0) or 0
        for key, cap in IMPROVE_PAGE.items():
            rows = body.get(key)
            if not isinstance(rows, list):
                continue
            limit = _page_arg(query, "limit", cap) if key == "findings" else cap
            start = offset if key == "findings" else 0
            end = len(rows) if limit is None else start + limit
            out[key] = rows[start:end]
            page[key] = {
                "total": len(rows),
                "offset": start,
                "returned": len(out[key]),
                "limit": limit,
            }
        out["page"] = page
        return out
    if path == "/api/v2/todos":
        keep = _page_arg(query, "done", TODOS_DONE_KEEP)
        hidden, phases = 0, []
        for phase in body.get("phases") or []:
            items = phase.get("items") or []
            done = [i for i in items if i.get("status") == "done"]
            if keep is not None and len(done) > keep:
                newest = sorted(
                    done, key=lambda i: i.get("updated") or "", reverse=True
                )
                drop = {id(i) for i in newest[keep:]}
                items = [i for i in items if id(i) not in drop]
                hidden += len(drop)
            phases.append({**phase, "items": items})
        return {
            **body,
            "phases": phases,
            "page": {"done_hidden": hidden, "done_keep": keep},
        }
    return body


def _v2_route(method: str, path: str):
    for m, rx, fn in V2_ROUTES:
        if m == method and rx.fullmatch(path):
            return fn
    return None


def _v2_get(path: str, query: dict):
    """Run a mounted GET route uncached (the SSE sampler). Raises on any failure."""
    fn = _v2_route("GET", path)
    if fn is None:
        raise LookupError(f"no GET route {path}")
    status, body = fn(_Ctx(query, {}, ()))
    if status != 200:
        raise RuntimeError(f"{path} answered {status}")
    return _shape_payload(path, query, body)


# Reads the SSE topics also serve share one computation across concurrent identical
# GETs for V2_CACHE_TTL_S; any v2 mutation drops the cache so a write is never read stale.
V2_CACHE_TTL_S = 2.0
_V2_CACHE: dict = {}
_V2_LOCKS: dict = {}
_V2_GUARD = threading.Lock()


def _v2_cache_clear() -> None:
    with _V2_GUARD:
        _V2_CACHE.clear()


def _v2_call(method: str, path: str, query: dict, body: dict, fn, groups: tuple):
    """(status, payload) for one v2 route call, cached and paged for heavy GETs."""
    if method != "GET":
        _v2_cache_clear()
        return fn(_Ctx(query, body, groups))

    def run():
        status, payload = fn(_Ctx(query, {}, groups))
        return status, (
            _shape_payload(path, query, payload) if status == 200 else payload
        )

    if path not in _V2_CACHED_PATHS:
        return run()
    key = (path, tuple(sorted(query.items())))
    with _V2_GUARD:
        lock = _V2_LOCKS.setdefault(key, threading.Lock())
    with lock:  # single flight: the first caller computes, the rest read its result
        with _V2_GUARD:
            hit = _V2_CACHE.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1], hit[2]
        status, payload = run()
        if status == 200:
            with _V2_GUARD:
                _V2_CACHE[key] = (time.monotonic() + V2_CACHE_TTL_S, status, payload)
                if len(_V2_CACHE) > 64:  # bound the distinct-project key space
                    now = time.monotonic()
                    for k in [k for k, v in _V2_CACHE.items() if v[0] <= now]:
                        _V2_CACHE.pop(k, None)
                        _V2_LOCKS.pop(k, None)
        return status, payload


SSE_TICK_S = 5
SSE_HEARTBEAT_S = 15
SSE_TOPICS = (
    ("herd", "/api/v2/herd/agents"),
    ("agents", "/api/v2/agents"),
    ("todos", "/api/v2/todos"),
    ("irc", "/api/v2/irc"),
    ("health", "/api/v2/health"),
    ("improve", "/api/v2/improve"),
)
_V2_CACHED_PATHS = frozenset(route for _event, route in SSE_TOPICS)
# Topics whose hash ignores live fields still re-emit this often (none needed today).
SSE_FORCE_REFRESH_S: dict = {}


class _Sampler:
    """Computes every SSE topic once per tick for all clients of one project filter."""

    def __init__(self, project: str):
        self.project = project
        self.cond = threading.Condition()
        self.epoch = secrets.token_hex(3)
        self.gen = 0  # 0 = nothing sampled yet
        self.topics: dict = {}  # event -> {digest, body, gen (when it last changed), at}
        self.errors: dict = {}  # event -> {error, gen} while the route is failing
        self.subscribers = 0

    def sample(self) -> None:
        query = {"project": self.project} if self.project else {}
        results = {}
        for event, route in SSE_TOPICS:
            try:
                results[event] = (_v2_get(route, dict(query)), None)
            except (
                Exception
            ) as e:  # surfaced to clients as route_error, never swallowed
                sys.stderr.write(f"[atlas-dashboard] sse {event} {route}: {e!r}\n")
                results[event] = (None, f"{type(e).__name__}: {e}")
        now = time.monotonic()
        with self.cond:
            nxt = self.gen + 1
            for event, (body, err) in results.items():
                if err is not None:
                    if self.errors.get(event, {}).get("error") != err:
                        self.errors[event] = {"error": err, "gen": nxt}
                    continue
                recovered = self.errors.pop(event, None) is not None
                digest = _snapshot_hash(body)
                cur = self.topics.get(event)
                stale = cur is not None and now - cur["at"] >= SSE_FORCE_REFRESH_S.get(
                    event, float("inf")
                )
                if cur is None or cur["digest"] != digest or recovered or stale:
                    self.topics[event] = {
                        "digest": digest,
                        "body": body,
                        "gen": nxt,
                        "at": now,
                    }
            self.gen = nxt
            self.cond.notify_all()

    def run(self) -> None:
        while True:
            with _SAMPLERS_LOCK:
                if self.subscribers == 0:
                    _SAMPLERS.pop(self.project, None)
                    return
            self.sample()
            time.sleep(SSE_TICK_S)


_SAMPLERS: dict = {}
_SAMPLERS_LOCK = threading.Lock()


def _sampler_acquire(project: str) -> _Sampler:
    with _SAMPLERS_LOCK:
        s = _SAMPLERS.get(project)
        if s is None:
            s = _SAMPLERS[project] = _Sampler(project)
            threading.Thread(
                target=s.run, daemon=True, name="atlas-sse-sampler"
            ).start()
        s.subscribers += 1
        return s


def _sampler_release(s: _Sampler) -> None:
    with _SAMPLERS_LOCK:
        s.subscribers -= 1


class Handler(BaseHTTPRequestHandler):
    server_version = "AtlasDashboard/1.2"

    def _json(self, code: int, payload):
        body = json.dumps(payload, default=str, separators=(",", ":")).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
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

    def log_message(self, format, *args):  # noqa: A002 - base-class signature
        sys.stderr.write("[atlas-dashboard] " + (format % args) + "\n")

    # -- central security guard (every route, every method) ------------------

    def _served_port(self) -> int:
        return int(self.server.server_address[1])

    def _deny(self, code: int, error: str, why: str, do: str):
        return self._json(code, {"ok": False, "error": error, "why": why, "do": do})

    def _guard(self, method: str, path: str, query: dict) -> bool:
        """True when the request may proceed; otherwise the reply is already sent.

        Order: Host (403) -> Content-Type on non-GET/HEAD (415) -> Origin (403)
        -> X-Atlas-Token (401) on mutations, /api/v2/stream and sensitive GETs.
        /api/health is Host-checked only so hooks and ensure probes keep working.
        """
        port = self._served_port()
        allowed_hosts = {f"{LOOPBACK}:{port}", f"localhost:{port}"}
        host = (self.headers.get("Host") or "").strip().lower()
        if host not in allowed_hosts:
            self._deny(
                403,
                "bad_host",
                f"Host {host!r} is not this dashboard",
                f"use http://{LOOPBACK}:{port}/ or http://localhost:{port}/",
            )
            return False
        mutating = method not in ("GET", "HEAD")
        if mutating:
            ctype = (
                (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            )
            if ctype != "application/json":
                self._deny(
                    415,
                    "unsupported_media_type",
                    "mutations must send Content-Type: application/json",
                    "set the Content-Type header to application/json",
                )
                return False
        origin = self.headers.get("Origin")
        if origin is not None and origin not in {f"http://{h}" for h in allowed_hosts}:
            self._deny(
                403,
                "bad_origin",
                f"Origin {origin!r} is not this dashboard",
                "call the API from the dashboard page itself",
            )
            return False
        if path in _TOKEN_EXEMPT:
            return True
        if mutating or _SENSITIVE_GET.match(path):
            supplied = self.headers.get("X-Atlas-Token") or ""
            if not supplied and path == "/api/v2/stream":
                supplied = query.get("token", "")
            if not hmac.compare_digest(supplied.encode(), DASH_TOKEN.encode()):
                self._deny(
                    401,
                    "bad_token",
                    "missing or invalid X-Atlas-Token",
                    "reload the dashboard page to obtain a fresh token",
                )
                return False
        return True

    # -- static UI --------------------------------------------------------------

    def _serve_static(self, path: str, head_only: bool = False) -> bool:
        """Serve / and /ui/*. True when the path was a static route."""
        if path in ("/", "/index.html", "/dashboard", "/dashboard/"):
            target = _static_file("index.html")
            if target is None:
                self._json(
                    404,
                    {
                        "ok": False,
                        "error": "ui_missing",
                        "why": f"{STATIC_DIR / 'index.html'} does not exist",
                        "do": "reinstall the atlas plugin",
                    },
                )
                return True
            body = target.read_bytes().replace(
                TOKEN_PLACEHOLDER.encode(), DASH_TOKEN.encode()
            )
            if DASH_TOKEN.encode() not in body:
                tag = f'<meta name="atlas-token" content="{DASH_TOKEN}">'.encode()
                body = re.sub(rb"(<head[^>]*>)", rb"\1" + tag, body, count=1)
            return self._send_static(body, "text/html; charset=utf-8", head_only)
        if path.startswith("/ui/"):
            target = _static_file(unquote(path[len("/ui/") :]))
            if target is None:
                self._json(404, {"ok": False, "error": "not_found", "path": path})
                return True
            ctype = _MIME.get(target.suffix.lower(), "application/octet-stream")
            return self._send_static(target.read_bytes(), ctype, head_only)
        return False

    def _send_static(self, body: bytes, ctype: str, head_only: bool) -> bool:
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        if not head_only:
            self.wfile.write(body)
        return True

    # -- SSE -----------------------------------------------------------------------

    def _sse(self, query: dict):
        """colony/todos/irc/health/improve events from the shared sampler.

        One sampler per project filter computes every topic once per tick for all
        clients; a client only gets topics that changed since its ``Last-Event-ID``
        (``<epoch>-<generation>``, carried by the ``tick`` event). A topic whose
        route raised arrives as ``route_error`` instead of going silent.
        """
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        self.close_connection = True
        sampler = _sampler_acquire(str(query.get("project") or ""))
        epoch, _, gen_text = (
            (self.headers.get("Last-Event-ID") or "").strip().partition("-")
        )
        seen = int(gen_text) if epoch == sampler.epoch and gen_text.isdigit() else 0

        def emit(event: str, data, event_id: str | None = None) -> None:
            payload = json.dumps(data, default=str, separators=(",", ":"))
            ident = f"id: {event_id}\n" if event_id else ""
            self.wfile.write(f"{ident}event: {event}\ndata: {payload}\n\n".encode())
            self.wfile.flush()

        try:
            self.wfile.write(b"retry: 3000\n\n")
            self.wfile.flush()
            while True:
                with sampler.cond:
                    fresh = sampler.cond.wait_for(
                        lambda: sampler.gen > seen, timeout=SSE_HEARTBEAT_S
                    )
                    gen = sampler.gen
                    events = [
                        (e, t["body"])
                        for e, t in sampler.topics.items()
                        if t["gen"] > seen
                    ]
                    errors = [
                        (e, x["error"])
                        for e, x in sampler.errors.items()
                        if x["gen"] > seen
                    ]
                if not fresh:
                    self.wfile.write(b": heartbeat\n\n")
                    self.wfile.flush()
                    continue
                for event, body in events:
                    emit(event, body)
                for topic, message in errors:
                    emit("route_error", {"topic": topic, "error": message})
                emit("tick", {"ts": time.time()}, f"{sampler.epoch}-{gen}")
                seen = gen
        except (BrokenPipeError, ConnectionResetError, OSError):
            return  # client went away; the thread ends with the connection
        finally:
            _sampler_release(sampler)

    # -- v2 dispatch ---------------------------------------------------------------

    def _dispatch_v2(self, method: str, path: str, query: dict, body: dict) -> bool:
        """Run a mounted v2 route. True when one matched (reply already sent)."""
        for m, rx, fn in V2_ROUTES:
            if m != method:
                continue
            match = rx.fullmatch(path)
            if not match:
                continue
            try:
                status, payload = _v2_call(
                    method, path, query, body, fn, match.groups()
                )
            except Exception as e:  # one module's bug never kills the server
                sys.stderr.write(f"[atlas-dashboard] v2 {method} {path}: {e!r}\n")
                self._json(
                    500,
                    {
                        "ok": False,
                        "error": str(e) or type(e).__name__,
                        "why": "the route raised an exception",
                        "do": "check dashboard.log",
                    },
                )
                return True
            self._json(status, payload)
            return True
        return False

    def _query(self, u) -> dict:
        return {k: v[0] for k, v in parse_qs(u.query).items()}

    def do_OPTIONS(self):
        # No CORS preflight is honoured: the UI is same-origin, so cross-origin
        # pages get no Allow-* headers and the browser blocks them.
        self.send_response(204)
        self.send_header("Allow", "GET, HEAD, POST, PUT")
        self.end_headers()

    def do_HEAD(self):
        u = urlparse(self.path)
        if self._guard("HEAD", u.path, self._query(u)):
            if not self._serve_static(u.path, head_only=True):
                self._json(404, {"ok": False, "error": "not_found", "path": u.path})

    def do_GET(self):
        u = urlparse(self.path)
        query = self._query(u)
        if not self._guard("GET", u.path, query):
            return
        if self._serve_static(u.path):
            return
        if u.path == "/api/v2/stream":
            return self._sse(query)
        if self._dispatch_v2("GET", u.path, query, {}):
            return
        return self._legacy_get(u)

    def _legacy_get(self, u):
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
                    "url": dashboard_url(self._served_port()),
                    "pid": os.getpid(),
                    "db_path": dashboard_db_path(),
                    "script": str(Path(__file__).resolve()),
                    "version": _plugin_manifest().get("version"),
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
            qs = parse_qs(u.query)
            editable = qs.get("editable", [""])[0] in ("1", "true")
            conn, _ = _db()
            try:
                return self._json(
                    200,
                    {"ok": True, "projects": _projects(conn, editable_only=editable)},
                )
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
        if u.path == "/api/todo":
            qs = parse_qs(u.query)
            root = _project_root(qs.get("project_id", [None])[0])
            if not root:
                return self._json(400, {"ok": False, "error": "unknown_project"})
            return self._json(200, _todo_payload(root))
        if u.path == "/api/agents":
            qs = parse_qs(u.query)
            root = _project_root(qs.get("project_id", [None])[0])
            if not root:
                return self._json(400, {"ok": False, "error": "unknown_project"})
            return self._json(200, _agents_payload(root))
        if u.path.startswith("/api/agents/"):
            name = unquote(u.path[len("/api/agents/") :])
            qs = parse_qs(u.query)
            root = _project_root(qs.get("project_id", [None])[0])
            return self._json(200, _agent_content(root, name))
        if u.path == "/api/memory":
            try:
                import atlas_memory

                return self._json(200, {"ok": True, **atlas_memory.load_snapshot()})
            except Exception as e:
                return self._json(200, {"ok": False, "error": str(e)})
        return self._json(404, {"ok": False, "error": "not_found", "path": u.path})

    MAX_BODY = 4 * 1024 * 1024

    def _mutate(self, method: str):
        u = urlparse(self.path)
        query = self._query(u)
        if not self._guard(method, u.path, query):
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._deny(
                400,
                "bad_length",
                "Content-Length is not a number",
                "send a valid length",
            )
        if length > self.MAX_BODY:
            return self._deny(
                413,
                "body_too_large",
                f"{length} bytes exceeds {self.MAX_BODY}",
                "send a smaller body",
            )
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            return self._json(400, {"ok": False, "error": "invalid_json"})
        if not isinstance(data, dict):
            return self._deny(
                400, "invalid_json", "body must be a JSON object", "wrap it in {}"
            )
        if self._dispatch_v2(method, u.path, query, data):
            return
        if method == "POST":
            return self._legacy_post(u, data)
        return self._json(404, {"ok": False, "error": "not_found", "path": u.path})

    def do_POST(self):
        return self._mutate("POST")

    def do_PUT(self):
        return self._mutate("PUT")

    def _legacy_post(self, u, data):
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
        if u.path == "/api/todo":
            root = _project_root(data.get("project_id"))
            if not root:
                return self._json(400, {"ok": False, "error": "unknown_project"})
            action = str(data.get("action") or "")
            item_id = str(data.get("id") or "")
            try:
                if action == "add":
                    r = atlas_todo.add(
                        root, str(data.get("content") or ""), origin="manual"
                    )
                elif action == "claim":
                    r = atlas_todo.claim(
                        root,
                        item_id,
                        str(data.get("owner") or "dashboard"),
                        force=bool(data.get("force")),
                    )
                elif action == "complete":
                    r = atlas_todo.set_status(
                        root,
                        item_id,
                        "completed",
                        owner=str(data.get("owner") or "dashboard"),
                        evidence=str(
                            data.get("evidence") or "completed from dashboard"
                        ),
                    )
                elif action == "reopen":
                    r = atlas_todo.set_status(
                        root,
                        item_id,
                        "pending",
                        owner=str(data.get("owner") or "dashboard"),
                    )
                elif action == "remove":
                    r = atlas_todo.remove(root, item_id)
                else:
                    r = {"ok": False, "error": "unknown_action"}
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
            return self._json(200, r)
        if u.path == "/api/agents":
            root = _project_root(data.get("project_id"))
            if not root:
                return self._json(400, {"ok": False, "error": "unknown_project"})
            action = str(data.get("action") or "")
            name = str(data.get("name") or "")
            content = data.get("content")
            try:
                if action == "save":
                    r = _agent_save(root, name, content)
                elif action == "reset":
                    r = _agent_reset(root, name)
                else:
                    r = {"ok": False, "error": "unknown_action"}
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
            return self._json(200, r)
        return self._json(404, {"ok": False, "error": "not_found"})


def _is_loopback_host(host: str) -> bool:
    """True only for 127.0.0.1/::1-range addresses or the literal 'localhost'.

    An unparseable hostname (anything that isn't a literal IP) is treated as
    non-loopback: 'localhost' is the one named exception ip_address() can't
    resolve on its own.
    """
    if host == "localhost":
        return True
    try:
        import ipaddress

        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


class _Server(ThreadingHTTPServer):
    # The stdlib backlog of 5 resets connections under a burst of tabs/clients.
    request_queue_size = 128


def serve(host: str, port: int):
    os.environ["ATLAS_DB"] = dashboard_db_path()
    os.environ["ATLAS_DASHBOARD_DB"] = dashboard_db_path()
    httpd = _Server((host, port), Handler)
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
    __import__(
        "atlas_selffix"
    ).start_scheduler()  # daemon thread; serve() is not run by tests/imports
    httpd.serve_forever()


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    sp = sub.add_parser("serve")
    sp.add_argument("--port", type=int, default=DEFAULT_PORT)
    sp.add_argument("--host", default=LOOPBACK)
    sp.add_argument("--foreground", action="store_true")
    sp.add_argument(
        "--allow-remote",
        action="store_true",
        help="Allow binding a non-loopback --host (e.g. 0.0.0.0 or a LAN IP). "
        "The dashboard serves session/findings data with no auth; binding it "
        "to all interfaces exposes that data to the network. Off by default.",
    )
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
        if not _is_loopback_host(args.host) and not args.allow_remote:
            sys.stderr.write(
                f"[atlas-dashboard] refusing to bind non-loopback host {args.host!r}; "
                "pass --allow-remote to expose the dashboard beyond localhost\n"
            )
            return 1
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
