"""Shared plumbing for the atlas scorecard: metric records, isolation, timing, subprocess.

Everything a probe measures goes through `metric()` / `skipped()`; everything a probe
runs goes through `iso_env()` so no probe can touch the user's ~/.atlas, HOME, tmux
server or live processes. Stdlib only.
"""

import json
import math
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path

SCHEMA_VERSION = 1
TIME_THRESHOLD = {
    "rel": 0.25,
    "abs": 5.0,
}  # timing metrics: within 25% or 5 ms is "same"
EXACT = {"abs": 0}


class Ctx:
    """One scorecard run: the tree under test, scratch dir, knobs, private tmux."""

    def __init__(self, root, quick=False, db=None, runs=None, work=None):
        self.root = Path(root).resolve()
        self.repo = self.root.parent.parent  # holds test-mcp-tools.mjs in this monorepo
        self.quick = bool(quick)
        self.db = Path(db).resolve() if db else None
        self.n = int(runs) if runs else (5 if quick else 15)
        self.work = Path(
            work or tempfile.mkdtemp(prefix="atlas-sc-", dir="/tmp")
        ).resolve()
        self.work.mkdir(parents=True, exist_ok=True)
        self.py = sys.executable
        self.tmux_real = shutil.which("tmux")
        self.tmux_sock = f"atlassc{os.getpid()}"
        self.shim = self.work / "shim"
        self._seeded = None
        self.cleanups = []

    # -- layout --------------------------------------------------------------
    @property
    def scripts(self):
        return self.root / "scripts"

    @property
    def hooks(self):
        return self.root / "hooks"

    def sub(self, name):
        p = self.work / name
        p.mkdir(parents=True, exist_ok=True)
        return p

    def tmux_shim(self):
        """Dir holding a `tmux` wrapper bound to this run's private socket, or None."""
        if not self.tmux_real:
            return None
        self.shim.mkdir(parents=True, exist_ok=True)
        w = self.shim / "tmux"
        if not w.exists():
            w.write_text(
                f'#!/bin/sh\nexec "{self.tmux_real}" -L {self.tmux_sock} "$@"\n'
            )
            w.chmod(0o755)
        return self.shim

    def close(self):
        if self.tmux_real:  # kill only OUR private socket's server
            subprocess.run(
                [self.tmux_real, "-L", self.tmux_sock, "kill-server"],
                capture_output=True,
            )
        for fn in self.cleanups:
            try:
                fn()
            except Exception:
                pass
        shutil.rmtree(self.work, ignore_errors=True)


# -- metric records ------------------------------------------------------------
def metric(
    name,
    value,
    unit,
    direction="lower",
    threshold=None,
    cmd="",
    group="",
    det=True,
    note=None,
    detail=None,
):
    """direction: lower|higher (better), exact (any change is a regression), info (never judged).
    threshold: {"abs":x,"rel":y} - a delta within max(abs, rel*|before|) is `same`."""
    if isinstance(value, bool):
        value = int(value)
    if isinstance(value, float):
        value = round(value, 3)
    out = {
        "name": name,
        "value": value,
        "unit": unit,
        "direction": direction,
        "threshold": threshold or (EXACT if det else dict(TIME_THRESHOLD)),
        "remeasure": cmd,
        "group": group,
        "deterministic": det,
        "state": "ok",
    }
    if note:
        out["note"] = note
    if detail is not None:
        out["detail"] = detail
    return out


def timing(name, ms, cmd="", group="", direction="lower", note=None, detail=None):
    return metric(
        name, ms, "ms", direction, dict(TIME_THRESHOLD), cmd, group, False, note, detail
    )


def skipped(
    name, reason, unit="", direction="lower", cmd="", group="", state="skipped"
):
    return {
        "name": name,
        "value": None,
        "unit": unit,
        "direction": direction,
        "threshold": dict(EXACT),
        "remeasure": cmd,
        "group": group,
        "deterministic": True,
        "state": state,
        "reason": reason,
    }


def pct(xs, p):
    """Nearest-rank percentile of a list (same convention as the audit probes)."""
    xs = sorted(xs)
    if not xs:
        return None
    k = max(0, min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1)))))
    return xs[k]


