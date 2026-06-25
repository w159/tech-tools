# Atlas Plugin Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-architect the atlas plugin so subagent fan-out is mechanically forced (not just advised), skill overlap is removed, every skill is discovery-first and on-theme, and atlas's own run health is measured into a single global SQLite observability database.

**Architecture:** A shared stdlib `atlas_db.py` module owns one global SQLite SSOT (`~/.atlas/atlas.db`). The `session_boot.py` hook builds/registers into it on every run; a new `dispatch_tripwire.py` PostToolUse hook logs inline-op vs dispatch events and injects a hard STOP when the main session drifts inline. `atlas-engine` gains a mechanical Workflow decision gate. Skills are renamed to the `atlas-<one themed word>` convention, the redundant ones are deleted, and two new discovery-first swarms (`atlas-cartographer`, `atlas-survey`) plus the de-hardcoded `atlas-expedition` are added.

**Tech Stack:** Python 3 (stdlib only: `sqlite3`, `json`, `unittest`), Claude Code plugin format (SKILL.md, hooks.json, plugin.json), the Workflow tool, the `graphify` skill.

## Global Constraints

- Skill naming rule: every skill is `atlas-<one atlas-themed word>` - exactly one dash, no second/internal dash. Two-dash names are non-conformant.
- Final skill set (8): `atlas-engine`, `atlas-architect`, `atlas-cartographer`, `atlas-sextant`, `atlas-orbit`, `atlas-harbor`, `atlas-expedition`, `atlas-survey`. Deleted: `atlas-operating-contract`, `atlas-loop`, `atlas-connectors`, `atlas-self-improving`, `atlas-uxt-swarm` (the last four are renames, not net deletions).
- Hooks are stdlib-only and fail-open: any internal error exits 0 and never blocks a session.
- The observability DB stores paths, tool names, counts, timestamps only - never file contents, code, or secrets. It lives at `~/.atlas/atlas.db` (override `ATLAS_DB`), outside any repo, never committed.
- Writing style (repo rule): US-keyboard ASCII only - no em/en dashes, no curly quotes, no ellipsis character.
- iCloud build rule: never run `npm install` inside the repo. Skills/hooks/python need no install. Do not rebuild MCP `.mcpb` bundles (connectors are unchanged).
- Commit target: `main` (user-authorized for this work). Branch not required.
- Every change lands across all layers per the repo CLAUDE.md propagation rule; a per-layer disparity is a bug even when no test fails.

---

## Phase 1 - Observability foundation

### Task 1: `atlas_db.py` - the SQLite SSOT module

**Files:**
- Create: `plugins/atlas/scripts/atlas_db.py`
- Test: `plugins/atlas/scripts/test_atlas_db.py`

**Interfaces:**
- Produces (imported by hooks + atlas-sextant):
  - `db_path() -> str`
  - `connect(path: str | None = None) -> sqlite3.Connection` (WAL, busy_timeout=5000, ensures parent dir)
  - `init(conn) -> None` (idempotent `CREATE TABLE IF NOT EXISTS`)
  - `register_project(conn, root_path: str, name: str | None = None, stack: str | None = None) -> int`
  - `start_run(conn, project_id: int, session_id: str, task_summary: str | None = None, model: str | None = None) -> int`
  - `current_run_id(conn, session_id: str) -> int | None` (latest run with `ended_at IS NULL`)
  - `log_event(conn, run_id: int, tool: str, context: str, is_inline_op: int, path: str | None = None) -> int`
  - `log_dispatch(conn, run_id: int, agent_type: str, model: str | None = None, wave_id: int | None = None) -> int` (also writes an `events` row with tool=`agent_type`, is_inline_op=0)
  - `inline_ops_since_last_dispatch(conn, run_id: int) -> int`
  - `finalize_run(conn, run_id: int, wall_clock_s: float | None = None) -> None` (aggregates into `metrics`)
  - `run_metrics(conn, run_id: int) -> dict`
  - `record_improvement(conn, run_id: int, dimension: str, baseline: str, target: str, note: str) -> int`
  - `trends(conn, limit: int = 20) -> list[dict]`

- [ ] **Step 1: Write the failing test**

Create `plugins/atlas/scripts/test_atlas_db.py`:

```python
import os, tempfile, unittest
import atlas_db


class AtlasDbTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "atlas.db")
        self.conn = atlas_db.connect(self.path)
        atlas_db.init(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_init_is_idempotent(self):
        atlas_db.init(self.conn)  # second call must not raise
        names = {r[0] for r in self.conn.execute(
            "select name from sqlite_master where type='table'")}
        self.assertTrue({"projects", "runs", "events", "dispatches",
                         "metrics", "improvements"} <= names)

    def test_register_project_is_stable_by_path(self):
        a = atlas_db.register_project(self.conn, "/repo/x", "x", "python")
        b = atlas_db.register_project(self.conn, "/repo/x")
        self.assertEqual(a, b)  # same path -> same id

    def test_inline_ops_reset_on_dispatch(self):
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-1")
        for _ in range(3):
            atlas_db.log_event(self.conn, rid, "Read", "main", 1, "a.py")
        self.assertEqual(atlas_db.inline_ops_since_last_dispatch(self.conn, rid), 3)
        atlas_db.log_dispatch(self.conn, rid, "atlas:explorer")
        self.assertEqual(atlas_db.inline_ops_since_last_dispatch(self.conn, rid), 0)
        atlas_db.log_event(self.conn, rid, "Grep", "main", 1)
        self.assertEqual(atlas_db.inline_ops_since_last_dispatch(self.conn, rid), 1)

    def test_finalize_and_run_metrics(self):
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-1")
        atlas_db.log_event(self.conn, rid, "Read", "main", 1)
        atlas_db.log_dispatch(self.conn, rid, "atlas:implementer")
        atlas_db.finalize_run(self.conn, rid, wall_clock_s=42.0)
        m = atlas_db.run_metrics(self.conn, rid)
        self.assertEqual(m["inline_ops"], 1)
        self.assertEqual(m["dispatches"], 1)
        self.assertEqual(m["wall_clock_s"], 42.0)

    def test_record_improvement_and_trends(self):
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-1")
        atlas_db.finalize_run(self.conn, rid)
        atlas_db.record_improvement(self.conn, rid, "parallelism", "0 waves",
                                    ">=3 waves", "fan out the audit")
        rows = self.conn.execute("select count(*) from improvements").fetchone()
        self.assertEqual(rows[0], 1)
        self.assertGreaterEqual(len(atlas_db.trends(self.conn)), 1)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugins/atlas/scripts && python3 -m unittest test_atlas_db -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'atlas_db'`.

