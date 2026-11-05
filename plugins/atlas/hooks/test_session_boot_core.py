"""session_boot_core unit contracts: the dashboard/colony subprocess budgets, the colony cache
windows, boot-log placement, the output-style contract, dirty-map and language scans, the session
context lag, git root lookup and the session-start telemetry gate. Complements test_session_boot.py,
test_session_boot_colony.py and test_session_boot_update_notice.py."""

import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(
    0,
    _iso_os.path.join(
        _iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"
    ),
)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ["ATLAS_DASHBOARD"] = "off"
import session_boot  # noqa: E402

NOW = 1_800_000_000.0
UP = {"healthy": True, "herdr_server": True, "url": "http://127.0.0.1:7317"}
DOWN = {"healthy": False, "herdr_server": True, "url": "http://127.0.0.1:7317"}


class EnsureDashboardBudgetTest(unittest.TestCase):
    def test_ensure_call_gets_a_fifteen_second_budget_and_reports_the_state(self):
        for already, state in ((True, "ready"), (False, "started")):
            res = subprocess.CompletedProcess(
                [], 0, json.dumps({"url": "http://127.0.0.1:7421", "already_running": already}), ""
            )
            with mock.patch.dict(
                os.environ, {"ATLAS_DASHBOARD": "on", "ATLAS_DASHBOARD_PORT": "7500"}
            ), mock.patch("subprocess.run", return_value=res) as run:
                self.assertEqual(
                    session_boot.ensure_dashboard(),
                    f"dashboard: http://127.0.0.1:7421 ({state})",
                )
            argv = run.call_args[0][0]
            self.assertEqual(argv[0], sys.executable)
            self.assertEqual(os.path.basename(argv[1]), "atlas_dashboard.py")
            self.assertEqual(argv[2], "ensure")
            self.assertEqual(run.call_args[1]["timeout"], 15)

    def test_failed_ensure_is_silent(self):
        res = subprocess.CompletedProcess([], 1, "", "boom")
        with mock.patch.dict(
            os.environ, {"ATLAS_DASHBOARD": "on", "ATLAS_DASHBOARD_PORT": "7500"}
        ), mock.patch("subprocess.run", return_value=res):
            self.assertIsNone(session_boot.ensure_dashboard())


