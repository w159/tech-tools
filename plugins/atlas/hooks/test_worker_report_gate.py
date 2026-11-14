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


def _run_entry_with_broken_core(entry, hook):
    """Copy the thin entry `entry` beside a core module that raises on import
    (the real scripts/ dir symlinked next to it) and run it as Claude Code
    does. Returns (completed process, hook-faults rows)."""
    import shutil

    tmp = tempfile.mkdtemp()
    try:
        hooks = os.path.join(tmp, "hooks")
        os.makedirs(hooks)
        shutil.copy(entry, hooks)
        name = os.path.splitext(os.path.basename(entry))[0]
        with open(os.path.join(hooks, name + "_core.py"), "w") as f:
            f.write("raise ImportError('core boom')\n")
        os.symlink(
            os.path.realpath(os.path.join(os.path.dirname(entry), "..", "scripts")),
            os.path.join(tmp, "scripts"),
        )
        home = os.path.join(tmp, "home")
        env = dict(os.environ, ATLAS_HOME=home, ATLAS_HOOKSTATE_DIR=os.path.join(tmp, "hs"))
        r = subprocess.run(
            [sys.executable, "-S", os.path.join(hooks, os.path.basename(entry))],
            input=json.dumps({"session_id": "s", "hook_event_name": hook}),
            capture_output=True,
            text=True,
            env=env,
        )
        rows = []
        faults = os.path.join(home, "hook-faults.jsonl")
        if os.path.exists(faults):
            with open(faults) as f:
                rows = [json.loads(line) for line in f if line.strip()]
        return r, rows
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

