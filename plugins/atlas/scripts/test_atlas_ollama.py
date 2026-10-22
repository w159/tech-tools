#!/usr/bin/env python3
"""Tests for atlas_ollama: `ollama list` parsing, filter/sort, status, pull jobs, delete, popularity cache."""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import atlas_ollama as ol

# Real `ollama list` output from this machine (cloud rows have SIZE "-").
LIST = """NAME                          ID              SIZE      MODIFIED
minimax-m3.1-flash:cloud      00b189154096    -         45 hours ago
nimble:latest                 9b953de7a533    9.5 GB    2 weeks ago
qwen3:8b                      aaaabbbbcccc    5.2 GB    3 days ago
llama3.2:1b                   dddd11112222    1.3 GB    2 months ago
"""
PS = "NAME            ID              SIZE      PROCESSOR    UNTIL\nqwen3:8b        aaaabbbbcccc    6.0 GB    100% GPU     4 minutes from now\n"


class Ctx:
    def __init__(self, query=None, body=None, groups=()):
        self.query, self._body, self.groups = query or {}, body or {}, groups

    def json(self):
        return self._body


class FakeOllama:
    """The `ollama` binary: list/ps/--version/pull/rm/show answered from memory."""

    def __init__(self):
        self.listing, self.ps = LIST, PS
        self.pull_lines = ("pulling manifest", "pulling aa 40%", "pulling aa 100%")
        self.pull_rc = 0
        self.calls = []

    def __call__(self, argv, timeout=15, on_line=None, host=None):
        self.calls.append(list(argv))
        self.hosts = getattr(self, "hosts", []) + [host]
        cmd = argv[1]
        if cmd == "list":
            return 0, self.listing, ""
        if cmd == "ps":
            return 0, self.ps, ""
        if cmd == "--version":
            return 0, "ollama version is 0.12.3\n", ""
        if cmd == "show":
            return 0, "  context length      131072\n  quantization        Q4_K_M\n", ""
        if cmd == "rm":
            return 0, "deleted 'x'\n", ""
        if cmd == "pull":
            for line in self.pull_lines:
                on_line(line)
            return self.pull_rc, "", "" if self.pull_rc == 0 else "boom"
        return 1, "", "unknown"


class OllamaCase(unittest.TestCase):
    def setUp(self):
        self.fake = FakeOllama()
        p = mock.patch.object(ol, "run", self.fake)
        p.start()
        self.addCleanup(p.stop)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        h = mock.patch.dict(os.environ, {"HOME": self.tmp.name})
        h.start()
        self.addCleanup(h.stop)


class TestParse(OllamaCase):
    def test_real_list_output_parses_cloud_and_local_rows(self):
        rows = {m["name"]: m for m in ol.parse_list(LIST, now=1_000_000)}
        self.assertEqual(len(rows), 4)
        cloud = rows["minimax-m3.1-flash:cloud"]
        self.assertTrue(cloud["cloud"])
        self.assertIsNone(cloud["size_bytes"])
        self.assertEqual(cloud["modified_at"], 1_000_000 - 45 * 3600)
        nimble = rows["nimble:latest"]
        self.assertFalse(nimble["cloud"])
        self.assertEqual(
            (nimble["size_bytes"], nimble["tag"], nimble["family"]),
            (9_500_000_000, "latest", "nimble"),
        )
        self.assertEqual(rows["qwen3:8b"]["params"], "8B")

    def test_a_dash_size_is_cloud_even_without_the_cloud_tag(self):
        row = ol.parse_list("x:latest  ffff00001111  -  1 day ago\n")[0]
        self.assertTrue(row["cloud"])


SHOW = """  Model
    architecture    bert
    context length  2048

  Capabilities
    embedding

  Parameters
    num_ctx    8192
"""


