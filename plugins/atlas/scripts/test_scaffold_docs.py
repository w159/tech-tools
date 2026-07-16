#!/usr/bin/env python3
"""Tests for scaffold_docs.py -- idempotent no-op, legacy .atlas/docs/ guard,
and the two-tree split (docs/ minimum + .atlas/ full self-improvement surface)."""

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
        # Atlas-internal subdirs must exist (evidence, self-improvement, memory, nudge, .run).
        for d in ("evidence", "self-improvement", "memory", "nudge"):
            self.assertTrue(
                os.path.isdir(os.path.join(self.tmpdir, ".atlas", d)),
                f".atlas/{d}/ must be scaffolded",
            )

    def test_legacy_atlas_docs_blocks_with_error(self):
        """A pre-existing non-empty .atlas/docs/ with durable content must refuse to scaffold."""
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

    def test_legacy_atlas_docs_with_only_run_marker_proceeds(self):
        """A legacy .atlas/docs/ holding only a .run/ marker (ephemeral) must
        NOT block scaffolding -- it is orchestration state, not curated content.
        This is the Bug 1 regression test from the v5.0.1 review."""
        legacy = os.path.join(self.tmpdir, ".atlas", "docs", ".run")
        os.makedirs(legacy, exist_ok=True)
        with open(os.path.join(legacy, "atlas-orchestrate.active"), "w") as fh:
            fh.write("session-1\n")

        code, out, err = self._run_main(self.tmpdir)

        self.assertEqual(code, 0, f"expected exit 0, got {code}; stdout={out}; stderr={err}")
        self.assertTrue(os.path.isdir(os.path.join(self.tmpdir, "docs")),
                        "docs/ should be scaffolded despite ephemeral legacy")

    def test_legacy_atlas_docs_empty_dir_proceeds(self):
        """An empty .atlas/docs/ is not durable content -- scaffold should proceed."""
        os.makedirs(os.path.join(self.tmpdir, ".atlas", "docs"), exist_ok=True)

        code, _, err = self._run_main(self.tmpdir)

        self.assertEqual(code, 0, f"expected exit 0, got {code}; stderr={err}")
        self.assertTrue(os.path.isdir(os.path.join(self.tmpdir, "docs")))

    def test_scaffold_creates_minimal_docs_and_full_atlas(self):
        """Fresh repo: docs/ gets CHANGELOG.md + ROADMAP.md only; .atlas/ gets
        only atlas-internal state (evidence, self-improvement, memory, nudge, .run).
        Project wiki subdirs (architecture, plans, specs, audits, lessons, wiki)
        are NOT pre-created — they grow dynamically in docs/."""
        code, out, err = self._run_main(self.tmpdir)

        self.assertEqual(code, 0, f"expected exit 0, got {code}; stderr={err}")
        # docs/ minimum.
        self.assertTrue(os.path.isfile(os.path.join(self.tmpdir, "docs", "CHANGELOG.md")))
        self.assertTrue(os.path.isfile(os.path.join(self.tmpdir, "docs", "ROADMAP.md")))
        # docs/ should NOT have pre-created subfolders (wiki is dynamic).
        for d in ("architecture", "features", "lessons", "plans", "specs", "wiki", "audits"):
            self.assertFalse(
                os.path.isdir(os.path.join(self.tmpdir, "docs", d)),
                f"docs/{d}/ should not be pre-scaffolded (wiki is dynamic)",
            )
        # .atlas/ internal-only surface.
        for d in ("evidence", "self-improvement", "memory", "nudge", ".run"):
            self.assertTrue(
                os.path.isdir(os.path.join(self.tmpdir, ".atlas", d)),
                f".atlas/{d}/ must be scaffolded",
            )
        # .atlas/ must NOT contain project wiki subdirs.
        for d in ("architecture", "audits", "plans", "specs", "lessons", "wiki"):
            self.assertFalse(
                os.path.isdir(os.path.join(self.tmpdir, ".atlas", d)),
                f".atlas/{d}/ must not be scaffolded (project wiki goes in docs/)",
            )

    def test_no_atlas_internal_dirs_in_docs(self):
        """After scaffolding, no atlas-internal subdirs must exist under docs/."""
        code, _, err = self._run_main(self.tmpdir)
        self.assertEqual(code, 0, f"expected exit 0, got {code}; stderr={err}")
        for d in ("evidence", ".run", "self-improvement", "nudge", "memory"):
            self.assertFalse(
                os.path.isdir(os.path.join(self.tmpdir, "docs", d)),
                f"docs/{d}/ must not exist -- atlas-internal content goes in .atlas/{d}/",
            )

    def test_wiki_content_in_atlas_blocks_scaffold(self):
        """Project wiki subdirs under .atlas/ must block scaffolding."""
        # Create .atlas/architecture/ with content
        wiki_dir = os.path.join(self.tmpdir, ".atlas", "architecture")
        os.makedirs(wiki_dir, exist_ok=True)
        with open(os.path.join(wiki_dir, "skills-mastery.md"), "w") as fh:
            fh.write("# Architecture\n")
        # Also need docs/ to exist so the guard is what fires, not docs/ scaffold
        os.makedirs(os.path.join(self.tmpdir, "docs"), exist_ok=True)

        code, out, err = self._run_main(self.tmpdir)

        self.assertEqual(code, 1, f"expected exit 1, got {code}; stdout={out}")
        self.assertIn("project wiki content", err.lower())
        self.assertIn("architecture", err)


if __name__ == "__main__":
    unittest.main()