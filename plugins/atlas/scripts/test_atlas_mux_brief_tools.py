#!/usr/bin/env python3
"""The member brief tells every worker the allowed read and shell routes up front."""

import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import _test_isolation  # noqa: F401,E402
import atlas_mux  # noqa: E402


class BriefToolRouteTests(unittest.TestCase):
    def _brief(self, harness):
        member = {"name": "w1", "role": "implementer", "harness": harness}
        rec = {"team_id": "t", "task": "x", "file_scope": [], "members": [member]}
        return atlas_mux.team_brief(rec, member, "/proj", "chan", "lead")

    def test_brief_names_read_and_shell_routes_for_every_harness(self):
        for harness in ("claude", "omp", "codex"):
            with self.subTest(harness=harness):
                brief = self._brief(harness)
                self.assertIn("Read big files in ranges", brief)
                self.assertIn("use lean-ctx, not shell, to read", brief)
                self.assertEqual(brief.count("in ranges"), 1)


if __name__ == "__main__":
    unittest.main()
