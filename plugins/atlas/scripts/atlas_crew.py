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
import ast
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
# Write creates each owned file (staged, then installed by `irc check`); Bash runs the check; Edit patches.
# Shell heredoc writes are not used: Claude Code's Bash safety check refuses some of them ("Contains brace
# with quote character (expansion obfuscation)"); 4 workers per 30-module run lost a whole file generation
# (10-25 s) to it, then failed Edit with "File has not been read yet". Each extra tool schema is re-sent on
# every call (Read+Write cost about 1k tokens per call, measured), Write alone is small.
WORKER_TOOLS = "Bash,Edit,Write"
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
directory). Use the tools to read, write and run code. Write whole files with the Write tool (never with
shell heredocs), run the code to verify it, and stay terse: no explanations, plans or summaries unless asked.

"""

PROTOCOL = """\
You are one worker of an Atlas crew: several Claude sessions building one deliverable in parallel,
each owning different files. You talk to the others on the team IRC channel.

Channel commands (run them with Bash):
  irc say "text"                      post to the whole team
  irc say --to <nick> "text"          message one peer
  irc need [--done] <peer> [<peer> ...]
                                      block until each named peer has posted READY or DONE
                                      (--done: DONE only); exit 4 if a peer gave up
  irc wait --from <nick> --match <regex>
                                      block until that peer posts a NEW matching message
                                      (--all: history too)
  irc check                           wait for your peers, run your unit check, post DONE if it passes
  Both time out after 100s (the shell kills a command after 2 minutes): rerun on a timeout.
  Never `sleep`: wait with `irc wait`. Peers are the workers listed below; the lead posts no READY.
  irc read                            print anything unread
Messages from peers are pushed to you automatically after your tool calls as [irc] lines.

Rules:
1. Edit only the files you own; edits elsewhere are blocked. Need a change in a peer's file? Ask its owner.
2. Write each file you own in full with the Write tool to its staged path (listed under "You own"; a new
   file, so no Read is needed), and in the SAME reply call Bash `irc check` exactly as is (never piped,
   chained or wrapped) after the Write. `irc check` copies a staged file over the real one when the staged
   copy is newer, waits for the peers you import, runs your unit check and posts DONE only if it passes;
   DONE is never your word. If it fails, fix with Edit on the staged file, then `irc check` again. Never
   write files with shell heredocs (the shell safety check refuses some code). Do not announce READY:
   your peers already hold your interface.
3. Code against the interfaces you were handed. `irc check` waits for the peers you import; do not run
   tests that import peers outside it.
4. Answer every question addressed to you, briefly, then keep working.
5. Keep messages short and factual (names, signatures, decisions). No status chatter.
6. Your shell already starts in the project root: never `cd`, use paths relative to it, and keep
   scratch files under .atlas/tmp/ (anything outside the project needs an approval nobody can give).
7. Your context below already holds your spec section, your stub and the interfaces of the peer files
   you import. Do not re-read them, and read peers' files or tests only to debug a failure.
8. Every tool call re-sends your whole context, so use few, large calls. Usual shape: ONE reply with a
   Write per file you own plus `irc check`; then Edit only what fails.
9. You are finished when your check passes. The team gate re-runs it when you stop; you cannot
   stop while it fails. Then reply with one line: files, check result.
"""


# ---------------------------------------------------------------- plan + context


def _run_dir(root, run_id) -> Path:
    return Path(root) / CREW_REL / run_id


IRC_CHECK = "irc check"


def _wire_check(w: dict) -> None:
    """Make a worker's check `irc check` (unit_check = the plain check, needs = who it waits for), so its DONE
    is decided by the check itself. A check that already is `irc check`, or that drives `irc` by hand, is kept."""
    chk = (w.get("check") or "").strip()
    if not chk or chk == IRC_CHECK or re.search(r"\birc\s+(need|done|check)\b", chk):
        return
    w["unit_check"] = w.get("unit_check") or chk
    w["needs"] = list(w.get("needs") or [])
    w["check"] = IRC_CHECK


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
    for w in workers:
        _wire_check(w)
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
        if "\n" not in path and f.is_file():  # multi-line literal text is never a path
            text = f.read_text(encoding="utf-8", errors="replace")
            if head:
                sec = section(text, head)
                parts.append(sec if sec else f"(section '{head}' not found in {path})")
            else:
                parts.append(f"--- {path} ---\n{text}")
        else:
            parts.append(str(e))
    return "\n\n".join(parts)


def _stage_dir(root, run_id: str, nick: str) -> Path:
    """Where a worker writes its files before `irc check` installs them: <root>/.atlas/tmp/<run_id>/<nick>."""
    return Path(root) / ".atlas" / "tmp" / run_id / nick


def _needs_closure(plan: dict, w: dict) -> list:
    """Transitive closure of `w`'s needs in plan order of discovery (never the worker itself; cycle-safe)."""
    by_name = {x["name"]: x for x in plan["workers"]}
    closure: list = []
    todo = list(w.get("needs") or [])
    while todo:
        n = todo.pop(0)
        if n == w["name"] or n in closure or n not in by_name:
            continue
        closure.append(n)
        todo.extend(by_name[n].get("needs") or [])
    return closure


