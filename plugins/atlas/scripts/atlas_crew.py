#!/usr/bin/env python3
"""atlas_crew -- a team of lean Claude workers in tmux that talk over an IRC channel.

The lead writes a plan (JSON) that splits the work by FILE OWNERSHIP, then runs it:

    atlas_crew.py run  --plan plan.json [--root R] [--model M] [--effort E]   # starts, returns the run id
    atlas_crew.py wait --run <id> [--timeout 540]                             # blocks; prints a compact summary
    atlas_crew.py status --run <id>
    atlas_crew.py kill --run <id>

What makes it a team rather than parallel one-shots:
  * one tmux session per run: window `irc` shows the live channel, one window per worker renders its
    tool calls, window `ircd` runs a real IRC gateway (atlas_irc.py serve) any IRC client can join
  * the channel is shared and push-delivered: every message a peer posts reaches each worker after its
    next tool call (hooks/crew_worker.py PostToolUse); `irc wait` blocks on a peer's announcement;
    `irc say --to <peer>` asks one peer directly
  * file leases: a worker can only edit what it owns; an edit elsewhere is denied with the owner's name
  * the adversarial gate: a worker cannot stop until its own check passes, re-run by the hook, and
    after all workers stop the engine re-runs the global check; failures are routed back to the
    owning worker's own session (`--resume`, warm cache) for up to --fix-rounds rounds
  * context offload: each worker is a fresh, lean session (its own session id, no user plugins, MCP
    servers or memory prompt, only the tools it needs) that sees only its slice of the context;
    the lead sees one JSON summary, never the workers' transcripts

Plan schema:
  {"goal": str, "check": "<global acceptance command>", "context": ["SPEC.md#Overview", ...],
   "workers": [{"name": "semver", "owns": ["pkg/semver.py"], "task": str,
                "context": ["SPEC.md#semver"], "check": "<this worker's check>",
                "tests": ["tests/test_semver.py"], "model": null, "effort": null}]}
  A context entry is `path`, `path#Heading` (that markdown section) or literal text.
Stdlib only. Prints one JSON object per invocation.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
PLUGIN_ROOT = SCRIPTS.parent
sys.path.insert(0, str(SCRIPTS))
import atlas_irc  # noqa: E402

CREW_REL = Path(".atlas") / ".run" / "crew"
NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,31}$")
# Bash writes and reads files (heredoc, cat, sed); Edit patches. Each extra tool schema is re-sent on
# every call (Read+Write cost about 1k tokens per call, measured).
WORKER_TOOLS = "Bash,Edit"
# Env a worker must not inherit: the lead's session identity (workers would write their transcript
# under the lead's session id) and host-injected context that bloats every worker turn.
SCRUB_ENV = (
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_REMOTE_SESSION_ID",
    "CLAUDE_MEMORY_STORES",
    "CLAUDE_COWORK_MEMORY_PATH_OVERRIDE",
    "CLAUDE_CODE_POST_TURN_MEMORY",
    "CLAUDE_CODE_POST_TURN_MEMORY_CONFIG",
    "CLAUDE_CODE_ENABLE_CFC",
    "CLAUDE_CODE_ENABLE_REMOTE_RECAP",
    "CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION",
    "TMUX",
    "TMUX_PANE",
)
SCRUB_PREFIX = ("ATLAS_WORKER_", "CMUX_")
# Bash commands a worker may run without a prompt (compound commands are matched part by part).
DEV_BASH = (
    "irc",
    "python3",
    "python",
    "pytest",
    "uv",
    "npm",
    "npx",
    "yarn",
    "pnpm",
    "bun",
    "node",
    "go",
    "cargo",
    "make",
    "ls",
    "cat",
    "head",
    "tail",
    "wc",
    "grep",
    "rg",
    "find",
    "sed",
    "awk",
    "printf",
    "cut",
    "tr",
    "uniq",
    "cmp",
    "test",
    "echo",
    "cd",
    "pwd",
    "mkdir",
    "touch",
    "diff",
    "sort",
    "git status",
    "git diff",
    "git log",
    "git show",
    "true",
    "sleep",
    "timeout",
)

BASE_PROMPT = """\
You are an expert software engineer running non-interactively in a git repository (your working
directory). Use the tools to read, write and run code. Prefer Bash heredocs for whole-file writes,
run the code to verify it, and stay terse: no explanations, plans or summaries unless asked.

"""

PROTOCOL = """\
You are one worker of an Atlas crew: several Claude sessions building one deliverable in parallel,
each owning different files. You talk to the others on the team IRC channel.

Channel commands (run them with Bash):
  irc say "text"                      post to the whole team
  irc say --to <nick> "text"          message one peer
  irc need <peer> [<peer> ...]         block until each named peer has posted READY or DONE
  irc wait --from <nick> --match <regex>
                                      block until that peer posts a matching message
  Both time out after 100s (the shell kills a command after 2 minutes): rerun on a timeout,
  never `sleep`. Peers are the workers listed below; the lead posts no READY.
  irc read                            print anything unread
