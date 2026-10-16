#!/usr/bin/env python3
"""atlas_mux -- opt-in colony mode (ATLAS_MUX=tmux); workers run as tmux panes/windows.

Transport: tmux by default whenever it is installed (session `atlas-<run>`, one window per worker; the dashboard
Terminal page attaches to these live). claude-bg is the fallback without tmux: `claude --bg --name <worker> --agent
atlas:<role>` runs the harness as a supervised background agent (status via `claude agents --json`, kill via
`claude stop`; the worker's ONE report note contract travels in the composed brief). ATLAS_COLONY_TRANSPORT=
herdr|tmux|claude-bg forces one. omp workers always run as panes (claude --bg is claude-only): tmux, or herdr only
when forced.
Each worker runs as its own headless harness process,
at the cost tier its agent definition declares:

  claude: claude -p --agent atlas:<role> --model <m> --effort <e> --permission-mode <p> <prompt>
          (tier from plugins/atlas/agents/<role>.md `model:` / `effort:`)
  omp:    omp -p --model=<concrete> --thinking=<t> <role brief + prompt>
          (tier from plugins/atlas/omp/agents/<role>.md `model:` list / `thinkingLevel:`;
          omp has no --agent flag, so the role's body is prepended to the prompt.
          The first model pattern that resolves wins; an @role alias resolves to the
          CONCRETE selector under modelRoles in ~/.omp/agent/config.yml
          (ATLAS_MUX_OMP_CONFIG overrides the path) and that selector is what omp gets)

Tier enforcement: spawn refuses (ok:false, exit 2, before any pane/tmux call) when the
role's definition is missing or yields no model, unless the caller passes an explicit
--model AND the harness tier flag (--effort claude | --thinking omp). An omp --model
(or definition pattern list) that resolves to nothing is always refused.

Workers share the lead's board: ATLAS_PROJECT_ROOT=<root> and
ATLAS_WORKER_NAME=<name> are pinned in the worker env. atlas_todo.note is the single
writer of <root>/.atlas/.run/board/<name>.jsonl: run-worker posts exactly ONE note per run,
addressed to ATLAS_LEAD_NAME in ATLAS_CHANNEL (kind=report): the STATUS..NEXT report block
(else the last 20 non-noise lines) then `exit <code>` (+ ` [failed: reason]`). Full stdout+stderr
goes to <root>/.atlas/.run/logs/<name>.log and the pane; the worker then leaves the channel and
is marked finished in the registry.
`omp -p` exits 0 on `Model "..." not found` and on HTTP 402, so output matching
not-found / 402 / credit / auth patterns is classified failed and recorded as exit 1
(NOISE_RE lines, e.g. `Warning: MCP server ... its tools are unavailable`, are not scanned).

Not Claude Code agent teams: teammates inherit the lead's effort, which would
erase the per-role tiers. The default in-process colony is unchanged.

Subcommands: spawn | spawn-team | wait | reap | status | kill | run-worker (internal: the pane command).
spawn-team sizes a team from atlas_resolve (class, effort) and spawns it as tmux panes (session atlas-<team_id>);
wait blocks until every member posted its exit note; reap kills the session and archives the team record.
Test-only: --command-override / ATLAS_MUX_WORKER_CMD replaces the harness
command inside run-worker (stub workers for smoke runs).
Stdlib only. Prints one JSON object per invocation.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import time
import sys
import tempfile
from pathlib import Path

import atlas_panefeed
import atlas_resolve
import atlas_todo

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_AGENT_DIRS = {
    "claude": PLUGIN_ROOT / "agents",
    "omp": PLUGIN_ROOT / "omp" / "agents",
}
CODEX_EFFORTS = ("minimal", "low", "medium", "high")
NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
BOARD_REL = Path(".atlas") / ".run" / "board"
# Lead env vars a tmux pane would otherwise lose (a pane inherits the tmux SERVER env, not the spawning client's;
# PATH is the exception: tmux hands the client's PATH to a new window, verified with a server started under a
# different PATH). ATLAS_DB/ATLAS_GATE: database and gate. The ATLAS_* kill switches/knobs are read in the omp
# extension or the hooks of a worker session, so a lead that set ATLAS_MANDATES=off would otherwise have its workers
# recall-gated again. PI_*/OMP_PROFILE pick the omp agent dir/profile (auth, config.yml, sessions) the lead runs under.
# Not listed on purpose: variables atlas itself pins per worker or per bridge (ATLAS_WORKER_NAME, ATLAS_PROJECT_ROOT,
# ATLAS_HARNESS, ATLAS_TOOLKIT_LOAD, ATLAS_NATIVE_POLICY, ATLAS_ENGINE_ARM).
FORWARDED_ENV = (
    "ATLAS_DB",
    "ATLAS_GATE",
    "ATLAS_MANDATES",
    "ATLAS_HOOK_BRIDGE",
    "ATLAS_STOP_BRIDGE",
    "ATLAS_INGEST",
    "ATLAS_LEAN_SHELL",
    "ATLAS_ADVISOR_GATE",
    "ATLAS_STYLE",
    "ATLAS_TRIPWIRE",
    "ATLAS_TRIPWIRE_HARD",
    "ATLAS_WORKER_MAX_TOKENS",
    "ATLAS_CONNECTOR_WATCH",
    "ATLAS_CHRONICLE",
    "ATLAS_MEMORY_CAPTURE",
    "PI_CODING_AGENT_DIR",
    "PI_PROFILE",
    "OMP_PROFILE",
    "ATLAS_LEAD_NAME",
    "ATLAS_CHANNEL",
    # the lead's agent/session name; claude-bg brief adds the SendMessage native-wake
    # paragraph only when it is set (see _bg_brief) and the worker env carries it for the wake
    "ATLAS_LEAD_AGENT",
    # the lead's task-mirror switch; claude-bg brief adds the TaskCreate mirror paragraph
    # only when it is truthy (see _bg_brief)
    "ATLAS_TASKS_MIRROR",
)
# Read/navigation MCP tools a pane claude worker may call without a prompt (live 12.3.1: unlisted MCP tools were
# denied in -p mode and workers fell back from mcp__lean-ctx__ctx_shell to Bash).
WORKER_MCP_ALLOW = (
    "mcp__lean-ctx__*",
    "mcp__plugin_context-mode_context-mode__*",
    "mcp__serena__activate_project",
    "mcp__serena__get_symbols_overview",
    "mcp__serena__find_symbol",
    "mcp__serena__find_referencing_symbols",
    "mcp__serena__find_declaration",
    "mcp__serena__find_implementations",
    "mcp__serena__get_diagnostics_for_file",
)
# omp prints one of these per unreachable MCP server; the run itself is fine.
NOISE_RE = re.compile(
    r"^(Warning: MCP server .* its tools are unavailable|Extension error\b)"
)
# the exit line is the LAST line of the report note (a bare `exit N` note is the one-line case)
EXIT_NOTE_RE = re.compile(r"^exit (-?\d+)[^\n]*\Z", re.M)
# omp -p exits 0 on these, so run-worker classifies by output. First match wins.
FAIL_SIGNS = (
    (re.compile(r"\bmodel\b[^\n]{0,60}\bnot found\b", re.I), "model not found"),
    (re.compile(r"(?<!\d)402(?!\d)"), "http 402"),
    (
        re.compile(
            r"insufficient credit|credit balance|out of credit|credits? (?:exhausted|depleted)|payment required",
            re.I,
        ),
        "credits exhausted",
    ),
    (
        re.compile(
            r"\bunauthori[sz]ed\b|\bunauthenticated\b|authentication (?:failed|required|error)|invalid api[ _-]?key|(?<!\d)401(?!\d)",
            re.I,
        ),
        "auth rejected",
    ),
)


def _emit(obj: dict, code: int = 0) -> int:
    print(json.dumps(obj))
    return code


def _session(run: str) -> str:
    return f"atlas-{run}"


def clean_env(env: dict | None = None) -> dict:
    """Env for tmux and its panes with every cmux hook removed (CMUX_*, TERM_PROGRAM=cmux) and cmux CLI shims off
    PATH, so nothing in a pane can reach the cmux socket or surface a UI."""
    out = {
        k: v
        for k, v in (os.environ if env is None else env).items()
        # TMUX/TMUX_PANE: atlas sessions are detached and addressed by name; a stale or unresolvable
        # lead pane must not route (or fail) them.
        if not k.startswith("CMUX_") and k not in ("TMUX", "TMUX_PANE")
    }
    if out.get("TERM_PROGRAM", "").lower() == "cmux":
        del out["TERM_PROGRAM"]
    if out.get("PATH"):
        out["PATH"] = os.pathsep.join(
            p
            for p in out["PATH"].split(os.pathsep)
            if ".cmuxterm" not in p
            and "cmux-cli-shims" not in p
            and "cmux.app" not in p.lower()
        )
    return out


TMUX_TIMEOUT_S = 10


def _log_tmux_failure(args, res) -> None:
    """Append one line per failed tmux call to <project>/.atlas/.run/logs/atlas_mux.log. has-session is the
    existence probe (nonzero is the normal answer), so it stays out. Best effort: logging never breaks a spawn."""
    if res.returncode == 0 or args[:1] == ("has-session",):
        return
    try:
        start = Path(os.environ.get("ATLAS_PROJECT_ROOT") or os.getcwd()).resolve()
        # nearest ancestor with a real .atlas/.run; never create .atlas itself
        root = next(
            (p for p in (start, *start.parents) if (p / ".atlas" / ".run").is_dir()),
            None,
        )
        if root is None:
            return
        log = root / ".atlas" / ".run" / "logs" / "atlas_mux.log"
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open("a", encoding="utf-8") as fh:
            fh.write(
                f"{time.strftime('%FT%T')} tmux {shlex.join(args)[:300]} rc={res.returncode} {str(res.stderr).strip()[:300]}\n"
            )
    except OSError:
        pass


def _tmux(*args: str) -> subprocess.CompletedProcess:
    """Run tmux with a bounded wait. A missing binary or a wedged server comes back as a failed
    CompletedProcess (127 / 124) with a stderr reason, never an exception or a hang."""
    res = _tmux_run(args)
    _log_tmux_failure(args, res)
    return res


def _tmux_run(args) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            ["tmux", *args],
            capture_output=True,
            text=True,
            env=clean_env(),
            timeout=TMUX_TIMEOUT_S,
        )
    except FileNotFoundError:
        return subprocess.CompletedProcess(
            ["tmux", *args], 127, "", "tmux not found on PATH"
        )
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(
            ["tmux", *args], 124, "", f"tmux timed out after {TMUX_TIMEOUT_S}s"
        )


def _seats_up() -> bool:
    """True when a seat backend (OpenRig, else herdr) is reachable; the one symbol tests patch."""
    import atlas_seats

    try:
        if atlas_seats.backend() == "none":
            return False
        st = atlas_seats.status()
        # herdr's `healthy` is only its web UI; the pane socket is `herdr_server`. rig has just `healthy`.
        return bool(st["herdr_server"] if "herdr_server" in st else st.get("healthy"))
    except Exception:
        return False


def transport() -> str:
    """The transport forced via ATLAS_COLONY_TRANSPORT=herdr|tmux|claude-bg; unforced, tmux whenever it is
    installed (each colony worker gets its own window under session atlas-<run>), else 'claude-bg'."""
    forced = os.environ.get("ATLAS_COLONY_TRANSPORT", "").strip().lower()
    if forced in ("herdr", "tmux", "claude-bg"):
        return forced
    return "tmux" if shutil.which("tmux") else "claude-bg"


def _pane_transport() -> str:
    """'herdr' only when forced via ATLAS_COLONY_TRANSPORT, else 'tmux' — for workers that must run as panes
    (omp has no claude --bg equivalent; interactive launches always need a pane)."""
    return (
        "herdr"
        if os.environ.get("ATLAS_COLONY_TRANSPORT", "").strip().lower() == "herdr"
        else "tmux"
    )


CLAUDE_TIMEOUT_S = 30
# line 1 of a successful `claude --bg` run: `backgrounded · <id> · <name>`
_BG_ID_RE = re.compile(r"backgrounded\s+·\s+(\S+)")
# claude agents --json states that mean the background agent is finished
_BG_DONE_STATES = frozenset(("done", "failed", "stopped", "error"))


def _claude(
    *args: str, env: dict | None = None, cwd: str | None = None
) -> subprocess.CompletedProcess:
    """Run the claude CLI with a bounded wait. A missing binary or a hung call comes back as a
    failed CompletedProcess (127 / 124) with a stderr reason, never an exception or a hang."""
    try:
        return subprocess.run(
            ["claude", *args],
            capture_output=True,
            text=True,
            env=clean_env() if env is None else env,
            cwd=cwd,
            timeout=CLAUDE_TIMEOUT_S,
        )
    except FileNotFoundError:
        return subprocess.CompletedProcess(
            ["claude", *args], 127, "", "claude not found on PATH"
        )
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(
            ["claude", *args], 124, "", f"claude timed out after {CLAUDE_TIMEOUT_S}s"
        )


def _claude_workers(root: str) -> list | None:
    """claude-bg workers of `root` from `claude agents --json`: background agents whose cwd is
    this project. None when claude is missing or answers garbage (status then reports none)."""
    res = _claude("agents", "--json")
    if res.returncode != 0:
        return None
    try:
        rows = json.loads(res.stdout)
    except ValueError:
        return None
    if not isinstance(rows, list):
        return None
    real = os.path.realpath(root)
    out = []
    for row in rows:
        if not isinstance(row, dict) or row.get("kind") != "background":
            continue
        if os.path.realpath(str(row.get("cwd") or "")) != real:
            continue
        name = str(row.get("name") or "")
        if name in ("lead", "Sidebar"):
            continue
        state = str(row.get("state") or row.get("status") or "").lower()
        out.append(
            {
                "name": name,
                "dead": 1 if state in _BG_DONE_STATES else 0,
                "pid": row.get("id") or row.get("pid") or "",
                "state": state,
            }
        )
    return out


def pane_env(root: str, name: str) -> dict:
    """Env pinned on every worker pane, whatever the transport: the board contract plus the forwarded lead env."""
    env = {"ATLAS_PROJECT_ROOT": root, "ATLAS_WORKER_NAME": name}
    env.update({k: os.environ[k] for k in FORWARDED_ENV if os.environ.get(k)})
    return env


def pane_command(env: dict, argv: list) -> str:
    """`exec env K=V ... argv`: the pins travel in the command itself, so a shell that resets its env cannot drop them."""
    return "exec " + shlex.join(["env", *[f"{k}={v}" for k, v in env.items()], *argv])


def _agents_dir(harness: str, override: str | None) -> Path:
    return Path(override) / harness if override else DEFAULT_AGENT_DIRS[harness]


def _frontmatter(path: Path) -> tuple[dict, str]:
    """(fields, body) of a `---` fenced agent file; ({}, "") when absent."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return {}, ""
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end < 0:
        return {}, text
    fields = {}
    for line in text[3:end].splitlines():
        m = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if m:
            v = m.group(2).strip()
            if len(v) > 1 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]  # gen-agents.ts quotes scalars: thinkingLevel: "medium"
            fields[m.group(1)] = v
    return fields, text[text.find("\n", end + 1) + 1 :]


