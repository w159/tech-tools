import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(
    0,
    _iso_os.path.join(
        _iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"
    ),
)
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)

sys.path.insert(0, os.path.dirname(__file__))

import recall_gate  # noqa: E402
from recall_gate import main  # noqa: E402

CONTRACT_PATH = os.path.join(
    os.path.dirname(__file__), "..", "contracts", "mandates.json"
)
with open(CONTRACT_PATH, encoding="utf-8") as _fh:
    CONTRACT = json.load(_fh)
CASES = CONTRACT["recallGateCases"]
CC_ROUTE = "mcp__plugin_claude-mem_mcp-search__search"
REASON = (
    CONTRACT["recallGate"]
    .replace("{route}", CC_ROUTE)
    .replace("{example}", CONTRACT["recallGateExample"])
)
# Fixtures use throwaway temp dirs as cwd, where the scope check leaves gates unarmed.
os.environ.setdefault("ATLAS_GATES", "always")


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
    return (
        spec["hookEventName"] == "PreToolUse" and spec["permissionDecision"] == "deny"
    )


_REAL_MOUNTED = recall_gate._mem_server_mounted


class RecallGateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._marker_dir = recall_gate.GATE_MARKER_DIR
        recall_gate.GATE_MARKER_DIR = self.tmp
        # hooks cannot see the callable set; the armed heuristic is "claude-mem plugin enabled"
        patcher = patch.object(recall_gate, "_claude_mem_enabled", return_value=True)
        patcher.start()
        self.addCleanup(patcher.stop)
        mounted = patch.object(recall_gate, "_mem_server_mounted", return_value=True)
        mounted.start()
        self.addCleanup(mounted.stop)
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
            "transcript_path": f"/home/u/.claude/projects/p/{session_id}.jsonl",
            "cwd": self.tmp,
        }
        payload.update(extra)
        return payload

    def _markers(self):
        return sorted(m for m in os.listdir(self.tmp) if m.startswith("recall-"))

    def test_every_non_recall_call_is_denied_until_the_recall(self):
        self.assertTrue(CASES["block"])
        for i, case in enumerate(CASES["block"]):
            sid = f"block-{i}"
            for attempt in range(
                4
            ):  # denied on EVERY attempt, never fail-open after one
                code, out = _run_main(self._payload(case, session_id=sid))
                self.assertEqual(code, 0)
                self.assertTrue(_denied(out), (case["name"], attempt))
                self.assertEqual(
                    json.loads(out)["hookSpecificOutput"]["permissionDecisionReason"],
                    REASON,
                )
                self.assertEqual(
                    self._markers(),
                    [],
                    "a denial must never write the satisfied marker",
                )

    def test_scripted_sequences_match_the_contract(self):
        sat, blk, ex = CASES["satisfy"][0], CASES["block"][0], CASES["exempt"][0]
        tool_search = {"name": "ToolSearch", "input": {"query": "select:x"}}
        sub = {"transcript_path": "/h/.claude/projects/p/s/subagents/a.jsonl"}
        agent = {"agent_id": "agent-7"}
        D, A = True, False
        seqs = [  # (case, extra payload, denied?)
            [(blk, {}, D), (blk, {}, D), (sat, {}, A), (blk, {}, A), (blk, {}, A)],
            [(tool_search, {}, A), (blk, {}, D), (tool_search, {}, A), (blk, {}, D)],
            [
                (ex, {}, A),
                (blk, {}, D),
                (ex, {}, A),
                (blk, {}, D),
                (sat, {}, A),
                (ex, {}, A),
            ],
            [(blk, sub, A), (blk, agent, A), (blk, {}, D), (blk, sub, A), (blk, {}, D)],
            [(sat, {}, A), (sat, {}, A), (blk, {}, A)],
            [
                (CASES["satisfy"][3], {}, A),
                (blk, {}, A),
            ],  # Write to an xd:// claude-mem device
            [
                (CASES["block"][2], {}, D),
                (CASES["block"][3], {}, D),
                (CASES["block"][1], {}, D),
                (sat, {}, A),
                (CASES["block"][3], {}, A),
            ],
            [(blk, {}, D), (tool_search, agent, A), (blk, {}, D)],
        ]
        for n, seq in enumerate(seqs):
            sid = f"seq-{n}"
            for step, (case, extra, want) in enumerate(seq):
                _, out = _run_main(self._payload(case, session_id=sid, **extra))
                self.assertEqual(_denied(out), want, (n, step, case["name"]))

    def test_no_recall_tool_mounted_allows_and_traces_once_per_session(self):
        faults_home = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, faults_home, True)
        with (
            patch.dict(os.environ, {"ATLAS_HOME": faults_home}),
            patch.object(recall_gate, "_mem_server_mounted", return_value=False),
        ):
            for _ in range(3):
                self.assertEqual(
                    _run_main(self._payload(CASES["block"][0], session_id="down")),
                    (0, ""),
                )
            with open(
                os.path.join(faults_home, "hook-faults.jsonl"), encoding="utf-8"
            ) as fh:
                lines = [json.loads(x) for x in fh if x.strip()]
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0]["hook"], "recall_gate")
        self.assertIn("no recall tool mounted", lines[0]["error"])
        self.assertEqual(self._markers(), [])

    def test_unwritable_marker_dir_fails_open_instead_of_deadlocking(self):
        faults_home = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, faults_home, True)
        ro = os.path.join(self.tmp, "ro")
        os.makedirs(ro)
        os.chmod(ro, 0o500)
        self.addCleanup(lambda: os.path.isdir(ro) and os.chmod(ro, 0o700))
        with (
            patch.dict(os.environ, {"ATLAS_HOME": faults_home}),
            patch.object(recall_gate, "GATE_MARKER_DIR", ro),
        ):
            if os.access(ro, os.W_OK):
                self.skipTest("running as a user that ignores directory modes")
            self.assertEqual(
                _run_main(self._payload(CASES["block"][0], session_id="ro")), (0, "")
            )
            with open(
                os.path.join(faults_home, "hook-faults.jsonl"), encoding="utf-8"
            ) as fh:
                self.assertIn("not writable", fh.read())

    def test_server_absent_allows(self):
        with patch.object(recall_gate, "_mem_server_mounted", return_value=False):
            code, out = _run_main(self._payload(CASES["block"][0], session_id="absent"))
        self.assertEqual((code, out), (0, ""))
        self.assertEqual(
            [m for m in os.listdir(self.tmp) if m.startswith("recall-")], []
        )

    def test_mem_server_mounted_reads_project_mcp_json(self):
        home = os.path.join(self.tmp, "home")
        proj = os.path.join(home, "proj")
        os.makedirs(proj)
        with patch.dict(os.environ, {"HOME": home}):
            self.assertFalse(_REAL_MOUNTED(proj))
            with open(os.path.join(home, ".mcp.json"), "w", encoding="utf-8") as fh:
                json.dump({"mcpServers": {"claude-mem": {"command": "x"}}}, fh)
            self.assertTrue(_REAL_MOUNTED(proj))

    def test_mem_server_mounted_reads_claude_json_project_entry(self):
        home = os.path.join(self.tmp, "home")
        proj = os.path.join(home, "proj")
        os.makedirs(proj)
        with open(os.path.join(home, ".claude.json"), "w", encoding="utf-8") as fh:
            json.dump({"projects": {proj: {"mcpServers": {"mcp-search": {}}}}}, fh)
        with patch.dict(os.environ, {"HOME": home}):
            self.assertTrue(_REAL_MOUNTED(proj))

    def test_only_a_claude_mem_call_satisfies_the_gate(self):
        case = CASES["block"][0]
        sid = "ignore-then-recall"
        self.assertTrue(_denied(_run_main(self._payload(case, session_id=sid))[1]))
        recall = CASES["satisfy"][0]
        self.assertEqual(_run_main(self._payload(recall, session_id=sid)), (0, ""))
        self.assertEqual(self._markers(), [f"recall-{sid}"])
        self.assertEqual(_run_main(self._payload(case, session_id=sid)), (0, ""))

    def test_headless_bg_worker_sessions_are_never_denied(self):
        """Worker sessions (mux/atlas_launch spawned; ATLAS_WORKER_NAME pinned)
        never arm the recall gate: headless sessions cannot answer the
        claude-mem MCP approval, same worker trust model as the 10.4.1
        dispatch-tripwire exemption."""
        self.assertTrue(CASES["block"])
        case = CASES["block"][0]
        for worker in ("alpha-1", "beta-2"):
            sid = f"worker-{worker}"
            with patch.dict(os.environ, {"ATLAS_WORKER_NAME": worker}):
                self.assertEqual(
                    _run_main(self._payload(case, session_id=sid)), (0, "")
                )
                self.assertEqual(self._markers(), [])

    def test_blank_worker_name_is_not_a_worker(self):
        """A blank ATLAS_WORKER_NAME is no worker: the gate still denies."""
        case = CASES["block"][0]
        with patch.dict(os.environ, {"ATLAS_WORKER_NAME": ""}):
            code, out = _run_main(self._payload(case, session_id="blank-env"))
        self.assertTrue(_denied(out))

    def test_reason_names_the_claude_mem_route_and_an_example(self):
        self.assertIn(CC_ROUTE, REASON)
        self.assertIn('"query"', REASON)
        self.assertNotRegex(REASON, r"\{(route|example)\}")

    def test_claude_mem_call_satisfies_silently_and_later_calls_pass(self):
        self.assertTrue(CASES["satisfy"])
        for i, case in enumerate(CASES["satisfy"]):
            sid = f"satisfy-{i}"
            self.assertEqual(
                _run_main(self._payload(case, session_id=sid)), (0, ""), case["name"]
            )
            later = CASES["block"][0]
            self.assertEqual(
                _run_main(self._payload(later, session_id=sid)), (0, ""), case["name"]
            )

    def test_claude_code_write_names_its_path_file_path(self):
        case = {
            "name": "Write",
            "input": {
                "file_path": "xd://mcp__claude_mem_mcp_search_search",
                "content": "{}",
            },
        }
        self.assertEqual(_run_main(self._payload(case, session_id="fp")), (0, ""))
        self.assertEqual(
            _run_main(self._payload(CASES["block"][0], session_id="fp")), (0, "")
        )

    def test_a_write_to_a_real_path_is_not_a_recall(self):
        case = {
            "name": "Write",
            "input": {"file_path": os.path.join(self.tmp, "xd://mcp__claude_mem.txt")},
        }
        code, out = _run_main(self._payload(case, session_id="realpath"))
        self.assertTrue(_denied(out))

    def test_todo_is_exempt_and_leaves_the_gate_armed(self):
        self.assertTrue(CASES["exempt"])
        for i, case in enumerate(CASES["exempt"]):
            sid = f"exempt-{i}"
            self.assertEqual(_run_main(self._payload(case, session_id=sid)), (0, ""))
            self.assertEqual(
                self._markers(), [], "an exempt call must not consume the gate"
            )
            code, out = _run_main(self._payload(CASES["block"][0], session_id=sid))
            self.assertTrue(_denied(out))

    def test_toolsearch_passes_before_recall(self):
        """ToolSearch is how Claude Code loads the claude-mem tool: denying it deadlocks the gate."""
        for name in ("ToolSearch", "tool_search", "toolsearch"):
            case = {"name": name, "input": {"query": f"select:{CC_ROUTE}"}}
            self.assertEqual(_run_main(self._payload(case, session_id="ts")), (0, ""))
        self.assertEqual(self._markers(), [])
        self.assertTrue(
            _denied(_run_main(self._payload(CASES["block"][0], session_id="ts"))[1])
        )

    def test_sessions_are_independent(self):
        case = CASES["block"][0]
        self.assertTrue(_denied(_run_main(self._payload(case, session_id="one"))[1]))
        self.assertTrue(_denied(_run_main(self._payload(case, session_id="two"))[1]))
        self.assertEqual(
            _run_main(self._payload(CASES["satisfy"][0], session_id="one")), (0, "")
        )
        self.assertEqual(_run_main(self._payload(case, session_id="one")), (0, ""))
        # session two has no recall marker: still denied, independent of session one
        self.assertTrue(_denied(_run_main(self._payload(case, session_id="two"))[1]))
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
        self.assertEqual(
            _run_main(self._payload(CASES["satisfy"][0], session_id="shared")), (0, "")
        )
        for n in range(3):
            sub = self._payload(
                case,
                session_id="shared",
                transcript_path=(
                    f"/home/u/.claude/projects/p/shared/subagents/agent-{n}.jsonl"
                ),
            )
            self.assertEqual(_run_main(sub), (0, ""))
        self.assertEqual(_run_main(self._payload(case, session_id="shared")), (0, ""))
        self.assertEqual(self._markers(), ["recall-shared"])

    def test_a_subagent_with_its_own_session_is_gated_like_a_main_thread(self):
        # Policy: the gate keys on session_id. A subagent that runs under its OWN session id
        # (no /subagents/ transcript) has no marker, so it must recall once itself; the
        # parent's satisfied marker does not leak to it.
        case = CASES["block"][0]
        self.assertEqual(
            _run_main(self._payload(CASES["satisfy"][0], session_id="parent-s")),
            (0, ""),
        )
        own = self._payload(case, session_id="child-own-session")
        self.assertTrue(_denied(_run_main(own)[1]))
        self.assertEqual(
            _run_main(
                self._payload(CASES["satisfy"][0], session_id="child-own-session")
            ),
            (0, ""),
        )
        self.assertEqual(_run_main(own), (0, ""))

    def test_unarmed_states_never_deny_or_leave_a_marker(self):
        case = CASES["block"][0]
        with patch.dict(os.environ, {"ATLAS_MANDATES": "off"}):
            self.assertEqual(_run_main(self._payload(case)), (0, ""))
        with patch.dict(
            os.environ, {"ATLAS_MANDATES": "Off"}
        ):  # exact "off", as in omp
            self.assertTrue(
                _denied(_run_main(self._payload(case, session_id="caps"))[1])
            )
        with patch.object(recall_gate, "_claude_mem_enabled", return_value=False):
            self.assertEqual(
                _run_main(self._payload(case, session_id="noplugin")), (0, "")
            )
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
            self.assertEqual(
                _run_main(self._payload(CASES["block"][0], session_id="nofield")),
                (0, ""),
            )
        with patch.object(
            recall_gate, "MANDATES_PATH", os.path.join(self.tmp, "absent.json")
        ):
            self.assertEqual(
                _run_main(self._payload(CASES["block"][0], session_id="absent")),
                (0, ""),
            )
        self.assertEqual(
            [m for m in self._markers() if m.endswith(("nofield", "absent"))], []
        )

    def test_internal_errors_fail_open(self):
        faults_home = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, faults_home, True)
        env = patch.dict(os.environ, {"ATLAS_HOME": faults_home})
        env.start()
        self.addCleanup(env.stop)
        with patch.object(
            recall_gate, "_claude_mem_enabled", side_effect=RuntimeError("boom")
        ):
            self.assertEqual(
                _run_main(self._payload(CASES["block"][0], session_id="boom")), (0, "")
            )
        with open(
            os.path.join(faults_home, "hook-faults.jsonl"), encoding="utf-8"
        ) as fh:
            fault = json.loads(fh.readline())
        self.assertEqual((fault["hook"], fault["error"]), ("recall_gate", "boom"))
        with patch.object(
            recall_gate, "GATE_MARKER_DIR", os.path.join(self.tmp, "file")
        ):
            open(
                os.path.join(self.tmp, "file"), "w"
            ).close()  # a file where the marker dir should be
            # the recall path writes the marker: a failure there fails open (no deny, no crash)
            self.assertEqual(
                _run_main(self._payload(CASES["satisfy"][0], session_id="nodir")),
                (0, ""),
            )
            # the first-deny marker cannot be written either: fail open, never loop-deny
            self.assertEqual(
                _run_main(self._payload(CASES["block"][0], session_id="nodir2")),
                (0, ""),
            )

    def test_garbage_stdin_is_silent(self):
        for raw in (
            "",
            "not json{{{",
            "[1,2,3]",
            "null",
            "{}",
            '{"tool_name": 7, "session_id": 7}',
        ):
            self.assertEqual(_run_main(raw), (0, ""), raw)

    def test_scratch_cwd_never_arms(self):
        payload = {
            "hook_event_name": "PreToolUse",
            "tool_name": "Grep",
            "session_id": "scope-s1",
            "cwd": self.tmp,
        }
        with patch.dict(os.environ, {"ATLAS_GATES": ""}):
            self.assertEqual(_run_main(payload), (0, ""))


if __name__ == "__main__":
    unittest.main()
