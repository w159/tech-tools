"""In-process coverage tests for session_boot.SessionStart hook.

The existing test_session_boot_db.py exercises the hook via subprocess, which
contributes zero to line coverage. These tests import session_boot directly,
mock sys.stdin with a SessionStart payload, drive main() in-process, and call
the helper functions directly so coverage traces the real code paths.

Scope: session_boot.py only. The hook source is never modified.
"""

import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(
    0,
    _iso_os.path.join(
        _iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"
    ),
)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import glob
import io
import json
import os
import shutil
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
import testenv  # noqa: E402

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
        # Never let boot reach the real dashboard daemon (ensure would stop/respawn it).
        self.env = dict(
            testenv.scrub(dict(os.environ)),
            ATLAS_DB=self.db,
            ATLAS_DASHBOARD="off",
            ATLAS_COLONY="off",
        )
        # run_main_inprocess patches with clear=False, so scrub the live env too.
        self._saved_environ = dict(os.environ)
        testenv.scrub()
        self.addCleanup(self._restore_environ)
        # Pre-inject mock curator/memory so main()'s import is a no-op and
        # apply_transitions / load_snapshot do not touch the real filesystem.
        self._curator = mock.MagicMock()
        self._memory = mock.MagicMock()
        self._memory.load_snapshot.return_value = {}
        self._orig_curator = sys.modules.get("atlas_curator")
        self._orig_memory = sys.modules.get("atlas_memory")
        sys.modules["atlas_curator"] = self._curator
        sys.modules["atlas_memory"] = self._memory
        # Plugin enablement reads the real ~/.claude/settings.json; isolate it.
        self._plugins = mock.patch.object(
            session_boot, "plugin_enabled", return_value=False
        )
        self._plugins.start()

    def _restore_environ(self):
        os.environ.clear()
        os.environ.update(self._saved_environ)

    def tearDown(self):
        self._plugins.stop()
        for name, orig in (
            ("atlas_curator", self._orig_curator),
            ("atlas_memory", self._orig_memory),
        ):
            if orig is not None:
                sys.modules[name] = orig
            else:
                sys.modules.pop(name, None)

    # --- additionalContext + systemMessage emission -----------------------

    def test_context_carries_absolute_team_flow_commands(self):
        """live-230: CLAUDE_PLUGIN_ROOT is unset in the lead's Bash, so `${CLAUDE_PLUGIN_ROOT}` commands
        ran the repo's scripts. Boot prints the installed root's absolute resolver/spawn-team commands;
        omp passes its own root in CLAUDE_PLUGIN_ROOT."""
        own = os.path.realpath(os.path.join(os.path.dirname(__file__), ".."))
        for env_root, want in ((None, own), ("/opt/omp/atlas", "/opt/omp/atlas")):
            env = dict(self.env)
            env.pop("CLAUDE_PLUGIN_ROOT", None)
            if env_root:
                env["CLAUDE_PLUGIN_ROOT"] = env_root
            with mock.patch.dict(os.environ, {}, clear=False):
                os.environ.pop("CLAUDE_PLUGIN_ROOT", None)
                _, out = run_main_inprocess({"session_id": "s1", "cwd": self.tmp}, env)
            ctx = json.loads(out)["hookSpecificOutput"]["additionalContext"]
            self.assertIn(f'python3 "{want}/scripts/atlas_resolve.py" <class> <effort>', ctx)
            self.assertIn(f'python3 "{want}/scripts/atlas_mux.py" spawn-team', ctx)
            self.assertIn(f'python3 "{want}/scripts/atlas_mux.py" wait --team', ctx)
            self.assertNotIn("${CLAUDE_PLUGIN_ROOT}", ctx)

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
        self.assertIn(
            "Atlas: orchestrator posture",
            data["hookSpecificOutput"]["additionalContext"],
        )
        self.assertIn(
            "research -> theory", data["hookSpecificOutput"]["additionalContext"]
        )
        self.assertIn("atlas:<role>", data["hookSpecificOutput"]["additionalContext"])
        # All three deps absent -> one consolidated "Setup gap" line naming all three.
        self.assertIn(
            "Setup gap: claude-mem, context-mode, ponytail absent",
            data["hookSpecificOutput"]["additionalContext"],
        )
        self.assertEqual(
            data["systemMessage"],
            "Atlas ready (run the `atlas-setup` skill to complete setup)",
        )
        self.assertEqual(data["hookSpecificOutput"]["hookEventName"], "SessionStart")

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
        # Nothing missing -> the noise-reduction contract says say nothing.
        self.assertNotIn("Setup gap", data["hookSpecificOutput"]["additionalContext"])
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
        gap = [
            ln
            for ln in data["hookSpecificOutput"]["additionalContext"].splitlines()
            if ln.startswith("Setup gap:")
        ]
        self.assertTrue(gap)
        self.assertNotIn("ponytail", gap[0])

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
        self.assertTrue(
            json.loads(out).get("hookSpecificOutput", {}).get("additionalContext")
        )

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
        ctx = json.loads(out)["hookSpecificOutput"]["additionalContext"]
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
        self.assertIn(
            "Atlas: orchestrator posture",
            json.loads(out)["hookSpecificOutput"]["additionalContext"],
        )

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
        self.assertIn(
            "## Resuming demo",
            json.loads(out)["hookSpecificOutput"]["additionalContext"],
        )

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
        self.assertIn(
            "Atlas: orchestrator posture",
            json.loads(out)["hookSpecificOutput"]["additionalContext"],
        )

    # --- malformed stdin does not block boot ------------------------------

    def test_main_invalid_json_does_not_block_boot(self):
        """Garbage on stdin must not crash boot; default payload used."""
        with (
            mock.patch.object(session_boot, "detect_dep", return_value=False),
            mock.patch.object(session_boot, "has_cmd", return_value=False),
        ):
            code, out = run_main_inprocess("{not valid json", self.env)
        self.assertEqual(code, 0)
        self.assertIn(
            "Atlas: orchestrator posture",
            json.loads(out)["hookSpecificOutput"]["additionalContext"],
        )

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
        self.assertIn(
            "Atlas: orchestrator posture",
            json.loads(out)["hookSpecificOutput"]["additionalContext"],
        )

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
        self.assertLessEqual(
            len(json.loads(out)["hookSpecificOutput"]["additionalContext"]), 9000
        )

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

    def test_missing_structure_reports_full_canonical_set(self):
        """A bare dir (no .git, no docs/) is missing every canonical path,
        including the docs/ base subfolders and durable .atlas/ subfolders
        this check was broadened to cover."""
        tmp = tempfile.mkdtemp()
        missing = session_boot.missing_structure(tmp)
        for label in (
            "docs/architecture/",
            "docs/wiki/",
            ".atlas/findings/",
            ".atlas/self-improvement/",
            "CLAUDE.md",
            ".gitignore",
        ):
            self.assertIn(label, missing)

    def test_missing_structure_empty_when_fully_scaffolded(self):
        """A dir with every canonical path present reports nothing missing."""
        tmp = tempfile.mkdtemp()
        for label in session_boot._STRUCTURE_PATHS:
            path = os.path.join(tmp, label.rstrip("/"))
            if label.endswith("/"):
                os.makedirs(path, exist_ok=True)
            else:
                os.makedirs(os.path.dirname(path) or tmp, exist_ok=True)
                open(path, "w").close()
        self.assertEqual(session_boot.missing_structure(tmp), [])


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
        patcher = mock.patch.dict(os.environ)  # restores ATLAS_DB on cleanup
        patcher.start()
        self.addCleanup(patcher.stop)
        self.db = os.path.join(self.tmp, "atlas.db")
        os.environ["ATLAS_DB"] = self.db
        self.conn = atlas_db.connect(self.db)
        atlas_db.init(self.conn)
        self.pid = atlas_db.register_project(self.conn, self.tmp)

    def tearDown(self):
        self.conn.close()

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
        env = dict(
            os.environ,
            ATLAS_DB=os.path.join(tmp, "atlas.db"),
            ATLAS_DASHBOARD="off",
            ATLAS_COLONY="off",
        )
        p = subprocess.run(
            [sys.executable, BOOT],
            input=json.dumps({"session_id": "e2e", "cwd": tmp}),
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(p.returncode, 0)
        self.assertIn("Atlas: orchestrator posture", p.stdout)

    def test_subprocess_garbage_stdin_exits_zero(self):
        """Hook must never block boot, even on garbage stdin."""
        tmp = tempfile.mkdtemp()
        env = dict(
            os.environ,
            ATLAS_DB=os.path.join(tmp, "atlas.db"),
            ATLAS_DASHBOARD="off",
            ATLAS_COLONY="off",
        )
        p = subprocess.run(
            [sys.executable, BOOT],
            input="<<<not json",
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(p.returncode, 0)


class DocsStructureRepairTest(unittest.TestCase):
    """SessionStart repairs the durable docs/ tree instead of blocking on it.

    Creating an empty, scaffolder-owned subfolder is mechanical and safe, so it
    is auto-fixed here. Anything needing judgement (a file's name, a CHANGELOG
    entry) stays a completion-gate block instead.
    """

    def setUp(self):
        self.addCleanup(os.environ.update, testenv.scrub())
        self.tmp = tempfile.mkdtemp()
        subprocess.run(["git", "init", "-q", self.tmp], check=True, capture_output=True)
        with open(os.path.join(self.tmp, "README.md"), "w", encoding="utf-8") as fh:
            fh.write("# r\n")
        self.env = dict(
            os.environ,
            ATLAS_DB=os.path.join(self.tmp, "atlas.db"),
            ATLAS_HOOKSTATE_DIR=os.path.join(self.tmp, "hookstate"),
            ATLAS_DASHBOARD="off",
            ATLAS_COLONY="off",
        )

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _boot(self, session="s1"):
        return subprocess.run(
            [sys.executable, BOOT],
            input=json.dumps({"session_id": session, "cwd": self.tmp}),
            capture_output=True,
            text=True,
            env=self.env,
        ).stdout

    def _subdirs(self):
        docs = os.path.join(self.tmp, "docs")
        if not os.path.isdir(docs):
            return set()
        return {n for n in os.listdir(docs) if os.path.isdir(os.path.join(docs, n))}

    def test_partial_docs_tree_is_completed(self):
        os.makedirs(os.path.join(self.tmp, "docs"), exist_ok=True)
        out = self._boot()
        self.assertIn("docs structure repaired", out)
        for required in ("architecture", "decisions", "plans", "specs", "lessons"):
            self.assertIn(required, self._subdirs())

    def test_repair_is_idempotent_and_then_silent(self):
        os.makedirs(os.path.join(self.tmp, "docs"), exist_ok=True)
        self._boot("s1")
        before = self._subdirs()
        out = self._boot("s2")
        self.assertNotIn("docs structure repaired", out)
        self.assertEqual(before, self._subdirs())

    def test_project_with_no_docs_tree_is_not_scaffolded_behind_the_users_back(self):
        """Onboarding a project that never asked for docs/ belongs to
        atlas-setup. Boot reports the gap and creates nothing."""
        out = self._boot()
        self.assertIn("docs SSOT absent", out)
        self.assertFalse(os.path.isdir(os.path.join(self.tmp, "docs")))

    def test_kill_switch_disables_repair(self):
        os.makedirs(os.path.join(self.tmp, "docs"), exist_ok=True)
        self.env["ATLAS_DOCS_REPAIR"] = "off"
        out = self._boot()
        self.assertNotIn("docs structure repaired", out)
        self.assertEqual(self._subdirs(), set())


class RecallMandateTest(unittest.TestCase):
    """claude-mem recall mandate: armed only when the claude-mem plugin is enabled."""

    setUp = MainInProcessTest.setUp
    tearDown = MainInProcessTest.tearDown
    _restore_environ = MainInProcessTest._restore_environ

    def _context(self, enabled, mandates=""):
        self._plugins.stop()
        self._plugins = mock.patch.object(
            session_boot,
            "plugin_enabled",
            side_effect=lambda name, root=None: name in enabled,
        )
        self._plugins.start()
        with (
            mock.patch.object(session_boot, "detect_dep", return_value=False),
            mock.patch.object(session_boot, "has_cmd", return_value=False),
        ):
            code, out = run_main_inprocess(
                {"session_id": "r1", "cwd": self.tmp},
                dict(self.env, ATLAS_MANDATES=mandates),
            )
        self.assertEqual(code, 0)
        return json.loads(out)["hookSpecificOutput"]["additionalContext"]

    def test_enabled_plugin_arms_recall_and_clears_setup_gap(self):
        ctx = self._context({"claude-mem", "ponytail", "context-mode"})
        self.assertIn(session_boot.recall_mandate(), ctx)
        self.assertIn("mcp__plugin_claude-mem_mcp-search__search", ctx)
        self.assertNotIn("Setup gap", ctx)

    def test_absent_plugin_stays_silent(self):
        ctx = self._context(set())
        self.assertNotIn("Recall first", ctx)

    def test_kill_switch(self):
        ctx = self._context({"claude-mem"}, "off")
        self.assertNotIn("Recall first", ctx)


class PluginEnabledTest(unittest.TestCase):
    """tool_routing.plugin_enabled: settings precedence and fail-open parsing."""

    def setUp(self):
        import tool_routing

        self.tr = tool_routing
        self.home = tempfile.mkdtemp()
        self.proj = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.home, ".claude"))
        os.makedirs(os.path.join(self.proj, ".claude"))

    def tearDown(self):
        shutil.rmtree(self.home, ignore_errors=True)
        shutil.rmtree(self.proj, ignore_errors=True)

    def _write(self, base, name, data):
        with open(os.path.join(base, ".claude", name), "w") as fh:
            fh.write(data if isinstance(data, str) else json.dumps(data))

    def test_user_setting_enables_and_project_override_disables(self):
        self._write(
            self.home, "settings.json", {"enabledPlugins": {"ponytail@ponytail": True}}
        )
        with mock.patch.dict(os.environ, {"HOME": self.home}):
            self.assertTrue(self.tr.plugin_enabled("ponytail", self.proj))
            self.assertFalse(self.tr.plugin_enabled("pony", self.proj))
            self._write(
                self.proj,
                "settings.local.json",
                {"enabledPlugins": {"ponytail@ponytail": False}},
            )
            self.assertFalse(self.tr.plugin_enabled("ponytail", self.proj))

    def test_malformed_settings_fail_open(self):
        self._write(self.home, "settings.json", "{not json")
        self._write(self.proj, "settings.json", {"enabledPlugins": ["ponytail"]})
        with mock.patch.dict(os.environ, {"HOME": self.home}):
            self.assertFalse(self.tr.plugin_enabled("ponytail", self.proj))

    def test_omp_lock_decides_under_omp_only(self):
        # An omp-installed plugin is absent from the Claude settings; boot called it "absent - run the atlas skill".
        os.makedirs(os.path.join(self.home, ".omp", "plugins"))
        with open(
            os.path.join(self.home, ".omp", "plugins", "omp-plugins.lock.json"), "w"
        ) as fh:
            json.dump(
                {
                    "plugins": {
                        "ponytail": {"enabled": True},
                        "pyright-lsp": {"enabled": False},
                    }
                },
                fh,
            )
        self._write(
            self.home, "settings.json", {"enabledPlugins": {"pyright-lsp@x": True}}
        )
        with mock.patch.dict(os.environ, {"HOME": self.home}):
            self.assertFalse(
                self.tr.plugin_enabled("ponytail", self.proj)
            )  # Claude Code never reads the omp lock
            self.assertTrue(self.tr.plugin_enabled("pyright-lsp", self.proj))
        with mock.patch.dict(os.environ, {"HOME": self.home, "ATLAS_HARNESS": "omp"}):
            self.assertTrue(self.tr.plugin_enabled("ponytail", self.proj))
            self.assertFalse(
                self.tr.plugin_enabled("pyright-lsp", self.proj)
            )  # omp lock disables it for omp
            self.assertFalse(self.tr.plugin_enabled("unknown", self.proj))


