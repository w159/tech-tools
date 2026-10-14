#!/usr/bin/env python3
"""spawn-team: deterministic team expansion, max_parallel semaphore, wait/reap."""
import json
import os
import pathlib
import tempfile
import unittest

import _test_isolation  # noqa: F401
import atlas_mux


class TeamTests(unittest.TestCase):
    def test_build_is_deterministic(self):
        a = atlas_mux.build_team("audit", "high", ["b", "a"], "do it")
        b = atlas_mux.build_team("audit", "high", ["a", "b"], "do it")
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))
        self.assertEqual(len(a["members"]), 5)
        self.assertEqual(len({m["name"] for m in a["members"]}), 5)
        self.assertEqual(a["max_parallel"], 5)

    def test_semaphore_never_exceeds_max_parallel(self):
        rec = atlas_mux.build_team("audit", "high", None, "x")
        rec["max_parallel"] = 2
        done, peak, order = set(), [0], []

        def spawn(m):
            order.append(m["name"])
            peak[0] = max(peak[0], len([n for n in order if n not in done]))
            return {"ok": True}

        def sleep(_):  # one running member exits per poll tick
            running = [n for n in order if n not in done]
            if running:
                done.add(running[0])

        res = atlas_mux.supervise(rec, spawn, lambda n: n in done, sleep, 0)
        self.assertEqual(len(res), 5)
        self.assertLessEqual(peak[0], 2)

    def test_wait_and_reap(self):
        root = tempfile.mkdtemp()
        os.environ["ATLAS_PROJECT_ROOT"] = root
        rec = atlas_mux.build_team("audit", "medium", None, "x")
        rec["created"] = 0.0
        rec["transport"] = "tmux"
        d = pathlib.Path(root) / atlas_mux.TEAMS_REL
        d.mkdir(parents=True)
        (d / f"{rec['team_id']}.json").write_text(json.dumps(rec))
        for m in rec["members"]:
            atlas_mux.atlas_todo.note(
                root, m["name"], "STATUS: DONE\nexit 0", to="lead", kind="report"
            )
        ns = type("N", (), {"root": root, "team": rec["team_id"], "timeout": 5, "poll": 0.1})
        self.assertEqual(atlas_mux.cmd_wait(ns), 0)
        self.assertEqual(atlas_mux.cmd_reap(ns), 0)
        self.assertFalse((d / f"{rec['team_id']}.json").exists())
        self.assertTrue((d / "archive" / f"{rec['team_id']}.json").exists())


if __name__ == "__main__":
    unittest.main()
