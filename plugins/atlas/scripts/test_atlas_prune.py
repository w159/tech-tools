import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_prune as ap  # noqa: E402

DAY = 86400


def touch(path, age_days):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{}")
    t = time.time() - age_days * DAY
    os.utime(path, (t, t))


class PruneTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        self.run_dir = Path(self.root, ".atlas", ".run")
        self.run_dir.mkdir(parents=True)
        (self.run_dir / "channels.json").write_text(
            json.dumps({"channels": {"c": {"lead": "lead-1", "members": [{"name": "live-owner"}]}}})
        )
        for name in ("findings.json", "todos.json"):
            touch(self.run_dir / name, 400)

    def tearDown(self):
        self._tmp.cleanup()

    def crew(self, name, age, live=False):
        d = self.run_dir / "crew" / name
        d.mkdir(parents=True, exist_ok=True)
        (d / "run.json").write_text("{}")
        if live:
            (d / "supervisor.pid").write_text(str(os.getpid()))
        t = time.time() - age * DAY
        os.utime(d, (t, t))
        return d

    def test_prunes_closed_and_keeps_live_and_durable(self):
        old_crew = [self.crew(f"old{i}", 30 + i) for i in range(25)]
        live = self.crew("live-old", 90, live=True)
        young = self.crew("young", 0)
        for i in range(60):
            touch(self.run_dir / "board" / f"gone{i}.jsonl", 10 + i)
        touch(self.run_dir / "board" / "live-owner.jsonl", 100)
        touch(self.run_dir / "board" / "lead-1.jsonl", 100)
        touch(self.run_dir / "teams" / "archive" / "old.json", 3)
        touch(self.run_dir / "teams" / "archive" / "new.json", 0)
        touch(self.run_dir / "teams" / "tlive.json", 50)
        for i in range(9):
            touch(self.run_dir / f"dirty-snapshot-s{i}.json", 2 + i)
        touch(self.run_dir / "dirty-snapshot-fresh.json", 0)

        ap.apply(ap.plan(self.root))

        crews = set(os.listdir(self.run_dir / "crew"))
        self.assertIn("live-old", crews)
        self.assertIn("young", crews)
        # newest 20 of 27 survive (young + 19 old); live-old is older but alive
        self.assertEqual(len([c for c in crews if c.startswith("old")]), 19)
        self.assertTrue(live.exists() and young.exists())
        self.assertFalse(old_crew[-1].exists())
        boards = set(os.listdir(self.run_dir / "board"))
        self.assertEqual(len([b for b in boards if b.startswith("gone")]), 50)
        self.assertIn("live-owner.jsonl", boards)
        self.assertIn("lead-1.jsonl", boards)
        self.assertFalse((self.run_dir / "teams" / "archive" / "old.json").exists())
        self.assertTrue((self.run_dir / "teams" / "archive" / "new.json").exists())
        self.assertTrue((self.run_dir / "teams" / "tlive.json").exists())
        snaps = sorted(p for p in os.listdir(self.run_dir) if p.startswith("dirty-snapshot-"))
        self.assertEqual(len(snaps), 5)
        self.assertIn("dirty-snapshot-fresh.json", snaps)
        self.assertTrue((self.run_dir / "findings.json").exists())
        self.assertTrue((self.run_dir / "todos.json").exists())

    def test_dry_run_deletes_nothing_and_kill_switch(self):
        for i in range(8):
            touch(self.run_dir / f"dirty-snapshot-s{i}.json", 5 + i)
        script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "atlas_prune.py")
        out = subprocess.run(
            [sys.executable, script, "--root", self.root, "--dry-run"],
            capture_output=True, text=True, check=True,
        ).stdout
        self.assertIn("would remove snapshot", out)
        self.assertEqual(len([p for p in os.listdir(self.run_dir) if p.startswith("dirty")]), 8)
        subprocess.run(
            [sys.executable, script, "--root", self.root],
            env={**os.environ, "ATLAS_PRUNE": "off"}, check=True, capture_output=True,
        )
        self.assertEqual(len([p for p in os.listdir(self.run_dir) if p.startswith("dirty")]), 8)

    def test_unreadable_channels_prunes_no_board(self):
        (self.run_dir / "channels.json").write_text("not json")
        for i in range(60):
            touch(self.run_dir / "board" / f"gone{i}.jsonl", 30)
        self.assertEqual([k for k, _ in ap.plan(self.root) if k == "board"], [])


if __name__ == "__main__":
    unittest.main()
