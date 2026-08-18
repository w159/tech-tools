"""connector_credential_watch.py -- stale-credential detection on MCP responses.

Guards the measured failure: a connector holding a rotated secret returns the
same auth error on every endpoint, and the session sweeps all of them anyway.
The warning has to fire on the FIRST failure, exactly once, and must not fire
on an ordinary bad-argument 400 or a successful response that happens to
contain the word "unauthorized" in its data.

Stdlib only.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HOOK = Path(__file__).resolve().parent / "connector_credential_watch.py"


def _run(payload, env_extra=None, home=None):
    env = dict(os.environ)
    if home:
        env["HOME"] = home
    env.update(env_extra or {})
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
    )


class ConnectorCredentialWatch(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    def _payload(
        self,
        response,
        tool="mcp__plugin_atlas_connectwise__cw_search_tickets",
        session="s1",
    ):
        return {
            "hook_event_name": "PostToolUse",
            "tool_name": tool,
            "session_id": session,
            "tool_response": response,
        }

    def test_401_warns(self):
        r = _run(
            self._payload({"status": 401, "error": "Unauthorized"}), home=self.home
        )
        self.assertIn("STALE CREDENTIAL", r.stdout)
        self.assertIn("do not retry other endpoints", r.stdout.lower())

    def test_400_invalid_token_warns(self):
        r = _run(
            self._payload(
                'HTTP 400: {"code":"InvalidToken","message":"Invalid Token"}'
            ),
            home=self.home,
        )
        self.assertIn("STALE CREDENTIAL", r.stdout)

    def test_plain_400_bad_argument_is_silent(self):
        r = _run(
            self._payload(
                {"status": 400, "error": "conditions parameter is malformed"}
            ),
            home=self.home,
        )
        self.assertEqual(r.stdout.strip(), "")

    def test_successful_response_is_silent(self):
        r = _run(
            self._payload({"status": 200, "items": [{"summary": "ok"}]}), home=self.home
        )
        self.assertEqual(r.stdout.strip(), "")

    def test_non_mcp_tool_is_ignored(self):
        r = _run(
            self._payload({"status": 401}, tool="Bash"),
            home=self.home,
        )
        self.assertEqual(r.stdout.strip(), "")

    def test_warns_once_per_server_per_session(self):
        p = self._payload({"status": 401, "error": "Unauthorized"})
        first = _run(p, home=self.home)
        second = _run(p, home=self.home)
        self.assertIn("STALE CREDENTIAL", first.stdout)
        self.assertEqual(second.stdout.strip(), "")

    def test_different_server_warns_again(self):
        _run(self._payload({"status": 401}), home=self.home)
        other = _run(
            self._payload({"status": 401}, tool="mcp__plugin_atlas_ramp__ramp_list"),
            home=self.home,
        )
        self.assertIn("STALE CREDENTIAL", other.stdout)

    def test_new_session_warns_again(self):
        _run(self._payload({"status": 401}), home=self.home)
        later = _run(self._payload({"status": 401}, session="s2"), home=self.home)
        self.assertIn("STALE CREDENTIAL", later.stdout)

    def test_kill_switch(self):
        r = _run(
            self._payload({"status": 401}),
            env_extra={"ATLAS_CONNECTOR_WATCH": "off"},
            home=self.home,
        )
        self.assertEqual(r.stdout.strip(), "")

    def test_garbage_stdin_fails_open(self):
        r = subprocess.run(
            [sys.executable, str(HOOK)],
            input="not json",
            capture_output=True,
            text=True,
            env=dict(os.environ, HOME=self.home),
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")

    def test_output_is_valid_hook_json(self):
        r = _run(self._payload({"status": 403, "error": "Forbidden"}), home=self.home)
        parsed = json.loads(r.stdout)
        self.assertEqual(parsed["hookSpecificOutput"]["hookEventName"], "PostToolUse")
        self.assertIn("additionalContext", parsed["hookSpecificOutput"])


if __name__ == "__main__":
    unittest.main()