def _git(root, *args):
    subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)


def make_repo():
    """A REAL git repo: committed src/calc.py and docs/guide.md."""
    root = os.path.realpath(tempfile.mkdtemp())
    _git(root, "init", "-q")
    _git(root, "config", "user.email", "t@example.com")
    _git(root, "config", "user.name", "t")
    os.makedirs(os.path.join(root, "src"))
    os.makedirs(os.path.join(root, "docs"))
    with open(os.path.join(root, "src", "calc.py"), "w") as fh:
        fh.write("def add(a, b):\n    return a - b\n")
    with open(os.path.join(root, "docs", "guide.md"), "w") as fh:
        fh.write("# guide\n")
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "init")
    return root


class DirtySnapshotTest(unittest.TestCase):
    """SessionStart records which non-docs paths are already dirty, so the Stop
    gate can tell shell-written code (sed -i, tee, ...) from inherited dirt."""

    def setUp(self):
        self.root = make_repo()
        self.addCleanup(shutil.rmtree, self.root, True)

    def snap_path(self, session="s1"):
        return os.path.join(
            self.root, ".atlas", ".run", "dirty-snapshot-%s.json" % session
        )

    def put(self, rel, body):
        path = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            fh.write(body)

    def test_snapshot_maps_non_docs_dirty_paths_to_hashes(self):
        self.put("src/calc.py", "def add(a, b):\n    return a + b\n")
        self.put("src/new.py", "x = 1\n")
        self.put("docs/guide.md", "# changed\n")
        self.put("README.md", "r\n")
        self.put(".atlas/state.json", "{}\n")
        self.assertEqual(
            session_boot.write_dirty_snapshot(self.root, "s1"), self.snap_path()
        )
        with open(self.snap_path()) as fh:
            paths = json.load(fh)["paths"]
        self.assertEqual(sorted(paths), ["src/calc.py", "src/new.py"])
        self.assertTrue(all(len(h) == 64 for h in paths.values()))

    def test_first_snapshot_wins_on_repeat_session_start(self):
        self.put("src/new.py", "x = 1\n")
        session_boot.write_dirty_snapshot(self.root, "s1")
        self.put(
            "src/later.py", "y = 1\n"
        )  # shell edit between two SessionStart events
        session_boot.write_dirty_snapshot(self.root, "s1")
        with open(self.snap_path()) as fh:
            self.assertEqual(sorted(json.load(fh)["paths"]), ["src/new.py"])

    def test_not_a_git_repo_writes_nothing(self):
        plain = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, plain, True)
        self.assertIsNone(session_boot.write_dirty_snapshot(plain, "s1"))
        self.assertFalse(os.path.exists(os.path.join(plain, ".atlas")))

    def test_missing_session_id_writes_nothing(self):
        self.assertIsNone(session_boot.write_dirty_snapshot(self.root, ""))
        self.assertFalse(os.path.exists(os.path.join(self.root, ".atlas")))

    def test_unwritable_target_is_swallowed(self):
        self.put(".atlas", "a file where the dir should be\n")
        self.assertIsNone(session_boot.write_dirty_snapshot(self.root, "s1"))

    def test_main_writes_snapshot_for_the_session(self):
        self.put("src/new.py", "x = 1\n")
        home = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, home, True)
        env = {
            "ATLAS_DB": os.path.join(home, "atlas.db"),
            "HOME": home,
            "ATLAS_DASHBOARD": "off",
            "ATLAS_COLONY": "off",
        }
        with mock.patch.object(session_boot, "plugin_enabled", return_value=False):
            code, _ = run_main_inprocess({"session_id": "s1", "cwd": self.root}, env)
        self.assertEqual(code, 0)
        for _ in range(
            100
        ):  # the snapshot is written by a detached child, off the boot path
            if os.path.exists(self.snap_path()):
                break
            time.sleep(0.05)
        with open(self.snap_path()) as fh:
            self.assertEqual(sorted(json.load(fh)["paths"]), ["src/new.py"])


