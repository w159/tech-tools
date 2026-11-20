"""Stop-gate friction fixes: (m) outside orchestrated runs and (i) while a job runs."""
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import _test_isolation  # noqa: F401,E402
import completion_gate_core as cg  # noqa: E402

RUNNING_SHELL = [{"type": "shell", "status": "running"}]
DONE_SHELL = [{"type": "shell", "status": "completed"}]


class _Stdin:
    def __init__(self, raw):
        self.buffer = io.BytesIO(raw)


def _stop(tmp, orchestrating, patches, **extra):
    """Run cg._main() in-process with a Stop payload; return captured stdout."""
    import json

    (Path(tmp) / "docs").mkdir(exist_ok=True)
    payload = dict(session_id="s-fix", cwd=tmp, **extra)
    env = {
        "ATLAS_DB": os.path.join(tmp, "atlas.db"),
        "ATLAS_HOOKSTATE_DIR": os.path.join(tmp, "hs"),
        "ATLAS_CONTRACT_GATE_DIR": os.path.join(tmp, "mk"),
    }
    out = io.StringIO()
    with mock.patch.dict(os.environ, env), mock.patch.object(
        sys, "stdin", _Stdin(json.dumps(payload).encode())
    ), mock.patch.object(cg, "_session_is_orchestrating", return_value=orchestrating), \
        mock.patch.object(cg, "_has_in_flight_dispatch", return_value=False), \
        mock.patch.object(cg, "_done_claim_reason", return_value=""), \
        mock.patch.object(cg, "_decision_verify_reason", return_value=""), \
        mock.patch.object(cg, "_finalize_db"), \
        mock.patch.object(cg, "_record_gate_block"), \
        mock.patch.object(cg, "_record_analytics"), \
        mock.patch("sys.stdout", out):
        for name, val in patches.items():
            mock.patch.object(cg, name, val).start()
        try:
            cg._main()
        finally:
            mock.patch.stopall()
    return out.getvalue()


class DelegationProofTest(unittest.TestCase):
    """Fix 3a: (m) in a non-orchestrating session honors the gate's test proof."""

    def run_m(self, proof):
        with tempfile.TemporaryDirectory() as tmp:
            return _stop(
                tmp,
                False,
                {
                    "_delegation_state": lambda d, r: (True, ["src/a.py"], ""),
                    "_gate_proof": lambda *a, **k: proof,
                    "_run_paths_for": lambda s, r: ["src/a.py"],
                },
            )

    def test_valid_proof_clears_m(self):
        self.assertNotIn("block", self.run_m({"exit": 0}))

    def test_no_proof_still_blocks(self):
        out = self.run_m(None)
        self.assertIn("(m) Delegation mandate", out)

    def test_message_names_no_nonexistent_exit(self):
        self.assertNotIn("delegation exemption", self.run_m(None))


class OpenTodosWaitingTest(unittest.TestCase):
    """Fix 3b: (i) alone yields to a running shell/monitor job."""

    def run_i(self, failed, tasks):
        ev = {k: True for k in ("ok_a", "ok_b", "ok_c", "ok_d", "ok_e", "ok_h")}
        ev.update(
            failed=failed, drift=False, unverified=0, open_todos=2, missing_plan=False,
            worktrees=0, name_violations=[], header_failing=False, phases_missing=[],
            colony_failing=False, colony_workers=[], wt_unmerged=[],
            missing_delegation=False, started=None, proof=None,
        )
        with tempfile.TemporaryDirectory() as tmp:
            return _stop(
                tmp,
                True,
                {
                    "_delegation_state": lambda d, r: (False, [], ""),
                    "evaluate": lambda *a, **k: ev,
                },
                background_tasks=tasks,
            )

    def test_i_only_with_running_shell_passes(self):
        self.assertNotIn("block", self.run_i(["i"], RUNNING_SHELL))

    def test_i_only_without_background_task_blocks(self):
        self.assertIn("block", self.run_i(["i"], []))

    def test_i_plus_other_letter_blocks(self):
        self.assertIn("block", self.run_i(["i", "c"], RUNNING_SHELL))

    def test_terminal_shell_does_not_suppress(self):
        self.assertIn("block", self.run_i(["i"], DONE_SHELL))

    def test_monitor_counts(self):
        self.assertTrue(
            cg._has_running_background_job({"background_tasks": [{"type": "monitor"}]})
        )


if __name__ == "__main__":
    unittest.main()
