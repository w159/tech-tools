#!/usr/bin/env python3
"""OpenRig seat backend for atlas: same public surface as atlas_herdr.py, driven only by the
`rig` CLI (--json) plus GET /healthz. One rig per atlas run, one pod `w`, one terminal member per worker.

Every public function returns a dict/list and never raises. All subprocess calls go through `_rig`."""

from __future__ import annotations

import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

DEFAULT_PORT = 7437
RIG_VERSION = "0.6.10"  # the one pin for the private-prefix install
_SAFE = re.compile(r"[^A-Za-z0-9_.-]")
# agentActivity.state -> atlas agent status
_ACTIVITY = {"running": "working", "needs_input": "blocked", "idle": "idle"}


def _home() -> Path:
    return Path(os.environ.get("ATLAS_HOME") or Path.home() / ".atlas")


def _rig_home() -> Path:
    return _home() / "openrig" / "home"


def _port() -> int:
    try:
        return int(os.environ.get("ATLAS_RIG_PORT") or DEFAULT_PORT)
    except ValueError:
        return DEFAULT_PORT


def _url() -> str:
    return f"http://127.0.0.1:{_port()}"


def _bin() -> str | None:
    p = _home() / "openrig" / "npm" / "node_modules" / ".bin" / "rig"
    return str(p) if p.is_file() else shutil.which("rig")


def _env() -> dict:
    return {
        **os.environ,
        "OPENRIG_HOME": str(_rig_home()),
        "OPENRIG_PORT": str(_port()),
        "OPENRIG_NO_KERNEL": "1",
        "OPENRIG_URL": _url(),
        # Keep daemon writes inside OPENRIG_HOME: codex config, and no Tailscale-IP bind.
        "CODEX_HOME": str(_rig_home() / "codex"),
        "OPENRIG_BIND_HOST": "127.0.0.1",
    }


_VENDORED_SKILLS = ("rigs", "openrig-skills", "refocusing")


def _quarantine_vendored_skills(home: Path | None = None) -> dict:
    """The daemon re-vendors skills into ~/.claude/skills and ~/.agents/skills on every boot (no off switch).
    It skips a dir that exists without `.openrig-vendor-version`, so leave empty, unmarked dirs there.
    Dirs without the marker are not ours and are never touched. Fail-open."""
    out: dict = {"removed": [], "created": [], "kept": [], "errors": []}
    base = home or Path.home()
    for root in (base / ".claude" / "skills", base / ".agents" / "skills"):
        for name in _VENDORED_SKILLS:
            d = root / name
            try:
                if (d / ".openrig-vendor-version").exists():
                    shutil.rmtree(d)
                    d.mkdir()
                    out["removed"].append(str(d))
                elif d.exists():
                    out["kept"].append(str(d))
                else:
                    d.mkdir(parents=True)
                    out["created"].append(str(d))
            except OSError as e:
                out["errors"].append(f"{d}: {e}")
    return out


def _rig(args: list[str], timeout: float = 10) -> tuple[int, object, str]:
    """Run `rig <args>`; (rc, parsed stdout JSON or None, stderr tail). rc 127 = no binary, 124 = timeout."""
    exe = _bin()
    if not exe:
        return 127, None, "rig_missing"
    # Own session + explicit group kill: subprocess.run's post-timeout communicate() blocks
    # forever when a grandchild (the rig daemon autostart) inherits the stdout pipe.
    try:
        proc = subprocess.Popen(
            [exe, *args],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=_env(),
            start_new_session=True,
        )
    except OSError as e:
        return 127, None, str(e)
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            proc.kill()
        for stream in (proc.stdout, proc.stderr):
            try:
                if stream:
                    stream.close()
            except OSError:
                pass
        proc.wait(timeout=2)
        return 124, None, "timeout"
    try:
        data = json.loads(out) if out.strip() else None
    except ValueError:
        data = None
    return proc.returncode, data, (err or "")[-300:]


def _healthz() -> dict | None:
    try:
        with urllib.request.urlopen(f"{_url()}/healthz", timeout=2) as r:
            d = json.loads(r.read())
        return d if isinstance(d, dict) and d.get("status") == "ok" else None
    except Exception:
        return None


def _ok(**kw) -> dict:
    return {"ok": True, **kw}


def _err(reason: str, **kw) -> dict:
    return {"ok": False, "reason": reason, **kw}


def _safe(s: str) -> str:
    return _SAFE.sub("-", str(s)) or "work"


