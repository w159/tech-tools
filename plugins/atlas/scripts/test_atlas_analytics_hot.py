#!/usr/bin/env python3
"""atlas_analytics_hot: key charset (counter keys such as crew.rounds.3+ and team.size.9+ must be accepted)."""

import json
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

import _test_isolation  # noqa: F401

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas_analytics_hot as hot  # noqa: E402


class KeyCharsTest(unittest.TestCase):
    def test_plus_keys_are_written_and_bad_chars_are_not(self):
        with tempfile.TemporaryDirectory() as home:
            with mock.patch.dict(os.environ, {"ATLAS_HOME": home, "ATLAS_ANALYTICS": "on"}), mock.patch(
                "subprocess.Popen"
            ):  # never a real send, even when run outside pytest
                hot.record(["crew.rounds.3+", "team.size.9+", "bad key", "a/b", "x;y"])
            path = os.path.join(home, "analytics", "events.jsonl")
            keys = [json.loads(x)["k"] for x in open(path).read().splitlines()]
        self.assertEqual(keys, ["crew.rounds.3+", "team.size.9+"])


class FlushTest(unittest.TestCase):
    """Counts used to leave the machine only at the next session start at least an hour later, so a short or
    only session (every cloud container) sent {session, active.day} and never what it did. record() now
    starts the same detached `send --auto` once an hour."""

    def run_record(self, home, stamp_age=None, env=None):
        calls = []

        class FakePopen:
            def __init__(self, argv, **kw):
                calls.append((argv, kw))

        e = {"ATLAS_HOME": home, "ATLAS_ANALYTICS": "on"}
        e.update(env or {})
        adir = os.path.join(home, "analytics")
        os.makedirs(adir, exist_ok=True)
        stamp = os.path.join(adir, "last_send.json")
        if stamp_age is not None:
            with open(stamp, "w") as f:
                json.dump({"at": time.time() - stamp_age}, f)
            os.utime(stamp, (time.time() - stamp_age,) * 2)
        with mock.patch.dict(os.environ, e):
            os.environ.pop("PYTEST_CURRENT_TEST", None)
            with mock.patch.object(hot, "_under_test", lambda: False, create=True), mock.patch("subprocess.Popen", FakePopen):
                hot.record(["gate.pass"])
                hot.record(["gate.pass"])
        return calls, stamp

    def test_first_record_starts_one_background_send_and_claims_the_hour(self):
        with tempfile.TemporaryDirectory() as home:
            calls, stamp = self.run_record(home)
            self.assertEqual(len(calls), 1)
            argv, kw = calls[0]
            self.assertEqual(argv[-2:], ["send", "--auto"])
            self.assertTrue(argv[-3].endswith("atlas_analytics.py"))
            self.assertTrue(kw["start_new_session"])
            self.assertIsInstance(json.load(open(stamp))["at"], float)

    def test_no_second_send_inside_the_hour_but_one_after_it(self):
        with tempfile.TemporaryDirectory() as home:
            self.assertEqual(len(self.run_record(home, stamp_age=60)[0]), 0)
            self.assertEqual(len(self.run_record(home, stamp_age=3700)[0]), 1)

    def test_nothing_starts_when_off_or_under_test(self):
        with tempfile.TemporaryDirectory() as home:
            self.assertEqual(self.run_record(home, env={"ATLAS_ANALYTICS": "off"})[0], [])
        with tempfile.TemporaryDirectory() as home:
            calls = []
            with mock.patch.dict(os.environ, {"ATLAS_HOME": home, "ATLAS_ANALYTICS": "on"}):
                with mock.patch("subprocess.Popen", lambda *a, **k: calls.append(a)):
                    hot.record(["gate.pass"])  # this process is a test run: the real guard
            self.assertEqual(calls, [])


class StampLockTest(unittest.TestCase):
    """The hourly stamp write must not erase a send result that atlas_analytics._note_result just wrote."""

    def _env(self, home):
        e = {"ATLAS_HOME": home, "ATLAS_ANALYTICS": "on"}
        return mock.patch.dict(os.environ, e), mock.patch.object(hot, "_under_test", lambda: False)

    def test_stamp_write_keeps_a_result_noted_between_its_read_and_write(self):
        import threading

        import atlas_analytics as aa

        with tempfile.TemporaryDirectory() as home:
            adir = os.path.join(home, "analytics")
            os.makedirs(adir)
            stamp = os.path.join(adir, "last_send.json")
            with open(stamp, "w") as f:
                json.dump({"at": 1.0}, f)
            os.utime(stamp, (1.0, 1.0))  # stale: the stamp path runs
            real_json, racers = hot._json, []

            def racing_json(path):
                d = real_json(path)
                if path == stamp and not racers:  # a finishing send notes its result right after this read
                    t = threading.Thread(target=aa._note_result, args=("sent",))
                    t.start()
                    t.join(0.5)  # unlocked it completes here; behind the lock it waits for _flush to finish
                    racers.append(t)
                return d

            env, under_test = self._env(home)
            with env, under_test, mock.patch.object(hot, "_json", racing_json), mock.patch("subprocess.Popen"):
                hot.record(["gate.pass"])
                racers[0].join(5)  # still inside the env patch: the racer resolves ATLAS_HOME when it finally runs
            final = json.load(open(stamp))
        self.assertEqual(final.get("result"), "sent")
        self.assertIn("done_at", final)
        self.assertGreater(final["at"], 1.0)

    def test_contended_lock_skips_the_stamp_and_the_spawn_without_blocking(self):
        import fcntl

        with tempfile.TemporaryDirectory() as home:
            adir = os.path.join(home, "analytics")
            os.makedirs(adir)
            stamp = os.path.join(adir, "last_send.json")
            with open(stamp, "w") as f:
                json.dump({"at": 1.0}, f)
            os.utime(stamp, (1.0, 1.0))
            calls = []
            env, under_test = self._env(home)
            with open(os.path.join(adir, ".lock"), "a+b") as held:
                fcntl.flock(held, fcntl.LOCK_EX)  # another process is inside its read-modify-write
                t0 = time.time()
                with env, under_test, mock.patch("subprocess.Popen", lambda *a, **k: calls.append(a)):
                    hot.record(["gate.pass"])
                took = time.time() - t0
            self.assertEqual(calls, [])
            self.assertEqual(json.load(open(stamp)), {"at": 1.0})
            self.assertLess(took, 1.0)


if __name__ == "__main__":
    unittest.main()
