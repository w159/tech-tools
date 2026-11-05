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


class VersionKey(unittest.TestCase):
    """_version_key orders version directory names; digits are numbers, the rest text."""

    def _sorted(self, names):
        return sorted(names, key=armada_root._version_key)

    def test_numeric_parts_compare_as_numbers(self):
        self.assertEqual(
            self._sorted(["1.10.0", "1.9.0", "1.2.0"]), ["1.2.0", "1.9.0", "1.10.0"]
        )

    def test_a_numeric_part_outranks_a_text_part_in_the_same_slot(self):
        # "0" must beat "a": a mutated flag would tie them on the leading element
        self.assertEqual(self._sorted(["1.0.0", "1.0.a"]), ["1.0.a", "1.0.0"])
        self.assertGreater(
            armada_root._version_key("1.0.0"), armada_root._version_key("1.0.a")
        )

    def test_text_parts_compare_lexically(self):
        self.assertEqual(self._sorted(["1.0.b", "1.0.a"]), ["1.0.a", "1.0.b"])

    def test_prerelease_suffix_sorts_before_nothing_after_core(self):
        # the longer tuple wins when the shared prefix is equal
        self.assertLess(
            armada_root._version_key("1.0.0"), armada_root._version_key("1.0.0-rc1")
        )

    def test_separators_dot_dash_plus_all_split(self):
        self.assertEqual(
            armada_root._version_key("1.2-3+4"),
            armada_root._version_key("1.2.3.4"),
        )

    def test_zero_is_a_digit_part_not_text(self):
        # "0" and "00" are both numeric zero and tie
        self.assertEqual(armada_root._version_key("0"), armada_root._version_key("00"))


class IsPluginDir(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)

    def test_true_only_with_manifest_file(self):
        self.assertIs(armada_root._is_plugin_dir(_plugin(self.tmp / "p")), True)
        (self.tmp / "q").mkdir()
        self.assertIs(armada_root._is_plugin_dir(self.tmp / "q"), False)

    def test_manifest_that_is_a_directory_is_not_a_plugin(self):
        (self.tmp / "r" / ".claude-plugin" / "plugin.json").mkdir(parents=True)
        self.assertIs(armada_root._is_plugin_dir(self.tmp / "r"), False)

    def test_oserror_while_probing_means_false_not_a_crash(self):
        from unittest import mock

        with mock.patch.object(Path, "is_file", side_effect=OSError("denied")):
            self.assertIs(armada_root._is_plugin_dir(self.tmp), False)

    def test_unreadable_cache_dir_yields_none_with_reason(self):
        from unittest import mock

        atlas = _plugin(self.tmp / "cache" / "atlas" / "1.0.0", "atlas")
        (self.tmp / "cache" / "armada").mkdir()
        with mock.patch.object(Path, "iterdir", side_effect=OSError("denied")):
            root, reason = armada_root.find_armada_root(atlas)
        self.assertIsNone(root)
        self.assertIn("armada plugin not found", reason)

    def test_default_root_is_this_plugin(self):
        root, _ = armada_root.find_armada_root()
        self.assertEqual(root, SCRIPTS.parent.parent / "armada")


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