def _omp_config_path() -> Path:
    return Path(
        os.environ.get("ATLAS_MUX_OMP_CONFIG")
        or Path.home() / ".omp" / "agent" / "config.yml"
    )


def _omp_roles(config: Path) -> dict:
    """omp modelRoles as {alias: concrete selector} (simple YAML scan of inline
    scalars); empty on error."""
    roles: dict = {}
    try:
        lines = config.read_text(encoding="utf-8").splitlines()
    except OSError:
        return roles
    inside = False
    for line in lines:
        if re.match(r"^modelRoles:\s*$", line):
            inside = True
            continue
        if inside:
            m = re.match(r"^\s+([A-Za-z0-9_.-]+):[ \t]*(\S.*?)\s*$", line)
            if m:
                roles[m.group(1)] = m.group(2).strip("\"'")
            elif line.strip() and not line.startswith((" ", "\t")):
                break
    return roles


def _patterns(raw: str | None) -> list:
    """Model patterns from a frontmatter value or --model: a JSON list or one scalar."""
    if not raw:
        return []
    try:
        found = json.loads(raw) if raw.startswith("[") else [raw.strip("\"'")]
    except ValueError:
        return []
    return [p for p in found if isinstance(p, str) and p]


def _resolve_omp_model(patterns: list, roles: dict) -> str | None:
    """First pattern omp can take: a concrete selector as-is, or an @role alias
    replaced by its concrete modelRoles value. None when nothing resolves."""
    for p in patterns:
        if not p.startswith("@"):
            return p
        if roles.get(p[1:]):
            return roles[p[1:]]
    return None


def _tier(
    harness: str,
    role: str,
    agents_dir: str | None,
    model: str | None,
    level: str | None,
):
    """(model, level, body, error). `error` names the role and the path searched.

    The definition must yield a model. When it does not (file missing, no `model:`,
    or for omp no pattern that resolves), the caller must pass an explicit --model
    AND the harness tier flag; the explicit model always wins and, for omp, must
    itself resolve to a concrete selector."""
    # codex has no agent files of its own: it reads the claude role (body is prepended to the brief)
    def_path = (
        _agents_dir("claude" if harness == "codex" else harness, agents_dir)
        / f"{role}.md"
    )
    fields, body = _frontmatter(def_path)
    flag = "--effort" if harness == "claude" else "--thinking"
    fm_level = fields.get("effort" if harness == "claude" else "thinkingLevel") or None
    config: Path | None = None
    patterns: list = []
    if harness == "codex":
        # codex's own config picks the model; --model/--thinking are optional overrides, never required
        fm = fields.get("effort")
        return model or None, level or (fm if fm in CODEX_EFFORTS else None), body, None
    if harness == "claude":
        def_model = fields.get("model") or None
        explicit = model
    else:
        config = _omp_config_path()
        roles = _omp_roles(config)
        patterns = _patterns(fields.get("model"))
        def_model = _resolve_omp_model(patterns, roles)
        explicit = _resolve_omp_model(_patterns(model), roles) if model else None
        if model and explicit is None:
            return (
                None,
                None,
                body,
                f"tier enforcement: --model {model!r} for role '{role}' resolves to nothing in modelRoles of {config}",
            )
    if def_model:
        return explicit or def_model, level or fm_level, body, None
    if model and level:  # explicit tier overrides a definition that yields no model
        return explicit, level, body, None
    why = (
        f"lists {patterns!r}, none found in modelRoles of {config}"
        if harness == "omp" and patterns
        else "is missing or has no `model:`"
    )
    return (
        None,
        None,
        body,
        (
            f"tier enforcement: no model for role '{role}': {def_path} {why}; "
            f"pass an explicit --model together with {flag}"
        ),
    )


