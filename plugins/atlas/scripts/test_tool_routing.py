#!/usr/bin/env python3
"""Tests for scripts/tool_routing.py."""
from __future__ import annotations

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
            "languages: [\"python\"]\n",
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


if __name__ == "__main__":
    unittest.main()
