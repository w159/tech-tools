"""Unit tests for atlas_parity_rig: the fake model server and the result parsing. No harness runs."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _test_isolation  # noqa: F401  (redirects ~/.atlas to a tempdir)
import atlas_parity_rig as rig

CMD = rig.SCENARIOS["write"]

CODEX_TOOLS = [
    {
        "type": "function",
        "name": "exec_command",
        "parameters": {
            "type": "object",
            "properties": {"cmd": {"type": "string"}, "workdir": {"type": "string"}},
            "required": ["cmd"],
        },
    },
    {"type": "function", "name": "view_image", "parameters": {"type": "object", "properties": {}}},
    {"type": "web_search"},
]
OMP_TOOLS = [
    {"type": "function", "function": {"name": "read", "parameters": {"type": "object"}}},
    {
        "type": "function",
        "function": {
            "name": "bash",
            "parameters": {
                "type": "object",
                "properties": {"i": {"type": "string"}, "command": {"type": "string"}, "timeout": {"type": "number"}},
                "required": ["command", "i"],
            },
        },
    },
]


def parse_sse(data: bytes) -> list[dict]:
    out = []
    for block in data.decode().split("\n\n"):
        for line in block.splitlines():
            if line.startswith("data: ") and line[6:] != "[DONE]":
                out.append(json.loads(line[6:]))
    return out


class ToolPicking(unittest.TestCase):
    def test_responses_shape_exec_command(self):
        name, params = rig.pick_shell_tool({"tools": CODEX_TOOLS})
        self.assertEqual(name, "exec_command")
        self.assertEqual(rig.shell_arguments(params, CMD), {"cmd": CMD})

    def test_chat_shape_bash_fills_required(self):
        name, params = rig.pick_shell_tool({"tools": OMP_TOOLS})
        self.assertEqual(name, "bash")
        self.assertEqual(rig.shell_arguments(params, CMD), {"command": CMD, "i": "parity rig"})

    def test_array_command_schema_gets_argv(self):
        params = {"properties": {"command": {"type": "array"}}, "required": ["command"]}
        self.assertEqual(rig.shell_arguments(params, CMD), {"command": ["bash", "-lc", CMD]})

    def test_no_shell_tool(self):
        self.assertIsNone(rig.pick_shell_tool({"tools": [CODEX_TOOLS[1]]}))
        self.assertEqual(rig.plan_turn({"tools": []}, CMD)["kind"], "text")


class TurnPlan(unittest.TestCase):
    def test_fresh_turn_calls_tool(self):
        plan = rig.plan_turn({"tools": CODEX_TOOLS, "input": [{"type": "message", "role": "user"}]}, CMD)
        self.assertEqual(plan, {"kind": "tool", "name": "exec_command", "arguments": {"cmd": CMD}})

    def test_responses_tool_output_ends_turn(self):
        body = {"tools": CODEX_TOOLS, "input": [{"type": "function_call_output", "call_id": "c", "output": "blocked by hook"}]}
        plan = rig.plan_turn(body, CMD)
        self.assertEqual(plan["kind"], "text")
        self.assertIn("blocked by hook", plan["text"])
        self.assertTrue(plan["text"].startswith(rig.FINAL_PREFIX))

    def test_chat_tool_message_ends_turn(self):
        body = {"tools": OMP_TOOLS, "messages": [{"role": "tool", "content": [{"type": "text", "text": "ok"}]}]}
        self.assertEqual(rig.tool_results(body), ["ok"])
        self.assertEqual(rig.plan_turn(body, CMD)["kind"], "text")


class Encoders(unittest.TestCase):
    def test_responses_tool_call_stream(self):
        events = rig.responses_events({"tools": CODEX_TOOLS, "model": "m"}, CMD)
        self.assertEqual([e["type"] for e in events], ["response.created", "response.output_item.done", "response.completed"])
        item = events[1]["item"]
        self.assertEqual(item["type"], "function_call")
        self.assertEqual(json.loads(item["arguments"]), {"cmd": CMD})
        self.assertEqual(events[2]["response"]["output"], [item])
        raw = rig.encode_responses_sse(events)
        self.assertTrue(raw.startswith(b"event: response.created\ndata: {"))
        self.assertEqual(parse_sse(raw), events)

    def test_responses_text_stream(self):
        body = {"input": [{"type": "function_call_output", "output": "done"}]}
        types = [e["type"] for e in rig.responses_events(body, CMD)]
        self.assertIn("response.output_text.delta", types)
        self.assertEqual(types[-1], "response.completed")

    def test_chat_stream_tool_call(self):
        chunks = rig.chat_chunks({"tools": OMP_TOOLS}, CMD)
        tc = chunks[0]["choices"][0]["delta"]["tool_calls"][0]
        self.assertEqual(tc["function"]["name"], "bash")
        self.assertEqual(json.loads(tc["function"]["arguments"])["command"], CMD)
        self.assertEqual(chunks[1]["choices"][0]["finish_reason"], "tool_calls")
        self.assertIn("usage", chunks[2])
        self.assertTrue(rig.encode_chat_sse(chunks).endswith(b"data: [DONE]\n\n"))

    def test_chat_non_stream(self):
        reply = rig.chat_completion({"tools": OMP_TOOLS}, CMD)
        self.assertEqual(reply["choices"][0]["finish_reason"], "tool_calls")
        self.assertNotIn("index", reply["choices"][0]["message"]["tool_calls"][0])


class Server(unittest.TestCase):
    def setUp(self):
        self.srv = rig.FakeModelServer(CMD).start()

    def tearDown(self):
        self.srv.stop()

    def post(self, path, body):
        req = urllib.request.Request(
            self.srv.base_url + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.headers.get("Content-Type"), r.read()

    def test_responses_round_trip(self):
        ctype, raw = self.post("/responses", {"stream": True, "tools": CODEX_TOOLS, "input": []})
        self.assertEqual(ctype, "text/event-stream")
        call = parse_sse(raw)[1]["item"]
        ctype, raw = self.post(
            "/responses",
            {"tools": CODEX_TOOLS, "input": [{"type": "function_call_output", "call_id": call["call_id"], "output": "x"}]},
        )
        self.assertEqual(parse_sse(raw)[-1]["response"]["output"][0]["type"], "message")
        self.assertEqual([r["plan"]["kind"] for r in self.srv.requests], ["tool", "text"])

    def test_chat_round_trip_and_models(self):
        _, raw = self.post("/chat/completions", {"stream": True, "tools": OMP_TOOLS, "messages": []})
        self.assertEqual(parse_sse(raw)[0]["choices"][0]["delta"]["tool_calls"][0]["function"]["name"], "bash")
        with urllib.request.urlopen(self.srv.base_url + "/models", timeout=5) as r:
            self.assertEqual(json.loads(r.read())["data"][0]["id"], rig.MODEL_ID)


def rec(event, script="event_dispatch.py", stdout="", rc=0, stderr="", cmd=""):
    return {"event": event, "script": script, "stdout": stdout, "rc": rc, "stderr": stderr, "cmd": cmd}


DENY = json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny"}})


class Parsing(unittest.TestCase):
    def test_parse_hook_log_fallback_events(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "h.jsonl")
            with open(p, "w") as f:
                f.write(json.dumps({"event": "", "script": "event_dispatch.py", "argv": ["PostToolUse"]}) + "\n")
                f.write(json.dumps({"event": "", "script": "completion_gate.py", "argv": []}) + "\n")
                f.write("not json\n\n")
                f.write(json.dumps({"event": "PreToolUse", "script": "git_guard.py", "argv": []}) + "\n")
            recs = rig.parse_hook_log(p)
        self.assertEqual([r["event"] for r in recs], ["PostToolUse", "Stop", "PreToolUse"])
        self.assertEqual(rig.parse_hook_log("/nonexistent/x"), [])

    def test_events_and_denies(self):
        recs = [rec("SessionStart"), rec("SessionStart"), rec("PreToolUse", stdout=DENY, cmd="git push"), rec("PreToolUse")]
        self.assertEqual(rig.events_fired(recs), {"SessionStart": 2, "PreToolUse": 2})
        self.assertEqual(len(rig.deny_records(recs)), 1)
        self.assertEqual(len(rig.deny_records([rec("PreToolUse", stdout='{"decision": "block"}')])), 1)
        self.assertEqual(rig.deny_records([rec("Stop", stdout=DENY)]), [])

    def test_force_push_verdict(self):
        self.assertEqual(rig.force_push_verdict(True, [{}], True), "NO (push ran)")
        self.assertEqual(rig.force_push_verdict(False, [{}], True), "yes (denied)")
        self.assertEqual(rig.force_push_verdict(False, [], True), "no deny; push did not run")
        self.assertEqual(rig.force_push_verdict(False, [], False), "not attempted")

    def test_atlas_warnings(self):
        recs = [rec("SessionStart", stdout="ATLAS-DOCTOR WARNING: unhealthy\nok"), rec("SessionStart", stdout="ATLAS-DOCTOR WARNING: unhealthy")]
        self.assertEqual(rig.atlas_warnings(recs), ["ATLAS-DOCTOR WARNING: unhealthy"])

    def test_hook_crashes(self):
        recs = [rec("Stop", rc=1, stderr="Traceback (most recent call last):\nValueError: boom"), rec("Stop")]
        self.assertEqual(rig.hook_problem_records(recs), ["event_dispatch.py Stop rc=1: ValueError: boom"])

    def test_codex_text_output(self):
        out = "\n".join(
            [
                "warning: `--dangerously-bypass-hook-trust` is enabled. hooks may fail",
                "hook: SessionStart",
                "hook: PreToolUse Blocked",
                "ERROR codex_core::tools::router: error=Command blocked by PreToolUse hook: no",
                f"{rig.FINAL_PREFIX} hook error repeated in the model text",
            ]
        )
        self.assertEqual(rig.harness_reported_hooks("codex", out), ["SessionStart", "PreToolUse Blocked"])
        errs = rig.harness_hook_errors("codex", out)
        self.assertEqual(len(errs), 1)
        self.assertIn("blocked by PreToolUse hook", errs[0])

    def test_claude_stream_json(self):
        lines = [
            {"type": "system", "subtype": "hook_started", "hook_event": "Stop"},
            {"type": "system", "subtype": "hook_response", "hook_event": "Stop", "hook_name": "Stop", "outcome": "success", "stderr": ""},
            {"type": "system", "subtype": "hook_response", "hook_event": "PreToolUse", "hook_name": "PreToolUse:Bash", "outcome": "error", "exit_code": "1", "stderr": "x\nboom"},
            {"type": "user", "message": {"content": [{"type": "tool_result", "content": "denied by hook"}]}},
        ]
        out = "\n".join(json.dumps(x) for x in lines)
        self.assertEqual(rig.harness_reported_hooks("claude", out), ["Stop success", "PreToolUse error"])
        self.assertEqual(rig.harness_hook_errors("claude", out), ["PreToolUse:Bash: outcome=error exit=1 boom"])
        self.assertEqual(rig.claude_tool_results(out), ["denied by hook"])

    def test_render_table(self):
        rows = [
            {"scenario": "write", "fired": {"SessionStart": 2, "Stop": 1}, "parity_file": True, "force_push": "n/a"},
            {"scenario": "force-push", "fired": {}, "parity_file": False, "force_push": "yes (denied)"},
            {"scenario": "write", "setup_error": "boom"},
        ]
        t = rig.render_table("codex", rows)
        self.assertIn("## codex", t)
        lines = t.splitlines()
        self.assertIn("yes (2)", lines[3])
        self.assertIn("yes (denied)", lines[4])
        self.assertTrue(all(len(x) == len(lines[1]) for x in lines[1:]))


class Shim(unittest.TestCase):
    def test_shim_logs_hook_and_passes_through(self):
        with tempfile.TemporaryDirectory() as d:
            hooks = os.path.join(d, "plugin", "hooks")
            os.makedirs(hooks)
            script = os.path.join(hooks, "fake_hook.py")
            with open(script, "w") as f:
                f.write("import sys\nd = sys.stdin.read()\nprint('got', len(d))\nsys.exit(2)\n")
            log = os.path.join(d, "log.jsonl")
            shim = rig.write_shim(os.path.join(d, "shim"), sys.executable, log)
            payload = json.dumps({"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": "git push"}})
            r = subprocess.run([shim, "-S", script, "X"], input=payload, capture_output=True, text=True, timeout=30, check=False)
            self.assertEqual(r.returncode, 2)
            self.assertEqual(r.stdout.strip(), f"got {len(payload)}")
            (entry,) = rig.parse_hook_log(log)
            self.assertEqual(
                (entry["event"], entry["script"], entry["argv"], entry["tool"], entry["cmd"], entry["rc"]),
                ("PreToolUse", "fake_hook.py", ["X"], "Bash", "git push", 2),
            )
            r = subprocess.run([shim, "-c", "print(6*7)"], capture_output=True, text=True, timeout=30, check=False)
            self.assertEqual(r.stdout.strip(), "42")
            self.assertEqual(rig.parse_hook_log(log), [entry])


class Env(unittest.TestCase):
    def test_env_isolation(self):
        base = {"PATH": "/usr/bin", "ATLAS_LEAD_NAME": "x", "CLAUDECODE": "1", "CODEX_HOME": "/real", "ANTHROPIC_BASE_URL": "u",
                "CLAUDE_CODE_SYNC_PLUGINS": "1", "KEEP": "1"}
        codex = rig.harness_env("codex", base, "/h", "/a", "/s", "/l")
        self.assertEqual(codex["CODEX_HOME"], "/h/.codex")
        self.assertNotIn("ATLAS_LEAD_NAME", codex)
        self.assertNotIn("CLAUDECODE", codex)
        self.assertEqual((codex["DO_NOT_TRACK"], codex["ATLAS_ANALYTICS"], codex["KEEP"]), ("1", "off", "1"))
        self.assertTrue(codex["PATH"].startswith("/s" + os.pathsep))
        claude = rig.harness_env("claude", base, "/h", "/a", "/s", "/l")
        self.assertEqual(claude["CLAUDECODE"], "1")
        self.assertNotIn("CLAUDE_CODE_SYNC_PLUGINS", claude)
        self.assertNotIn("CODEX_HOME", claude)
        self.assertEqual(claude["HOME"], "/h")


if __name__ == "__main__":
    unittest.main()
