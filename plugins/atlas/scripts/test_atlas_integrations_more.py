#!/usr/bin/env python3
"""atlas_integrations: unknown plugin state, colon paths, thread-row and channel-name mapping."""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import atlas_integrations as ai  # noqa: E402
import test_atlas_integrations as T  # noqa: E402


class TestUnknownPluginState(T.Base):
    def test_notes_say_plugin_state_unknown_only_when_plugin_list_unreadable(self):
        known = {t["name"]: t for t in ai.detect(refresh=True)["tools"]}
        self.assertEqual(
            known["herdr-projects"]["notes"],
            "read-only list; thread start only on explicit POST",
        )
        self.assertEqual(
            known["herdr-file-viewer"]["notes"],
            "opened per click with a pinned absolute root",
        )
        with mock.patch.object(ai, "_plugins", return_value=None):
            unknown = {t["name"]: t for t in ai.detect(refresh=True)["tools"]}
        for name in ("herdr-projects", "herdr-file-viewer", "captains-deck"):
            self.assertEqual(
                unknown[name]["notes"], "herdr not found: plugin state unknown"
            )
            self.assertFalse(unknown[name]["installed"])
            self.assertFalse(unknown[name]["enabled"])
            self.assertIsNone(unknown[name]["version"])


class TestOpenFileColon(T.Base):
    def test_colon_in_relative_path_is_refused_without_opening(self):
        f = self.project / "src" / "a:b.py"
        f.write_text("x\n")
        r = ai.open_file(str(f), str(self.project), self.known)
        self.assertIsInstance(r, dict)
        self.assertFalse(r["ok"])
        self.assertEqual(r["error"], "unsupported_path")
        self.assertEqual(r["http"], 400)
        self.assertEqual(self.opens(), [])


class TestOpenFileNotAFile(T.Base):
    def test_directory_target_is_refused_as_not_a_file(self):
        r = ai.open_file(str(self.project / "src"), str(self.project), self.known)
        self.assertEqual((r["ok"], r["error"], r["http"]), (False, "not_a_file", 400))
        self.assertEqual(self.opens(), [])


class TestChannelNames(unittest.TestCase):
    def test_missing_base_or_branch_gives_none_pair(self):
        self.assertEqual(ai._channel_names({"repo": "/r/proj"}), (None, None))
        self.assertEqual(ai._channel_names({"branch": "b"}), (None, None))
        self.assertEqual(ai._channel_names({}), (None, None))

    def test_name_from_repo_basename_else_cwd_basename(self):
        self.assertEqual(
            ai._channel_names({"repo": "/r/proj/", "branch": "hp/x"}), ("proj@hp/x", None)
        )
        self.assertEqual(
            ai._channel_names({"cwd": "/w/tree1", "branch": "b"}), ("tree1@b", None)
        )

    def test_parent_from_atlas_main_channel_for_existing_repo_dir(self):
        import atlas_todo

        repo = T.tempfile.mkdtemp()
        with mock.patch.object(atlas_todo, "main_channel", return_value="main-x") as mc:
            ch, parent = ai._channel_names({"repo": repo, "branch": "b"})
        mc.assert_called_once_with(repo)
        self.assertEqual((ch, parent), (os.path.basename(repo) + "@b", "main-x"))
        with mock.patch.object(atlas_todo, "main_channel", side_effect=RuntimeError("x")):
            self.assertEqual(
                ai._channel_names({"repo": repo, "branch": "b"})[1], None
            )


class TestThreadRow(unittest.TestCase):
    def test_cwd_falls_back_to_worktree_path_then_none(self):
        with mock.patch.object(ai, "_channel_names", return_value=(None, None)):
            self.assertEqual(ai._thread_row({"cwd": "/c", "worktree_path": "/w"})["cwd"], "/c")
            self.assertEqual(ai._thread_row({"worktree_path": "/w"})["cwd"], "/w")
            self.assertIsNone(ai._thread_row({})["cwd"])

    def test_channel_path_joins_parent_and_channel(self):
        with mock.patch.object(ai, "_channel_names", return_value=("p@b", "main")):
            row = ai._thread_row({"id": "t", "pr": "", "branch": ""})
        self.assertEqual((row["channel"], row["channel_parent"]), ("p@b", "main"))
        self.assertEqual(row["channel_path"], "main/p@b")
        self.assertIsNone(row["pr"])
        self.assertIsNone(row["branch"])
        with mock.patch.object(ai, "_channel_names", return_value=("p@b", None)):
            self.assertEqual(ai._thread_row({})["channel_path"], "p@b")
        with mock.patch.object(ai, "_channel_names", return_value=(None, None)):
            self.assertIsNone(ai._thread_row({})["channel_path"])


