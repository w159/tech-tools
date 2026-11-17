"""17.28.0 (B): with tmux on PATH the FIRST in-process working atlas: dispatch of a session is routed like
every later one (the session is armed only after it), also when the one-time spec advisory would let it
through. The route is a permission deny whose text is a ready spawn-team command with the prompt saved
to .atlas/.run/briefs/. Read-only and closing roles pass; no tmux, omp and ATLAS_TEAM_GATE=off keep today's
behaviour."""

import glob
import json
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "scripts"))
sys.path.insert(0, _HERE)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)

os.environ.setdefault("ATLAS_CHANNELS", "off")

import tempfile  # noqa: E402
import unittest  # noqa: E402

import dispatch_tripwire_core as core  # noqa: E402
import test_dispatch_tripwire as T  # noqa: E402

ROUTE = "ROUTE - this work goes to a tmux team: run the command below"


def setUpModule():
    T.setUpModule()


def tearDownModule():
    T.tearDownModule()


class DispatchArmingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        # docs/ makes find_root() resolve the temp project: the one-time spec advisory is recorded there.
        os.makedirs(os.path.join(self.tmp, "docs"))
        self.env = dict(
            os.environ,
            ATLAS_DB=os.path.join(self.tmp, "atlas.db"),
            ATLAS_GATES="always",
            ATLAS_TRIPWIRE="on",
            ATLAS_BURST_SECS="0",
            ATLAS_TEAM_GATE="on",
        )
        for k in ("ATLAS_TRIPWIRE_THRESHOLD", "ATLAS_WORKER_NAME", "ATLAS_HARNESS", "ATLAS_TOOLKIT_LOAD"):
            self.env.pop(k, None)
        import atlas_db

        conn = atlas_db.connect(self.env["ATLAS_DB"])
        atlas_db.init(conn)
        pid = atlas_db.register_project(conn, "/repo/x")
        atlas_db.start_run(conn, pid, "sess-1")  # NOT marked orchestrating: the session is unarmed
        conn.close()

    def _arm(self):
        import atlas_db

        conn = atlas_db.connect(self.env["ATLAS_DB"])
        atlas_db.mark_orchestrating(conn, "sess-1")
        conn.close()

    def _path(self, with_tmux=True):
        d = tempfile.mkdtemp(dir=self.tmp)
        if with_tmux:
            fake = os.path.join(d, "tmux")
            with open(fake, "w") as fh:
                fh.write("#!/bin/sh\nexit 0\n")
            os.chmod(fake, 0o755)
        return d

    def _env(self, with_tmux=True, **extra):
        return dict(self.env, PATH=self._path(with_tmux), **extra)

    def _dispatch(self, env, agent="atlas:implementer", scope="fix/medium", spec=None, name="auth-slice"):
        spec = T.SPEC_BLOCK.replace("SCOPE: fix/medium\n", "") if spec is None else spec
        prompt = T.TOOLS_BLOCK + spec + f"SCOPE: {scope}\n"
        payload = {
            "session_id": "sess-1",
            "cwd": self.tmp,
            "hook_event_name": "PreToolUse",
            "tool_name": "Agent",
            "tool_input": {"subagent_type": agent, "name": name, "prompt": prompt},
        }
        r = T.run_hook(payload, env)
        if not r.stdout.strip():
            return None, "", prompt
        out = json.loads(r.stdout)["hookSpecificOutput"]
        text = out.get("permissionDecisionReason") or out.get("additionalContext") or ""
        return out.get("permissionDecision"), text, prompt

    def _assert_routed(self, decision, text, prompt, cls="fix", effort="medium"):
        self.assertEqual(decision, "deny")
        self.assertTrue(text.startswith(ROUTE), text)
        self.assertNotIn("DENY - in-process working dispatch", text)
        m = re.search(
            r'python3 "\$\{CLAUDE_PLUGIN_ROOT\}/scripts/atlas_mux\.py" spawn-team '
            rf"--class {cls} --effort {effort} --task-file (\S+)",
            text,
        )
        self.assertIsNotNone(m, text)
        brief = m.group(1)
        self.assertTrue(os.path.isfile(brief), brief)
        self.assertIn(os.sep + os.path.join(".atlas", ".run", "briefs") + os.sep, brief)
        self.assertTrue(os.path.basename(brief).startswith("auth-slice-"), brief)
        with open(brief) as fh:
            self.assertEqual(fh.read(), prompt)
        self.assertTrue(core._is_orchestration_path(brief, self.tmp))
        text.encode("ascii")

    def test_first_dispatch_of_unarmed_session_is_routed(self):
        env = self._env()
        self._assert_routed(*self._dispatch(env))
        self._assert_routed(*self._dispatch(env))  # the second is routed the same way

    def test_first_dispatch_of_armed_session_is_routed(self):
        self._arm()
        env = self._env()
        self._assert_routed(*self._dispatch(env))
        self._assert_routed(*self._dispatch(env, scope="fix/low"), effort="low")

    def test_spec_advisory_does_not_let_the_first_dispatch_through(self):
        self._arm()
        env = self._env()
        spec = T.SPEC_BLOCK.replace("SCOPE: fix/medium\n", "").replace(
            "OUT OF SCOPE: no edits, no migrations, no dependency changes\n", ""
        )
        self._assert_routed(*self._dispatch(env, spec=spec))

    def test_paths_are_included_only_when_named(self):
        self._arm()
        env = self._env()
        spec = T.SPEC_BLOCK.replace("SCOPE: fix/medium\n", "") + "PATHS: src/a.py, src/b.py\n"
        decision, text, _ = self._dispatch(env, spec=spec)
        self.assertEqual(decision, "deny")
        self.assertIn("--effort medium --paths src/a.py,src/b.py --task-file ", text)
        decision, text, _ = self._dispatch(env)
        self.assertNotIn("--paths", text)

    def test_read_only_and_closing_roles_pass(self):
        env = self._env()
        for agent, scope in (
            ("atlas:explorer", "audit/medium"),
            ("atlas:db-prober", "db-audit/medium"),
            ("atlas:verifier", "implement/medium"),
            ("atlas:planner", T._scope_for("planner")),
        ):
            for armed in (False, True):
                if armed:
                    self._arm()
                decision, text, _ = self._dispatch(env, agent=agent, scope=scope, name="ro-slice")
                self.assertIsNone(decision, (agent, armed, text))
                self.assertNotIn("ROUTE", text)

    def test_no_tmux_omp_and_gate_off_keep_todays_behaviour(self):
        for env in (
            self._env(with_tmux=False),
            self._env(ATLAS_HARNESS="omp"),
            self._env(ATLAS_TEAM_GATE="off"),
        ):
            decision, text, _ = self._dispatch(env)  # unarmed: never denied anything
            self.assertIsNone(decision)
            self.assertEqual(text, "")
        self._arm()
        env = self._env(with_tmux=False)
        self._dispatch(env)
        decision, text, _ = self._dispatch(env)
        self.assertIsNone(decision)
        self.assertIn("ADVISORY (no tmux)", text)
        env = self._env(ATLAS_TEAM_GATE="off")
        decision, text, _ = self._dispatch(env)
        self.assertIsNone(decision)
        self.assertEqual(glob.glob(os.path.join(self.tmp, ".atlas", ".run", "briefs", "*")), [])


if __name__ == "__main__":
    unittest.main()
