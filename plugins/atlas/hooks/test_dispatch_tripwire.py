import json, os, subprocess, sys, tempfile, unittest

HOOK = os.path.join(os.path.dirname(__file__), "dispatch_tripwire.py")


def run_hook(payload, env):
    p = subprocess.run(
        [sys.executable, HOOK],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
    )
    return p


class TripwireTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.env = dict(os.environ, ATLAS_DB=os.path.join(self.tmp, "atlas.db"))
        # seed a run so current_run_id resolves
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        conn = atlas_db.connect(self.env["ATLAS_DB"])
        atlas_db.init(conn)
        pid = atlas_db.register_project(conn, "/repo/x")
        atlas_db.start_run(conn, pid, "sess-1")
        conn.close()

    def _payload(self, tool, tinput=None):
        return {"session_id": "sess-1", "tool_name": tool, "tool_input": tinput or {}}

    def test_under_threshold_is_silent(self):
        for _ in range(3):
            r = run_hook(self._payload("Read", {"file_path": "a.py"}), self.env)
            self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")

    def test_trips_at_threshold(self):
        for _ in range(4):
            r = run_hook(self._payload("Read", {"file_path": "a.py"}), self.env)
        self.assertEqual(r.returncode, 0)
        self.assertIn("additionalContext", r.stdout)
        self.assertIn("STOP", r.stdout)

    def test_dispatch_resets(self):
        for _ in range(3):
            run_hook(self._payload("Read"), self.env)
        run_hook(self._payload("Task", {"subagent_type": "atlas:explorer"}), self.env)
        r = run_hook(self._payload("Read"), self.env)  # 1 since reset
        self.assertEqual(r.stdout.strip(), "")

    def test_off_switch(self):
        env = dict(self.env, ATLAS_TRIPWIRE="off")
        for _ in range(6):
            r = run_hook(self._payload("Read"), env)
        self.assertEqual(r.stdout.strip(), "")

    def test_fail_open_on_garbage_stdin(self):
        p = subprocess.run(
            [sys.executable, HOOK],
            input="not json",
            capture_output=True,
            text=True,
            env=self.env,
        )
        self.assertEqual(p.returncode, 0)

    def test_threshold_override(self):
        env = dict(self.env, ATLAS_TRIPWIRE_THRESHOLD="2")
        r = run_hook(self._payload("Read"), env)
        self.assertEqual(r.stdout.strip(), "")  # 1 op: silent
        r = run_hook(self._payload("Read"), env)
        self.assertIn("STOP", r.stdout)  # 2nd op: trips at override

    def test_hooks_json_matcher_includes_dispatch_tools(self):
        import json, os

        hj = os.path.join(os.path.dirname(__file__), "hooks.json")
        with open(hj) as f:
            data = json.load(f)
        entries = json.dumps(data)
        self.assertIn("dispatch_tripwire.py", entries)
        # find the matcher string that co-occurs with dispatch_tripwire
        blob = json.dumps(data)
        self.assertIn("Agent", blob)
        self.assertIn("Task", blob)
        # stronger: the tripwire group's matcher must include Agent and Task
        ok = False
        for grp in data.get("hooks", {}).get("PostToolUse", []):
            hooks = json.dumps(grp.get("hooks", grp))
            if "dispatch_tripwire.py" in hooks:
                self.assertIn("Agent", grp.get("matcher", ""))
                self.assertIn("Task", grp.get("matcher", ""))
                ok = True
        self.assertTrue(ok, "dispatch_tripwire entry not found in PostToolUse")


if __name__ == "__main__":
    unittest.main()