class EnsureColonyCacheTest(unittest.TestCase):
    """A fresh healthy status cache skips the slow `atlas_herdr.py status` probe; stale/unhealthy re-probe."""

    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.home, True)
        self.cache = os.path.join(self.home, "herdr-status-cache.json")

    def seed(self, data, age):
        with open(self.cache, "w") as fh:
            json.dump(data, fh)
        t = time.time() - age
        os.utime(self.cache, (t, t))

    def run_colony(self):
        with mock.patch.dict(
            os.environ, {"ATLAS_HOME": self.home, "ATLAS_COLONY": "on"}
        ):
            with (
                mock.patch("subprocess.run") as run,
                mock.patch("subprocess.Popen") as popen,
                mock.patch.object(__import__("atlas_seats"), "backend", return_value="herdr"),
                # herdr down -> one ensure_server attempt; never start (or probe) the real server
                mock.patch.object(
                    __import__("atlas_herdr"), "ensure_server", return_value={"ok": False}
                ),
            ):
                run.return_value = mock.Mock(
                    stdout=json.dumps({"healthy": False, "herdr_server": False})
                )
                return session_boot.ensure_colony(), run, popen

    def test_fresh_healthy_cache_skips_probe(self):
        self.seed({"healthy": True, "url": "http://x:1"}, 5)
        out, run, popen = self.run_colony()
        self.assertEqual(out, "colony ready at http://x:1")
        run.assert_not_called()
        popen.assert_not_called()

    def test_stale_healthy_cache_refreshes_detached(self):
        self.seed({"healthy": True, "url": "http://x:1"}, 100)
        out, run, popen = self.run_colony()
        self.assertEqual(out, "colony ready at http://x:1")
        run.assert_not_called()
        popen.assert_called_once()

    def test_cold_cache_never_probes_on_boot_path(self):
        out, run, popen = self.run_colony()
        self.assertEqual(out, "colony: checking")
        run.assert_not_called()
        popen.assert_called_once()  # detached status refresh

    def test_recent_herdr_down_is_negative_cached(self):
        self.seed({"healthy": False, "herdr_server": False}, 5)
        out, run, popen = self.run_colony()
        self.assertIsNone(out)
        run.assert_not_called()
        popen.assert_not_called()

    def test_recent_web_ui_down_reuses_status_and_starts_ensure(self):
        self.seed({"healthy": False, "herdr_server": True, "url": "u"}, 5)
        with mock.patch.object(session_boot, "_colony_stack_url", return_value=None):
            out, run, popen = self.run_colony()
        self.assertTrue(out.startswith("colony: starting"))
        run.assert_not_called()
        popen.assert_called_once()

    def test_expired_cache_reprobes(self):
        for data, age in (
            ({"healthy": False}, 9999),
            ({"healthy": True, "url": "u"}, 9999),
        ):
            self.seed(data, age)
            out, run, _ = self.run_colony()
            self.assertIsNone(out)
            run.assert_called_once()


