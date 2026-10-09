"""Messaging / colony probes: board concurrency, IRC delivery, colony terminal-state
accuracy, parallel spawn. tmux runs only on this scorecard run's private socket."""

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from . import core
from .core import metric, run, skipped, timing

CMD = "python3 atlas_scorecard.py run --root <plugins/atlas> --out x.json --only "

BOARD_PY = r"""
import json, multiprocessing as mp, os, re, sys, time, collections
sys.path[:0] = [os.environ["SC_SCRIPTS"], os.environ["SC_HOOKS"]]
import atlas_todo as T, worker_inbox as W
# drain(now=) exists only on the older mailbox (ts cursor); the seq-cursor one has no clock arg
import inspect
def DR(r, w, now=None):
    return W.drain(r, w, now=now) if now is not None and "now" in inspect.signature(W.drain).parameters else W.drain(r, w)
R = os.environ["SC_ROOT"]

def writer_same(k):
    for i in range(100):
        T.note(R, "shared", f"W{k}-{i} " + "x" * (6000 if i % 2 else 50), to="all")
def writer_own(k):
    for i in range(100): T.note(R, f"own{k}", f"W{k}-{i}", to="wx")
def adder(k):
    for i in range(25): T.add(R, f"item-{k}-{i}")
def stream_writer(k):
    for i in range(300): T.note(R, f"s{k}", f"S{k}-{i:04d}", to="wx")
def drainer(stop_at, out):
    got = []
    def pull():
        t = W.drain(R, "wx")
        for l in t.splitlines():
            m = re.search(r"S(\d)-(\d{4})", l)
            if m: got.append((int(m.group(1)), int(m.group(2))))
        return t
    while time.time() < stop_at: pull()
    time.sleep(0.3)
    while pull(): pass
    out.put(got)

if __name__ == "__main__":
    res = {}
    ps = [mp.Process(target=writer_same, args=(k,)) for k in range(8)]; [p.start() for p in ps]; [p.join() for p in ps]
    res["same_file_parsed"] = sum(1 for r in T.notes(R) if r["owner"] == "shared")
    ps = [mp.Process(target=writer_own, args=(k,)) for k in range(8)]; [p.start() for p in ps]; [p.join() for p in ps]
    res["own_file_parsed"] = sum(1 for r in T.notes(R) if str(r["owner"]).startswith("own"))
    q = mp.Queue(); stop = time.time() + 6
    dr = mp.Process(target=drainer, args=(stop, q)); dr.start(); time.sleep(0.5)
    ps = [mp.Process(target=stream_writer, args=(k,)) for k in range(8)]; [p.start() for p in ps]; [p.join() for p in ps]
    got = q.get(); dr.join()
    c = collections.Counter(got); exp = {(k, i) for k in range(8) for i in range(300)}
    res["stream_expected"] = len(exp); res["stream_lost"] = len(exp - set(c))
    res["stream_dup"] = sum(v - 1 for v in c.values() if v > 1)
    pa = [mp.Process(target=adder, args=(k,)) for k in range(8)]; [p.start() for p in pa]; [p.join() for p in pa]
    res["adds_parsed"] = len(T.load(R).get("items", []))
    # deterministic late-stamp race: an older-ts note landing after a drain must still be delivered
    real = time.time; t0 = real()
    T.time.time = lambda: t0 + 0.001; T.note(R, "B", "B-first", to="wy")
    T.time.time = real
    DR(R, "wy", now=t0 + 5)
    T.time.time = lambda: t0; T.note(R, "A", "A-late-but-earlier-ts", to="wy")
    T.time.time = real
    d2 = DR(R, "wy", now=t0 + 5) + DR(R, "wy", now=t0 + 50)
    res["late_note_delivered"] = int("A-late-but-earlier-ts" in d2)
    print("SC_RESULT " + json.dumps(res))
"""

