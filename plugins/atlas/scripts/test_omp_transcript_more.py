"""omp_transcript: in-process unit tests of the translation helpers, the
converter and the file-level entry points (the subprocess-based suite in
test_omp_transcript.py does not register coverage)."""

import _test_isolation  # noqa: F401,E402
import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import omp_transcript as ot  # noqa: E402


class IsoTimestamps(unittest.TestCase):
    def test_epoch_ms_to_utc_z_millis(self):
        self.assertEqual(ot._iso_from_epoch_ms(1700000000123),
                         "2023-11-14T22:13:20.123Z")
        self.assertEqual(ot._iso_from_epoch_ms("0"), "1970-01-01T00:00:00.000Z")

    def test_bad_values_are_none(self):
        for v in (None, "abc", [], float("nan"), 1e40, float("inf")):
            self.assertIsNone(ot._iso_from_epoch_ms(v), v)

    def test_entry_timestamp_precedence(self):
        self.assertEqual(ot._entry_timestamp({"timestamp": "2024-01-01T00:00:00Z",
                                              "message": {"timestamp": 5}}),
                         "2024-01-01T00:00:00Z")
        self.assertEqual(ot._entry_timestamp({"timestamp": 1700000000000}),
                         "2023-11-14T22:13:20.000Z")
        self.assertEqual(ot._entry_timestamp({"timestamp": "",
                                              "message": {"timestamp": 1700000000000}}),
                         "2023-11-14T22:13:20.000Z")
        self.assertEqual(ot._entry_timestamp({"message": {"timestamp": 0}}),
                         "1970-01-01T00:00:00.000Z")
        self.assertIsNone(ot._entry_timestamp({"message": "x"}))
        self.assertIsNone(ot._entry_timestamp({}))


class McpXdSplit(unittest.TestCase):
    def test_known_server_longest_match(self):
        self.assertEqual(ot._split_mcp_xd("xd://mcp__lean_ctx_ctx_shell"),
                         "mcp__lean_ctx__ctx_shell")
        self.assertEqual(
            ot._split_mcp_xd("xd://mcp__context_mode_context_mode_ctx_execute"),
            "mcp__context_mode_context_mode__ctx_execute")

    def test_known_server_requires_a_tool(self):
        # server name with nothing after the separator: no known-server split
        self.assertIsNone(ot._split_mcp_xd("xd://mcp__lean_ctx_"))
        self.assertIsNone(ot._split_mcp_xd("xd://mcp__lean_ctx"))

    def test_duplicate_token_rule(self):
        self.assertEqual(ot._split_mcp_xd("xd://mcp__atlas_falcon_falcon_get_host"),
                         "mcp__atlas_falcon__get_host")
        self.assertEqual(ot._split_mcp_xd("xd://mcp__github_github_get_me"),
                         "mcp__github__get_me")

    def test_duplicate_token_without_tool_is_none(self):
        self.assertIsNone(ot._split_mcp_xd("xd://mcp__foo_foo"))

    def test_unrecognised_shapes(self):
        for p in ("xd://mcp__plainname", "file.txt", "", None, "xd://other__a_a_b",
                  "xd://mcp__"):
            self.assertIsNone(ot._split_mcp_xd(p), p)

    def test_empty_token_is_not_a_duplicate(self):
        # "a__b" tokenises to ["a", "", "b"]: empty tokens never match each other
        self.assertIsNone(ot._split_mcp_xd("xd://mcp__a__b"))

    def test_loader_fallback_and_validation(self):
        with tempfile.TemporaryDirectory() as t:
            ok = Path(t) / "ok.json"
            ok.write_text(json.dumps({"underscoredServers": ["x_y"]}))
            self.assertEqual(ot._load_mcp_servers(str(ok)), ("x_y",))
            for body in ('{"underscoredServers": []}', '{"underscoredServers": [1]}',
                         '{"underscoredServers": [""]}', '{"underscoredServers": "s"}',
                         '{}', 'not json'):
                p = Path(t) / "bad.json"
                p.write_text(body)
                self.assertEqual(ot._load_mcp_servers(str(p)),
                                 ot._KNOWN_MCP_SERVERS_FALLBACK, body)
            self.assertEqual(ot._load_mcp_servers(str(Path(t) / "none.json")),
                             ot._KNOWN_MCP_SERVERS_FALLBACK)


