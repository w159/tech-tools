#!/usr/bin/env python3
"""Verify atlas connector wiring: .mcp.json, plugin.json userConfig, and bundles.

This test is intentionally data-driven from the filesystem so it stays current
as connectors are added or removed inside plugins/atlas/mcp/.
"""

import json
import re
import unittest
from pathlib import Path

PLUGINS_ATLAS = Path(__file__).parent.parent
MCP_DIR = PLUGINS_ATLAS / "mcp"
PLUGIN_JSON = PLUGINS_ATLAS / ".claude-plugin" / "plugin.json"
MCP_JSON = PLUGINS_ATLAS / ".mcp.json"

# userConfig interpolation pattern used in this repo's .mcp.json files.
_INTERPOLATION_RE = re.compile(r"\$\{user_config\.([a-z_][a-z0-9_]*)\}")


def _discover_connectors() -> dict[str, Path]:
    """Return a map of connector name -> bundle path for every .mcpb bundle."""
    connectors: dict[str, Path] = {}
    if MCP_DIR.exists():
        for bundle in sorted(MCP_DIR.rglob("*.mcpb")):
            connectors[bundle.stem] = bundle
    return connectors


class TestConnectorsWiring(unittest.TestCase):
    def setUp(self) -> None:
        with PLUGIN_JSON.open() as f:
            self.plugin = json.load(f)
        with MCP_JSON.open() as f:
            self.mcp = json.load(f)
        self.connectors = _discover_connectors()
        self.user_config = self.plugin.get("userConfig", {})
        self.mcp_servers = self.mcp.get("mcpServers", {})

    def test_plugin_json_declares_mcp_servers_reference(self) -> None:
        self.assertEqual(
            self.plugin.get("mcpServers"),
            "./.mcp.json",
            "plugin.json must point at the bundled .mcp.json",
        )

    def test_mcp_json_exists(self) -> None:
        self.assertTrue(MCP_JSON.exists(), f"{MCP_JSON} must exist")

    def test_mcp_json_references_every_bundle(self) -> None:
        missing = sorted(set(self.connectors) - set(self.mcp_servers))
        self.assertEqual(
            missing,
            [],
            "every .mcpb bundle must have a matching mcpServers entry",
        )

    def test_every_mcp_server_has_a_bundle(self) -> None:
        extra = sorted(set(self.mcp_servers) - set(self.connectors))
        self.assertEqual(
            extra,
            [],
            "every mcpServers entry must have a matching .mcpb bundle",
        )

    def test_mcp_server_invokes_department_launch_script(self) -> None:
        for name, bundle in self.connectors.items():
            server = self.mcp_servers[name]
            args = server.get("args", [])
            dept = bundle.parent.name
            expected_script = f"${{CLAUDE_PLUGIN_ROOT}}/mcp/{dept}/launch.sh"
            self.assertEqual(
                args[0],
                expected_script,
                f"{name}: launch script must be {expected_script}",
            )
            self.assertEqual(
                args[1],
                name,
                f"{name}: launch script arg must be the connector bundle name",
            )
            self.assertTrue(
                isinstance(args[2], str) and args[2],
                f"{name}: launch script must include a non-empty entry path",
            )

    def test_every_interpolated_user_config_key_exists(self) -> None:
        referenced: set[str] = set()
        for name, server in self.mcp_servers.items():
            for value in server.get("env", {}).values():
                for match in _INTERPOLATION_RE.finditer(value):
                    referenced.add(match.group(1))

        missing = sorted(referenced - set(self.user_config))
        self.assertEqual(
            missing,
            [],
            "every ${user_config.<key>} in .mcp.json must be declared in plugin.json",
        )

    def test_every_user_config_key_defaults_to_empty_string(self) -> None:
        bad: list[str] = []
        for key, spec in self.user_config.items():
            default = spec.get("default")
            if default != "":
                bad.append(f"{key}={default!r}")
        self.assertEqual(
            bad,
            [],
            "every connector userConfig key must default to the empty string for inert-by-default",
        )

    def test_user_config_entries_for_every_connector(self) -> None:
        """Each connector's required env vars are backed by userConfig keys."""
        for name, server in self.mcp_servers.items():
            env = server.get("env", {})
            required_envs = {
                k
                for k, v in env.items()
                if k not in {"MCP_TRANSPORT", "LOG_LEVEL"}
                and _INTERPOLATION_RE.search(v)
            }
            for env_key in required_envs:
                config_keys = {
                    m.group(1) for m in _INTERPOLATION_RE.finditer(env[env_key])
                }
                self.assertTrue(
                    config_keys.issubset(set(self.user_config)),
                    f"{name}: env {env_key} references undeclared userConfig key(s) {sorted(config_keys - set(self.user_config))}",
                )


if __name__ == "__main__":
    unittest.main()
