#!/usr/bin/env python3
"""The suite runs inside one private temp dir (plugins/atlas/conftest.py) that is removed at session end, so
fixtures and gettempdir()-derived product paths (atlas-contract-gate, atlas-autonames) never accumulate in /tmp."""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import _test_isolation  # noqa: F401,E402
sys.path.insert(0, str(HERE.parent))
import conftest  # noqa: E402

sys.path.insert(0, str(HERE.parent / "hooks"))


class TmpHygieneTests(unittest.TestCase):
    def test_tempdir_is_the_private_session_dir(self):
        self.assertEqual(tempfile.gettempdir(), conftest.SESSION_TMP)
        self.assertEqual(os.environ["TMPDIR"], conftest.SESSION_TMP)
        self.assertTrue(os.path.isdir(conftest.SESSION_TMP))

    def test_mkdtemp_lands_inside_it(self):
        d = tempfile.mkdtemp()
        self.addCleanup(os.rmdir, d)
        self.assertEqual(Path(d).parent, Path(conftest.SESSION_TMP))

    def test_child_processes_inherit_it(self):
        out = subprocess.run(
            [sys.executable, "-c", "import tempfile;print(tempfile.gettempdir())"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        self.assertEqual(out, conftest.SESSION_TMP)

    def test_product_marker_dirs_default_under_it(self):
        import completion_gate_core as core

        if not os.environ.get("ATLAS_CONTRACT_GATE_DIR"):
            self.assertTrue(core.CONTRACT_GATE_MARKER_DIR.startswith(conftest.SESSION_TMP))


if __name__ == "__main__":
    unittest.main()
