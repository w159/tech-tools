#!/usr/bin/env python3
"""Guard: this marketplace ships Claude Code plugins only — no Kimi dual manifests."""

from __future__ import annotations

import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
PLUGIN_ROOT = Path(__file__).resolve().parents[1]


class NoKimiArtifacts(unittest.TestCase):
    def test_no_plugin_kimi_manifests(self):
        for name in ("atlas", "armada", "programmer"):
            path = REPO / "plugins" / name / ".kimi-plugin"
            self.assertFalse(path.exists(), f"{path} must not exist")

    def test_no_root_kimi_marketplace(self):
        self.assertFalse((REPO / ".kimi-plugin").exists())
        self.assertFalse((REPO / "kimi.plugin.json").exists())

    def test_claude_marketplace_lists_three_plugins_only(self):
        import json

        mp = json.loads((REPO / ".claude-plugin" / "marketplace.json").read_text())
        names = [p["name"] for p in mp["plugins"]]
        self.assertEqual(sorted(names), ["armada", "atlas", "programmer"])
        blob = json.dumps(mp).lower()
        self.assertNotIn("kimi", blob)


if __name__ == "__main__":
    unittest.main()
