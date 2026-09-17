#!/usr/bin/env python3
"""Tests for docs conformance: date-first naming, the fixer, and structure."""

from __future__ import annotations

import contextlib
import io
import os
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lint_docs_names  # noqa: E402


class IsDatedName(unittest.TestCase):
    def test_plain_dated_slug(self):
        self.assertTrue(lint_docs_names.is_dated_name("2026-06-23-packer-consolidation"))

    def test_sequence_number_after_the_date_is_allowed(self):
        """A same-day ordered set keeps its order with a number AFTER the date."""
        self.assertTrue(lint_docs_names.is_dated_name("2026-06-23-01-packer"))

    def test_trailing_date_is_not_dated(self):
        self.assertFalse(lint_docs_names.is_dated_name("atlas-harden-2026-07-07"))

    def test_sequence_prefix_is_not_dated(self):
        self.assertFalse(lint_docs_names.is_dated_name("00-master-consolidation"))

    def test_uppercase_slug_is_rejected(self):
        self.assertFalse(lint_docs_names.is_dated_name("2026-06-23-MASTER"))

    def test_impossible_month_is_rejected(self):
        """A calendar-shaped check, so 2026-13-01 is not a date."""
        self.assertFalse(lint_docs_names.is_dated_name("2026-13-01-thing"))

    def test_date_with_no_slug_is_rejected(self):
        self.assertFalse(lint_docs_names.is_dated_name("2026-06-23"))


class Violations(unittest.TestCase):
    def test_compliant_paths_are_clean(self):
        self.assertEqual(
            lint_docs_names.violations(
                [
                    "docs/plans/2026-06-23-01-packer.md",
                    "docs/lessons/2026-07-09-enforcement.md",
                    ".atlas/findings/2026-08-11-serena.md",
                ]
            ),
            [],
        )

    def test_trailing_date_is_reported_as_order(self):
        (path, reason), = lint_docs_names.violations(
            ["docs/audits/atlas-harden-2026-07-07/final-report.md"]
        )
        self.assertEqual(path, "docs/audits/atlas-harden-2026-07-07")
        self.assertIn("date is not first", reason)

    def test_missing_date_is_reported(self):
        (_, reason), = lint_docs_names.violations(["docs/plans/bootstrap-kit.md"])
        self.assertIn("missing a leading date", reason)

    def test_living_directories_are_never_dated(self):
        """architecture/features/wiki are revised in place, so a date would lie."""
        self.assertEqual(
            lint_docs_names.violations(
                [
                    "docs/architecture/module-map.md",
                    "docs/features/billing.md",
                    "docs/wiki/overview.md",
                ]
            ),
            [],
        )

    def test_scaffolded_index_files_are_exempt(self):
        self.assertEqual(
            lint_docs_names.violations(
                ["docs/plans/README.md", ".atlas/findings/INDEX.md"]
            ),
            [],
        )

    def test_only_the_immediate_child_is_judged(self):
        """Inside a compliant audit hub, the hub's own subtree is its business."""
        self.assertEqual(
            lint_docs_names.violations(
                ["docs/audits/2026-07-07-atlas-harden/plans/ws4-hub-launcher.md"]
            ),
            [],
        )

    def test_one_artifact_is_reported_once(self):
        """Many changed files inside one badly named hub is still one rename."""
        self.assertEqual(
            len(
                lint_docs_names.violations(
                    [
                        "docs/audits/atlas-harden-2026-07-07/a.md",
                        "docs/audits/atlas-harden-2026-07-07/b.md",
                    ]
                )
            ),
            1,
        )

    def test_paths_outside_the_watched_trees_are_ignored(self):
        self.assertEqual(
            lint_docs_names.violations(["src/app.py", "README.md", "docs/CHANGELOG.md"]),
            [],
        )


