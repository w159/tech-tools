#!/usr/bin/env python3
"""In-process tests for atlas_warm_lead: state helpers, Host event tracking, the host loop, start/stop/send/status.

The lead is a fake Python process speaking the same stream-json as `claude -p`. tmux is never run: the tmux
boundary (`_tmux`, `use_tmux`) is stubbed where the surrounding logic is tested."""

import _test_isolation  # noqa: F401  (must be first)
import argparse
import io
import json
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

import atlas_warm_lead as wl
from test_atlas_warm_lead import FAKE

SCRIPT = Path(wl.__file__).resolve()
STUCK = (
    "import json,sys,time\n"
    "print(json.dumps({'type':'autocompact_state'}),flush=True)\n"
    "sys.stdin.readline()\n"
    "print(json.dumps({'type':'system','subtype':'task_started','task_id':'t0'}),flush=True)\n"
    "print(json.dumps({'type':'result','subtype':'success','result':'early'}),flush=True)\n"
    "print(json.dumps({'type':'system','subtype':'task_notification','task_id':'t0'}),flush=True)\n"
    "time.sleep(60)\n"
)


def wait_for(pred, timeout=15.0):
    end = time.time() + timeout
    while time.time() < end:
        v = pred()
        if v:
            return v
        time.sleep(0.02)
    raise AssertionError("condition not reached")


# ------------------------------------------------------------ pure helpers


def test_rundir_resolves_root_and_joins_name(tmp_path):
    rd = wl.rundir(tmp_path / "x" / "..", "nm")
    assert rd == tmp_path.resolve() / ".atlas" / ".run" / "warm" / "nm"


def test_lead_cmd_adds_only_missing_stream_flags():
    assert wl.lead_cmd(["claude", "--model", "m"]) == [
        "claude", "--model", "m", "-p", "--input-format", "stream-json",
        "--output-format", "stream-json", "--verbose",
    ]
    full = ["claude", "--print", "--input-format=text", "--output-format", "x", "--verbose"]
    assert wl.lead_cmd(full) == full
    assert wl.lead_cmd(["c", "-p"]).count("-p") == 1


def test_lead_cmd_does_not_mutate_input():
    args = ["claude"]
    wl.lead_cmd(args)
    assert args == ["claude"]


def test_state_roundtrip_merge_and_atomic_write(tmp_path):
    assert wl.read_state(tmp_path) is None
    (tmp_path / "state.json").write_text("{bad")
    assert wl.read_state(tmp_path) is None
    assert wl.write_state(tmp_path, a=1) == {"a": 1}
    assert wl.write_state(tmp_path, b=2) == {"a": 1, "b": 2}
    assert wl.read_state(tmp_path) == {"a": 1, "b": 2}
    assert sorted(p.name for p in tmp_path.iterdir()) == ["state.json"]


def test_pid_alive_cases():
    assert wl.pid_alive(None) is False
    assert wl.pid_alive(0) is False
    assert wl.pid_alive(os.getpid()) is True
    assert wl.pid_alive("not-a-pid") is False
    p = subprocess.Popen(["true"])
    p.wait()
    assert wl.pid_alive(p.pid) is False


def test_pid_alive_treats_zombie_as_dead():
    p = subprocess.Popen(["true"])
    try:
        wait_for(lambda: Path(f"/proc/{p.pid}/stat").read_text().rsplit(")", 1)[1].split()[0] == "Z")
        assert wl.pid_alive(p.pid) is False
    finally:
        p.wait()


def test_event_dict():
    assert wl.event_dict('{"type": "result"}') == {"type": "result"}
    assert wl.event_dict("[1, 2]") == {}
    assert wl.event_dict("not json") == {}
    assert wl.event_dict('"s"') == {}


def test_out_and_fail_print_json_and_return_code(capsys):
    assert wl.out({"a": 1}) == 0
    assert json.loads(capsys.readouterr().out) == {"a": 1}
    assert wl.out({"a": 1}, 4) == 4
    capsys.readouterr()
    assert wl.fail("boom", 3, x=1) == 3
    assert json.loads(capsys.readouterr().out) == {"ok": False, "error": "boom", "x": 1}
    assert wl.fail("d") == 1


def test_tmux_name():
    assert wl.tmux_name("abc") == "atlas-warm-abc"


def test_use_tmux_follows_which(monkeypatch):
    monkeypatch.setattr(wl.shutil, "which", lambda n: "/bin/tmux" if n == "tmux" else None)
    assert wl.use_tmux() is True
    monkeypatch.setattr(wl.shutil, "which", lambda n: None)
    assert wl.use_tmux() is False


