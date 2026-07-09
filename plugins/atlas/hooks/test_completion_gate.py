import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from completion_gate import (
    _docs_drift,
    _nondocs_changed,
    _unpaired_implementer_dispatches,
)

GATE = os.path.join(os.path.dirname(__file__), "completion_gate.py")


def _run_gate(payload, env):
    return subprocess.run(
        [sys.executable, GATE],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
    )


class DocsDriftTest(unittest.TestCase):
    def test_non_docs_only_returns_true(self):
        """Non-docs changes with no docs changes -> drift detected."""
        self.assertTrue(_docs_drift(["src/foo.py", "README.md"]))

    def test_docs_change_present_returns_false(self):
        """Any docs/ path in the list -> no drift."""
        self.assertFalse(_docs_drift(["src/foo.py", "docs/CHANGELOG.md"]))

    def test_only_docs_path_returns_false(self):
        """Only docs/ paths -> no drift."""
        self.assertFalse(_docs_drift(["docs/ROADMAP.md"]))

    def test_nested_docs_path_returns_false(self):
        """A path containing /docs/ counts as a docs path."""
        self.assertFalse(_docs_drift(["plugins/atlas/docs/features.md"]))

    def test_empty_list_returns_false(self):
        """Empty input -> no drift (nothing changed)."""
        self.assertFalse(_docs_drift([]))


class GateOrchestrationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        os.makedirs(
            os.path.join(self.tmp, "docs"), exist_ok=True
        )  # docs/ exists, no artifacts
        self.env = dict(os.environ, ATLAS_DB=os.path.join(self.tmp, "atlas.db"))
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        c = atlas_db.connect(self.env["ATLAS_DB"])
        atlas_db.init(c)
        pid = atlas_db.register_project(c, self.tmp)
        atlas_db.start_run(c, pid, "sess-chat")  # non-orchestration
        atlas_db.start_run(c, pid, "sess-orch")
        atlas_db.mark_orchestrating(c, "sess-orch")  # orchestration
        c.close()

    def test_non_orchestration_session_is_not_blocked(self):
        r = _run_gate({"session_id": "sess-chat", "cwd": self.tmp}, self.env)
        self.assertEqual(r.returncode, 0)
        self.assertNotIn('"decision": "block"', r.stdout)

    def test_orchestration_session_missing_artifacts_is_blocked(self):
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn('"decision": "block"', r.stdout)

    def _satisfy_all_conditions(self):
        docs = os.path.join(self.tmp, "docs")
        os.makedirs(os.path.join(docs, "evidence"), exist_ok=True)
        os.makedirs(os.path.join(docs, ".run"), exist_ok=True)
        with open(os.path.join(docs, "evidence", "run.txt"), "w") as f:
            f.write("observed output")
        with open(os.path.join(docs, ".run", "findings.json"), "w") as f:
            json.dump([{"claim": "x works", "status": "verified"}], f)
        for name in ("CHANGELOG.md", "ROADMAP.md"):
            with open(os.path.join(docs, name), "w") as f:
                f.write("# %s\ncontent\n" % name)
        with open(os.path.join(self.tmp, "README.md"), "w") as f:
            f.write("# project\n")

    def test_all_conditions_met_passes(self):
        self._satisfy_all_conditions()
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertEqual(r.returncode, 0)
        self.assertNotIn('"decision": "block"', r.stdout)

    def test_missing_roadmap_blocks_with_condition_d(self):
        self._satisfy_all_conditions()
        os.remove(os.path.join(self.tmp, "docs", "ROADMAP.md"))
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn('"decision": "block"', r.stdout)
        self.assertIn("ROADMAP.md is missing", r.stdout)

    def test_missing_readme_blocks_with_condition_e(self):
        self._satisfy_all_conditions()
        os.remove(os.path.join(self.tmp, "README.md"))
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn('"decision": "block"', r.stdout)
        self.assertIn("README.md at the project root is missing", r.stdout)

    def test_docs_drift_blocks_with_condition_f(self):
        self._satisfy_all_conditions()
        subprocess.run(["git", "init", "-q", self.tmp], check=True, capture_output=True)
        genv = dict(
            os.environ,
            GIT_AUTHOR_NAME="t",
            GIT_AUTHOR_EMAIL="t@t",
            GIT_COMMITTER_NAME="t",
            GIT_COMMITTER_EMAIL="t@t",
        )
        subprocess.run(
            ["git", "-C", self.tmp, "add", "-A"], check=True, capture_output=True
        )
        subprocess.run(
            ["git", "-C", self.tmp, "commit", "-qm", "base"],
            check=True,
            capture_output=True,
            env=genv,
        )
        # change code only -> drift
        with open(os.path.join(self.tmp, "app.py"), "w") as f:
            f.write("print('x')\n")
        subprocess.run(
            ["git", "-C", self.tmp, "add", "app.py"], check=True, capture_output=True
        )
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn('"decision": "block"', r.stdout)
        self.assertIn("Docs drift", r.stdout)
        # touching a docs file clears the drift block
        with open(os.path.join(self.tmp, "docs", "CHANGELOG.md"), "a") as f:
            f.write("- change\n")
        r2 = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertNotIn('"decision": "block"', r2.stdout)

    def _commit_and_make_mixed_diff(self):
        """Satisfy (a)-(f): commit a baseline, then stage a non-docs code change
        AND touch a docs file so drift is cleared but code did change this run."""
        self._satisfy_all_conditions()
        genv = dict(
            os.environ,
            GIT_AUTHOR_NAME="t",
            GIT_AUTHOR_EMAIL="t@t",
            GIT_COMMITTER_NAME="t",
            GIT_COMMITTER_EMAIL="t@t",
        )
        subprocess.run(["git", "init", "-q", self.tmp], check=True, capture_output=True)
        subprocess.run(
            ["git", "-C", self.tmp, "add", "-A"], check=True, capture_output=True
        )
        subprocess.run(
            ["git", "-C", self.tmp, "commit", "-qm", "base"],
            check=True,
            capture_output=True,
            env=genv,
        )
        # non-docs code change (staged) -> code_changed True
        with open(os.path.join(self.tmp, "app.py"), "w") as f:
            f.write("print('x')\n")
        subprocess.run(
            ["git", "-C", self.tmp, "add", "app.py"], check=True, capture_output=True
        )
        # docs change -> drift cleared, so (f) passes and only (g) can block
        with open(os.path.join(self.tmp, "docs", "CHANGELOG.md"), "a") as f:
            f.write("- change\n")

    def _log_dispatches(self, implementers, verifiers):
        """Record implementer/verifier dispatches on the orch session's run."""
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        c = atlas_db.connect(self.env["ATLAS_DB"])
        rid = atlas_db.current_run_id(c, "sess-orch") or atlas_db.latest_run_id(
            c, "sess-orch"
        )
        for _ in range(implementers):
            atlas_db.log_dispatch(c, rid, "atlas:implementer")
        for _ in range(verifiers):
            atlas_db.log_dispatch(c, rid, "atlas:verifier")
        c.commit()
        c.close()

    def test_unpaired_implementer_dispatches_blocks_with_condition_g(self):
        """2 implementers + 0 verifiers, code changed, (a)-(f) met -> (g) blocks."""
        self._commit_and_make_mixed_diff()
        self._log_dispatches(implementers=2, verifiers=0)
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn('"decision": "block"', r.stdout)
        self.assertIn("verifier coverage", r.stdout)
        self.assertIn("atlas:verifier", r.stdout)
        self.assertIn("2 implementer", r.stdout)

    def test_paired_verifier_dispatches_do_not_block(self):
        """2 implementers + 2 verifiers -> unpaired count 0 -> no (g) block."""
        self._commit_and_make_mixed_diff()
        self._log_dispatches(implementers=2, verifiers=2)
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertEqual(r.returncode, 0)
        self.assertNotIn('"decision": "block"', r.stdout)

    def test_no_implementer_dispatches_do_not_block(self):
        """0 implementers -> unpaired count 0 -> no (g) block."""
        self._commit_and_make_mixed_diff()
        self._log_dispatches(implementers=0, verifiers=0)
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertEqual(r.returncode, 0)
        self.assertNotIn('"decision": "block"', r.stdout)


class ConditionGHelperTest(unittest.TestCase):
    def test_nondocs_changed_true_for_code_path(self):
        self.assertTrue(_nondocs_changed(["src/foo.py", "docs/CHANGELOG.md"]))

    def test_nondocs_changed_false_for_docs_only(self):
        self.assertFalse(_nondocs_changed(["docs/CHANGELOG.md", "a/docs/b.md"]))

    def test_nondocs_changed_false_for_empty(self):
        self.assertFalse(_nondocs_changed([]))

    def test_unpaired_fails_open_to_zero_on_db_error(self):
        """atlas_db unavailable (DB path unopenable) -> helper returns 0, no crash."""
        blocker = tempfile.NamedTemporaryFile(delete=False)
        blocker.write(b"x")
        blocker.close()
        old = os.environ.get("ATLAS_DB")
        # A path *under* a regular file: connect()'s makedirs raises -> fail-open.
        os.environ["ATLAS_DB"] = os.path.join(blocker.name, "atlas.db")
        try:
            self.assertEqual(_unpaired_implementer_dispatches("sess-orch"), 0)
        finally:
            if old is None:
                os.environ.pop("ATLAS_DB", None)
            else:
                os.environ["ATLAS_DB"] = old
            os.unlink(blocker.name)


if __name__ == "__main__":
    unittest.main()
