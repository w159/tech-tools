"""sweep_stale against a real temp git repo and temp HOME (no real worktrees touched)."""

import _test_isolation  # noqa: F401,E402
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import atlas_db  # noqa: E402
import atlas_selffix as sf  # noqa: E402

OLD = time.time() - 10 * 86400


class SweepTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.repo = os.path.join(self.tmp, "repo")
        os.makedirs(self.repo)
        for c in (
            ["init", "-q"],
            [
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@t",
                "commit",
                "-q",
                "--allow-empty",
                "-m",
                "x",
            ],
        ):
            subprocess.run(["git", *c], cwd=self.repo, check=True)
        self.conn = atlas_db.connect(os.path.join(self.tmp, "t.db"))
        atlas_db.init(self.conn)
        p = mock.patch.object(sf, "_home", lambda: Path(self.tmp) / "home")
        p.start()
        self.addCleanup(p.stop)

    def tree(self, fid, age_old=True, status=None, fix_state=None):
        wt, br = sf.worktree_for(self.repo, fid)
        os.makedirs(os.path.dirname(wt), exist_ok=True)
        subprocess.run(
            ["git", "worktree", "add", "-q", wt, "-b", br], cwd=self.repo, check=True
        )
        if status:
            self.conn.execute(
                "INSERT INTO findings(id,fingerprint,title,status,fix_state) VALUES(?,?,?,?,?)",
                (fid, f"fp{fid}", "t", status, fix_state),
            )
            self.conn.commit()
        if age_old:
            os.utime(wt, (OLD, OLD))
        return wt

    def test_sweep(self):
        gone = self.tree(1, status="applied")
        missing = self.tree(2)
        queued = self.tree(3, status="accepted", fix_state="queued")
        running = self.tree(4, status="verified", fix_state="running")
        fresh = self.tree(5, age_old=False, status="applied")
        dry = sf.sweep_stale(self.conn, dry_run=True)
        self.assertEqual(
            {r["action"] for r in dry if r["worktree"] in (gone, missing)}, {"remove"}
        )
        self.assertTrue(os.path.isdir(gone))  # dry run deletes nothing
        sf.sweep_stale(self.conn)
        self.assertFalse(os.path.isdir(gone))
        self.assertFalse(os.path.isdir(missing))
        for kept in (queued, running, fresh):
            self.assertTrue(os.path.isdir(kept), kept)


if __name__ == "__main__":
    unittest.main()
