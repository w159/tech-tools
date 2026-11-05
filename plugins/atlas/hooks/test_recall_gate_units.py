"""recall_gate unit contracts: temp-root resolution, recall detection, the plugin .mcp.json walk
and lenient payload parsing. Complements test_recall_gate.py."""

import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
)
import _test_isolation  # noqa: F401,E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import recall_gate  # noqa: E402

CC_SEARCH = "mcp__plugin_claude-mem_mcp-search__search"


class TempRootTest(unittest.TestCase):
    def _root(self, **env):
        base = {
            k: v for k, v in os.environ.items() if k not in ("TMPDIR", "TEMP", "TMP")
        }
        base.update(env)
        with mock.patch.dict(os.environ, base, clear=True):
            return recall_gate._temp_root()

    def test_no_variable_means_slash_tmp(self):
        self.assertEqual(self._root(), "/tmp")

    def test_variables_are_read_in_tmpdir_temp_tmp_order(self):
        self.assertEqual(self._root(TMPDIR="/a", TEMP="/b", TMP="/c"), "/a")
        self.assertEqual(self._root(TEMP="/b", TMP="/c"), "/b")
        self.assertEqual(self._root(TMP="/c"), "/c")

    def test_empty_variable_is_skipped_and_value_is_made_absolute(self):
        self.assertEqual(self._root(TMPDIR="", TEMP="/b"), "/b")
        cwd = os.getcwd()
        try:
            os.chdir("/")
            self.assertEqual(self._root(TMPDIR="rel/dir"), "/rel/dir")
        finally:
            os.chdir(cwd)

    def test_non_posix_uses_the_tempfile_module(self):
        with mock.patch.object(recall_gate.os, "name", "nt"), mock.patch(
            "tempfile.gettempdir", return_value="C:/Temp"
        ):
            self.assertEqual(recall_gate._temp_root(), "C:/Temp")


class IsRecallTest(unittest.TestCase):
    def test_claude_mem_tool_is_a_recall(self):
        self.assertIs(recall_gate._is_recall(CC_SEARCH, {}), True)
        self.assertIs(recall_gate._is_recall(CC_SEARCH, None), True)

    def test_write_to_a_claude_mem_device_is_a_recall_by_either_key(self):
        target = "xd://" + CC_SEARCH
        for key in ("path", "file_path"):
            self.assertIs(recall_gate._is_recall("Write", {key: target}), True, key)
            self.assertIs(recall_gate._is_recall("write", {key: target}), True, key)

    def test_write_needs_a_dict_input(self):
        for bad in (None, "xd://" + CC_SEARCH, ["xd://" + CC_SEARCH], 5):
            self.assertIs(recall_gate._is_recall("Write", bad), False, bad)

    def test_only_write_counts_as_a_device_write(self):
        target = {"path": "xd://" + CC_SEARCH}
        self.assertIs(recall_gate._is_recall("Read", target), False)
        self.assertIs(recall_gate._is_recall("Bash", target), False)

    def test_other_device_or_path_is_not_a_recall(self):
        for value in ("xd://mcp__other__tool", "/tmp/x", CC_SEARCH, 7, None):
            self.assertIs(recall_gate._is_recall("Write", {"path": value}), False, value)


class PluginMcpFilesTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()

    def _touch(self, *parts):
        d = os.path.join(self.root, *parts[:-1])
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, parts[-1])
        with open(path, "w") as f:
            f.write("{}")
        return path

    def test_yields_mcp_json_only_inside_a_claude_mem_directory(self):
        want = self._touch("cache", "claude-mem", "1.0", ".mcp.json")
        self._touch("cache", "other-plugin", ".mcp.json")
        self._touch("cache", "claude-mem", "1.0", "README.md")
        self._touch("cache", "claude_mem2", "x", "package.json")
        also = self._touch("cache", "Claude_Mem", ".mcp.json")
        got = sorted(recall_gate._plugin_mcp_files(self.root))
        self.assertEqual(got, sorted([want, also]))

    def test_node_modules_and_git_are_not_walked(self):
        self._touch("claude-mem", "node_modules", "dep", ".mcp.json")
        self._touch("claude-mem", ".git", ".mcp.json")
        self.assertEqual(list(recall_gate._plugin_mcp_files(self.root)), [])

    def test_walk_is_bounded_in_depth(self):
        deep_ok = self._touch("claude-mem", "a", "b", "c", "d", "e", ".mcp.json")
        self._touch("claude-mem", "a", "b", "c", "d", "e", "f", "g", "h", ".mcp.json")
        got = list(recall_gate._plugin_mcp_files(self.root))
        self.assertEqual(got, [deep_ok])

    def test_missing_dir_yields_nothing(self):
        self.assertEqual(
            list(recall_gate._plugin_mcp_files(os.path.join(self.root, "nope"))), []
        )


class MainParsingTest(unittest.TestCase):
    def _main(self, raw):
        seen = []
        with mock.patch.object(
            recall_gate, "_decide", side_effect=lambda d: seen.append(d)
        ), mock.patch("sys.stdin", new=io.StringIO(raw)), mock.patch(
            "sys.stdout", new=io.StringIO()
        ) as out:
            code = recall_gate.main()
        return code, seen, out.getvalue()

    def test_raw_control_characters_inside_strings_are_accepted(self):
        code, seen, out = self._main('{"tool_name": "a\nb"}')
        self.assertEqual(code, 0)
        self.assertEqual(seen, [{"tool_name": "a\nb"}])
        self.assertEqual(out, "")

    def test_blank_stdin_is_an_empty_payload(self):
        self.assertEqual(self._main("  \n")[1], [{}])

    def test_non_object_json_is_an_empty_payload(self):
        for raw in ("null", "[1]", '"x"'):
            self.assertEqual(self._main(raw)[1], [{}], raw)

    def test_invalid_json_exits_clean_without_deciding(self):
        code, seen, out = self._main("{nope")
        self.assertEqual((code, seen, out), (0, [], ""))

    def test_a_reason_is_printed_as_a_pretooluse_deny(self):
        with mock.patch.object(recall_gate, "_decide", return_value="why"), mock.patch(
            "sys.stdin", new=io.StringIO("{}")
        ), mock.patch("sys.stdout", new=io.StringIO()) as out:
            self.assertEqual(recall_gate.main(), 0)
        spec = json.loads(out.getvalue())["hookSpecificOutput"]
        self.assertEqual(
            spec,
            {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": "why",
            },
        )


class JsonServersTest(unittest.TestCase):
    def _file(self, text):
        d = tempfile.mkdtemp()
        path = os.path.join(d, "x.json")
        with open(path, "w") as f:
            f.write(text)
        return path

    def test_returns_the_mcp_servers_mapping(self):
        path = self._file('{"mcpServers": {"claude-mem": {"command": "x"}}}')
        self.assertEqual(
            recall_gate._json_servers(path), {"claude-mem": {"command": "x"}}
        )

    def test_anything_else_is_an_empty_dict(self):
        for text in ("[1]", "{}", '{"mcpServers": [1]}', "not json", '{"mcpServers": null}'):
            self.assertEqual(recall_gate._json_servers(self._file(text)), {}, text)
        self.assertEqual(recall_gate._json_servers("/nonexistent/x.json"), {})


class ClaudeMemEnabledTest(unittest.TestCase):
    def test_delegates_to_tool_routing_with_the_cwd(self):
        import tool_routing

        for verdict in (True, False):
            with mock.patch.object(
                tool_routing, "plugin_enabled", return_value=verdict
            ) as pe:
                self.assertIs(recall_gate._claude_mem_enabled("/repo"), verdict)
            pe.assert_called_once_with("claude-mem", "/repo")


if __name__ == "__main__":
    unittest.main()