def spread(xs):
    """Relative spread (max-min)/median, for flagging unstable probes."""
    if len(xs) < 2:
        return 0.0
    med = sorted(xs)[len(xs) // 2] or 1e-9
    return (max(xs) - min(xs)) / abs(med)


def latency_metrics(prefix, samples, group, cmd, unit_note=None):
    """p50 + p95 timing metrics from a list of ms samples."""
    if not samples:
        return [
            skipped(f"{prefix}_p50_ms", "no samples", "ms", cmd=cmd, group=group),
            skipped(f"{prefix}_p95_ms", "no samples", "ms", cmd=cmd, group=group),
        ]
    n = len(samples)
    return [
        timing(
            f"{prefix}_p50_ms",
            pct(samples, 50),
            cmd,
            group,
            note=unit_note,
            detail={"n": n},
        ),
        timing(f"{prefix}_p95_ms", pct(samples, 95), cmd, group, detail={"n": n}),
    ]


# -- environment isolation -----------------------------------------------------
_STRIP = ("ATLAS_", "HERDR_", "CFG_", "TMUX")


def iso_env(ctx, name, extra=None, tmux=True):
    """A hermetic child env: temp HOME/ATLAS_*/TMPDIR, private tmux, nothing inherited
    that could point at the user's state. Returns (env, atlas_dir, home_dir)."""
    base = ctx.sub(name)
    home, atlas, tmp = base / "home", base / "atlas", base / "tmp"
    for d in (home / ".claude", atlas, tmp):
        d.mkdir(parents=True, exist_ok=True)
    (home / ".claude" / "settings.json").write_text(
        json.dumps({"enabledPlugins": {"claude-mem@thedotmack": True}})
    )
    env = {k: v for k, v in os.environ.items() if not k.startswith(_STRIP)}
    env.update(
        HOME=str(home),
        ATLAS_HOME=str(atlas),
        ATLAS_DB=str(atlas / "atlas.db"),
        ATLAS_DASHBOARD_DB=str(atlas / "atlas.db"),
        ATLAS_DOCTOR_STATE=str(atlas / "doctor-state.json"),
        ATLAS_HOOKSTATE_DIR=str(atlas / "hookstate"),
        ATLAS_REPORT_GATE_DIR=str(tmp / "rg"),
        ATLAS_SELFFIX="0",
        ATLAS_DASHBOARD="off",
        ATLAS_COLONY="off",
        ATLAS_DASHBOARD_PORT="17969",
        ATLAS_GATES="always",
        TMPDIR=str(tmp),
        CLAUDE_PLUGIN_ROOT=str(ctx.root),
        PYTHONDONTWRITEBYTECODE="1",
        ATLAS_ENV_FILE="/nonexistent",
    )
    shim = ctx.tmux_shim() if tmux else None
    if shim:
        env["PATH"] = f"{shim}{os.pathsep}{env.get('PATH', '')}"
    if extra:
        env.update(extra)
    return env, atlas, home


def suite_env(ctx, name):
    """iso_env for running a product test suite. The suites assert environment-relative scoping,
    so keep the real HOME (a HOME under /tmp is scratch: 'markerless dir under home' tests cannot
    hold), the real TMPDIR (a /tmp path vs its /private/tmp realpath flips gate scoping, and a deep
    TMPDIR overflows the unix-socket path limit for tmux), and the default gate arming (ATLAS_GATES
    unset). Every ATLAS_* state path stays isolated."""
    env, atlas, home = iso_env(ctx, name)
    for k in ("HOME", "TMPDIR"):
        if k in os.environ:
            env[k] = os.environ[k]
        else:
            env.pop(k, None)
    env.pop("ATLAS_GATES", None)
    return env, atlas, home


def run(argv, input=None, env=None, cwd=None, timeout=60):
    """Run a command; never raises. -> {rc, out, err, ms} (rc == 'TIMEOUT' on timeout)."""
    if isinstance(input, str):
        input = input.encode()
    elif isinstance(input, (dict, list)):
        input = json.dumps(input).encode()
    t = time.perf_counter()
    try:
        p = subprocess.run(
            argv, input=input, capture_output=True, env=env, cwd=cwd, timeout=timeout
        )
        rc = p.returncode
        out, err = (
            p.stdout.decode("utf-8", "replace"),
            p.stderr.decode("utf-8", "replace"),
        )
    except subprocess.TimeoutExpired as e:
        rc, out, err = "TIMEOUT", (e.stdout or b"").decode("utf-8", "replace"), ""
    except OSError as e:
        rc, out, err = "OSERROR", "", str(e)
    return {"rc": rc, "out": out, "err": err, "ms": (time.perf_counter() - t) * 1000}


def faults(atlas):
    p = Path(atlas) / "hook-faults.jsonl"
    try:
        return [json.loads(line) for line in p.read_text().splitlines() if line.strip()]
    except Exception:
        return []


def hook_decision(out):
    """Normalise hook stdout into allow|deny|block|context|other."""
    out = (out or "").strip()
    if not out:
        return "allow"
    try:
        j = json.loads(out)
    except Exception:
        return "other:" + out[:60]
    if not isinstance(j, dict):
        return "other"
    if j.get("decision") == "block":
        return "block"
    h = j.get("hookSpecificOutput") or {}
    if h.get("permissionDecision") == "deny":
        return "deny"
    if h.get("additionalContext"):
        return "context"
    return "other"


def free_port():
    import socket

    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def safe_project_dir(ctx, name="proj"):
    """A project dir that is NOT under any system temp root (dispatch_tripwire exempts
    /tmp, /private/tmp and the hook's TMPDIR from the inline-edit deny). Prefers the
    per-user darwin temp dir, then /var/tmp, then ~/.cache; removed on close."""
    cands = []
    try:
        cands.append(os.confstr("CONFSTR_DARWIN_USER_TEMP_DIR"))
    except (ValueError, OSError, AttributeError):
        pass
    cands += ["/var/tmp", str(Path.home() / ".cache")]
    for base in cands:
        if not base or not os.path.isdir(base):
            continue
        real = os.path.realpath(base)
        if real.startswith(("/tmp", "/private/tmp")):
            continue
        try:
            d = Path(tempfile.mkdtemp(prefix="atlas-sc-", dir=base)) / name
            d.mkdir()
        except OSError:
            continue
        ctx.cleanups.append(lambda p=d.parent: shutil.rmtree(p, ignore_errors=True))
        return d.resolve()
    return None


def make_project(root, with_git=True):
    for d in ("docs", ".atlas/.run", ".atlas/evidence", "src"):
        (root / d).mkdir(parents=True, exist_ok=True)
    (root / ".mcp.json").write_text(
        json.dumps({"mcpServers": {"claude-mem": {"command": "x"}}})
    )
    (root / "README.md").write_text("# proj\n")
    (root / "docs/CHANGELOG.md").write_text("# Changelog\n- init\n")
    (root / "docs/ROADMAP.md").write_text("# Roadmap\n- [ ] item\n")
    (root / "src/app.py").write_text("x = 1\n")
    if with_git:
        subprocess.run(["git", "init", "-q", str(root)], capture_output=True)
    return root


def write_transcript(path, tools=()):
    lines = [
        {
            "type": "user",
            "uuid": "u1",
            "sessionId": "s",
            "message": {
                "role": "user",
                "content": "implement the feature in src/app.py",
            },
            "timestamp": "2026-10-06T10:00:00Z",
        },
        {
            "type": "assistant",
            "uuid": "a1",
            "sessionId": "s",
            "message": {
                "role": "assistant",
                "model": "claude-x",
                "content": [{"type": "text", "text": "Done. Edited src/app.py."}]
                + list(tools),
                "usage": {"input_tokens": 10, "output_tokens": 5},
            },
            "timestamp": "2026-10-06T10:00:05Z",
        },
    ]
    Path(path).write_text("".join(json.dumps(x) + "\n" for x in lines))
    return str(path)


# -- DB seeding ----------------------------------------------------------------
_SEED_HELPER = r"""
import os, sys, json
sys.path.insert(0, os.environ["SC_SCRIPTS"])
import atlas_db
c = atlas_db.connect(); atlas_db.init(c)
cfg = json.loads(os.environ["SC_CFG"])
pid = atlas_db.register_project(c, cfg["root"])
for i in range(cfg["runs"]):
    sid = "seed-%04d" % i
    rid = atlas_db.start_run(c, pid, sid, "task %d" % i)
    if i % 3 == 0:
        atlas_db.mark_orchestrating(c, sid, cfg["root"])
    for j in range(8):
        atlas_db.log_event(c, rid, ("Edit", "Bash", "Read")[j % 3], "main", j % 2, cfg["root"] + "/src/f%d.py" % j)
    for j in range(3):
        atlas_db.log_dispatch(c, rid, ("atlas:implementer", "atlas:verifier", "atlas:explorer")[j])
c.commit()
print(pid)
"""


def _fill_defaults(conn, table, row):
    for _cid, col, typ, notnull, dflt, _pk in conn.execute(
        f"pragma table_info({table})"
    ):
        if col not in row and notnull and dflt is None:
            row[col] = (
                0
                if any(t in (typ or "").upper() for t in ("INT", "REAL", "NUM"))
                else ""
            )
    return row


def _insert(conn, table, rows):
    if not rows:
        return
    full = [_fill_defaults(conn, table, dict(r)) for r in rows]
    cols = list(full[0])
    conn.executemany(
        f"insert or ignore into {table} ({','.join(cols)}) values ({','.join('?' * len(cols))})",
        [[r.get(c) for c in cols] for r in full],
    )


def seed_db(ctx, dest, project_root):
    """Create `dest` as a scorecard-private DB: a backup copy of --db when given,
    else a deterministic synthetic DB built with the tree's own schema. Returns a
    description dict. The source DB is opened read-only and never written."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if ctx.db:
        src = sqlite3.connect(f"file:{ctx.db}?mode=ro", uri=True)
        dst = sqlite3.connect(dest)
        with dst:
            src.backup(dst)
        n = dst.execute("select count(*) from messages").fetchone()[0]
        src.close()
        dst.close()
        return {"kind": "copy", "source": str(ctx.db), "messages": n}
    import random

    rng = random.Random(20261006)
    env = {
        **os.environ,
        "ATLAS_DB": str(dest),
        "SC_SCRIPTS": str(ctx.scripts),
        "PYTHONDONTWRITEBYTECODE": "1",
        "SC_CFG": json.dumps({"root": str(project_root), "runs": 60}),
    }
    r = run([ctx.py, "-c", _SEED_HELPER], env=env, timeout=120)
    if r["rc"] != 0:
        raise RuntimeError("seed helper failed: " + r["err"][-300:])
    pid = int(r["out"].strip().splitlines()[-1])
    conn = sqlite3.connect(dest)
    base_ts = (
        int(time.time()) // 3600 * 3600 - 160 * 3600
    )  # relative to now: the same windows every run
    sessions, msgs, calls, scores, facets, prompts = [], [], [], [], [], []
    for i in range(160):
        sid = f"sess-{i:04d}"
        t0 = base_ts + i * 3600
        agent = "omp" if i % 3 == 0 else "claude"
        sessions.append(
            dict(
                session_id=sid,
                project_id=pid,
                transcript_path=f"/seed/{sid}.jsonl",
                cwd=str(project_root),
                agent=agent,
                model="m",
                started_at=t0,
                ended_at=t0 + 900,
                message_count=40,
                user_prompt_count=5,
                tool_call_count=30,
                error_count=2,
                input_tokens=1000,
                output_tokens=500,
                cursor_bytes=0,
                cursor_lines=0,
                file_size=0,
                file_mtime=0,
                last_ingest_at=t0 + 901,
            )
        )
        for m in range(40):
            uid = f"{sid}-m{m}"
            msgs.append(
                dict(
                    session_id=sid,
                    uuid=uid,
                    ts=t0 + m * 20,
                    role="user" if m % 8 == 0 else "assistant",
                    is_sidechain=0,
                    model="m",
                    text=("line %d " % m) * rng.randint(5, 40),
                )
            )
            if m % 8 == 0:
                prompts.append(
                    dict(
                        session_id=sid,
                        uuid=uid,
                        ts=t0 + m * 20,
                        text="do thing %d" % m,
                        char_len=10,
                        norm="do thing",
                    )
                )
        for k in range(30):
            err = 1 if k % 15 == 0 else 0
            calls.append(
                dict(
                    session_id=sid,
                    message_uuid=f"{sid}-m{k}",
                    ts=t0 + k * 25,
                    is_sidechain=0,
                    tool_use_id=f"{sid}-t{k}",
                    tool_name=("Bash", "Read", "Edit", "Grep")[k % 4],
                    kind="tool",
                    target="src/f.py",
                    server="",
                    input_summary="{}",
                    input_bytes=20,
                    is_error=err,
                    result_bytes=100,
                    denied=0,
                    error_snippet="boom" if err else None,
                )
            )
        if i % 2 == 0:
            scores.append(
                dict(
                    session_id=sid,
                    message_uuid=f"{sid}-m1",
                    ts=t0 + 30,
                    judgment="done_claim_unverified",
                    kind="turn",
                    value=rng.random(),
                    label=None,
                    confidence=0.5,
                    model="m",
                    scored_at=t0 + 40,
                    input_tokens=10,
                )
            )
            facets.append(
                dict(
                    session_id=sid,
                    project_id=pid,
                    created_at=t0,
                    message_count=40,
                    user_prompt_count=5,
                    tool_call_count=30,
                    error_count=2,
                    dispatch_count=3,
                    wall_clock_s=900,
                    outcome="success",
                )
            )
    for table, rows in (
        ("session_logs", sessions),
        ("messages", msgs),
        ("tool_calls", calls),
        ("user_prompts", prompts),
        ("turn_scores", scores),
        ("facets", facets),
    ):
        _insert(conn, table, rows)
    conn.commit()
    n = conn.execute("select count(*) from messages").fetchone()[0]
    conn.close()
    return {"kind": "synthetic", "messages": n}


def jsonl_last(text):
    """Last parseable JSON line of a text blob, else None."""
    for line in reversed((text or "").strip().splitlines()):
        try:
            return json.loads(line)
        except Exception:
            continue
    return None


def finite(x):
    return isinstance(x, (int, float)) and math.isfinite(x)
