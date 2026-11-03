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
            mock.patch.object(session_boot, "_boot_herdr_wanted", return_value=True),
            # herdr down -> one ensure_server attempt; keep it off the real herdr server
            mock.patch.object(
                __import__("atlas_herdr"),
                "ensure_server",
                return_value={"ok": False, "reason": "spawn denied"},
            ),
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

    def _boot_log(self):
        try:
            with open(os.path.join(self.home, "colony-boot.log")) as f:
                return f.read()
        except OSError:
            return ""

    def test_ensure_server_failure_is_logged_not_printed(self):
        self.seed(
            {**DOWN, "herdr_server": False}, age=300
        )  # past the negative-cache TTL
        self.assertIsNone(self.boot())
        self.assertRegex(
            self._boot_log(), r"ensure_colony: ensure_server .*spawn denied"
        )

    def test_unexpected_exception_is_logged_and_still_silent(self):
        self.seed(DOWN, age=10)
        with (
            mock.patch.object(session_boot, "_boot_herdr_wanted", return_value=True),
            mock.patch.object(
                session_boot, "_colony_stack_url", side_effect=RuntimeError("kaboom")
            ),
        ):
            self.assertIsNone(session_boot.ensure_colony())
        self.assertRegex(self._boot_log(), r"ensure_colony: exception .*kaboom")


if __name__ == "__main__":
    unittest.main()


# Expected backend() of cef065ec (the decision SessionStart used before seats moved to first use), hard-coded.
# Key: (node major or None, rig binary, herdr web-ui installed, herdr server up); no rigs running; npm present with node.
# Boot's herdr colony path ran exactly when this was "herdr".
OLD_BACKEND = {
    (None, True, True, True): 'herdr', (None, True, True, False): 'rig', (None, True, False, True): 'herdr', (None, True, False, False): 'rig',
    (None, False, True, True): 'herdr', (None, False, True, False): 'herdr', (None, False, False, True): 'herdr', (None, False, False, False): 'none',
    (18, True, True, True): 'herdr', (18, True, True, False): 'rig', (18, True, False, True): 'herdr', (18, True, False, False): 'rig',
    (18, False, True, True): 'herdr', (18, False, True, False): 'herdr', (18, False, False, True): 'herdr', (18, False, False, False): 'none',
    (20, True, True, True): 'herdr', (20, True, True, False): 'rig', (20, True, False, True): 'herdr', (20, True, False, False): 'rig',
    (20, False, True, True): 'herdr', (20, False, True, False): 'herdr', (20, False, False, True): 'herdr', (20, False, False, False): 'none',
    (22, True, True, True): 'herdr', (22, True, True, False): 'rig', (22, True, False, True): 'herdr', (22, True, False, False): 'rig',
    (22, False, True, True): 'herdr', (22, False, True, False): 'rig', (22, False, False, True): 'herdr', (22, False, False, False): 'rig',
    (24, True, True, True): 'herdr', (24, True, True, False): 'rig', (24, True, False, True): 'herdr', (24, True, False, False): 'rig',
    (24, False, True, True): 'herdr', (24, False, True, False): 'rig', (24, False, False, True): 'herdr', (24, False, False, False): 'rig',
    (26, True, True, True): 'herdr', (26, True, True, False): 'rig', (26, True, False, True): 'herdr', (26, True, False, False): 'rig',
    (26, False, True, True): 'herdr', (26, False, True, False): 'herdr', (26, False, False, True): 'herdr', (26, False, False, False): 'none',
}


