"""armada_root.find_armada_root: where the dashboard and control plane find the connectors."""

import _test_isolation  # noqa: F401  (must be first)
import json
import tempfile
import unittest
from pathlib import Path

import armada_root

SCRIPTS = Path(__file__).resolve().parent


def _plugin(path: Path, name: str = "armada") -> Path:
    (path / ".claude-plugin").mkdir(parents=True)
    (path / ".claude-plugin" / "plugin.json").write_text(json.dumps({"name": name}))
    return path


class ArmadaRoot(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)

    def test_source_layout_finds_the_sibling_plugin(self):
        atlas = _plugin(self.tmp / "plugins" / "atlas", "atlas")
        armada = _plugin(self.tmp / "plugins" / "armada")
        root, reason = armada_root.find_armada_root(atlas)
        self.assertEqual(root, armada)
        self.assertEqual(reason, "")

    def test_cache_layout_picks_the_highest_version(self):
        base = self.tmp / "cache" / "tech-tools"
        atlas = _plugin(base / "atlas" / "15.0.0", "atlas")
        for v in ("1.2.0", "1.10.0", "1.9.9"):
            _plugin(base / "armada" / v)
        (base / "armada" / "9.9.9").mkdir()  # no manifest: not an install
        root, reason = armada_root.find_armada_root(atlas)
        self.assertEqual(
            root, base / "armada" / "1.10.0"
        )  # numeric, not lexical, order
        self.assertEqual(reason, "")

    def test_source_layout_wins_over_a_cache_lookalike(self):
        atlas = _plugin(self.tmp / "plugins" / "atlas", "atlas")
        armada = _plugin(self.tmp / "plugins" / "armada")
        _plugin(self.tmp / "armada" / "9.0.0")
        self.assertEqual(armada_root.find_armada_root(atlas)[0], armada)

    def test_missing_armada_returns_none_with_a_reason(self):
        atlas = _plugin(self.tmp / "plugins" / "atlas", "atlas")
        root, reason = armada_root.find_armada_root(atlas)
        self.assertIsNone(root)
        self.assertIn("armada", reason)
        self.assertIn("install", reason)

    def test_a_directory_without_a_manifest_is_not_armada(self):
        atlas = _plugin(self.tmp / "plugins" / "atlas", "atlas")
        (self.tmp / "plugins" / "armada").mkdir()
        self.assertIsNone(armada_root.find_armada_root(atlas)[0])

    def test_this_repo_resolves_to_plugins_armada(self):
        root, reason = armada_root.find_armada_root(SCRIPTS.parent)
        self.assertEqual(root, SCRIPTS.parent.parent / "armada")
        self.assertEqual(reason, "")


class DashboardWithoutArmada(unittest.TestCase):
    """No armada install: an empty connector list with a reason, never a crash."""

    def test_connector_status_is_empty_and_explains_why(self):
        from unittest import mock

        import atlas_control
        import atlas_dashboard as d

        none = (None, "armada plugin not found beside atlas")
        with mock.patch.object(armada_root, "find_armada_root", return_value=none):
            self.assertEqual(d._mcp_json(), {})
            self.assertEqual(d._connector_manifest(), {})
            self.assertEqual(d._connector_status(), [])
            self.assertIn("armada", d.connectors_unavailable_reason())
            self.assertEqual(d._connector_env("auvik"), {})
            entry, argv = atlas_control.connector_entry("auvik")
            self.assertIsNone(argv)
            self.assertFalse(entry.exists())


if __name__ == "__main__":
    unittest.main()
