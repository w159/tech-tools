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


class ToolingBlockTest(unittest.TestCase):
    """ensure_tooling_block: insert / replace / skip-on-ambiguity, and the
    full main() propagation of the block into AGENTS.md + CLAUDE.md."""

    NEW_BLOCK = "<!-- atlas-tooling -->\nNEW BLOCK\n<!-- /atlas-tooling -->"

    def test_inserts_when_absent(self):
        with TempRepo() as root:
            path = root / "AGENTS.md"
            path.write_text("# AGENTS.md\nexisting content\n")
            status = scaffold_docs.ensure_tooling_block(path, self.NEW_BLOCK)
            self.assertIn("inserted", status)
            text = path.read_text()
            self.assertIn("existing content", text)
            self.assertIn(self.NEW_BLOCK, text)

    def test_replaces_existing_well_formed_pair(self):
        with TempRepo() as root:
            path = root / "AGENTS.md"
            path.write_text(
                "# AGENTS.md\nkeep me\n"
                "<!-- atlas-tooling -->\nOLD BLOCK\n<!-- /atlas-tooling -->\n"
                "keep me too\n"
            )
            status = scaffold_docs.ensure_tooling_block(path, self.NEW_BLOCK)
            self.assertIn("updated", status)
            text = path.read_text()
            self.assertIn("keep me\n", text)
            self.assertIn("keep me too", text)
            self.assertIn("NEW BLOCK", text)
            self.assertNotIn("OLD BLOCK", text)

    def test_idempotent_on_rerun(self):
        with TempRepo() as root:
            path = root / "AGENTS.md"
            path.write_text("# AGENTS.md\n")
            scaffold_docs.ensure_tooling_block(path, self.NEW_BLOCK)
            before = path.read_text()
            status = scaffold_docs.ensure_tooling_block(path, self.NEW_BLOCK)
            self.assertIn("unchanged", status)
            self.assertEqual(path.read_text(), before)
            self.assertEqual(before.count("<!-- atlas-tooling -->"), 1)

    def test_skips_and_preserves_content_on_orphan_start_marker(self):
        # Regression: an unpaired START earlier in the file (e.g. quoted in
        # a doc example) followed by a real, later pair used to make the
        # naive first-START/first-END replace delete everything in between,
        # including real user content and the legitimate block.
        with TempRepo() as root:
            path = root / "AGENTS.md"
            original = (
                "# AGENTS.md\n"
                "Some doc text showing an example:\n"
                "<!-- atlas-tooling -->\n"
                "IMPORTANT USER CONTENT THAT MUST SURVIVE\n"
                "<!-- atlas-tooling -->\n"
                "old block\n"
                "<!-- /atlas-tooling -->\n"
                "tail content\n"
            )
            path.write_text(original)
            status = scaffold_docs.ensure_tooling_block(path, self.NEW_BLOCK)
            self.assertIn("SKIP", status)
            self.assertEqual(path.read_text(), original)

    def test_skips_on_unpaired_end_marker(self):
        with TempRepo() as root:
            path = root / "AGENTS.md"
            original = "# AGENTS.md\nstray <!-- /atlas-tooling --> with no start\n"
            path.write_text(original)
            status = scaffold_docs.ensure_tooling_block(path, self.NEW_BLOCK)
            self.assertIn("SKIP", status)
            self.assertEqual(path.read_text(), original)

    def test_main_propagates_block_into_agents_and_claude_md(self):
        with TempRepo() as root:
            rc = scaffold_docs.main(["scaffold_docs.py", str(root)])
            self.assertEqual(rc, 0)
            agents = (root / "AGENTS.md").read_text()
            claude = (root / "CLAUDE.md").read_text()
            self.assertIn(scaffold_docs.TOOLING_MARKER_START, agents)
            self.assertIn(scaffold_docs.TOOLING_MARKER_END, agents)
            self.assertIn(scaffold_docs.TOOLING_MARKER_START, claude)
            self.assertIn(scaffold_docs.TOOLING_MARKER_END, claude)

    def test_main_preserves_preexisting_hand_written_agents_md(self):
        with TempRepo() as root:
            (root / "AGENTS.md").write_text(
                "# AGENTS.md\nHand-written project rules, pre-dating atlas-setup.\n"
            )
            scaffold_docs.main(["scaffold_docs.py", str(root)])
            text = (root / "AGENTS.md").read_text()
            self.assertIn("Hand-written project rules", text)
            self.assertIn(scaffold_docs.TOOLING_MARKER_START, text)



if __name__ == "__main__":
    unittest.main()
