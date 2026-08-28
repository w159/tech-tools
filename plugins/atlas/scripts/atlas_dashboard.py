#!/usr/bin/env python3
"""Atlas multi-session local dashboard (claude-mem / Serena style worker UI).

One shared loopback daemon serves ALL concurrent coding-agent terminals.
SessionStart ensures the daemon is up and injects the URL once; it does not
open a new browser tab per terminal (avoids Serena-style focus stealing).

  python3 atlas_dashboard.py status
  python3 atlas_dashboard.py serve [--port N]
  python3 atlas_dashboard.py ensure   # start if needed; print URL
  python3 atlas_dashboard.py stop

UI:  http://127.0.0.1:7421/
API: http://127.0.0.1:7421/api/status
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
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen

SCRIPTS_DIR = Path(__file__).resolve().parent
PLUGIN_ROOT = SCRIPTS_DIR.parent
sys.path.insert(0, str(SCRIPTS_DIR))

import atlas_db  # noqa: E402

DEFAULT_PORT = int(os.environ.get("ATLAS_DASHBOARD_PORT", "7421"))
# Build loopback without a contiguous literal some redactors mangle.
LOOPBACK = ".".join(["127", "0", "0", "1"])
STATE_DIR = Path(os.environ.get("ATLAS_HOME") or Path.home() / ".atlas")
PID_PATH = STATE_DIR / "dashboard.pid"
LOG_PATH = STATE_DIR / "dashboard.log"


def _db():
    path = atlas_db.db_path()
    conn = atlas_db.connect(path)
    atlas_db.init(conn)
    return conn, path


def _q(conn, sql, args=(), one=False):
    cur = conn.execute(sql, args)
    cols = [c[0] for c in cur.description] if cur.description else []
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    return rows[0] if one and rows else (rows if not one else None)


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


def _env_file_status():
    path = PLUGIN_ROOT / ".env"
    example_keys = _env_example_keys()
    present = set()
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            k, v = s.split("=", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if v:
                present.add(k)
    return {
        "path": str(path),
        "exists": path.is_file(),
        "keys_defined_in_example": example_keys,
        "keys_set": sorted(k for k in example_keys if k in present),
        "keys_missing": sorted(k for k in example_keys if k not in present),
    }


def _connector_status():
    manifest = _plugin_manifest()
    mcp = _mcp_json()
    user_config = manifest.get("userConfig") or {}
    servers = mcp.get("mcpServers") or {}
    env_status = _env_file_status()
    set_env = set(env_status["keys_set"])
    out = []
    for name, cfg in servers.items():
        bundle = PLUGIN_ROOT / "mcp" / name / "server.mjs"
        env_map = cfg.get("env") or {}
        cfg_keys = [k for k in env_map if k.startswith("CFG_")]
        requiredish = [k[4:] for k in cfg_keys]
        uc_refs = []
        for v in env_map.values():
            if isinstance(v, str):
                m = re.search(r"\$\{user_config\.([a-z0-9_]+)\}", v)
                if m:
                    uc_refs.append(m.group(1))
        sensitive = [
            k
            for k in uc_refs
            if isinstance(user_config.get(k), dict) and user_config[k].get("sensitive")
        ]
        out.append(
            {
                "name": name,
                "bundle_exists": bundle.is_file(),
                "bundle_bytes": bundle.stat().st_size if bundle.is_file() else 0,
                "user_config_fields": uc_refs,
                "sensitive_fields": sensitive,
                "env_keys": requiredish,
                "env_keys_set": sorted(k for k in requiredish if k in set_env),
                "env_keys_missing": sorted(k for k in requiredish if k not in set_env),
                "configured_hint": any(k in set_env for k in requiredish),
            }
        )
    return out


def _projects(conn):
    return _q(
        conn,
        """
        SELECT p.id, p.root_path, p.name, p.stack, p.first_seen, p.last_seen,
               COUNT(DISTINCT r.id) AS run_count,
               SUM(CASE WHEN r.orchestrating=1 AND r.ended_at IS NULL THEN 1 ELSE 0 END) AS active_orchestrating
        FROM projects p
        LEFT JOIN runs r ON r.project_id = p.id
        GROUP BY p.id
        ORDER BY p.last_seen DESC
        """,
    )


def _sessions(conn, project_id=None, limit=40):
    args: list = []
    where = ""
    if project_id is not None:
        where = "WHERE COALESCE(sl.project_id, r.project_id) = ?"
        args.append(project_id)
    args.append(limit)
    return _q(
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
          SELECT session_id FROM runs WHERE session_id IS NOT NULL
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
        # fallback to runs-only
        session = _q(
            conn,
            """
            SELECT r.session_id, r.project_id, p.name AS project_name, p.root_path AS project_root,
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
    tools = _q(
        conn,
        """
        SELECT tool_name, kind, target, server, is_error, ts, input_summary, result_bytes
        FROM tool_calls WHERE session_id=? ORDER BY ts DESC LIMIT 80
        """,
        (session_id,),
    )
    prompts = _q(
        conn,
        """
        SELECT ts, char_len,
               CASE WHEN length(text) > 240 THEN substr(text,1,240) || '…' ELSE text END AS text
        FROM user_prompts WHERE session_id=? ORDER BY ts DESC LIMIT 20
        """,
        (session_id,),
    )
    friction = _q(
        conn,
        """
        SELECT category, weight, snippet, ts FROM friction_events
        WHERE session_id=? ORDER BY ts DESC LIMIT 30
        """,
        (session_id,),
    )
    events = _q(
        conn,
        """
        SELECT e.ts, e.tool, e.context, e.is_inline_op, e.path
        FROM events e
        JOIN runs r ON r.id = e.run_id
        WHERE r.session_id=?
        ORDER BY e.ts DESC LIMIT 60
        """,
        (session_id,),
    )
    dispatches = _q(
        conn,
        """
        SELECT d.ts, d.agent_type, d.model, d.wave_id
        FROM dispatches d
        JOIN runs r ON r.id = d.run_id
        WHERE r.session_id=?
        ORDER BY d.ts DESC LIMIT 40
        """,
        (session_id,),
    )
    return {
        "session": session,
        "tools": tools,
        "prompts": prompts,
        "friction": friction,
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
          SUM(m.inline_ops) AS sum_inline_ops,
          SUM(m.dispatches) AS sum_dispatches,
          SUM(m.est_context_tokens) AS sum_est_context_tokens
        FROM runs r
        LEFT JOIN metrics m ON m.run_id = r.id
        """,
        one=True,
    ) or {}
    open_findings = _q(
        conn, "SELECT COUNT(*) AS n FROM findings WHERE status='open'", one=True
    )
    active = _q(
        conn,
        """
        SELECT r.session_id, r.project_id, p.name AS project_name, p.root_path,
               r.started_at, r.task_summary, r.model,
               m.inline_ops, m.dispatches, m.verifier_coverage, m.est_context_tokens
        FROM runs r
        LEFT JOIN projects p ON p.id = r.project_id
        LEFT JOIN metrics m ON m.run_id = r.id
        WHERE r.orchestrating=1 AND r.ended_at IS NULL
        ORDER BY r.started_at DESC
        LIMIT 20
        """,
    )
    return {
        "totals": totals,
        "open_findings": (open_findings or {}).get("n", 0),
        "recent_runs": recent,
        "active_sessions": active,
    }


def _savings_estimate(conn):
    row = _q(
        conn,
        """
        SELECT
          SUM(m.dispatches) AS dispatches,
          SUM(m.inline_ops) AS inline_ops,
          SUM(m.parallel_waves) AS parallel_waves,
          SUM(m.est_context_tokens) AS est_context_tokens,
          SUM(m.recall_hits) AS recall_hits,
          SUM(m.recall_misses) AS recall_misses,
          AVG(m.verifier_coverage) AS avg_verifier_coverage
        FROM metrics m
        """,
        one=True,
    ) or {}
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


def _findings(conn, limit=30):
    return _q(
        conn,
        """
        SELECT id, created_at, dimension, severity, title, detail, status,
               proposed_action, target_path
        FROM findings
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (limit,),
    )