def test_tmux_runs_tmux_without_tmux_env(monkeypatch):
    seen = {}

    def fake_run(cmd, **kw):
        seen["cmd"], seen["kw"] = cmd, kw
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setenv("TMUX", "/tmp/x")
    monkeypatch.setenv("TMUX_PANE", "%1")
    monkeypatch.setenv("KEEP_ME", "1")
    monkeypatch.setattr(wl.subprocess, "run", fake_run)
    wl._tmux("kill-session", "-t", "n")
    assert seen["cmd"] == ["tmux", "kill-session", "-t", "n"]
    assert "TMUX" not in seen["kw"]["env"] and "TMUX_PANE" not in seen["kw"]["env"]
    assert seen["kw"]["env"]["KEEP_ME"] == "1"
    assert seen["kw"]["capture_output"] is True and seen["kw"]["text"] is True
    assert seen["kw"]["timeout"] == 15


def test_new_lines_returns_only_complete_lines(tmp_path):
    f = tmp_path / "log"
    f.write_bytes(b"one\ntwo\npart")
    lines, off = wl.new_lines(f, 0)
    assert (lines, off) == (["one", "two"], 8)
    f.write_bytes(b"one\ntwo\npartial\nx")
    assert wl.new_lines(f, off) == (["partial"], 16)
    assert wl.new_lines(f, 16) == ([], 16)
    assert wl.new_lines(tmp_path / "missing", 5) == ([], 5)


def test_proc_usage_for_self_and_missing():
    u = wl.proc_usage(os.getpid())
    assert u["rss_kb"] > 0 and u["cpu_s"] >= 0
    assert wl.proc_usage(99999999) == {"rss_kb": None, "cpu_s": None}


# ------------------------------------------------------------ Host bookkeeping


@pytest.fixture
def host(tmp_path):
    rd = wl.rundir(tmp_path, "h")
    rd.mkdir(parents=True)
    h = wl.Host(str(tmp_path), "h", True, ["x"])
    yield h
    h.log.close()


def test_host_init_state(host, tmp_path):
    assert host.rd == wl.rundir(tmp_path, "h")
    assert host.open == set() and host.results == 0 and host.owed == 0
    assert host.proc is None and not host.stopping.is_set() and not host.result_seen.is_set()


def test_reset_task_clears_counters(host):
    host.open.add("a")
    host.results, host.owed, host.last_line = 3, 2, 0
    host.reset_task()
    assert (host.open, host.results, host.owed) == (set(), 0, 0)
    assert host.last_line > 1


def test_task_started_tracks_id_or_tool_use_id(host):
    host.on_event({"type": "system", "subtype": "task_started", "task_id": "a"})
    host.on_event({"type": "system", "subtype": "task_started", "tool_use_id": "b"})
    assert host.open == {"a", "b"}
    host.on_event({"type": "system", "subtype": "other"})
    assert host.open == {"a", "b"}


def test_plain_result_finishes_task_and_marks_recycling(host):
    wl.write_state(host.rd, done=4)
    host.on_event({"type": "result"})
    st = wl.read_state(host.rd)
    assert st["status"] == "recycling" and st["done"] == 5 and st["last_results"] == 1
    assert st["results"] == 1 and st["last_result"] > 1
    assert host.results == 0 and host.result_seen.is_set()


def test_finish_without_recycle_goes_idle(tmp_path):
    (wl.rundir(tmp_path, "i")).mkdir(parents=True)
    h = wl.Host(str(tmp_path), "i", False, ["x"])
    h.on_event({"type": "result"})
    assert wl.read_state(h.rd)["status"] == "idle"
    assert wl.read_state(h.rd)["done"] == 1
    h.log.close()


def test_result_with_open_agent_does_not_finish(host):
    host.on_event({"type": "system", "subtype": "task_started", "task_id": "a"})
    host.on_event({"type": "result"})
    assert host.results == 1 and not host.result_seen.is_set()
    assert "status" not in (wl.read_state(host.rd) or {})


def test_notification_after_result_owes_a_second_result(host):
    host.on_event({"type": "system", "subtype": "task_started", "task_id": "a"})
    host.on_event({"type": "result"})
    host.on_event({"type": "system", "subtype": "task_notification", "task_id": "a"})
    assert host.open == set() and host.owed == 1
    assert not host.result_seen.is_set()
    host.on_event({"type": "result"})
    assert host.result_seen.is_set()
    assert wl.read_state(host.rd)["last_results"] == 2


def test_notification_before_any_result_owes_nothing(host):
    host.on_event({"type": "system", "subtype": "task_started", "tool_use_id": "a"})
    host.on_event({"type": "system", "subtype": "task_notification", "tool_use_id": "a"})
    assert host.owed == 0 and host.open == set()


class FakeStdin:
    def __init__(self, fail=False):
        self.data, self.fail, self.closed = [], fail, False

    def write(self, s):
        if self.fail:
            raise OSError("broken pipe")
        self.data.append(s)

    def flush(self):
        pass

    def close(self):
        self.closed = True


