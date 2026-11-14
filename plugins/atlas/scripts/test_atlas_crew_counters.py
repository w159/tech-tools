#!/usr/bin/env python3
"""atlas_crew: crew.* anonymous counters written once per run by _write_summary."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import _test_isolation  # noqa: F401

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas_analytics  # noqa: E402
import atlas_crew  # noqa: E402


class CrewCounterTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        p = mock.patch.dict(os.environ, {"ATLAS_HOME": self.tmp.name, "ATLAS_ANALYTICS": "on"})
        p.start()
        self.addCleanup(p.stop)
        atlas_analytics._reset()
        self.addCleanup(atlas_analytics._reset)
        self.rundir = Path(self.tmp.name) / "run"
        self.rundir.mkdir()
        (self.rundir / "run.json").write_text(json.dumps({"timeout": 600}))

    def _write(self, **kw):
        s = {"ok": True, "killed": False, "check_exit": 0, "wall_s": 30.0, "rounds": [{"round": 0}], "workers": [{}, {}]}
        s.update(kw)
        atlas_crew._write_summary(self.rundir, s)

    def _keys(self):
        path = Path(self.tmp.name) / "analytics" / "events.jsonl"
        if not path.exists():
            return []
        return [json.loads(x)["k"] for x in path.read_text().splitlines()]

    def test_done_run(self):
        self._write()
        self.assertEqual(
            self._keys(),
            ["crew.workers.2", "crew.outcome.done", "crew.wall.lt1m", "crew.rounds.0", "crew.check.pass"],
        )

    def test_killed_run(self):
        self._write(ok=False, killed=True, check_exit=1, rounds=[], workers=[{}] * 5, wall_s=400)
        self.assertEqual(
            self._keys(),
            ["crew.workers.5-8", "crew.outcome.killed", "crew.wall.5to15m", "crew.rounds.0", "crew.check.fail"],
        )

    def test_failed_run_with_fix_rounds(self):
        rounds = [{"round": i} for i in range(5)]  # first attempt + 4 fix rounds
        self._write(ok=False, check_exit=2, rounds=rounds, workers=[{}], wall_s=100)
        self.assertEqual(
            self._keys(),
            ["crew.workers.1", "crew.outcome.failed", "crew.wall.1to5m", "crew.rounds.3+", "crew.check.fail"],
        )

    def test_timeout_run_and_no_check(self):
        self._write(ok=False, check_exit=None, wall_s=601, workers=[{}] * 9)
        self.assertEqual(
            self._keys(),
            ["crew.workers.9+", "crew.outcome.timeout", "crew.wall.5to15m", "crew.rounds.0", "crew.check.none"],
        )

    def test_second_write_for_the_same_run_does_not_count_again(self):
        self._write()
        n = len(self._keys())
        self._write(ok=False)
        self.assertEqual(len(self._keys()), n)

    def test_counter_failure_never_breaks_the_summary(self):
        with mock.patch.object(atlas_analytics, "record", side_effect=RuntimeError("x")):
            self._write()
        self.assertTrue((self.rundir / "summary.json").exists())

    def test_keys_validate_against_the_schema(self):
        self._write(rounds=[{}, {}, {}], wall_s=7200, workers=[{}] * 4)
        self.assertEqual(len(self._keys()), 5)
        self.assertEqual(self._keys()[3], "crew.rounds.2")
        self.assertEqual(self._keys()[2], "crew.wall.ge60m")


if __name__ == "__main__":
    unittest.main()
