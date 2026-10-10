#!/usr/bin/env python3
"""Atlas colony runtime: single-instance manager for the vendored herdr-web-ui, plus the herdr socket client
that creates/closes worker panes (the colony transport, replacing tmux).

HARD RULE: there is only ever ONE vendored herdr-web-ui (the colony). Every caller goes through
``ensure()``, which reuses a live vendored instance and spawns only when none exists,
serialised across processes by an exclusive flock on ``$ATLAS_HOME/herdr-web.lock``.
A user-run UPSTREAM herdr-web-ui holding the port is never reused or touched: ``ensure()`` starts the vendored
build on a free fallback port (17317/27317/37317/47317, explicit PORT + its own state dir under
``$ATLAS_HOME/colony/state``), records it in ``$ATLAS_HOME/colony/port``, and ``status()`` reports
``upstream_plugin_on_port`` with the exact ``takeover`` commands.

The web UI runs from the VENDORED source ``plugins/atlas/colony/herdr-web-ui``. That tree is never written to:
the first ``ensure()`` mirrors it to ``$ATLAS_HOME/colony/herdr-web-ui`` and runs
``bun install --frozen-lockfile`` + ``bun run build`` there (re-done when the vendored package.json/bun.lock change).
herdr core is a pinned *binary* (``plugins/atlas/colony/herdr/PIN.json``): ``install-check`` fails with an
actionable message when the installed herdr is older than the pin.

* CLI: ``python3 atlas_herdr.py status|ensure|reap|install-check|create-pane|prompt|close-pane`` (prints JSON).
* ``create-pane --name N --cwd D [--run R] [--env K=V ...] -- <command...>`` opens one worker pane.
* ``prompt --pane ID --text TEXT [--root]`` sends text to an idle agent pane.
* ``close-pane --pane ID [--root]`` closes one colony pane.

Stdlib only. Loopback only.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote, urlparse

ATLAS_PLUGIN = Path(__file__).resolve().parent.parent
COLONY_SRC = ATLAS_PLUGIN / "colony" / "herdr-web-ui"  # vendored, read-only
PIN_FILE = ATLAS_PLUGIN / "colony" / "herdr" / "PIN.json"


def _home() -> Path:
    return Path(os.environ.get("ATLAS_HOME") or Path.home() / ".atlas")


def _colony_dir() -> Path:
    return _home() / "colony"


# The runnable copy of the vendored tree (source + node_modules + dist). Never inside the plugin tree.
PLUGIN_ROOT = Path(
    os.environ.get("HERDR_WEB_PLUGIN_ROOT") or _colony_dir() / "herdr-web-ui"
)
_SCRIPT_RX = re.compile(
    r"/[^/]*herdr-web-ui[^/]*/(?:.*/)?server/(managed|supervisor)\.ts$"
)
LOCK_WAIT_S = 240.0  # > install+build+spawn+health, so a queued caller sees the result
SPAWN_TIMEOUT_S = 30
BUILD_TIMEOUT_S = 180
HEALTH_WAIT_S = 20.0
DEFAULT_PORT = 7317
# herdr-web-ui's own fallbacks (scripts/plugin-port.ts), tried in order when 7317 belongs to someone else.
FALLBACK_PORTS = (17317, 27317, 37317, 47317)


def _port_file() -> Path:
    """$ATLAS_HOME/colony/port: the port the VENDORED build was started on (absent while it owns 7317)."""
    return _colony_dir() / "port"


def _read_port(path: Path) -> int | None:
    try:
        port = int(path.read_text().strip())
    except (OSError, ValueError):
        return None
    return port if 0 < port < 65536 else None


def _saved_port() -> int | None:
    """The colony's own persisted port, else the fallback port herdr-web-ui settled on (plugin.ts writes
    plugin-port under HERDR_WEB_STATE_DIR when 7317 cannot be bound)."""
    own = _read_port(_port_file())
    if own:
        return own
    state = os.environ.get("HERDR_WEB_STATE_DIR") or str(
        Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
        / "herdr-web-ui"
    )
    return _read_port(Path(state) / "plugin-port")


def _url() -> str:
    """http://127.0.0.1:<port>. HERDR_WEB_URL wins (non-loopback ignored), then the saved fallback port, then 7317."""
    default = f"http://127.0.0.1:{_saved_port() or DEFAULT_PORT}"
    raw = os.environ.get("HERDR_WEB_URL")
    if not raw:
        return default
    u = urlparse(raw)
    if u.scheme != "http" or u.hostname not in ("127.0.0.1", "localhost", "::1"):
        return default
    return f"http://{u.hostname}:{u.port or DEFAULT_PORT}"


HERDR_URL = _url()


def _refresh_url() -> None:
    """Re-read the saved fallback port: a start that moved off 7317 writes it after this module was imported."""
    global HERDR_URL
    HERDR_URL = _url()


def _lock_path() -> Path:
    return (
        Path(os.environ.get("ATLAS_HOME") or Path.home() / ".atlas") / "herdr-web.lock"
    )


# --- hooks (tests replace these) ----------------------------------------------


def _fetch(url: str, timeout: float = 2):
    """(status, content-type, body bytes) or None when nothing answers. HTTP errors are answers."""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, r.headers.get("Content-Type", ""), r.read(65536)
    except urllib.error.HTTPError as e:
        with e:
            return e.code, e.headers.get("Content-Type", ""), e.read(65536)
    except Exception:
        return None


