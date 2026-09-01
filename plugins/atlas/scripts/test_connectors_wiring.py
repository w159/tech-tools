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
    """Return a map of connector name -> vendored entry point.

    Node connectors ship a single ESM bundle (mcp/<name>/server.mjs); Python
    connectors ship a vendored source tree with its own pyproject.toml.
    """
    connectors: dict[str, Path] = {}
    if MCP_DIR.exists():
        for bundle in sorted(MCP_DIR.glob("*/server.mjs")):
            connectors[bundle.parent.name] = bundle
        for project in sorted(MCP_DIR.glob("*/pyproject.toml")):
            connectors.setdefault(project.parent.name, project)
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
            "every vendored connector must have a matching mcpServers entry",
        )

    def test_every_mcp_server_has_a_bundle(self) -> None:
        extra = sorted(set(self.mcp_servers) - set(self.connectors))
        self.assertEqual(
            extra,
            [],
            "every mcpServers entry must have a vendored mcp/<name>/ entry point",
        )

    def test_connectors_are_discoverable_at_all(self) -> None:
        """Guard against a discovery bug making every bundle test vacuous."""
        self.assertTrue(
            self.connectors,
            f"no connector bundles discovered under {MCP_DIR}; discovery is broken",
        )

    def test_mcp_server_runs_vendored_bundle_through_env_preloader(self) -> None:
        for name, entry in self.connectors.items():
            server = self.mcp_servers[name]
            if entry.name == "server.mjs":
                self.assertEqual(
                    server.get("command"),
                    "node",
                    f"{name}: vendored ESM bundles are launched with node",
                )
                self.assertEqual(
                    server.get("args"),
                    [
                        "--import",
                        "${CLAUDE_PLUGIN_ROOT}/mcp/_env/load.mjs",
                        f"${{CLAUDE_PLUGIN_ROOT}}/mcp/{name}/server.mjs",
                    ],
                    f"{name}: must preload the env loader, then run its own server.mjs",
                )
                continue
            # Python connector: uv resolves the vendored project's own pinned
            # dependencies, then the Python preloader runs its server module.
            self.assertEqual(
                server.get("command"),
                "uv",
                f"{name}: vendored Python connectors are launched with uv",
            )
            args = server.get("args") or []
            self.assertEqual(
                args[:5],
                [
                    "run",
                    "--project",
                    f"${{CLAUDE_PLUGIN_ROOT}}/mcp/{name}",
                    "python",
                    "${CLAUDE_PLUGIN_ROOT}/mcp/_env/load.py",
                ],
                f"{name}: must run its vendored project through the Python env preloader",
            )
            self.assertEqual(
                len(args), 6, f"{name}: preloader takes exactly one module argument"
            )

    def test_every_interpolated_user_config_key_exists(self) -> None:
        referenced: set[str] = set()
        for server in self.mcp_servers.values():
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
