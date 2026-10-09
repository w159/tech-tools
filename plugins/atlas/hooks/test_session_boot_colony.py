"""session_boot.ensure_colony: only probes the one upstream herdr-web-ui on 7317 (cached status) and, when it is
down while herdr runs, starts `atlas_herdr.py ensure` detached (which holds the flock): never a second instance.
Fail-open, ATLAS_COLONY=off honoured. atlas_herdr.py is never run: subprocess.run/Popen are faked."""

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
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ["ATLAS_DASHBOARD"] = "off"
import session_boot  # noqa: E402

UP = {"healthy": True, "herdr_server": True, "url": "http://127.0.0.1:7317"}
DOWN = {"healthy": False, "herdr_server": True, "url": "http://127.0.0.1:7317"}
# the verifier's exact scenario: upstream stack up on :7317, status says web_ui_down on 17317
VERIFIER = {
    "healthy": False,
    "state": "web_ui_down",
    "herdr_server": True,
    "upstream_plugin_on_port": True,
    "url": "http://127.0.0.1:17317",
}


class ColonyBootTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        self.env = mock.patch.dict(
            os.environ, {"ATLAS_HOME": self.home, "ATLAS_COLONY": "on"}
        )
        self.env.start()
        self.addCleanup(self.env.stop)
        self.popen = []  # every spawn: stands in for the stub bun / launcher
        self.runs = []
        self.ps = "/usr/bin/some-other-process\n"
        self.health = set()  # URLs whose /api/health answers 200

    def seed(self, status, age=0):
        cache = os.path.join(self.home, "herdr-status-cache.json")
        with open(cache, "w") as f:
            json.dump(status, f)
        t = time.time() - age
        os.utime(cache, (t, t))

    def boot(self):
        def run(argv, *a, **k):
            self.runs.append(argv)
            out = self.ps if argv[0] == "ps" else "{}"
            return subprocess.CompletedProcess(argv, 0, out, "")

        def urlopen(url, timeout=None):
            if url.removesuffix("/api/health") not in self.health:
                raise OSError("down")
            m = mock.MagicMock()
            m.__enter__.return_value.status = 200
            return m

        with (
            mock.patch("subprocess.run", side_effect=run),
            mock.patch(
                "subprocess.Popen", side_effect=lambda *a, **k: self.popen.append(a[0])
            ),
            mock.patch("urllib.request.urlopen", side_effect=urlopen),
        ):
            return session_boot.ensure_colony()

    def ensures(self):
        return [p for p in self.popen if p[-1] == "ensure"]

    def test_cold_cache_refreshes_detached_and_reports_checking(self):
        self.assertEqual(self.boot(), "colony: checking")
        self.assertEqual(len(self.popen), 1)
        self.assertEqual(self.ensures(), [])  # a status refresh, never an ensure
        self.assertEqual(self.runs, [])  # no probe on the boot path

    def test_warm_healthy_cache_reports_up_without_spawning(self):
        self.seed(UP, age=5)
        self.assertEqual(self.boot(), "colony ready at http://127.0.0.1:7317")
        self.assertEqual(self.popen, [])

    def test_stale_healthy_cache_revalidates_detached_only(self):
        self.seed(UP, age=120)
        self.assertEqual(self.boot(), "colony ready at http://127.0.0.1:7317")
        self.assertEqual(len(self.popen), 1)
        self.assertEqual(self.ensures(), [])

    def test_unhealthy_negative_cache_herdr_down_skips_everything(self):
        self.seed({**DOWN, "herdr_server": False}, age=30)
        self.assertIsNone(self.boot())
        self.assertEqual(self.popen + self.runs, [])

    def test_herdr_down_fresh_probe_no_spawn(self):
        self.seed({**DOWN, "herdr_server": False}, age=300)
        self.assertIsNone(self.boot())
        self.assertEqual(self.ensures(), [])

    def test_unhealthy_cache_older_than_60s_is_reprobed(self):
        self.seed(DOWN, age=90)
        self.assertIsNone(self.boot())  # fake status says {}: herdr not running
        self.assertEqual(self.runs[0][-1], "status")
        self.assertEqual(self.ensures(), [])

    def test_no_stack_and_herdr_up_one_guarded_ensure(self):
        self.seed(DOWN, age=10)
        msg = self.boot()
        self.assertTrue(msg.startswith("colony: starting the herdr web UI"), msg)
        self.assertEqual(len(self.popen), 1)
        self.assertEqual(self.popen[0][2], "ensure")
        self.assertTrue(self.popen[0][1].endswith("atlas_herdr.py"))

    def test_upstream_flag_without_answering_port_never_spawns_or_invents_url(self):
        self.seed({**DOWN, "upstream_plugin_on_port": True}, age=10)
        self.assertEqual(self.boot(), "colony: herdr web UI running (port unknown)")
        self.assertEqual(self.popen, [])

    def test_ps_match_never_spawns(self):
        for line in (
            "bun /x/herdr-web-ui/server/managed.ts",
            "bun server/supervisor.ts",
            "bun server/index.ts",
        ):
            self.popen.clear()
            self.ps = "/bin/zsh\n" + line + "\n"
            self.seed(DOWN, age=10)
            self.assertEqual(
                self.boot(), "colony: herdr web UI running (port unknown)", line
            )
            self.assertEqual(self.popen, [], line)

    def test_ps_match_with_listener_on_7317_reports_7317(self):
        self.ps = "bun /p/herdr-web-ui/server/managed.ts\n"
        self.health = {"http://127.0.0.1:7317"}
        self.seed({**DOWN, "url": "http://127.0.0.1:17317"}, age=10)
        self.assertEqual(self.boot(), "colony: http://127.0.0.1:7317 (ready)")
        self.assertEqual(self.popen, [])

    def test_health_listener_only_reports_that_url(self):
        # the only answering listener is a health stub on an arbitrary free port == status url
        self.health = {"http://127.0.0.1:47317"}
        self.seed({**DOWN, "url": "http://127.0.0.1:47317"}, age=10)
        self.assertEqual(self.boot(), "colony: http://127.0.0.1:47317 (ready)")
        self.assertEqual(self.popen, [])

    def test_health_listener_found_by_port_probe(self):
        self.health = {"http://127.0.0.1:27317"}
        self.seed(DOWN, age=10)
        self.assertEqual(self.boot(), "colony: http://127.0.0.1:27317 (ready)")
        self.assertEqual(self.popen, [])

    def test_verifier_scenario_reports_real_port_and_spawns_nothing(self):
        # status web_ui_down + upstream_plugin_on_port, url :17317 (dead), upstream stack alive on :7317
        self.ps = "bun /p/herdr-web-ui/server/managed.ts\n"
        self.health = {"http://127.0.0.1:7317"}
        self.seed(VERIFIER, age=10)
        msg = self.boot()
        self.assertEqual(msg, "colony: http://127.0.0.1:7317 (ready)")
        self.assertNotIn("17317", msg)
        self.assertEqual(
            self.popen, []
        )  # no bun install / build / plugin.ts start / ensure

    def test_colony_off_skips_everything(self):
        with mock.patch.dict(os.environ, {"ATLAS_COLONY": "off"}):
            with mock.patch("subprocess.run") as run:
                self.assertIsNone(session_boot.ensure_colony())
                run.assert_not_called()

    def test_status_failure_is_fail_open(self):
        self.seed(DOWN, age=10)
        with mock.patch("subprocess.run", side_effect=OSError("no ps")):
            with mock.patch("urllib.request.urlopen", side_effect=OSError("x")):
                with mock.patch("subprocess.Popen"):
                    session_boot.ensure_colony()  # must not raise


if __name__ == "__main__":
    unittest.main()