FAKE_INTERACTIVE = r"""
import sys, os, time, json, threading, subprocess
name = os.environ["FAKE_NAME"]
log = open(os.path.join(os.environ["SC_RECV"], f"recv_{name}.jsonl"), "a", buffering=1)
def rec(kind, line): log.write(json.dumps({"t": time.time(), "kind": kind, "line": line}) + "\n")
HOOK = os.environ["SC_HOOKS"] + "/dispatch_tripwire.py"
def drain_loop():
    while True:
        time.sleep(0.5)
        p = subprocess.run([sys.executable, HOOK], capture_output=True, text=True, input=json.dumps({
            "hook_event_name": "PostToolUse", "cwd": os.environ["ATLAS_PROJECT_ROOT"], "tool_name": "Bash",
            "tool_input": {}, "tool_response": "ok", "session_id": "fake"}))
        if "additionalContext" in p.stdout:
            for l in json.loads(p.stdout)["hookSpecificOutput"]["additionalContext"].splitlines():
                if l.startswith("- from"): rec("hook", l)
threading.Thread(target=drain_loop, daemon=True).start()
print("fake agent ready >", flush=True)
for line in sys.stdin:
    rec("tty", line.rstrip("\n"))
    print("> ", end="", flush=True)
"""

FAKE_WORKER = r"""
import sys, os, time, json
sys.path.insert(0, os.environ["SC_HOOKS"])
import worker_inbox
name, root = os.environ["ATLAS_WORKER_NAME"], os.environ["ATLAS_PROJECT_ROOT"]
log = open(os.path.join(os.environ["SC_RECV"], f"recv_{name}.jsonl"), "a", buffering=1)
while True:
    time.sleep(0.5)
    t = time.time()
    for l in worker_inbox.drain(root, name).splitlines():
        if l.startswith("- from"): log.write(json.dumps({"t": t, "kind": "drain", "line": l}) + "\n")
"""

IRC_PY = r"""
import json, os, re, sys, threading, time, glob
sys.path[:0] = [os.environ["SC_SCRIPTS"], os.environ["SC_HOOKS"]]
import atlas_dashboard as D, atlas_todo as T
import atlas_dash_irc as C  # IRC routes (h_irc_post, read_messages)
R = os.environ["SC_ROOT"]; N = int(os.environ["SC_N"]); RECV = os.environ["SC_RECV"]
targets = ["omp1", "omp2", "wk1", "sh1"]
sent = []
for i in range(N):
    to = targets[i % 4]; tag = f"HM{i:03d}"; t0 = time.time()
    st, res = C.h_irc_post(D._Ctx({}, {"project": R, "to": to, "body": f"{tag} hello {to}"}, ()))
    sent.append(dict(tag=tag, cls="human", to=to, t0=t0, ok=res.get("ok"), status=(res.get("message") or {}).get("status")))
    time.sleep(0.05)
def a2a(sender, to, n0, cnt):
    for i in range(n0, n0 + cnt):
        tag = f"AM{i:03d}"; t0 = time.time()
        T.note(R, sender, f"{tag} from {sender}", to=to)
        sent.append(dict(tag=tag, cls="a2a", to=to, t0=t0)); time.sleep(0.02)
th = [threading.Thread(target=a2a, args=("wk1", "wk2", 0, N // 2)), threading.Thread(target=a2a, args=("omp2", "wk2", N // 2, N // 2))]
[t.start() for t in th]; [t.join() for t in th]
time.sleep(8)
recv = {}
for f in glob.glob(RECV + "/recv_*.jsonl"):
    name = os.path.basename(f)[5:-6]
    for l in open(f):
        r = json.loads(l)
        m = re.search(r"[AH]M\d{3}", r["line"])
        if m and r["kind"] in ("tty", "hook", "drain"): recv.setdefault(m.group(0), []).append((name, r["kind"], r["t"]))
final = {}
_rm = C.read_messages([R], limit=1000)
for m in (_rm[0] if isinstance(_rm, tuple) else _rm):
    mm = re.match(r"[AH]M\d{3}", m["body"].split()[0] if m["body"] else "")
    if mm: final[mm.group(0)] = m.get("status")
for s in sent:
    rs = recv.get(s["tag"], [])
    s["n"] = len(rs); s["first_ms"] = min(((t - s["t0"]) * 1000 for _, _, t in rs), default=None)
    s["final"] = final.get(s["tag"])
print("SC_RESULT " + json.dumps(sent))
"""

