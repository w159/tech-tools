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
  started_at REAL, ended_at REAL, wall_clock_s REAL, task_summary TEXT, model TEXT,
  kind TEXT DEFAULT 'orchestrator', orchestrating INTEGER DEFAULT 0);
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
CREATE TABLE IF NOT EXISTS asset_verdicts (
  id INTEGER PRIMARY KEY, project_id INTEGER, ts REAL,
  kind TEXT, key TEXT, tags TEXT, verdict TEXT, est_tokens INTEGER,
  applied INTEGER DEFAULT 0, restored INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_asset_verdicts_key ON asset_verdicts(kind, key);

-- Session-log mirror: the rich transcript forensics layer. Populated by the
-- ingest hook (Stop/SubagentStop/SessionEnd/PreCompact) and the backfill CLI,
-- which parse the on-disk jsonl transcripts Claude Code already writes. This is
-- what lets sextant see WHICH tools/skills/mcp/agents ran, the real token/cache
-- cost, repeated user requests, and behavioral signals (assumption admissions,
-- user corrections) that never reach the sparse `events` table.
CREATE TABLE IF NOT EXISTS session_logs (
  id INTEGER PRIMARY KEY,
  session_id TEXT UNIQUE NOT NULL,
  project_id INTEGER,
  transcript_path TEXT, cwd TEXT, git_branch TEXT, model TEXT,
  started_at REAL, ended_at REAL,
  message_count INTEGER DEFAULT 0, user_prompt_count INTEGER DEFAULT 0,
  tool_call_count INTEGER DEFAULT 0, error_count INTEGER DEFAULT 0,
  input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0, cache_creation_tokens INTEGER DEFAULT 0,
  cursor_bytes INTEGER DEFAULT 0, cursor_lines INTEGER DEFAULT 0,
  file_size INTEGER DEFAULT 0, file_mtime REAL, last_ingest_at REAL);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, session_id TEXT NOT NULL,
  uuid TEXT, parent_uuid TEXT, ts REAL, role TEXT,
  is_sidechain INTEGER DEFAULT 0, model TEXT, thinking TEXT, text TEXT,
  input_tokens INTEGER, output_tokens INTEGER,
  cache_read_tokens INTEGER, cache_creation_tokens INTEGER, service_tier TEXT);