class BootLogTest(unittest.TestCase):
    def test_log_lands_under_atlas_home_and_collapses_newlines(self):
        home = tempfile.mkdtemp()
        other = tempfile.mkdtemp()
        with mock.patch.dict(os.environ, {"ATLAS_HOME": home, "HOME": other}):
            session_boot._boot_log("stage-x", "line one\nline two " + "z" * 400)
        with open(os.path.join(home, "colony-boot.log")) as f:
            text = f.read()
        self.assertFalse(os.path.exists(os.path.join(other, ".atlas", "colony-boot.log")))
        self.assertRegex(text, r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\S* ensure_colony: stage-x line one line two z+\n$")
        self.assertEqual(len(text.split(" ensure_colony: stage-x ", 1)[1].rstrip("\n")), 300)

    def test_without_atlas_home_it_uses_dot_atlas_under_home(self):
        home = tempfile.mkdtemp()
        env = {k: v for k, v in os.environ.items() if k != "ATLAS_HOME"}
        env["HOME"] = home
        with mock.patch.dict(os.environ, env, clear=True):
            session_boot._boot_log("s", "r")
        self.assertTrue(os.path.isfile(os.path.join(home, ".atlas", "colony-boot.log")))


class ColonyCacheWindowTest(unittest.TestCase):
    """ensure_colony reads the cached `atlas_herdr status`: healthy <30 s as-is, healthy <600 s used
    with a detached refresh, unhealthy <60 s reused; anything older is re-probed."""

    def setUp(self):
        self.home = tempfile.mkdtemp()
        env = mock.patch.dict(os.environ, {"ATLAS_HOME": self.home, "ATLAS_COLONY": "on"})
        env.start()
        self.addCleanup(env.stop)
        self.popen = []
        self.runs = []
        self.health = set()

    def seed(self, status):
        with open(os.path.join(self.home, "herdr-status-cache.json"), "w") as f:
            json.dump(status, f)

    def boot(self, age):
        def run(argv, *a, **k):
            self.runs.append((argv, k))
            out = "" if argv[0] == "ps" else "{}"
            return subprocess.CompletedProcess(argv, 0, out, "")

        def popen(argv, *a, **k):
            self.popen.append((argv, k))

        def urlopen(url, timeout=None):
            self.url_timeouts.append(timeout)
            if url.removesuffix("/api/health") not in self.health:
                raise OSError("down")
            m = mock.MagicMock()
            m.__enter__.return_value.status = 200
            return m

        self.url_timeouts = []
        with mock.patch("subprocess.run", side_effect=run), mock.patch(
            "subprocess.Popen", side_effect=popen
        ), mock.patch("urllib.request.urlopen", side_effect=urlopen), mock.patch.object(
            session_boot, "_boot_herdr_wanted", return_value=True
        ), mock.patch.object(
            __import__("atlas_herdr"), "ensure_server", return_value={"ok": True}
        ), mock.patch("time.time", return_value=NOW), mock.patch(
            "os.path.getmtime", return_value=NOW - age
        ):
            return session_boot.ensure_colony()

    def statuses(self):
        return [a for a, _ in self.runs if a[-1] == "status"]

    def test_healthy_cache_under_thirty_seconds_needs_no_refresh(self):
        self.seed(UP)
        self.assertEqual(self.boot(29.9), "colony ready at http://127.0.0.1:7317")
        self.assertEqual(self.popen, [])

    def test_healthy_cache_from_thirty_seconds_refreshes_detached(self):
        self.seed(UP)
        self.assertEqual(self.boot(30), "colony ready at http://127.0.0.1:7317")
        self.assertEqual(len(self.popen), 1)
        argv, kw = self.popen[0]
        self.assertEqual(argv[:3], ["sh", "-c", '"$0" "$1" status >"$2.tmp" && mv "$2.tmp" "$2"'])
        self.assertEqual(argv[3], sys.executable)
        self.assertEqual(argv[-1], os.path.join(self.home, "herdr-status-cache.json"))
        self.assertIs(kw["start_new_session"], True)
        self.assertIs(kw["stdin"], subprocess.DEVNULL)
        self.assertIs(kw["stdout"], subprocess.DEVNULL)
        self.assertIs(kw["stderr"], subprocess.DEVNULL)

    def test_healthy_cache_is_trusted_up_to_ten_minutes(self):
        self.seed(UP)
        self.assertEqual(self.boot(599.9), "colony ready at http://127.0.0.1:7317")
        self.assertEqual(self.statuses(), [])

    def test_healthy_cache_at_ten_minutes_is_reprobed_not_trusted(self):
        self.seed(UP)
        self.boot(600)
        self.assertEqual(len(self.statuses()), 1)

    def test_unhealthy_cache_is_reused_under_a_minute(self):
        self.seed(DOWN)
        self.boot(59.9)
        self.assertEqual(self.statuses(), [])

    def test_unhealthy_cache_from_a_minute_is_reprobed(self):
        self.seed(DOWN)
        self.boot(60)
        self.assertEqual(len(self.statuses()), 1)

    def test_status_probe_gets_a_four_second_budget(self):
        self.seed(DOWN)
        self.boot(90)
        (argv, kw), = [r for r in self.runs if r[0][-1] == "status"]
        self.assertEqual(kw["timeout"], 4)

    def test_health_probe_of_a_stack_waits_300_ms_per_port(self):
        self.seed(DOWN)
        self.boot(10)
        self.assertTrue(self.url_timeouts)
        self.assertEqual(set(self.url_timeouts), {0.3})


class StatusContractLinesTest(unittest.TestCase):
    def test_no_override_for_empty_or_atlas_style(self):
        for style in ("", None, "   ", session_boot.ATLAS_OUTPUT_STYLE, f"  {session_boot.ATLAS_OUTPUT_STYLE} "):
            lines = session_boot.status_contract_lines(style)
            self.assertEqual(len(lines), 1, style)
            self.assertNotIn("STYLE OVERRIDE", lines[0])
            self.assertIn(session_boot.header_template(), lines[0])

    def test_other_style_adds_the_override_hedge(self):
        lines = session_boot.status_contract_lines("concise")
        self.assertIn("STYLE OVERRIDE: outputStyle is 'concise'", "\n".join(lines))
        self.assertIn("LEDGER", "\n".join(lines))
        self.assertIn(session_boot.header_template(), "\n".join(lines))


def _git(root, *args):
    subprocess.run(["git", "-C", root, *args], check=True, capture_output=True)


class DirtyMapTest(unittest.TestCase):
    def test_git_status_gets_a_ten_second_budget_and_maps_paths_to_hashes(self):
        root = tempfile.mkdtemp()
        out = b" M src/a.py\0?? new.txt\0"
        res = subprocess.CompletedProcess([], 0, out, b"")
        with open(os.path.join(root, "new.txt"), "wb") as f:
            f.write(b"hello")
        with mock.patch("subprocess.run", return_value=res) as run:
            got = session_boot.dirty_map(root)
        self.assertEqual(run.call_args[1]["timeout"], 10)
        import hashlib

        self.assertEqual(got["new.txt"], hashlib.sha256(b"hello").hexdigest())
        self.assertEqual(got["src/a.py"], session_boot._DELETED)

    def test_not_a_work_tree_is_none(self):
        self.assertIsNone(session_boot.dirty_map(tempfile.mkdtemp()))


class DetectLanguagesTest(unittest.TestCase):
    def _touch(self, root, *rel):
        path = os.path.join(root, *rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, "w").close()

    def test_counts_by_extension_ranked_and_capped(self):
        root = tempfile.mkdtemp()
        for i in range(3):
            self._touch(root, "src", f"m{i}.py")
        for i in range(2):
            self._touch(root, f"s{i}.go")
        self._touch(root, "a.rs")
        self._touch(root, "a.java")
        self._touch(root, "README.md")
        self.assertEqual(session_boot._detect_languages(root), ["python", "go", "rust"])
        self.assertEqual(session_boot._detect_languages(root, cap=1), ["python"])

    def test_vendored_and_hidden_virtualenv_dirs_are_skipped(self):
        root = tempfile.mkdtemp()
        self._touch(root, "ok.rb")
        for d in ("node_modules", ".git", "vendor", "dist", "build", "target", "__pycache__", ".venv-x"):
            for i in range(4):
                self._touch(root, d, f"f{i}.py")
        self.assertEqual(session_boot._detect_languages(root), ["ruby"])

    def test_other_directories_are_walked(self):
        root = tempfile.mkdtemp()
        self._touch(root, "lib", "deep", "x.cs")
        self.assertEqual(session_boot._detect_languages(root), ["csharp"])


class SessionContextLagTest(unittest.TestCase):
    def _ctx(self, cursor, size):
        import atlas_db

        tmp = tempfile.mkdtemp()
        conn = atlas_db.connect(os.path.join(tmp, "atlas.db"))
        atlas_db.init(conn)
        pid = atlas_db.register_project(conn, tmp)
        conn.execute(
            "INSERT INTO session_logs(session_id, project_id, cwd, started_at, cursor_bytes, file_size) "
            "VALUES (?,?,?,?,?,?)",
            ("s-lag", pid, tmp, NOW, cursor, size),
        )
        conn.commit()
        try:
            return session_boot._atlas_session_context(conn, tmp)
        finally:
            conn.close()

    def test_lag_is_zero_unless_the_file_outgrew_the_cursor(self):
        self.assertEqual(self._ctx(2048, 2048)["lag_kb"], 0)
        self.assertEqual(self._ctx(4096, 100)["lag_kb"], 0)
        self.assertEqual(self._ctx(None, 5000)["lag_kb"], 0)
        self.assertEqual(self._ctx(0, 5000)["lag_kb"], 0)
        self.assertEqual(self._ctx(100, 100 + 3 * 1024)["lag_kb"], 3)

    def test_empty_context_defaults(self):
        ctx = self._ctx(None, None)
        self.assertEqual(
            (ctx["prompt"], ctx["last_file"], ctx["unverified"]), (None, None, 0)
        )


class GitMainRootTest(unittest.TestCase):
    def test_outside_any_repo_is_none(self):
        self.assertIsNone(session_boot._git_main_root(tempfile.mkdtemp()))

    def test_repo_root_is_found_from_a_subdirectory(self):
        root = os.path.realpath(tempfile.mkdtemp())
        _git(root, "init", "-q")
        sub = os.path.join(root, "a", "b")
        os.makedirs(sub)
        self.assertEqual(session_boot._git_main_root(sub), root)


    def test_a_gitfile_that_is_not_a_linked_worktree_is_its_own_root(self):
        for text in ("gitdir: ../.git/modules/sub\n", "not a gitdir line", ""):
            root = os.path.realpath(tempfile.mkdtemp())
            with open(os.path.join(root, ".git"), "w") as f:
                f.write(text)
            sub = os.path.join(root, "pkg")
            os.makedirs(sub)
            self.assertEqual(session_boot._git_main_root(sub), root, text)


class ColonyStackUrlTest(unittest.TestCase):
    def _url(self, status, data=None):
        def urlopen(url, timeout=None):
            m = mock.MagicMock()
            m.__enter__.return_value.status = status
            return m

        ps = subprocess.CompletedProcess([], 0, "/usr/bin/other\n", "")
        with mock.patch("urllib.request.urlopen", side_effect=urlopen), mock.patch(
            "subprocess.run", return_value=ps
        ):
            return session_boot._colony_stack_url(data or {"url": "http://127.0.0.1:7317"})

    def test_only_a_200_health_answer_counts(self):
        self.assertEqual(self._url(200), "http://127.0.0.1:7317")
        for status in (201, 204, 404, 500, 503):
            self.assertIsNone(self._url(status), status)

    def test_upstream_flag_without_an_answering_port_is_unknown_port(self):
        self.assertEqual(self._url(500, {"upstream_plugin_on_port": True}), "")


class ResumeBlockConnectionTest(unittest.TestCase):
    def test_the_atlas_connection_is_closed_even_when_nothing_resumes(self):
        import atlas_db

        conn = mock.MagicMock()
        conn.execute.return_value.fetchone.return_value = None
        with mock.patch.object(atlas_db, "connect", return_value=conn), mock.patch.object(
            atlas_db, "init"
        ), mock.patch.object(
            session_boot, "_atlas_session_context", return_value=None
        ), mock.patch.object(session_boot, "_claude_mem_summary", return_value=None):
            self.assertIsNone(session_boot.resume_block("/repo/x"))
        conn.close.assert_called_once_with()

    def test_a_failed_connect_is_silent(self):
        import atlas_db

        with mock.patch.object(
            atlas_db, "connect", side_effect=RuntimeError("locked")
        ), mock.patch.object(session_boot, "_claude_mem_summary", return_value=None):
            self.assertIsNone(session_boot.resume_block("/repo/x"))


class AnalyticsSessionStartTest(unittest.TestCase):
    def test_compaction_is_not_a_new_session(self):
        import atlas_analytics

        with mock.patch.object(atlas_analytics, "on_session_start") as hook:
            session_boot._analytics_session_start({"source": "compact"})
        hook.assert_not_called()

    def test_every_other_source_counts_the_session(self):
        import atlas_analytics

        for source in ("startup", "resume", "clear", None):
            payload = {"source": source, "session_id": "s"}
            with mock.patch.object(atlas_analytics, "on_session_start") as hook:
                session_boot._analytics_session_start(payload)
            hook.assert_called_once_with(payload)

    def test_a_failing_counter_never_raises(self):
        import atlas_analytics

        with mock.patch.object(atlas_analytics, "on_session_start", side_effect=RuntimeError):
            session_boot._analytics_session_start({"source": "startup"})


if __name__ == "__main__":
    unittest.main()
