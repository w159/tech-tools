"""The crew's pytest shards hold only files pytest can collect: a bun .test.ts ran in its own worker's check."""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _test_isolation  # noqa: F401,E402
import atlas_crew  # noqa: E402

TS = "plugins/atlas/mod/data/core-scope.test.ts"


class ShardNonPythonTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        for f in ("a/test_x.py", "b/test_y.py", TS):
            (self.root / f).parent.mkdir(parents=True, exist_ok=True)
            (self.root / f).write_text("x = 1\n")
        env = mock.patch.dict("os.environ", {"ATLAS_CREW_SHARD": ""})
        env.start()
        self.addCleanup(env.stop)

    def test_no_shard_command_names_a_ts_file(self):
        jobs = atlas_crew._shard_jobs("python3 -m pytest -q", self.root, ["a/test_x.py", "b/test_y.py", TS], 4)
        self.assertTrue(jobs)
        for cmd, label, _ in jobs:
            self.assertNotIn(".ts", cmd)
            self.assertNotIn(".ts", label)

    def test_shard_count_ignores_the_ts_file(self):
        with_ts = atlas_crew.shard_count("python3 -m pytest -q", self.root, ["a/test_x.py", "b/test_y.py", TS], 4)
        without = atlas_crew.shard_count("python3 -m pytest -q", self.root, ["a/test_x.py", "b/test_y.py"], 4)
        self.assertEqual(with_ts, without)
        self.assertEqual(with_ts, 3)  # two file shards and the rest shard
        # one .py file and one .ts file: fewer than 2 pytest files, the check runs unsharded
        self.assertEqual(atlas_crew.shard_count("python3 -m pytest -q", self.root, ["a/test_x.py", TS], 4), 1)

    def test_a_skipped_ts_file_is_not_ignored(self):
        jobs = atlas_crew._shard_jobs("python3 -m pytest -q", self.root, ["a/test_x.py", "b/test_y.py"], 4, skip=[TS])
        self.assertTrue(all(".ts" not in cmd for cmd, _, _ in jobs))


if __name__ == "__main__":
    unittest.main()
