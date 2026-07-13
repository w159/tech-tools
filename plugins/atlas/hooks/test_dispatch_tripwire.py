import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

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
        r = None
        for _ in range(3):
            r = run_hook(self._payload("Read", {"file_path": "a.py"}), self.env)
            self.assertEqual(r.returncode, 0)
        assert r is not None  # range(3) always runs at least once
        self.assertEqual(r.stdout.strip(), "")

    def test_trips_at_threshold(self):
        r = None
        for _ in range(4):
            r = run_hook(self._payload("Read", {"file_path": "a.py"}), self.env)
        assert r is not None  # range(4) always runs at least once
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
        assert last is not None  # range(6) always runs at least once
        self.assertEqual(last.returncode, 0)
        self.assertEqual(
            last.stdout.strip(), ""
        )  # no nag for a non-orchestration session

    def test_off_switch(self):
        env = dict(self.env, ATLAS_TRIPWIRE="off")
        r = None
        for _ in range(6):
            r = run_hook(self._payload("Read"), env)
        assert r is not None  # range(6) always runs at least once
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
        import json
        import os

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
                "tool_input": {"skill": "atlas:atlas-orchestrate"},
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
                "tool_input": {"skill": "atlas:atlas-setup"},
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
        # Since the 4.0.0 SSOT migration only .atlas/docs/ is the
        # orchestration-artifact tree; a plain docs/ path is target code.
        r2 = run_hook(self._pre_payload("Edit", {"file_path": "docs/x.md"}), self.env)
        self.assertEqual(r2.returncode, 0)
        self.assertIn('"permissionDecision": "deny"', r2.stdout)
        r3 = run_hook(
            self._pre_payload("Edit", {"file_path": ".atlas/docs/x.md"}), self.env
        )
        self.assertEqual(r3.returncode, 0)
        self.assertEqual(r3.stdout.strip(), "")

    def test_notebook_multiedit_on_prod_path_is_denied(self):
        # M3: a MultiEdit on a production .ipynb carries the path under
        # notebook_path, which the path extractor ignored; the inline-edit
        # deny tier must still fire on production target code.
        r = run_hook(
            self._pre_payload("MultiEdit", {"notebook_path": "src/foo.ipynb"}),
            self.env,
        )
        self.assertEqual(r.returncode, 0)
        self.assertIn('"permissionDecision": "deny"', r.stdout)
        self.assertIn("atlas:implementer", r.stdout)

    def test_inline_ops_db_error_fails_closed(self):
        # M4: if the inline-op count query raises mid-orchestration, the
        # tripwire must fail CLOSED (deny), not fail-open to a silent pass.
        # Seed 8 inline ops so the count is over the deny threshold.
        for _ in range(8):
            run_hook(self._post_payload("Read", {"file_path": "a.py"}), self.env)
        # Corrupt the events table so inline_ops_since_last_dispatch raises:
        # rename the real table and leave a stub missing the is_inline_op
        # column. init()'s CREATE TABLE IF NOT EXISTS sees the stub and skips,
        # so the SELECT on is_inline_op raises OperationalError at query time.
        import atlas_db

        conn = atlas_db.connect(self.env["ATLAS_DB"])
        conn.execute("ALTER TABLE events RENAME TO events_bak_m4")
        conn.execute(
            "CREATE TABLE events (id INTEGER PRIMARY KEY, run_id INTEGER, "
            "ts REAL, tool TEXT, context TEXT, path TEXT)"
        )
        conn.commit()
        conn.close()
        r = run_hook(self._pre_payload("Read", {"file_path": "b.py"}), self.env)
        self.assertEqual(r.returncode, 0)
        self.assertNotEqual(r.stdout.strip(), "")  # not a silent pass
        self.assertIn('"permissionDecision": "deny"', r.stdout)

    def test_pre_fail_open_on_garbage_stdin(self):
        p = subprocess.run(
            [sys.executable, HOOK],
            input='{"hook_event_name": "PreToolUse", not json',
            capture_output=True,
            text=True,
            env=self.env,
        )
        self.assertEqual(p.returncode, 0)

    def test_fail_open_writes_stderr_on_exception(self):
        # The outer __main__ guard must surface the caught exception on stderr
        # (matching auto_skill/memory_capture) instead of silently swallowing
        # it. Garbage stdin forces main() to raise json.loads, hitting the
        # guard; the process must still exit 0 (fail-open) AND write a
        # diagnosable fail-open line to stderr.
        p = subprocess.run(
            [sys.executable, HOOK],
            input="not json",
            capture_output=True,
            text=True,
            env=self.env,
        )
        self.assertEqual(p.returncode, 0)
        self.assertIn("[atlas] dispatch_tripwire fail-open:", p.stderr)

    def test_hooks_json_pretooluse_registers_tripwire_and_keeps_bash_advisor(self):
        import json
        import os

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