def harness_argv(
    harness: str,
    role: str,
    prompt: str,
    model,
    level,
    body: str,
    permission_mode: str,
    omp_extension: str | None = None,
    cwd: str | None = None,
) -> list:
    if harness == "codex":
        # exec --json: one JSON event per line (atlas_panefeed renders them); workspace-write lets the worker edit
        argv = [
            "codex",
            "exec",
            "--json",
            "--skip-git-repo-check",
            "-s",
            "workspace-write",
        ]
        if cwd:
            argv += ["-C", cwd]
        if model:
            argv += ["-m", model]
        if level:
            argv += ["-c", f"model_reasoning_effort={level}"]
        brief = (
            f"You are the atlas:{role} worker.\n\n{body.strip()}\n\n# Task\n{prompt}"
            if body.strip()
            else prompt
        )
        return argv + [brief]
    if harness == "claude":
        # stream-json so the pane shows live tool calls; atlas_panefeed renders it and run-worker keeps the result text
        argv = [
            "claude",
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",
            "--agent",
            f"atlas:{role}",
        ]
        if model:
            argv += ["--model", model]
        if level:
            argv += ["--effort", level]
        # --allowedTools is variadic: another flag must follow it so it cannot swallow the prompt
        return argv + [
            "--allowedTools",
            ",".join(WORKER_MCP_ALLOW),
            "--permission-mode",
            permission_mode,
            prompt,
        ]
    # --mode json: one JSON event per line, so atlas_panefeed renders tool rows like the claude feed
    argv = ["omp", "-p", "--mode", "json"]
    if model:
        argv.append(f"--model={model}")
    if level:
        argv.append(f"--thinking={level}")
    if omp_extension:
        # Pin the worker to one atlas tree. Without this a worker loads whichever atlas omp has installed, which
        # can be an older release than the lead's. --no-extensions keeps discovery from loading a second copy.
        argv += ["--no-extensions", f"--extension={omp_extension}"]
    # In-memory session: with omp's autoResume on, `omp -p` in the lead's cwd resumes the lead's own session
    # (live: the worker reopened it, hit the writer lock and hung on "Working..." until SIGHUP).
    argv.append("--no-session")
    brief = (
        f"You are the atlas:{role} worker.\n\n{body.strip()}\n\n# Task\n{prompt}"
        if body.strip()
        else prompt
    )
    return argv + [brief]


def _validate(args) -> str | None:
    if os.environ.get("ATLAS_MUX") != "tmux":
        return "mux mode is opt-in: set ATLAS_MUX=tmux"
    for label, value in (("run", args.run), ("name", args.name), ("agent", args.agent)):
        if not NAME_RE.match(value or ""):
            return f"invalid {label} {value!r}: use [A-Za-z0-9_-]"
    if args.harness in ("omp", "codex") and args.effort:
        return f"--effort is a claude flag; {args.harness} workers take --thinking"
    if args.harness == "claude" and args.thinking:
        return "--thinking is an omp flag; claude workers take --effort"
    if not os.path.isfile(args.prompt_file):
        return f"prompt file not found: {args.prompt_file}"
    return None


def _dead_flag(raw: str) -> int:
    """tmux #{window_dead} as 0/1; anything that is not a plain digit string is 0."""
    return int(raw) if raw.isascii() and raw.isdigit() else 0


def _windows(session: str) -> list | None:
    res = _tmux(
        "list-windows",
        "-t",
        session,
        "-F",
        "#{window_name}\t#{window_dead}\t#{pane_pid}",
    )
    if res.returncode != 0:
        return None
    out = []
    for line in res.stdout.splitlines():
        parts = line.split("\t")
        if parts and parts[0]:
            out.append(
                {
                    "name": parts[0],
                    "dead": _dead_flag(parts[1]) if len(parts) > 1 else 0,
                    "pid": parts[2] if len(parts) > 2 else "",
                }
            )
    return out


DEFAULT_PANE_SIZE = "200x50"


def _lead_size() -> str:
    """WxH of the lead's tmux client, else DEFAULT_PANE_SIZE. Queried with the lead's own env (TMUX set),
    not clean_env, which strips TMUX on purpose."""
    if os.environ.get("TMUX"):
        try:
            out = subprocess.run(
                ["tmux", "display-message", "-p", "#{client_width}x#{client_height}"],
                capture_output=True,
                text=True,
                timeout=TMUX_TIMEOUT_S,
            ).stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            out = ""
        if re.fullmatch(r"\d+x\d+", out) and not out.startswith("0"):
            return out
    return DEFAULT_PANE_SIZE


def _open_window(
    session: str, name: str, pane: str, team: dict | None = None
) -> str | None:
    """Create the session when missing and open window `name` in it; an error string or None.
    With `team` (spawn-team) the worker becomes a pane of the team's one tiled window instead.

    Serialised per session by a lock file; a "duplicate session" from tmux (another process
    created it first) just means the session exists."""
    lock = Path(tempfile.gettempdir()) / f"atlas-mux-{session}"
    with atlas_todo._file_lock(lock):
        if team is not None:
            return _open_team_pane(session, name, pane, team)
        if _tmux("has-session", "-t", session).returncode != 0:
            # a detached session is 80x24 unless told otherwise and the branded feed wraps at that width;
            # default-size covers the windows opened later (no client is attached to size them)
            width, height = _lead_size().split("x")
            created = _tmux(
                "new-session",
                "-d",
                "-s",
                session,
                "-n",
                "lead",
                "-x",
                width,
                "-y",
                height,
            )
            if created.returncode != 0 and "duplicate session" not in created.stderr:
                return f"tmux new-session failed: {created.stderr.strip()}"
            _tmux("set-option", "-t", session, "remain-on-exit", "off")
            _tmux("set-option", "-t", session, "default-size", f"{width}x{height}")
        elif any(w["name"] == name for w in _windows(session) or []):
            return f"name_taken: {name} already runs in {session}"
        res = _tmux("new-window", "-d", "-t", session, "-n", name, pane)
        if res.returncode != 0:
            return f"tmux new-window failed: {res.stderr.strip()}"
    return None


# ---- team window: every worker a pane of one tiled, atlas-styled window ------------------------------------------
# Catppuccin-Mocha, the palette atlas_panefeed paints the panes with
_BORDER = (
    "#{?pane_active,#[fg=#1e1e2e bg=#cba6f7 bold],#[fg=#cba6f7 bg=#181825]}"
    " ◢◤ #{@atlas_worker} · #{@atlas_role} #[default]"
)
_DEAD = "#[fg=#6c7086] pane kept for review · exit #{pane_dead_status} · reap closes it"
# Status counts and clock in plain tmux formats: #{n:} is the length of a per-pane glyph loop, and
# strftime runs over status-right before format expansion, so %s is now and %% a literal % (modulo).
_ELAPSED = "#{e|-|:%s,#{session_created}}"
_COUNTS = (
    "#{n:#{P:#{?pane_dead,,x}}} live · #{n:#{P:#{?pane_dead,x,}}} done · "
    f"◷ #{{e|/|:{_ELAPSED},60}}m#{{e|%%|:{_ELAPSED},60}}s"
)


def _team_window_argv(target: str) -> list:
    """Window options for a team window (set on that window only, never -g)."""
    opts = [
        ("pane-border-status", "top"),
        ("pane-border-lines", "heavy"),
        ("pane-border-format", _BORDER),
        ("pane-border-style", "fg=#45475a"),
        ("pane-active-border-style", "fg=#cba6f7"),
        ("window-style", "fg=#cdd6f4,bg=#11111b"),
        ("window-active-style", "fg=#cdd6f4,bg=#11111b"),
        # a finished worker keeps its pane (and its DONE line) until reap kills the session
        ("remain-on-exit", "on"),
        ("remain-on-exit-format", _DEAD),
    ]
    return [["set-option", "-w", "-t", target, k, v] for k, v in opts]


def _team_session_argv(session: str, rec: dict) -> list:
    """Session options: an atlas status bar for this team session only (never -g)."""
    left = (
        "#[fg=#1e1e2e,bg=#cba6f7,bold] ◢◤ ATLAS #[fg=#cba6f7,bg=#181825,nobold]"
        f" team {rec.get('team_id', '?')} · {rec.get('class', '?')}/{rec.get('effort', '?')} "
    )
    right = (
        "#{P:#{?pane_dead,#{?#{==:#{pane_dead_status},0},#[fg=#a6e3a1]✔,#[fg=#f38ba8]✖},#[fg=#f9e2af]◆}} "
        f"#[fg=#1e1e2e,bg=#94e2d5,bold] {_COUNTS} "
    )
    opts = [
        ("status", "on"),
        ("status-interval", "1"),
        ("status-style", "fg=#cdd6f4,bg=#181825"),
        ("status-left-length", "90"),
        ("status-right-length", "90"),
        ("status-left", left),
        ("status-right", right),
        ("window-status-format", ""),
        ("window-status-current-format", ""),
    ]
    return [["set-option", "-t", session, k, v] for k, v in opts]


# pane title `name [role]`, set by _open_team_pane so `list-panes -F '#{pane_title}'` maps panes to members
TITLE_RE = re.compile(r"^(\S+) \[(.*)\]$")


def _team_panes(session: str) -> list:
    """Worker panes of a team session, by their @atlas_worker pane option."""
    res = _tmux(
        "list-panes",
        "-s",
        "-t",
        session,
        "-F",
        "#{@atlas_worker}\t#{pane_dead}\t#{pane_pid}",
    )
    if res.returncode != 0:
        return []
    rows = [line.split("\t") for line in res.stdout.splitlines()]
    return [
        {"name": r[0], "dead": _dead_flag(r[1]), "pid": r[2]}
        for r in rows
        if len(r) == 3 and r[0]
    ]


def _team_pane_rows(session: str, root: str) -> list:
    """One row per pane of a team session for `status`: member, role, pane id, pid, liveness, foreground
    command, exit status when dead, last board note kind. Member comes from the @atlas_worker pane option,
    else from the `name [role]` pane title (a harness can rewrite the title, the option survives)."""
    fmt = "\t".join(
        "#{" + k + "}"
        for k in (
            "pane_id",
            "@atlas_worker",
            "@atlas_role",
            "pane_title",
            "pane_pid",
            "pane_dead",
            "pane_dead_status",
            "pane_current_command",
        )
    )
    res = _tmux("list-panes", "-s", "-t", session, "-F", fmt)
    if res.returncode != 0:
        return []
    last = {}
    for rec in atlas_todo.notes(root):
        last[str(rec.get("owner"))] = rec.get("kind") or "note"
    rows = []
    for line in res.stdout.splitlines():
        r = (line.split("\t") + [""] * 8)[:8]
        name, role = r[1], r[2]
        title = TITLE_RE.match(r[3])
        if not name and title:
            name, role = title.group(1), role or title.group(2)
        if not name:
            continue
        dead = _dead_flag(r[5])
        rows.append(
            {
                "name": name,
                "role": role,
                "pane_id": r[0],
                "pid": r[4],
                "dead": dead,
                "command": r[7],
                "exit_status": int(r[6])
                if dead and r[6].lstrip("-").isdigit()
                else None,
                "last_note": last.get(name),
            }
        )
    return rows