class BootHerdrGateTests(unittest.TestCase):
    """Boot's herdr-colony gate reproduces the old backend()-based decision without a per-boot subprocess (the seat
    backend probe ran `node --version`; the node major is now cached in ATLAS_HOME by path+mtime+size)."""

    def setUp(self):
        import shutil

        self.home = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.home, True)
        self.bin = os.path.join(self.home, "fakebin")
        os.makedirs(self.bin)
        p = mock.patch.dict(os.environ, {"ATLAS_HOME": self.home, "ATLAS_COLONY": "on", "HOME": self.home})
        p.start()
        self.addCleanup(p.stop)
        os.environ.pop("ATLAS_SEAT_BACKEND", None)
        os.environ["PATH"] = self.bin + os.pathsep + "/usr/bin" + os.pathsep + "/bin"

    def shim(self, node):
        want = {} if node is None else {"node": f"#!/bin/sh\necho v{node}.1.0\n", "npm": "#!/bin/sh\nexit 0\n"}
        for n in ("node", "npm"):
            f = os.path.join(self.bin, n)
            if n not in want:
                if os.path.exists(f):
                    os.remove(f)
            elif not os.path.exists(f) or open(f).read() != want[n]:  # untouched shim keeps its mtime: warm cache
                with open(f, "w") as fh:
                    fh.write(want[n])
                os.chmod(f, 0o755)

    def gate(self, node, rig, installed, server):
        import atlas_herdr
        import atlas_rig

        self.shim(node)
        root = os.path.join(self.home, "plugin")
        os.makedirs(os.path.join(root, "scripts"), exist_ok=True)
        marker = os.path.join(root, "scripts", "plugin.ts")
        if installed:
            open(marker, "w").close()
        elif os.path.exists(marker):
            os.remove(marker)
        sock = os.path.join(self.home, "herdr.sock")  # existence is the cheap pre-check; _server_up is patched
        if server:
            open(sock, "w").close()
        elif os.path.exists(sock):
            os.remove(sock)
        os.environ["HERDR_SOCKET_PATH"] = sock
        with (
            mock.patch.object(atlas_rig, "_bin", return_value="/x/rig" if rig else None),
            mock.patch.object(atlas_rig, "_rigs", return_value=[]),
            mock.patch.object(atlas_herdr, "_server_up", return_value=server),
            mock.patch.object(atlas_herdr, "PLUGIN_ROOT", __import__("pathlib").Path(root)),
        ):
            return session_boot._boot_herdr_wanted(self.home)

    def test_gate_equals_old_backend_decision(self):
        for key, old in OLD_BACKEND.items():
            with self.subTest(key=key):
                for f in ("node-major-cache.json",):
                    p = os.path.join(self.home, f)
                    if os.path.exists(p):
                        os.remove(p)
                self.assertEqual(old == "herdr", self.gate(*key), f"old backend {old!r}")

    def test_env_decides_when_set(self):
        for val, want in (("herdr", True), ("rig", False), ("off", False)):
            with mock.patch.dict(os.environ, {"ATLAS_SEAT_BACKEND": val}):
                self.assertEqual(self.gate(None, False, False, False), want)

    def test_warm_node_cache_runs_no_subprocess(self):
        self.gate(20, False, True, False)  # cold: one `node --version`
        with mock.patch("subprocess.run") as run, mock.patch("subprocess.Popen") as popen:
            self.assertTrue(self.gate(20, False, True, False))
        run.assert_not_called()
        popen.assert_not_called()

    def test_node_cache_is_keyed_by_binary(self):
        self.assertTrue(self.gate(20, False, True, False))  # node 20, web-ui installed: herdr
        self.gate(22, False, True, False)  # shim() rewrites node -> new mtime/size
        self.assertFalse(self.gate_same_node(True), "a new node install must not reuse the old cached major")

    def gate_same_node(self, installed):
        import atlas_herdr
        import atlas_rig

        root = os.path.join(self.home, "plugin")
        with (
            mock.patch.object(atlas_rig, "_bin", return_value=None),
            mock.patch.object(atlas_rig, "_rigs", return_value=[]),
            mock.patch.object(atlas_herdr, "_server_up", return_value=False),
            mock.patch.object(atlas_herdr, "PLUGIN_ROOT", __import__("pathlib").Path(root)),
        ):
            return session_boot._boot_herdr_wanted(self.home)

    def test_rig_boot_is_silent_and_spawns_nothing(self):
        with mock.patch.dict(os.environ, {"ATLAS_SEAT_BACKEND": "rig"}), mock.patch("subprocess.Popen") as popen:
            self.assertIsNone(session_boot.ensure_colony())
        popen.assert_not_called()


class BootDoesNotStartSeatsTests(unittest.TestCase):
    """The seats daemon starts on first use (atlas_mux), never at SessionStart: no backend detection (`node --version`)
    and no detached `atlas_seats.py ensure` on the boot path."""

    def setUp(self):
        self.home = tempfile.mkdtemp()
        p = mock.patch.dict(os.environ, {"ATLAS_HOME": self.home, "ATLAS_COLONY": "on", "HOME": self.home})
        p.start()
        self.addCleanup(p.stop)
        os.environ.pop("ATLAS_HERDR_AUTOSTART", None)
        os.environ.pop("ATLAS_SEAT_BACKEND", None)

    def test_boot_never_spawns_seats_ensure_or_detects_backend(self):
        with (
            mock.patch("subprocess.Popen") as popen,
            mock.patch("subprocess.run") as run,
            mock.patch.object(__import__("atlas_seats"), "backend", return_value="rig") as backend,
            mock.patch.object(__import__("atlas_seats"), "_node_ok", return_value=True) as node_ok,
        ):
            run.return_value = mock.Mock(stdout="{}")
            session_boot.ensure_colony()
        spawned = [c for c in popen.call_args_list if "atlas_seats.py" in " ".join(map(str, c[0][0]))]
        self.assertEqual([], spawned)
        backend.assert_not_called()
        node_ok.assert_not_called()