- [ ] **Step 3: Write minimal implementation**

Create `plugins/atlas/scripts/atlas_db.py`:

```python
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
        (root_path, name, stack, now, now, now, name, stack))
    conn.commit()
    return conn.execute("SELECT id FROM projects WHERE root_path=?",
                        (root_path,)).fetchone()[0]


def start_run(conn, project_id, session_id, task_summary=None, model=None):
    cur = conn.execute(
        "INSERT INTO runs(project_id,session_id,started_at,task_summary,model) "
        "VALUES(?,?,?,?,?)", (project_id, session_id, time.time(),
                              task_summary, model))
    conn.commit()
    return cur.lastrowid


def current_run_id(conn, session_id):
    row = conn.execute(
        "SELECT id FROM runs WHERE session_id=? AND ended_at IS NULL "
        "ORDER BY id DESC LIMIT 1", (session_id,)).fetchone()
    return row[0] if row else None


def log_event(conn, run_id, tool, context, is_inline_op, path=None):
    cur = conn.execute(
        "INSERT INTO events(run_id,ts,tool,context,is_inline_op,path) "
        "VALUES(?,?,?,?,?,?)",
        (run_id, time.time(), tool, context, int(is_inline_op), path))
    conn.commit()
    return cur.lastrowid


def log_dispatch(conn, run_id, agent_type, model=None, wave_id=None):
    conn.execute(
        "INSERT INTO dispatches(run_id,ts,agent_type,model,wave_id) "
        "VALUES(?,?,?,?,?)", (run_id, time.time(), agent_type, model, wave_id))
    eid = log_event(conn, run_id, agent_type, "main", 0)
    return eid


def inline_ops_since_last_dispatch(conn, run_id):
    last = conn.execute(
        "SELECT COALESCE(MAX(id),0) FROM events WHERE run_id=? AND tool IN "
        "(%s)" % ",".join("?" * len(DISPATCH_TOOLS)),
        (run_id, *DISPATCH_TOOLS)).fetchone()[0]
    return conn.execute(
        "SELECT COUNT(*) FROM events WHERE run_id=? AND is_inline_op=1 AND id>?",
        (run_id, last)).fetchone()[0]


def finalize_run(conn, run_id, wall_clock_s=None):
    inline = conn.execute(
        "SELECT COUNT(*) FROM events WHERE run_id=? AND is_inline_op=1",
        (run_id,)).fetchone()[0]
    disp = conn.execute(
        "SELECT COUNT(*) FROM dispatches WHERE run_id=?", (run_id,)).fetchone()[0]
    conn.execute("UPDATE runs SET ended_at=?, wall_clock_s=? WHERE id=?",
                 (time.time(), wall_clock_s, run_id))
    conn.execute(
        "INSERT INTO metrics(run_id,inline_ops,dispatches,wall_clock_s) "
        "VALUES(?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET inline_ops=?, "
        "dispatches=?, wall_clock_s=?",
        (run_id, inline, disp, wall_clock_s, inline, disp, wall_clock_s))
    conn.commit()


def run_metrics(conn, run_id):
    row = conn.execute("SELECT * FROM metrics WHERE run_id=?",
                       (run_id,)).fetchone()
    if not row:
        return {}
    cols = [c[0] for c in conn.execute(
        "SELECT * FROM metrics WHERE run_id=?", (run_id,)).description]
    return dict(zip(cols, row))


def record_improvement(conn, run_id, dimension, baseline, target, note):
    cur = conn.execute(
        "INSERT INTO improvements(run_id,ts,dimension,baseline,target,note) "
        "VALUES(?,?,?,?,?,?)",
        (run_id, time.time(), dimension, baseline, target, note))
    conn.commit()
    return cur.lastrowid


def trends(conn, limit=20):
    rows = conn.execute(
        "SELECT r.id, p.root_path, m.inline_ops, m.dispatches, m.wall_clock_s "
        "FROM runs r JOIN projects p ON p.id=r.project_id "
        "LEFT JOIN metrics m ON m.run_id=r.id "
        "ORDER BY r.id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(zip(("run_id", "root_path", "inline_ops", "dispatches",
                      "wall_clock_s"), r)) for r in rows]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plugins/atlas/scripts && python3 -m unittest test_atlas_db -v`
Expected: PASS (5 tests OK).

- [ ] **Step 5: Commit**

```bash
git add plugins/atlas/scripts/atlas_db.py plugins/atlas/scripts/test_atlas_db.py
git commit -m "feat(atlas): add atlas_db SQLite observability SSOT module"
```

---

### Task 2: `dispatch_tripwire.py` PostToolUse hook

**Files:**
- Create: `plugins/atlas/hooks/dispatch_tripwire.py`
- Modify: `plugins/atlas/hooks/hooks.json` (register the hook)
- Test: `plugins/atlas/hooks/test_dispatch_tripwire.py`

**Interfaces:**
- Consumes: `atlas_db` (Task 1) via `sys.path` insert of `../scripts`.
- Behavior: reads a Claude Code PostToolUse JSON payload on stdin (`{"session_id","tool_name","tool_input",...}`). Classifies the tool as a dispatch (`Agent`/`Task` -> reset), an inline op (`Read`/`Grep`/`Glob`/`Edit`/`Write`/`Bash`), or ignored. Logs to the DB. When inline-ops-since-last-dispatch crosses `ATLAS_TRIPWIRE_THRESHOLD` (default 4), OR on any inline `Edit`/`Write` to a non-orchestration path, prints a JSON `hookSpecificOutput.additionalContext` STOP message. Always exits 0. `ATLAS_TRIPWIRE=off` disables.