def _new_team_session(
    session: str, pane: str, rec: dict
) -> subprocess.CompletedProcess:
    """The team session; its first window (named like the session) starts with this worker, no idle shell."""
    width, height = _lead_size().split("x")
    res = _tmux(
        "new-session",
        "-d",
        "-s",
        session,
        "-n",
        session,
        "-x",
        width,
        "-y",
        height,
        "-P",
        "-F",
        "#{pane_id}",
        pane,
        # same tmux command queue as new-session: the option is set before the event loop can reap a worker that
        # exits at once (set afterwards, the lone pane died, the session and server vanished, later splits failed)
        ";",
        "set-option",
        "-w",
        "-t",
        f"{session}:{session}",
        "remain-on-exit",
        "on",
    )
    if res.returncode == 0:
        for argv in [
            *_team_session_argv(session, rec),
            *_team_window_argv(f"{session}:{session}"),
        ]:
            _tmux(*argv)
    return res


def _split_team_window(
    session: str, name: str, pane: str
) -> subprocess.CompletedProcess:
    res = _tmux(
        "split-window",
        "-d",
        "-t",
        f"{session}:{session}",
        "-P",
        "-F",
        "#{pane_id}",
        pane,
    )
    if res.returncode == 0:
        return res
    # no space left for another pane: overflow into a styled window of its own
    res = _tmux(
        "new-window", "-d", "-t", session, "-n", name, "-P", "-F", "#{pane_id}", pane
    )
    if res.returncode == 0:
        for argv in _team_window_argv(f"{session}:{name}"):
            _tmux(*argv)
    return res


def _team_layout(count: int, width: int) -> str:
    """Side by side while each pane keeps >= 70 cols, else one wide pane over the rest; 4+ tile."""
    if count == 3:
        return "even-horizontal" if (width - 2) // 3 >= 70 else "main-horizontal"
    return "even-horizontal" if count <= 2 else "tiled"


def _relayout_team(session: str) -> None:
    win = f"{session}:{session}"
    res = _tmux("list-panes", "-t", win, "-F", "#{window_width}")
    widths = (
        [int(w) for w in res.stdout.split() if w.isdigit()]
        if res.returncode == 0
        else []
    )
    width = widths[0] if widths else int(_lead_size().split("x")[0])
    _tmux("select-layout", "-t", win, _team_layout(max(1, len(widths)), width))


def _open_team_pane(session: str, name: str, pane: str, team: dict) -> str | None:
    """Team mode of _open_window (caller holds its lock): a tiled pane tagged @atlas_worker/@atlas_role."""
    if _tmux("has-session", "-t", session).returncode != 0:
        res = _new_team_session(session, pane, team.get("rec") or {})
    elif any(p["name"] == name for p in _team_panes(session)):
        return f"name_taken: {name} already runs in {session}"
    else:
        res = _split_team_window(session, name, pane)
    if res.returncode != 0:
        return f"tmux team pane failed: {res.stderr.strip()}"
    pane_id = res.stdout.strip()
    _tmux("set-option", "-p", "-t", pane_id, "@atlas_worker", name)
    _tmux("set-option", "-p", "-t", pane_id, "@atlas_role", str(team.get("role") or ""))
    _tmux("select-pane", "-t", pane_id, "-T", f"{name} [{team.get('role') or ''}]")
    _relayout_team(session)
    dead = _tmux(
        "display-message", "-p", "-t", pane_id, "#{pane_dead} #{pane_dead_status}"
    )
    state = dead.stdout.split()
    if dead.returncode == 0 and len(state) == 2 and state[0] == "1" and state[1] != "0":
        return f"tmux team pane {name} died at spawn (exit {state[1]}); see .atlas/.run/logs/atlas_mux.log"
    return None


def _bg_log_tail(pid: str) -> str:
    """Recent terminal output of a running claude-bg worker (`claude logs <id>`, verified live:
    it streams while the agent runs and claude clears the buffer on exit — a finished worker's
    report reaches the board as its own note instead). Same tail shape as the pane capture."""
    res = _claude("logs", str(pid))
    if res.returncode != 0:
        return ""
    return _report(
        [t for t in res.stdout.splitlines() if t.strip() and not NOISE_RE.match(t)]
    )


def _todo_script() -> Path:
    """atlas_todo.py as the plugin root names it, symlinks NOT followed: resolve() turned the ~/.claude/plugins
    link into a source-tree path the worker's settings deny reading, so workers skipped the note protocol."""
    root = (os.environ.get("CLAUDE_PLUGIN_ROOT") or "").strip()
    if root and (Path(root) / "scripts" / "atlas_todo.py").is_file():
        return Path(root) / "scripts" / "atlas_todo.py"
    return Path(os.path.abspath(__file__)).with_name("atlas_todo.py")


def _bg_brief(prompt: str, root: str, name: str, chan: str, lead: str) -> str:
    """Task prompt + the board report contract. A pane worker gets its ONE report note posted by
    the run-worker wrapper watching its output; a claude-bg agent has no wrapper, so the note
    command travels in the brief itself (same C2 shape: report block, then the exit line). The
    note is the transport of record; when the lead exported ATLAS_LEAD_AGENT, one env-gated
    paragraph adds a best-effort SendMessage native wake (unset = byte-identical brief), and a
    truthy ATLAS_TASKS_MIRROR adds an opt-in TaskCreate board-mirror paragraph the same way."""
    todo = _todo_script()
    note_cmd = (
        f"python3 {todo} note --root {shlex.quote(root)} --channel {shlex.quote(chan)} "
        f"--owner {shlex.quote(name)} --to {shlex.quote(lead or 'lead')} --kind report "
        "'<report>'"
    )
    wake = ""
    if (os.environ.get("ATLAS_LEAD_AGENT") or "").strip():
        wake = (
            "If the env var ATLAS_LEAD_AGENT is set to your lead's session name and ListAgents "
            "shows it, send the same report text via SendMessage (to: that name) immediately "
            "after posting the note. Do not retry sends. Skip entirely when unset or not "
            "listed.\n\n"
        )
    mirror = ""
    if (os.environ.get("ATLAS_TASKS_MIRROR") or "").strip().lower() in (
        "1",
        "true",
        "on",
    ):
        mirror = (
            "If a TaskCreate tool is available to you, mirror the board item you claim: "
            'TaskCreate with subject "[<phase>] <content>" at claim time and mark it '
            "completed when you post your completion. The atlas board remains the source "
            "of truth; do not duplicate status updates beyond the one completion.\n\n"
        )
    return (
        f"{prompt}\n\n# Atlas worker report contract\n"
        "When the task ends, post exactly ONE report note to the atlas board by running this "
        "shell command, with <report> replaced by your STATUS..NEXT report block whose LAST line "
        "is `exit <code>` (`exit 0` on success, otherwise `exit 1 [failed: reason]`):\n\n"
        f"    {note_cmd}\n\n"
        f"{wake}"
        f"{mirror}"
        "Post no other notes to the board."
    )


def _spawn_claude_bg(args, root: str, chan: str, model, level, session: str) -> int:
    """claude-bg transport: `claude --bg` supervises the worker itself — no pane, no run-worker
    wrapper. Status/kill go through `claude agents --json` / `claude stop`."""
    prompt = Path(args.prompt_file).read_text(encoding="utf-8")
    lead = (os.environ.get("ATLAS_LEAD_NAME") or "").strip() or str(
        (atlas_todo.get_channel(root, chan) or {}).get("lead") or "lead"
    )
    argv = [
        "--bg",
        "--name",
        args.name,
        "--agent",
        f"atlas:{args.agent}",
        # accept cross-session inbound: the lead's SendMessage must not be parked on a
        # permission-class mismatch (the interactive lead runs the accepting side); the
        # allow rules cover the brief's two mandatory actions (board-note Bash call,
        # claude-mem MCP search) so an unattended worker never prompts on them
        "--settings",
        '{"crossSessionInbound":"accept","permissions":{"allow":'
        '["Bash(python3 *atlas_todo.py*)","mcp__claude_mem_mcp_search"]}}',
    ]
    if model:
        argv += ["--model", model]
    if level:
        argv += ["--effort", level]
    argv += [
        # unattended-safe by default: without a caller mode, dontAsk auto-denies prompts
        # (allow rules still run) instead of hanging; explicit --permission-mode passes through
        "--permission-mode",
        args.permission_mode or "dontAsk",
        _bg_brief(prompt, root, args.name, chan, lead),
    ]
    env = dict(clean_env(), ATLAS_PROJECT_ROOT=root, ATLAS_WORKER_NAME=args.name)
    env.update({k: os.environ[k] for k in FORWARDED_ENV if os.environ.get(k)})
    res = _claude(*argv, env=env, cwd=os.path.abspath(args.cwd) if args.cwd else root)
    found = _BG_ID_RE.search(res.stdout)
    if res.returncode != 0 or not found:
        atlas_todo.leave(root, chan, args.name)
        return _emit(
            {
                "ok": False,
                "error": (
                    res.stderr.strip()
                    or res.stdout.strip()
                    or f"claude --bg failed ({res.returncode})"
                ),
            },
            1,
        )
    agent_id = found.group(1)
    # the claude session id is a hex string: it goes in the string-handle slot (pid= would int() it)
    atlas_todo.set_member_handles(root, args.name, chan or None, pane_id=agent_id)
    return _emit(
        {
            "ok": True,
            "session": session,
            "name": args.name,
            "harness": args.harness,
            "agent": args.agent,
            "model": model,
            "level": level,
            "agent_id": agent_id,
            "transport": "claude-bg",
            "board": str(Path(root) / BOARD_REL / f"{args.name}.jsonl"),
        }
    )


