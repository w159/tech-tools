#!/usr/bin/env python3
"""Atlas integrations: pure adapters for herdr-projects, herdr-file-viewer, tode, Captain's Deck.

Rules: every subprocess is an argv list (never a shell) with a timeout and a size cap; reads
never spawn anything that mutates; nothing here installs or configures a tool. Targets
(paths, titles, tasks) are data: they only ever land in argv elements or stdin.
Functions return plain dicts; failures are {"ok": False, "error": <code>, ...} with an
`http` hint the route layer uses as the status code.
"""

from __future__ import annotations

import glob
import fnmatch
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import tomllib
from pathlib import Path

OUT_CAP = 1 << 20
CACHE_TTL_S = 5.0
VIEWER_DEDUPE_S = 10.0
START_TIMEOUT_S = 60
READ_TIMEOUT_S = 10

PLUGIN_PROJECTS = "herdr-projects"
PLUGIN_VIEWER = "herdr-file-viewer"
PLUGIN_DECK = "herdr-firstmate-flow"  # Captain's Deck's manifest id

TOOLS = {
    "herdr-projects": {
        "install_cmd": "herdr plugin install eliasstravik/herdr-projects",
        "docs_url": "https://github.com/eliasstravik/herdr-projects",
    },
    "herdr-file-viewer": {
        "install_cmd": "herdr plugin install smarzban/herdr-file-viewer",
        "docs_url": "https://github.com/smarzban/herdr-file-viewer",
    },
    "captains-deck": {
        "install_cmd": "herdr plugin install deimantasnork/captains-deck",
        "docs_url": "https://github.com/deimantasnork/captains-deck",
    },
    "cmux-browser-mcp": {
        "install_cmd": "git clone https://github.com/jasonraz/cmux-browser-mcp && cd cmux-browser-mcp && ./install.sh",
        "docs_url": "https://github.com/jasonraz/cmux-browser-mcp",
    },
    "tode": {
        "install_cmd": "curl -fsSL https://tode.sh/install | bash",
        "docs_url": "https://tode.sh",
    },
}

_CTRL = re.compile(r"[\x00-\x1f\x7f]")
_SLUG = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$")
_PLAIN = re.compile(r"^-\s+(\S+)\s+\((.*?)\)\s+(enabled|disabled)\b", re.M)
_NEEDS = re.compile(r"(\d+)\s+need")


def err(code: str, http: int, **more) -> dict:
    return {"ok": False, "error": code, "http": http, **more}


# --- subprocess + binaries -------------------------------------------------------------------


def which(name: str) -> str | None:
    extra = os.path.join(os.path.expanduser("~"), ".local", "bin")
    found = shutil.which(name) or shutil.which(name, path=extra)
    if not found and name == "cmux":
        p = "/Applications/cmux.app/Contents/Resources/bin/cmux"
        found = p if os.access(p, os.X_OK) else None
    return found


def run(argv: list, timeout: float = READ_TIMEOUT_S, stdin: str | None = None) -> dict:
    """{ok, rc, out, err} or {ok:False, error: not_found|timeout|spawn_failed}. No shell."""
    exe = which(argv[0])
    if not exe:
        return {"ok": False, "error": "not_found"}
    try:
        p = subprocess.run(
            [exe, *argv[1:]],
            input=stdin,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "timeout"}
    except OSError as e:
        return {"ok": False, "error": "spawn_failed", "detail": str(e)}
    return {
        "ok": p.returncode == 0,
        "rc": p.returncode,
        "out": p.stdout[:OUT_CAP],
        "err": p.stderr[:4096],
    }


def _json_file(path: str):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


# --- detection ---------------------------------------------------------------------------------


def _plugins() -> dict | None:
    """plugin_id -> {version, enabled, root, name}; None when herdr cannot be asked at all.
    Order: `herdr plugin list --json`, ~/.config/herdr/plugins.json, plain `plugin list`."""

    def norm(rows) -> dict:
        out = {}
        for p in rows if isinstance(rows, list) else []:
            if isinstance(p, dict) and p.get("plugin_id"):
                out[str(p["plugin_id"])] = {
                    "version": p.get("version"),
                    "enabled": bool(p.get("enabled")),
                    "root": p.get("plugin_root"),
                    "name": p.get("name"),
                }
        return out

    r = run(["herdr", "plugin", "list", "--json"])
    if r["ok"]:
        try:
            d = json.loads(r["out"])
            rows = (d.get("result") or {}).get("plugins") if isinstance(d, dict) else d
            return norm(rows)
        except ValueError:
            pass
    d = _json_file(os.path.expanduser("~/.config/herdr/plugins.json"))
    if isinstance(d, list):
        return norm(d)
    if r.get("error") == "not_found":
        return None
    r = run(["herdr", "plugin", "list"])
    if r["ok"]:
        return {
            m[0]: {
                "version": None,
                "enabled": m[2] == "enabled",
                "root": None,
                "name": m[1],
            }
            for m in _PLAIN.findall(r["out"])
        }
    return None