class EntryImportCrashTest(unittest.TestCase):
    def test_core_import_crash_is_a_visible_fail_open(self):
        r, rows = _run_entry_with_broken_core(HOOK, "SubagentStop")
        self.assertEqual(r.returncode, 0, r.stderr)
        doc = json.loads(r.stdout)
        self.assertNotIn("decision", doc)
        self.assertIn("FAIL-OPEN", doc["systemMessage"])
        self.assertEqual([x["hook"] for x in rows], ["worker_report_gate"])


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

    def test_stop_marks_known_member_finished(self):
        sys.path.insert(0, os.path.join(os.path.dirname(HOOK), "..", "scripts"))
        import atlas_todo as todo

        root = os.path.realpath(tempfile.mkdtemp(dir=WORK))
        subprocess.run(["git", "-C", root, "init", "-q"], check=True)
        todo.open_lead_channel(root, "lead-x", ["impl-1"])
        self.run_hook(
            payload(
                agent_name="impl-1",
                agent_type="atlas:implementer",
                cwd=root,
                last_assistant_message=COMPLIANT,
            )
        )
        mem = [
            m
            for c in todo._reg_read(root)["channels"].values()
            for m in c["members"]
            if m["name"] == "impl-1"
        ]
        self.assertEqual([m.get("exit_code") for m in mem], [0])

    def _board_item_after(self, msg):
        sys.path.insert(0, os.path.join(os.path.dirname(HOOK), "..", "scripts"))
        import atlas_todo as todo

        root = os.path.realpath(tempfile.mkdtemp(dir=WORK))
        subprocess.run(["git", "-C", root, "init", "-q"], check=True)
        todo.open_lead_channel(root, "lead-x", ["impl-1"])
        todo.add(root, "do it", owner="impl-1", origin="dispatch")
        self.run_hook(
            payload(
                agent_name="impl-1",
                agent_type="atlas:implementer",
                cwd=root,
                last_assistant_message=msg,
            )
        )
        return todo.load(root)["items"][0]

    def test_done_report_completes_board_item_with_evidence(self):
        item = self._board_item_after(COMPLIANT)
        self.assertEqual(item["status"], "completed")
        self.assertIn("ls -> ok", item["evidence"])

    def test_blocked_report_marks_board_item_blocked(self):
        msg = COMPLIANT.replace("STATUS: DONE", "STATUS: BLOCKED")
        self.assertEqual(self._board_item_after(msg)["status"], "blocked")

    def test_done_report_closes_lead_made_board_item_by_recorded_id(self):
        # A lead-written CHANNEL: prompt skips the owned dispatch todo; the lead's own item
        # (no owner) is named by `BOARD ITEM: <id>` in the prompt, recorded on the member.
        sys.path.insert(0, os.path.join(os.path.dirname(HOOK), "..", "scripts"))
        import atlas_todo as todo

        root = os.path.realpath(tempfile.mkdtemp(dir=WORK))
        subprocess.run(["git", "-C", root, "init", "-q"], check=True)
        todo.open_lead_channel(root, "lead-x", ["runner-1"])
        item = todo.add(root, "lead made", origin="manual")["item"]
        todo.set_member_agent_id(root, "runner-1", "abc123abc123", item["id"])
        self.run_hook(
            payload(
                agent_id="abc123abc123",
                agent_type="atlas:runner",
                cwd=root,
                last_assistant_message=COMPLIANT,
            )
        )
        self.assertEqual(todo.load(root)["items"][0]["status"], "completed")

    def _retry_after_block(self, retry_msg):
        # Live runs (critique 6, S1): the first stop is blocked for a malformed report; the
        # agent's retry stop arrives with stop_hook_active=true and used to return before it
        # settled the member, leaving the dispatch row pending forever.
        sys.path.insert(0, os.path.join(os.path.dirname(HOOK), "..", "scripts"))
        import atlas_todo as todo

        root = os.path.realpath(tempfile.mkdtemp(dir=WORK))
        subprocess.run(["git", "-C", root, "init", "-q"], check=True)
        todo.open_lead_channel(root, "lead-x", ["alpha-explorer"])
        todo.add(root, "read alpha", owner="alpha-explorer", origin="dispatch")
        todo.set_member_agent_id(root, "alpha-explorer", "a85313f7b04ba678f")
        base = dict(agent_id="a85313f7b04ba678f", agent_type="atlas:explorer", cwd=root)
        first = self.run_hook(
            payload(last_assistant_message="prose, no container", **base)
        )
        self.assertIn('"decision": "block"', first.stdout)
        self.assertEqual(todo.load(root)["items"][0]["status"], "pending")
        self.run_hook(
            payload(stop_hook_active=True, last_assistant_message=retry_msg, **base)
        )
        mem = [
            m
            for c in todo._reg_read(root)["channels"].values()
            for m in c["members"]
            if m["name"] == "alpha-explorer"
        ]
        return todo.load(root)["items"][0], mem

    def test_retry_stop_with_valid_report_completes_dispatch_row(self):
        item, mem = self._retry_after_block(COMPLIANT)
        self.assertEqual(item["status"], "completed")
        self.assertEqual([m.get("exit_code") for m in mem], [0])

    def test_retry_stop_with_bad_report_still_settles_dispatch_row(self):
        item, mem = self._retry_after_block("still prose")
        self.assertEqual(item["status"], "blocked")
        self.assertEqual([m.get("exit_code") for m in mem], [0])

    def _handback_then_stop(self, report, closing=""):
        """SubagentHandback delivers the report as the tool call's `message`
        input (Claude Code hooks docs, SubagentStop); `last_assistant_message`
        then holds only the closing text. Returns (stop stdout, board item)."""
        sys.path.insert(0, os.path.join(os.path.dirname(HOOK), "..", "scripts"))
        import atlas_todo as todo

        root = os.path.realpath(tempfile.mkdtemp(dir=WORK))
        subprocess.run(["git", "-C", root, "init", "-q"], check=True)
        todo.open_lead_channel(root, "lead-x", ["impl-1"])
        todo.add(root, "do it", owner="impl-1", origin="dispatch")
        todo.set_member_agent_id(root, "impl-1", "hb0123456789")
        base = dict(agent_id="hb0123456789", agent_type="atlas:implementer", cwd=root)
        post = self.run_hook(
            dict(
                base,
                hook_event_name="PostToolUse",
                tool_name="SubagentHandback",
                tool_input={"message": report},
                tool_response={},
            )
        )
        self.assertEqual(post.stdout, "")
        stop = self.run_hook(payload(last_assistant_message=closing, **base))
        return stop.stdout, todo.load(root)["items"][0]

    def test_handback_report_with_empty_last_message_settles_done(self):
        out, item = self._handback_then_stop(COMPLIANT)
        self.assertEqual(out, "")
        self.assertEqual(item["status"], "completed")
        self.assertIn("ls -> ok", item["evidence"])

    def test_handback_report_wins_over_closing_text(self):
        out, item = self._handback_then_stop(COMPLIANT, closing="Report delivered.")
        self.assertEqual(out, "")
        self.assertEqual(item["status"], "completed")

    def test_handback_report_missing_labels_still_blocks(self):
        out, item = self._handback_then_stop("STATUS: DONE\nall good, trust me")
        self.assertIn('"decision": "block"', out)
        self.assertIn("missing labels", out)
        self.assertEqual(item["status"], "pending")

    def test_hooks_json_routes_subagent_handback_to_this_gate(self):
        """The handback store only runs when hooks.json matches PostToolUse on
        SubagentHandback to worker_report_gate.py."""
        import re

        with open(os.path.join(os.path.dirname(HOOK), "hooks.json")) as f:
            groups = json.load(f)["hooks"]["PostToolUse"]
        routed = [
            h["command"]
            for g in groups
            if re.fullmatch(g.get("matcher") or ".*", "SubagentHandback")
            for h in g["hooks"]
            if "worker_report_gate.py" in h["command"]
        ]
        self.assertEqual(len(routed), 1, groups)

    def test_member_finish_cli_with_done_report_reaps_like_claude(self):
        # omp path: `member-finish --message <final text>` settles item and member.
        sys.path.insert(0, os.path.join(os.path.dirname(HOOK), "..", "scripts"))
        import atlas_todo as todo

        root = os.path.realpath(tempfile.mkdtemp(dir=WORK))
        subprocess.run(["git", "-C", root, "init", "-q"], check=True)
        todo.open_lead_channel(root, "lead-x", ["Alpha"])
        todo.add(root, "do it", owner="Alpha", origin="dispatch")
        subprocess.run(
            [
                sys.executable,
                os.path.join(os.path.dirname(HOOK), "..", "scripts", "atlas_todo.py"),
                "member-finish",
                "--root",
                root,
                "--agent",
                "0-Alpha",
                "--exit",
                "0",
                "--message",
                COMPLIANT,
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(todo.load(root)["items"][0]["status"], "completed")

    def test_member_finish_without_report_archives_dispatch_item(self):
        # omp session_stop passes no final text: the worker's manual dispatch item must not stay pending.
        sys.path.insert(0, os.path.join(os.path.dirname(HOOK), "..", "scripts"))
        import atlas_todo as todo

        root = os.path.realpath(tempfile.mkdtemp(dir=WORK))
        subprocess.run(["git", "-C", root, "init", "-q"], check=True)
        todo.open_lead_channel(root, "lead-x", ["Alpha"])
        todo.add(root, "do it", owner="Alpha", origin="manual")
        subprocess.run(
            [
                sys.executable,
                os.path.join(os.path.dirname(HOOK), "..", "scripts", "atlas_todo.py"),
                "member-finish",
                "--root",
                root,
                "--agent",
                "0-Alpha",
                "--exit",
                "0",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        item = todo.load(root)["items"][0]
        self.assertFalse(item.get("archived"))
        self.assertEqual(item["status"], "blocked")
        self.assertIn("no final report", item["evidence"])

    def test_stop_with_only_agent_id_finishes_mapped_member(self):
        # Claude's SubagentStop carries agent_id + agent_type, never the member name.
        sys.path.insert(0, os.path.join(os.path.dirname(HOOK), "..", "scripts"))
        import atlas_todo as todo

        root = os.path.realpath(tempfile.mkdtemp(dir=WORK))
        subprocess.run(["git", "-C", root, "init", "-q"], check=True)
        todo.open_lead_channel(root, "lead-x", ["impl-1"])
        todo.set_member_agent_id(root, "impl-1", "a41e91e5560395790")
        self.run_hook(
            payload(
                agent_id="a41e91e5560395790",
                agent_type="atlas:implementer",
                cwd=root,
                last_assistant_message=COMPLIANT,
            )
        )
        mem = [
            m
            for c in todo._reg_read(root)["channels"].values()
            for m in c["members"]
            if m["name"] == "impl-1"
        ]
        self.assertEqual([m.get("exit_code") for m in mem], [0])

    def test_stop_without_last_message_still_finishes_member(self):
        # Real Claude SubagentStop of a background atlas:explorer: no
        # last_assistant_message key at all (keys: agent_id, agent_type, ...).
        sys.path.insert(0, os.path.join(os.path.dirname(HOOK), "..", "scripts"))
        import atlas_todo as todo

        root = os.path.realpath(tempfile.mkdtemp(dir=WORK))
        subprocess.run(["git", "-C", root, "init", "-q"], check=True)
        todo.open_lead_channel(root, "lead-x", ["explorer-ab12"])
        todo.set_member_agent_id(root, "explorer-ab12", "aae39746167210093")
        p = payload(agent_id="aae39746167210093", agent_type="atlas:explorer", cwd=root)
        del p["last_assistant_message"]
        self.run_hook(p)
        mem = [
            m
            for c in todo._reg_read(root)["channels"].values()
            for m in c["members"]
            if m["name"] == "explorer-ab12"
        ]
        self.assertEqual([m.get("exit_code") for m in mem], [0])
        self.assertTrue(all("ended_at" in m for m in mem))

    def _stop_unmapped(self, names, agent_type="atlas:implementer"):
        # SubagentStop with no recorded agent_id mapping and no report (async launch).
        sys.path.insert(0, os.path.join(os.path.dirname(HOOK), "..", "scripts"))
        import atlas_todo as todo

        root = os.path.realpath(tempfile.mkdtemp(dir=WORK))
        subprocess.run(["git", "-C", root, "init", "-q"], check=True)
        todo.open_lead_channel(root, "lead-x", names)
        p = payload(agent_id="zzz999", agent_type=agent_type, cwd=root)
        del p["last_assistant_message"]
        self.run_hook(p)
        return {
            m["name"]: m
            for c in todo._reg_read(root)["channels"].values()
            for m in c["members"]
        }

    def test_stop_without_id_map_finishes_single_type_match(self):
        mem = self._stop_unmapped(["implementer-doctorwiring", "explorer-x"])
        self.assertEqual(mem["implementer-doctorwiring"].get("exit_code"), 0)
        self.assertIn("ended_at", mem["implementer-doctorwiring"])
        self.assertNotIn("exit_code", mem["explorer-x"])

    def test_stop_without_id_map_ambiguous_is_noop(self):
        mem = self._stop_unmapped(["implementer-a", "implementer-b"])
        self.assertTrue(
            all(
                "exit_code" not in m
                for m in mem.values()
                if m["name"].startswith("impl")
            )
        )

    def test_stop_unmapped_slice_role_name_closes_dispatch_row(self):
        # Live run 150-74d8931b-1: members are named "<slice>-<role>" (gamma-explorer), the
        # launch recorded no agent_id for gamma, and its dispatch row stayed pending so Stop
        # reported "1 open todo item(s)" while the Board showed everything done.
        sys.path.insert(0, os.path.join(os.path.dirname(HOOK), "..", "scripts"))
        import atlas_todo as todo

        root = os.path.realpath(tempfile.mkdtemp(dir=WORK))
        subprocess.run(["git", "-C", root, "init", "-q"], check=True)
        names = ["alpha-explorer", "beta-explorer", "gamma-explorer"]
        todo.open_lead_channel(root, "lead-x", names)
        todo.set_member_agent_id(root, "alpha-explorer", "a188a2adce5415989")
        todo.set_member_agent_id(root, "beta-explorer", "a3010d2acc018187c")
        for n in names:
            todo.add(root, "read " + n, owner=n, origin="dispatch")
        p = payload(
            agent_id="aeccb696744ff698f",
            agent_type="atlas:explorer",
            cwd=root,
            last_assistant_message=COMPLIANT,
        )
        self.run_hook(p)
        rows = {i["owner"]: i["status"] for i in todo.load(root)["items"]}
        self.assertEqual(rows["gamma-explorer"], "completed")
        mem = {
            m["name"]: m
            for c in todo._reg_read(root)["channels"].values()
            for m in c["members"]
        }
        self.assertEqual(mem["gamma-explorer"].get("exit_code"), 0)
        self.assertNotIn("exit_code", mem["alpha-explorer"])

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

    def test_missing_agent_id_does_not_share_one_marker(self):
        # Without an agent_id every agent used to share the "unknown" marker, so only the
        # first malformed report was ever blocked.
        p1 = payload(last_assistant_message="prose")
        p2 = payload(last_assistant_message="prose2", agent_type="atlas:y")
        del p1["agent_id"], p2["agent_id"]
        self.assertNotEqual(self.run_hook(p1).stdout, "")
        self.assertNotEqual(self.run_hook(p2).stdout, "")
        self.assertEqual(self.run_hook(p1).stdout, "")

    def test_done_with_failing_test_evidence_blocks(self):
        bad = COMPLIANT.replace("1. ls -> ok", "1. pytest -> 5 failed, 2 passed")
        self.assertIn(
            "failing", self.run_hook(payload(last_assistant_message=bad)).stdout
        )
        ok = COMPLIANT.replace("1. ls -> ok", "1. pytest -> 7 passed, 0 failed")
        self.assertEqual(self.run_hook(payload(last_assistant_message=ok)).stdout, "")

    def test_done_red_then_green_passes_final_failed_rejects(self):
        red_green = COMPLIANT.replace(
            "1. ls -> ok",
            "1. pytest before fix -> 4 failed, 19 passed\n2. pytest after fix -> 23 passed",
        )
        self.assertEqual(
            self.run_hook(payload(last_assistant_message=red_green)).stdout, ""
        )
        green_red = COMPLIANT.replace(
            "1. ls -> ok", "1. pytest -> 23 passed\n2. pytest again -> 3 failed"
        )
        self.assertIn(
            "failing", self.run_hook(payload(last_assistant_message=green_red)).stdout
        )

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

    def test_resolved_or_zero_failure_phrases_do_not_block(self):
        for ev in [
            "1. ruff check --fix -> Found 3 errors (3 fixed, 0 remaining).",
            "1. lint -> errors-free",
            "1. tsc -> no errors",
            "1. pytest -> 12 passed, 0 failed",
        ]:
            with self.subTest(ev=ev):
                self.assertFalse(self.blocked(self.report(evidence=ev)))

    def test_real_failure_phrases_still_block(self):
        for ev in [
            "1. pytest -> 2 failed, 5 passed",
            "1. pytest -> FAILED",
            "1. tsc -> Error: cannot find module",
            "1. tsc -> 3 errors",
            "1. ruff check -> Found 3 errors (1 fixed, 2 remaining).",
        ]:
            with self.subTest(ev=ev):
                self.assertTrue(self.blocked(self.report(evidence=ev)))

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
        # Private fault log: the process-global ATLAS_HOME is shared by every test in this worker, and an int cwd
        # does not crash the hook (os.path.isdir(123) is just False), so this test used to pass only when an
        # earlier test happened to leave a worker_report_gate row there. A list cwd makes os.path.isdir raise
        # TypeError inside the objective check, which is the internal error under test.
        home = tempfile.mkdtemp(dir=self.gate)
        env = dict(self.env, ATLAS_HOME=home)
        r = self.run_hook(
            payload(
                last_assistant_message=msg,
                agent_type="atlas:implementer",
                cwd=["not", "a", "path"],
            ),
            env,
        )
        self.assertEqual((r.returncode, r.stdout), (0, ""))
        with open(os.path.join(home, "hook-faults.jsonl"), encoding="utf-8") as f:
            self.assertIn("worker_report_gate", f.read())


if __name__ == "__main__":
    unittest.main()