def cmd_spawn(args) -> int:
    error = _validate(args)
    if error:
        return _emit({"ok": False, "error": error}, 2)
    root = os.path.abspath(
        args.root or os.environ.get("ATLAS_PROJECT_ROOT") or os.getcwd()
    )
    # Lead side: this process runs in the lead's env, so the worker joins the lead's channel
    # here; a worker never registers itself (an inherited env grants no membership).
    chan = atlas_todo.register_member(root, args.name)
    session = _session(args.run)
    model, level, _, tier_error = _tier(
        args.harness,
        args.agent,
        args.agents_dir,
        args.model,
        args.effort or args.thinking,
    )
    if tier_error:
        atlas_todo.leave(root, chan, args.name)
        return _emit({"ok": False, "error": tier_error}, 2)
    use = transport()
    if use == "claude-bg":
        if args.harness == "claude":
            return _spawn_claude_bg(args, root, chan, model, level, session)
        use = _pane_transport()  # claude --bg is claude-only: omp workers keep panes
    # Session creation, the name check and new-window run under one lock (_open_window):
    # parallel spawns of one run raced check-then-create and 7 of 8 failed.
    worker = [
        sys.executable,
        str(Path(__file__).resolve()),
        "run-worker",
        "--run",
        args.run,
        "--name",
        args.name,
        "--harness",
        args.harness,
        "--agent",
        args.agent,
        "--prompt-file",
        os.path.abspath(args.prompt_file),
        "--root",
        root,
        "--cwd",
        os.path.abspath(args.cwd) if args.cwd else root,
        # pane default stays acceptEdits (only the claude-bg transport defaults dontAsk)
        "--permission-mode",
        args.permission_mode or "acceptEdits",
    ]
    if args.agents_dir:
        worker += ["--agents-dir", args.agents_dir]
    if model:
        worker += ["--model", model]
    if level:
        worker += ["--effort" if args.harness == "claude" else "--thinking", level]
    # tmux panes inherit the tmux SERVER env, not this client's, so the test-only
    # override env var is forwarded as a flag.
    override = args.command_override or os.environ.get("ATLAS_MUX_WORKER_CMD")
    if override:
        worker += ["--command-override", override]
    # Same reason: the omp extension pin set in the lead's env would be lost, so it travels as a flag too.
    extension = args.omp_extension or os.environ.get("ATLAS_MUX_OMP_EXTENSION")
    if extension and args.harness == "omp":
        worker += ["--omp-extension", os.path.abspath(extension)]
    # Lead env a pane would silently lose, forwarded by name: ATLAS_DB (workers would write a different database) and
    # ATLAS_GATE (a gate the lead switched off would come back on). An allowlist, never a copy of the lead's environment.
    forwarded = [f"{k}={os.environ[k]}" for k in FORWARDED_ENV if os.environ.get(k)]
    pane = (
        "exec "
        + (shlex.join(["env", *forwarded]) + " " if forwarded else "")
        + shlex.join(worker)
    )
    if use == "herdr":
        # herdr panes get the board pins as well: run-worker re-pins them for the harness, the pane shell needs them
        # for anything the lead runs there (and for the hooks of a manually started harness).
        import atlas_seats

        pins = pane_env(root, args.name)
        made = atlas_seats.create_pane(
            args.name,
            pane_command(pins, worker),
            cwd=os.path.abspath(args.cwd) if args.cwd else root,
            run=args.run,
            env=pins,
        )
        failure = None if made["ok"] else made["reason"]
        if made["ok"]:
            atlas_todo.set_member_handles(
                root, args.name, chan or None, pane_id=made["pane_id"]
            )
    else:
        team = getattr(args, "team", None)
        failure = _open_window(
            session,
            args.name,
            pane,
            {"rec": team, "role": args.agent} if team else None,
        )
    if failure:
        atlas_todo.leave(root, chan, args.name)
        return _emit({"ok": False, "error": failure}, 1)
    return _emit(
        {
            "ok": True,
            "session": session,
            "name": args.name,
            "harness": args.harness,
            "agent": args.agent,
            "model": model,
            "level": level,
            "board": str(Path(root) / BOARD_REL / f"{args.name}.jsonl"),
        }
    )


def _classify(output: str, code: int) -> tuple[int, str | None]:
    """(recorded exit code, failure reason). Output evidence beats a zero exit."""
    for pattern, reason in FAIL_SIGNS:
        if pattern.search(output):
            return 1, reason
    if code != 0:
        return code, "nonzero exit"
    return 0, None


def cmd_run_worker(args) -> int:
    root = os.path.abspath(args.root)
    prompt = Path(args.prompt_file).read_text(encoding="utf-8")
    override = args.command_override or os.environ.get("ATLAS_MUX_WORKER_CMD")
    if override:
        argv = ["/bin/sh", "-c", override]
    else:
        model, level, body, tier_error = _tier(
            args.harness,
            args.agent,
            args.agents_dir,
            args.model,
            args.effort or args.thinking,
        )
        if tier_error:
            return _emit({"ok": False, "error": tier_error}, 2)
        argv = harness_argv(
            args.harness,
            args.agent,
            prompt,
            model,
            level,
            body,
            args.permission_mode,
            args.omp_extension,
            os.path.abspath(args.cwd or root),
        )
    env = dict(clean_env(), ATLAS_PROJECT_ROOT=root, ATLAS_WORKER_NAME=args.name)
    channel = (os.environ.get("ATLAS_CHANNEL") or "").strip()
    lead = (os.environ.get("ATLAS_LEAD_NAME") or "").strip()
    if not channel:
        mine = atlas_todo.channels_of(root, args.name)
        channel = mine[-1] if mine else ""
    if not lead and channel:
        lead = str((atlas_todo.get_channel(root, channel) or {}).get("lead") or "")
    lead = lead or "lead"
    log_path = Path(root) / ".atlas" / ".run" / "logs" / f"{args.name}.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log = log_path.open("w", encoding="utf-8")
    feed = atlas_panefeed.Feed(
        args.name,
        args.agent,
        args.run,
        channel,
        prompt,
        calls_file=log_path.with_suffix(".tool.json"),
    )

    def finish(code: int, tail: str, reason: str | None = None) -> int:
        """The ONE board note of this run: the report block + exit line (contract C2)."""
        feed.finish(code)
        exit_line = f"exit {code}" + (f" [failed: {reason}]" if reason else "")
        rec = atlas_todo.note(
            root,
            args.name,
            f"{tail}\n{exit_line}" if tail else exit_line,
            to=lead,
            channel=channel or None,
            kind="report",
        )
        home = rec.get("channel") or channel
        if home:
            atlas_todo.mark_finished(root, args.name, code)
            atlas_todo.leave(root, home, args.name)
        log.close()
        return code

    log.write(f"$ {shlex.join(argv)}\n")
    log.flush()
    # guaranteed start note: the board shows the worker even when the model skips its own
    try:
        atlas_todo.note(
            root,
            args.name,
            f"start: {args.agent} worker {args.name} running",
            to=lead,
            channel=channel or None,
            kind="start",
        )
    except OSError as exc:
        log.write(f"start note failed: {exc}\n")
    feed.start()
    try:
        proc = subprocess.Popen(
            argv,
            cwd=args.cwd or root,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except OSError as exc:
        log.write(f"spawn failed: {exc}\n")
        return finish(127, f"spawn failed: {exc}", "spawn error")
    atlas_todo.set_member_handles(root, args.name, channel or None, pid=proc.pid)
    assert proc.stdout is not None

    def _killed(signum, _frame):
        raise SystemExit(128 + signum)

    # tmux kill-window sends SIGHUP; kill/stop send SIGTERM. Without a handler the
    # worker dies silently and its board never shows an exit.
    for sig in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, _killed)
    lines: list[str] = []
    try:
        for raw in proc.stdout:
            log.write(raw if raw.endswith("\n") else raw + "\n")
            log.flush()
            lines += _feed_line(raw.rstrip("\n"), feed)
        # classify the harness output only: the STATUS..NEXT report is the worker's own prose
        # (it may cite `foo.py:402`) and must not trip the 402/401 signs
        head = lines[
            : next(
                (i for i, t in enumerate(lines) if t.startswith("STATUS:")), len(lines)
            )
        ]
        seen = [t for t in head if not NOISE_RE.match(t)]
        code, reason = _classify("\n".join(seen), proc.wait())
    except (SystemExit, KeyboardInterrupt) as exc:
        code = getattr(exc, "code", 130)
        code = code if isinstance(code, int) else 130
        proc.terminate()
        return finish(code, _report(lines), f"killed by signal {code - 128}")
    return finish(code, _report(lines), reason)


def _feed_line(text: str, feed=None) -> list[str]:
    """Show one worker output line in the pane feed; return the lines that count as the worker's output
    (report/classify input)."""
    feed = feed or atlas_panefeed.Feed(live=False)
    event = atlas_panefeed.parse_line(text)
    if event is None:
        feed.text(text)
        return [text] if text.strip() else []
    feed.event(event)
    if event.get("type") not in ("result", "agent_end"):
        return _omp_error_lines(event)
    body = atlas_panefeed.result_text(event)
    feed.report(body)
    return [t for t in body.splitlines() if t.strip()]


