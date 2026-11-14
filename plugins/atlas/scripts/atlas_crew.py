#!/usr/bin/env python3
"""atlas_crew -- a team of lean coding-agent workers in tmux that talk over an IRC channel.

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
import atlas_crew_seal  # noqa: E402
import atlas_irc  # noqa: E402

CREW_REL = Path(".atlas") / ".run" / "crew"
NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,31}$")
# a run id names the run directory and the tmux session `atlas-<id>`: tmux turns `.` and `:` into `_`, so a
# session made as atlas-v1.2 is atlas-v1_2 and every later `-t atlas-v1.2` (worker windows, kill) misses it
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
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
You are one worker of an Atlas crew: several coding-agent sessions building one deliverable in parallel,
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
  irc give <file> <peer> [note]       hand a file you own to a peer (it may edit it from then on, fixes
                                      for it go to it); use it when the peer is better placed to finish it
  irc claim <file>                    take a file nobody owns yet (a new shared helper); first claim wins
  Both time out after 100s (the shell kills a command after 2 minutes): rerun on a timeout.
  Never `sleep`: wait with `irc wait`. Peers are the workers listed below; the lead posts no READY.
  irc read                            print anything unread
Messages from peers are pushed to you automatically after your tool calls as [irc] lines.

Rules:
1. Edit only the files you own; edits elsewhere are blocked. Need a change in a peer's file? Ask its owner,
   who either makes it or hands you the file with `irc give`; a lease that moves is announced on the channel.
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
        for p in w["owns"]:
            if not isinstance(p, str) or not p.strip() or os.path.isabs(p) or ".." in Path(p).parts:
                raise ValueError(
                    f"worker {name} owns {p!r}: an owned path is relative to the project root and stays inside it"
                )
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
            "ATLAS_WORKER_NAME": w["name"],
            "ATLAS_MANDATES": "off",
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


def worker_argv(model, effort, settings, sid, prompt, resume=None, name=None, harness="claude") -> list:
    if harness == "codex":
        # codex has no replacement system prompt or --settings: the protocol rides in the prompt
        argv = ["codex", "exec"]
        if resume:
            argv += ["resume", resume, "--json"]
        else:
            argv += ["--json", "--sandbox", "workspace-write"]
        if model:
            argv += ["--model", model]
        if effort:
            argv += ["--config", f'model_reasoning_effort="{effort}"']
        return [*argv, BASE_PROMPT + CODEX_NOTE + PROTOCOL + prompt]
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


CODEX_NOTE = """\
Codex harness: "Bash" below means your shell tool; "Write" and "Edit" mean your file-editing tool
(apply_patch). Peer messages are not pushed to you: run `irc read` between steps.