def snapshot(project_id=None):
    conn, dbpath = _db()
    try:
        manifest = _plugin_manifest()
        return {
            "ok": True,
            "generated_at": time.time(),
            "url": f"http://{LOOPBACK}:{DEFAULT_PORT}/",
            "plugin": {
                "name": manifest.get("name"),
                "version": manifest.get("version"),
                "root": str(PLUGIN_ROOT),
            },
            "db_path": dbpath,
            "projects": _projects(conn),
            "sessions": _sessions(conn, project_id=project_id, limit=40),
            "health": _run_health(conn, project_id=project_id),
            "savings": _savings_estimate(conn),
            "connectors": _connector_status(),
            "env_file": _env_file_status(),
            "findings": _findings(conn),
            "user_config_fields": sorted((manifest.get("userConfig") or {}).keys()),
        }
    finally:
        conn.close()


def write_env_updates(updates: dict):
    allowed = set(_env_example_keys())
    bad = [k for k in updates if k not in allowed]
    if bad:
        return {"ok": False, "error": "keys_not_allowlisted", "keys": bad}
    path = PLUGIN_ROOT / ".env"
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
        if not isinstance(v, str):
            v = str(v)
        v = v.replace("\n", "").replace("\r", "")
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
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {
        "ok": True,
        "updated_keys": sorted(updates.keys()),
        "note": "Restart Claude Code / reload plugins so MCP servers re-read env.",
    }