def test_read_lead_ready_line_flips_starting_to_idle_and_logs(host):
    wl.write_state(host.rd, status="starting")
    host.proc = SimpleNamespace(stdout=iter(['{"type": "autocompact_state"}\n', "no newline"]))
    host.read_lead(host.proc)
    st = wl.read_state(host.rd)
    assert st["status"] == "idle" and st["ready"] > 1
    host.log.flush()
    assert (host.rd / "lead.log").read_text() == '{"type": "autocompact_state"}\nno newline\n'


def test_read_lead_ready_line_ignored_when_not_starting(host):
    wl.write_state(host.rd, status="busy")
    host.proc = SimpleNamespace(stdout=iter(['{"type": "autocompact_state"}\n']))
    host.read_lead(host.proc)
    assert wl.read_state(host.rd)["status"] == "busy"


def test_read_lead_result_only_counts_while_busy(host):
    wl.write_state(host.rd, status="idle")
    host.proc = SimpleNamespace(stdout=iter(['{"type": "result"}\n']))
    host.read_lead(host.proc)
    assert wl.read_state(host.rd)["status"] == "idle" and host.results == 0
    wl.write_state(host.rd, status="busy")
    host.proc = SimpleNamespace(stdout=iter(['{"type": "result"}\n']))
    host.read_lead(host.proc)
    assert wl.read_state(host.rd)["status"] == "recycling"


def test_read_lead_ignores_events_from_a_replaced_process(host):
    wl.write_state(host.rd, status="busy")
    old = SimpleNamespace(stdout=iter(['{"type": "result"}\n']))
    host.proc = SimpleNamespace(stdout=iter([]))
    host.read_lead(old)
    assert wl.read_state(host.rd)["status"] == "busy"
    host.log.flush()
    assert (host.rd / "lead.log").read_text() == '{"type": "result"}\n'


def test_close_lead_closes_stdin_and_waits(host):
    p = subprocess.Popen(["cat"], stdin=subprocess.PIPE, start_new_session=True)
    host.proc = p
    host.close_lead(grace=5)
    assert p.poll() == 0


def test_close_lead_without_process_is_noop(host):
    host.close_lead()


def test_close_lead_kills_a_lead_that_ignores_stdin_close(host, monkeypatch):
    p = subprocess.Popen(["sleep", "60"], stdin=subprocess.PIPE, start_new_session=True)
    host.proc = p
    host.close_lead(grace=0.2)
    assert p.poll() is not None


def test_close_lead_tolerates_stdin_oserror(host):
    class P:
        stdin = SimpleNamespace(close=lambda: (_ for _ in ()).throw(OSError("x")))

        def wait(self, timeout):
            return 0

    host.proc = P()
    host.close_lead()


def test_kill_lead_escalates_to_sigkill(host):
    code = "import signal,time\nsignal.signal(signal.SIGTERM, signal.SIG_IGN)\nprint('r',flush=True)\ntime.sleep(60)\n"
    p = subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, text=True, start_new_session=True)
    p.stdout.readline()
    host.proc = p
    host.kill_lead()
    assert p.poll() == -signal.SIGKILL


def test_kill_lead_terminates_group_with_sigterm(host):
    p = subprocess.Popen(["sleep", "60"], start_new_session=True)
    host.proc = p
    host.kill_lead()
    assert p.poll() == -signal.SIGTERM


def test_kill_lead_skips_exited_or_missing(host, monkeypatch):
    calls = []
    monkeypatch.setattr(wl.os, "killpg", lambda *a: calls.append(a))
    host.kill_lead()
    host.proc = SimpleNamespace(poll=lambda: 0, pid=1)
    host.kill_lead()
    assert calls == []


def test_kill_lead_returns_when_group_is_gone(host, monkeypatch):
    def gone(*a):
        raise ProcessLookupError

    monkeypatch.setattr(wl.os, "killpg", gone)
    host.proc = SimpleNamespace(poll=lambda: None, pid=1, wait=lambda timeout: pytest.fail("waited"))
    host.kill_lead()


def feed(host, *lines):
    r, w = os.pipe()
    with os.fdopen(w, "w") as f:
        f.write("".join(lines))
    host.inbox_loop(r)


def test_inbox_loop_hands_task_to_idle_lead(host):
    wl.write_state(host.rd, status="idle", tasks=2)
    host.proc = SimpleNamespace(stdin=FakeStdin(), poll=lambda: None)
    host.open.add("stale")
    feed(host, "\n", "  \n", '{"task": 1}\n')
    st = wl.read_state(host.rd)
    assert host.proc.stdin.data == ['{"task": 1}\n']
    assert st["status"] == "busy" and st["tasks"] == 3 and st["results"] == 0 and st["last_send"] > 1
    assert host.open == set()


