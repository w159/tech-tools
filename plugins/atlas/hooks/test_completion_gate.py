import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from completion_gate import _docs_drift

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


if __name__ == "__main__":
    unittest.main()
