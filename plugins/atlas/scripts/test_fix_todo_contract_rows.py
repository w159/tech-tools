"""17.28.0: the boot archive pass moves old foreign pending rows out of todos.json.

Measured on this repo: todos.json held 2812 rows (2 MB), 2790 of them archived and
never moved out; 413 pending rows carried `session_id: "contract"` (written by
hooks/test_atlas_contract.py booting session_boot.py with that id against the real
repo) and 142 pending rows had an empty session id (a boot or `carry` with no
session). carry_over archived them in place, rotate_archive (the only mover) runs
from the CLI `carry` alone, so the board grew without bound. The boot pass now moves
any pending row older than _ARCHIVE_AGE_S whose session is not the current one into
the archive aside file rotate_archive already writes: nothing is erased.
"""

import json
import os
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_todo  # noqa: E402

DAY = 86400.0


def _row(i, sid, status="pending", age_s=0.0, archived=False, origin="carried"):
    t = time.time() - age_s
    row = {
        "id": f"r{i}",
        "content": f"row {i}",
        "status": status,
        "owner": None,
        "session_id": sid,
        "origin": origin,
        "created_at": t,
        "updated_at": t,
        "evidence": None,
        "completed_at": None,
        "archived": archived,
    }
    if archived:
        row["archived_reason"] = "carry_expired"
        row["archived_at"] = t
    return row


class BootArchivesForeignPending(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = self._tmp.name
        self.sid = "3f25ef76-c6ea-4b61-906d-60dca7d35456"

    def _save(self, items):
        atlas_todo.save(self.root, {"version": 1, "items": items})

    def _aside(self):
        adir = atlas_todo.board_path(self.root).parent / "archive"
        out = []
        for p in sorted(adir.glob("todos-*.jsonl")) if adir.is_dir() else []:
            out += [json.loads(line) for line in p.read_text().splitlines() if line]
        return out

    def test_old_foreign_pending_rows_leave_the_board_and_own_rows_stay(self):
        old = 10 * DAY
        foreign = (
            # the real shape: archived-in-place contract rows and empty-sid rows
            [_row(i, "contract", age_s=old, archived=True) for i in range(200)]
            + [_row(200 + i, "", age_s=old, archived=True) for i in range(80)]
            # and never-archived old foreign pending rows
            + [_row(300 + i, "contract", age_s=old) for i in range(40)]
            + [_row(400 + i, "dead-session", status="in_progress", age_s=old) for i in range(5)]
        )
        own = [
            _row(900, self.sid, status="in_progress", origin="session", age_s=old),
            _row(901, self.sid, status="pending", origin="session", age_s=old),
            _row(902, self.sid, status="completed", origin="session"),
        ]
        self._save(foreign + own)
        before = atlas_todo.board_path(self.root).stat().st_size

        atlas_todo.carry_over(self.root, self.sid)

        items = atlas_todo.load(self.root)["items"]
        ids = {i["id"] for i in items}
        self.assertEqual(ids, {"r900", "r901", "r902"})
        mine = {i["id"]: i for i in items}
        for r in own:  # the current session's rows are untouched
            self.assertEqual(mine[r["id"]], r)
        self.assertLess(atlas_todo.board_path(self.root).stat().st_size, before / 10)
        # nothing silently erased: every moved row sits in the aside file, marked archived
        aside = self._aside()
        self.assertEqual({a["id"] for a in aside}, {r["id"] for r in foreign})
        self.assertTrue(all(a["archived"] for a in aside))

    def test_recent_foreign_pending_row_stays(self):
        recent = _row(1, "other-session", age_s=3 * DAY, origin="session")
        fresh = _row(2, "", age_s=60, origin="session")
        self._save([recent, fresh, _row(3, self.sid, origin="session")])

        atlas_todo.carry_over(self.root, self.sid)

        ids = {i["id"] for i in atlas_todo.load(self.root)["items"]}
        self.assertEqual(ids, {"r1", "r2", "r3"})
        self.assertEqual(self._aside(), [])

    def test_manual_and_advisor_rows_keep_their_own_lifecycle(self):
        # _KEEP_ORIGINS rows are never carried; sweep() ages advisor notes. The boot pass leaves them.
        man = _row(1, "other", age_s=30 * DAY, origin="manual")
        adv = _row(2, "other", age_s=30 * DAY, origin="advisor")
        self._save([man, adv])

        atlas_todo.carry_over(self.root, self.sid)

        ids = {i["id"] for i in atlas_todo.load(self.root)["items"]}
        self.assertEqual(ids, {"r1", "r2"})


if __name__ == "__main__":
    unittest.main()
