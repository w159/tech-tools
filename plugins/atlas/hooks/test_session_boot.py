"""In-process coverage tests for session_boot.SessionStart hook.

The existing test_session_boot_db.py exercises the hook via subprocess, which
contributes zero to line coverage. These tests import session_boot directly,
mock sys.stdin with a SessionStart payload, drive main() in-process, and call
the helper functions directly so coverage traces the real code paths.

Scope: session_boot.py only. The hook source is never modified.
"""

import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import atlas_db  # noqa: E402
import session_boot  # noqa: E402

BOOT = os.path.join(os.path.dirname(__file__), "session_boot.py")


def run_main_inprocess(payload, env):
    """Drive session_boot.main() in-process with mocked stdin/stdout/env.

    Returns (exit_code, stdout_text). main() ends with sys.exit(0), so we
    capture SystemExit."""
    raw = json.dumps(payload) if not isinstance(payload, str) else payload
    stdin = io.StringIO(raw)
    stdout = io.StringIO()
    with (
        mock.patch("sys.stdin", new=stdin),
        mock.patch("sys.stdout", new=stdout),
        mock.patch.dict(os.environ, env, clear=False),
    ):
        try:
            session_boot.main()
            code = 0
        except SystemExit as exc:
            code = exc.code if isinstance(exc.code, int) else 0
    return code, stdout.getvalue()