class TestPluginsNormalisation(T.Base):
    def test_fallback_json_skips_junk_rows_and_keeps_fields(self):
        (self.bin / "herdr").unlink()
        cfgdir = self.home / ".config" / "herdr"
        cfgdir.mkdir(parents=True)
        (cfgdir / "plugins.json").write_text(
            T.json.dumps(
                [
                    "junk",
                    None,
                    {"name": "no id"},
                    {"plugin_id": "a", "version": "1.2", "enabled": 1,
                     "plugin_root": "/r", "name": "A"},
                    {"plugin_id": "b"},
                ]
            )
        )
        self.assertEqual(
            ai._plugins(),
            {
                "a": {"version": "1.2", "enabled": True, "root": "/r", "name": "A"},
                "b": {"version": None, "enabled": False, "root": None, "name": None},
            },
        )


class TestMcpServers(T.Base):
    def test_type_declared_inferred_or_absent_across_sources(self):
        (self.home / ".mcp.json").write_text(
            T.json.dumps(
                {
                    "mcpServers": {
                        "declared": {"type": "sse", "command": "x"},
                        "inferred": {"command": "node"},
                        "bare": {"url": "http://u"},
                        "badcfg": "oops",
                    }
                }
            )
        )
        (self.home / ".claude.json").write_text(
            T.json.dumps(
                {
                    "mcpServers": {"g": {"command": "c"}},
                    "projects": {"/p": {"mcpServers": {"pp": {"type": "http"}}}, "/q": 5},
                }
            )
        )
        got = {(m["name"], m["source"]): m["type"] for m in ai.mcp_servers()}
        self.assertEqual(
            got,
            {
                ("declared", "~/.mcp.json"): "sse",
                ("inferred", "~/.mcp.json"): "stdio",
                ("bare", "~/.mcp.json"): None,
                ("badcfg", "~/.mcp.json"): None,
                ("g", "~/.claude.json"): "stdio",
                ("pp", "~/.claude.json#project"): "http",
            },
        )

    def test_no_config_files_gives_empty(self):
        self.assertEqual(ai.mcp_servers(), [])


class TestCmux(unittest.TestCase):
    def cmux(self, run_result, which_result="/bin/cmux"):
        with (
            mock.patch.object(ai, "run", return_value=run_result),
            mock.patch.object(ai, "which", return_value=which_result),
        ):
            return ai._cmux()

    def test_not_running_reports_installed_from_which(self):
        self.assertEqual(
            self.cmux({"ok": False, "error": "x"}), {"installed": True, "running": False}
        )
        self.assertEqual(
            self.cmux({"ok": False, "error": "x"}, None),
            {"installed": False, "running": False},
        )

    def test_unparseable_output_is_running_without_details(self):
        self.assertEqual(
            self.cmux({"ok": True, "out": "not json"}), {"installed": True, "running": True}
        )

    def test_counts_browser_capabilities(self):
        out = T.json.dumps(
            {"access_mode": "full", "capabilities": ["browser.open", "browser.tab", "ws.list", 3]}
        )
        self.assertEqual(
            self.cmux({"ok": True, "out": out}),
            {"installed": True, "running": True, "access_mode": "full", "browser_capabilities": 2},
        )

    def test_non_dict_json_has_no_access_mode_and_zero_capabilities(self):
        self.assertEqual(
            self.cmux({"ok": True, "out": "[1]"}),
            {"installed": True, "running": True, "access_mode": None, "browser_capabilities": 0},
        )