def worker_prompt(plan: dict, w: dict, run_id: str, root: str) -> str:
    peers = [
        f"- {p['name']} owns {', '.join(p['owns'])}"
        for p in plan["workers"]
        if p["name"] != w["name"]
    ]
    ctx = resolve_context((plan.get("context") or []) + (w.get("context") or []), root)
    check = w.get("check") or "(none: you finish when your task is done)"
    unit = w.get("unit_check")
    done_when = (
        f"`{check}` passes in {root}: it runs `{unit}` after the peers you import are done."
        if unit and check.strip() == IRC_CHECK
        else f"`{check}` passes in {root}."
    )
    trim = (
        "Omit the docstrings of the stub's functions, classes and methods when you write your .py files: `irc check` "
        "restores them. Keep a docstring on a one-line `def f(): ...` and on a name defined twice.\n\n"
        if os.environ.get("ATLAS_CREW_SKIP_DOCSTRINGS", "on").strip().lower() != "off"
        else ""
    )
    return (
        f"# Crew {run_id}: you are `{w['name']}`\n"
        f"Team goal: {plan.get('goal', '')}\n\n"
        f"## Your task\n{w['task'].strip()}\n\n"
        f"## You own (only you may edit)\n"
        + "\n".join(
            f"- {p} (write it to {_stage_dir(root, run_id, w['name']).relative_to(root).as_posix()}/{p})"
            for p in w["owns"]
        )
        + "\n\n"
        + trim
        + f"## Peers on #{run_id}\n" + ("\n".join(peers) or "(none)") + "\n\n"
        f"## Done when\n{done_when}\n\n"
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
    stubs = {p: str(rundir / "stubs" / p) for p in w["owns"] if (rundir / "stubs" / p).is_file()}
    # transitive closure of needs (never the worker itself; cycle-safe) for the speculative peer check
    by_name = {x["name"]: x for x in plan["workers"]}
    closure = _needs_closure(plan, w)
    env.update(
        {
            "ATLAS_IRC_DIR": str(rundir / "irc"),
            "ATLAS_IRC_NICK": w["name"],
            "ATLAS_CREW_ROOT": root,
            "ATLAS_CREW_OWNS": json.dumps(w["owns"]),
            # Write lands here; `irc check` installs a staged file over the real one when it is newer
            "ATLAS_CREW_STAGE": str(_stage_dir(root, rundir.name, w["name"])),
            "ATLAS_CREW_OWNERS": json.dumps(owners),
            # pristine copies of the owned stubs: `irc check` restores the docstrings a rewrite dropped
            "ATLAS_CREW_STUBS": json.dumps(stubs),
            "ATLAS_CREW_CHECK": w.get("check") or "",
            # `irc check` waits for NEEDS, runs UNIT_CHECK and posts DONE itself
            "ATLAS_CREW_NEEDS": " ".join(w.get("needs") or []),
            "ATLAS_CREW_NEEDS_ALL": " ".join(closure),
            "ATLAS_CREW_PEER_OWNS": json.dumps({n: by_name[n]["owns"] for n in closure}),
            "ATLAS_CREW_STUB_DIR": str(rundir / "stubs"),
            "ATLAS_CREW_UNIT_CHECK": w.get("unit_check") or "",
            "ATLAS_CREW_MAX_BLOCKS": str(plan.get("max_blocks") or 3),
            "PATH": f"{rundir / 'bin'}{os.pathsep}{os.environ.get('PATH', '')}",
            # the worker's own hooks are the crew hooks; atlas's lead-side gates stay off in workers
            "ATLAS_CREW_WORKER": w["name"],
            # no background shells: a stray `cat > f` with no input was moved to the background at
            # the 2-minute timeout and kept the finished worker alive for 9 minutes (live run).
            # With this set, a timed-out command is killed and its error goes back to the worker.
            "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS": "1",
            # no telemetry, flag fetch or post_turn_summary round trip: `claude -p` exited ~2.3 s after
            # the result, init came ~0.6 s sooner (3 runs each: exit 8.8 s -> 5.8 s, init 4.2 -> 3.6 s).
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
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


def worker_effort(w: dict, meta: dict):
    """ATLAS_CREW_WORKER_EFFORT (low|medium|high) replaces the plan's per-worker effort; unset or invalid: unchanged."""
    env = os.environ.get("ATLAS_CREW_WORKER_EFFORT", "").strip().lower()
    return env if env in ("low", "medium", "high") else (w.get("effort") or meta.get("effort"))


def worker_model(w: dict, meta: dict):
    """ATLAS_CREW_WORKER_MODEL ([A-Za-z0-9._-]+) replaces the worker/plan model; unset or invalid: unchanged."""
    env = os.environ.get("ATLAS_CREW_WORKER_MODEL", "").strip()
    return env if re.fullmatch(r"[A-Za-z0-9._-]+", env) else (w.get("model") or meta.get("model"))


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
    model = worker_model(w, meta)
    effort = worker_effort(w, meta)
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
    delay = getattr(a, "delay", 0) or 0
    if rnd == 0 and delay > 0:
        # boot contention: a worker that will wait on its peers anyway sleeps first, so the CPU goes to the
        # critical workers while they boot (30 workers on 4 CPUs: the critical one spent ~6 s booting)
        time.sleep(delay)
    if getattr(a, "nice", 0) and a.nice > 0:
        try:
            os.nice(a.nice)  # claude and its hooks inherit it
        except (OSError, AttributeError):
            pass
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


IFACE_HEAD = (
    "Interfaces of the peer files you import (code against these; their owners implement them, "
    "do not read the files):\n"
)


def _sig(fn) -> str:
    kw = "async def" if isinstance(fn, ast.AsyncFunctionDef) else "def"
    ret = f" -> {ast.unparse(fn.returns)}" if fn.returns else ""
    doc = (ast.get_docstring(fn) or "").strip().split("\n")[0]
    decos = "".join(f"@{ast.unparse(d)}\n" for d in fn.decorator_list)
    return f"{decos}{kw} {fn.name}({ast.unparse(fn.args)}){ret}: ..." + (f"  # {doc}" if doc else "")


def _interface(path) -> str:
    """Public API skeleton of a Python file (classes, functions, __all__, constants), bodies elided."""
    try:
        tree = ast.parse(Path(path).read_text(encoding="utf-8", errors="replace"))
    except (SyntaxError, OSError, ValueError):
        return ""

    def public(name):
        return not name.startswith("_") or (name.startswith("__") and name.endswith("__"))

    out = []
    for n in tree.body:
        if isinstance(n, ast.ClassDef) and not n.name.startswith("_"):
            out += [f"@{ast.unparse(d)}" for d in n.decorator_list]
            bases = ", ".join(ast.unparse(b) for b in [*n.bases, *n.keywords])
            doc = (ast.get_docstring(n) or "").strip().split("\n")[0]
            out.append(f"class {n.name}({bases}):" if bases else f"class {n.name}:")
            if doc:
                out.append(f'    """{doc}"""')
            for m in n.body:
                if isinstance(m, ast.AnnAssign):
                    out.append("    " + ast.unparse(m))
                elif isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)) and public(m.name):
                    out += ["    " + ln for ln in _sig(m).split("\n")]
        elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and not n.name.startswith("_"):
            out.append(_sig(n))
        elif isinstance(n, ast.Assign) and all(isinstance(t, ast.Name) for t in n.targets):
            if any(t.id == "__all__" or not t.id.startswith("_") for t in n.targets):
                out.append(ast.unparse(n))
        elif isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name) and not n.target.id.startswith("_"):
            out.append(ast.unparse(n))
    return "\n".join(out)


