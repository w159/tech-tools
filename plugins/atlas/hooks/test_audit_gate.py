import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import unittest  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import completion_gate_core as gate  # noqa: E402


class AuditGateTest(unittest.TestCase):
    def test_atlas_runtime_writes_are_not_shipped_code(self):
        paths = [
            ".atlas/.run/briefs/atlas-audit-2026-11-17.md",
            "/repo/.atlas/evidence/2026-11-17_144853_gate-rerun_043e88.txt",
        ]
        self.assertFalse(gate._nondocs_changed(paths))

    def test_source_edit_still_arms(self):
        paths = [".atlas/.run/x.md", "plugins/atlas/hooks/foo.py"]
        self.assertTrue(gate._nondocs_changed(paths))
        self.assertTrue(gate._nondocs_changed(["/repo/src/app.py"]))


if __name__ == "__main__":
    unittest.main()
