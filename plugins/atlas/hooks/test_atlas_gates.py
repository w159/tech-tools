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
import shutil
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
        # (c) is scoped to code-shipping runs: record a non-docs write.
        import atlas_db

        rid = atlas_db.current_run_id(self.conn, SESSION) or atlas_db.latest_run_id(
            self.conn, SESSION
        )
        atlas_db.log_event(self.conn, rid, "Write", "main", 1, "src/app.py")
        self.conn.commit()
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
        self.assertEqual(trip["inline"]["detail"], "1 of 4")  # the logged code write
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

    def _native_bash_ok(self, agent, lean_ctx=True):
        self.conn.execute(
            "INSERT INTO session_logs (session_id, agent) VALUES (?,?)",
            (SESSION, agent),
        )
        self.conn.execute(
            "INSERT INTO tool_calls (session_id, tool_use_id, tool_name, kind) "
            "VALUES (?, 'tu-1', 'Bash', 'builtin')",
            (SESSION,),
        )
        self.conn.commit()
        env = {}
        if lean_ctx:  # a reachable replacement: binary on PATH + server in .mcp.json
            bindir = Path(tempfile.mkdtemp())
            self.addCleanup(shutil.rmtree, bindir, ignore_errors=True)
            exe = bindir / "lean-ctx"
            exe.write_text("#!/bin/sh\n")
            exe.chmod(0o755)
            env["PATH"] = f"{bindir}{os.pathsep}{os.environ.get('PATH', '')}"
            Path(self.root, ".mcp.json").write_text(json.dumps({"mcpServers": {"lean-ctx": {"command": "lean-ctx"}}}))
        _, doc = _run(self.db, self.root, env)
        routing = next(g for g in doc["groups"] if g["id"] == "routing")
        return {ln["id"]: ln["ok"] for ln in routing["lines"]}

    def test_native_bash_counts_in_claude_session(self):
        self.assertFalse(self._native_bash_ok("claude")["native-Bash"])

    def test_native_bash_is_the_route_without_lean_ctx(self):
        """No lean-ctx here: a native call is the only route, not a miss (the band
        read "gates ✖" for it in the 2026-11-10 live run)."""
        self.assertTrue(self._native_bash_ok("claude", lean_ctx=False)["native-Bash"])

    def test_native_bash_ignored_in_omp_session(self):
        ok = self._native_bash_ok("omp")
        self.assertNotIn("native-Bash", ok)
        self.assertIn("native-Read", ok)

    def test_gate_off(self):
        _, doc = _run(self.db, self.root, {"ATLAS_GATE": "off"})
        self.assertEqual(doc["groups"][0]["error"], "gate is off")


