#!/usr/bin/env python3
"""Extra behavior tests for sweep_state.py: on-disk format, timestamps,
cursor ordering, per-source reads and CLI misuse."""

import _test_isolation  # noqa: F401,E402
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "sweep_state.py"
_spec = importlib.util.spec_from_file_location("sweep_state_under_test", SCRIPT)
ss = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ss)


def run(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *args],
                          capture_output=True, text=True)


def word(res):
    return res.stdout.strip().splitlines()[0]


def payload(res):
    out = res.stdout.strip().splitlines()
    return json.loads(out[1]) if len(out) > 1 else {}


class CursorRegressesTest(unittest.TestCase):
    def test_none_old_never_regresses(self):
        self.assertIs(ss.cursor_regresses(None, "5"), False)

    def test_numeric_compare_not_lexical(self):
        # lexically "10" < "9", numerically it is an advance
        self.assertIs(ss.cursor_regresses("9", "10"), False)
        self.assertIs(ss.cursor_regresses("10", "9"), True)
        self.assertIs(ss.cursor_regresses("1.5", "1.25"), True)

    def test_equal_is_not_regression(self):
        self.assertIs(ss.cursor_regresses("5", "5"), False)
        self.assertIs(ss.cursor_regresses("abc", "abc"), False)

    def test_string_fallback(self):
        self.assertIs(ss.cursor_regresses("b", "a"), True)
        self.assertIs(ss.cursor_regresses("a", "b"), False)
        # one side numeric, the other not: falls back to string ordering
        self.assertIs(ss.cursor_regresses("2", "10x"), True)
        self.assertIs(ss.cursor_regresses("2024-02-01", "2024-01-01"), True)
        self.assertIs(ss.cursor_regresses("2024-01-01", "2024-02-01"), False)


class IsoHelpersTest(unittest.TestCase):
    def test_now_iso_is_parseable_utc_now(self):
        before = datetime.now(timezone.utc)
        value = ss.now_iso()
        after = datetime.now(timezone.utc)
        self.assertIsInstance(value, str)
        parsed = datetime.fromisoformat(value)
        self.assertIsNotNone(parsed.tzinfo)
        self.assertEqual(parsed.utcoffset().total_seconds(), 0)
        self.assertTrue(before <= parsed <= after)

    def test_parse_iso(self):
        self.assertIsNone(ss.parse_iso("not a time"))
        self.assertIsNone(ss.parse_iso(None))
        self.assertEqual(ss.parse_iso("2024-01-02T03:04:05+00:00").year, 2024)


class EngineCliTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.state = str(self.dir / "s.json")

    def acquire(self, w="w1"):
        return run("lease-acquire", "--state", self.state, "--writer", w)

    def test_lease_timestamp_is_real_iso_and_file_format(self):
        self.assertEqual(word(self.acquire()), "OK")
        raw = Path(self.state).read_text(encoding="utf-8")
        self.assertTrue(raw.endswith("}\n"))
        # indent=2 and insertion order preserved (sort_keys False)
        self.assertIn('\n  "lease": {\n    "writer": "w1",', raw)
        data = json.loads(raw)
        ts = datetime.fromisoformat(data["lease"]["timestamp"])
        self.assertLess(abs((datetime.now(timezone.utc) - ts).total_seconds()), 120)
        self.assertEqual(data["lease"]["ttl_minutes"], 60.0)
        self.assertEqual(data["schema_version"], 1)
        # no temp files left behind
        self.assertEqual([p.name for p in self.dir.glob(".sweep-state-*")], [])

    def test_read_without_state(self):
        res = run("read", "--state", self.state)
        self.assertEqual(word(res), "NO-STATE")
        self.assertEqual(res.returncode, 0)

    def test_read_source_returns_only_cursor(self):
        self.acquire()
        run("upsert-item", "--state", self.state, "--writer", "w1",
            "--source", "gh", "--id", "1", "--json", '{"status":"open"}')
        self.assertEqual(word(run("cursor-advance", "--state", self.state,
                                  "--writer", "w1", "--source", "gh",
                                  "--to", "42", "--past-item", "1")), "OK")
        res = run("read", "--state", self.state, "--source", "gh")
        self.assertEqual(word(res), "OK")
        self.assertEqual(payload(res), {"source": "gh", "cursor": "42"})
        res = run("read", "--state", self.state, "--source", "unknown")
        self.assertEqual(payload(res), {"source": "unknown", "cursor": None})
        full = payload(run("read", "--state", self.state))
        self.assertIn("items", full)
        self.assertEqual(full["sources"]["gh"]["cursor"], "42")

    def test_cursor_numeric_advance_and_regression(self):
        self.acquire()
        run("upsert-item", "--state", self.state, "--writer", "w1",
            "--source", "gh", "--id", "1", "--json", "{}")

        def adv(to):
            return word(run("cursor-advance", "--state", self.state,
                            "--writer", "w1", "--source", "gh", "--to", to,
                            "--past-item", "1"))
        self.assertEqual(adv("9"), "OK")
        self.assertEqual(adv("10"), "OK")
        self.assertEqual(adv("9"), "REFUSED")
        self.assertEqual(adv("10"), "OK")

    def test_cursor_string_regression_refused(self):
        self.acquire()
        run("upsert-item", "--state", self.state, "--writer", "w1",
            "--source", "gh", "--id", "1", "--json", "{}")

        def adv(to):
            return word(run("cursor-advance", "--state", self.state,
                            "--writer", "w1", "--source", "gh", "--to", to,
                            "--past-item", "1"))
        self.assertEqual(adv("2024-02-01T00:00:00Z"), "OK")
        self.assertEqual(adv("2024-01-01T00:00:00Z"), "REFUSED")
        data = json.loads(Path(self.state).read_text())
        self.assertEqual(data["sources"]["gh"]["cursor"], "2024-02-01T00:00:00Z")

    def test_cursor_unknown_item_refused(self):
        self.acquire()
        res = run("cursor-advance", "--state", self.state, "--writer", "w1",
                  "--source", "gh", "--to", "1", "--past-item", "nope")
        self.assertEqual(word(res), "REFUSED")

    def test_missing_subcommand_exits_2(self):
        res = run()
        self.assertEqual(res.returncode, 2)
        self.assertEqual(res.stdout, "")

    def test_every_subcommand_requires_state(self):
        for cmd in ("lease-acquire", "lease-release", "read", "upsert-item",
                    "cursor-advance", "run-record", "validate"):
            res = run(cmd)
            self.assertEqual(res.returncode, 2, cmd)
            self.assertIn("--state", res.stderr, cmd)

    def test_missing_state_dir_exits_2_with_error(self):
        res = run("read", "--state", str(self.dir / "nodir" / "s.json"))
        self.assertEqual(res.returncode, 2)
        self.assertIn("state directory does not exist", res.stderr)

    def test_corrupt_state_reports_corrupt_exit_0(self):
        Path(self.state).write_text("{not json", encoding="utf-8")
        res = run("read", "--state", self.state)
        self.assertEqual(res.returncode, 0)
        self.assertEqual(word(res), "CORRUPT")
        self.assertEqual(Path(self.state).read_text(), "{not json")

    def test_run_record_validates_and_stamps(self):
        self.acquire()
        res = run("run-record", "--state", self.state, "--writer", "w1",
                  "--outcome", "completed", "--counts", '{"n": 3}')
        self.assertEqual(word(res), "OK")
        rec = payload(res)
        self.assertEqual(rec["counts"], {"n": 3})
        self.assertEqual(rec["writer"], "w1")
        self.assertIsNotNone(ss.parse_iso(rec["timestamp"]))
        self.assertEqual(run("run-record", "--state", self.state, "--writer", "w1",
                             "--outcome", "bogus").returncode, 2)
        self.assertEqual(run("run-record", "--state", self.state, "--writer", "w1",
                             "--outcome", "partial", "--timestamp", "zzz").returncode, 2)
        self.assertEqual(run("run-record", "--state", self.state, "--writer", "w1",
                             "--outcome", "partial", "--counts", "[1]").returncode, 2)


if __name__ == "__main__":
    unittest.main()