CREATE INDEX IF NOT EXISTS ix_messages_session ON messages(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_messages_uuid ON messages(uuid);
CREATE TABLE IF NOT EXISTS tool_calls (
  id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, message_uuid TEXT, ts REAL,
  is_sidechain INTEGER DEFAULT 0, tool_use_id TEXT, tool_name TEXT,
  kind TEXT, target TEXT, server TEXT,
  input_summary TEXT, input_bytes INTEGER DEFAULT 0,
  is_error INTEGER, result_bytes INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_tool_calls_session ON tool_calls(session_id);
CREATE INDEX IF NOT EXISTS ix_tool_calls_kind ON tool_calls(kind, target);
CREATE UNIQUE INDEX IF NOT EXISTS ix_tool_calls_tuid ON tool_calls(tool_use_id);
CREATE TABLE IF NOT EXISTS user_prompts (
  id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, uuid TEXT, ts REAL,
  text TEXT, char_len INTEGER, norm TEXT);
CREATE INDEX IF NOT EXISTS ix_user_prompts_session ON user_prompts(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_user_prompts_uuid ON user_prompts(uuid);
CREATE INDEX IF NOT EXISTS ix_user_prompts_norm ON user_prompts(norm);
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, message_uuid TEXT, ts REAL,
  signal_type TEXT, weight REAL DEFAULT 1.0, snippet TEXT);
CREATE INDEX IF NOT EXISTS ix_signals_session ON signals(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_signals_dedupe ON signals(message_uuid, signal_type);
"""


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
    # Idempotent migration: add kind column to pre-existing DBs. Fresh DBs
    # already have it from the SCHEMA; the OperationalError is the success path
    # for any DB initialized before this column was added.
    try:
        conn.execute("ALTER TABLE runs ADD COLUMN kind TEXT DEFAULT 'orchestrator'")
        conn.commit()
    except sqlite3.OperationalError:
        pass  # column already present
    try:
        conn.execute("ALTER TABLE runs ADD COLUMN orchestrating INTEGER DEFAULT 0")
        conn.commit()
    except sqlite3.OperationalError:
        pass  # column already present
    backfill_run_kinds(conn)


def backfill_run_kinds(conn):
    """Classify all existing runs whose session has at least one message row.
    A run is 'worker' when its session has >=1 total messages but zero
    non-sidechain (is_sidechain=0) messages. Sessions with no ingested
    messages are left at the default 'orchestrator' -- absence of data is
    not evidence of worker status. Idempotent."""
    conn.execute(
        "UPDATE runs SET kind='worker' "
        "WHERE session_id IN ("
        "  SELECT session_id FROM messages "
        "  GROUP BY session_id "
        "  HAVING COUNT(*) >= 1 "
        "  AND SUM(CASE WHEN is_sidechain=0 THEN 1 ELSE 0 END) = 0"
        ")"
    )
    conn.execute(
        "UPDATE runs SET kind='orchestrator' "
        "WHERE session_id IN ("
        "  SELECT session_id FROM messages "
        "  GROUP BY session_id "
        "  HAVING SUM(CASE WHEN is_sidechain=0 THEN 1 ELSE 0 END) >= 1"
        ")"
    )
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


def latest_run_id(conn, session_id):
    """Most recent run for a session, open OR closed. Unlike current_run_id this
    still resolves after the Stop hook has finalized the run, so the post-ingest
    metric derivation can attach to it regardless of hook ordering."""
    row = conn.execute(
        "SELECT id FROM runs WHERE session_id=? ORDER BY id DESC LIMIT 1",
        (session_id,),
    ).fetchone()
    return row[0] if row else None


def mark_orchestrating(conn, session_id, cwd=None):
    """Flag this session's run as a real atlas orchestration run. Idempotent.
    Creates a run if none exists yet (e.g. the boot hook has not fired).
    Optionally writes an advisory sentinel under <cwd>/docs/.run/."""
    rid = current_run_id(conn, session_id) or latest_run_id(conn, session_id)
    if rid is None:
        base = cwd or "."
        pid = register_project(conn, base, os.path.basename(os.path.abspath(base)))
        rid = start_run(conn, pid, session_id)
    conn.execute("UPDATE runs SET orchestrating=1 WHERE id=?", (rid,))
    conn.commit()
    if cwd:
        _write_orchestration_sentinel(cwd)
    return rid


def is_orchestrating(conn, session_id):
    """True when this session's current-or-latest run is flagged orchestrating."""
    rid = current_run_id(conn, session_id) or latest_run_id(conn, session_id)
    if rid is None:
        return False
    row = conn.execute("SELECT orchestrating FROM runs WHERE id=?", (rid,)).fetchone()
    return bool(row and row[0])


def _write_orchestration_sentinel(cwd):
    """Advisory only. Never read for gating; a stale file must not enable a gate."""
    try:
        run_dir = os.path.join(cwd, "docs", ".run")
        os.makedirs(run_dir, exist_ok=True)
        with open(os.path.join(run_dir, "atlas-engine.active"), "w") as f:
            f.write(str(time.time()))
    except Exception:
        pass  # sentinel is best-effort


def current_or_last_run_id(conn, session_id):
    """Active run if one exists (ended_at IS NULL), otherwise the most recent
    run for this session regardless of ended_at. Returns None only when the
    session has no run at all. Use this when a dispatch may arrive after
    finalize_run has closed the run -- the finalized row is still the right
    target for attribution."""
    row = conn.execute(
        "SELECT id FROM runs WHERE session_id=? AND ended_at IS NULL "
        "ORDER BY id DESC LIMIT 1",
        (session_id,),
    ).fetchone()
    if row:
        return row[0]
    row = conn.execute(
        "SELECT id FROM runs WHERE session_id=? ORDER BY id DESC LIMIT 1",
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


def record_recall(conn, run_id, hit):
    """Record a memory-recall outcome from the engine Orient step. hit=True increments
    recall_hits (the memory lookup returned a usable lesson); hit=False increments
    recall_misses (the lookup ran but returned nothing usable). Creates the run's metrics
    row if absent. Touches only the recall columns - the derive_run_metrics upsert omits
    them - so recall survives every mirror-refresh derive cycle."""
    col = "recall_hits" if hit else "recall_misses"
    # `col` is one of two fixed internal literals, never user input - safe to interpolate.
    conn.execute(
        "INSERT INTO metrics(run_id,%s) VALUES(?,1) "
        "ON CONFLICT(run_id) DO UPDATE SET %s=COALESCE(%s,0)+1" % (col, col, col),
        (run_id,),
    )
    conn.commit()


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
    # Default the wall clock to the run's own elapsed time. Callers (the Stop
    # hook) rarely have a precomputed duration, and a NULL here is why
    # wall_clock_s was empty on every historical run.
    if wall_clock_s is None:
        started = conn.execute(
            "SELECT started_at FROM runs WHERE id=?", (run_id,)
        ).fetchone()
        if started and started[0] is not None:
            wall_clock_s = max(0.0, time.time() - started[0])
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
    cur = conn.execute("SELECT * FROM metrics WHERE run_id=?", (run_id,))
    row = cur.fetchone()
    if not row:
        return {}
    cols = [c[0] for c in cur.description]
    return dict(zip(cols, row))


def derive_run_metrics(conn, run_id, session_id, window_s=10.0):
    """Compute the run-health columns that no live hook can fill, from the
    transcript mirror, and write them onto the metrics row. Fills the columns
    that were previously always NULL:

      est_context_tokens - peak orchestrator context = max(input+cache_read) over
                           main-thread (non-sidechain) messages this session.
      verifier_coverage  - verifier dispatches / implementer dispatches, capped
                           at 1.0; None when nothing was dispatched to verify.
      parallel_waves     - count of dispatch clusters (>=2 agent dispatches inside
                           a `window_s` window). Approximate - timestamp-based.
      in_flight_peak     - max agent dispatches inside any `window_s` window.
      wall_clock_s       - session span from the mirror, if not already set.

    recall_hits / recall_misses are intentionally NOT derived: deciding whether a
    memory result was actually usable is a semantic judgment, not a count. They
    stay NULL and are filled by the sextant skill when it reads the messages.
    Returns the computed dict."""
    peak = conn.execute(
        "SELECT MAX(COALESCE(input_tokens,0)+COALESCE(cache_read_tokens,0)) "
        "FROM messages WHERE session_id=? AND is_sidechain=0",
        (session_id,),
    ).fetchone()[0]
    impl = conn.execute(
        "SELECT COUNT(*) FROM tool_calls WHERE session_id=? AND kind='agent' "
        "AND target LIKE '%implementer%'",
        (session_id,),
    ).fetchone()[0]
    ver = conn.execute(
        "SELECT COUNT(*) FROM tool_calls WHERE session_id=? AND kind='agent' "
        "AND target LIKE '%verifier%'",
        (session_id,),
    ).fetchone()[0]
    coverage = min(1.0, ver / impl) if impl else None
    ts = [
        r[0]
        for r in conn.execute(
            "SELECT ts FROM tool_calls WHERE session_id=? AND kind='agent' "
            "AND ts IS NOT NULL ORDER BY ts",
            (session_id,),
        ).fetchall()
    ]
    in_flight_peak, parallel_waves = _dispatch_waves(ts, window_s)
    span = conn.execute(
        "SELECT ended_at-started_at FROM session_logs WHERE session_id=? "
        "AND started_at IS NOT NULL AND ended_at IS NOT NULL",
        (session_id,),
    ).fetchone()
    wall = span[0] if span else None
    # finalize_run's dispatches count is a one-shot snapshot taken at the first
    # Stop hook; dispatches landing in later turns of the same session (via the
    # dispatch_tripwire last-run fallback) never reach it. Recompute here so the
    # metrics row reflects every dispatch row ingested by the time this runs.
    disp = conn.execute(
        "SELECT COUNT(*) FROM dispatches WHERE run_id=?", (run_id,)
    ).fetchone()[0]
    conn.execute(
        "INSERT INTO metrics(run_id,est_context_tokens,parallel_waves,"
        "in_flight_peak,verifier_coverage,wall_clock_s,dispatches) VALUES(?,?,?,?,?,?,?) "
        "ON CONFLICT(run_id) DO UPDATE SET est_context_tokens=excluded.est_context_tokens,"
        "parallel_waves=excluded.parallel_waves,in_flight_peak=excluded.in_flight_peak,"
        "verifier_coverage=excluded.verifier_coverage,"
        # finalize_run's elapsed time is authoritative; the transcript-span value
        # derived here only fills a wall_clock that finalize never set (e.g. a
        # backfill-only session). Existing value wins, so derive never clobbers it.
        "wall_clock_s=COALESCE(wall_clock_s,excluded.wall_clock_s),"
        "dispatches=excluded.dispatches",
        (run_id, peak, parallel_waves, in_flight_peak, coverage, wall, disp),
    )
    # Classify run kind from message thread visibility. Only act when at least
    # one message is ingested; sessions with no messages stay 'orchestrator'.
    total_msgs = conn.execute(
        "SELECT COUNT(*) FROM messages WHERE session_id=?",
        (session_id,),
    ).fetchone()[0]
    if total_msgs >= 1:
        main_msgs = conn.execute(
            "SELECT COUNT(*) FROM messages WHERE session_id=? AND is_sidechain=0",
            (session_id,),
        ).fetchone()[0]
        kind = "worker" if main_msgs == 0 else "orchestrator"
        conn.execute("UPDATE runs SET kind=? WHERE id=?", (kind, run_id))
    conn.commit()
    return {
        "est_context_tokens": peak,
        "verifier_coverage": coverage,
        "parallel_waves": parallel_waves,
        "in_flight_peak": in_flight_peak,
        "wall_clock_s": wall,
    }


def _dispatch_waves(sorted_ts, window_s):
    """(in_flight_peak, parallel_waves) from sorted dispatch timestamps using a
    sliding window. A wave is a window holding >=2 dispatches."""
    if not sorted_ts:
        return 0, 0
    peak, waves, j = 1, 0, 0
    counted = [False] * len(sorted_ts)
    for i in range(len(sorted_ts)):
        while sorted_ts[i] - sorted_ts[j] > window_s:
            j += 1
        size = i - j + 1
        peak = max(peak, size)
        if size >= 2 and not counted[j]:
            waves += 1
            for k in range(j, i + 1):
                counted[k] = True
    return peak, waves


def record_improvement(conn, run_id, dimension, baseline, target, note):
    cur = conn.execute(
        "INSERT INTO improvements(run_id,ts,dimension,baseline,target,note) "
        "VALUES(?,?,?,?,?,?)",
        (run_id, time.time(), dimension, baseline, target, note),
    )
    conn.commit()
    return cur.lastrowid


TREND_COLUMNS = (
    "run_id",
    "root_path",
    "inline_ops",
    "dispatches",
    "parallel_waves",
    "in_flight_peak",
    "est_context_tokens",
    "recall_hits",
    "recall_misses",
    "verifier_coverage",
    "wall_clock_s",
)


def trends(conn, limit=20):
    """Cross-run/cross-project rows over the FULL metric set. The skill's Trends
    table compares dimensions like verifier_coverage and parallel_waves, so every
    derived column is returned here - not just the three the live hooks write."""
    rows = conn.execute(
        "SELECT r.id, p.root_path, m.inline_ops, m.dispatches, m.parallel_waves, "
        "m.in_flight_peak, m.est_context_tokens, m.recall_hits, m.recall_misses, "
        "m.verifier_coverage, m.wall_clock_s "
        "FROM runs r JOIN projects p ON p.id=r.project_id "
        "LEFT JOIN metrics m ON m.run_id=r.id "
        "WHERE COALESCE(r.kind,'orchestrator')='orchestrator' "
        "ORDER BY r.id DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [dict(zip(TREND_COLUMNS, r)) for r in rows]


# --- asset/context audit (the context-cost lens) ------------------------------


def record_asset_verdicts(conn, project_id, assets):
    """Persist this run's non-keep verdicts. `assets` are dicts from
    asset_audit (kind, key, tags, verdict, est_tokens). Idempotent per
    (project, kind, key): the latest verdict replaces the prior one."""
    now = time.time()
    for a in assets:
        if a.get("verdict") == "keep":
            continue
        conn.execute(
            "DELETE FROM asset_verdicts WHERE project_id=? AND kind=? AND key=? "
            "AND applied=0 AND restored=0",
            (project_id, a["kind"], a["key"]),
        )
        conn.execute(
            "INSERT INTO asset_verdicts"
            "(project_id,ts,kind,key,tags,verdict,est_tokens) VALUES(?,?,?,?,?,?,?)",
            (
                project_id,
                now,
                a["kind"],
                a["key"],
                ",".join(a.get("tags", [])),
                a["verdict"],
                a.get("est_tokens", 0),
            ),
        )
    conn.commit()


def mark_asset_applied(conn, kind, key):
    conn.execute(
        "UPDATE asset_verdicts SET applied=1 WHERE kind=? AND key=?", (kind, key)
    )
    conn.commit()


def note_asset_restore(conn, kind, key):
    """A restore is the learning signal: a flag the user reversed = false
    positive. Future audits suppress it via suppressed_assets()."""
    conn.execute(
        "UPDATE asset_verdicts SET restored=1 WHERE kind=? AND key=?", (kind, key)
    )
    conn.commit()


def suppressed_assets(conn):
    """Set of (kind, key) the user has restored before; never re-flag them."""
    rows = conn.execute(
        "SELECT DISTINCT kind, key FROM asset_verdicts WHERE restored=1"
    ).fetchall()
    return {(k, v) for k, v in rows}


def asset_audit_summary(conn):
    """Cross-run learning view: counts by verdict + false-positive rate."""
    total = conn.execute("SELECT COUNT(*) FROM asset_verdicts").fetchone()[0]
    restored = conn.execute(
        "SELECT COUNT(*) FROM asset_verdicts WHERE restored=1"
    ).fetchone()[0]
    applied = conn.execute(
        "SELECT COUNT(*) FROM asset_verdicts WHERE applied=1"
    ).fetchone()[0]
    return {
        "verdicts": total,
        "applied": applied,
        "restored": restored,
        "false_positive_rate": round(restored / applied, 3) if applied else 0.0,
    }


# --- session-log mirror: write path (used by the ingest hook + backfill) ------


def session_cursor(conn, session_id):
    """Return (cursor_bytes, file_size) for incremental ingest. (0, 0) if new."""
    row = conn.execute(
        "SELECT cursor_bytes, file_size FROM session_logs WHERE session_id=?",
        (session_id,),
    ).fetchone()
    return (row[0], row[1]) if row else (0, 0)


def upsert_session_log(conn, session_id, **fields):
    """Insert or update the per-session meta row. Only the keys passed in
    `fields` are written; absent keys keep their stored value (COALESCE)."""
    cols = (
        "project_id",
        "transcript_path",
        "cwd",
        "git_branch",
        "model",
        "started_at",
        "ended_at",
        "cursor_bytes",
        "cursor_lines",
        "file_size",
        "file_mtime",
        "last_ingest_at",
    )
    vals = {c: fields.get(c) for c in cols}
    conn.execute(
        "INSERT INTO session_logs(session_id," + ",".join(cols) + ") "
        "VALUES(?," + ",".join("?" for _ in cols) + ") "
        "ON CONFLICT(session_id) DO UPDATE SET "
        + ",".join(f"{c}=COALESCE(excluded.{c},{c})" for c in cols),
        (session_id, *[vals[c] for c in cols]),
    )
    conn.commit()


def insert_message(conn, session_id, m):
    """Idempotent on uuid. `m` is a dict of message fields."""
    conn.execute(
        "INSERT OR IGNORE INTO messages(session_id,uuid,parent_uuid,ts,role,"
        "is_sidechain,model,thinking,text,input_tokens,output_tokens,"
        "cache_read_tokens,cache_creation_tokens,service_tier) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            session_id,
            m.get("uuid"),
            m.get("parent_uuid"),
            m.get("ts"),
            m.get("role"),
            int(m.get("is_sidechain", 0)),
            m.get("model"),
            m.get("thinking"),
            m.get("text"),
            m.get("input_tokens"),
            m.get("output_tokens"),
            m.get("cache_read_tokens"),
            m.get("cache_creation_tokens"),
            m.get("service_tier"),
        ),
    )


def insert_tool_call(conn, session_id, t):
    """Idempotent on tool_use_id."""
    conn.execute(
        "INSERT OR IGNORE INTO tool_calls(session_id,message_uuid,ts,is_sidechain,"
        "tool_use_id,tool_name,kind,target,server,input_summary,input_bytes,"
        "is_error,result_bytes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            session_id,
            t.get("message_uuid"),
            t.get("ts"),
            int(t.get("is_sidechain", 0)),
            t.get("tool_use_id"),
            t.get("tool_name"),
            t.get("kind"),
            t.get("target"),
            t.get("server"),
            t.get("input_summary"),
            t.get("input_bytes"),
            t.get("is_error"),
            t.get("result_bytes"),
        ),
    )


def update_tool_result(conn, tool_use_id, is_error, result_bytes):
    """Join a tool_result back onto its tool_use row (results arrive in the
    next message, sometimes a later ingest batch). Idempotent."""
    conn.execute(
        "UPDATE tool_calls SET is_error=?, result_bytes=? WHERE tool_use_id=?",
        (is_error, result_bytes, tool_use_id),
    )


def insert_user_prompt(conn, session_id, p):
    conn.execute(
        "INSERT OR IGNORE INTO user_prompts(session_id,uuid,ts,text,char_len,norm) "
        "VALUES(?,?,?,?,?,?)",
        (
            session_id,
            p.get("uuid"),
            p.get("ts"),
            p.get("text"),
            p.get("char_len"),
            p.get("norm"),
        ),
    )


def insert_signal(conn, session_id, s):
    """Idempotent per (message_uuid, signal_type)."""
    conn.execute(
        "INSERT OR IGNORE INTO signals(session_id,message_uuid,ts,signal_type,"
        "weight,snippet) VALUES(?,?,?,?,?,?)",
        (
            session_id,
            s.get("message_uuid"),
            s.get("ts"),
            s.get("signal_type"),
            s.get("weight", 1.0),
            s.get("snippet"),
        ),
    )


def refresh_session_aggregates(conn, session_id):
    """Recompute counts/token totals from child rows. Idempotent regardless of
    how many times a transcript was (re-)ingested, so cursor resets never
    double-count."""
    conn.execute(
        "UPDATE session_logs SET "
        "message_count=(SELECT COUNT(*) FROM messages WHERE session_id=:s),"
        "user_prompt_count=(SELECT COUNT(*) FROM user_prompts WHERE session_id=:s),"
        "tool_call_count=(SELECT COUNT(*) FROM tool_calls WHERE session_id=:s),"
        "error_count=(SELECT COUNT(*) FROM tool_calls WHERE session_id=:s AND is_error=1),"
        "input_tokens=(SELECT COALESCE(SUM(input_tokens),0) FROM messages WHERE session_id=:s),"
        "output_tokens=(SELECT COALESCE(SUM(output_tokens),0) FROM messages WHERE session_id=:s),"
        "cache_read_tokens=(SELECT COALESCE(SUM(cache_read_tokens),0) FROM messages WHERE session_id=:s),"
        "cache_creation_tokens=(SELECT COALESCE(SUM(cache_creation_tokens),0) FROM messages WHERE session_id=:s) "
        "WHERE session_id=:s",
        {"s": session_id},
    )
    conn.commit()


def reset_session_rows(conn, session_id):
    """Drop a session's child rows so a from-scratch re-ingest is clean
    (used when a transcript was truncated/rewritten under the cursor)."""
    for tbl in ("messages", "tool_calls", "user_prompts", "signals"):
        conn.execute(f"DELETE FROM {tbl} WHERE session_id=?", (session_id,))
    conn.commit()


# --- session-log mirror: read path (the sextant session-forensics lens) -------


def _rows(cur):
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def tool_usage(conn, kind=None, project_id=None):
    """Per-target usage rollup: calls, errors, sessions touched, total input
    bytes. Filter by kind (builtin|skill|mcp|agent|command) and/or project."""
    q = (
        "SELECT t.kind, t.target, t.server, COUNT(*) AS calls,"
        " SUM(COALESCE(t.is_error,0)) AS errors,"
        " COUNT(DISTINCT t.session_id) AS sessions,"
        " SUM(COALESCE(t.input_bytes,0)) AS input_bytes "
        "FROM tool_calls t "
    )
    where, args = [], []
    if project_id is not None:
        q += "JOIN session_logs s ON s.session_id=t.session_id "
        where.append("s.project_id=?")
        args.append(project_id)
    if kind:
        where.append("t.kind=?")
        args.append(kind)
    if where:
        q += "WHERE " + " AND ".join(where) + " "
    q += "GROUP BY t.kind, t.target, t.server ORDER BY calls DESC"
    return _rows(conn.execute(q, args))


def context_tool_health(conn):
    """Cache efficiency + the context/memory trio's call and error rates. Low
    cache-read share or a high error rate on context-mode/claude-mem/ponytail
    means the context-protection layer is not actually helping."""
    tok = conn.execute(
        "SELECT COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(input_tokens),0),"
        " COALESCE(SUM(cache_creation_tokens),0), COALESCE(SUM(output_tokens),0) "
        "FROM session_logs"
    ).fetchone()
    cache_read, inp, cache_create, out = tok
    denom = (cache_read or 0) + (inp or 0)
    rows = _rows(
        conn.execute(
            "SELECT server, COUNT(*) AS calls, SUM(COALESCE(is_error,0)) AS errors,"
            " COUNT(DISTINCT session_id) AS sessions FROM tool_calls "
            "WHERE kind='mcp' AND server IN "
            "('context-mode','claude-mem','ponytail') GROUP BY server"
        )
    )
    return {
        "cache_read_tokens": cache_read,
        "fresh_input_tokens": inp,
        "cache_hit_ratio": round(cache_read / denom, 3) if denom else 0.0,
        "cache_creation_tokens": cache_create,
        "output_tokens": out,
        "context_tools": {r["server"]: r for r in rows},
    }


def signal_rollup(conn, signal_type=None, limit=50):
    """Behavioral signals (assumption_admission, user_correction, ...) with
    their session and a snippet, most recent first. This surfaces the
    agent-penny class of issue without re-reading any transcript."""
    q = (
        "SELECT g.signal_type, g.session_id, p.root_path, g.ts, g.snippet "
        "FROM signals g LEFT JOIN session_logs s ON s.session_id=g.session_id "
        "LEFT JOIN projects p ON p.id=s.project_id "
    )
    args = []
    if signal_type:
        q += "WHERE g.signal_type=? "
        args.append(signal_type)
    q += "ORDER BY g.ts DESC LIMIT ?"
    args.append(limit)
    return _rows(conn.execute(q, args))


def signal_counts(conn):
    """Count of each signal type, plus how many distinct projects show it."""
    return _rows(
        conn.execute(
            "SELECT g.signal_type, COUNT(*) AS n,"
            " COUNT(DISTINCT s.project_id) AS projects "
            "FROM signals g LEFT JOIN session_logs s ON s.session_id=g.session_id "
            "GROUP BY g.signal_type ORDER BY n DESC"
        )
    )


def repeated_prompts(conn, min_count=3, limit=30):
    """Normalized user prompts that recur across sessions - the repetitive-task
    signal. A high count means a workflow that should become a skill/command or
    a CLAUDE.md rule, not a re-typed request."""
    return _rows(
        conn.execute(
            "SELECT norm, COUNT(*) AS n, COUNT(DISTINCT session_id) AS sessions,"
            " MIN(text) AS sample FROM user_prompts "
            "WHERE norm IS NOT NULL AND LENGTH(norm)>=12 "
            "GROUP BY norm HAVING n>=? ORDER BY n DESC LIMIT ?",
            (min_count, limit),
        )
    )


def idle_assets(conn, kind, known_keys):
    """Of the assets present this environment (`known_keys`), which were never
    invoked in any ingested session. Feeds the 'remove/relocate unused' lens."""
    used = {
        r[0]
        for r in conn.execute(
            "SELECT DISTINCT target FROM tool_calls WHERE kind=?", (kind,)
        ).fetchall()
    }
    return sorted(k for k in known_keys if k not in used)


if __name__ == "__main__":
    import sys as _sys

    if len(_sys.argv) >= 3 and _sys.argv[1] == "mark-orchestrating":
        _session = _sys.argv[2]
        _cwd = _sys.argv[3] if len(_sys.argv) >= 4 else os.getcwd()
        _c = connect()
        init(_c)
        _rid = mark_orchestrating(_c, _session, _cwd)
        print("orchestrating run %s for session %s" % (_rid, _session))

    elif len(_sys.argv) >= 4 and _sys.argv[1] == "record-recall":
        _session = _sys.argv[2]
        _outcome = _sys.argv[3]  # must be exactly "hit" or "miss"
        if _outcome not in ("hit", "miss"):
            # Reject anything else rather than silently counting it as a miss, so an
            # improvised outcome word can't pollute recall_misses.
            print(
                "recall outcome must be 'hit' or 'miss', got %r; not recorded"
                % _outcome
            )
        else:
            _c = connect()
            init(_c)
            _rid = current_run_id(_c, _session) or latest_run_id(_c, _session)
            if _rid is None:
                print("no run for session %s; recall not recorded" % _session)
            else:
                record_recall(_c, _rid, _outcome == "hit")
                print("recorded recall %s for run %s" % (_outcome, _rid))