def _health_info(base: str | None = None) -> dict | None:
    """Parsed /api/health of the web UI, or None when it is unreachable/unhealthy."""
    try:
        with urllib.request.urlopen(
            (base or HERDR_URL) + "/api/health", timeout=2
        ) as r:
            d = json.load(r)
        return d if isinstance(d, dict) and d.get("ok") else None
    except Exception:
        return None


def _is_vendored(base: str | None = None) -> bool:
    """True when the listener at `base` is the VENDORED build. Only it serves the /atlas/** gateway: with auth
    on it answers 401 JSON {error}, with auth off atlas JSON. The upstream plugin falls through to its SPA
    (text/html) or 404, so it is never mistaken for the colony."""
    got = _fetch((base or HERDR_URL) + "/atlas/api/health")
    if got is None:
        return False
    status, ctype, _ = got
    return "json" in ctype.lower() and status in (200, 401, 403, 502, 503)


def _health() -> bool:
    return _health_info() is not None


def _free_port() -> int | None:
    """First fallback port nothing is listening on (loopback)."""
    for p in FALLBACK_PORTS:
        with socket.socket() as s:
            s.settimeout(0.3)
            if s.connect_ex(("127.0.0.1", p)) != 0:
                return p
    return None


# --- herdr server socket (read-only client + prompt) ---------------------------
# One request per connection: the server answers one newline-delimited JSON line, then closes.


class HerdrSockError(Exception):
    """reason: socket_missing | connect_failed | timeout | malformed | rpc_error | io_error."""

    def __init__(self, reason: str, detail: str = ""):
        super().__init__(f"{reason}: {detail}" if detail else reason)
        self.reason = reason
        self.detail = detail


def _sock_path() -> str:
    return os.environ.get("HERDR_SOCKET_PATH") or str(
        Path.home() / ".config/herdr/herdr.sock"
    )


def rpc(method: str, params: dict | None = None, timeout: float = 0.5) -> dict:
    """Call one herdr socket method; returns the `result` object or raises HerdrSockError."""
    path = _sock_path()
    if not os.path.exists(path):
        raise HerdrSockError("socket_missing", path)
    deadline = time.monotonic() + timeout
    req = json.dumps({"id": "atlas", "method": method, "params": params or {}}) + "\n"
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        s.settimeout(timeout)
        try:
            s.connect(path)
            s.sendall(req.encode())
            buf = b""
            while b"\n" not in buf:
                left = deadline - time.monotonic()
                if left <= 0:
                    raise socket.timeout()
                s.settimeout(left)
                chunk = s.recv(65536)
                if not chunk:
                    break
                buf += chunk
        except socket.timeout:
            raise HerdrSockError("timeout", method) from None
        except OSError as e:
            raise HerdrSockError("connect_failed", f"{type(e).__name__}: {e}") from None
    finally:
        s.close()
    try:
        msg = json.loads(buf.split(b"\n", 1)[0])
    except ValueError:
        raise HerdrSockError("malformed", method) from None
    if not isinstance(msg, dict):
        raise HerdrSockError("malformed", method)
    if msg.get("error"):
        e = msg["error"]
        raise HerdrSockError(
            "rpc_error", str(e.get("message", e)) if isinstance(e, dict) else str(e)
        )
    res = msg.get("result")
    if not isinstance(res, dict):
        raise HerdrSockError("malformed", method)
    return res


def _agent_row(a: dict, labels: dict, web: str) -> dict:
    pane = str(a.get("pane_id") or "")
    ws = str(a.get("workspace_id") or "")
    return {
        "pane_id": pane,
        "workspace_id": ws,
        "workspace": labels.get(ws, ""),
        "tab_id": a.get("tab_id"),
        "agent": a.get("agent") or "unknown",
        "status": a.get("agent_status") or "unknown",
        "cwd": a.get("cwd") or "",
        "title": a.get("terminal_title_stripped") or a.get("terminal_title") or "",
        "focused": bool(a.get("focused")),
        "state_change_seq": a.get("state_change_seq"),
        "completion_seq": a.get("completion_seq"),
        "deep_link": f"{web}/?pane={quote(pane)}&machine=local",
    }


def agents() -> dict:
    """Never raises. {reachable, reason, workspaces, agents}; agent session paths are not exposed."""
    try:
        al = rpc("agent.list").get("agents")
        if not isinstance(al, list):
            raise HerdrSockError("malformed", "agent.list")
        try:  # workspace labels are decoration: lose them, not the agents
            ws = rpc("workspace.list").get("workspaces")
            ws = ws if isinstance(ws, list) else []
        except HerdrSockError:
            ws = []
    except HerdrSockError as e:
        return {"reachable": False, "reason": e.reason, "workspaces": [], "agents": []}
    ws = [w for w in ws if isinstance(w, dict)]
    labels = {str(w.get("workspace_id")): str(w.get("label") or "") for w in ws}
    rows = [
        _agent_row(a, labels, HERDR_URL)
        for a in al
        if isinstance(a, dict) and a.get("pane_id")
    ]
    return {
        "reachable": True,
        "reason": None,
        "workspaces": [
            {
                "workspace_id": w.get("workspace_id"),
                "label": w.get("label"),
                "focused": bool(w.get("focused")),
                "agent_status": w.get("agent_status"),
                "pane_count": w.get("pane_count"),
            }
            for w in ws
        ],
        "agents": rows,
    }


