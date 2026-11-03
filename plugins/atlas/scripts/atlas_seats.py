#!/usr/bin/env python3
"""Seat-backend facade: OpenRig (atlas_rig) by default, herdr (atlas_herdr) as fallback.

ATLAS_SEAT_BACKEND=rig|herdr|off overrides detection. Every public function delegates to the chosen module."""

from __future__ import annotations

import contextlib
import importlib
import json
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_NAMES = (
    "status",
    "ensure",
    "ensure_server",
    "list_panes",
    "create_pane",
    "close_pane",
    "pane_live",
    "send_prompt",
)


def _node_rule(version_text: str) -> bool:
    """OpenRig needs Node 22 or 24 (and npm to install it)."""
    return bool(shutil.which("npm")) and int(
        version_text.strip().lstrip("v").split(".")[0]
    ) in (22, 24)


def _node_ok() -> bool:
    try:
        v = subprocess.run(
            ["node", "--version"], capture_output=True, text=True, timeout=5
        ).stdout
        return _node_rule(v)
    except Exception:
        return False


def _node_ok_cached(home: str) -> bool:
    """_node_ok() without a per-call subprocess: the `node --version` major is cached in
    $ATLAS_HOME/node-major-cache.json keyed by the resolved node path + mtime + size, so it runs once per node
    install. Failures are never cached."""
    try:
        node = shutil.which("node")
        if not node:
            return False
        real = os.path.realpath(node)
        st = os.stat(real)
        key = [real, st.st_mtime_ns, st.st_size]
        cache = os.path.join(home, "node-major-cache.json")
        try:
            with open(cache) as f:
                c = json.load(f)
            if c.get("key") == key:
                return _node_rule(str(c["version"]))
        except (OSError, ValueError, KeyError):
            pass
        v = subprocess.run(
            [node, "--version"], capture_output=True, text=True, timeout=5
        ).stdout
        ok = _node_rule(v)
        with contextlib.suppress(OSError):
            os.makedirs(home, exist_ok=True)
            with open(cache + ".tmp", "w") as f:
                json.dump({"key": key, "version": v.strip()}, f)
            os.replace(cache + ".tmp", cache)
        return ok
    except Exception:
        return False


def decide_backend(rig_bin, node_ok, rigs_empty, herdr_server_up, herdr_installed) -> str:
    """The one backend decision (rig | herdr | none), shared by backend() and SessionStart's herdr gate so they
    cannot drift. Every argument is a zero-arg callable so callers pick cheap or exact probes and unused ones never
    run: rig when its binary exists or node 22/24 + npm are present, except herdr when no rigs run and the herdr
    server is up; without rig, herdr when its web-ui is installed or its server is up, else none."""
    if rig_bin() or node_ok():
        # rig holds no rigs (or its ps failed) but herdr is up: the live panes are herdr's
        try:
            if rigs_empty() and herdr_server_up():
                return "herdr"
        except Exception:
            pass
        return "rig"
    try:
        if herdr_installed() or herdr_server_up():
            return "herdr"
    except Exception:
        pass
    return "none"


_BACKEND_TTL_S = 30.0
_backend_cache: tuple = (0.0, None)


def _reset_backend_cache() -> None:
    global _backend_cache
    _backend_cache = (0.0, None)


def backend() -> str:
    """rig | herdr | none, memoized per process for 30 s (rig ps costs ~1.5 s). Env overrides are never cached."""
    global _backend_cache
    env = (os.environ.get("ATLAS_SEAT_BACKEND") or "").strip().lower()
    if env in ("rig", "herdr", "off"):
        return _detect_backend()
    ts, val = _backend_cache
    now = time.monotonic()
    if val is not None and now - ts < _BACKEND_TTL_S:
        return val
    val = _detect_backend()
    _backend_cache = (now, val)
    return val


def _detect_backend() -> str:
    """Rig wins when its binary exists or it can be installed silently."""
    env = (os.environ.get("ATLAS_SEAT_BACKEND") or "").strip().lower()
    if env in ("rig", "herdr"):
        return env
    if env == "off":
        return "none"
    rig = importlib.import_module("atlas_rig")
    herdr = importlib.import_module("atlas_herdr")
    return decide_backend(
        rig._bin,
        _node_ok,
        lambda: not rig._rigs(),
        lambda: herdr.status().get("herdr_server"),
        lambda: herdr.status().get("installed"),
    )


