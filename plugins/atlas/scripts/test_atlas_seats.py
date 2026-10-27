"""atlas_seats unit tests: both backend modules are patched; nothing spawns."""

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_herdr  # noqa: E402
import atlas_rig  # noqa: E402
import atlas_seats as s  # noqa: E402


class BackendTests(unittest.TestCase):
    def env(self, **kw):
        p = mock.patch.dict(os.environ, kw)
        p.start()
        self.addCleanup(p.stop)
        if "ATLAS_SEAT_BACKEND" not in kw:
            os.environ.pop("ATLAS_SEAT_BACKEND", None)

    def test_env_override(self):
        for val, want in (("rig", "rig"), ("herdr", "herdr"), ("off", "none")):
            self.env(ATLAS_SEAT_BACKEND=val)
            self.assertEqual(s.backend(), want)

    def test_rig_when_binary_exists(self):
        self.env()
        with (
            mock.patch.object(atlas_rig, "_bin", return_value="/x/rig"),
            mock.patch.object(atlas_rig, "_rigs", return_value=None),
        ):
            self.assertEqual(s.backend(), "rig")

    def test_herdr_when_rig_empty_and_herdr_up(self):
        self.env()
        up = {"herdr_server": True}
        with (
            mock.patch.object(atlas_rig, "_bin", return_value="/x/rig"),
            mock.patch.object(atlas_herdr, "status", return_value=up),
        ):
            with mock.patch.object(atlas_rig, "_rigs", return_value=[]):
                self.assertEqual(s.backend(), "herdr")
            with mock.patch.object(atlas_rig, "_rigs", return_value=["r"]):
                self.assertEqual(s.backend(), "rig")
            self.env(ATLAS_SEAT_BACKEND="rig")  # explicit override wins
            with mock.patch.object(atlas_rig, "_rigs", return_value=[]):
                self.assertEqual(s.backend(), "rig")

    def test_herdr_when_rig_absent(self):
        self.env()
        with (
            mock.patch.object(atlas_rig, "_bin", return_value=None),
            mock.patch.object(s, "_node_ok", return_value=False),
            mock.patch.object(atlas_herdr, "status", return_value={"installed": True}),
        ):
            self.assertEqual(s.backend(), "herdr")

    def test_none_when_nothing(self):
        self.env()
        with (
            mock.patch.object(atlas_rig, "_bin", return_value=None),
            mock.patch.object(s, "_node_ok", return_value=False),
            mock.patch.object(atlas_herdr, "status", return_value={}),
        ):
            self.assertEqual(s.backend(), "none")

    def test_delegation_targets_chosen_module(self):
        self.env(ATLAS_SEAT_BACKEND="rig")
        with (
            mock.patch.object(atlas_rig, "status", return_value={"who": "rig"}),
            mock.patch.object(atlas_herdr, "status", return_value={"who": "herdr"}),
        ):
            self.assertEqual(s.status()["who"], "rig")
            os.environ["ATLAS_SEAT_BACKEND"] = "herdr"
            self.assertEqual(s.status()["who"], "herdr")

    def test_agents_union_rig_and_herdr_deduped(self):
        self.env()
        rig = {"reachable": True, "reason": None, "workspaces": [{"workspace_id": "r1"}],
               "agents": [{"pane_id": "a@r1"}, {"pane_id": "dup"}]}
        hd = {"reachable": True, "reason": None, "workspaces": [{"workspace_id": "w1"}],
              "agents": [{"pane_id": "dup"}, {"pane_id": "h1"}]}
        with (
            mock.patch.object(atlas_rig, "agents", return_value=rig),
            mock.patch.object(atlas_herdr, "agents", return_value=hd),
            mock.patch.object(atlas_herdr, "status", return_value={"herdr_server": True}),
        ):
            r = s.agents()
            self.assertEqual([a["pane_id"] for a in r["agents"]], ["a@r1", "dup", "h1"])
            self.assertEqual(len(r["workspaces"]), 2)
            os.environ["ATLAS_SEAT_BACKEND"] = "rig"  # override restricts to one source
            self.assertEqual([a["pane_id"] for a in s.agents()["agents"]], ["a@r1", "dup"])

    def test_status_adds_backend_and_web_ui(self):
        self.env(ATLAS_SEAT_BACKEND="rig")
        with mock.patch.object(atlas_rig, "status", return_value={"url": "x"}):
            self.assertEqual(
                s.status(), {"url": "x", "backend": "rig", "web_ui": False}
            )
        os.environ["ATLAS_SEAT_BACKEND"] = "herdr"
        with mock.patch.object(atlas_herdr, "status", return_value={"url": "y"}):
            self.assertEqual(
                s.status(), {"url": "y", "backend": "herdr", "web_ui": True}
            )

    def test_capture_rig_delegates(self):
        self.env(ATLAS_SEAT_BACKEND="rig")
        with mock.patch.object(
            atlas_rig, "capture", return_value={"ok": True, "text": "t"}
        ) as c:
            self.assertEqual(s.capture("p", 5)["text"], "t")
        c.assert_called_once_with("p", 5)

    def test_capture_herdr_reads_pane_via_rpc(self):
        self.env(ATLAS_SEAT_BACKEND="herdr")
        with mock.patch.object(
            atlas_herdr, "rpc", return_value={"read": {"text": "hi"}}
        ) as r:
            self.assertEqual(
                s.capture("p", 7), {"ok": True, "pane_id": "p", "text": "hi"}
            )
        self.assertEqual(
            r.call_args.args,
            ("pane.read", {"pane_id": "p", "source": "recent", "lines": 7, "format": "text"}),
        )

    def test_capture_herdr_sock_error_is_not_ok(self):
        self.env(ATLAS_SEAT_BACKEND="herdr")
        err = atlas_herdr.HerdrSockError("socket_missing", "x")
        with mock.patch.object(atlas_herdr, "rpc", side_effect=err):
            self.assertEqual(s.capture("p"), {"ok": False, "error": "socket_missing"})


if __name__ == "__main__":
    unittest.main()
