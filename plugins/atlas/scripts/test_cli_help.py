#!/usr/bin/env python3
"""--help / -h prints usage and exits 0 without running the command (S5)."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = (
    "release_notes.py",
    "lint_docs_names.py",
    "atlas_control.py",
    "atlas_herdr.py",
    "atlas_rig.py",
)


class CliHelpTest(unittest.TestCase):
    def test_help_prints_usage_and_exits_zero(self):
        for script in SCRIPTS:
            for flag in ("--help", "-h"):
                with tempfile.TemporaryDirectory() as home:
                    proc = subprocess.run(
                        [sys.executable, os.path.join(HERE, script), flag],
                        capture_output=True,
                        text=True,
                        cwd=home,
                        env={**os.environ, "HOME": home},
                        timeout=30,
                    )
                self.assertEqual(proc.returncode, 0, (script, flag, proc.stderr))
                self.assertIn("usage:", proc.stdout, (script, flag))
                self.assertNotIn("naming OK", proc.stdout)


if __name__ == "__main__":
    unittest.main()