COLONY_PY = r"""
import json, os, sys
sys.path[:0] = [os.environ["SC_SCRIPTS"], os.environ["SC_HOOKS"]]
import atlas_dashboard as D
try:
    c = D._v2_get("/api/v2/colony", {"project": os.environ["SC_ROOT"]})
except LookupError:  # route removed: the colony moved to the herdr transport
    print("SC_RESULT " + json.dumps({"__no_route__": 1})); raise SystemExit
out = {a["name"]: {"state": a.get("state"), "section": a.get("section")}
       for r in (c or {}).get("rigs", []) for a in r.get("agents", [])}
print("SC_RESULT " + json.dumps(out))
"""


def _helper(ctx, name, code, env, timeout=300, extra=None):
    d = ctx.sub(name)
    f = d / "helper.py"
    f.write_text(code)
    e = {
        **env,
        "SC_SCRIPTS": str(ctx.scripts),
        "SC_HOOKS": str(ctx.hooks),
        **(extra or {}),
    }
    r = run([ctx.py, str(f)], env=e, cwd=str(d), timeout=timeout)
    line = next(
        (ln for ln in r["out"].splitlines() if ln.startswith("SC_RESULT ")), None
    )
    return (json.loads(line[10:]) if line else None), r


def probe_board(ctx):
    cmd = CMD + "board_concurrency"
    names = [
        "board_note_loss_same_file",
        "board_note_loss_own_file",
        "board_add_loss",
        "irc_stream_loss",
        "irc_stream_dup",
        "irc_late_note_delivered",
    ]
    env, _a, _h = core.iso_env(ctx, "board")
    root = ctx.sub("board") / "proj"
    root.mkdir(exist_ok=True)
    res, r = _helper(ctx, "board", BOARD_PY, env, 300, {"SC_ROOT": str(root)})
    if res is None:
        return [
            skipped(
                n,
                "board helper failed: " + (r["err"] + r["out"])[-250:],
                group="mesh",
                state="error",
            )
            for n in names
        ]
    return [
        metric(
            "board_note_loss_same_file",
            800 - res["same_file_parsed"],
            "of 800",
            "lower",
            cmd=cmd,
            group="mesh",
        ),
        metric(
            "board_note_loss_own_file",
            800 - res["own_file_parsed"],
            "of 800",
            "lower",
            cmd=cmd,
            group="mesh",
        ),
        metric(
            "board_add_loss",
            200 - res["adds_parsed"],
            "of 200",
            "lower",
            cmd=cmd,
            group="mesh",
        ),
        metric(
            "irc_stream_loss",
            res["stream_lost"],
            f"of {res['stream_expected']}",
            "lower",
            cmd=cmd,
            group="mesh",
            det=False,
            threshold={"abs": 8},
            note="8 writers x 300 notes + 1 drainer; timing-dependent in the baseline",
        ),
        metric(
            "irc_stream_dup", res["stream_dup"], "notes", "lower", cmd=cmd, group="mesh"
        ),
        metric(
            "irc_late_note_delivered",
            res["late_note_delivered"],
            "of 1",
            "higher",
            cmd=cmd,
            group="mesh",
            note="an older-ts note landing after a drain must still be delivered",
        ),
    ]


def _tmux(ctx, *a):
    return subprocess.run(
        [ctx.tmux_real, "-L", ctx.tmux_sock, *a], capture_output=True, text=True
    )


