"""atlas_rig unit tests: `_rig` / `_healthz` are patched, no daemon or tmux needed."""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_rig as r  # noqa: E402

NODES = [
    {
        "logicalId": "w.a",
        "canonicalSessionName": "w-a@run1",
        "lifecycleState": "running",
        "startupStatus": "ready",
        "agentActivity": {"state": "running"},
        "cwd": "/x",
    },
    {
        "logicalId": "w.b",
        "canonicalSessionName": "w-b@run1",
        "lifecycleState": "running",
        "startupStatus": "ready",
        "agentActivity": {"state": "needs_input"},
        "cwd": "/x",
    },
    {
        "logicalId": "w.c",
        "canonicalSessionName": "w-c@run1",
        "lifecycleState": "running",
        "startupStatus": "ready",
        "agentActivity": {"state": "idle"},
        "cwd": "/x",
    },
    {
        "logicalId": "w.d",
        "canonicalSessionName": "w-d@run1",
        "lifecycleState": "detached",
        "startupStatus": "ready",
        "agentActivity": {"state": "unknown"},
        "cwd": "/x",
    },
    {
        "logicalId": "w.e",
        "canonicalSessionName": "w-e@run1",
        "lifecycleState": "attention_required",
        "startupStatus": "failed",
        "latestError": "boom",
        "agentActivity": {"state": "idle"},
        "cwd": "/x",
    },
]


class Base(unittest.TestCase):
    def setUp(self):
        r._ps_cache.clear()  # `rig ps` probes are TTL-cached; tests patch _rig per case
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        p = mock.patch.dict(os.environ, {"ATLAS_HOME": self.tmp.name})
        p.start()
        self.addCleanup(p.stop)
        p = mock.patch.object(r, "_bin", return_value="/fake/rig")
        p.start()
        self.addCleanup(p.stop)


class StatusTests(Base):
    def test_ok(self):
        with mock.patch.object(r, "_healthz", return_value={"status": "ok", "pid": 7}):
            s = r.status()
        self.assertEqual(s["state"], "ok")
        self.assertTrue(s["healthy"])

    def test_refused(self):
        with mock.patch.object(r, "_healthz", return_value=None):
            s = r.status()
        self.assertEqual(s["state"], "server_down")
        self.assertFalse(s["healthy"])

    def test_rig_missing(self):
        with (
            mock.patch.object(r, "_bin", return_value=None),
            mock.patch.object(r, "_healthz", return_value=None),
        ):
            s = r.status()
        self.assertEqual((s["state"], s["reason"]), ("server_down", "rig_missing"))


