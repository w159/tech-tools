#!/usr/bin/env python3
"""atlas_mux -- opt-in colony mode (ATLAS_MUX=tmux); workers run as panes of a herdr workspace.

Transport: claude-bg by default for claude workers — `claude --bg --name <worker> --agent atlas:<role>` runs the
harness itself as a supervised background agent (status via `claude agents --json`, kill via `claude stop`; the
worker's ONE report note contract travels in the composed brief, since no run-worker wrapper watches the output).
ATLAS_COLONY_TRANSPORT=herdr|tmux forces a pane transport. omp workers always run as panes (claude --bg is
claude-only): herdr when its server is up, else tmux (session `atlas-<run>`, one window per worker).
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

Subcommands: spawn | status | kill | run-worker (internal: the pane command).
Test-only: --command-override / ATLAS_MUX_WORKER_CMD replaces the harness
command inside run-worker (stub workers for smoke runs).
Stdlib only. Prints one JSON object per invocation.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import signal
import subprocess
import time
import sys
import tempfile
from pathlib import Path

import atlas_todo

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_AGENT_DIRS = {
    "claude": PLUGIN_ROOT / "agents",
    "omp": PLUGIN_ROOT / "omp" / "agents",
}
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


def _tmux(*args: str) -> subprocess.CompletedProcess:
    """Run tmux with a bounded wait. A missing binary or a wedged server comes back as a failed
    CompletedProcess (127 / 124) with a stderr reason, never an exception or a hang."""
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


def transport() -> str:
    """'claude-bg' (the default), or the pane transport forced via ATLAS_COLONY_TRANSPORT=herdr|tmux."""
    forced = os.environ.get("ATLAS_COLONY_TRANSPORT", "").strip().lower()
    return forced if forced in ("herdr", "tmux", "claude-bg") else "claude-bg"


def _pane_transport() -> str:
    """'herdr' when the herdr server is up, else 'tmux' — for workers that must run as panes
    (omp has no claude --bg equivalent; interactive launches always need a pane)."""
    import atlas_herdr

    return "herdr" if atlas_herdr._server_up() else "tmux"


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
    def_path = _agents_dir(harness, agents_dir) / f"{role}.md"
    fields, body = _frontmatter(def_path)
    flag = "--effort" if harness == "claude" else "--thinking"
    fm_level = fields.get("effort" if harness == "claude" else "thinkingLevel") or None
    config: Path | None = None
    patterns: list = []
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
) -> list:
    if harness == "claude":
        argv = ["claude", "-p", "--agent", f"atlas:{role}"]
        if model:
            argv += ["--model", model]
        if level:
            argv += ["--effort", level]
        return argv + ["--permission-mode", permission_mode, prompt]
    argv = ["omp", "-p"]
    if model:
        argv.append(f"--model={model}")
    if level:
        argv.append(f"--thinking={level}")
    if omp_extension:
        # Pin the worker to one atlas tree. Without this a worker loads whichever atlas omp has installed, which
        # can be an older release than the lead's. --no-extensions keeps discovery from loading a second copy.
        argv += ["--no-extensions", f"--extension={omp_extension}"]
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
    if args.harness == "omp" and args.effort:
        return "--effort is a claude flag; omp workers take --thinking"
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


def _open_window(session: str, name: str, pane: str) -> str | None:
    """Create the session when missing and open window `name` in it; an error string or None.

    Serialised per session by a lock file; a "duplicate session" from tmux (another process
    created it first) just means the session exists."""
    lock = Path(tempfile.gettempdir()) / f"atlas-mux-{session}"
    with atlas_todo._file_lock(lock):
        if _tmux("has-session", "-t", session).returncode != 0:
            created = _tmux("new-session", "-d", "-s", session, "-n", "lead")
            if created.returncode != 0 and "duplicate session" not in created.stderr:
                return f"tmux new-session failed: {created.stderr.strip()}"
            _tmux("set-option", "-t", session, "remain-on-exit", "off")
        elif any(w["name"] == name for w in _windows(session) or []):
            return f"name_taken: {name} already runs in {session}"
        res = _tmux("new-window", "-d", "-t", session, "-n", name, pane)
        if res.returncode != 0:
            return f"tmux new-window failed: {res.stderr.strip()}"
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


def _bg_brief(prompt: str, root: str, name: str, chan: str, lead: str) -> str:
    """Task prompt + the board report contract. A pane worker gets its ONE report note posted by
    the run-worker wrapper watching its output; a claude-bg agent has no wrapper, so the note
    command travels in the brief itself (same C2 shape: report block, then the exit line). The
    note is the transport of record; when the lead exported ATLAS_LEAD_AGENT, one env-gated
    paragraph adds a best-effort SendMessage native wake (unset = byte-identical brief), and a
    truthy ATLAS_TASKS_MIRROR adds an opt-in TaskCreate board-mirror paragraph the same way."""
    todo = Path(__file__).resolve()
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
        import atlas_herdr

        pins = pane_env(root, args.name)
        made = atlas_herdr.create_pane(
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
        failure = _open_window(session, args.name, pane)
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

    def finish(code: int, tail: str, reason: str | None = None) -> int:
        """The ONE board note of this run: the report block + exit line (contract C2)."""
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
            text = raw.rstrip("\n")
            print(text, flush=True)
            log.write(raw if raw.endswith("\n") else raw + "\n")
            log.flush()
            if text.strip():
                lines.append(text)
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
            import atlas_herdr

            try:
                panes = [
                    {"name": p["label"], "dead": 0, "pid": p["pane_id"]}
                    for p in atlas_herdr.list_panes(args.run)
                ]
            except atlas_herdr.HerdrSockError:
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
        import atlas_herdr

        try:
            windows = [
                {"name": p["label"], "dead": 0, "pid": p["pane_id"]}
                for p in atlas_herdr.list_panes(args.run)
            ]
        except atlas_herdr.HerdrSockError:
            windows = None
    else:
        windows = (
            _windows(session)
            if _tmux("has-session", "-t", session).returncode == 0
            else None
        )
    workers = [w for w in (windows or []) if w["name"] not in ("lead", "Sidebar")]
    return _emit(
        {
            "ok": True,
            "run": args.run,
            "session_name": session,
            "transport": use,
            "tmux": use == "tmux" and windows is not None,
            "workers": workers,
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
        import atlas_herdr

        res = atlas_herdr.close_run(args.run)
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
    res = _tmux("kill-session", "-t", session)
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


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="atlas_mux", description=(__doc__ or "").split("\n\n")[0]
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    def worker_opts(sp, internal=False, permission_default: str | None = "acceptEdits"):
        sp.add_argument("--run", required=True)
        sp.add_argument("--name", required=True)
        sp.add_argument("--harness", choices=("claude", "omp"), required=True)
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
    for name in ("status", "kill"):
        sp = sub.add_parser(name)
        sp.add_argument("--run", required=True)
        sp.add_argument("--root")
    return p


def main(argv=None) -> int:
    args = _parser().parse_args(argv)
    try:
        return {
            "spawn": cmd_spawn,
            "run-worker": cmd_run_worker,
            "status": cmd_status,
            "kill": cmd_kill,
        }[args.cmd](args)
    except Exception as exc:  # report, never traceback-dump into the pane
        return _emit({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, 1)


if __name__ == "__main__":
    raise SystemExit(main())
