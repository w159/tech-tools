#!/usr/bin/env python3
"""atlas_warm_lead: start waits for ready, send hands a task to the idle lead, recycle, stop, fallbacks.

The lead is a FAKE speaking the same stream-json as `claude -p --input-format stream-json`: it prints an
autocompact_state line when idle, reads one user line per turn and prints a result line echoing it."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

import _test_isolation  # noqa: F401
import atlas_warm_lead as wl

SCRIPT = Path(wl.__file__).resolve()
FAKE = r'''
import json, os, sys, time
a = sys.argv[1:]
def opt(k, d=0.0):
    return float(a[a.index(k) + 1]) if k in a else d
time.sleep(opt("--ready-delay"))
if "--no-ready" not in a:
    print(json.dumps({"type": "autocompact_state", "tokens": 0}), flush=True)
for line in sys.stdin:
    msg = json.loads(line)
    time.sleep(opt("--delay"))
    print(json.dumps({"type": "assistant", "message": {"content": "thinking"}}), flush=True)
    bg = int(opt("--bg"))  # background agents: early result, one notification each, then the answering turns
    for i in range(bg):
        print(json.dumps({"type": "system", "subtype": "task_started", "task_id": "t%d" % i}), flush=True)
    def result(text):
        print(json.dumps({"type": "result", "subtype": "success", "is_error": "--error" in a,
                          "result": text}), flush=True)
    result("%d|%s" % (os.getpid(), msg["message"]["content"]) if not bg else "early")
    for i in range(bg):
        time.sleep(opt("--bg-delay"))
        print(json.dumps({"type": "system", "subtype": "task_notification", "task_id": "t%d" % i,
                          "status": "completed"}), flush=True)
    for i in range(bg):  # the CLI answers the notifications in one turn that ends in one result per notification
        result("%d|%s|final%d" % (os.getpid(), msg["message"]["content"], i))
'''


class WarmLeadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="warm-")
        self.fake = Path(self.tmp) / "fake_lead.py"
        self.fake.write_text(FAKE)
        self.name = f"t{os.getpid()}x{int(time.time() * 1000) % 100000}"
        self.started = False
        self.addCleanup(self.cleanup)

    def cleanup(self):
        self.cli("stop")
        shutil.rmtree(self.tmp, ignore_errors=True)

    def cli(self, sub, *args, env=None, lead=()):
        cmd = [sys.executable, str(SCRIPT), sub, "--root", self.tmp, "--name", self.name, *args]
        if lead is not None and sub == "start":
            cmd += ["--", sys.executable, str(self.fake), *lead]
        e = {**os.environ, **(env or {})}
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120, env=e)
        try:
            body = json.loads(r.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            body = {"raw": r.stdout, "err": r.stderr}
        return r.returncode, body

    def start(self, *args, lead=(), env=None):
        rc, body = self.cli("start", *args, lead=lead, env=env)
        self.assertEqual(rc, 0, body)
        return body

    def state(self):
        return json.loads((Path(self.tmp) / ".atlas/.run/warm" / self.name / "state.json").read_text())

    def wait_idle(self, timeout=15):
        end = time.time() + timeout
        while time.time() < end:
            if self.state()["status"] == "idle":
                return
            time.sleep(0.05)
        self.fail(f"never idle: {self.state()}")

    def test_start_waits_for_ready(self):
        t0 = time.time()
        body = self.start(lead=["--ready-delay", "1.0"])
        self.assertGreaterEqual(time.time() - t0, 1.0)
        self.assertEqual(self.state()["status"], "idle")
        self.assertTrue(body["ok"])
        self.assertTrue(wl.pid_alive(self.state()["lead_pid"]))

    def test_send_wait_returns_echo_and_handoff(self):
        self.start()
        rc, body = self.cli("send", "--wait", "hello warm")
        self.assertEqual(rc, 0, body)
        self.assertTrue(body["result"].endswith("|hello warm"))
        self.assertFalse(body["is_error"])
        self.assertGreater(body["handoff_s"], 0)
        self.assertTrue(Path(body["log"]).read_text().count('"type": "result"') == 1)
        self.assertEqual(self.state()["tasks"], 1)

    def test_send_wait_waits_for_background_agents(self):
        self.start(lead=["--bg", "1", "--bg-delay", "1.5"])
        out = {}
        t = threading.Thread(target=lambda: out.update(zip(("rc", "body"), self.cli("send", "--wait", "bg task"))))
        t.start()
        time.sleep(0.7)  # past the early result, before the notification
        self.assertIn("early", Path(self.state()["root"], ".atlas/.run/warm", self.name, "lead.log").read_text())
        self.assertEqual(self.state()["status"], "busy")
        self.assertEqual(self.state()["results"], 1)
        t.join(30)
        self.assertEqual(out["rc"], 0, out)
        body = out["body"]
        self.assertEqual(body["results"], 2)
        self.assertTrue(body["result"].endswith("|bg task|final0"), body)
        self.assertGreaterEqual(body["handoff_s"], 1.5)
        self.wait_idle()
        self.assertEqual(self.state()["tasks"], 1)

    def test_send_wait_batched_results_after_two_agents(self):
        self.start(lead=["--bg", "2", "--bg-delay", "0.3"])
        rc, body = self.cli("send", "--wait", "two bg")
        self.assertEqual(rc, 0, body)
        self.assertEqual(body["results"], 3)
        self.assertTrue(body["result"].endswith("|two bg|final1"), body)

    def test_send_reads_stdin_and_error_result_is_nonzero(self):
        self.start(lead=["--error"])
        r = subprocess.run(
            [sys.executable, str(SCRIPT), "send", "--root", self.tmp, "--name", self.name, "--wait", "-"],
            input="from stdin", capture_output=True, text=True, timeout=60,
        )
        body = json.loads(r.stdout)
        self.assertNotEqual(r.returncode, 0)
        self.assertTrue(body["is_error"])
        self.assertTrue(body["result"].endswith("|from stdin"))

    def test_send_refused_while_busy(self):
        self.start("--recycle", "off", lead=["--delay", "1.5"])
        rc, body = self.cli("send", "first")
        self.assertEqual(rc, 0, body)
        rc, body = self.cli("send", "second")
        self.assertNotEqual(rc, 0)
        self.assertIn("not idle", body["error"])
        self.assertEqual(self.state()["tasks"], 1)

    def test_send_refused_when_not_running(self):
        rc, body = self.cli("send", "x")
        self.assertNotEqual(rc, 0)
        self.assertIn("not running", body["error"])

    def test_recycle_on_starts_new_lead(self):
        self.start("--recycle", "on")
        pid1 = self.state()["lead_pid"]
        rc, r1 = self.cli("send", "--wait", "one")
        rc2, r2 = self.cli("send", "--wait", "two")
        self.assertEqual((rc, rc2), (0, 0), (r1, r2))
        p1, p2 = int(r1["result"].split("|")[0]), int(r2["result"].split("|")[0])
        self.assertEqual(p1, pid1)
        self.assertNotEqual(p1, p2)
        self.assertFalse(wl.pid_alive(p1))
        self.wait_idle()
        p3 = self.state()["lead_pid"]  # the lead that ran task two was recycled too
        self.assertNotIn(p3, (p1, p2))
        self.assertTrue(wl.pid_alive(p3))
        self.assertFalse(wl.pid_alive(p2))

    def test_recycle_off_keeps_pid(self):
        self.start("--recycle", "off")
        _, r1 = self.cli("send", "--wait", "one")
        _, r2 = self.cli("send", "--wait", "two")
        self.assertEqual(r1["result"].split("|")[0], r2["result"].split("|")[0])
        self.assertEqual(self.state()["status"], "idle")

    def test_stop_is_idempotent_and_leaves_nothing(self):
        self.start()
        st = self.state()
        pids = (st["host_pid"], st["lead_pid"])
        rc, body = self.cli("stop")
        self.assertEqual(rc, 0, body)
        for pid in pids:
            self.assertFalse(wl.pid_alive(pid), pid)
        self.assertEqual(self.state()["status"], "stopped")
        if shutil.which("tmux"):
            has = subprocess.run(["tmux", "has-session", "-t", wl.tmux_name(self.name)], capture_output=True)
            self.assertNotEqual(has.returncode, 0)
        rc, _ = self.cli("stop")
        self.assertEqual(rc, 0)
        rc, _ = self.cli("send", "x")
        self.assertNotEqual(rc, 0)

    def test_stop_without_start_is_ok(self):
        rc, body = self.cli("stop")
        self.assertEqual(rc, 0, body)
        self.assertTrue(body["stopped"])

    def test_start_timeout(self):
        t0 = time.time()
        rc, body = self.cli("start", "--timeout", "1", lead=["--no-ready"])
        self.assertNotEqual(rc, 0)
        self.assertIn("not ready", body["error"])
        self.assertLess(time.time() - t0, 20)
        st = self.state()
        self.assertEqual(st["status"], "stopped")
        self.assertFalse(wl.pid_alive(st["host_pid"]))
        self.assertFalse(wl.pid_alive(st["lead_pid"]))

    def test_start_twice_refused(self):
        self.start()
        rc, body = self.cli("start", lead=[])
        self.assertNotEqual(rc, 0)
        self.assertIn("already running", body["error"])

    @unittest.skipUnless(shutil.which("tmux"), "tmux not installed")
    def test_tmux_launcher(self):
        self.start()
        st = self.state()
        self.assertEqual(st["launcher"], "tmux")
        has = subprocess.run(["tmux", "has-session", "-t", wl.tmux_name(self.name)], capture_output=True)
        self.assertEqual(has.returncode, 0)

    def test_no_tmux_fallback(self):
        empty = tempfile.mkdtemp(prefix="nopath-")
        self.addCleanup(shutil.rmtree, empty, True)
        self.start(env={"PATH": empty})
        st = self.state()
        self.assertEqual(st["launcher"], "subprocess")
        self.assertIn("tmux not on PATH", st["note"])
        rc, body = self.cli("send", "--wait", "no tmux", env={"PATH": empty})
        self.assertEqual(rc, 0, body)
        self.assertTrue(body["result"].endswith("|no tmux"))

    def test_status_reports_usage(self):
        self.start()
        rc, body = self.cli("status")
        self.assertEqual(rc, 0)
        self.assertEqual(body["status"], "idle")
        self.assertTrue(body["lead_alive"] and body["host_alive"])
        if Path("/proc/self/status").exists():
            self.assertGreater(body["rss_kb"], 0)
            self.assertGreaterEqual(body["cpu_s"], 0)

    def test_lead_cmd_adds_only_stream_flags(self):
        cmd = wl.lead_cmd(["claude", "--model", "m", "--permission-mode", "acceptEdits"])
        for flag in ("-p", "--input-format", "--output-format", "--verbose"):
            self.assertIn(flag, cmd)
        self.assertEqual(cmd[:5], ["claude", "--model", "m", "--permission-mode", "acceptEdits"])
        self.assertFalse([c for c in cmd if "dangerously" in c or c == "bypassPermissions"])
        again = wl.lead_cmd(cmd)
        self.assertEqual(again, cmd)
        self.assertEqual(wl.lead_cmd(["claude", "--print", "--input-format=stream-json"]).count("--input-format"), 0)


if __name__ == "__main__":
    unittest.main()
