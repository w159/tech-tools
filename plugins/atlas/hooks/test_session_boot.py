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
import types
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import atlas_db  # noqa: E402
# Bind atlas_todo to the real atlas_memory lock before any test swaps in a mock: a lazy first import
# under the mock caches a fake _file_lock for the rest of the run (breaks test_dispatch_tripwire).
import atlas_todo  # noqa: E402,F401
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

    def test_boot_reap_passes_seat_pane_probe(self):
        import atlas_seats
        import atlas_todo

        root = os.path.realpath(self.tmp)
        subprocess.run(["git", "-C", root, "init", "-q"], check=True)
        with mock.patch.object(atlas_todo, "reap_channels") as reap:
            run_main_inprocess({"session_id": "s-reap", "cwd": root}, self.env)
        self.assertTrue(reap.called)
        self.assertIs(reap.call_args.kwargs.get("pane_live"), atlas_seats.pane_live)

    def test_plain_git_repo_gets_no_lock_files_or_run_dir(self):
        root = os.path.realpath(self.tmp)
        subprocess.run(["git", "-C", root, "init", "-q"], check=True)
        with mock.patch.dict(sys.modules):
            sys.modules.pop("atlas_memory", None)  # the board lock lives in the real module
            # Pinned: a due clean claims its slot with a (gitignored) stamp, and an armed gate writes a dirty
            # snapshot. test_recall_gate / test_dispatch_tripwire leak ATLAS_GATES=always into the worker.
            run_main_inprocess(
                {"session_id": "s-plain-git", "cwd": root},
                dict(self.env, ATLAS_GIT_AUTOCLEAN="off", ATLAS_GATES=""),
            )
        locks = [
            os.path.join(d, f)
            for d, _, files in os.walk(root)
            for f in files
            if f.endswith(".lock") and ".git" not in d.split(os.sep)
        ]
        self.assertEqual(locks, [])
        self.assertFalse(os.path.exists(os.path.join(root, ".atlas", ".run")))

    def _snapshot_launches(self, root, gates, docs=False):
        subprocess.run(["git", "-C", root, "init", "-q"], check=True)
        if docs:
            os.makedirs(os.path.join(root, "docs"))
        real_popen = subprocess.Popen
        launches = []

        def spy(args, *a, **kw):
            if "--snapshot" in args:
                launches.append(args)
                return mock.MagicMock()
            return real_popen(args, *a, **kw)

        with mock.patch.dict(sys.modules):
            sys.modules.pop("atlas_memory", None)
            with mock.patch.object(subprocess, "Popen", side_effect=spy):
                run_main_inprocess(
                    {"session_id": "s-snap", "cwd": root},
                    dict(self.env, ATLAS_GIT_AUTOCLEAN="off", ATLAS_GATES=gates),
                )
        return launches

    def test_dirty_snapshot_spawns_only_where_the_stop_gate_acts(self):
        root = os.path.realpath(self.tmp)
        self.assertEqual(self._snapshot_launches(root, ""), [], "unarmed scratch dir")
        for name, gates, docs in (("armed", "always", False), ("docs", "", True)):
            sub = os.path.join(root, name)
            os.makedirs(sub)
            with self.subTest(name):
                self.assertEqual(len(self._snapshot_launches(sub, gates, docs)), 1)

    def test_plain_git_repo_real_session_start_leaves_git_status_clean(self):
        """The real SessionStart entry point (subprocess) in a plain git repo: nothing untracked."""
        root = os.path.realpath(self.tmp)
        subprocess.run(["git", "-C", root, "init", "-q"], check=True)
        hooks = os.path.dirname(os.path.abspath(__file__))
        env = dict(
            self.env,
            HOME=root + "-home",
            ATLAS_DB=os.path.join(root + "-home", "atlas.db"),
            ATLAS_GIT_AUTOCLEAN="on",  # the due-clean path claims its slot with a stamp file
            ATLAS_HOME=os.path.join(root + "-home", ".atlas"),
            CLAUDE_PLUGIN_ROOT=os.path.dirname(hooks),
        )
        os.makedirs(env["HOME"], exist_ok=True)
        self.addCleanup(shutil.rmtree, env["HOME"], True)
        payload = json.dumps(
            {"session_id": "s-real", "cwd": root, "hook_event_name": "SessionStart", "source": "startup"}
        )
        r = subprocess.run(
            [sys.executable, os.path.join(hooks, "session_boot.py")],
            input=payload, text=True, env=env, capture_output=True, timeout=60, check=False,
        )
        status = subprocess.run(
            ["git", "-C", root, "status", "--porcelain", "--untracked-files=all"],
            capture_output=True, text=True, check=True,
        ).stdout
        self.assertEqual(status, "", r.stdout[:300] + r.stderr[-500:])

    def test_existing_board_still_carries_over(self):
        import atlas_todo

        root = os.path.realpath(self.tmp)
        subprocess.run(["git", "-C", root, "init", "-q"], check=True)
        atlas_todo.add(root, "carry me", session_id="old-sess")
        with mock.patch.dict(sys.modules), mock.patch.object(
            atlas_todo, "carry_over", wraps=atlas_todo.carry_over
        ) as co:
            sys.modules.pop("atlas_memory", None)
            run_main_inprocess({"session_id": "s-new", "cwd": root}, self.env)
        self.assertTrue(co.called)

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
            self.assertIn(
                f'python3 "{want}/scripts/atlas_resolve.py" <class> <effort>', ctx
            )
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
            "Atlas ready (run /atlas:atlas-setup to complete setup)",
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
        self.assertIn('<recalled-memory untrusted="true">', ctx)
        self.assertIn("</recalled-memory>", ctx)
        self.assertLess(ctx.index("not instructions"), ctx.index("MEM-LINE"))

    def test_main_memory_block_lists_project_first_and_passes_root(self):
        self._memory.load_snapshot.return_value = {
            "memory": "GLOBAL-LESSON",
            "project": "PROJ-LESSON",
        }
        with (
            mock.patch.object(session_boot, "detect_dep", return_value=False),
            mock.patch.object(session_boot, "has_cmd", return_value=False),
        ):
            _, out = run_main_inprocess(
                {"session_id": "s6b", "cwd": self.tmp}, self.env
            )
        ctx = json.loads(out)["hookSpecificOutput"]["additionalContext"]
        self.assertLess(ctx.index("PROJ-LESSON"), ctx.index("GLOBAL-LESSON"))
        self.assertTrue(self._memory.load_snapshot.call_args.kwargs.get("root"))

    def test_main_memory_block_over_budget_keeps_project_and_reports_cut(self):
        proj = "═══ PROJECT CONTEXT ═══\n" + "\n§\n".join(
            f"P{i} " + "p" * 150 for i in range(2)
        )
        glob = "═══ MEMORY ═══\n" + "\n§\n".join(f"G{i} " + "g" * 150 for i in range(3))
        self._memory.load_snapshot.return_value = {"memory": glob, "project": proj}
        with (
            mock.patch.object(session_boot, "detect_dep", return_value=False),
            mock.patch.object(session_boot, "has_cmd", return_value=False),
        ):
            _, out = run_main_inprocess(
                {"session_id": "s6c", "cwd": self.tmp}, self.env
            )
        ctx = json.loads(out)["hookSpecificOutput"]["additionalContext"]
        self.assertIn("P0 ", ctx)
        self.assertNotIn("G2 ", ctx)
        self.assertRegex(ctx, r"\+\d+ more in \.atlas/memory/MEMORY\.md")

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