_NO_BACKEND = {"ok": False, "reason": "no seat backend"}


class _NullBackend:
    """Contract-shaped no-ops for backend() == 'none': public calls never raise."""

    @staticmethod
    def status():
        return {"ok": False, "running": False, "state": "no_backend", "reason": "no seat backend"}

    @staticmethod
    def list_panes(run=None):
        return []

    @staticmethod
    def pane_live(pane_id):
        return False

    @staticmethod
    def agents():
        return {"reachable": False, "reason": "no seat backend", "workspaces": [], "agents": []}

    def __getattr__(self, name):  # ensure, ensure_server, create_pane, close_pane, send_prompt, close_run
        return lambda *a, **kw: dict(_NO_BACKEND)


def _mod():
    b = backend()
    if b == "none":
        return _NullBackend()
    return importlib.import_module("atlas_rig" if b == "rig" else "atlas_herdr")


def _delegate(name):
    return lambda *a, **kw: getattr(_mod(), name)(*a, **kw)


for _n in _NAMES:
    globals()[_n] = _delegate(_n)

_status = status  # the delegating function bound above


def _forced() -> bool:
    return (os.environ.get("ATLAS_SEAT_BACKEND") or "").strip().lower() in (
        "rig",
        "herdr",
        "off",
    )


def _sources() -> list:
    """Modules whose panes are live: the forced one alone, else rig plus herdr when its server is up."""
    if _forced():
        return [] if backend() == "none" else [_mod()]
    mods = [importlib.import_module("atlas_rig")]
    herdr = importlib.import_module("atlas_herdr")
    try:
        if herdr.status().get("herdr_server"):
            mods.append(herdr)
    except Exception:
        pass
    return mods


def agents() -> dict:
    """Union of every live source's rows (rig and herdr panes coexist), deduped by pane_id / workspace_id."""
    out = {"reachable": False, "reason": "no seat backend", "workspaces": [], "agents": []}
    seen_a, seen_w, reasons = set(), set(), []
    for m in _sources():
        r = m.agents()
        if not r.get("reachable"):
            reasons.append(str(r.get("reason")))
            continue
        out["reachable"] = True
        for key, ident, seen in (
            ("agents", "pane_id", seen_a),
            ("workspaces", "workspace_id", seen_w),
        ):
            for row in r.get(key, []):
                if row.get(ident) not in seen:
                    seen.add(row.get(ident))
                    out[key].append(row)
    out["reason"] = None if out["reachable"] else "; ".join(reasons) or out["reason"]
    return out


def close_run(run: str) -> dict:
    """Tear the run down in every live source: a team's rig and a herdr workspace of the same id may both exist."""
    res = [m.close_run(run) for m in _sources()]
    ok = [r for r in res if r.get("ok")]
    if not ok:
        return res[0] if res else {"ok": False, "reason": "no seat backend"}
    return {
        "ok": True,
        "closed": [c for r in ok for c in r.get("closed", [])],
        "panes": [c for r in ok for c in r.get("panes", [])],
    }


def status() -> dict:
    """Backend status plus `backend` and `web_ui` (True only for herdr: the rig url is a health URL, not an iframe)."""
    b = backend()
    base = _NullBackend.status() if b == "none" else _status()
    if b == "rig" and not shutil.which("tmux"):  # rig seats are tmux sessions: say so before rig up fails
        base = {**base, "ok": False, "reason": "tmux is not installed (rig seats run in tmux)"}
    return {**base, "backend": b, "web_ui": b == "herdr"}


def capture(pane_id, lines: int = 40) -> dict:
    """Recent terminal text of a seat: rig via its capture, herdr via the pane.read socket call. Never raises."""
    b = backend()
    if b == "herdr":
        h = _herdr()
        try:
            read = h.rpc(
                "pane.read",
                {"pane_id": pane_id, "source": "recent", "lines": lines, "format": "text"},
                timeout=2.0,
            ).get("read")
        except h.HerdrSockError as e:
            return {"ok": False, "error": e.reason}
        text = read.get("text") if isinstance(read, dict) else None
        return {"ok": True, "pane_id": pane_id, "text": text if isinstance(text, str) else ""}
    if b != "rig":
        return {"ok": False, "error": "not_supported"}
    return importlib.import_module("atlas_rig").capture(pane_id, lines)


