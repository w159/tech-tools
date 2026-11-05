#!/usr/bin/env python3
"""Tests for scripts/tool_routing.py."""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import tool_routing  # noqa: E402


def write(path, text="x\n"):
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


class ScanStackTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        import shutil

        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_empty(self):
        s = tool_routing.scan_stack(self.tmp)
        self.assertFalse(s["has_code"])
        self.assertFalse(s["js_ts"])

    def test_python_code(self):
        write(os.path.join(self.tmp, "main.py"), "print(1)\n")
        s = tool_routing.scan_stack(self.tmp)
        self.assertTrue(s["has_code"])
        self.assertTrue(s["python"])
        self.assertIn("python", s["languages"])

    def test_js_package(self):
        write(os.path.join(self.tmp, "package.json"), '{"name":"x"}\n')
        s = tool_routing.scan_stack(self.tmp)
        self.assertTrue(s["js_ts"])
        self.assertTrue(s["has_code"])

    def test_serena_yml_languages(self):
        write(
            os.path.join(self.tmp, ".serena", "project.yml"),
            'languages: ["python"]\n',
        )
        write(os.path.join(self.tmp, "a.py"), "x=1\n")
        s = tool_routing.scan_stack(self.tmp)
        self.assertTrue(s["serena_yml"])
        self.assertTrue(s["serena_languages_ok"])


class BootLinesTests(unittest.TestCase):
    def test_always_has_routing_line(self):
        lines = tool_routing.boot_lines(stack={"has_code": False, "js_ts": False})
        self.assertTrue(any("Tool routing" in L for L in lines))
        self.assertTrue(any("serena" in L for L in lines))

    def test_code_mentions_activate(self):
        lines = tool_routing.boot_lines(
            stack={
                "has_code": True,
                "languages": ["python"],
                "serena_yml": True,
                "serena_languages_ok": True,
                "js_ts": False,
            }
        )
        blob = "\n".join(lines)
        self.assertIn("activate_project", blob)
        self.assertIn("tool-routing.md", blob)

    def test_routes_only_present_tools(self):
        stack = {"has_code": True, "languages": ["python"], "js_ts": False}
        lines = tool_routing.boot_lines(stack=stack, present={"serena"})
        blob = "\n".join(lines)
        self.assertIn("serena", blob)
        for absent in ("lean-ctx", "context-mode", "claude-mem"):
            self.assertNotIn(absent, blob)

    def test_nothing_present_emits_no_routing(self):
        stack = {"has_code": True, "languages": ["python"], "js_ts": False}
        self.assertEqual(tool_routing.boot_lines(stack=stack, present=set()), [])

    def test_js_mentions_fallow(self):
        lines = tool_routing.boot_lines(
            stack={"has_code": True, "languages": ["typescript"], "js_ts": True}
        )
        self.assertTrue(any("fallow" in L for L in lines))


class BatchTests(unittest.TestCase):
    def test_batch_includes_activate_and_edit(self):
        b = tool_routing.TOOLSEARCH_BATCH
        self.assertIn("activate_project", b)
        self.assertIn("replace_symbol_body", b)
        self.assertIn("ctx_compose", b)
        self.assertIn("ToolSearch", b)


import contextlib  # noqa: E402
import io  # noqa: E402
import json  # noqa: E402
from pathlib import Path  # noqa: E402
from unittest import mock  # noqa: E402


