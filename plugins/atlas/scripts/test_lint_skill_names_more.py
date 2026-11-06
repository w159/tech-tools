#!/usr/bin/env python3
"""Extra tests for lint_skill_names.py: skip rules must skip only the skipped
entry and keep scanning the remaining (sorted) entries."""

import _test_isolation  # noqa: F401,E402
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
from test_lint_skill_names_unit import _run_under_mock  # noqa: E402


class SkipRulesTest(unittest.TestCase):
    def test_plain_file_before_bad_dir_does_not_stop_scan(self):
        out, exc = _run_under_mock(["0-readme.md", "bad"], {"bad"})
        self.assertIsNotNone(exc)
        self.assertEqual(exc.code, 1)
        self.assertIn("NON-CONFORMANT: ['bad']", out)

    def test_plain_file_alone_is_ignored(self):
        out, exc = _run_under_mock(["Not-A-Skill.md"], set())
        self.assertIsNone(exc)
        self.assertIn("all skill names conform", out)

    def test_docs_dir_is_skipped_and_scan_continues(self):
        out, exc = _run_under_mock(["bad", "docs"], {"bad", "docs"})
        self.assertEqual(exc.code, 1)
        self.assertIn("['bad']", out)
        self.assertNotIn("docs", out)

    def test_docs_dir_alone_is_not_flagged(self):
        out, exc = _run_under_mock(["docs"], {"docs"})
        self.assertIsNone(exc)

    def test_hidden_dir_alone_is_not_flagged(self):
        out, exc = _run_under_mock([".ruff_cache"], {".ruff_cache"})
        self.assertIsNone(exc)
        self.assertIn("all skill names conform", out)

    def test_hidden_dir_skipped_and_scan_continues(self):
        # ".z" sorts before "zbad"; both are dirs
        out, exc = _run_under_mock([".z", "zbad"], {".z", "zbad"})
        self.assertEqual(exc.code, 1)
        self.assertIn("['zbad']", out)
        self.assertNotIn(".z", out)

    def test_docs_prefixed_name_is_not_exempt(self):
        out, exc = _run_under_mock(["docs-extra"], {"docs-extra"})
        self.assertEqual(exc.code, 1)
        self.assertIn("docs-extra", out)

    def test_multiple_bad_reported_in_sorted_order(self):
        out, exc = _run_under_mock(["zzz", "atlas-ok", "aaa"],
                                   {"zzz", "atlas-ok", "aaa"})
        self.assertIn("['aaa', 'zzz']", out)


if __name__ == "__main__":
    unittest.main()
