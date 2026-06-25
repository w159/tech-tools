"""Atlas observability store. Single global SQLite SSOT for coding-agent run health.

Stdlib-only. Stores paths, tool names, counts, timestamps - never code or secrets.
Callers in hooks MUST wrap usage in try/except and fail open; this module may raise.
"""

import os
import sqlite3
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY, root_path TEXT UNIQUE NOT NULL,
  name TEXT, stack TEXT, first_seen REAL, last_seen REAL);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, session_id TEXT,
  started_at REAL, ended_at REAL, wall_clock_s REAL, task_summary TEXT, model TEXT);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL, ts REAL, tool TEXT,
  context TEXT, is_inline_op INTEGER, path TEXT);
CREATE TABLE IF NOT EXISTS dispatches (
  id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL, ts REAL,
  agent_type TEXT, model TEXT, wave_id INTEGER);
CREATE TABLE IF NOT EXISTS metrics (
  run_id INTEGER PRIMARY KEY, inline_ops INTEGER, dispatches INTEGER,
  parallel_waves INTEGER, in_flight_peak INTEGER, est_context_tokens INTEGER,
  recall_hits INTEGER, recall_misses INTEGER, verifier_coverage REAL,
  wall_clock_s REAL);
CREATE TABLE IF NOT EXISTS improvements (
  id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL, ts REAL,
  dimension TEXT, baseline TEXT, target TEXT, note TEXT);
"""

DISPATCH_TOOLS = ("Agent", "Task")


def db_path():
    return os.environ.get("ATLAS_DB") or os.path.expanduser("~/.atlas/atlas.db")


def connect(path=None):
    path = path or db_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path, timeout=5.0)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init(conn):
    conn.executescript(SCHEMA)
    conn.commit()


def register_project(conn, root_path, name=None, stack=None):
    now = time.time()
    conn.execute(
        "INSERT INTO projects(root_path,name,stack,first_seen,last_seen) "
        "VALUES(?,?,?,?,?) ON CONFLICT(root_path) DO UPDATE SET last_seen=?, "
        "name=COALESCE(?,name), stack=COALESCE(?,stack)",
        (root_path, name, stack, now, now, now, name, stack),
    )
    conn.commit()
    return conn.execute(
        "SELECT id FROM projects WHERE root_path=?", (root_path,)
    ).fetchone()[0]


def start_run(conn, project_id, session_id, task_summary=None, model=None):
    cur = conn.execute(
        "INSERT INTO runs(project_id,session_id,started_at,task_summary,model) "
        "VALUES(?,?,?,?,?)",
        (project_id, session_id, time.time(), task_summary, model),
    )
    conn.commit()
    return cur.lastrowid


def current_run_id(conn, session_id):
    row = conn.execute(
        "SELECT id FROM runs WHERE session_id=? AND ended_at IS NULL "
        "ORDER BY id DESC LIMIT 1",
        (session_id,),
    ).fetchone()
    return row[0] if row else None


def log_event(conn, run_id, tool, context, is_inline_op, path=None):
    cur = conn.execute(
        "INSERT INTO events(run_id,ts,tool,context,is_inline_op,path) "
        "VALUES(?,?,?,?,?,?)",
        (run_id, time.time(), tool, context, int(is_inline_op), path),
    )
    conn.commit()
    return cur.lastrowid


def log_dispatch(conn, run_id, agent_type, model=None, wave_id=None):
    conn.execute(
        "INSERT INTO dispatches(run_id,ts,agent_type,model,wave_id) VALUES(?,?,?,?,?)",
        (run_id, time.time(), agent_type, model, wave_id),
    )
    eid = log_event(conn, run_id, agent_type, "main", 0)
    return eid


def inline_ops_since_last_dispatch(conn, run_id):
    last = conn.execute(
        "SELECT COALESCE(MAX(id),0) FROM events WHERE run_id=? AND is_inline_op=0",
        (run_id,),
    ).fetchone()[0]
    return conn.execute(
        "SELECT COUNT(*) FROM events WHERE run_id=? AND is_inline_op=1 AND id>?",
        (run_id, last),
    ).fetchone()[0]


def finalize_run(conn, run_id, wall_clock_s=None):
    inline = conn.execute(
        "SELECT COUNT(*) FROM events WHERE run_id=? AND is_inline_op=1",
        (run_id,),
    ).fetchone()[0]
    disp = conn.execute(
        "SELECT COUNT(*) FROM dispatches WHERE run_id=?", (run_id,)
    ).fetchone()[0]
    conn.execute(
        "UPDATE runs SET ended_at=?, wall_clock_s=? WHERE id=?",
        (time.time(), wall_clock_s, run_id),
    )
    conn.execute(
        "INSERT INTO metrics(run_id,inline_ops,dispatches,wall_clock_s) "
        "VALUES(?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET inline_ops=?, "
        "dispatches=?, wall_clock_s=?",
        (run_id, inline, disp, wall_clock_s, inline, disp, wall_clock_s),
    )
    conn.commit()


def run_metrics(conn, run_id):
    row = conn.execute("SELECT * FROM metrics WHERE run_id=?", (run_id,)).fetchone()
    if not row:
        return {}
    cols = [
        c[0]
        for c in conn.execute(
            "SELECT * FROM metrics WHERE run_id=?", (run_id,)
        ).description
    ]
    return dict(zip(cols, row))


def record_improvement(conn, run_id, dimension, baseline, target, note):
    cur = conn.execute(
        "INSERT INTO improvements(run_id,ts,dimension,baseline,target,note) "
        "VALUES(?,?,?,?,?,?)",
        (run_id, time.time(), dimension, baseline, target, note),
    )
    conn.commit()
    return cur.lastrowid


def trends(conn, limit=20):
    rows = conn.execute(
        "SELECT r.id, p.root_path, m.inline_ops, m.dispatches, m.wall_clock_s "
        "FROM runs r JOIN projects p ON p.id=r.project_id "
        "LEFT JOIN metrics m ON m.run_id=r.id "
        "ORDER BY r.id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [
        dict(
            zip(
                ("run_id", "root_path", "inline_ops", "dispatches", "wall_clock_s"),
                r,
            )
        )
        for r in rows
    ]