class EnsureTests(Base):
    def test_already_up(self):
        with (
            mock.patch.object(r, "_healthz", return_value={"status": "ok"}),
            mock.patch.object(r, "_rig") as rig,
        ):
            out = r.ensure_server()
        self.assertEqual(out["action"], "already_up")
        rig.assert_not_called()

    def test_started(self):
        with (
            mock.patch.object(r, "_healthz", side_effect=[None, {"status": "ok"}]),
            mock.patch.object(r, "_rig", return_value=(0, None, "")) as rig,
        ):
            out = r.ensure_server(wait=0)
        self.assertEqual((out["ok"], out["action"]), (True, "started"))
        self.assertEqual(rig.call_count, 1)
        self.assertEqual(rig.call_args[0][0][:2], ["daemon", "start"])

    def test_still_down(self):
        with (
            mock.patch.object(r, "_healthz", return_value=None),
            mock.patch.object(r, "_rig", return_value=(1, None, "bad")),
        ):
            out = r.ensure_server(wait=0)
        self.assertFalse(out["ok"])

    def test_no_binary_installs_then_starts(self):
        with (
            mock.patch.object(r, "_bin", return_value=None),
            mock.patch.object(r, "_healthz", side_effect=[None, {"status": "ok"}]),
            mock.patch.object(
                r, "install", return_value={"ok": True, "action": "installed"}
            ) as ins,
            mock.patch.object(r, "_rig", return_value=(0, None, "")),
        ):
            out = r.ensure_server(wait=0)
        ins.assert_called_once()
        self.assertEqual((out["ok"], out["action"]), (True, "started"))

    def test_no_binary_install_error_is_returned(self):
        bad = {"ok": False, "action": "error", "reason": "npm failed"}
        with (
            mock.patch.object(r, "_bin", return_value=None),
            mock.patch.object(r, "_healthz", return_value=None),
            mock.patch.object(r, "install", return_value=bad),
        ):
            out = r.ensure_server()
        self.assertEqual(out, bad)


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp()
        p = mock.patch.dict(os.environ, {"ATLAS_HOME": self.home})
        p.start()
        self.addCleanup(p.stop)

    def _run(self, node="v22.1.0", rc=0):
        def fake(argv, **kw):
            if argv[0] == "node":
                return mock.Mock(returncode=0, stdout=node, stderr="")
            return mock.Mock(returncode=rc, stdout="", stderr="")

        return fake

    def test_present(self):
        with mock.patch.object(r, "_bin", return_value="/x/rig"):
            self.assertEqual(r.install(), {"ok": True, "action": "present"})

    def test_unsupported_node(self):
        with (
            mock.patch.object(r, "_bin", return_value=None),
            mock.patch("shutil.which", return_value="/usr/bin/npm"),
            mock.patch("subprocess.run", side_effect=self._run(node="v18.0.0")),
        ):
            out = r.install()
        self.assertEqual((out["ok"], out["action"]), (False, "unsupported_node"))

    def test_installed_pins_version_and_logs(self):
        with (
            mock.patch.object(r, "_bin", return_value=None),
            mock.patch("shutil.which", return_value="/usr/bin/npm"),
            mock.patch("subprocess.run", side_effect=self._run()) as run,
        ):
            out = r.install()
        self.assertEqual((out["ok"], out["action"]), (True, "installed"))
        argv = run.call_args_list[-1][0][0]
        self.assertIn("@openrig/cli@" + r.RIG_VERSION, argv)
        self.assertTrue(
            os.path.isfile(os.path.join(self.home, "openrig", "install.log"))
        )

    def test_install_error(self):
        with (
            mock.patch.object(r, "_bin", return_value=None),
            mock.patch("shutil.which", return_value="/usr/bin/npm"),
            mock.patch("subprocess.run", side_effect=self._run(rc=1)),
        ):
            out = r.install()
        self.assertEqual((out["ok"], out["action"]), (False, "error"))


class SeatTests(Base):
    def test_create_pane(self):
        calls = []

        def fake(args, timeout=10):
            calls.append(args)
            if args[:1] == ["ps"]:
                return 0, [], ""
            return 0, {"ok": True}, ""

        with mock.patch.object(r, "_rig", side_effect=fake):
            out = r.create_pane("w1", "echo hi", cwd="/tmp", run="run1")
        self.assertTrue(out["ok"], out)
        self.assertEqual(out["pane_id"], "w-w1@run1")
        spec = (Path(self.tmp.name) / "openrig/home/specs/run1.yaml").read_text()
        self.assertIn("label:", spec)
        self.assertIn("builtin:terminal", spec)
        up = next(c for c in calls if c[0] == "up")
        self.assertIn("--yes", up)
        self.assertIn("--json", up)
        send = next(c for c in calls if c[0] == "send")
        self.assertIn("--raw", send)

    def test_agents_mapping(self):
        def fake(args, timeout=10):
            if args == ["ps", "--json"]:
                return 0, [{"name": "run1"}], ""
            return 0, NODES, ""

        with (
            mock.patch.object(r, "_healthz", return_value={"status": "ok"}),
            mock.patch.object(r, "_rig", side_effect=fake),
        ):
            out = r.agents()
        got = {a["name"]: a["status"] for a in out["agents"]}
        self.assertEqual(
            got,
            {
                "a": "working",
                "b": "blocked",
                "c": "idle",
                "d": "unknown",
                "e": "blocked",
            },
        )
        self.assertEqual(out["agents"][4]["reason"], "boom")

    def test_send_prompt_raw(self):
        with mock.patch.object(r, "_rig", return_value=(0, {"ok": True}, "")) as rig:
            out = r.send_prompt("w-a@run1", "ls")
        self.assertTrue(out["ok"])
        args = rig.call_args[0][0]
        self.assertEqual(args[:3], ["send", "w-a@run1", "ls"])
        self.assertIn("--raw", args)

    def test_capture_returns_text(self):
        with mock.patch.object(
            r, "_rig", return_value=(0, {"text": "hi\n"}, "")
        ) as rig:
            out = r.capture("w-a@run1", 7)
        self.assertEqual(
            (out["ok"], out["text"], out["pane_id"]), (True, "hi\n", "w-a@run1")
        )
        self.assertEqual(
            rig.call_args[0][0], ["capture", "w-a@run1", "--lines", "7", "--json"]
        )

    def test_capture_failure_is_error_dict(self):
        with mock.patch.object(r, "_rig", return_value=(1, None, "no such session")):
            out = r.capture("nope")
        self.assertFalse(out["ok"])
        self.assertIn("no such session", out["error"])

    def test_close_run(self):
        with mock.patch.object(
            r, "_rig", return_value=(0, {"deleted": True}, "")
        ) as rig:
            out = r.close_run("run1")
        self.assertTrue(out["ok"])
        self.assertIn(
            ["down", "run1", "--delete", "--json"],
            [c[0][0] for c in rig.call_args_list],
        )


