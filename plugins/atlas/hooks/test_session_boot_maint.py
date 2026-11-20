import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import session_boot_core as core  # noqa: E402


class MaintSpawnTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = os.path.join(self.tmp.name, "home")
        os.makedirs(self.home)
        self.root = os.path.join(self.tmp.name, "proj")
        os.makedirs(self.root)
        env = mock.patch.dict(os.environ, {"ATLAS_HOME": self.home})
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop("ATLAS_MAINT", None)
        self.calls = []

    def popen(self, cmd, **kw):
        self.calls.append((cmd, kw))
        return mock.Mock(wait=mock.Mock(side_effect=AssertionError("waited")))

    def stamp(self, db, proj):
        with open(os.path.join(self.home, "maint-stamp.json"), "w") as fh:
            json.dump({"db": db, "projects": {os.path.realpath(self.root): proj}}, fh)

    def test_spawns_when_due_detached(self):
        self.assertTrue(core.maybe_spawn_maint(self.root, popen=self.popen))
        cmd, kw = self.calls[0]
        self.assertTrue(cmd[1].endswith("atlas_maint.py"))
        self.assertEqual(cmd[-2:], ["--project", os.path.realpath(self.root)])
        self.assertTrue(kw["start_new_session"])
        self.assertEqual(kw["stdout"], subprocess.DEVNULL)

    def test_not_when_fresh(self):
        now = time.time()
        self.stamp(now - 60, now - 60)
        self.assertFalse(core.maybe_spawn_maint(self.root, popen=self.popen))
        self.assertEqual(self.calls, [])

    def test_spawns_when_only_project_due(self):
        now = time.time()
        self.stamp(now - 60, now - 3 * 86400)
        self.assertTrue(core.maybe_spawn_maint(self.root, popen=self.popen))

    def test_not_when_off(self):
        with mock.patch.dict(os.environ, {"ATLAS_MAINT": "off"}):
            self.assertFalse(core.maybe_spawn_maint(self.root, popen=self.popen))
        self.assertEqual(self.calls, [])

    def test_fail_open_and_no_wait(self):
        def boom(*a, **k):
            raise OSError("no")

        self.assertFalse(core.maybe_spawn_maint(self.root, popen=boom))
        self.assertTrue(core.maybe_spawn_maint(self.root, popen=self.popen))


if __name__ == "__main__":
    unittest.main()