class TestRunCap(unittest.TestCase):
    def test_stdout_capped_at_one_mebibyte_and_stderr_at_4k(self):
        code = "import sys; sys.stdout.write('x' * (3 << 20)); sys.stderr.write('e' * 9000)"
        with mock.patch.object(ai, "which", return_value=sys.executable):
            r = ai.run(["py", "-c", code], timeout=60)
        self.assertEqual((len(r["out"]), len(r["err"])), (1 << 20, 4096))
        self.assertTrue(r["ok"])
        self.assertEqual(ai.OUT_CAP, 1 << 20)

    def test_missing_binary_and_timeout(self):
        with mock.patch.object(ai, "which", return_value=None):
            self.assertEqual(ai.run(["nope"]), {"ok": False, "error": "not_found"})
        with mock.patch.object(ai, "which", return_value=sys.executable):
            r = ai.run(["py", "-c", "import time; time.sleep(5)"], timeout=0.2)
        self.assertEqual(r, {"ok": False, "error": "timeout"})


class TestResolveErrors(T.Base):
    def code(self, path, root):
        r = ai._resolve(path, root, self.known)
        self.assertEqual(len(r), 3)
        return None if r[2] is None else (r[2]["error"], r[2]["http"])

    def test_error_codes_per_branch(self):
        p = str(self.project / "src" / "app.py")
        root = str(self.project)
        self.assertEqual(self.code("", root), ("bad_path", 400))
        self.assertEqual(self.code(p, "rel"), ("root_must_be_absolute", 400))
        self.assertEqual(self.code(p, str(self.tmp / "nodir")), ("bad_root", 400))
        self.assertEqual(self.code(p, str(self.tmp)), ("unknown_root", 403))
        self.assertEqual(self.code("/etc/hostname", root), ("path_outside_root", 403))
        self.assertEqual(self.code(".git/config", root), ("forbidden_path", 403))
        self.assertEqual(self.code("src/missing.py", root), ("not_found", 404))
        rroot, rpath, bad = ai._resolve("src/app.py", root, self.known)
        self.assertEqual((rroot, rpath, bad), (root, p, None))


class TestDeckStatus(T.Base):
    def test_no_firstmate_homes(self):
        d = ai.deck_status()
        self.assertIs(d["ok"], True)
        self.assertEqual(d["plugin_id"], ai.PLUGIN_DECK)
        self.assertEqual(d["homes"], [])
        self.assertTrue(d["installed"] and d["enabled"])

    def test_homes_but_plugin_missing(self):
        (self.home / "firstmate").mkdir()
        with mock.patch.object(ai, "_plugins", return_value={}):
            d = ai.deck_status()
        self.assertIs(d["ok"], True)
        self.assertFalse(d["installed"] or d["enabled"])
        self.assertEqual(
            (d["available"], d["reason"]), (False, "Captain's Deck plugin not installed")
        )

    def test_probe_script_output_is_listed_when_plugin_root_has_it(self):
        (self.home / "firstmate").mkdir()
        root = self.tmp / "deckroot"
        (root / "scripts").mkdir(parents=True)
        (root / "scripts" / "kanban-view.sh").write_text("echo h1\necho h2\n")
        plug = {ai.PLUGIN_DECK: {"version": "1", "enabled": True, "root": str(root), "name": "d"}}
        with mock.patch.object(ai, "_plugins", return_value=plug):
            d = ai.deck_status()
        self.assertIs(d["ok"], True)
        self.assertEqual(d["discovered"], ["h1", "h2"])
        self.assertTrue(d["available"])
        self.assertIsNone(d["reason"])

    def test_fm_flow_homes_env_adds_existing_unique_dirs(self):
        extra = self.tmp / "fm"
        extra.mkdir()
        os.environ["FM_FLOW_HOMES"] = f"{extra}:{extra}:/nonexistent::"
        self.assertEqual(ai._firstmate_homes(), [str(extra)])
        (self.home / "firstmate").mkdir()
        self.assertEqual(ai._firstmate_homes(), [str(self.home / "firstmate"), str(extra)])


if __name__ == "__main__":
    unittest.main()