"""


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
        kind = _event_type(line)
        if kind == "result":
            return not json.loads(line).get("is_error")
        if kind == "turn.completed":  # codex exec --json
            return True
        if kind in ("turn.failed", "error"):
            return False
    return False


def _event_type(line: str) -> str:
    if '"type"' not in line:
        return ""
    try:
        event = json.loads(line)
    except ValueError:
        return ""
    return str(event.get("type") or "") if isinstance(event, dict) else ""


def _codex_thread_id(log_path) -> str | None:
    try:
        lines = Path(log_path).read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return None
    for line in lines:
        if _event_type(line) != "thread.started":
            continue
        tid = json.loads(line).get("thread_id")
        if tid:
            return str(tid)
    return None


# claude leads its own process group in the wrapper's session (not a new session: a session has no pane
# terminal, and `setsid` made tmux's C-c, a SIGINT to the pane's foreground group, miss claude)
_OWN_GROUP = {"process_group": 0} if sys.version_info >= (3, 11) else {"preexec_fn": os.setpgrp}


def _hand_terminal(pgid: int, fd: int | None = None) -> int | None:
    """Make process group `pgid` the foreground group of the pane terminal on stdout, as a shell does for a job.
    Returns the terminal's fd (None when stdout is no terminal or the group is gone). SIGTTOU is blocked for the
    call: it is how a background group is told off for this, and the wrapper is one once claude runs."""
    try:
        if fd is None:
            fd = sys.stdout.fileno()
            if not os.isatty(fd):
                return None
        old = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTTOU})
        try:
            os.tcsetpgrp(fd, pgid)
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, old)
        return fd
    except (OSError, ValueError, AttributeError):
        return None


def cmd_worker(a) -> int:
    """Pane command: run one worker (or one fix round), render it, log it, record the exit."""
    rundir = Path(a.rundir)
    try:  # first thing: the supervisor treats a gone pid with no exit file as a dead worker
        (rundir / "wpid").mkdir(exist_ok=True)
        (rundir / "wpid" / f"{a.name}.r{a.round}").write_text(str(os.getpid()))
    except OSError:
        pass
    meta = json.loads((rundir / "run.json").read_text(encoding="utf-8"))
    plan = meta["plan"]
    w = next(x for x in plan["workers"] if x["name"] == a.name)
    root = meta["root"]
    rnd = a.round
    sid_file = rundir / "sid" / f"{a.name}"
    harness = meta.get("harness", "claude")
    if rnd == 0:
        # codex picks its own thread id; it is read from the log after the run
        sid = "" if harness == "codex" else str(uuid.uuid4())
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
    argv = worker_argv(
        model,
        effort,
        meta["settings"],
        sid,
        prompt,
        resume=resume,
        name=f"{meta['run_id']}-{a.name}",
        harness=harness,
    )
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
    # `kill` (SIGTERM) and a closing pane (SIGHUP) must stop claude even when they land between Popen and the
    # pid-file write below: the handler stops claude's group, and the loop then ends and the exit record is written
    stop = {"proc": None, "asked": False}

    def _stop_child(_sig=None, _frm=None):
        stop["asked"] = True
        if stop["proc"] is not None:
            try:
                os.killpg(stop["proc"].pid, signal.SIGTERM)
            except OSError:
                pass

    old_handlers = {}
    for sg in (signal.SIGTERM, signal.SIGHUP):
        try:
            old_handlers[sg] = signal.signal(sg, _stop_child)
        except (ValueError, OSError):  # not the main thread
            pass
    with log_path.open("w", encoding="utf-8") as log:
        log.write("$ " + shlex.join(argv[:-1]) + " <prompt>\n")
        log.flush()
        try:
            if stop["asked"]:
                raise ChildProcessError  # stopped before claude started: start none
            proc = subprocess.Popen(
                argv,
                cwd=root,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                **_OWN_GROUP,  # its own process group: the supervisor and `kill` stop claude with its children
            )
            stop["proc"] = proc
            if stop["asked"]:
                _stop_child()
            tty = _hand_terminal(proc.pid)  # the pane's Ctrl-C goes to claude's group, not to this wrapper
            (rundir / "pid").mkdir(exist_ok=True)
            (rundir / "pid" / a.name).write_text(str(proc.pid))
            reaper = None
            for line in proc.stdout:
                log.write(line)
                log.flush()
                if reaper is None and _event_type(line) in ("result", "turn.completed"):
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
            _hand_terminal(os.getpgrp(), tty)
            if reaper is not None:
                reaper.cancel()
                if code != 0 and _result_ok(log_path):
                    code = 0  # reaped after a successful result: the work finished
        except FileNotFoundError:
            log.write(f"{argv[0]} not found on PATH\n")
            code = 127
        except ChildProcessError:
            log.write("stopped before claude started\n")
            code = 143
        finally:
            for sg, old in old_handlers.items():
                try:
                    signal.signal(sg, old)
                except (ValueError, OSError):
                    pass
    if harness == "codex":
        sid = _codex_thread_id(log_path) or sid
        if sid:
            sid_file.write_text(sid)
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


LAUNCH_GRACE_S = 60  # a wrapper that has written no pid this long after its launch never started


def _launch(meta: dict, rundir: Path, name: str, rnd: int, cmd: str) -> str | None:
    """Start one worker wrapper. Returns None, or the launch error after recording it as the worker's exit
    (126) so the supervisor reports the worker as failed instead of waiting for it until the deadline."""
    session = meta["session"]
    (rundir / "launched").mkdir(parents=True, exist_ok=True)
    (rundir / "launched" / f"{name}.r{rnd}").write_text(str(time.time()))
    err = None
    try:
        if meta["tmux"]:
            wname = name if rnd == 0 else f"{name}.fix{rnd}"
            res = _tmux("new-window", "-d", "-t", session, "-n", wname, cmd)
            if res.returncode != 0:
                err = f"tmux new-window failed ({res.returncode}): {(res.stderr or '').strip()}"
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
    except (OSError, subprocess.SubprocessError) as exc:
        err = f"launch failed: {exc}"
    if err:
        _write_exit(rundir, name, rnd, {"exit": 126, "wall_s": None, "sid": None, "launch_error": err})
    return err


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
    try:
        if not (a.spec and a.files):
            raise ValueError("plan needs --spec and --files")
        plan = auto_plan(root, a.spec, a.files, a.tests, a.check, a.goal)
    except (OSError, ValueError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 2
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


# Same order as atlas_mux.SESSION_ENV (the spawn-team --session fallback).
LEAD_SESSION_ENV = ("CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID", "ATLAS_SESSION_ID")


def lead_session(flag=None) -> str:
    """The lead session id owning a run: --session, else the first set LEAD_SESSION_ENV var, else the empty string."""
    try:
        sid = flag or next((os.environ[k] for k in LEAD_SESSION_ENV if os.environ.get(k)), "")
        return str(sid or "")
    except Exception:
        return ""


# Poll interval of every wait on a file another process writes (summary, exits, DONE): the measured gap between
# the last DONE and the published summary was 0.44-0.91 s, mostly a 0.5 s sleep; a stat per poll costs nothing.
POLL_S = 0.05
GREEN_CHECK_TIMEOUT = 300


_GUARD_DRIVER = (
    "import json, sys, pytest\n"
    "n = int(sys.argv[1]); flags = sys.argv[2:2 + n]\n"
    "res = {f: int(pytest.main([*flags, f])) for f in sys.argv[2 + n:]}\n"
    "sys.stdout.write('\\nATLAS_GUARD ' + json.dumps(res) + '\\n')\n"
)


def _pytest_unit(unit: str, root):
    """(interpreter, flags, test files) when `unit` is `<python> -m pytest` with only the flags
    _plain_pytest_files allows and at least one existing test file, else None."""
    files = _plain_pytest_files(unit, root)
    if not files:
        return None
    toks = shlex.split(unit)
    if not _PY_BIN.match(os.path.basename(toks[0])):
        return None
    return toks[0], [t for t in toks[3:] if t not in files], files


def _guard_codes(units: list, root, timeout) -> dict:
    """{index: exit code} of each (index, unit check) pair. Plain-pytest checks run as one `pytest.main` per test
    file inside a few shared interpreters (min(cpus, files) of them, grouped by interpreter and flags) instead of
    one process per worker: 16 pytest start-ups on 4 cpus were 1.3 s, and the exit code of each file is the one
    its own command line gives. Anything else runs as its own shell command."""
    codes: dict = {}
    text = dict(units)
    groups: dict = {}
    singles = []
    for i, unit in units:
        parts = _pytest_unit(unit, root)
        if parts and len(parts[2]) == 1:
            groups.setdefault((parts[0], tuple(parts[1])), []).append((i, parts[2][0]))
        else:
            singles.append((i, unit))
    jobs = []  # (target(), indices)
    for (py, flags), members in groups.items():
        if len(members) < 2:
            singles.extend((i, text[i]) for i, _ in members)
            continue
        by_file = {}
        for i, f in members:
            by_file.setdefault(f, []).append(i)
        for chunk in _shard_files(list(by_file), root, min(os.cpu_count() or 1, len(by_file))):
            argv = [py, "-c", _GUARD_DRIVER, str(len(flags)), *flags, *chunk]
            jobs.append((argv, [(f, by_file[f]) for f in chunk]))

    def run_group(argv, files):
        try:
            _, o, timed_out = atlas_irc.run_shell(shlex.join(argv), root, timeout)
            line = None if timed_out else next((l for l in reversed(o.splitlines()) if l.startswith("ATLAS_GUARD ")), None)
            res = json.loads(line[len("ATLAS_GUARD "):]) if line else {}
        except (OSError, ValueError):
            res = {}
        for f, idxs in files:
            for i in idxs:  # no verdict (driver died): run the worker's own command, as before
                codes[i] = res[f] if f in res else _run_check(text[i], root, timeout=timeout)[0]

    def one(i, unit):
        codes[i] = _run_check(unit, root, timeout=timeout)[0]

    threads = [threading.Thread(target=run_group, args=j, daemon=True) for j in jobs]
    threads += [threading.Thread(target=one, args=u, daemon=True) for u in singles]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return codes


def green_check_guard(plan: dict, root, timeout=GREEN_CHECK_TIMEOUT) -> None:
    """Raise ValueError when a worker unit check already exits 0 before any work. crew_worker ends a worker as
    soon as its check passes, so a check that is green at launch would end it mid-work and report DONE falsely.
    The checks run at once, not one after another (8 pytest start-ups held every worker back about 4 s, and one
    hung check held the rest up to `timeout` each), and plain-pytest checks share interpreters (_guard_codes)."""
    units = [(w, (w.get("unit_check") or "").strip()) for w in plan["workers"]]
    units = [(w, u) for w, u in units if u]
    codes = _guard_codes([(i, u) for i, (_, u) in enumerate(units)], root, timeout)
    for i, (w, unit) in enumerate(units):
        if codes.get(i) == 0:
            raise ValueError(
                f"worker {w["name"]!r}: its check already passes before any work ({unit!r}), so the worker "
                "would be ended at once and report DONE falsely; give it a check that fails until the task is "
                "done, or pass --allow-green-check"
            )


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
        if not getattr(a, "allow_green_check", False):
            green_check_guard(plan, root)
    except (OSError, ValueError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 2
    run_id = a.run_id or "crew-" + time.strftime("%H%M%S") + uuid.uuid4().hex[:4]
    if not RUN_ID_RE.match(run_id):
        print(json.dumps({"ok": False, "error": f"run id {run_id!r} must match {RUN_ID_RE.pattern} (it names a directory and a tmux session)"}))
        return 2
    rundir = _run_dir(root, run_id)
    try:  # a run id is used once: a reused dir would carry over killed, exit/, pid/ and summary.json
        rundir.parent.mkdir(parents=True, exist_ok=True)
        rundir.mkdir()
    except FileExistsError:
        print(json.dumps({"ok": False, "error": f"run id {run_id!r} already exists at {rundir}: pick another --run-id"}))
        return 2
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
        "harness": getattr(a, "harness", None) or "claude",
        "settings": worker_settings(rundir),
        "session": f"atlas-{run_id}",
        "lead_session": lead_session(getattr(a, "session", None)),
        "tmux": tmux,
        "started": time.time(),
        "fix_rounds": a.fix_rounds,
        "timeout": a.timeout,
        "changelog": (getattr(a, "changelog", None) or "").strip() or None,
        "seal_home": str(atlas_crew_seal.home()),  # where the seal record lives, whatever ATLAS_HOME a later reader has
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
    sealed = atlas_crew_seal.create(rundir, run_id)  # the supervisor signs summary.json with this record's key
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
        gw = subprocess.Popen(
            shlex.split(_self_cmd_irc(rundir, "serve")),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        if isinstance(getattr(gw, "pid", None), int):  # the supervisor and `kill` stop it
            (rundir / "gateway.pid").write_text(str(gw.pid))
    launch_errors = {}
    for item in meta["launch"]:
        err = _launch(
            meta,
            rundir,
            item["name"],
            0,
            _self_cmd(
                "worker", "--rundir", str(rundir), "--name", item["name"], "--nice", str(item["nice"]),
                "--delay", str(item.get("delay", 0)),
            ),
        )
        if isinstance(err, str):
            launch_errors[item["name"]] = err
    # the supervisor owns the run from here: global check, fix rounds, summary
    sup = _self_cmd("supervise", "--rundir", str(rundir))
    sup_proc = subprocess.Popen(
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
                obj, bad = _load_summary(rundir)
                if bad:  # no point waiting out the budget: a signed summary is published whole
                    print(json.dumps({"ok": False, "error": f"run {run_id!r} summary refused: {bad}"}))
                    return 1
                print(json.dumps(lead_view(obj, rundir)))
                return 0 if obj.get("ok") is True else 1
            gone = _supervisor_gone(rundir, sup_proc.poll if isinstance(getattr(sup_proc, "pid", None), int) else None)
            if gone:
                print(json.dumps(gone))
                return 1
            time.sleep(POLL_S)
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
                "next": _self_cmd("wait", "--run", run_id, "--root", root),
                **({"launch_errors": launch_errors} if launch_errors else {}),
                **({} if sealed else {"warning_seal": f"could not write the run's seal under {atlas_crew_seal.record_path(rundir).parent}: the completion gate will not credit this crew"}),
                **({"warning": "no lead session id: pass --session <id> or the completion gate will not credit this crew"} if not meta["lead_session"] else {}),
            }
        )
    )
    return 3 if a.wait else 0  # 3: still running, same code as `wait` timing out


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


def _write_exit(rundir: Path, name: str, rnd: int, rec: dict) -> None:
    """Record an exit the worker wrapper could not (dead, never started); never overwrites its own file."""
    exit_dir = rundir / "exit"
    exit_dir.mkdir(parents=True, exist_ok=True)
    try:
        with open(exit_dir / f"{name}.r{rnd}.json", "x", encoding="utf-8") as fh:
            fh.write(json.dumps(rec))
    except FileExistsError:
        pass


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except OSError:
        return True
    try:  # a zombie (dead, not yet reaped by its parent) is gone for our purposes
        return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[0] != "Z"
    except (OSError, IndexError):
        return True


def _worker_gone(rundir: Path, name: str, rnd: int) -> str | None:
    """Why the worker's wrapper is dead with no exit file (its pid is gone, or it never wrote one), else None."""
    try:
        pid = int((rundir / "wpid" / f"{name}.r{rnd}").read_text())
    except (OSError, ValueError):
        try:
            launched = float((rundir / "launched" / f"{name}.r{rnd}").read_text())
        except (OSError, ValueError):
            return None
        return f"never started ({LAUNCH_GRACE_S:g}s after launch)" if time.time() - launched > LAUNCH_GRACE_S else None
    return None if _pid_alive(pid) else f"worker process {pid} is gone with no exit recorded"