@pytest.mark.parametrize("status,poll", [("busy", None), ("idle", 0), (None, None)])
def test_inbox_loop_rejects_when_not_idle_or_lead_gone(host, status, poll):
    wl.write_state(host.rd, **({"status": status} if status else {}))
    stdin = FakeStdin()
    host.proc = SimpleNamespace(stdin=stdin, poll=lambda: poll)
    feed(host, '{"t": 1}\n')
    assert stdin.data == []
    host.log.flush()
    rec = json.loads((host.rd / "lead.log").read_text())
    assert rec == {"type": "warm_rejected", "status": status}
    assert wl.read_state(host.rd).get("status") == status


def test_inbox_loop_rejects_without_a_process(host):
    wl.write_state(host.rd, status="idle")
    feed(host, '{"t": 1}\n')
    assert wl.read_state(host.rd)["status"] == "idle"


def test_inbox_loop_marks_stopped_when_stdin_closed(host):
    wl.write_state(host.rd, status="idle")
    host.proc = SimpleNamespace(stdin=FakeStdin(fail=True), poll=lambda: None)
    feed(host, '{"t": 1}\n')
    st = wl.read_state(host.rd)
    assert st["status"] == "stopped" and st["note"] == "lead stdin closed: broken pipe"


# ------------------------------------------------------------ Host.run / spawn with a fake lead


@pytest.fixture
def fake_lead(tmp_path):
    p = tmp_path / "fake_lead.py"
    p.write_text(FAKE)
    return p


def run_host(tmp_path, monkeypatch, cmd, recycle=True):
    monkeypatch.setattr(wl.signal, "signal", lambda *a: None)
    rd = wl.rundir(tmp_path, "r")
    rd.mkdir(parents=True)
    os.mkfifo(rd / "inbox")
    h = wl.Host(str(tmp_path), "r", recycle, cmd)
    t = threading.Thread(target=h.run, daemon=True)
    t.start()
    return h, t, rd


def send_raw(rd, text):
    fd = os.open(rd / "inbox", os.O_WRONLY | os.O_NONBLOCK)
    with os.fdopen(fd, "w") as f:
        f.write(json.dumps({"type": "user", "message": {"role": "user", "content": text}}) + "\n")


def test_run_serves_a_task_recycles_the_lead_and_stops_cleanly(tmp_path, monkeypatch, fake_lead):
    h, t, rd = run_host(tmp_path, monkeypatch, [sys.executable, str(fake_lead)])
    try:
        st = wait_for(lambda: (s := wl.read_state(rd)) and s.get("status") == "idle" and s)
        assert st["host_pid"] == os.getpid() and st["tasks"] == 0
        first_pid = st["lead_pid"]
        send_raw(rd, "hello")
        wait_for(lambda: (wl.read_state(rd) or {}).get("done") == 1)
        st = wait_for(lambda: (s := wl.read_state(rd)) and s["status"] == "idle" and s["lead_pid"] != first_pid and s)
        assert st["tasks"] == 1
        assert '"result": "%d|hello"' % first_pid in (rd / "lead.log").read_text()
    finally:
        h.stopping.set()
        t.join(20)
    assert not t.is_alive()
    st = wl.read_state(rd)
    assert st["status"] == "stopped" and st["note"] == "stopped" and st["stopped"] > 1
    assert not (rd / "inbox").exists()
    assert h.proc.poll() is not None


def test_run_without_recycle_keeps_the_same_lead(tmp_path, monkeypatch, fake_lead):
    h, t, rd = run_host(tmp_path, monkeypatch, [sys.executable, str(fake_lead)], recycle=False)
    try:
        st = wait_for(lambda: (s := wl.read_state(rd)) and s.get("status") == "idle" and s)
        pid = st["lead_pid"]
        send_raw(rd, "one")
        wait_for(lambda: (wl.read_state(rd) or {}).get("done") == 1)
        assert wl.read_state(rd)["lead_pid"] == pid
        assert wl.read_state(rd)["status"] == "idle"
        send_raw(rd, "two")
        wait_for(lambda: (wl.read_state(rd) or {}).get("done") == 2)
        assert wl.read_state(rd)["lead_pid"] == pid
    finally:
        h.stopping.set()
        t.join(20)


def test_run_reports_a_lead_that_exits(tmp_path, monkeypatch):
    h, t, rd = run_host(tmp_path, monkeypatch, [sys.executable, "-c", "import sys; sys.exit(3)"])
    t.join(20)
    assert not t.is_alive()
    st = wl.read_state(rd)
    assert st["status"] == "stopped" and st["note"] == "lead exited with 3"


def test_run_settles_a_task_whose_counts_disagree(tmp_path, monkeypatch):
    monkeypatch.setattr(wl, "SETTLE", 0.3)
    script = tmp_path / "stuck.py"
    script.write_text(STUCK)
    h, t, rd = run_host(tmp_path, monkeypatch, [sys.executable, str(script)], recycle=False)
    try:
        wait_for(lambda: (wl.read_state(rd) or {}).get("status") == "idle")
        send_raw(rd, "go")
        wait_for(lambda: (wl.read_state(rd) or {}).get("done") == 1)
        st = wl.read_state(rd)
        assert st["status"] == "idle" and st["last_results"] == 1
    finally:
        h.stopping.set()
        t.join(20)


