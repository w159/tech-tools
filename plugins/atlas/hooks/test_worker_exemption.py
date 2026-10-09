import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import json

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import _test_isolation  # noqa: F401  (redirects ~/.atlas to a tempdir)

HOOK = os.path.join(os.path.dirname(__file__), "dispatch_tripwire.py")


def run_hook(payload, env):
    return subprocess.run(
        [sys.executable, HOOK],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
    )


class WorkerExemptionTest(unittest.TestCase):
    """A headless atlas_mux worker (ATLAS_WORKER_NAME non-blank) is a leaf: never armed,
    never denied or nagged, even on a run already flagged orchestrating. A lead is unchanged."""

    SESSION = "sess-wk"

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.env = {
            k: v
            for k, v in os.environ.items()
            if k not in ("ATLAS_WORKER_NAME", "ATLAS_TRIPWIRE_HARD")
        }
        self.env["ATLAS_DB"] = os.path.join(self.tmp, "atlas.db")
        self.env["ATLAS_GATES"] = (
            "always"  # temp-dir cwd leaves gates unarmed otherwise
        )
        self.env["ATLAS_CHANNELS"] = "off"
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        self.atlas_db = atlas_db
        conn = atlas_db.connect(self.env["ATLAS_DB"])
        atlas_db.init(conn)
        pid = atlas_db.register_project(conn, "/repo/x")
        atlas_db.start_run(conn, pid, self.SESSION)
        conn.close()

    def _flag(self):
        conn = self.atlas_db.connect(self.env["ATLAS_DB"])
        self.atlas_db.mark_orchestrating(conn, self.SESSION)
        conn.close()

    def _orchestrating(self):
        conn = self.atlas_db.connect(self.env["ATLAS_DB"])
        try:
            return self.atlas_db.is_orchestrating(conn, self.SESSION)
        finally:
            conn.close()

    def _hook(self, event, tool, tinput, env):
        r = run_hook(
            {
                "session_id": self.SESSION,
                "hook_event_name": event,
                "tool_name": tool,
                "tool_input": tinput,
                "cwd": self.tmp,
            },
            env,
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        return r

    def _seed_inline_ops(self, n):
        conn = self.atlas_db.connect(self.env["ATLAS_DB"])
        run_id = self.atlas_db.current_run_id(conn, self.SESSION)
        for _ in range(n):
            self.atlas_db.log_event(conn, run_id, "Bash", "main", 1, None)
        conn.close()

    def test_worker_edit_of_target_code_not_denied_lead_is(self):
        self._flag()
        edit = {"file_path": "/repo/x/app.py", "old_string": "a", "new_string": "b"}
        lead = self._hook("PreToolUse", "Edit", edit, self.env)
        self.assertIn("never edit target code inline", lead.stdout)
        worker = self._hook(
            "PreToolUse", "Edit", edit, dict(self.env, ATLAS_WORKER_NAME="W")
        )
        self.assertEqual(worker.stdout.strip(), "")

    def test_worker_many_inline_ops_not_denied_lead_is(self):
        self._flag()
        self._seed_inline_ops(8)
        bash = {"command": "make build"}
        lead = self._hook("PreToolUse", "Bash", bash, self.env)
        self.assertIn("inline ops since your last dispatch", lead.stdout)
        worker = self._hook(
            "PreToolUse", "Bash", bash, dict(self.env, ATLAS_WORKER_NAME="W")
        )
        self.assertEqual(worker.stdout.strip(), "")

    def test_blank_worker_name_is_not_a_worker(self):
        self._flag()
        edit = {"file_path": "/repo/x/app.py", "old_string": "a", "new_string": "b"}
        for blank in ("", "   "):
            r = self._hook(
                "PreToolUse", "Edit", edit, dict(self.env, ATLAS_WORKER_NAME=blank)
            )
            self.assertIn("never edit target code inline", r.stdout)

    def test_worker_is_never_armed_by_footprint_or_orchestrate_skill(self):
        env = dict(self.env, ATLAS_WORKER_NAME="W")
        for name in ("a.py", "b.py", "c.py", "d.py"):
            r = self._hook(
                "PostToolUse", "Write", {"file_path": "/repo/x/" + name}, env
            )
            self.assertNotIn("tripwires are now armed", r.stdout)
        self.assertFalse(self._orchestrating())
        import dispatch_tripwire

        skill = sorted(dispatch_tripwire.ORCH_SKILLS)[0]
        self._hook("PostToolUse", "Skill", {"skill": skill}, env)
        self.assertFalse(self._orchestrating())

    def test_lead_is_still_armed_by_footprint(self):
        for name in ("a.py", "b.py", "c.py"):
            self._hook(
                "PostToolUse", "Write", {"file_path": "/repo/x/" + name}, self.env
            )
        self.assertTrue(self._orchestrating())

    def test_flagged_worker_gets_no_stop_advisory(self):
        self._flag()
        env = dict(self.env, ATLAS_WORKER_NAME="W")
        out = ""
        for i in range(10):
            out += self._hook(
                "PostToolUse", "Edit", {"file_path": "/repo/x/f%d.py" % i}, env
            ).stdout
        self.assertNotIn("STOP", out)

    def test_arm_orchestration_skips_worker_prompt(self):
        import prompt_optimizer

        data = {"session_id": self.SESSION}
        prompt = "refactor the db module in src/app.py and fix the failing tests"
        old = {
            k: os.environ.get(k)
            for k in ("ATLAS_WORKER_NAME", "ATLAS_ENGINE_ARM", "ATLAS_DB")
        }
        try:
            os.environ.pop("ATLAS_ENGINE_ARM", None)
            os.environ["ATLAS_DB"] = self.env["ATLAS_DB"]
            os.environ["ATLAS_WORKER_NAME"] = "W"
            self.assertIsNone(prompt_optimizer.arm_orchestration(data, prompt))
            self.assertFalse(self._orchestrating())
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v


if __name__ == "__main__":
    unittest.main()