def _settle(rundir: Path, name: str, rnd: int):
    """The worker's exit record; a dead wrapper with none gets one (137, died) so every waiter sees it."""
    ex = _exited(rundir, name, rnd)
    if ex:
        return ex
    why = _worker_gone(rundir, name, rnd)
    if not why:
        return None
    ex = _exited(rundir, name, rnd)  # the wrapper writes its exit just before it dies
    if ex:
        return ex
    _write_exit(rundir, name, rnd, {"exit": 137, "wall_s": None, "sid": None, "died": True, "why": why})
    _stop_pidfile(rundir / "pid" / name, rundir.name)  # the wrapper is gone; its claude must not keep writing files
    return _exited(rundir, name, rnd)


def _wait_round(rundir, names, rnd, deadline) -> bool:
    while time.time() < deadline:
        if all([_settle(rundir, n, rnd) for n in names]):
            return True
        time.sleep(POLL_S)
    return False


def _wait_ready(rundir, names, rnd, deadline) -> bool:
    """Until every worker has exited (round `rnd`) or holds a current verified DONE."""
    while time.time() < deadline:
        if all([_settle(rundir, n, rnd) or atlas_irc.has_done(rundir / "irc", n) for n in names]):
            return True
        time.sleep(POLL_S)
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
    """(exit code, stdout + stderr) of shell `cmd` in root. A timeout kills the check's whole process group and
    is 124 with the output so far after the budget line (it shows where the check hung)."""
    code, out, timed_out = atlas_irc.run_shell(cmd, root, timeout)
    if timed_out:
        return 124, f"timed out after {timeout}s" + (f"\n{out}" if out else "")
    return code, out


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


_NO_RECURSE = ("*.egg", ".*", "_darcs", "build", "CVS", "dist", "node_modules", "venv", "{arch}")
_PYTEST_CONFIG = ("pytest.ini", ".pytest.ini", "tox.ini", "setup.cfg", "pyproject.toml")
_REST_WALK_MAX = 20000


def _rest_is_empty(cmd, root, known) -> bool:
    """True only when pytest, run as `cmd` from root, provably collects nothing outside the `known` test files:
    `cmd` names no path and no flag but the plain ones, no pytest config (pytest.ini, tox.ini, setup.cfg,
    pyproject.toml with a pytest table) or PYTEST_ADDOPTS can change what is collected, no conftest.py talks about
    collection, and no file matching pytest's default test_*.py / *_test.py sits outside `known` under a directory
    pytest recurses into. False when anything is unclear (the rest shard then runs, as before)."""
    import fnmatch

    if os.environ.get("PYTEST_ADDOPTS") or _plain_pytest_files(cmd, root) != []:
        return False
    known, seen = set(known or ()), 0
    try:
        for dirpath, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if not any(fnmatch.fnmatch(d, pat) for pat in _NO_RECURSE)]
            for f in files:
                seen += 1
                path = Path(dirpath, f)
                rel = path.relative_to(root).as_posix()
                if seen > _REST_WALK_MAX:
                    return False
                if f in _PYTEST_CONFIG:
                    text = path.read_text(encoding="utf-8", errors="replace")
                    if f == "pyproject.toml" and "pytest" not in text:
                        continue
                    if f in ("tox.ini", "setup.cfg") and "pytest" not in text:
                        continue
                    return False
                if f == "conftest.py" and "collect" in path.read_text(encoding="utf-8", errors="replace"):
                    return False
                if f.endswith(".py") and (f.startswith("test_") or f.endswith("_test.py")) and rel not in known:
                    return False
    except (OSError, ValueError):
        return False
    return True