def test_spawn_strips_session_env_and_records_pid(tmp_path, monkeypatch):
    for k in wl.ENV_DROP:
        monkeypatch.setenv(k, "1")
    monkeypatch.setenv("KEEP_ENV", "yes")
    rd = wl.rundir(tmp_path, "s")
    rd.mkdir(parents=True)
    code = "import os,json;print(json.dumps({k:os.environ.get(k) for k in ['TMUX','CLAUDE_CODE_SESSION_ID','KEEP_ENV']}),flush=True)"
    h = wl.Host(str(tmp_path), "s", True, [sys.executable, "-c", code])
    h.spawn()
    h.proc.wait(10)
    wait_for(lambda: (rd / "lead.log").read_text() if h.log.flush() is None else "")
    st = wl.read_state(rd)
    assert st["status"] == "starting" and st["lead_pid"] == h.proc.pid
    assert json.loads((rd / "lead.log").read_text()) == {"TMUX": None, "CLAUDE_CODE_SESSION_ID": None, "KEEP_ENV": "yes"}
    h.log.close()


def test_cmd_host_builds_host_from_args(monkeypatch):
    seen = {}

    class H:
        def __init__(self, root, name, recycle, cmd):
            seen["a"] = (root, name, recycle, cmd)

        def run(self):
            return 7

    monkeypatch.setattr(wl, "Host", H)
    ns = argparse.Namespace(root="/r", name="n", recycle="off", lead=["claude", "--model", "m"])
    assert wl.cmd_host(ns) == 7
    assert seen["a"][:3] == ("/r", "n", False) and seen["a"][3][:3] == ["claude", "--model", "m"]
    ns.recycle = "on"
    wl.cmd_host(ns)
    assert seen["a"][2] is True


# ------------------------------------------------------------ start / send / status / stop (real host subprocess)


class Warm:
    def __init__(self, tmp_path, fake, capsys, monkeypatch):
        self.root, self.fake, self.capsys = str(tmp_path), fake, capsys
        self.name = f"w{os.getpid()}"
        monkeypatch.setattr(wl, "use_tmux", lambda: False)

    def main(self, *argv):
        rc = wl.main(list(argv))
        out = self.capsys.readouterr().out.strip().splitlines()
        return rc, json.loads(out[-1])

    def start(self, *lead, timeout="20"):
        return self.main("start", "--root", self.root, "--name", self.name, "--timeout", timeout,
                         "--", sys.executable, str(self.fake), *lead)

    def send(self, task, *flags):
        return self.main("send", "--root", self.root, "--name", self.name, *flags, task)

    def status(self):
        return self.main("status", "--root", self.root, "--name", self.name)

    def stop(self):
        return self.main("stop", "--root", self.root, "--name", self.name)


@pytest.fixture
def warm(tmp_path, fake_lead, capsys, monkeypatch):
    w = Warm(tmp_path, fake_lead, capsys, monkeypatch)
    yield w
    try:
        w.stop()
    finally:
        capsys.readouterr()


def test_start_send_wait_status_stop_roundtrip(warm):
    rc, body = warm.start()
    assert rc == 0 and body["ok"] is True and body["launcher"] == "subprocess"
    assert body["note"] == "tmux not on PATH: host runs as a detached subprocess"
    assert body["tmux_session"] is None and body["ready_s"] >= 0
    assert body["log"].endswith("/.atlas/.run/warm/%s/lead.log" % warm.name)
    rc, st = warm.status()
    assert rc == 0 and st["host_alive"] is True and st["lead_alive"] is True
    assert st["rss_kb"] > 0 and st["cpu_s"] >= 0 and st["status"] == "idle"
    assert st["recycle"] is True and st["name"] == warm.name
    rc, r1 = warm.send("hello", "--wait", "--timeout", "30")
    assert rc == 0 and r1["is_error"] is False and r1["results"] == 1
    assert r1["result"].endswith("|hello") and r1["handoff_s"] >= 0
    rc, r2 = warm.send("again", "--wait", "--timeout", "30")
    assert rc == 0 and r2["result"].endswith("|again")
    assert r1["result"].split("|")[0] != r2["result"].split("|")[0]
    rc, stop = warm.stop()
    assert rc == 0 and stop == {"ok": True, "stopped": True, "tasks": 2}
    rc, st = warm.status()
    assert st["host_alive"] is False and st["lead_alive"] is False and st["status"] == "stopped"
    assert st["rss_kb"] is None and st["cpu_s"] is None


def test_send_without_wait_reports_the_accepted_task(warm):
    warm.start("--delay", "1.5")
    rc, body = warm.send("slow")
    assert rc == 0 and body["sent"] is True and body["tasks"] == 1
    assert body["log"].endswith("lead.log")
    rc, body = warm.send("second")
    assert rc == 1 and body["status"] == "busy"
    assert body["error"] == f"warm lead '{warm.name}' is busy, not idle: task refused"