- [ ] **Step 1: Write the failing test**

Create `plugins/atlas/hooks/test_dispatch_tripwire.py`:

```python
import json, os, subprocess, sys, tempfile, unittest

HOOK = os.path.join(os.path.dirname(__file__), "dispatch_tripwire.py")


def run_hook(payload, env):
    p = subprocess.run([sys.executable, HOOK], input=json.dumps(payload),
                       capture_output=True, text=True, env=env)
    return p


class TripwireTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.env = dict(os.environ, ATLAS_DB=os.path.join(self.tmp, "atlas.db"))
        # seed a run so current_run_id resolves
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db
        conn = atlas_db.connect(self.env["ATLAS_DB"])
        atlas_db.init(conn)
        pid = atlas_db.register_project(conn, "/repo/x")
        atlas_db.start_run(conn, pid, "sess-1")
        conn.close()

    def _payload(self, tool, tinput=None):
        return {"session_id": "sess-1", "tool_name": tool,
                "tool_input": tinput or {}}

    def test_under_threshold_is_silent(self):
        for _ in range(3):
            r = run_hook(self._payload("Read", {"file_path": "a.py"}), self.env)
            self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")

    def test_trips_at_threshold(self):
        for _ in range(4):
            r = run_hook(self._payload("Read", {"file_path": "a.py"}), self.env)
        self.assertEqual(r.returncode, 0)
        self.assertIn("additionalContext", r.stdout)
        self.assertIn("STOP", r.stdout)

    def test_dispatch_resets(self):
        for _ in range(3):
            run_hook(self._payload("Read"), self.env)
        run_hook(self._payload("Task", {"subagent_type": "atlas:explorer"}), self.env)
        r = run_hook(self._payload("Read"), self.env)  # 1 since reset
        self.assertEqual(r.stdout.strip(), "")

    def test_off_switch(self):
        env = dict(self.env, ATLAS_TRIPWIRE="off")
        for _ in range(6):
            r = run_hook(self._payload("Read"), env)
        self.assertEqual(r.stdout.strip(), "")

    def test_fail_open_on_garbage_stdin(self):
        p = subprocess.run([sys.executable, HOOK], input="not json",
                           capture_output=True, text=True, env=self.env)
        self.assertEqual(p.returncode, 0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugins/atlas/hooks && python3 -m unittest test_dispatch_tripwire -v`
Expected: FAIL (hook file does not exist -> subprocess returncode non-zero / no output).

- [ ] **Step 3: Write minimal implementation**

Create `plugins/atlas/hooks/dispatch_tripwire.py`:

```python
#!/usr/bin/env python3
"""PostToolUse tripwire: counts inline ops in the main session and STOPs drift.

Fail-open: any error exits 0. Logs to the atlas observability DB. Advisory only -
it injects context, never blocks. Disable with ATLAS_TRIPWIRE=off.
"""
import json
import os
import sys

INLINE_TOOLS = {"Read", "Grep", "Glob", "Edit", "Write", "Bash"}
DISPATCH_TOOLS = {"Agent", "Task"}
EDIT_TOOLS = {"Edit", "Write", "MultiEdit"}
ORCH_PREFIXES = ("docs/.run/", "docs/plans/", "docs/evidence/", "docs/")


def _threshold():
    try:
        return int(os.environ.get("ATLAS_TRIPWIRE_THRESHOLD", "4"))
    except ValueError:
        return 4


def _is_orchestration_path(path):
    if not path:
        return True  # unknown path -> do not punish
    norm = path.replace("\\", "/")
    return any(seg in norm for seg in ORCH_PREFIXES)


def main():
    if os.environ.get("ATLAS_TRIPWIRE", "on").lower() == "off":
        return
    raw = sys.stdin.read()
    payload = json.loads(raw)  # may raise -> caught below
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
    import atlas_db

    tool = payload.get("tool_name", "")
    tinput = payload.get("tool_input", {}) or {}
    session = payload.get("session_id", "")
    path = tinput.get("file_path") or tinput.get("path")

    conn = atlas_db.connect()
    atlas_db.init(conn)
    run_id = atlas_db.current_run_id(conn, session)
    if run_id is None:
        return  # no active run; boot hook will create one

    if tool in DISPATCH_TOOLS:
        atlas_db.log_dispatch(conn, run_id, tinput.get("subagent_type", tool))
        return
    if tool not in INLINE_TOOLS:
        return

    atlas_db.log_event(conn, run_id, tool, "main", 1, path)
    count = atlas_db.inline_ops_since_last_dispatch(conn, run_id)

    edit_to_target = tool in EDIT_TOOLS and not _is_orchestration_path(path)
    if count >= _threshold() or edit_to_target:
        if edit_to_target:
            msg = ("STOP - atlas orchestrators never edit target code inline. "
                   "Route this %s of %s to atlas:implementer." % (tool, path))
        else:
            msg = ("STOP - %d inline ops this turn with no dispatch. This is "
                   "orchestrator drift. Dispatch the next investigative or edit "
                   "step to a subagent (atlas:explorer / atlas:implementer)." % count)
        out = {"hookSpecificOutput": {"hookEventName": "PostToolUse",
                                      "additionalContext": msg}}
        print(json.dumps(out))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # fail-open: never block a session
    sys.exit(0)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plugins/atlas/hooks && python3 -m unittest test_dispatch_tripwire -v`
Expected: PASS (5 tests OK).

- [ ] **Step 5: Register the hook in `hooks.json`**

Open `plugins/atlas/hooks/hooks.json`. In the `PostToolUse` array, add an entry matching the existing `format_after_edit.py` shape but with matcher `Read|Grep|Glob|Edit|Write|Bash` and command pointing at `dispatch_tripwire.py` via `${CLAUDE_PLUGIN_ROOT}/hooks/dispatch_tripwire.py`. Preserve all existing entries.

- [ ] **Step 6: Verify hooks.json is valid JSON and references the hook**

