#!/usr/bin/env python3
"""Tests for the durable todo board (atlas_todo.py)."""

import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

import atlas_todo


def cli(*argv):
    """Run the CLI without polluting test output; return (rc, printed_json)."""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = atlas_todo._cli(list(argv))
    try:
        data = json.loads(buf.getvalue())
    except ValueError:
        data = {}
    return rc, data or {}


class BoardBasics(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        self.addCleanup(self._tmp.cleanup)

    def test_board_path_uses_given_root(self):
        p = atlas_todo.board_path(self.root)
        self.assertEqual(
            str(p), os.path.join(self.root, ".atlas", ".run", "todos.json")
        )

    def test_load_missing_board_is_empty(self):
        board = atlas_todo.load(self.root)
        self.assertEqual(board["items"], [])
        self.assertEqual(
            atlas_todo.counts(board),
            {"needed": 0, "remaining": 0, "complete": 0, "claimed": 0},
        )

    def test_add_and_counts(self):
        r = atlas_todo.add(self.root, "wire the gate", session_id="s1")
        self.assertTrue(r["ok"])
        board = atlas_todo.load(self.root)
        self.assertEqual(len(board["items"]), 1)
        self.assertEqual(atlas_todo.counts(board, "s1")["needed"], 1)

    def test_mirror_replaces_session_items_and_keeps_manual(self):
        atlas_todo.add(self.root, "human note", origin="manual")
        atlas_todo.mirror(
            self.root,
            [
                {"content": "a", "status": "pending"},
                {"content": "b", "status": "completed"},
            ],
            "s1",
        )
        contents = {
            i["content"]
            for i in atlas_todo.load(self.root)["items"]
            if not i.get("archived")
        }
        self.assertEqual(contents, {"a", "b", "human note"})

    def test_mirror_keeps_other_sessions_items(self):
        """Concurrent terminals share one project board, so a mirror from one
        session must not wipe another session's plan."""
        atlas_todo.mirror(self.root, [{"content": "theirs", "status": "pending"}], "s2")
        atlas_todo.mirror(self.root, [{"content": "mine", "status": "pending"}], "s1")
        board = atlas_todo.load(self.root)
        self.assertEqual({i["content"] for i in board["items"]}, {"theirs", "mine"})
        self.assertEqual(atlas_todo.counts(board, "s1")["needed"], 1)

    def test_mirror_keeps_claim_on_same_content(self):
        atlas_todo.mirror(self.root, [{"content": "task", "status": "pending"}], "s1")
        item_id = atlas_todo.load(self.root)["items"][0]["id"]
        atlas_todo.claim(self.root, item_id, "atlas:implementer")
        atlas_todo.mirror(
            self.root, [{"content": "task", "status": "in_progress"}], "s1"
        )
        item = atlas_todo.load(self.root)["items"][0]
        self.assertEqual(item["owner"], "atlas:implementer")

    def test_claim_conflict_and_force(self):
        atlas_todo.mirror(self.root, [{"content": "task", "status": "pending"}], "s1")
        item_id = atlas_todo.load(self.root)["items"][0]["id"]
        self.assertTrue(atlas_todo.claim(self.root, item_id, "agent-a")["ok"])
        second = atlas_todo.claim(self.root, item_id, "agent-b")
        self.assertFalse(second["ok"])
        self.assertEqual(second["error"], "claimed_by_other")
        self.assertTrue(
            atlas_todo.claim(self.root, item_id, "agent-b", force=True)["ok"]
        )

    def test_complete_sets_evidence_and_counts(self):
        atlas_todo.mirror(self.root, [{"content": "task", "status": "pending"}], "s1")
        item_id = atlas_todo.load(self.root)["items"][0]["id"]
        atlas_todo.set_status(
            self.root, item_id, "completed", owner="agent-a", evidence="tests pass"
        )
        item = atlas_todo.load(self.root)["items"][0]
        self.assertEqual(item["status"], "completed")
        self.assertEqual(item["evidence"], "tests pass")
        self.assertEqual(
            atlas_todo.counts(atlas_todo.load(self.root), "s1")["complete"], 1
        )

    def test_carry_over_archives_done_and_carries_open(self):
        atlas_todo.mirror(
            self.root,
            [
                {"content": "done", "status": "completed"},
                {"content": "open", "status": "pending"},
            ],
            "s1",
        )
        atlas_todo.carry_over(self.root, "s2")
        board = atlas_todo.load(self.root)
        by_content = {i["content"]: i for i in board["items"]}
        self.assertTrue(by_content["done"]["archived"])
        carried = by_content["open"]
        self.assertEqual(carried["origin"], "carried")
        self.assertEqual(carried["session_id"], "s2")
        self.assertIsNone(carried["owner"])
        self.assertEqual(atlas_todo.counts(board, "s2")["needed"], 1)

    def test_manual_items_survive_carry_over(self):
        atlas_todo.add(self.root, "human note", origin="manual")
        atlas_todo.carry_over(self.root, "s2")
        item = atlas_todo.load(self.root)["items"][0]
        self.assertEqual(item["origin"], "manual")
        self.assertEqual(item["status"], "pending")

    def test_claim_stale_takeover(self):
        atlas_todo.mirror(self.root, [{"content": "task", "status": "pending"}], "s1")
        item = atlas_todo.load(self.root)["items"][0]
        atlas_todo.claim(self.root, item["id"], "agent-a")
        board = atlas_todo.load(self.root)
        board["items"][0]["claimed_at"] = time.time() - 3600
        atlas_todo.save(self.root, board)
        r = atlas_todo.claim(self.root, item["id"], "agent-b")
        self.assertTrue(r["ok"])

    def test_cli_roundtrip(self):
        rc, data = cli(
            "set",
            "--root",
            self.root,
            "--session",
            "s1",
            '[{"content":"a","status":"pending"}]',
        )
        self.assertEqual(rc, 0)
        self.assertEqual(data["counts"]["needed"], 1)
        item_id = atlas_todo.load(self.root)["items"][0]["id"]
        rc, data = cli(
            "claim", "--root", self.root, "--id", item_id, "--owner", "agent-a"
        )
        self.assertEqual(rc, 0)
        self.assertEqual(data["item"]["status"], "in_progress")
        rc, data = cli(
            "complete",
            "--root",
            self.root,
            "--id",
            item_id,
            "--owner",
            "agent-a",
            "--evidence",
            "t",
        )
        self.assertEqual(rc, 0)
        self.assertEqual(data["counts"]["complete"], 1)
        rc, data = cli("counts", "--root", self.root, "--session", "s1")
        self.assertEqual(rc, 0)
        self.assertEqual(data["remaining"], 0)
        other = os.path.join(self.root, "other")
        os.makedirs(other, exist_ok=True)
        rc, data = cli("counts", "--root", other)
        self.assertEqual(rc, 0)
        self.assertEqual(data["needed"], 0)

    def test_cli_rejects_unknown_command(self):
        rc, data = cli("nonsense")
        self.assertEqual(rc, 1)
        self.assertEqual(data["error"], "unknown_command")


def _run_git(*args, cwd=None):
    return subprocess.run(("git",) + args, cwd=cwd, capture_output=True, text=True)


class WorktreeBoard(unittest.TestCase):
    """A linked git worktree maps to the MAIN repo root so workers and the
    lead share one board."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        self.addCleanup(self._tmp.cleanup)

    def _make_worktree(self):
        main = os.path.join(self.root, "main")
        wt = os.path.join(self.root, "wt")
        r = _run_git("init", "-q", main)
        if r.returncode != 0:
            self.skipTest(f"git init failed: {r.stderr.strip()}")
        r = _run_git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "seed", cwd=main)
        if r.returncode != 0:
            self.skipTest(f"git commit failed: {r.stderr.strip()}")
        r = _run_git("worktree", "add", "-q", wt, "HEAD", cwd=main)
        if r.returncode != 0:
            self.skipTest(f"git worktree add failed: {r.stderr.strip()}")
        return main, wt

    def test_linked_worktree_shares_main_board(self):
        main, wt = self._make_worktree()
        # in a linked worktree .git is a file, not a dir
        self.assertTrue(os.path.isfile(os.path.join(wt, ".git")))
        # the board path from inside the worktree equals the main root's,
        # even with the explicit worktree dir (e.g. hooks passing cwd)
        self.assertEqual(
            os.path.realpath(str(atlas_todo.board_path(wt))),
            os.path.realpath(str(atlas_todo.board_path(main))),
        )
        prev = os.getcwd()
        os.chdir(wt)
        try:
            with mock.patch.dict(os.environ):
                os.environ.pop("ATLAS_PROJECT_ROOT", None)
                self.assertEqual(os.path.realpath(atlas_todo.find_root()), os.path.realpath(main))
                self.assertEqual(
                    os.path.realpath(str(atlas_todo.board_path())),
                    os.path.realpath(str(atlas_todo.board_path(main))),
                )
                atlas_todo.add(main, "written by lead")
                atlas_todo.note(None, "worker", "seen from worktree")
                # default resolution from inside the worktree reads the lead's board
                self.assertEqual(atlas_todo.load()["items"][0]["content"], "written by lead")
        finally:
            os.chdir(prev)
        # the note written from the worktree cwd landed on the MAIN board
        self.assertEqual(atlas_todo.load(main)["items"][0]["content"], "written by lead")
        self.assertEqual([n["text"] for n in atlas_todo.notes(main)], ["seen from worktree"])

    def test_plain_repo_and_env_resolution_unchanged(self):
        main, wt = self._make_worktree()
        # main repo itself still resolves to its own dir
        self.assertEqual(os.path.realpath(atlas_todo.find_root(main)), os.path.realpath(main))
        with mock.patch.dict(os.environ):
            os.environ.pop("ATLAS_PROJECT_ROOT", None)
            self.assertEqual(os.path.realpath(atlas_todo.find_root(main)), os.path.realpath(main))
            env_root = os.path.join(self.root, "envroot")
            os.makedirs(env_root, exist_ok=True)
            os.environ["ATLAS_PROJECT_ROOT"] = env_root
            # ATLAS_PROJECT_ROOT still wins over find_root()
            self.assertEqual(
                os.path.realpath(str(atlas_todo.board_path().parent.parent.parent)),
                os.path.realpath(env_root),
            )


class MirrorMonotonicCompletion(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        self.addCleanup(self._tmp.cleanup)

    def _item(self):
        return atlas_todo.load(self.root)["items"][0]

    def test_completed_with_evidence_survives_mirror_revert(self):
        atlas_todo.mirror(self.root, [{"content": "task", "status": "in_progress"}], "s1")
        item_id = self._item()["id"]
        self.assertTrue(atlas_todo.claim(self.root, item_id, "agent-a")["ok"])
        self.assertTrue(
            atlas_todo.set_status(self.root, item_id, "completed", owner="agent-a", evidence="tests pass")["ok"]
        )
        before = self._item()
        self.assertEqual(before["status"], "completed")
        # the lead re-mirrors the whole plan with the item still in progress
        atlas_todo.mirror(self.root, [{"content": "task", "status": "in_progress"}], "s1")
        after = self._item()
        self.assertEqual(after["status"], "completed")
        self.assertEqual(after["evidence"], "tests pass")
        self.assertEqual(after["completed_at"], before["completed_at"])
        self.assertEqual(after["owner"], "agent-a")
        # a pending incoming status cannot revert it either
        atlas_todo.mirror(self.root, [{"content": "task", "status": "pending"}], "s1")
        self.assertEqual(self._item()["status"], "completed")

    def test_claimed_in_progress_survives_stale_pending_mirror(self):
        atlas_todo.mirror(self.root, [{"content": "task", "status": "pending"}], "s1")
        item_id = self._item()["id"]
        self.assertTrue(atlas_todo.claim(self.root, item_id, "agent-a")["ok"])
        atlas_todo.mirror(self.root, [{"content": "task", "status": "pending"}], "s1")
        item = self._item()
        self.assertEqual(item["status"], "in_progress")
        self.assertEqual(item["owner"], "agent-a")

    def test_completed_without_evidence_still_reverts(self):
        atlas_todo.mirror(self.root, [{"content": "task", "status": "in_progress"}], "s1")
        item_id = self._item()["id"]
        self.assertTrue(atlas_todo.claim(self.root, item_id, "agent-a")["ok"])
        self.assertTrue(atlas_todo.set_status(self.root, item_id, "completed")["ok"])
        atlas_todo.mirror(self.root, [{"content": "task", "status": "pending"}], "s1")
        self.assertEqual(self._item()["status"], "pending")


class CorruptBoard(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        self.addCleanup(self._tmp.cleanup)

    def _write_garbage(self, text):
        p = atlas_todo.board_path(self.root)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")

    def _corrupt_files(self):
        return sorted(atlas_todo.board_path(self.root).parent.glob("todos.json.corrupt-*"))

    def test_writer_quarantines_unparseable_board(self):
        self._write_garbage("{not json")
        r = atlas_todo.add(self.root, "fresh start", session_id="s1")
        self.assertTrue(r["ok"])
        corrupt = self._corrupt_files()
        self.assertEqual(len(corrupt), 1)
        self.assertEqual(corrupt[0].read_text(encoding="utf-8"), "{not json")
        self.assertEqual(atlas_todo.load(self.root)["items"][0]["content"], "fresh start")

    def test_writer_quarantines_wrong_shaped_board(self):
        self._write_garbage('{"whatever": true}')
        r = atlas_todo.add(self.root, "after shape fix", session_id="s1")
        self.assertTrue(r["ok"])
        corrupt = self._corrupt_files()
        self.assertEqual(len(corrupt), 1)
        self.assertEqual(corrupt[0].read_text(encoding="utf-8"), '{"whatever": true}')
        self.assertEqual(atlas_todo.load(self.root)["items"][0]["content"], "after shape fix")

    def test_readonly_load_leaves_corrupt_file_alone(self):
        self._write_garbage("{nope")
        self.assertEqual(atlas_todo.load(self.root)["items"], [])
        self.assertEqual(self._corrupt_files(), [])
        self.assertEqual(atlas_todo.board_path(self.root).read_text(encoding="utf-8"), "{nope")

    def test_quarantine_is_recorded_as_note(self):
        self._write_garbage("{broken")
        self.assertTrue(atlas_todo.add(self.root, "recorded", session_id="s1")["ok"])
        notes = atlas_todo.notes(self.root)
        self.assertTrue(any("corrupt" in (n.get("text") or "") for n in notes))


class NotesChannel(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        self.addCleanup(self._tmp.cleanup)

    def test_note_appends_and_owner_sanitized(self):
        rec = atlas_todo.note(self.root, "atlas:fixer", "hello", to="agent-b", item="t1")
        self.assertEqual(rec["owner"], "atlas_fixer")
        atlas_todo.note(self.root, "bad/name here", "x")
        f1 = atlas_todo.notes_dir(self.root) / "atlas_fixer.jsonl"
        self.assertTrue(f1.exists())
        line = json.loads(f1.read_text(encoding="utf-8").strip())
        self.assertEqual(line["owner"], "atlas_fixer")
        self.assertEqual(line["to"], "agent-b")
        self.assertEqual(line["item"], "t1")
        self.assertEqual(line["text"], "hello")
        self.assertTrue((atlas_todo.notes_dir(self.root) / "bad_name_here.jsonl").exists())

    def test_notes_filtering_ordering_and_malformed_skip(self):
        atlas_todo.note(self.root, "agent-a", "first", to="agent-b")
        time.sleep(0.002)
        atlas_todo.note(self.root, "agent-b", "second", to="agent-a")
        time.sleep(0.002)
        t_cut = time.time()
        time.sleep(0.002)
        atlas_todo.note(self.root, "agent-a", "third", to="all")
        with open(atlas_todo.notes_dir(self.root) / "agent-a.jsonl", "a", encoding="utf-8") as fh:
            fh.write("this is not json\n")
            fh.write('{"owner": "ghost", "text": "no ts here"}\n')
        all_notes = atlas_todo.notes(self.root)
        self.assertEqual(
            [n["text"] for n in all_notes], ["no ts here", "first", "second", "third"]
        )
        self.assertEqual(
            [n["text"] for n in atlas_todo.notes(self.root, to="agent-b")],
            ["first", "third"],
        )
        self.assertEqual(
            [n["text"] for n in atlas_todo.notes(self.root, to="agent-a")],
            ["second", "third"],
        )
        self.assertEqual([n["text"] for n in atlas_todo.notes(self.root, since=t_cut)], ["third"])

    def test_notes_missing_dir_returns_empty(self):
        self.assertEqual(atlas_todo.notes(self.root), [])


class BoardConcurrency(unittest.TestCase):
    """Multiprocess stress: 6+ workers each appending 50 notes to their OWN
    file while racing claims on shared items."""

    WORKERS = 6
    NOTES_PER_WORKER = 50
    ITEMS = 20

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        self.addCleanup(self._tmp.cleanup)

    def test_parallel_workers_no_lost_notes_or_double_claims(self):
        scripts = os.path.dirname(os.path.abspath(atlas_todo.__file__))
        item_ids = [
            atlas_todo.add(self.root, f"item {i}")["item"]["id"]
            for i in range(self.ITEMS)
        ]
        worker_src = (
            "import sys\n"
            f"sys.path.insert(0, {scripts!r})\n"
            "import atlas_todo\n"
            "root, owner, n = sys.argv[1], sys.argv[2], int(sys.argv[3])\n"
            "item_ids = sys.argv[4:]\n"
            "for i in range(n):\n"
            "    atlas_todo.note(root, owner, 'note ' + str(i) + ' from ' + owner)\n"
            "for item_id in item_ids:\n"
            "    atlas_todo.claim(root, item_id, owner)\n"
        )
        procs = []
        for w in range(self.WORKERS):
            owner = f"worker-{w}"
            procs.append(
                subprocess.Popen(
                    [sys.executable, "-I", "-c", worker_src, self.root, owner, str(self.NOTES_PER_WORKER), *item_ids],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )
            )
        for p in procs:
            _out, err = p.communicate(timeout=120)
            self.assertEqual(p.returncode, 0, err.decode() if err else "worker failed")

        # zero lost notes: every worker's own file has exactly 50 valid lines
        total = 0
        for w in range(self.WORKERS):
            owner = f"worker-{w}"
            path = atlas_todo.notes_dir(self.root) / f"{owner}.jsonl"
            lines = path.read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(lines), self.NOTES_PER_WORKER)
            for line in lines:
                rec = json.loads(line)
                self.assertEqual(rec["owner"], owner)
            total += len(lines)
        self.assertEqual(total, self.WORKERS * self.NOTES_PER_WORKER)

        # exactly one claim winner per shared item
        board = atlas_todo.load(self.root)
        owners = {f"worker-{w}" for w in range(self.WORKERS)}
        claimed = 0
        for item in board["items"]:
            self.assertIn(item["owner"], owners)
            self.assertEqual(item["status"], "in_progress")
            claimed += 1
        self.assertEqual(claimed, self.ITEMS)


if __name__ == "__main__":
    unittest.main()


if __name__ == "__main__":
    unittest.main()
