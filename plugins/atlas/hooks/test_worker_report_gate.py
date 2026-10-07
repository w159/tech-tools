import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(
    0,
    _iso_os.path.join(
        _iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"
    ),
)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
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

    # ---- objective checks beyond label presence ----

    def report(
        self,
        steps="2/2",
        files="none",
        evidence="1. pytest -q -> 5 passed",
        status="DONE",
    ):
        return (
            f"STATUS: {status}\nSTEPS: {steps}\nFILES_CHANGED: {files}\n"
            f"EVIDENCE:\n{evidence}\nDELIVERABLE: did it\nNEXT: none"
        )

    def blocked(self, msg, **kw):
        r = self.run_hook(
            payload(last_assistant_message=msg, agent_id=f"x-{abs(hash(msg))}", **kw)
        )
        self.assertEqual(r.returncode, 0)
        return r.stdout != ""

    def test_nonsense_done_blocks(self):
        # the audit probe: STEPS banana, empty EVIDENCE, DONE
        nonsense = "STATUS: DONE\nSTEPS: banana\nFILES_CHANGED: x\nEVIDENCE:\nDELIVERABLE:\nNEXT:"
        r = self.run_hook(payload(last_assistant_message=nonsense))
        out = json.loads(r.stdout)
        self.assertEqual(out["decision"], "block")
        self.assertIn("STEPS", out["reason"])
        self.assertIn("EVIDENCE", out["reason"])

    def test_steps_done_over_total_blocks(self):
        self.assertTrue(self.blocked(self.report(steps="9/3")))
        self.assertFalse(self.blocked(self.report(steps="3/3")))

    def test_done_with_empty_or_commandless_evidence_blocks(self):
        self.assertTrue(self.blocked(self.report(evidence="")))
        self.assertTrue(self.blocked(self.report(evidence="everything passed")))
        self.assertTrue(self.blocked(self.report(evidence="1. ran tests ->")))

    def test_evidence_with_output_on_following_lines_is_accepted(self):
        self.assertFalse(
            self.blocked(
                self.report(evidence="1. python3 -m pytest -q\n   5 passed in 0.2s")
            )
        )

    def test_failed_and_blocked_reports_need_no_evidence(self):
        for status in ("FAILED", "BLOCKED"):
            self.assertFalse(self.blocked(self.report(status=status, evidence="")))

    def test_genuine_implementer_report_is_accepted(self):
        real = os.path.join(self.gate, "real.py")
        open(real, "w").close()
        msg = self.report(files="real.py; ./real.py (new)")
        r = self.run_hook(
            payload(
                last_assistant_message=msg,
                agent_type="atlas:implementer",
                cwd=self.gate,
            )
        )
        self.assertEqual((r.returncode, r.stdout), (0, ""))

    def test_implementer_done_naming_a_file_that_never_existed_blocks(self):
        msg = self.report(files="src/never_touched.py")
        r = self.run_hook(
            payload(
                last_assistant_message=msg,
                agent_type="atlas:implementer",
                cwd=self.gate,
            )
        )
        out = json.loads(r.stdout)
        self.assertIn("src/never_touched.py", out["reason"])

    def test_globs_annotations_and_throwaways_are_not_checked(self):
        msg = self.report(
            files="omp/agents/*.md (regenerated); /tmp/atlas-gone-xyz.py (throwaway); old.py (deleted)"
        )
        r = self.run_hook(
            payload(
                last_assistant_message=msg,
                agent_type="atlas:implementer",
                cwd=self.gate,
            )
        )
        self.assertEqual(r.stdout, "")

    def test_file_deleted_in_the_tree_is_accepted_via_git_status(self):
        repo = os.path.join(self.gate, "repo")
        os.makedirs(repo)

        def git(*a):
            return subprocess.run(
                ["git", "-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", *a],
                check=True,
                capture_output=True,
            )

        git("init", "-q")
        open(os.path.join(repo, "gone.py"), "w").close()
        git("add", ".")
        git("commit", "-qm", "x")
        os.remove(os.path.join(repo, "gone.py"))
        msg = self.report(files="gone.py")
        r = self.run_hook(
            payload(
                last_assistant_message=msg, agent_type="atlas:implementer", cwd=repo
            )
        )
        self.assertEqual(r.stdout, "")
        # ...but a path git never saw is still caught
        r = self.run_hook(
            payload(
                last_assistant_message=self.report(files="ghost.py"),
                agent_type="atlas:implementer",
                cwd=repo,
                agent_id="a9",
            )
        )
        self.assertIn("ghost.py", json.loads(r.stdout)["reason"])

    def test_read_only_agents_files_changed_is_not_checked(self):
        msg = self.report(files=".atlas/.run/findings.json")
        r = self.run_hook(
            payload(
                last_assistant_message=msg, agent_type="atlas:verifier", cwd=self.gate
            )
        )
        self.assertEqual(r.stdout, "")

    def test_objective_check_internal_error_fails_open_with_a_fault_row(self):
        msg = self.report(files="a.py")
        r = self.run_hook(
            payload(last_assistant_message=msg, agent_type="atlas:implementer", cwd=123)
        )
        self.assertEqual((r.returncode, r.stdout), (0, ""))
        faults = os.path.join(os.environ["ATLAS_HOME"], "hook-faults.jsonl")
        with open(faults, encoding="utf-8") as f:
            self.assertIn("worker_report_gate", f.read())


if __name__ == "__main__":
    unittest.main()