def sharded_check(cmd, root, test_files, ncpu, timeout=900, skip=(), skip_passed=None):
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
    if jobs[-1][2] and _rest_is_empty(cmd, root, [*(test_files or []), *skip]):
        jobs = jobs[:-1]  # nothing outside the known files: the rest shard would only report "no tests ran"
    # each shard in its own process group (atlas_irc.run_shell): a hung shard is killed with every process it
    # started at the budget; killing the shell alone left pytest running and held this loop for the whole hang
    runs: list = [None] * len(jobs)

    def shard(i, c):
        runs[i] = atlas_irc.run_shell(c, root, timeout, merge=True)

    threads = [threading.Thread(target=shard, args=(i, c), daemon=True) for i, (c, _, _) in enumerate(jobs)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    results = []
    for (_, label, rest), (code, o, timed_out) in zip(jobs, runs):
        if timed_out:
            o = f"timed out after {timeout}s\n{o}"
        if rest and code == 5:  # nothing left outside the known files
            code = 0
        results.append((code, label, o or ""))
    combined = next((c for c, _, _ in results if c), 0)
    parts = []
    for code, label, o in sorted(results, key=lambda r: r[0] != 0):  # stable: failing shards last, so out[-800:] shows them
        parts.append(f"=== shard [{label}] exit {code} ===\n{o[-(SHARD_TAIL_CHARS if code else 200):]}")
    if skip:
        note = "" if skip_passed is None else f", {skip_passed} passed"
        parts.insert(0, f"{len(skip)} test files verified by worker DONE on the same bytes{note}; skipped")
    ran = [atlas_irc.passed_count(o) for c, _, o in results if c == 0]
    if not combined and (skip_passed is not None or not skip) and all(n is not None for n in ran if n):
        # one count for the whole check, so nobody re-runs the suite to learn it: DONE-verified files plus the shards
        total = (skip_passed or 0) + sum(n or 0 for n in ran)
        parts.append(f"crew total: {total} passed ({skip_passed or 0} verified by worker DONE, {total - (skip_passed or 0)} run here)")
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
    owner = _file_owners(plan, irc_dir, root)
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
            # a peer file the tests reach through imports must be in the DONE too: `needs` is optional on --plan
            # plans, and 17.16.0 cached tests/test_a.py as green after peer b rewrote the kit/b.py it imports
            and all(p in pd and pd.get(p) == atlas_irc._owned_digest(root, by_name[p].get("owns") or [])
                    for p in _import_peers(w, root, files, owner))
        )
        for f in files:
            ok[f] = ok.get(f, True) and good and f in (toks or [])
    return sorted(f for f, v in ok.items() if v)


def _file_owners(plan: dict, irc_dir, root=None) -> dict:
    """{rel path: worker} over every plan `owns` entry (globs and directories expanded under root), with live
    leases (irc give / claim) applied on top."""
    owner = {}
    for w in plan.get("workers") or []:
        for p in (atlas_irc._owned_files(root, w.get("owns")) if root else (w.get("owns") or [])):
            owner[p] = w["name"]
    owner.update(atlas_irc.leases(irc_dir) if irc_dir else {})
    return owner


IMPORT_WALK_MAX = 500


def _import_files(rel: str, root) -> list:
    """Existing .py files (repo-relative posix paths) that `rel` imports, whoever owns them: each module, the
    `__init__.py` of every package on its path, and for `from pkg import name` also pkg/name.py. An absolute name
    is tried from the root, from the importing file's directory (pytest's rootdir-less sys.path entry) and
    below src/."""
    try:
        tree = ast.parse((Path(root) / rel).read_text(encoding="utf-8", errors="replace"))
    except (SyntaxError, OSError, ValueError):
        return []
    here = Path(rel).parent
    out = []

    def mod(parts, bases):
        for base in bases:
            cur = base
            for i, part in enumerate(parts):
                cur = cur / part
                for cand in (cur / "__init__.py", Path(str(cur) + ".py") if i == len(parts) - 1 else None):
                    if cand is not None and (Path(root) / cand).is_file():
                        out.append(os.path.normpath(cand).replace(os.sep, "/"))
            if not parts and (Path(root) / base / "__init__.py").is_file():
                out.append(os.path.normpath(base / "__init__.py").replace(os.sep, "/"))

    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            for a in n.names:
                mod(a.name.split("."), [Path("."), here, Path("src")])
        elif isinstance(n, ast.ImportFrom):
            parts = n.module.split(".") if n.module else []
            if n.level:
                base = here
                for _ in range(n.level - 1):
                    base = base.parent
                bases = [base]
            else:
                bases = [Path("."), here, Path("src")]
            mod(parts, bases)
            for a in n.names:
                mod([*parts, a.name], bases)
    return [f for f in dict.fromkeys(out) if f != rel]


def _import_peers(w: dict, root, test_files, owner: dict) -> set:
    """Workers other than `w` that own a file reachable by Python imports from `w`'s test files, its own files or
    the conftest.py files above its tests. The walk opens every local .py file, owned or not: an unowned
    conftest.py or package __init__.py that re-exports a peer's file still ties the test to it."""
    start = [*test_files, *atlas_irc._owned_files(root, w.get("owns"))]
    for t in test_files:
        for d in Path(t).parents:
            c = (d / "conftest.py").as_posix().removeprefix("./")
            if (Path(root) / c).is_file():
                start.append(c)
    seen, todo = set(), start
    while todo and len(seen) < IMPORT_WALK_MAX:
        f = todo.pop()
        if f in seen:
            continue
        seen.add(f)
        if f.endswith(".py"):
            todo.extend(_import_files(f, root))
    return {owner[f] for f in seen if f in owner and owner[f] != w["name"]}


def _global_check(plan: dict, root, rundir, check, tfiles, ncpu):
    """(code, output, cached) of one sharded global check; cached = the test files skipped as worker-verified."""
    cached = verified_test_files(plan, root, rundir / "irc", check, tfiles, ncpu)
    code, out = sharded_check(check, root, tfiles, ncpu, skip=cached, skip_passed=done_passed(plan, root, rundir / "irc", cached))
    return code, out, cached


def done_passed(plan: dict, root, irc_dir, cached):
    """Sum of the `passed` counts on the standing DONEs of the workers whose test files are all in `cached`,
    or None when any cached file is not covered by exactly one such DONE (then no total is claimed)."""
    if not cached:
        return 0
    known, cover, total = set(cached), {}, 0
    for w in plan.get("workers") or []:
        files = _worker_test_files(w, root) & known
        if not files:
            continue
        rec = atlas_irc.latest_done_record(irc_dir, w["name"]) or {}
        n = rec.get("passed")
        if not isinstance(n, int) or isinstance(n, bool):
            return None
        total += n
        for f in files:
            cover[f] = cover.get(f, 0) + 1
    return total if set(cover) == known and all(v == 1 for v in cover.values()) else None