def mcp_servers() -> list:
    """Registered MCP servers, read-only. Only names/sources/env KEYS are exposed; command, args
    and env values can carry secrets and are never returned."""
    home = os.path.expanduser("~")
    out = []

    def add(src: str, servers) -> None:
        for name, cfg in (servers if isinstance(servers, dict) else {}).items():
            cfg = cfg if isinstance(cfg, dict) else {}
            env = cfg.get("env") if isinstance(cfg.get("env"), dict) else {}
            out.append(
                {
                    "name": str(name),
                    "source": src,
                    "type": cfg.get("type")
                    or ("stdio" if cfg.get("command") else None),
                    "env": {str(k): "<redacted>" for k in env},
                }
            )

    d = _json_file(os.path.join(home, ".omp", "agent", "mcp.json"))
    add(
        "~/.omp/agent/mcp.json",
        (d or {}).get("mcpServers") if isinstance(d, dict) else None,
    )
    d = _json_file(os.path.join(home, ".claude.json"))
    if isinstance(d, dict):
        add("~/.claude.json", d.get("mcpServers"))
        for proj in (d.get("projects") or {}).values():
            if isinstance(proj, dict):
                add("~/.claude.json#project", proj.get("mcpServers"))
    d = _json_file(os.path.join(home, ".mcp.json"))
    add("~/.mcp.json", (d or {}).get("mcpServers") if isinstance(d, dict) else None)
    return out


def _cmux() -> dict:
    r = run(["cmux", "capabilities"], timeout=5)
    if not r["ok"]:
        return {"installed": which("cmux") is not None, "running": False}
    try:
        d = json.loads(r["out"])
    except ValueError:
        return {"installed": True, "running": True}
    caps = d.get("capabilities") if isinstance(d, dict) else None
    return {
        "installed": True,
        "running": True,
        "access_mode": d.get("access_mode") if isinstance(d, dict) else None,
        "browser_capabilities": sum(
            1 for c in caps or [] if isinstance(c, str) and c.startswith("browser.")
        ),
    }


def _tode_version() -> str | None:
    d = _json_file(os.path.expanduser("~/.local/state/tode/install.json"))
    return d.get("version") if isinstance(d, dict) else None


_cache: dict = {"at": 0.0, "val": None}
_cache_lock = threading.Lock()


def detect(refresh: bool = False) -> dict:
    """GET /integrations body. Read-only; cached CACHE_TTL_S."""
    with _cache_lock:
        if (
            not refresh
            and _cache["val"]
            and time.monotonic() - _cache["at"] < CACHE_TTL_S
        ):
            return _cache["val"]
    plugins = _plugins()
    mcp = mcp_servers()
    cmux = _cmux()
    have_herdr = which("herdr") is not None

    def plug(pid: str, key: str, notes: str) -> dict:
        p = (plugins or {}).get(pid)
        t = TOOLS[key]
        n = notes if plugins is not None else "herdr not found: plugin state unknown"
        return {
            "name": key,
            "installed": p is not None,
            "enabled": bool(p and p["enabled"]),
            "version": p["version"] if p else None,
            "install_cmd": t["install_cmd"],
            "docs_url": t["docs_url"],
            "notes": n,
        }

    hp = plug(
        PLUGIN_PROJECTS,
        "herdr-projects",
        "read-only list; thread start only on explicit POST",
    )
    hp["configured"] = os.path.isdir(hp_root())
    hp["binary"] = which("herdr-projects") is not None
    fv = plug(
        PLUGIN_VIEWER,
        "herdr-file-viewer",
        "opened per click with a pinned absolute root",
    )
    cd = plug(
        PLUGIN_DECK,
        "captains-deck",
        "read-only Firstmate kanban; needs Firstmate homes",
    )
    cd["plugin_id"] = PLUGIN_DECK
    tode_bin = which("tode")
    t = TOOLS["tode"]
    tode = {
        "name": "tode",
        "installed": tode_bin is not None,
        "enabled": tode_bin is not None,
        "version": _tode_version() if tode_bin else None,
        "install_cmd": t["install_cmd"],
        "docs_url": t["docs_url"],
        "notes": "launched via CLI only; its code-server is never embedded or proxied",
    }
    reg = [m for m in mcp if "cmux-browser" in m["name"]]
    t = TOOLS["cmux-browser-mcp"]
    cb = {
        "name": "cmux-browser-mcp",
        "installed": bool(reg)
        or os.path.isdir(os.path.expanduser("~/.claude/mcp-servers/cmux-browser")),
        "enabled": bool(reg),
        "version": None,
        "install_cmd": t["install_cmd"],
        "docs_url": t["docs_url"],
        "notes": "cmux running"
        if cmux.get("running")
        else "needs the cmux app running",
        "cmux": cmux,
    }
    val = {
        "ok": True,
        "herdr": have_herdr,
        "tools": [hp, fv, cd, cb, tode],
        "mcp": mcp,
    }
    with _cache_lock:
        _cache.update(at=time.monotonic(), val=val)
    return val