class TestCapabilities(OllamaCase):
    def test_parse_capabilities_reads_the_block_only(self):
        self.assertEqual(ol.parse_capabilities(SHOW), ["embedding"])
        self.assertEqual(ol.parse_capabilities("  Capabilities\n    completion\n    vision\n"), ["completion", "vision"])
        self.assertEqual(ol.parse_capabilities("  Model\n    x  y\n"), [])

    def test_list_models_adds_capabilities_cached_and_defaulting_to_completion(self):
        base, shows = self.fake.__call__, []
        def show(argv, **kw):
            if argv[1] == "show":
                shows.append(argv[2])
                return (0, SHOW, "") if argv[2] == "qwen3:8b" else base(argv, **kw)
            return base(argv, **kw)
        with mock.patch.object(ol, "run", show):
            caps = {m["name"]: m["capabilities"] for m in ol.list_models()["models"]}
            ol.list_models()
        self.assertEqual(caps["qwen3:8b"], ["embedding"])
        self.assertEqual(caps["nimble:latest"], ["completion"])  # no block: assume completion
        self.assertEqual(caps["minimax-m3.1-flash:cloud"], ["completion"])
        cache = json.loads(Path(self.tmp.name, ".atlas", "ollama-show-cache.json").read_text())
        self.assertEqual(cache["qwen3:8b"]["caps"], ["embedding"])
        self.assertEqual(shows.count("qwen3:8b"), 1)  # second list served from the 10 min cache


class TestListModels(OllamaCase):
    def names(self, **kw):
        return [m["name"] for m in ol.list_models(**kw)["models"]]

    def test_scope_filters_local_and_cloud(self):
        self.assertEqual(self.names(scope="cloud"), ["minimax-m3.1-flash:cloud"])
        self.assertNotIn("minimax-m3.1-flash:cloud", self.names(scope="local"))
        self.assertEqual(len(self.names(scope="all")), 4)

    def test_sorts(self):
        self.assertEqual(self.names(sort="name")[0], "llama3.2:1b")
        self.assertEqual(self.names(sort="size")[0], "nimble:latest")
        self.assertEqual(self.names(sort="latest")[0], "minimax-m3.1-flash:cloud")
        self.assertEqual(self.names(sort="latest")[-1], "llama3.2:1b")

    def test_query_filters_by_substring(self):
        self.assertEqual(self.names(q="QWEN"), ["qwen3:8b"])

    def test_running_flag_comes_from_ps(self):
        running = {m["name"] for m in ol.list_models()["models"] if m["running"]}
        self.assertEqual(running, {"qwen3:8b"})

    def test_popular_sort_ranks_from_the_library_page_and_nulls_sink(self):
        html = '<a href="/library/qwen3"></a><a href="/library/llama3.2"></a><a href="/library/qwen3"></a>'
        with mock.patch.object(ol, "fetch_library", lambda *a, **k: html):
            res = ol.list_models(sort="popular")["models"]
        ranks = {m["name"]: m["popularity_rank"] for m in res}
        self.assertEqual(
            (ranks["qwen3:8b"], ranks["llama3.2:1b"], ranks["nimble:latest"]),
            (1, 2, None),
        )
        self.assertEqual([m["name"] for m in res][:2], ["qwen3:8b", "llama3.2:1b"])

    def test_popular_failure_leaves_rank_null_and_does_not_raise(self):
        def boom(*a, **k):
            raise OSError("offline")

        with mock.patch.object(ol, "fetch_library", boom):
            res = ol.list_models(sort="popular")
        self.assertTrue(res["ok"])
        self.assertTrue(all(m["popularity_rank"] is None for m in res["models"]))

    def test_library_is_cached_for_ten_minutes_under_home(self):
        calls = []

        def fetch(*a, **k):
            calls.append(1)
            return '<a href="/library/qwen3"></a>'

        with mock.patch.object(ol, "fetch_library", fetch):
            ol.popular_order(now=1000)
            ol.popular_order(now=1000 + 599)
            self.assertEqual(len(calls), 1)
            ol.popular_order(now=1000 + 601)
        self.assertEqual(len(calls), 2)
        cache = Path(self.tmp.name) / ".atlas" / "ollama-library.json"
        self.assertEqual(json.loads(cache.read_text())["names"], ["qwen3"])

    def test_detail_fills_context_and_quant_for_local_models_only(self):
        rows = {m["name"]: m for m in ol.list_models(detail=True)["models"]}
        self.assertEqual(
            (rows["qwen3:8b"]["context"], rows["qwen3:8b"]["quant"]), (131072, "Q4_K_M")
        )
        self.assertIsNone(rows["minimax-m3.1-flash:cloud"]["context"])

    def test_missing_binary_is_an_error_not_a_crash(self):
        with mock.patch.object(
            ol, "run", lambda argv, **k: (127, "", "ollama binary not found")
        ):
            res = ol.list_models()
        self.assertEqual((res["ok"], res["error"]), (False, "ollama_unavailable"))


