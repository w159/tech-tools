import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(
    0,
    _iso_os.path.join(
        _iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"
    ),
)
import _test_isolation  # noqa: F401,E402
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / "scripts" / "atlas_gates.py"
SESSION = "sess-gates-1"


def _run(db, root, env_extra=None):
    env = dict(os.environ, ATLAS_DB=db, ATLAS_HOME=str(Path(db).parent))
    env.pop("ATLAS_GATE", None)
    env.update(env_extra or {})
    p = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--session",
            SESSION,
            "--root",
            str(root),
            "--json",
        ],
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
    )
    return p, json.loads(p.stdout)


class AtlasGatesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "repo"
        (self.root / "docs").mkdir(parents=True)
        self.db = str(Path(self.tmp.name) / "home" / "atlas.db")
        Path(self.db).parent.mkdir()
        sys.path.insert(0, str(HERE.parent / "scripts"))
        import atlas_db

        conn = sqlite3.connect(self.db)
        atlas_db.init(conn)
        conn.execute(
            "INSERT INTO runs (project_id, session_id, orchestrating, started_at) VALUES (1,?,1,?)",
            (SESSION, 1.0),
        )
        conn.execute(
            "INSERT INTO friction_events (session_id, category, weight, snippet, ts) "
            "VALUES (?, 'dispatch_denied:toolkit', 1, 'no TOOLS block', 5.0)",
            (SESSION,),
        )
        conn.commit()
        self.conn = conn

    def _count(self):
        return self.conn.execute("SELECT COUNT(*) FROM friction_events").fetchone()[0]

    def test_shape_and_fix_text(self):
        p, doc = _run(self.db, self.root)
        self.assertEqual(p.returncode, 0)
        self.assertEqual(
            [g["id"] for g in doc["groups"]], ["completion", "tripwire", "routing"]
        )
        self.assertIsInstance(doc["generatedAt"], int)
        comp = doc["groups"][0]
        by_id = {ln["id"]: ln for ln in comp["lines"]}
        self.assertFalse(by_id["c"]["ok"])  # no CHANGELOG in temp repo
        self.assertIn("CHANGELOG", by_id["c"]["fix"])
        trip = {ln["id"]: ln for ln in doc["groups"][1]["lines"]}
        self.assertTrue(trip["armed"]["ok"])
        self.assertEqual(trip["inline"]["detail"], "0 of 4")
        self.assertEqual(trip["deny0"]["label"], "Denied: toolkit")

    def test_no_side_effects(self):
        before = self._count()
        _run(self.db, self.root)
        self.assertEqual(self._count(), before)
        self.assertEqual(
            [
                p.name
                for p in self.root.rglob("*")
                if "block" in p.name or "seen" in p.name
            ],
            [],
        )

    def test_broken_db_isolates_error(self):
        p, doc = _run(str(Path(self.tmp.name) / "missing" / "x.db"), self.root)
        self.assertEqual(p.returncode, 0)
        groups = {g["id"]: g for g in doc["groups"]}
        self.assertIn("error", groups["tripwire"])
        self.assertIn("error", groups["routing"])
        self.assertNotIn("error", groups["completion"])

    def _native_bash_ok(self, agent):
        self.conn.execute(
            "INSERT INTO session_logs (session_id, agent) VALUES (?,?)", (SESSION, agent)
        )
        self.conn.execute(
            "INSERT INTO tool_calls (session_id, tool_use_id, tool_name, kind) "
            "VALUES (?, 'tu-1', 'Bash', 'builtin')",
            (SESSION,),
        )
        self.conn.commit()
        _, doc = _run(self.db, self.root)
        routing = next(g for g in doc["groups"] if g["id"] == "routing")
        return {ln["id"]: ln["ok"] for ln in routing["lines"]}

    def test_native_bash_counts_in_claude_session(self):
        self.assertFalse(self._native_bash_ok("claude")["native-Bash"])

    def test_native_bash_ignored_in_omp_session(self):
        ok = self._native_bash_ok("omp")
        self.assertNotIn("native-Bash", ok)
        self.assertIn("native-Read", ok)

    def test_gate_off(self):
        _, doc = _run(self.db, self.root, {"ATLAS_GATE": "off"})
        self.assertEqual(doc["groups"][0]["error"], "gate is off")


if __name__ == "__main__":
    unittest.main()