def status() -> dict:
    """Read-only. state: ok | server_down (reason rig_missing | connection_refused)."""
    h = _healthz()
    exe = _bin()
    state = "ok" if h else "server_down"
    out = {
        "running": bool(h),
        "healthy": bool(h),
        "state": state,
        "url": _url(),
        "pid": (h or {}).get("pid"),
        "rig_version": (h or {}).get("semver"),
        "installed": bool(exe),
        "rig_home": str(_rig_home()),
    }
    if not h:
        out["reason"] = "connection_refused" if exe else "rig_missing"
    if not exe:
        out["reason"] = "rig_missing"
    return out


def install(log_path: str | None = None) -> dict:
    """Silent private-prefix install of @openrig/cli into $ATLAS_HOME/openrig/npm. Never raises."""
    try:
        if _bin():
            return {"ok": True, "action": "present"}
        npm = shutil.which("npm")
        node = subprocess.run(
            ["node", "--version"], capture_output=True, text=True, timeout=10
        )
        major = (
            int(node.stdout.strip().lstrip("v").split(".")[0])
            if node.returncode == 0
            else 0
        )
        if not npm or major not in (22, 24):
            return {
                "ok": False,
                "action": "unsupported_node",
                "reason": f"node major {major or 'missing'}, npm {'ok' if npm else 'missing'}; need node 22/24 + npm",
            }
        log = Path(log_path) if log_path else _home() / "openrig" / "install.log"
        log.parent.mkdir(parents=True, exist_ok=True)
        with open(log, "ab") as f:
            p = subprocess.run(
                [
                    npm,
                    "install",
                    "--prefix",
                    str(_home() / "openrig" / "npm"),
                    f"@openrig/cli@{RIG_VERSION}",
                ],
                stdout=f,
                stderr=f,
                timeout=180,
            )
        if p.returncode != 0:
            return {
                "ok": False,
                "action": "error",
                "reason": f"npm exit {p.returncode} (see {log})",
            }
        return {"ok": True, "action": "installed"}
    except Exception as e:  # contract: never raises
        return {"ok": False, "action": "error", "reason": f"{type(e).__name__}: {e}"}


def ensure_server(wait: float = 8.0) -> dict:
    """Idempotent: probe, else `rig daemon start` (self-daemonizes) and poll /healthz."""
    try:
        if _healthz():
            return _ok(action="already_up", url=_url())
        if not _bin():
            ins = install()
            if not ins.get("ok"):
                return ins
        _quarantine_vendored_skills()  # daemon vendors skills on boot
        rc, _, tail = _rig(
            [
                "daemon",
                "start",
                "--no-kernel",
                "--host",
                "127.0.0.1",
                "--port",
                str(_port()),
            ],
            60,
        )
        deadline = time.monotonic() + wait
        while True:
            if _healthz():
                _quarantine_vendored_skills()  # boot-time write may have landed
                return _ok(action="started", url=_url())
            if time.monotonic() >= deadline:
                break
            time.sleep(0.25)
        return {
            "ok": False,
            "action": "error",
            "reason": f"daemon not healthy (rc={rc}) {tail}".strip(),
        }
    except Exception as e:  # contract: never raises
        return {"ok": False, "action": "error", "reason": f"{type(e).__name__}: {e}"}


def ensure() -> dict:
    out = ensure_server()
    return {**out, **{k: v for k, v in status().items() if k not in out}}


_PROBE_TIMEOUT_S = 3  # request-path probes: fail fast, the next TTL window retries
_PS_TTL_S = 3.0
_ps_lock = threading.Lock()
_ps_cache: dict[tuple, tuple[float, tuple[int, object, str]]] = {}


def _ps(args: list[str]) -> tuple[int, object, str]:
    """Read-only `rig ps` probe, cached for a few seconds under a lock. One dashboard request asks
    per project root (agents + list_panes + live index); an unresponsive rig must cost one bounded
    probe per window, not one per caller."""
    key = tuple(args)
    with _ps_lock:
        hit = _ps_cache.get(key)
        if hit and time.monotonic() - hit[0] < _PS_TTL_S:
            return hit[1]
        res = _rig(args, timeout=_PROBE_TIMEOUT_S)
        _ps_cache[key] = (time.monotonic(), res)
        return res