Run: `python3 -c "import json,sys; d=json.load(open('plugins/atlas/hooks/hooks.json')); print('dispatch_tripwire.py' in json.dumps(d))"`
Expected: `True`

- [ ] **Step 7: Commit**

```bash
git add plugins/atlas/hooks/dispatch_tripwire.py plugins/atlas/hooks/test_dispatch_tripwire.py plugins/atlas/hooks/hooks.json
git commit -m "feat(atlas): add dispatch tripwire PostToolUse hook + DB logging"
```

---

### Task 3: Wire boot + finalize into the run lifecycle

**Files:**
- Modify: `plugins/atlas/hooks/session_boot.py` (init DB, register project, start run)
- Modify: `plugins/atlas/hooks/hooks.json` (ensure a `Stop` entry finalizes the run; reuse `completion_gate.py` if it already runs on `Stop`, else add a tiny finalizer call inside it)
- Test: `plugins/atlas/hooks/test_session_boot_db.py`

**Interfaces:**
- Consumes: `atlas_db` (Task 1).
- `session_boot.py` on `SessionStart`: resolves the project root (cwd), calls `atlas_db.init`, `register_project`, `start_run(session_id)`. All wrapped in try/except, fail-open. Must not change existing boot output behavior.

- [ ] **Step 1: Write the failing test**

Create `plugins/atlas/hooks/test_session_boot_db.py`:

```python
import json, os, subprocess, sys, tempfile, unittest

BOOT = os.path.join(os.path.dirname(__file__), "session_boot.py")


class BootDbTest(unittest.TestCase):
    def test_boot_creates_db_and_registers_run(self):
        tmp = tempfile.mkdtemp()
        env = dict(os.environ, ATLAS_DB=os.path.join(tmp, "atlas.db"))
        payload = json.dumps({"session_id": "sess-boot", "cwd": tmp})
        p = subprocess.run([sys.executable, BOOT], input=payload,
                           capture_output=True, text=True, env=env)
        self.assertEqual(p.returncode, 0)
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db
        conn = atlas_db.connect(env["ATLAS_DB"])
        self.assertIsNotNone(atlas_db.current_run_id(conn, "sess-boot"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugins/atlas/hooks && python3 -m unittest test_session_boot_db -v`
Expected: FAIL (`current_run_id` returns None - boot does not yet write the DB).

- [ ] **Step 3: Add the DB lifecycle calls to `session_boot.py`**

Read `session_boot.py` first to match its existing structure and stdin handling. Add, near the top of its main path (after it parses the payload, inside a try/except that fails open):

```python
try:
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
    import atlas_db
    _conn = atlas_db.connect()
    atlas_db.init(_conn)
    _root = payload.get("cwd") or os.getcwd()
    _pid = atlas_db.register_project(_conn, _root, os.path.basename(_root))
    if atlas_db.current_run_id(_conn, payload.get("session_id", "")) is None:
        atlas_db.start_run(_conn, _pid, payload.get("session_id", ""))
except Exception:
    pass  # observability is best-effort; never block boot
```

- [ ] **Step 4: Add run finalization on `Stop`**

Read `completion_gate.py`. At the end of its `Stop` handling (after its existing gate logic, fail-open), add a finalize call:

```python
try:
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
    import atlas_db
    _conn = atlas_db.connect()
    _rid = atlas_db.current_run_id(_conn, payload.get("session_id", ""))
    if _rid is not None:
        atlas_db.finalize_run(_conn, _rid)
except Exception:
    pass
```

If `completion_gate.py` does not receive the payload/session_id, parse stdin the same way the file already does; do not change its gate verdict logic.

- [ ] **Step 5: Run boot test + full hook suite**

Run: `cd plugins/atlas/hooks && python3 -m unittest discover -p 'test_*.py' -v`
Expected: PASS (all hook tests, including boot DB test).

- [ ] **Step 6: Commit**

```bash
git add plugins/atlas/hooks/session_boot.py plugins/atlas/hooks/completion_gate.py plugins/atlas/hooks/test_session_boot_db.py
git commit -m "feat(atlas): build/register observability DB on engine run; finalize on stop"
```

---

## Phase 2 - Engine forcing function

### Task 4: `atlas-engine` decision gate + Workflow template

**Files:**
- Modify: `plugins/atlas/skills/atlas-engine/SKILL.md`
- Create: `plugins/atlas/skills/atlas-engine/references/workflow-template.md`

**Interfaces:**
- Produces: the mechanical "first move" all atlas work routes through; referenced by commands and the new swarms.

- [ ] **Step 1: Add the mechanical decision gate to the engine**

In `SKILL.md`, replace the prose-heavy opening of "## The loop" with a leading mechanical gate. Insert immediately before step 0:

```markdown
## The decision gate (mechanical - run this FIRST, every task)

Answer three yes/no questions before any other action:
1. More than one stage? 2. More than one surface (frontend/backend/db/config)?
3. Whole-repo or audit-scale?

If ANY is yes: your first move is to author a Workflow (see
`references/workflow-template.md`) OR dispatch a parallel wave in ONE message.
You may NOT proceed inline. This is a checklist, not a judgment call - the
`dispatch_tripwire.py` hook will STOP you at 4 inline ops regardless.

If ALL are no (a single trivial single-surface change): inline is allowed, but the
first investigative read still goes to `atlas:explorer` if it would exceed a glance.
```

- [ ] **Step 2: Absorb Architect-Mode orchestration posture**

Add a short subsection "## Orchestration posture (single owner)" stating the engine is the sole owner of the delegate-everything / adversarial-evidence / synthesize-and-gate posture, formerly duplicated in atlas-architect. Keep it to 5-8 lines; do not re-expand the old sermon.

- [ ] **Step 3: Reference the tripwire + DB in the automation section**

In the "## Automation: hooks enforce the discipline" list, add a bullet for `dispatch_tripwire.py` (PostToolUse; counts inline ops, STOPs drift at threshold, logs to `atlas.db`, env `ATLAS_TRIPWIRE`/`ATLAS_TRIPWIRE_THRESHOLD`). Update "seven hooks" -> "eight hooks" everywhere in the file.

- [ ] **Step 4: Update the references index + squad for renames/new skills**