class Cli(unittest.TestCase):
    def _run(self, *argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = lint_docs_names._cli(list(argv))
        return rc, buf.getvalue()

    def test_explicit_clean_path_exits_zero(self):
        rc, out = self._run("docs/plans/2026-06-23-01-packer.md")
        self.assertEqual(rc, 0)
        self.assertIn("docs naming OK", out)

    def test_violation_exits_one_and_names_the_path(self):
        rc, out = self._run("docs/plans/00-MASTER-consolidation.md")
        self.assertEqual(rc, 1)
        self.assertIn("00-MASTER-consolidation.md", out)



class Fixer(unittest.TestCase):
    """Rename planning, date derivation, and reference rewriting."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def _write(self, rel, text=""):
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def test_embedded_date_wins_over_mtime(self):
        """A trailing-date name already states the date the artifact is ABOUT,
        which beats whenever the file happened to be written."""
        self._write("docs/audits/atlas-harden-2026-07-07/report.md", "x")
        self.assertEqual(
            lint_docs_names.derive_date(
                self.root, "docs/audits/atlas-harden-2026-07-07"
            ),
            "2026-07-07",
        )

    def test_undated_name_falls_back_to_a_real_timestamp(self):
        """Never invents a date: with nothing embedded and no git, the mtime is
        the only honest answer."""
        self._write("docs/plans/bootstrap-kit.md", "x")
        got = lint_docs_names.derive_date(self.root, "docs/plans/bootstrap-kit.md")
        self.assertRegex(got, r"^\d{4}-\d{2}-\d{2}$")

    def test_plan_moves_the_date_to_the_front_and_keeps_the_subject(self):
        self._write("docs/audits/atlas-harden-2026-07-07/report.md", "x")
        viols = lint_docs_names.violations(
            ["docs/audits/atlas-harden-2026-07-07/report.md"]
        )
        self.assertEqual(
            lint_docs_names.plan_renames(self.root, viols),
            [
                (
                    "docs/audits/atlas-harden-2026-07-07",
                    "docs/audits/2026-07-07-atlas-harden",
                )
            ],
        )

    def test_rename_rewrites_references_in_prose_and_in_comments(self):
        """A rename that leaves dangling references trades one defect for a
        worse one, so the full path AND the bare name are corrected -- including
        inside a code comment."""
        self._write("docs/plans/00-MASTER-plan.md", "# plan\n")
        self._write(
            "docs/architecture/map.md",
            "See docs/plans/00-MASTER-plan.md for the decomposition.\n",
        )
        self._write("src/app.py", "# staged per 00-MASTER-plan.md\nX = 1\n")
        viols = lint_docs_names.violations(["docs/plans/00-MASTER-plan.md"])
        moved = lint_docs_names.apply_renames(
            self.root, lint_docs_names.plan_renames(self.root, viols)
        )
        self.assertEqual(len(moved), 1)
        new_rel = moved[0][1]
        new_name = new_rel.rsplit("/", 1)[-1]
        touched = lint_docs_names.rewrite_references(self.root, moved)
        self.assertIn("docs/architecture/map.md", touched)
        self.assertIn("src/app.py", touched)
        self.assertIn(
            new_rel, (self.root / "docs/architecture/map.md").read_text(encoding="utf-8")
        )
        self.assertIn(
            new_name, (self.root / "src/app.py").read_text(encoding="utf-8")
        )
        self.assertTrue((self.root / new_rel).is_file())
        self.assertFalse((self.root / "docs/plans/00-MASTER-plan.md").exists())

    def test_the_full_path_wins_over_the_bare_name(self):
        """Substituting the bare name first would corrupt the longer path."""
        self._write("docs/plans/00-MASTER-plan.md", "x")
        self._write("docs/architecture/map.md", "docs/plans/00-MASTER-plan.md\n")
        viols = lint_docs_names.violations(["docs/plans/00-MASTER-plan.md"])
        moved = lint_docs_names.apply_renames(
            self.root, lint_docs_names.plan_renames(self.root, viols)
        )
        lint_docs_names.rewrite_references(self.root, moved)
        text = (self.root / "docs/architecture/map.md").read_text(encoding="utf-8")
        self.assertEqual(text.strip(), moved[0][1])

    def test_the_fixer_never_rewrites_its_own_fixtures(self):
        """Observed defect: a tree-wide bare-name rewrite edited this module's
        own examples and inverted the meaning of its tests."""
        self._write("docs/plans/00-MASTER-plan.md", "x")
        sentinel = "00-MASTER-plan.md stays quoted here\n"
        self._write("scripts/test_lint_docs_names.py", sentinel)
        self._write("scripts/lint_docs_names.py", sentinel)
        viols = lint_docs_names.violations(["docs/plans/00-MASTER-plan.md"])
        moved = lint_docs_names.apply_renames(
            self.root, lint_docs_names.plan_renames(self.root, viols)
        )
        lint_docs_names.rewrite_references(self.root, moved)
        for name in ("test_lint_docs_names.py", "lint_docs_names.py"):
            self.assertEqual(
                (self.root / "scripts" / name).read_text(encoding="utf-8"),
                sentinel,
                "%s was rewritten" % name,
            )


class Structure(unittest.TestCase):
    """Any project atlas runs in must have the durable docs/ tree."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_no_docs_tree_is_a_single_actionable_gap(self):
        gaps = lint_docs_names.structure_gaps(self.root)
        self.assertEqual(len(gaps), 1)
        self.assertEqual(gaps[0][0], "docs/")

    def test_missing_subfolder_is_reported(self):
        for entry in lint_docs_names.required_docs_entries():
            target = self.root / "docs" / entry
            if entry.endswith(".md"):
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("x", encoding="utf-8")
            else:
                target.mkdir(parents=True, exist_ok=True)
        (self.root / "README.md").write_text("x", encoding="utf-8")
        self.assertEqual(lint_docs_names.structure_gaps(self.root), [])
        import shutil

        shutil.rmtree(self.root / "docs" / "plans")
        gaps = dict(lint_docs_names.structure_gaps(self.root))
        self.assertIn("docs/plans/", gaps)

    def test_required_entries_match_the_scaffolder(self):
        """The check and the creator must not diverge: a subfolder the
        scaffolder stops making would otherwise be demanded forever."""
        import importlib.util

        scaffold = (
            pathlib.Path(lint_docs_names.__file__).resolve().parent.parent
            / "skills"
            / "atlas-setup"
            / "scripts"
            / "scaffold_docs.py"
        )
        spec = importlib.util.spec_from_file_location("_scaffold_probe", scaffold)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        self.assertEqual(
            lint_docs_names.required_docs_entries(),
            [name for name, _is_dir in mod.DURABLE_ENTRIES],
        )


if __name__ == "__main__":
    unittest.main()