def _local_deps(rel: str, rels, root) -> list:
    """Plan files (repo-relative posix paths in `rels`) that file `rel` imports, in order of first appearance."""
    try:
        tree = ast.parse((Path(root) / rel).read_text(encoding="utf-8", errors="replace"))
    except (SyntaxError, OSError, ValueError):
        return []
    here = Path(rel).parent
    known = set(rels)
    found = []

    def add(mod_parts, base):
        cand = (base / "/".join(mod_parts)).as_posix() + ".py" if mod_parts else None
        if cand and cand.startswith("./"):
            cand = cand[2:]
        if cand and cand not in known and base == Path("."):
            # absolute name of a package that lives below a source dir (`src/pkg/x.py` for `pkg.x`)
            hits = [k for k in known if k.endswith("/" + cand)]
            cand = hits[0] if len(hits) == 1 else cand
        if cand and cand in known and cand != rel and cand not in found:
            found.append(cand)

    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            for a in n.names:
                add(a.name.split("."), Path("."))
        elif isinstance(n, ast.ImportFrom):
            mod = n.module.split(".") if n.module else []
            if n.level:
                base = here
                for _ in range(n.level - 1):
                    base = base.parent
            else:
                base = Path(".")
            add(mod, base)
            for a in n.names:  # `from . import x` / `from pkg import x`: x may itself be a plan file
                add([*mod, a.name], base)
    return found