def _nodes(rig: str) -> list[dict]:
    rc, data, _ = _ps(["ps", "--nodes", "--rig", rig, "--json"])
    return (
        [n for n in data if isinstance(n, dict)]
        if rc == 0 and isinstance(data, list)
        else []
    )


def _rigs() -> list[str] | None:
    rc, data, _ = _ps(["ps", "--json"])
    if rc != 0 or not isinstance(data, list):
        return None
    return [str(d["name"]) for d in data if isinstance(d, dict) and d.get("name")]


def _member(n: dict) -> str:
    return str(n.get("logicalId") or "").split(".", 1)[-1]


def list_panes(run: str | None = None) -> list[dict]:
    """[{pane_id, workspace_id, workspace, tab_id, label, cwd}]; pane_id is the tmux session name."""
    try:
        rigs = [_safe(run)] if run else (_rigs() or [])
        return [
            {
                "pane_id": str(n.get("canonicalSessionName") or ""),
                "workspace_id": rig,
                "workspace": rig,
                "tab_id": None,
                "label": _member(n),
                "cwd": n.get("cwd") or "",
            }
            for rig in rigs
            for n in _nodes(rig)
            if n.get("canonicalSessionName")
        ]
    except Exception:
        return []


def _member_spec(m: dict) -> dict:
    return {
        "id": m["id"],
        "label": m["id"],
        "agent_ref": "builtin:terminal",
        "profile": "none",
        "runtime": "terminal",
        "cwd": m["cwd"],
    }


def _spec(rig: str, members: list[dict]) -> str:
    q = json.dumps  # JSON scalars are valid YAML, and quote safely
    lines = [
        f"version: {q('0.2')}",
        f"name: {q(rig)}",
        "pods:",
        "  - id: w",
        f"    label: {q('workers')}",
        "    members:",
    ]
    for m in members:
        lines += [
            f"      - id: {q(m['id'])}",
            f"        label: {q(m['id'])}",
            f"        agent_ref: {q('builtin:terminal')}",
            "        profile: none",
            "        runtime: terminal",
            f"        cwd: {q(m['cwd'])}",
        ]
    return "\n".join(lines) + "\n"


def create_pane(
    name: str,
    command: str,
    *,
    cwd: str,
    run: str = "work",
    env: dict | None = None,
    focus: bool = False,
) -> dict:
    """Add terminal member `name` to rig `run` and type `command` into it. `env`/`focus` are ignored:
    the caller already wraps `command` with `env K=V`. Returns {ok, pane_id, workspace_id, tab_id, name, run}."""
    try:
        rig, member = _safe(run), _safe(name)
        existing = list_panes(rig)
        if any(p["label"] == member for p in existing):
            return _err(f"name_taken: {member} already runs in {rig}")
        members = [{"id": p["label"], "cwd": p["cwd"] or cwd} for p in existing]
        members.append({"id": member, "cwd": cwd})
        spec = _rig_home() / "specs" / f"{rig}.yaml"
        spec.parent.mkdir(parents=True, exist_ok=True)
        spec.write_text(_spec(rig, members))
        if existing:
            # `rig up` refuses a running rig name (even with --existing); `rig add` grows pod `w` live.
            frag = spec.with_name(f"{rig}.{member}.member.json")
            frag.write_text(json.dumps(_member_spec(members[-1])))
            rc, out, tail = _rig(["add", rig, "w", str(frag), "--json"], 60)
        else:
            rc, out, tail = _rig(["up", str(spec), "--yes", "--json"], 60)
        if rc != 0:
            why = out.get("error", "") if isinstance(out, dict) else ""
            return _err(f"rig up/add failed (rc={rc}): {why or tail}".strip())
        session = f"w-{member}@{rig}"
        rc, _, tail = _rig(["send", session, command, "--raw", "--json"])
        if rc != 0:
            return _err(f"rig send failed (rc={rc}): {tail}".strip(), pane_id=session)
        return _ok(pane_id=session, workspace_id=rig, tab_id=None, name=name, run=run)
    except Exception as e:
        return _err(f"{type(e).__name__}: {e}")


def close_pane(pane_id: str) -> dict:
    """Kill one seat's tmux session (documented fallback; a `rig` seat-stop ref is [unverified])."""
    try:
        if not any(
            p["pane_id"] == pane_id for p in list_panes(pane_id.rsplit("@", 1)[-1])
        ):
            return _err("no such colony pane")
        subprocess.run(
            ["tmux", "kill-session", "-t", pane_id], capture_output=True, timeout=5
        )
        return _ok(pane_id=pane_id)
    except Exception as e:
        return _err(f"{type(e).__name__}: {e}")


