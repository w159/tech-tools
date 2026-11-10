#!/usr/bin/env python3
"""Tests for docs conformance: dated-name (underscore) naming, the fixer, and structure."""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import contextlib
import io
import os
import pathlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lint_docs_names  # noqa: E402


class IsDatedName(unittest.TestCase):
    def test_plain_dated_slug(self):
        self.assertTrue(
            lint_docs_names.is_dated_name("2026-06-23_packer-consolidation")
        )

    def test_sequence_number_after_the_date_is_allowed(self):
        """A same-day ordered set keeps its order with a number AFTER the date."""
        self.assertTrue(lint_docs_names.is_dated_name("2026-06-23_01-packer"))

    def test_trailing_date_is_not_dated(self):
        self.assertFalse(lint_docs_names.is_dated_name("atlas-harden-2026-07-07"))

    def test_sequence_prefix_is_not_dated(self):
        self.assertFalse(lint_docs_names.is_dated_name("00-master-consolidation"))

    def test_uppercase_slug_is_rejected(self):
        self.assertFalse(lint_docs_names.is_dated_name("2026-06-23_MASTER"))

    def test_impossible_month_is_rejected(self):
        """A calendar-shaped check, so 2026-13-01 is not a date."""
        self.assertFalse(lint_docs_names.is_dated_name("2026-13-01_thing"))

    def test_date_with_no_slug_is_rejected(self):
        self.assertFalse(lint_docs_names.is_dated_name("2026-06-23"))


class Violations(unittest.TestCase):
    def test_compliant_paths_are_clean(self):
        self.assertEqual(
            lint_docs_names.violations(
                [
                    "docs/plans/2026-06-23_01-packer.md",
                    "docs/lessons/2026-07-09_enforcement.md",
                    ".atlas/findings/2026-08-11_lean-ctx.md",
                ]
            ),
            [],
        )

    def test_trailing_date_is_reported_as_order(self):
        ((path, reason),) = lint_docs_names.violations(
            ["docs/audits/atlas-harden-2026-07-07/final-report.md"]
        )
        self.assertEqual(path, "docs/audits/atlas-harden-2026-07-07")
        self.assertIn("date is not first", reason)

    def test_missing_date_is_reported(self):
        ((_, reason),) = lint_docs_names.violations(["docs/plans/bootstrap-kit.md"])
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
                ["docs/audits/2026-07-07_atlas-harden/plans/ws4-hub-launcher.md"]
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
            lint_docs_names.violations(
                ["src/app.py", "README.md", "docs/CHANGELOG.md"]
            ),
            [],
        )


class Cli(unittest.TestCase):
    def _run(self, *argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = lint_docs_names._cli(list(argv))
        return rc, buf.getvalue()

    def test_explicit_clean_path_exits_zero(self):
        rc, out = self._run("docs/plans/2026-06-23_01-packer.md")
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
                    "docs/audits/2026-07-07_atlas-harden",
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
            new_rel,
            (self.root / "docs/architecture/map.md").read_text(encoding="utf-8"),
        )
        self.assertIn(new_name, (self.root / "src/app.py").read_text(encoding="utf-8"))
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


class UnderscoreRule(unittest.TestCase):
    def test_hyphen_dated_name_is_not_dated(self):
        self.assertFalse(lint_docs_names.is_dated_name("2026-06-23-packer"))

    def test_hyphen_dated_name_is_a_separator_violation(self):
        ((path, reason),) = lint_docs_names.violations(
            ["docs/plans/2026-06-23-packer.md"]
        )
        self.assertEqual(path, "docs/plans/2026-06-23-packer.md")
        self.assertIn("date separator must be '_'", reason)

    def test_meetings_and_handoffs_are_dated_dirs(self):
        self.assertEqual(
            len(
                lint_docs_names.violations(
                    ["docs/meetings/standup.md", "docs/handoffs/x.md"]
                )
            ),
            2,
        )
        self.assertEqual(
            lint_docs_names.violations(["docs/meetings/2026-01-02_standup.md"]), []
        )