def _break_cycles(deps: dict) -> dict:
    """Drop the edge A->B when B reaches A through the dep graph and A sorts after B, so no worker waits
    on a peer that (transitively) waits on it. The surviving edge of a cycle is the same on every run."""
    g = {k: list(v) for k, v in deps.items()}

    def reaches(src, dst):
        seen, stack = set(), [src]
        while stack:
            for m in g.get(stack.pop(), ()):
                if m == dst:
                    return True
                if m not in seen:
                    seen.add(m)
                    stack.append(m)
        return False

    for a in sorted(g):
        for b in list(g[a]):
            if a > b and reaches(b, a):
                g[a].remove(b)
    return g


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
    # a matched file that is another matched file's test, or is named like a test, is never a worker
    owned_tests = {
        (rootp / tests_pat.format(stem=f.stem, name=f.name, parent=f.parent.name)).resolve()
        for f in files
    } if tests_pat else set()
    files = [
        f for f in files
        if not (f.name.startswith("test_") or f.name.endswith("_test.py") or f.resolve() in owned_tests - {f.resolve()})
    ]
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
    owner = {}
    for f, rel in zip(files, rels):
        base = f.stem if stems.count(f.stem) == 1 else f"{f.parent.name}-{f.stem}"
        owner[rel] = re.sub(r"[^A-Za-z0-9_-]", "-", base)[:32] if base[0].isalpha() else "w-" + base[:30]
    workers = []

    def own_tests(f):
        if not tests_pat:
            return []
        t = tests_pat.format(stem=f.stem, name=f.name, parent=f.parent.name)
        return [t] if (rootp / t).exists() else []

    # a worker needs the peers its stub imports and the peers its own tests import (a test can reach a
    # peer the stub never names; running it before that peer is DONE hits the peer's stub)
    imports = {}
    for f, rel in zip(files, rels):
        deps = _local_deps(rel, rels, rootp)
        for t in own_tests(f):
            deps += [d for d in _local_deps(t, rels, rootp) if d != rel and d not in deps]
        imports[rel] = deps
    waits = _break_cycles(imports)
    for f, rel in zip(files, rels):
        head = _heading_for(text, rel)
        peers = [(d, _interface(rootp / d)) for d in imports[rel]]
        iface = "".join(f"# {owner[d]} owns {d}\n{sk}\n" for d, sk in peers if sk)
        parent = f.parent.name
        tests = own_tests(f)
        unit = f"python3 -m pytest -q {' '.join(tests)}" if tests and (check or "").startswith("python3 -m pytest") else None
        final = unit or check or ""
        needs = [owner[d] for d in waits[rel]] if final.startswith("python3 -m pytest") else []
        base = f.stem if stems.count(f.stem) == 1 else f"{parent}-{f.stem}"
        top = rel.split("/")[0] if "/" in rel else None
        workers.append({
            "name": owner[rel],
            "owns": [rel],
            "tests": tests,
            "task": f"Implement {rel}" + (f" per the spec section '{head}'" if head else "") + ".",
            "context": scoped.get(top, []) + ([f"{spec}#{head}"] if head else [spec])
            + ([IFACE_HEAD + iface] if iface else []) + [rel],
            "check": IRC_CHECK if final else "",  # DONE is posted by `irc check` itself once final passes
            **({"unit_check": final, "needs": needs} if final else {}),
        })
    return {"goal": goal or f"Implement {files_glob} per {spec}", "check": check or "", "context": shared, "workers": workers}


def cmd_plan(a) -> int:
    root = os.path.realpath(a.root or os.getcwd())
    plan = auto_plan(root, a.spec, a.files, a.tests, a.check, a.goal)
    if a.out:
        Path(root, a.out).write_text(json.dumps(plan, indent=1), encoding="utf-8")
    print(json.dumps(plan, indent=1))
    return 0