class DaemonBootLineTest(MainInProcessTest):
    def test_boot_line_says_daemons_started_and_names_off_switches(self):
        with (
            mock.patch.object(session_boot, "ensure_dashboard", return_value="dashboard: http://127.0.0.1:7421/ (started)"),
            mock.patch.object(session_boot, "ensure_colony", return_value="colony: checking"),
        ):
            _, out = run_main_inprocess({"session_id": "s1", "cwd": self.tmp}, self.env)
        ctx = json.loads(out)["hookSpecificOutput"]["additionalContext"]
        self.assertIn("dashboard: http://127.0.0.1:7421/ (started)", ctx)
        self.assertIn("ATLAS_DASHBOARD=off", ctx)
        self.assertIn("ATLAS_COLONY=off", ctx)
        self.assertIn("ATLAS_HERDR_AUTOSTART=off", ctx)


class BootRoutingPresenceTest(unittest.TestCase):
    """main() hands tool_routing.boot_lines only the supported code/context tools."""

    def test_present_set_is_limited_to_supported_tools(self):
        import tool_routing

        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        seen = {}

        def record(root=None, present=None):
            seen["present"] = set(present or ())
            return []

        env = {
            "ATLAS_DB": os.path.join(tmp, "atlas.db"),
            "ATLAS_DASHBOARD": "off",
            "ATLAS_COLONY": "off",
        }
        with (
            mock.patch.object(tool_routing, "boot_lines", side_effect=record),
            mock.patch.object(tool_routing, "mcp_configured", return_value=True),
            mock.patch.object(session_boot, "has_cmd", return_value=True),
        ):
            run_main_inprocess({"session_id": "s1", "cwd": tmp}, env)
        self.assertIn("present", seen)
        self.assertLessEqual(seen["present"], {"lean-ctx", "context-mode", "claude-mem"})
        self.assertIn("lean-ctx", seen["present"])

    def test_boot_has_no_project_config_heal_entry_point(self):
        self.assertEqual([n for n in dir(session_boot) if n.startswith("heal_")], [])


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

    def _onboard(self):
        """The signal atlas-setup leaves behind: .atlas/AGENTS.md (scaffold_docs.py)."""
        os.makedirs(os.path.join(self.tmp, ".atlas"), exist_ok=True)
        with open(os.path.join(self.tmp, ".atlas", "AGENTS.md"), "w", encoding="utf-8") as fh:
            fh.write("# atlas\n")

    def test_docs_tree_in_a_non_onboarded_project_is_left_alone(self):
        """A repo that merely has docs/ never asked for Atlas scaffolding: boot
        creates no docs/* folders there (it may only keep .atlas/ run state)."""
        os.makedirs(os.path.join(self.tmp, "docs"), exist_ok=True)
        out = self._boot()
        self.assertNotIn("docs structure repaired", out)
        self.assertEqual(self._subdirs(), set())

    def test_partial_docs_tree_is_completed(self):
        self._onboard()
        os.makedirs(os.path.join(self.tmp, "docs"), exist_ok=True)
        out = self._boot()
        self.assertIn("docs structure repaired", out)
        for required in ("architecture", "decisions", "plans", "specs", "lessons"):
            self.assertIn(required, self._subdirs())

    def test_repair_is_idempotent_and_then_silent(self):
        self._onboard()
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

    def _context(self, out):
        return json.loads(out)["hookSpecificOutput"]["additionalContext"]

    def test_unscaffolded_repo_gets_one_short_scaffold_notice(self):
        """No docs/ tree and an incomplete structure used to print two notices (a 23-path list plus the SSOT
        line, 660+ chars). One line says it all: the count by group, the fix, and that nothing is auto-created."""
        ctx = self._context(self._boot())
        notices = [
            ln
            for ln in ctx.splitlines()
            if "docs SSOT absent" in ln or "project structure incomplete" in ln
        ]
        self.assertEqual(len(notices), 1, notices)
        note = notices[0]
        self.assertLessEqual(len(note), 260)
        for needed in ("/atlas:atlas-setup", "ATLAS_DOCS_REPAIR=off", "nothing is scaffolded"):
            self.assertIn(needed, note)
        self.assertRegex(note, r"missing \d+")
        self.assertFalse(os.path.isdir(os.path.join(self.tmp, "docs")))

    def test_partial_structure_still_lists_what_is_missing(self):
        """With a docs/ tree present the SSOT notice does not apply; the gap list stays as it was."""
        os.makedirs(os.path.join(self.tmp, "docs"), exist_ok=True)
        ctx = self._context(self._boot())
        self.assertNotIn("docs SSOT absent", ctx)
        self.assertIn("project structure incomplete (missing: ", ctx)
        self.assertIn(".atlas/evidence/", ctx)

    def test_kill_switch_disables_repair(self):
        self._onboard()
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
                mock.patch.object(session_boot, "_boot_herdr_wanted", return_value=True),
                # herdr down -> one ensure_server attempt; never start (or probe) the real server
                mock.patch.object(
                    __import__("atlas_herdr"),
                    "ensure_server",
                    return_value={"ok": False},
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
        base["ATLAS_DASHBOARD"] = (
            "on"  # autostart is opt-in; these tests cover the opted-in guards
        )
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
        env["ATLAS_DASHBOARD"] = "on"
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
            return (
                False if str(path).endswith("atlas_dashboard.py") else real_isfile(path)
            )

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
        os.makedirs(
            os.path.join(proj, ".atlas", ".run")
        )  # an atlas project: its board already exists
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

    def _pane_files(
        self, proj
    ):  # the lead name may come from ATLAS_LEAD_NAME in the env
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
        with (
            mock.patch.object(
                session_boot, "open_lead_channel_once", return_value=None
            ) as spy,
            mock.patch.dict(
                os.environ,
                dict(self._saved, ATLAS_DASHBOARD="off", ATLAS_COLONY="off"),
                clear=True,
            ),
        ):
            os.environ.pop("ATLAS_WORKER_NAME", None)
            code, _out = run_main_inprocess(
                {"session_id": "sess123456", "cwd": proj}, dict(os.environ)
            )
        self.assertEqual(code, 0)
        spy.assert_called_once()


GIT_ENV = {
    "GIT_AUTHOR_NAME": "t",
    "GIT_AUTHOR_EMAIL": "t@t",
    "GIT_COMMITTER_NAME": "t",
    "GIT_COMMITTER_EMAIL": "t@t",
}


def _git(cwd, *args):
    return subprocess.run(
        ["git", "-C", str(cwd), *args],
        capture_output=True,
        text=True,
        check=True,
        env=dict(os.environ, **GIT_ENV),
    ).stdout.strip()


class GitHygieneBootTest(unittest.TestCase):
    """Boot starts a detached LOCAL clean when the stamp is stale, runs no git itself, and says one line."""

    def setUp(self):
        self.repo = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.repo, True)
        _git(self.repo, "init", "-q", "-b", "main")
        _git(self.repo, "commit", "-q", "--allow-empty", "-m", "i")
        self.stamp = os.path.join(self.repo, ".atlas", ".run", "git-clean-stamp.json")
        env = {"ATLAS_HOME": tempfile.mkdtemp(), "ATLAS_GIT_AUTOCLEAN": "on"}
        patcher = mock.patch.dict(os.environ, env)
        patcher.start()
        self.addCleanup(patcher.stop)
        for k in list(os.environ):
            if k.startswith("ATLAS_GIT_") and k != "ATLAS_GIT_AUTOCLEAN":
                del os.environ[k]

    def _stamp(self, **kw):
        os.makedirs(os.path.dirname(self.stamp), exist_ok=True)
        with open(self.stamp, "w", encoding="utf-8") as fh:
            json.dump(kw, fh)

    def _boot(self, cwd=None):
        with mock.patch("subprocess.Popen") as popen:
            line = session_boot.git_hygiene_boot(cwd or self.repo)
        return line, popen

    def test_missing_stamp_spawns_a_detached_local_clean(self):
        line, popen = self._boot()
        self.assertIsNone(line)
        popen.assert_called_once()
        argv = popen.call_args.args[0]
        self.assertEqual(argv[0], sys.executable)
        self.assertTrue(argv[1].endswith(os.path.join("scripts", "atlas_git.py")))
        self.assertEqual(argv[2:], ["--root", self.repo, "clean"])
        self.assertNotIn("--remote", argv)
        kw = popen.call_args.kwargs
        self.assertTrue(kw["start_new_session"])
        for stream in ("stdin", "stdout", "stderr"):
            self.assertEqual(kw[stream], subprocess.DEVNULL)
        with open(self.stamp, encoding="utf-8") as fh:  # slot claimed: a burst of sessions spawns one
            self.assertLess(abs(json.load(fh)["at"] - time.time()), 30)
        self.assertEqual(self._boot()[1].call_count, 0)

    def test_stale_stamp_spawns_fresh_stamp_does_not(self):
        self._stamp(at=int(time.time()) - 7 * 3600)
        self.assertEqual(self._boot()[1].call_count, 1)
        self._stamp(at=int(time.time()) - 3600)
        self.assertEqual(self._boot()[1].call_count, 0)

    def test_stale_threshold_follows_the_policy(self):
        self._stamp(at=int(time.time()) - 3600)
        with mock.patch.dict(os.environ, {"ATLAS_GIT_AUTO_CLEAN_HOURS": "1"}):
            self.assertEqual(self._boot()[1].call_count, 1)

    def test_kill_switches_and_non_repos_never_spawn(self):
        for env in (
            {"ATLAS_GIT_AUTOCLEAN": "off"},
            {"ATLAS_GIT_GUARD": "off"},
            {"ATLAS_GIT_CLEANUP_LOCAL": "off"},
            {"ATLAS_GIT_AUTO_CLEAN_HOURS": "0"},
        ):
            with self.subTest(env=env), mock.patch.dict(os.environ, env):
                self.assertEqual(self._boot()[1].call_count, 0)
        plain = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, plain, True)
        self.assertEqual(self._boot(plain)[1].call_count, 0)

    def test_linked_worktree_cleans_the_main_root(self):
        wt = os.path.join(os.path.dirname(self.repo), os.path.basename(self.repo) + "-wt")
        self.addCleanup(shutil.rmtree, wt, True)
        _git(self.repo, "worktree", "add", "-q", wt, "-b", "worker/x")
        self.assertEqual(session_boot._git_main_root(wt), self.repo)
        self.assertEqual(session_boot._git_main_root(os.path.join(wt, "sub")), self.repo)
        _line, popen = self._boot(wt)
        self.assertEqual(popen.call_args.args[0][3], self.repo)

    def test_boot_line_only_when_at_the_cap_and_without_running_git(self):
        self._stamp(at=int(time.time()), worktrees=1, max_worktrees=4, branches=3, max_branches=8)
        with mock.patch("subprocess.run", side_effect=AssertionError("git on the boot path")):
            self.assertIsNone(session_boot.git_hygiene_boot(self.repo))
            self._stamp(at=int(time.time()), worktrees=4, max_worktrees=4, branches=9, max_branches=8)
            line = session_boot.git_hygiene_boot(self.repo)
        self.assertIn("4/4 worktrees", line)
        self.assertIn("9/8 branches", line)
        self.assertIn("atlas_git.py status", line)
        self.assertEqual(line.count("\n"), 0)

    def test_corrupt_stamp_is_treated_as_missing(self):
        os.makedirs(os.path.dirname(self.stamp))
        with open(self.stamp, "w", encoding="utf-8") as fh:
            fh.write("{nope")
        line, popen = self._boot()
        self.assertIsNone(line)
        self.assertEqual(popen.call_count, 1)

    def test_clean_writes_the_counts_boot_reads(self):
        import atlas_git

        self._stamp(at=0)
        atlas_git.clean(self.repo)
        with open(self.stamp, encoding="utf-8") as fh:
            got = json.load(fh)
        self.assertEqual((got["worktrees"], got["branches"]), (0, 0))
        self.assertEqual((got["max_worktrees"], got["max_branches"]), (4, 8))


