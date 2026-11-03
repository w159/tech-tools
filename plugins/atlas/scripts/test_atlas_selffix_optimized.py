#!/usr/bin/env python3
"""atlas_selffix._set must enforce its column allowlist even under `python -O` (asserts stripped)."""

import _test_isolation  # noqa: F401
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent

CODE = """
import sys
sys.path.insert(0, %r)
import atlas_db, atlas_selffix as sf
conn = atlas_db.connect(sys.argv[1])
atlas_db.init(conn)
fid = atlas_db.upsert_finding(conn, "m:c", title="orig", severity="MED")
try:
    sf._set(conn, fid, "failed", **{"title='pwned', fix_branch": "x"})
except AssertionError:
    pass
print(atlas_db.get_finding(conn, fid)["title"])
"""


class SetAllowlistUnderOptimizeTests(unittest.TestCase):
    def test_unknown_column_rejected_with_python_O(self):
        with tempfile.TemporaryDirectory() as t:
            env = {**os.environ, "HOME": t}
            r = subprocess.run(
                [sys.executable, "-O", "-c", CODE % str(HERE), os.path.join(t, "t.db")],
                capture_output=True, text=True, env=env, timeout=60,
            )
            self.assertEqual(r.stdout.strip(), "orig", r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
