"""connector_credential_watch.py -- stale-credential detection on MCP responses.

Guards the measured failure: a connector holding a rotated secret returns the
same auth error on every endpoint, and the session sweeps all of them anyway.
The warning has to fire on the FIRST failure, exactly once, and must not fire
on an ordinary bad-argument 400 or a successful response that happens to
contain the word "unauthorized" in its data.

Stdlib only.
"""

from __future__ import annotations

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
from pathlib import Path

HOOK = Path(__file__).resolve().parent / "connector_credential_watch.py"


def _run(payload, env_extra=None, home=None):
    env = dict(os.environ)
    if home:
        env["HOME"] = home
        env["ATLAS_HOME"] = os.path.join(home, ".atlas")
    env.update(env_extra or {})
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
    )


class CredentialWatchFalsePositives(unittest.TestCase):
    """AuditConnectors F1: only a real error signal may fire; payload words are data."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    @staticmethod
    def _p(resp, tool="mcp__plugin_atlas_connectwise__cw_search_tickets", session="s1"):
        return {
            "hook_event_name": "PostToolUse",
            "tool_name": tool,
            "session_id": session,
            "tool_response": resp,
        }

    @staticmethod
    def _blocks(text, is_error=False):
        out = {"content": [{"type": "text", "text": text}]}
        if is_error:
            out["isError"] = True
        return out

    def test_benign_data_responses_never_fire(self):
        b = self._blocks
        benign = [
            (
                "mcp__plugin_atlas_blumira__blumira_findings_list",
                b(
                    json.dumps(
                        {
                            "data": [
                                {
                                    "name": "Unauthorized login attempt from 1.2.3.4",
                                    "priority": 2,
                                }
                            ]
                        }
                    )
                ),
            ),
            (
                "mcp__plugin_atlas_vanta__vanta_tests_list",
                b(json.dumps({"totalCount": 403, "results": []})),
            ),
            (
                "mcp__plugin_atlas_falcon__falcon_search_detections",
                b("Forbidden process execution blocked by policy"),
            ),
            (
                "mcp__plugin_atlas_ninjaone__ninjaone_devices_get",
                b(json.dumps({"id": 401, "name": "pc"})),
            ),
            (
                "mcp__atlas_threatlocker_threatlocker_audit_search",
                b("Deny Forbidden binary 403 times; token expired for user bob"),
            ),
            (
                "mcp__plugin_atlas_knowbe4__knowbe4_groups_list",
                {"groups": [{"name": "Invalid token training", "id": 401}]},
            ),
            (
                "mcp__plugin_atlas_panos__panos_logs_retrieve",
                b(
                    "status: ok\nlog: authentication failed for user x (HTTP 401 seen upstream)"
                ),
            ),
        ]
        for i, (tool, resp) in enumerate(benign):
            with self.subTest(tool=tool):
                r = _run(self._p(resp, tool=tool, session="b%d" % i), home=self.home)
                self.assertEqual(r.stdout.strip(), "")
        self.assertFalse(
            (Path(self.home) / ".atlas" / "connector_auth_warned.json").exists()
        )

    def test_real_auth_errors_still_fire(self):
        b = self._blocks
        errors = [
            b("HTTP 401 Unauthorized: Invalid Token", True),
            b("Request failed with status code 403 Forbidden", True),
            b("invalid_grant: refresh token revoked", True),
            b('HTTP 400: {"code":"InvalidToken","message":"Invalid Token"}', True),
            {"status": 403, "error": "Forbidden"},
            {"error": "Authentication failed"},
            "Error: 401 Unauthorized",
            "status 401 unauthorized",
            [{"type": "text", "text": "HTTP 401 Unauthorized"}],
        ]
        for i, resp in enumerate(errors):
            with self.subTest(resp=resp):
                r = _run(self._p(resp, session="e%d" % i), home=self.home)
                self.assertIn("STALE CREDENTIAL", r.stdout)

    def test_is_error_with_unrelated_numbers_is_silent(self):
        r = _run(
            self._p(self._blocks("User 403 not found in group 401", True)),
            home=self.home,
        )
        self.assertEqual(r.stdout.strip(), "")

    def test_omp_device_names_match_and_dedupe_per_server(self):
        resp = self._blocks("HTTP 401 Unauthorized", True)
        first = _run(
            self._p(resp, tool="mcp__atlas_cipp_cipp_list_users"), home=self.home
        )
        self.assertIn("STALE CREDENTIAL: cipp returned", first.stdout)
        again = _run(
            self._p(resp, tool="mcp__atlas_cipp_cipp_list_tenants"), home=self.home
        )
        self.assertEqual(
            again.stdout.strip(), "", "same server, other tool: warned once"
        )
        for tool in (
            "mcp__lean_ctx_ctx_read",
            "mcp__context_mode_context_mode_ctx_execute",
            "mcp__claude_mem_mcp_search_search",
            "mcp__serena_find_symbol",
        ):
            r = _run(self._p("HTTP 401 Unauthorized", tool=tool), home=self.home)
            self.assertEqual(r.stdout.strip(), "", tool)

    def test_malformed_stdin_traces_but_empty_stdin_does_not(self):
        env = dict(
            os.environ, HOME=self.home, ATLAS_HOME=os.path.join(self.home, ".atlas")
        )
        for raw in ("", "   "):
            subprocess.run(
                [sys.executable, str(HOOK)],
                input=raw,
                capture_output=True,
                text=True,
                env=env,
            )
        faults = Path(self.home) / ".atlas" / "hook-faults.jsonl"
        self.assertFalse(faults.exists())
        subprocess.run(
            [sys.executable, str(HOOK)],
            input="{not json",
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertEqual(
            json.loads(faults.read_text().splitlines()[0])["hook"],
            "connector_credential_watch",
        )

    def test_unwritable_state_still_warns_and_traces(self):
        atlas = Path(self.home) / ".atlas"
        atlas.mkdir()
        (
            atlas / "connector_auth_warned.json"
        ).mkdir()  # a directory where the file belongs
        r = _run(self._p({"status": 401, "error": "Unauthorized"}), home=self.home)
        self.assertIn("STALE CREDENTIAL", r.stdout)
        self.assertIn(
            "connector_credential_watch", (atlas / "hook-faults.jsonl").read_text()
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

    def test_content_returning_server_never_warns(self):
        """lean-ctx/context-mode/serena return FILE CONTENT. Reading this very
        hook, or grepping the connector sources, puts "Invalid Token" and
        "Unauthorized" in the response body. Warning there would inject a false
        restart order mid-task -- the nudge-in-subagent-context defect again."""
        for tool in (
            "mcp__lean-ctx__ctx_read",
            "mcp__plugin_context-mode_context-mode__ctx_execute",
            "mcp__serena__find_symbol",
            "mcp__plugin_claude-mem_mcp-search__search",
            "mcp__context7__query-docs",
        ):
            with self.subTest(tool=tool):
                r = _run(
                    self._payload(
                        'HTTP 401 Unauthorized: {"error":"Invalid Token"}  '
                        "-- matched in hooks/connector_credential_watch.py",
                        tool=tool,
                    ),
                    home=self.home,
                )
                self.assertEqual(r.stdout.strip(), "")

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
