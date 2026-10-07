"""The OS temp root must never hold a `.atlas` marker: every project-root walk from a temp dir
(find_root in atlas_db / atlas_finding / atlas_todo) treats an ancestor `.atlas` as the project, so one
stray `$TMPDIR/.atlas` makes every temp-dir fixture resolve to the wrong root.

Cause that was fixed: omp/worker-report.test.ts passed the bare temp root as cwd to the channel code, which
created `.atlas/.run/channels.json` (channel named after the dir: "T") in the temp root.
"""

import os
import re
import tempfile
import unittest
from pathlib import Path

import _test_isolation  # noqa: F401  (redirects ~/.atlas to a tempdir)

PLUGIN = Path(__file__).resolve().parent.parent
BARE_TMP_CWD = re.compile(
    r"cwd\s*[:=]\s*(?:os\.)?tmpdir\(\)|cwd\s*=\s*tempfile\.gettempdir\(\)"
)


class TmpRootMarkerTest(unittest.TestCase):
    def test_no_marker_in_temp_roots(self):
        for root in {
            tempfile.gettempdir(),
            os.path.realpath(tempfile.gettempdir()),
            "/tmp",  # noqa: S108  (the literal path is the point: it must hold no marker)
        }:
            self.assertFalse(
                os.path.exists(os.path.join(root, ".atlas")), f"stray marker in {root}"
            )

    def test_no_test_uses_the_bare_temp_root_as_cwd(self):
        offenders = []
        for pattern in ("omp/*.test.ts", "hooks/test_*.py", "scripts/test_*.py"):
            for f in PLUGIN.glob(pattern):
                for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
                    if BARE_TMP_CWD.search(line) and "pwd" not in line:
                        offenders.append(f"{f.relative_to(PLUGIN)}:{n}")
        self.assertEqual(
            offenders, [], "use mkdtemp(), not the temp root itself, as a test cwd"
        )


if __name__ == "__main__":
    unittest.main()