class PromptRefused(Exception):
    def __init__(self, http: int, error: str, why: str = ""):
        super().__init__(error)
        self.http, self.error, self.why = http, error, why


PROMPT_MAX = 8000
# herdr pane ids are "<workspace>:<pane>" (e.g. wB:p1); same charset herdr's own HTTP route allows.
PANE_ID_RX = re.compile(r"[A-Za-z0-9:_.\-]{1,64}")
PROMPT_CLI_MAX = 2000


def send_prompt(pane_id, text) -> dict:
    """Send text to an idle agent over the socket. The pane id must be in the live agent list;
    nothing is passed to a shell. Raises PromptRefused (4xx/503) or returns the herdr result."""
    if not isinstance(text, str) or not text.strip():
        raise PromptRefused(400, "text is required")
    if len(text) > PROMPT_MAX:
        raise PromptRefused(400, f"text longer than {PROMPT_MAX} characters")
    live = agents()
    if not live["reachable"]:
        raise PromptRefused(503, "herdr server is not reachable", live["reason"])
    row = next((a for a in live["agents"] if a["pane_id"] == pane_id), None)
    if row is None:
        raise PromptRefused(404, "no such agent pane")
    if row["status"] != "idle":
        raise PromptRefused(
            409,
            "agent is not idle",
            f"status is {row['status']}; only idle agents accept prompts",
        )
    try:
        return rpc("agent.prompt", {"target": pane_id, "text": text}, timeout=5.0)
    except HerdrSockError as e:
        raise PromptRefused(502, "herdr rejected the prompt", str(e)) from None


def _server_up() -> bool:
    try:
        rpc("ping")
        return True
    except HerdrSockError:
        return False


def _classify(command: str) -> str | None:
    """'managed'/'supervisor' iff argv[0] is bun/node and argv[1] is the plugin's server script.

    Shells/wrappers whose text merely mentions the script do not match.
    ponytail: split on whitespace, so a plugin path containing spaces is not detected.
    """
    argv = command.split()
    if len(argv) < 2 or Path(argv[0]).name not in ("bun", "node"):
        return None
    m = _SCRIPT_RX.search(argv[1])
    return m.group(1) if m else None