def route_failures(plan: dict, output: str, moved: dict | None = None) -> dict:
    """{worker: failure excerpt} for a failed global check: a worker gets the failures that name a
    file it owns or one of its `tests`. Unrouted failures go to every worker whose own check fails.
    `moved` is the live lease table (atlas_irc.leases): a file handed over with `irc give` routes to
    its new owner, not to the plan's."""
    out = {}
    lines = output.splitlines()
    moved = moved or {}
    for w in plan["workers"]:
        own = [p for p in (w.get("owns") or []) if moved.get(p, w["name"]) == w["name"]]
        own += [p for p, who in moved.items() if who == w["name"] and p not in own]
        keys = [k for k in own + (w.get("tests") or [])]
        hit = [
            ln
            for ln in lines
            if any(k and k.split("*")[0] and k.split("*")[0] in ln for k in keys)
        ]
        if hit:
            out[w["name"]] = "\n".join(hit[-40:])
    return out


def _killed(rundir: Path) -> bool:
    return (rundir / "killed").exists()


def _bucket_size(n: int) -> str:
    return "1" if n <= 1 else "2" if n == 2 else "3-4" if n <= 4 else "5-8" if n <= 8 else "9+"


def _bucket_wall(s: float) -> str:
    return "lt1m" if s < 60 else "1to5m" if s < 300 else "5to15m" if s < 900 else "15to60m" if s < 3600 else "ge60m"


def _count_run(rundir: Path, summary: dict) -> None:
    """Anonymous crew.* counters for one finished run (closed-set buckets only, never a name or path).
    Never raises; atlas_analytics validates the keys and is off when the user opted out."""
    try:
        import atlas_analytics

        wall = float(summary.get("wall_s") or 0)
        if summary.get("killed"):
            outcome = "killed"
        elif summary.get("ok"):
            outcome = "done"
        else:
            # the summary has no timeout flag: the supervisor's deadline is run.json started+timeout, so a
            # red run that used its whole budget is a timeout, any other red run a failure
            try:
                limit = float(json.loads((rundir / "run.json").read_text(encoding="utf-8")).get("timeout") or 3600)
            except (OSError, ValueError, TypeError, AttributeError):
                limit = None
            outcome = "timeout" if limit is not None and wall >= limit else "failed"
        # rounds[0] is the first attempt (round 0), not a fix round: count only the fix rounds after it
        fix = max(0, len(summary.get("rounds") or []) - 1)
        ce = summary.get("check_exit")
        check = "none" if ce is None else "pass" if ce == 0 else "fail"
        for key in (
            "crew.workers." + _bucket_size(len(summary.get("workers") or [])),
            "crew.outcome." + outcome,
            "crew.wall." + _bucket_wall(wall),
            "crew.rounds." + ("3+" if fix >= 3 else str(fix)),
            "crew.check." + check,
        ):
            atlas_analytics.record(key)
    except Exception:  # noqa: BLE001 -- telemetry never changes a run
        pass


def _write_summary(rundir: Path, summary: dict) -> None:
    first = not (rundir / "summary.json").exists()  # a second write for the same run must not count twice
    tmp = rundir / f"summary.json.{os.getpid()}.tmp"
    tmp.write_text(json.dumps(atlas_crew_seal.sign(rundir, summary), indent=1), encoding="utf-8")
    os.replace(tmp, rundir / "summary.json")
    if first:
        _count_run(rundir, summary)


def _pid_from(path: Path) -> int | None:
    try:
        return int(path.read_text().strip())
    except (OSError, ValueError):
        return None


def _group_of(pid: int, needle: str) -> int | None:
    """pid's process group id when pid leads its own group and its command line holds `needle`, else None."""
    try:
        if os.getpgid(pid) != pid:
            return None
        if needle not in Path(f"/proc/{pid}/cmdline").read_bytes().decode("utf-8", "replace"):
            return None
    except OSError:
        return None
    return pid


def _read_argv(pid: int) -> list[str]:
    """pid's argv from /proc/<pid>/cmdline (NUL separated); OSError when it cannot be read."""
    raw = Path(f"/proc/{pid}/cmdline").read_bytes().decode("utf-8", "replace")
    return [a for a in raw.split("\0") if a]


def _argv_is_ours(argv: list[str], needle: str) -> bool:
    """True when an argv element ties the process to run `needle`: a path holding it as a whole component (the run
    directory or a file under it), or a claude worker name `<run_id>-<w>` (after --name, or as --name=...)."""
    for i, arg in enumerate(argv):
        if arg.startswith("--name="):
            arg = arg[len("--name="):]
            if arg.startswith(needle + "-"):
                return True
            continue
        if i and argv[i - 1] == "--name" and arg.startswith(needle + "-"):
            return True  # claude worker: --name <run_id>-<w>
        parts = [x for x in arg.split("/") if x]
        if "/" in arg and needle in parts:
            return True  # the run directory (or a path under it) as a whole path component
    return False


def _is_ours(pid: int, needle: str) -> bool:
    """False when pid's argv is readable and does not match `needle` (the run id) exactly: the pid file outlived its
    process and the system gave the pid to another one. True without /proc (the file is trusted)."""
    try:
        argv = _read_argv(pid)
    except FileNotFoundError:
        return not Path("/proc/self").exists()  # /proc mounted and no entry: the pid is gone
    except OSError:
        return True
    return _argv_is_ours(argv, needle)


def _stop_pidfile(path: Path, needle: str, wait_s: float = 3.0) -> int | None:
    """SIGTERM (then SIGKILL) the process group whose pid `path` records, only while its command line still
    holds `needle` (the run id), so a recycled pid is never signalled. Returns the pid stopped, else None."""
    pid = _pid_from(path)
    if not pid or pid == os.getpid() or not _pid_alive(pid):
        return None
    try:
        if needle not in Path(f"/proc/{pid}/cmdline").read_bytes().decode("utf-8", "replace"):
            return None
    except OSError:
        pass  # no /proc: trust the file

    def send(sig):
        try:
            if os.getpgid(pid) == pid:
                os.killpg(pid, sig)
            else:
                os.kill(pid, sig)
        except OSError:
            pass

    send(signal.SIGTERM)
    end = time.time() + wait_s
    while time.time() < end and _pid_alive(pid):
        time.sleep(0.05)
    if _pid_alive(pid):
        send(signal.SIGKILL)
    return pid


def _mark_stopped(rundir: Path, name: str) -> None:
    """Record that the supervisor stops `name` after a green check on its verified DONE (the fast polls make
    that land while the slowest claude is still in its final turn)."""
    try:
        (rundir / "stopped").mkdir(exist_ok=True)
        (rundir / "stopped" / name).write_text(str(time.time()))
    except OSError:
        pass