# --- herdr-projects ------------------------------------------------------------------------------


def hp_root() -> str:
    env = os.environ.get("HERDR_PROJECTS_ROOT")
    if env:
        return os.path.expanduser(env)
    try:
        with open(
            os.path.expanduser("~/.config/herdr-projects/config.toml"), "rb"
        ) as f:
            root = tomllib.load(f).get("root")
        if isinstance(root, str) and root:
            return os.path.expanduser(root)
    except (OSError, tomllib.TOMLDecodeError):
        pass
    return os.path.expanduser("~/.herdr-projects")


def _hp_project_meta(root: str, slug: str) -> dict:
    try:
        text = Path(root, slug, "PROJECT.md").read_text(encoding="utf-8")
        body = text.split("+++")[1]
        return tomllib.loads(body)
    except (OSError, IndexError, tomllib.TOMLDecodeError):
        return {}


def _channel_names(thread: dict) -> tuple:
    """(channel, parent): `<repo-folder>@<branch>` and the repo's atlas main channel."""
    repo = thread.get("repo") or ""
    branch = thread.get("branch") or ""
    base = os.path.basename(repo.rstrip("/")) or os.path.basename(
        (thread.get("cwd") or "").rstrip("/")
    )
    if not base or not branch:
        return None, None
    parent = None
    if repo and os.path.isdir(repo):
        try:
            import atlas_todo

            parent = atlas_todo.main_channel(repo)
        except Exception:
            parent = None
    return f"{base}@{branch}", parent


def _thread_row(t: dict) -> dict:
    ch, parent = _channel_names(t)
    return {
        "id": t.get("id"),
        "title": t.get("title"),
        "group": t.get("group"),
        "group_token": t.get("group_token"),
        "branch": t.get("branch") or None,
        "cwd": t.get("cwd") or t.get("worktree_path") or None,
        "repo": t.get("repo") or None,
        "kind": t.get("kind"),
        "pane_id": t.get("pane_id") or None,
        "status": t.get("status"),
        "note": t.get("note"),
        "pr": t.get("pr") or None,
        "pr_state": t.get("pr_state") or None,
        "channel": ch,
        "channel_parent": parent,
        "channel_path": f"{parent}/{ch}" if parent and ch else ch,
    }


