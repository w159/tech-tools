#!/usr/bin/env python3
"""atlas_warm_lead stop while the host recycles: no new lead is started for a host that is stopping, and none
outlives `stop`. The lead is a fake speaking stream-json that takes a while to exit after its stdin closes."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

import _test_isolation  # noqa: F401
import atlas_warm_lead as wl

SCRIPT = Path(wl.__file__).resolve()
FAKE = r"""
import json, os, sys, time
log, exit_delay = sys.argv[1], float(sys.argv[2])
with open(log, "a") as f:
    f.write("%d\n" % os.getpid())
print(json.dumps({"type": "autocompact_state", "tokens": 0}), flush=True)
for line in sys.stdin:
    print(json.dumps({"type": "result", "subtype": "success", "is_error": False, "result": "ok"}), flush=True)
time.sleep(exit_delay)  # a lead that takes its time to exit once its stdin closes
"""


class StopDuringRecycleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="warm-stop-")
        self.fake = Path(self.tmp) / "fake_lead.py"
        self.fake.write_text(FAKE)
        self.pids = Path(self.tmp) / "pids.txt"
        self.name = f"s{os.getpid()}x{int(time.time() * 1000) % 100000}"
        self.addCleanup(self.cleanup)

    def cleanup(self):
        self.cli("stop")
        for pid in self.spawned():
            try:
                os.kill(pid, 9)
            except OSError:
                pass
        shutil.rmtree(self.tmp, ignore_errors=True)

    def cli(self, sub, *args, lead=None):
        cmd = [
            sys.executable,
            str(SCRIPT),
            sub,
            "--root",
            self.tmp,
            "--name",
            self.name,
            *args,
        ]
        if lead is not None:
            cmd += ["--", *lead]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        try:
            return r.returncode, json.loads(r.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            return r.returncode, {"raw": r.stdout, "err": r.stderr}

    def state(self):
        return json.loads(
            (Path(self.tmp) / ".atlas/.run/warm" / self.name / "state.json").read_text()
        )

    def spawned(self):
        try:
            return [int(x) for x in self.pids.read_text().split()]
        except OSError:
            return []

    def test_stop_while_recycling_starts_no_new_lead_and_leaves_none(self):
        rc, body = self.cli(
            "start",
            "--recycle",
            "on",
            lead=[sys.executable, str(self.fake), str(self.pids), "7"],
        )
        self.assertEqual(rc, 0, body)
        rc, body = self.cli("send", "task")
        self.assertEqual(rc, 0, body)
        end = time.time() + 10
        while time.time() < end and self.state().get("status") != "recycling":
            time.sleep(0.05)
        self.assertEqual(self.state().get("status"), "recycling")
        rc, body = self.cli("stop")
        self.assertEqual(rc, 0, body)
        time.sleep(0.5)
        alive = [p for p in self.spawned() if wl.pid_alive(p)]
        self.assertEqual(
            alive, [], f"leads alive after stop: {alive} of {self.spawned()}"
        )
        self.assertEqual(
            len(self.spawned()),
            1,
            f"a lead was started for a stopping host: {self.spawned()}",
        )


if __name__ == "__main__":
    unittest.main()
