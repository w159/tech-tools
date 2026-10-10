"""CLI tests for atlas_herdr prompt/close-pane: JSON on stdout, non-zero exit on failure,
strict pane-id validation and the 2000-char text cap. The herdr socket client (rpc) and the
live-agent/pane lookups are monkeypatched, so no real herdr is touched."""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import contextlib
import io
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import atlas_herdr  # noqa: E402


def _agents_snapshot(agents: list[dict]) -> dict:
    return {"reachable": True, "reason": None, "agents": agents}


class FakeRpc:
    """Stands in for the herdr socket client; records every call."""

    def __init__(self, reachable: bool = True):
        self.calls: list[tuple] = []
        self.reachable = reachable

    def __call__(self, method, params=None, timeout=None):
        self.calls.append((method, params))
        if method == "agent.prompt":
            return {"type": "prompt_sent", "target": (params or {}).get("target")}
        if method == "pane.close":
            return {"type": "closed"}
        return {}

    def prompt_calls(self) -> list[tuple]:
        return [c for c in self.calls if c[0] == "agent.prompt"]

    def close_calls(self) -> list[tuple]:
        return [c for c in self.calls if c[0] == "pane.close"]


class CliBase(unittest.TestCase):
    IDLE_AGENT = [{"pane_id": "wB:p1", "status": "idle"}]

    def setUp(self):
        self.fake = FakeRpc()
        self.saved = {
            k: getattr(atlas_herdr, k) for k in ("rpc", "agents", "list_panes")
        }
        atlas_herdr.rpc = self.fake
        atlas_herdr.agents = lambda: _agents_snapshot(list(self.IDLE_AGENT))
        atlas_herdr.list_panes = lambda run=None: [{"pane_id": "wB:p1"}]

    def tearDown(self):
        for k, v in self.saved.items():
            setattr(atlas_herdr, k, v)

    def run_cli(self, *args: str) -> tuple[int, dict, str]:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = atlas_herdr.main(["atlas_herdr.py", *args])
        return code, json.loads(buf.getvalue()), buf.getvalue()


class PromptTests(CliBase):
    def test_idle_agent_gets_prompt_and_exit_zero(self):
        code, out, _ = self.run_cli("prompt", "--pane", "wB:p1", "--text", "hello")
        self.assertEqual(code, 0)
        self.assertTrue(out["ok"])
        self.assertEqual(out["result"]["type"], "prompt_sent")
        self.assertEqual(
            self.fake.prompt_calls(),
            [("agent.prompt", {"target": "wB:p1", "text": "hello"})],
        )

    def test_root_flag_is_accepted(self):
        code, out, _ = self.run_cli(
            "prompt", "--pane", "wB:p1", "--text", "hi", "--root", "some/root"
        )
        self.assertEqual((code, out["ok"]), (0, True))

    def test_text_over_2000_chars_is_refused_before_sending(self):
        code, out, _ = self.run_cli("prompt", "--pane", "wB:p1", "--text", "x" * 2001)
        self.assertEqual(code, 1)
        self.assertFalse(out["ok"])
        self.assertIn("2000", out["reason"])
        self.assertEqual(self.fake.prompt_calls(), [])

    def test_text_at_exactly_2000_chars_is_allowed(self):
        code, out, _ = self.run_cli("prompt", "--pane", "wB:p1", "--text", "x" * 2000)
        self.assertEqual((code, out["ok"]), (0, True))

    def test_invalid_pane_id_refused_without_touching_the_socket(self):
        for bad in ("bad id!", "../escape", "wB:p1\n", "x" * 65, ""):
            with self.subTest(pane=bad):
                self.fake.calls.clear()
                code, out, _ = self.run_cli("prompt", "--pane", bad, "--text", "hi")
                self.assertEqual(code, 1)
                self.assertFalse(out["ok"])
                self.assertEqual(self.fake.calls, [])  # agents() never even ran

    def test_unknown_pane_refused_404(self):
        code, out, _ = self.run_cli("prompt", "--pane", "wC:nope", "--text", "hi")
        self.assertEqual(code, 1)
        self.assertIn("no such agent pane", out["reason"])
        self.assertEqual(self.fake.prompt_calls(), [])

    def test_non_idle_agent_refused_409(self):
        atlas_herdr.agents = lambda: _agents_snapshot(
            [{"pane_id": "wB:p1", "status": "working"}]
        )
        code, out, _ = self.run_cli("prompt", "--pane", "wB:p1", "--text", "hi")
        self.assertEqual(code, 1)
        self.assertIn("not idle", out["reason"])
        self.assertEqual(self.fake.prompt_calls(), [])

    def test_server_down_refused_503(self):
        atlas_herdr.agents = lambda: {
            "reachable": False,
            "reason": "socket_missing",
            "agents": [],
        }
        code, out, _ = self.run_cli("prompt", "--pane", "wB:p1", "--text", "hi")
        self.assertEqual(code, 1)
        self.assertIn("not reachable", out["reason"])
        self.assertEqual(self.fake.calls, [])

    def test_missing_text_is_a_usage_error(self):
        code, out, _ = self.run_cli("prompt", "--pane", "wB:p1")
        self.assertEqual((code, out["ok"]), (1, False))

    def test_missing_pane_is_a_usage_error(self):
        code, out, _ = self.run_cli("prompt", "--text", "hi")
        self.assertEqual((code, out["ok"]), (1, False))

    def test_unknown_option_is_refused(self):
        code, out, _ = self.run_cli(
            "prompt", "--pane", "wB:p1", "--text", "hi", "--bogus", "1"
        )
        self.assertEqual((code, out["ok"]), (1, False))


class ClosePaneTests(CliBase):
    def test_colony_pane_is_closed_and_exit_zero(self):
        code, out, _ = self.run_cli("close-pane", "--pane", "wB:p1")
        self.assertEqual(code, 0)
        self.assertTrue(out["ok"])
        self.assertEqual(out["pane_id"], "wB:p1")
        self.assertEqual(
            self.fake.close_calls(), [("pane.close", {"pane_id": "wB:p1"})]
        )

    def test_root_flag_is_accepted(self):
        code, out, _ = self.run_cli(
            "close-pane", "--pane", "wB:p1", "--root", "some/root"
        )
        self.assertEqual((code, out["ok"]), (0, True))

    def test_unknown_pane_refused_without_closing(self):
        atlas_herdr.list_panes = lambda run=None: []
        code, out, _ = self.run_cli("close-pane", "--pane", "wB:p1")
        self.assertEqual(code, 1)
        self.assertIn("no such colony pane", out["reason"])
        self.assertEqual(self.fake.close_calls(), [])

    def test_invalid_pane_id_refused_without_touching_the_socket(self):
        for bad in ("bad id!", "../escape", "x" * 65):
            with self.subTest(pane=bad):
                self.fake.calls.clear()
                code, out, _ = self.run_cli("close-pane", "--pane", bad)
                self.assertEqual(code, 1)
                self.assertFalse(out["ok"])
                self.assertEqual(self.fake.calls, [])

    def test_missing_pane_is_a_usage_error(self):
        code, out, _ = self.run_cli("close-pane")
        self.assertEqual((code, out["ok"]), (1, False))

    def test_unknown_option_is_refused(self):
        code, out, _ = self.run_cli("close-pane", "--pane", "wB:p1", "--bogus")
        self.assertEqual((code, out["ok"]), (1, False))


if __name__ == "__main__":
    unittest.main()
