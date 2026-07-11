import json
import os
import subprocess
import sys
import tempfile
import unittest

HOOK = os.path.join(os.path.dirname(__file__), "prompt_optimizer.py")


def run_hook(payload, env):
    return subprocess.run(
        [sys.executable, HOOK],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
    )


class PromptClassifierTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.db = os.path.join(self.tmp, "atlas.db")
        # Force trigger mode (default) so no non-prefixed prompt ever calls ollama;
        # the classifier path is what we exercise here.
        self.env = dict(os.environ, ATLAS_DB=self.db, ATLAS_OPTIMIZE="trigger")
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

    def _atlas_db(self):
        import atlas_db

        return atlas_db

    def _orchestrating_flag(self, session_id):
        """Raw runs.orchestrating value for the session's latest run, or None if
        the session has no run row at all."""
        atlas_db = self._atlas_db()
        conn = atlas_db.connect(self.db)
        atlas_db.init(conn)
        row = conn.execute(
            "SELECT orchestrating FROM runs WHERE session_id=? ORDER BY id DESC LIMIT 1",
            (session_id,),
        ).fetchone()
        conn.close()
        return row[0] if row else None

    def _seed_run(self, session_id):
        """A boot-created run with orchestrating=0 (never marked)."""
        atlas_db = self._atlas_db()
        conn = atlas_db.connect(self.db)
        atlas_db.init(conn)
        pid = atlas_db.register_project(conn, "/repo/x")
        atlas_db.start_run(conn, pid, session_id)
        conn.close()

    # 1. Substantive prompt arms the flag AND injects the engine nudge.
    def test_substantive_prompt_arms_and_nudges(self):
        payload = {
            "session_id": "sess-build",
            "cwd": self.tmp,
            "prompt": (
                "Refactor backend/services/auth.py to use JWT, fix the failing login "
                "test, and add rate limiting to the API."
            ),
        }
        r = run_hook(payload, self.env)
        self.assertEqual(r.returncode, 0)
        # DB: the run for this session is flagged orchestrating=1.
        self.assertEqual(self._orchestrating_flag("sess-build"), 1)
        # stdout: a single JSON object whose additionalContext carries the nudge.
        out = json.loads(r.stdout)
        ctx = out["hookSpecificOutput"]["additionalContext"]
        self.assertIn("atlas-metis", ctx)
        self.assertIn("dispatch wave 1", ctx)

    # 1b. An error report (stack trace) is substantive too.
    def test_error_report_arms(self):
        payload = {
            "session_id": "sess-err",
            "cwd": self.tmp,
            "prompt": (
                "The worker crashes on startup with:\n"
                "Traceback (most recent call last):\n"
                '  File "app/main.py", line 42, in run\n'
                "TypeError: cannot read property of undefined"
            ),
        }
        r = run_hook(payload, self.env)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self._orchestrating_flag("sess-err"), 1)

    # 2. Trivial prompts change NOTHING: no flag flip, no nudge, empty stdout.
    def test_ack_changes_nothing(self):
        self._seed_run("sess-ack")
        r = run_hook(
            {"session_id": "sess-ack", "cwd": self.tmp, "prompt": "thanks"}, self.env
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")
        self.assertEqual(self._orchestrating_flag("sess-ack"), 0)

    def test_question_changes_nothing(self):
        self._seed_run("sess-q")
        r = run_hook(
            {
                "session_id": "sess-q",
                "cwd": self.tmp,
                "prompt": "what does this acronym mean",
            },
            self.env,
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")
        self.assertEqual(self._orchestrating_flag("sess-q"), 0)

    # 2b. Conversational multi-step prompts must NOT arm. Each stacks common
    #     action verbs (fix / add / remove / buy) into a sequenced or numbered
    #     list with zero code reference - the exact false-positive shape that the
    #     old score-based classifier wrongly armed.
    def _assert_no_arm(self, session_id, prompt):
        self._seed_run(session_id)
        r = run_hook(
            {"session_id": session_id, "cwd": self.tmp, "prompt": prompt}, self.env
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "", f"unexpected nudge for: {prompt!r}")
        self.assertEqual(
            self._orchestrating_flag(session_id), 0, f"wrongly armed: {prompt!r}"
        )

    def test_conversational_sandwich_does_not_arm(self):
        self._assert_no_arm(
            "sess-fp-sandwich",
            "Can you help me fix a sandwich for lunch, then figure out what wine "
            "pairs well with it? I want to also add a side salad and remove the "
            "onions since my kid is picky.",
        )

    def test_conversational_recipe_list_does_not_arm(self):
        self._assert_no_arm(
            "sess-fp-recipe",
            "1. Buy tomatoes\n2. Fix the salad dressing recipe\n"
            "3. Add basil and remove the garlic",
        )

    def test_conversational_trip_does_not_arm(self):
        self._assert_no_arm(
            "sess-fp-trip",
            "For the trip, first book the flights, then fix our hotel reservation, "
            "and finally add travel insurance before we go.",
        )

    def test_conversational_gift_does_not_arm(self):
        self._assert_no_arm(
            "sess-fp-gift",
            "Can you help me wrap this gift? First add a bow, then fix the tape so "
            "it doesn't peel, and finally remove the price tag.",
        )

    # 2c. Genuine engineering that carries NO explicit code reference must still
    #     arm - a strong technical verb is a work order on its own. These would be
    #     wrongly rejected by a naive hard code-anchor gate.
    def test_repo_security_audit_arms(self):
        payload = {
            "session_id": "sess-audit",
            "cwd": self.tmp,
            "prompt": "Audit this repo for security issues.",
        }
        r = run_hook(payload, self.env)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self._orchestrating_flag("sess-audit"), 1)
        out = json.loads(r.stdout)
        self.assertIn("atlas-metis", out["hookSpecificOutput"]["additionalContext"])

    def test_endpoint_investigation_arms(self):
        payload = {
            "session_id": "sess-500",
            "cwd": self.tmp,
            "prompt": ("The login endpoint returns 500 after deploy, investigate why."),
        }
        r = run_hook(payload, self.env)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self._orchestrating_flag("sess-500"), 1)

    # 3. An internal exception (parent of DB path is a file -> connect raises)
    #    must still exit 0 and emit nothing.
    def test_internal_exception_exits_zero(self):
        afile = os.path.join(self.tmp, "afile")
        with open(afile, "w") as fh:
            fh.write("not a directory")
        bad_env = dict(
            os.environ,
            ATLAS_DB=os.path.join(afile, "atlas.db"),  # parent is a regular file
            ATLAS_OPTIMIZE="trigger",
        )
        payload = {
            "session_id": "sess-boom",
            "cwd": self.tmp,
            "prompt": (
                "Refactor backend/services/auth.py to use JWT and add tests for the "
                "login flow."
            ),
        }
        r = run_hook(payload, bad_env)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")


if __name__ == "__main__":
    unittest.main()