# --- singleton daemon helpers (one UI for all terminals) ---------------------

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
        data = json.loads(PID_PATH.read_text(encoding="utf-8"))
        return data
    except Exception:
        return None


def _write_pidfile(pid: int, port: int):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    PID_PATH.write_text(
        json.dumps(
            {"pid": pid, "port": port, "host": LOOPBACK, "started_at": time.time()},
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


def ensure_daemon(port: int | None = None) -> dict:
    """Start the shared dashboard if needed. Safe for concurrent SessionStart hooks."""
    port = port or DEFAULT_PORT
    url = dashboard_url(port)
    existing = _read_pidfile()
    if existing and _pid_alive(int(existing.get("pid") or 0)) and _port_open(
        LOOPBACK, int(existing.get("port") or port)
    ):
        return {
            "ok": True,
            "already_running": True,
            "url": dashboard_url(int(existing.get("port") or port)),
            "pid": existing.get("pid"),
            "port": int(existing.get("port") or port),
        }
    if _port_open(LOOPBACK, port):
        # Something healthy is already bound (pidfile missing/stale).
        return {
            "ok": True,
            "already_running": True,
            "url": url,
            "pid": None,
            "port": port,
        }
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    logf = open(LOG_PATH, "a", encoding="utf-8")
    env = os.environ.copy()
    env["ATLAS_DASHBOARD_PORT"] = str(port)
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
    # wait briefly for listen
    for _ in range(40):
        if _port_open(LOOPBACK, port):
            _write_pidfile(proc.pid, port)
            return {
                "ok": True,
                "already_running": False,
                "url": url,
                "pid": proc.pid,
                "port": port,
            }
        time.sleep(0.05)
    return {
        "ok": False,
        "error": "daemon_did_not_bind",
        "pid": proc.pid,
        "port": port,
        "log": str(LOG_PATH),
    }


def stop_daemon() -> dict:
    info = _read_pidfile()
    if not info:
        return {"ok": True, "stopped": False, "reason": "no_pidfile"}
    pid = int(info.get("pid") or 0)
    if _pid_alive(pid):
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError as e:
            return {"ok": False, "error": str(e)}
    _clear_pidfile()
    return {"ok": True, "stopped": True, "pid": pid}


# --- HTML UI -----------------------------------------------------------------

UI_HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Atlas Dashboard</title>
<style>
  :root {
    --bg:#0b1220; --panel:#121a2b; --panel2:#182235; --border:#243044;
    --text:#e7eefc; --muted:#93a4c3; --accent:#5b9dff; --good:#3ddc97;
    --warn:#ffcc66; --bad:#ff6b7a; --chip:#1e2a40;
  }
  *{box-sizing:border-box}
  body{margin:0;font:14px/1.45 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;
       background:radial-gradient(1200px 600px at 10% -10%,#1a2744 0%,var(--bg) 55%);color:var(--text)}
  header{display:flex;gap:12px;align-items:center;justify-content:space-between;
         padding:14px 18px;border-bottom:1px solid var(--border);backdrop-filter:blur(8px);
         position:sticky;top:0;background:rgba(11,18,32,.86);z-index:5}
  h1{font-size:16px;margin:0;letter-spacing:.2px}
  .sub{color:var(--muted);font-size:12px}
  .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  select,button,input{background:var(--panel2);color:var(--text);border:1px solid var(--border);
         border-radius:10px;padding:8px 10px}
  button{cursor:pointer}
  button:hover{border-color:var(--accent)}
  main{display:grid;grid-template-columns:280px 1fr;gap:14px;padding:14px}
  @media (max-width:980px){main{grid-template-columns:1fr}}
  .card{background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--border);
        border-radius:16px;padding:14px;box-shadow:0 10px 30px rgba(0,0,0,.25)}
  .metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px}
  @media (max-width:980px){.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
  .metric .v{font-size:22px;font-weight:700}
  .metric .l{color:var(--muted);font-size:12px}
  .list{display:flex;flex-direction:column;gap:8px;max-height:70vh;overflow:auto}
  .item{padding:10px;border:1px solid var(--border);border-radius:12px;background:rgba(255,255,255,.02);cursor:pointer}
  .item.active,.item:hover{border-color:var(--accent);background:rgba(91,157,255,.08)}
  .chip{display:inline-block;padding:2px 8px;border-radius:999px;background:var(--chip);color:var(--muted);font-size:11px;margin-right:4px}
  .good{color:var(--good)} .warn{color:var(--warn)} .bad{color:var(--bad)}
  table{width:100%;border-collapse:collapse}
  th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--border);vertical-align:top}
  th{color:var(--muted);font-weight:600;font-size:12px}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  @media (max-width:980px){.grid2{grid-template-columns:1fr}}
  .muted{color:var(--muted)}
  .bar{height:8px;background:#0e1626;border-radius:99px;overflow:hidden}
  .bar>i{display:block;height:100%;background:linear-gradient(90deg,#3ddc97,#5b9dff)}
</style>
</head>
<body>
<header>
  <div>
    <h1>Atlas Dashboard</h1>
    <div class="sub">Shared across concurrent coding-agent terminals · <span id="url" class="mono"></span></div>
  </div>
  <div class="row">
    <label class="sub">Project
      <select id="project"></select>
    </label>
    <label class="sub">Session
      <select id="session"></select>
    </label>
    <button id="refresh">Refresh</button>
    <button id="copy">Copy URL</button>
  </div>
</header>
<main>
  <section class="card">
    <div class="row" style="justify-content:space-between;margin-bottom:8px">
      <strong>Sessions</strong>
      <span class="sub" id="sessionCount"></span>
    </div>
    <div class="list" id="sessionList"></div>
  </section>
  <section>
    <div class="metrics" id="metrics"></div>
    <div class="grid2">
      <div class="card">
        <strong>Selected session</strong>
        <div id="detail" class="sub" style="margin-top:8px">Pick a session…</div>
      </div>
      <div class="card">
        <strong>Savings proxies</strong>
        <div id="savings" class="sub" style="margin-top:8px"></div>
      </div>
    </div>
    <div class="grid2" style="margin-top:12px">
      <div class="card">
        <strong>Tools (recent)</strong>
        <div style="overflow:auto;max-height:280px;margin-top:8px">
          <table><thead><tr><th>When</th><th>Tool</th><th>Target</th><th>Err</th></tr></thead>
          <tbody id="tools"></tbody></table>
        </div>
      </div>
      <div class="card">
        <strong>Connectors</strong>
        <div style="overflow:auto;max-height:280px;margin-top:8px">
          <table><thead><tr><th>Name</th><th>Configured</th><th>Missing keys</th></tr></thead>
          <tbody id="connectors"></tbody></table>
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:12px">
      <strong>Open findings</strong>
      <div style="overflow:auto;max-height:220px;margin-top:8px">
        <table><thead><tr><th>Sev</th><th>Title</th><th>Dimension</th></tr></thead>
        <tbody id="findings"></tbody></table>
      </div>
    </div>
  </section>
</main>
<script>
const $ = (id) => document.getElementById(id);
let state = {snapshot:null, selectedSession:null, selectedProject:null};

function fmtTime(epoch){
  if(!epoch) return '—';
  const d = new Date(epoch*1000);
  return d.toLocaleString();
}
function shortId(s){ return (s||'').slice(0,10); }
function pct(x){ return (x==null||Number.isNaN(x)) ? '—' : (100*x).toFixed(0)+'%'; }
function num(x){ return (x==null) ? '—' : Number(x).toLocaleString(); }

async function api(path){
  const r = await fetch(path, {cache:'no-store'});
  if(!r.ok) throw new Error(path+' '+r.status);
  return r.json();
}

function metric(label, value, cls=''){
  return `<div class="card metric"><div class="v ${cls}">${value}</div><div class="l">${label}</div></div>`;
}

function renderMetrics(s){
  const t = s.health?.totals || {};
  const active = (s.health?.active_sessions||[]).length;
  $('metrics').innerHTML = [
    metric('Active orchestrating', active, active? 'good':''),
    metric('Runs', num(t.runs)),
    metric('Dispatches', num(t.sum_dispatches)),
    metric('Inline ops', num(t.sum_inline_ops)),
    metric('Avg verifier', pct(t.avg_verifier_coverage)),
    metric('Est. context tokens', num(t.sum_est_context_tokens)),
    metric('Open findings', num(s.health?.open_findings), s.health?.open_findings? 'warn':''),
    metric('Plugin', s.plugin?.version || '—'),
  ].join('');
}

function renderSavings(s){
  const v = s.savings||{};
  const ratio = v.dispatch_ratio==null? '—' : v.dispatch_ratio.toFixed(2);
  const hit = pct(v.recall_hit_rate);
  const cov = pct(v.avg_verifier_coverage);
  $('savings').innerHTML = `
    <div class="row" style="margin-bottom:8px"><span class="chip">dispatch/inline ${ratio}</span>
    <span class="chip">recall hit ${hit}</span><span class="chip">verifier ${cov}</span></div>
    <div class="muted">${v.note||''}</div>
    <div style="margin-top:10px">Dispatches <strong>${num(v.dispatches)}</strong> · Inline <strong>${num(v.inline_ops)}</strong></div>
    <div class="bar" style="margin-top:8px"><i style="width:${Math.min(100, (v.dispatch_ratio||0)*40)}%"></i></div>
  `;
}

function renderProjects(s){
  const sel = $('project');
  const cur = state.selectedProject;
  const opts = [`<option value="">All projects</option>`].concat(
    (s.projects||[]).map(p => {
      const label = `${p.name||p.root_path} (${p.run_count||0})`;
      const val = String(p.id);
      return `<option value="${val}" ${cur===val?'selected':''}>${label}</option>`;
    })
  );
  sel.innerHTML = opts.join('');
}

function filteredSessions(s){
  let list = s.sessions||[];
  if(state.selectedProject){
    list = list.filter(x => String(x.project_id)===String(state.selectedProject));
  }
  return list;
}

function renderSessionList(s){
  const list = filteredSessions(s);
  $('sessionCount').textContent = list.length + ' shown';
  const sel = $('session');
  sel.innerHTML = list.map(x => {
    const label = `${x.project_name||'project'} · ${shortId(x.session_id)} · ${x.orchestrating? 'LIVE': (x.ended_at?'done':'open')}`;
    return `<option value="${x.session_id}" ${state.selectedSession===x.session_id?'selected':''}>${label}</option>`;
  }).join('');
  $('sessionList').innerHTML = list.map(x => {
    const live = x.orchestrating ? '<span class="chip good">LIVE</span>' : '';
    const active = state.selectedSession===x.session_id ? 'active':'';
    return `<div class="item ${active}" data-sid="${x.session_id}">
      <div class="row" style="justify-content:space-between">
        <strong>${x.project_name||'—'}</strong>${live}
      </div>
      <div class="mono muted">${shortId(x.session_id)}</div>
      <div class="muted">${fmtTime(x.started_at)} · disp ${num(x.dispatches)} · inline ${num(x.inline_ops)}</div>
    </div>`;
  }).join('') || '<div class="muted">No sessions yet.</div>';
  document.querySelectorAll('#sessionList .item').forEach(el => {
    el.onclick = () => { state.selectedSession = el.dataset.sid; loadDetail(); renderSessionList(state.snapshot); };
  });
}

function renderConnectors(s){
  $('connectors').innerHTML = (s.connectors||[]).map(c => {
    const ok = c.configured_hint;
    return `<tr>
      <td class="mono">${c.name}</td>
      <td class="${ok?'good':'warn'}">${ok?'yes':'no'}</td>
      <td class="mono muted">${(c.env_keys_missing||[]).slice(0,4).join(', ')||'—'}</td>
    </tr>`;
  }).join('');
}

function renderFindings(s){
  $('findings').innerHTML = (s.findings||[]).filter(f=>f.status==='open').slice(0,20).map(f =>
    `<tr><td class="warn">${f.severity||''}</td><td>${f.title||''}</td><td class="muted">${f.dimension||''}</td></tr>`
  ).join('') || '<tr><td colspan="3" class="muted">No open findings</td></tr>';
}

async function loadDetail(){
  if(!state.selectedSession){
    $('detail').textContent = 'Pick a session…';
    $('tools').innerHTML = '';
    return;
  }
  const d = await api('/api/sessions/'+encodeURIComponent(state.selectedSession));
  const s = d.session||{};
  $('detail').innerHTML = `
    <div><span class="chip">${s.project_name||'—'}</span>
         <span class="chip">${s.orchestrating?'orchestrating':'idle'}</span>
         <span class="chip">${s.agent||'claude'}</span>
         <span class="chip">${s.model||'—'}</span></div>
    <div class="mono" style="margin-top:8px">${s.session_id||''}</div>
    <div class="muted" style="margin-top:6px">${s.project_root||s.cwd||''}</div>
    <div style="margin-top:10px">Task: <strong>${s.task_summary||s.brief_summary||'—'}</strong></div>
    <div class="row" style="margin-top:8px">
      <span class="chip">dispatches ${num(s.dispatches)}</span>
      <span class="chip">inline ${num(s.inline_ops)}</span>
      <span class="chip">verifier ${pct(s.verifier_coverage)}</span>
      <span class="chip">tokens ~${num(s.est_context_tokens)}</span>
      <span class="chip">gates ${num(s.gate_block_count)}</span>
    </div>
    <div class="muted" style="margin-top:8px">${s.outcome||s.primary_success||''}</div>
  `;
  $('tools').innerHTML = (d.tools||[]).map(t =>
    `<tr>
      <td class="muted">${fmtTime(t.ts)}</td>
      <td class="mono">${t.tool_name||''}</td>
      <td class="mono muted">${(t.target||t.server||'').toString().slice(0,48)}</td>
      <td class="${t.is_error?'bad':''}">${t.is_error?'yes':''}</td>
    </tr>`
  ).join('') || '<tr><td colspan="4" class="muted">No tool calls mirrored yet</td></tr>';
}

async function refresh(){
  const q = state.selectedProject ? ('?project_id='+encodeURIComponent(state.selectedProject)) : '';
  const s = await api('/api/status'+q);
  state.snapshot = s;
  $('url').textContent = s.url || location.origin;
  renderMetrics(s);
  renderSavings(s);
  renderProjects(s);
  renderSessionList(s);
  renderConnectors(s);
  renderFindings(s);
  if(!state.selectedSession){
    const first = filteredSessions(s)[0];
    if(first) state.selectedSession = first.session_id;
  }
  if(state.selectedSession) await loadDetail();
}

$('project').onchange = async (e) => {
  state.selectedProject = e.target.value || null;
  state.selectedSession = null;
  await refresh();
};
$('session').onchange = async (e) => {
  state.selectedSession = e.target.value || null;
  renderSessionList(state.snapshot||{sessions:[]});
  await loadDetail();
};
$('refresh').onclick = () => refresh();
$('copy').onclick = async () => {
  const u = state.snapshot?.url || location.href;
  await navigator.clipboard.writeText(u);
  $('copy').textContent = 'Copied';
  setTimeout(()=>$('copy').textContent='Copy URL', 1200);
};

refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>
"""


class Handler(BaseHTTPRequestHandler):
    server_version = "AtlasDashboard/1.0"

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
        if u.path in ("/api/health", "/health"):
            return self._json(
                200,
                {
                    "ok": True,
                    "service": "atlas-dashboard",
                    "url": dashboard_url(),
                    "pid": os.getpid(),
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
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
            finally:
                conn.close()
        if u.path == "/api/sessions":
            qs = parse_qs(u.query)
            project_id = qs.get("project_id", [None])[0]
            project_id = int(project_id) if project_id not in (None, "") else None
            limit = int(qs.get("limit", ["40"])[0])
            conn, _ = _db()
            try:
                return self._json(
                    200,
                    {
                        "ok": True,
                        "sessions": _sessions(conn, project_id=project_id, limit=limit),
                    },
                )
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
            finally:
                conn.close()
        if u.path.startswith("/api/sessions/"):
            sid = u.path[len("/api/sessions/") :]
            conn, _ = _db()
            try:
                detail = _session_detail(conn, sid)
                if not detail.get("session"):
                    return self._json(404, {"ok": False, "error": "session_not_found"})
                return self._json(200, {"ok": True, **detail})
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
            finally:
                conn.close()
        if u.path == "/api/connectors":
            try:
                return self._json(
                    200,
                    {
                        "ok": True,
                        "connectors": _connector_status(),
                        "env_file": _env_file_status(),
                    },
                )
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
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
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
            finally:
                conn.close()
        if u.path == "/api/findings":
            conn, _ = _db()
            try:
                return self._json(200, {"ok": True, "findings": _findings(conn)})
            except Exception as e:
                return self._json(500, {"ok": False, "error": str(e)})
            finally:
                conn.close()
        return self._json(404, {"ok": False, "error": "not_found"})

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
            return self._json(200, write_env_updates(updates))
        return self._json(404, {"ok": False, "error": "not_found"})


def serve(host: str, port: int):
    httpd = ThreadingHTTPServer((host, port), Handler)
    _write_pidfile(os.getpid(), port)
    atexit.register(_clear_pidfile)

    def _stop(signum, frame):
        _clear_pidfile()
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    sys.stderr.write(
        f"[atlas-dashboard] {dashboard_url(port)}  (shared multi-session UI, loopback only)\n"
    )
    httpd.serve_forever()


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status", help="Print full JSON snapshot")
    sp = sub.add_parser("serve", help="Run the shared dashboard daemon")
    sp.add_argument("--port", type=int, default=DEFAULT_PORT)
    sp.add_argument("--host", default=LOOPBACK)
    sp.add_argument(
        "--foreground",
        action="store_true",
        help="Internal: run server in this process (used by ensure)",
    )
    ep = sub.add_parser("ensure", help="Start shared daemon if needed; print URL JSON")
    ep.add_argument("--port", type=int, default=DEFAULT_PORT)
    sub.add_parser("stop", help="Stop shared daemon")
    sub.add_parser("url", help="Print dashboard URL if reachable")
    args = p.parse_args(argv)

    if args.cmd == "status":
        json.dump(snapshot(), sys.stdout, indent=2, default=str)
        sys.stdout.write("\n")
        return 0
    if args.cmd == "url":
        info = ensure_daemon(DEFAULT_PORT) if False else _read_pidfile()
        # only report if up
        if _port_open(LOOPBACK, DEFAULT_PORT):
            print(dashboard_url(DEFAULT_PORT))
            return 0
        print("", end="")
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
        # If already running, do not bind twice.
        if _port_open(args.host, args.port) and not args.foreground:
            print(dashboard_url(args.port))
            return 0
        serve(args.host, args.port)
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