def _stale_dones(plan: dict, root, rundir: Path, check, tfiles, ncpu, cached) -> dict:
    """{worker: why} for workers whose standing DONE recorded a digest that no longer matches their owned files
    (edited after the DONE, e.g. by a worker that was then stopped) and whose unit check does not pass now. The
    DONE no longer describes the tree, so the check is re-run here; a worker with no check to re-run fails.
    A DONE still current costs nothing, and so does a worker whose test files the sharded global check just ran
    itself (none of them cached): that run already covers its unit check on the current files."""
    bad = {}
    sharded = bool(check) and bool(_shard_jobs(check, root, tfiles, ncpu))
    for w in plan["workers"]:
        rec = atlas_irc.latest_done_record(rundir / "irc", w["name"])
        if not rec or not rec.get("digest") or rec["digest"] == atlas_irc._owned_digest(root, w.get("owns") or []):
            continue
        mine = _worker_test_files(w, root)
        if sharded and mine and not (mine & set(cached or ())):
            continue
        cmd = (w.get("unit_check") or w.get("check") or "").strip()
        if not cmd:
            bad[w["name"]] = "files changed after its DONE and it has no check to re-run"
        else:
            c, _ = _run_check(cmd, root)
            if c:
                bad[w["name"]] = f"files changed after its DONE and its check now fails (exit {c})"
    return bad


def cmd_supervise(a) -> int:
    rundir = Path(a.rundir)
    meta = json.loads((rundir / "run.json").read_text(encoding="utf-8"))
    plan, root = meta["plan"], meta["root"]
    names = [w["name"] for w in plan["workers"]]
    deadline = meta["started"] + float(meta.get("timeout") or 3600)
    rounds = []
    check = plan.get("check")
    (rundir / "supervisor.pid").write_text(str(os.getpid()))  # `kill` stops this process

    def finish_killed() -> int:
        _write_summary(rundir, summarize(rundir, meta, rounds, 1, "killed", killed=True))
        _stop_pidfile(rundir / "gateway.pid", meta["run_id"])
        return 0

    # the global check needs every worker's files, not their processes' exit: exit tails run 1-8 s under
    # load. Wait until each worker has exited or holds a current verified DONE, check, then collect exits.
    _wait_ready(rundir, names, 0, deadline)
    before = _owned_hashes(root, plan)
    check_before_exit = not all(_exited(rundir, n, 0) for n in names)
    tfiles, ncpu = _known_test_files(plan, root), os.cpu_count() or 1
    nsh = shard_count(check, root, tfiles, ncpu) if check else 1
    code, out, cached = (0, "", []) if not check else _global_check(plan, root, rundir, check, tfiles, ncpu)
    if check and _owned_hashes(root, plan) != before:
        code, out, cached = _global_check(plan, root, rundir, check, tfiles, ncpu)  # a file changed while the check ran: its verdict is stale
        before = _owned_hashes(root, plan)

    def row0(finished):
        return {
            "round": 0,
            "all_exited": finished,
            "check_started_before_exit": check_before_exit,
            "check_exit": code,
            "check_shards": nsh,
            "check_cached": cached,
            "t": round(time.time() - meta["started"], 1),
        }

    def publish():
        summary = summarize(rundir, meta, rounds, code, out, stale=stale)
        if code == 0 and meta.get("changelog"):
            summary["changelog"] = write_changelog(root, meta["changelog"])
        _write_summary(rundir, summary)

    reap_s = RESULT_GRACE_S + 10
    stale: dict = {}
    green = code == 0 and not _killed(rundir)
    if green:
        # the first published ok-true must never flip: stop every worker still running (each holds a verified
        # DONE), so nothing edits an owned file after the verdict; a change while they stopped re-checks
        for n in names:
            if not _exited(rundir, n, 0):
                if _stop_pidfile(rundir / "pid" / n, rundir.name):
                    _mark_stopped(rundir, n)  # its signal exit is this stop, not a crash
        if check and _owned_hashes(root, plan) != before:
            code, out, cached = _global_check(plan, root, rundir, check, tfiles, ncpu)
            before = _owned_hashes(root, plan)
        green = code == 0
        stale = _stale_dones(plan, root, rundir, check, tfiles, ncpu, cached)
    if green:
        # green and no fix round follows: the verdict does not depend on the exit tails (1-30 s of a
        # lingering claude process), so publish it now and collect the exits after
        rounds.append(row0(all([_settle(rundir, n, 0) for n in names])))
        publish()
        finished = _wait_round(rundir, names, 0, min(deadline, time.time() + reap_s))
        if check and _owned_hashes(root, plan) != before:
            code, out, cached = _global_check(plan, root, rundir, check, tfiles, ncpu)
        rounds[0] = row0(finished)
    else:
        finished = _wait_round(rundir, names, 0, min(deadline, time.time() + reap_s))
        if check and _owned_hashes(root, plan) != before:
            code, out, cached = _global_check(plan, root, rundir, check, tfiles, ncpu)  # a file changed while the check ran: its verdict is stale
        rounds.append(row0(finished))
    for rnd in range(1, int(meta.get("fix_rounds") or 0) + 1):
        if code == 0 or not finished:
            break
        if _killed(rundir):
            return finish_killed()
        routed = route_failures(plan, out, atlas_irc.leases(rundir / "irc"))
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
    if _killed(rundir):
        return finish_killed()
    publish()
    shutil.rmtree(Path(root) / ".atlas" / "tmp" / meta["run_id"], ignore_errors=True)  # staged copies
    atlas_irc.post(
        rundir / "irc",
        "lead",
        f"#{meta['run_id']}",
        f"Crew finished: global check exit {code}.",
        kind="final",
    )
    for n in names:  # a claude still alive is in its own session now: kill-session would not reach it
        _stop_pidfile(rundir / "pid" / n, rundir.name)
    _stop_pidfile(rundir / "gateway.pid", meta["run_id"])  # the no-tmux gateway `run` started
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
    seen: dict = {}  # message id -> largest usage per field, for a process stopped before its result
    with fh:
        for line in fh:
            kind = _event_type(line)
            if kind in ("assistant", "stream_event"):
                _note_message_usage(line, seen)
                continue
            if kind == "turn.completed":
                # codex exec --json: usage is per turn; input_tokens includes the cached part
                usage = json.loads(line).get("usage") or {}
                cached = int(usage.get("cached_input_tokens") or 0)
                t["results"] += 1
                t["turns"] += 1
                t["input"] += max(int(usage.get("input_tokens") or 0) - cached, 0)
                t["cache_read"] += cached
                t["output"] += int(usage.get("output_tokens") or 0)
                continue
            if kind != "result":
                continue
            e = json.loads(line)
            t["results"] += 1
            t["cost_usd"] = float(e.get("total_cost_usd") or 0)
            t["turns"] += int(e.get("num_turns") or 0)
            t.update(input=0, cache_write=0, cache_read=0, output=0)
            for u in (e.get("modelUsage") or {}).values():
                t["input"] += u.get("inputTokens", 0)
                t["cache_write"] += u.get("cacheCreationInputTokens", 0)
                t["cache_read"] += u.get("cacheReadInputTokens", 0)
                t["output"] += u.get("outputTokens", 0)
    if not t["results"] and seen:
        # no result event: the process was stopped mid-turn (a worker stopped after its verified DONE). The
        # assistant messages it did stream are its real turns and tokens.
        t["turns"] = len(seen)
        for u in seen.values():
            t["input"] += u["input_tokens"]
            t["cache_write"] += u["cache_creation_input_tokens"]
            t["cache_read"] += u["cache_read_input_tokens"]
            t["output"] += u["output_tokens"]
    t["total"] = t["input"] + t["cache_write"] + t["cache_read"] + t["output"]
    t["cost_usd"] = round(t["cost_usd"], 4)
    return t


_USAGE_KEYS = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")