class SmallHelpers(unittest.TestCase):
    def test_edit_paths(self):
        patch = "[a/b.py#1F]\n@@ x\n[c.py]\nbody\n[a/b.py#22]\n[ spaced.py ]\n"
        self.assertEqual(ot._edit_paths(patch), ["a/b.py", "c.py", "spaced.py"])
        self.assertEqual(ot._edit_paths("no headers"), [])
        self.assertEqual(ot._edit_paths(None), [])
        self.assertEqual(ot._edit_paths(5), [])
        self.assertEqual(ot._edit_paths("[   ]\n"), [])

    def test_flatten_text(self):
        self.assertEqual(ot._flatten_text("plain"), "plain")
        self.assertEqual(ot._flatten_text([{"type": "text", "text": "a"}, "b",
                                           {"type": "image", "text": "no"},
                                           {"type": "text", "text": ""},
                                           {"type": "text"}, 7]), "a\nb")
        self.assertEqual(ot._flatten_text(None), "")
        self.assertEqual(ot._flatten_text({"type": "text", "text": "x"}), "")

    def test_todos_from_result(self):
        res = {"details": {"phases": [
            {"tasks": [{"content": "  one ", "status": "in_progress"},
                       {"title": "two", "status": "done"},
                       {"content": "three", "status": "abandoned"},
                       {"content": "four"},
                       {"content": "five", "status": "weird"},
                       {"content": "  "}, "junk", {"content": "five-b"}]},
            "bad phase",
            {"tasks": None},
            {"tasks": [{"content": "six", "status": "completed"}]}]}}
        self.assertEqual(ot._todos_from_result(res), [
            {"content": "one", "status": "in_progress", "activeForm": "one"},
            {"content": "two", "status": "completed", "activeForm": "two"},
            {"content": "three", "status": "completed", "activeForm": "three"},
            {"content": "four", "status": "pending", "activeForm": "four"},
            {"content": "five", "status": "pending", "activeForm": "five"},
            {"content": "five-b", "status": "pending", "activeForm": "five-b"},
            {"content": "six", "status": "completed", "activeForm": "six"},
        ])

    def test_todos_from_missing_shapes(self):
        for r in (None, {}, {"details": None}, {"details": {"phases": "x"}},
                  {"details": {"phases": {}}}):
            self.assertEqual(ot._todos_from_result(r), [])

    def test_warn_goes_to_stderr_only(self):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            ot._warn("hello")
        self.assertEqual(out.getvalue(), "")
        self.assertEqual(err.getvalue(), "omp_transcript: hello\n")

    def test_mcp_input_decodes_json_string_content(self):
        self.assertEqual(ot._mcp_input({"path": "xd://x",
                                        "content": '{"command": "pytest -q"}'}),
                         {"command": "pytest -q"})

    def test_mcp_input_keeps_raw_when_not_an_object(self):
        for content in ("[1, 2]", "not json", '"str"', 5, None):
            args = {"path": "xd://x", "content": content, "extra": 1}
            out = ot._mcp_input(args)
            self.assertEqual(out, {"content": content, "extra": 1}, content)
        self.assertEqual(ot._mcp_input({"path": "p"}), {})

    def test_list_dir_sorted_and_tolerant(self):
        with tempfile.TemporaryDirectory() as t:
            for n in ("b", "a", "c"):
                (Path(t) / n).write_text("")
            self.assertEqual(ot._list_dir(t), ["a", "b", "c"])
            self.assertEqual(ot._list_dir(str(Path(t) / "nope")), [])

    def test_agent_name(self):
        self.assertEqual(ot._agent_name("__advisor.jsonl"), "advisor")
        self.assertEqual(ot._agent_name("Worker.jsonl"), "Worker")
        self.assertEqual(ot._agent_name("___.jsonl"), "agent")
        self.assertEqual(ot._agent_name("a.b.jsonl"), "a.b")

    def test_session_meta(self):
        self.assertEqual(ot._session_meta([{"type": "x"},
                                           {"type": "session", "id": "S", "cwd": "/w"},
                                           {"type": "session", "id": "T"}]), ("S", "/w"))
        self.assertEqual(ot._session_meta([{"type": "session", "id": "", "cwd": ""}]),
                         (None, None))
        self.assertEqual(ot._session_meta([]), (None, None))