def _fake_panes(ctx, env, root, recv):
    """Copies of bash named omp/claude so tmux reports the harness name as the pane command."""
    d = ctx.sub("mesh")
    bindir = d / "bin"
    bindir.mkdir(exist_ok=True)
    for n in ("omp", "claude"):
        if not (bindir / n).exists():
            shutil.copy("/bin/bash", bindir / n)
            if (
                sys.platform == "darwin"
            ):  # a copied platform binary is killed unless re-signed ad hoc
                subprocess.run(
                    ["codesign", "--force", "-s", "-", str(bindir / n)],
                    capture_output=True,
                )
    if (
        subprocess.run(
            [str(bindir / "omp"), "-c", "true"], capture_output=True
        ).returncode
        != 0
    ):
        return None, d
    (d / "fake_interactive.py").write_text(FAKE_INTERACTIVE)
    (d / "fake_worker.py").write_text(FAKE_WORKER)
    return bindir, d


def probe_irc(ctx):
    cmd = CMD + "irc_delivery"
    names = [
        "irc_human_loss",
        "irc_human_dup",
        "irc_a2a_loss",
        "irc_shell_typed",
        "irc_stuck_queued",
    ]
    if not ctx.tmux_real:
        return [skipped(n, "tmux not installed", group="mesh") for n in names]
    env, _a, _h = core.iso_env(ctx, "irc", {"ATLAS_MUX": "tmux"})
    root = ctx.sub("irc") / "proj"
    root.mkdir(exist_ok=True)
    recv = ctx.sub("irc") / "recv"
    recv.mkdir(exist_ok=True)
    bindir, d = _fake_panes(ctx, env, root, recv)
    if bindir is None:
        return [
            skipped(
                n,
                "a copied bash named omp cannot run here (needed so tmux reports the harness name)",
                group="mesh",
            )
            for n in names
        ]
    env = {
        **env,
        "SC_ROOT": str(root),
        "SC_RECV": str(recv),
        "SC_N": str(20 if ctx.quick else 40),
        "SC_HOOKS": str(ctx.hooks),
        "ATLAS_PROJECT_ROOT": str(root),
    }
    if (
        _tmux(
            ctx, "new-session", "-d", "-s", "atlas-scirc", "-n", "lead", "-c", str(root)
        ).returncode
        != 0
    ):
        return [
            skipped(n, "private tmux server would not start", group="mesh")
            for n in names
        ]
    omp = str(bindir / "omp")

    def pane(name, body, **penv):
        e = " ".join(
            f"{k}={v}"
            for k, v in {
                "FAKE_NAME": name,
                "SC_RECV": str(recv),
                "SC_HOOKS": str(ctx.hooks),
                "ATLAS_PROJECT_ROOT": str(root),
                "ATLAS_HOME": env["ATLAS_HOME"],
                "ATLAS_DB": env["ATLAS_DB"],
                "HOME": env["HOME"],
                **penv,
            }.items()
        )
        _tmux(
            ctx,
            "new-window",
            "-d",
            "-t",
            "atlas-scirc:",
            "-n",
            name,
            "-c",
            str(root),
            f"exec env {e} {omp} -c '{body}; true'",
        )

    py = ctx.py
    for n in ("omp1", "omp2"):
        pane(n, f"{py} {d}/fake_interactive.py", ATLAS_WORKER_NAME=n)
    for n in ("wk1", "wk2"):
        pane(n, f"{py} {d}/fake_worker.py atlas_mux.py run-worker", ATLAS_WORKER_NAME=n)
    _tmux(
        ctx,
        "new-window",
        "-d",
        "-t",
        "atlas-scirc:",
        "-n",
        "sh1",
        "-c",
        str(root),
        "exec bash -c 'sleep 3000; true'",
    )
    time.sleep(1.5)
    code = (
        f"import sys; sys.path[:0]=[{str(ctx.scripts)!r}]; import atlas_todo as T\n"
        f"[T.note({str(root)!r}, n, 'started '+n, to='lead') for n in ('omp1','omp2','wk1','wk2','sh1')]\n"
    )
    run([ctx.py, "-c", code], env=env)
    res, r = _helper(ctx, "irc", IRC_PY, env, 240)
    shell_typed = _tmux(
        ctx, "capture-pane", "-p", "-t", "atlas-scirc:sh1"
    ).stdout.count("HM0")
    _tmux(ctx, "kill-server")
    if res is None:
        return [
            skipped(
                n,
                "irc helper failed: " + (r["err"] + r["out"])[-250:],
                group="mesh",
                state="error",
            )
            for n in names
        ]
    human = [s for s in res if s["cls"] == "human" and s["to"] != "sh1"]
    a2a = [s for s in res if s["cls"] == "a2a"]
    lat = [s["first_ms"] for s in human if s["first_ms"] is not None]
    out = [
        metric("irc_human_sent", len(human), "messages", "info", cmd=cmd, group="mesh"),
        metric(
            "irc_human_loss",
            sum(1 for s in human if s["n"] == 0),
            "messages",
            "lower",
            cmd=cmd,
            group="mesh",
            note="to steerable panes (omp1, omp2, wk1); no receipt of any kind",
        ),
        metric(
            "irc_human_dup",
            sum(1 for s in human if s["n"] > 1),
            "messages",
            "lower",
            cmd=cmd,
            group="mesh",
            note="delivered both typed and by hook drain",
        ),
        metric(
            "irc_a2a_loss",
            sum(1 for s in a2a if s["n"] == 0),
            "messages",
            "lower",
            cmd=cmd,
            group="mesh",
            det=False,
            threshold={"abs": 2},
            note="agent->agent via board to a headless worker",
        ),
        metric(
            "irc_shell_typed",
            shell_typed,
            "messages",
            "lower",
            cmd=cmd,
            group="mesh",
            note="messages typed into a plain shell pane (must be refused)",
        ),
        metric(
            "irc_stuck_queued",
            sum(1 for s in human if s.get("final") == "queued"),
            "messages",
            "lower",
            cmd=cmd,
            group="mesh",
            det=False,
            threshold={"abs": 2},
            note="never reached a terminal delivery status",
        ),
    ]
    out += core.latency_metrics("irc_delivery", lat, "mesh", cmd)
    return out