In the reference table and "## Your squad" / cross-references: rename `atlas-loop` -> `atlas-orbit`, `atlas-connectors` -> `atlas-harbor`, `atlas-self-improving` -> `atlas-sextant`; add `atlas-cartographer`, `atlas-survey`, `atlas-expedition`. Remove the trailing note about `orc-*` workspace skills only if it references deleted skills (leave unrelated text).

- [ ] **Step 5: Create the Workflow template reference**

Create `references/workflow-template.md` with a canned, copy-ready Workflow script skeleton (explore -> plan -> implement -> verify) using `parallel()`/`pipeline()` and the atlas squad, plus the `meta` block. Include the loop-until-dry and adversarial-verify shapes. Base it on the Workflow tool contract (phases, schema option, pipeline default). End with the rule: synthesis stays with the orchestrator; subagents return distilled reports only.

- [ ] **Step 6: Verify structure**

Run:
```bash
grep -c "decision gate" plugins/atlas/skills/atlas-engine/SKILL.md
grep -rn "seven hooks" plugins/atlas/skills/atlas-engine/SKILL.md || echo "OK: no stale count"
test -f plugins/atlas/skills/atlas-engine/references/workflow-template.md && echo "template OK"
```
Expected: decision-gate match >=1; "OK: no stale count"; "template OK".

- [ ] **Step 7: Commit**

```bash
git add plugins/atlas/skills/atlas-engine/
git commit -m "feat(atlas-engine): mechanical Workflow decision gate + tripwire wiring + workflow template"
```

---

## Phase 3 - Renames and deletions

### Task 5: Rename `atlas-loop` -> `atlas-orbit`

**Files:**
- Rename dir: `plugins/atlas/skills/atlas-loop/` -> `plugins/atlas/skills/atlas-orbit/`
- Modify: the renamed `SKILL.md` frontmatter `name: atlas-orbit`
- Modify: every reference to `atlas-loop` across `plugins/atlas/`

- [ ] **Step 1: Move the directory with git**

```bash
git mv plugins/atlas/skills/atlas-loop plugins/atlas/skills/atlas-orbit
```

- [ ] **Step 2: Update frontmatter name**

Edit `plugins/atlas/skills/atlas-orbit/SKILL.md`: set `name: atlas-orbit`. Keep the body; update any self-references to the old name in prose.

- [ ] **Step 3: Find and update all references**

Run: `grep -rln "atlas-loop" plugins/atlas/`
Then edit each hit to `atlas-orbit` (expect: engine SKILL.md, architect SKILL.md, capability-routing.md, capability-catalog.md, README.md, plugin.json, any command). Preserve surrounding text.

- [ ] **Step 4: Verify zero stale references**

Run: `grep -rn "atlas-loop" plugins/atlas/ && echo "STALE REFS - fix" || echo "clean"`
Expected: `clean`.

- [ ] **Step 5: Commit**

```bash
git add -A plugins/atlas/
git commit -m "refactor(atlas): rename atlas-loop -> atlas-orbit"
```

---

### Task 6: Rename `atlas-connectors` -> `atlas-harbor`

**Files:**
- Rename dir: `plugins/atlas/skills/atlas-connectors/` -> `plugins/atlas/skills/atlas-harbor/`
- Modify: renamed `SKILL.md` frontmatter + `vendors.md` only if it self-names
- Modify: every reference to `atlas-connectors`

- [ ] **Step 1: Move the directory**

```bash
git mv plugins/atlas/skills/atlas-connectors plugins/atlas/skills/atlas-harbor
```

- [ ] **Step 2: Update frontmatter + references**

Set `name: atlas-harbor` in the renamed `SKILL.md`. Run `grep -rln "atlas-connectors" plugins/atlas/` and update each hit (expect: architect SKILL.md, capability-routing.md, capability-catalog.md, README.md, plugin.json).

- [ ] **Step 3: Verify clean**

Run: `grep -rn "atlas-connectors" plugins/atlas/ && echo "STALE" || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add -A plugins/atlas/
git commit -m "refactor(atlas): rename atlas-connectors -> atlas-harbor"
```

---

### Task 7: Delete `atlas-operating-contract` skill

**Files:**
- Delete dir: `plugins/atlas/skills/atlas-operating-contract/`
- Keep: `plugins/atlas/skills/atlas-engine/references/operating-contract.md` (commands cat this directly)

- [ ] **Step 1: Confirm nothing invokes the skill (only the file)**

Run: `grep -rn "atlas-operating-contract" plugins/atlas/ | grep -v "skills/atlas-operating-contract/"`
Expected: only references in `plugin.json` (skill list) and possibly README - NOT a command `Skill(atlas-operating-contract)` call. (Commands cat `references/operating-contract.md`, verified earlier.)

- [ ] **Step 2: Remove the skill**

```bash
git rm -r plugins/atlas/skills/atlas-operating-contract
```

- [ ] **Step 3: Scrub plugin.json + README references**

Edit `plugins/atlas/.claude-plugin/plugin.json` and `README.md` to drop `atlas-operating-contract` from any skill list/table. Leave `references/operating-contract.md` mentions intact.

- [ ] **Step 4: Verify**

Run: `grep -rn "atlas-operating-contract" plugins/atlas/ && echo "STALE" || echo "clean"`
Expected: `clean`.

- [ ] **Step 5: Commit**

```bash
git add -A plugins/atlas/
git commit -m "refactor(atlas): delete dead atlas-operating-contract skill (file retained)"
```

---

### Task 8: Trim `atlas-architect` (remove Architect Mode)

**Files:**
- Modify: `plugins/atlas/skills/atlas-architect/SKILL.md`

- [ ] **Step 1: Remove the Architect Mode section**

Delete the entire "## Architect Mode" section (lines describing rewrite-the-prompt / delegate-everything / adversarial-evidence / synthesize-and-gate). Replace with one pointer line: "Orchestration posture lives in atlas-engine (## Orchestration posture). The architect only boots and configures; it does not run work."

- [ ] **Step 2: Refresh the capability list**