def hp_projects() -> dict:
    """Read-only. {installed, configured, projects:[{slug,status,summary,goal,repos,threads}], needs_you}."""
    if not which("herdr-projects"):
        return {
            "ok": True,
            "installed": False,
            "configured": False,
            "projects": [],
            "install_cmd": TOOLS["herdr-projects"]["install_cmd"],
        }
    root = hp_root()
    if not os.path.isdir(root):
        return {
            "ok": True,
            "installed": True,
            "configured": False,
            "root": root,
            "projects": [],
            "hint": "run herdr-projects configure --dry-run first",
        }
    base = ["herdr-projects", "--root", root]
    r = run(base + ["list"])
    if not r["ok"]:
        return err(
            "hp_list_failed",
            502,
            installed=True,
            detail=(r.get("err") or r.get("error")),
        )
    projects = []
    for line in r["out"].splitlines()[:200]:
        parts = line.split("\t")
        slug = parts[0].strip()
        if not _SLUG.match(slug):
            continue
        meta = _hp_project_meta(root, slug)
        tr = run(base + ["thread", "list", slug, "--json"])
        threads = []
        if tr["ok"]:
            try:
                rows = json.loads(tr["out"])
                threads = [_thread_row(t) for t in rows if isinstance(t, dict)]
            except ValueError:
                pass
        projects.append(
            {
                "slug": slug,
                "status": parts[1] if len(parts) > 1 else None,
                "summary": parts[2] if len(parts) > 2 else None,
                "name": meta.get("name"),
                "goal": meta.get("goal") or None,
                "repos": meta.get("repos")
                if isinstance(meta.get("repos"), list)
                else [],
                "threads": threads,
            }
        )
    n = run(base + ["needs-you", "--line"])
    m = _NEEDS.search(n.get("out") or "") if n["ok"] else None
    return {
        "ok": True,
        "installed": True,
        "configured": True,
        "root": root,
        "projects": projects,
        "needs_you": int(m.group(1)) if m else 0,
    }


def hp_thread_start(project, title, repo, kind, task, root: str | None = None) -> dict:
    """The one mutating hp call: `thread start` with the task on stdin. Never touches profiles,
    yolo or safety settings; the ticker is never started."""
    if not isinstance(project, str) or not _SLUG.match(project):
        return err("bad_project", 400)
    if (
        not isinstance(title, str)
        or not title.strip()
        or len(title) > 200
        or _CTRL.search(title)
    ):
        return err("bad_title", 400)
    if kind not in ("worktree", "tab", "checkout"):
        return err("bad_kind", 400)
    if not isinstance(task, str) or not task.strip() or len(task) > 100_000:
        return err("bad_task", 400)
    if repo in (None, ""):
        if kind != "tab":
            return err("repo_required", 400)
    else:
        if (
            not isinstance(repo, str)
            or _CTRL.search(repo)
            or not os.path.isabs(repo)
            or not os.path.isdir(repo)
        ):
            return err(
                "bad_repo", 400, why="repo must be an existing absolute directory"
            )
        repo = os.path.realpath(repo)
    if not which("herdr-projects"):
        return err(
            "tool_not_installed",
            424,
            install_cmd=TOOLS["herdr-projects"]["install_cmd"],
        )
    root = root or hp_root()
    if not os.path.isdir(os.path.join(root, project)):
        return err("unknown_project", 404)
    argv = [
        "herdr-projects",
        "--root",
        root,
        "thread",
        "start",
        project,
        "--title",
        title,
    ]
    if repo:
        argv += ["--repo", repo]
    argv += ["--kind", kind, "--task-file", "-"]
    r = run(argv, timeout=START_TIMEOUT_S, stdin=task)
    if not r["ok"]:
        return err(
            "thread_start_failed",
            502,
            detail=(r.get("err") or r.get("error") or "")[:500],
        )
    try:
        return {"ok": True, "thread": json.loads(r["out"])}
    except ValueError:
        return {"ok": True, "output": r["out"][:4096]}


# --- path validation + open actions -------------------------------------------------------------


def _under(child: str, parent: str) -> bool:
    return child == parent or child.startswith(parent.rstrip(os.sep) + os.sep)


_SYSTEM_TREES = (
    "/etc",
    "/usr",
    "/bin",
    "/sbin",
    "/System",
    "/Library",
    "/Applications",
)
_BROAD_DIRS = ("/", "/tmp", "/var", "/private")


def _bad_root(rk: str) -> bool:
    """Too broad or system-owned to be a project root: fs root, home itself or an ancestor of it,
    bare temp/var dirs, or anything inside a system tree."""
    home = os.path.realpath(os.path.expanduser("~"))
    broad = {os.path.realpath(d) for d in _BROAD_DIRS}
    broad.add(os.path.realpath(tempfile.gettempdir()))
    if rk in broad or _under(
        home, rk
    ):  # _under(home, rk): rk == home or an ancestor of home
        return True
    return any(_under(rk, os.path.realpath(t)) for t in _SYSTEM_TREES)


