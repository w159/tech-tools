"""Golden-frame test: atlas_tui --once on fixtures/colony_snap.json at three sizes.

Later Colony TUI stages change frames on purpose; regenerate with
ATLAS_GOLDEN_UPDATE=1 python3 -m unittest test_colony_golden
"""

import os
import re
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)

FIX = HERE / "fixtures" / "colony_snap.json"
GOLD = HERE / "fixtures" / "golden"
SIZES = [(100, 30), (60, 18), (160, 48)]
STAMP = re.compile(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC")


def frame(w, h):
    out = subprocess.run(
        [sys.executable, str(HERE / "atlas_tui.py"), "--once", "--fixture", str(FIX),
         "--width", str(w), "--height", str(h)],
        capture_output=True, text=True, check=True, timeout=60,
    ).stdout
    lines = [x.rstrip() for x in out.splitlines()]
    lines[0] = STAMP.sub("<TS>", lines[0])
    return "\n".join(lines) + "\n"


class Golden(unittest.TestCase):
    pass


def _make(w, h):
    def t(self):
        path = GOLD / f"colony_{w}x{h}.txt"
        got = frame(w, h)
        if os.environ.get("ATLAS_GOLDEN_UPDATE") == "1":
            path.write_text(got)
        self.assertTrue(path.exists(), f"missing {path}; run with ATLAS_GOLDEN_UPDATE=1")
        self.assertEqual(got, path.read_text(), f"{path.name} drifted; ATLAS_GOLDEN_UPDATE=1 to accept")
    return t


for _w, _h in SIZES:
    setattr(Golden, f"test_{_w}x{_h}", _make(_w, _h))

if __name__ == "__main__":
    unittest.main()
