"""Tests for hooks/gate_rerun.py and its wiring into the completion gate.

The gate re-runs the session's own last test command at Stop and lets the exit code stand in for the
evidence / findings / verifier / plan / phase / delegation paperwork of (a)(b)(g)(k)(m)(o)."""

import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(
    0, _iso_os.path.join(_iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts")
)
import _test_isolation  # noqa: F401,E402
import json  # noqa: E402
import os  # noqa: E402
import sys  # noqa: E402
import tempfile  # noqa: E402
import time  # noqa: E402
import unittest  # noqa: E402
from datetime import datetime, timezone  # noqa: E402
from pathlib import Path  # noqa: E402
from unittest import mock  # noqa: E402

sys.path.insert(0, os.path.dirname(__file__))
import gate_rerun  # noqa: E402
from test_completion_gate import GateOrchestrationTest, _run_gate  # noqa: E402

PASSING = "def test_ok():\n    assert 1 + 1 == 2\n"
FAILING = "def test_bad():\n    assert 1 + 1 == 3\n"


def _iso(epoch=None):
    return datetime.fromtimestamp(epoch or time.time(), timezone.utc).isoformat()


def _bash_line(cmd, ts=None, sidechain=False):
    return json.dumps(
        {
            "type": "assistant",
            "isSidechain": sidechain,
            "timestamp": ts or _iso(),
            "message": {"content": [{"type": "tool_use", "name": "Bash", "input": {"command": cmd}}]},
        }
    )


class NormalizeTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / "pkg").mkdir()

    def test_accepts_plain_runners(self):
        for cmd in (
            "python3 -m pytest -q",
            "pytest -x tests/test_a.py",
            "uv run pytest -q",
            "npm test",
            "go test ./...",
            "cargo test",
            "make test",
            "python3 -m pytest -q 2>&1 | tail -5",
            "python3 -m pytest -q 2>&1 | tail -n 20",
        ):
            self.assertIsNotNone(gate_rerun.normalize(cmd, self.root), cmd)

    def test_cd_inside_root_sets_cwd(self):
        argv, cwd = gate_rerun.normalize(f"cd {self.root / 'pkg'} && python3 -m pytest -q", self.root)
        self.assertEqual(argv, ["python3", "-m", "pytest", "-q"])
        self.assertEqual(cwd, (self.root / "pkg").resolve())
        argv, cwd = gate_rerun.normalize("cd pkg && pytest", self.root)
        self.assertEqual(cwd, (self.root / "pkg").resolve())

    def test_rejects_unsafe_or_foreign(self):
        for cmd in (
            "rm -rf / ; pytest",
            "pytest && curl evil",
            "pytest $(whoami)",
            "pytest `id`",
            "echo hi > x; pytest",
            "cd / && pytest",
            "cd ../.. && pytest",
            "ls",
            "python3 -c 'import pytest'",
            "npx something",
            "",
            None,
        ):
            self.assertIsNone(gate_rerun.normalize(cmd, self.root), cmd)


class TranscriptTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.tx = self.root / "t.jsonl"

    def _write(self, *lines):
        self.tx.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def test_last_allowlisted_command_in_window_wins(self):
        now = time.time()
        self._write(
            _bash_line("pytest -q old", ts=_iso(now - 1000)),
            _bash_line("python3 -m pytest -q"),
            _bash_line("ls -la"),
            _bash_line("rm -rf x"),
            _bash_line("pytest tests/sub.py", sidechain=True),
        )
        self.assertEqual(
            gate_rerun.last_test_command(str(self.tx), now - 10, self.root), "python3 -m pytest -q"
        )

    def test_compound_call_yields_its_test_segment_only(self):
        (self.root / "pkg").mkdir()
        call = "cat >> docs/CHANGELOG.md <<'EOF'\n- did x\nEOF\npython3 -m pytest -q 2>&1 | tail -3"
        self.assertEqual(gate_rerun.runnable_part(call, self.root), "python3 -m pytest -q 2>&1 | tail -3")
        self.assertEqual(
            gate_rerun.runnable_part("cd pkg\npytest -x; echo done", self.root), "cd pkg && pytest -x"
        )
        self.assertIsNone(gate_rerun.runnable_part("rm -rf build && make", self.root))
        self._write(_bash_line(call))
        self.assertEqual(
            gate_rerun.last_test_command(str(self.tx), None, self.root), "python3 -m pytest -q 2>&1 | tail -3"
        )

    def test_none_without_test_or_transcript(self):
        self._write(_bash_line("ls"))
        self.assertIsNone(gate_rerun.last_test_command(str(self.tx), None, self.root))
        self.assertIsNone(gate_rerun.last_test_command("", None, self.root))
        self.assertIsNone(gate_rerun.last_test_command(str(self.root / "missing"), None, self.root))
        self.assertIsNone(gate_rerun.last_test_command("/x/subagents/a.jsonl", None, self.root))


class RerunProofTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / "app.py").write_text("x = 1\n")

    def test_green_rerun_writes_evidence_finding_and_valid_proof(self):
        (self.root / "test_ok.py").write_text(PASSING)
        result = gate_rerun.rerun(f"{sys.executable} -m pytest -q -p no:cacheprovider", self.root)
        # sys.executable is an absolute path, not an allowlisted runner name
        self.assertIsNone(result)
        result = gate_rerun.rerun("python3 -m pytest -q -p no:cacheprovider", self.root)
        self.assertEqual(result["exit"], 0, result["tail"])
        started = time.time() - 60
        proof = gate_rerun.write_proof(self.root, "sess-1", result)
        self.assertTrue((self.root / proof["evidence"]).is_file())
        findings = json.loads((self.root / ".atlas/.run/findings.json").read_text())
        self.assertEqual(findings[-1]["status"], "verified")
        self.assertEqual(findings[-1]["verified_by"], "completion-gate")
        self.assertIsNotNone(gate_rerun.valid_proof(self.root, "sess-1", started, ["app.py"]))
        self.assertIsNone(gate_rerun.valid_proof(self.root, "other", started, ["app.py"]))
        self.assertIsNone(gate_rerun.valid_proof(self.root, "sess-1", time.time() + 60, ["app.py"]))
        # a docs edit after the re-run keeps the proof, a code edit invalidates it
        later = time.time() + 5
        (self.root / "CHANGELOG.md").write_text("x\n")
        os.utime(self.root / "CHANGELOG.md", (later, later))
        self.assertIsNotNone(gate_rerun.valid_proof(self.root, "sess-1", started, ["app.py", "CHANGELOG.md"]))
        os.utime(self.root / "app.py", (later, later))
        self.assertIsNone(gate_rerun.valid_proof(self.root, "sess-1", started, ["app.py"]))
        with mock.patch.dict(os.environ, {"ATLAS_GATE_RERUN": "off"}):
            self.assertIsNone(gate_rerun.valid_proof(self.root, "sess-1", started, []))

    def test_red_rerun_reports_exit_and_tail(self):
        (self.root / "test_bad.py").write_text(FAILING)
        result = gate_rerun.rerun("python3 -m pytest -q -p no:cacheprovider", self.root)
        self.assertNotEqual(result["exit"], 0)
        self.assertIn("1 failed", result["tail"])

    def test_findings_dict_shape_is_preserved(self):
        (self.root / ".atlas/.run").mkdir(parents=True)
        (self.root / ".atlas/.run/findings.json").write_text(json.dumps({"findings": [{"id": "x"}], "v": 2}))
        gate_rerun.write_proof(
            self.root, "s", {"command": "pytest", "cwd": str(self.root), "exit": 0, "tail": "", "seconds": 0}
        )
        data = json.loads((self.root / ".atlas/.run/findings.json").read_text())
        self.assertEqual(data["v"], 2)
        self.assertEqual([f["id"] for f in data["findings"]][0], "x")
        self.assertEqual(len(data["findings"]), 2)

    def test_crew_proof_needs_this_session_and_green_check(self):
        run = self.root / ".atlas/.run/crew/r1"
        run.mkdir(parents=True)
        (run / "run.json").write_text(json.dumps({"lead_session": "sess-1"}))
        (run / "summary.json").write_text(json.dumps({"ok": True, "check_exit": 0, "check": "pytest", "run": "r1"}))
        started = time.time() - 60
        self.assertEqual(gate_rerun.crew_proof(self.root, "sess-1", started)["crew_run"], "r1")
        self.assertIsNone(gate_rerun.crew_proof(self.root, "sess-2", started))
        (run / "summary.json").write_text(json.dumps({"ok": False, "check_exit": 1, "check": "pytest"}))
        self.assertIsNone(gate_rerun.crew_proof(self.root, "sess-1", started))