class LoadEntries(unittest.TestCase):
    def test_skips_blank_junk_and_non_objects(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / "s.jsonl"
            p.write_bytes(b'{"a": 1}\n\n   \nnot json\n[1]\n"s"\n{"b": 2}\n{"trunc')
            self.assertEqual(ot._load_entries(str(p)), [{"a": 1}, {"b": 2}])

    def test_invalid_utf8_is_replaced_not_fatal(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / "s.jsonl"
            p.write_bytes(b'{"a": "\xff"}\n')
            self.assertEqual(ot._load_entries(str(p)), [{"a": "�"}])

    def test_missing_file_raises_with_path(self):
        with self.assertRaises(OSError) as cm:
            ot._load_entries("/nonexistent/dir/s.jsonl")
        self.assertIn("cannot read /nonexistent/dir/s.jsonl", str(cm.exception))


class ConverterIds(unittest.TestCase):
    def test_uuid_and_tool_id_namespacing(self):
        lead = ot._Converter("S", None, False, None)
        sub = ot._Converter("S", "Ag", True, None)
        self.assertEqual(lead._uuid("e1"), "S:e1")
        self.assertEqual(sub._uuid("e1"), "S:Ag:e1")
        self.assertEqual(lead._tool_id("c1", "fb"), "c1")
        self.assertEqual(lead._tool_id("c1", "fb"), "c1#2")
        self.assertEqual(lead._tool_id("c1", "fb"), "c1#3")
        self.assertEqual(lead._tool_id(None, "fb"), "fb")
        self.assertEqual(lead._tool_id("", "fb"), "fb#2")
        self.assertEqual(sub._tool_id("c1", "fb"), "Ag:c1")
        self.assertEqual(sub._tool_id(7, "fb"), "Ag:7")


class UsageTest(unittest.TestCase):
    def test_usage_mapping(self):
        u = ot._Converter._usage({"input": 1, "output": 2.9, "cacheRead": 3, "cacheWrite": 4})
        self.assertEqual(u, {"input_tokens": 1, "output_tokens": 2,
                             "cache_read_input_tokens": 3,
                             "cache_creation_input_tokens": 4})

    def test_usage_rejects_bool_nan_and_non_dict(self):
        u = ot._Converter._usage({"input": True, "output": float("nan"),
                                  "cacheRead": float("inf"), "cacheWrite": "5"})
        self.assertEqual(u, {"input_tokens": 0, "output_tokens": 0,
                             "cache_read_input_tokens": 0,
                             "cache_creation_input_tokens": 0})
        self.assertIsNone(ot._Converter._usage(None))
        self.assertIsNone(ot._Converter._usage([1]))
        self.assertEqual(ot._Converter._usage({})["input_tokens"], 0)


def _msg(eid, role, content, **extra):
    m = {"role": role, "content": content}
    m.update(extra)
    return {"type": "message", "id": eid, "message": m}


class MapToolCalls(unittest.TestCase):
    def conv(self):
        return ot._Converter("S", None, False, None)

    def call(self, name, args, result=None, cid="c1", conv=None):
        c = conv or self.conv()
        return c._map_tool_calls({"name": name, "id": cid, "arguments": args}, result, "e1")

    def test_plain_rename_and_unmapped_name(self):
        out = self.call("bash", {"command": "ls"})
        self.assertEqual(out, [{"type": "tool_use", "id": "c1", "name": "Bash",
                                "input": {"command": "ls"}}])
        self.assertEqual(self.call("advise", {"q": 1})[0]["name"], "advise")
        self.assertEqual(self.call("", {})[0]["name"], "unknown")
        self.assertEqual(self.call("find", {})[0]["name"], "Glob")
        self.assertEqual(self.call("web_search", {})[0]["name"], "WebSearch")

    def test_non_dict_arguments_become_empty_input(self):
        c = self.conv()
        out = c._map_tool_calls({"name": "bash", "id": "c", "arguments": "oops"}, None, "e")
        self.assertEqual(out[0]["input"], {})

    def test_fallback_id_when_call_has_no_id(self):
        out = self.call("bash", {}, cid=None)
        self.assertEqual(out[0]["id"], "e1:bash")
        out = self.conv()._map_tool_calls({"arguments": {}}, None, "e9")
        self.assertEqual(out[0]["id"], "e9:tool")

    def test_read_and_write_lead_with_file_path(self):
        out = self.call("read", {"offset": 1, "path": "/a.py"})[0]["input"]
        self.assertEqual(list(out)[:1], ["file_path"])
        self.assertEqual(out, {"file_path": "/a.py", "offset": 1, "path": "/a.py"})
        out = self.call("write", {"path": "/b.txt", "content": "hi"})[0]
        self.assertEqual(out["name"], "Write")
        self.assertEqual(out["input"]["file_path"], "/b.txt")
        self.assertEqual(list(out["input"])[0], "file_path")
        self.assertEqual(self.call("read", {"offset": 1})[0]["input"], {"offset": 1})

    def test_edit_derives_file_path_from_patch_header(self):
        patch = "[src/x.py#AB]\n@@\n[src/y.py]\n"
        inp = self.call("edit", {"input": patch, "note": "n"})[0]["input"]
        self.assertEqual(inp["file_path"], "src/x.py")
        self.assertEqual(inp["path"], "src/x.py")
        self.assertEqual(inp["files"], ["src/x.py", "src/y.py"])
        self.assertEqual(list(inp)[:3], ["file_path", "path", "files"])
        self.assertEqual(inp["input"], patch)

    def test_edit_single_header_has_no_files_list(self):
        inp = self.call("edit", {"input": "[only.py#1]\n"})[0]["input"]
        self.assertNotIn("files", inp)
        self.assertEqual(inp["file_path"], "only.py")

    def test_edit_falls_back_to_path_argument(self):
        inp = self.call("edit", {"input": "no header", "path": "p.py"})[0]["input"]
        self.assertEqual((inp["file_path"], inp["path"]), ("p.py", "p.py"))
        inp = self.call("edit", {"input": "no header"})[0]["input"]
        self.assertEqual(inp, {"input": "no header"})

    def test_todo_input_comes_from_result(self):
        res = {"details": {"phases": [{"tasks": [{"content": "t", "status": "pending"}]}]}}
        out = self.call("todo", {"ops": []}, result=res)
        self.assertEqual(out[0]["name"], "TodoWrite")
        self.assertEqual(out[0]["input"],
                         {"todos": [{"content": "t", "status": "pending", "activeForm": "t"}]})
        self.assertEqual(self.call("todo", {})[0]["input"], {"todos": []})

    def test_mcp_device_write(self):
        out = self.call("write", {"path": "xd://mcp__lean_ctx_ctx_shell",
                                  "content": json.dumps({"command": "pytest"})})
        self.assertEqual(out, [{"type": "tool_use", "id": "c1",
                                "name": "mcp__lean_ctx__ctx_shell",
                                "input": {"command": "pytest"}}])

    def test_unparseable_xd_write_stays_a_write(self):
        out = self.call("write", {"path": "xd://mcp__nosplit", "content": "{}"})
        self.assertEqual(out[0]["name"], "Write")

    def test_task_single_and_batched(self):
        out = self.call("task", {"agent": "explorer", "task": "look", "i": "desc"})
        self.assertEqual(out, [{"type": "tool_use", "id": "c1.0", "name": "Task",
                                "input": {"subagent_type": "explorer", "prompt": "look",
                                          "description": "desc"}}])
        out = self.call("task", {"agent": "dflt", "tasks": [
            {"agent": "a", "task": "t0", "name": "n0"},
            "skip me",
            {"prompt": "t2"}]})
        self.assertEqual([o["id"] for o in out], ["c1.0", "c1.2"])
        self.assertEqual(out[0]["input"], {"subagent_type": "a", "prompt": "t0",
                                           "description": "n0"})
        self.assertEqual(out[1]["input"], {"subagent_type": "dflt", "prompt": "t2",
                                           "description": ""})

    def test_task_defaults_and_id_fallback(self):
        out = self.call("task", {}, cid=None)
        self.assertEqual(out[0]["id"], "e1:task.0")
        self.assertEqual(out[0]["input"], {"subagent_type": "task", "prompt": "",
                                           "description": ""})
        self.assertEqual(self.call("task", {"tasks": []})[0]["name"], "Task")


class ConvertEntries(unittest.TestCase):
    def convert(self, entries, sid="S", agent=None, sidechain=False, cwd=None):
        c = ot._Converter(sid, agent, sidechain, cwd)
        with contextlib.redirect_stderr(io.StringIO()) as err:
            c.convert(entries)
        return c.records, err.getvalue()

    def test_record_shape_parent_chain_and_cwd(self):
        recs, _ = self.convert([
            _msg("1", "user", "hello", timestamp=None) | {"timestamp": "2024-01-01T00:00:00Z"},
            _msg("2", "assistant", [{"type": "text", "text": "hi"}], model="m1",
                 usage={"input": 3}),
            {"type": "other", "id": "x"},
            _msg("3", "assistant", "plain string") | {"parentId": "1"},
        ], cwd="/w")
        self.assertEqual([r["uuid"] for r in recs], ["S:1", "S:2", "S:3"])
        self.assertEqual([r["parentUuid"] for r in recs], [None, "S:1", "S:1"])
        self.assertEqual(recs[0]["timestamp"], "2024-01-01T00:00:00Z")
        self.assertEqual(recs[0]["cwd"], "/w")
        self.assertEqual(recs[0]["isSidechain"], False)
        self.assertEqual(recs[0]["sessionId"], "S")
        self.assertEqual(recs[0]["type"], "user")
        self.assertEqual(recs[1]["message"]["model"], "m1")
        self.assertEqual(recs[1]["message"]["usage"]["input_tokens"], 3)
        self.assertNotIn("model", recs[0]["message"])
        self.assertEqual(recs[2]["message"]["content"], [{"type": "text", "text": "plain string"}])

    def test_no_cwd_key_without_cwd(self):
        recs, _ = self.convert([_msg("1", "user", "x")])
        self.assertNotIn("cwd", recs[0])

    def test_sidechain_flag_and_agent_prefix(self):
        recs, _ = self.convert([_msg("1", "user", "x")], agent="Ag", sidechain=True)
        self.assertEqual(recs[0]["uuid"], "S:Ag:1")
        self.assertTrue(recs[0]["isSidechain"])

    def test_user_attribution_wraps_non_user_text(self):
        recs, _ = self.convert([
            _msg("1", "user", "human"),
            _msg("2", "user", "parent says", attribution="agent"),
            _msg("3", "user", "   "),
            _msg("4", "user", [{"type": "text", "text": "blocks"}], attribution="user"),
            _msg("5", "developer", "dev"),
        ])
        texts = [r["message"]["content"][0]["text"] for r in recs]
        self.assertEqual(texts, ["human",
                                 "<system-reminder>\nparent says\n</system-reminder>",
                                 "blocks"])

    def test_assistant_blocks_text_thinking_toolcall(self):
        recs, _ = self.convert([
            _msg("1", "assistant", [
                {"type": "text", "text": "t"},
                {"type": "thinking", "thinking": "th"},
                {"type": "toolCall", "id": "c1", "name": "bash",
                 "arguments": {"command": "ls"}},
                {"type": "mystery"}, "junk", {"type": "text"}]),
            _msg("2", "assistant", [{"type": "mystery"}]),
            _msg("3", "assistant", 5),
        ])
        self.assertEqual(len(recs), 1)
        self.assertEqual(recs[0]["message"]["content"], [
            {"type": "text", "text": "t"},
            {"type": "thinking", "thinking": "th"},
            {"type": "tool_use", "id": "c1", "name": "Bash", "input": {"command": "ls"}},
            {"type": "text", "text": ""},
        ])

    def test_tool_results_pair_orphan_and_error(self):
        recs, _ = self.convert([
            _msg("1", "assistant", [{"type": "toolCall", "id": "c1", "name": "bash",
                                     "arguments": {}}]),
            _msg("2", "toolResult", [{"type": "text", "text": "out"}], toolCallId="c1"),
            _msg("3", "toolResult", "boom", toolCallId="gone", isError=True),
            _msg("4", "toolResult", "x"),
        ])
        r1 = recs[1]["message"]["content"]
        self.assertEqual(r1, [{"type": "tool_result", "tool_use_id": "c1",
                               "content": "out", "is_error": False}])
        r2 = recs[2]["message"]["content"][0]
        self.assertEqual((r2["tool_use_id"], r2["is_error"], r2["content"]),
                         ("orphan-gone", True, "boom"))
        self.assertEqual(recs[3]["message"]["content"][0]["tool_use_id"], "4:orphan")
        self.assertEqual(recs[1]["type"], "user")
        self.assertEqual(recs[1]["message"]["role"], "user")

    def test_batched_task_result_fans_out_to_every_tool_use(self):
        recs, _ = self.convert([
            _msg("1", "assistant", [{"type": "toolCall", "id": "c", "name": "task",
                                     "arguments": {"tasks": [{"task": "a"}, {"task": "b"}]}}]),
            _msg("2", "toolResult", "done", toolCallId="c"),
        ])
        ids = [b["tool_use_id"] for b in recs[1]["message"]["content"]]
        self.assertEqual(ids, ["c.0", "c.1"])

    def test_todo_uses_result_that_follows_call(self):
        recs, _ = self.convert([
            _msg("1", "assistant", [{"type": "toolCall", "id": "c", "name": "todo",
                                     "arguments": {}}]),
            _msg("2", "toolResult", "ok", toolCallId="c",
                 details={"phases": [{"tasks": [{"content": "x", "status": "done"}]}]}),
        ])
        self.assertEqual(recs[0]["message"]["content"][0]["input"]["todos"],
                         [{"content": "x", "status": "completed", "activeForm": "x"}])

    def test_bad_entry_is_skipped_with_warning(self):
        bad = _msg("1", "assistant", [{"type": "toolCall", "id": "c", "name": "bash",
                                       "arguments": {}}])
        with mock.patch.object(ot._Converter, "_map_tool_calls",
                               side_effect=RuntimeError("kaboom")):
            recs, err = self.convert([bad, _msg("2", "user", "ok")])
        self.assertEqual([r["uuid"] for r in recs], ["S:2"])
        self.assertIn("omp_transcript: skipped entry '1': RuntimeError: kaboom", err)

    def test_non_dict_message_and_duplicate_call_ids(self):
        recs, _ = self.convert([
            {"type": "message", "id": "0", "message": "str"},
            _msg("1", "assistant", [{"type": "toolCall", "id": "c", "name": "bash", "arguments": {}}]),
            _msg("2", "assistant", [{"type": "toolCall", "id": "c", "name": "bash", "arguments": {}}]),
        ])
        ids = [r["message"]["content"][0]["id"] for r in recs]
        self.assertEqual(ids, ["c", "c#2"])


class FileLevel(unittest.TestCase):
    def setUp(self):
        t = tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        self.dir = Path(t.name)

    def write(self, path, entries):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(json.dumps(e) for e in entries) + "\n")

    def lead(self):
        p = self.dir / "in" / "sess1.jsonl"
        self.write(p, [{"type": "session", "id": "META", "cwd": "/w"},
                       _msg("1", "user", "go"),
                       _msg("2", "assistant", [{"type": "text", "text": "ok"}])])
        return p

    def recs(self, path):
        return [json.loads(x) for x in Path(path).read_text().splitlines()]

    def test_session_id_precedence(self):
        p = self.lead()
        out = self.dir / "out" / "t.jsonl"
        self.assertEqual(ot.convert_file(str(p), str(out)),
                         {"ok": True, "out": str(out), "lines": 2, "session_id": "META"})
        self.assertEqual(self.recs(out)[0]["sessionId"], "META")
        self.assertEqual(self.recs(out)[0]["cwd"], "/w")
        self.assertEqual(ot.convert_file(str(p), str(out), "OVERRIDE")["session_id"], "OVERRIDE")
        q = self.dir / "in" / "nometa.jsonl"
        self.write(q, [_msg("1", "user", "go")])
        self.assertEqual(ot.convert_file(str(q), str(out))["session_id"], "nometa")

    def test_subagent_files_written_counted_and_stale_pruned(self):
        p = self.lead()
        sub = self.dir / "in" / "sess1"
        self.write(sub / "Worker.jsonl", [_msg("1", "user", "task for you"),
                                          _msg("2", "assistant", "done")])
        self.write(sub / "__advisor.jsonl", [_msg("1", "assistant", "advice")])
        self.write(sub / "advisor.jsonl", [_msg("1", "assistant", "second advisor")])
        self.write(sub / "empty.jsonl", [{"type": "title"}])
        (sub / "notes.txt").write_text("ignored")
        out = self.dir / "out" / "t.jsonl"
        stale = out.parent / "subagents" / "agent-gone.jsonl"
        stale.parent.mkdir(parents=True)
        stale.write_text("{}\n")
        keep = out.parent / "subagents" / "other.txt"
        keep.write_text("mine")
        res = ot.convert_file(str(p), str(out))
        self.assertEqual(res["lines"], 2 + 2 + 1 + 1)
        names = sorted(x.name for x in (out.parent / "subagents").iterdir())
        self.assertEqual(names, ["agent-Worker.jsonl", "agent-advisor-2.jsonl",
                                 "agent-advisor.jsonl", "other.txt"])
        w = self.recs(out.parent / "subagents" / "agent-Worker.jsonl")
        self.assertTrue(all(r["isSidechain"] and r["sessionId"] == "META" for r in w))
        self.assertEqual(w[0]["uuid"], "META:Worker:1")
        self.assertEqual(w[0]["cwd"], "/w")
        self.assertEqual(self.recs(out.parent / "subagents" / "agent-advisor.jsonl")[0]
                         ["message"]["content"][0]["text"], "advice")
        # idempotent rerun, leaves no tmp files
        res2 = ot.convert_file(str(p), str(out))
        self.assertEqual(res2["lines"], res["lines"])
        self.assertEqual([x.name for x in out.parent.glob(".omp-transcript-*")], [])

    def test_unreadable_subagent_file_does_not_lose_lead(self):
        p = self.lead()
        sub = self.dir / "in" / "sess1"
        self.write(sub / "Good.jsonl", [_msg("1", "user", "x")])
        self.write(sub / "Bad.jsonl", [_msg("1", "user", "x")])
        real = ot._load_entries

        def flaky(path):
            if path.endswith("Bad.jsonl"):
                raise OSError("denied")
            return real(path)
        out = self.dir / "out" / "t.jsonl"
        err = io.StringIO()
        with mock.patch.object(ot, "_load_entries", flaky), contextlib.redirect_stderr(err):
            res = ot.convert_file(str(p), str(out))
        self.assertEqual(res["lines"], 3)
        self.assertIn("skipped sub-agent file 'Bad.jsonl': OSError: denied", err.getvalue())
        self.assertTrue((out.parent / "subagents" / "agent-Good.jsonl").exists())

    def test_stale_removal_failure_only_warns(self):
        p = self.lead()
        out = self.dir / "out" / "t.jsonl"
        stale = out.parent / "subagents" / "agent-gone.jsonl"
        stale.parent.mkdir(parents=True)
        stale.write_text("{}\n")
        err = io.StringIO()
        with mock.patch.object(ot.os, "unlink", side_effect=OSError("busy")), \
                contextlib.redirect_stderr(err):
            res = ot.convert_file(str(p), str(out))
        self.assertTrue(res["ok"])
        self.assertIn("could not remove stale 'agent-gone.jsonl': busy", err.getvalue())

    def test_write_atomic_failure_cleans_temp_and_keeps_old_file(self):
        out = self.dir / "o" / "t.jsonl"
        ot._write_atomic(str(out), [{"a": "é"}])
        self.assertEqual(out.read_text(encoding="utf-8"), '{"a": "é"}\n')
        with mock.patch.object(ot.os, "replace", side_effect=OSError("nope")):
            with self.assertRaises(OSError):
                ot._write_atomic(str(out), [{"a": 2}])
        self.assertEqual(out.read_text(encoding="utf-8"), '{"a": "é"}\n')
        self.assertEqual([x.name for x in out.parent.iterdir()], ["t.jsonl"])

    def test_write_atomic_unusable_dir(self):
        blocker = self.dir / "file"
        blocker.write_text("x")
        with self.assertRaises(OSError) as cm:
            ot._write_atomic(str(blocker / "sub" / "t.jsonl"), [])
        self.assertIn("cannot create", str(cm.exception))


class MainEntry(unittest.TestCase):
    def setUp(self):
        t = tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        self.dir = Path(t.name)

    def run_main(self, argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = ot.main(argv)
        return rc, out.getvalue(), err.getvalue()

    def test_convert_success_prints_one_json_line(self):
        src = self.dir / "s.jsonl"
        src.write_text(json.dumps(_msg("1", "user", "hi")) + "\n")
        out = self.dir / "o.jsonl"
        rc, stdout, _ = self.run_main(["convert", "--session-file", str(src),
                                       "--out", str(out), "--session-id", "SID"])
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(stdout), {"ok": True, "out": str(out),
                                              "lines": 1, "session_id": "SID"})
        self.assertEqual(len(stdout.splitlines()), 1)

    def test_missing_file_is_fail_open_exit_zero(self):
        rc, stdout, _ = self.run_main(["convert", "--session-file", str(self.dir / "no"),
                                       "--out", str(self.dir / "o")])
        self.assertEqual(rc, 0)
        res = json.loads(stdout)
        self.assertFalse(res["ok"])
        self.assertTrue(res["error"].startswith("OSError: cannot read "))

    def test_no_subcommand_and_bad_args_exit_two(self):
        rc, stdout, _ = self.run_main([])
        self.assertEqual(rc, 2)
        self.assertEqual(json.loads(stdout)["ok"], False)
        self.assertIn("usage: omp_transcript.py convert", json.loads(stdout)["error"])
        rc, stdout, _ = self.run_main(["convert"])
        self.assertEqual(rc, 2)
        self.assertEqual(json.loads(stdout), {"ok": False, "error": "bad arguments"})

    def test_help_exits_zero_without_result_line(self):
        rc, stdout, _ = self.run_main(["--help"])
        self.assertEqual(rc, 0)
        self.assertIn("usage:", stdout)
        self.assertNotIn('"ok"', stdout)


class ToolMapLoader(unittest.TestCase):
    def test_plain_names_only_first_claude_name_wins(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / "c.json"
            p.write_text(json.dumps({"claudeToOmp": {
                "Task": "task", "Agent": "task", "ToolSearch": "tool search",
                "Bash": "bash", "bad name": "x", "TodoWrite": "todo",
                "Read": "Read"}}))
            m = ot._load_tool_map(str(p))
            self.assertEqual(m["task"], "Task")
            self.assertEqual(m["bash"], "Bash")
            self.assertEqual(m["todo"], "TodoWrite")
            self.assertEqual(m["find"], "Glob")
            self.assertEqual(m["web_search"], "WebSearch")
            self.assertNotIn("tool search", m)
            self.assertNotIn("x", m)

    def test_unreadable_or_malformed_contract_falls_back(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / "c.json"
            for body in ("nope", "{}", '{"claudeToOmp": []}', '{"claudeToOmp": 5}'):
                p.write_text(body)
                self.assertEqual(ot._load_tool_map(str(p)), ot._TOOL_MAP_FALLBACK, body)
            self.assertEqual(ot._load_tool_map(str(Path(t) / "none")), ot._TOOL_MAP_FALLBACK)


if __name__ == "__main__":
    unittest.main()
