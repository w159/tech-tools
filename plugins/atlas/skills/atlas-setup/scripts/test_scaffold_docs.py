import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))

import scaffold_docs  # noqa: E402

DOCS_BASE_SUBFOLDERS = (
    "architecture",
    "decisions",
    "plans",
    "specs",
    "features",
    "lessons",
    "wiki",
)

ATLAS_SUBFOLDERS = (
    "evidence",
    "findings",
    "audits",
    "decisions",
    "archive",
    "understand-anything",
    "graphify",
    "self-improvement",
    "memory",
    "nudge",
    ".run",
)


class TempRepo:
    """A throwaway repo root for scaffold tests."""

    def __enter__(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        return self.root

    def __exit__(self, *exc):
        self._tmp.cleanup()


class FullScaffoldTest(unittest.TestCase):
    def test_creates_full_canonical_tree(self):
        """A clean repo gets root files, the full docs/ tree, and the
        full .atlas/ tree in one pass, with no API signal present."""
        with TempRepo() as root:
            code = scaffold_docs.main(["scaffold_docs.py", str(root)])
            self.assertEqual(code, 0)

            for name in ("README.md", "AGENTS.md", "CLAUDE.md"):
                self.assertTrue((root / name).is_file(), f"missing root {name}")
                self.assertGreater((root / name).stat().st_size, 0)

            docs = root / "docs"
            self.assertTrue((docs / "CHANGELOG.md").is_file())
            self.assertTrue((docs / "ROADMAP.md").is_file())
            self.assertTrue((docs / "AGENTS.md").is_file())
            for name in DOCS_BASE_SUBFOLDERS:
                self.assertTrue((docs / name).is_dir(), f"missing docs/{name}")
                self.assertTrue(
                    (docs / name / "README.md").is_file(),
                    f"missing docs/{name}/README.md",
                )

            # No API signal in a bare temp dir -> not created.
            self.assertFalse((docs / "api").exists())
            self.assertFalse((docs / "endpoints.md").exists())

            atlas = root / ".atlas"
            self.assertTrue((atlas / "CLAUDE.md").is_file())
            self.assertTrue((atlas / "AGENTS.md").is_file())
            self.assertTrue((atlas / "findings" / "INDEX.md").is_file())
            for name in ATLAS_SUBFOLDERS:
                self.assertTrue((atlas / name).is_dir(), f"missing .atlas/{name}")

            self.assertTrue((root / ".gitignore").is_file())

    def test_idempotent_rerun_does_not_overwrite(self):
        """Running twice does not touch content already written; a
        deliberately edited file survives a second run untouched."""
        with TempRepo() as root:
            self.assertEqual(scaffold_docs.main(["scaffold_docs.py", str(root)]), 0)

            marker = (root / "docs" / "CHANGELOG.md").read_text() + "\nCUSTOM ENTRY\n"
            (root / "docs" / "CHANGELOG.md").write_text(marker)

            self.assertEqual(scaffold_docs.main(["scaffold_docs.py", str(root)]), 0)
            self.assertEqual((root / "docs" / "CHANGELOG.md").read_text(), marker)

    def test_repair_fills_in_entries_missing_from_older_scaffold(self):
        """A repo that only has the old minimal docs/.atlas trees (as an
        older scaffold version would have left it) gets repaired: every
        entry now in the canonical set appears, without disturbing what
        was already there."""
        with TempRepo() as root:
            docs = root / "docs"
            docs.mkdir()
            (docs / "CHANGELOG.md").write_text("# CHANGELOG\nold content\n")
            (docs / "ROADMAP.md").write_text("# ROADMAP\nold content\n")
            atlas = root / ".atlas"
            (atlas / "evidence").mkdir(parents=True)
            (atlas / "evidence" / ".gitkeep").touch()

            code = scaffold_docs.main(["scaffold_docs.py", str(root)])
            self.assertEqual(code, 0)

            # Pre-existing content untouched.
            self.assertEqual(
                (docs / "CHANGELOG.md").read_text(), "# CHANGELOG\nold content\n"
            )
            # Missing pieces filled in.
            for name in DOCS_BASE_SUBFOLDERS:
                self.assertTrue((docs / name / "README.md").is_file())
            for name in ATLAS_SUBFOLDERS:
                self.assertTrue((atlas / name).is_dir())
            self.assertTrue((root / "README.md").is_file())
            self.assertTrue((root / "AGENTS.md").is_file())
            self.assertTrue((root / "CLAUDE.md").is_file())

    def test_refuses_over_durable_legacy_atlas_docs(self):
        """The pre-existing legacy .atlas/docs/ guard still blocks."""
        with TempRepo() as root:
            legacy = root / ".atlas" / "docs"
            legacy.mkdir(parents=True)
            (legacy / "CHANGELOG.md").write_text("curated content\n")

            code = scaffold_docs.main(["scaffold_docs.py", str(root)])
            self.assertEqual(code, 1)

    def test_atlas_audits_and_decisions_do_not_trip_wiki_guard(self):
        """.atlas/audits/ and .atlas/decisions/ are legitimate atlas-owned
        names now (distinct from their docs/ namesakes) and must not be
        flagged by the legacy wiki-content-in-.atlas guard."""
        with TempRepo() as root:
            self.assertEqual(scaffold_docs.main(["scaffold_docs.py", str(root)]), 0)
            # Second run must not refuse just because .atlas/audits and
            # .atlas/decisions are now non-empty (they hold a .gitkeep).
            self.assertEqual(scaffold_docs.main(["scaffold_docs.py", str(root)]), 0)

    def test_refuses_over_wiki_content_directly_under_atlas(self):
        """A genuine legacy conflation (e.g. .atlas/architecture/) still
        blocks scaffolding."""
        with TempRepo() as root:
            bad = root / ".atlas" / "architecture"
            bad.mkdir(parents=True)
            (bad / "notes.md").write_text("stray content\n")

            code = scaffold_docs.main(["scaffold_docs.py", str(root)])
            self.assertEqual(code, 1)


class ApiDetectionTest(unittest.TestCase):
    def test_no_signal_means_no_api_docs(self):
        with TempRepo() as root:
            self.assertFalse(scaffold_docs.detect_api(root))

    def test_openapi_file_is_a_signal(self):
        with TempRepo() as root:
            (root / "openapi.yaml").write_text("openapi: 3.0.0\n")
            self.assertTrue(scaffold_docs.detect_api(root))

    def test_routes_directory_is_a_signal(self):
        with TempRepo() as root:
            (root / "routes").mkdir()
            self.assertTrue(scaffold_docs.detect_api(root))

    def test_framework_dependency_is_a_signal(self):
        with TempRepo() as root:
            (root / "package.json").write_text(
                '{"dependencies": {"express": "^4.0.0"}}'
            )
            self.assertTrue(scaffold_docs.detect_api(root))

    def test_detected_api_creates_docs_api_and_endpoints(self):
        with TempRepo() as root:
            (root / "package.json").write_text(
                '{"dependencies": {"fastify": "^4.0.0"}}'
            )
            code = scaffold_docs.main(["scaffold_docs.py", str(root)])
            self.assertEqual(code, 0)
            self.assertTrue((root / "docs" / "api" / "README.md").is_file())
            self.assertTrue((root / "docs" / "endpoints.md").is_file())


class GitignoreTest(unittest.TestCase):
    def test_seeds_gitignore_when_missing(self):
        with TempRepo() as root:
            scaffold_docs.main(["scaffold_docs.py", str(root)])
            gi = root / ".gitignore"
            self.assertTrue(gi.is_file())
            self.assertGreater(gi.stat().st_size, 0)

    def test_leaves_existing_gitignore_untouched(self):
        with TempRepo() as root:
            (root / ".gitignore").write_text("# custom\n*.log\n")
            scaffold_docs.main(["scaffold_docs.py", str(root)])
            self.assertEqual((root / ".gitignore").read_text(), "# custom\n*.log\n")


if __name__ == "__main__":
    unittest.main()
