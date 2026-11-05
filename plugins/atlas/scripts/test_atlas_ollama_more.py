#!/usr/bin/env python3
"""atlas_ollama: size units, ps parsing, library fetch, run seam, bad-query body."""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402
import io
import os
import sys
import unittest
from unittest import mock

import atlas_ollama as ol


class ParsingTest(unittest.TestCase):
    def test_size_units_are_decimal_powers(self):
        want = {"1 B": 1, "1 KB": 10**3, "2 MB": 2 * 10**6, "1.5 GB": 1_500_000_000,
                "1 TB": 10**12, "3GB": 3 * 10**9}
        for text, n in want.items():
            self.assertEqual(ol._size_bytes(text), n, text)
        self.assertIsNone(ol._size_bytes("-"))

    def test_age_seconds(self):
        self.assertEqual(ol._age_seconds("45 hours ago"), 45 * 3600)
        self.assertEqual(ol._age_seconds("about an hour ago"), 3600)
        self.assertEqual(ol._age_seconds("2 weeks ago"), 14 * 86400)
        self.assertIsNone(ol._age_seconds("yesterday"))

    def test_parse_list_skips_header_shaped_row_named_name(self):
        text = "NAME  idid  1.0 GB  2 days ago\nqwen3:8b  aaaa  5.2 GB  3 days ago\n"
        self.assertEqual([m["name"] for m in ol.parse_list(text)], ["qwen3:8b"])

    def test_parse_ps_skips_header_and_blank_lines(self):
        text = "NAME   ID   SIZE   UNTIL\nqwen3:8b  aaaa  6 GB  4 minutes\n\n   \nllama3  bbbb  1 GB  now\n"
        rows = ol.parse_ps(text)
        self.assertEqual([r["name"] for r in rows], ["qwen3:8b", "llama3"])
        self.assertEqual(rows[0]["line"], "qwen3:8b  aaaa  6 GB  4 minutes")

    def test_parse_library_dedupes_in_order(self):
        html = '<a href="/library/b"></a><a href="/library/a.1"></a><a href="/library/b"></a><a href="/x/c">'
        self.assertEqual(ol.parse_library(html), ["b", "a.1"])