class NeverRaisesTests(Base):
    def test_rc2(self):
        with (
            mock.patch.object(r, "_rig", return_value=(2, None, "err")),
            mock.patch.object(r, "_healthz", return_value=None),
        ):
            self.assertIsInstance(r.status(), dict)
            self.assertIsInstance(r.ensure_server(wait=0), dict)
            self.assertIsInstance(r.ensure(), dict)
            self.assertEqual(r.list_panes("x"), [])
            self.assertIsInstance(r.create_pane("n", "c", cwd="/tmp", run="x"), dict)
            self.assertFalse(r.close_pane("w-a@x")["ok"])
            self.assertFalse(r.close_run("x")["ok"])
            self.assertFalse(r.pane_live("w-a@x"))
            self.assertFalse(r.send_prompt("w-a@x", "hi")["ok"])
            self.assertFalse(r.agents()["reachable"])


class QuarantineTests(unittest.TestCase):
    def test_three_branches(self):
        with tempfile.TemporaryDirectory() as td:
            home = Path(td)
            marked = home / ".claude" / "skills" / "rigs"
            marked.mkdir(parents=True)
            (marked / "SKILL.md").write_text("x")
            (marked / ".openrig-vendor-version").write_text("0.6.10")
            foreign = home / ".claude" / "skills" / "refocusing"
            foreign.mkdir()
            (foreign / "SKILL.md").write_text("mine")
            out = r._quarantine_vendored_skills(home)
            self.assertEqual(list(marked.iterdir()), [])
            self.assertTrue((foreign / "SKILL.md").exists())
            self.assertTrue((home / ".agents" / "skills" / "rigs").is_dir())
            self.assertEqual(out["errors"], [])
            self.assertEqual(out["removed"], [str(marked)])
            self.assertEqual(out["kept"], [str(foreign)])
            self.assertEqual(len(out["created"]), 4)  # 6 dirs - removed - kept


class EnvTests(Base):
    def test_confinement_keys(self):
        e = r._env()
        self.assertEqual(e["CODEX_HOME"], str(r._rig_home() / "codex"))
        self.assertEqual(e["OPENRIG_BIND_HOST"], "127.0.0.1")


class RigHangTests(unittest.TestCase):
    def test_ps_probe_runs_once_per_ttl_window(self):
        """Regression: /api/v2/channels probed `rig ps` per project root; a slow rig cost seconds each."""
        r._ps_cache.clear()
        with mock.patch.object(r, "_rig", return_value=(0, [], "")) as p:
            for _ in range(5):
                r._rigs()
        self.assertEqual(p.call_count, 1)
        r._ps_cache.clear()

    def test_rig_returns_on_timeout_when_grandchild_holds_pipe(self):
        """Regression: /api/v2/channels hung because a daemon grandchild kept stdout open."""
        import stat
        import tempfile
        import time

        with tempfile.TemporaryDirectory() as d:
            exe = Path(d) / "rig"
            exe.write_text("#!/bin/sh\n(sleep 30 &)\nsleep 30\n")
            exe.chmod(exe.stat().st_mode | stat.S_IEXEC)
            t0 = time.monotonic()
            with mock.patch.object(r, "_bin", return_value=str(exe)):
                rc, data, _ = r._rig(["ps"], timeout=1)
            self.assertEqual((rc, data), (124, None))
            self.assertLess(time.monotonic() - t0, 5)


if __name__ == "__main__":
    unittest.main()