Messages from peers are pushed to you automatically after your tool calls as [irc] lines.

Rules:
1. Edit only the files you own; edits elsewhere are blocked. Need a change in a peer's file? Ask its owner.
2. As soon as the public interface of your files is settled, announce it once:
   irc say "READY <your name>: <signatures other workers use>"
   Post READY again only if the interface changes.
3. If you depend on a peer's file, code against the agreed interface right away; before running
   tests that import it, `irc need <peer> ...` for exactly the peers you import.
4. Answer every question addressed to you, briefly, then keep working.
5. Keep messages short and factual (names, signatures, decisions). No status chatter.
6. Your shell already starts in the project root: never `cd`, use paths relative to it, and keep
   scratch files under .atlas/tmp/ (anything outside the project needs an approval nobody can give).
7. Your context below already holds your spec section and your stub. Do not re-read them, and read
   peers' files or tests only to debug a failure.
8. Every tool call re-sends your whole context, so use few, large calls. Usual shape: ONE Bash
   call that writes your file(s) with a heredoc, posts READY, then runs your check; then Edit only
   what fails.
9. You are finished when your check passes. The team gate re-runs it when you stop; you cannot
   stop while it fails. Then reply with one line: files, check result.
"""


# ---------------------------------------------------------------- plan + context


def _run_dir(root, run_id) -> Path:
    return Path(root) / CREW_REL / run_id


def load_plan(path) -> dict:
    plan = json.loads(Path(path).read_text(encoding="utf-8"))
    workers = plan.get("workers") or []
    if not workers:
        raise ValueError("plan has no workers")
    names = set()
    for w in workers:
        name = w.get("name") or ""
        if not NAME_RE.match(name):
            raise ValueError(f"worker name {name!r} must match {NAME_RE.pattern}")
        if name in names or name == "lead":
            raise ValueError(f"duplicate or reserved worker name {name!r}")
        names.add(name)
        if not w.get("owns"):
            raise ValueError(
                f"worker {name} owns no files: split the work by file ownership"
            )
        if not (w.get("task") or "").strip():
            raise ValueError(f"worker {name} has no task")
    seen = {}
    for w in workers:
        for p in w["owns"]:
            if p in seen:
                raise ValueError(f"{p} is owned by both {seen[p]} and {w['name']}")
            seen[p] = w["name"]
    return plan


_HEAD = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")


def _headings(text: str) -> list:
    """(line index, level, text) of every markdown heading outside fenced code blocks: a `# comment`
    inside a code block is not a heading (it cut a spec section short in a live run). Fences follow
    CommonMark: 3+ backticks or tildes open (a backtick info string holds no backtick, so inline
    ``` code ``` is not a fence) and a line of at least as many of the same char closes."""
    out, fence = [], None
    for i, line in enumerate(text.splitlines()):
        st = line.strip()
        if fence:
            if re.fullmatch(re.escape(fence[0]) + "{%d,}" % len(fence), st):
                fence = None
            continue
        m = re.match(r"(`{3,}|~{3,})(.*)$", st)
        if m and not (m.group(1)[0] == "`" and "`" in m.group(2)):
            fence = m.group(1)
            continue
        if (h := _HEAD.match(line)):
            out.append((i, len(h.group(1)), h.group(2).strip()))
    return out


def section(text: str, heading: str) -> str | None:
    """The markdown section whose heading matches `heading` (exact, case-insensitive, else prefix/substr)."""
    lines = text.splitlines()
    want = heading.strip().lower()
    heads = _headings(text)
    pick = None
    for test in (
        lambda h: h.lower() == want,
        lambda h: h.lower().startswith(want),
        lambda h: want in h.lower(),
    ):
        pick = next(((i, lvl) for i, lvl, h in heads if test(h)), None)
        if pick:
            break
    if not pick:
        return None
    start, lvl = pick
    if lvl == 1:
        # a title heading spans the whole document: hand over only its preamble
        end = next((i for i, _, _ in heads if i > start), len(lines))
    else:
        end = next((i for i, l2, _ in heads if i > start and l2 <= lvl), len(lines))
    return "\n".join(lines[start:end]).strip()


def resolve_context(entries, root) -> str:
    parts = []
    for e in entries or []:
        path, _, head = str(e).partition("#")
        f = Path(root) / path
        if f.is_file():
            text = f.read_text(encoding="utf-8", errors="replace")
            if head:
                sec = section(text, head)
                parts.append(sec if sec else f"(section '{head}' not found in {path})")
            else:
                parts.append(f"--- {path} ---\n{text}")
        else:
            parts.append(str(e))
    return "\n\n".join(parts)


def worker_prompt(plan: dict, w: dict, run_id: str, root: str) -> str:
    peers = [
        f"- {p['name']} owns {', '.join(p['owns'])}"
        for p in plan["workers"]
        if p["name"] != w["name"]
    ]
    ctx = resolve_context((plan.get("context") or []) + (w.get("context") or []), root)
    check = w.get("check") or "(none: you finish when your task is done)"
    return (
        f"# Crew {run_id}: you are `{w['name']}`\n"
        f"Team goal: {plan.get('goal', '')}\n\n"
        f"## Your task\n{w['task'].strip()}\n\n"
        f"## You own (only you may edit)\n"
        + "\n".join(f"- {p}" for p in w["owns"])
        + "\n\n"
        f"## Peers on #{run_id}\n" + ("\n".join(peers) or "(none)") + "\n\n"
        f"## Done when\n`{check}` passes in {root}.\n\n"
        f"## Context\n{ctx}\n"
    )


# ---------------------------------------------------------------- worker process


def worker_env(rundir: Path, plan: dict, w: dict, root: str) -> dict:
    env = {
        k: v
        for k, v in os.environ.items()
        if k not in SCRUB_ENV and not k.startswith(SCRUB_PREFIX)
    }
    owners = {p: x["name"] for x in plan["workers"] for p in x["owns"]}
    env.update(
        {
            "ATLAS_IRC_DIR": str(rundir / "irc"),
            "ATLAS_IRC_NICK": w["name"],
            "ATLAS_CREW_ROOT": root,
            "ATLAS_CREW_OWNS": json.dumps(w["owns"]),
            "ATLAS_CREW_OWNERS": json.dumps(owners),
            "ATLAS_CREW_CHECK": w.get("check") or "",
            "ATLAS_CREW_MAX_BLOCKS": str(plan.get("max_blocks") or 3),
            "PATH": f"{rundir / 'bin'}{os.pathsep}{os.environ.get('PATH', '')}",
            # the worker's own hooks are the crew hooks; atlas's lead-side gates stay off in workers
            "ATLAS_CREW_WORKER": w["name"],
            # no background shells: a stray `cat > f` with no input was moved to the background at
            # the 2-minute timeout and kept the finished worker alive for 9 minutes (live run).
            # With this set, a timed-out command is killed and its error goes back to the worker.
            "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS": "1",
        }
    )
    return env


def worker_settings(rundir: Path) -> str:
    hook = shlex.quote(str(PLUGIN_ROOT / "hooks" / "crew_worker.py"))
    py = shlex.quote(sys.executable or "python3")
    settings = {
        "hooks": {
            "PostToolUse": [
                {
                    "matcher": "*",
                    "hooks": [
                        {
                            "type": "command",
                            "command": f"{py} {hook} PostToolUse",
                            "timeout": 10,
                        }
                    ],
                }
            ],
            "PreToolUse": [
                {
                    "matcher": "Bash|Edit|Write|MultiEdit|NotebookEdit",
                    "hooks": [
                        {
                            "type": "command",
                            "command": f"{py} {hook} PreToolUse",
                            "timeout": 10,
                        }
                    ],
                }
            ],
            "Stop": [
                {
                    "matcher": "*",
                    "hooks": [
                        {
                            "type": "command",
                            "command": f"{py} {hook} Stop",
                            "timeout": 620,
                        }
                    ],
                }
            ],
        },
        "permissions": {
            "allow": [f"Bash({c} *)" for c in DEV_BASH]
            + [f"Bash({c})" for c in DEV_BASH]
            + ["Edit", "Write", "Read", "Grep", "Glob"]
        },
    }
    p = rundir / "worker-settings.json"
    p.write_text(json.dumps(settings, indent=1), encoding="utf-8")
    return str(p)


def worker_argv(model, effort, settings, sid, prompt, resume=None, name=None) -> list:
    argv = ["claude", "-p", "--output-format", "stream-json", "--verbose"]
    argv += ["--resume", resume] if resume else ["--session-id", sid]
    if model:
        argv += ["--model", model]
    if effort:
        argv += ["--effort", effort]
    if name:
        # a named session skips the host's auto-title call (a haiku request that re-sends the whole prompt)
        argv += ["--name", name]
    argv += [
        "--strict-mcp-config",
        "--setting-sources",
        "project,local",
        "--settings",
        settings,
        "--disable-slash-commands",
        "--no-chrome",
        "--tools",
        WORKER_TOOLS,
        "--permission-mode",
        "acceptEdits",
        # replaces the stock coding-agent prompt (about 3k tokens re-sent on every call) with the
        # worker's own short one; the tool schemas still carry the tool usage rules
        "--system-prompt",
        BASE_PROMPT + PROTOCOL,
        prompt,
    ]
    return argv


RESULT_GRACE_S = 20


def _reap(proc, log_path) -> None:
    if proc.poll() is not None:
        return
    try:
        with open(log_path, "a", encoding="utf-8") as fh:
            fh.write(f"[atlas_crew] still running {RESULT_GRACE_S}s after its result; terminated\n")
    except OSError:
        pass
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


def _result_ok(log_path) -> bool:
    try:
        lines = Path(log_path).read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return False
    for line in reversed(lines):
        if '"type":"result"' in line.replace(" ", ""):
            try:
                return not json.loads(line).get("is_error")
            except ValueError:
                return False
    return False


def cmd_worker(a) -> int:
    """Pane command: run one worker (or one fix round), render it, log it, record the exit."""
    rundir = Path(a.rundir)
    meta = json.loads((rundir / "run.json").read_text(encoding="utf-8"))
    plan = meta["plan"]
    w = next(x for x in plan["workers"] if x["name"] == a.name)
    root = meta["root"]
    rnd = a.round
    sid_file = rundir / "sid" / f"{a.name}"
    if rnd == 0:
        sid = str(uuid.uuid4())
        sid_file.parent.mkdir(parents=True, exist_ok=True)
        sid_file.write_text(sid)
        prompt = (rundir / "prompts" / f"{a.name}.md").read_text(encoding="utf-8")
        resume = None
    else:
        sid = sid_file.read_text().strip()
        prompt = (rundir / "prompts" / f"{a.name}.fix{rnd}.md").read_text(
            encoding="utf-8"
        )
        resume = sid
    model = w.get("model") or meta.get("model")
    effort = w.get("effort") or meta.get("effort")
    argv = worker_argv(model, effort, meta["settings"], sid, prompt, resume=resume, name=f"{meta['run_id']}-{a.name}")
    env = worker_env(rundir, plan, w, root)
    if rnd:
        # a fix round gets a fresh gate budget
        (rundir / "irc" / "stop" / f"{a.name}.json").unlink(missing_ok=True)
    log_path = (
        rundir / "logs" / (f"{a.name}.log" if rnd == 0 else f"{a.name}.fix{rnd}.log")
    )
    log_path.parent.mkdir(parents=True, exist_ok=True)
    feed = None
    if sys.stdout.isatty():
        try:
            import atlas_panefeed

            feed = atlas_panefeed.Feed(
                a.name, "crew", meta["run_id"], f"#{meta['run_id']}", prompt[:400]
            )
            feed.start()
        except Exception:
            feed = None
    t0 = time.time()
    code = 1
    with log_path.open("w", encoding="utf-8") as log:
        log.write("$ " + shlex.join(argv[:-1]) + " <prompt>\n")
        log.flush()
        try:
            proc = subprocess.Popen(
                argv,
                cwd=root,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            (rundir / "pid").mkdir(exist_ok=True)
            (rundir / "pid" / a.name).write_text(str(proc.pid))
            reaper = None
            for line in proc.stdout:
                log.write(line)
                log.flush()
                if reaper is None and '"type":"result"' in line.replace(" ", ""):
                    # the turn is over; a process still alive after the grace period is held open
                    # by something left running (a shell, a watcher), not by work
                    reaper = threading.Timer(RESULT_GRACE_S, _reap, (proc, log_path))
                    reaper.daemon = True
                    reaper.start()
                if feed is not None:
                    try:
                        ev = atlas_panefeed.parse_line(line)
                        feed.event(ev) if ev else feed.text(line.rstrip("\n"))
                    except Exception:
                        pass
                elif not sys.stdout.isatty():
                    pass
            code = proc.wait()
            if reaper is not None:
                reaper.cancel()
                if code != 0 and _result_ok(log_path):
                    code = 0  # reaped after a successful result: the work finished
        except FileNotFoundError:
            log.write("claude not found on PATH\n")
            code = 127
    if feed is not None:
        try:
            feed.finish(code)
        except Exception:
            pass
    exit_dir = rundir / "exit"
    exit_dir.mkdir(exist_ok=True)
    (exit_dir / f"{a.name}.r{rnd}.json").write_text(
        json.dumps({"exit": code, "wall_s": round(time.time() - t0, 1), "sid": sid})
    )
    if sys.stdout.isatty() and not a.no_hold:
        print(f"\n[{a.name}] exit {code}; pane kept for inspection")
        time.sleep(3600 * 6)
    return code


# ---------------------------------------------------------------- tmux / spawning


def _tmux(*args) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if k not in ("TMUX", "TMUX_PANE")}
    return subprocess.run(
        ["tmux", *args], capture_output=True, text=True, env=env, timeout=15
    )


def _use_tmux(flag: bool) -> bool:
    return (
        flag
        and shutil.which("tmux") is not None
        and os.environ.get("ATLAS_CREW_TMUX", "on") != "off"
    )


def _self_cmd(*args) -> str:
    return shlex.join(
        [sys.executable or "python3", str(Path(__file__).resolve()), *args]
    )


def _launch(meta: dict, rundir: Path, name: str, rnd: int, cmd: str) -> None:
    session = meta["session"]
    if meta["tmux"]:
        wname = name if rnd == 0 else f"{name}.fix{rnd}"
        _tmux("new-window", "-d", "-t", session, "-n", wname, cmd)
    else:
        logs = rundir / "logs"
        logs.mkdir(exist_ok=True)
        with open(logs / f"{name}.r{rnd}.pane", "w") as out:
            subprocess.Popen(
                shlex.split(cmd),
                stdout=out,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                start_new_session=True,
            )


def _heading_for(text: str, rel: str):
    """The heading text of the spec section about file `rel`: one naming its path, else its file name."""
    heads = [h for _, _, h in _headings(text)]
    name = Path(rel).name
    for key in (rel, name):
        hit = next((h for h in heads if key in h), None)
        if hit:
            return hit
    stem = Path(rel).stem
    return next((h for h in heads if re.search(rf"\b{re.escape(stem)}\b", h, re.I)), None)


def auto_plan(root: str, spec: str, files_glob: str, tests_pat: str | None = None, check: str | None = None,
              goal: str | None = None, exclude=("__init__.py", "conftest.py")) -> dict:
    """A plan with one worker per source file: each gets the spec section naming its file, the file itself
    (the stub), its tests (`tests_pat` with {stem}, {name}, {parent}) as its own check, and the spec's
    preamble plus its overview/dependency sections as shared context. In a multi-package tree a shared
    section whose heading names a top-level directory goes only to the workers under that directory, and
    a file stem used twice gets its directory as a name prefix."""
    rootp = Path(root)
    text = (rootp / spec).read_text(encoding="utf-8", errors="replace")
    files = [f for f in sorted(rootp.glob(files_glob)) if f.is_file() and f.name not in exclude]
    rels = [f.relative_to(rootp).as_posix() for f in files]
    tops = {r.split("/")[0] for r in rels if "/" in r}
    heads = [(lvl, h) for _, lvl, h in _headings(text)]
    shared, scoped = ([f"{spec}#{heads[0][1]}"] if heads else []), {}
    # only top-level sections named as a whole word, so `class DependencyGraph` is not shared context
    for lvl, h in heads[1:]:
        if lvl > 2 or not re.search(r"\b(dependenc(y|ies)|overview|conventions?|shared)\b", h, re.I):
            continue
        own = next((t for t in tops if re.search(rf"\b{re.escape(t)}\b", h)), None) if len(tops) > 1 else None
        if own:
            scoped.setdefault(own, []).append(f"{spec}#{h}")
        elif len(shared) < 4:
            shared.append(f"{spec}#{h}")
    stems = [f.stem for f in files]
    workers = []
    for f, rel in zip(files, rels):
        head = _heading_for(text, rel)
        parent = f.parent.name
        tests = []
        if tests_pat:
            t = tests_pat.format(stem=f.stem, name=f.name, parent=parent)
            if (rootp / t).exists():
                tests = [t]
        unit = f"python3 -m pytest -q {' '.join(tests)}" if tests and (check or "").startswith("python3 -m pytest") else None
        base = f.stem if stems.count(f.stem) == 1 else f"{parent}-{f.stem}"
        top = rel.split("/")[0] if "/" in rel else None
        workers.append({
            "name": re.sub(r"[^A-Za-z0-9_-]", "-", base)[:32] if base[0].isalpha() else "w-" + base[:30],
            "owns": [rel],
            "tests": tests,
            "task": f"Implement {rel}" + (f" per the spec section '{head}'" if head else "") + ".",
            "context": scoped.get(top, []) + ([f"{spec}#{head}"] if head else [spec]) + [rel],
            "check": unit or check or "",
        })
    return {"goal": goal or f"Implement {files_glob} per {spec}", "check": check or "", "context": shared, "workers": workers}


def cmd_plan(a) -> int:
    root = os.path.realpath(a.root or os.getcwd())
    plan = auto_plan(root, a.spec, a.files, a.tests, a.check, a.goal)
    if a.out:
        Path(root, a.out).write_text(json.dumps(plan, indent=1), encoding="utf-8")
    print(json.dumps(plan, indent=1))
    return 0


def cmd_run(a) -> int:
    root = os.path.realpath(a.root or os.getcwd())
    try:
        if not a.plan:
            if not (a.spec and a.files):
                raise ValueError("give --plan, or --spec and --files for an automatic plan")
            Path(root, ".atlas").mkdir(exist_ok=True)
            a.plan = str(Path(root, ".atlas", "crew-plan.json"))
            Path(a.plan).write_text(json.dumps(auto_plan(root, a.spec, a.files, a.tests, a.check, a.goal), indent=1))
        plan = load_plan(a.plan)
    except (OSError, ValueError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 2
    run_id = a.run_id or "crew-" + time.strftime("%H%M%S") + uuid.uuid4().hex[:4]
    rundir = _run_dir(root, run_id)
    (rundir / "prompts").mkdir(parents=True, exist_ok=True)
    (rundir / "bin").mkdir(exist_ok=True)
    Path(root, ".atlas", "tmp").mkdir(parents=True, exist_ok=True)  # worker scratch space (rule 6)
    irc = rundir / "bin" / "irc"
    irc.write_text(
        f'#!/bin/sh\nexec {shlex.quote(sys.executable or "python3")} {shlex.quote(str(SCRIPTS / "atlas_irc.py"))} "$@"\n'
    )
    irc.chmod(0o755)
    nicks = [w["name"] for w in plan["workers"]]
    atlas_irc.init_bus(rundir / "irc", f"#{run_id}", nicks, lead="lead")
    tmux = _use_tmux(not a.no_tmux)
    meta = {
        "run_id": run_id,
        "root": root,
        "plan": plan,
        "model": a.model,
        "effort": a.effort,
        "settings": worker_settings(rundir),
        "session": f"atlas-{run_id}",
        "tmux": tmux,
        "started": time.time(),
        "fix_rounds": a.fix_rounds,
        "timeout": a.timeout,
    }
    for w in plan["workers"]:
        (rundir / "prompts" / f"{w['name']}.md").write_text(
            worker_prompt(plan, w, run_id, root), encoding="utf-8"
        )
    (rundir / "run.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    roster = "; ".join(f"{w['name']}: {', '.join(w['owns'])}" for w in plan["workers"])
    atlas_irc.post(
        rundir / "irc",
        "lead",
        f"#{run_id}",
        f"Kickoff. Goal: {plan.get('goal', '')} | owners: {roster}",
        kind="kickoff",
    )
    if tmux:
        tail = _self_cmd_irc(rundir, "tail")
        res = _tmux(
            "new-session",
            "-d",
            "-s",
            meta["session"],
            "-n",
            "irc",
            "-x",
            "220",
            "-y",
            "50",
            tail,
        )
        if res.returncode != 0:
            print(json.dumps({"ok": False, "error": f"tmux: {res.stderr.strip()}"}))
            return 1
        _tmux(
            "new-window",
            "-d",
            "-t",
            meta["session"],
            "-n",
            "ircd",
            _self_cmd_irc(rundir, "serve"),
        )
    else:
        subprocess.Popen(
            shlex.split(_self_cmd_irc(rundir, "serve")),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    for w in plan["workers"]:
        _launch(
            meta,
            rundir,
            w["name"],
            0,
            _self_cmd("worker", "--rundir", str(rundir), "--name", w["name"]),
        )
    # the supervisor owns the run from here: global check, fix rounds, summary
    sup = _self_cmd("supervise", "--rundir", str(rundir))
    subprocess.Popen(
        shlex.split(sup),
        stdout=open(rundir / "supervisor.log", "w"),
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
    if a.wait:
        end = time.time() + a.wait
        while time.time() < end:
            if (rundir / "summary.json").exists():
                print((rundir / "summary.json").read_text())
                return 0
            time.sleep(0.5)
    print(
        json.dumps(
            {
                "ok": True,
                "run": run_id,
                "root": root,
                "workers": nicks,
                "tmux_session": meta["session"] if tmux else None,
                "attach": f"tmux attach -t {meta['session']}" if tmux else None,
                "irc": f"irc gateway: 127.0.0.1:$(cat {rundir / 'irc' / 'port'}) channel #{run_id}",
                "next": f"atlas_crew.py wait --run {run_id} --root {root}",
            }
        )
    )
    return 0


def _self_cmd_irc(rundir: Path, sub: str) -> str:
    return shlex.join(
        [
            sys.executable or "python3",
            str(SCRIPTS / "atlas_irc.py"),
            "--dir",
            str(rundir / "irc"),
            sub,
        ]
    )


# ---------------------------------------------------------------- supervision


def _exited(rundir: Path, name: str, rnd: int):
    p = rundir / "exit" / f"{name}.r{rnd}.json"
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return None


def _wait_round(rundir, names, rnd, deadline) -> bool:
    while time.time() < deadline:
        if all(_exited(rundir, n, rnd) for n in names):
            return True
        time.sleep(0.5)
    return False


def _run_check(cmd, root, timeout=900):
    try:
        r = subprocess.run(
            cmd, shell=True, cwd=root, capture_output=True, text=True, timeout=timeout
        )
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {timeout}s"


def route_failures(plan: dict, output: str) -> dict:
    """{worker: failure excerpt} for a failed global check: a worker gets the failures that name a
    file it owns or one of its `tests`. Unrouted failures go to every worker whose own check fails."""
    out = {}
    lines = output.splitlines()
    for w in plan["workers"]:
        keys = [k for k in (w.get("owns") or []) + (w.get("tests") or [])]
        hit = [
            ln
            for ln in lines
            if any(k and k.split("*")[0] and k.split("*")[0] in ln for k in keys)
        ]
        if hit:
            out[w["name"]] = "\n".join(hit[-40:])
    return out


def cmd_supervise(a) -> int:
    rundir = Path(a.rundir)
    meta = json.loads((rundir / "run.json").read_text(encoding="utf-8"))
    plan, root = meta["plan"], meta["root"]
    names = [w["name"] for w in plan["workers"]]
    deadline = meta["started"] + float(meta.get("timeout") or 3600)
    rounds = []
    finished = _wait_round(rundir, names, 0, deadline)
    check = plan.get("check")
    code, out = (0, "") if not check else _run_check(check, root)
    rounds.append(
        {
            "round": 0,
            "all_exited": finished,
            "check_exit": code,
            "t": round(time.time() - meta["started"], 1),
        }
    )
    for rnd in range(1, int(meta.get("fix_rounds") or 0) + 1):
        if code == 0 or not finished:
            break
        routed = route_failures(plan, out)
        if not routed:
            for w in plan["workers"]:
                if w.get("check"):
                    c2, o2 = _run_check(w["check"], root)
                    if c2:
                        routed[w["name"]] = o2[-3000:]
        if not routed:
            break
        chan = f"#{meta['run_id']}"
        for name, excerpt in routed.items():
            atlas_irc.post(
                rundir / "irc",
                "lead",
                name,
                f"Global check `{check}` fails in your area (fix round {rnd}).",
                kind="fix",
            )
            (rundir / "prompts" / f"{name}.fix{rnd}.md").write_text(
                f"The team's global check `{check}` failed after everyone stopped. These failures involve your "
                f"files; fix them (coordinate on {chan} if a peer's interface is the cause), then rerun your check.\n\n"
                f"{excerpt}\n\nFull output tail:\n{out[-2500:]}\n",
                encoding="utf-8",
            )
            _launch(
                meta,
                rundir,
                name,
                rnd,
                _self_cmd(
                    "worker",
                    "--rundir",
                    str(rundir),
                    "--name",
                    name,
                    "--round",
                    str(rnd),
                ),
            )
        finished = _wait_round(rundir, list(routed), rnd, deadline)
        code, out = _run_check(check, root)
        rounds.append(
            {
                "round": rnd,
                "workers": list(routed),
                "all_exited": finished,
                "check_exit": code,
                "t": round(time.time() - meta["started"], 1),
            }
        )
    summary = summarize(rundir, meta, rounds, code, out)
    (rundir / "summary.json").write_text(
        json.dumps(summary, indent=1), encoding="utf-8"
    )
    atlas_irc.post(
        rundir / "irc",
        "lead",
        f"#{meta['run_id']}",
        f"Crew finished: global check exit {code}.",
        kind="final",
    )
    if meta.get("tmux") and not os.environ.get("ATLAS_CREW_KEEP"):
        _tmux("kill-session", "-t", meta["session"])
    return 0


# ---------------------------------------------------------------- accounting


def usage_of(log: Path) -> dict:
    """Token use of one stream-json log. modelUsage and total_cost_usd are cumulative for the process
    (a second result after a background task repeats them; live 2026-10-28), so the last result counts;
    num_turns is per result and is summed. total = all tokens the API processed."""
    t = {
        "input": 0,
        "cache_write": 0,
        "cache_read": 0,
        "output": 0,
        "cost_usd": 0.0,
        "turns": 0,
        "results": 0,
    }
    try:
        fh = log.open(encoding="utf-8", errors="replace")
    except OSError:
        return {**t, "total": 0}
    with fh:
        for line in fh:
            if '"type":"result"' not in line.replace(" ", ""):
                continue
            try:
                e = json.loads(line)
            except ValueError:
                continue
            t["results"] += 1
            t["cost_usd"] = float(e.get("total_cost_usd") or 0)
            t["turns"] += int(e.get("num_turns") or 0)
            t.update(input=0, cache_write=0, cache_read=0, output=0)
            for u in (e.get("modelUsage") or {}).values():
                t["input"] += u.get("inputTokens", 0)
                t["cache_write"] += u.get("cacheCreationInputTokens", 0)
                t["cache_read"] += u.get("cacheReadInputTokens", 0)
                t["output"] += u.get("outputTokens", 0)
    t["total"] = t["input"] + t["cache_write"] + t["cache_read"] + t["output"]
    t["cost_usd"] = round(t["cost_usd"], 4)
    return t


def irc_stats(d: Path, names) -> dict:
    recs = atlas_irc.history(d)
    workers = set(names)
    w2w = [
        r
        for r in recs
        if r.get("from") in workers
        and (r.get("to") in workers or (r.get("to") or "").startswith("#"))
        and r.get("kind") not in ("done", "failed")
    ]
    direct = [r for r in recs if r.get("from") in workers and r.get("to") in workers]
    return {
        "messages": len(recs),
        "from_workers": len(w2w),
        "direct_worker_to_worker": len(direct),
        "ready": sum(1 for r in recs if (r.get("text") or "").startswith("READY")),
        "human_or_irc_client": sum(1 for r in recs if r.get("via") == "irc"),
    }


def summarize(rundir: Path, meta: dict, rounds, code, out) -> dict:
    names = [w["name"] for w in meta["plan"]["workers"]]
    workers, tot = [], {"total": 0, "cost_usd": 0.0}
    for n in names:
        u = {"total": 0, "cost_usd": 0.0, "turns": 0}
        for log in sorted((rundir / "logs").glob(f"{n}*.log")):
            x = usage_of(log)
            for k, v in x.items():
                u[k] = u.get(k, 0) + v
        gate = {}
        try:
            gate = json.loads((rundir / "irc" / "stop" / f"{n}.json").read_text())
        except (OSError, ValueError):
            pass
        ex = _exited(rundir, n, 0) or {}
        workers.append(
            {
                "name": n,
                "exit": ex.get("exit"),
                "wall_s": ex.get("wall_s"),
                "turns": u.get("turns"),
                "tokens": u.get("total"),
                "cost_usd": round(u.get("cost_usd", 0), 4),
                "gate_refusals": gate.get("blocks"),
                "own_check_passed": gate.get("passed"),
            }
        )
        tot["total"] += u.get("total", 0)
        tot["cost_usd"] += u.get("cost_usd", 0)
    tot["cost_usd"] = round(tot["cost_usd"], 4)
    return {
        "ok": code == 0,
        "run": meta["run_id"],
        "check": meta["plan"].get("check"),
        "check_exit": code,
        "check_tail": out[-800:] if code else out[-200:],
        "wall_s": round(time.time() - meta["started"], 1),
        "rounds": rounds,
        "workers": workers,
        "tokens_workers": tot,
        "irc": irc_stats(rundir / "irc", names),
        "transcripts": str(rundir / "logs"),
        "channel_log": str(rundir / "irc" / "log.jsonl"),
    }


def cmd_wait(a) -> int:
    rundir = _run_dir(a.root or os.getcwd(), a.run)
    end = time.time() + a.timeout
    while time.time() < end:
        s = rundir / "summary.json"
        if s.exists():
            print(s.read_text())
            return 0
        time.sleep(2)
    print(
        json.dumps(
            status(rundir) | {"done": False, "hint": "still running; call wait again"}
        )
    )
    return 3


def status(rundir: Path) -> dict:
    meta = json.loads((rundir / "run.json").read_text(encoding="utf-8"))
    names = [w["name"] for w in meta["plan"]["workers"]]
    recs = atlas_irc.history(rundir / "irc")
    return {
        "run": meta["run_id"],
        "elapsed_s": round(time.time() - meta["started"], 1),
        "exited": [n for n in names if _exited(rundir, n, 0)],
        "running": [n for n in names if not _exited(rundir, n, 0)],
        "channel_messages": len(recs),
        "last": [atlas_irc.fmt(r, 160) for r in recs[-3:]],
    }


def cmd_status(a) -> int:
    print(json.dumps(status(_run_dir(a.root or os.getcwd(), a.run))))
    return 0


def cmd_kill(a) -> int:
    rundir = _run_dir(a.root or os.getcwd(), a.run)
    meta = json.loads((rundir / "run.json").read_text(encoding="utf-8"))
    killed = []
    for p in (rundir / "pid").glob("*"):
        try:
            os.kill(int(p.read_text()), signal.SIGTERM)
            killed.append(p.name)
        except (OSError, ValueError):
            pass
    if meta.get("tmux"):
        _tmux("kill-session", "-t", meta["session"])
    print(json.dumps({"ok": True, "killed": killed}))
    return 0


def parser():
    ap = argparse.ArgumentParser(prog="atlas_crew")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--plan", help="plan JSON; or build one automatically with --spec and --files")
    for x in (r, sub.add_parser("plan", help="print an automatic one-worker-per-file plan")):
        x.add_argument("--spec", help="markdown spec with one section per file")
        x.add_argument("--files", help="glob of files to split by, e.g. 'pkg/*.py'")
        x.add_argument("--tests", help="test path pattern per file, e.g. 'tests/test_{stem}.py'")
        x.add_argument("--check", help="global acceptance command")
        x.add_argument("--goal")
    pl = sub.choices["plan"]
    pl.add_argument("--root")
    pl.add_argument("--out")
    pl.set_defaults(fn=cmd_plan)
    r.add_argument("--root")
    r.add_argument("--model")
    r.add_argument("--effort")
    r.add_argument("--run-id")
    r.add_argument("--fix-rounds", type=int, default=2)
    r.add_argument("--timeout", type=float, default=3600)
    r.add_argument("--no-tmux", action="store_true")
    r.add_argument(
        "--wait",
        type=float,
        default=0,
        help="block up to this many seconds and print the summary",
    )
    r.set_defaults(fn=cmd_run)
    w = sub.add_parser("worker")
    w.add_argument("--rundir", required=True)
    w.add_argument("--name", required=True)
    w.add_argument("--round", type=int, default=0)
    w.add_argument("--no-hold", action="store_true")
    w.set_defaults(fn=cmd_worker)
    s = sub.add_parser("supervise")
    s.add_argument("--rundir", required=True)
    s.set_defaults(fn=cmd_supervise)
    for name, fn in (("wait", cmd_wait), ("status", cmd_status), ("kill", cmd_kill)):
        x = sub.add_parser(name)
        x.add_argument("--run", required=True)
        x.add_argument("--root")
        if name == "wait":
            x.add_argument("--timeout", type=float, default=540)
        x.set_defaults(fn=fn)
    return ap


def main(argv=None) -> int:
    a = parser().parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