def _omp_error_lines(event: dict) -> list[str]:
    """omp json mode reports a failed model call as an assistant message_end with `errorMessage`; surface it
    as an output line so _classify still sees the 402/not-found signs the plain-text mode printed."""
    kind = event.get("type")
    item = event.get("item")
    if (
        kind == "item.completed"
        and isinstance(item, dict)
        and item.get("type") == "agent_message"
    ):
        # codex exec --json: every agent message is output; the last one carries the STATUS report
        return [t for t in str(item.get("text") or "").splitlines() if t.strip()]
    if kind in (
        "turn.failed",
        "error",
    ):  # classify sees 401/402/model-not-found in the failure text
        err = event.get("error") if isinstance(event.get("error"), dict) else event
        return [str(err.get("message") or "")]
    msg = event.get("message") if kind == "message_end" else None
    err = msg.get("errorMessage") if isinstance(msg, dict) else None
    return [err] if isinstance(err, str) and err.strip() else []


def _report(lines: list[str]) -> str:
    """Report block (first `STATUS:` line to the end), else the last 20 non-noise lines."""
    for i, t in enumerate(lines):
        if t.startswith("STATUS:"):
            return "\n".join(lines[i:])
    return "\n".join([t for t in lines if not NOISE_RE.match(t)][-20:])


def _board_exits(root: Path) -> list:
    board = []
    for path in sorted((root / BOARD_REL).glob("*.jsonl")):
        exit_code = None
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                m = (
                    EXIT_NOTE_RE.search(str(rec.get("text", "")))
                    if isinstance(rec, dict)
                    else None
                )
                if m:
                    exit_code = int(m.group(1))
        except OSError:
            continue
        board.append({"name": path.stem, "path": str(path), "exit": exit_code})
    return board


def cmd_status(args) -> int:
    session = _session(args.run)
    root = Path(
        os.path.abspath(
            args.root or os.environ.get("ATLAS_PROJECT_ROOT") or os.getcwd()
        )
    )
    use = transport()
    if use == "claude-bg":
        rows = _claude_workers(str(root)) or []
        # a running worker's terminal output: `claude logs <id>` (the pane transports capture it live)
        for w in rows:
            if not w["dead"] and w["pid"]:
                w["tail"] = _bg_log_tail(str(w["pid"]))
        # omp/pane workers of the same run still exist under a pane transport
        pane_use = _pane_transport()
        if pane_use == "herdr":
            import atlas_seats

            try:
                panes = [
                    {"name": p["label"], "dead": 0, "pid": p["pane_id"]}
                    for p in atlas_seats.list_panes(args.run)
                ]
            except Exception:  # seat backend unreachable
                panes = None
        else:
            panes = (
                _windows(session)
                if _tmux("has-session", "-t", session).returncode == 0
                else None
            )
        windows = rows + [
            w for w in (panes or []) if w["name"] not in ("lead", "Sidebar")
        ]
    elif use == "herdr":
        import atlas_seats

        try:
            windows = [
                {"name": p["label"], "dead": 0, "pid": p["pane_id"]}
                for p in atlas_seats.list_panes(args.run)
            ]
        except Exception:  # seat backend unreachable
            windows = None
    else:
        windows = (
            _windows(session)
            if _tmux("has-session", "-t", session).returncode == 0
            else None
        )
    workers = [w for w in (windows or []) if w["name"] not in ("lead", "Sidebar")]
    # a team's workers are tiled panes of one window, which `workers` (tmux windows) collapses to one row
    has_team = use != "herdr" and _tmux("has-session", "-t", session).returncode == 0
    panes = _team_pane_rows(session, str(root)) if has_team else []
    return _emit(
        {
            "ok": True,
            "run": args.run,
            "session_name": session,
            "transport": use,
            "tmux": use == "tmux" and windows is not None,
            "workers": workers,
            "panes": panes,
            "board": _board_exits(root),
        }
    )


def _exited(root: str, name: str) -> bool:
    """True when the worker's own last board note is an exit note."""
    mine = [r for r in atlas_todo.notes(root) if str(r.get("owner")) == name]
    return bool(mine) and bool(EXIT_NOTE_RE.search(str(mine[-1].get("text") or "")))


def _kill_notes(root: str, names) -> None:
    """Fallback exit for killed workers that never posted their own (SIGHUP/SIGTERM makes
    run-worker post it, so give those up to 2s first). Same C2 shape: report note to the
    worker's lead and channel, then mark_finished + leave."""
    deadline = time.time() + 2
    pending = [n for n in names if not _exited(root, n)]
    while pending and time.time() < deadline:
        time.sleep(0.1)
        pending = [n for n in pending if not _exited(root, n)]
    for name in pending:
        mine = atlas_todo.channels_of(root, name)
        chan = mine[-1] if mine else ""
        lead = str((atlas_todo.get_channel(root, chan) or {}).get("lead") or "lead")
        rec = atlas_todo.note(
            root,
            name,
            "exit 137 [failed: killed by atlas_mux kill]",
            to=lead,
            channel=chan or None,
            kind="report",
        )
        home = rec.get("channel") or chan
        if home:
            atlas_todo.mark_finished(root, name, 137)
            atlas_todo.leave(root, home, name)


def _stop_claude_bg(root: str) -> list:
    """`claude stop` every live claude-bg worker of `root`; returns the stopped names. The
    agents rows carry no run grouping, so the root is the kill scope (the same destructiveness
    class as herdr close_run / tmux kill-session)."""
    stopped = []
    for w in _claude_workers(root) or []:
        if w["dead"]:
            continue
        if _claude("stop", str(w["pid"])).returncode == 0:
            stopped.append(w["name"])
    return stopped


def cmd_kill(args) -> int:
    session = _session(args.run)
    root = os.path.abspath(
        args.root or os.environ.get("ATLAS_PROJECT_ROOT") or os.getcwd()
    )
    use = transport()
    configured = use
    stopped: list = []
    if use == "claude-bg":
        stopped = _stop_claude_bg(str(root))
        use = _pane_transport()  # panes of this run (omp workers) may still exist
    if use == "herdr":
        import atlas_seats

        res = atlas_seats.close_run(args.run)
        if not res["ok"]:
            if stopped:
                _kill_notes(root, stopped)
            return _emit(
                {
                    "ok": False,
                    "session_name": session,
                    "transport": configured,
                    "killed": bool(stopped),
                    "error": res["reason"],
                },
                1,
            )
        # a killed worker never writes its own exit: without one it reads as working forever
        _kill_notes(root, [*res["closed"], *stopped])
        return _emit(
            {
                "ok": True,
                "session_name": session,
                "transport": configured,
                "killed": bool(res["closed"]) or bool(stopped),
            }
        )
    if _tmux("has-session", "-t", session).returncode != 0:
        if stopped:
            _kill_notes(root, stopped)
        return _emit(
            {
                "ok": True,
                "session_name": session,
                "transport": configured,
                "killed": bool(stopped),
            }
        )
    victims = [w["name"] for w in _windows(session) or [] if w["name"] != "lead"]
    res = _tmux("kill-session", "-t", f"={session}")
    if res.returncode == 0:
        # a killed worker never writes its own exit: without one it reads as working forever
        _kill_notes(root, [*victims, *stopped])
    return _emit(
        {
            "ok": res.returncode == 0,
            "session_name": session,
            "transport": configured,
            "killed": res.returncode == 0 or bool(stopped),
            **({"error": res.stderr.strip()} if res.returncode else {}),
        },
        0 if res.returncode == 0 else 1,
    )


# ---- spawn-team / wait / reap: resolver-sized parallel worker teams -----------------------------------------------
TEAMS_REL = Path(".atlas") / ".run" / "teams"


def _sha(*parts) -> str:
    return hashlib.sha1("\x1f".join(map(str, parts)).encode()).hexdigest()


def build_team(
    task_class: str, effort: str, paths=None, task: str = "", team_id: str | None = None
) -> dict:
    """Deterministic team record: same (class, effort, paths, task) -> same ids and member names.
    `created` is the only non-deterministic field and is added by the caller."""
    cell = atlas_resolve.resolve(task_class, effort, paths)
    scope = cell["file_scope"]
    tid = team_id or "t" + _sha(task_class, effort, *scope, task)[:6]
    members = []
    for spec in cell["team"]:
        for i in range(int(spec["count"])):
            members.append(
                {
                    "name": f"{spec['role']}-{_sha(tid, spec['role'], i)[:4]}",
                    "role": spec["role"],
                    "tools_profile": spec.get("tools_profile"),
                }
            )
    return {
        "team_id": tid,
        "class": task_class,
        "effort": effort,
        "task": task,
        "file_scope": scope,
        "members": members,
        "max_parallel": int(cell["max_parallel"]),
        "isolation": cell["isolation"],
    }


def team_brief(rec: dict, member: dict, root: str, chan: str, lead: str) -> str:
    """Self-contained worker brief: task, scope, channel, peers, and the note protocol."""
    todo = _todo_script()
    peers = [m["name"] for m in rec["members"] if m["name"] != member["name"]]

    scope = ", ".join(rec["file_scope"]) or "(whole project; stay read-mostly)"
    me = member["name"]
    # explicit --root/--channel/--owner (as _bg_brief): pane env alone left workers posting to no channel
    qr, qc = shlex.quote(root), shlex.quote(chan)
    cmd = f"python3 {todo}"
    flags = f"--root {qr} --channel {qc}"
    return (
        f"You are {me} ({member['role']}), 1 of {len(rec['members'])} workers of team {rec['team_id']} "
        f"on {chan}. Lead: {lead}. Peers: {', '.join(peers) or '(none)'}.\n\n"
        f"# Task\n{rec['task']}\n\n# Scope\n{scope}\n\n"
        f"# Protocol\nPost (do not read the script): {cmd} note {flags} --owner {me} --to <who> '<text>'\n"
        f"Read: {cmd} notes --to {me} {flags}\n"
        f"1. After a first finding, note {lead}.\n"
        "2. Before finishing, note each peer once (found, changed, avoid).\n"
        "3. Reply once to any peer note.\n"
        "4. End with STATUS/FILES/EVIDENCE/DELIVERABLE/NEXT.\n"
    )