def _procs(owned: bool = False) -> list[tuple[int, int, str, str]]:
    """[(pid, ppid, kind, etime)] for real bun/node managed.ts / supervisor.ts processes.

    owned=True keeps only this colony's (script under PLUGIN_ROOT): an upstream herdr-web-ui the user runs
    is none of atlas's business, and must never be waited on, counted as a duplicate, or reaped."""
    try:
        out = subprocess.run(
            ["ps", "-axo", "pid=,ppid=,etime=,command="],
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout
    except Exception:
        return []
    rows = []
    me = os.getpid()
    root = str(PLUGIN_ROOT).rstrip("/") + "/"
    for line in out.splitlines():
        parts = line.split(None, 3)
        if len(parts) < 4 or int(parts[0]) == me:
            continue
        kind = _classify(parts[3])
        if not kind:
            continue
        if owned and not parts[3].split()[1].startswith(root):
            continue
        rows.append((int(parts[0]), int(parts[1]), kind, parts[2]))
    return rows


def _bun() -> str | None:
    bun = shutil.which("bun") or str(Path.home() / ".bun/bin/bun")
    return bun if Path(bun).exists() else None


_STAMP_SKIP = {"node_modules", "dist", ".git", "evidence", ".DS_Store", ".atlas-build"}


def _stamp() -> str:
    """Hash of the whole vendored tree (sorted relative paths + bytes, minus build output/VCS/evidence):
    any edit to src/, server/, public/, package.json, bun.lock, patches/, scripts/ or UPSTREAM.md changes it."""
    h = hashlib.sha256()
    for dirpath, dirs, files in os.walk(COLONY_SRC):
        dirs[:] = sorted(d for d in dirs if d not in _STAMP_SKIP)
        for name in sorted(files):
            if name in _STAMP_SKIP:
                continue
            p = Path(dirpath, name)
            h.update(p.relative_to(COLONY_SRC).as_posix().encode() + b"\0")
            try:
                with p.open("rb") as f:
                    while chunk := f.read(1 << 20):
                        h.update(chunk)
            except OSError:
                h.update(b"-")
            h.update(b"\0")
    return h.hexdigest()[:16]


def _run(argv: list[str], cwd: Path, timeout: float) -> tuple[bool, str]:
    try:
        r = subprocess.run(
            argv,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=timeout,
            stdin=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired:
        return False, f"{' '.join(argv[:3])} timed out after {timeout:.0f}s"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"
    return r.returncode == 0, (r.stderr or r.stdout).strip()[-300:]


def _prepare() -> tuple[bool, str]:
    """Mirror the vendored source to PLUGIN_ROOT, then `bun install --frozen-lockfile` + `bun run build`.

    Idempotent: a stamp file (hash of the whole vendored tree) records the last good build, and a
    missing node_modules/dist also forces a rebuild. Runs under the ensure() lock. Never writes in the plugin tree.
    """
    bun = _bun()
    if not bun:
        return False, "bun is not installed"
    stamp, mark = _stamp(), PLUGIN_ROOT / ".atlas-build"
    try:
        fresh = (
            mark.read_text().strip() == stamp
            and (PLUGIN_ROOT / "node_modules").is_dir()
            and (PLUGIN_ROOT / "dist" / "index.html").is_file()
        )
    except OSError:
        fresh = False
    if fresh:
        return True, "built"
    if not (COLONY_SRC / "scripts" / "plugin.ts").is_file():
        return False, f"vendored herdr-web-ui is missing at {COLONY_SRC}"
    PLUGIN_ROOT.mkdir(parents=True, exist_ok=True)
    # source mirror only: node_modules/dist/state stay put so a re-sync does not redo the install
    ok, out = _run(
        [
            "rsync",
            "-a",
            "--delete",
            "--exclude=node_modules",
            "--exclude=dist",
            "--exclude=.atlas-build",
            f"{COLONY_SRC}/",
            f"{PLUGIN_ROOT}/",
        ],
        PLUGIN_ROOT,
        60,
    )
    if not ok:
        return False, f"mirror failed: {out}"
    for argv in (
        [bun, "install", "--frozen-lockfile"],
        [bun, "run", "build"],
    ):
        ok, out = _run(argv, PLUGIN_ROOT, BUILD_TIMEOUT_S)
        if not ok:
            return False, f"`{' '.join(argv[1:])}` failed: {out}"
    mark.write_text(stamp + "\n")
    return True, "built"


def _plugin_cmd(verb: str, port: int | None = None) -> tuple[bool, str]:
    """Run `bun scripts/plugin.ts <verb>` in the vendored mirror. `port` is an explicit PORT (plugin.ts never swaps
    one) plus a state dir of its own, used when something else holds 7317 so the two instances never share
    pid/token/app state. start and stop use the same cwd + HERDR_PLUGIN_* env, so stop only reaches OUR instance."""
    bun = _bun()
    if not bun:
        return False, "bun is not installed"
    state = _colony_dir() / "state"
    state.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, HERDR_PLUGIN_ROOT=str(PLUGIN_ROOT))
    env.setdefault("HERDR_PLUGIN_STATE_DIR", str(state))
    if port is not None:
        env["PORT"] = str(port)
        env["HERDR_WEB_STATE_DIR"] = str(state / "app")
        env.pop("HERDR_WEB_URL", None)
    try:
        r = subprocess.run(
            [bun, "scripts/plugin.ts", verb],
            cwd=str(PLUGIN_ROOT),
            capture_output=True,
            text=True,
            timeout=SPAWN_TIMEOUT_S,
            stdin=subprocess.DEVNULL,
            env=env,
        )
    except subprocess.TimeoutExpired:
        return False, f"plugin {verb} timed out after {SPAWN_TIMEOUT_S}s"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"
    return r.returncode == 0, (r.stderr or r.stdout).strip()[-300:]


def _spawn(port: int | None = None) -> tuple[bool, str]:
    """Start the vendored build (see _plugin_cmd for `port`)."""
    return _plugin_cmd("start", port)


def _stop(port: int | None = None) -> tuple[bool, str]:
    """Stop the vendored build only (plugin.ts stop in the mirror cwd, same env as _spawn)."""
    return _plugin_cmd("stop", port)


def _mirror_stale() -> bool:
    """True when the built mirror's stamp differs from the vendored tree's (or is unreadable)."""
    try:
        return (PLUGIN_ROOT / ".atlas-build").read_text().strip() != _stamp()
    except OSError:
        return True


# --- pinned herdr binary ------------------------------------------------------


def _pin() -> dict:
    try:
        d = json.loads(PIN_FILE.read_text())
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def _vtuple(v: str) -> tuple[int, ...]:
    m = re.match(r"v?(\d+(?:\.\d+)*)", str(v or "").strip())
    return tuple(int(x) for x in m.group(1).split(".")) if m else ()


def _herdr_bin() -> str | None:
    return shutil.which("herdr") or (
        str(Path.home() / ".local/bin/herdr")
        if (Path.home() / ".local/bin/herdr").exists()
        else None
    )


def _herdr_version() -> str | None:
    """`herdr --version` -> '0.9.3', or None when herdr is not installed/runnable."""
    exe = _herdr_bin()
    if not exe:
        return None
    try:
        out = subprocess.run(
            [exe, "--version"], capture_output=True, text=True, timeout=5
        ).stdout
    except Exception:
        return None
    m = re.search(r"\d+(?:\.\d+)+", out)
    return m.group(0) if m else None


def install_check() -> dict:
    """Is the installed herdr at least the pinned version? Read-only. ok:false carries `why` + `do`."""
    pin = _pin()
    want = str(pin.get("version") or "")
    url = pin.get("install_url") or "https://herdr.dev"
    have = _herdr_version()
    out = {"ok": True, "installed": have, "pinned": want, "sha": pin.get("sha")}
    if not want:
        return {
            **out,
            "ok": False,
            "why": f"no herdr pin at {PIN_FILE}",
            "do": "restore plugins/atlas/colony/herdr/PIN.json",
        }
    if have is None:
        return {
            **out,
            "ok": False,
            "why": "herdr is not installed",
            "do": f"install herdr >= {want} from {url}",
        }
    if _vtuple(have) < _vtuple(want):
        return {
            **out,
            "ok": False,
            "why": f"installed herdr {have} is older than the pinned {want}",
            "do": f"upgrade herdr to >= {want} ({url}), then retry",
        }
    return out


# --- worker panes (the colony transport) --------------------------------------
# herdr socket methods (verified against `herdr api schema --json`, protocol 22): workspace.create /
# tab.create / pane.split / pane.close / pane.list / pane.send_input. There is no pane.run method:
# the CLI's `pane run` is pane.send_input with text + the `enter` key.


def colony_label(run: str) -> str:
    return f"atlas-{run}"


def _ok(**kw) -> dict:
    return {"ok": True, **kw}


def _err(reason: str, **kw) -> dict:
    return {"ok": False, "reason": reason, **kw}


def _find_workspace(label: str) -> str | None:
    for w in rpc("workspace.list").get("workspaces") or []:
        if isinstance(w, dict) and w.get("label") == label:
            return str(w.get("workspace_id"))
    return None


def list_panes(run: str | None = None) -> list[dict]:
    """[{pane_id, workspace_id, tab_id, label}] of the colony's panes (one workspace per run), [] when none."""
    label = colony_label(run) if run else None
    wss = [
        w
        for w in rpc("workspace.list").get("workspaces") or []
        if isinstance(w, dict)
        and str(w.get("label") or "").startswith("atlas-")
        and (label is None or w.get("label") == label)
    ]
    out = []
    for w in wss:
        for p in (
            rpc("pane.list", {"workspace_id": w.get("workspace_id")}).get("panes") or []
        ):
            if isinstance(p, dict) and p.get("pane_id"):
                out.append(
                    {
                        "pane_id": str(p["pane_id"]),
                        "workspace_id": str(w.get("workspace_id")),
                        "workspace": str(w.get("label")),
                        "tab_id": p.get("tab_id"),
                        "label": p.get("label") or "",
                    }
                )
    return out


def create_pane(
    name: str,
    command: str,
    *,
    cwd: str,
    run: str = "work",
    env: dict | None = None,
    focus: bool = False,
) -> dict:
    """Open one worker pane named `name` in the colony workspace `atlas-<run>` and run `command` in it.

    The first worker of a run creates the workspace (its root pane runs the command); later workers each get
    their own tab. `env` is set on the pane's shell by herdr; the caller still wraps `command` with `env K=V`
    so the pins survive a shell that resets them. Returns {ok, pane_id, workspace_id, tab_id, name, run} or
    {ok:false, reason}. Never raises."""
    env = {str(k): str(v) for k, v in (env or {}).items()}
    label = colony_label(run)
    try:
        if any(p["label"] == name for p in list_panes(run)):
            return _err(f"name_taken: {name} already runs in {label}")
        ws = _find_workspace(label)
        if ws is None:
            res = rpc(
                "workspace.create",
                {"cwd": cwd, "env": env, "label": label, "focus": focus},
                timeout=10.0,
            )
            ws = str((res.get("workspace") or {}).get("workspace_id"))
            tab = res.get("tab") or {}
            pane = res.get("root_pane") or {}
        else:
            res = rpc(
                "tab.create",
                {
                    "workspace_id": ws,
                    "cwd": cwd,
                    "env": env,
                    "label": name,
                    "focus": focus,
                },
                timeout=10.0,
            )
            tab = res.get("tab") or {}
            pane = res.get("root_pane") or {}
        pane_id = str(pane.get("pane_id") or "")
        if not pane_id:
            return _err("herdr returned no pane id", detail=str(res)[:200])
        rpc("pane.rename", {"pane_id": pane_id, "label": name})
        rpc(
            "pane.send_input",
            {"pane_id": pane_id, "text": command, "keys": ["enter"]},
            timeout=5.0,
        )
        return _ok(
            pane_id=pane_id,
            workspace_id=ws,
            tab_id=tab.get("tab_id"),
            name=name,
            run=run,
        )
    except HerdrSockError as e:
        return _err(f"herdr {e.reason}: {e.detail}".strip(": "))
    except Exception as e:  # contract: never raises
        return _err(f"{type(e).__name__}: {e}")


def close_pane(pane_id: str) -> dict:
    """Close one pane (kills its process). The id must be one of the colony's panes. Never raises."""
    try:
        if not any(p["pane_id"] == pane_id for p in list_panes()):
            return _err("no such colony pane")
        rpc("pane.close", {"pane_id": pane_id}, timeout=5.0)
        return _ok(pane_id=pane_id)
    except HerdrSockError as e:
        return _err(f"herdr {e.reason}: {e.detail}".strip(": "))


def close_run(run: str) -> dict:
    """Close every pane of a run's workspace. {ok, closed:[names], panes:[ids]}. Never raises."""
    try:
        ws = _find_workspace(colony_label(run))
        if ws is None:
            return _ok(closed=[], panes=[])
        panes = list_panes(run)
        rpc("workspace.close", {"workspace_id": ws}, timeout=5.0)
        return _ok(
            closed=[p["label"] for p in panes], panes=[p["pane_id"] for p in panes]
        )
    except HerdrSockError as e:
        return _err(f"herdr {e.reason}: {e.detail}".strip(": "))


def pane_live(pane_id: str) -> bool:
    """True when the pane still exists in herdr (a dead process closes its pane unless remain-on-exit)."""
    try:
        rpc("pane.get", {"pane_id": pane_id})
        return True
    except HerdrSockError:
        return False


def _wait_health(seconds: float) -> bool:
    end = time.monotonic() + seconds
    while True:
        if _health():
            return True
        if time.monotonic() >= end:
            return False
        time.sleep(0.25)


# --- public API ---------------------------------------------------------------


def _managed() -> list[tuple[int, int, str, str]]:
    """This colony's own managed.ts processes (never the user's upstream herdr-web-ui)."""
    return [p for p in _procs(owned=True) if p[2] == "managed"]


# herdr refuses every action on a disabled plugin (`stop` -> plugin_disabled; verified), so stop BEFORE disable.
TAKEOVER_NOTE = (
    "stop first, then disable: once devswha.herdr-web-ui is disabled `herdr plugin action invoke stop` fails with "
    "plugin_disabled; fallback is the plugin's own `bun scripts/plugin.ts stop` with HERDR_PLUGIN_ROOT/"
    "HERDR_PLUGIN_STATE_DIR/HERDR_PLUGIN_CONFIG_DIR set"
)


def takeover_hint(upstream_url: str) -> list[str]:
    """Exact user commands that let the vendored build own the configured port (never run by atlas).
    Syntax per `herdr plugin disable --help` (`<PLUGIN_ID>`) and `herdr plugin action invoke --help`
    (`<ACTION_ID> --plugin <ID>`; the upstream plugin ships a `stop` action). ORDER MATTERS: see TAKEOVER_NOTE."""
    return [
        f"herdr plugin action invoke stop --plugin devswha.herdr-web-ui   # 1: stops the instance holding {upstream_url} (while still enabled)",
        "herdr plugin disable devswha.herdr-web-ui   # 2: no restart with herdr (id from `herdr plugin list`)",
        f"rm -f {_port_file()}   # forget the fallback port",
        "python3 plugins/atlas/scripts/atlas_herdr.py ensure   # starts the vendored build on 7317",
        "python3 plugins/atlas/scripts/atlas_remote.py apply --yes --replace   # re-point the :8443 tailscale mapping",
    ]


def _probe(base: str) -> str:
    """Who answers at `base`: 'colony' (vendored build), 'upstream' (a healthy herdr-web-ui without the /atlas
    gateway) or 'none'."""
    if (
        base == HERDR_URL
    ):  # the hook tests (and the 2s status cache) go through _health()
        healthy = _health()
    else:
        healthy = _health_info(base) is not None
    if not healthy:
        return "none"
    return "colony" if _is_vendored(base) else "upstream"


def _find_colony() -> str | None:
    """URL of a running VENDORED build on one of the fallback ports (read-only scan), else None."""
    for p in FALLBACK_PORTS:
        base = f"http://127.0.0.1:{p}"
        if _probe(base) == "colony":
            return base
    return None


def _where() -> tuple[str, str, str | None]:
    """(who, colony_url, upstream_url). `who` is 'colony' | 'upstream' | 'none' for the colony URL's listener.

    When an upstream herdr-web-ui holds the configured port, the colony is looked for on its fallback ports;
    if none runs, colony_url is the first free fallback it would be started on."""
    who = _probe(HERDR_URL)
    if who != "upstream":
        return who, HERDR_URL, None
    found = _find_colony()
    if found:
        return "colony", found, HERDR_URL
    p = _free_port()
    return "none", f"http://127.0.0.1:{p}" if p else HERDR_URL, HERDR_URL


STATUS_TTL_S = 2.0
_status_cache: tuple[float, dict] | None = None


def status() -> dict:
    """Read-only; never spawns. Cached STATUS_TTL_S so the ps fork and health probe are not per-request.

    state: ok | server_down (herdr itself is not running; atlas cannot start it) | web_ui_down.
    `healthy`/`running`/`vendored_running` mean the VENDORED colony answers at colony_url. A healthy upstream
    herdr-web-ui holding the configured port is reported as upstream_plugin_on_port (+ `takeover`), never as the
    colony; ensure() then starts the vendored build on a fallback port.
    """
    global _status_cache
    now = time.monotonic()
    if _status_cache and now - _status_cache[0] < STATUS_TTL_S:
        return dict(_status_cache[1])
    _refresh_url()
    managed = _managed()
    who, colony_url, upstream_url = _where()
    healthy = who == "colony"
    info = _health_info(colony_url) if healthy else None
    server_up = _server_up()
    herdr = {}
    if server_up:
        try:
            herdr = rpc("ping")
        except HerdrSockError:
            herdr = {}
    pin = _pin()
    out = {
        "running": healthy,
        "healthy": healthy,
        "state": "ok"
        if healthy and server_up
        else "server_down"
        if not server_up
        else "web_ui_down",
        "herdr_server": server_up,
        "herdr_version": herdr.get("version") or _herdr_version(),
        "herdr_protocol": herdr.get("protocol_version") or herdr.get("protocol"),
        "herdr_pinned": pin.get("version"),
        "auth_required": bool(((info or {}).get("auth") or {}).get("required")),
        "url": colony_url,
        "colony_url": colony_url,
        "vendored_running": healthy,
        "upstream_plugin_on_port": upstream_url is not None,
        "pids": [p[0] for p in managed],
        "duplicates": max(0, len(managed) - 1),
        "installed": (PLUGIN_ROOT / "scripts" / "plugin.ts").is_file(),
        "vendored": (COLONY_SRC / "scripts" / "plugin.ts").is_file(),
        "plugin_root": str(PLUGIN_ROOT),
    }
    if upstream_url:
        out["upstream_url"] = upstream_url
        out["takeover"] = takeover_hint(upstream_url)
        out["takeover_note"] = TAKEOVER_NOTE
    _status_cache = (now, out)
    return dict(out)


def _unavailable(why: str, do: str) -> dict:
    return {
        "ok": False,
        "action": "unavailable",
        "url": HERDR_URL,
        "why": why,
        "do": do,
    }


def _acquire(path: Path):
    """Exclusive flock with bounded wait; returns the open file or None."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        f = path.open("a+")
    except OSError:
        return None
    end = time.monotonic() + LOCK_WAIT_S
    while True:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return f
        except OSError:
            if time.monotonic() >= end:
                f.close()
                return None
            time.sleep(0.1)


def _result(action: str, colony_url: str, upstream_url: str | None) -> dict:
    out = {"ok": True, "action": action, "url": colony_url, "colony_url": colony_url}
    if upstream_url:
        out["upstream_plugin_on_port"] = True
        out["upstream_url"] = upstream_url
        out["takeover"] = takeover_hint(upstream_url)
        out["takeover_note"] = TAKEOVER_NOTE
    return out


def _record_port(port: int) -> None:
    """Persist the port the vendored build runs on (read back by _url() in every process)."""
    f = _port_file()
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(f"{port}\n")
    _refresh_url()


def _restart_stale(colony_url: str, upstream_url: str | None) -> dict:
    """Running vendored server + stale mirror (caller holds the lock): build FIRST (server keeps serving), then
    stop + start only our own instance on the port it already uses. A failed build leaves the server untouched."""
    if _bun() is None:
        return _unavailable(
            "bun is not installed", "install bun (https://bun.sh), then retry"
        )
    ok, detail = _prepare()
    if not ok:
        return _unavailable(
            f"herdr-web-ui mirror is stale and could not be rebuilt ({detail}); the running server was left as is",
            f"run `bun install --frozen-lockfile && bun run build` in {PLUGIN_ROOT}, then retry",
        )
    # only a colony living off the configured URL (fallback port beside an upstream) needs explicit PORT + state dir
    port = urlparse(colony_url).port if colony_url != HERDR_URL else None
    ok, detail = _stop(port)
    if not ok:
        return _unavailable(
            f"could not stop the stale herdr-web-ui ({detail or 'no output'})",
            "run `bun scripts/plugin.ts stop` in the plugin root, then retry",
        )
    ok, detail = _spawn(port)
    if _wait_health(HEALTH_WAIT_S):
        out = _result("restarted", _where()[1], upstream_url)
        out["reason"] = "stale_mirror"
        return out
    return _unavailable(
        f"herdr-web-ui did not become healthy after the stale-mirror restart ({detail or 'no output'})",
        "run `bun scripts/plugin.ts status` in the plugin root and check server.log",
    )


def ensure() -> dict:
    """Reuse the running VENDORED colony; spawn only when none exists. Never raises.

    A healthy herdr-web-ui that is not the vendored build (the upstream plugin) holding the configured port is
    left alone: the vendored build is started under the lock on a free fallback port, which is recorded in
    $ATLAS_HOME/colony/port, and the result carries upstream_plugin_on_port + the user's `takeover` commands."""
    try:
        _refresh_url()
        who, colony_url, upstream_url = _where()
        if (
            who == "colony" and not _mirror_stale()
        ):  # fast path, no lock: nothing to spawn or rebuild
            return _result("reused", colony_url, upstream_url)
        chk = install_check()
        if not chk["ok"]:
            return _unavailable(chk["why"], chk["do"])
        if not _server_up():  # the web UI health 502s without it; spawning cannot help
            return _unavailable(
                "the herdr server is not running (Atlas cannot start herdr itself)",
                "start herdr in a terminal (run `herdr`), then recheck",
            )
        lock = _acquire(_lock_path())
        if lock is None:
            return _unavailable(
                "another process holds the herdr launch lock",
                f"retry shortly; lock: {_lock_path()}",
            )
        try:
            _refresh_url()
            who, colony_url, upstream_url = _where()
            if who == "colony":  # a lock holder before us may have started it
                if (
                    _mirror_stale()
                ):  # healthy but built from an older tree: rebuild, restart ours only
                    return _restart_stale(colony_url, upstream_url)
                return _result("reused", colony_url, upstream_url)
            if _managed():  # starting up (or wedged): wait, never spawn a second
                if _wait_health(HEALTH_WAIT_S):
                    return _result("waited", _where()[1], upstream_url)
                return _unavailable(
                    f"a herdr-web-ui process exists but not healthy after {HEALTH_WAIT_S:.0f}s",
                    "run `python3 atlas_herdr.py reap`, or check the plugin server.log",
                )
            port = None
            if (
                upstream_url
            ):  # never touch the upstream instance: take a free fallback port
                port = _free_port()
                if port is None:
                    return _unavailable(
                        f"an upstream herdr-web-ui holds {upstream_url} and every fallback port "
                        f"{', '.join(map(str, FALLBACK_PORTS))} is busy",
                        "free one of those ports, or stop the upstream plugin: "
                        + "; ".join(takeover_hint(upstream_url)[:2]),
                    )
            if _bun() is None:
                return _unavailable(
                    "bun is not installed", "install bun (https://bun.sh), then retry"
                )
            ok, detail = _prepare()
            if not ok:
                return _unavailable(
                    f"herdr-web-ui could not be built ({detail})",
                    f"run `bun install --frozen-lockfile && bun run build` in {PLUGIN_ROOT}, then retry",
                )
            if port is None:
                ok, detail = _spawn()
            else:
                _record_port(
                    port
                )  # the health wait below (and every other process) must look at this port
                ok, detail = _spawn(port)
            if _wait_health(HEALTH_WAIT_S):
                return _result("started", HERDR_URL, upstream_url)
            if (
                port is not None
            ):  # a failed start must not leave status pointing at a dead port
                _port_file().unlink(missing_ok=True)
                _refresh_url()
            return _unavailable(
                f"herdr-web-ui did not become healthy ({detail or 'no output'})",
                "run `bun scripts/plugin.ts status` in the plugin root and check server.log",
            )
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
            lock.close()
    except Exception as e:  # contract: never raises
        return _unavailable(
            f"{type(e).__name__}: {e}",
            "retry; if it persists check atlas_herdr.py status",
        )


def _etime_s(s: str) -> int:
    """ps etime [[dd-]hh:]mm:ss -> seconds (0 when unparsable)."""
    try:
        days, _, rest = s.rpartition("-")
        p = [int(x) for x in rest.split(":")]
    except ValueError:
        return 0
    p = [0] * (3 - len(p)) + p
    return int(days or 0) * 86400 + p[0] * 3600 + p[1] * 60 + p[2]


def reap() -> dict:
    """Kill duplicate managed.ts trees of THIS colony, keeping the OLDEST. CLI only; never the user's upstream."""
    procs = _procs(owned=True)
    managed = sorted(
        (p for p in procs if p[2] == "managed"), key=lambda p: -_etime_s(p[3])
    )
    if len(managed) <= 1:
        return {"ok": True, "kept": [p[0] for p in managed], "killed": []}
    keep, extras = managed[0], managed[1:]
    doomed = {p[0] for p in extras}
    # supervisors parented to a doomed managed.ts go with it
    doomed |= {p[0] for p in procs if p[2] == "supervisor" and p[1] in doomed}
    killed = []
    for pid in sorted(doomed):
        try:
            os.kill(pid, signal.SIGTERM)
            killed.append(pid)
        except ProcessLookupError:
            pass
        except PermissionError:
            pass
    return {"ok": True, "kept": [keep[0]], "killed": killed}


def _create_pane_cli(argv: list[str]) -> dict:
    """create-pane --name N [--cwd D] [--run R] [--env K=V ...] -- <command...>"""
    flags, cmd = argv, []
    if "--" in argv:
        i = argv.index("--")
        flags, cmd = argv[:i], argv[i + 1 :]
    opts: dict = {"env": {}}
    it = iter(flags)
    for a in it:
        if a in ("--name", "--cwd", "--run"):
            opts[a[2:]] = next(it, "")
        elif a == "--env":
            k, _, v = next(it, "").partition("=")
            if k:
                opts["env"][k] = v
        else:
            return _err(f"unknown option {a!r}")
    if not opts.get("name") or not cmd:
        return _err(
            "usage: create-pane --name N [--cwd D] [--run R] [--env K=V] -- <command...>"
        )
    return create_pane(
        opts["name"],
        shlex.join(cmd),
        cwd=opts.get("cwd") or os.getcwd(),
        run=opts.get("run") or "work",
        env=opts["env"],
    )


def _prompt_cli(argv: list[str]) -> dict:
    """CLI for send_prompt. --root is accepted for parity with sibling atlas scripts and ignored:
    the colony is per-user ($ATLAS_HOME), not per-repo."""
    pane = text = None
    it = iter(argv)
    for a in it:
        if a == "--pane":
            pane = next(it, "")
        elif a == "--text":
            text = next(it, "")
        elif a == "--root":
            next(it, "")
        else:
            return _err(f"unknown option {a!r}")
    if not pane or text is None:
        return _err("usage: prompt --pane ID --text TEXT [--root]")
    if not PANE_ID_RX.fullmatch(pane):
        return _err(f"invalid pane id {pane!r}")
    if len(text) > PROMPT_CLI_MAX:
        return _err(f"text longer than {PROMPT_CLI_MAX} characters")
    try:
        res = send_prompt(pane, text)
    except PromptRefused as e:
        why = f" ({e.why})" if e.why else ""
        return _err(f"prompt refused ({e.http}): {e.error}{why}")
    return _ok(pane_id=pane, result=res)


def _close_pane_cli(argv: list[str]) -> dict:
    """CLI for close_pane; --root accepted and ignored (per-user colony)."""
    pane = None
    it = iter(argv)
    for a in it:
        if a == "--pane":
            pane = next(it, "")
        elif a == "--root":
            next(it, "")
        else:
            return _err(f"unknown option {a!r}")
    if not pane:
        return _err("usage: close-pane --pane ID [--root]")
    if not PANE_ID_RX.fullmatch(pane):
        return _err(f"invalid pane id {pane!r}")
    return close_pane(pane)


def main(argv: list[str]) -> int:
    cmds = {
        "status": status,
        "ensure": ensure,
        "reap": reap,
        "install-check": install_check,
    }
    if len(argv) >= 2 and argv[1] == "create-pane":
        out = _create_pane_cli(argv[2:])
    elif len(argv) >= 2 and argv[1] == "prompt":
        out = _prompt_cli(argv[2:])
    elif len(argv) >= 2 and argv[1] == "close-pane":
        out = _close_pane_cli(argv[2:])
    elif len(argv) != 2 or argv[1] not in cmds:
        sys.stderr.write(
            "usage: atlas_herdr.py status|ensure|reap|install-check|create-pane|prompt|close-pane\n"
        )
        return 2
    else:
        out = cmds[argv[1]]()
    print(json.dumps(out, indent=2))
    return 0 if out.get("ok", True) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
