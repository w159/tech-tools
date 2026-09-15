#!/usr/bin/env python3
"""Tests for the ATLAS statusline segment (durable todo board at the prompt)."""

from __future__ import annotations

import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent


def _load():
    spec = importlib.util.spec_from_file_location(
        "atlas_statusline", SCRIPTS / "atlas_statusline.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _board(root, items):
    d = os.path.join(root, ".atlas", ".run")
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, "todos.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"items": items}, fh)
    return path


def _item(content, status, session=None):
    return {
        "content": content,
        "status": status,
        "session_id": session,
        "origin": "session",
        " archived".strip(): False,
    }


class RenderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = _load()

    def test_renders_header_and_one_line_per_item(self):
        with tempfile.TemporaryDirectory() as root:
            _board(
                root,
                [
                    _item("wire the gate", "in_progress", "s1"),
                    _item("contract test", "pending", "s1"),
                    _item("docs", "pending", "s1"),
                    _item("old plan item", "completed", "s1"),
                ],
            )
            block = self.mod.render(root, "s1").splitlines()
        self.assertEqual(len(block), 5)  # header + 4 items
        self.assertIn("ATLAS Todos", block[0])
        self.assertIn("1/4", block[0])
        self.assertIn("wire the gate", block[1])
        self.assertIn("contract test", block[2])
        self.assertIn("docs", block[3])
        self.assertIn("old plan item", block[4])
        self.assertIn("✓", block[1] + block[4])  # completed items carry the check
        self.assertIn("❯", block[1])  # in-progress carries the arrow

    def test_all_done_renders_green_header(self):
        with tempfile.TemporaryDirectory() as root:
            _board(
                root,
                [
                    _item("a", "completed", "s1"),
                    _item("b", "completed", "s1"),
                ],
            )
            block = self.mod.render(root, "s1")
        self.assertIn("✓ ATLAS Todos", block)
        self.assertIn("2/2", block)
        self.assertIn("✓ a", block)

    def test_session_items_prefer_session_items(self):
        with tempfile.TemporaryDirectory() as root:
            _board(
                root,
                [
                    _item("mine open", "pending", "s1"),
                    _item("mine too", "completed", "s1"),
                    _item("other session", "pending", "s2"),
                ],
            )
            block = self.mod.render(root, "s1")
        self.assertIn("1/2", block)
        self.assertNotIn("other session", block)

    def test_carried_items_show_via_board_fallback(self):
        with tempfile.TemporaryDirectory() as root:
            _board(
                root,
                [
                    _item("carried work", "pending", "s-old"),
                    _item("carried too", "completed", "s-old"),
                ],
            )
            block = self.mod.render(root, "s-new")
        self.assertIn("1/2", block)
        self.assertIn("carried work", block)

    def test_missing_board_renders_empty(self):
        with tempfile.TemporaryDirectory() as root:
            block = self.mod.render(root, "s1")
        self.assertEqual(block, "")

    def test_list_caps_at_eight_items(self):
        with tempfile.TemporaryDirectory() as root:
            items = [_item("item %d" % n, "pending", "s1") for n in range(9)]
            _board(root, items)
            block = self.mod.render(root, "s1").splitlines()
        self.assertEqual(len(block), 10)  # header + 8 items + "+1 more"
        self.assertIn("+ 1 more", block[-1])

    def test_empty_board_renders_empty(self):
        with tempfile.TemporaryDirectory() as root:
            _board(root, [])
            block = self.mod.render(root, "s1")
        self.assertEqual(block, "")

    def test_main_fails_open_on_bad_stdin(self):
        buf = io.StringIO()
        with mock.patch.object(sys, "stdin", io.StringIO("not json")):
            with redirect_stdout(buf):
                rc = self.mod.main()
        self.assertEqual(rc, 0)
        self.assertEqual(buf.getvalue(), "")

    def test_main_off_switch(self):
        buf = io.StringIO()
        with mock.patch.dict(os.environ, {"ATLAS_STATUSLINE": "off"}):
            with redirect_stdout(buf):
                rc = self.mod.main()
        self.assertEqual(rc, 0)
        self.assertEqual(buf.getvalue(), "")
