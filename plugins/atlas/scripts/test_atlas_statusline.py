#!/usr/bin/env python3
"""Tests for the ATLAS statusline segment (durable board at the prompt)."""

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
        "archived": False,
    }


class RenderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = _load()

    def test_renders_counts_now_left(self):
        with tempfile.TemporaryDirectory() as root:
            _board(
                root,
                [
                    _item("wire the gate", "in_progress", "s1"),
                    _item(
                        "contract test",
                        "pending",
                        "s1",
                    ),
                    _item("docs", "pending", "s1"),
                    _item("old plan item", "completed", "s1"),
                ],
            )
            line = self.mod.render(root, "s1")
            self.assertIn("ATLAS", line)
            self.assertIn("1/4", line)
            self.assertIn("now: wire the gate", line)
            self.assertIn("3 left", line)

    def test_all_done_renders_done(self):
        with tempfile.TemporaryDirectory() as root:
            _board(
                root,
                [
                    _item("a", "completed", "s1"),
                    _item("b", "completed", "s1"),
                ],
            )
            line = self.mod.render(root, "s1")
        self.assertIn("2/2 done", line)

    def test_session_items_preferred(self):
        with tempfile.TemporaryDirectory() as root:
            _board(
                root,
                [
                    _item("mine open", "pending", "s1"),
                    _item("mine too", "completed", "s1"),
                    _item("other session", "pending", "s2"),
                ],
            )
            line = self.mod.render(root, "s1")
        self.assertIn("1/2", line)

    def test_carried_items_show_via_board_fallback(self):
        with tempfile.TemporaryDirectory() as root:
            _board(
                root,
                [
                    _item("carried work", "pending", "s-old"),
                    _item("carried too", "completed", "s-old"),
                ],
            )
            line = self.mod.render(root, "s-new")
        self.assertIn("1/2", line)

    def test_missing_board_renders_empty(self):
        with tempfile.TemporaryDirectory() as root:
            line = self.mod.render(root, "s1")
        self.assertEqual(line, "")

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
