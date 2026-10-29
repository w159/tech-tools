#!/usr/bin/env python3
"""atlas_warm_lead -- a Claude Code lead that is already started and idle when a task arrives.

    atlas_warm_lead.py start  --root DIR [--name lead] [--recycle on|off] [--timeout 60] -- claude <lead args>
    atlas_warm_lead.py send   --root DIR [--name lead] [--wait] [--timeout 900] TASK|-
    atlas_warm_lead.py status --root DIR [--name lead]
    atlas_warm_lead.py stop   --root DIR [--name lead]

`start` runs a host in a detached tmux session `atlas-warm-<name>` (a detached subprocess when tmux is
missing; state.json says which). The host spawns the lead as
`claude -p --input-format stream-json --output-format stream-json --verbose <args>` in DIR with stdin
piped, appends every stdout line to `.atlas/.run/warm/<name>/lead.log` and takes tasks from the FIFO
`inbox`. The CLI runs its SessionStart hooks at start and prints an `autocompact_state` line when idle;
that line is "ready". `send` writes one stream-json user line, so the turn (slash commands included)
starts at hand-off; `--wait` blocks until that turn's `result` line. With `--recycle on` (default) the
host closes the lead's stdin after each result and starts a fresh lead, so the next task meets a warm
lead with a clean context; `off` keeps one conversation.

No permission flags are added: the caller's lead args decide what the lead may do. Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

WARM_REL = Path(".atlas") / ".run" / "warm"
LEAD_FLAGS = (
    (("-p", "--print"), ["-p"]),
    (("--input-format",), ["--input-format", "stream-json"]),
    (("--output-format",), ["--output-format", "stream-json"]),
    (("--verbose",), ["--verbose"]),
)
ENV_DROP = ("CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_REMOTE_SESSION_ID", "TMUX", "TMUX_PANE")
READY_WAIT = 60.0  # `send` waits this long for a lead that is still starting or recycling


def rundir(root, name: str) -> Path:
    return Path(root).resolve() / WARM_REL / name


def lead_cmd(args: list[str]) -> list[str]:
    """The caller's lead command plus the stream-json flags it lacks (nothing else is added)."""
    cmd = list(args)
    for names, add in LEAD_FLAGS:
        if not any(a == n or a.startswith(n + "=") for a in cmd for n in names):
            cmd += add
    return cmd


def read_state(rd: Path) -> dict | None:
    try:
        return json.loads((rd / "state.json").read_text())
    except (OSError, ValueError):
        return None


def write_state(rd: Path, **fields) -> dict:
    st = read_state(rd) or {}
    st.update(fields)
    tmp = rd / f"state.json.{os.getpid()}.tmp"
    tmp.write_text(json.dumps(st, indent=1))
    os.replace(tmp, rd / "state.json")
    return st


def pid_alive(pid) -> bool:
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
    except (OSError, ValueError):
        return False
    try:  # a zombie is dead for our purposes
        return Path(f"/proc/{int(pid)}/stat").read_text().rsplit(")", 1)[1].split()[0] != "Z"
    except (OSError, IndexError):
        return True


def event_type(line: str) -> str | None:
    try:
        ev = json.loads(line)
    except ValueError:
        return None
    return ev.get("type") if isinstance(ev, dict) else None


def out(obj, code: int = 0) -> int:
    print(json.dumps(obj))
    return code


def fail(msg: str, code: int = 1, **extra) -> int:
    return out({"ok": False, "error": msg, **extra}, code)


# ---------------------------------------------------------------- host


