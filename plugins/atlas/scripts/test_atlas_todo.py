#!/usr/bin/env python3
"""Tests for the durable todo board (atlas_todo.py)."""

import contextlib
import io
import json
import os
import tempfile
import time
import unittest

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


if __name__ == "__main__":
    unittest.main()


if __name__ == "__main__":
    unittest.main()
