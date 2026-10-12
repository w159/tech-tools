#!/usr/bin/env python3
"""Health payload: swallowed data-source failures surface, hook fault streams classify."""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import sqlite3
import time
import unittest
from unittest import mock

import test_atlas_dash_insights as T

ins, Ctx = T.ins, T.Ctx
NOW = time.time()


class Flaky:
    """sqlite connection whose queries touching `needle` raise sqlite3.Error."""

    def __init__(self, conn, needle):
        self._c, self._n = conn, needle

    def execute(self, sql, *a):
        if self._n in sql:
            raise sqlite3.OperationalError("injected failure")
        return self._c.execute(sql, *a)

    def __getattr__(self, name):
        return getattr(self._c, name)


class HealthCollectBase(T.InsightsBase):
    def health(self, conn=None, provider=None):
        with mock.patch.object(ins, "CONNECTOR_STATUS_PROVIDER", provider):
            return ins.route_health(Ctx(conn or self.conn, {}))[1]

    def subs(self, body):
        return {s["id"]: s for s in body["subsystems"]}

    def write_faults(self, rows):
        with open(self.home / "hook-faults.jsonl", "w") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")


class TestDataWarnings(HealthCollectBase):
    def test_clean_run_has_no_warnings(self):
        self.assertEqual(self.health()["data_warnings"], [])

    def test_unopenable_db_warns_and_db_fails(self):
        class Boom(Ctx):
            def db(self):
                raise RuntimeError("locked")

        with mock.patch.object(ins, "CONNECTOR_STATUS_PROVIDER", None):
            body = ins.route_health(Boom())[1]
        self.assertIn("db", {w["source"] for w in body["data_warnings"]})
        self.assertNotEqual(self.subs(body)["db"]["status"], "ok")

    def test_failed_query_warns_and_db_not_ok(self):
        body = self.health(Flaky(self.conn, "FROM tool_calls"))
        self.assertTrue(any("injected" in w["message"] for w in body["data_warnings"]))
        db = self.subs(body)["db"]
        self.assertEqual(db["status"], "warn")
        self.assertIn("data source failed", db["detail"])

    def test_provider_failure_marks_connectors_warn(self):
        def provider():
            raise RuntimeError("provider down")

        body = self.health(provider=provider)
        self.assertIn("connectors", {w["source"] for w in body["data_warnings"]})
        self.assertEqual(self.subs(body)["connectors"]["status"], "warn")

    def test_corrupt_hookstate_marks_hooks_warn(self):
        (self.home / "hookstate" / "bad.json").write_text("{not json")
        body = self.health()
        self.assertIn("hooks", {w["source"] for w in body["data_warnings"]})
        self.assertEqual(self.subs(body)["hooks"]["status"], "warn")

    def test_unreadable_pragma_warns(self):
        body = self.health(Flaky(self.conn, "PRAGMA table_info"))
        self.assertTrue(any("columns" in w["message"] for w in body["data_warnings"]))


class TestConsumers(HealthCollectBase):
    def test_statuses_stay_in_known_set_and_payload_serializes(self):
        self.write_faults([{"ts": NOW - 7200, "hook": "h", "error": "x", "type": "E", "cwd": "/w/p"}])
        body = self.health()
        json.dumps(body)
        known = {"ok", "warn", "fail", "info", "unknown"}
        self.assertLessEqual({s["status"] for s in body["subsystems"]}, known)
        self.assertEqual(self.subs(body)["hooks"]["status"], "info")


class TestHookStreams(HealthCollectBase):
    def row(self, age_s, **kw):
        base = {
            "ts": NOW - age_s,
            "hook": "pretool",
            "error": "x",
            "type": "E",
            "cwd": "/w/proj-a",
        }
        return {**base, **kw}

    def test_historic_stream_is_info_with_last_seen_text(self):
        self.write_faults([self.row(7200 + i) for i in range(3)])
        hooks = self.subs(self.health())["hooks"]
        self.assertEqual(hooks["status"], "info")
        self.assertTrue(
            any(
                "3 faults from pretool" in e and "none since" in e
                for e in hooks["evidence"]
            )
        )

    def test_active_stream_stays_warn(self):
        self.write_faults([self.row(60)])
        hooks = self.subs(self.health())["hooks"]
        self.assertEqual(hooks["status"], "warn")
        self.assertTrue(any(e.endswith("active") for e in hooks["evidence"]))

    def test_rows_without_version_group_as_unknown(self):
        import atlas_health_collect as hc

        g = hc.group_fault_streams([self.row(10), self.row(20)], NOW, "11.0.0")
        self.assertEqual([(x["version"], x["count"]) for x in g], [("unknown", 2)])
        self.assertFalse(g[0]["stale"])

    def test_streams_split_by_version_and_project(self):
        import atlas_health_collect as hc

        rows = [
            self.row(10, plugin_version="1.0.0"),
            self.row(10, plugin_version="2.0.0"),
            self.row(10, cwd="/w/proj-b"),
        ]
        self.assertEqual(len(hc.group_fault_streams(rows, NOW, "2.0.0")), 3)

    def test_stale_version_adds_doctor_fix(self):
        self.write_faults([self.row(60, plugin_version="0.0.1")])
        ev = self.subs(self.health())["hooks"]["evidence"]
        self.assertTrue(
            any(
                "stale plugin install 0.0.1" in e and "atlas_doctor.py --fix" in e
                for e in ev
            )
        )


if __name__ == "__main__":
    unittest.main()