def test_send_wait_reports_an_error_result_with_exit_one(warm):
    warm.start("--error")
    rc, body = warm.send("x", "--wait", "--timeout", "30")
    assert rc == 1 and body["is_error"] is True and body["result"].endswith("|x")


def test_send_wait_times_out_with_code_three(warm):
    warm.start("--delay", "30")
    rc, body = warm.send("x", "--wait", "--timeout", "0.5")
    assert rc == 3 and body["ok"] is False and body["results"] == 0
    assert body["error"] == "no final result within 0.5s (the task is still running)"


def test_send_reads_task_from_stdin(warm, monkeypatch):
    warm.start()
    monkeypatch.setattr(sys, "stdin", io.StringIO("from stdin"))
    rc, body = warm.send("-", "--wait", "--timeout", "30")
    assert rc == 0 and body["result"].endswith("|from stdin")


def test_send_rejects_empty_task_and_missing_lead(warm):
    rc, body = warm.send("   ")
    assert (rc, body["error"]) == (1, "empty task")
    rc, body = warm.send("x")
    assert rc == 1 and body["error"] == f"warm lead '{warm.name}' is not running: start it first"


def test_start_without_lead_command_fails(warm):
    rc, body = warm.main("start", "--root", warm.root, "--name", warm.name)
    assert rc == 1 and body["error"].startswith("no lead command")


def test_start_twice_is_refused(warm):
    warm.start()
    rc, body = warm.start()
    assert rc == 1 and "already running (host pid" in body["error"]


def test_start_fails_when_lead_never_signals_ready(warm):
    rc, body = warm.start("--no-ready", timeout="1")
    assert rc == 1 and body["error"].startswith("lead not ready after 1s (tmux not on PATH")
    assert "host_log" in body
    st = wl.read_state(wl.rundir(warm.root, warm.name))
    assert st["status"] == "stopped"


def test_status_of_unknown_lead(warm):
    rc, body = warm.status()
    assert rc == 1 and body["error"] == f"no warm lead '{warm.name}' under {warm.root}"


def test_stop_when_not_running(warm):
    rc, body = warm.stop()
    assert rc == 0 and body == {"ok": True, "stopped": True, "note": "not running"}


def test_stop_lead_kills_lead_left_behind_by_a_dead_host(tmp_path):
    rd = wl.rundir(tmp_path, "z")
    rd.mkdir(parents=True)
    (rd / "inbox").write_text("")
    lead = subprocess.Popen(["sleep", "60"], start_new_session=True)
    wl.write_state(rd, host_pid=None, lead_pid=lead.pid, tasks=5, launcher="subprocess")
    res = wl.stop_lead(tmp_path, "z")
    assert res == {"stopped": True, "tasks": 5}
    assert lead.wait(10) == -signal.SIGKILL
    assert not (rd / "inbox").exists()
    assert wl.read_state(rd)["status"] == "stopped"


def test_stop_lead_terminates_a_live_host_and_kills_tmux_session(tmp_path, monkeypatch):
    rd = wl.rundir(tmp_path, "z")
    rd.mkdir(parents=True)
    host = subprocess.Popen(["sleep", "60"], start_new_session=True)
    wl.write_state(rd, host_pid=host.pid, launcher="tmux", tmux_session="sess-z")
    calls = []
    monkeypatch.setattr(wl, "use_tmux", lambda: True)
    monkeypatch.setattr(wl, "_tmux", lambda *a: calls.append(a))
    assert wl.stop_lead(tmp_path, "z") == {"stopped": True, "tasks": 0}
    assert host.wait(10) == -signal.SIGTERM
    assert calls == [("kill-session", "-t", "sess-z")]


def test_stop_lead_sigkills_a_host_that_ignores_sigterm(tmp_path):
    rd = wl.rundir(tmp_path, "z")
    rd.mkdir(parents=True)
    code = "import signal,time\nsignal.signal(signal.SIGTERM, signal.SIG_IGN)\nprint('r',flush=True)\ntime.sleep(60)\n"
    host = subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, text=True, start_new_session=True)
    host.stdout.readline()
    wl.write_state(rd, host_pid=host.pid, launcher="subprocess")
    wl.stop_lead(tmp_path, "z")
    assert host.wait(10) == -signal.SIGKILL