class OptionalBootTextTest(unittest.TestCase):
    """atlas_security.boot_line / atlas_analytics.boot_notice join boot when present and vanish when not."""

    # the in-process boot harness (isolated env, mocked curator/memory), without re-running its tests
    setUp = MainInProcessTest.setUp
    tearDown = MainInProcessTest.tearDown
    _restore_environ = MainInProcessTest._restore_environ

    def _fake(self, name, func, value):
        mod = types.ModuleType(name)
        if func:
            setattr(mod, func, value)
        return mod

    def _boot(self, modules):
        patch = {"atlas_security": None, "atlas_analytics": None, **modules}
        with (
            mock.patch.dict(sys.modules, patch),
            mock.patch.object(session_boot, "git_hygiene_boot", return_value=None),
        ):
            code, out = run_main_inprocess({"session_id": "s1", "cwd": self.tmp}, self.env)
        self.assertEqual(code, 0)
        return json.loads(out)

    def test_absent_modules_change_nothing(self):
        data = self._boot({})  # None in sys.modules makes the import raise ImportError
        self.assertEqual(data["hookSpecificOutput"]["hookEventName"], "SessionStart")
        self.assertNotIn("\n", data["systemMessage"])

    def test_module_without_the_function_is_skipped(self):
        data = self._boot(
            {"atlas_security": self._fake("atlas_security", None, None), "atlas_analytics": self._fake("atlas_analytics", None, None)}
        )
        self.assertIn("Atlas: orchestrator posture", data["hookSpecificOutput"]["additionalContext"])

    def test_raising_module_is_fail_open(self):
        def boom(*a):
            raise RuntimeError("down")

        data = self._boot({"atlas_security": self._fake("atlas_security", "boot_line", boom)})
        self.assertIn("Atlas: orchestrator posture", data["hookSpecificOutput"]["additionalContext"])

    def test_security_line_goes_into_context_only(self):
        seen = []
        data = self._boot(
            {"atlas_security": self._fake("atlas_security", "boot_line", lambda root: seen.append(root) or "SEC-LINE-1")}
        )
        self.assertIn("SEC-LINE-1", data["hookSpecificOutput"]["additionalContext"])
        self.assertNotIn("SEC-LINE-1", data["systemMessage"])
        self.assertEqual(seen, [self.tmp])

    def test_analytics_notice_goes_into_context_and_system_message(self):
        data = self._boot({"atlas_analytics": self._fake("atlas_analytics", "boot_notice", lambda: "NOTICE-TEXT")})
        self.assertIn("NOTICE-TEXT", data["hookSpecificOutput"]["additionalContext"])
        self.assertIn("NOTICE-TEXT", data["systemMessage"])
        self.assertTrue(data["systemMessage"].startswith("Atlas ready"))

    def test_non_string_and_empty_results_are_ignored(self):
        data = self._boot(
            {
                "atlas_security": self._fake("atlas_security", "boot_line", lambda root: ["x"]),
                "atlas_analytics": self._fake("atlas_analytics", "boot_notice", lambda: "  "),
            }
        )
        self.assertNotIn("\n", data["systemMessage"])

    def test_hygiene_line_reaches_the_context_and_a_failure_does_not_break_boot(self):
        with (
            mock.patch.dict(sys.modules, {"atlas_security": None, "atlas_analytics": None}),
            mock.patch.object(session_boot, "git_hygiene_boot", return_value="git hygiene: HYG-LINE"),
        ):
            _, out = run_main_inprocess({"session_id": "s1", "cwd": self.tmp}, self.env)
        self.assertIn("HYG-LINE", json.loads(out)["hookSpecificOutput"]["additionalContext"])
        with (
            mock.patch.dict(sys.modules, {"atlas_security": None, "atlas_analytics": None}),
            mock.patch.object(session_boot, "git_hygiene_boot", side_effect=RuntimeError("x")),
        ):
            code, out = run_main_inprocess({"session_id": "s1", "cwd": self.tmp}, self.env)
        self.assertEqual(code, 0)
        self.assertIn("Atlas: orchestrator posture", out)