_ROOT_MARKERS = (".git", ".atlas", ".claude-plugin")
_HOME_BARE = ("Downloads", "Desktop", "Documents", "Library", "Public")
# Well-known non-secret dot entries a project path may traverse; every other dot component is refused.
_DOT_ALLOW = {
    ".github",
    ".gitignore",
    ".gitattributes",
    ".editorconfig",
    ".dockerignore",
    ".gitlab-ci.yml",
    ".prettierrc",
    ".eslintrc",
    ".nvmrc",
    ".python-version",
    ".tool-versions",
}
_SECRET_NAMES = (
    ".env*",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "id_rsa*",
    "id_ed25519*",
    "id_ecdsa*",
    "auth.json",
    "credentials*",
    ".npmrc",
    ".netrc",
    ".pgpass",
)


def _valid_root(rk: str) -> bool:
    """rk (realpath) is a usable project root: a real directory, not broad/system, not home, not a
    bare ~/Downloads|Desktop|Documents|Library (or inside Library), not a dot-dir under home or inside
    one, and carrying a project marker (.git, .atlas or .claude-plugin)."""
    if not os.path.isdir(rk) or _bad_root(rk):
        return False
    home = os.path.realpath(os.path.expanduser("~"))
    if _under(rk, home):
        parts = os.path.relpath(rk, home).split(os.sep)
        if any(p.startswith(".") for p in parts) or parts[0] == "Library":
            return False
        if len(parts) == 1 and parts[0] in _HOME_BARE:
            return False
    return any(os.path.lexists(os.path.join(rk, m)) for m in _ROOT_MARKERS)


def _known_root(path: str, known: list) -> str | None:
    """The validated registered root (realpath) containing `path`, else None."""
    for k in known:
        if not isinstance(k, str) or not k or _CTRL.search(k) or not os.path.isabs(k):
            continue
        rk = os.path.realpath(k)
        if _valid_root(rk) and _under(path, rk):
            return rk
    return None


def _forbidden_target(rpath: str, vroot: str) -> bool:
    """True for dot components (outside the allowlist) or secret-looking names below the validated root."""
    rel = os.path.relpath(rpath, vroot)
    if rel == ".":
        return False
    for p in rel.split(os.sep):
        if p.startswith(".") and p not in _DOT_ALLOW:
            return True
        if any(fnmatch.fnmatch(p.lower(), g) for g in _SECRET_NAMES):
            return True
    return False


def _resolve(path, root, known) -> tuple:
    """(realroot, realpath, None) or (None, None, error dict). Symlink escapes fail the realpath check."""
    for v in (path, root):
        if not isinstance(v, str) or not v or _CTRL.search(v):
            return None, None, err("bad_path", 400)
    if not os.path.isabs(root):
        return None, None, err("root_must_be_absolute", 400)
    rroot = os.path.realpath(root)
    if not os.path.isdir(rroot):
        return None, None, err("bad_root", 400)
    vroot = _known_root(rroot, known)
    if not vroot:
        return (
            None,
            None,
            err("unknown_root", 403, why="root is not a registered project root"),
        )
    rpath = os.path.realpath(path if os.path.isabs(path) else os.path.join(rroot, path))
    if not _under(rpath, rroot):
        return None, None, err("path_outside_root", 403)
    if _forbidden_target(rroot, vroot) or _forbidden_target(rpath, vroot):
        return None, None, err("forbidden_path", 403)
    if not os.path.exists(rpath):
        return None, None, err("not_found", 404)
    return rroot, rpath, None


def _line(v):
    if isinstance(v, bool) or not isinstance(v, int) or not 1 <= v <= 10_000_000:
        return None
    return v


_last_open: dict = {}


