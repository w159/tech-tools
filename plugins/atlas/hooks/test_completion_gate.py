import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from completion_gate import _docs_drift


class DocsDriftTest(unittest.TestCase):
    def test_non_docs_only_returns_true(self):
        """Non-docs changes with no docs changes -> drift detected."""
        self.assertTrue(_docs_drift(["src/foo.py", "README.md"]))

    def test_docs_change_present_returns_false(self):
        """Any docs/ path in the list -> no drift."""
        self.assertFalse(_docs_drift(["src/foo.py", "docs/CHANGELOG.md"]))

    def test_only_docs_path_returns_false(self):
        """Only docs/ paths -> no drift."""
        self.assertFalse(_docs_drift(["docs/ROADMAP.md"]))

    def test_nested_docs_path_returns_false(self):
        """A path containing /docs/ counts as a docs path."""
        self.assertFalse(_docs_drift(["plugins/atlas/docs/features.md"]))

    def test_empty_list_returns_false(self):
        """Empty input -> no drift (nothing changed)."""
        self.assertFalse(_docs_drift([]))


if __name__ == "__main__":
    unittest.main()