class BootCoreSurvivorTests(unittest.TestCase):
    """session_boot_core helpers pinned against mutation survivors."""

    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.home, ignore_errors=True)

    def _gate(self, env_sock):
        import pathlib

        import atlas_herdr
        import atlas_rig
        import atlas_seats

        env = {"HOME": self.home}
        if env_sock:
            env["HERDR_SOCKET_PATH"] = env_sock
        with (
            mock.patch.dict(os.environ, env),
            mock.patch.dict(os.environ, {"ATLAS_SEAT_BACKEND": ""}),
            mock.patch.object(atlas_rig, "_bin", return_value=None),
            mock.patch.object(atlas_rig, "_rigs", return_value=[]),
            mock.patch.object(atlas_seats, "_node_ok_cached", return_value=False),
            mock.patch.object(atlas_herdr, "_server_up", return_value=True),
            mock.patch.object(atlas_herdr, "PLUGIN_ROOT", pathlib.Path(self.home) / "none"),
        ):
            if not env_sock:
                os.environ.pop("HERDR_SOCKET_PATH", None)
            return session_boot._boot_herdr_wanted(self.home)

    def test_herdr_gate_true_when_env_socket_exists_and_server_answers(self):
        sock = os.path.join(self.home, "custom.sock")
        open(sock, "w").close()
        self.assertIs(self._gate(sock), True)

    def test_herdr_gate_false_when_env_socket_missing_even_if_default_exists(self):
        default = os.path.join(self.home, ".config", "herdr")
        os.makedirs(default)
        open(os.path.join(default, "herdr.sock"), "w").close()
        self.assertIs(self._gate(os.path.join(self.home, "absent.sock")), False)

    def test_herdr_gate_uses_default_socket_under_home_when_env_unset(self):
        default = os.path.join(self.home, ".config", "herdr")
        os.makedirs(default)
        open(os.path.join(default, "herdr.sock"), "w").close()
        self.assertIs(self._gate(None), True)

    def test_header_template_falls_back_on_empty_or_non_string(self):
        for bad in ("", None, 5, ["x"]):
            with self.subTest(bad=bad):
                with mock.patch.object(
                    session_boot, "_contract", return_value={"headerTemplate": bad}
                ):
                    self.assertEqual(
                        session_boot.header_template(), session_boot._FALLBACK_TEMPLATE
                    )
        with mock.patch.object(
            session_boot, "_contract", return_value={"headerTemplate": "T {x}"}
        ):
            self.assertEqual(session_boot.header_template(), "T {x}")

    def test_plugin_enabled_is_false_not_none_on_error(self):
        import tool_routing

        with mock.patch.object(
            tool_routing, "plugin_enabled", side_effect=RuntimeError("boom")
        ):
            self.assertIs(session_boot.plugin_enabled("x"), False)

    def test_atlas_home_prefers_env_else_dot_atlas_under_home(self):
        with mock.patch.dict(os.environ, {"ATLAS_HOME": "/elsewhere"}):
            self.assertEqual(session_boot._atlas_home(), "/elsewhere")
        with mock.patch.dict(os.environ, {"HOME": self.home}):
            os.environ.pop("ATLAS_HOME", None)
            self.assertEqual(
                session_boot._atlas_home(), os.path.join(self.home, ".atlas")
            )

    def _notice(self, published, mkt=None):
        own = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(session_boot.__file__))),
            ".claude-plugin",
            "plugin.json",
        )
        with open(own) as f:
            installed = json.load(f)["version"]
        doc = {"published": published}
        if mkt is not None:
            doc["marketplace"] = mkt
        with open(os.path.join(self.home, "update-check.json"), "w") as f:
            json.dump(doc, f)
        with open(os.path.join(self.home, "update-check-state.json"), "w") as f:
            json.dump({"last_start": 1_000_000.0}, f)
        with mock.patch.dict(
            os.environ, {"ATLAS_HOME": self.home, "ATLAS_UPDATE_CHECK": "on"}
        ):
            return session_boot.update_notice(now=1_000_001.0, popen=mock.Mock()), installed

    def test_update_notice_shows_newer_version_with_marketplace(self):
        got, installed = self._notice("999.0.0", "my-mkt")
        self.assertEqual(
            got,
            f"atlas 999.0.0 is published (installed {installed}): "
            "claude plugin marketplace update my-mkt && claude plugin update atlas@my-mkt",
        )

    def test_update_notice_bad_marketplace_falls_back_to_tech_tools(self):
        got, _ = self._notice("999.0.0", "bad mkt;rm")
        self.assertIn("marketplace update tech-tools", got)

    def test_update_notice_rejects_malformed_published_version(self):
        for bad in ("abc", "1.2.3.4", "999.0.0; rm", ""):
            with self.subTest(bad=bad):
                got, _ = self._notice(bad)
                self.assertIsNone(got)

    def test_update_notice_none_when_not_newer(self):
        _, installed = self._notice("0.0.1")
        got, _ = self._notice(installed)
        self.assertIsNone(got)
