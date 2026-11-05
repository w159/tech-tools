"""worker_inbox: receipt pruning and the cheap pre-checks that skip the atlas_todo import."""

import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(
    0,
    _iso_os.path.join(
        _iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"
    ),
)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))
import worker_inbox  # noqa: E402


class ReceiptPruneTest(unittest.TestCase):
    def setUp(self):
        self.path = Path(tempfile.mkdtemp()) / "inbox" / "w.json"

    def doc(self):
        return json.loads(self.path.read_text())

    def test_exactly_keep_receipts_are_not_pruned(self):
        worker_inbox._write_cursor(self.path, 1.0, 500, range(1, 501), now=10.0)
        d = self.doc()
        self.assertEqual(len(d["receipts"]), worker_inbox.RECEIPT_KEEP)
        self.assertEqual(d["legacy_upto"], 0)
        self.assertEqual(d["receipts"]["1"], 10.0)

    def test_overflow_drops_oldest_seq_numerically_and_raises_legacy_upto(self):
        worker_inbox._write_cursor(self.path, 1.0, 502, range(1, 503), now=10.0)
        d = self.doc()
        self.assertEqual(len(d["receipts"]), worker_inbox.RECEIPT_KEEP)
        self.assertNotIn("1", d["receipts"])
        self.assertNotIn("2", d["receipts"])
        self.assertIn("3", d["receipts"])
        self.assertEqual(d["legacy_upto"], 2)

    def test_cursor_never_moves_backwards(self):
        worker_inbox._write_cursor(self.path, 50.0, 9, [9], now=1.0)
        worker_inbox._write_cursor(self.path, 5.0, 3, [3], now=2.0)
        d = self.doc()
        self.assertEqual((d["ts"], d["seq"]), (50.0, 9))
        self.assertEqual(d["receipts"], {"9": 1.0, "3": 2.0})


class PrecheckTest(unittest.TestCase):
    def setUp(self):
        env = patch.dict(os.environ)
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("ATLAS_PROJECT_ROOT", None)
        self.root = tempfile.mkdtemp()

    def run_dir(self):
        d = os.path.join(self.root, ".atlas", ".run")
        os.makedirs(d, exist_ok=True)
        return d

    def test_no_registry_possible_true_only_without_channels_json(self):
        with patch.object(worker_inbox, "_project_root", return_value=self.root):
            self.assertIs(worker_inbox._no_registry_possible(self.root), True)
            open(os.path.join(self.run_dir(), "channels.json"), "w").write("{}")
            self.assertIs(worker_inbox._no_registry_possible(self.root), False)

    def test_no_registry_possible_is_false_when_root_resolution_fails(self):
        with patch.object(worker_inbox, "_project_root", side_effect=RuntimeError("x")):
            self.assertIs(worker_inbox._no_registry_possible(self.root), False)

    def test_no_notes_dir_true_without_board_false_with_it(self):
        with patch.object(worker_inbox, "_project_root", return_value=self.root):
            self.assertIs(worker_inbox._no_notes_dir({"cwd": self.root}, {}), True)
            os.makedirs(os.path.join(self.run_dir(), "board"))
            self.assertIs(worker_inbox._no_notes_dir({"cwd": self.root}, {}), False)

    def test_no_notes_dir_checks_the_env_project_root_too(self):
        other = tempfile.mkdtemp()
        os.makedirs(os.path.join(other, ".atlas", ".run", "board"))
        with patch.object(worker_inbox, "_project_root", return_value=self.root):
            env = {"ATLAS_PROJECT_ROOT": other}
            self.assertIs(worker_inbox._no_notes_dir({"cwd": self.root}, env), False)

    def test_no_notes_dir_uncertain_when_env_root_is_a_linked_worktree(self):
        other = tempfile.mkdtemp()
        open(os.path.join(other, ".git"), "w").write("gitdir: /x\n")
        with patch.object(worker_inbox, "_project_root", return_value=self.root):
            env = {"ATLAS_PROJECT_ROOT": other}
            self.assertIsNone(worker_inbox._candidate_roots(self.root, env))
            self.assertIs(worker_inbox._no_notes_dir({"cwd": self.root}, env), False)

    def test_no_notes_dir_ignores_non_string_cwd(self):
        with patch.object(worker_inbox, "_project_root", return_value=self.root) as pr:
            worker_inbox._no_notes_dir({"cwd": 5}, {})
        pr.assert_called_once_with(None)


class TailAndHeadTest(unittest.TestCase):
    def setUp(self):
        self.f = Path(tempfile.mkdtemp()) / "n.jsonl"
        self.f.write_bytes(b"0123456789")

    def test_read_tail_is_the_half_open_range(self):
        self.assertEqual(worker_inbox._read_tail(self.f, 4, 10), b"456789")
        self.assertEqual(worker_inbox._read_tail(self.f, 10, 10), b"")
        self.assertEqual(worker_inbox._read_tail(self.f, 8, 5), b"")
        self.assertEqual(worker_inbox._read_tail(self.f, 0, 3), b"012")

    def test_head_is_first_64_bytes_hex_or_empty_when_unreadable(self):
        self.f.write_bytes(bytes(range(100)))
        self.assertEqual(worker_inbox._head(self.f), bytes(range(64)).hex())
        self.assertEqual(worker_inbox._head(self.f.with_name("missing")), "")


class CandidateRootsTest(unittest.TestCase):
    def test_lists_project_root_then_sanitized_env_root(self):
        import atlas_paths

        other = tempfile.mkdtemp()
        with patch.object(worker_inbox, "_project_root", return_value="/proj"):
            self.assertEqual(worker_inbox._candidate_roots("/c", {}), ["/proj"])
            self.assertEqual(
                worker_inbox._candidate_roots("/c", {"ATLAS_PROJECT_ROOT": other}),
                ["/proj", atlas_paths.sanitize(other)],
            )


class MemberForTest(unittest.TestCase):
    class Todo:
        def __init__(self, names):
            self.names = names

        def _reg_read(self, root):
            return {"channels": {"c1": {"members": [{"name": n} for n in self.names]}}}

        def _sanitize_owner(self, s):
            return s

    def member(self, agent, names):
        return worker_inbox._member_for(self.Todo(names), "/r", agent)

    def test_exact_match_is_case_blind(self):
        self.assertEqual(self.member("alpha", ["Alpha", "Beta"]), "Alpha")

    def test_omp_prefix_and_trailing_digits_are_stripped(self):
        self.assertEqual(self.member("3-Alpha", ["Alpha"]), "Alpha")
        self.assertEqual(self.member("Alpha12", ["Alpha"]), "Alpha")
        self.assertEqual(self.member("3-Alpha12", ["Alpha"]), "Alpha")

    def test_no_match_blank_or_ambiguous_gives_none(self):
        self.assertIsNone(self.member("Gamma", ["Alpha"]))
        self.assertIsNone(self.member("   ", ["Alpha"]))
        self.assertIsNone(self.member("alpha", ["Alpha", "ALPHA"]))


if __name__ == "__main__":
    unittest.main()
