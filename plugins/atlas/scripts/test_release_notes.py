import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import _test_isolation  # noqa: F401  (redirects ~/.atlas to a tempdir)

SCRIPT = Path(__file__).with_name("release_notes.py")
LOG = """# Changelog

## 2.0.0 - 2026-02-01 (unreleased)

draft

## 1.1.0 - 2026-01-02

### Added

- b

## 1.0.0 - 2026-01-01

- a
"""


def run(version, text=LOG):
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "CHANGELOG.md"
        p.write_text(text, encoding="utf-8")
        r = subprocess.run([sys.executable, str(SCRIPT), version, str(p)],
                           capture_output=True, text=True)
    return r.returncode, r.stdout


class ReleaseNotes(unittest.TestCase):
    def test_middle_section_only(self):
        rc, out = run("1.1.0")
        self.assertEqual(rc, 0)
        self.assertIn("- b", out)
        self.assertNotIn("- a", out)
        self.assertNotIn("##", out.replace("###", ""))

    def test_last_section(self):
        self.assertEqual(run("1.0.0"), (0, "- a\n"))

    def test_top_section_when_released(self):
        rc, out = run("2.0.0", LOG.replace(" (unreleased)", ""))
        self.assertEqual((rc, out), (0, "draft\n"))

    def test_unreleased_exits_2(self):
        self.assertEqual(run("2.0.0")[0], 2)

    def test_missing_exits_2(self):
        self.assertEqual(run("9.9.9")[0], 2)

    def test_prefix_version_not_matched(self):
        self.assertEqual(run("1.1")[0], 2)


if __name__ == "__main__":
    unittest.main()