def close_run(run: str) -> dict:
    """`rig down <rig> --delete --json`. {ok, closed:[names], panes:[ids]}."""
    try:
        rig = _safe(run)
        panes = list_panes(rig)
        rc, _, tail = _rig(["down", rig, "--delete", "--json"], 60)
        if rc != 0:
            return _err(f"rig down failed (rc={rc}): {tail}".strip())
        return _ok(
            closed=[p["label"] for p in panes], panes=[p["pane_id"] for p in panes]
        )
    except Exception as e:
        return _err(f"{type(e).__name__}: {e}")


def pane_live(pane_id: str) -> bool:
    try:
        return any(
            p["pane_id"] == pane_id for p in list_panes(pane_id.rsplit("@", 1)[-1])
        )
    except Exception:
        return False


def send_prompt(pane_id, text) -> dict:
    """Type `text` into a terminal seat. --raw is required: without it the From/To envelope reaches the shell."""
    try:
        if not isinstance(text, str) or not text.strip():
            return _err("text is required")
        rc, data, tail = _rig(["send", str(pane_id), text, "--raw", "--json"])
        return (
            _ok(pane_id=pane_id, result=data)
            if rc == 0
            else _err(f"rig send failed (rc={rc}): {tail}".strip())
        )
    except Exception as e:
        return _err(f"{type(e).__name__}: {e}")


def capture(pane_id, lines: int = 40) -> dict:
    """{ok, pane_id, text} for a seat's recent terminal text; {ok: False, error} otherwise. Never raises."""
    try:
        rc, data, tail = _rig(
            ["capture", str(pane_id), "--lines", str(int(lines)), "--json"]
        )
        if rc != 0:
            return {
                "ok": False,
                "error": f"rig capture failed (rc={rc}): {tail}".strip(),
            }
        if isinstance(data, dict):  # key name is rig's; accept the plausible ones
            data = next(
                (
                    data[k]
                    for k in ("text", "output", "content", "screen", "capture")
                    if k in data
                ),
                "",
            )
        return {
            "ok": True,
            "pane_id": pane_id,
            "text": data if isinstance(data, str) else "",
        }
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def _agent_row(rig: str, n: dict) -> dict:
    session = str(n.get("canonicalSessionName") or "")
    act = (n.get("agentActivity") or {}).get("state")
    st = _ACTIVITY.get(str(act), "unknown")
    row = {
        "pane_id": session,
        "workspace_id": rig,
        "workspace": rig,
        "tab_id": None,
        "name": _member(n),
        "agent": "terminal",
        "status": st,
        "cwd": n.get("cwd") or "",
        "title": session,
        "focused": False,
        "state_change_seq": None,
        "completion_seq": None,
        "deep_link": f"tmux attach -t {session}",
    }
    if (
        n.get("lifecycleState") == "attention_required"
        or n.get("startupStatus") == "failed"
    ):
        row["status"], row["reason"] = (
            "blocked",
            n.get("latestError") or "attention_required",
        )
    return row


def agents() -> dict:
    """{reachable, reason, workspaces, agents}, never raises."""
    try:
        rigs = _rigs()
        if rigs is None:
            return {
                "reachable": False,
                "reason": "rig ps failed",
                "workspaces": [],
                "agents": [],
            }
        rows = [_agent_row(rig, n) for rig in rigs for n in _nodes(rig)]
        wss = [
            {
                "workspace_id": r_,
                "label": r_,
                "focused": False,
                "agent_status": None,
                "pane_count": sum(1 for a in rows if a["workspace_id"] == r_),
            }
            for r_ in rigs
        ]
        return {"reachable": True, "reason": None, "workspaces": wss, "agents": rows}
    except Exception as e:
        return {
            "reachable": False,
            "reason": f"{type(e).__name__}: {e}",
            "workspaces": [],
            "agents": [],
        }


def main(argv: list[str]) -> int:
    cmds = {
        "status": status,
        "ensure": ensure,
        "list-panes": list_panes,
        "agents": agents,
    }
    if len(argv) != 2 or argv[1] not in cmds:
        sys.stderr.write("usage: atlas_rig.py status|ensure|list-panes|agents\n")
        return 2
    out = cmds[argv[1]]()
    print(json.dumps(out, indent=2))
    return 0 if not isinstance(out, dict) or out.get("ok", True) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