# --- herdr-only passthroughs: the dashboard keeps these behind `backend() == "herdr"` ---------


def _herdr():
    return importlib.import_module("atlas_herdr")


def __getattr__(
    name,
):  # PromptRefused / SockError: the exception types callers catch (lazy, no import cycle)
    if name == "PromptRefused":
        return _herdr().PromptRefused
    if name == "SockError":
        return _herdr().HerdrSockError
    raise AttributeError(name)


def rpc(method: str, params: dict | None = None, timeout: float = 0.5) -> dict:
    return _herdr().rpc(method, params, timeout=timeout)


def web_url() -> str:
    """The herdr colony web UI URL (where the Command Center frames panes); independent of the active backend."""
    h = _herdr()
    h._refresh_url()
    return h._where()[1]


def reset_status_cache() -> None:
    """Drop the cached status so the page's next read is fresh."""
    _herdr()._status_cache = None


ENSURE_BACKOFF_S = 1800  # a failed first-use ensure (npm install, daemon start) is not retried for this long
ENSURE_PENDING_S = 240  # a start launched this recently is still running: do not launch another


def _flag_off(name: str) -> bool:
    return os.environ.get(name, "on").lower() in ("0", "off", "false", "no")


def ensure_background() -> str:
    """First-use start of the seat daemon: launch `atlas_seats.py ensure` detached and return at once (callers never
    wait on an npm install). Returns off (ATLAS_COLONY / ATLAS_HERDR_AUTOSTART), none, herdr (not started here: the
    SessionStart colony path owns herdr), backoff (a recent ensure failed), pending (one is already running),
    started or error. State lives in $ATLAS_HOME/seat-ensure-state.json: {"state": "starting"|"failed", "at": ts};
    success removes it and rewrites seat-status-cache.json, failure leaves no .tmp behind."""
    if _flag_off("ATLAS_COLONY") or _flag_off("ATLAS_HERDR_AUTOSTART"):
        return "off"
    kind = backend()
    if kind != "rig":
        return "herdr" if kind == "herdr" else "none"
    home = os.environ.get("ATLAS_HOME") or os.path.join(os.path.expanduser("~"), ".atlas")
    state = os.path.join(home, "seat-ensure-state.json")
    try:
        with open(state) as f:
            st = json.load(f)
        age = time.time() - float(st.get("at", 0))
        if st.get("state") == "failed" and 0 <= age < ENSURE_BACKOFF_S:
            return "backoff"
        if st.get("state") == "starting" and 0 <= age < ENSURE_PENDING_S:
            return "pending"
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    try:
        os.makedirs(home, exist_ok=True)
        with open(state, "w") as f:
            json.dump({"state": "starting", "at": time.time()}, f)
        subprocess.Popen(
            [
                "sh",
                "-c",
                '"$0" "$1" ensure >"$2.tmp" 2>>"$3" && mv "$2.tmp" "$2" && rm -f "$4"'
                ' || { rm -f "$2.tmp"; printf \'{"state": "failed", "at": %s}\\n\' "$(date +%s)" >"$4"; }',
                sys.executable,
                os.path.abspath(__file__),
                os.path.join(home, "seat-status-cache.json"),
                os.path.join(home, "seat-ensure.log"),
                state,
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            env=os.environ.copy(),
        )
        return "started"
    except Exception:
        with contextlib.suppress(OSError):
            os.remove(state)
        return "error"


def main(argv: list[str]) -> int:
    cmds = {
        "backend": lambda: {"backend": backend()},
        **{
            c: globals()[f]
            for c, f in (
                ("status", "status"),
                ("ensure", "ensure"),
                ("list-panes", "list_panes"),
                ("agents", "agents"),
            )
        },
    }
    if len(argv) != 2 or argv[1] not in cmds:
        sys.stderr.write(
            "usage: atlas_seats.py backend|status|ensure|list-panes|agents\n"
        )
        return 2
    out = cmds[argv[1]]()
    print(json.dumps(out, indent=2))
    return 0 if not isinstance(out, dict) or out.get("ok", True) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
