#!/usr/bin/env python3
"""atlas_mux -- opt-in tmux colony mode (ATLAS_MUX=tmux).

Each worker runs as its own headless harness process in a window of one tmux
session `atlas-<run>`, at the cost tier its agent definition declares:

  claude: claude -p --agent atlas:<role> --model <m> --effort <e> --permission-mode <p> <prompt>
          (tier from plugins/atlas/agents/<role>.md `model:` / `effort:`)
  omp:    omp -p --model=<m> --thinking=<t> <role brief + prompt>
          (tier from plugins/atlas/omp/agents/<role>.md `model:` list / `thinkingLevel:`;
          omp has no --agent flag, so the role's body is prepended to the prompt,
          and the first model pattern whose @role alias is configured is used)

Workers share the lead's board: ATLAS_PROJECT_ROOT=<root> and
ATLAS_WORKER_NAME=<name> are pinned in the worker env. Every stdout line is
appended to <root>/.atlas/.run/board/<name>.jsonl as a note-shaped record
({ts, owner, name, to:"lead", kind:"report", text}) plus a final
{kind:"exit", code}; `atlas_todo.py notes --to lead` reads them alongside the
workers' own `atlas_todo.py note --owner <name>` messages.

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
import time
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_AGENT_DIRS = {"claude": PLUGIN_ROOT / "agents", "omp": PLUGIN_ROOT / "omp" / "agents"}
NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
BOARD_REL = Path(".atlas") / ".run" / "board"


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


def _omp_roles(config: Path) -> set:
    """Configured omp modelRoles keys (simple YAML scan); empty on error."""
    roles: set = set()
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
            m = re.match(r"^\s+([A-Za-z0-9_.-]+):", line)
            if m:
                roles.add(m.group(1))
            elif line.strip() and not line.startswith((" ", "\t")):
                break
    return roles


def _pick_omp_model(raw: str) -> str | None:
    """First pattern from a frontmatter model list that omp's CLI can resolve:
    a concrete selector, or an @role alias configured in modelRoles."""
    try:
        patterns = json.loads(raw) if raw.startswith("[") else [raw.strip("\"'")]
    except ValueError:
        return None
    patterns = [p for p in patterns if isinstance(p, str) and p]
    config = Path(os.environ.get("ATLAS_MUX_OMP_CONFIG") or Path.home() / ".omp" / "agent" / "config.yml")
    roles = _omp_roles(config)
    for p in patterns:
        if not p.startswith("@") or p[1:] in roles:
            return p
    return patterns[-1] if patterns else None


def _tier(harness: str, role: str, agents_dir: str | None, model: str | None, level: str | None):
    fields, body = _frontmatter(_agents_dir(harness, agents_dir) / f"{role}.md")
    if harness == "claude":
        return model or fields.get("model") or None, level or fields.get("effort") or None, body
    picked = _pick_omp_model(fields["model"]) if fields.get("model") else None
    return model or picked, level or fields.get("thinkingLevel") or None, body


def harness_argv(harness: str, role: str, prompt: str, model, level, body: str, permission_mode: str) -> list:
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
    brief = f"You are the atlas:{role} worker.\n\n{body.strip()}\n\n# Task\n{prompt}" if body.strip() else prompt
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


def _windows(session: str) -> list | None:
    res = _tmux("list-windows", "-t", session, "-F", "#{window_name}\t#{window_dead}\t#{pane_pid}")
    if res.returncode != 0:
        return None
    out = []
    for line in res.stdout.splitlines():
        parts = line.split("\t")
        if parts and parts[0]:
            out.append({"name": parts[0], "dead": int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0,
                        "pid": parts[2] if len(parts) > 2 else ""})
    return out


def cmd_spawn(args) -> int:
    error = _validate(args)
    if error:
        return _emit({"ok": False, "error": error}, 2)
    root = os.path.abspath(args.root or os.environ.get("ATLAS_PROJECT_ROOT") or os.getcwd())
    session = _session(args.run)
    model, level, _ = _tier(args.harness, args.agent, args.agents_dir, args.model, args.effort or args.thinking)
    if _tmux("has-session", "-t", session).returncode != 0:
        created = _tmux("new-session", "-d", "-s", session, "-n", "lead")
        if created.returncode != 0:
            return _emit({"ok": False, "error": f"tmux new-session failed: {created.stderr.strip()}"}, 1)
        _tmux("set-option", "-t", session, "remain-on-exit", "off")
    else:
        live = _windows(session) or []
        if any(w["name"] == args.name for w in live):
            return _emit({"ok": False, "error": f"name_taken: {args.name} already runs in {session}"}, 1)
    worker = [sys.executable, str(Path(__file__).resolve()), "run-worker", "--run", args.run, "--name", args.name,
              "--harness", args.harness, "--agent", args.agent, "--prompt-file", os.path.abspath(args.prompt_file),
              "--root", root, "--permission-mode", args.permission_mode]
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
    pane = "exec " + shlex.join(worker)
    res = _tmux("new-window", "-d", "-t", session, "-n", args.name, pane)
    if res.returncode != 0:
        return _emit({"ok": False, "error": f"tmux new-window failed: {res.stderr.strip()}"}, 1)
    return _emit({"ok": True, "session": session, "name": args.name, "harness": args.harness, "agent": args.agent,
                  "model": model, "level": level, "board": str(Path(root) / BOARD_REL / f"{args.name}.jsonl")})


def _append(path: Path, record: dict) -> None:
    line = (json.dumps(record, separators=(",", ":")) + "\n").encode("utf-8")
    fd = os.open(str(path), os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
    try:
        os.write(fd, line)
    finally:
        os.close(fd)


def cmd_run_worker(args) -> int:
    root = os.path.abspath(args.root)
    board = Path(root) / BOARD_REL
    board.mkdir(parents=True, exist_ok=True)
    target = board / f"{args.name}.jsonl"
    prompt = Path(args.prompt_file).read_text(encoding="utf-8")
    override = args.command_override or os.environ.get("ATLAS_MUX_WORKER_CMD")
    if override:
        argv = ["/bin/sh", "-c", override]
    else:
        model, level, body = _tier(args.harness, args.agent, args.agents_dir, args.model, args.effort or args.thinking)
        argv = harness_argv(args.harness, args.agent, prompt, model, level, body, args.permission_mode)
    env = dict(os.environ, ATLAS_PROJECT_ROOT=root, ATLAS_WORKER_NAME=args.name)
    base = {"owner": args.name, "name": args.name, "to": "lead", "item": None}
    try:
        proc = subprocess.Popen(argv, cwd=root, env=env, stdout=subprocess.PIPE, stderr=None, text=True, bufsize=1)
    except OSError as exc:
        _append(target, {"ts": time.time(), **base, "kind": "exit", "code": 127, "text": f"spawn failed: {exc}"})
        return 127
    assert proc.stdout is not None
    for raw in proc.stdout:
        text = raw.rstrip("\n")
        print(text, flush=True)
        if text.strip():
            _append(target, {"ts": time.time(), **base, "kind": "report", "text": text})
    code = proc.wait()
    _append(target, {"ts": time.time(), **base, "kind": "exit", "code": code, "text": f"exit {code}"})
    return code


def cmd_status(args) -> int:
    session = _session(args.run)
    root = Path(os.path.abspath(args.root or os.environ.get("ATLAS_PROJECT_ROOT") or os.getcwd()))
    windows = _windows(session) if _tmux("has-session", "-t", session).returncode == 0 else None
    board = []
    for path in sorted((root / BOARD_REL).glob("*.jsonl")):
        exit_code = None
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if isinstance(rec, dict) and rec.get("kind") == "exit":
                    exit_code = rec.get("code")
        except OSError:
            continue
        board.append({"name": path.stem, "path": str(path), "exit": exit_code})
    workers = [w for w in (windows or []) if w["name"] != "lead"]
    return _emit({"ok": True, "run": args.run, "session_name": session, "tmux": windows is not None,
                  "workers": workers, "board": board})


def cmd_kill(args) -> int:
    session = _session(args.run)
    if _tmux("has-session", "-t", session).returncode != 0:
        return _emit({"ok": True, "session_name": session, "killed": False})
    res = _tmux("kill-session", "-t", session)
    return _emit({"ok": res.returncode == 0, "session_name": session, "killed": res.returncode == 0,
                  **({"error": res.stderr.strip()} if res.returncode else {})}, 0 if res.returncode == 0 else 1)


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="atlas_mux", description=(__doc__ or "").split("\n\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)

    def worker_opts(sp, internal=False):
        sp.add_argument("--run", required=True)
        sp.add_argument("--name", required=True)
        sp.add_argument("--harness", choices=("claude", "omp"), required=True)
        sp.add_argument("--agent", required=True, help="atlas role, e.g. implementer")
        sp.add_argument("--prompt-file", required=True)
        sp.add_argument("--model", help="override the agent definition's model")
        sp.add_argument("--effort", help="claude only: override the definition's effort")
        sp.add_argument("--thinking", help="omp only: override the definition's thinkingLevel")
        sp.add_argument("--agents-dir", help="dir holding claude/ and omp/ agent definitions (tests)")
        sp.add_argument("--permission-mode", default="acceptEdits", help="claude --permission-mode (default acceptEdits)")
        sp.add_argument("--command-override", help="test-only: shell command replacing the harness")
        sp.add_argument("--root", required=internal, help="project root (default ATLAS_PROJECT_ROOT or cwd)")

    worker_opts(sub.add_parser("spawn", help="start one worker window"))
    worker_opts(sub.add_parser("run-worker", help="internal: the pane command"), internal=True)
    for name in ("status", "kill"):
        sp = sub.add_parser(name)
        sp.add_argument("--run", required=True)
        sp.add_argument("--root")
    return p


def main(argv=None) -> int:
    args = _parser().parse_args(argv)
    try:
        return {"spawn": cmd_spawn, "run-worker": cmd_run_worker, "status": cmd_status, "kill": cmd_kill}[args.cmd](args)
    except Exception as exc:  # report, never traceback-dump into the pane
        return _emit({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, 1)


if __name__ == "__main__":
    raise SystemExit(main())
