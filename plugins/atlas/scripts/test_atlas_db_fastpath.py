"""atlas_db schema-version fast path and dispatch telemetry (wave id, model alias)."""

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))

import atlas_db

HOOK = os.path.join(os.path.dirname(__file__), "..", "hooks", "dispatch_tripwire.py")

OLD_DISPATCHES = (
    "CREATE TABLE dispatches (id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL, ts REAL,"
    " agent_type TEXT, model TEXT, wave_id INTEGER);"
)


class SchemaVersionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "atlas.db")

    def test_init_stamps_user_version(self):
        c = atlas_db.connect(self.path)
        atlas_db.init(c)
        self.assertEqual(
            c.execute("PRAGMA user_version").fetchone()[0], atlas_db.SCHEMA_VERSION
        )

    def test_matching_version_skips_ddl(self):
        c = atlas_db.connect(self.path)
        atlas_db.init(c)
        c.execute("DROP TABLE signals")  # a full init would recreate it
        c.commit()
        atlas_db.init(c, backfill=False)
        names = {
            r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        self.assertNotIn("signals", names)

    def test_stale_version_runs_ddl(self):
        c = atlas_db.connect(self.path)
        atlas_db.init(c)
        c.execute("DROP TABLE signals")
        c.execute("PRAGMA user_version=0")
        c.commit()
        atlas_db.init(c)
        names = {
            r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        self.assertIn("signals", names)

    def test_migration_keeps_rows_and_makes_wave_id_text(self):
        raw = sqlite3.connect(self.path)
        raw.executescript(OLD_DISPATCHES)
        raw.execute(
            "INSERT INTO dispatches VALUES (1, 7, 1.5, 'atlas:implementer', 'sonnet', 3)"
        )
        raw.execute(
            "INSERT INTO dispatches VALUES (2, 7, 2.5, 'atlas:explorer', 'haiku', 't1ad516')"
        )
        raw.commit()
        raw.close()
        c = atlas_db.connect(self.path)
        atlas_db.init(c)
        decl = {r[1]: r[2] for r in c.execute("PRAGMA table_info(dispatches)")}
        self.assertEqual(decl["wave_id"], "TEXT")
        rows = c.execute(
            "SELECT id, run_id, ts, agent_type, model, wave_id, typeof(wave_id) FROM dispatches ORDER BY id"
        ).fetchall()
        self.assertEqual(
            rows[0], (1, 7, 1.5, "atlas:implementer", "sonnet", "3", "text")
        )
        self.assertEqual(
            rows[1], (2, 7, 2.5, "atlas:explorer", "haiku", "t1ad516", "text")
        )


class TelemetryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "atlas.db")
        self.conn = atlas_db.connect(self.path)
        atlas_db.init(self.conn)

    def test_normalize_model(self):
        n = atlas_db.normalize_model
        self.assertEqual(n("anthropic/claude-sonnet-5-5:medium"), "sonnet")
        self.assertEqual(n("claude-opus-4-1"), "opus")
        self.assertEqual(n("haiku"), "haiku")
        self.assertEqual(n("openai/gpt-5:high"), "gpt-5")
        self.assertIsNone(n(""))
        self.assertIsNone(n(None))

    def test_log_dispatch_stores_alias(self):
        atlas_db.log_dispatch(
            self.conn, 1, "atlas:critic", "anthropic/claude-sonnet-5-5:medium"
        )
        self.assertEqual(
            self.conn.execute("SELECT model FROM dispatches").fetchone()[0], "sonnet"
        )

    def test_next_wave_id_groups_a_burst(self):
        c = self.conn
        self.assertEqual(atlas_db.next_wave_id(c, 1, now=100.0), "w1")
        c.execute(
            "INSERT INTO dispatches(run_id,ts,agent_type,wave_id) VALUES(1,100.0,'a','w1')"
        )
        self.assertEqual(
            atlas_db.next_wave_id(c, 1, now=105.0), "w1"
        )  # inside the 10s gap
        self.assertEqual(atlas_db.next_wave_id(c, 1, now=200.0), "w2")  # new burst
        self.assertEqual(atlas_db.next_wave_id(c, 2, now=105.0), "w1")  # other run

    def test_agent_tool_dispatch_gets_wave_id(self):
        env = dict(
            os.environ,
            ATLAS_DB=self.path,
            ATLAS_HOME=self.tmp,
            CLAUDE_PLUGIN_ROOT=os.path.join(os.path.dirname(__file__), ".."),
        )
        pid = atlas_db.register_project(self.conn, self.tmp, "p")
        atlas_db.start_run(self.conn, pid, "sess1")
        payload = {
            "cwd": self.tmp,
            "session_id": "sess1",
            "hook_event_name": "PostToolUse",
            "tool_name": "Agent",
            "tool_response": {},
            "tool_input": {
                "subagent_type": "general-purpose",
                "prompt": "x",
                "description": "x",
                "model": "anthropic/claude-sonnet-5-5:medium",
            },
        }
        for _ in range(2):
            subprocess.run(
                [sys.executable, HOOK],
                input=json.dumps(payload),
                text=True,
                capture_output=True,
                env=env,
                cwd=self.tmp,
            )
        rows = self.conn.execute("SELECT model, wave_id FROM dispatches").fetchall()
        self.assertEqual(rows, [("sonnet", "w1"), ("sonnet", "w1")])


if __name__ == "__main__":
    unittest.main()