class InProcessTest(unittest.TestCase):
    """In-process tests: import dispatch_tripwire and call main() with mocked
    stdin/env so coverage traces the real branching logic. The subprocess
    TripwireTest above gives end-to-end exit-code coverage but contributes 0%
    to line coverage because the hook runs in a separate process.
    """

    @classmethod
    def setUpClass(cls):
        cls.hooks_dir = os.path.dirname(__file__)
        sys.path.insert(0, cls.hooks_dir)
        sys.path.insert(0, os.path.join(cls.hooks_dir, "..", "scripts"))
        import atlas_db
        import dispatch_tripwire

        cls.atlas_db = atlas_db
        cls.dt = dispatch_tripwire

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.db_path = os.path.join(self.tmp, "atlas.db")
        # Seed an orchestrating run for sess-1 so the inline-op advisory and
        # deny tiers have an active, orchestrating run to gate against.
        conn = self.atlas_db.connect(self.db_path)
        self.atlas_db.init(conn)
        pid = self.atlas_db.register_project(conn, "/repo/x")
        self.atlas_db.start_run(conn, pid, "sess-1")
        self.atlas_db.mark_orchestrating(conn, "sess-1")
        conn.close()

    # ---- harness ----

    def _run_main(self, payload, env=None):
        """Call dispatch_tripwire.main() in-process with mocked stdin/env."""
        e = {
            "ATLAS_DB": self.db_path,
            "ATLAS_TRIPWIRE": "on",
            "ATLAS_TRIPWIRE_HARD": "on",
            "ATLAS_TRIPWIRE_THRESHOLD": "4",
        }
        if env:
            e.update(env)
        out = io.StringIO()
        with (
            patch.dict(os.environ, e),
            patch("sys.stdin", new=io.StringIO(json.dumps(payload))),
            contextlib.redirect_stdout(out),
        ):
            self.dt.main()
        return out.getvalue()

    def _post(self, tool, tinput=None, session="sess-1"):
        return {
            "hook_event_name": "PostToolUse",
            "session_id": session,
            "tool_name": tool,
            "tool_input": tinput or {},
        }

    def _pre(self, tool, tinput=None, session="sess-1"):
        return {
            "hook_event_name": "PreToolUse",
            "session_id": session,
            "tool_name": tool,
            "tool_input": tinput or {},
        }

    def _fresh_run(self, session_id, mark_orch=False):
        conn = self.atlas_db.connect(self.db_path)
        pid = self.atlas_db.register_project(conn, "/repo/x")
        self.atlas_db.start_run(conn, pid, session_id)
        if mark_orch:
            self.atlas_db.mark_orchestrating(conn, session_id)
        conn.close()

    def _is_orch(self, session_id):
        conn = self.atlas_db.connect(self.db_path)
        flag = self.atlas_db.is_orchestrating(conn, session_id)
        conn.close()
        return flag

    def _dispatch_count(self, session_id):
        conn = self.atlas_db.connect(self.db_path)
        rid = self.atlas_db.current_or_last_run_id(conn, session_id)
        row = conn.execute(
            "SELECT COUNT(*) FROM dispatches WHERE run_id=?", (rid,)
        ).fetchone()
        conn.close()
        return row[0]

    # ---- main() off switch ----

    def test_ip_off_switch_returns_before_db(self):
        out = self._run_main(
            self._post("Read", {"file_path": "a.py"}), env={"ATLAS_TRIPWIRE": "off"}
        )
        self.assertEqual(out, "")

    # ---- PostToolUse advisory tier ----

    def test_ip_post_under_threshold_is_silent(self):
        for _ in range(3):
            out = self._run_main(self._post("Read", {"file_path": "a.py"}))
            self.assertEqual(out, "")

    def test_ip_post_trips_at_threshold(self):
        out = ""
        for _ in range(4):
            out = self._run_main(self._post("Read", {"file_path": "a.py"}))
        self.assertIn("additionalContext", out)
        self.assertIn("STOP", out)

    def test_ip_post_edit_to_target_nags(self):
        out = self._run_main(self._post("Edit", {"file_path": "src/foo.py"}))
        self.assertIn("STOP", out)
        self.assertIn("atlas:implementer", out)

    def test_ip_pre_deny_notebook_edit(self):
        # M3: notebook_path is the path key for MultiEdit on .ipynb; the inline
        # edit deny tier must still fire on production target code.
        out = self._run_main(self._pre("MultiEdit", {"notebook_path": "src/foo.ipynb"}))
        self.assertIn('"permissionDecision": "deny"', out)
        self.assertIn("atlas:implementer", out)

    def test_ip_post_path_key_resolves(self):
        # The path extractor falls back to tool_input["path"] when file_path is
        # absent; the op must still log and stay silent under threshold.
        out = self._run_main(self._post("Read", {"path": "a.py"}))
        self.assertEqual(out, "")

    def test_ip_post_non_orchestrating_skips_nag(self):
        # WS1: a non-orchestration session logs inline ops but is never nagged,
        # even past the threshold.
        self._fresh_run("sess-chat", mark_orch=False)
        out = ""
        for _ in range(6):
            out = self._run_main(
                self._post("Read", {"file_path": "a.py"}, session="sess-chat")
            )
        self.assertEqual(out, "")

    def test_ip_post_no_active_run_is_silent(self):
        # A finalized session has no current run -> inline-op branch returns
        # before logging.
        conn = self.atlas_db.connect(self.db_path)
        rid = self.atlas_db.current_run_id(conn, "sess-1")
        self.atlas_db.finalize_run(conn, rid)
        conn.close()
        out = self._run_main(self._post("Read", {"file_path": "a.py"}))
        self.assertEqual(out, "")

    def test_ip_post_non_inline_tool_is_silent(self):
        # A tool outside INLINE_TOOLS on an active orchestrating run returns
        # before the inline-op counter is touched.
        out = self._run_main(self._post("WebFetch", {"file_path": "a.py"}))
        self.assertEqual(out, "")

    def test_ip_post_threshold_value_error_falls_back(self):
        # A non-integer ATLAS_TRIPWIRE_THRESHOLD must fall back to 4, not crash.
        out = self._run_main(
            self._post("Read", {"file_path": "a.py"}),
            env={"ATLAS_TRIPWIRE_THRESHOLD": "not-an-int"},
        )
        self.assertEqual(out, "")  # 1 op < default 4 -> silent, no crash

    # ---- Skill branch ----

    def test_ip_skill_orch_marks_session(self):
        self._fresh_run("sess-skill", mark_orch=False)
        self._run_main(
            {
                "hook_event_name": "PostToolUse",
                "session_id": "sess-skill",
                "tool_name": "Skill",
                "tool_input": {"skill": "atlas:atlas-orchestrate"},
            }
        )
        self.assertTrue(self._is_orch("sess-skill"))

    def test_ip_skill_config_does_not_mark(self):
        self._fresh_run("sess-arch", mark_orch=False)
        self._run_main(
            {
                "hook_event_name": "PostToolUse",
                "session_id": "sess-arch",
                "tool_name": "Skill",
                "tool_input": {"skill": "atlas:atlas-setup"},
            }
        )
        self.assertFalse(self._is_orch("sess-arch"))

    # ---- Dispatch branch ----

    def test_ip_dispatch_atlas_agent_marks_session(self):
        # A session with no run yet: current_or_last_run_id is None so the
        # dispatch is not logged, but dispatching an atlas: agent still marks
        # the session orchestrating (mark_orchestrating creates the run).
        out = self._run_main(
            {
                "hook_event_name": "PostToolUse",
                "session_id": "sess-atlas",
                "tool_name": "Agent",
                "tool_input": {"subagent_type": "atlas:explorer"},
            }
        )
        self.assertEqual(out, "")
        self.assertTrue(self._is_orch("sess-atlas"))

    def test_ip_dispatch_generic_agent_logs_without_marking(self):
        # A session with an active run: the dispatch is logged via the
        # fallback resolver, but a generic agent_type does not mark the
        # session orchestrating.
        self._fresh_run("sess-gen", mark_orch=False)
        out = self._run_main(
            {
                "hook_event_name": "PostToolUse",
                "session_id": "sess-gen",
                "tool_name": "Agent",
                "tool_input": {"subagent_type": "Explore"},
            }
        )
        self.assertEqual(out, "")
        self.assertFalse(self._is_orch("sess-gen"))
        self.assertGreaterEqual(self._dispatch_count("sess-gen"), 1)

    # ---- PreToolUse deny tier ----

    def test_ip_pre_deny_at_threshold(self):
        for _ in range(8):
            self._run_main(self._post("Read", {"file_path": "a.py"}))
        out = self._run_main(self._pre("Read", {"file_path": "b.py"}))
        self.assertIn('"permissionDecision": "deny"', out)
        self.assertIn("atlas:explorer", out)
        self.assertIn("atlas:implementer", out)

    def test_ip_pre_deny_prod_edit(self):
        out = self._run_main(self._pre("Edit", {"file_path": "src/foo.py"}))
        self.assertIn('"permissionDecision": "deny"', out)
        self.assertIn("atlas:implementer", out)

    def test_ip_pre_docs_edit_allowed(self):
        # An edit inside the .atlas/docs/ orchestration tree is permitted.
        out = self._run_main(self._pre("Edit", {"file_path": ".atlas/docs/x.md"}))
        self.assertEqual(out, "")

    def test_ip_pre_docs_edit_allowed_via_contains(self):
        # The path-orchestration check also matches "/.atlas/docs/" mid-path.
        out = self._run_main(self._pre("Edit", {"file_path": "/repo/.atlas/docs/x.md"}))
        self.assertEqual(out, "")

    def test_ip_pre_no_active_run_is_silent(self):
        # No run -> nothing to gate.
        out = self._run_main(
            self._pre("Read", {"file_path": "b.py"}, session="sess-norun")
        )
        self.assertEqual(out, "")

    def test_ip_pre_not_orchestrating_is_silent(self):
        # Non-orchestration sessions are never denied, even past threshold.
        self._fresh_run("sess-pre-noorch", mark_orch=False)
        for _ in range(8):
            self._run_main(
                self._post("Read", {"file_path": "a.py"}, session="sess-pre-noorch")
            )
        out = self._run_main(
            self._pre("Read", {"file_path": "b.py"}, session="sess-pre-noorch")
        )
        self.assertEqual(out, "")

    def test_ip_pre_hard_off_disables_deny_only(self):
        for _ in range(8):
            self._run_main(self._post("Read", {"file_path": "a.py"}))
        out = self._run_main(
            self._pre("Read", {"file_path": "b.py"}),
            env={"ATLAS_TRIPWIRE_HARD": "off"},
        )
        self.assertEqual(out, "")  # deny tier suppressed

    def test_ip_pre_db_error_fails_closed(self):
        # M4: if the inline-op count query raises mid-orchestration, the deny
        # tier fails CLOSED, not open to a silent pass.
        for _ in range(8):
            self._run_main(self._post("Read", {"file_path": "a.py"}))
        with patch.object(
            self.atlas_db,
            "inline_ops_since_last_dispatch",
            side_effect=Exception("boom"),
        ):
            out = self._run_main(self._pre("Read", {"file_path": "b.py"}))
        self.assertIn('"permissionDecision": "deny"', out)
        self.assertIn("Failing closed", out)

    # ---- helper unit coverage ----

    def test_ip_is_orchestration_path_branches(self):
        f = self.dt._is_orchestration_path
        self.assertTrue(f(None))  # unknown path -> do not punish
        self.assertTrue(f(""))  # empty -> do not punish
        self.assertTrue(f(".atlas/docs/x.md"))  # startswith
        self.assertTrue(f("/repo/.atlas/docs/x.md"))  # contains
        self.assertTrue(f(".atlas\\docs\\x.md"))  # backslash normalization
        self.assertFalse(f("src/foo.py"))  # production target

    def test_ip_threshold_value_error_branch(self):
        with patch.dict(os.environ, {"ATLAS_TRIPWIRE_THRESHOLD": "garbage"}):
            self.assertEqual(self.dt._threshold(), 4)
        with patch.dict(os.environ, {"ATLAS_TRIPWIRE_THRESHOLD": "2"}):
            self.assertEqual(self.dt._threshold(), 2)

    def test_ip_deny_output_shape(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.dt._deny("a reason")
        parsed = json.loads(out.getvalue())
        self.assertEqual(parsed["hookSpecificOutput"]["permissionDecision"], "deny")
        self.assertEqual(
            parsed["hookSpecificOutput"]["permissionDecisionReason"], "a reason"
        )
        self.assertEqual(parsed["hookSpecificOutput"]["hookEventName"], "PreToolUse")


if __name__ == "__main__":
    unittest.main()