class MainInProcessTest(unittest.TestCase):
    """Drive the full main() path in-process with mocked externals."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.db = os.path.join(self.tmp, "atlas.db")
        self.env = dict(os.environ, ATLAS_DB=self.db)
        # Pre-inject mock curator/memory so main()'s import is a no-op and
        # apply_transitions / load_snapshot do not touch the real filesystem.
        self._curator = mock.MagicMock()
        self._memory = mock.MagicMock()
        self._memory.load_snapshot.return_value = {}
        self._orig_curator = sys.modules.get("atlas_curator")
        self._orig_memory = sys.modules.get("atlas_memory")
        sys.modules["atlas_curator"] = self._curator
        sys.modules["atlas_memory"] = self._memory

    def tearDown(self):
        for name, orig in (
            ("atlas_curator", self._orig_curator),
            ("atlas_memory", self._orig_memory),
        ):
            if orig is not None:
                sys.modules[name] = orig
            else:
                sys.modules.pop(name, None)

    # --- additionalContext + systemMessage emission -----------------------

    def test_main_emits_contract_and_system_message_absent_deps(self):
        """No deps present -> contract emitted, systemMessage asks to run atlas."""
        with (
            mock.patch.object(session_boot, "detect_dep", return_value=False),
            mock.patch.object(session_boot, "has_cmd", return_value=False),
        ):
            code, out = run_main_inprocess(
                {"session_id": "s1", "cwd": self.tmp}, self.env
            )
        self.assertEqual(code, 0)
        data = json.loads(out)
        self.assertIn("Atlas runtime active", data["additionalContext"])
        self.assertIn("research -> theory", data["additionalContext"])
        self.assertIn("atlas:<role>", data["additionalContext"])
        # All three deps absent -> all three "absent" lines present.
        self.assertIn("Memory (claude-mem): absent", data["additionalContext"])
        self.assertIn(
            "Context protection (context-mode): absent", data["additionalContext"]
        )
        self.assertIn("Less-code mode (ponytail): absent", data["additionalContext"])
        self.assertEqual(
            data["systemMessage"],
            "Atlas ready (run the `atlas` skill to complete setup)",
        )

    def test_main_system_message_ready_when_all_deps_available(self):
        """All deps present -> systemMessage is the bare 'Atlas ready'."""
        with (
            mock.patch.object(session_boot, "detect_dep", return_value=True),
            mock.patch.object(session_boot, "has_cmd", return_value=True),
        ):
            code, out = run_main_inprocess(
                {"session_id": "s2", "cwd": self.tmp}, self.env
            )
        self.assertEqual(code, 0)
        data = json.loads(out)
        self.assertIn("Memory (claude-mem): available", data["additionalContext"])
        self.assertIn(
            "Context protection (context-mode): available", data["additionalContext"]
        )
        self.assertIn("Less-code mode (ponytail): available", data["additionalContext"])
        self.assertEqual(data["systemMessage"], "Atlas ready")

    def test_main_ponytail_via_config_file_branch(self):
        """has_cmd('ponytail') False but config.json exists -> ponytail available."""

        def has_cmd(name):
            return False  # ponytail not on PATH

        with (
            mock.patch.object(session_boot, "detect_dep", return_value=False),
            mock.patch.object(session_boot, "has_cmd", side_effect=has_cmd),
            mock.patch("os.path.exists", return_value=True),
        ):
            code, out = run_main_inprocess(
                {"session_id": "s3", "cwd": self.tmp}, self.env
            )
        self.assertEqual(code, 0)
        data = json.loads(out)
        self.assertIn("Less-code mode (ponytail): available", data["additionalContext"])

    # --- DB start_run path ------------------------------------------------

    def test_main_creates_run_for_session_id(self):
        """session_id present -> start_run called; read back the run row."""
        code, _ = run_main_inprocess(
            {"session_id": "sess-boot-real", "cwd": self.tmp}, self.env
        )
        self.assertEqual(code, 0)
        conn = atlas_db.connect(self.db)
        try:
            self.assertIsNotNone(atlas_db.current_run_id(conn, "sess-boot-real"))
            # Boot never flags orchestrating; verify it stays unset.
            self.assertFalse(atlas_db.is_orchestrating(conn, "sess-boot-real"))
        finally:
            conn.close()

    def test_main_empty_session_id_creates_no_phantom_run(self):
        """M5 fix: empty/missing session_id must not create a phantom '' run."""
        code, _ = run_main_inprocess({"cwd": self.tmp}, self.env)
        self.assertEqual(code, 0)
        conn = atlas_db.connect(self.db)
        try:
            count = conn.execute(
                "SELECT COUNT(*) FROM runs WHERE session_id=''"
            ).fetchone()[0]
            self.assertEqual(count, 0, "phantom run keyed by '' was created")
        finally:
            conn.close()

    def test_main_idempotent_no_duplicate_run_for_same_session(self):
        """Calling main() twice for the same session must not start two runs."""
        run_main_inprocess({"session_id": "sess-dup", "cwd": self.tmp}, self.env)
        run_main_inprocess({"session_id": "sess-dup", "cwd": self.tmp}, self.env)
        conn = atlas_db.connect(self.db)
        try:
            count = conn.execute(
                "SELECT COUNT(*) FROM runs WHERE session_id='sess-dup'"
            ).fetchone()[0]
            self.assertEqual(count, 1, "boot created a duplicate run")
        finally:
            conn.close()

    # --- curator dispatch -------------------------------------------------

    def test_main_dispatches_curator(self):
        """main() invokes atlas_curator.apply_transitions (fail-open)."""
        with (
            mock.patch.object(session_boot, "detect_dep", return_value=False),
            mock.patch.object(session_boot, "has_cmd", return_value=False),
        ):
            run_main_inprocess({"session_id": "s4", "cwd": self.tmp}, self.env)
        self._curator.apply_transitions.assert_called_once()

    def test_main_curator_failure_does_not_block_boot(self):
        """An exception from apply_transitions must not prevent a clean exit."""
        self._curator.apply_transitions.side_effect = RuntimeError("boom")
        with (
            mock.patch.object(session_boot, "detect_dep", return_value=False),
            mock.patch.object(session_boot, "has_cmd", return_value=False),
        ):
            code, out = run_main_inprocess(
                {"session_id": "s5", "cwd": self.tmp}, self.env
            )
        self.assertEqual(code, 0)
        self.assertTrue(json.loads(out).get("additionalContext"))

    # --- memory snapshot injection ---------------------------------------

    def test_main_injects_memory_block(self):
        """load_snapshot returns memory+project -> both joined into context."""
        self._memory.load_snapshot.return_value = {
            "memory": "MEM-LINE",
            "project": "PROJ-LINE",
        }
        with (
            mock.patch.object(session_boot, "detect_dep", return_value=False),
            mock.patch.object(session_boot, "has_cmd", return_value=False),
        ):
            code, out = run_main_inprocess(
                {"session_id": "s6", "cwd": self.tmp}, self.env
            )
        self.assertEqual(code, 0)
        ctx = json.loads(out)["additionalContext"]
        self.assertIn("MEM-LINE", ctx)
        self.assertIn("PROJ-LINE", ctx)

    def test_main_memory_failure_does_not_block_boot(self):
        """load_snapshot raising must not crash boot."""
        self._memory.load_snapshot.side_effect = RuntimeError("nope")
        with (
            mock.patch.object(session_boot, "detect_dep", return_value=False),
            mock.patch.object(session_boot, "has_cmd", return_value=False),
        ):
            code, out = run_main_inprocess(
                {"session_id": "s7", "cwd": self.tmp}, self.env
            )
        self.assertEqual(code, 0)
        self.assertIn("Atlas runtime active", json.loads(out)["additionalContext"])

    # --- resume block appended to context --------------------------------

    def test_main_appends_resume_block(self):
        """resume_block truthy -> its text is appended to additionalContext."""
        with (
            mock.patch.object(
                session_boot, "resume_block", return_value="## Resuming demo"
            ),
            mock.patch.object(session_boot, "detect_dep", return_value=False),
            mock.patch.object(session_boot, "has_cmd", return_value=False),
        ):
            code, out = run_main_inprocess(
                {"session_id": "s8", "cwd": self.tmp}, self.env
            )
        self.assertEqual(code, 0)
        self.assertIn("## Resuming demo", json.loads(out)["additionalContext"])

    def test_main_resume_block_none_is_skipped(self):
        """resume_block None -> no crash, context still emitted."""
        with (
            mock.patch.object(session_boot, "resume_block", return_value=None),
            mock.patch.object(session_boot, "detect_dep", return_value=False),
            mock.patch.object(session_boot, "has_cmd", return_value=False),
        ):
            code, out = run_main_inprocess(
                {"session_id": "s9", "cwd": self.tmp}, self.env
            )
        self.assertEqual(code, 0)
        self.assertIn("Atlas runtime active", json.loads(out)["additionalContext"])

    # --- malformed stdin does not block boot ------------------------------

    def test_main_invalid_json_does_not_block_boot(self):
        """Garbage on stdin must not crash boot; default payload used."""
        with (
            mock.patch.object(session_boot, "detect_dep", return_value=False),
            mock.patch.object(session_boot, "has_cmd", return_value=False),
        ):
            code, out = run_main_inprocess("{not valid json", self.env)
        self.assertEqual(code, 0)
        self.assertIn("Atlas runtime active", json.loads(out)["additionalContext"])

    def test_main_db_failure_does_not_block_boot(self):
        """If atlas_db.connect raises, boot still emits context and exits 0."""
        with (
            mock.patch.object(atlas_db, "connect", side_effect=RuntimeError("db down")),
            mock.patch.object(session_boot, "detect_dep", return_value=False),
            mock.patch.object(session_boot, "has_cmd", return_value=False),
        ):
            code, out = run_main_inprocess(
                {"session_id": "s10", "cwd": self.tmp}, self.env
            )
        self.assertEqual(code, 0)
        self.assertIn("Atlas runtime active", json.loads(out)["additionalContext"])

    # --- context truncation guard ----------------------------------------

    def test_main_context_truncated_to_9000_chars(self):
        """A huge resume_block is capped at 9000 chars in additionalContext."""
        with (
            mock.patch.object(session_boot, "resume_block", return_value="X" * 20000),
            mock.patch.object(session_boot, "detect_dep", return_value=False),
            mock.patch.object(session_boot, "has_cmd", return_value=False),
        ):
            code, out = run_main_inprocess(
                {"session_id": "s11", "cwd": self.tmp}, self.env
            )
        self.assertEqual(code, 0)
        self.assertLessEqual(len(json.loads(out)["additionalContext"]), 9000)

    def test_main_block_catches_exception_exits_zero(self):
        """The outer __main__ guard catches any exception escaping main() and
        exits 0 (fail-open contract). Mirrors the auto_skill guard test."""
        with open(BOOT) as f:
            source = f.read()

        guard_calls = mock.MagicMock()

        def _fake_exit(_code=0):
            guard_calls()
            raise RuntimeError("forced non-SystemExit to exercise outer except")

        payload = json.dumps({"session_id": "guard-sess", "cwd": self.tmp})
        g: dict = {"__name__": "__main__", "__file__": BOOT}
        with (
            mock.patch("sys.exit", side_effect=_fake_exit),
            mock.patch("sys.stdin", io.StringIO(payload)),
            mock.patch("sys.stdout", io.StringIO()),
            mock.patch.dict(os.environ, self.env, clear=False),
        ):
            # main() runs through to its final sys.exit(0); the patched
            # sys.exit raises RuntimeError, which escapes main(), is caught by
            # the outer `except Exception`, whose sys.exit(0) raises
            # RuntimeError again and escapes exec. guard_calls fires twice.
            with self.assertRaises(RuntimeError):
                exec(compile(source, BOOT, "exec"), g)
        self.assertGreaterEqual(guard_calls.call_count, 2)


class HelperTest(unittest.TestCase):
    """Direct unit tests for the small pure helpers."""

    def test_has_cmd_returns_bool(self):
        self.assertIsInstance(session_boot.has_cmd("python3"), bool)
        self.assertFalse(session_boot.has_cmd("definitely-not-a-real-cmd-xyz"))

    def test_detect_dep_present_and_absent(self):
        # A stdlib module that always resolves.
        self.assertTrue(session_boot.detect_dep("json"))
        # A module name that will never resolve.
        self.assertFalse(session_boot.detect_dep("zzz_no_such_module_zzz"))

    def test_detect_dep_swallows_exception(self):
        """find_spec raising must return False, not propagate."""
        with mock.patch("importlib.util.find_spec", side_effect=ValueError("bad")):
            self.assertFalse(session_boot.detect_dep("anything"))

    def test_relative_time_branches(self):
        now = time.time()
        self.assertEqual(session_boot._relative_time(now), "just now")
        self.assertEqual(session_boot._relative_time(now - 120), "2m ago")
        self.assertEqual(session_boot._relative_time(now - 7200), "2h ago")
        self.assertEqual(session_boot._relative_time(now - 86400 * 3), "3d ago")

    def test_claude_mem_summary_missing_db_returns_none(self):
        """No claude-mem DB file -> None, no exception."""
        with mock.patch("os.path.exists", return_value=False):
            self.assertIsNone(session_boot._claude_mem_summary("any"))

    def test_claude_mem_summary_empty_project_returns_none(self):
        """Empty project_name short-circuits to None."""
        self.assertIsNone(session_boot._claude_mem_summary(""))


class ResumeBlockTest(unittest.TestCase):
    """Cover resume_block's None and populated return paths."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.db = os.path.join(self.tmp, "atlas.db")
        self.env = dict(os.environ, ATLAS_DB=self.db)
        self._orig_curator = sys.modules.get("atlas_curator")
        self._orig_memory = sys.modules.get("atlas_memory")
        sys.modules["atlas_curator"] = mock.MagicMock()
        sys.modules["atlas_memory"] = mock.MagicMock()

    def tearDown(self):
        for name, orig in (
            ("atlas_curator", self._orig_curator),
            ("atlas_memory", self._orig_memory),
        ):
            if orig is not None:
                sys.modules[name] = orig
            else:
                sys.modules.pop(name, None)

    def test_resume_block_no_data_returns_none(self):
        """No atlas session and no claude-mem -> None."""
        with (
            mock.patch.object(session_boot, "_claude_mem_summary", return_value=None),
            mock.patch.object(
                session_boot, "_atlas_session_context", return_value=None
            ),
        ):
            self.assertIsNone(session_boot.resume_block(self.tmp))

    def test_resume_block_from_claude_mem_only(self):
        """claude-mem summary present, no atlas session -> block from mem."""
        now_ms = int(time.time() * 1000)
        mem = {
            "summary": ("did X", "next: do Y", "file_a.py", now_ms),
            "threads": ["decision A", "discovery B"],
        }
        with (
            mock.patch.object(session_boot, "_claude_mem_summary", return_value=mem),
            mock.patch.object(
                session_boot, "_atlas_session_context", return_value=None
            ),
        ):
            block = session_boot.resume_block(self.tmp)
        self.assertIsNotNone(block)
        assert block is not None  # narrow Optional[str] for assertIn
        self.assertIn("## Resuming", block)
        self.assertIn("Last task: did X", block)
        self.assertIn("Open threads:", block)
        self.assertIn("- decision A", block)
        self.assertIn("Next step: next: do Y", block)
        self.assertIn("Last file: file_a.py", block)

    def test_resume_block_from_atlas_ctx_only(self):
        """atlas session present, no claude-mem -> block from atlas ctx."""
        atlas_ctx = {
            "branch": "feature-x",
            "started_at": time.time() - 600,
            "prompt": "fix the bug",
            "last_file": "src/app.py",
            "unverified": 2,
            "lag_kb": 12,
        }
        with (
            mock.patch.object(session_boot, "_claude_mem_summary", return_value=None),
            mock.patch.object(
                session_boot, "_atlas_session_context", return_value=atlas_ctx
            ),
        ):
            block = session_boot.resume_block(self.tmp)
        self.assertIsNotNone(block)
        assert block is not None  # narrow Optional[str] for assertIn
        self.assertIn("branch: feature-x", block)
        self.assertIn("Last intent: fix the bug", block)
        self.assertIn("Last file: src/app.py", block)
        self.assertIn("mirror 12KB behind live", block)
        self.assertIn("Unfinished verification: 2 unverified claim(s)", block)

    def test_resume_block_swallows_unexpected_error(self):
        """Any uncaught exception -> None (never block boot)."""
        with (
            mock.patch.object(
                session_boot,
                "_atlas_session_context",
                side_effect=RuntimeError("kaboom"),
            ),
            mock.patch.object(
                session_boot, "_claude_mem_summary", side_effect=RuntimeError("kaboom")
            ),
        ):
            # Both helpers raise; the outer try/except in resume_block catches.
            self.assertIsNone(session_boot.resume_block(self.tmp))