class WorkerIdentityTest(unittest.TestCase):
    """10.4.3: workers never steal carry-over; a Claude Code lead pins ATLAS_LEAD_NAME via CLAUDE_ENV_FILE."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.root = os.path.join(self.tmp, "proj")
        os.makedirs(os.path.join(self.root, ".atlas"))
        self.env_file = os.path.join(self.tmp, "claude.env")
        self.env = {
            "ATLAS_DB": os.path.join(self.tmp, "atlas.db"),
            "ATLAS_DASHBOARD": "off",
            "ATLAS_COLONY": "off",
            "ATLAS_TODO": "on",
            "ATLAS_WORKER_NAME": "",
            "ATLAS_LEAD_NAME": "",
            "CLAUDE_ENV_FILE": self.env_file,
        }

    def boot(self, sid, **over):
        env = dict(self.env, **over)
        return run_main_inprocess({"session_id": sid, "cwd": self.root}, env)

    def test_worker_session_does_not_carry_other_sessions_items(self):
        import atlas_todo

        atlas_todo.mirror(
            self.root, [{"content": "lead item", "status": "pending"}], "lead-sid"
        )
        self.boot("worker-sid", ATLAS_WORKER_NAME="Alpha")
        item = atlas_todo.load(self.root)["items"][0]
        self.assertEqual((item["session_id"], item["origin"]), ("lead-sid", "session"))
        # a non-worker session still carries it (the behaviour a worker must not trigger)
        self.boot("next-sid")
        item = atlas_todo.load(self.root)["items"][0]
        self.assertEqual((item["session_id"], item["origin"]), ("next-sid", "carried"))

    def test_lead_gets_exactly_one_export_line(self):
        self.boot("01a11c99-aaaa")
        self.boot("01a11c99-aaaa")
        with open(self.env_file) as f:
            lines = f.read().splitlines()
        self.assertEqual(lines, ["export ATLAS_LEAD_NAME=lead-01a11c"])

    def test_worker_and_preset_lead_name_write_nothing(self):
        self.boot("sid-1234567", ATLAS_WORKER_NAME="Beta")
        self.boot("sid-1234567", ATLAS_LEAD_NAME="custom")
        self.assertFalse(os.path.exists(self.env_file))


class EnsureDashboardTempEnvTest(unittest.TestCase):
    """Boot under scratch state must never reach the shared :7421 daemon."""

    def _run(self, **env):
        drop = (
            "ATLAS_DASHBOARD",
            "ATLAS_DASHBOARD_PORT",
            "ATLAS_HOME",
            "ATLAS_DASHBOARD_DB",
        )
        base = {k: v for k, v in os.environ.items() if k not in drop}
        base.update(env)
        fake = mock.Mock(
            returncode=0,
            stdout='{"url": "http://127.0.0.1:7421/", "already_running": true}',
        )
        with (
            mock.patch.dict(os.environ, base, clear=True),
            mock.patch("subprocess.run", return_value=fake) as run,
        ):
            return session_boot.ensure_dashboard(), run

    def test_temp_home_skips_without_spawn(self):
        with tempfile.TemporaryDirectory() as home:
            out, run = self._run(HOME=home)
        self.assertIsNone(out)
        run.assert_not_called()

    def test_temp_db_skips_without_spawn(self):
        out, run = self._run(
            HOME="/Users/someone", ATLAS_DASHBOARD_DB="/tmp/x/atlas.db"
        )
        self.assertIsNone(out)
        run.assert_not_called()

    def test_temp_home_with_explicit_spare_port_is_allowed(self):
        with tempfile.TemporaryDirectory() as home:
            out, run = self._run(HOME=home, ATLAS_DASHBOARD_PORT="17969")
        run.assert_called_once()
        self.assertIn("dashboard:", out)

    def test_real_home_still_ensures(self):
        out, run = self._run(HOME="/Users/someone")
        run.assert_called_once()
        self.assertIn("dashboard:", out)

    def test_ensure_timeout_records_hook_fault(self):
        import atlas_hook_guard

        exc = subprocess.TimeoutExpired(cmd="ensure", timeout=15)
        env = {
            k: v
            for k, v in os.environ.items()
            if k
            not in (
                "ATLAS_DASHBOARD",
                "ATLAS_DASHBOARD_PORT",
                "ATLAS_HOME",
                "ATLAS_DASHBOARD_DB",
            )
        }
        env["HOME"] = "/Users/someone"
        with (
            mock.patch.dict(os.environ, env, clear=True),
            mock.patch("subprocess.run", side_effect=exc),
            mock.patch.object(atlas_hook_guard, "fault") as fault,
        ):
            out = session_boot.ensure_dashboard()
        self.assertIsNone(out)
        fault.assert_called_once()
        self.assertEqual(fault.call_args.args[0], "session_boot")


if __name__ == "__main__":
    unittest.main()


class NoJunkAtlasDirOnBoot(unittest.TestCase):
    """SessionStart in a non-project cwd (plain dir, $HOME, ~/Downloads[/x]) must not create .atlas."""

    def setUp(self):
        self.addCleanup(os.environ.update, testenv.scrub())
        self.tmp = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.home = os.path.join(self.tmp, "home")
        os.makedirs(os.path.join(self.home, "Downloads", "x"))
        os.makedirs(os.path.join(self.tmp, "plain"))
        self.env = dict(
            os.environ,
            HOME=self.home,
            ATLAS_DB=os.path.join(self.tmp, "atlas.db"),
            ATLAS_HOOKSTATE_DIR=os.path.join(self.tmp, "hookstate"),
            ATLAS_DASHBOARD="off",
            ATLAS_COLONY="off",
        )

    def test_no_atlas_dir_created(self):
        for cwd in (
            os.path.join(self.tmp, "plain"),
            self.home,
            os.path.join(self.home, "Downloads"),
            os.path.join(self.home, "Downloads", "x"),
        ):
            subprocess.run(  # noqa: S603  # fixed argv: this interpreter + the BOOT script constant
                [sys.executable, BOOT],
                input=json.dumps({"session_id": "s1", "cwd": cwd}),
                capture_output=True,
                text=True,
                env=self.env,
            )
            self.assertFalse(os.path.exists(os.path.join(cwd, ".atlas")), cwd)


class PruneRunStateTest(unittest.TestCase):
    def test_prunes_only_stale_files_in_inbox_and_autonames(self):
        with tempfile.TemporaryDirectory() as root:
            run = os.path.join(root, ".atlas", ".run")
            old = time.time() - 8 * 86400
            paths = {}
            for sub in ("inbox", "autonames", "other"):
                os.makedirs(os.path.join(run, sub))
                for tag in ("old", "new"):
                    p = os.path.join(run, sub, tag + ".lock")
                    open(p, "w").close()
                    if tag == "old":
                        os.utime(p, (old, old))
                    paths[(sub, tag)] = p
            session_boot.prune_run_state(root)
            for (sub, tag), p in paths.items():
                gone = tag == "old" and sub != "other"
                self.assertEqual(os.path.exists(p), not gone, (sub, tag))

    def test_never_raises_without_dirs(self):
        session_boot.prune_run_state("/nonexistent-atlas-root")


class EnsureDashboardStaleInstallTest(unittest.TestCase):
    """A partial install (empty scripts/ dir, as seen in omp plugin caches) used to skip
    dashboard ensure SILENTLY - the stale :7421 daemon was then never replaced (no
    `replacing` line, no fault row). The skip must now leave a fault row."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self._saved = dict(os.environ)
        testenv.scrub()
        self.addCleanup(self._restore)

    def _restore(self):
        os.environ.clear()
        os.environ.update(self._saved)

    def test_missing_dashboard_script_records_fault_and_fails_open(self):
        env = dict(
            self._saved,
            ATLAS_HOME=self.tmp,
            ATLAS_DASHBOARD="on",
            ATLAS_DASHBOARD_PORT="7495",  # non-shared: the temp-root guard does not apply
        )
        real_isfile = os.path.isfile

        def no_dashboard(path):
            return False if str(path).endswith("atlas_dashboard.py") else real_isfile(path)

        guard = mock.MagicMock()
        with (
            mock.patch.dict(os.environ, env, clear=True),
            mock.patch("os.path.isfile", side_effect=no_dashboard),
            mock.patch.dict(sys.modules, {"atlas_hook_guard": guard}),
        ):
            self.assertIsNone(session_boot.ensure_dashboard())
        guard.fault.assert_called_once()
        self.assertIn("stale", guard.fault.call_args.args[1])
        self.assertIn("atlas_dashboard.py", guard.fault.call_args.args[1])

    def test_missing_script_with_kill_switch_stays_silent(self):
        env = dict(self._saved, ATLAS_HOME=self.tmp, ATLAS_DASHBOARD="off")
        guard = mock.MagicMock()
        with (
            mock.patch.dict(os.environ, env, clear=True),
            mock.patch.dict(sys.modules, {"atlas_hook_guard": guard}),
        ):
            self.assertIsNone(session_boot.ensure_dashboard())
        guard.fault.assert_not_called()