In the "## No-args behavior (standard scan)" and any install-recommendation text, update the named built-ins to the final set: `atlas-orbit` (loop-library), `atlas-harbor` (connectors), and add `atlas-cartographer`, `atlas-survey`, `atlas-expedition`, `atlas-sextant`. Remove `atlas-self-improving`/`atlas-loop`/`atlas-connectors` names.

- [ ] **Step 3: Verify**

Run:
```bash
grep -n "Architect Mode" plugins/atlas/skills/atlas-architect/SKILL.md && echo "STILL PRESENT" || echo "removed"
grep -rn "atlas-self-improving\|atlas-loop\|atlas-connectors" plugins/atlas/skills/atlas-architect/SKILL.md && echo "STALE" || echo "clean"
```
Expected: "removed" and "clean".

- [ ] **Step 4: Commit**

```bash
git add plugins/atlas/skills/atlas-architect/SKILL.md
git commit -m "refactor(atlas-architect): drop Architect Mode (engine owns posture); refresh capability list"
```

---

## Phase 4 - Sextant (measurable, SQLite-backed)

### Task 9: Rename + rewrite `atlas-self-improving` -> `atlas-sextant`

**Files:**
- Rename dir: `plugins/atlas/skills/atlas-self-improving/` -> `plugins/atlas/skills/atlas-sextant/`
- Modify: renamed `SKILL.md` (full rewrite around the DB)
- Delete: `plugins/atlas/skills/atlas-engine/references/self-improving.md` (the `~/self-improving/` tiered file system - item E cut)
- Modify: `plugins/atlas/hooks/nudge.py` (point to atlas-sextant), engine references index

- [ ] **Step 1: Move the directory**

```bash
git mv plugins/atlas/skills/atlas-self-improving plugins/atlas/skills/atlas-sextant
```

- [ ] **Step 2: Rewrite the SKILL.md**

Set frontmatter:
```markdown
---
name: atlas-sextant
description: Use to measure atlas's own run health from the SQLite observability DB and propose metric-backed improvements to atlas's behavior. Emits RUN METRICS (wall-clock, inline-ops, dispatches, parallel waves, context, recall, verifier coverage) and MEASURABLE IMPROVEMENTS (baseline -> target). On no args, reports cross-run/cross-project trends. The atlas Stop/SubagentStop nudge hook points here.
---
```
Body must contain these sections, with these load-bearing rules:
- "## Single source of truth": the global SQLite DB at `~/.atlas/atlas.db` (env `ATLAS_DB`), read via `scripts/atlas_db.py`. Files are not the SSOT; claude-mem is the narrative layer only.
- "## What it measures": list the metrics columns and how each maps to a behavior (inline_ops high = drift; parallel_waves low on multi-stage = under-fanned; recall_misses = re-derivation; verifier_coverage < 1 = unverified ships).
- "## Measurable improvements": each proposed improvement MUST carry an explicit `baseline -> target` and be written via `record_improvement(...)`. No qualitative-only entries.
- "## Trends (no-arg)": run `trends()` and summarize cross-run/cross-project direction.
- "## The nudge": the `nudge.py` hook points here; capture a claude-mem lesson when one exists.

- [ ] **Step 3: Cut the third memory system**

```bash
git rm plugins/atlas/skills/atlas-engine/references/self-improving.md
```
Then `grep -rln "references/self-improving.md\|self-improving.md" plugins/atlas/` and remove the index row/links to it in `atlas-engine/SKILL.md` and `atlas-self-improving` body references.

- [ ] **Step 4: Update nudge.py + engine references**

Edit `plugins/atlas/hooks/nudge.py`: any "atlas-self-improving" string -> "atlas-sextant". Edit `atlas-engine/SKILL.md` references index: rename the self-improving row to point to atlas-sextant; remove the `references/self-improving.md` row.

- [ ] **Step 5: Verify clean + suite still green**

Run:
```bash
grep -rn "atlas-self-improving" plugins/atlas/ && echo "STALE" || echo "clean"
grep -rn "references/self-improving.md" plugins/atlas/ && echo "STALE REF" || echo "clean"
cd plugins/atlas/scripts && python3 -m unittest test_atlas_db -v
```
Expected: both "clean"; DB tests PASS.

- [ ] **Step 6: Commit**

```bash
git add -A plugins/atlas/
git commit -m "feat(atlas-sextant): rename self-improving -> sextant; SQLite-backed measurable meta; cut ~/self-improving system"
```

---

## Phase 5 - New discovery-first swarms

### Task 10: New skill `atlas-cartographer` (structure / dedup / unify)

**Files:**
- Create: `plugins/atlas/skills/atlas-cartographer/SKILL.md`

**Interfaces:**
- Produces: feature flowcharts + duplication report + unified proposal + `/atlas-engine` handoff prompts in `docs/audits/atlas-cartographer-<date>/`.

- [ ] **Step 1: Write the SKILL.md**

Frontmatter:
```markdown
---
name: atlas-cartographer
description: Use to map a codebase into feature-grouped flowcharts, find architectural duplication across features, and propose the simplest unified architecture - discovery-first and zero-arg. Runs as a Workflow that fans out one explorer per feature, hunts duplication, and synthesizes a unification proposal with file:line evidence. Use before a refactor, to "find the ideal path," or to unify duplicated systems.
---
```
Body must specify:
- "## Zero-arg discovery": Phase 0 dispatches one `atlas:explorer` to propose feature boundaries from the source tree + README/CLAUDE.md; the orchestrator approves boundaries before fan-out. The user supplies no details.
- "## Workflow shape": phase 1 = one `atlas:explorer` per feature in parallel (flowchart with every node labeled `file:line`); phase 2 = two duplication-hunters in parallel (within-feature, cross-feature); phase 3 = orchestrator-only unified proposal; phase 4 = per-system `/atlas-engine` handoff prompts. Reference `atlas-engine/references/workflow-template.md`.
- "## Evidence contract": reject and redeploy any subagent report whose nodes/claims lack `file:line`; every duplication claim cites >=2 locations.
- "## Boundary": owns ARCHITECTURAL/structural duplication and unification only. Quality/security/local-smell findings belong to `atlas-survey`.
- "## Output": artifacts under `docs/audits/atlas-cartographer-<date>/` (SSOT), not a loose repo-root dir.
- "## Anti-patterns to reject in the proposal": new abstraction layer for flexibility, both paths behind a flag, registry/factory where a switch suffices.

