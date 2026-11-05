"""stop_tail runs the four Stop tail hooks in one process with isolated failures."""

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import stop_tail  # noqa: E402


class _Hook:
    def __init__(self, name, log, behavior=None):
        self.name, self.log, self.behavior = name, log, behavior

    def main(self):
        self.log.append((self.name, sys.stdin.read()))
        if self.behavior:
            raise self.behavior


class StopTailTest(unittest.TestCase):
    def _run(self, behaviors):
        log = []
        mods = {n: _Hook(n, log, behaviors.get(n)) for n in stop_tail.TAIL}
        with (
            mock.patch("sys.stdin", io.StringIO('{"session_id": "s"}')),
            mock.patch.object(
                stop_tail, "__import__", create=True, side_effect=mods.__getitem__
            ),
        ):
            self.assertEqual(stop_tail.main(), 0)
        return log

    def test_every_hook_gets_the_same_payload_in_order(self):
        log = self._run({})
        self.assertEqual([n for n, _ in log], list(stop_tail.TAIL))
        self.assertEqual({p for _, p in log}, {'{"session_id": "s"}'})

    def test_exit_and_exception_do_not_stop_later_hooks(self):
        log = self._run(
            {"ingest_session": SystemExit(0), "chronicle_facet": RuntimeError("boom")}
        )
        self.assertEqual([n for n, _ in log], list(stop_tail.TAIL))

    def test_slow_ingest_is_bounded_and_does_not_starve_later_hooks(self):
        import time

        log = []

        class Slow:
            def main(self):
                time.sleep(5)  # would blow the budget without a slice
                log.append("ingest_done")

        mods = {n: _Hook(n, log) for n in stop_tail.TAIL}
        mods["ingest_session"] = Slow()
        slices = dict(stop_tail.SLICES_S, ingest_session=0.2)
        t0 = time.monotonic()
        with (
            mock.patch("sys.stdin", io.StringIO("{}")),
            mock.patch.object(stop_tail, "SLICES_S", slices),
            mock.patch.object(
                stop_tail, "__import__", create=True, side_effect=mods.__getitem__
            ),
        ):
            stop_tail.main()
        self.assertLess(time.monotonic() - t0, 3)
        self.assertNotIn("ingest_done", log)
        self.assertEqual(
            [e[0] for e in log if e != "ingest_done"],
            ["chronicle_facet", "memory_capture", "nudge"],
        )

    def test_slice_budget_is_pinned(self):
        self.assertEqual(
            stop_tail.SLICES_S,
            {"ingest_session": 30, "chronicle_facet": 8, "memory_capture": 8, "nudge": 5},
        )

    def _run_one(self, name, slices=None):
        import signal

        log = []
        timers = []
        real = signal.setitimer

        def rec(which, secs, *a):
            timers.append(secs)
            return real(which, secs, *a)

        with (
            mock.patch.object(stop_tail, "__import__", create=True,
                              side_effect=lambda n: _Hook(n, log)),
            mock.patch.object(stop_tail.signal, "setitimer", side_effect=rec),
        ):
            if slices is not None:
                with mock.patch.object(stop_tail, "SLICES_S", slices):
                    stop_tail._run(name, "{}")
            else:
                stop_tail._run(name, "{}")
        return log, timers

    def test_known_hook_arms_its_slice_then_clears_the_timer(self):
        import signal

        log, timers = self._run_one("nudge")
        self.assertEqual(timers, [5, 0])
        self.assertEqual(len(log), 1)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL)[0], 0)

    def test_unknown_hook_still_runs_and_is_unbounded(self):
        log, timers = self._run_one("not_in_slices")
        self.assertEqual([n for n, _ in log], ["not_in_slices"])
        self.assertEqual(timers, [])

    def test_zero_slice_runs_unbounded(self):
        log, timers = self._run_one("nudge", slices={"nudge": 0})
        self.assertEqual(len(log), 1)
        self.assertEqual(timers, [])

    def test_off_main_thread_runs_unbounded_and_touches_no_timer(self):
        import threading

        out = {}

        def target():
            out["r"] = self._run_one("nudge")

        t = threading.Thread(target=target)
        t.start()
        t.join(10)
        log, timers = out["r"]
        self.assertEqual(len(log), 1)
        self.assertEqual(timers, [])

    def test_previous_sigalrm_handler_is_restored(self):
        import signal

        def mine(signum, frame):
            pass

        old = signal.signal(signal.SIGALRM, mine)
        try:
            self._run_one("nudge")
            self.assertIs(signal.getsignal(signal.SIGALRM), mine)
        finally:
            signal.signal(signal.SIGALRM, old)

    def test_slices_fit_in_hook_timeout(self):
        self.assertLess(sum(stop_tail.SLICES_S.values()), 60)

    def test_stdin_is_restored(self):
        before = sys.stdin
        self._run({})
        self.assertIs(sys.stdin, before)


class StopTailOutputTest(unittest.TestCase):
    """A Stop hook's hookSpecificOutput.additionalContext continues the conversation
    (an extra model turn). Only decision "block" with a reason may do that."""

    def test_non_blocking_stop_emits_no_additional_context(self):
        tmp = tempfile.mkdtemp()
        env = dict(
            os.environ,
            ATLAS_HOME=tmp,
            ATLAS_DB=os.path.join(tmp, "atlas.db"),
            ATLAS_HOOKSTATE_DIR=os.path.join(tmp, "hookstate"),
            ATLAS_QUIET="off",
        )
        payload = {
            "hook_event_name": "Stop",
            "session_id": "stop-tail-quiet",
            "cwd": tmp,
        }
        r = subprocess.run(
            [sys.executable, "-S", os.path.join(os.path.dirname(__file__), "stop_tail.py")],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            env=env,
            timeout=60,
        )
        self.assertEqual(r.returncode, 0)
        self.assertNotIn("additionalContext", r.stdout)

    def test_no_stop_hook_source_emits_additional_context(self):
        # nudge is the only TAIL hook that speaks; it must go through
        # atlas_hook_guard.emit, which routes Stop to systemMessage.
        src = open(os.path.join(os.path.dirname(__file__), "nudge.py")).read()
        self.assertNotIn('"additionalContext"', src)


if __name__ == "__main__":
    unittest.main()