# least-squares through the origin on 162 benchmark worker runs: API time ~ spec chars / 400 (residual sd 3.75 s)
GEN_CHARS_PER_S = 400
STAGGER_MARGIN_S = 7.5  # two residual sds: only wait estimates beyond this earn a delay
STAGGER_CAP_S = 8.0  # longest launch delay
HOP_S = 1.5  # one hop: a dependent's `irc check` sees its peer's DONE and runs its own check


def _weight(w: dict, root) -> int:
    """Chars of the markdown sections its `path#Heading` context entries resolve to (the spec it reads).

    Measured on 162 worker runs: API time correlates 0.78-0.84 with these spec chars and -0.18 to -0.28 with the
    chars of the owned stub files, so owned files are not counted."""
    n = 0
    for e in w.get("context") or []:
        path, _, head = str(e).partition("#")
        f = Path(root) / path
        if head and "\n" not in path and f.is_file():
            sec = section(f.read_text(encoding="utf-8", errors="replace"), head)
            n += len(sec or "")
    return n


def launch_order(plan: dict, root, ncpu: int | None = None) -> list:
    """[{"name", "nice", "slack", "delay"}] in launch order: critical workers first, so they get the CPU.

    30 `claude -p` workers started at once on 4 CPUs: median init 10.6 s, first result 19.4 s (alone: init
    0.7 s, result 4.1 s). With 8 of the 30 at nice 0 and 22 at nice 15, those 8 got init 2.1 s and result 6.6 s.
    Slack is how long a worker can be late without delaying the end: forward pass fin(w) = max(gen_s(w),
    fin of its needs) + HOP_S with unlimited CPU, backward pass LF(w) = the latest finish that keeps the
    makespan M, slack = LF - HOP_S - gen_s. Order: least slack first, ties by larger weight, then name.
    nice = min(19, 4 * (rank // ncpu)): the first ncpu workers run at nice 0.
    delay: a worker whose needs finish long after it could have is held back so it does not compete for the CPU
    while booting: dep_wait = max(fin of needs) - gen_s, delay = min(STAGGER_CAP_S, max(0, dep_wait -
    STAGGER_MARGIN_S)); 0 without needs or with ATLAS_CREW_STAGGER=off."""
    ncpu = ncpu or os.cpu_count() or 4
    ws = {w["name"]: w for w in plan["workers"]}
    weight = {n: _weight(w, root) for n, w in ws.items()}
    gen = {n: weight[n] / GEN_CHARS_PER_S for n in ws}
    needs = {n: [x for x in (w.get("needs") or []) if x in ws and x != n] for n, w in ws.items()}
    dependents = {n: [] for n in ws}
    for n, deps in needs.items():
        for d in deps:
            dependents[d].append(n)
    fin: dict = {}

    def forward(n, seen=()):
        if n not in fin:
            deps = [d for d in needs[n] if d not in seen]  # needs is acyclic (_break_cycles); belt and braces
            fin[n] = max([gen[n]] + [forward(d, (*seen, n)) for d in deps]) + HOP_S
        return fin[n]

    for n in ws:
        forward(n)
    makespan = max(fin.values())
    lf: dict = {}

    def backward(n, seen=()):
        if n not in lf:
            ds = [d for d in dependents[n] if d not in seen]
            lf[n] = makespan if not ds else min(backward(d, (*seen, n)) - HOP_S for d in ds)
        return lf[n]

    slack = {n: backward(n) - HOP_S - gen[n] for n in ws}
    order = sorted(ws, key=lambda n: (slack[n], -weight[n], n))
    stagger = os.environ.get("ATLAS_CREW_STAGGER", "on") != "off"

    def delay(n):
        if not stagger or not needs[n]:
            return 0.0
        dep_wait = max(fin[d] for d in needs[n]) - gen[n]
        return round(min(STAGGER_CAP_S, max(0.0, dep_wait - STAGGER_MARGIN_S)), 2)

    return [
        {"name": n, "nice": min(19, 4 * (i // ncpu)), "slack": round(slack[n], 2), "delay": delay(n)}
        for i, n in enumerate(order)
    ]


def save_stubs(rundir: Path, plan: dict, root: str) -> None:
    """Keep a pristine copy of every owned .py stub under `<rundir>/stubs/<rel>` before any worker runs."""
    for w in plan["workers"]:
        for rel in w["owns"]:
            src = Path(root, rel)
            if rel.endswith(".py") and src.is_file():
                dst = rundir / "stubs" / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(src, dst)


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
        "model": worker_model({}, {"model": a.model}),
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
    if os.environ.get("ATLAS_CREW_PRIORITY", "on") == "off":
        meta["launch"] = [{"name": n, "nice": 0, "slack": None, "delay": 0} for n in nicks]
    else:
        meta["launch"] = launch_order(plan, root)
    (rundir / "run.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    save_stubs(rundir, plan, root)
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
    for item in meta["launch"]:
        _launch(
            meta,
            rundir,
            item["name"],
            0,
            _self_cmd(
                "worker", "--rundir", str(rundir), "--name", item["name"], "--nice", str(item["nice"]),
                "--delay", str(item.get("delay", 0)),
            ),
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


def _wait_ready(rundir, names, rnd, deadline) -> bool:
    """Until every worker has exited (round `rnd`) or holds a current verified DONE."""
    while time.time() < deadline:
        if all(_exited(rundir, n, rnd) or atlas_irc.has_done(rundir / "irc", n) for n in names):
            return True
        time.sleep(0.5)
    return False


def _owned_hashes(root, plan) -> dict:
    """sha256 of every planned owned file now on disk (globs and directories expanded)."""
    import hashlib

    out = {}
    for w in plan["workers"]:
        for pat in w.get("owns") or []:
            if any(c in pat for c in "*?["):
                found = Path(root).glob(pat)
            else:
                f = Path(root, pat)
                found = f.rglob("*") if f.is_dir() else [f]
            for f in found:
                try:
                    if f.is_file():
                        out[f.relative_to(root).as_posix()] = hashlib.sha256(f.read_bytes()).hexdigest()
                except OSError:
                    pass
    return out


def _run_check(cmd, root, timeout=900):
    try:
        r = subprocess.run(
            cmd, shell=True, cwd=root, capture_output=True, text=True, timeout=timeout
        )
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {timeout}s"


SHARD_TAIL_CHARS = 6000  # per failing shard; a passing shard keeps 200 (summarize reads check_tail from the end)
_PLAIN_PYTEST = re.compile(r"\bpytest\b")
_SHELL_OPS = re.compile(r"[|&;<>`$()\n]")


def _known_test_files(plan: dict, root) -> list:
    """Union of every worker's `tests` entries that exist under root (globs expanded), as sorted posix rel paths."""
    found = set()
    for w in plan.get("workers") or []:
        found.update(_worker_test_files(w, root))
    return sorted(found)


def _worker_test_files(w: dict, root) -> set:
    """The existing files of one worker's `tests` entries (globs expanded), as posix rel paths."""
    found = set()
    for pat in w.get("tests") or []:
        if not pat:
            continue
        try:
            hits = Path(root).glob(pat) if any(c in pat for c in "*?[") else [Path(root, pat)]
            for f in hits:
                if f.is_file():
                    found.add(f.relative_to(root).as_posix())
        except (OSError, ValueError, NotImplementedError):
            continue
    return found


def _shard_files(files, root, n) -> list:
    """Greedy balance by file size: largest first into the lightest shard. Empty shards are dropped."""
    def size(f):
        try:
            return Path(root, f).stat().st_size
        except OSError:
            return 0

    shards = [[0, []] for _ in range(max(1, n))]
    for f in sorted(files, key=lambda f: (-size(f), f)):
        lightest = min(shards, key=lambda s: s[0])
        lightest[0] += size(f)
        lightest[1].append(f)
    return [sorted(fs) for _, fs in shards if fs]


def _shard_jobs(cmd, root, test_files, ncpu, skip=()):
    """[(shell command, label, is_rest)] for a sharded run, or [] when `cmd` runs unsharded: not a plain pytest
    command (no `|`, `&&`, `;`, `>` ...), fewer than 2 known files, or ATLAS_CREW_SHARD=off. Files in `skip` get
    no shard and are `--ignore`d by the rest shard."""
    skip = set(skip or ())
    files = [f for f in (test_files or []) if f not in skip]
    if (
        os.environ.get("ATLAS_CREW_SHARD", "").strip().lower() == "off"
        or len(files) + len(skip) < 2
        or not _PLAIN_PYTEST.search(cmd or "")
        or _SHELL_OPS.search(cmd or "")
    ):
        return []
    try:
        base = shlex.split(cmd)
    except ValueError:
        return []
    groups = _shard_files(files, root, min(max(1, int(ncpu or 1)), max(1, len(files))))
    jobs = [(shlex.join([*base, *g, "-p", "no:cacheprovider"]), ", ".join(g), False) for g in groups]
    ignores = [f"--ignore={f}" for f in sorted([*files, *skip])]
    jobs.append((shlex.join([*base, *ignores, "-p", "no:cacheprovider"]), "rest (everything else)", True))
    return jobs


def shard_count(cmd, root, test_files, ncpu) -> int:
    """Number of processes `sharded_check` runs for these arguments (1 when unsharded)."""
    return len(_shard_jobs(cmd, root, test_files, ncpu)) or 1


def sharded_check(cmd, root, test_files, ncpu, timeout=900, skip=()):
    """Run a plain pytest `cmd` as parallel shards: min(ncpu, files) shards of the workers' known test files
    plus one "rest" shard (`--ignore` for every known file) so tests outside their lists still run. The
    supervisor's global check runs after the last DONE, on the critical path: the 784-test `python3 -m pytest
    -q` took 3.95 s in one benchmark run and 8.5-8.9 s in two others, where one test file had a 5.1 s test.
    Returns (code, output): the first nonzero shard code (the rest shard's exit 5, no tests collected, counts
    as 0), passing shards' output first, failing last (the summary keeps the output tail). Anything unsharded runs `cmd` once through _run_check.
    `skip`: test files already verified by their worker's DONE (verified_test_files): not run, not sharded."""
    skip = sorted(set(skip or ()))
    jobs = _shard_jobs(cmd, root, test_files, ncpu, skip)
    if not jobs:
        return _run_check(cmd, root, timeout)
    procs = [
        (subprocess.Popen(c, shell=True, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True), label, rest)
        for c, label, rest in jobs
    ]
    t_end = time.time() + timeout
    results = []
    for pr, label, rest in procs:
        try:
            o, _ = pr.communicate(timeout=max(1.0, t_end - time.time()))
            code = pr.returncode
        except subprocess.TimeoutExpired:
            pr.kill()
            o, _ = pr.communicate()
            code, o = 124, f"timed out after {timeout}s\n{o or ''}"
        if rest and code == 5:  # nothing left outside the known files
            code = 0
        results.append((code, label, o or ""))
    combined = next((c for c, _, _ in results if c), 0)
    parts = []
    for code, label, o in sorted(results, key=lambda r: r[0] != 0):  # stable: failing shards last, so out[-800:] shows them
        parts.append(f"=== shard [{label}] exit {code} ===\n{o[-(SHARD_TAIL_CHARS if code else 200):]}")
    if skip:
        parts.insert(0, f"{len(skip)} test files verified by worker DONE on the same bytes; skipped")
    return combined, "\n".join(parts)


# Measured (30-module benchmark, 3 runs): after the last worker DONE the supervisor's sharded full-suite check
# took 4.4 s, 1.7 s and 3.9 s of wall time on the critical path (1.4 s at 18 modules), re-running test files
# every worker's `irc check` had just passed. A worker's DONE records digests of its own files and of its
# needs closure; matching digests mean the passing run saw exactly the bytes on disk, so that file is skipped.
_PLAIN_FLAGS = {"-q", "-qq", "-x", "-pno:cacheprovider"}
_PY_BIN = re.compile(r"^python[\d.]*$")


def _plain_pytest_files(unit, root):
    """Test files a unit_check names when it is plain pytest, else None. Allowlist: `python3 -m pytest` /
    `python -m pytest` / `pytest`, then only -q, -qq, -x, `-p no:cacheprovider` (or -pno:cacheprovider) and literal
    test file paths existing under root. Any other token (-k, --lf, --ignore-glob, ...) is not plain."""
    try:
        toks = shlex.split(unit or "")
    except ValueError:
        return None
    if _SHELL_OPS.search(unit or "") or not toks:
        return None
    head = os.path.basename(toks[0])
    if head == "pytest":
        rest = toks[1:]
    elif _PY_BIN.match(head) and toks[1:3] == ["-m", "pytest"]:
        rest = toks[3:]
    else:
        return None
    files, i = [], 0
    while i < len(rest):
        t = rest[i]
        if t in _PLAIN_FLAGS:
            pass
        elif t == "-p" and rest[i + 1:i + 2] == ["no:cacheprovider"]:
            i += 1
        elif not t.startswith("-") and Path(root, t).is_file():
            files.append(t)
        else:
            return None
        i += 1
    return files


def verified_test_files(plan: dict, root, irc_dir, cmd, test_files, ncpu) -> list:
    """Sorted test files whose every listing worker has a standing DONE (atlas_irc.latest_done_record) with
    digest == its own files' digest now, test_digest == the recomputed digest of its test files and shared pytest
    inputs (conftest.py, pytest.ini, pyproject.toml, setup.cfg, tox.ini), and peer_digests covering its whole needs closure, each equal to that
    peer's digest now, and whose unit_check is a plain pytest command naming the file. [] when the check does
    not shard or ATLAS_CREW_CHECK_CACHE=off."""
    if os.environ.get("ATLAS_CREW_CHECK_CACHE", "").strip().lower() == "off" or not _shard_jobs(cmd, root, test_files, ncpu):
        return []
    by_name = {x["name"]: x for x in plan.get("workers") or []}
    known, ok = set(test_files or []), {}
    for w in by_name.values():
        files = _worker_test_files(w, root) & known
        if not files:
            continue
        unit = w.get("unit_check") or ""
        toks = _plain_pytest_files(unit, root)
        plain = toks is not None
        rec = atlas_irc.latest_done_record(irc_dir, w["name"])
        pd = rec.get("peer_digests") if rec else None
        good = (
            plain
            and isinstance(pd, dict)
            and bool(rec.get("test_digest"))
            and rec.get("test_digest") == atlas_irc.test_inputs_digest(root, unit)
            and rec.get("digest") == atlas_irc._owned_digest(root, w.get("owns") or [])
            and all(
                p in by_name and pd.get(p) == atlas_irc._owned_digest(root, by_name[p].get("owns") or [])
                for p in _needs_closure(plan, w)
            )
        )
        for f in files:
            ok[f] = ok.get(f, True) and good and f in (toks or [])
    return sorted(f for f, v in ok.items() if v)


def _global_check(plan: dict, root, rundir, check, tfiles, ncpu):
    """(code, output, cached) of one sharded global check; cached = the test files skipped as worker-verified."""
    cached = verified_test_files(plan, root, rundir / "irc", check, tfiles, ncpu)
    code, out = sharded_check(check, root, tfiles, ncpu, skip=cached)
    return code, out, cached


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
    check = plan.get("check")
    # the global check needs every worker's files, not their processes' exit: exit tails run 1-8 s under
    # load. Wait until each worker has exited or holds a current verified DONE, check, then collect exits.
    _wait_ready(rundir, names, 0, deadline)
    before = _owned_hashes(root, plan)
    check_before_exit = not all(_exited(rundir, n, 0) for n in names)
    tfiles, ncpu = _known_test_files(plan, root), os.cpu_count() or 1
    nsh = shard_count(check, root, tfiles, ncpu) if check else 1
    code, out, cached = (0, "", []) if not check else _global_check(plan, root, rundir, check, tfiles, ncpu)
    finished = _wait_round(rundir, names, 0, min(deadline, time.time() + RESULT_GRACE_S + 10))
    if check and _owned_hashes(root, plan) != before:
        code, out, cached = _global_check(plan, root, rundir, check, tfiles, ncpu)  # a file changed while the check ran: its verdict is stale
    rounds.append(
        {
            "round": 0,
            "all_exited": finished,
            "check_started_before_exit": check_before_exit,
            "check_exit": code,
            "check_shards": nsh,
            "check_cached": cached,
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
                    # the unwired check: the lead has no `irc` on PATH and nothing to wait for
                    c2, o2 = _run_check(w.get("unit_check") or w["check"], root)
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
        tfiles = _known_test_files(plan, root)
        nsh = shard_count(check, root, tfiles, ncpu)
        code, out, cached = _global_check(plan, root, rundir, check, tfiles, ncpu)
        rounds.append(
            {
                "round": rnd,
                "workers": list(routed),
                "all_exited": finished,
                "check_exit": code,
                "check_shards": nsh,
                "check_cached": cached,
                "t": round(time.time() - meta["started"], 1),
            }
        )
    summary = summarize(rundir, meta, rounds, code, out)
    (rundir / "summary.json").write_text(
        json.dumps(summary, indent=1), encoding="utf-8"
    )
    shutil.rmtree(Path(root) / ".atlas" / "tmp" / meta["run_id"], ignore_errors=True)  # staged copies
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
    w.add_argument("--nice", type=int, default=0, help="os.nice() increment before claude starts")
    w.add_argument("--delay", type=float, default=0, help="seconds to sleep before claude starts (round 0 only)")
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