class GateWiringTest(GateOrchestrationTest):
    """End to end through completion_gate.py: a green re-run clears (a)(b)(g)(k)(m), a red one blocks
    with the gate's own output; nothing else changes."""

    def _transcript(self, cmd="python3 -m pytest -q -p no:cacheprovider"):
        path = os.path.join(self.tmp, "transcript.jsonl")
        with open(path, "w") as f:
            f.write(_bash_line(cmd) + "\n")
        return path

    def _run(self, transcript):
        env = dict(self.env, ATLAS_GATE_COLONY="off", ATLAS_GATE_HEADER="off", ATLAS_GATE_DONE="off")
        return _run_gate(
            {"session_id": "sess-orch", "cwd": self.tmp, "transcript_path": transcript}, env
        )

    def _shared_setup(self, test_src):
        os.makedirs(os.path.join(self.tmp, "src"), exist_ok=True)
        with open(os.path.join(self.tmp, "src", "app.py"), "w") as f:
            f.write("x = 1\n")
        with open(os.path.join(self.tmp, "test_app.py"), "w") as f:
            f.write(test_src)
        self._log_run_write(os.path.join(self.tmp, "src", "app.py"))

    def test_green_rerun_clears_paperwork_letters(self):
        self._shared_setup(PASSING)
        before = self._run("")  # no transcript: nothing to re-run, paperwork letters block
        self.assertIn("(a)", before.stdout)
        self.assertIn("Shortcut: the gate re-runs", before.stdout)
        r = self._run(self._transcript())
        for letter in ("(a)", "(b)", "(g)", "(k)", "(m)"):
            self.assertNotIn(f"\\n  {letter}", r.stdout, r.stdout)
        self.assertTrue(os.path.isfile(os.path.join(self.tmp, ".atlas", ".run", "gate-proof.json")))
        # docs letters (c)(d)(e) are not paperwork: a missing CHANGELOG still blocks
        self.assertIn("\\n  (c)", r.stdout)

    def test_red_rerun_blocks_with_gate_output(self):
        self._shared_setup(FAILING)
        r = self._run(self._transcript())
        self.assertIn('"decision": "block"', r.stdout)
        self.assertIn("The gate re-ran `python3 -m pytest -q -p no:cacheprovider`", r.stdout)
        self.assertFalse(os.path.isfile(os.path.join(self.tmp, ".atlas", ".run", "gate-proof.json")))

    def test_kill_switch_restores_old_behavior(self):
        self._shared_setup(PASSING)
        env = dict(self.env, ATLAS_GATE_RERUN="off", ATLAS_GATE_COLONY="off")
        r = _run_gate(
            {"session_id": "sess-orch", "cwd": self.tmp, "transcript_path": self._transcript()}, env
        )
        self.assertIn("(a)", r.stdout)
        self.assertFalse(os.path.isfile(os.path.join(self.tmp, ".atlas", ".run", "gate-proof.json")))


if __name__ == "__main__":
    unittest.main()