def _note_message_usage(line: str, seen: dict) -> None:
    """Fold the usage of one streamed assistant message (a message event, or a stream_event delta) into `seen`."""
    try:
        e = json.loads(line)
    except ValueError:
        return
    if not isinstance(e, dict):
        return
    msg = e.get("message") if e.get("type") == "assistant" else None
    if isinstance(msg, dict):
        mid, usage = msg.get("id"), msg.get("usage")
    else:
        ev = e.get("event")
        mid = e.get("api_message_id")
        usage = ev.get("usage") if isinstance(ev, dict) and ev.get("type") == "message_delta" else None
    if not mid or not isinstance(usage, dict):
        return
    cur = seen.setdefault(mid, dict.fromkeys(_USAGE_KEYS, 0))
    for k in _USAGE_KEYS:
        try:
            cur[k] = max(cur[k], int(usage.get(k) or 0))
        except (TypeError, ValueError):
            pass


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


def _final_exit(rundir: Path, name: str):
    """(round, exit record) of the worker's latest round that has one, else None."""
    best = None
    for p in (rundir / "exit").glob(f"{name}.r*.json"):
        m = re.fullmatch(rf"{re.escape(name)}\.r(\d+)\.json", p.name)
        if m and (best is None or int(m.group(1)) > best):
            best = int(m.group(1))
    return None if best is None else _exited(rundir, name, best)


def summarize(rundir: Path, meta: dict, rounds, code, out, killed: bool = False, stale=None) -> dict:
    """Run verdict. ok needs a green check and no failed worker: one whose final exit is nonzero, or that left no
    exit and holds no verified DONE. A worker whose DONE still stands under a green check is verified work; its
    nonzero exit (the reaper, a crash after the result) is reported in late_exits and a missing one in
    pending_exits (the supervisor publishes at once after a green check and collects exits after), neither red.
    The stop the supervisor itself makes after the green check (rundir/stopped/<name>) is no late exit: the
    worker row carries stopped_after_done."""
    names = [w["name"] for w in meta["plan"]["workers"]]
    workers, tot = [], {"total": 0, "cost_usd": 0.0}
    failed, late, pending, stopped = [], {}, [], []
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
        ex = _final_exit(rundir, n) or {}
        done = atlas_irc.has_done(rundir / "irc", n)
        if n in (stale or {}):
            failed.append({"name": n, "exit": ex.get("exit"), "why": stale[n]})
        elif not ex:
            if done:
                pending.append(n)
            else:
                failed.append({"name": n, "exit": None, "why": "no exit recorded and no verified DONE"})
        elif ex.get("exit") != 0:
            if done and code == 0 and (rundir / "stopped" / n).exists():
                stopped.append(n)  # the supervisor stopped it after the green check: not a crash, not late
            elif done and code == 0:
                late[n] = ex.get("exit")
            else:
                why = ex.get("launch_error") or ex.get("why") or f"exited {ex.get('exit')}"
                failed.append({"name": n, "exit": ex.get("exit"), "why": why})
        workers.append(
            {
                "name": n,
                "exit": ex.get("exit"),
                "wall_s": ex.get("wall_s"),
                "turns": u.get("turns"),
                "tokens": u.get("total"),
                "cost_usd": round(u.get("cost_usd", 0), 4),
                **({"stopped_after_done": True} if n in stopped else {}),
                "gate_refusals": gate.get("blocks"),
                "own_check_passed": gate.get("passed"),
            }
        )
        tot["total"] += u.get("total", 0)
        tot["cost_usd"] += u.get("cost_usd", 0)
    tot["cost_usd"] = round(tot["cost_usd"], 4)
    return {
        "ok": code == 0 and not failed and not killed,
        "killed": killed,
        "failed_workers": failed,
        "late_exits": late,
        "pending_exits": pending,
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


_UNRELEASED = re.compile(r"^##\s*\[?unreleased\]?\s*$", re.I)


def write_changelog(root, text: str) -> str | None:
    """Add `text` as one bullet under `## Unreleased` of docs/CHANGELOG.md (else CHANGELOG.md), creating that
    heading above the first `## ` section when there is none. A project that keeps no changelog gets none:
    creating docs/ would arm the Stop gate's docs letters (c)-(h) on a project that never had them. The
    supervisor calls it only after a green global check, so a red crew never records a change it did not
    make. Returns the path written, relative to root, or None when nothing was written."""
    root = Path(root)
    line = " ".join(str(text).split())
    if not line:
        return None
    bullet = line if line.startswith(("- ", "* ")) else f"- {line}"
    rel = next((p for p in ("docs/CHANGELOG.md", "CHANGELOG.md") if (root / p).is_file()), None)
    if rel is None:
        return None
    path = root / rel
    try:
        body = path.read_text(encoding="utf-8")
    except OSError:
        return None
    if bullet in body.splitlines():
        return rel
    lines = body.splitlines(keepends=True)
    if lines and not lines[-1].endswith("\n"):
        lines[-1] += "\n"
    head = next((i for i, x in enumerate(lines) if _UNRELEASED.match(x.strip())), None)
    if head is not None:
        j = head + 1
        while j < len(lines) and not lines[j].strip():
            j += 1
        lines[j:j] = ([] if j > head + 1 else ["\n"]) + [bullet + "\n"] + ([] if j == len(lines) or lines[j].lstrip().startswith(("- ", "* ")) else ["\n"])
    else:
        first = next((i for i, x in enumerate(lines) if x.startswith("## ")), None)
        block = ["## Unreleased\n", "\n", bullet + "\n", "\n"]
        if first is None:
            lines += (["\n"] if lines and lines[-1].strip() else []) + block[:-1]
        else:
            lines[first:first] = block
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(lines), encoding="utf-8")
    except OSError:
        return None
    return rel


def _known_run(a) -> Path | None:
    """The run's directory, or None after printing an unknown-run error (a run exists once `run` wrote run.json)."""
    rundir = _run_dir(a.root or os.getcwd(), a.run)
    if RUN_ID_RE.match(a.run or "") and (rundir / "run.json").is_file():
        return rundir
    print(json.dumps({"ok": False, "error": f"unknown run {a.run!r}: no {rundir / 'run.json'}"}))
    return None