class Host:
    def __init__(self, root: str, name: str, recycle: bool, cmd: list[str]):
        self.root, self.name, self.recycle, self.cmd = root, name, recycle, cmd
        self.rd = rundir(root, name)
        self.lock = threading.Lock()
        self.stopping = threading.Event()
        self.result_seen = threading.Event()
        self.proc: subprocess.Popen | None = None
        self.log = open(self.rd / "lead.log", "a", buffering=1)

    def spawn(self) -> None:
        env = {k: v for k, v in os.environ.items() if k not in ENV_DROP}
        self.proc = subprocess.Popen(
            self.cmd,
            cwd=self.root,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=env,
            start_new_session=True,
        )
        with self.lock:
            write_state(self.rd, status="starting", lead_pid=self.proc.pid, lead_started=time.time())
        threading.Thread(target=self.read_lead, args=(self.proc,), daemon=True).start()

    def read_lead(self, proc: subprocess.Popen) -> None:
        for line in proc.stdout:
            # State flips BEFORE the line is logged, so a sender that sees the result also sees idle/recycling.
            kind = event_type(line) if proc is self.proc else None
            if kind == "result":
                with self.lock:
                    write_state(self.rd, status="recycling" if self.recycle else "idle", last_result=time.time())
                self.result_seen.set()
            elif kind == "autocompact_state":
                with self.lock:
                    if (read_state(self.rd) or {}).get("status") == "starting":
                        write_state(self.rd, status="idle", ready=time.time())
            self.log.write(line if line.endswith("\n") else line + "\n")

    def close_lead(self, grace: float = 15.0) -> None:
        proc = self.proc
        if proc is None:
            return
        try:
            proc.stdin.close()
        except OSError:
            pass
        try:
            proc.wait(timeout=grace)
        except subprocess.TimeoutExpired:
            self.kill_lead()

    def kill_lead(self) -> None:
        proc = self.proc
        if proc is None or proc.poll() is not None:
            return
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(proc.pid, sig)
            except OSError:
                return
            try:
                proc.wait(timeout=3)
                return
            except subprocess.TimeoutExpired:
                continue

    def inbox_loop(self, fd: int) -> None:
        with os.fdopen(fd, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                with self.lock:
                    st = read_state(self.rd) or {}
                    if st.get("status") != "idle" or self.proc is None or self.proc.poll() is not None:
                        self.log.write(json.dumps({"type": "warm_rejected", "status": st.get("status")}) + "\n")
                        continue
                    write_state(self.rd, status="busy", tasks=int(st.get("tasks", 0)) + 1, last_send=time.time())
                    try:
                        self.proc.stdin.write(line + "\n")
                        self.proc.stdin.flush()
                    except OSError as e:
                        write_state(self.rd, status="stopped", note=f"lead stdin closed: {e}")

    def run(self) -> int:
        signal.signal(signal.SIGTERM, lambda *_: self.stopping.set())
        signal.signal(signal.SIGINT, lambda *_: self.stopping.set())
        write_state(self.rd, host_pid=os.getpid(), started=time.time(), tasks=0)
        fd = os.open(self.rd / "inbox", os.O_RDWR)  # RDWR: never EOF, never blocks without a writer
        self.spawn()
        threading.Thread(target=self.inbox_loop, args=(fd,), daemon=True).start()
        reason = "stopped"
        while not self.stopping.is_set():
            if self.result_seen.wait(0.1):
                self.result_seen.clear()
                if self.recycle and not self.stopping.is_set():
                    self.close_lead()
                    self.spawn()
            elif self.proc.poll() is not None:
                reason = f"lead exited with {self.proc.returncode}"
                break
        self.close_lead(grace=5.0)
        with self.lock:
            write_state(self.rd, status="stopped", stopped=time.time(), note=reason)
        try:
            (self.rd / "inbox").unlink()
        except OSError:
            pass
        return 0


def cmd_host(a) -> int:
    return Host(a.root, a.name, a.recycle == "on", lead_cmd(a.lead)).run()


# ---------------------------------------------------------------- start / stop


def tmux_name(name: str) -> str:
    return f"atlas-warm-{name}"


def _tmux(*args) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if k not in ("TMUX", "TMUX_PANE")}
    return subprocess.run(["tmux", *args], capture_output=True, text=True, env=env, timeout=15)


def use_tmux() -> bool:
    return shutil.which("tmux") is not None


