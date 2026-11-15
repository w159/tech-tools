"""atlas_isolation_bench: shared-tree baseline uses Edit semantics, conflicts count as unmerged, auto is reported."""

import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _test_isolation  # noqa: F401,E402
import atlas_isolation_bench as ib  # noqa: E402

CASES = {kind: (files, ea, eb) for kind, files, ea, eb in reversed(ib.build_cases())}


class SharedEditSemanticsTests(unittest.TestCase):
    def test_edit_refused_when_file_changed_since_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = ib._repo(tmp, {"f.txt": ib.BASE})
            snap = Path(repo, "f.txt").read_text()
            self.assertEqual(ib.edit_tool(repo, "f.txt", snap, "line 2\n", "line 2 A\n"), "applied")
            self.assertEqual(ib.edit_tool(repo, "f.txt", snap, "line 30\n", "line 30 B\n"), "refused-stale")
            self.assertNotIn("line 30 B", Path(repo, "f.txt").read_text())

    def test_edit_refused_when_old_string_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = ib._repo(tmp, {"f.txt": ib.BASE})
            snap = Path(repo, "f.txt").read_text()
            self.assertEqual(ib.edit_tool(repo, "f.txt", snap, "no such line\n", "x\n"), "refused-missing")

    def test_same_file_case_is_refused_not_lost(self):
        r = ib.run_shared(*CASES["same-file-diff-hunk"])
        self.assertEqual((r["merged"], r["refused"], r["lost"], r["conflicted"]), (1, 1, 0, 0))

    def test_naive_overwrite_still_loses_and_is_labeled_upper_bound(self):
        r = ib.run_naive(*CASES["same-file-diff-hunk"])
        self.assertEqual((r["merged"], r["lost"]), (1, 1))
        self.assertIn("naive overwrite (upper bound)", [m for m, _ in ib.MODES])


class WorktreeConflictTests(unittest.TestCase):
    def test_conflicted_branch_counts_as_unmerged(self):
        r = ib.run_worktree(*CASES["same-line"])
        self.assertEqual((r["merged"], r["conflicted"], r["lost"]), (1, 1, 0))

    def test_clean_merge_counts_both(self):
        r = ib.run_worktree(*CASES["same-file-diff-hunk"])
        self.assertEqual((r["merged"], r["conflicted"], r["lost"]), (2, 0, 0))


class AutoChoiceTests(unittest.TestCase):
    def test_auto_reports_choice_per_case(self):
        self.assertEqual(ib.run_auto(*CASES["disjoint-files"])["chose"], "shared")
        r = ib.run_auto(*CASES["same-line"])
        self.assertEqual(r["chose"], "worktree")
        self.assertEqual((r["merged"], r["conflicted"]), (1, 1))

    def test_table_has_auto_row_with_choice(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = ib.main([])
        out = buf.getvalue()
        self.assertEqual(rc, 0)
        total = [ln for ln in out.splitlines() if ln.startswith("TOTAL") and " auto " in ln]
        self.assertEqual(len(total), 1)
        self.assertIn("worktree:14", total[0])
        self.assertIn("shared:6", total[0])


if __name__ == "__main__":
    unittest.main()