class UnderscoreFixer(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def _write(self, rel, text=""):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")

    def _fix(self, paths):
        bad = lint_docs_names.violations(paths)
        plans = lint_docs_names.plan_renames(self.root, bad)
        moved = lint_docs_names.apply_renames(self.root, plans)
        lint_docs_names.rewrite_references(self.root, moved)
        return plans, moved

    def test_hyphen_migrates_to_underscore_keeping_date_and_rewrites_refs(self):
        self._write("docs/plans/2026-06-23-packer.md", "x")
        self._write(
            "docs/wiki/a.md",
            "see docs/plans/2026-06-23-packer.md and 2026-06-23-packer\n",
        )
        plans, moved = self._fix(["docs/plans/2026-06-23-packer.md"])
        self.assertEqual(
            moved,
            [("docs/plans/2026-06-23-packer.md", "docs/plans/2026-06-23_packer.md")],
        )
        self.assertTrue((self.root / "docs/plans/2026-06-23_packer.md").is_file())
        self.assertEqual(
            (self.root / "docs/wiki/a.md").read_text(encoding="utf-8"),
            "see docs/plans/2026-06-23_packer.md and 2026-06-23_packer\n",
        )

    def test_hyphen_directory_in_dated_dir_migrates(self):
        self._write("docs/audits/2026-07-07-atlas-harden/report.md", "x")
        _, moved = self._fix(["docs/audits/2026-07-07-atlas-harden/report.md"])
        self.assertEqual(moved[0][1], "docs/audits/2026-07-07_atlas-harden")
        self.assertTrue(
            (self.root / "docs/audits/2026-07-07_atlas-harden/report.md").is_file()
        )

    def test_date_last_becomes_underscore_form(self):
        self._write("docs/audits/atlas-harden-2026-07-07/r.md", "x")
        plans, _ = self._fix(["docs/audits/atlas-harden-2026-07-07/r.md"])
        self.assertEqual(plans[0][1], "docs/audits/2026-07-07_atlas-harden")

    def test_classified_root_file_moves_with_reference_rewrite(self):
        self._write("docs/MEETING_NOTES_9.3.26.md", "n")
        self._write(
            "docs/wiki/a.md",
            "[n](../MEETING_NOTES_9.3.26.md) docs/MEETING_NOTES_9.3.26.md\n",
        )
        plans, moved = self._fix(["docs/MEETING_NOTES_9.3.26.md"])
        new = moved[0][1]
        self.assertEqual(new, "docs/meetings/2026-09-03_meeting-notes.md")
        self.assertFalse((self.root / "docs/MEETING_NOTES_9.3.26.md").exists())
        text = (self.root / "docs/wiki/a.md").read_text(encoding="utf-8")
        self.assertIn(new, text)
        self.assertNotIn("MEETING_NOTES", text)

    def test_root_routing_keywords(self):
        cases = {
            "docs/FORMULA-INVENTORY.md": "docs/audits",
            "docs/MEETING_TRANSCRIPT.md": "docs/meetings",
            "docs/API_SPEC.md": "docs/specs",
            "docs/Q3-plan.md": "docs/plans",
            "docs/adr-5.md": "docs/decisions",
            "docs/handoff.md": "docs/handoffs",
            "docs/sprint-retro.md": "docs/lessons",
        }
        for rel, folder in cases.items():
            self.assertEqual(lint_docs_names._root_target_dir(rel), folder, rel)
        self.assertIsNone(lint_docs_names._root_target_dir("docs/quadrant.md"))

    def test_unclassified_root_file_goes_to_architecture_bare_name(self):
        self._write("docs/Atlas_Channels.md", "x")
        self._write("docs/wiki/a.md", "[c](../Atlas_Channels.md) docs/Atlas_Channels.md\n")
        ((_, reason),) = lint_docs_names.violations(["docs/Atlas_Channels.md"])
        self.assertIn("docs/architecture/", reason)
        _, moved = self._fix(["docs/Atlas_Channels.md"])
        self.assertEqual(moved[0][1], "docs/architecture/atlas-channels.md")
        self.assertFalse((self.root / "docs/Atlas_Channels.md").exists())
        text = (self.root / "docs/wiki/a.md").read_text(encoding="utf-8")
        self.assertIn("docs/architecture/atlas-channels.md", text)
        self.assertNotIn("Atlas_Channels", text)

    def test_embedded_date_without_keyword_is_logged_not_kept(self):
        ((_, reason),) = lint_docs_names.violations(["docs/design-9.3.26.md"])
        self.assertIn("2026-09-03", reason)
        plans, _ = self._fix(["docs/design-9.3.26.md"])
        self.assertEqual(plans[0][1].rsplit("/", 1)[0], "docs/architecture")

    def test_architecture_name_collision_is_skipped_not_overwritten(self):
        self._write("docs/Atlas_Mod.md", "new")
        self._write("docs/architecture/atlas-mod.md", "keep")
        plans, moved = self._fix(["docs/Atlas_Mod.md"])
        self.assertEqual((plans, moved), ([], []))
        self.assertTrue((self.root / "docs/Atlas_Mod.md").is_file())
        self.assertEqual(
            (self.root / "docs/architecture/atlas-mod.md").read_text(encoding="utf-8"),
            "keep",
        )

    def test_canonical_root_files_are_exempt(self):
        names = [
            "README.md",
            "changelog.md",
            "ROADMAP.md",
            "AGENTS.md",
            "CLAUDE.md",
            "GLOSSARY.md",
            "Contributing.md",
            "SECURITY.md",
            "DEVELOPMENT.md",
            "INDEX.md",
        ]
        self.assertEqual(lint_docs_names.violations(["docs/" + n for n in names]), [])

    def test_living_dir_and_non_doc_root_files_are_exempt(self):
        self.assertEqual(
            lint_docs_names.violations(
                ["docs/wiki/Anything_Goes.md", "docs/diagram.png"]
            ),
            [],
        )

    def test_bare_name_rewrite_respects_word_boundaries(self):
        self._write("docs/PLAN.md", "x")
        self._write("docs/wiki/a.md", "PLAN.md and MASTER_PLAN.md\n")
        _, moved = self._fix(["docs/PLAN.md"])
        text = (self.root / "docs/wiki/a.md").read_text(encoding="utf-8")
        self.assertIn("MASTER_PLAN.md", text)
        self.assertIn(moved[0][1].rsplit("/", 1)[-1], text)

    def test_rewrite_reaches_env_template_and_ts_line_comment(self):
        self._write("docs/atlas-turn-scoring.md", "x")
        self._write(".env.template", "# see docs/atlas-turn-scoring.md\nKEY=\n")
        self._write("mod/contract.ts", "// Plan: docs/atlas-turn-scoring.md\n")
        _, moved = self._fix(["docs/atlas-turn-scoring.md"])
        new = moved[0][1]
        for f in (".env.template", "mod/contract.ts"):
            text = (self.root / f).read_text(encoding="utf-8")
            self.assertIn(new, text, f)
            self.assertNotIn("docs/atlas-turn-scoring.md", text, f)

    def test_unwritable_reference_file_is_reported_not_silent(self):
        self._write("docs/atlas-turn-scoring.md", "x")
        self._write("mod/contract.ts", "// Plan: docs/atlas-turn-scoring.md\n")
        real = Path.write_text

        def deny(self_, *a, **k):
            if self_.name == "contract.ts":
                raise PermissionError(1, "Operation not permitted")
            return real(self_, *a, **k)

        err = io.StringIO()
        with mock.patch.object(Path, "write_text", deny), contextlib.redirect_stderr(err):
            self._fix(["docs/atlas-turn-scoring.md"])
        self.assertIn("could not rewrite", err.getvalue())
        self.assertIn("contract.ts", err.getvalue())

    def test_all_mode_lists_root_files(self):
        self._write("docs/TODO_LIST.md", "x")
        self._write("docs/README.md", "x")
        self.assertEqual(
            lint_docs_names.all_artifact_paths(self.root),
            ["docs/README.md", "docs/TODO_LIST.md"],
        )


class EmbeddedNameDates(unittest.TestCase):
    """Loose names often carry a US-style date; it is the real date, and it
    leaves the slug."""

    def test_embedded_date_forms(self):
        cases = {
            "MEETING_NOTES_9.3.26.md": "2026-09-03",
            "notes-9.3.2026.md": "2026-09-03",
            "notes-9-3-26.md": "2026-09-03",
            "notes_9_3_2026.md": "2026-09-03",
            "notes-20260903.md": "2026-09-03",
        }
        with tempfile.TemporaryDirectory() as tmp:
            for name, want in cases.items():
                rel = "docs/" + name
                self.assertEqual(lint_docs_names.derive_date(pathlib.Path(tmp), rel), want, name)

    def test_date_text_leaves_the_slug(self):
        with tempfile.TemporaryDirectory() as tmp:
            for name in ("MEETING_NOTES_9.3.26.md", "meeting-notes-20260903.md", "meeting_notes_9_3_2026.md"):
                (( _, new),) = lint_docs_names.plan_renames(
                    pathlib.Path(tmp), [("docs/" + name, "x")]
                )
                self.assertEqual(new, "docs/meetings/2026-09-03_meeting-notes.md", name)

    def test_impossible_date_is_not_used(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / "docs").mkdir()
            (root / "docs" / "notes-13.40.26.md").write_text("x", encoding="utf-8")
            got = lint_docs_names.derive_date(root, "docs/notes-13.40.26.md")
            self.assertNotEqual(got, "2026-13-40")
            self.assertRegex(got, r"^\d{4}-\d{2}-\d{2}$")
            self.assertIsNone(lint_docs_names._name_date("notes-13.40.26"))
            self.assertIsNone(lint_docs_names._name_date("notes-20261340"))


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


def _git(cwd, *args, date=None):
    env = dict(
        os.environ,
        GIT_CONFIG_GLOBAL="/dev/null",
        GIT_CONFIG_NOSYSTEM="1",
        GIT_AUTHOR_NAME="t",
        GIT_AUTHOR_EMAIL="t@example.invalid",
        GIT_COMMITTER_NAME="t",
        GIT_COMMITTER_EMAIL="t@example.invalid",
    )
    if date:
        env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = date
    import subprocess

    return subprocess.run(
        ["git", "-C", str(cwd), *args], env=env, capture_output=True, text=True, check=True
    ).stdout


class _Tree(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._tmp.name).resolve()
        self.addCleanup(self._tmp.cleanup)

    def write(self, rel, text="x"):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
        return p

    def repo(self):
        _git(self.root, "init", "-q")
        return self.root


class PureHelperBoundaries(unittest.TestCase):
    def test_is_dated_name_calendar_bounds(self):
        ok = ["2026-01-01_x", "2026-12-31_x", "2026-06-15_x"]
        bad = ["2026-00-10_x", "2026-13-01_x", "2026-01-00_x", "2026-01-32_x", "2026-1-01_x", "x"]
        for n in ok:
            self.assertIs(lint_docs_names.is_dated_name(n), True, n)
        for n in bad:
            self.assertIs(lint_docs_names.is_dated_name(n), False, n)

    def test_dated_dir_for(self):
        f = lint_docs_names._dated_dir_for
        self.assertEqual(f("docs/plans/x.md"), "docs/plans")
        self.assertEqual(f("docs/plans/sub/y"), "docs/plans")
        self.assertEqual(f(".atlas/findings/a"), ".atlas/findings")
        for rel in ("docs/plans/", "docs/plans", "docs/plansx/y", "docs/architecture/a", "src/a"):
            self.assertIsNone(f(rel), rel)

    def test_is_root_file(self):
        f = lint_docs_names._is_root_file
        for rel in ("docs/a.md", "docs/A.MD", "docs/n.txt", "docs/r.rst", "docs/m.markdown"):
            self.assertIs(f(rel), True, rel)
        for rel in ("docs/sub/a.md", "docs/a.png", "other/a.md", "docs//y.md", "docs/"):
            self.assertIs(f(rel), False, rel)

    def test_name_date_two_digit_and_century_edges(self):
        nd = lint_docs_names._name_date
        self.assertEqual(nd("a-1-2-26")[0], "2026-01-02")
        self.assertEqual(nd("1-2-0100")[0], "0100-01-02")
        self.assertEqual(nd("x-20260102-y")[0], "2026-01-02")
        self.assertIsNone(nd("nothing"))

    def test_norm_strips_prefix_and_backslashes(self):
        self.assertEqual(lint_docs_names._norm(" ./docs\\plans\\a.md "), "docs/plans/a.md")


class ViolationsOrderingAndSkips(unittest.TestCase):
    def test_skips_never_stop_later_paths_from_being_judged(self):
        paths = [
            "",
            "docs/README.md",
            "docs/CHANGELOG.md",
            "docs/plan-one.md",
            "docs/plan-one.md",
            "docs/plans/README.md",
            "docs/plans/2026-01-01_x.md",
            "docs/plans/2026-01-01_x.md/inner.txt",
            "docs/plans/bad.md",
            "docs/plans/bad.md/inner.txt",
            "docs/architecture/anything.md",
            "src/unrelated.py",
            "docs/specs/Worse.md",
        ]
        got = lint_docs_names.violations(paths)
        self.assertEqual([k for k, _ in got], ["docs/plan-one.md", "docs/plans/bad.md", "docs/specs/Worse.md"])
        self.assertIn("docs/plans/ as <YYYY-MM-DD>_<slug>", got[0][1])
        self.assertIn("missing a leading date ('bad.md')", got[1][1])
        self.assertIn("not lowercase and not dated ('Worse.md')", got[2][1])

    def test_single_char_slug_with_md_suffix_is_compliant(self):
        self.assertEqual(lint_docs_names.violations(["docs/plans/2026-01-01_x.md"]), [])

    def test_reason_wording_per_failure_kind(self):
        v = dict(
            lint_docs_names.violations(
                [
                    "docs/plans/2026-01-01-hyphen.md",
                    "docs/plans/2026-01-01_Upper.md",
                    "docs/plans/slug-2026-01-01.md",
                    "docs/plans/plain.md",
                ]
            )
        )
        self.assertIn("date separator must be '_'", v["docs/plans/2026-01-01-hyphen.md"])
        self.assertIn("slug must be lowercase kebab-case", v["docs/plans/2026-01-01_Upper.md"])
        self.assertIn("date is not first", v["docs/plans/slug-2026-01-01.md"])
        self.assertIn("missing a leading date", v["docs/plans/plain.md"])

    def test_loose_root_file_notes_the_name_date_it_does_not_keep(self):
        got = lint_docs_names.violations(["docs/subsystem-2026-01-02.md", "docs/subsystem.md"])
        self.assertIn("docs/architecture/ under its bare name (name date 2026-01-02 not kept)", got[0][1])
        self.assertTrue(got[1][1].endswith("under its bare name"))

    def test_empty_and_none_inputs(self):
        self.assertEqual(lint_docs_names.violations(None), [])
        self.assertEqual(lint_docs_names.violations([]), [])


class GitBackedDiscovery(_Tree):
    def test_repo_root_is_toplevel_or_none(self):
        self.assertIsNone(lint_docs_names._repo_root(self.root))
        self.repo()
        sub = self.root / "a" / "b"
        sub.mkdir(parents=True)
        self.assertEqual(lint_docs_names._repo_root(sub), str(self.root))

    def test_changed_paths_outside_a_repo_is_empty(self):
        self.write("docs/plans/bad.md")
        self.assertEqual(lint_docs_names.changed_paths(self.root), [])

    def test_changed_paths_unions_worktree_index_and_untracked(self):
        self.repo()
        self.write("tracked.txt", "1")
        self.write("staged_later.txt", "1")
        _git(self.root, "add", "-A")
        _git(self.root, "commit", "-qm", "init")
        self.write("tracked.txt", "2")
        self.write("new_staged.txt")
        _git(self.root, "add", "new_staged.txt")
        self.write("docs/plans/untracked.md")
        self.assertEqual(
            lint_docs_names.changed_paths(self.root / "docs"),
            ["docs/plans/untracked.md", "new_staged.txt", "tracked.txt"],
        )

    def test_changed_paths_in_a_repo_without_commits_still_sees_index_and_untracked(self):
        self.repo()
        self.write("a_staged.txt")
        _git(self.root, "add", "a_staged.txt")
        self.write("b_untracked.txt")
        self.assertEqual(lint_docs_names.changed_paths(self.root), ["a_staged.txt", "b_untracked.txt"])

    def test_all_artifact_paths_lists_children_and_loose_docs_files(self):
        self.write("docs/plans/README.md")
        self.write("docs/plans/2026-01-01_a.md")
        self.write("docs/plans/b.md")
        self.write(".atlas/audits/x/inner.md")
        self.write("docs/audits/.gitkeep")
        self.write("docs/CHANGELOG.md")
        self.write("docs/loose.md")
        self.write("docs/architecture/keep.md")
        self.assertEqual(
            lint_docs_names.all_artifact_paths(self.root),
            [
                "docs/plans/2026-01-01_a.md",
                "docs/plans/b.md",
                ".atlas/audits/x",
                "docs/CHANGELOG.md",
                "docs/loose.md",
            ],
        )

    def test_all_artifact_paths_empty_tree(self):
        self.assertEqual(lint_docs_names.all_artifact_paths(self.root), [])

    def test_all_artifact_paths_survives_unreadable_directories(self):
        self.write("docs/plans/a.md")
        self.write("docs/specs/b.md")
        real = pathlib.Path.iterdir

        def flaky(p):
            if p.name == "plans":
                raise PermissionError(13, "denied")
            return real(p)

        with mock.patch.object(pathlib.Path, "iterdir", flaky):
            self.assertEqual(lint_docs_names.all_artifact_paths(self.root), ["docs/specs/b.md"])

        def docs_broken(p):
            if p.name == "docs":
                raise PermissionError(13, "denied")
            return real(p)

        with mock.patch.object(pathlib.Path, "iterdir", docs_broken):
            self.assertEqual(
                lint_docs_names.all_artifact_paths(self.root), ["docs/plans/a.md", "docs/specs/b.md"]
            )


class DeriveDateSources(_Tree):
    def test_first_commit_date_beats_mtime_and_later_commits(self):
        self.repo()
        self.write("docs/plans/idea.md", "1")
        _git(self.root, "add", "-A")
        _git(self.root, "commit", "-qm", "add", date="2025-03-04T12:00:00")
        self.write("docs/plans/idea.md", "2")
        _git(self.root, "commit", "-qam", "edit", date="2026-05-06T12:00:00")
        self.assertEqual(lint_docs_names.derive_date(self.root, "docs/plans/idea.md"), "2025-03-04")

    def test_name_date_beats_git(self):
        self.repo()
        self.write("docs/plans/idea-2024-02-03.md")
        _git(self.root, "add", "-A")
        _git(self.root, "commit", "-qm", "add", date="2025-03-04T12:00:00")
        self.assertEqual(lint_docs_names.derive_date(self.root, "docs/plans/idea-2024-02-03.md"), "2024-02-03")

    def test_uncommitted_file_in_a_repo_falls_back_to_mtime(self):
        self.repo()
        p = self.write("docs/plans/idea.md")
        os.utime(p, (1_700_000_000, 1_700_000_000))
        want = __import__("time").strftime("%Y-%m-%d", __import__("time").localtime(1_700_000_000))
        self.assertEqual(lint_docs_names.derive_date(self.root, "docs/plans/idea.md"), want)

    def test_mtime_outside_a_repo_and_today_for_a_missing_file(self):
        import time

        p = self.write("docs/plans/idea.md")
        os.utime(p, (1_600_000_000, 1_600_000_000))
        self.assertEqual(
            lint_docs_names.derive_date(self.root, "docs/plans/idea.md"),
            time.strftime("%Y-%m-%d", time.localtime(1_600_000_000)),
        )
        with mock.patch.object(lint_docs_names.time, "strftime", side_effect=lambda f, *a: "T:" + f) as st:
            self.assertEqual(lint_docs_names.derive_date(self.root, "docs/plans/gone.md"), "T:%Y-%m-%d")
        self.assertEqual(st.call_args.args, ("%Y-%m-%d",))

    def test_garbage_git_output_is_ignored(self):
        p = self.write("docs/plans/idea.md")
        os.utime(p, (1_600_000_000, 1_600_000_000))
        import time

        with mock.patch.object(lint_docs_names, "_repo_root", return_value=str(self.root)), mock.patch.object(
            lint_docs_names.subprocess, "check_output", return_value=b"not a date\n"
        ):
            self.assertEqual(
                lint_docs_names.derive_date(self.root, "docs/plans/idea.md"),
                time.strftime("%Y-%m-%d", time.localtime(1_600_000_000)),
            )
        with mock.patch.object(lint_docs_names, "_repo_root", return_value=str(self.root)), mock.patch.object(
            lint_docs_names.subprocess, "check_output", return_value=b"\n"
        ):
            self.assertEqual(
                lint_docs_names.derive_date(self.root, "docs/plans/idea.md"),
                time.strftime("%Y-%m-%d", time.localtime(1_600_000_000)),
            )


class PlanRenamesEdges(_Tree):
    def test_living_root_docs_get_bare_names_and_collisions_are_skipped(self):
        self.write("docs/architecture/taken.md")
        viols = [("docs/Foo_Bar.md", "r"), ("docs/foo-bar.md", "r"), ("docs/taken.md", "r"), ("docs/other.md", "r")]
        self.assertEqual(
            lint_docs_names.plan_renames(self.root, viols),
            [
                ("docs/Foo_Bar.md", "docs/architecture/foo-bar.md"),
                ("docs/other.md", "docs/architecture/other.md"),
            ],
        )

    def test_dated_targets_that_exist_or_repeat_get_numeric_suffixes(self):
        self.write("docs/plans/2026-02-03_idea.md")
        self.write("docs/plans/2026-02-03_idea-2.md")
        viols = [
            ("docs/plans/idea-2026-02-03.md", "r"),
            ("docs/plans/2026-02-03-idea.md", "r"),
            ("docs/plans/Idea-2026-02-03.md", "r"),
        ]
        got = lint_docs_names.plan_renames(self.root, viols)
        self.assertEqual(
            [new for _, new in got],
            [
                "docs/plans/2026-02-03_idea-3.md",
                "docs/plans/2026-02-03_idea-4.md",
                "docs/plans/2026-02-03_idea-5.md",
            ],
        )

    def test_first_free_suffix_is_two(self):
        self.write("docs/plans/2026-02-03_idea.md")
        got = lint_docs_names.plan_renames(self.root, [("docs/plans/idea-2026-02-03.md", "r")])
        self.assertEqual(got, [("docs/plans/idea-2026-02-03.md", "docs/plans/2026-02-03_idea-2.md")])

    def test_directories_without_md_suffix_keep_their_name(self):
        (self.root / "docs" / "plans" / "Big-2026-02-03").mkdir(parents=True)
        got = lint_docs_names.plan_renames(self.root, [("docs/plans/Big-2026-02-03", "r")])
        self.assertEqual(got, [("docs/plans/Big-2026-02-03", "docs/plans/2026-02-03_big")])

    def test_classified_root_file_moves_to_its_dated_folder(self):
        self.write("docs/Release_Plan_2026-02-03.md")
        got = lint_docs_names.plan_renames(self.root, [("docs/Release_Plan_2026-02-03.md", "r")])
        self.assertEqual(got, [("docs/Release_Plan_2026-02-03.md", "docs/plans/2026-02-03_release-plan.md")])

    def test_root_file_with_only_a_date_is_untitled(self):
        got = lint_docs_names.plan_renames(self.root, [("docs/plan_2026-02-03.md", "r")])
        self.assertEqual(got, [("docs/plan_2026-02-03.md", "docs/plans/2026-02-03_plan.md")])
        got = lint_docs_names.plan_renames(self.root, [("docs/2026-02-03_audit.md", "r")])
        self.assertEqual(got[0][1], "docs/audits/2026-02-03_audit.md")


class ApplyRenamesBehaviour(_Tree):
    def test_git_mv_stages_a_rename_in_a_repo(self):
        self.repo()
        self.write("docs/plans/old.md", "body")
        _git(self.root, "add", "-A")
        _git(self.root, "commit", "-qm", "x")
        moved = lint_docs_names.apply_renames(self.root, [("docs/plans/old.md", "docs/plans/2026-01-01_old.md")])
        self.assertEqual(moved, [("docs/plans/old.md", "docs/plans/2026-01-01_old.md")])
        self.assertFalse((self.root / "docs/plans/old.md").exists())
        self.assertEqual((self.root / "docs/plans/2026-01-01_old.md").read_text(), "body")
        status = _git(self.root, "status", "--porcelain")
        self.assertIn("R  docs/plans/old.md -> docs/plans/2026-01-01_old.md", status)

    def test_untracked_file_in_a_repo_falls_back_to_plain_rename(self):
        self.repo()
        self.write("docs/plans/old.md", "body")
        moved = lint_docs_names.apply_renames(self.root, [("docs/plans/old.md", "docs/plans/2026-01-01_old.md")])
        self.assertEqual(len(moved), 1)
        self.assertTrue((self.root / "docs/plans/2026-01-01_old.md").is_file())
        self.assertFalse((self.root / "docs/plans/old.md").exists())

    def test_outside_a_repo_creates_parent_folders_and_skips_missing_sources(self):
        self.write("docs/plans/b.md")
        self.write("docs/c.md")
        plans = [
            ("docs/plans/missing.md", "docs/plans/2026-01-01_missing.md"),
            ("docs/plans/b.md", "docs/plans/2026-01-01_b.md"),
            ("docs/c.md", "docs/architecture/c.md"),
        ]
        moved = lint_docs_names.apply_renames(self.root, plans)
        self.assertEqual(moved, plans[1:])
        self.assertTrue((self.root / "docs/architecture/c.md").is_file())

    def test_missing_nested_target_folders_are_created(self):
        self.write("docs/c.md")
        moved = lint_docs_names.apply_renames(self.root, [("docs/c.md", "new/deep/er/c.md")])
        self.assertEqual(len(moved), 1)
        self.assertTrue((self.root / "new/deep/er/c.md").is_file())

    def test_a_failing_rename_is_skipped_not_fatal(self):
        self.write("docs/plans/a.md")
        self.write("docs/plans/b.md")
        real = os.rename

        def flaky(src, dst):
            if str(src).endswith("a.md"):
                raise OSError("busy")
            return real(src, dst)

        plans = [
            ("docs/plans/a.md", "docs/plans/2026-01-01_a.md"),
            ("docs/plans/b.md", "docs/plans/2026-01-01_b.md"),
        ]
        with mock.patch.object(lint_docs_names.os, "rename", flaky):
            moved = lint_docs_names.apply_renames(self.root, plans)
        self.assertEqual(moved, plans[1:])
        self.assertTrue((self.root / "docs/plans/a.md").exists())

    def test_git_timeout_budget(self):
        self.repo()
        self.write("docs/plans/a.md")
        _git(self.root, "add", "-A")
        _git(self.root, "commit", "-qm", "x")
        with mock.patch.object(lint_docs_names.subprocess, "check_call") as cc:
            lint_docs_names.apply_renames(self.root, [("docs/plans/a.md", "docs/plans/2026-01-01_a.md")])
        self.assertEqual(cc.call_args.args[0], ["git", "-C", str(self.root), "mv", "docs/plans/a.md", "docs/plans/2026-01-01_a.md"])
        self.assertEqual(cc.call_args.kwargs["timeout"], 15)


class RewriteReferencesEdges(_Tree):
    def test_no_moves_returns_an_empty_list(self):
        self.assertEqual(lint_docs_names.rewrite_references(self.root, []), [])
        self.assertEqual(lint_docs_names.rewrite_references(self.root, None), [])

    def test_bare_stem_and_name_and_path_all_rewritten_longest_first(self):
        self.write("README.md", "see docs/plans/old.md and old.md and old, not oldest or x-old\n")
        moved = [("docs/plans/old.md", "docs/plans/2026-01-01_old.md")]
        self.assertEqual(lint_docs_names.rewrite_references(self.root, moved), ["README.md"])
        self.assertEqual(
            (self.root / "README.md").read_text(),
            "see docs/plans/2026-01-01_old.md and 2026-01-01_old.md and 2026-01-01_old, not oldest or x-old\n",
        )

    def test_unreadable_files_do_not_stop_the_walk(self):
        (self.root / "bad.md").write_bytes(b"\xff\xfe\x00 old.md")
        self.write("good.md", "old.md")
        self.write("skip.bin", "old.md")
        moved = [("docs/plans/old.md", "docs/plans/2026-01-01_old.md")]
        self.assertEqual(lint_docs_names.rewrite_references(self.root, moved), ["good.md"])
        self.assertEqual((self.root / "skip.bin").read_text(), "old.md")

    def test_a_write_failure_does_not_stop_the_other_files(self):
        self.write("a.md", "old.md")
        self.write("b.md", "old.md")
        self.write("c.md", "old.md")
        real = pathlib.Path.write_text

        def deny(p, *a, **k):
            if p.name == "a.md":
                raise PermissionError(1, "nope")
            return real(p, *a, **k)

        moved = [("docs/plans/old.md", "docs/plans/2026-01-01_old.md")]
        with mock.patch.object(pathlib.Path, "write_text", deny), contextlib.redirect_stderr(io.StringIO()):
            got = lint_docs_names.rewrite_references(self.root, moved)
        self.assertEqual(got, ["b.md", "c.md"])

    def test_text_files_skips_self_owned_and_vendored_directories(self):
        walk = [
            (str(self.root), ["node_modules", "src", ".git"], ["lint_docs_names.py", "a.md", "test_lint_docs_names.py", "b.py", "img.png"]),
            (str(self.root / "src"), [], ["c.ts"]),
        ]
        with mock.patch.object(lint_docs_names.os, "walk", return_value=iter(walk)):
            names = [p.name for p in lint_docs_names._text_files(self.root)]
        self.assertEqual(names, ["a.md", "b.py", "c.ts"])
        self.assertEqual(walk[0][1], ["src"])

    def test_text_files_matches_suffix_case_insensitively_and_bare_names(self):
        walk = [(str(self.root), [], ["A.MD", "Makefile", "x.bin"])]
        with mock.patch.object(lint_docs_names.os, "walk", return_value=iter(walk)):
            names = [p.name for p in lint_docs_names._text_files(self.root)]
        self.assertEqual(names, ["A.MD", "Makefile"])

    def test_paths_outside_root_are_reported_absolute(self):
        self.write("a.md", "old.md")
        outside = pathlib.Path(tempfile.mkdtemp()) / "x.md"
        outside.write_text("old.md")
        self.addCleanup(lambda: outside.unlink())
        with mock.patch.object(lint_docs_names, "_text_files", return_value=iter([outside])):
            got = lint_docs_names.rewrite_references(self.root, [("p/old.md", "p/new.md")])
        self.assertEqual(got, [str(outside)])


class RequiredEntriesAndStructure(_Tree):
    def test_entries_come_from_the_scaffolder_module(self):
        class Loader:
            def exec_module(self, mod):
                mod.DURABLE_ENTRIES = [("alpha.md", False), ("beta", True)]

        spec = mock.Mock(loader=Loader())
        with mock.patch("importlib.util.spec_from_file_location", return_value=spec), mock.patch(
            "importlib.util.module_from_spec", return_value=types_module()
        ):
            self.assertEqual(lint_docs_names.required_docs_entries(), ["alpha.md", "beta"])

    def test_fallback_when_scaffolder_is_missing_or_broken(self):
        fallback = [
            "CHANGELOG.md", "ROADMAP.md", "architecture", "decisions", "plans",
            "specs", "features", "lessons", "wiki",
        ]
        with mock.patch("importlib.util.spec_from_file_location", return_value=None):
            self.assertEqual(lint_docs_names.required_docs_entries(), fallback)

        class Boom:
            def exec_module(self, mod):
                raise RuntimeError("broken")

        with mock.patch("importlib.util.spec_from_file_location", return_value=mock.Mock(loader=Boom())):
            self.assertEqual(lint_docs_names.required_docs_entries(), fallback)
        with mock.patch("importlib.util.spec_from_file_location", return_value=mock.Mock(loader=None)):
            self.assertEqual(lint_docs_names.required_docs_entries(), fallback)

    def test_structure_gaps_files_dirs_and_readme(self):
        with mock.patch.object(lint_docs_names, "required_docs_entries", return_value=["A.md", "sub"]):
            self.write("docs/A.md")
            (self.root / "docs" / "sub").mkdir()
            self.assertEqual(lint_docs_names.structure_gaps(self.root), [("README.md", "root README is missing")])
            self.write("README.md")
            self.assertEqual(lint_docs_names.structure_gaps(self.root), [])
            (self.root / "docs" / "A.md").unlink()
            (self.root / "docs" / "sub").rmdir()
            self.write("docs/sub", "a file, not a dir")
            self.assertEqual(
                lint_docs_names.structure_gaps(self.root),
                [
                    ("docs/A.md", "required docs file is missing"),
                    ("docs/sub/", "required docs subfolder is missing"),
                ],
            )


def types_module():
    import types

    return types.ModuleType("_atlas_scaffold")


class CliModes(_Tree):
    def run_cli(self, *argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = lint_docs_names._cli(list(argv))
        return rc, buf.getvalue()

    def test_help_exits_zero_with_usage(self):
        for flag in ("--help", "-h"):
            rc, out = self.run_cli(flag)
            self.assertEqual(rc, 0)
            self.assertTrue(out.startswith("usage: lint_docs_names.py [--root DIR]"))

    def test_default_argv_is_sys_argv(self):
        buf = io.StringIO()
        with mock.patch.object(sys, "argv", ["lint", "--help"]), contextlib.redirect_stdout(buf):
            self.assertEqual(lint_docs_names._cli(), 0)
        self.assertIn("usage:", buf.getvalue())

    def test_root_option_scopes_the_run_and_dangling_root_falls_back_to_cwd(self):
        self.write("docs/plans/bad.md")
        rc, out = self.run_cli("--root", str(self.root), "--all")
        self.assertEqual(rc, 1)
        self.assertIn("docs/plans/bad.md", out)
        with mock.patch.object(lint_docs_names.os, "getcwd", return_value=str(self.root)):
            rc, out = self.run_cli("--all", "--root")
        self.assertEqual(rc, 1)
        self.assertIn("docs/plans/bad.md", out)

    def test_paths_after_root_are_not_swallowed(self):
        self.write("docs/plans/bad.md")
        rc, out = self.run_cli("--root", str(self.root), "docs/plans/2026-01-01_ok.md")
        self.assertEqual((rc, out), (0, "docs naming OK (1 path(s) checked, explicit)\n"))

    def test_scope_labels(self):
        rc, out = self.run_cli("--root", str(self.root), "--all")
        self.assertEqual((rc, out), (0, "docs naming OK (0 path(s) checked, whole tree)\n"))
        rc, out = self.run_cli("--root", str(self.root))
        self.assertEqual((rc, out), (0, "docs naming OK (0 path(s) checked, changed files)\n"))

    def test_report_mode_prints_target_and_does_not_move(self):
        self.write("docs/plans/idea-2026-02-03.md")
        rc, out = self.run_cli("--root", str(self.root), "docs/plans/idea-2026-02-03.md")
        self.assertEqual(rc, 1)
        self.assertIn("docs naming violations (1):", out)
        self.assertIn("  docs/plans/idea-2026-02-03.md -- date is not first", out)
        self.assertIn("      -> docs/plans/2026-02-03_idea.md", out)
        self.assertIn("Re-run with --fix", out)
        self.assertTrue((self.root / "docs/plans/idea-2026-02-03.md").exists())

    def test_fix_renames_rewrites_and_reports(self):
        self.write("docs/plans/idea-2026-02-03.md")
        self.write("README.md", "see idea-2026-02-03.md\n")
        rc, out = self.run_cli("--root", str(self.root), "--fix", "docs/plans/idea-2026-02-03.md")
        self.assertEqual(rc, 0)
        self.assertIn("renamed 1 artifact(s):", out)
        self.assertIn("  docs/plans/idea-2026-02-03.md -> docs/plans/2026-02-03_idea.md", out)
        self.assertIn("rewrote references in 1 file(s):", out)
        self.assertIn("  README.md", out)
        self.assertEqual((self.root / "README.md").read_text(), "see 2026-02-03_idea.md\n")
        self.assertTrue((self.root / "docs/plans/2026-02-03_idea.md").is_file())

    def test_fix_without_references_has_no_colon(self):
        self.write("docs/plans/idea.md")
        rc, out = self.run_cli("--root", str(self.root), "--fix", "docs/plans/idea.md")
        self.assertEqual(rc, 0)
        self.assertIn("rewrote references in 0 file(s)\n", out)

    def test_fix_reports_what_it_could_not_move(self):
        self.write("docs/architecture/taken.md")
        self.write("docs/taken.md")
        rc, out = self.run_cli("--root", str(self.root), "--fix", "docs/taken.md")
        self.assertEqual(rc, 1)
        self.assertIn("renamed 0 artifact(s):", out)
        self.assertIn("NEEDS A HUMAN (1), not auto-moved:", out)
        self.assertIn("  docs/taken.md -- loose file in docs/ root", out)

    def test_fix_reports_still_non_conformant_results(self):
        self.write("docs/plans/x.md")
        with mock.patch.object(lint_docs_names, "plan_renames", return_value=[("docs/plans/x.md", "docs/plans/Bad.md")]):
            rc, out = self.run_cli("--root", str(self.root), "--fix", "docs/plans/x.md")
        self.assertEqual(rc, 1)
        self.assertIn("STILL NON-CONFORMANT (1):", out)
        self.assertIn("  docs/plans/Bad.md -- not lowercase and not dated", out)

    def test_structure_gaps_and_ok(self):
        rc, out = self.run_cli("--root", str(self.root), "--structure")
        self.assertEqual(rc, 1)
        self.assertIn("docs structure gaps (1):", out)
        self.assertIn("  docs/ -- no docs/ tree", out)
        self.assertIn('-> run atlas-setup, or python3 "', out)
        self.assertIn("scaffold_docs.py", out)
        self.assertIn("docs naming OK", out)
        with mock.patch.object(lint_docs_names, "structure_gaps", return_value=[]):
            rc, out = self.run_cli("--root", str(self.root), "--structure")
        self.assertEqual(rc, 0)
        self.assertTrue(out.startswith("docs structure OK\n"))

    def test_structure_gap_rc_survives_a_violation_free_naming_check(self):
        with mock.patch.object(lint_docs_names, "structure_gaps", return_value=[("x", "y")]):
            rc, _ = self.run_cli("--root", str(self.root), "--structure", "docs/plans/2026-01-01_ok.md")
        self.assertEqual(rc, 1)
        with mock.patch.object(lint_docs_names, "structure_gaps", return_value=[("x", "y")]):
            self.write("docs/plans/bad.md")
            rc, _ = self.run_cli("--root", str(self.root), "--structure", "--fix", "docs/plans/bad.md")
        self.assertEqual(rc, 1)


if __name__ == "__main__":
    unittest.main()


class SlugifyUnderscoreEdges(unittest.TestCase):
    def test_edge_underscores_are_stripped_so_the_dated_name_complies(self):
        for raw, want in (("_foo", "foo"), ("foo_", "foo"), ("__x__", "x"), ("_", "untitled")):
            slug = lint_docs_names._slugify(raw)
            self.assertEqual(slug, want, raw)
            self.assertEqual(lint_docs_names.violations(["docs/plans/2026-01-01_%s.md" % slug]), [])

    def test_inner_underscores_survive(self):
        self.assertEqual(lint_docs_names._slugify("a_b"), "a_b")