def cmd_start(a) -> int:
    import shlex

    if not a.lead:
        return fail("no lead command: pass it after `--`, e.g. -- claude --model M")
    rd = rundir(a.root, a.name)
    st = read_state(rd)
    if st and st.get("status") != "stopped" and pid_alive(st.get("host_pid")):
        return fail(f"warm lead '{a.name}' is already running (host pid {st['host_pid']})")
    rd.mkdir(parents=True, exist_ok=True)
    for f in ("state.json", "lead.log", "host.log", "inbox"):
        (rd / f).unlink(missing_ok=True)
    os.mkfifo(rd / "inbox")
    (rd / "lead.log").touch()
    tmux = use_tmux()
    write_state(
        rd,
        name=a.name,
        root=str(Path(a.root).resolve()),
        status="starting",
        recycle=a.recycle == "on",
        launcher="tmux" if tmux else "subprocess",
        note=None if tmux else "tmux not on PATH: host runs as a detached subprocess",
        tmux_session=tmux_name(a.name) if tmux else None,
        cmd=lead_cmd(a.lead),
        tasks=0,
    )
    host = [
        sys.executable or "python3",
        str(Path(__file__).resolve()),
        "host",
        "--root",
        str(Path(a.root).resolve()),
        "--name",
        a.name,
        "--recycle",
        a.recycle,
        "--",
        *a.lead,
    ]
    if tmux:
        _tmux("kill-session", "-t", tmux_name(a.name))
        res = _tmux(
            "new-session", "-d", "-s", tmux_name(a.name), "-c", str(Path(a.root).resolve()),
            f"exec {shlex.join(host)} >> {shlex.quote(str(rd / 'host.log'))} 2>&1",
        )  # fmt: skip
        if res.returncode != 0:
            return fail(f"tmux: {res.stderr.strip()}")
    else:
        with open(rd / "host.log", "ab") as log:
            subprocess.Popen(
                host, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True,
                cwd=str(Path(a.root).resolve()),
            )  # fmt: skip
    deadline = time.time() + a.timeout
    while time.time() < deadline:
        st = read_state(rd) or {}
        if st.get("status") == "idle":
            return out({"ok": True, "ready_s": round(st["ready"] - st["started"], 3), **{k: st.get(k) for k in ("launcher", "note", "host_pid", "lead_pid", "tmux_session")}, "log": str(rd / "lead.log")})
        if st.get("host_pid") and not pid_alive(st["host_pid"]) or st.get("status") == "stopped":
            break
        time.sleep(0.05)
    why = (read_state(rd) or {}).get("note") or "no autocompact_state seen"
    tail = (rd / "host.log").read_text()[-400:] if (rd / "host.log").exists() else ""
    stop_lead(a.root, a.name)
    return fail(f"lead not ready after {a.timeout:g}s ({why})", host_log=tail)


def stop_lead(root, name: str) -> dict:
    rd = rundir(root, name)
    st = read_state(rd)
    if not st:
        return {"stopped": True, "note": "not running"}
    host = st.get("host_pid")
    if pid_alive(host):
        os.kill(int(host), signal.SIGTERM)
        for _ in range(200):
            if not pid_alive(host):
                break
            time.sleep(0.05)
        if pid_alive(host):
            os.kill(int(host), signal.SIGKILL)
    lead = st.get("lead_pid")
    if pid_alive(lead):  # the host died before it could close the lead
        try:
            os.killpg(int(lead), signal.SIGKILL)
        except OSError:
            pass
    if st.get("launcher") == "tmux" and use_tmux():
        _tmux("kill-session", "-t", st.get("tmux_session") or tmux_name(name))
    (rd / "inbox").unlink(missing_ok=True)
    write_state(rd, status="stopped", stopped=time.time())
    return {"stopped": True, "tasks": st.get("tasks", 0)}


def cmd_stop(a) -> int:
    return out({"ok": True, **stop_lead(a.root, a.name)})


# ---------------------------------------------------------------- send / status


def new_lines(path: Path, off: int) -> tuple[list[str], int]:
    """Complete lines appended after `off`, and the offset after the last complete one."""
    try:
        with open(path, "rb") as f:
            f.seek(off)
            data = f.read()
    except OSError:
        return [], off
    end = data.rfind(b"\n") + 1
    return data[:end].decode("utf-8", "replace").splitlines(), off + end