def _team_dir(root: str) -> Path:
    return Path(root) / TEAMS_REL


def supervise(rec: dict, spawn, is_done, sleep=time.sleep, poll_s: float = 1.0) -> list:
    """Start members under a max_parallel semaphore: never more than that many unfinished at once;
    the rest start as earlier ones exit. spawn(member)->dict(ok,...); is_done(name)->bool."""
    pending, live, results = list(rec["members"]), [], []
    # returns once the last member is started; `wait` covers the remaining runtime
    while pending:
        live = [n for n in live if not is_done(n)]
        while pending and len(live) < rec["max_parallel"]:
            m = pending.pop(0)
            res = spawn(m)
            results.append({"name": m["name"], **res})
            if res.get("ok"):
                live.append(m["name"])
        if pending:
            sleep(poll_s)
    return results


SESSION_ENV = ("CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID", "ATLAS_SESSION_ID")


def _lead_run(root: str, session: str | None) -> tuple:
    """(run_id, session_id) of the lead: --session, else the session env Claude Code exports, else the
    project's latest run (open first). (None, None) when nothing matches. Fail-open."""
    try:
        import atlas_db

        sid = session or next(
            (os.environ[k] for k in SESSION_ENV if os.environ.get(k)), None
        )
        conn = atlas_db.connect()
        try:
            if sid:
                return atlas_db.current_or_last_run_id(conn, sid), sid
            # An omp lead exports no session id. Worker sessions register runs in the same project too, so
            # prefer a run whose session owns a lead-<sid6> channel (lead sessions open one, workers never do).
            # ponytail: with two live leads in one project the newest wins; pass --session to be exact.
            rows = conn.execute(
                "SELECT r.id, r.session_id FROM runs r JOIN projects p ON p.id=r.project_id "
                "WHERE p.root_path=? ORDER BY (r.ended_at IS NULL) DESC, r.id DESC LIMIT 50",
                (root,),
            ).fetchall()
            leads = {
                c.get("lead")
                for c in atlas_todo._reg_read(root).get("channels", {}).values()
                if c.get("kind") == "lead"
            }
            row = next(
                (
                    r
                    for r in rows
                    if f"lead-{atlas_todo._sanitize_owner(r[1])[:6]}" in leads
                ),
                rows[0] if rows else None,
            )
            return (row[0], row[1]) if row else (None, None)
        finally:
            conn.close()
    except Exception:
        return None, None


def _team_lead(session_id: str | None, team_id: str) -> str:
    """The team's lead name, which names its channel `<main>/<lead>`: ATLAS_LEAD_NAME, else lead-<sid6>,
    else lead-<team_id>. Never the bare shared `lead`, where every session's notes mix."""
    name = atlas_todo.lead_name(session_id)
    return name if name != "lead" else f"lead-{team_id}"


def _log_wave(rec: dict, run_id, results=()) -> bool:
    """One dispatches row per member with wave_id=team_id (a TEXT column) and the
    model its spawn resolved (`results`, from supervise). Idempotent per (run, team, member): the table
    has no member column, so a role's existing rows fill its first slots (member names are deterministic
    per team id, live-230 logged t1ad516 4x on respawns). Fail-open."""
    if run_id is None:
        return False
    try:
        import atlas_db

        models = {r.get("name"): r.get("model") for r in results}
        conn = atlas_db.connect()
        try:
            have = dict(
                conn.execute(
                    "SELECT agent_type, COUNT(*) FROM dispatches WHERE run_id=? AND wave_id=? GROUP BY agent_type",
                    (run_id, rec["team_id"]),
                ).fetchall()
            )
            for m in rec["members"]:
                agent = f"atlas:{m['role']}"
                if have.get(agent, 0) > 0:
                    have[agent] -= 1
                    continue
                atlas_db.log_dispatch(
                    conn, run_id, agent, models.get(m["name"]), rec["team_id"]
                )
            conn.commit()
        finally:
            conn.close()
        return True
    except Exception:
        return False


def _root(args) -> str:
    return os.path.abspath(
        args.root or os.environ.get("ATLAS_PROJECT_ROOT") or os.getcwd()
    )


def _team_thinking(harness: str, role: str) -> str | None:
    """omp team member --thinking: the role's Claude `effort:` so one team runs one tier on both harnesses. The omp
    definition's thinkingLevel is the `task`-sub tier and is "off" for explorer-class roles, which left omp team
    members thinking-off while the same Claude team ran at low. None for claude (its definition already applies)."""
    if harness != "omp":
        return None
    return (
        _frontmatter(_agents_dir("claude", None) / f"{role}.md")[0].get("effort")
        or None
    )


def cmd_spawn_team(args) -> int:
    root = _root(args)
    task = (
        Path(args.task_file).read_text(encoding="utf-8")
        if args.task_file
        else (args.task or "")
    )
    paths = args.paths.split(",") if args.paths else None
    try:
        rec = build_team(args.cls, args.effort, paths, task, args.team_id)
    except ValueError as exc:
        return _emit({"ok": False, "error": str(exc)}, 2)
    if not NAME_RE.match(rec["team_id"]):
        return _emit({"ok": False, "error": f"invalid team id {rec['team_id']!r}"}, 2)
    if args.dry_run:
        return _emit({"ok": True, "dry_run": True, "team": rec})
    path = _team_dir(root) / f"{rec['team_id']}.json"
    if path.exists():
        return _emit(
            {
                "ok": False,
                "error": f"team {rec['team_id']} exists; reap it or pass --team-id",
            },
            1,
        )
    # tmux when installed gives a visible window per worker; ATLAS_COLONY_TRANSPORT still overrides.
    note = None
    if not os.environ.get("ATLAS_COLONY_TRANSPORT", "").strip():
        if shutil.which("tmux"):
            os.environ["ATLAS_COLONY_TRANSPORT"] = "tmux"
        else:
            note = "tmux not on PATH: fell back to claude-bg"
    os.environ["ATLAS_MUX"] = (
        "tmux"  # spawn-team is the explicit opt-in cmd_spawn checks for
    )
    run_id, sid = _lead_run(root, args.session)
    lead = _team_lead(sid, rec["team_id"])
    chan = atlas_todo.open_lead_channel(root, lead, [])["name"]
    os.environ["ATLAS_CHANNEL"] = chan
    os.environ["ATLAS_LEAD_NAME"] = lead
    rec["channel"], rec["transport"], rec["lead"] = chan, transport(), lead
    rec["created"] = time.time()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rec, indent=1, sort_keys=True), encoding="utf-8")
    members = ", ".join(f"{m['name']} ({m['role']})" for m in rec["members"])
    headline = (rec["task"].strip().splitlines() or [""])[0][:120]
    kickoff = f"kickoff {rec['team_id']}: {headline} | members: {members} | scope: {', '.join(rec['file_scope']) or 'whole project'}"
    atlas_todo.note(root, lead, kickoff, to="all", channel=chan, kind="kickoff")

    def spawn(member: dict) -> dict:
        pf = path.parent / f"{rec['team_id']}-{member['name']}.prompt"
        pf.write_text(team_brief(rec, member, root, chan, lead), encoding="utf-8")
        ns = argparse.Namespace(
            run=rec["team_id"],
            name=member["name"],
            harness=args.harness,
            agent=member["role"],
            prompt_file=str(pf),
            model=None,
            effort=None,
            thinking=_team_thinking(args.harness, member["role"]),
            agents_dir=None,
            permission_mode=None,
            command_override=None,
            omp_extension=None,
            root=root,
            cwd=None,
            team=rec,
        )
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            cmd_spawn(ns)
        try:
            return json.loads(buf.getvalue().strip().splitlines()[-1])
        except (ValueError, IndexError):
            return {"ok": False, "error": buf.getvalue().strip()[-200:]}

    results = supervise(rec, spawn, lambda n: _exited(root, n), poll_s=args.poll)
    wave_logged = _log_wave(
        rec, run_id, results
    )  # after spawn: each member's resolved model is known
    return _emit(
        {
            "ok": all(r.get("ok") for r in results),
            "team_id": rec["team_id"],
            "session": _session(rec["team_id"]),
            "transport": rec["transport"],
            "transport_note": note,
            "wave_logged": wave_logged,
            "run_id": run_id,
            "channel": chan,
            "max_parallel": rec["max_parallel"],
            "members": results,
        }
    )


def _load_team(root: str, team_id: str) -> dict | None:
    try:
        return json.loads(
            (_team_dir(root) / f"{team_id}.json").read_text(encoding="utf-8")
        )
    except (OSError, ValueError):
        return None


def cmd_wait(args) -> int:
    root = _root(args)
    rec = _load_team(root, args.team)
    if rec is None:
        return _emit({"ok": False, "error": f"no team record for {args.team}"}, 1)
    names = [m["name"] for m in rec["members"]]
    t0 = time.time()

    def dead_silent() -> set:
        # a pane whose process is gone with no exit note will never report; do not wait out the timeout for it
        if rec.get("transport") in ("claude-bg", "herdr"):
            return set()
        return {
            p["name"]
            for p in _team_panes(_session(rec["team_id"]))
            if p["dead"] and not _exited(root, p["name"])
        }

    while time.time() - t0 < args.timeout:
        silent = dead_silent()
        if all(_exited(root, n) or n in silent for n in names):
            break
        time.sleep(args.poll)
    silent = dead_silent()
    allnotes = atlas_todo.notes(root)
    members, w2w = [], 0
    for n in names:
        mine = [r for r in allnotes if str(r.get("owner")) == n]
        text = str(mine[-1].get("text") or "") if mine else ""
        found = EXIT_NOTE_RE.search(text)
        status = next((l for l in text.splitlines() if l.startswith("STATUS:")), None)
        w2w += sum(1 for r in mine if r.get("to") in names and r.get("to") != n)
        members.append(
            {
                "name": n,
                "exit": int(found.group(1)) if found else None,
                "dead_without_report": n in silent and not found,
                "duration_s": round(float(mine[-1]["ts"]) - rec["created"], 1)
                if found
                else None,
                "last_status": status,
            }
        )
    finished = all(m["exit"] is not None for m in members)
    return _emit(
        {
            "ok": finished,
            "team_id": rec["team_id"],
            "members": members,
            "notes_worker_to_worker": w2w,
            "elapsed_s": round(time.time() - t0, 1),
        },
        0 if finished else 1,
    )


