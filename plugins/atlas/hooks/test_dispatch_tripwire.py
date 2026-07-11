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
        atlas_db.mark_orchestrating(
            conn, "sess-1"
        )  # WS1: tripwire only nags in orchestration runs
        conn.close()

    def _payload(self, tool, tinput=None):
        return {"session_id": "sess-1", "tool_name": tool, "tool_input": tinput or {}}

    def _post_payload(self, tool, tinput=None, session="sess-1"):
        return {
            "session_id": session,
            "hook_event_name": "PostToolUse",
            "tool_name": tool,
            "tool_input": tinput or {},
        }

    def _pre_payload(self, tool, tinput=None, session="sess-1"):
        return {
            "session_id": session,
            "hook_event_name": "PreToolUse",
            "tool_name": tool,
            "tool_input": tinput or {},
        }

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

    def test_no_trip_when_not_orchestrating(self):
        # A fresh non-orchestration session: boot-created run, never marked.
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        conn = atlas_db.connect(self.env["ATLAS_DB"])
        pid = atlas_db.register_project(conn, "/repo/x")
        atlas_db.start_run(conn, pid, "sess-chat")
        conn.close()
        last = None
        for _ in range(6):
            last = run_hook(
                {
                    "session_id": "sess-chat",
                    "tool_name": "Read",
                    "tool_input": {"file_path": "a.py"},
                },
                self.env,
            )
        self.assertEqual(last.returncode, 0)
        self.assertEqual(
            last.stdout.strip(), ""
        )  # no nag for a non-orchestration session

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

    def test_dispatch_logged_after_run_finalized(self):
        """A dispatch arriving after the run is finalized must still be logged."""
        import atlas_db

        # Finalize the run so current_run_id returns None.
        conn = atlas_db.connect(self.env["ATLAS_DB"])
        atlas_db.init(conn)
        run_id = atlas_db.current_run_id(conn, "sess-1")
        atlas_db.finalize_run(conn, run_id)
        conn.close()

        # Fire a dispatch -- should not silently drop even though run is closed.
        r = run_hook(
            self._payload("Agent", {"subagent_type": "atlas:implementer"}), self.env
        )
        self.assertEqual(r.returncode, 0)

        # Confirm the dispatch was persisted via the fallback resolver.
        conn2 = atlas_db.connect(self.env["ATLAS_DB"])
        fallback_id = atlas_db.current_or_last_run_id(conn2, "sess-1")
        self.assertIsNotNone(fallback_id)
        rows = conn2.execute(
            "SELECT COUNT(*) FROM dispatches WHERE run_id=?", (fallback_id,)
        ).fetchone()
        conn2.close()
        self.assertGreater(rows[0], 0, "dispatch not logged after run finalized")

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
                self.assertIn("Skill", grp.get("matcher", ""))
                ok = True
        self.assertTrue(ok, "dispatch_tripwire entry not found in PostToolUse")

    def _fresh_unmarked_session(self, session_id):
        import atlas_db

        conn = atlas_db.connect(self.env["ATLAS_DB"])
        pid = atlas_db.register_project(conn, "/repo/x")
        atlas_db.start_run(conn, pid, session_id)
        conn.close()

    def _is_orchestrating(self, session_id):
        import atlas_db

        conn = atlas_db.connect(self.env["ATLAS_DB"])
        flag = atlas_db.is_orchestrating(conn, session_id)
        conn.close()
        return flag

    def test_orchestration_skill_marks_session(self):
        self._fresh_unmarked_session("sess-skill")
        r = run_hook(
            {
                "session_id": "sess-skill",
                "tool_name": "Skill",
                "tool_input": {"skill": "atlas:atlas-metis"},
            },
            self.env,
        )
        self.assertEqual(r.returncode, 0)
        self.assertTrue(self._is_orchestrating("sess-skill"))

    def test_config_skill_does_not_mark_session(self):
        self._fresh_unmarked_session("sess-arch")
        run_hook(
            {
                "session_id": "sess-arch",
                "tool_name": "Skill",
                "tool_input": {"skill": "atlas:atlas-hephaestus"},
            },
            self.env,
        )
        self.assertFalse(self._is_orchestrating("sess-arch"))

    def test_atlas_agent_dispatch_marks_session(self):
        self._fresh_unmarked_session("sess-disp")
        run_hook(
            {
                "session_id": "sess-disp",
                "tool_name": "Agent",
                "tool_input": {"subagent_type": "atlas:explorer"},
            },
            self.env,
        )
        self.assertTrue(self._is_orchestrating("sess-disp"))

    def test_generic_agent_dispatch_does_not_mark_session(self):
        self._fresh_unmarked_session("sess-gen")
        run_hook(
            {
                "session_id": "sess-gen",
                "tool_name": "Agent",
                "tool_input": {"subagent_type": "Explore"},
            },
            self.env,
        )
        self.assertFalse(self._is_orchestrating("sess-gen"))

    # ---- PreToolUse deny tier ----

    def test_pre_deny_at_ninth_inline_op(self):
        # Seed 8 logged inline ops on the orchestrating session (setUp marks it).
        for _ in range(8):
            run_hook(self._post_payload("Read", {"file_path": "a.py"}), self.env)
        r = run_hook(self._pre_payload("Read", {"file_path": "b.py"}), self.env)
        self.assertEqual(r.returncode, 0)
        self.assertIn('"permissionDecision": "deny"', r.stdout)
        self.assertIn("atlas:explorer", r.stdout)
        self.assertIn("atlas:implementer", r.stdout)

    def test_pre_no_deny_when_not_orchestrating(self):
        self._fresh_unmarked_session("sess-pre-noorch")
        for _ in range(8):
            run_hook(
                self._post_payload(
                    "Read", {"file_path": "a.py"}, session="sess-pre-noorch"
                ),
                self.env,
            )
        r = run_hook(
            self._pre_payload("Read", {"file_path": "b.py"}, session="sess-pre-noorch"),
            self.env,
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")

    def test_pre_hard_off_disables_deny_only(self):
        for _ in range(8):
            run_hook(self._post_payload("Read", {"file_path": "a.py"}), self.env)
        env = dict(self.env, ATLAS_TRIPWIRE_HARD="off")
        r = run_hook(self._pre_payload("Read", {"file_path": "b.py"}), env)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")  # deny tier suppressed

    def test_pre_deny_prod_edit_allows_docs_edit(self):
        r = run_hook(self._pre_payload("Edit", {"file_path": "src/foo.py"}), self.env)
        self.assertEqual(r.returncode, 0)
        self.assertIn('"permissionDecision": "deny"', r.stdout)
        self.assertIn("atlas:implementer", r.stdout)
        r2 = run_hook(self._pre_payload("Edit", {"file_path": "docs/x.md"}), self.env)
        self.assertEqual(r2.returncode, 0)
        self.assertEqual(r2.stdout.strip(), "")

    def test_pre_fail_open_on_garbage_stdin(self):
        p = subprocess.run(
            [sys.executable, HOOK],
            input='{"hook_event_name": "PreToolUse", not json',
            capture_output=True,
            text=True,
            env=self.env,
        )
        self.assertEqual(p.returncode, 0)

    def test_hooks_json_pretooluse_registers_tripwire_and_keeps_bash_advisor(self):
        import json, os

        hj = os.path.join(os.path.dirname(__file__), "hooks.json")
        with open(hj) as f:
            data = json.load(f)  # asserts hooks.json parses as JSON
        pre = data["hooks"]["PreToolUse"]
        # bash_advisor's Bash registration must be untouched.
        bash_advisor_ok = any(
            "bash_advisor.py" in json.dumps(g) and g.get("matcher") == "Bash"
            for g in pre
        )
        self.assertTrue(bash_advisor_ok, "bash_advisor Bash registration disturbed")
        # dispatch_tripwire must be registered on PreToolUse with the full matcher.
        tw = [g for g in pre if "dispatch_tripwire.py" in json.dumps(g)]
        self.assertTrue(tw, "dispatch_tripwire not registered on PreToolUse")
        matcher = tw[0].get("matcher", "")
        for t in ("Edit", "Write", "MultiEdit", "Read", "Grep", "Glob", "Bash"):
            self.assertIn(t, matcher)


if __name__ == "__main__":
    unittest.main()
