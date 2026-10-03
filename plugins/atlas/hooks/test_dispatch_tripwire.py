import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
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


TOOLS_BLOCK = (
    'TOOLS: ToolSearch("select:mcp__lean-ctx__ctx_compose,mcp__serena__find_symbol")\n'
)
# The five blocks subagent-kit.md's dispatch spec requires. Without them
# _unbounded_dispatch denies the dispatch as having no finish line.
SPEC_BLOCK = (
    "GOAL: map the auth path.\n"
    "DELIVERABLE: a report written to .atlas/evidence/auth-map.md\n"
    "SUCCESS CRITERIA: every auth entrypoint listed with file:line\n"
    "OUT OF SCOPE: no edits, no migrations, no dependency changes\n"
    "STOP CONDITIONS: halt and report if the router cannot be located\n"
)
# Every atlas:* dispatch fixture carries a sibling name: the colony contract
# (dispatch_tripwire.py) denies unnamed atlas:* dispatches, so tests exercise
# that deny explicitly instead of tripping it through unrelated fixtures.
COLONY_NAME = "auth-slice"


def _named(tinput):
    """Inject the fixture name into an atlas:* dispatch payload unless the test
    set one deliberately (an empty/whitespace name exercises the deny)."""
    tinput = dict(tinput or {})
    if "name" not in tinput and str(tinput.get("subagent_type") or "").startswith("atlas:"):
        tinput["name"] = COLONY_NAME
    return tinput


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
        return {
            "session_id": "sess-1",
            "tool_name": tool,
            "tool_input": _named(tinput),
        }

    def _post_payload(self, tool, tinput=None, session="sess-1"):
        return {
            "session_id": session,
            "hook_event_name": "PostToolUse",
            "tool_name": tool,
            "tool_input": _named(tinput),
        }

    def _pre_payload(self, tool, tinput=None, session="sess-1"):
        return {
            "session_id": session,
            "cwd": self.tmp,
            "hook_event_name": "PreToolUse",
            "tool_name": tool,
            "tool_input": _named(tinput),
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
                "tool_input": _named({"subagent_type": "atlas:explorer"}),
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

    def test_pre_deny_atlas_dispatch_with_no_toolsearch(self):
        """A dispatch that names no tools produces a subagent that greps.

        Recorded: 3 of 12 subagent runs arrived with no TOOLS block and made zero
        MCP calls, reading the repo through Bash grep/cat instead.
        """
        r = run_hook(
            self._pre_payload(
                "Agent",
                {
                    "subagent_type": "atlas:explorer",
                    "prompt": "ROLE: explorer. GOAL: map the auth path.",
                },
            ),
            self.env,
        )
        self.assertEqual(r.returncode, 0)
        self.assertIn('"permissionDecision": "deny"', r.stdout)
        self.assertIn("ToolSearch", r.stdout)

    def test_pre_allows_atlas_dispatch_that_orders_the_toolset(self):
        r = run_hook(
            self._pre_payload(
                "Agent",
                {
                    "subagent_type": "atlas:explorer",
                    "prompt": TOOLS_BLOCK + SPEC_BLOCK,
                },
            ),
            self.env,
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")

    def test_pre_allows_atlas_dispatch_using_plural_spec_labels(self):
        """DELIVERABLES:/SUCCESS CRITERIA:/STOP CONDITIONS: plural forms must
        satisfy the same check as the singular forms in SPEC_BLOCK."""
        plural_spec = (
            "GOAL: map the auth path.\n"
            "DELIVERABLES: a report written to .atlas/evidence/auth-map.md\n"
            "SUCCESS CRITERIA: every auth entrypoint listed with file:line\n"
            "OUT OF SCOPE: no edits, no migrations, no dependency changes\n"
            "STOP CONDITIONS: halt and report if the router cannot be located\n"
        )
        r = run_hook(
            self._pre_payload(
                "Agent",
                {
                    "subagent_type": "atlas:explorer",
                    "prompt": TOOLS_BLOCK + plural_spec,
                },
            ),
            self.env,
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")

    def test_pre_deny_atlas_dispatch_missing_the_bounding_spec(self):
        """A dispatch that names the toolset but gives the agent no finish line
        -- the exact shape that produced 30-60 minute subagent sessions. The
        deny must name the blocks that are actually absent."""
        r = run_hook(
            self._pre_payload(
                "Agent",
                {
                    "subagent_type": "atlas:implementer",
                    "prompt": TOOLS_BLOCK + "GOAL: fix the auth bug.\n",
                },
            ),
            self.env,
        )
        self.assertEqual(r.returncode, 0)
        self.assertIn('"permissionDecision": "deny"', r.stdout)
        self.assertIn("unbounded", r.stdout)
        for block in (
            "DELIVERABLE:",
            "SUCCESS CRITERIA:",
            "OUT OF SCOPE:",
            "STOP CONDITIONS:",
        ):
            self.assertIn(block, r.stdout)
        # GOAL was supplied, so it must not be reported among the missing.
        self.assertNotIn("GOAL:,", r.stdout)

    def test_pre_allows_edit_to_the_session_scratchpad(self):
        """The scratchpad lives under the system temp dir, outside the project
        root: it is ephemeral session workspace, not production target code,
        so the inline-edit deny must not fire for it."""
        scratch = os.path.join(
            tempfile.gettempdir(), "claude-501", "proj-slug", "sess-uuid", "scratchpad"
        )
        os.makedirs(scratch, exist_ok=True)
        try:
            r = run_hook(
                self._pre_payload(
                    "Write", {"file_path": os.path.join(scratch, "tpp_nudge.py")}
                ),
                self.env,
            )
            self.assertEqual(r.returncode, 0)
            self.assertEqual(r.stdout.strip(), "")
        finally:
            shutil.rmtree(scratch, ignore_errors=True)

    def test_pre_denies_edit_to_in_root_source(self):
        """A path that is not docs/.atlas and not under the system temp dir is
        still treated as production target code and denied."""
        r = run_hook(
            self._pre_payload("Edit", {"file_path": "src/app.py"}),
            self.env,
        )
        self.assertEqual(r.returncode, 0)
        self.assertIn('"permissionDecision": "deny"', r.stdout)
        self.assertIn("never edit target code inline", r.stdout)

    def test_pre_deny_dispatch_bundling_several_goals(self):
        """Two GOAL blocks is a whole wave compressed into one context, which
        is the orchestrator's sprawl moved one level down rather than delegated."""
        r = run_hook(
            self._pre_payload(
                "Agent",
                {
                    "subagent_type": "atlas:implementer",
                    "prompt": TOOLS_BLOCK
                    + SPEC_BLOCK
                    + "GOAL: also rewrite the billing module.\n",
                },
            ),
            self.env,
        )
        self.assertEqual(r.returncode, 0)
        self.assertIn('"permissionDecision": "deny"', r.stdout)
        self.assertIn("2 GOAL: blocks", r.stdout)

    def test_pre_toolkit_guard_ignores_forks_and_foreign_agents(self):
        """A fork inherits the parent's already-loaded tools; non-atlas agents carry
        their own contract. Denying either would block work this guard is not about."""
        for agent in ("fork", "general-purpose", "Explore"):
            r = run_hook(
                self._pre_payload(
                    "Agent", {"subagent_type": agent, "prompt": "do the thing"}
                ),
                self.env,
            )
            self.assertEqual(r.stdout.strip(), "", "denied a %s dispatch" % agent)

    def test_pre_hard_off_disables_deny_only(self):
        for _ in range(8):
            run_hook(self._post_payload("Read", {"file_path": "a.py"}), self.env)
        env = dict(self.env, ATLAS_TRIPWIRE_HARD="off")
        r = run_hook(self._pre_payload("Read", {"file_path": "b.py"}), env)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")  # deny tier suppressed

    # ---- availability-aware native Grep/Glob, end to end ----

    def _docs_project(self):
        (Path(self.tmp) / "docs").mkdir()

    def _fake_lean_ctx_bin(self, env):
        """A deterministic shutil.which('lean-ctx') hit regardless of host PATH."""
        bin_dir = Path(self.tmp) / "bin"
        bin_dir.mkdir(exist_ok=True)
        fake = bin_dir / "lean-ctx"
        fake.write_text("#!/bin/sh\nexit 0\n")
        fake.chmod(0o755)
        env["PATH"] = str(bin_dir) + os.pathsep + env.get("PATH", "")
        return env

    def test_pre_nudges_native_grep_when_mcp_unconfigured(self):
        self._docs_project()
        env = self._fake_lean_ctx_bin(dict(self.env, HOME=self.tmp))
        r = run_hook(self._pre_payload("Grep"), env)
        self.assertEqual(r.returncode, 0)
        out = json.loads(r.stdout)["hookSpecificOutput"]
        self.assertNotIn("permissionDecision", out)  # allowed with a nudge
        self.assertIn("ctx_search", out["additionalContext"])
        self.assertIn("not configured", out["additionalContext"])
        # one-time: a second Grep in the same session is silently allowed
        r2 = run_hook(self._pre_payload("Grep"), env)
        self.assertEqual(r2.stdout.strip(), "")

    def test_pre_denies_native_grep_when_mcp_configured(self):
        self._docs_project()
        (Path(self.tmp) / ".mcp.json").write_text(
            json.dumps({"mcpServers": {"lean-ctx": {"command": "lean-ctx"}}})
        )
        env = self._fake_lean_ctx_bin(dict(self.env, HOME=self.tmp))
        r = run_hook(self._pre_payload("Grep"), env)
        self.assertEqual(r.returncode, 0)
        out = json.loads(r.stdout)["hookSpecificOutput"]
        self.assertEqual(out["permissionDecision"], "deny")
        self.assertIn("ToolSearch", out["permissionDecisionReason"])
        self.assertIn("ctx_search", out["permissionDecisionReason"])
        # Glob gets the same treatment with the ctx_glob selector
        r2 = run_hook(self._pre_payload("Glob"), env)
        out2 = json.loads(r2.stdout)["hookSpecificOutput"]
        self.assertEqual(out2["permissionDecision"], "deny")
        self.assertIn("ctx_glob", out2["permissionDecisionReason"])

    def test_pre_deny_prod_edit_allows_docs_edit(self):
        r = run_hook(self._pre_payload("Edit", {"file_path": "src/foo.py"}), self.env)
        self.assertEqual(r.returncode, 0)
        self.assertIn('"permissionDecision": "deny"', r.stdout)
        self.assertIn("atlas:implementer", r.stdout)
        # docs/ is the project-documentation orchestration-artifact tree.
        r2 = run_hook(self._pre_payload("Edit", {"file_path": "docs/x.md"}), self.env)
        self.assertEqual(r2.returncode, 0)
        self.assertEqual(r2.stdout.strip(), "")
        # .atlas/ (evidence, audits, .run) is also orchestration-owned.
        r3 = run_hook(
            self._pre_payload("Edit", {"file_path": ".atlas/evidence/x.md"}), self.env
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
            "tool_input": _named(tinput),
        }

    def _pre(self, tool, tinput=None, session="sess-1"):
        return {
            "hook_event_name": "PreToolUse",
            "cwd": self.tmp,
            "session_id": session,
            "tool_name": tool,
            "tool_input": _named(tinput),
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

    def test_ip_skill_arm_failure_records_friction(self):
        self._fresh_run("sess-skill-fail", mark_orch=False)
        with (
            patch.object(
                self.atlas_db,
                "mark_orchestrating",
                side_effect=Exception("db down"),
            ),
        ):
            self._run_main(
                {
                    "hook_event_name": "PostToolUse",
                    "session_id": "sess-skill-fail",
                    "tool_name": "Skill",
                    "tool_input": {"skill": "atlas:atlas-orchestrate"},
                }
            )
        conn = self.atlas_db.connect(self.db_path)
        row = conn.execute(
            "SELECT session_id, category FROM friction_events"
        ).fetchone()
        conn.close()
        self.assertEqual(
            row, ("sess-skill-fail", "orchestration_flag_arm_failed")
        )

    def test_ip_dispatch_arm_failure_records_friction(self):
        with (
            patch.object(
                self.atlas_db,
                "mark_orchestrating",
                side_effect=Exception("db down"),
            ),
        ):
            self._run_main(
                {
                    "hook_event_name": "PostToolUse",
                    "session_id": "sess-atlas-fail",
                    "tool_name": "Agent",
                    "tool_input": _named({"subagent_type": "atlas:explorer"}),
                }
            )
        conn = self.atlas_db.connect(self.db_path)
        row = conn.execute(
            "SELECT session_id, category FROM friction_events"
        ).fetchone()
        conn.close()
        self.assertEqual(
            row, ("sess-atlas-fail", "orchestration_flag_arm_failed")
        )

    def test_ip_friction_write_failure_still_fail_open(self):
        # Doubly failing DB: the friction write itself must not raise out of
        # the hook, and mark_used_worktrees / later work must still proceed.
        with (
            patch.object(
                self.atlas_db,
                "mark_orchestrating",
                side_effect=Exception("db down"),
            ),
            patch.object(
                self.atlas_db,
                "record_friction",
                side_effect=Exception("db still down"),
            ),
        ):
            self._run_main(
                {
                    "hook_event_name": "PostToolUse",
                    "session_id": "sess-atlas-fail2",
                    "tool_name": "Agent",
                    "tool_input": _named({"subagent_type": "atlas:explorer"}),
                }
            )

    def test_ip_dispatch_atlas_agent_marks_session(self):
        # A session with no run yet: current_or_last_run_id is None so the
        # dispatch is not logged, but dispatching an atlas: agent still marks
        # the session orchestrating (mark_orchestrating creates the run).
        out = self._run_main(
            {
                "hook_event_name": "PostToolUse",
                "session_id": "sess-atlas",
                "tool_name": "Agent",
                "tool_input": _named({"subagent_type": "atlas:explorer"}),
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
        # An edit inside the docs/ orchestration tree is permitted.
        out = self._run_main(self._pre("Edit", {"file_path": "docs/x.md"}))
        self.assertEqual(out, "")

    def test_ip_pre_docs_edit_allowed_via_contains(self):
        # The path-orchestration check also matches "/docs/" mid-path.
        out = self._run_main(self._pre("Edit", {"file_path": "/repo/docs/x.md"}))
        self.assertEqual(out, "")

    def test_ip_pre_atlas_evidence_edit_allowed(self):
        # .atlas/ (evidence, audits, .run) is also orchestration-owned.
        out = self._run_main(self._pre("Edit", {"file_path": ".atlas/evidence/x.md"}))
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
            "unsanctioned_inline_ops_since_last_dispatch",
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
        self.assertTrue(f("docs/x.md"))  # startswith docs/
        self.assertTrue(f("/repo/docs/x.md"))  # contains /docs/
        self.assertTrue(f(".atlas/evidence/x.md"))  # startswith .atlas/
        self.assertTrue(f("/repo/.atlas/audits/x.md"))  # contains /.atlas/
        self.assertTrue(f("docs\\x.md"))  # backslash normalization
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

    # ---- availability-aware native Grep meets the deny threshold ----

    def _docs_project(self):
        (Path(self.tmp) / "docs").mkdir()

    def test_nudged_grep_is_allowed_and_counts_toward_threshold(self):
        """An allowed (one-time-nudged) native Grep still RUNS, so its
        PostToolUse event counts as an unsanctioned inline op toward the deny
        threshold. The availability-aware deny may never erase that accounting
        for a call that actually executed."""
        self._docs_project()
        home = tempfile.mkdtemp()  # no lean-ctx MCP config anywhere
        with patch.object(self.dt.shutil, "which", return_value="/usr/bin/lean-ctx"):
            out = self._run_main(self._pre("Grep"), env={"HOME": home})
            # nudge -> allowed: no deny decision, the nudge names ctx_search
            self.assertNotIn("DENY", out)
            self.assertIn("ctx_search", out)
            for _ in range(4):  # env threshold is 4
                out = self._run_main(self._post("Grep"), env={"HOME": home})
        # the 4th nudged Grep op tripped the advisory threshold: it counted
        self.assertIn("STOP - 4 inline ops", out)
        conn = self.atlas_db.connect(self.db_path)
        rid = self.atlas_db.current_run_id(conn, "sess-1")
        self.assertEqual(
            self.atlas_db.unsanctioned_inline_ops_since_last_dispatch(conn, rid), 4
        )
        conn.close()

    def test_denied_grep_does_not_count_toward_threshold(self):
        """A DENIED native Grep never ran, so it must not add to the inline-op
        count. With threshold-level ops already seeded, the availability-aware
        policy deny wins over the threshold deny (lean-ctx reason, not the
        threshold reason) and the count is unchanged."""
        self._docs_project()
        (Path(self.tmp) / ".mcp.json").write_text(
            json.dumps({"mcpServers": {"lean-ctx": {"command": "lean-ctx"}}})
        )
        for _ in range(6):  # DENY_THRESHOLD inline ops, all counted
            self._run_main(self._post("Grep"))
        with patch.object(self.dt.shutil, "which", return_value="/usr/bin/lean-ctx"):
            out = self._run_main(self._pre("Grep"), env={"HOME": tempfile.mkdtemp()})
        self.assertIn("DENY", out)
        self.assertIn("ToolSearch", out)
        # policy deny reason, NOT the threshold deny reason
        self.assertNotIn("inline ops since your last dispatch", out)
        conn = self.atlas_db.connect(self.db_path)
        rid = self.atlas_db.current_run_id(conn, "sess-1")
        self.assertEqual(
            self.atlas_db.unsanctioned_inline_ops_since_last_dispatch(conn, rid), 6
        )
        conn.close()

    def test_threshold_deny_still_applies_to_allowed_native_reads_in_docs_projects(self):
        """Regression (8.3.0): the native policy returned early for every
        docs-project Read/Bash/Grep/Glob, so an armed orchestrator past the
        inline-op limit was never denied for them. An allowed native call must
        still reach the threshold deny tier, and the deny replaces the nudge."""
        self._docs_project()
        for _ in range(8):
            self._run_main(self._post("Read", {"file_path": "a.py"}))
        out = self._run_main(self._pre("Read", {"file_path": "b.py"}))
        self.assertIn('"permissionDecision": "deny"', out)
        self.assertNotIn("additionalContext", out)
        self.assertEqual(out.count("hookSpecificOutput"), 1)

    def test_nudge_replaced_by_deny_is_shown_on_next_allowed_call(self):
        """The once-per-session marker is claimed only when the nudge is
        actually printed, so a deny that replaced it does not burn it."""
        self._docs_project()
        for _ in range(8):
            self._run_main(self._post("Read", {"file_path": "a.py"}))
        denied = self._run_main(self._pre("Read", {"file_path": "b.py"}))
        self.assertIn('"permissionDecision": "deny"', denied)
        self._run_main(self._post("Task", {"subagent_type": "atlas:explorer"}))
        allowed = self._run_main(self._pre("Read", {"file_path": "b.py"}))
        self.assertNotIn("deny", allowed)
        self.assertIn("ctx_read", allowed)
        self.assertEqual(self._run_main(self._pre("Read", {"file_path": "c.py"})), "")


class WorktreeFlagTest(unittest.TestCase):
    """A dispatch with isolation="worktree" is recorded, so the completion gate
    can demand close-out without firing on worktrees the user created."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.env = dict(os.environ, ATLAS_DB=os.path.join(self.tmp, "atlas.db"))
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        conn = atlas_db.connect(self.env["ATLAS_DB"])
        atlas_db.init(conn)
        pid = atlas_db.register_project(conn, self.tmp)
        atlas_db.start_run(conn, pid, "sess-wt")
        atlas_db.mark_orchestrating(conn, "sess-wt")
        conn.close()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _flag(self):
        import atlas_db

        conn = atlas_db.connect(self.env["ATLAS_DB"])
        try:
            return atlas_db.run_used_worktrees(conn, "sess-wt")
        finally:
            conn.close()

    def _dispatch(self, tinput):
        return run_hook(
            {
                "session_id": "sess-wt",
                "hook_event_name": "PostToolUse",
                "tool_name": "Agent",
                "tool_input": _named(tinput),
                "cwd": self.tmp,
            },
            self.env,
        )

    def test_flag_starts_off(self):
        self.assertFalse(self._flag())

    def test_isolated_dispatch_sets_the_flag(self):
        r = self._dispatch(
            {"subagent_type": "atlas:implementer", "isolation": "worktree"}
        )
        self.assertEqual(r.returncode, 0)
        self.assertTrue(self._flag())

    def test_plain_dispatch_leaves_the_flag_off(self):
        """No isolation -> no tree to clean up -> the gate must stay quiet."""
        r = self._dispatch({"subagent_type": "atlas:implementer"})
        self.assertEqual(r.returncode, 0)
        self.assertFalse(self._flag())

    def test_other_isolation_value_leaves_the_flag_off(self):
        r = self._dispatch({"subagent_type": "atlas:explorer", "isolation": "remote"})
        self.assertEqual(r.returncode, 0)
        self.assertFalse(self._flag())

    def test_non_atlas_agent_with_worktree_still_counts(self):
        """The tree exists regardless of which agent type asked for it."""
        r = self._dispatch(
            {"subagent_type": "general-purpose", "isolation": "worktree"}
        )
        self.assertEqual(r.returncode, 0)
        self.assertTrue(self._flag())


class SubagentDenyTierSkipTest(unittest.TestCase):
    """The PreToolUse deny tier must never fire inside a dispatched subagent:
    it polices the ORCHESTRATOR's own inline drift, and a subagent's payload
    can carry the PARENT session_id (which IS flagged orchestrating), so the
    tier is skipped by transcript_path (_in_subagent), not by session flag."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.env = dict(os.environ, ATLAS_DB=os.path.join(self.tmp, "atlas.db"))
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        conn = atlas_db.connect(self.env["ATLAS_DB"])
        atlas_db.init(conn)
        pid = atlas_db.register_project(conn, "/repo/x")
        atlas_db.start_run(conn, pid, "sess-1")
        atlas_db.mark_orchestrating(conn, "sess-1")
        conn.close()
        self.sub_transcript = os.path.join(
            self.tmp, "proj", "sess-1", "subagents", "agent-abc123.jsonl"
        )
        self.main_transcript = os.path.join(self.tmp, "proj", "sess-1.jsonl")

    def _payload(self, tool, tinput, transcript):
        return {
            "session_id": "sess-1",
            "hook_event_name": "PreToolUse",
            "tool_name": tool,
            "transcript_path": transcript,
            "tool_input": tinput,
        }

    def _decision(self, stdout):
        if not stdout.strip():
            return None
        return json.loads(stdout)["hookSpecificOutput"].get("permissionDecision")

    def test_edit_from_subagent_with_parent_session_id_is_not_denied(self):
        r = run_hook(
            self._payload("Edit", {"file_path": "src/app.ts"}, self.sub_transcript),
            self.env,
        )
        self.assertEqual(r.returncode, 0)
        self.assertIsNone(self._decision(r.stdout))

    def test_same_edit_from_the_main_transcript_is_still_denied(self):
        r = run_hook(
            self._payload("Edit", {"file_path": "src/app.ts"}, self.main_transcript),
            self.env,
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self._decision(r.stdout), "deny")
        self.assertIn("never edit target code inline", r.stdout)

    def test_inline_op_threshold_is_also_skipped_inside_a_subagent(self):
        last = None
        for _ in range(5):
            last = run_hook(
                self._payload("Read", {"file_path": "a.py"}, self.sub_transcript),
                self.env,
            )
        assert last is not None  # range(5) always runs at least once
        self.assertEqual(last.returncode, 0)
        self.assertIsNone(self._decision(last.stdout))



class VerifierVerdictBracketTest(unittest.TestCase):
    """A verifier that returns prose and writes no findings.json row is the
    documented cause of the re-dispatch loop: the completion gate reads the
    file, not the chat. The tripwire brackets each verifier dispatch (count
    before on PreToolUse, count after on PostToolUse) and names the one-command
    fix instead of letting Stop discover the gap."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.root = os.path.join(self.tmp, "repo")
        os.makedirs(os.path.join(self.root, "docs"))
        os.makedirs(os.path.join(self.root, ".atlas", ".run"))
        self.env = dict(os.environ, ATLAS_DB=os.path.join(self.tmp, "atlas.db"))
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        conn = atlas_db.connect(self.env["ATLAS_DB"])
        atlas_db.init(conn)
        pid = atlas_db.register_project(conn, self.root)
        atlas_db.start_run(conn, pid, "sess-v")
        atlas_db.mark_orchestrating(conn, "sess-v")
        conn.close()

    def _findings_path(self):
        return os.path.join(self.root, ".atlas", ".run", "findings.json")

    def _write_findings(self, entries):
        with open(self._findings_path(), "w") as fh:
            json.dump(entries, fh)

    def _payload(self, event, session="sess-v", agent="atlas:verifier"):
        return {
            "session_id": session,
            "hook_event_name": event,
            "tool_name": "Agent",
            "cwd": self.root,
            "tool_input": _named(
                {
                    "subagent_type": agent,
                    "prompt": 'ToolSearch("select:mcp__lean-ctx__ctx_read")',
                }
            ),
        }

    def test_verifier_without_a_findings_write_is_flagged(self):
        self._write_findings([{"id": "S1", "status": "open"}])
        run_hook(self._payload("PreToolUse"), self.env)
        post = run_hook(self._payload("PostToolUse"), self.env)
        self.assertIn("verifier verdict not in findings.json", post.stdout)
        self.assertIn("atlas_finding.py", post.stdout)
        self.assertIn("do not re-dispatch", post.stdout)

    def test_hint_names_an_existing_absolute_script_path(self):
        """$CLAUDE_PLUGIN_ROOT is expanded only by the hook runner, never in a
        model-run shell, so the hint must carry the resolved absolute path."""
        self._write_findings([{"id": "S1", "status": "open"}])
        run_hook(self._payload("PreToolUse"), self.env)
        post = run_hook(self._payload("PostToolUse"), self.env)
        text = json.loads(post.stdout)["hookSpecificOutput"]["additionalContext"]
        self.assertNotIn("CLAUDE_PLUGIN_ROOT", text)
        script = os.path.realpath(
            os.path.join(os.path.dirname(__file__), "..", "scripts", "atlas_finding.py")
        )
        self.assertTrue(os.path.isabs(script) and os.path.exists(script), script)
        self.assertIn(f'python3 "{script}"', text)

    def test_verifier_that_wrote_its_verdict_is_silent(self):
        self._write_findings([{"id": "S1", "status": "open"}])
        run_hook(self._payload("PreToolUse"), self.env)
        self._write_findings(
            [{"id": "S1", "status": "open"}, {"id": "S2", "status": "verified"}]
        )
        post = run_hook(self._payload("PostToolUse"), self.env)
        self.assertNotIn("verifier verdict not in findings.json", post.stdout)

    def test_non_verifier_dispatch_is_not_bracketed(self):
        self._write_findings([])
        run_hook(self._payload("PreToolUse", agent="atlas:implementer"), self.env)
        post = run_hook(
            self._payload("PostToolUse", agent="atlas:implementer"), self.env
        )
        self.assertNotIn("verifier verdict not in findings.json", post.stdout)

    def test_no_baseline_stays_silent(self):
        """A PostToolUse with no matching PreToolUse baseline cannot judge, so
        it says nothing rather than warning on a guess."""
        self._write_findings([])
        post = run_hook(self._payload("PostToolUse"), self.env)
        self.assertNotIn("verifier verdict not in findings.json", post.stdout)

    def test_baseline_from_another_session_is_ignored(self):
        self._write_findings([])
        run_hook(self._payload("PreToolUse", session="other"), self.env)
        post = run_hook(self._payload("PostToolUse"), self.env)
        self.assertNotIn("verifier verdict not in findings.json", post.stdout)

    def test_dispatch_still_reaches_the_observability_db(self):
        """The flag must not swallow dispatch logging -- condition (g) depends on it."""
        import atlas_db

        self._write_findings([])
        run_hook(self._payload("PreToolUse"), self.env)
        run_hook(self._payload("PostToolUse"), self.env)
        conn = atlas_db.connect(self.env["ATLAS_DB"])
        rid = atlas_db.current_run_id(conn, "sess-v")
        rows = conn.execute(
            "SELECT COUNT(*) FROM dispatches WHERE run_id=?", (rid,)
        ).fetchone()[0]
        conn.close()
        self.assertGreaterEqual(rows, 1)


class NestedSubagentDenyTest(unittest.TestCase):
    """A subagent must never dispatch another subagent. Nesting hides the work
    from the orchestrator that owns the task: the nested dispatch is uncounted,
    its verdict never reaches findings.json, its context is unreachable."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.env = dict(os.environ, ATLAS_DB=os.path.join(self.tmp, "atlas.db"))
        self.sub_transcript = os.path.join(
            self.tmp, "proj", "sess-1", "subagents", "agent-abc123.jsonl"
        )
        self.main_transcript = os.path.join(self.tmp, "proj", "sess-1.jsonl")

    def _payload(self, transcript, tool="Agent", event="PreToolUse"):
        return {
            # A subagent's session_id is its own agent id and has no run row --
            # which is exactly why the deny cannot depend on the DB.
            "session_id": "agent-abc123",
            "hook_event_name": event,
            "tool_name": tool,
            "transcript_path": transcript,
            "tool_input": _named(
                {
                    "subagent_type": "atlas:explorer",
                    "prompt": 'ToolSearch("select:mcp__lean-ctx__ctx_read")',
                }
            ),
        }

    def _decision(self, stdout):
        if not stdout.strip():
            return None
        return json.loads(stdout)["hookSpecificOutput"].get("permissionDecision")

    def test_agent_dispatch_from_a_subagent_is_denied(self):
        r = run_hook(self._payload(self.sub_transcript), self.env)
        self.assertEqual(self._decision(r.stdout), "deny")
        self.assertIn("never dispatch another subagent", r.stdout)

    def test_task_dispatch_from_a_subagent_is_denied(self):
        r = run_hook(self._payload(self.sub_transcript, tool="Task"), self.env)
        self.assertEqual(self._decision(r.stdout), "deny")

    def test_the_orchestrator_is_never_denied_for_nesting(self):
        r = run_hook(self._payload(self.main_transcript), self.env)
        self.assertNotIn("never dispatch another subagent", r.stdout)

    def test_deny_survives_the_drift_kill_switch(self):
        """ATLAS_TRIPWIRE=off silences inline-drift coaching, a matter of taste.
        Nesting is a structural invariant and is not opt-out."""
        env = dict(self.env, ATLAS_TRIPWIRE="off")
        r = run_hook(self._payload(self.sub_transcript), env)
        self.assertEqual(self._decision(r.stdout), "deny")

    def test_non_dispatch_tools_in_a_subagent_are_untouched(self):
        r = run_hook(
            self._payload(self.sub_transcript, tool="Read"),
            self.env,
        )
        self.assertNotIn("never dispatch another subagent", r.stdout)

    def test_no_db_is_required_for_the_deny(self):
        """The whole point of placing this before the DB import: a subagent has
        no run row, so any DB-gated path would return early and never deny."""
        env = dict(self.env, ATLAS_DB="/nonexistent/dir/atlas.db")
        r = run_hook(self._payload(self.sub_transcript), env)
        self.assertEqual(self._decision(r.stdout), "deny")

    def test_windows_style_transcript_path_is_recognized(self):
        win = r"C:\Users\x\.claude\projects\p\sess\subagents\agent-abc.jsonl"
        r = run_hook(self._payload(win), self.env)
        self.assertEqual(self._decision(r.stdout), "deny")


class NativeToolPolicyTest(unittest.TestCase):
    """docs/ projects: native Grep/Glob are denied ONLY when lean-ctx is
    plausibly reachable -- binary on PATH AND a lean-ctx MCP server configured
    for the project (.mcp.json / Claude settings). Otherwise the deny downgrades
    to the one-time allow-nudge, so no session is stranded without search.
    HOME is faked per test so the host's real ~/.claude.json can never flip an
    expectation; deny does not consume a nudge marker, nudge does."""

    def setUp(self):
        import dispatch_tripwire

        self.dt = dispatch_tripwire
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "docs").mkdir()
        self.home = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.home, ignore_errors=True)

    def call(self, tool, *, available=True, **extra):
        payload = dict(hook_event_name="PreToolUse", tool_name=tool,
                       session_id="native-policy", cwd=str(self.root), **extra)
        output = io.StringIO()
        with patch.object(self.dt.shutil, "which", return_value="/bin/lean-ctx" if available else None), \
                patch.dict(os.environ, {"HOME": str(self.home)}), \
                contextlib.redirect_stdout(output):
            handled, nudge = self.dt._native_tool_policy(payload)
            # main() prints the nudge only when no later deny tier fires.
            self.dt._emit_nudge(nudge)
        return handled, output.getvalue()

    def _mcp_json(self, key="lean-ctx", command="lean-ctx"):
        (self.root / ".mcp.json").write_text(
            json.dumps({"mcpServers": {key: {"command": command}}}), encoding="utf-8"
        )

    def _deny_output(self, tool, **extra):
        _, output = self.call(tool, **extra)
        return json.loads(output)["hookSpecificOutput"]

    def _contract(self, mutate):
        spec = json.loads(Path(self.dt.NATIVE_TOOLS_PATH).read_text())
        mutate(spec)
        path = self.root / "native-tools.json"
        path.write_text(json.dumps(spec))
        return patch.object(self.dt, "NATIVE_TOOLS_PATH", str(path))

    def test_contract_drives_replacement_and_mode(self):
        """contracts/native-tools.json is the single source: renaming the
        replacement or downgrading the mode changes the hook's behavior."""
        self._mcp_json()

        def rename(spec):
            spec["kinds"]["search"]["replacements"][0]["tool"] = "ctx_find"

        with self._contract(rename):
            reason = self._deny_output("Grep")["permissionDecisionReason"]
        self.assertIn('ToolSearch("select:mcp__lean-ctx__ctx_find")', reason)

        def soften(spec):
            spec["kinds"]["search"]["mode"] = "nudge"

        with self._contract(soften):
            handled, output = self.call("Grep")
        self.assertFalse(handled)
        self.assertNotIn('"deny"', output)

    def test_unreadable_contract_allows_silently(self):
        self._mcp_json()
        with patch.object(self.dt, "NATIVE_TOOLS_PATH", str(self.root / "absent.json")):
            self.assertEqual(self.call("Grep"), (False, ""))

    def test_native_policy_env_unset_or_on_still_denies_native_grep(self):
        # Claude Code never sets ATLAS_NATIVE_POLICY: the deny must be unchanged.
        self._mcp_json()
        with patch.dict(os.environ):
            os.environ.pop("ATLAS_NATIVE_POLICY", None)
            self.assertEqual(self._deny_output("Grep")["permissionDecision"], "deny")
        with patch.dict(os.environ, {"ATLAS_NATIVE_POLICY": "on"}):
            self.assertEqual(self._deny_output("Grep")["permissionDecision"], "deny")

    def test_native_policy_off_skips_only_the_native_text(self):
        # The omp bridge sets ATLAS_NATIVE_POLICY=off because omp/index.ts already
        # produces the native-tool text: no deny, no nudge, and the caller falls
        # through to the inline-op tiers (handled=False).
        self._mcp_json()
        for value in ("off", "OFF"):
            with patch.dict(os.environ, {"ATLAS_NATIVE_POLICY": value}):
                self.assertEqual(self.call("Grep"), (False, ""))
                self.assertEqual(self.call("Read"), (False, ""))

    def test_native_search_denied_when_mcp_configured_even_for_subagents(self):
        self._mcp_json()
        for tool, replacement in (("Grep", "ctx_search"), ("Glob", "ctx_glob")):
            result = self._deny_output(
                tool, transcript_path="/session/subagents/agent-x.jsonl"
            )
            self.assertEqual(result["permissionDecision"], "deny")
            reason = result["permissionDecisionReason"]
            self.assertIn(replacement, reason)
            # the deny names the subagent load step, not just the tool
            self.assertIn(f'ToolSearch("select:mcp__lean-ctx__{replacement}")', reason)

    def test_deny_fires_from_each_config_source(self):
        # (1) project .mcp.json
        self._mcp_json()
        self.assertEqual(self._deny_output("Grep")["permissionDecision"], "deny")
        (self.root / ".mcp.json").unlink()
        claude_dir = self.root / ".claude"
        claude_dir.mkdir()
        # (2a) project .claude/settings.json mcpServers
        (claude_dir / "settings.json").write_text(
            json.dumps({"mcpServers": {"lean-ctx": {"command": "lean-ctx"}}})
        )
        self.assertEqual(self._deny_output("Grep")["permissionDecision"], "deny")
        (claude_dir / "settings.json").unlink()
        # (2b) project .claude/settings.local.json enabledMcpjsonServers
        (claude_dir / "settings.local.json").write_text(
            json.dumps({"enabledMcpjsonServers": ["lean-ctx"]})
        )
        self.assertEqual(self._deny_output("Grep")["permissionDecision"], "deny")
        (claude_dir / "settings.local.json").unlink()
        # (3a) ~/.claude.json top-level mcpServers (underscore key variant)
        (self.home / ".claude.json").write_text(
            json.dumps({"mcpServers": {"lean_ctx": {"command": "lean-ctx"}}})
        )
        result = self._deny_output("Grep")
        self.assertEqual(result["permissionDecision"], "deny")
        self.assertIn("mcp__lean_ctx__ctx_search", result["permissionDecisionReason"])
        # (3b) ~/.claude.json projects[<root>].mcpServers
        (self.home / ".claude.json").write_text(
            json.dumps({
                "projects": {
                    str(self.root): {"mcpServers": {"lean-ctx": {"command": "lean-ctx"}}}
                }
            })
        )
        self.assertEqual(self._deny_output("Grep")["permissionDecision"], "deny")
        (self.home / ".claude.json").unlink()
        # (4) ~/.claude/settings.json mcpServers
        home_claude = self.home / ".claude"
        home_claude.mkdir()
        (home_claude / "settings.json").write_text(
            json.dumps({"mcpServers": {"lean-ctx": {"command": "lean-ctx"}}})
        )
        self.assertEqual(self._deny_output("Grep")["permissionDecision"], "deny")

    def test_search_nudged_when_mcp_unconfigured_then_silent(self):
        for tool, replacement in (("Grep", "ctx_search"), ("Glob", "ctx_glob")):
            handled, output = self.call(tool)  # binary present, nothing configured
            self.assertEqual(handled, False)  # allowed: legacy tiers still run
            result = json.loads(output)["hookSpecificOutput"]
            self.assertNotIn("permissionDecision", result)
            self.assertIn(replacement, result["additionalContext"])
            self.assertIn("not configured", result["additionalContext"])
            self.assertEqual(self.call(tool), (False, ""))  # one-time marker

    def test_search_nudged_when_binary_missing(self):
        self._mcp_json()
        for tool, replacement in (("Grep", "ctx_search"), ("Glob", "ctx_glob")):
            handled, output = self.call(tool, available=False)
            self.assertEqual(handled, False)
            result = json.loads(output)["hookSpecificOutput"]
            self.assertNotIn("permissionDecision", result)
            self.assertIn(replacement, result["additionalContext"])

    def test_hard_off_stays_silent_even_when_configured(self):
        self._mcp_json()
        for tool in ("Grep", "Glob"):
            with patch.dict(os.environ, {"ATLAS_TRIPWIRE_HARD": "off"}):
                self.assertEqual(self.call(tool), (False, ""))

    def test_unreadable_config_fails_open_to_nudge(self):
        (self.root / ".mcp.json").write_text("{not json", encoding="utf-8")
        handled, output = self.call("Grep")
        self.assertEqual(handled, False)
        result = json.loads(output)["hookSpecificOutput"]
        self.assertNotIn("permissionDecision", result)
        self.assertIn("ctx_search", result["additionalContext"])

    def test_outside_docs_projects_is_silent(self):
        (self.root / "docs").rmdir()
        for tool in ("Grep", "Glob", "Read", "Bash"):
            self.assertEqual(self.call(tool), (False, ""))

    def test_read_and_bash_nudge_once_independently_with_hard_off(self):
        with patch.dict(os.environ, {"ATLAS_TRIPWIRE_HARD": "off"}):
            for tool, replacement in (("Read", "ctx_read"), ("Bash", "ctx_execute")):
                _, output = self.call(tool)
                result = json.loads(output)["hookSpecificOutput"]
                self.assertNotIn("permissionDecision", result)
                self.assertIn(replacement, result["additionalContext"])
                self.assertEqual(self.call(tool), (False, ""))

    def test_internal_policy_error_is_silent_and_allowed(self):
        with patch.object(self.dt, "find_root", side_effect=RuntimeError("bad filesystem")):
            self.assertEqual(self.call("Grep"), (False, ""))


class ExplorationShellDenyTest(unittest.TestCase):
    """Bash that only reads/inspects is DENIED toward ctx_* when lean-ctx is
    plausibly reachable (binary on PATH AND an MCP server configured; a Claude
    PreToolUse hook cannot see the callable tool set). Everything else keeps the
    one-time nudge. The verdict cases are shared with omp/contracts.test.ts via
    contracts/native-tools.json explorationShell.cases."""

    def setUp(self):
        import dispatch_tripwire

        self.dt = dispatch_tripwire
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "docs").mkdir()
        self.home = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.home, ignore_errors=True)
        self.cases = json.loads(Path(self.dt.NATIVE_TOOLS_PATH).read_text())["explorationShell"]["cases"]

    def call(self, command, *, available=True, configured=True, session="explore"):
        if configured:
            (self.root / ".mcp.json").write_text(
                json.dumps({"mcpServers": {"lean-ctx": {"command": "lean-ctx"}}}), encoding="utf-8"
            )
        payload = {"hook_event_name": "PreToolUse", "tool_name": "Bash", "session_id": session,
                   "cwd": str(self.root), "tool_input": {"command": command}}
        output = io.StringIO()
        with patch.object(self.dt.shutil, "which", return_value="/bin/lean-ctx" if available else None), \
                patch.dict(os.environ, {"HOME": str(self.home)}), \
                contextlib.redirect_stdout(output):
            handled, nudge = self.dt._native_tool_policy(payload)
            self.dt._emit_nudge(nudge)
        return handled, output.getvalue()

    def test_shared_cases_classify_identically_to_omp(self):
        self.assertGreaterEqual(len(self.cases["deny"]), 12)
        self.assertGreaterEqual(len(self.cases["allow"]), 12)
        for command in self.cases["deny"]:
            self.assertTrue(self.dt._is_exploration_shell(command), command)
        for command in self.cases["allow"]:
            self.assertFalse(self.dt._is_exploration_shell(command), command)

    def test_exploration_denied_naming_ctx_tool_and_toolsearch_load_step(self):
        expected = {
            "cat README.md": "ctx_read", "head -5 a": "ctx_read", "tail -3 a": "ctx_read",
            "grep -rn x .": "ctx_search", "rg x": "ctx_search", "ag x": "ctx_search",
            "ls -la": "ctx_tree", "tree -L 2": "ctx_tree",
            "find . -name '*.py'": "ctx_glob", "fd x": "ctx_glob",
            "wc -l a": "ctx_shell", "stat a": "ctx_shell", "sed -n 1p a": "ctx_shell",
            "cat a | grep b | wc -l": "ctx_shell", "cd src && cat a": "ctx_read",
        }
        for command, tool in expected.items():
            handled, output = self.call(command, session=command)
            self.assertTrue(handled, command)
            result = json.loads(output)["hookSpecificOutput"]
            self.assertEqual(result["permissionDecision"], "deny", command)
            reason = result["permissionDecisionReason"]
            self.assertIn(tool, reason, command)
            self.assertIn(f'ToolSearch("select:mcp__lean-ctx__{tool}")', reason, command)

    def test_every_shared_deny_case_is_denied_end_to_end(self):
        for command in self.cases["deny"]:
            handled, output = self.call(command, session=command)
            self.assertTrue(handled, command)
            self.assertEqual(json.loads(output)["hookSpecificOutput"]["permissionDecision"], "deny", command)

    def test_every_shared_allow_case_is_allowed_with_at_most_a_nudge(self):
        for command in self.cases["allow"]:
            handled, output = self.call(command, session=command)
            self.assertFalse(handled, command)
            if output:
                self.assertNotIn("permissionDecision", json.loads(output)["hookSpecificOutput"], command)

    def test_not_plausibly_reachable_keeps_the_nudge(self):
        for available, configured in ((False, True), (True, False)):
            handled, output = self.call("cat README.md", available=available, configured=configured)
            self.assertFalse(handled)
            self.assertNotIn("permissionDecision", json.loads(output)["hookSpecificOutput"])
            (self.root / ".mcp.json").unlink(missing_ok=True)
            shutil.rmtree(self.root / ".atlas", ignore_errors=True)

    def test_hard_off_and_outside_docs_projects_allow_silently(self):
        with patch.dict(os.environ, {"ATLAS_TRIPWIRE_HARD": "off"}):
            handled, output = self.call("cat README.md")
        self.assertFalse(handled)
        self.assertNotIn("permissionDecision", output)
        (self.root / "docs").rmdir()
        self.assertEqual(self.call("cat README.md", session="other"), (False, ""))

    def test_contract_without_exploration_section_fails_open(self):
        spec = json.loads(Path(self.dt.NATIVE_TOOLS_PATH).read_text())
        del spec["explorationShell"]
        path = self.root / "native-tools.json"
        path.write_text(json.dumps(spec))
        with patch.object(self.dt, "NATIVE_TOOLS_PATH", str(path)):
            self.assertFalse(self.dt._is_exploration_shell("cat README.md"))
            handled, output = self.call("cat README.md")
        self.assertFalse(handled)
        self.assertNotIn("permissionDecision", output)
        path.write_text(json.dumps({**spec, "explorationShell": {"commands": "cat", "cases": {}}}))
        with patch.object(self.dt, "NATIVE_TOOLS_PATH", str(path)):
            self.assertFalse(self.dt._is_exploration_shell("cat README.md"))

    def test_missing_command_or_non_string_command_is_not_exploration(self):
        for command in ("", "   ", None, 7, "cd /tmp"):
            self.assertFalse(self.dt._is_exploration_shell(command), command)


class ColonyDenyTest(unittest.TestCase):
    """Colony dispatch guards: named dispatches and frontmatter model tiers.

    An atlas:* dispatch the tripwire accepts carries a sibling `name` and no
    per-call `model` that drifts the agent definition's frontmatter tier. Both
    guards share the toolkit/spec gating (armed orchestration, atlas:* only)
    and the ATLAS_TRIPWIRE_HARD kill switch; a definition file that cannot be
    read fails open."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.env = dict(os.environ, ATLAS_DB=os.path.join(self.tmp, "atlas.db"))
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        conn = atlas_db.connect(self.env["ATLAS_DB"])
        atlas_db.init(conn)
        pid = atlas_db.register_project(conn, "/repo/x")
        atlas_db.start_run(conn, pid, "sess-1")
        atlas_db.mark_orchestrating(conn, "sess-1")
        conn.close()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    # Clears every pre-existing guard, so a deny here can only come from the
    # colony guards under test.
    SPEC = TOOLS_BLOCK + SPEC_BLOCK

    def _pre(self, tinput):
        return run_hook(
            {
                "session_id": "sess-1",
                "hook_event_name": "PreToolUse",
                "tool_name": "Agent",
                "tool_input": tinput,
            },
            self.env,
        )

    def _dispatch(self, name="auth-slice", model=None, agent="atlas:implementer"):
        # implementer.md pins model: sonnet, so opus is a real mismatch.
        tinput = {"subagent_type": agent, "prompt": self.SPEC}
        if name is not None:
            tinput["name"] = name
        if model is not None:
            tinput["model"] = model
        return self._pre(tinput)

    def test_model_override_differs_from_definition_is_denied(self):
        r = self._dispatch(model="opus")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(
            json.loads(r.stdout)["hookSpecificOutput"]["permissionDecision"], "deny"
        )
        self.assertIn("model: sonnet", r.stdout)
        self.assertIn("Drop the `model` param", r.stdout)

    def test_matching_model_is_allowed(self):
        r = self._dispatch(model="sonnet")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")

    def test_case_insensitive_model_match_is_allowed(self):
        r = self._dispatch(model="Sonnet")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")

    def test_absent_model_is_allowed(self):
        r = self._dispatch(model=None)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")

    def test_missing_name_is_denied(self):
        r = self._dispatch(name="")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(
            json.loads(r.stdout)["hookSpecificOutput"]["permissionDecision"], "deny"
        )
        self.assertIn("SendMessage", r.stdout)
        self.assertIn("<role>-<slice>", r.stdout)

    def test_named_dispatch_is_allowed(self):
        r = self._dispatch(name="auth-implementer")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")

    def test_non_atlas_agent_is_never_gated(self):
        # No name, a drifting model, no spec: a non-atlas agent opts out of
        # every colony guard.
        r = self._pre(
            {
                "subagent_type": "Explore",
                "model": "opus",
                "prompt": "do the thing",
            }
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")

    def test_unreadable_definition_fails_open(self):
        # No such agent file -> the tier cannot be proven -> allow.
        r = self._dispatch(agent="atlas:not-an-atlas-agent", model="opus")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")

    def test_hard_off_lifts_both_colony_denies(self):
        env = dict(self.env, ATLAS_TRIPWIRE_HARD="off")
        unnamed_override = {
            "subagent_type": "atlas:implementer",
            "prompt": self.SPEC,
            "name": "",
            "model": "opus",
        }
        unnamed = {"subagent_type": "atlas:implementer", "prompt": self.SPEC, "name": ""}
        for tinput in (unnamed_override, unnamed):
            p = run_hook(
                {
                    "session_id": "sess-1",
                    "hook_event_name": "PreToolUse",
                    "tool_name": "Agent",
                    "tool_input": tinput,
                },
                env,
            )
            self.assertEqual(p.returncode, 0)
            self.assertEqual(p.stdout.strip(), "")

    def test_agent_teams_env_lifts_name_requirement(self):
        # With agent teams enabled, naming a main-conversation dispatch makes
        # it a teammate (inherits the lead's effort, runs in the main cwd)
        # instead of a scoped subagent; the guard stands down so atlas workers
        # stay unnamed subagents and their definition tier applies.
        env = dict(self.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS="1")
        p = run_hook(
            {
                "session_id": "sess-1",
                "hook_event_name": "PreToolUse",
                "tool_name": "Agent",
                "tool_input": {"subagent_type": "atlas:implementer", "prompt": self.SPEC},
            },
            env,
        )
        self.assertEqual(p.returncode, 0)
        self.assertEqual(p.stdout.strip(), "")

    def test_teams_env_unset_or_not_1_still_denies_unnamed(self):
        # Only the exact value "1" stands the guard down. The env is stripped
        # explicitly so a leaked host value cannot mask the deny.
        env = {
            k: v
            for k, v in self.env.items()
            if k != "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"
        }
        payload = {
            "session_id": "sess-1",
            "hook_event_name": "PreToolUse",
            "tool_name": "Agent",
            "tool_input": {"subagent_type": "atlas:implementer", "prompt": self.SPEC},
        }
        for teams_env in (env, dict(env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS="0")):
            r = run_hook(payload, teams_env)
            self.assertEqual(r.returncode, 0)
            self.assertEqual(
                json.loads(r.stdout)["hookSpecificOutput"]["permissionDecision"],
                "deny",
            )
            self.assertIn("SendMessage", r.stdout)


class ColonyGuardUnitTest(unittest.TestCase):
    """Helper-level coverage for definition branches no shipped agent uses:
    `model: inherit` accepts any model, and an unreadable definition file
    fails open. Pure functions, no DB."""

    def setUp(self):
        self.hooks_dir = os.path.dirname(__file__)
        sys.path.insert(0, self.hooks_dir)
        sys.path.insert(0, os.path.join(self.hooks_dir, "..", "scripts"))
        import dispatch_tripwire

        self.dt = dispatch_tripwire

    def test_inherit_definition_accepts_any_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            agents = Path(tmp)
            (agents / "probe.md").write_text(
                "---\nname: probe\nmodel: inherit\n---\n\nbody\n", encoding="utf-8"
            )
            with patch.object(self.dt, "AGENTS_DIR", agents):
                self.assertEqual(self.dt._frontmatter_model("probe"), "inherit")
                self.assertIsNone(
                    self.dt._model_override(
                        {"subagent_type": "atlas:probe", "model": "opus"}
                    )
                )

    def test_unreadable_definition_fails_open_in_the_helper(self):
        with patch.object(self.dt, "AGENTS_DIR", Path("/nonexistent/atlas/agents")):
            self.assertIsNone(self.dt._frontmatter_model("probe"))
            self.assertIsNone(
                self.dt._model_override(
                    {"subagent_type": "atlas:probe", "model": "opus"}
                )
            )

    def test_guards_ignore_non_atlas_agents(self):
        self.assertIsNone(self.dt._name_missing({"subagent_type": "Explore"}))
        self.assertIsNone(
            self.dt._model_override({"subagent_type": "fork", "model": "opus"})
        )

    def test_name_missing_accepts_only_a_real_name(self):
        self.assertEqual(
            self.dt._name_missing({"subagent_type": "atlas:verifier"}),
            "atlas:verifier",
        )
        self.assertEqual(
            self.dt._name_missing({"subagent_type": "atlas:verifier", "name": "   "}),
            "atlas:verifier",
        )
        self.assertIsNone(
            self.dt._name_missing(
                {"subagent_type": "atlas:verifier", "name": "auth-v"}
            )
        )


class ToolkitGapOmpTest(unittest.TestCase):
    """ATLAS_TOOLKIT_LOAD=omp is set only by the omp hook bridge. omp has no ToolSearch (its tools are xd://
    devices), so the load-step half of the requirement cannot be met there; the named-navigation-tool half stays.
    Unset, as in Claude Code, nothing changes."""

    def setUp(self):
        sys.path.insert(0, os.path.dirname(__file__))
        import dispatch_tripwire

        self.dt = dispatch_tripwire
        env = {k: v for k, v in os.environ.items() if k != "ATLAS_TOOLKIT_LOAD"}
        patcher = patch.dict(os.environ, env, clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    OMP_TOOLS = "use lean-ctx via its xd:// devices (xd://mcp__lean_ctx_ctx_search)"

    def gap(self, prompt, agent="atlas:implementer"):
        return self.dt._toolkit_gap({"subagent_type": agent, "prompt": prompt})

    def test_claude_unset_still_requires_the_toolsearch_load_step(self):
        self.assertEqual(self.gap(self.OMP_TOOLS), "atlas:implementer")
        with patch.dict(os.environ, {"ATLAS_TOOLKIT_LOAD": "claude"}):
            self.assertEqual(self.gap(self.OMP_TOOLS), "atlas:implementer")
        self.assertIsNone(self.gap('ToolSearch("select:mcp__lean-ctx__ctx_read") and lean-ctx'))

    def test_omp_mode_accepts_a_navigation_tool_without_toolsearch(self):
        with patch.dict(os.environ, {"ATLAS_TOOLKIT_LOAD": "omp"}):
            self.assertIsNone(self.gap(self.OMP_TOOLS))

    def test_omp_mode_still_denies_a_prompt_that_names_no_navigation_tool(self):
        with patch.dict(os.environ, {"ATLAS_TOOLKIT_LOAD": "omp"}):
            self.assertEqual(self.gap("implement the money module, read the files you need"), "atlas:implementer")
            self.assertEqual(self.gap("", "atlas:verifier"), "atlas:verifier")

    def test_non_atlas_agents_are_exempt_in_both_modes(self):
        self.assertIsNone(self.gap("anything", "Explore"))
        with patch.dict(os.environ, {"ATLAS_TOOLKIT_LOAD": "omp"}):
            self.assertIsNone(self.gap("anything", "Explore"))

    def test_deny_text_is_claude_wording_unless_the_omp_bridge_asked_for_omp(self):
        claude = self.dt._toolkit_gap_reason("Task", "atlas:implementer")
        self.assertIn("ToolSearch", claude)
        self.assertIn("Without it atlas:implementer greps the tree.", claude)
        with patch.dict(os.environ, {"ATLAS_TOOLKIT_LOAD": "claude"}):
            self.assertEqual(self.dt._toolkit_gap_reason("Task", "atlas:implementer"), claude)

    # Captured by running the released 8.7.0 hook (a7ba0e8) end to end on a no-TOOLS atlas dispatch. The substring checks
    # above would still pass if the Claude wording drifted; this one pins every byte of what Claude Code users see.
    CLAUDE_870_DENY = (
        "DENY - this Task dispatch is missing the code-nav TOOLS block. Paste subagent-kit.md / tool-routing.md: one "
        "batched ToolSearch that includes lean-ctx (ctx_compose/ctx_search/ctx_read) AND serena (activate_project, "
        "get_symbols_overview, find_symbol, and for implementers replace_symbol_body), plus context-mode for noisy "
        "output. The subagent must run that before Read/Grep/Bash; serena down -> lean-ctx only, never Bash grep. "
        "Without it atlas:implementer greps the tree."
    )

    def test_claude_deny_text_is_byte_identical_to_the_released_wording(self):
        self.assertEqual(self.dt._toolkit_gap_reason("Task", "atlas:implementer"), self.CLAUDE_870_DENY)
        with patch.dict(os.environ, {"ATLAS_TOOLKIT_LOAD": "claude"}):
            self.assertEqual(self.dt._toolkit_gap_reason("Task", "atlas:implementer"), self.CLAUDE_870_DENY)

    def test_omp_deny_text_names_what_an_omp_lead_can_actually_do(self):
        with patch.dict(os.environ, {"ATLAS_TOOLKIT_LOAD": "omp"}):
            text = self.dt._toolkit_gap_reason("Task", "atlas:implementer")
        self.assertNotIn("ToolSearch", text)  # omp has no such tool; asking for it is an instruction nobody can follow
        self.assertIn("xd://mcp__lean_ctx_ctx_search", text)
        self.assertIn("TOOLS:", text)  # a one-line block the lead can paste as is
        self.assertIn("atlas:implementer", text)
        self.assertTrue(text.startswith("DENY - this Task dispatch is missing the code-nav TOOLS block."))


if __name__ == "__main__":
    unittest.main()
