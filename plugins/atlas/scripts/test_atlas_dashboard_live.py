#!/usr/bin/env python3
"""Dashboard live path: shared SSE sampler, Last-Event-ID, route errors, payload paging,
read cache, connector truthfulness and owner-only credential writes."""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import http.client
import importlib.util
import io
import json
import os
import re
import stat
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent


def _load():
    spec = importlib.util.spec_from_file_location(
        "atlas_dashboard", SCRIPTS / "atlas_dashboard.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class LiveCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = _load()

    def serve(self):
        httpd = self.mod._Server((self.mod.LOOPBACK, 0), self.mod.Handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        return httpd.server_address[1]


class FakeRoutes:
    """Stands in for _v2_get: per-route bodies, call counts and injectable failures."""

    ROUTES = [
        r
        for _e, r in (
            ("herd", "/api/v2/herd/agents"),
            ("agents", "/api/v2/agents"),
            ("todos", "/api/v2/todos"),
            ("irc", "/api/v2/irc"),
            ("health", "/api/v2/health"),
            ("improve", "/api/v2/improve"),
        )
    ]

    def __init__(self):
        self.lock = threading.Lock()
        self.calls = {r: 0 for r in self.ROUTES}
        self.bodies = {r: {"route": r, "n": 0} for r in self.ROUTES}
        self.fail = {}

    def __call__(self, path, query):
        with self.lock:
            self.calls[path] += 1
            if path in self.fail:
                raise RuntimeError(self.fail[path])
            return json.loads(json.dumps(self.bodies[path]))


class SseCase(LiveCase):
    def setUp(self):
        self.fake = FakeRoutes()
        for patch in (
            mock.patch.object(self.mod, "_v2_get", self.fake),
            mock.patch.object(self.mod, "SSE_TICK_S", 0.05),
            mock.patch.object(sys, "stderr", io.StringIO()),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        self.port = self.serve()

    def tearDown(self):
        deadline = time.time() + 5
        while self.mod._SAMPLERS and time.time() < deadline:
            time.sleep(0.05)

    def open_stream(self, last_event_id=None, project=None):
        conn = http.client.HTTPConnection(self.mod.LOOPBACK, self.port, timeout=10)
        headers = {
            "Host": f"{self.mod.LOOPBACK}:{self.port}",
            "X-Atlas-Token": self.mod.DASH_TOKEN,
        }
        if last_event_id:
            headers["Last-Event-ID"] = last_event_id
        path = "/api/v2/stream" + (f"?project={project}" if project else "")
        conn.request("GET", path, headers=headers)
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200)
        self.addCleanup(conn.close)
        return resp

    @staticmethod
    def read_ticks(resp, ticks):
        """Events (name, data, id) up to and including the Nth tick."""
        events, name, data, ident, seen = [], None, None, None, 0
        while seen < ticks:
            line = resp.fp.readline().decode()
            if line == "":
                break
            line = line.rstrip("\n")
            if line.startswith("event: "):
                name = line[7:]
            elif line.startswith("data: "):
                data = json.loads(line[6:])
            elif line.startswith("id: "):
                ident = line[4:]
            elif line == "" and name:
                events.append((name, data, ident))
                seen += name == "tick"
                name, data, ident = None, None, None
        return events

    def test_clients_share_one_sampling_pass(self):
        streams = [self.open_stream() for _ in range(3)]
        with ThreadPoolExecutor(3) as ex:
            results = list(ex.map(lambda r: self.read_ticks(r, 4), streams))
        for events in results:
            self.assertEqual(
                {n for n, _d, _i in events} - {"tick"},
                {"herd", "agents", "todos", "irc", "health", "improve"},
            )
        # per-client recompute would make this >= 3 clients x 4 ticks = 12
        self.assertLessEqual(self.fake.calls["/api/v2/health"], 7, self.fake.calls)
        self.assertEqual(len(self.mod._SAMPLERS), 1)

    def test_unchanged_topics_and_live_fields_are_not_resent(self):
        self.fake.bodies["/api/v2/herd/agents"] = {
            "fetched_ms": 1.0,
            "agents": [{"name": "a", "preview": ["x"], "last_ts": 1}],
        }
        resp = self.open_stream()
        stop = threading.Event()

        def churn():  # an agent printing: only preview/last_ts move
            i = 0
            while not stop.is_set():
                i += 1
                self.fake.bodies["/api/v2/herd/agents"] = {
                    "fetched_ms": float(i),
                    "agents": [{"name": "a", "preview": [f"line {i}"], "last_ts": i}],
                }
                time.sleep(0.01)

        threading.Thread(target=churn, daemon=True).start()
        self.addCleanup(stop.set)
        events = self.read_ticks(resp, 8)
        names = [n for n, _d, _i in events]
        for topic in ("herd", "agents", "todos", "irc", "health", "improve"):
            self.assertEqual(names.count(topic), 1, (topic, names))
        stop.set()
        self.fake.bodies["/api/v2/irc"] = {"route": "irc", "n": 1}  # a real change
        later = [n for n, _d, _i in self.read_ticks(resp, 6)]
        self.assertEqual(later.count("irc"), 1, later)
        self.assertNotIn("herd", later)

    def test_agents_topic_ignores_volatile_fields_and_emits_once_per_real_change(self):
        def body(ms, state):
            return {
                "fetched_ms": ms,
                "agents": [{"key": "wA:p1", "state": state, "state_changed_at": "t0"}],
            }

        self.fake.bodies["/api/v2/agents"] = body(1.0, "working")
        resp = self.open_stream()
        stop = threading.Event()

        def churn():  # only the volatile fetch time moves
            i = 0
            while not stop.is_set():
                i += 1
                self.fake.bodies["/api/v2/agents"] = body(float(i), "working")
                time.sleep(0.01)

        threading.Thread(target=churn, daemon=True).start()
        self.addCleanup(stop.set)
        names = [n for n, _d, _i in self.read_ticks(resp, 8)]
        self.assertEqual(names.count("agents"), 1, names)
        stop.set()
        time.sleep(0.1)
        self.fake.bodies["/api/v2/agents"] = body(0.0, "input")  # a real change
        later = [n for n, _d, _i in self.read_ticks(resp, 6)]
        self.assertEqual(later.count("agents"), 1, later)

    def test_route_failure_is_an_event_and_a_log_line_then_recovers(self):
        self.fake.fail["/api/v2/irc"] = "boom: db locked"
        resp = self.open_stream()
        events = self.read_ticks(resp, 5)
        errors = [d for n, d, _i in events if n == "route_error"]
        self.assertEqual(
            len(errors), 1, "same failure must not be re-announced every tick"
        )
        self.assertEqual(errors[0]["topic"], "irc")
        self.assertIn("boom: db locked", errors[0]["error"])
        self.assertNotIn("irc", [n for n, _d, _i in events])
        self.assertIn("sse irc", sys.stderr.getvalue())
        del self.fake.fail["/api/v2/irc"]
        later = [n for n, _d, _i in self.read_ticks(resp, 4)]
        self.assertIn(
            "irc", later
        )  # recovery re-emits even though the body never existed
        self.assertNotIn("route_error", later)

    def test_last_event_id_resumes_without_resending_known_topics(self):
        first = self.read_ticks(self.open_stream(), 2)
        last_id = [i for n, _d, i in first if n == "tick"][-1]
        self.assertRegex(last_id, r"^[0-9a-f]+-\d+$")
        self.fake.bodies["/api/v2/todos"] = {"route": "todos", "n": 9}
        resumed = self.read_ticks(self.open_stream(last_event_id=last_id), 3)
        names = [n for n, _d, _i in resumed]
        self.assertIn("todos", names)
        for known in ("herd", "agents", "irc", "health", "improve"):
            self.assertNotIn(known, names)
        epoch = last_id.split("-")[0]
        foreign = self.read_ticks(self.open_stream(last_event_id="ffffff-3"), 1)
        self.assertNotEqual(epoch, "ffffff")
        self.assertEqual(
            {n for n, _d, _i in foreign} - {"tick"},
            {"herd", "agents", "todos", "irc", "health", "improve"},
        )

    def test_sampler_stops_when_the_last_client_leaves(self):
        resp = self.open_stream()
        self.read_ticks(resp, 1)
        self.assertEqual(len(self.mod._SAMPLERS), 1)
        resp.close()
        deadline = time.time() + 5
        while self.mod._SAMPLERS and time.time() < deadline:
            time.sleep(0.05)
        self.assertEqual(self.mod._SAMPLERS, {})


class PayloadAndCache(LiveCase):
    def setUp(self):
        self.mod._v2_cache_clear()

    def test_improve_default_page_is_small_and_pageable(self):
        body = {
            "findings": [{"id": i, "pad": "x" * 800} for i in range(433)],
            "ledger": list(range(100)),
            "lessons": list(range(50)),
            "loop": {"a": 1},
        }
        small = self.mod._shape_payload("/api/v2/improve", {}, body)
        self.assertEqual(len(small["findings"]), 40)
        self.assertEqual(len(small["ledger"]), 20)
        self.assertEqual(
            small["page"]["findings"],
            {"total": 433, "offset": 0, "returned": 40, "limit": 40},
        )
        self.assertLess(len(json.dumps(small)), 100_000)
        self.assertEqual(len(body["findings"]), 433, "input must not be mutated")
        second = self.mod._shape_payload(
            "/api/v2/improve", {"limit": "10", "offset": "40"}, body
        )
        self.assertEqual([f["id"] for f in second["findings"]], list(range(40, 50)))
        self.assertEqual(
            len(
                self.mod._shape_payload("/api/v2/improve", {"limit": "all"}, body)[
                    "findings"
                ]
            ),
            433,
        )
        self.assertIs(
            self.mod._shape_payload("/api/v2/improve", {"full": "1"}, body), body
        )
        junk = self.mod._shape_payload("/api/v2/improve", {"limit": "banana"}, body)
        self.assertEqual(len(junk["findings"]), 40)

    def test_todos_keeps_every_open_item_and_the_newest_done(self):
        items = [
            {"id": f"d{i}", "status": "done", "updated": f"2026-01-{i + 1:02d}"}
            for i in range(30)
        ]
        items += [
            {"id": "o1", "status": "open", "updated": "2020-01-01"},
            {"id": "w1", "status": "in_progress", "updated": "2020-01-01"},
        ]
        body = {
            "phases": [{"name": "p", "items": items}],
            "counts": {"done": 30, "open": 1},
        }
        out = self.mod._shape_payload("/api/v2/todos", {}, body)
        ids = {i["id"] for i in out["phases"][0]["items"]}
        self.assertTrue({"o1", "w1"} <= ids)
        self.assertEqual(sum(i.startswith("d") for i in ids), 20)
        self.assertIn("d29", ids)
        self.assertNotIn("d0", ids)
        self.assertEqual(out["counts"], {"done": 30, "open": 1})
        self.assertEqual(out["page"]["done_hidden"], 10)
        all_done = self.mod._shape_payload("/api/v2/todos", {"done": "all"}, body)
        self.assertEqual(len(all_done["phases"][0]["items"]), 32)

    def test_concurrent_identical_reads_share_one_computation_until_a_write(self):
        calls = {"n": 0}

        def slow(ctx):
            calls["n"] += 1
            time.sleep(0.2)
            return 200, {"n": calls["n"]}

        routes = [
            ("GET", re.compile(r"/api/v2/health"), slow),
            ("POST", re.compile(r"/api/v2/todos"), lambda ctx: (200, {"ok": True})),
        ]
        port = self.serve()

        def get(_):
            req = urllib.request.Request(
                f"http://{self.mod.LOOPBACK}:{port}/api/v2/health"
            )
            with urllib.request.urlopen(req, timeout=10) as r:
                return json.loads(r.read())["n"]

        with mock.patch.object(self.mod, "V2_ROUTES", routes):
            started = time.time()
            with ThreadPoolExecutor(8) as ex:
                got = list(ex.map(get, range(8)))
            self.assertEqual(calls["n"], 1)
            self.assertEqual(set(got), {1})
            self.assertLess(time.time() - started, 1.0)
            self.mod._v2_call("POST", "/api/v2/todos", {}, {}, routes[1][2], ())
            self.assertEqual(get(0), 2, "a v2 mutation must drop the cached read")

    def test_failing_route_is_not_cached(self):
        state = {"fail": True}

        def route(ctx):
            if state["fail"]:
                raise RuntimeError("first call fails")
            return 200, {"ok": True}

        with self.assertRaises(RuntimeError):
            self.mod._v2_call("GET", "/api/v2/health", {}, {}, route, ())
        state["fail"] = False
        self.assertEqual(
            self.mod._v2_call("GET", "/api/v2/health", {}, {}, route, ())[0], 200
        )

    def test_snapshot_hash_ignores_only_live_fields(self):
        a = {"agents": [{"n": 1, "preview": ["a"], "last_ts": 1}]}
        b = {"agents": [{"n": 1, "preview": ["b"], "last_ts": 2}]}
        c = {"agents": [{"n": 2, "preview": ["a"], "last_ts": 1}]}
        h = self.mod._snapshot_hash
        self.assertEqual(h(a), h(b))
        self.assertNotEqual(h(a), h(c))


class ConnectorTruth(LiveCase):
    """Settings/Health must follow what each vendor server needs, not 'a secret is present'."""

    def status(self, set_keys: dict):
        """{connector: row} when exactly ``set_keys`` (env key -> value) are saved."""
        opts = {k.lower(): v for k, v in set_keys.items()}
        with (
            mock.patch.object(self.mod, "_plugin_config_options", return_value=opts),
            mock.patch.object(self.mod, "_env_file_present_keys", return_value=set()),
            mock.patch.object(self.mod, "_env_file_values", return_value={}),
            mock.patch.object(self.mod, "_load_cred_marks", return_value={}),
            mock.patch.object(self.mod, "_connector_usage_map", return_value={}),
            mock.patch.object(
                self.mod.atlas_control, "_disabled_servers", return_value=[]
            ),
        ):
            return {c["name"]: c for c in self.mod._connector_status()}

    def test_table_covers_every_shipped_connector_and_real_keys(self):
        rows = self.status({})
        self.assertEqual(set(self.mod.CONNECTOR_AUTH), set(rows))
        for name, alternatives in self.mod.CONNECTOR_AUTH.items():
            keys = {f["env_key"] for f in rows[name]["fields"]}
            for alt in alternatives:
                for req in alt:
                    self.assertIn(req.partition("=")[0], keys, (name, req))

    def test_secret_alone_does_not_make_a_connector_configured(self):
        sensitive = {}
        for name, row in self.status({}).items():
            for f in row["fields"]:
                if f["sensitive"]:
                    sensitive[f["env_key"]] = "s3cret"
        rows = self.status(sensitive)
        # single-secret vendors are genuinely usable; everything else needs more
        self.assertEqual(
            {n for n, r in rows.items() if r["configured_hint"]},
            {"blumira", "knowbe4", "threatlocker"},
        )
        self.assertEqual(rows["auvik"]["missing_required"], ["AUVIK_USERNAME"])
        self.assertEqual(rows["auvik"]["health"], "unconfigured")
        self.assertEqual(rows["panos"]["missing_required"], ["PANOS_HOST"])
        self.assertEqual(rows["vanta"]["missing_required"], ["VANTA_CLIENT_ID"])

    def test_valid_alternate_setups_are_configured(self):
        rows = self.status(
            {
                "BLUMIRA_JWT_TOKEN": "j",
                "CIPP_BASE_URL": "https://cipp.example",
                "CIPP_API_KEY": "k",
                "PANOS_HOST": "fw.example",
                "PANOS_API_KEY": "k",
                "NINJAONE_CLIENT_ID": "id",
                "NINJAONE_AUTH_MODE": "user",
                "AUVIK_USERNAME": "u",
                "AUVIK_API_KEY": "k",
            }
        )
        for name in ("blumira", "cipp", "panos", "ninjaone", "auvik"):
            self.assertTrue(rows[name]["configured_hint"], name)
            self.assertEqual(rows[name]["missing_required"], [], name)
        self.assertEqual(rows["auvik"]["health"], "idle")

    def test_alternative_value_condition_is_enforced(self):
        rows = self.status(
            {"NINJAONE_CLIENT_ID": "id", "NINJAONE_AUTH_MODE": "client_credentials"}
        )
        self.assertFalse(rows["ninjaone"]["configured_hint"])
        self.assertEqual(
            rows["ninjaone"]["missing_required"], ["NINJAONE_CLIENT_SECRET"]
        )

    def test_default_env_file_counts_as_configured(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp) / ".config" / "atlas"
            d.mkdir(parents=True)
            (d / "atlas.env").write_text("KNOWBE4_API_KEY=abc\n")
            with mock.patch.object(Path, "home", return_value=Path(tmp)):
                self.assertIn(d / "atlas.env", self.mod._env_candidate_paths())
                self.assertIn("KNOWBE4_API_KEY", self.mod._env_file_present_keys())


class PrivateWrites(LiveCase):
    def test_credentials_and_settings_are_written_owner_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            settings = root / "home" / ".claude" / "settings.json"
            env_file = root / "plugin.env"
            env_file.write_text("AUVIK_REGION=us1\n")
            env_file.chmod(0o644)  # a file created before this fix
            old = os.umask(0o022)
            try:
                with (
                    mock.patch.object(
                        self.mod, "_settings_path", return_value=settings
                    ),
                    mock.patch.object(
                        self.mod,
                        "_write_env_file",
                        side_effect=lambda u: self.mod._merge_env_file(env_file, u),
                    ),
                    mock.patch.object(self.mod, "_save_cred_marks"),
                ):
                    res = self.mod.write_settings_updates(
                        {"auvik_api_key": "topsecret"}
                    )
            finally:
                os.umask(old)
            self.assertTrue(res["ok"], res)
            for p in (settings, env_file):
                self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o600, p)
            self.assertIn("topsecret", env_file.read_text())
            self.assertEqual(
                json.loads(settings.read_text())["pluginConfigs"]["atlas@tech-tools"][
                    "options"
                ]["auvik_api_key"],
                "topsecret",
            )

    def test_unparseable_settings_are_refused_not_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            settings = Path(tmp) / "settings.json"
            settings.write_text("{ not json", encoding="utf-8")
            with (
                mock.patch.object(self.mod, "_settings_path", return_value=settings),
                mock.patch.object(self.mod, "_write_env_file") as env_write,
            ):
                res = self.mod.write_settings_updates({"auvik_api_key": "k"})
            self.assertFalse(res["ok"])
            self.assertEqual(res["error"], "settings_unreadable")
            self.assertEqual(settings.read_text(encoding="utf-8"), "{ not json")
            env_write.assert_not_called()


if __name__ == "__main__":
    unittest.main()
