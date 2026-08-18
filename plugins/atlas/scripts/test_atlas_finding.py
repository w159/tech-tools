"""atlas_finding.py -- the write path the completion gate reads.

The bug this file guards: atlas:verifier runs with Write disallowed and had no
way to put a verdict into .atlas/.run/findings.json, so verdicts stayed prose,
gate condition (b) tripped, and the orchestrator re-dispatched. These tests
assert the CLI produces exactly the shape condition (b) accepts.

Stdlib only.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "atlas_finding.py"
GATE = Path(__file__).resolve().parent.parent / "hooks" / "completion_gate.py"


def _run(args, cwd):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        cwd=str(cwd),
        capture_output=True,
        text=True,
    )


def _findings(root: Path):
    return json.loads((root / ".atlas" / ".run" / "findings.json").read_text())


class AtlasFindingCli(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        (self.root / "docs").mkdir()

    def tearDown(self):
        self._tmp.cleanup()

    def test_creates_file_and_appends_entry(self):
        r = _run(
            ["--id", "S1", "--status", "verified", "--title", "budget sums income"],
            self.root,
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        items = _findings(self.root)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["id"], "S1")
        self.assertEqual(items[0]["status"], "verified")
        self.assertIn("verified_at", items[0])

    def test_appends_rather_than_overwrites(self):
        _run(["--id", "S1", "--status", "open", "--title", "a"], self.root)
        _run(["--id", "S2", "--status", "verified", "--title", "b"], self.root)
        self.assertEqual([i["id"] for i in _findings(self.root)], ["S1", "S2"])

    def test_repeatable_evidence_flags(self):
        _run(
            [
                "--id",
                "S1",
                "--status",
                "verified",
                "--title",
                "t",
                "--evidence",
                "a.py:1",
                "--evidence",
                ".atlas/evidence/run.log",
                "--reproduction",
                "pytest -q",
            ],
            self.root,
        )
        entry = _findings(self.root)[0]
        self.assertEqual(entry["evidence"], ["a.py:1", ".atlas/evidence/run.log"])
        self.assertEqual(entry["reproduction"], "pytest -q")

    def test_rejects_status_outside_the_schema_enum(self):
        r = _run(["--id", "S1", "--status", "done", "--title", "t"], self.root)
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse((self.root / ".atlas" / ".run" / "findings.json").exists())

    def test_unwraps_dict_shaped_ledger_without_dropping_entries(self):
        run = self.root / ".atlas" / ".run"
        run.mkdir(parents=True)
        (run / "findings.json").write_text(json.dumps({"findings": [{"id": "OLD"}]}))
        _run(["--id", "S1", "--status", "verified", "--title", "t"], self.root)
        self.assertEqual([i["id"] for i in _findings(self.root)], ["OLD", "S1"])

    def test_corrupt_ledger_does_not_abort_the_write(self):
        run = self.root / ".atlas" / ".run"
        run.mkdir(parents=True)
        (run / "findings.json").write_text("{not json")
        r = _run(["--id", "S1", "--status", "verified", "--title", "t"], self.root)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(len(_findings(self.root)), 1)

    def test_no_project_root_fails_loudly(self):
        with tempfile.TemporaryDirectory() as bare:
            # A bare dir with no docs/ or .atlas/ anywhere it can detect. Use an
            # explicit nonexistent --root so ancestor detection cannot rescue it.
            r = _run(
                ["--id", "S1", "--status", "verified", "--title", "t", "--root", ""],
                bare,
            )
            self.assertNotEqual(r.returncode, 0)

    def test_entry_satisfies_completion_gate_condition_b(self):
        """The whole point: what this CLI writes is what the gate accepts."""
        sys.path.insert(0, str(GATE.parent))
        import completion_gate

        _run(["--id", "S1", "--status", "verified", "--title", "t"], self.root)
        self.assertTrue(completion_gate._check_findings(self.root))

    def test_non_verified_entry_does_not_satisfy_condition_b(self):
        sys.path.insert(0, str(GATE.parent))
        import completion_gate

        _run(["--id", "S1", "--status", "needs-evidence", "--title", "t"], self.root)
        self.assertFalse(completion_gate._check_findings(self.root))


if __name__ == "__main__":
    unittest.main()
