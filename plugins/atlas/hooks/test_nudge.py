import json
import os
import subprocess
import sys
import tempfile
import unittest

HOOK = os.path.join(os.path.dirname(__file__), "nudge.py")


def run_hook(payload, env):
    return subprocess.run(
        [sys.executable, HOOK],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
    )


class NudgeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.env = dict(os.environ, ATLAS_DB=os.path.join(self.tmp, "atlas.db"))
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        c = atlas_db.connect(self.env["ATLAS_DB"])
        atlas_db.init(c)
        pid = atlas_db.register_project(c, "/repo/x")
        atlas_db.start_run(c, pid, "sess-chat")
        atlas_db.start_run(c, pid, "sess-orch")
        atlas_db.mark_orchestrating(c, "sess-orch")
        c.close()
        # Remove the throttle marker so test_fires_for_orchestration is deterministic
        m = os.path.join(os.path.expanduser("~"), ".atlas", ".atlas_nudge")
        if os.path.exists(m):
            os.remove(m)

    def test_silent_for_non_orchestration(self):
        r = run_hook({"session_id": "sess-chat", "cwd": self.tmp}, self.env)
        self.assertEqual(r.stdout.strip(), "")

    def test_fires_for_orchestration(self):
        r = run_hook({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn("additionalContext", r.stdout)


if __name__ == "__main__":
    unittest.main()