def _recover_team(root: str, team_id: str) -> dict | None:
    """A team with no live record: members from the per-member prompt files spawn-team wrote and the
    windows of atlas-<team>. None when no trace is left."""
    # ponytail: team "peer" also matches peer-sync's prompts; team ids are hashes or explicit, so rare
    names = {
        p.name[len(team_id) + 1 : -len(".prompt")]
        for p in _team_dir(root).glob(f"{team_id}-*.prompt")
    }
    windows = _windows(_session(team_id)) or []
    names |= {
        w["name"] for w in windows if w["name"] not in ("lead", _session(team_id))
    }
    names |= {p["name"] for p in _team_panes(_session(team_id))}
    if not names and not windows:
        return None
    return {
        "team_id": team_id,
        "members": [{"name": n} for n in sorted(names)],
        "transport": "tmux",
    }


def _release_team_channel(root: str, rec: dict) -> None:
    """The team channel is the lead's own session channel (_team_lead), and the lead's member row carries no exit
    until its SessionEnd, so reap_channels never found it dead while the lead lived (omp live: channels_reaped 0).
    Once every other member has exited, the lead leaves it so the reap below archives and closes it; a still-running
    member (a `task` sub on the same channel) keeps the lead in and the channel open. The next open re-adds the lead."""
    name, lead = rec.get("channel"), rec.get("lead")
    chan = atlas_todo.get_channel(root, name) if name and lead else None
    others = [m for m in (chan or {}).get("members", []) if m.get("name") != lead]
    if others and all("exit_code" in m for m in others):
        atlas_todo.leave(root, name, lead)


def _post_wrapup(root: str, rec: dict) -> None:
    """One lead wrap-up note on the team channel: each member's exit code, duration and notes posted."""
    chan, lead = rec.get("channel"), rec.get("lead")
    if not (chan and lead):
        return
    allnotes = atlas_todo.notes(root)
    parts = []
    for m in rec["members"]:
        mine = [r for r in allnotes if str(r.get("owner")) == m["name"]]
        found = EXIT_NOTE_RE.search(str(mine[-1].get("text") or "")) if mine else None
        secs = (
            f" {round(float(mine[-1]['ts']) - rec['created'])}s"
            if found and rec.get("created")
            else ""
        )
        parts.append(
            f"{m['name']} exit {found.group(1) if found else '?'}{secs} {len(mine)} notes"
        )
    atlas_todo.note(
        root,
        lead,
        f"wrap-up {rec['team_id']}: " + "; ".join(parts),
        to="all",
        channel=chan,
        kind="wrapup",
    )


def cmd_reap(args) -> int:
    root = _root(args)
    if not NAME_RE.match(args.team or ""):
        return _emit({"ok": False, "error": f"invalid team id {args.team!r}"}, 2)
    arch = _team_dir(root) / "archive"
    archived_path = arch / f"{args.team}.json"
    rec, state = _load_team(root, args.team), "live"
    if rec is None:
        # reap is idempotent: an archived team still gets its leftover session and prompts cleaned
        try:
            rec, state = (
                json.loads(archived_path.read_text(encoding="utf-8")),
                "archived",
            )
        except (OSError, ValueError):
            rec, state = _recover_team(root, args.team), "recovered"
        if rec is None:
            return _emit(
                {
                    "ok": False,
                    "error": f"no team record, prompts or session for {args.team}",
                },
                1,
            )
    session = _session(rec["team_id"])
    names = [m["name"] for m in rec["members"]]
    killed = False
    # scope is this team's own session/agents only (cmd_kill's claude-bg path stops every worker of the root)
    if rec.get("transport") == "claude-bg":
        for w in _claude_workers(root) or []:
            if w["name"] in names and not w["dead"]:
                killed = _claude("stop", str(w["pid"])).returncode == 0 or killed
    elif rec.get("transport") == "herdr":
        import atlas_seats

        killed = bool(atlas_seats.close_run(rec["team_id"]).get("ok"))
    elif _tmux("has-session", "-t", session).returncode == 0:
        killed = _tmux("kill-session", "-t", f"={session}").returncode == 0
    _kill_notes(
        root, names
    )  # exit note + mark_finished + leave for any worker that never posted its own
    for n in (
        names
    ):  # a member the lead channel still lists without an exit: finish it, then drop it
        for c in atlas_todo.channels_of(root, n):
            if not any(
                "exit_code" in m
                for m in (atlas_todo.get_channel(root, c) or {}).get("members", [])
                if m["name"] == n
            ):
                atlas_todo.mark_finished(root, n, 137)
            atlas_todo.leave(root, c, n)
    if (
        state == "live"
    ):  # an archived or recovered team already got (or never had) a wrap-up
        _post_wrapup(root, rec)
    _release_team_channel(root, rec)
    reaped = atlas_todo.reap_channels(root)
    if state == "live":
        arch.mkdir(parents=True, exist_ok=True)
        (_team_dir(root) / f"{rec['team_id']}.json").replace(archived_path)
    prompts = [_team_dir(root) / f"{rec['team_id']}-{n}.prompt" for n in names]
    removed = 0
    for p in prompts:
        if p.exists():
            p.unlink()
            removed += 1
    return _emit(
        {
            "ok": True,
            "team_id": rec["team_id"],
            "record": state,
            "already_reaped": state == "archived",
            "members": names,
            "session": session,
            "killed": killed,
            "session_left": _tmux("has-session", "-t", session).returncode == 0,
            "channels_reaped": reaped.get("reaped"),
            "prompts_removed": removed,
            "archived": str(archived_path) if state != "recovered" else None,
        }
    )


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="atlas_mux", description=(__doc__ or "").split("\n\n")[0]
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    def worker_opts(sp, internal=False, permission_default: str | None = "acceptEdits"):
        sp.add_argument("--run", required=True)
        sp.add_argument("--name", required=True)
        sp.add_argument("--harness", choices=("claude", "omp", "codex"), required=True)
        sp.add_argument("--agent", required=True, help="atlas role, e.g. implementer")
        sp.add_argument("--prompt-file", required=True)
        sp.add_argument(
            "--model",
            help="override the definition's model (for omp an @role alias resolves via modelRoles); with no usable definition it must be paired with --effort/--thinking",
        )
        sp.add_argument(
            "--effort", help="claude only: override the definition's effort"
        )
        sp.add_argument(
            "--thinking", help="omp only: override the definition's thinkingLevel"
        )
        sp.add_argument(
            "--agents-dir",
            help="dir holding claude/ and omp/ agent definitions (tests)",
        )
        sp.add_argument(
            "--permission-mode",
            default=permission_default,
            help="claude --permission-mode (default acceptEdits; claude-bg spawns default dontAsk)",
        )
        sp.add_argument(
            "--command-override", help="test-only: shell command replacing the harness"
        )
        sp.add_argument(
            "--omp-extension",
            help="omp only: pin the worker to this atlas extension dir/file with "
            "--no-extensions --extension=<path> (default env ATLAS_MUX_OMP_EXTENSION; unset = whichever atlas omp has installed)",
        )
        sp.add_argument(
            "--root",
            required=internal,
            help="project root (default ATLAS_PROJECT_ROOT or cwd)",
        )
        sp.add_argument("--cwd", help="harness working directory (default: --root)")

    # no --permission-mode default: the spawn transport decides (claude-bg: dontAsk so an
    # unattended worker auto-denies instead of hanging; pane workers: acceptEdits in cmd_spawn)
    worker_opts(
        sub.add_parser("spawn", help="start one worker window"),
        permission_default=None,
    )
    worker_opts(
        sub.add_parser("run-worker", help="internal: the pane command"), internal=True
    )
    st = sub.add_parser(
        "spawn-team", help="resolver-sized team of parallel tmux workers"
    )
    st.add_argument("--class", dest="cls", required=True)
    st.add_argument("--effort", required=True)
    st.add_argument("--paths", help="comma-separated file scope")
    st.add_argument("--task")
    st.add_argument("--task-file")
    st.add_argument("--team-id")
    st.add_argument(
        "--session", help="lead session id for wave attribution and the team channel"
    )
    st.add_argument("--harness", choices=("claude", "omp", "codex"), default="claude")
    st.add_argument("--dry-run", action="store_true")
    st.add_argument("--root")
    st.add_argument("--poll", type=float, default=1.0)
    for name in ("wait", "reap"):
        sp = sub.add_parser(name)
        sp.add_argument("--team", required=True)
        sp.add_argument("--root")
        sp.add_argument("--timeout", type=float, default=600)
        sp.add_argument("--poll", type=float, default=1.0)
    for name in ("status", "kill"):
        sp = sub.add_parser(name)
        if name == "status":
            g = sp.add_mutually_exclusive_group(required=True)
            g.add_argument("--run", dest="run")
            g.add_argument("--team", dest="run")  # a team id is its run id
        else:
            sp.add_argument("--run", required=True)
        sp.add_argument("--root")
    return p


def main(argv=None) -> int:
    args = _parser().parse_args(argv)
    try:
        return {
            "spawn": cmd_spawn,
            "run-worker": cmd_run_worker,
            "spawn-team": cmd_spawn_team,
            "wait": cmd_wait,
            "reap": cmd_reap,
            "status": cmd_status,
            "kill": cmd_kill,
        }[args.cmd](args)
    except Exception as exc:  # report, never traceback-dump into the pane
        return _emit({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, 1)


if __name__ == "__main__":
    raise SystemExit(main())