class AtlasSessionContextTest(unittest.TestCase):
    """Cover _atlas_session_context against a real temp atlas DB."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.db = os.path.join(self.tmp, "atlas.db")
        os.environ["ATLAS_DB"] = self.db
        self.conn = atlas_db.connect(self.db)
        atlas_db.init(self.conn)
        self.pid = atlas_db.register_project(self.conn, self.tmp)

    def tearDown(self):
        self.conn.close()
        os.environ.pop("ATLAS_DB", None)

    def test_no_session_row_returns_none(self):
        self.assertIsNone(session_boot._atlas_session_context(self.conn, self.tmp))

    def test_populated_session_row_returns_context(self):
        sid = "sess-ctx"
        started = time.time() - 3600
        self.conn.execute(
            "INSERT INTO session_logs(session_id, project_id, cwd, git_branch, "
            "started_at, cursor_bytes, file_size) VALUES (?,?,?,?,?,?,?)",
            (sid, self.pid, self.tmp, "main", started, 100, 2048),
        )
        # Two user prompts: first is a task-notification (skipped), second real.
        self.conn.execute(
            "INSERT INTO user_prompts(session_id, ts, text) VALUES (?,?,?)",
            (sid, started + 1, "<task-notification>noise</task-notification>"),
        )
        self.conn.execute(
            "INSERT INTO user_prompts(session_id, ts, text) VALUES (?,?,?)",
            (sid, started + 2, "  <command-name>slash</command-name>"),
        )
        self.conn.execute(
            "INSERT INTO user_prompts(session_id, ts, text) VALUES (?,?,?)",
            (sid, started + 3, "real user prompt here"),
        )
        # A tool call with an Edit input_summary carrying a file_path.
        self.conn.execute(
            "INSERT INTO tool_calls(session_id, ts, tool_name, input_summary) "
            "VALUES (?,?,?,?)",
            (sid, started + 4, "Edit", json.dumps({"file_path": "src/main.py"})),
        )
        # An unverified-claim signal.
        self.conn.execute(
            "INSERT INTO signals(session_id, ts, signal_type) VALUES (?,?,?)",
            (sid, started + 5, "unverified_claim"),
        )
        self.conn.commit()

        ctx = session_boot._atlas_session_context(self.conn, self.tmp)
        self.assertIsNotNone(ctx)
        assert ctx is not None  # narrow Optional[dict] for subscript
        self.assertEqual(ctx["branch"], "main")
        self.assertEqual(ctx["prompt"], "real user prompt here")
        self.assertEqual(ctx["last_file"], "src/main.py")
        self.assertEqual(ctx["unverified"], 1)
        # file_size (2048) > cursor_bytes (100) -> lag_kb = (2048-100)//1024 = 1
        self.assertEqual(ctx["lag_kb"], 1)

    def test_malformed_edit_summary_yields_no_last_file(self):
        sid = "sess-bad"
        self.conn.execute(
            "INSERT INTO session_logs(session_id, project_id, cwd, started_at) "
            "VALUES (?,?,?,?)",
            (sid, self.pid, self.tmp, time.time()),
        )
        self.conn.execute(
            "INSERT INTO tool_calls(session_id, ts, tool_name, input_summary) "
            "VALUES (?,?,?,?)",
            (sid, time.time(), "Write", "not-json{"),
        )
        self.conn.commit()
        ctx = session_boot._atlas_session_context(self.conn, self.tmp)
        self.assertIsNotNone(ctx)
        assert ctx is not None  # narrow Optional[dict] for subscript
        self.assertIsNone(ctx["last_file"])


class SubprocessExitCodeTest(unittest.TestCase):
    """A couple of end-to-end exit-code checks through the real interpreter."""

    def test_subprocess_valid_payload_exits_zero(self):
        tmp = tempfile.mkdtemp()
        env = dict(os.environ, ATLAS_DB=os.path.join(tmp, "atlas.db"))
        p = subprocess.run(
            [sys.executable, BOOT],
            input=json.dumps({"session_id": "e2e", "cwd": tmp}),
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(p.returncode, 0)
        self.assertIn("Atlas runtime active", p.stdout)

    def test_subprocess_garbage_stdin_exits_zero(self):
        """Hook must never block boot, even on garbage stdin."""
        tmp = tempfile.mkdtemp()
        env = dict(os.environ, ATLAS_DB=os.path.join(tmp, "atlas.db"))
        p = subprocess.run(
            [sys.executable, BOOT],
            input="<<<not json",
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(p.returncode, 0)


if __name__ == "__main__":
    unittest.main()
