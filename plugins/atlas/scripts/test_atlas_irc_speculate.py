#!/usr/bin/env python3
"""atlas_irc `check`: the speculative unit-check run that starts once the peers' files are installed."""

import argparse
import contextlib
import io
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

import _test_isolation  # noqa: F401
import atlas_irc

STUB = "def f():\n    pass\n"
REAL = "def f():\n    return 1\n"


class SpeculateTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        tmp = Path(self._tmp.name)
        self.root, self.stubs = tmp / "root", tmp / "stubs"
        self.root.mkdir()
        self.stubs.mkdir()
        self.d = atlas_irc.init_bus(tmp / "irc", "#t", ["me", "peer"], lead="lead")
        (self.stubs / "peer.py").write_text(STUB)
        (self.root / "peer.py").write_text(REAL)
        (self.root / "me.py").write_text("x = 1\n")
        self.counter = tmp / "counter"
        self.threads = []

    def env(self, check=None, **over):
        check = check or f"echo run >> {self.counter}"
        env = {
            "ATLAS_CREW_ROOT": str(self.root),
            "ATLAS_CREW_OWNS": json.dumps(["me.py"]),
            "ATLAS_CREW_NEEDS": "peer",
            "ATLAS_CREW_NEEDS_ALL": "peer",
            "ATLAS_CREW_PEER_OWNS": json.dumps({"peer": ["peer.py"]}),
            "ATLAS_CREW_STUB_DIR": str(self.stubs),
            "ATLAS_CREW_UNIT_CHECK": check,
        }
        env.update(over)
        return env

    def runs(self) -> int:
        return len(self.counter.read_text().split()) if self.counter.exists() else 0

    def peer_done(self):
        digest = atlas_irc._owned_digest(self.root, ["peer.py"])
        atlas_irc.post(self.d, "peer", "#t", "DONE peer: ok", kind="done", extra={"digest": digest})

    def later(self, fn, wait_runs=None, delay=0.0):
        """Run fn in a thread once the unit check has run `wait_runs` times (or after `delay` seconds)."""
        def body():
            end = time.time() + 8
            while wait_runs is not None and self.runs() < wait_runs and time.time() < end:
                time.sleep(0.02)
            time.sleep(delay)
            fn()
        t = threading.Thread(target=body, daemon=True)
        t.start()
        self.threads.append(t)

    def check(self, env, timeout=8):
        a = argparse.Namespace(dir=str(self.d), as_="me", timeout=timeout)
        out = io.StringIO()
        with mock.patch.dict(os.environ, env), contextlib.redirect_stdout(out):
            rc = atlas_irc.cmd_check(a)
        for t in self.threads:
            t.join(10)
        return rc, out.getvalue()

    def me_done(self) -> bool:
        return atlas_irc.has_done(self.d, "me")

    def test_a_runs_before_peer_done_and_posts_done_with_one_run(self):
        seen = {}

        def finish():
            seen["done_before"] = self.me_done()
            self.peer_done()

        self.later(finish, wait_runs=1)
        rc, out = self.check(self.env())
        self.assertEqual(rc, 0)
        self.assertFalse(seen["done_before"])
        self.assertEqual(self.runs(), 1)
        self.assertTrue(self.me_done())
        self.assertIn("posted DONE for me", out)

    def test_b_peer_changes_file_after_the_run_reruns(self):
        def change_then_done():
            (self.root / "peer.py").write_text(REAL + "# edited\n")
            self.peer_done()

        self.later(change_then_done, wait_runs=1)
        rc, _ = self.check(self.env())
        self.assertEqual(rc, 0)
        self.assertEqual(self.runs(), 2)
        self.assertTrue(self.me_done())

    def test_b2_peer_changes_file_during_the_run_reruns(self):
        # the peer's DONE already matches the pre-run bytes, so only the before/after snapshot compare can
        # reject the first run, which saw the file change under it
        self.peer_done()
        check = f"echo run >> {self.counter}; [ $(wc -l < {self.counter}) -gt 1 ] || echo '# edit' >> {self.root}/peer.py"
        rc, _ = self.check(self.env(check=check))
        self.assertEqual(rc, 0)
        self.assertEqual(self.runs(), 2)

    def test_c_failed_speculative_run_prints_nothing_and_reruns(self):
        check = f"echo run >> {self.counter}; if [ $(wc -l < {self.counter}) -lt 2 ]; then echo SPEC-FAIL-OUTPUT; exit 1; fi; echo second-ok"
        self.later(self.peer_done, wait_runs=1, delay=0.3)
        rc, out = self.check(self.env(check=check))
        self.assertEqual(rc, 0)
        self.assertNotIn("SPEC-FAIL-OUTPUT", out)
        self.assertIn("second-ok", out)
        self.assertEqual(self.runs(), 2)
        self.assertFalse([r for r in atlas_irc.history(self.d) if r.get("kind") == "unverified"])

    def test_d_peer_equal_to_stub_waits_for_done(self):
        (self.root / "peer.py").write_text(STUB)
        seen = {}

        def finish():
            seen["runs_before_done"] = self.runs()
            self.peer_done()

        self.later(finish, delay=1.0)
        rc, _ = self.check(self.env())
        self.assertEqual(rc, 0)
        self.assertEqual(seen["runs_before_done"], 0)
        self.assertEqual(self.runs(), 1)

    def test_e_speculate_off_is_todays_behaviour(self):
        seen = {}

        def finish():
            seen["runs_before_done"] = self.runs()
            self.peer_done()

        self.later(finish, delay=1.0)
        rc, _ = self.check(self.env(ATLAS_CREW_SPECULATE="off"))
        self.assertEqual(rc, 0)
        self.assertEqual(seen["runs_before_done"], 0)
        self.assertEqual(self.runs(), 1)

    def test_f_peer_gave_up_exits_4(self):
        atlas_irc.post(self.d, "peer", "#t", "GAVE UP peer: stuck", kind="failed")
        rc, out = self.check(self.env())
        self.assertEqual(rc, 4)
        self.assertIn("peer gave up", out)
        self.assertEqual(self.runs(), 0)
        self.assertFalse(self.me_done())

    def test_missing_peer_owns_env_takes_the_normal_path(self):
        self.later(self.peer_done, delay=0.8)
        rc, _ = self.check(self.env(ATLAS_CREW_PEER_OWNS=""))
        self.assertEqual(rc, 0)
        self.assertEqual(self.runs(), 1)


    def done_rec(self):
        return atlas_irc.latest_done_record(self.d, "me")

    def test_normal_path_done_carries_peer_digests(self):
        self.peer_done()
        rc, _ = self.check(self.env(ATLAS_CREW_SPECULATE="off"))
        self.assertEqual(rc, 0)
        self.assertEqual(self.done_rec()["peer_digests"], {"peer": atlas_irc._owned_digest(self.root, ["peer.py"])})

    def test_speculative_path_done_carries_peer_digests(self):
        self.later(self.peer_done, wait_runs=1)
        rc, _ = self.check(self.env())
        self.assertEqual(rc, 0)
        self.assertEqual(self.runs(), 1)
        self.assertEqual(self.done_rec()["peer_digests"], {"peer": atlas_irc._owned_digest(self.root, ["peer.py"])})

    def test_normal_path_omits_peer_digests_when_a_peer_changed_during_the_run(self):
        self.peer_done()
        check = f"echo run >> {self.counter}; echo '# edit' >> {self.root}/peer.py"
        rc, _ = self.check(self.env(check=check, ATLAS_CREW_SPECULATE="off"))
        self.assertEqual(rc, 0)
        self.assertNotIn("peer_digests", self.done_rec())

    def test_missing_peer_owns_omits_peer_digests(self):
        self.later(self.peer_done, delay=0.8)
        rc, _ = self.check(self.env(ATLAS_CREW_PEER_OWNS=""))
        self.assertEqual(rc, 0)
        self.assertNotIn("peer_digests", self.done_rec())


if __name__ == "__main__":
    unittest.main()