def test_start_with_tmux_launches_a_detached_session(tmp_path, monkeypatch, capsys):
    calls = []
    monkeypatch.setattr(wl, "use_tmux", lambda: True)

    def fake_tmux(*a):
        calls.append(a)
        return subprocess.CompletedProcess(a, 0, "", "")

    monkeypatch.setattr(wl, "_tmux", fake_tmux)
    rc = wl.main(["start", "--root", str(tmp_path), "--name", "tm", "--timeout", "0.3", "--recycle", "off",
                  "--", "claude", "--model", "m"])
    body = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert rc == 1 and body["error"].startswith("lead not ready after 0.3s")
    kill, new = calls[0], calls[1]
    assert kill == ("kill-session", "-t", "atlas-warm-tm")
    assert new[:6] == ("new-session", "-d", "-s", "atlas-warm-tm", "-c", str(tmp_path.resolve()))
    cmdline = new[6]
    rd = wl.rundir(tmp_path, "tm")
    assert cmdline.startswith("exec ") and f">> {rd / 'host.log'} 2>&1" in cmdline
    assert " host --root " in cmdline and "--recycle off -- claude --model m" in cmdline
    st = wl.read_state(rd)
    assert st["launcher"] == "tmux" and st["tmux_session"] == "atlas-warm-tm" and st["note"] is None
    assert st["recycle"] is False and st["cmd"][:3] == ["claude", "--model", "m"]
    assert calls[-1] == ("kill-session", "-t", "atlas-warm-tm")
    assert stat_is_fifo(rd / "inbox") is False  # stop_lead removed it


def stat_is_fifo(p):
    import stat

    try:
        return stat.S_ISFIFO(os.stat(p).st_mode)
    except OSError:
        return False