def cmd_send(a) -> int:
    t0 = time.time()
    task = sys.stdin.read() if a.task == "-" else a.task
    if not task.strip():
        return fail("empty task")
    rd = rundir(a.root, a.name)
    st = read_state(rd)
    if not st or st.get("status") == "stopped" or not pid_alive(st.get("host_pid")):
        return fail(f"warm lead '{a.name}' is not running: start it first")
    waited = 0.0
    while st.get("status") in ("starting", "recycling") and waited < READY_WAIT:
        time.sleep(0.02)
        waited = time.time() - t0
        st = read_state(rd) or st
    if st.get("status") != "idle":
        return fail(f"warm lead '{a.name}' is {st.get('status')}, not idle: task refused", status=st.get("status"))
    log = rd / "lead.log"
    off, before = log.stat().st_size, int(st.get("tasks", 0))
    line = json.dumps({"type": "user", "message": {"role": "user", "content": task}}) + "\n"
    try:
        fd = os.open(rd / "inbox", os.O_WRONLY | os.O_NONBLOCK)
        os.set_blocking(fd, True)
        with os.fdopen(fd, "w") as f:
            f.write(line)
    except OSError as e:
        return fail(f"cannot reach the lead's inbox: {e}")
    for _ in range(250):  # the host accepts the task by bumping the task count
        st = read_state(rd) or {}
        if int(st.get("tasks", 0)) > before:
            break
        time.sleep(0.02)
    else:
        return fail("the host did not take the task (rejected or gone)")
    if not a.wait:
        return out({"ok": True, "sent": True, "tasks": st["tasks"], "log": str(log)})
    deadline = t0 + a.timeout
    while True:
        lines, off = new_lines(log, off)
        for ln in lines:
            try:
                ev = json.loads(ln)
            except ValueError:
                continue
            if ev.get("type") == "result":
                t_res = time.time()
                err = bool(ev.get("is_error"))
                text = ev.get("result")
                if text is None:
                    text = "; ".join(map(str, ev.get("errors") or [])) or ev.get("subtype", "")
                rec = {"result": text, "is_error": err, "handoff_s": round(t_res - t0, 3), "log": str(log)}
                if waited:
                    rec["waited_ready_s"] = round(waited, 3)  # handoff_s includes this wait
                return out(rec, 1 if err else 0)
        st = read_state(rd) or {}
        if st.get("status") == "stopped" or not pid_alive(st.get("host_pid")):
            return fail("the lead stopped before it produced a result", log=str(log))
        if time.time() > deadline:
            return fail(f"no result within {a.timeout:g}s (the task is still running)", code=3, log=str(log))
        time.sleep(0.02)


def proc_usage(pid) -> dict:
    try:
        rss = next(int(x.split()[1]) for x in Path(f"/proc/{pid}/status").read_text().splitlines() if x.startswith("VmRSS:"))
        f = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        return {"rss_kb": rss, "cpu_s": round((int(f[11]) + int(f[12])) / os.sysconf("SC_CLK_TCK"), 2)}
    except (OSError, StopIteration, ValueError, IndexError):
        return {"rss_kb": None, "cpu_s": None}


def cmd_status(a) -> int:
    st = read_state(rundir(a.root, a.name))
    if not st:
        return fail(f"no warm lead '{a.name}' under {a.root}")
    st["host_alive"] = pid_alive(st.get("host_pid"))
    st["lead_alive"] = pid_alive(st.get("lead_pid"))
    st.update(proc_usage(st["lead_pid"]) if st["lead_alive"] else {"rss_kb": None, "cpu_s": None})
    return out(st)


# ---------------------------------------------------------------- cli


def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="warm Claude Code lead")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name, fn in (("start", cmd_start), ("host", cmd_host), ("send", cmd_send), ("status", cmd_status), ("stop", cmd_stop)):
        p = sub.add_parser(name)
        p.add_argument("--root", required=True)
        p.add_argument("--name", default="lead")
        if name in ("start", "host"):
            p.add_argument("--recycle", choices=("on", "off"), default="on")
            p.add_argument("lead", nargs=argparse.REMAINDER, help="-- <claude lead args>")
        if name == "start":
            p.add_argument("--timeout", type=float, default=60)
        if name == "send":
            p.add_argument("--wait", action="store_true")
            p.add_argument("--timeout", type=float, default=900)
            p.add_argument("task", help="task text, or - for stdin")
        p.set_defaults(fn=fn)
    return ap


def main(argv=None) -> int:
    a = parser().parse_args(argv)
    if getattr(a, "lead", None) and a.lead[0] == "--":
        a.lead = a.lead[1:]
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
