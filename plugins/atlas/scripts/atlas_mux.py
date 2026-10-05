#!/usr/bin/env python3
"""atlas_mux -- opt-in tmux colony mode (ATLAS_MUX=tmux).

Each worker runs as its own headless harness process in a window of one tmux
session `atlas-<run>`, at the cost tier its agent definition declares:

  claude: claude -p --agent atlas:<role> --model <m> --effort <e> --permission-mode <p> <prompt>
          (tier from plugins/atlas/agents/<role>.md `model:` / `effort:`)
  omp:    omp -p --model=<concrete> --thinking=<t> <role brief + prompt>
          (tier from plugins/atlas/omp/agents/<role>.md `model:` list / `thinkingLevel:`;
          omp has no --agent flag, so the role's body is prepended to the prompt.
          The first model pattern that resolves wins; an @role alias resolves to the
          CONCRETE selector under modelRoles in ~/.omp/agent/config.yml
          (ATLAS_MUX_OMP_CONFIG overrides the path) and that selector is what omp gets)

Tier enforcement: spawn refuses (ok:false, exit 2, before any tmux call) when the
role's definition is missing or yields no model, unless the caller passes an explicit
--model AND the harness tier flag (--effort claude | --thinking omp). An omp --model
(or definition pattern list) that resolves to nothing is always refused.

Workers share the lead's board: ATLAS_PROJECT_ROOT=<root> and
ATLAS_WORKER_NAME=<name> are pinned in the worker env. atlas_todo.note is the single
writer of <root>/.atlas/.run/board/<name>.jsonl: run-worker posts, all to "lead",
the exact harness argv (shlex-quoted, so the tier is auditable) first, then every
output line (stderr merged into stdout), then `exit <code>` (+ ` [failed: reason]`).
`omp -p` exits 0 on `Model "..." not found` and on HTTP 402, so output matching
not-found / 402 / credit / auth patterns is classified failed and recorded as exit 1
(`Warning: MCP server ... its tools are unavailable` lines are posted but not scanned).
`atlas_todo.py notes --to lead` reads them alongside the workers' own
`atlas_todo.py note --owner <name>` messages.

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
import subprocess
import sys
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
)
# omp prints one of these per unreachable MCP server; the run itself is fine.
NOISE_RE = re.compile(r"^Warning: MCP server .* its tools are unavailable")
EXIT_NOTE_RE = re.compile(r"^exit (-?\d+)")
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


def _tmux(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["tmux", *args], capture_output=True, text=True)


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
            fields[m.group(1)] = m.group(2).strip()
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
    return int(raw) if raw.isdigit() else 0


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


def cmd_spawn(args) -> int:
    error = _validate(args)
    if error:
        return _emit({"ok": False, "error": error}, 2)
    root = os.path.abspath(
        args.root or os.environ.get("ATLAS_PROJECT_ROOT") or os.getcwd()
    )
    session = _session(args.run)
    model, level, _, tier_error = _tier(
        args.harness,
        args.agent,
        args.agents_dir,
        args.model,
        args.effort or args.thinking,
    )
    if tier_error:
        return _emit({"ok": False, "error": tier_error}, 2)
    if _tmux("has-session", "-t", session).returncode != 0:
        created = _tmux("new-session", "-d", "-s", session, "-n", "lead")
        if created.returncode != 0:
            return _emit(
                {
                    "ok": False,
                    "error": f"tmux new-session failed: {created.stderr.strip()}",
                },
                1,
            )
        _tmux("set-option", "-t", session, "remain-on-exit", "off")
    else:
        live = _windows(session) or []
        if any(w["name"] == args.name for w in live):
            return _emit(
                {
                    "ok": False,
                    "error": f"name_taken: {args.name} already runs in {session}",
                },
                1,
            )
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
        "--permission-mode",
        args.permission_mode,
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
    res = _tmux("new-window", "-d", "-t", session, "-n", args.name, pane)
    if res.returncode != 0:
        return _emit(
            {"ok": False, "error": f"tmux new-window failed: {res.stderr.strip()}"}, 1
        )
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
    env = dict(os.environ, ATLAS_PROJECT_ROOT=root, ATLAS_WORKER_NAME=args.name)

    def post(text: str) -> None:
        atlas_todo.note(root, args.name, text, to="lead")

    post(shlex.join(argv))
    try:
        proc = subprocess.Popen(
            argv,
            cwd=root,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
    except OSError as exc:
        post(f"spawn failed: {exc}")
        post("exit 127 [failed: spawn error]")
        return 127
    assert proc.stdout is not None
    seen = []
    for raw in proc.stdout:
        text = raw.rstrip("\n")
        print(text, flush=True)
        if text.strip():
            if not NOISE_RE.match(text):
                seen.append(text)
            post(text)
    code, reason = _classify("\n".join(seen), proc.wait())
    post(f"exit {code}" + (f" [failed: {reason}]" if reason else ""))
    return code


def cmd_status(args) -> int:
    session = _session(args.run)
    root = Path(
        os.path.abspath(
            args.root or os.environ.get("ATLAS_PROJECT_ROOT") or os.getcwd()
        )
    )
    windows = (
        _windows(session)
        if _tmux("has-session", "-t", session).returncode == 0
        else None
    )
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
                    EXIT_NOTE_RE.match(str(rec.get("text", "")))
                    if isinstance(rec, dict)
                    else None
                )
                if m:
                    exit_code = int(m.group(1))
        except OSError:
            continue
        board.append({"name": path.stem, "path": str(path), "exit": exit_code})
    workers = [w for w in (windows or []) if w["name"] != "lead"]
    return _emit(
        {
            "ok": True,
            "run": args.run,
            "session_name": session,
            "tmux": windows is not None,
            "workers": workers,
            "board": board,
        }
    )


def cmd_kill(args) -> int:
    session = _session(args.run)
    if _tmux("has-session", "-t", session).returncode != 0:
        return _emit({"ok": True, "session_name": session, "killed": False})
    res = _tmux("kill-session", "-t", session)
    return _emit(
        {
            "ok": res.returncode == 0,
            "session_name": session,
            "killed": res.returncode == 0,
            **({"error": res.stderr.strip()} if res.returncode else {}),
        },
        0 if res.returncode == 0 else 1,
    )


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="atlas_mux", description=(__doc__ or "").split("\n\n")[0]
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    def worker_opts(sp, internal=False):
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
            default="acceptEdits",
            help="claude --permission-mode (default acceptEdits)",
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

    worker_opts(sub.add_parser("spawn", help="start one worker window"))
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
