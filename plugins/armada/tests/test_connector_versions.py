#!/usr/bin/env python3
"""Connector MCP initialize versions must come from each package.json.

A hard-coded version literal in `new McpServer(...)` / `new Server(...)` (or the
cipp config default) drifts every time package.json is bumped. Each connector
must import its own package.json and report `pkg.version`.

    python3 plugins/armada/tests/test_connector_versions.py
"""

import json
import re
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SERVERS = REPO / "mcp_servers"

SEMVER = r"\d+\.\d+\.\d+"
LITERAL = re.compile(r"""version\s*(?::|\|\|)\s*(?:[\w.]+\s*\|\|\s*)?["'](%s)["']""" % SEMVER)
CTOR = re.compile(r"new\s+(?:McpServer|Server)\(")
PKG_IMPORT = re.compile(r"""import\s+pkg\s+from\s+["'](?:\.\./)+package\.json["']""")

# cipp builds its server info in config.ts and hands it to McpServer in mcp/server.ts,
# so the version source is config.ts rather than the constructing file.
VERSION_SOURCE = {"cipp-mcp": ["src/utils/config.ts"]}


def connectors():
    for d in sorted(SERVERS.glob("*-mcp")):
        if d.name == "mcp-gateway" or not (d / "package.json").is_file():
            continue
        yield d


def source_files(d):
    for p in sorted((d / "src").rglob("*.ts")):
        if ".test." in p.name or "__tests__" in p.parts:
            continue
        yield p


class ConnectorVersions(unittest.TestCase):
    def test_no_hardcoded_version_drift(self):
        drift = []
        for d in connectors():
            want = json.loads((d / "package.json").read_text())["version"]
            for p in source_files(d):
                for n, line in enumerate(p.read_text().splitlines(), 1):
                    m = LITERAL.search(line)
                    if m and m.group(1) != want:
                        drift.append(
                            f"{p.relative_to(REPO)}:{n} reports {m.group(1)}, package.json is {want}"
                        )
        self.assertEqual(drift, [], "version drift:\n" + "\n".join(drift))

    def test_server_files_import_package_json(self):
        missing = []
        for d in connectors():
            if d.name in VERSION_SOURCE:
                files = [d / f for f in VERSION_SOURCE[d.name]]
            else:
                files = [p for p in source_files(d) if CTOR.search(p.read_text())]
            self.assertTrue(files, f"{d.name}: no McpServer/Server construction found")
            for p in files:
                text = p.read_text()
                if not PKG_IMPORT.search(text) or "pkg.version" not in text:
                    missing.append(f"{p.relative_to(REPO)} does not report pkg.version from package.json")
        self.assertEqual(missing, [], "\n".join(missing))


if __name__ == "__main__":
    unittest.main()