def test_start_reports_tmux_failure(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(wl, "use_tmux", lambda: True)
    monkeypatch.setattr(
        wl, "_tmux",
        lambda *a: subprocess.CompletedProcess(a, 1, "", " no server \n") if a[0] == "new-session" else subprocess.CompletedProcess(a, 0, "", ""),
    )
    rc = wl.main(["start", "--root", str(tmp_path), "--name", "tf", "--", "claude"])
    body = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert rc == 1 and body["error"] == "tmux: no server"


# ------------------------------------------------------------ send against a simulated host


class SimHost(threading.Thread):
    """Plays the host: reads the inbox, bumps `tasks`, then runs `after(rd)`."""

    def __init__(self, rd, after=None):
        super().__init__(daemon=True)
        self.rd, self.after = rd, after
        self.fd = os.open(rd / "inbox", os.O_RDONLY | os.O_NONBLOCK)

    def run(self):
        end = time.time() + 15
        buf = b""
        while time.time() < end and b"\n" not in buf:
            try:
                buf += os.read(self.fd, 4096)
            except BlockingIOError:
                pass
            time.sleep(0.01)
        self.got = buf
        st = wl.read_state(self.rd)
        wl.write_state(self.rd, tasks=int(st.get("tasks", 0)) + 1)
        if self.after:
            self.after(self.rd)


def sim_setup(tmp_path, **state):
    rd = wl.rundir(tmp_path, "sim")
    rd.mkdir(parents=True)
    os.mkfifo(rd / "inbox")
    (rd / "lead.log").write_text("")
    wl.write_state(rd, host_pid=os.getpid(), status="idle", tasks=0, done=0, **state)
    return rd


def send_ns(tmp_path, task="t", wait=True, timeout=10.0):
    return argparse.Namespace(root=str(tmp_path), name="sim", wait=wait, timeout=timeout, task=task)


def log_result(rd, **ev):
    with open(rd / "lead.log", "a") as f:
        f.write(json.dumps({"type": "result", **ev}) + "\n")


def finish(rd, n=1):
    wl.write_state(rd, done=int(wl.read_state(rd)["done"]) + 1, last_results=n)


def test_send_writes_a_stream_json_user_line(tmp_path, capsys):
    rd = sim_setup(tmp_path)
    sim = SimHost(rd)
    sim.start()
    assert wl.cmd_send(send_ns(tmp_path, "do it", wait=False)) == 0
    sim.join(10)
    assert json.loads(sim.got) == {"type": "user", "message": {"role": "user", "content": "do it"}}
    body = json.loads(capsys.readouterr().out)
    assert body["sent"] is True and body["tasks"] == 1


def test_send_waits_for_result_line_after_state_flip(tmp_path, capsys):
    rd = sim_setup(tmp_path)

    def after(rd):
        finish(rd, n=2)  # state flips first; the final result line arrives later
        log_result(rd, result="first")
        time.sleep(0.2)
        log_result(rd, result="final")

    SimHost(rd, after).start()
    assert wl.cmd_send(send_ns(tmp_path)) == 0
    body = json.loads(capsys.readouterr().out)
    assert body["result"] == "final" and body["results"] == 2 and body["is_error"] is False
    assert "waited_ready_s" not in body


@pytest.mark.parametrize(
    "ev,text",
    [({"errors": ["a", "b"], "subtype": "error_x", "is_error": True}, "a; b"),
     ({"subtype": "error_max_turns", "is_error": True}, "error_max_turns"),
     ({"result": "", "is_error": True}, "")],
)
def test_send_result_text_falls_back_to_errors_then_subtype(tmp_path, capsys, ev, text):
    rd = sim_setup(tmp_path)

    def after(rd):
        log_result(rd, **ev)
        finish(rd)

    SimHost(rd, after).start()
    assert wl.cmd_send(send_ns(tmp_path)) == 1
    body = json.loads(capsys.readouterr().out)
    assert body["result"] == text and body["is_error"] is True


def test_send_waits_for_a_recycling_lead_to_become_idle(tmp_path, capsys):
    rd = sim_setup(tmp_path)
    wl.write_state(rd, status="recycling")
    threading.Timer(0.3, lambda: wl.write_state(rd, status="idle")).start()

    def after(rd):
        log_result(rd, result="ok")
        finish(rd)

    SimHost(rd, after).start()
    assert wl.cmd_send(send_ns(tmp_path)) == 0
    body = json.loads(capsys.readouterr().out)
    assert body["waited_ready_s"] >= 0.2 and body["handoff_s"] >= body["waited_ready_s"]


def test_send_reports_a_lead_that_stopped_mid_task(tmp_path, capsys):
    rd = sim_setup(tmp_path)
    SimHost(rd, lambda rd: wl.write_state(rd, status="stopped")).start()
    assert wl.cmd_send(send_ns(tmp_path)) == 1
    body = json.loads(capsys.readouterr().out)
    assert body["error"] == "the lead stopped before it produced a result"
    assert body["results"] == 0 and body["log"].endswith("lead.log")


def test_send_reports_unreachable_inbox(tmp_path, capsys):
    rd = sim_setup(tmp_path)
    (rd / "inbox").unlink()
    assert wl.cmd_send(send_ns(tmp_path)) == 1
    assert json.loads(capsys.readouterr().out)["error"].startswith("cannot reach the lead's inbox:")


def test_send_reports_a_host_that_never_takes_the_task(tmp_path, capsys, monkeypatch):
    rd = sim_setup(tmp_path)
    keep = os.open(rd / "inbox", os.O_RDONLY | os.O_NONBLOCK)
    monkeypatch.setattr(wl.time, "sleep", lambda s: None)
    try:
        assert wl.cmd_send(send_ns(tmp_path)) == 1
    finally:
        os.close(keep)
    assert json.loads(capsys.readouterr().out)["error"] == "the host did not take the task (rejected or gone)"


def test_send_refuses_when_status_never_leaves_starting(tmp_path, capsys, monkeypatch):
    rd = sim_setup(tmp_path)
    wl.write_state(rd, status="starting")
    monkeypatch.setattr(wl, "READY_WAIT", 0.1)
    assert wl.cmd_send(send_ns(tmp_path)) == 1
    body = json.loads(capsys.readouterr().out)
    assert body["status"] == "starting" and "is starting, not idle" in body["error"]


def test_send_rejects_a_stopped_lead(tmp_path, capsys):
    rd = sim_setup(tmp_path)
    wl.write_state(rd, status="stopped")
    assert wl.cmd_send(send_ns(tmp_path)) == 1
    assert "is not running: start it first" in json.loads(capsys.readouterr().out)["error"]


def test_parser_defaults():
    p = wl.parser()
    a = p.parse_args(["start", "--root", "/r", "--", "claude", "-x"])
    assert a.lead == ["--", "claude", "-x"] and a.recycle == "on" and a.timeout == 60 and a.name == "lead"
    a = p.parse_args(["send", "--root", "/r", "task"])
    assert a.wait is False and a.timeout == 900 and a.task == "task" and a.fn is wl.cmd_send
    a = p.parse_args(["host", "--root", "/r", "--recycle", "off", "--", "c"])
    assert a.recycle == "off" and a.fn is wl.cmd_host
    assert p.parse_args(["status", "--root", "/r"]).fn is wl.cmd_status
    assert p.parse_args(["stop", "--root", "/r"]).fn is wl.cmd_stop


def test_main_strips_the_double_dash_from_lead_args(monkeypatch):
    got = []
    monkeypatch.setattr(wl, "cmd_start", lambda a: got.append(a.lead) or 5)
    assert wl.main(["start", "--root", "/r", "--", "claude", "-x"]) == 5
    assert wl.main(["start", "--root", "/r", "claude", "-x"]) == 5
    assert got == [["claude", "-x"], ["claude", "-x"]]


def test_subcommand_is_required(capsys):
    with pytest.raises(SystemExit) as e:
        wl.main([])
    assert e.value.code == 2
    assert "required" in capsys.readouterr().err


@pytest.mark.parametrize("sub", ["start", "host", "send", "status", "stop"])
def test_root_is_required_for_every_subcommand(sub, capsys):
    argv = [sub] + (["task"] if sub == "send" else [])
    with pytest.raises(SystemExit) as e:
        wl.main(argv)
    assert e.value.code == 2
    assert "--root" in capsys.readouterr().err