class TestRoutes(OllamaCase):
    def wait_job(self, job_id):
        for _ in range(300):
            _, job = ol._job(Ctx(groups=(job_id,)))
            if job["status"] != "running":
                return job
            time.sleep(0.01)
        self.fail("pull job never finished")

    def test_models_route_rejects_bad_query(self):
        status, body = ol._models(Ctx({"scope": "mars"}))
        self.assertEqual((status, body["error"]), (400, "bad_query"))

    def test_models_route_returns_the_list(self):
        status, body = ol._models(Ctx({"scope": "local", "sort": "name"}))
        self.assertEqual(status, 200)
        self.assertEqual(body["models"][0]["name"], "llama3.2:1b")

    def test_status_reports_version_and_ps(self):
        _, body = ol._status(Ctx())
        self.assertEqual((body["reachable"], body["version"]), (True, "0.12.3"))
        self.assertEqual(body["ps"][0]["name"], "qwen3:8b")

    def test_status_honors_url_and_rejects_public_hosts(self):
        _, body = ol._status(Ctx({"url": "http://192.168.1.5:11434"}))
        self.assertEqual((body["reachable"], body["version"]), (True, "0.12.3"))
        self.assertEqual(set(self.fake.hosts), {"http://192.168.1.5:11434"})
        status, body = ol._status(Ctx({"url": "http://evil.example"}))
        self.assertEqual((status, body["error"]), (400, "bad_url"))

    def test_status_when_unreachable(self):
        with mock.patch.object(
            ol, "run", lambda argv, **k: (1, "", "connection refused")
        ):
            _, body = ol._status(Ctx())
        self.assertFalse(body["reachable"])
        self.assertIn("refused", body["error"])

    def test_pull_job_lifecycle(self):
        status, body = ol._pull(Ctx(body={"name": "qwen3:8b"}))
        self.assertEqual(status, 202)
        job = self.wait_job(body["job"])
        self.assertEqual((job["status"], job["percent"], job["rc"]), ("done", 100, 0))
        self.assertEqual(job["lines"], list(self.fake.pull_lines))
        self.assertIn(["ollama", "pull", "qwen3:8b"], self.fake.calls)

    def test_failed_pull_ends_in_error_with_the_message(self):
        self.fake.pull_rc = 1
        _, body = ol._pull(Ctx(body={"name": "nope:1b"}))
        job = self.wait_job(body["job"])
        self.assertEqual(job["status"], "error")
        self.assertIn("boom", job["lines"])

    def test_pull_rejects_bad_names_and_unknown_jobs_404(self):
        for bad in ("", "a b", "x;rm -rf /", "-flag"):
            self.assertEqual(ol._pull(Ctx(body={"name": bad}))[0], 400, bad)
        self.assertEqual(ol._job(Ctx(groups=("nope",)))[0], 404)

    def test_delete_needs_confirm_then_removes(self):
        status, body = ol._delete(Ctx(groups=("qwen3%3A8b",)))
        self.assertEqual((status, body["error"]), (409, "needs_confirm"))
        self.assertNotIn(["ollama", "rm", "qwen3:8b"], self.fake.calls)
        status, body = ol._delete(Ctx(body={"confirm": True}, groups=("qwen3%3A8b",)))
        self.assertEqual((status, body["removed"]), (200, "qwen3:8b"))
        self.assertIn(["ollama", "rm", "qwen3:8b"], self.fake.calls)

    def test_delete_unknown_model_is_404(self):
        status, body = ol._delete(Ctx(body={"confirm": True}, groups=("ghost:1b",)))
        self.assertEqual((status, body["error"]), (404, "unknown_model"))

    def test_validate_model_suggests_closest(self):
        self.assertEqual(ol.validate_model("qwen3:8b"), (True, []))
        self.assertEqual(
            ol.validate_model("nimble"), (True, [])
        )  # bare name resolves to :latest
        ok, matches = ol.validate_model("qwen3:9b")
        self.assertFalse(ok)
        self.assertEqual(matches[0], "qwen3:8b")

    def test_routes_are_mounted_with_the_documented_paths(self):
        paths = {(m, p) for m, p, _ in ol.ROUTES}
        self.assertEqual(
            paths,
            {
                ("GET", "/api/v2/ollama/models"),
                ("GET", "/api/v2/ollama/status"),
                ("POST", "/api/v2/ollama/pull"),
                ("GET", "/api/v2/ollama/jobs/([A-Za-z0-9_-]+)"),
                ("DELETE", "/api/v2/ollama/models/(.+)"),
            },
        )


if __name__ == "__main__":
    unittest.main()
