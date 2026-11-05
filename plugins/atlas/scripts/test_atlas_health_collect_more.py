#!/usr/bin/env python3
"""atlas_health_collect: collector, subsystem marking, stream grouping boundaries."""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import unittest
from pathlib import Path
from unittest import mock

import atlas_health_collect as hc

NOW = 1_000_000.0


def row(age, **kw):
    return {**{"ts": NOW - age, "hook": "h", "cwd": "/w/proj-a"}, **kw}


class CollectorTest(unittest.TestCase):
    def test_warn_outside_request_is_noop_and_inside_dedupes_and_caps(self):
        hc._CURRENT.set(None)
        hc.warn("db", "x")  # must not raise
        bucket = hc.start()
        hc.warn("db", "x")
        hc.warn("db", "x")
        hc.warn("hooks", "y" * 400)
        self.assertEqual(bucket[0], {"source": "db", "message": "x"})
        self.assertEqual(len(bucket), 2)
        self.assertEqual(len(bucket[1]["message"]), 300)
        hc._CURRENT.set(None)

    def test_apply_marks_ok_and_unknown_warn_but_keeps_fail_and_skips_unknown_source(self):
        subs = [
            {"id": "a", "status": "ok", "detail": "d"},
            {"id": "b", "status": "unknown", "detail": "d"},
            {"id": "c", "status": "fail", "detail": "d"},
            {"id": "d", "status": "info", "detail": "d"},
        ]
        warns = [{"source": s, "message": "m"} for s in ("a", "b", "c", "d", "zzz")]
        hc.apply_to_subsystems(subs, warns)
        self.assertEqual([s["status"] for s in subs], ["warn", "warn", "fail", "info"])
        for s in subs:
            self.assertEqual(s["detail"], "d; data source failed: m")


class VersionTest(unittest.TestCase):
    def test_installed_version_reads_manifest(self):
        manifest = Path(hc.__file__).resolve().parent.parent / ".claude-plugin" / "plugin.json"
        self.assertEqual(
            hc.installed_plugin_version(), json.loads(manifest.read_text())["version"]
        )

    def test_unreadable_manifest_warns_hooks_and_returns_none(self):
        bucket = hc.start()
        with mock.patch.object(Path, "read_text", side_effect=OSError("nope")):
            self.assertIsNone(hc.installed_plugin_version())
        self.assertEqual(bucket[0]["source"], "hooks")
        self.assertIn("plugin.json", bucket[0]["message"])
        hc._CURRENT.set(None)

    def test_vkey_orders_numerically_and_non_digits_count_zero(self):
        self.assertEqual(hc._vkey("1.10.2"), (1, 10, 2))
        self.assertLess(hc._vkey("1.9.0"), hc._vkey("1.10.0"))
        self.assertEqual(hc._vkey("1.beta"), (1, 0))

    def test_stale_when_pre_release_tag_sorts_below_current(self):
        g = hc.group_fault_streams([row(1, plugin_version="1.beta")], NOW, "1.1")
        self.assertTrue(g[0]["stale"])
        g = hc.group_fault_streams([row(1, plugin_version="1.1")], NOW, "1.1")
        self.assertFalse(g[0]["stale"])
        g = hc.group_fault_streams([row(1, plugin_version="0.1")], NOW, None)
        self.assertFalse(g[0]["stale"])


class StreamTest(unittest.TestCase):
    def test_project_of(self):
        self.assertEqual(hc._project_of("/w/proj-a"), "proj-a")
        self.assertEqual(hc._project_of(""), "unknown")

    def test_group_fields_counts_and_last(self):
        g = hc.group_fault_streams(
            [row(50), row(10), row(30), row(5, ts="bad"), {"hook": "no-ts"}], NOW, None
        )
        self.assertEqual(len(g), 1)
        self.assertEqual(
            {k: g[0][k] for k in ("hook", "version", "project", "cwd", "count", "last")},
            {"hook": "h", "version": "unknown", "project": "proj-a",
             "cwd": "/w/proj-a", "count": 3, "last": NOW - 10},
        )

    def test_missing_hook_and_cwd_default(self):
        g = hc.group_fault_streams([{"ts": NOW}], NOW, None)
        self.assertEqual((g[0]["hook"], g[0]["project"], g[0]["cwd"]), ("?", "unknown", ""))

    def test_active_window_is_exactly_thirty_minutes(self):
        self.assertEqual(hc.ACTIVE_FAULT_SECS, 1800)
        self.assertTrue(hc.group_fault_streams([row(1800)], NOW, None)[0]["active"])
        self.assertFalse(hc.group_fault_streams([row(1801)], NOW, None)[0]["active"])

    def test_sort_active_first_then_count_then_recency(self):
        rows = [
            row(7200, hook="old-many"), row(7201, hook="old-many"), row(7202, hook="old-many"),
            row(7000, hook="old-new"),
            row(100, hook="act-one"),
            row(100, hook="act-two"), row(101, hook="act-two"),
        ]
        order = [g["hook"] for g in hc.group_fault_streams(rows, NOW, None)]
        self.assertEqual(order, ["act-two", "act-one", "old-many", "old-new"])

    def test_age_text_unit_boundaries(self):
        self.assertEqual(hc.age_text(-5), "0 min ago")
        self.assertEqual(hc.age_text(59 * 60 + 59), "59 min ago")
        self.assertEqual(hc.age_text(3600), "1 h ago")
        self.assertEqual(hc.age_text(2879 * 60), "47 h ago")
        self.assertEqual(hc.age_text(2880 * 60), "2 d ago")

    def test_describe_stream(self):
        g = {"count": 3, "hook": "pre", "version": "1.0.0", "project": "p",
             "last": NOW - 600, "active": False}
        self.assertEqual(
            hc.describe_stream(g, NOW),
            "3 faults from pre (plugin 1.0.0, project p), last seen 10 min ago; none since",
        )
        self.assertTrue(hc.describe_stream({**g, "active": True}, NOW).endswith("; active"))


if __name__ == "__main__":
    unittest.main()
