#!/usr/bin/env python3
"""Tests for lint_skill_names.py — in-process coverage of the skill-name linter.

The script runs its logic at import time (module-level, no main()), so each
test loads/reloads it under mocked `os.listdir` / `os.path.isdir` to drive
every branch: the all-conform path, the non-conformant exit path, the non-dir
skip, empty input, and the slug-length boundaries.

The real skills directory currently contains non-`atlas-` subdirs
(`.ruff_cache`, `docs`), so importing the module unmocked raises SystemExit.
We therefore import it for the first time inside the mock harness.
"""

import importlib
import io
import os
import sys
import unittest
from contextlib import redirect_stdout
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))


def _run_under_mock(listing, isdir_names):
    """Load (or reload) lint_skill_names under mocked directory state.

    `listing` is what `os.listdir` returns; `isdir_names` is the set of names
    that `os.path.isdir` reports as directories. Returns (stdout, exit_exc).
    """
    sys.modules.pop("lint_skill_names", None)
    buf = io.StringIO()
    exit_exc = None
    with (
        mock.patch("os.listdir", return_value=listing),
        mock.patch(
            "os.path.isdir",
            side_effect=lambda p: os.path.basename(p) in isdir_names,
        ),
        redirect_stdout(buf),
    ):
        try:
            importlib.import_module("lint_skill_names")
        except SystemExit as exc:
            exit_exc = exc
    return buf.getvalue(), exit_exc


class TestLintSkillNames(unittest.TestCase):
    def test_all_conform_prints_success_and_exits_clean(self) -> None:
        out, exit_exc = _run_under_mock(
            ["atlas-foo", "atlas-db-audit"],
            {"atlas-foo", "atlas-db-audit"},
        )
        self.assertIsNone(exit_exc, "conformant names must not exit nonzero")
        self.assertIn("all skill names conform", out)

    def test_non_conformant_missing_prefix_exits_one(self) -> None:
        out, exit_exc = _run_under_mock(["bad-skill"], {"bad-skill"})
        self.assertIsNotNone(exit_exc, "bad names must trigger sys.exit")
        assert exit_exc is not None  # narrowing for pyright
        self.assertEqual(exit_exc.code, 1)
        self.assertIn("NON-CONFORMANT", out)
        self.assertIn("bad-skill", out)

    def test_non_conformant_uppercase_after_prefix_exits_one(self) -> None:
        # Starts with atlas- but uppercase letters violate the slug regex.
        out, exit_exc = _run_under_mock(["atlas-Foo"], {"atlas-Foo"})
        assert exit_exc is not None  # narrowing for pyright
        self.assertEqual(exit_exc.code, 1)
        self.assertIn("atlas-Foo", out)

    def test_non_conformant_bare_prefix_exits_one(self) -> None:
        # "atlas-" alone has zero chars after the dash; regex needs 1-59.
        _, exit_exc = _run_under_mock(["atlas-"], {"atlas-"})
        assert exit_exc is not None  # narrowing for pyright
        self.assertEqual(exit_exc.code, 1)

    def test_non_dir_entries_are_skipped(self) -> None:
        # A file (not a dir) must be skipped, leaving only the conformant dir.
        out, exit_exc = _run_under_mock(
            ["README.md", "atlas-foo"],
            {"atlas-foo"},  # README.md is not a dir
        )
        self.assertIsNone(exit_exc)
        self.assertIn("all skill names conform", out)

    def test_empty_listing_conforms(self) -> None:
        out, exit_exc = _run_under_mock([], set())
        self.assertIsNone(exit_exc)
        self.assertIn("all skill names conform", out)

    def test_longest_valid_name_conforms(self) -> None:
        # 59 chars after "atlas-" is the upper bound of the slug regex.
        name = "atlas-" + "a" * 59
        _, exit_exc = _run_under_mock([name], {name})
        self.assertIsNone(exit_exc)

    def test_too_long_name_is_non_conformant(self) -> None:
        # 60 chars after "atlas-" exceeds the {1,59} bound (and the 64-char cap).
        name = "atlas-" + "a" * 60
        out, exit_exc = _run_under_mock([name], {name})
        assert exit_exc is not None  # narrowing for pyright
        self.assertEqual(exit_exc.code, 1)
        self.assertIn(name, out)

    def test_sorting_keeps_bad_list_ordered(self) -> None:
        # sorted() in the script must emit names in lexicographic order.
        out, _ = _run_under_mock(
            ["atlas-Z", "atlas-A", "bad"],
            {"atlas-Z", "atlas-A", "bad"},
        )
        # "atlas-A" and "atlas-Z" both fail the lowercase regex; order matters.
        self.assertIn("['atlas-A', 'atlas-Z', 'bad']", out)


if __name__ == "__main__":
    unittest.main()
