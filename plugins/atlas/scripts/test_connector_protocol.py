"""Protocol-level contract for every vendored node MCP bundle.

Each bundle is spawned exactly as .mcp.json launches it (node --import
_env/load.mjs server.mjs) with no credentials anywhere, then driven through
initialize -> tools/list -> <vendor>_status. Checks what a Claude client sees:

- initialize returns server `instructions` (loaded at startup even when MCP
  Tool Search defers every tool schema, so it is the one place to steer tool
  choice and auth troubleshooting).
- the status tool is always listed and callable without credentials.
- status output never claims tools are listed when they are not.
"""

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

MCP_DIR = Path(__file__).parent.parent / "mcp"
ENV_LOADER = MCP_DIR / "_env" / "load.mjs"
BUNDLES = sorted(MCP_DIR.glob("*/server.mjs"))

# Phrases older status handlers printed while the credential gate hid every
# domain tool - the exact contradiction a user sees as "tools missing".
FALSE_CLAIMS = ("available at all times", "registered upfront")


def _rpc(bundle: Path) -> dict:
    """Run one stdio session; return {id: message} for ids 1-3."""
    with tempfile.TemporaryDirectory() as home:
        # Empty HOME hides ~/.config/atlas/atlas.env; no ATLAS_ENV_FILE and no
        # CFG_* keys, so the server boots genuinely unconfigured.
        env = {"PATH": os.environ["PATH"], "HOME": home, "MCP_TRANSPORT": "stdio"}
        proc = subprocess.Popen(
            ["node", "--import", str(ENV_LOADER), str(bundle)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            text=True,
        )
        stdin, stdout, stderr = proc.stdin, proc.stdout, proc.stderr
        assert stdin and stdout and stderr  # all three are PIPE above
        replies: dict[int, dict] = {}

        def send(msg: dict) -> None:
            stdin.write(json.dumps(msg) + "\n")
            stdin.flush()

        def read_until(msg_id: int) -> dict:
            while True:
                line = stdout.readline()
                if not line:
                    raise AssertionError(
                        f"{bundle.parent.name}: stdout closed before id {msg_id}: {stderr.read()[:500]}"
                    )
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    raise AssertionError(
                        f"{bundle.parent.name}: non-JSON on stdout: {line[:200]!r}"
                    )
                if msg.get("id") == msg_id:
                    return msg

        try:
            send(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2025-06-18",
                        "capabilities": {},
                        "clientInfo": {"name": "atlas-contract", "version": "0"},
                    },
                }
            )
            replies[1] = read_until(1)
            send({"jsonrpc": "2.0", "method": "notifications/initialized"})
            send({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
            replies[2] = read_until(2)
            status = [
                t["name"]
                for t in replies[2]["result"]["tools"]
                if t["name"].endswith("_status")
            ]
            if status:
                send(
                    {
                        "jsonrpc": "2.0",
                        "id": 3,
                        "method": "tools/call",
                        "params": {"name": status[0], "arguments": {}},
                    }
                )
                replies[3] = read_until(3)
        finally:
            proc.kill()
            proc.wait(timeout=5)
        return replies


class TestConnectorProtocol(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sessions = {b.parent.name: _rpc(b) for b in BUNDLES}

    def test_bundles_discovered(self) -> None:
        self.assertGreaterEqual(len(BUNDLES), 10)

    def test_initialize_returns_instructions(self) -> None:
        for name, s in self.sessions.items():
            with self.subTest(name):
                text = s[1]["result"].get("instructions") or ""
                self.assertGreater(
                    len(text.strip()), 40, f"{name}: missing server instructions"
                )

    def test_status_tool_listed_and_callable_unconfigured(self) -> None:
        for name, s in self.sessions.items():
            with self.subTest(name):
                self.assertIn(3, s, f"{name}: no *_status tool in tools/list")
                self.assertIn(
                    "result", s[3], f"{name}: status call failed: {s[3].get('error')}"
                )

    def test_every_listed_tool_has_title_and_permission_hints(self) -> None:
        # Claude decides auto-approval from readOnlyHint/destructiveHint; the
        # Anthropic connector review requires both plus a title on every tool.
        for name, s in self.sessions.items():
            for tool in s[2]["result"]["tools"]:
                with self.subTest(f"{name}:{tool['name']}"):
                    ann = tool.get("annotations") or {}
                    self.assertTrue(
                        tool.get("title") or ann.get("title"), "missing title"
                    )
                    self.assertIn("readOnlyHint", ann)
                    self.assertIn("destructiveHint", ann)

    def test_status_makes_no_false_availability_claim(self) -> None:
        for name, s in self.sessions.items():
            with self.subTest(name):
                text = " ".join(
                    c.get("text", "")
                    for c in s.get(3, {}).get("result", {}).get("content", [])
                )
                for phrase in FALSE_CLAIMS:
                    self.assertNotIn(
                        phrase,
                        text.lower(),
                        f"{name}: status claims '{phrase}' while unconfigured",
                    )


if __name__ == "__main__":
    unittest.main()
