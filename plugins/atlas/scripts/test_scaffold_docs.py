#!/usr/bin/env python3
"""Tests for scaffold_docs.py -- idempotent no-op and legacy .atlas/docs/ guard."""

import contextlib
import io
import os
import shutil
import sys
import tempfile
import unittest

# Import scaffold_docs from the atlas-setup skill scripts dir.
sys.path.insert(
    0,
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "skills",
        "atlas-setup",
        "scripts",
    ),
)
import scaffold_docs  # noqa: E402


class TestScaffoldDocsAbortGate(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _run_main(self, repo_root):
        """Invoke scaffold_docs.main targeting repo_root, capturing streams."""
        out = io.StringIO()
        err = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = scaffold_docs.main(["scaffold_docs.py", str(repo_root)])
        return code, out.getvalue(), err.getvalue()

    def test_existing_docs_is_noop_without_overwrite(self):
        """A non-empty docs/ must be a true no-op: exit 0, no re-scaffold."""
        docs_root = os.path.join(self.tmpdir, "docs")
        os.makedirs(docs_root, exist_ok=True)
        marker = "DISTINCTIVE ORIGINAL CHANGELOG CONTENT\n"
        changelog = os.path.join(docs_root, "CHANGELOG.md")
        with open(changelog, "w") as fh:
            fh.write(marker)

        code, out, err = self._run_main(self.tmpdir)

        self.assertEqual(code, 0, f"expected exit 0, got {code}; stderr={err}")
        with open(changelog) as fh:
            after = fh.read()
        self.assertEqual(after, marker, "existing CHANGELOG.md was modified")
        self.assertIn("already scaffolded", out.lower())

    def test_never_creates_atlas_docs(self):
        """Scaffolding must never create a .atlas/docs/ directory."""
        code, _, err = self._run_main(self.tmpdir)

        self.assertEqual(code, 0, f"expected exit 0, got {code}; stderr={err}")
        legacy = os.path.join(self.tmpdir, ".atlas", "docs")
        self.assertFalse(os.path.isdir(legacy), ".atlas/docs/ must never be created")
        self.assertTrue(os.path.isdir(os.path.join(self.tmpdir, "docs")))
        self.assertTrue(os.path.isdir(os.path.join(self.tmpdir, ".atlas", "evidence")))
        self.assertTrue(os.path.isdir(os.path.join(self.tmpdir, ".atlas", "audits")))

    def test_legacy_atlas_docs_blocks_with_error(self):
        """A pre-existing non-empty .atlas/docs/ must refuse to scaffold, not silently proceed."""
        legacy = os.path.join(self.tmpdir, ".atlas", "docs")
        os.makedirs(legacy, exist_ok=True)
        with open(os.path.join(legacy, "CHANGELOG.md"), "w") as fh:
            fh.write("# stale legacy changelog\n")

        code, out, err = self._run_main(self.tmpdir)

        self.assertEqual(code, 1, f"expected exit 1, got {code}; stdout={out}")
        self.assertIn("legacy", err.lower())
        self.assertIn(".atlas/docs", err.replace(os.sep, "/"))
        # Must not have scaffolded docs/ while blocked.
        self.assertFalse(os.path.isdir(os.path.join(self.tmpdir, "docs")))


if __name__ == "__main__":
    unittest.main()