class FetchLibraryTest(unittest.TestCase):
    def test_returns_decoded_body_with_agent_header_and_timeout(self):
        seen = {}

        class Resp(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def fake_open(req, timeout=None):
            seen["url"], seen["ua"], seen["timeout"] = req.full_url, req.get_header("User-agent"), timeout
            return Resp(b"caf\xc3\xa9 \xff")

        with mock.patch.object(ol.urllib.request, "urlopen", fake_open):
            body = ol.fetch_library("https://example.test/lib", timeout=7)
        self.assertEqual(body, "café �")
        self.assertEqual(seen, {"url": "https://example.test/lib", "ua": "atlas-dashboard", "timeout": 7})


class EnvAndRunTest(unittest.TestCase):
    def test_env_host_precedence(self):
        with mock.patch.dict(os.environ, {"ATLAS_OLLAMA_URL": "http://envhost:1"}):
            self.assertEqual(ol._env()["OLLAMA_HOST"], "http://envhost:1")
            self.assertEqual(ol._env("http://arg:2")["OLLAMA_HOST"], "http://arg:2")
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ATLAS_OLLAMA_URL", None)
            os.environ.pop("OLLAMA_HOST", None)
            self.assertNotIn("OLLAMA_HOST", ol._env())

    def test_run_captures_rc_stdout_stderr(self):
        code = "import sys; print('out'); print('err', file=sys.stderr); sys.exit(3)"
        self.assertEqual(ol.run([sys.executable, "-c", code]), (3, "out\n", "err\n"))

    def test_run_passes_host_to_child_env(self):
        code = "import os; print(os.environ['OLLAMA_HOST'])"
        rc, out, _ = ol.run([sys.executable, "-c", code], host="http://h:9")
        self.assertEqual((rc, out.strip()), (0, "http://h:9"))

    def test_run_missing_binary_is_127_and_timeout_is_124(self):
        self.assertEqual(ol.run(["/nonexistent/ollama-bin"]), (127, "", "ollama binary not found"))
        self.assertEqual(
            ol.run([sys.executable, "-c", "import time; time.sleep(5)"], timeout=0.2),
            (124, "", "ollama timed out"),
        )

    def test_run_streams_lines_splitting_on_cr_and_lf_and_dropping_blanks(self):
        code = "import sys; sys.stdout.write('a 10%\\ra 90%\\r\\n\\nlast'); sys.stdout.flush(); sys.exit(2)"
        lines = []
        rc = ol.run([sys.executable, "-c", code], on_line=lines.append)
        self.assertEqual(rc, (2, "", ""))
        self.assertEqual(lines, ["a 10%", "a 90%", "last"])

    def test_run_streaming_missing_binary(self):
        self.assertEqual(ol.run(["/nonexistent/ollama-bin"], on_line=print)[0], 127)


class ModelsRouteTest(unittest.TestCase):
    def test_bad_query_body_is_ok_false_with_error(self):
        class Ctx:
            query = {"scope": "mars"}

        self.assertEqual(ol._models(Ctx()), (400, {"ok": False, "error": "bad_query"}))
        Ctx.query = {"sort": "bogus"}
        self.assertEqual(ol._models(Ctx()), (400, {"ok": False, "error": "bad_query"}))


class PullJobsTest(unittest.TestCase):
    def setUp(self):
        saved = dict(ol._jobs)
        ol._jobs.clear()
        self.addCleanup(lambda: (ol._jobs.clear(), ol._jobs.update(saved)))

    def test_start_pull_evicts_oldest_finished_job_at_capacity(self):
        for i in range(ol.MAX_JOBS):
            ol._jobs[f"j{i}"] = {"finished": 100 + i if i != 1 else None}
        with mock.patch.object(ol.threading, "Thread"):
            job = ol.start_pull("qwen3:8b")
        self.assertEqual(len(ol._jobs), ol.MAX_JOBS)
        self.assertNotIn("j0", ol._jobs)
        self.assertIn("j1", ol._jobs)  # unfinished jobs are never evicted
        self.assertIn(job["id"], ol._jobs)
        self.assertEqual(
            {k: job[k] for k in ("name", "status", "percent", "lines", "rc", "finished")},
            {"name": "qwen3:8b", "status": "running", "percent": 0, "lines": [], "rc": None, "finished": None},
        )

    def test_start_pull_below_capacity_evicts_nothing(self):
        for i in range(3):
            ol._jobs[f"j{i}"] = {"finished": 5}
        with mock.patch.object(ol.threading, "Thread"):
            ol.start_pull("x")
        self.assertEqual(len(ol._jobs), 4)

    def test_worker_tracks_percent_caps_lines_and_marks_done(self):
        def fake_run(argv, timeout=None, on_line=None, host=None):
            self.assertEqual(argv, ["ollama", "pull", "m"])
            for i in range(250):
                on_line(f"line {i}")
            on_line("pulling 42%")
            return 0, "", ""

        job = {"name": "m", "lines": [], "percent": 0, "rc": None, "status": "running", "finished": None}
        with mock.patch.object(ol, "run", fake_run):
            ol._pull_worker(job)
        self.assertEqual((job["status"], job["rc"], job["percent"]), ("done", 0, 100))
        self.assertEqual(len(job["lines"]), 200)
        self.assertEqual(job["lines"][-1], "pulling 42%")
        self.assertIsNotNone(job["finished"])

    def test_worker_error_keeps_percent_and_appends_stderr(self):
        def fake_run(argv, timeout=None, on_line=None, host=None):
            on_line("pulling 42%")
            return 1, "", " boom \n"

        job = {"name": "m", "lines": [], "percent": 0, "rc": None, "status": "running", "finished": None}
        with mock.patch.object(ol, "run", fake_run):
            ol._pull_worker(job)
        self.assertEqual((job["status"], job["rc"], job["percent"]), ("error", 1, 42))
        self.assertEqual(job["lines"][-1], "boom")


if __name__ == "__main__":
    unittest.main()