def probe_colony(ctx):
    cmd = CMD + "colony_accuracy"
    names = ["colony_terminal_accuracy"]
    if not ctx.tmux_real:
        return [skipped(n, "tmux not installed", group="mesh") for n in names]
    env, _a, _h = core.iso_env(ctx, "colony", {"ATLAS_MUX": "tmux"})
    root = ctx.sub("colony") / "proj"
    root.mkdir(exist_ok=True)
    env = {**env, "SC_ROOT": str(root)}
    if (
        _tmux(
            ctx, "new-session", "-d", "-s", "atlas-sccol", "-n", "lead", "-c", str(root)
        ).returncode
        != 0
    ):
        return [
            skipped(n, "private tmux server would not start", group="mesh")
            for n in names
        ]
    loop = "import time\nwhile 1:\n print(time.time(),flush=True);time.sleep(1)"
    for n, c in (
        ("da", f'exec {ctx.py} -c "{loop}"'),
        ("db", "exec sleep 3000"),
        ("dc", 'printf "Overwrite file? (y/n) "; exec sleep 3000'),
    ):
        _tmux(
            ctx, "new-window", "-d", "-t", "atlas-sccol:", "-n", n, "-c", str(root), c
        )
    code = (
        f"import sys; sys.path[:0]=[{str(ctx.scripts)!r}]; import atlas_todo as T\n"
        f"[T.note({str(root)!r}, n, 'started '+n, to='lead') for n in ('da','db','dc')]\n"
    )
    run([ctx.py, "-c", code], env=env)
    time.sleep(4)
    _tmux(ctx, "kill-window", "-t", "atlas-sccol:dc")  # killed, no exit note
    run(
        [
            ctx.py,
            "-c",
            code.replace("'started '+n", "'exit 0'").replace(
                "('da','db','dc')", "('db',)"
            ),
        ],
        env=env,
    )
    _tmux(ctx, "kill-window", "-t", "atlas-sccol:db")  # finished with exit note
    _tmux(ctx, "send-keys", "-t", "atlas-sccol:da", "C-c")  # interrupted
    terminal = {"failed", "exited", "finished"}
    ok, last, deadline = {}, {}, time.time() + (12 if ctx.quick else 20)
    while time.time() < deadline:
        res, _r = _helper(ctx, "colony", COLONY_PY, env, 60)
        if res is None or res.get("__no_route__"):
            _tmux(ctx, "kill-server")
            why = (
                "colony HTTP route absent in this tree (colony moved to the herdr transport): not measurable"
                if res
                else "colony helper failed: " + (_r["err"] + _r["out"])[-250:]
            )
            return [
                skipped(
                    names[0],
                    why,
                    "of 3",
                    "higher",
                    cmd,
                    "mesh",
                    "skipped" if res else "error",
                )
            ]
        last = res
        ok = {
            n: (last.get(n) or {}).get("state") in terminal
            or (last.get(n) or {}).get("section") == "finished"
            for n in ("da", "db", "dc")
        }
        if all(ok.values()):
            break
        time.sleep(2)
    _tmux(ctx, "kill-server")
    return [
        metric(
            "colony_terminal_accuracy",
            sum(ok.values()),
            "of 3",
            "higher",
            cmd=cmd,
            group="mesh",
            detail={n: last.get(n) for n in ("da", "db", "dc")},
            note="agents that ended (killed / exit note / ctrl-c) shown terminal within the window",
        )
    ]


