"""More atlas_parity_rig tests: project/process helpers, argv builders, run_one, report, main.

No harness binary, model key or network is used; process spawning is mocked or limited to
git and the current interpreter."""

import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _test_isolation  # noqa: F401,E402
import atlas_parity_rig as rig  # noqa: E402


class TmpCase(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.addCleanup(self._t.cleanup)
        self.tmp = self._t.name


class Filler(unittest.TestCase):
    def test_types(self):
        f = rig._filler
        self.assertEqual(f({"type": "number"}), 0)
        self.assertEqual(f({"type": "integer"}), 0)
        self.assertIs(f({"type": "boolean"}), False)
        self.assertEqual(f({"type": "array"}), [])
        self.assertEqual(f({"type": "object"}), {})
        self.assertEqual(f({"type": "string"}), "parity rig")
        self.assertEqual(f({}), "parity rig")

    def test_union_type_skips_null(self):
        self.assertEqual(rig._filler({"type": ["null", "integer"]}), 0)
        self.assertEqual(rig._filler({"type": ["null"]}), "parity rig")


class ShellArguments(unittest.TestCase):
    def test_key_falls_back_to_required_string(self):
        params = {"properties": {"script": {"type": "string"}}, "required": ["script"]}
        self.assertEqual(rig.shell_arguments(params, "ls"), {"script": "ls"})

    def test_key_default_command_when_nothing_matches(self):
        self.assertEqual(rig.shell_arguments({}, "ls"), {"command": "ls"})

    def test_cmd_preferred_over_command(self):
        params = {"properties": {"command": {"type": "string"}, "cmd": {"type": "string"}}}
        self.assertEqual(rig.shell_arguments(params, "ls"), {"cmd": "ls"})

    def test_required_fillers_typed(self):
        params = {"properties": {"cmd": {"type": "string"}, "n": {"type": "integer"}, "f": {"type": "boolean"}},
                  "required": ["cmd", "n", "f", 7]}
        self.assertEqual(rig.shell_arguments(params, "x"), {"cmd": "x", "n": 0, "f": False})


class ContentText(unittest.TestCase):
    def test_shapes(self):
        c = rig._content_text
        self.assertEqual(c("a"), "a")
        self.assertEqual(c([{"text": "a"}, {"output": "b"}, "c", 5, {}]), "abc")
        self.assertEqual(c({"output": "o"}), "o")
        self.assertEqual(c({"text": "t"}), "t")
        self.assertEqual(c({"x": 1}), '{"x": 1}')
        self.assertEqual(c(None), "")
        self.assertEqual(c(12), "12")


class ToolSpecs(unittest.TestCase):
    def test_both_shapes_and_skips_nameless(self):
        body = {"tools": [
            {"type": "function", "name": "a", "parameters": {"p": 1}},
            {"type": "function", "function": {"name": "b", "parameters": {"q": 2}}},
            {"type": "web_search"},
            "junk",
        ]}
        self.assertEqual(rig.tool_specs(body), [("a", {"p": 1}), ("b", {"q": 2})])

    def test_tool_name_priority(self):
        body = {"tools": [{"type": "function", "name": "bash", "parameters": {}},
                          {"type": "function", "name": "exec_command", "parameters": {}}]}
        self.assertEqual(rig.pick_shell_tool(body)[0], "exec_command")


class ToolResults(unittest.TestCase):
    def test_collects_both_kinds_in_order(self):
        body = {"input": [{"type": "function_call_output", "output": "a"}, {"type": "message"},
                          {"type": "custom_tool_call_output", "output": "b"}],
                "messages": [{"role": "tool", "content": "c"}, {"role": "user", "content": "no"}]}
        self.assertEqual(rig.tool_results(body), ["a", "b", "c"])


class PlanTurnText(unittest.TestCase):
    def test_snippet_normalised_and_capped(self):
        body = {"input": [{"type": "function_call_output", "output": "a\n\n  b " + "z" * 400}]}
        text = rig.plan_turn(body, "c")["text"]
        self.assertTrue(text.startswith(rig.FINAL_PREFIX + " Tool result: a b zzz"))
        self.assertEqual(len(text.split("Tool result: ", 1)[1]), 200)

    def test_last_result_used(self):
        body = {"input": [{"type": "function_call_output", "output": "first"},
                          {"type": "function_call_output", "output": "second"}]}
        self.assertTrue(rig.plan_turn(body, "c")["text"].endswith("second"))

    def test_no_shell_message(self):
        self.assertEqual(rig.plan_turn({}, "c")["text"], rig.FINAL_PREFIX + " No shell tool was offered.")


class ResponsesEvents(unittest.TestCase):
    def test_text_turn_shape_and_usage(self):
        body = {"model": "mm", "input": [{"type": "function_call_output", "output": "done"}]}
        ev = rig.responses_events(body, "c")
        self.assertEqual([e["type"] for e in ev], [
            "response.created", "response.output_item.added", "response.output_text.delta",
            "response.output_item.done", "response.completed"])
        added = ev[1]["item"]
        self.assertEqual((added["status"], added["content"]), ("in_progress", []))
        self.assertEqual(ev[2]["delta"], ev[3]["item"]["content"][0]["text"])
        self.assertEqual(ev[2]["item_id"], ev[3]["item"]["id"])
        head, done = ev[0]["response"], ev[-1]["response"]
        self.assertEqual((head["status"], head["output"], head["model"]), ("in_progress", [], "mm"))
        self.assertEqual(done["status"], "completed")
        self.assertEqual(done["output"], [ev[3]["item"]])
        self.assertEqual(done["usage"], {
            "input_tokens": 10, "input_tokens_details": {"cached_tokens": 0},
            "output_tokens": 5, "output_tokens_details": {"reasoning_tokens": 0}, "total_tokens": 15})

    def test_tool_turn_output_index_and_default_model(self):
        ev = rig.responses_events({"tools": [{"type": "function", "name": "bash", "parameters": {}}]}, "c")
        self.assertEqual(ev[1]["output_index"], 0)
        self.assertEqual(ev[0]["response"]["model"], rig.MODEL_ID)
        self.assertEqual(ev[1]["item"]["status"], "completed")

    def test_text_events_output_indexes(self):
        ev = rig.responses_events({}, "c")
        self.assertEqual([e.get("output_index") for e in ev[1:4]], [0, 0, 0])
        self.assertEqual(ev[2]["content_index"], 0)

    def test_ids_unique_across_calls(self):
        a = rig.responses_events({}, "c")[0]["response"]["id"]
        b = rig.responses_events({}, "c")[0]["response"]["id"]
        self.assertNotEqual(a, b)


class ChatChunks(unittest.TestCase):
    def test_text_turn(self):
        ch = rig.chat_chunks({"messages": [{"role": "tool", "content": "r"}], "model": "mm"}, "c")
        self.assertEqual(ch[0]["choices"][0]["delta"]["role"], "assistant")
        self.assertTrue(ch[0]["choices"][0]["delta"]["content"].startswith(rig.FINAL_PREFIX))
        self.assertEqual(ch[1]["choices"][0]["finish_reason"], "stop")
        self.assertEqual(ch[2]["usage"], {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15})
        self.assertEqual(ch[2]["choices"], [])
        self.assertEqual(ch[0]["model"], "mm")
        self.assertEqual(len({c["id"] for c in ch}), 1)

    def test_completion_text(self):
        r = rig.chat_completion({"messages": [{"role": "tool", "content": "r"}]}, "c")
        self.assertEqual(r["choices"][0]["finish_reason"], "stop")
        self.assertNotIn("tool_calls", r["choices"][0]["message"])
        self.assertEqual(r["object"], "chat.completion")
        self.assertEqual(r["usage"]["total_tokens"], 15)
        self.assertEqual(r["model"], rig.MODEL_ID)


class Handler(unittest.TestCase):
    def setUp(self):
        self.srv = rig.FakeModelServer("echo hi").start()
        self.addCleanup(self.srv.stop)

    def req(self, method, path, body=None, headers=None):
        import urllib.error, urllib.request
        data = body if isinstance(body, bytes) else (json.dumps(body).encode() if body is not None else None)
        r = urllib.request.Request(self.srv.base_url + path, data=data, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(r, timeout=5) as resp:
                return resp.status, resp.headers.get("Content-Type"), resp.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers.get("Content-Type"), e.read()

    def test_unknown_get_404(self):
        code, ctype, raw = self.req("GET", "/nope")
        self.assertEqual((code, ctype, json.loads(raw)), (404, "application/json", {"error": "not found"}))

    def test_models_with_trailing_slash(self):
        code, _, raw = self.req("GET", "/models/")
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(raw)["data"][0]["owned_by"], "parity")

    def test_unknown_post_404(self):
        code, _, raw = self.req("POST", "/other", {})
        self.assertEqual((code, json.loads(raw)), (404, {"error": "not found"}))

    def test_bad_json_400(self):
        code, ctype, raw = self.req("POST", "/responses", b"{nope", {"Content-Type": "application/json"})
        self.assertEqual((code, ctype, json.loads(raw)), (400, "application/json", {"error": "bad json"}))
        self.assertEqual(self.srv.requests, [])

    def test_empty_body_is_empty_object(self):
        code, _, _ = self.req("POST", "/responses", b"")
        self.assertEqual(code, 200)
        self.assertEqual(self.srv.requests[0]["plan"]["kind"], "text")

    def test_gzip_body(self):
        import gzip
        body = gzip.compress(json.dumps({"tools": [{"type": "function", "name": "bash", "parameters": {}}]}).encode())
        code, _, _ = self.req("POST", "/responses", body, {"Content-Encoding": "gzip"})
        self.assertEqual(code, 200)
        self.assertEqual(self.srv.requests[0]["plan"]["name"], "bash")
        self.assertEqual(self.srv.requests[0]["plan"]["arguments"], {"command": "echo hi"})

    def test_chat_non_stream_json(self):
        code, ctype, raw = self.req("POST", "/chat/completions?x=1", {"tools": [
            {"type": "function", "function": {"name": "bash", "parameters": {}}}]})
        self.assertEqual((code, ctype), (200, "application/json"))
        self.assertEqual(json.loads(raw)["choices"][0]["finish_reason"], "tool_calls")
        self.assertEqual(self.srv.requests[0]["path"], "/v1/chat/completions")

    def test_record_keeps_tool_results(self):
        self.req("POST", "/responses/", {"input": [{"type": "function_call_output", "output": "zz"}]})
        self.assertEqual(self.srv.requests[0]["tool_results"], ["zz"])
        self.assertEqual(self.srv.requests[0]["path"], "/v1/responses")


class BaseUrl(unittest.TestCase):
    def test_base_url(self):
        srv = rig.FakeModelServer("c")
        self.addCleanup(srv.server_close)
        self.assertEqual(srv.base_url, "http://127.0.0.1:%d/v1" % srv.server_address[1])


class WriteShim(TmpCase):
    def test_file_executable_and_substituted(self):
        path = rig.write_shim(os.path.join(self.tmp, "a", "b"), "/usr/bin/pyx", "/tmp/l.jsonl")
        self.assertTrue(path.endswith("/python3"))
        self.assertTrue(os.access(path, os.X_OK))
        text = Path(path).read_text()
        self.assertTrue(text.startswith("#!/usr/bin/pyx -S\n"))
        self.assertIn('REAL = "/usr/bin/pyx"', text)
        self.assertIn('LOG = "/tmp/l.jsonl"', text)
        self.assertNotIn("@REAL", text)
        self.assertNotIn("@LOG", text)

    def test_non_hook_script_passes_through_unlogged(self):
        log = os.path.join(self.tmp, "l.jsonl")
        shim = rig.write_shim(os.path.join(self.tmp, "s"), sys.executable, log)
        other = os.path.join(self.tmp, "other.py")
        Path(other).write_text("print('plain')")
        r = subprocess.run([shim, other], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.stdout.strip(), "plain")
        self.assertFalse(os.path.exists(log))


class ParseHookLogMore(TmpCase):
    def write(self, *recs):
        p = os.path.join(self.tmp, "l.jsonl")
        Path(p).write_text("\n".join(json.dumps(r) if not isinstance(r, str) else r for r in recs))
        return p

    def test_explicit_event_kept(self):
        p = self.write({"event": "Stop", "script": "event_dispatch.py", "argv": ["PreToolUse"]})
        self.assertEqual(rig.parse_hook_log(p)[0]["event"], "Stop")

    def test_event_dispatch_without_argv_unknown(self):
        p = self.write({"script": "event_dispatch.py", "argv": []})
        self.assertEqual(rig.parse_hook_log(p)[0]["event"], "")

    def test_script_event_map(self):
        p = self.write(*({"script": s} for s in rig.SCRIPT_EVENT))
        self.assertEqual([r["event"] for r in rig.parse_hook_log(p)], list(rig.SCRIPT_EVENT.values()))

    def test_non_dict_json_skipped(self):
        p = self.write("[1, 2]", '"x"', {"event": "Stop"})
        self.assertEqual(len(rig.parse_hook_log(p)), 1)


class DenyMore(unittest.TestCase):
    def test_rc2_denies(self):
        self.assertEqual(len(rig.deny_records([{"event": "PreToolUse", "rc": 2, "stdout": ""}])), 1)

    def test_non_deny_decision_ignored(self):
        allow = json.dumps({"hookSpecificOutput": {"permissionDecision": "allow"}})
        self.assertEqual(rig.deny_records([{"event": "PreToolUse", "rc": 0, "stdout": allow}]), [])

    def test_non_json_stdout_ignored(self):
        self.assertEqual(rig.deny_records([{"event": "PreToolUse", "rc": 0, "stdout": "plain"}]), [])

    def test_non_dict_json_ignored(self):
        self.assertEqual(rig.deny_records([{"event": "PreToolUse", "rc": 0, "stdout": "[1]"}]), [])

    def test_hso_not_dict(self):
        self.assertEqual(rig.deny_records([{"event": "PreToolUse", "rc": 0,
                                            "stdout": '{"hookSpecificOutput": "x"}'}]), [])


class EventsFiredMore(unittest.TestCase):
    def test_unknown_event_bucket(self):
        self.assertEqual(rig.events_fired([{"event": ""}, {}]), {"?": 2})


class WarningsMore(unittest.TestCase):
    def test_only_warning_lines_stripped_and_capped(self):
        recs = [{"stdout": "  WARNING: " + "x" * 300 + "\nfine\nWARN"}]
        out = rig.atlas_warnings(recs)
        self.assertEqual(len(out), 1)
        self.assertEqual(len(out[0]), 240)
        self.assertTrue(out[0].startswith("WARNING: x"))


class ProblemRecords(unittest.TestCase):
    def test_rc2_clean_is_not_a_problem(self):
        self.assertEqual(rig.hook_problem_records([rec(2, "")]), [])

    def test_traceback_with_rc0(self):
        out = rig.hook_problem_records([rec(0, "Traceback x\nKeyError: k")])
        self.assertEqual(out, ["s.py Stop rc=0: KeyError: k"])

    def test_rc_nonzero_without_stderr(self):
        self.assertEqual(rig.hook_problem_records([rec(3, "")]), ["s.py Stop rc=3: "])

    def test_last_line_capped(self):
        out = rig.hook_problem_records([rec(1, "e" * 500)])
        self.assertEqual(len(out[0].split(": ", 1)[1]), 200)


def rec(rc, stderr):
    return {"script": "s.py", "event": "Stop", "rc": rc, "stderr": stderr}


class JsonLines(unittest.TestCase):
    def test_skips_bad_and_non_dict_and_continues(self):
        out = rig._json_lines('{"a": 1}\n{bad\n[1]\nplain\n{"b": 2}\n')
        self.assertEqual(out, [{"a": 1}, {"b": 2}])


class HarnessHookErrors(unittest.TestCase):
    def test_claude_dedupes_and_caps(self):
        d = {"type": "system", "subtype": "hook_response", "hook_name": "H", "outcome": "error",
             "exit_code": 1, "stderr": "boom"}
        out = "\n".join([json.dumps(d), json.dumps(d)])
        self.assertEqual(rig.harness_hook_errors("claude", out), ["H: outcome=error exit=1 boom"])

    def test_claude_success_without_stderr_ok_and_stderr_flagged(self):
        ok = {"type": "system", "subtype": "hook_response", "hook_name": "H", "outcome": "success"}
        noisy = dict(ok, stderr="warn")
        self.assertEqual(rig.harness_hook_errors("claude", json.dumps(ok)), [])
        self.assertEqual(rig.harness_hook_errors("claude", json.dumps(noisy)), ["H: outcome=success exit=None warn"])

    def test_claude_missing_outcome_without_stderr_ok(self):
        d = {"type": "system", "subtype": "hook_response", "hook_name": "H"}
        self.assertEqual(rig.harness_hook_errors("claude", json.dumps(d)), [])

    def test_claude_ignores_other_messages(self):
        d = {"type": "system", "subtype": "hook_started", "outcome": "error"}
        self.assertEqual(rig.harness_hook_errors("claude", json.dumps(d)), [])

    def test_text_requires_hook_and_error_words_and_skips_json(self):
        out = "\n".join(["hook failed badly", "no h-o-o-k error", "hook fine", '{"hook": "error"}',
                         "hook timed out", "hook failed badly"])
        self.assertEqual(rig.harness_hook_errors("omp", out), ["hook failed badly", "hook timed out"])

    def test_text_line_capped_at_240(self):
        self.assertEqual(len(rig.harness_hook_errors("codex", "hook error " + "x" * 400)[0]), 240)


class ReportedHooks(unittest.TestCase):
    def test_other_harness_empty(self):
        self.assertEqual(rig.harness_reported_hooks("omp", "hook: Stop"), [])

    def test_codex_requires_full_line(self):
        out = "hook: Stop Completed\nxx hook: Stop\nhook: PreToolUse Blocked extra\nhook: SessionStart"
        self.assertEqual(rig.harness_reported_hooks("codex", out), ["Stop Completed", "SessionStart"])

    def test_claude_missing_event_is_question_mark(self):
        d = {"type": "system", "subtype": "hook_response", "outcome": "success"}
        self.assertEqual(rig.harness_reported_hooks("claude", json.dumps(d)), ["? success"])


class ClaudeToolResults(unittest.TestCase):
    def test_only_user_tool_results(self):
        lines = [
            {"type": "user", "message": {"content": [{"type": "text", "text": "x"},
                                                       {"type": "tool_result", "content": [{"text": "A"}]}]}},
            {"type": "assistant", "message": {"content": [{"type": "tool_result", "content": "no"}]}},
            {"type": "user", "message": "str"},
            {"type": "user", "message": {"content": ["s"]}},
        ]
        out = "\n".join(json.dumps(x) for x in lines)
        self.assertEqual(rig.claude_tool_results(out), ["A"])


class YnRender(unittest.TestCase):
    def test_yn(self):
        self.assertEqual((rig.yn(True), rig.yn(False), rig.yn(None), rig.yn(0), rig.yn("x")),
                         ("yes", "no", "no", "no", "yes"))

    def test_render_columns(self):
        rows = [{"scenario": "write", "fired": {"Stop": 3}, "parity_file": True, "force_push": "x"},
                {"scenario": "force-push", "fired": {}, "parity_file": True, "force_push": "NO"}]
        lines = rig.render_table("h", rows).splitlines()
        self.assertEqual(lines[0], "## h")
        hdr = [c.strip() for c in lines[1].strip("|").split("|")]
        self.assertEqual(hdr, ["scenario"] + list(rig.EVENTS) + ["parity.txt", "force-push blocked"])
        w = [c.strip() for c in lines[3].strip("|").split("|")]
        self.assertEqual(w, ["write", "no", "no", "no", "no", "yes (3)", "yes", "n/a"])
        f = [c.strip() for c in lines[4].strip("|").split("|")]
        self.assertEqual(f[-2:], ["n/a", "NO"])
        self.assertTrue(lines[2].startswith("|-") and lines[2].endswith("-|"))
        self.assertEqual(set(lines[2]) - set("|-"), set())

    def test_setup_error_row_dashes(self):
        lines = rig.render_table("h", [{"scenario": "write", "setup_error": "x"}]).splitlines()
        cells = [c.strip() for c in lines[3].strip("|").split("|")]
        self.assertEqual(cells, ["write"] + ["-"] * 7)


class GitHelpers(TmpCase):
    def test_make_project_creates_everything(self):
        proj, remote, marker = rig.make_project(self.tmp)
        self.assertEqual((proj, remote, marker), (os.path.join(self.tmp, "proj"),
                         os.path.join(self.tmp, "remote.git"), os.path.join(self.tmp, "push-attempted")))
        self.assertEqual(Path(proj, "README.md").read_text(), "parity rig project\n")
        log = subprocess.run(["git", "log", "--format=%an|%ae|%s", "-1"], cwd=proj, capture_output=True, text=True).stdout
        self.assertEqual(log.strip(), "parity|parity@example.invalid|init")
        branch = subprocess.run(["git", "branch", "--show-current"], cwd=proj, capture_output=True, text=True).stdout
        self.assertEqual(branch.strip(), "main")
        url = subprocess.run(["git", "remote", "get-url", "origin"], cwd=proj, capture_output=True, text=True).stdout
        self.assertEqual(url.strip(), remote)
        hook = os.path.join(proj, ".git", "hooks", "pre-push")
        self.assertTrue(os.access(hook, os.X_OK))
        self.assertFalse(rig.remote_has_main(remote))
        self.assertFalse(os.path.exists(marker))

    def test_push_runs_hook_and_remote_has_main(self):
        proj, remote, marker = rig.make_project(self.tmp)
        rig._git(proj, "push", "origin", "main")
        self.assertTrue(os.path.exists(marker))
        self.assertTrue(rig.remote_has_main(remote))

    def test_git_helper_raises_on_failure(self):
        with self.assertRaises(subprocess.CalledProcessError):
            rig._git(self.tmp, "rev-parse", "HEAD")

    def test_remote_has_main_false_for_missing(self):
        self.assertFalse(rig.remote_has_main(os.path.join(self.tmp, "nope.git")))


class HarnessEnvMore(unittest.TestCase):
    BASE = {"PATH": "/usr/bin", "ATLAS_X": "1", "CODEX_Y": "1", "OMP_Z": "1", "PI_W": "1", "PLUGIN_ROOT": "p",
            "CLAUDE_PLUGIN_ROOT": "p", "OMPCODE": "1", "CLAUDE_CODE_SYNC_SKILLS": "1", "CLAUDE_CODE_PLUGIN_SEED_DIR": "d",
            "CLAUDE_CODE_SYNC_PLUGIN_INSTALL": "1", "CLAUDE_OTHER": "keep", "ANTHROPIC_API_KEY": "k", "KEEP": "1"}

    def test_omp_drops_claude_and_anthropic(self):
        env = rig.harness_env("omp", self.BASE, "/h", "/a", "/s", "/l")
        self.assertEqual({k for k in env if k.startswith(("CLAUDE", "ANTHROPIC"))}, set())
        self.assertNotIn("CODEX_HOME", env)
        self.assertEqual(env["KEEP"], "1")

    def test_claude_keeps_other_claude_vars_drops_sync_knobs(self):
        env = rig.harness_env("claude", self.BASE, "/h", "/a", "/s", "/l")
        self.assertEqual((env["CLAUDE_OTHER"], env["ANTHROPIC_API_KEY"]), ("keep", "k"))
        for k in ("CLAUDE_CODE_SYNC_SKILLS", "CLAUDE_CODE_PLUGIN_SEED_DIR", "CLAUDE_CODE_SYNC_PLUGIN_INSTALL",
                  "ATLAS_X", "CODEX_Y", "OMP_Z", "PI_W", "PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT", "OMPCODE"):
            self.assertNotIn(k, env)

    def test_set_values(self):
        env = rig.harness_env("codex", {}, "/h", "/a", "/s", "/l")
        self.assertEqual((env["HOME"], env["ATLAS_HOME"], env["ATLAS_PARITY_HOOKLOG"]), ("/h", "/a", "/l"))
        self.assertEqual(env["PATH"], "/s" + os.pathsep)


class RunProc(TmpCase):
    def test_success_merges_stderr(self):
        rc, out = rig.run_proc([sys.executable, "-c", "import sys;print('o');print('e',file=sys.stderr)"],
                               self.tmp, dict(os.environ), 30)
        self.assertEqual(rc, 0)
        self.assertEqual(sorted(out.split()), ["e", "o"])

    def test_nonzero_rc_and_cwd_and_env(self):
        rc, out = rig.run_proc([sys.executable, "-c", "import os,sys;print(os.getcwd(), os.environ['XV']);sys.exit(3)"],
                               self.tmp, {"XV": "val"}, 30)
        self.assertEqual(rc, 3)
        self.assertEqual(out.split(), [os.path.realpath(self.tmp), "val"])

    def test_stdin_is_closed(self):
        rc, out = rig.run_proc([sys.executable, "-c", "import sys;print(repr(sys.stdin.read()))"],
                               self.tmp, dict(os.environ), 30)
        self.assertEqual(out.strip(), "''")

    def test_timeout_kills_group_and_reports(self):
        rc, out = rig.run_proc([sys.executable, "-c", "import time;print('start',flush=True);time.sleep(60)"],
                               self.tmp, dict(os.environ), 1)
        self.assertIsNone(rc)
        self.assertIn("start", out)
        self.assertTrue(out.endswith("\n[parity rig] timed out after 1s"))


class Argv(unittest.TestCase):
    def test_prompt_for(self):
        p = rig.prompt_for("git push --force")
        self.assertIn("run exactly this command once, unchanged: git push --force\n", p)
        self.assertTrue(p.startswith("This is a disposable test repository"))
        self.assertTrue(p.endswith("Do nothing else."))

    def test_codex_argv(self):
        a = rig.harness_argv("codex", "/bin/codex", "/proj", "http://x/v1", "cmd1")
        self.assertEqual(a[:3], ["/bin/codex", "exec", "--dangerously-bypass-hook-trust"])
        self.assertIn("--dangerously-bypass-approvals-and-sandbox", a)
        self.assertEqual(a[a.index("-C") + 1], "/proj")
        self.assertEqual(a[a.index("-m") + 1], rig.MODEL_ID)
        prov = a[a.index("-c", a.index("model_provider=\"parity\"")) + 1]
        self.assertTrue(prov.startswith("model_providers.parity={"))
        self.assertIn('base_url="http://x/v1"', prov)
        self.assertIn('wire_api="responses"', prov)
        self.assertIn("request_max_retries=0", prov)
        self.assertIn("cmd1", a[-1])

    def test_omp_argv(self):
        a = rig.harness_argv("omp", "/bin/omp", "/proj", "http://x/v1", "cmd1")
        self.assertEqual(a[:2], ["/bin/omp", "-p"])
        self.assertEqual(a[a.index("-e") + 1], os.path.join(rig.PLUGIN_DIR, "omp", "index.ts"))
        self.assertEqual(a[a.index("--model") + 1], "parity/" + rig.MODEL_ID)
        self.assertEqual(a[a.index("--cwd") + 1], "/proj")
        self.assertIn("--no-extensions", a)
        self.assertIn("cmd1", a[-1])

    def test_claude_argv(self):
        a = rig.harness_argv("claude", "/bin/claude", "/proj", "", "cmd1")
        self.assertEqual(a[:2], ["/bin/claude", "-p"])
        self.assertEqual(a[a.index("--plugin-dir") + 1], rig.PLUGIN_DIR)
        self.assertEqual(a[a.index("--setting-sources") + 1], "")
        self.assertEqual(a[a.index("--output-format") + 1], "stream-json")
        for flag in ("--strict-mcp-config", "--include-hook-events", "--verbose"):
            self.assertIn(flag, a)
        self.assertIn("cmd1", a[-1])


class CodexSetup(unittest.TestCase):
    def test_runs_both_steps_and_collects_errors(self):
        outs = [(0, "ok"), (1, "x" * 600)]
        with mock.patch.object(rig, "run_proc", side_effect=outs) as rp:
            errs = rig.codex_setup("/bin/codex", {"E": "1"}, "/cwd", 9)
        self.assertEqual([c.args[0] for c in rp.call_args_list], [
            ["/bin/codex", "plugin", "marketplace", "add", rig.REPO_ROOT],
            ["/bin/codex", "plugin", "add", "atlas@tech-tools"]])
        self.assertEqual(rp.call_args_list[0].args[1:], ("/cwd", {"E": "1"}, 9))
        self.assertEqual(len(errs), 1)
        self.assertTrue(errs[0].startswith("plugin add atlas@tech-tools: rc=1: "))
        self.assertEqual(len(errs[0].split("rc=1: ")[1]), 400)

    def test_timeout_none_rc_is_error(self):
        with mock.patch.object(rig, "run_proc", return_value=(None, "t")):
            self.assertEqual(len(rig.codex_setup("b", {}, "/c", 1)), 2)

    def test_all_ok(self):
        with mock.patch.object(rig, "run_proc", return_value=(0, "")):
            self.assertEqual(rig.codex_setup("b", {}, "/c", 1), [])


class OmpModels(TmpCase):
    def test_writes_provider_config(self):
        rig.omp_models_file(self.tmp, "http://x/v1")
        cfg = json.loads(Path(self.tmp, ".omp", "agent", "models.yml").read_text())
        prov = cfg["providers"]["parity"]
        self.assertEqual((prov["baseUrl"], prov["api"], prov["apiKey"]),
                         ("http://x/v1", "openai-completions", "parity-fake-key"))
        self.assertEqual(prov["models"][0]["id"], rig.MODEL_ID)


class FindBinary(TmpCase):
    def test_local_tool_bin_preferred_for_codex_and_omp(self):
        for h in ("codex", "omp"):
            with mock.patch.object(rig, "TOOLS_BIN", self.tmp):
                p = os.path.join(self.tmp, h)
                Path(p).write_text("#!/bin/sh\n")
                os.chmod(p, 0o755)
                with mock.patch.object(rig.shutil, "which", return_value="/usr/bin/" + h):
                    self.assertEqual(rig.find_binary(h), p)

    def test_claude_ignores_local_bin(self):
        with mock.patch.object(rig, "TOOLS_BIN", self.tmp):
            p = os.path.join(self.tmp, "claude")
            Path(p).write_text("#!/bin/sh\n")
            os.chmod(p, 0o755)
            with mock.patch.object(rig.shutil, "which", return_value="/usr/bin/claude") as w:
                self.assertEqual(rig.find_binary("claude"), "/usr/bin/claude")
            w.assert_called_once_with("claude")

    def test_falls_back_to_which_and_none(self):
        with mock.patch.object(rig, "TOOLS_BIN", self.tmp):
            with mock.patch.object(rig.shutil, "which", return_value="/w/codex"):
                self.assertEqual(rig.find_binary("codex"), "/w/codex")
            with mock.patch.object(rig.shutil, "which", return_value=None):
                self.assertIsNone(rig.find_binary("omp"))

    def test_non_executable_local_ignored(self):
        with mock.patch.object(rig, "TOOLS_BIN", self.tmp):
            Path(self.tmp, "codex").write_text("x")
            os.chmod(os.path.join(self.tmp, "codex"), 0o644)
            with mock.patch.object(rig.shutil, "which", return_value="/w/codex"):
                self.assertEqual(rig.find_binary("codex"), "/w/codex")


class RunOne(TmpCase):
    def test_missing_binary(self):
        with mock.patch.object(rig, "find_binary", return_value=None):
            row = rig.run_one("omp", "write", 5, False, "/py")
        self.assertEqual(row, {"harness": "omp", "scenario": "write", "command": rig.SCENARIOS["write"],
                               "setup_error": "omp binary not found"})

    def fake_run(self, log_records, create_file=None, out="output text", rc=0):
        def run(argv, cwd, env, timeout):
            self.assertEqual(env["ATLAS_PARITY_HOOKLOG"], os.path.join(os.path.dirname(env["HOME"]), "hooks.jsonl"))
            Path(env["ATLAS_PARITY_HOOKLOG"]).write_text("\n".join(json.dumps(r) for r in log_records))
            if create_file:
                Path(cwd, create_file).write_text("x")
            Path(env["ATLAS_HOME"], "hook-faults.jsonl").write_text("f1\nf2\n")
            self.seen = dict(argv=argv, cwd=cwd, timeout=timeout)
            return rc, out
        return run

    def test_claude_write_scenario_full_row(self):
        recs = [{"event": "SessionStart", "script": "session_boot.py", "root": "/r", "stdout": "WARNING: w", "stderr": "", "rc": 0},
                {"event": "PreToolUse", "script": "git_guard.py", "root": "/r", "cmd": "echo hi", "stdout": "", "stderr": "", "rc": 0}]
        out = json.dumps({"type": "user", "message": {"content": [{"type": "tool_result", "content": "a\n  b"}]}})
        with mock.patch.object(rig, "find_binary", return_value="/bin/claude"), \
                mock.patch.object(rig, "run_proc", side_effect=self.fake_run(recs, "parity.txt", out)), \
                mock.patch.object(rig.time, "sleep") as sl:
            row = rig.run_one("claude", "write", 7, False, sys.executable)
        sl.assert_called_once_with(1.0)
        self.assertEqual(row["fired"], {"SessionStart": 1, "PreToolUse": 1})
        self.assertEqual(row["hook_scripts"], ["PreToolUse:git_guard.py", "SessionStart:session_boot.py"])
        self.assertEqual(row["hook_roots"], ["/r"])
        self.assertTrue(row["parity_file"])
        self.assertEqual((row["rc"], row["denies"], row["push_ran"], row["force_push"]), (0, [], False, "n/a"))
        self.assertEqual(row["atlas_warnings"], ["WARNING: w"])
        self.assertEqual(row["fault_rows"], ["f1", "f2"])
        self.assertEqual(row["tool_results_seen"], ["a b"])
        self.assertNotIn("model_requests", row)
        self.assertEqual(row["output_tail"], out[-3000:])
        self.assertEqual(self.seen["timeout"], 7)
        self.assertEqual(self.seen["argv"][0], "/bin/claude")
        self.assertTrue(self.seen["cwd"].endswith("/proj"))
        self.assertFalse(os.path.exists(row["workdir"]))   # cleaned up when keep is false

    def test_keep_preserves_workdir(self):
        with mock.patch.object(rig, "find_binary", return_value="/bin/claude"), \
                mock.patch.object(rig, "run_proc", side_effect=self.fake_run([])), \
                mock.patch.object(rig.time, "sleep"):
            row = rig.run_one("claude", "write", 7, True, sys.executable)
        self.addCleanup(shutil.rmtree, row["workdir"], True)
        self.assertTrue(os.path.isdir(row["workdir"]))
        self.assertEqual(Path(row["workdir"], "harness-output.txt").read_text(), "output text")
        self.assertFalse(row["parity_file"])
        self.assertEqual(row["fired"], {})

    def test_force_push_denied(self):
        deny = json.dumps({"hookSpecificOutput": {"permissionDecision": "deny"}})
        recs = [{"event": "PreToolUse", "script": "git_guard.py", "cmd": "git push --force origin main", "stdout": deny, "rc": 0}]
        with mock.patch.object(rig, "find_binary", return_value="/bin/claude"), \
                mock.patch.object(rig, "run_proc", side_effect=self.fake_run(recs)), \
                mock.patch.object(rig.time, "sleep"):
            row = rig.run_one("claude", "force-push", 7, False, sys.executable)
        self.assertEqual(row["force_push"], "yes (denied)")
        self.assertFalse(row["push_ran"])
        self.assertEqual(row["denies"], [{"script": "git_guard.py", "cmd": "git push --force origin main", "stdout": deny[:400]}])

    def test_force_push_ran_when_marker_present(self):
        recs = [{"event": "PreToolUse", "script": "git_guard.py", "cmd": "git push --force origin main", "stdout": "", "rc": 0}]

        def run(argv, cwd, env, timeout):
            Path(env["ATLAS_PARITY_HOOKLOG"]).write_text(json.dumps(recs[0]))
            Path(os.path.dirname(cwd), "push-attempted").write_text("")
            return 0, ""
        with mock.patch.object(rig, "find_binary", return_value="/bin/claude"), \
                mock.patch.object(rig, "run_proc", side_effect=run), mock.patch.object(rig.time, "sleep"):
            row = rig.run_one("claude", "force-push", 7, False, sys.executable)
        self.assertTrue(row["push_ran"])
        self.assertEqual(row["force_push"], "NO (push ran)")

    def test_omp_uses_fake_server_and_models_file(self):
        def run(argv, cwd, env, timeout):
            Path(env["ATLAS_PARITY_HOOKLOG"]).write_text("")
            self.models = Path(env["HOME"], ".omp", "agent", "models.yml").read_text()
            import urllib.request
            base = json.loads(self.models)["providers"]["parity"]["baseUrl"]
            req = urllib.request.Request(base + "/chat/completions", data=json.dumps({"tools": [
                {"type": "function", "function": {"name": "bash", "parameters": {}}}]}).encode())
            urllib.request.urlopen(req, timeout=5).read()
            return 0, ""
        with mock.patch.object(rig, "find_binary", return_value="/bin/omp"), \
                mock.patch.object(rig, "run_proc", side_effect=run), mock.patch.object(rig.time, "sleep"):
            row = rig.run_one("omp", "write", 7, False, sys.executable)
        self.assertEqual(row["model_requests"], 1)
        self.assertEqual(row["tool_results_seen"], [])
        self.assertTrue(json.loads(self.models)["providers"]["parity"]["baseUrl"].startswith("http://127.0.0.1:"))

    def test_codex_setup_failure_returns_setup_error(self):
        with mock.patch.object(rig, "find_binary", return_value="/bin/codex"), \
                mock.patch.object(rig, "codex_setup", return_value=["a", "b"]) as cs, \
                mock.patch.object(rig, "run_proc") as rp:
            row = rig.run_one("codex", "write", 7, False, sys.executable)
        self.assertEqual(row["setup_error"], "a; b")
        rp.assert_not_called()
        cs.assert_called_once()
        self.assertEqual(cs.call_args.args[0], "/bin/codex")
        self.assertEqual(cs.call_args.args[3], 7)

    def test_oserror_becomes_setup_error(self):
        with mock.patch.object(rig, "find_binary", return_value="/bin/claude"), \
                mock.patch.object(rig, "make_project", side_effect=OSError("disk")):
            row = rig.run_one("claude", "write", 7, False, sys.executable)
        self.assertEqual(row["setup_error"], "OSError: disk")
        self.assertFalse(os.path.exists(row["workdir"]))


class Report(unittest.TestCase):
    def row(self, **kw):
        base = dict(harness="codex", scenario="write", command="echo", rc=0, seconds=1.5,
                    fired={"Stop": 1}, hook_scripts=["Stop:a.py", "PreToolUse:b.py"], output_tail="",
                    push_ran=False, parity_file=True, force_push="n/a")
        base.update(kw)
        return base

    def test_core_lines(self):
        txt = rig.report([self.row()])
        self.assertIn("## codex", txt)
        self.assertIn("  [write] rc=0 in 1.5s; command: echo", txt)
        self.assertIn("  [write] hooks run (event:script): Stop:a.py, PreToolUse:b.py", txt)
        self.assertNotIn("push executed", txt)
        self.assertNotIn("harness-reported", txt)
        self.assertNotIn("output tail", txt)

    def test_optional_sections(self):
        txt = rig.report([self.row(
            scenario="force-push", harness_reported=["Stop Completed"], model_requests=2,
            tool_results_seen=["seen it"], denies=[{"script": "g.py", "cmd": "git push", "stdout": "d" * 400}],
            push_ran=True, harness_errors=["he"], atlas_warnings=["aw"], hook_crashes=["hc"],
            fault_rows=["f" * 400], hook_scripts=[], fired={"Stop": 1})])
        self.assertIn("  [force-push] harness-reported hooks: Stop Completed", txt)
        self.assertIn("  [force-push] fake model requests: 2", txt)
        self.assertIn("  [force-push] tool result fed back to model: seen it", txt)
        self.assertIn("  [force-push] deny by g.py for `git push`: " + "d" * 300 + "\n", txt)
        self.assertIn("  [force-push] push executed: yes", txt)
        self.assertIn("  [force-push] harness hook error: he", txt)
        self.assertIn("  [force-push] atlas hook warning: aw", txt)
        self.assertIn("  [force-push] hook crash: hc", txt)
        self.assertIn("  [force-push] hook-faults.jsonl: " + "f" * 300 + "\n", txt)
        self.assertIn("hooks run (event:script): none", txt)

    def test_setup_failed_and_tail_when_nothing_fired(self):
        txt = rig.report([
            {"harness": "omp", "scenario": "write", "setup_error": "boom"},
            self.row(harness="omp", scenario="force-push", fired={}, output_tail="l1\nl2", push_ran=False)])
        self.assertIn("  [write] SETUP FAILED: boom", txt)
        self.assertIn("  [force-push] output tail:\n      l1\n      l2", txt)
        self.assertIn("push executed: no", txt)

    def test_groups_by_harness_in_order(self):
        txt = rig.report([self.row(harness="omp"), self.row(harness="codex"), self.row(harness="omp", scenario="force-push")])
        self.assertLess(txt.index("## omp"), txt.index("## codex"))
        self.assertEqual(txt.count("## omp"), 1)


class Main(unittest.TestCase):
    def run_main(self, argv, **patches):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            rc = rig.main(argv)
        return rc, out.getvalue(), err.getvalue()

    def test_bad_harness_is_usage_error(self):
        with self.assertRaises(SystemExit) as cm, redirect_stderr(io.StringIO()):
            rig.main(["--harness", "nope"])
        self.assertEqual(cm.exception.code, 2)

    def test_empty_scenario_is_usage_error(self):
        with self.assertRaises(SystemExit), redirect_stderr(io.StringIO()):
            rig.main(["--scenario", " , "])

    def test_missing_git_returns_2(self):
        with mock.patch.object(rig.shutil, "which", side_effect=lambda n: "/py" if n == "python3" else None):
            rc, out, err = self.run_main(["--harness", "claude"])
        self.assertEqual(rc, 2)
        self.assertIn("python3 and git must be on PATH", err)

    def test_runs_every_pair_reports_and_writes_json(self):
        calls = []

        def fake(h, s, t, keep, py):
            calls.append((h, s, t, keep, py))
            return {"harness": h, "scenario": s, "command": "c", "rc": 0, "seconds": 0.1, "fired": {"Stop": 1},
                    "hook_scripts": [], "output_tail": "", "push_ran": False, "workdir": "/w",
                    "parity_file": True, "force_push": "n/a"}
        with tempfile.TemporaryDirectory() as d, mock.patch.object(rig, "run_one", side_effect=fake), \
                mock.patch.object(rig.shutil, "which", return_value="/usr/bin/x"):
            jp = os.path.join(d, "o.json")
            rc, out, err = self.run_main(["--harness", "codex, omp", "--scenario", "write", "--timeout", "9",
                                          "--keep", "--json", jp])
            data = json.loads(Path(jp).read_text())
        self.assertEqual(rc, 0)
        self.assertEqual(calls, [("codex", "write", 9, True, "/usr/bin/x"), ("omp", "write", 9, True, "/usr/bin/x")])
        self.assertIn("running codex / write", err)
        self.assertIn("Atlas parity rig - plugin " + rig.PLUGIN_DIR, out)
        self.assertIn("## codex", out)
        self.assertIn("kept: omp/write: /w", out)
        self.assertEqual([r["harness"] for r in data], ["codex", "omp"])

    def test_setup_error_exit_2_and_no_kept_lines_without_flag(self):
        with mock.patch.object(rig, "run_one", return_value={"harness": "claude", "scenario": "write", "setup_error": "x"}), \
                mock.patch.object(rig.shutil, "which", return_value="/usr/bin/x"):
            rc, out, _ = self.run_main(["--harness", "claude", "--scenario", "write"])
        self.assertEqual(rc, 2)
        self.assertNotIn("kept:", out)
        self.assertIn("SETUP FAILED: x", out)

    def test_defaults_cover_all(self):
        seen = []
        with mock.patch.object(rig, "run_one", side_effect=lambda h, s, *a: seen.append((h, s, a[0])) or
                               {"harness": h, "scenario": s, "setup_error": "x"}), \
                mock.patch.object(rig.shutil, "which", return_value="/usr/bin/x"):
            self.run_main([])
        self.assertEqual(len(seen), len(rig.HARNESSES) * len(rig.SCENARIOS))
        self.assertEqual({t for _, _, t in seen}, {300})


if __name__ == "__main__":
    unittest.main()
