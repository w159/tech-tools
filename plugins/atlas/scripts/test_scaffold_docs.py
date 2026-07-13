#!/usr/bin/env python3
"""Tests for scaffold_docs.py — abort gate and dual-SSOT warning."""

import contextlib
import io
import os
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
        import shutil

        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _run_main(self, docs_root):
        """Invoke scaffold_docs.main targeting docs_root, capturing streams."""
        out = io.StringIO()
        err = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = scaffold_docs.main(["scaffold_docs.py", str(docs_root)])
        return code, out.getvalue(), err.getvalue()

    def test_existing_ssot_is_noop_without_overwrite(self):
        """A non-empty .atlas/docs/ must be a true no-op: exit 0, no re-scaffold."""
        docs_root = os.path.join(self.tmpdir, ".atlas", "docs")
        os.makedirs(docs_root, exist_ok=True)
        marker = "DISTINCTIVE ORIGINAL CHANGELOG CONTENT\n"
        changelog = os.path.join(docs_root, "CHANGELOG.md")
        with open(changelog, "w") as fh:
            fh.write(marker)

        code, out, err = self._run_main(docs_root)

        self.assertEqual(code, 0, f"expected exit 0, got {code}; stderr={err}")
        with open(changelog) as fh:
            after = fh.read()
        self.assertEqual(after, marker, "existing CHANGELOG.md was modified")
        self.assertIn("already scaffolded", out.lower())

    def test_dual_ssot_warning_to_stderr(self):
        """A root docs/ with SSOT markers must emit a dual-SSOT warning to stderr."""
        root_docs = os.path.join(self.tmpdir, "docs")
        os.makedirs(root_docs, exist_ok=True)
        for name in ("CHANGELOG.md", "ROADMAP.md", "AGENTS.md"):
            with open(os.path.join(root_docs, name), "w") as fh:
                fh.write(f"# root {name}\n")

        # .atlas/docs/ does not exist yet -> scaffold proceeds, with warning.
        docs_root = os.path.join(self.tmpdir, ".atlas", "docs")

        code, out, err = self._run_main(docs_root)

        self.assertEqual(code, 0, f"expected exit 0, got {code}; stdout={out}")
        self.assertIn(
            "dual", err.lower(), f"expected dual-SSOT warning on stderr; got: {err}"
        )
        # Warning must name the root docs/ tree so the operator can reconcile.
        self.assertIn("docs", err.lower())


if __name__ == "__main__":
    unittest.main()