class HomeCase(unittest.TestCase):
    """A fake HOME and project root; ATLAS_HARNESS cleared unless a test sets it."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(__import__("shutil").rmtree, str(self.tmp), True)
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.proj = self.tmp / "proj"
        self.proj.mkdir()
        p = mock.patch.object(tool_routing.Path, "home", return_value=self.home)
        p.start()
        self.addCleanup(p.stop)
        e = mock.patch.dict(os.environ)
        e.start()
        self.addCleanup(e.stop)
        os.environ.pop("ATLAS_HARNESS", None)

    def put(self, path, obj):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(obj if isinstance(obj, str) else json.dumps(obj))

    def lock(self, obj):
        self.put(self.home / ".omp" / "plugins" / "omp-plugins.lock.json", obj)

    def user_settings(self, obj):
        self.put(self.home / ".claude" / "settings.json", obj)

    def proj_settings(self, obj, local=False):
        name = "settings.local.json" if local else "settings.json"
        self.put(self.proj / ".claude" / name, obj)


class OmpPluginState(HomeCase):
    def test_enabled_true_and_false(self):
        self.lock({"plugins": {"a": {"enabled": True}, "b": {"enabled": False}}})
        self.assertIs(tool_routing._omp_plugin_state("a"), True)
        self.assertIs(tool_routing._omp_plugin_state("b"), False)

    def test_entry_without_enabled_key_is_false_not_none(self):
        self.lock({"plugins": {"a": {}}})
        self.assertIs(tool_routing._omp_plugin_state("a"), False)

    def test_name_not_in_lock_is_none(self):
        self.lock({"plugins": {"a": {"enabled": True}}})
        self.assertIsNone(tool_routing._omp_plugin_state("zzz"))

    def test_non_dict_entry_is_none(self):
        self.lock({"plugins": {"a": "yes", "b": True, "c": None}})
        for n in "abc":
            self.assertIsNone(tool_routing._omp_plugin_state(n), n)

    def test_missing_lock_is_none(self):
        self.assertIsNone(tool_routing._omp_plugin_state("a"))

    def test_malformed_json_is_none(self):
        self.lock("{not json")
        self.assertIsNone(tool_routing._omp_plugin_state("a"))

    def test_plugins_null_or_absent_is_none(self):
        self.lock({"plugins": None})
        self.assertIsNone(tool_routing._omp_plugin_state("a"))
        self.lock({"other": 1})
        self.assertIsNone(tool_routing._omp_plugin_state("a"))

    def test_top_level_not_an_object_is_none(self):
        self.lock([1, 2])  # list has no .get -> AttributeError swallowed
        self.assertIsNone(tool_routing._omp_plugin_state("a"))

    def test_plugins_not_an_object_is_none(self):
        self.lock({"plugins": ["a"]})
        self.assertIsNone(tool_routing._omp_plugin_state("a"))


class PluginEnabled(HomeCase):
    def test_nothing_configured_is_false(self):
        self.assertIs(tool_routing.plugin_enabled("atlas", str(self.proj)), False)

    def test_user_settings_enable_by_name_before_at_marketplace(self):
        self.user_settings({"enabledPlugins": {"atlas@tech-tools": True}})
        self.assertIs(tool_routing.plugin_enabled("atlas"), True)

    def test_name_must_match_exactly_not_by_prefix(self):
        self.user_settings({"enabledPlugins": {"atlas-extra@m": True}})
        self.assertIs(tool_routing.plugin_enabled("atlas"), False)

    def test_false_value_is_disabled(self):
        self.user_settings({"enabledPlugins": {"atlas@m": False}})
        self.assertIs(tool_routing.plugin_enabled("atlas"), False)

    def test_project_settings_override_user(self):
        self.user_settings({"enabledPlugins": {"atlas@m": True}})
        self.proj_settings({"enabledPlugins": {"atlas@m": False}})
        self.assertIs(tool_routing.plugin_enabled("atlas", str(self.proj)), False)

    def test_local_settings_override_project(self):
        self.proj_settings({"enabledPlugins": {"atlas@m": False}})
        self.proj_settings({"enabledPlugins": {"atlas@m": True}}, local=True)
        self.assertIs(tool_routing.plugin_enabled("atlas", str(self.proj)), True)

    def test_project_files_ignored_without_root(self):
        self.proj_settings({"enabledPlugins": {"atlas@m": True}})
        self.assertIs(tool_routing.plugin_enabled("atlas"), False)

    def test_bad_user_file_does_not_hide_the_project_file(self):
        self.user_settings("{broken")
        self.proj_settings({"enabledPlugins": {"atlas@m": True}})
        self.assertIs(tool_routing.plugin_enabled("atlas", str(self.proj)), True)

    def test_non_dict_enabledplugins_is_skipped_and_later_files_still_read(self):
        self.user_settings({"enabledPlugins": ["atlas@m"]})
        self.proj_settings({"enabledPlugins": {"atlas@m": True}})
        self.assertIs(tool_routing.plugin_enabled("atlas", str(self.proj)), True)

    def test_settings_top_level_list_is_skipped(self):
        self.user_settings([1])
        self.proj_settings({"enabledPlugins": {"atlas@m": True}})
        self.assertIs(tool_routing.plugin_enabled("atlas", str(self.proj)), True)

    def test_omp_lock_overrides_claude_settings_when_harness_is_omp(self):
        self.user_settings({"enabledPlugins": {"atlas@m": True}})
        self.lock({"plugins": {"atlas": {"enabled": False}}})
        os.environ["ATLAS_HARNESS"] = "omp"
        self.assertIs(tool_routing.plugin_enabled("atlas"), False)
        self.lock({"plugins": {"atlas": {"enabled": True}}})
        self.user_settings({"enabledPlugins": {"atlas@m": False}})
        self.assertIs(tool_routing.plugin_enabled("atlas"), True)

    def test_omp_lock_ignored_when_harness_is_not_omp(self):
        self.lock({"plugins": {"atlas": {"enabled": True}}})
        self.assertIs(tool_routing.plugin_enabled("atlas"), False)
        os.environ["ATLAS_HARNESS"] = "claude"
        self.assertIs(tool_routing.plugin_enabled("atlas"), False)

    def test_omp_harness_falls_back_to_claude_settings_when_lock_silent(self):
        os.environ["ATLAS_HARNESS"] = "omp"
        self.user_settings({"enabledPlugins": {"atlas@m": True}})
        self.lock({"plugins": {"other": {"enabled": False}}})
        self.assertIs(tool_routing.plugin_enabled("atlas"), True)


class ScanStackMore(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(__import__("shutil").rmtree, self.tmp, True)

    def w(self, rel, text="x\n"):
        write(os.path.join(self.tmp, *rel.split("/")), text)

    def test_result_shape_and_root_is_absolute(self):
        s = tool_routing.scan_stack(self.tmp)
        self.assertEqual(s["root"], os.path.abspath(self.tmp))
        self.assertEqual(s["languages"], [])
        for k in (
            "has_code",
            "js_ts",
            "python",
            "has_package_json",
            "has_pyproject",
            "serena_yml",
            "serena_languages_ok",
            "docs",
        ):
            self.assertIs(s[k], False, k)

    def test_pyproject_markers_each_flag_python(self):
        for name in ("pyproject.toml", "setup.py", "requirements.txt"):
            with self.subTest(name):
                d = tempfile.mkdtemp()
                self.addCleanup(__import__("shutil").rmtree, d, True)
                write(os.path.join(d, name))
                s = tool_routing.scan_stack(d)
                self.assertTrue(s["has_pyproject"] and s["python"] and s["has_code"])
                self.assertFalse(s["js_ts"])

    def test_package_json_sets_pkg_flag_not_python(self):
        self.w("package.json", "{}")
        s = tool_routing.scan_stack(self.tmp)
        self.assertTrue(s["has_package_json"] and s["js_ts"] and s["has_code"])
        self.assertFalse(s["python"] or s["has_pyproject"])

    def test_extension_to_language_mapping(self):
        cases = {
            "a.ts": "typescript",
            "b.tsx": "typescript",
            "c.js": "typescript",
            "d.jsx": "typescript",
            "e.mjs": "typescript",
            "f.cjs": "typescript",
            "g.go": "go",
            "h.rs": "rust",
            "i.java": "java",
            "j.cs": "csharp",
            "k.rb": "ruby",
            "l.php": "php",
            "m.kt": "kotlin",
            "n.swift": "swift",
            "o.cpp": "cpp",
            "p.c": "c",
            "Q.PY": "python",
        }
        for fn, lang in cases.items():
            with self.subTest(fn):
                d = tempfile.mkdtemp()
                self.addCleanup(__import__("shutil").rmtree, d, True)
                write(os.path.join(d, fn))
                s = tool_routing.scan_stack(d)
                self.assertEqual(s["languages"], [lang])
                self.assertTrue(s["has_code"])
                self.assertIs(s["js_ts"], lang == "typescript")
                self.assertIs(s["python"], lang == "python")

    def test_unknown_extension_is_not_code(self):
        self.w("notes.txt")
        self.w("README.md")
        self.assertFalse(tool_routing.scan_stack(self.tmp)["has_code"])

    def test_languages_ranked_by_count_and_capped_at_five(self):
        for i in range(3):
            self.w(f"a{i}.go")
        for i in range(2):
            self.w(f"b{i}.rs")
        self.w("c.py")
        self.w("d.rb")
        self.w("e.php")
        self.w("f.java")
        langs = tool_routing.scan_stack(self.tmp)["languages"]
        self.assertEqual(len(langs), 5)
        self.assertEqual(langs[:2], ["go", "rust"])

    def test_vendor_and_hidden_venv_dirs_are_skipped(self):
        for d in (
            "node_modules",
            ".git",
            "venv",
            ".venv",
            ".venv.nosync.noindex",
            ".venv-custom",
            "dist",
            "build",
            "__pycache__",
            ".next",
            ".nuxt",
            "target",
            "vendor",
        ):
            self.w(f"{d}/package.json", "{}")
            self.w(f"{d}/x.go")
        s = tool_routing.scan_stack(self.tmp)
        self.assertFalse(s["has_code"])
        self.assertFalse(s["has_package_json"])

    def test_nested_source_is_found(self):
        self.w("src/deep/mod.rs")
        s = tool_routing.scan_stack(self.tmp)
        self.assertEqual(s["languages"], ["rust"])

    def test_docs_dir_detected_even_when_empty_or_nested(self):
        os.makedirs(os.path.join(self.tmp, "docs"))
        self.assertTrue(tool_routing.scan_stack(self.tmp)["docs"])

    def test_docs_lookalike_names_are_not_docs(self):
        self.w("docsite/readme.txt")
        self.w("src/docs/x.txt")  # not at the root: rel != docs
        self.assertFalse(tool_routing.scan_stack(self.tmp)["docs"])

    def test_docs_subdirectory_with_files(self):
        self.w("docs/guide/a.md")
        self.assertTrue(tool_routing.scan_stack(self.tmp)["docs"])

    def test_serena_yml_without_languages_key(self):
        self.w(".serena/project.yml", "name: x\n  languages: [py]\n")
        s = tool_routing.scan_stack(self.tmp)
        self.assertTrue(s["serena_yml"])
        self.assertFalse(s["serena_languages_ok"])  # indented key is not top level

    def test_serena_project_yaml_spelling_counts(self):
        self.w(".serena/project.yaml", "languages:\n- python\n")
        s = tool_routing.scan_stack(self.tmp)
        self.assertTrue(s["serena_yml"] and s["serena_languages_ok"])

    def test_serena_other_filename_is_ignored(self):
        self.w(".serena/other.yml", "languages: [x]\n")
        s = tool_routing.scan_stack(self.tmp)
        self.assertFalse(s["serena_yml"])

    def test_project_yml_outside_serena_dir_is_ignored(self):
        self.w("cfg/project.yml", "languages: [x]\n")
        self.assertFalse(tool_routing.scan_stack(self.tmp)["serena_yml"])

    def test_canonical_serena_path_found_when_walk_budget_cuts_it_off(self):
        for i in range(5):
            self.w(f"f{i}.txt")
        self.w(".serena/project.yml", "languages: [python]\n")
        s = tool_routing.scan_stack(self.tmp, budget=1)
        self.assertTrue(s["serena_yml"])
        self.assertTrue(s["serena_languages_ok"])

    def test_canonical_serena_path_without_languages(self):
        for i in range(5):
            self.w(f"f{i}.txt")
        self.w(".serena/project.yml", "name: x\n")
        s = tool_routing.scan_stack(self.tmp, budget=1)
        self.assertTrue(s["serena_yml"])
        self.assertFalse(s["serena_languages_ok"])

    def test_budget_stops_the_walk_after_the_current_directory(self):
        for i in range(3):
            self.w(f"f{i}.txt")
        self.w("sub/a.go")
        s = tool_routing.scan_stack(self.tmp, budget=2)
        self.assertEqual(s["languages"], [])  # never descended into sub/
        full = tool_routing.scan_stack(self.tmp)
        self.assertEqual(full["languages"], ["go"])

    def test_unreadable_serena_yml_is_swallowed(self):
        self.w(".serena/project.yml", "languages: [x]\n")
        with mock.patch.object(Path, "read_text", side_effect=OSError("no")):
            s = tool_routing.scan_stack(self.tmp)
        self.assertTrue(s["serena_yml"])
        self.assertFalse(s["serena_languages_ok"])

    def test_missing_root_returns_empty_stack(self):
        s = tool_routing.scan_stack(os.path.join(self.tmp, "nope"))
        self.assertFalse(s["has_code"])


class McpConfigured(HomeCase):
    def test_nothing_configured_is_false(self):
        self.assertIs(tool_routing.mcp_configured("serena", str(self.proj)), False)

    def test_user_level_mcp_servers(self):
        self.put(self.home / ".claude.json", {"mcpServers": {"serena": {}}})
        self.assertIs(tool_routing.mcp_configured("serena"), True)
        self.assertIs(tool_routing.mcp_configured("other"), False)

    def test_per_project_mcp_servers_need_matching_root(self):
        root = str(self.proj)
        self.put(
            self.home / ".claude.json",
            {"projects": {root: {"mcpServers": {"serena": {}}}}},
        )
        self.assertIs(tool_routing.mcp_configured("serena", root), True)
        self.assertIs(tool_routing.mcp_configured("serena", str(self.tmp)), False)
        self.assertIs(tool_routing.mcp_configured("serena"), False)  # no root

    def test_project_entry_that_is_not_a_dict_is_ignored(self):
        root = str(self.proj)
        self.put(self.home / ".claude.json", {"projects": {root: ["serena"]}})
        self.assertIs(tool_routing.mcp_configured("serena", root), False)

    def test_projects_not_a_dict_is_ignored(self):
        self.put(self.home / ".claude.json", {"projects": [str(self.proj)]})
        self.assertIs(tool_routing.mcp_configured("serena", str(self.proj)), False)

    def test_project_mcp_json(self):
        self.put(self.proj / ".mcp.json", {"mcpServers": {"lean-ctx": {}}})
        self.assertIs(tool_routing.mcp_configured("lean-ctx", str(self.proj)), True)
        self.assertIs(tool_routing.mcp_configured("lean-ctx"), False)  # root omitted

    def test_mcp_servers_must_be_a_dict(self):
        self.put(self.proj / ".mcp.json", {"mcpServers": ["serena"]})
        self.assertIs(tool_routing.mcp_configured("serena", str(self.proj)), False)

    def test_bad_first_source_does_not_hide_the_second(self):
        self.put(self.home / ".claude.json", "{broken")
        self.put(self.proj / ".mcp.json", {"mcpServers": {"serena": {}}})
        self.assertIs(tool_routing.mcp_configured("serena", str(self.proj)), True)

    def test_non_dict_json_document_is_skipped(self):
        self.put(self.home / ".claude.json", [1])
        self.put(self.proj / ".mcp.json", {"mcpServers": {"serena": {}}})
        self.assertIs(tool_routing.mcp_configured("serena", str(self.proj)), True)

    def test_enabled_plugin_counts(self):
        self.user_settings({"enabledPlugins": {"claude-mem@m": True}})
        self.assertIs(tool_routing.mcp_configured("claude-mem"), True)

    def test_disabled_plugin_does_not_count(self):
        self.user_settings({"enabledPlugins": {"claude-mem@m": False}})
        self.assertIs(tool_routing.mcp_configured("claude-mem"), False)


class BootLinesExact(unittest.TestCase):
    CODE = {
        "has_code": True,
        "languages": ["python", "go"],
        "serena_yml": True,
        "serena_languages_ok": True,
        "js_ts": False,
    }

    def test_routing_line_lists_all_four_tools_in_order(self):
        (line,) = tool_routing.boot_lines(stack={"has_code": False})
        self.assertEqual(
            line,
            "Tool routing: symbols/edits -> serena (activate_project first); "
            "orient/search -> lean-ctx ctx_compose/ctx_search/ctx_read; "
            "output >~20 lines -> context-mode ctx_batch_execute; "
            "prior lessons -> claude-mem search/timeline/get_observations.",
        )

    def test_code_stack_line_exact_with_fallback_and_no_note(self):
        lines = tool_routing.boot_lines(stack=self.CODE)
        self.assertEqual(len(lines), 2)
        self.assertEqual(
            lines[1],
            "Code stack (python,go): ToolSearch-load the batch first; serena down -> "
            "lean-ctx only. See atlas-orchestrate/references/tool-routing.md",
        )

    def test_missing_yml_note(self):
        st = dict(self.CODE, serena_yml=False, serena_languages_ok=False)
        self.assertIn(
            "; no .serena/project.yml yet (atlas-setup covers it).",
            tool_routing.boot_lines(stack=st)[1],
        )

    def test_missing_languages_note(self):
        st = dict(self.CODE, serena_languages_ok=False)
        self.assertIn(
            "; project.yml lacks languages: (boot heals it).",
            tool_routing.boot_lines(stack=st)[1],
        )

    def test_no_note_when_serena_absent(self):
        st = dict(self.CODE, serena_yml=False)
        line = tool_routing.boot_lines(stack=st, present={"lean-ctx"})[1]
        self.assertNotIn(".serena", line)
        self.assertNotIn("serena down", line)
        self.assertIn("first.", line)

    def test_no_fallback_when_only_serena_present(self):
        line = tool_routing.boot_lines(stack=self.CODE, present={"serena"})[1]
        self.assertNotIn("serena down", line)

    def test_code_line_needs_serena_or_lean_ctx(self):
        lines = tool_routing.boot_lines(stack=self.CODE, present={"claude-mem"})
        self.assertEqual(len(lines), 1)
        self.assertTrue(lines[0].startswith("Tool routing:"))

    def test_code_line_absent_without_code(self):
        st = dict(self.CODE, has_code=False)
        self.assertEqual(len(tool_routing.boot_lines(stack=st)), 1)

    def test_languages_default_to_code_word(self):
        st = dict(self.CODE, languages=[])
        self.assertTrue(
            tool_routing.boot_lines(stack=st)[1].startswith("Code stack (code):")
        )
        st = {k: v for k, v in self.CODE.items() if k != "languages"}
        self.assertTrue(
            tool_routing.boot_lines(stack=st)[1].startswith("Code stack (code):")
        )

    def test_js_ts_line_exact_and_last(self):
        st = dict(self.CODE, js_ts=True)
        lines = tool_routing.boot_lines(stack=st)
        self.assertEqual(
            lines[-1], "JS/TS: fallow for dead-code/dupes/audit (CLI or fallow-mcp)."
        )

    def test_js_ts_line_even_with_nothing_present(self):
        lines = tool_routing.boot_lines(stack={"js_ts": True}, present=set())
        self.assertEqual(
            lines, ["JS/TS: fallow for dead-code/dupes/audit (CLI or fallow-mcp)."]
        )

    def test_stack_defaults_to_scanning_root(self):
        d = tempfile.mkdtemp()
        self.addCleanup(__import__("shutil").rmtree, d, True)
        write(os.path.join(d, "package.json"), "{}")
        lines = tool_routing.boot_lines(root=d)
        self.assertTrue(any(l.startswith("JS/TS:") for l in lines))
        self.assertTrue(any(l.startswith("Code stack (code):") for l in lines))

    def test_stack_defaults_to_cwd_without_root(self):
        d = tempfile.mkdtemp()
        self.addCleanup(__import__("shutil").rmtree, d, True)
        write(os.path.join(d, "a.go"))
        prev = os.getcwd()
        self.addCleanup(os.chdir, prev)
        os.chdir(d)
        lines = tool_routing.boot_lines()
        self.assertTrue(any(l.startswith("Code stack (go):") for l in lines))


class BatchExact(unittest.TestCase):
    def test_batch_is_one_select_call_with_comma_joined_unique_names(self):
        b = tool_routing.TOOLSEARCH_BATCH
        self.assertTrue(b.startswith('ToolSearch("select:mcp__'))
        self.assertTrue(b.endswith('")'))
        names = b[len('ToolSearch("select:') : -2].split(",")
        self.assertEqual(len(names), 20)
        self.assertEqual(len(set(names)), 20)
        self.assertTrue(all(n.startswith("mcp__") and " " not in n for n in names))


class Main(unittest.TestCase):
    def run_main(self, argv):
        out = io.StringIO()
        with (
            mock.patch.object(sys, "argv", ["tool_routing.py", *argv]),
            contextlib.redirect_stdout(out),
        ):
            rc = tool_routing.main()
        return rc, out.getvalue()

    def test_default_prints_json_report_for_root(self):
        d = tempfile.mkdtemp()
        self.addCleanup(__import__("shutil").rmtree, d, True)
        write(os.path.join(d, "a.go"))
        rc, text = self.run_main([d])
        self.assertEqual(rc, 0)
        data = json.loads(text)
        self.assertEqual(set(data), {"stack", "boot_lines", "toolsearch"})
        self.assertEqual(data["stack"]["root"], os.path.abspath(d))
        self.assertEqual(data["stack"]["languages"], ["go"])
        self.assertEqual(data["toolsearch"], tool_routing.TOOLSEARCH_BATCH)
        self.assertEqual(data["boot_lines"], tool_routing.boot_lines(data["stack"]))
        self.assertTrue(text.startswith('{\n  "stack": {'))  # indent=2

    def test_no_args_scans_cwd(self):
        d = tempfile.mkdtemp()
        self.addCleanup(__import__("shutil").rmtree, d, True)
        write(os.path.join(d, "a.rs"))
        prev = os.getcwd()
        self.addCleanup(os.chdir, prev)
        os.chdir(d)
        rc, text = self.run_main([])
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(text)["stack"]["languages"], ["rust"])

    def test_help_flags_print_usage_and_return_zero(self):
        for flag in ("-h", "--help"):
            with self.subTest(flag):
                rc, text = self.run_main([flag])
                self.assertEqual(rc, 0)
                self.assertIn("usage: tool_routing.py", text)
                self.assertIn("project root to scan", text)
                self.assertNotIn('"stack"', text)

    def test_help_flag_after_root_still_prints_help(self):
        rc, text = self.run_main(["somewhere", "--help"])
        self.assertEqual(rc, 0)
        self.assertIn("usage:", text)

    def test_help_only_when_flag_is_an_argument_not_the_program_name(self):
        d = tempfile.mkdtemp()
        self.addCleanup(__import__("shutil").rmtree, d, True)
        rc, text = self.run_main([d])
        self.assertNotIn("usage:", text)


if __name__ == "__main__":
    unittest.main()