class AtlasGatesInProcess(unittest.TestCase):
    """Direct calls of the group builders against a private DB (no subprocess)."""

    def setUp(self):
        from unittest import mock

        self.mock = mock
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = str(Path(self.tmp.name) / "atlas.db")
        sys.path.insert(0, str(HERE.parent / "scripts"))
        import atlas_db
        import atlas_gates

        self.atlas_db, self.gates = atlas_db, atlas_gates
        patcher = mock.patch.dict(
            os.environ, {"ATLAS_DB": self.db, "ATLAS_HOME": self.tmp.name}
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ.pop("ATLAS_TRIPWIRE_THRESHOLD", None)
        self.conn = sqlite3.connect(self.db)
        atlas_db.init(self.conn)
        self.conn.execute(
            "INSERT INTO runs (project_id, session_id, orchestrating, started_at) VALUES (1,?,1,?)",
            (SESSION, 1.0),
        )
        self.conn.commit()
        self.addCleanup(self.conn.close)

    def _inline_ops(self, n):
        rid = self.atlas_db.current_run_id(self.conn, SESSION)
        for i in range(n):
            self.atlas_db.log_event(self.conn, rid, "Write", "main", 1, f"src/f{i}.py")
        self.conn.commit()

    def _tripwire(self):
        return {ln["id"]: ln for ln in self.gates.tripwire_group(SESSION)["lines"]}

    def test_inline_limit_default_is_four_and_strict(self):
        self._inline_ops(3)
        self.assertTrue(self._tripwire()["inline"]["ok"])
        self.assertEqual(self._tripwire()["inline"]["detail"], "3 of 4")
        self._inline_ops(1)
        line = self._tripwire()["inline"]
        self.assertEqual(line["detail"], "4 of 4")
        self.assertFalse(line["ok"])

    def test_inline_limit_env_override_and_bad_value_fallback(self):
        self._inline_ops(4)
        with self.mock.patch.dict(os.environ, {"ATLAS_TRIPWIRE_THRESHOLD": "5"}):
            line = self._tripwire()["inline"]
            self.assertEqual((line["ok"], line["detail"]), (True, "4 of 5"))
        with self.mock.patch.dict(os.environ, {"ATLAS_TRIPWIRE_THRESHOLD": "lots"}):
            line = self._tripwire()["inline"]
            self.assertEqual((line["ok"], line["detail"]), (False, "4 of 4"))

    def test_armed_line_reports_state(self):
        line = self._tripwire()["armed"]
        self.assertEqual((line["ok"], line["detail"]), (True, "armed"))
        self.conn.execute("UPDATE runs SET orchestrating=0")
        self.conn.commit()
        line = self._tripwire()["armed"]
        self.assertEqual((line["ok"], line["detail"]), (True, "not armed"))

    def test_denial_age_uses_seconds_then_minutes_and_truncates_snippet(self):
        now = 10_000.0
        rows = [
            ("dispatch_denied:a", "x" * 100, now - 119),
            ("dispatch_denied:b", "boundary", now - 120),
            ("dispatch_denied:c", None, now - 600),
            ("dispatch_denied:d", "future", now + 50),
            ("other:e", "ignored", now - 1),
        ]
        for cat, snip, ts in rows:
            self.conn.execute(
                "INSERT INTO friction_events (session_id, category, weight, snippet, ts) VALUES (?,?,1,?,?)",
                (SESSION, cat, snip, ts),
            )
        self.conn.commit()
        with self.mock.patch.object(self.gates.time, "time", return_value=now):
            lines = self.gates.tripwire_group(SESSION)["lines"]
        deny = [ln for ln in lines if ln["id"].startswith("deny")]
        self.assertEqual(
            [(ln["label"], ln["detail"], ln["ok"]) for ln in deny],
            [
                ("Denied: d", "future (0s ago)", False),
                ("Denied: a", "x" * 80 + " (119s ago)", False),
                ("Denied: b", "boundary (2m ago)", False),
                ("Denied: c", " (10m ago)", False),
            ],
        )

    def test_routing_counts_only_matching_kind_and_server(self):
        self.conn.execute("INSERT INTO session_logs (session_id, agent) VALUES (?, 'claude')", (SESSION,))
        calls = [
            ("mcp", "serena", "find_symbol", 0),
            ("mcp", "Serena", "get_symbols_overview", 0),
            ("mcp", "lean-ctx", "ctx_read", 1),
            ("mcp", "other", "x", 0),
            ("builtin", "serena", "Read", 0),
            ("builtin", None, "Read", 0),
            ("builtin", None, "Edit", 0),
        ]
        for i, (k, s, t, d) in enumerate(calls):
            self.conn.execute(
                "INSERT INTO tool_calls (session_id, tool_use_id, tool_name, kind, server, denied) VALUES (?,?,?,?,?,?)",
                (SESSION, f"tu{i}", t, k, s, d),
            )
        self.conn.commit()
        lines = {ln["id"]: ln for ln in self.gates.routing_group(SESSION)["lines"]}
        note = self.gates._ROUTING_NOTE
        self.assertEqual(lines["serena"]["detail"], f"2 {note}")
        self.assertEqual(lines["lean-ctx"]["detail"], f"1 {note}")
        self.assertEqual(lines["context-mode"]["detail"], f"0 {note}")
        self.assertTrue(all(lines[n]["ok"] for n in ("serena", "lean-ctx", "claude-mem")))
        self.assertEqual((lines["native-Read"]["ok"], lines["native-Read"]["detail"]), (False, f"2 {note}"))
        self.assertTrue(lines["native-Grep"]["ok"])
        self.assertEqual((lines["denied"]["ok"], lines["denied"]["detail"]), (False, f"1 {note}"))

    def test_routing_no_calls_all_ok(self):
        lines = self.gates.routing_group(SESSION)["lines"]
        self.assertTrue(all(ln["ok"] for ln in lines))
        self.assertEqual(
            [ln["id"] for ln in lines][-5:],
            ["native-Read", "native-Grep", "native-Glob", "native-Bash", "denied"],
        )

    def test_build_timestamp_is_epoch_milliseconds_and_isolates_failures(self):
        with self.mock.patch.object(self.gates.time, "time", return_value=1234.5):
            doc = self.gates.build(SESSION, self.tmp.name)
        self.assertEqual(doc["generatedAt"], 1234500)
        with self.mock.patch.object(self.gates, "tripwire_group", side_effect=ValueError("bad")):
            doc = self.gates.build(SESSION, self.tmp.name)
        trip = doc["groups"][1]
        self.assertEqual(
            trip, {"id": "tripwire", "title": "Dispatch tripwire", "lines": [], "error": "ValueError: bad"}
        )
        self.assertEqual(len(doc["groups"][2]["lines"]) > 0, True)

    def test_main_requires_json_flag_and_prints_document(self):
        import contextlib
        import io

        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as cm:
            self.gates.main(["--session", SESSION, "--root", self.tmp.name])
        self.assertEqual(cm.exception.code, 2)
        for argv in (["--root", "/r", "--json"], ["--session", SESSION, "--json"]):
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as cm:
                self.gates.main(argv)
            self.assertEqual(cm.exception.code, 2, argv)
        buf = io.StringIO()
        with self.mock.patch.object(self.gates, "build", return_value={"groups": []}) as b:
            with contextlib.redirect_stdout(buf):
                rc = self.gates.main(
                    ["--session", SESSION, "--root", "/r", "--transcript", "/t", "--json"]
                )
        b.assert_called_once_with(SESSION, "/r", "/t")
        self.assertEqual((rc, json.loads(buf.getvalue())), (0, {"groups": []}))


if __name__ == "__main__":
    unittest.main()
