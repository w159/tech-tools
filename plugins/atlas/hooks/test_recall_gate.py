import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))

import recall_gate  # noqa: E402
from recall_gate import main  # noqa: E402

CONTRACT_PATH = os.path.join(os.path.dirname(__file__), "..", "contracts", "mandates.json")
with open(CONTRACT_PATH, encoding="utf-8") as _fh:
    CONTRACT = json.load(_fh)
CASES = CONTRACT["recallGateCases"]
CC_ROUTE = "mcp__plugin_claude-mem_mcp-search__search"
REASON = CONTRACT["recallGate"].replace("{route}", CC_ROUTE).replace("{example}", CONTRACT["recallGateExample"])


def _run_main(payload) -> tuple[int, str]:
    """Call main() in-process with mocked stdin; return (exit code, stdout)."""
    raw = payload if isinstance(payload, str) else json.dumps(payload)
    buf = io.StringIO()
    with patch("sys.stdin", new=io.StringIO(raw)), redirect_stdout(buf):
        code = main()
    return code, buf.getvalue()


def _denied(out: str) -> bool:
    if not out.strip():
        return False
    spec = json.loads(out)["hookSpecificOutput"]
    return spec["hookEventName"] == "PreToolUse" and spec["permissionDecision"] == "deny"


class RecallGateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._marker_dir = recall_gate.GATE_MARKER_DIR
        recall_gate.GATE_MARKER_DIR = self.tmp
        # hooks cannot see the callable set; the armed heuristic is "claude-mem plugin enabled"
        patcher = patch.object(recall_gate, "_claude_mem_enabled", return_value=True)
        patcher.start()
        self.addCleanup(patcher.stop)
        env = patch.dict(os.environ)
        env.start()
        os.environ.pop("ATLAS_MANDATES", None)
        self.addCleanup(env.stop)

    def tearDown(self):
        recall_gate.GATE_MARKER_DIR = self._marker_dir
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _payload(self, case, session_id="sess-recall-1", **extra):
        payload = {
            "session_id": session_id,
            "hook_event_name": "PreToolUse",
            "tool_name": case["name"],
            "tool_input": case["input"],
            "transcript_path": "/home/u/.claude/projects/p/%s.jsonl" % session_id,
            "cwd": "/tmp/proj",
        }
        payload.update(extra)
        return payload

    def _markers(self):
        return sorted(os.listdir(self.tmp))

    def test_every_non_claude_mem_call_is_denied_until_a_real_recall(self):
        self.assertTrue(CASES["block"])
        for i, case in enumerate(CASES["block"]):
            sid = "block-%d" % i
            for attempt in range(3):  # ignoring a denial never satisfies the gate
                code, out = _run_main(self._payload(case, session_id=sid))
                self.assertEqual(code, 0)
                self.assertTrue(_denied(out), "%s attempt %d" % (case["name"], attempt))
                self.assertEqual(
                    json.loads(out)["hookSpecificOutput"]["permissionDecisionReason"], REASON
                )
            self.assertEqual(self._markers(), [], "a denial must never write the satisfied marker")

    def test_only_a_claude_mem_call_satisfies_then_later_calls_pass(self):
        case = CASES["block"][0]
        sid = "ignore-then-recall"
        self.assertTrue(_denied(_run_main(self._payload(case, session_id=sid))[1]))
        self.assertTrue(_denied(_run_main(self._payload(case, session_id=sid))[1]))
        recall = CASES["satisfy"][0]
        self.assertEqual(_run_main(self._payload(recall, session_id=sid)), (0, ""))
        self.assertEqual(self._markers(), ["recall-%s" % sid])
        self.assertEqual(_run_main(self._payload(case, session_id=sid)), (0, ""))

    def test_reason_names_the_claude_mem_route_and_an_example(self):
        self.assertIn(CC_ROUTE, REASON)
        self.assertIn('"query"', REASON)
        self.assertNotRegex(REASON, r"\{(route|example)\}")

    def test_claude_mem_call_satisfies_silently_and_later_calls_pass(self):
        self.assertTrue(CASES["satisfy"])
        for i, case in enumerate(CASES["satisfy"]):
            sid = "satisfy-%d" % i
            self.assertEqual(_run_main(self._payload(case, session_id=sid)), (0, ""), case["name"])
            later = CASES["block"][0]
            self.assertEqual(_run_main(self._payload(later, session_id=sid)), (0, ""), case["name"])

    def test_claude_code_write_names_its_path_file_path(self):
        case = {
            "name": "Write",
            "input": {"file_path": "xd://mcp__claude_mem_mcp_search_search", "content": "{}"},
        }
        self.assertEqual(_run_main(self._payload(case, session_id="fp")), (0, ""))
        self.assertEqual(_run_main(self._payload(CASES["block"][0], session_id="fp")), (0, ""))

    def test_a_write_to_a_real_path_is_not_a_recall(self):
        case = {"name": "Write", "input": {"file_path": "/tmp/xd://mcp__claude_mem.txt"}}
        code, out = _run_main(self._payload(case, session_id="realpath"))
        self.assertTrue(_denied(out))

    def test_todo_is_exempt_and_leaves_the_gate_armed(self):
        self.assertTrue(CASES["exempt"])
        for i, case in enumerate(CASES["exempt"]):
            sid = "exempt-%d" % i
            self.assertEqual(_run_main(self._payload(case, session_id=sid)), (0, ""))
            self.assertEqual(self._markers(), [], "an exempt call must not consume the gate")
            code, out = _run_main(self._payload(CASES["block"][0], session_id=sid))
            self.assertTrue(_denied(out))

    def test_sessions_are_independent(self):
        case = CASES["block"][0]
        self.assertTrue(_denied(_run_main(self._payload(case, session_id="one"))[1]))
        self.assertTrue(_denied(_run_main(self._payload(case, session_id="two"))[1]))
        self.assertEqual(_run_main(self._payload(CASES["satisfy"][0], session_id="one")), (0, ""))
        self.assertEqual(_run_main(self._payload(case, session_id="one")), (0, ""))
        self.assertTrue(_denied(_run_main(self._payload(case, session_id="two"))[1]))  # two still unsatisfied
        self.assertEqual(self._markers(), ["recall-one"])

    def test_subagent_transcripts_are_skipped_and_leave_the_main_gate_intact(self):
        case = CASES["block"][0]
        sub = self._payload(
            case,
            session_id="parent",
            transcript_path="/home/u/.claude/projects/p/parent/subagents/agent-1.jsonl",
        )
        self.assertEqual(_run_main(sub), (0, ""))
        self.assertEqual(self._markers(), [])
        self.assertTrue(_denied(_run_main(self._payload(case, session_id="parent"))[1]))

    def test_a_subagent_sharing_the_session_never_re_arms_a_satisfied_gate(self):
        # Claude Code subagents report the PARENT's session_id; the "*" PreToolUse matcher
        # fires for them too. State is keyed by session id, so once the main thread recalled,
        # every subagent call in that session sees the satisfied marker (and is skipped anyway).
        case = CASES["block"][0]
        self.assertEqual(_run_main(self._payload(CASES["satisfy"][0], session_id="shared")), (0, ""))
        for n in range(3):
            sub = self._payload(
                case,
                session_id="shared",
                transcript_path="/home/u/.claude/projects/p/shared/subagents/agent-%d.jsonl" % n,
            )
            self.assertEqual(_run_main(sub), (0, ""))
        self.assertEqual(_run_main(self._payload(case, session_id="shared")), (0, ""))
        self.assertEqual(self._markers(), ["recall-shared"])

    def test_a_subagent_with_its_own_session_is_gated_like_a_main_thread(self):
        # Policy: the gate keys on session_id. A subagent that runs under its OWN session id
        # (no /subagents/ transcript) has no marker, so it must recall once itself; the
        # parent's satisfied marker does not leak to it.
        case = CASES["block"][0]
        self.assertEqual(_run_main(self._payload(CASES["satisfy"][0], session_id="parent-s")), (0, ""))
        own = self._payload(case, session_id="child-own-session")
        self.assertTrue(_denied(_run_main(own)[1]))
        self.assertEqual(_run_main(self._payload(CASES["satisfy"][0], session_id="child-own-session")), (0, ""))
        self.assertEqual(_run_main(own), (0, ""))

    def test_unarmed_states_never_deny_or_leave_a_marker(self):
        case = CASES["block"][0]
        with patch.dict(os.environ, {"ATLAS_MANDATES": "off"}):
            self.assertEqual(_run_main(self._payload(case)), (0, ""))
        with patch.dict(os.environ, {"ATLAS_MANDATES": "Off"}):  # exact "off", as in omp
            self.assertTrue(_denied(_run_main(self._payload(case, session_id="caps"))[1]))
        with patch.object(recall_gate, "_claude_mem_enabled", return_value=False):
            self.assertEqual(_run_main(self._payload(case, session_id="noplugin")), (0, ""))
        self.assertEqual(_run_main(self._payload(case, session_id="")), (0, ""))
        no_sid = self._payload(case)
        del no_sid["session_id"]
        self.assertEqual(_run_main(no_sid), (0, ""))
        self.assertEqual(self._markers(), [])

    def test_contract_without_recall_gate_fields_fails_open(self):
        path = os.path.join(self.tmp, "m.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"commitNudge": "n", "recall": "r"}, fh)
        with patch.object(recall_gate, "MANDATES_PATH", path):
            self.assertEqual(_run_main(self._payload(CASES["block"][0], session_id="nofield")), (0, ""))
        with patch.object(recall_gate, "MANDATES_PATH", os.path.join(self.tmp, "absent.json")):
            self.assertEqual(_run_main(self._payload(CASES["block"][0], session_id="absent")), (0, ""))
        self.assertEqual([m for m in self._markers() if m.endswith(("nofield", "absent"))], [])

    def test_internal_errors_fail_open(self):
        with patch.object(recall_gate, "_claude_mem_enabled", side_effect=RuntimeError("boom")):
            self.assertEqual(_run_main(self._payload(CASES["block"][0], session_id="boom")), (0, ""))
        with patch.object(recall_gate, "GATE_MARKER_DIR", os.path.join(self.tmp, "file")):
            open(os.path.join(self.tmp, "file"), "w").close()  # a file where the marker dir should be
            # the recall path writes the marker: a failure there fails open (no deny, no crash)
            self.assertEqual(_run_main(self._payload(CASES["satisfy"][0], session_id="nodir")), (0, ""))
            # a denial needs no state, so a broken marker dir does not disarm the gate
            self.assertTrue(_denied(_run_main(self._payload(CASES["block"][0], session_id="nodir2"))[1]))

    def test_garbage_stdin_is_silent(self):
        for raw in ("", "not json{{{", "[1,2,3]", "null", "{}", '{"tool_name": 7, "session_id": 7}'):
            self.assertEqual(_run_main(raw), (0, ""), raw)


if __name__ == "__main__":
    unittest.main()