- [ ] **Step 2: Verify naming + structure**

Run:
```bash
grep -m1 "^name: atlas-cartographer$" plugins/atlas/skills/atlas-cartographer/SKILL.md && echo "name OK"
grep -c "file:line" plugins/atlas/skills/atlas-cartographer/SKILL.md
```
Expected: "name OK"; `file:line` count >=2.

- [ ] **Step 3: Commit**

```bash
git add plugins/atlas/skills/atlas-cartographer/
git commit -m "feat(atlas-cartographer): discovery-first architecture map + dedup + unify swarm"
```

---

### Task 11: New skill `atlas-survey` (quality / OWASP / security / principles)

**Files:**
- Create: `plugins/atlas/skills/atlas-survey/SKILL.md`

**Interfaces:**
- Produces: prioritized, adversarially-verified findings with `file:line` + severity in `docs/audits/atlas-survey-<date>/` + `/atlas-engine` handoff prompts.

- [ ] **Step 1: Write the SKILL.md**

Frontmatter:
```markdown
---
name: atlas-survey
description: Use for a comprehensive, discovery-first code-quality and security audit of a whole codebase - correctness, OWASP/security, SOLID/DRY/KISS, risk hotspots, dead code, coverage gaps, and code-vs-docs drift. Runs as a Workflow that builds a knowledge graph (graphify), targets the hottest nodes, fans out one reviewer per dimension, and adversarially verifies every finding before it counts.
---
```
Body must specify:
- "## Zero-arg discovery": Phase 1 runs the `graphify` skill to build the knowledge graph (communities, god nodes, high-centrality hot spots) and reads `docs/*` SSOT for intended behavior. No details required from the user.
- "## Dimensions (parallel fan-out)": one reviewer per dimension aimed at the hottest nodes: correctness/bugs, OWASP + security, SOLID/DRY/KISS + best practices, risk hotspots, dead code, test-coverage gaps, code-vs-docs drift. Compose existing assets (`security-review`, `codeql`, `quality-playbook`) rather than reinventing - name them.
- "## Adversarial verify": every finding confirmed by an independent `atlas:verifier` (engine law 5) before it counts; refuted findings dropped.
- "## Boundary": owns quality/security/risk + LOCAL code-smell duplication. DEFERS structural/architectural dedup to `atlas-cartographer` so the two never re-audit the same concern.
- "## Output": prioritized findings (file:line + severity) under `docs/audits/atlas-survey-<date>/`; handoff prompts to `/atlas-engine`.
- "## Workflow shape": reference `atlas-engine/references/workflow-template.md`; pipeline = graph -> per-dimension review -> per-finding verify, verifying as each dimension completes (no barrier).

- [ ] **Step 2: Verify naming + composition references**

Run:
```bash
grep -m1 "^name: atlas-survey$" plugins/atlas/skills/atlas-survey/SKILL.md && echo "name OK"
grep -E "graphify|security-review|codeql|quality-playbook|atlas-cartographer" plugins/atlas/skills/atlas-survey/SKILL.md | wc -l
```
Expected: "name OK"; composition reference count >=4.

- [ ] **Step 3: Commit**

```bash
git add plugins/atlas/skills/atlas-survey/
git commit -m "feat(atlas-survey): discovery-first comprehensive code-quality + security audit swarm"
```

---

## Phase 6 - Expedition (de-hardcode)

### Task 12: Rename + de-hardcode `atlas-uxt-swarm` -> `atlas-expedition`

**Files:**
- Rename dir: `plugins/atlas/skills/atlas-uxt-swarm/` -> `plugins/atlas/skills/atlas-expedition/`
- Modify: renamed `SKILL.md` + `references/discovery.md` (add app-discovery)
- Modify: `plugins/atlas/agents/ux-*.md` (remove first-responders literals)
- Modify: `plugins/atlas/skills/atlas-engine/references/ux-test-swarm.md` (de-hardcode), capability-routing.md

- [ ] **Step 1: Move the directory**

```bash
git mv plugins/atlas/skills/atlas-uxt-swarm plugins/atlas/skills/atlas-expedition
```

- [ ] **Step 2: Rewrite the SKILL.md for discovery-first**

Set `name: atlas-expedition`. Update the description to drop "first responders app" and state it adapts to any web app. Replace the "## Setup" hardcoded dev-URL/API-base block with a "## Phase 0 - discover the app" rule: read the repo to find the dev URL, API base, and the real save/read-back contract from `frontend/src`; write them to `RUN_DIR/coverage/contract-snapshot.json`; ask the user for a single value ONLY if discovery cannot determine it. All downstream phases consume the discovered contract. Keep the three hard gates and the calc oracle.

- [ ] **Step 3: Purge first-responders literals everywhere**

Run: `grep -rln "first-responders\|firstresponders\|first_responders" plugins/atlas/`
Edit each hit (the renamed SKILL.md, `references/discovery.md`, `references/data-entry-contract.md`, the `ux-*` agents, `atlas-engine/references/ux-test-swarm.md`) to remove the baked-in app and reference the discovered contract instead.

- [ ] **Step 4: Update references to the skill name**

Run `grep -rln "atlas-uxt-swarm\|uxt-swarm" plugins/atlas/` and update engine SKILL.md, capability-routing.md, capability-catalog.md, README.md, plugin.json to `atlas-expedition`.

- [ ] **Step 5: Verify fully de-hardcoded**

Run:
```bash
grep -rn "first-responders\|firstresponders" plugins/atlas/ && echo "STILL HARDCODED" || echo "clean"
grep -rn "atlas-uxt-swarm" plugins/atlas/ && echo "STALE NAME" || echo "clean"
```
Expected: both "clean".

- [ ] **Step 6: Commit**

