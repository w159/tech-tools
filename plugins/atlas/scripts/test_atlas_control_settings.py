#!/usr/bin/env python3
"""Settings catalog contract for GET /api/behavior (docs/command-center-redesign.md section 8)."""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import os
import sys
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_atlas_control import ControlTestCase  # noqa: E402  (also redirects ~/.atlas to a tempdir)


class TestSettingsCatalog(ControlTestCase):
    def entries(self):
        st = self.mod.behavior_state()
        out = {k["key"]: k for g in st["groups"] for k in g["knobs"]}
        out.update({k["key"]: k for k in st["advanced"]})
        return out

    def test_every_entry_is_documented(self):
        for key, e in self.entries().items():
            self.assertTrue(e.get("documented", True), key)
            self.assertTrue(e["description"].strip(), key)
            self.assertFalse(e["description"].startswith("Undocumented"), key)

    def test_finite_valued_entries_are_never_text(self):
        for key, e in self.entries().items():
            if e.get("options") or "on" in e or "off" in e:
                self.assertNotEqual(e["kind"], "text", key)
        k = self.entries()
        self.assertEqual(
            [o["value"] for o in k["ATLAS_GATES"]["options"]], ["on", "always", "off"]
        )
        for key in ("ATLAS_MODE", "ATLAS_SEAT_BACKEND"):
            self.assertEqual(k[key]["kind"], "select", key)
        for key in (
            "ATLAS_AUTONAME",
            "ATLAS_WT_GATE",
            "ATLAS_MANDATES",
            "ATLAS_SELFFIX",
            "ATLAS_TASKS_MIRROR",
        ):
            self.assertEqual(k[key]["kind"], "toggle", key)
        for key in (
            "ATLAS_BURST_SECS",
            "ATLAS_GATE_BLOCK_LOOP",
            "ATLAS_RIG_PORT",
            "ATLAS_TERM_IDLE_S",
        ):
            self.assertEqual(k[key]["kind"], "number", key)

    def test_atlas_set_keys_are_not_listed(self):
        listed = self.entries()
        for key in (
            "ATLAS_SESSION_ID",
            "ATLAS_SOURCE",
            "ATLAS_LEAD_AGENT",
            "ATLAS_TUI_BRIDGE",
        ):
            self.assertNotIn(key, listed, key)

    def test_every_entry_has_current_live_and_editable(self):
        for key, e in self.entries().items():
            self.assertEqual(set(e["current"]), {"value", "source", "applies"}, key)
            self.assertIn(e["current"]["source"], ("default", "saved", "shell"), key)
            self.assertEqual(set(e["live"]), {"value", "differs"}, key)
            self.assertIsInstance(e["editable"], bool, key)
            self.assertIn("read_only_reason", e, key)

    def test_current_prefers_the_store_over_default(self):
        self.assertEqual(
            self.entries()["ATLAS_TRIPWIRE_THRESHOLD"]["current"]["source"], "default"
        )
        self.assertTrue(
            self.mod.write_behavior_updates({"ATLAS_TRIPWIRE_THRESHOLD": "9"})["ok"]
        )
        cur = self.entries()["ATLAS_TRIPWIRE_THRESHOLD"]["current"]
        self.assertEqual((cur["value"], cur["source"]), ("9", "saved"))

    def test_live_differs_when_the_process_env_disagrees(self):
        with mock.patch.dict(os.environ, {"ATLAS_TRIPWIRE_THRESHOLD": "7"}):
            live = self.entries()["ATLAS_TRIPWIRE_THRESHOLD"]["live"]
        self.assertEqual(live, {"value": "7", "differs": True})
        with mock.patch.dict(os.environ, {"ATLAS_TRIPWIRE_THRESHOLD": "4"}):
            self.assertFalse(
                self.entries()["ATLAS_TRIPWIRE_THRESHOLD"]["live"]["differs"]
            )

    def test_shell_scope_current_reads_the_shell_layers(self):
        self.assertTrue(
            self.mod.write_behavior_updates({"ATLAS_RIG_PORT": "7500"})["ok"]
        )
        cur = self.entries()["ATLAS_RIG_PORT"]["current"]
        self.assertEqual(cur["value"], "7500")


if __name__ == "__main__":
    import unittest

    unittest.main()
