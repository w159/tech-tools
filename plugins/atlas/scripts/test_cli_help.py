#!/usr/bin/env python3
"""--help / -h prints usage and exits 0 without running the command (S5)."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest

import _test_isolation  # noqa: F401  (redirects ~/.atlas to a tempdir)

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


def _cli_scripts():
    """Every scripts/*.py that can run as a program (same rule as the feature bench: it has a __main__ guard)."""
    out = []
    for name in sorted(os.listdir(HERE)):
        if not name.endswith(".py") or name.startswith("test_"):
            continue
        with open(os.path.join(HERE, name), encoding="utf-8", errors="replace") as fh:
            if "__main__" in fh.read():
                out.append(name)
    return out


class CliHelpSweepTest(unittest.TestCase):
    """No CLI script may run its default action, or fail, when asked for --help."""

    def test_every_cli_script_prints_a_usage_screen_and_exits_zero(self):
        scripts = _cli_scripts()
        self.assertGreater(len(scripts), 40)
        bad = []
        for script in scripts:
            with tempfile.TemporaryDirectory() as home:
                proc = subprocess.run(
                    [sys.executable, os.path.join(HERE, script), "--help"],
                    capture_output=True,
                    text=True,
                    cwd=home,
                    env={**os.environ, "HOME": home},
                    timeout=60,
                )
                stray = os.listdir(home)
            usage = "usage:" in proc.stdout.lower()
            if proc.returncode != 0 or not usage or stray:
                bad.append((script, proc.returncode, usage, stray, proc.stderr[-120:]))
        self.assertEqual(bad, [])


if __name__ == "__main__":
    unittest.main()
