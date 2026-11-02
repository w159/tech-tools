#!/usr/bin/env python3
"""Tests for scripts/check_versions.py: strict semver and drift detection on a copied tree."""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_versions  # noqa: E402

ROOT = check_versions.ROOT


class CheckVersionsTest(unittest.TestCase):
    def make_tree(self, version):
        tmp = Path(tempfile.mkdtemp(prefix="cv-"))
        self.addCleanup(shutil.rmtree, tmp, True)
        (tmp / ".claude-plugin").mkdir()
        market = {"plugins": [{"name": n, "version": version} for n in check_versions.PLUGINS]}
        (tmp / ".claude-plugin/marketplace.json").write_text(json.dumps(market))
        (tmp / "README.md").write_text("Current versions: " + ", ".join(f"{n} {version}" for n in check_versions.PLUGINS) + "\n")
        for n in check_versions.PLUGINS:
            base = tmp / "plugins" / n
            (base / ".claude-plugin").mkdir(parents=True)
            (base / ".claude-plugin/plugin.json").write_text(json.dumps({"version": version}))
            (base / "CHANGELOG.md").write_text(f"# Changelog\n\n## {version}\n\n- x\n")
        return tmp

    def test_real_repo_is_clean(self):
        self.assertEqual(check_versions.check(ROOT)[0], [])

    def test_strict_semver_passes(self):
        self.assertEqual(check_versions.check(self.make_tree("2.2.1"))[0], [])

    def test_leading_zero_and_non_semver_rejected(self):
        for bad in ("2.2.01", "02.2.1", "2.2", "2.2.1-rc1", "v2.2.1"):
            with self.subTest(bad):
                errors = check_versions.check(self.make_tree(bad))[0]
                self.assertTrue(any("strict MAJOR.MINOR.PATCH" in e for e in errors), errors)


if __name__ == "__main__":
    unittest.main()