```bash
git add -A plugins/atlas/
git commit -m "refactor(atlas-expedition): rename atlas-uxt-swarm + de-hardcode to discover any web app"
```

---

## Phase 7 - Manifest, docs, verification

### Task 13: Update manifest, README, catalog, routing to the final 8

**Files:**
- Modify: `plugins/atlas/.claude-plugin/plugin.json` (skill list, keywords, description, version bump)
- Modify: `plugins/atlas/README.md` (tables + counts)
- Modify: root `marketplace.json` (description/keywords if they name skills)
- Modify: `plugins/atlas/scripts/discover_capabilities.py` (if it names skills)
- Modify: `plugins/atlas/skills/atlas-engine/references/capability-catalog.md`, `capability-routing.md`

- [ ] **Step 1: Reconcile plugin.json**

Ensure the skill list / any skill enumeration matches exactly: `atlas-engine, atlas-architect, atlas-cartographer, atlas-sextant, atlas-orbit, atlas-harbor, atlas-expedition, atlas-survey`. Bump the plugin `version` (minor). Update `description`/`keywords` to mention cartographer/survey/expedition and the observability DB if skills are enumerated there.

- [ ] **Step 2: Reconcile README + catalog + routing**

Update the skill tables and counts in `README.md` to the 8 skills (was 7). Update `capability-catalog.md` and `capability-routing.md` so task-signal -> skill routing names the final set (cartographer for architecture/dedup, survey for quality/security audit, expedition for UX runtime).

- [ ] **Step 3: Update marketplace.json + discover script if needed**

Run `grep -n "atlas-loop\|atlas-connectors\|atlas-self-improving\|atlas-uxt-swarm\|atlas-operating-contract" marketplace.json plugins/atlas/scripts/discover_capabilities.py` and update each hit to the new names or remove.

- [ ] **Step 4: Verify JSON validity + counts**

Run:
```bash
python3 -c "import json; json.load(open('plugins/atlas/.claude-plugin/plugin.json')); json.load(open('marketplace.json')); print('json OK')"
grep -rn "atlas-loop\|atlas-connectors\|atlas-self-improving\|atlas-uxt-swarm\|atlas-operating-contract" plugins/atlas/ marketplace.json && echo "STALE" || echo "clean"
```
Expected: "json OK"; "clean".

- [ ] **Step 5: Commit**

```bash
git add -A plugins/atlas/ marketplace.json
git commit -m "chore(atlas): reconcile manifest/README/catalog/routing to final 8 skills; version bump"
```

---

### Task 14: Final verification gate + skill-name lint

**Files:**
- Create: `plugins/atlas/scripts/lint_skill_names.py`
- Test: run the full verification battery

- [ ] **Step 1: Write the naming lint**

Create `plugins/atlas/scripts/lint_skill_names.py`:

```python
#!/usr/bin/env python3
"""Assert every atlas skill dir is `atlas-<one themed word>`: exactly one dash."""
import os, sys

skills = os.path.join(os.path.dirname(__file__), "..", "skills")
bad = []
for name in sorted(os.listdir(skills)):
    if not os.path.isdir(os.path.join(skills, name)):
        continue
    if not name.startswith("atlas-") or name.count("-") != 1:
        bad.append(name)
if bad:
    print("NON-CONFORMANT:", bad); sys.exit(1)
print("all skill names conform (single dash, atlas- prefix)")
```

- [ ] **Step 2: Run the lint**

Run: `python3 plugins/atlas/scripts/lint_skill_names.py`
Expected: "all skill names conform" (lists exactly the 8). If it fails, fix the offending dir/frontmatter.

- [ ] **Step 3: Run the full python suite**

Run:
```bash
cd plugins/atlas/scripts && python3 -m unittest test_atlas_db -v
cd ../hooks && python3 -m unittest discover -p 'test_*.py' -v
```
Expected: all PASS.

- [ ] **Step 4: Run the MCP harness (no regression)**

Run: `node test-mcp-tools.mjs` (from repo root)
Expected: PASS with no tool-count regression (connectors untouched).

- [ ] **Step 5: Smoke-test the observability DB end to end**

Run:
```bash
ATLAS_DB=/tmp/atlas-smoke.db python3 -c "
import sys; sys.path.insert(0,'plugins/atlas/scripts'); import atlas_db
c=atlas_db.connect(); atlas_db.init(c)
p=atlas_db.register_project(c,'/tmp/demo','demo')
r=atlas_db.start_run(c,p,'smoke')
atlas_db.log_event(c,r,'Read','main',1,'x.py'); atlas_db.log_dispatch(c,r,'atlas:explorer')
atlas_db.finalize_run(c,r,1.0); print(atlas_db.run_metrics(c,r))"
rm -f /tmp/atlas-smoke.db*
```
Expected: a metrics dict with `inline_ops: 1`, `dispatches: 1`.

- [ ] **Step 6: Final grep sweep for any stale name**

Run:
```bash
grep -rn "atlas-loop\|atlas-connectors\|atlas-self-improving\|atlas-uxt-swarm\|atlas-operating-contract\|first-responders\|self-improving.md" plugins/atlas/ marketplace.json && echo "STALE FOUND" || echo "ALL CLEAN"
```
Expected: "ALL CLEAN".

- [ ] **Step 7: Commit (final, to main)**

```bash
git add -A plugins/atlas/
git commit -m "test(atlas): skill-name lint + final verification gate for redesign"
```

---

## Self-Review notes (author)

- Spec coverage: forcing function (Tasks 2,4) + DB SSOT (Tasks 1,3) + sextant measurable (Task 9) + overlap kills (Tasks 7,8,9) + renames/naming (Tasks 5,6,9,12,14) + cartographer (Task 10) + survey (Task 11) + expedition de-hardcode (Task 12) + manifest/README/propagation (Task 13). All spec sections map to a task.
- Markdown skill bodies are specified by required-section + acceptance-grep rather than verbatim prose, because SKILL.md prose is not unit-testable; frontmatter (the lintable contract) is given verbatim.
- Type consistency: every `atlas_db` function used in Tasks 2/3/9/14 is defined in Task 1's Interfaces block with matching signatures.