def _load_summary(rundir: Path) -> tuple[dict | None, str | None]:
    """(summary object, None) when rundir/summary.json parses once and its seal verifies, else (None, why not)."""
    try:
        obj = json.loads((rundir / "summary.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None, "summary.json unreadable"
    bad = atlas_crew_seal.verify_obj(rundir, obj)
    return (None, bad) if bad else (obj, None)


_LEAD_KEYS = ("ok", "run", "check", "check_exit", "check_tail", "wall_s")
_LEAD_IF_SET = ("killed", "failed_workers", "late_exits", "pending_exits", "changelog")


def lead_view(obj: dict, rundir: Path) -> dict:
    """What `run --wait` and `wait` print for the lead: the verdict, the check, the workers by name, the files
    they own, the token total and the path of the full summary. Every reason a run is not clean (killed, failed,
    late or pending exits) and the changelog path appear when set. The per-worker rows, rounds, irc counters and
    log paths stay in summary.json: on an 8-worker run they were over half the line, and a supervisor stop after a
    verified DONE (exit 143) cost the lead a turn explaining a non-failure. The Stop gate's `_engine_json` still
    matches this object (run id, a workers list, an int check_exit)."""
    out = {k: obj[k] for k in _LEAD_KEYS if k in obj}
    ws = obj.get("workers")
    if isinstance(ws, list):
        out["workers"] = [w.get("name") if isinstance(w, dict) else w for w in ws]
    try:
        plan = json.loads((rundir / "run.json").read_text(encoding="utf-8")).get("plan") or {}
        files = [p for w in plan.get("workers") or [] for p in (w.get("owns") or [])]
    except (OSError, ValueError, AttributeError, TypeError):
        files = []
    if files:
        out["files"] = files
    tw = obj.get("tokens_workers")
    if isinstance(tw, dict) and isinstance(tw.get("total"), int):
        out["tokens"] = tw["total"]
    for k in _LEAD_IF_SET:
        if obj.get(k):
            out[k] = obj[k]
    out["summary"] = str(rundir / "summary.json")
    return out


def _summary_line(path: Path) -> str:
    """summary.json as one JSON line: the file is indented for people, and `run --wait` / `wait` print it
    into the lead's context, where the indentation is about a third of the bytes. Same keys either way."""
    text = path.read_text(encoding="utf-8")
    try:
        return json.dumps(json.loads(text))
    except ValueError:  # half-written or hand-edited: show what is there
        return text


def _summary_rc(path: Path) -> int:
    """Exit code for a finished run: 0 only when the summary says ok, so `run --wait ... && <docs step>`
    writes the docs on a green crew alone and a red one stops the chain."""
    try:
        return 0 if json.loads(path.read_text(encoding="utf-8")).get("ok") is True else 1
    except (OSError, ValueError, AttributeError):
        return 1


SUPERVISOR_GRACE_S = 60  # a run whose supervisor wrote no pid this long after the start has none


def _supervisor_gone(rundir: Path, poll=None) -> dict | None:
    """The error `wait` prints when the run's supervisor is dead and left no summary (a crash, an OOM kill, a
    reboot), else None. Without it `wait` said "still running; call wait again" for ever. `poll` is the
    supervisor's Popen.poll when this process started it (its zombie still answers signals). A run being
    killed is not dead: `kill` stops the supervisor first and then writes the summary itself."""
    if (rundir / "summary.json").exists() or _killed(rundir):
        return None
    pidf = rundir / "supervisor.pid"
    pid = _pid_from(pidf)
    if pid is None:
        try:
            started = float(json.loads((rundir / "run.json").read_text(encoding="utf-8")).get("started") or 0)
        except (OSError, ValueError, TypeError, AttributeError):
            return None
        if poll is not None and poll() is not None:
            why = f"the supervisor exited with {poll()} before it started"
        elif time.time() - started > SUPERVISOR_GRACE_S and not pidf.exists():
            why = f"no supervisor started within {SUPERVISOR_GRACE_S}s"
        else:
            return None
    else:
        dead = (poll() is not None) if poll is not None else not _pid_alive(pid)
        if not dead:
            try:  # a recycled pid is not our supervisor
                dead = rundir.name not in Path(f"/proc/{pid}/cmdline").read_bytes().decode("utf-8", "replace")
            except OSError:
                pass
        if not dead:
            return None
        why = f"the supervisor (pid {pid}) exited"
    if (rundir / "summary.json").exists():  # it published just before it went
        return None
    try:
        tail = (rundir / "supervisor.log").read_text(encoding="utf-8", errors="replace")[-1500:]
    except OSError:
        tail = ""
    return {
        "ok": False,
        "run": rundir.name,
        "error": f"{why} without writing a summary: the run is over and red; see {rundir / 'supervisor.log'}",
        "supervisor_log_tail": tail,
    }


def cmd_wait(a) -> int:
    rundir = _known_run(a)
    if rundir is None:
        return 1
    end = time.time() + a.timeout
    next_probe = 0.0
    while time.time() < end:
        s = rundir / "summary.json"
        if s.exists():
            if not (rundir / "supervisor.pid").is_file():
                # The supervisor writes supervisor.pid as it starts, before any summary. A summary without
                # one was not written by the engine: print nothing it says.
                print(json.dumps({"ok": False, "error": f"run {a.run!r} was never started by the crew engine (no supervisor.pid)"}))
                return 1
            obj, bad = _load_summary(rundir)
            if bad:
                print(json.dumps({"ok": False, "error": f"run {a.run!r} summary refused: {bad}"}))
                return 1
            print(json.dumps(lead_view(obj, rundir)))
            return 0 if obj.get("ok") is True else 1
        if time.time() >= next_probe:  # a pid probe every half second, the summary every poll
            next_probe = time.time() + 0.5
            gone = _supervisor_gone(rundir)
            if gone:
                print(json.dumps(gone))
                return 1
        time.sleep(POLL_S)
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
    rundir = _known_run(a)
    if rundir is None:
        return 1
    print(json.dumps(status(rundir)))
    return 0


def cmd_kill(a) -> int:
    rundir = _known_run(a)
    if rundir is None:
        return 1
    meta = json.loads((rundir / "run.json").read_text(encoding="utf-8"))
    finished = (rundir / "summary.json").exists() and not _killed(rundir)
    if not finished:
        (rundir / "killed").write_text(str(time.time()))  # the supervisor starts no fix round once this exists
    _stop_pidfile(rundir / "supervisor.pid", meta["run_id"])
    killed = []
    for p in (rundir / "pid").glob("*"):
        try:
            pid = int(p.read_text())
            if not _is_ours(pid, rundir.name):  # a finished run's pid, reused by an unrelated process
                continue
            group = _group_of(pid, rundir.name)
            os.kill(pid, signal.SIGTERM)
            killed.append(p.name)
            if group:  # claude's children share its group
                os.killpg(group, signal.SIGTERM)
        except (OSError, ValueError):
            pass
    for p in (rundir / "wpid").glob("*"):  # worker wrappers (a wrapper still in its --delay holds no claude pid)
        try:
            pid = int(p.read_text())
            if pid != os.getpid() and _is_ours(pid, rundir.name):
                os.kill(pid, signal.SIGTERM)
        except (OSError, ValueError):
            pass
    _stop_pidfile(rundir / "gateway.pid", meta["run_id"])
    if meta.get("tmux"):
        _tmux("kill-session", "-t", meta["session"])
    if finished:  # a finished run's summary is the record; a late kill must not turn it into ok false
        print(json.dumps({"ok": True, "killed": killed, "already_finished": True}))
        return 0
    _write_summary(rundir, summarize(rundir, meta, [], 1, "killed", killed=True))
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
    r.add_argument("--harness", choices=("claude", "codex"), default="claude")
    r.add_argument("--run-id")
    r.add_argument("--session", help="lead session id stamped into run.json as lead_session")
    r.add_argument("--changelog", help="one-line CHANGELOG entry the supervisor adds under ## Unreleased once the check is green")
    r.add_argument("--fix-rounds", type=int, default=2)
    r.add_argument("--timeout", type=float, default=3600)
    r.add_argument("--no-tmux", action="store_true")
    r.add_argument(
        "--allow-green-check",
        action="store_true",
        help="launch even when a worker check already passes before any work (it would end that worker at once)",
    )
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
    atlas_irc.stop_checks_on_signal()  # checks run in their own process groups: a stop of this process stops them too
    sys.exit(main())