class LeadChannelOpenTest(unittest.TestCase):
    """SessionStart opens the lead's channel with ZERO members via the same channel-open
    CLI the dispatch path runs, with the same lead name (atlas_todo.lead_name), so the
    first dispatch joins this exact channel and the live session shows as a colony
    (harness + lead_pid recorded by atlas_todo) before any dispatch."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self._saved = dict(os.environ)
        testenv.scrub()
        os.environ.pop("ATLAS_WORKER_NAME", None)
        os.environ.pop("ATLAS_CHANNELS", None)
        self.addCleanup(self._restore)

    def _restore(self):
        os.environ.clear()
        os.environ.update(self._saved)

    @staticmethod
    def _project():
        proj = tempfile.mkdtemp()
        os.makedirs(os.path.join(proj, ".atlas", ".run"))  # an atlas project: its board already exists
        return proj

    @staticmethod
    def _rec(calls):
        def rec(argv, **kw):
            calls.append(argv)
            return mock.MagicMock(returncode=0, stdout="{}", stderr="")

        return rec

    def test_opens_lead_channel_with_zero_members_in_a_project(self):
        proj = self._project()
        calls = []
        session_boot.open_lead_channel_once(
            {"session_id": "sess123456", "cwd": proj}, run=self._rec(calls)
        )
        self.assertEqual(len(calls), 1)
        argv = calls[0]
        self.assertIn("channel-open", argv)
        self.assertEqual(argv[argv.index("--lead") + 1], "lead-sess12")
        self.assertEqual(argv[argv.index("--members") + 1], "")  # zero members
        self.assertEqual(
            os.path.realpath(argv[argv.index("--root") + 1]),
            os.path.realpath(proj),
        )

    def _pane_files(self, proj):  # the lead name may come from ATLAS_LEAD_NAME in the env
        return glob.glob(os.path.join(proj, ".atlas", ".run", "lead-pane-*.json"))

    def test_records_lead_pane_when_tmux_pane_is_set(self):
        proj = self._project()
        with mock.patch.dict(os.environ, {"TMUX_PANE": "%7"}):
            session_boot.open_lead_channel_once(
                {"session_id": "sess123456", "cwd": proj}, run=self._rec([])
            )
        (path,) = self._pane_files(proj)
        with open(path) as fh:
            self.assertEqual(json.load(fh)["pane"], "%7")

    def test_records_no_lead_pane_without_tmux_pane(self):
        proj = self._project()
        env = {k: v for k, v in os.environ.items() if k != "TMUX_PANE"}
        with mock.patch.dict(os.environ, env, clear=True):
            session_boot.open_lead_channel_once(
                {"session_id": "sess123456", "cwd": proj}, run=self._rec([])
            )
        self.assertEqual(self._pane_files(proj), [])

    def test_second_session_start_reuses_the_same_channel(self):
        proj = self._project()
        calls = []
        for _ in range(2):
            session_boot.open_lead_channel_once(
                {"session_id": "sess123456", "cwd": proj}, run=self._rec(calls)
            )
        self.assertEqual(calls[0], calls[1])  # idempotent channel-open, same name

    def test_worker_env_does_not_open_a_channel(self):
        proj = self._project()
        os.environ["ATLAS_WORKER_NAME"] = "w1"
        rec = mock.MagicMock()
        session_boot.open_lead_channel_once(
            {"session_id": "sess123456", "cwd": proj}, run=rec
        )
        rec.assert_not_called()

    def test_atlas_channels_off_skips(self):
        proj = self._project()
        os.environ["ATLAS_CHANNELS"] = "off"
        rec = mock.MagicMock()
        session_boot.open_lead_channel_once(
            {"session_id": "sess123456", "cwd": proj}, run=rec
        )
        rec.assert_not_called()

    def test_no_session_id_skips(self):
        rec = mock.MagicMock()
        session_boot.open_lead_channel_once({"cwd": self.tmp}, run=rec)
        rec.assert_not_called()

    def test_non_project_dir_never_gets_board_state(self):
        rec = mock.MagicMock()  # plain tempdir: no .git, no project markers
        session_boot.open_lead_channel_once(
            {"session_id": "sess123456", "cwd": self.tmp}, run=rec
        )
        rec.assert_not_called()

    def test_main_invokes_the_channel_open_fail_open(self):
        proj = self._project()
        with mock.patch.object(
            session_boot, "open_lead_channel_once", return_value=None
        ) as spy, mock.patch.dict(
            os.environ,
            dict(self._saved, ATLAS_DASHBOARD="off", ATLAS_COLONY="off"),
            clear=True,
        ):
            os.environ.pop("ATLAS_WORKER_NAME", None)
            code, _out = run_main_inprocess(
                {"session_id": "sess123456", "cwd": proj}, dict(os.environ)
            )
        self.assertEqual(code, 0)
        spy.assert_called_once()