def open_file(path, root, known, line=None, rng=None, placement="split") -> dict:
    rroot, rpath, bad = _resolve(path, root, known)
    if bad:
        return bad
    if not os.path.isfile(rpath):
        return err("not_a_file", 400)
    rel = os.path.relpath(rpath, rroot)
    if ":" in rel:
        return err(
            "unsupported_path", 400, why="':' in the path clashes with the line suffix"
        )
    if line is not None and rng is not None:
        return err("line_or_range", 400)
    if line is not None:
        if _line(line) is None:
            return err("bad_line", 400)
        rel += f":{line}"
    elif rng is not None:
        if (
            not (isinstance(rng, (list, tuple)) and len(rng) == 2)
            or any(_line(x) is None for x in rng)
            or rng[0] > rng[1]
        ):
            return err("bad_range", 400)
        rel += f":{rng[0]}-{rng[1]}"
    if placement not in ("split", "tab"):
        return err("bad_placement", 400)
    plugins = _plugins()  # uncached: an install a second ago must count
    if plugins is None:
        return err("herdr_not_found", 424, install_cmd="https://herdr.dev")
    if PLUGIN_VIEWER not in plugins or not plugins[PLUGIN_VIEWER]["enabled"]:
        return err(
            "plugin_not_installed",
            424,
            install_cmd=TOOLS["herdr-file-viewer"]["install_cmd"],
        )
    now = time.monotonic()
    if now - _last_open.get(rroot, -1e9) < VIEWER_DEDUPE_S:
        return err(
            "duplicate_viewer",
            429,
            why=f"a viewer for this root opened < {VIEWER_DEDUPE_S:.0f}s ago",
        )
    argv = [
        "herdr",
        "plugin",
        "pane",
        "open",
        "--plugin",
        PLUGIN_VIEWER,
        "--entrypoint",
        "file-viewer",
        "--placement",
        placement,
    ]
    if placement == "split":
        argv += ["--direction", "right"]
    argv += [
        "--focus",
        "--env",
        f"HERDR_FILE_VIEWER_ROOT={rroot}",
        "--env",
        f"HERDR_FILE_VIEWER_OPEN={rel}",
    ]
    r = run(argv, timeout=15)
    if not r["ok"]:
        return err(
            "open_failed", 502, detail=(r.get("err") or r.get("error") or "")[:500]
        )
    _last_open[rroot] = now
    return {"ok": True, "root": rroot, "open": rel, "output": r["out"][:2048]}


def open_editor(path, known, line=None) -> dict:
    """Detached `tode` launch. tode's code-server URL/port is never read or returned."""
    if (
        not isinstance(path, str)
        or not path
        or _CTRL.search(path)
        or not os.path.isabs(path)
    ):
        return err("bad_path", 400)
    rpath = os.path.realpath(path)
    vroot = _known_root(rpath, known)
    if not vroot:
        return err(
            "unknown_root", 403, why="path is not inside a registered project root"
        )
    if _forbidden_target(rpath, vroot):
        return err("forbidden_path", 403)
    if not os.path.exists(rpath):
        return err("not_found", 404)
    exe = which("tode")
    if not exe:
        return err("tool_not_installed", 424, install_cmd=TOOLS["tode"]["install_cmd"])
    if os.path.isdir(rpath):
        argv = ["tode", rpath]
    else:
        if line is not None and _line(line) is None:
            return err("bad_line", 400)
        argv = ["tode", "--goto", f"{rpath}:{line or 1}:1"]
    try:
        p = subprocess.Popen(
            [exe, *argv[1:]],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError as e:
        return err("spawn_failed", 502, detail=str(e))
    threading.Thread(target=p.wait, daemon=True).start()  # reap, never block
    return {"ok": True, "launched": True, "path": rpath}


# --- Captain's Deck / Firstmate -------------------------------------------------------------------


def _firstmate_homes() -> list:
    home = os.path.expanduser("~")
    homes = [
        p
        for p in glob.glob(os.path.join(home, ".treehouse", "*", "*", "firstmate"))
        if os.path.isdir(p)
    ]
    if os.path.isdir(os.path.join(home, "firstmate")):
        homes.insert(0, os.path.join(home, "firstmate"))
    for p in (os.environ.get("FM_FLOW_HOMES") or "").split(":"):
        if p and os.path.isdir(p) and p not in homes:
            homes.append(p)
    return homes


def deck_status() -> dict:
    plugins = _plugins()
    p = (plugins or {}).get(PLUGIN_DECK)
    t = TOOLS["captains-deck"]
    base = {
        "ok": True,
        "plugin_id": PLUGIN_DECK,
        "installed": p is not None,
        "enabled": bool(p and p["enabled"]),
        "install_cmd": t["install_cmd"],
    }
    homes = _firstmate_homes()
    if not homes:
        return {
            **base,
            "available": False,
            "reason": "Firstmate not installed",
            "homes": [],
        }
    if not p:
        return {
            **base,
            "available": False,
            "reason": "Captain's Deck plugin not installed",
            "homes": homes,
        }
    out = {**base, "available": True, "homes": homes, "reason": None}
    script = os.path.join(p.get("root") or "", "scripts", "kanban-view.sh")
    if p.get("root") and os.path.isfile(script):
        r = run(["bash", script, "--homes"], timeout=10)  # documented read-only probe
        if r["ok"]:
            out["discovered"] = r["out"].splitlines()[:50]
    return out