def probe_spawn(ctx):
    cmd = CMD + "parallel_spawn"
    if not ctx.tmux_real:
        return [
            skipped(
                "parallel_spawn_ok", "tmux not installed", "of 8", "higher", cmd, "mesh"
            )
        ]
    env, _a, _h = core.iso_env(ctx, "spawn", {"ATLAS_MUX": "tmux"})
    d = ctx.sub("spawn")
    root = d / "proj"
    root.mkdir(exist_ok=True)
    pf = d / "prompt.txt"
    pf.write_text("do work")
    env = {**env, "ATLAS_MUX_WORKER_CMD": "echo hi; sleep 40"}
    procs = [
        subprocess.Popen(
            [
                ctx.py,
                str(ctx.scripts / "atlas_mux.py"),
                "spawn",
                "--run",
                "scsp",
                "--name",
                f"w{i}",
                "--harness",
                "claude",
                "--agent",
                "implementer",
                "--prompt-file",
                str(pf),
                "--root",
                str(root),
            ],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        for i in range(8)
    ]
    oks, errs = 0, []
    for p in procs:
        out, err = p.communicate(timeout=120)
        j = core.jsonl_last(out) or {}
        if j.get("ok"):
            oks += 1
        else:
            errs.append(str(j.get("error") or err[-80:])[:80])
    _tmux(ctx, "kill-server")
    return [
        metric(
            "parallel_spawn_ok",
            oks,
            "of 8",
            "higher",
            cmd=cmd,
            group="mesh",
            detail=sorted(set(errs)),
            note="8 concurrent atlas_mux.py spawn calls into one run, distinct names",
        )
    ]


PROBES = [
    (
        "board_concurrency",
        probe_board,
        ["board_note_loss_same_file", "irc_stream_loss"],
        False,
    ),
    ("irc_delivery", probe_irc, ["irc_human_loss", "irc_human_dup"], False),
    ("colony_accuracy", probe_colony, ["colony_terminal_accuracy"], False),
    ("parallel_spawn", probe_spawn, ["parallel_spawn_ok"], False),
]
