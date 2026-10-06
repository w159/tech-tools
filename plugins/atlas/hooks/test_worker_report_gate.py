import json
import os
import subprocess
import sys
import tempfile
import unittest

HOOK = os.path.join(os.path.dirname(__file__), "worker_report_gate.py")
WORK = os.path.expanduser("~/.cache/atlas-work/ReportGateHook")

COMPLIANT = (
    "STATUS: DONE\n"
    "STEPS: 3/3\n"
    "FILES_CHANGED: none\n"
    "EVIDENCE:\n1. ls -> ok\n"
    "DELIVERABLE: none\n"
    "NEXT: none"
)


def payload(**kw):
    p = {
        "hook_event_name": "SubagentStop",
        "agent_id": "a1",
        "agent_type": "atlas:runner",
        "stop_hook_active": False,
        "last_assistant_message": "all done",
    }
    p.update(kw)
    return p


class WorkerReportGateTest(unittest.TestCase):
    def setUp(self):
        os.makedirs(WORK, exist_ok=True)
        self.gate = tempfile.mkdtemp(dir=WORK)
        self.env = dict(os.environ, ATLAS_REPORT_GATE_DIR=self.gate)
        self.env.pop("ATLAS_GATE", None)
        self.env.pop("ATLAS_GATE_REPORT", None)

    def run_hook(self, raw, env=None):
        if not isinstance(raw, str):
            raw = json.dumps(raw)
        return subprocess.run(
            [sys.executable, HOOK],
            input=raw,
            capture_output=True,
            text=True,
            env=env or self.env,
        )

    def test_compliant_is_silent(self):
        r = self.run_hook(payload(last_assistant_message=COMPLIANT))
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout, "")

    def test_bad_first_line_blocks(self):
        msg = "Summary first\nSTATUS: DONE\nSTEPS: 1/1"
        r = self.run_hook(payload(last_assistant_message=msg))
        self.assertEqual(r.returncode, 0)
        out = json.loads(r.stdout)
        self.assertEqual(out["decision"], "block")
        for label in ("FILES_CHANGED", "EVIDENCE", "DELIVERABLE", "NEXT"):
            self.assertIn(label, out["reason"])
        self.assertIn("first line", out["reason"])

    def test_second_time_same_agent_silent(self):
        self.assertNotEqual(self.run_hook(payload()).stdout, "")
        self.assertEqual(self.run_hook(payload()).stdout, "")

    def test_other_agent_blocks_again(self):
        self.run_hook(payload())
        self.assertNotEqual(self.run_hook(payload(agent_id="a2")).stdout, "")

    def test_block_reason_is_one_line_format_correction(self):
        r = self.run_hook(payload())
        self.assertEqual(r.returncode, 0)
        reason = json.loads(r.stdout)["reason"]
        lead, _, template = reason.partition("\n\n")
        self.assertNotIn("\n", lead)
        self.assertIn("not the atlas report container", lead)
        for label in (
            "STATUS:",
            "STEPS:",
            "FILES_CHANGED:",
            "EVIDENCE:",
            "DELIVERABLE:",
            "NEXT:",
        ):
            self.assertIn(label, template)

    def test_stop_hook_active_silent(self):
        self.assertEqual(self.run_hook(payload(stop_hook_active=True)).stdout, "")

    def test_non_atlas_agent_silent(self):
        for t in ("Explore", "general-purpose"):
            self.assertEqual(self.run_hook(payload(agent_type=t)).stdout, "")

    def test_blank_message_silent(self):
        self.assertEqual(
            self.run_hook(payload(last_assistant_message="  \n ")).stdout, ""
        )

    def test_other_event_silent(self):
        self.assertEqual(self.run_hook(payload(hook_event_name="Stop")).stdout, "")

    def test_switch_off_silent(self):
        for var in ("ATLAS_GATE_REPORT", "ATLAS_GATE"):
            env = dict(self.env, **{var: "off"})
            self.assertEqual(self.run_hook(payload(), env).stdout, "")

    def test_malformed_stdin_silent(self):
        r = self.run_hook("{not json")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout, "")


if __name__ == "__main__":
    unittest.main()
