#!/usr/bin/env python3
"""Live parity rig: run one real turn per harness and record which Atlas hooks fired.

The payload-level parity tests (hooks/test_codex_parity.py, scripts/test_atlas_codex_contract.py)
feed hand-built payloads to the hooks. This rig runs the harnesses themselves:

  codex   codex exec, Atlas installed through the repo marketplace into a throwaway CODEX_HOME,
          hooks trusted for the run with --dangerously-bypass-hook-trust
  omp     omp -p with only the Atlas extension (--no-extensions -e <plugin>/omp/index.ts)
  claude  claude -p --plugin-dir <plugin> --setting-sources "" --strict-mcp-config (real model)

Codex and omp have no model key here, so a local fake model server on 127.0.0.1 answers them:
OpenAI Responses API (SSE) for Codex, OpenAI chat completions (SSE) for omp. It reads the tools
offered in each request and replies with a scripted turn: one call of the shell tool with the
scenario command, then, once a tool result comes back, a final text message.

Scenarios:
  write       echo atlas-parity > parity.txt      (parity.txt must appear in the project)
  force-push  git push --force origin main        (Atlas git_guard should deny it; the project has
                                                   a local bare remote and a pre-push hook marker,
                                                   so a push that runs is observable)

Observable: a `python3` shim first on PATH. Every Atlas hook command is `python3 -S <root>/hooks/
<script>.py ...` run through a shell, so the shim sees each hook invocation, logs the event name
from the hook's stdin payload, its exit code and output, then runs the real interpreter with the
same stdin. Nothing in the shipped plugin is modified. Each run uses a throwaway HOME,
CODEX_HOME, ATLAS_HOME and git project under one temp dir, with DO_NOT_TRACK=1 and
ATLAS_ANALYTICS=off.

Usage:
  python3 atlas_parity_rig.py [--harness codex,omp,claude] [--scenario write,force-push]
                              [--timeout 300] [--keep] [--json OUT]
Exit 0 when the rig ran (whatever the hooks did); 2 for usage errors or a harness that could not
be set up. Stdlib only.
"""

from __future__ import annotations

import argparse
import gzip
import http.server
import itertools
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN_DIR = os.path.dirname(HERE)
REPO_ROOT = os.path.dirname(os.path.dirname(PLUGIN_DIR))
TOOLS_BIN = "/home/claude/tools/node_modules/.bin"

MODEL_ID = "parity-model"
EVENTS = ("SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop")
SCENARIOS = {
    "write": "echo atlas-parity > parity.txt",
    "force-push": "git push --force origin main",
}
HARNESSES = ("codex", "omp", "claude")
FINAL_PREFIX = "parity rig done."

# --------------------------------------------------------------------------- fake model server

SHELL_TOOL_NAMES = (
    "exec_command",
    "shell_command",
    "shell",
    "bash",
    "Bash",
    "run_shell_command",
)
_ids = itertools.count(1)


def tool_specs(body: dict) -> list[tuple[str, dict]]:
    """(name, JSON-schema parameters) of every function tool, Responses or chat-completions shape."""
    out = []
    for t in body.get("tools") or []:
        if not isinstance(t, dict) or t.get("type") != "function":
            continue
        fn = t.get("function") if isinstance(t.get("function"), dict) else t
        name = fn.get("name")
        if isinstance(name, str) and name:
            params = fn.get("parameters")
            out.append((name, params if isinstance(params, dict) else {}))
    return out


def pick_shell_tool(body: dict) -> tuple[str, dict] | None:
    """The offered tool that runs a shell command, by the first known name in SHELL_TOOL_NAMES."""
    specs = dict(tool_specs(body))
    for name in SHELL_TOOL_NAMES:
        if name in specs:
            return name, specs[name]
    return None


def _filler(schema: dict):
    kind = schema.get("type")
    if isinstance(kind, list):
        kind = next((k for k in kind if k != "null"), "string")
    return {"number": 0, "integer": 0, "boolean": False, "array": [], "object": {}}.get(
        kind, "parity rig"
    )


def shell_arguments(params: dict, command: str) -> dict:
    """Arguments for the shell tool: the command in `cmd`/`command` (argv form when the schema
    wants an array), every other required property filled with a type-correct placeholder."""
    props = params.get("properties") if isinstance(params.get("properties"), dict) else {}
    required = [r for r in params.get("required") or [] if isinstance(r, str)]
    key = next((k for k in ("cmd", "command") if k in props), None)
    if key is None:
        key = next((r for r in required if (props.get(r) or {}).get("type") == "string"), "command")
    want_array = (props.get(key) or {}).get("type") == "array"
    args: dict = {key: ["bash", "-lc", command] if want_array else command}
    for r in required:
        if r not in args:
            args[r] = _filler(props.get(r) or {})
    return args


def _content_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for p in content:
            if isinstance(p, dict):
                parts.append(str(p.get("text") or p.get("output") or ""))
            elif isinstance(p, str):
                parts.append(p)
        return "".join(parts)
    if isinstance(content, dict):
        return str(content.get("output") or content.get("text") or json.dumps(content))
    return "" if content is None else str(content)


def tool_results(body: dict) -> list[str]:
    """Tool outputs the harness sent back: Responses `*_call_output` input items, chat `tool` messages."""
    out = []
    for item in body.get("input") or []:
        if isinstance(item, dict) and str(item.get("type", "")).endswith("_call_output"):
            out.append(_content_text(item.get("output")))
    for msg in body.get("messages") or []:
        if isinstance(msg, dict) and msg.get("role") == "tool":
            out.append(_content_text(msg.get("content")))
    return out


def plan_turn(body: dict, command: str) -> dict:
    """{"kind": "tool", "name", "arguments"} for a fresh turn, {"kind": "text", "text"} once a tool
    result came back (or when no shell tool is offered, e.g. a title request)."""
    results = tool_results(body)
    if results:
        snippet = " ".join(results[-1].split())[:200]
        return {"kind": "text", "text": f"{FINAL_PREFIX} Tool result: {snippet}"}
    shell = pick_shell_tool(body)
    if shell is None:
        return {"kind": "text", "text": f"{FINAL_PREFIX} No shell tool was offered."}
    name, params = shell
    return {"kind": "tool", "name": name, "arguments": shell_arguments(params, command)}


def _usage_responses() -> dict:
    return {
        "input_tokens": 10,
        "input_tokens_details": {"cached_tokens": 0},
        "output_tokens": 5,
        "output_tokens_details": {"reasoning_tokens": 0},
        "total_tokens": 15,
    }


def responses_events(body: dict, command: str) -> list[dict]:
    """The OpenAI Responses stream events for one scripted turn."""
    n = next(_ids)
    rid = f"resp_parity_{n}"
    plan = plan_turn(body, command)
    model = body.get("model") or MODEL_ID
    if plan["kind"] == "tool":
        item = {
            "type": "function_call",
            "id": f"fc_parity_{n}",
            "call_id": f"call_parity_{n}",
            "name": plan["name"],
            "arguments": json.dumps(plan["arguments"]),
            "status": "completed",
        }
        middle = [{"type": "response.output_item.done", "output_index": 0, "item": item}]
    else:
        item = {
            "type": "message",
            "id": f"msg_parity_{n}",
            "role": "assistant",
            "status": "completed",
            "content": [{"type": "output_text", "text": plan["text"], "annotations": []}],
        }
        added = dict(item, status="in_progress", content=[])
        middle = [
            {"type": "response.output_item.added", "output_index": 0, "item": added},
            {
                "type": "response.output_text.delta",
                "item_id": item["id"],
                "output_index": 0,
                "content_index": 0,
                "delta": plan["text"],
            },
            {"type": "response.output_item.done", "output_index": 0, "item": item},
        ]
    head = {"id": rid, "object": "response", "model": model, "status": "in_progress", "output": []}
    done = dict(head, status="completed", output=[item], usage=_usage_responses())
    return (
        [{"type": "response.created", "response": head}]
        + middle
        + [{"type": "response.completed", "response": done}]
    )


def encode_responses_sse(events: list[dict]) -> bytes:
    return b"".join(
        f"event: {e['type']}\ndata: {json.dumps(e)}\n\n".encode() for e in events
    )


def chat_chunks(body: dict, command: str) -> list[dict]:
    """OpenAI chat-completions stream chunks for one scripted turn (usage chunk last)."""
    n = next(_ids)
    base = {
        "id": f"chatcmpl-parity-{n}",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": body.get("model") or MODEL_ID,
    }
    plan = plan_turn(body, command)
    if plan["kind"] == "tool":
        delta = {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "index": 0,
                    "id": f"call_parity_{n}",
                    "type": "function",
                    "function": {"name": plan["name"], "arguments": json.dumps(plan["arguments"])},
                }
            ],
        }
        finish = "tool_calls"
    else:
        delta, finish = {"role": "assistant", "content": plan["text"]}, "stop"
    return [
        dict(base, choices=[{"index": 0, "delta": delta, "finish_reason": None}]),
        dict(base, choices=[{"index": 0, "delta": {}, "finish_reason": finish}]),
        dict(base, choices=[], usage={"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}),
    ]


def encode_chat_sse(chunks: list[dict]) -> bytes:
    return b"".join(f"data: {json.dumps(c)}\n\n".encode() for c in chunks) + b"data: [DONE]\n\n"


def chat_completion(body: dict, command: str) -> dict:
    """Non-streaming chat completion built from the same chunks."""
    chunks = chat_chunks(body, command)
    delta, finish = chunks[0]["choices"][0]["delta"], chunks[1]["choices"][0]["finish_reason"]
    msg = {"role": "assistant", "content": delta.get("content")}
    if delta.get("tool_calls"):
        msg["tool_calls"] = [{k: v for k, v in tc.items() if k != "index"} for tc in delta["tool_calls"]]
    return {
        "id": chunks[0]["id"],
        "object": "chat.completion",
        "created": chunks[0]["created"],
        "model": chunks[0]["model"],
        "choices": [{"index": 0, "message": msg, "finish_reason": finish}],
        "usage": chunks[2]["usage"],
    }


class _Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):  # quiet
        pass

    def _send(self, code: int, ctype: str, data: bytes) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path.rstrip("/").endswith("/models"):
            data = {"object": "list", "data": [{"id": MODEL_ID, "object": "model", "owned_by": "parity"}]}
            return self._send(200, "application/json", json.dumps(data).encode())
        return self._send(404, "application/json", b'{"error":"not found"}')

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if (self.headers.get("Content-Encoding") or "").lower() == "gzip":
            raw = gzip.decompress(raw)
        try:
            body = json.loads(raw or b"{}")
        except ValueError:
            return self._send(400, "application/json", b'{"error":"bad json"}')
        srv: FakeModelServer = self.server  # type: ignore[assignment]
        path = self.path.split("?", 1)[0].rstrip("/")
        if path.endswith("/responses"):
            events = responses_events(body, srv.command)
            srv.record(path, body, events)
            return self._send(200, "text/event-stream", encode_responses_sse(events))
        if path.endswith("/chat/completions"):
            if body.get("stream"):
                chunks = chat_chunks(body, srv.command)
                srv.record(path, body, chunks)
                return self._send(200, "text/event-stream", encode_chat_sse(chunks))
            reply = chat_completion(body, srv.command)
            srv.record(path, body, [reply])
            return self._send(200, "application/json", json.dumps(reply).encode())
        return self._send(404, "application/json", b'{"error":"not found"}')


class FakeModelServer(http.server.ThreadingHTTPServer):
    """127.0.0.1 server on an ephemeral port; `command` is the scripted shell command."""

    daemon_threads = True

    def __init__(self, command: str):
        super().__init__(("127.0.0.1", 0), _Handler)
        self.command = command
        self.requests: list[dict] = []
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}/v1"

    def record(self, path: str, body: dict, reply: list) -> None:
        with self._lock:
            self.requests.append(
                {"path": path, "tool_results": tool_results(body), "plan": plan_turn(body, self.command)}
            )

    def start(self) -> FakeModelServer:
        self._thread = threading.Thread(target=self.serve_forever, daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        self.shutdown()
        self.server_close()


# --------------------------------------------------------------------------- hook observable

SHIM = r'''#!@REAL@ -S
# atlas parity rig: log every Atlas hook invocation, then run it with the real interpreter.
import json, os, re, subprocess, sys, time
REAL = @REAL_JSON@
LOG = @LOG_JSON@
args = sys.argv[1:]
script = next((a for a in args if a.endswith(".py")), "")
if not re.search(r"/(hooks/[A-Za-z0-9_]+|scripts/atlas_doctor)\.py$", script):
    os.execv(REAL, [REAL] + args)
data = sys.stdin.buffer.read()
event = tool = cmd = ""
try:
    p = json.loads(data.decode("utf-8", "replace") or "{}")
    event = str(p.get("hook_event_name") or "")
    tool = str(p.get("tool_name") or "")
    ti = p.get("tool_input")
    if isinstance(ti, dict):
        cmd = ti.get("command") or ti.get("cmd") or ""
        cmd = " ".join(cmd) if isinstance(cmd, list) else str(cmd)
except Exception:
    pass
t0 = time.time()
r = subprocess.run([REAL] + args, input=data, capture_output=True)
sys.stdout.buffer.write(r.stdout); sys.stdout.flush()
sys.stderr.buffer.write(r.stderr); sys.stderr.flush()
rec = {"ts": t0, "ms": int((time.time() - t0) * 1000), "event": event, "script": os.path.basename(script),
       "argv": args[args.index(script) + 1:], "root": os.path.dirname(os.path.dirname(script)),
       "tool": tool, "cmd": cmd[:300], "rc": r.returncode,
       "stdout": r.stdout.decode("utf-8", "replace")[:4000], "stderr": r.stderr.decode("utf-8", "replace")[:2000],
       "harness_env": os.environ.get("ATLAS_HARNESS", "")}
with open(LOG, "a", encoding="utf-8") as f:
    f.write(json.dumps(rec) + "\n")
sys.exit(r.returncode)
'''

# Event a script stands for when its payload names none (only these scripts are unambiguous).
SCRIPT_EVENT = {
    "session_boot.py": "SessionStart",
    "atlas_doctor.py": "SessionStart",
    "prompt_optimizer.py": "UserPromptSubmit",
    "completion_gate.py": "Stop",
    "stop_tail.py": "Stop",
}


def write_shim(shim_dir: str, real_python: str, log_path: str) -> str:
    os.makedirs(shim_dir, exist_ok=True)
    path = os.path.join(shim_dir, "python3")
    text = (
        SHIM.replace("@REAL_JSON@", json.dumps(real_python))
        .replace("@LOG_JSON@", json.dumps(log_path))
        .replace("@REAL@", real_python)
    )
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    os.chmod(path, 0o755)
    return path


def parse_hook_log(path: str) -> list[dict]:
    out = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if isinstance(rec, dict):
                    if not rec.get("event"):
                        argv = rec.get("argv") or []
                        if rec.get("script") == "event_dispatch.py" and argv:
                            rec["event"] = argv[0]
                        else:
                            rec["event"] = SCRIPT_EVENT.get(rec.get("script", ""), "")
                    out.append(rec)
    except OSError:
        pass
    return out


def events_fired(records: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for r in records:
        ev = r.get("event") or "?"
        counts[ev] = counts.get(ev, 0) + 1
    return counts


def deny_records(records: list[dict]) -> list[dict]:
    """PreToolUse invocations whose output carries a deny (permissionDecision or decision:block)."""
    out = []
    for r in records:
        if r.get("event") != "PreToolUse":
            continue
        text = r.get("stdout") or ""
        try:
            data = json.loads(text) if text.strip() else {}
        except ValueError:
            data = {}
        hso = data.get("hookSpecificOutput") if isinstance(data, dict) else None
        decision = (hso or {}).get("permissionDecision") if isinstance(hso, dict) else None
        if decision == "deny" or (isinstance(data, dict) and data.get("decision") == "block") or r.get("rc") == 2:
            out.append(r)
    return out


def atlas_warnings(records: list[dict]) -> list[str]:
    """Hook stdout lines Atlas marks as a warning (e.g. `ATLAS-DOCTOR WARNING: ...` at SessionStart)."""
    out: list[str] = []
    for r in records:
        for line in (r.get("stdout") or "").splitlines():
            if "WARNING" in line and line.strip()[:240] not in out:
                out.append(line.strip()[:240])
    return out


def hook_problem_records(records: list[dict]) -> list[str]:
    """One line per hook invocation that crashed or printed a traceback."""
    out = []
    for r in records:
        err = (r.get("stderr") or "").strip()
        if r.get("rc") not in (0, 2) or "Traceback" in err:
            last = err.splitlines()[-1] if err else ""
            out.append(f"{r.get('script')} {r.get('event')} rc={r.get('rc')}: {last[:200]}")
    return out


_HOOK_LINE = re.compile(r"hook", re.IGNORECASE)
_ERR_WORD = re.compile(r"error|fail|invalid|timed out|timeout|refus|denied|unsupported|panick", re.IGNORECASE)


def _json_lines(output: str) -> list[dict]:
    out = []
    for line in output.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if isinstance(d, dict):
            out.append(d)
    return out


def harness_hook_errors(harness: str, output: str) -> list[str]:
    """Hook problems the harness printed. claude (stream-json): hook_response messages whose outcome
    is not success or that carry stderr. codex/omp (text): non-JSON lines that mention a hook
    together with an error word."""
    seen: set[str] = set()
    out: list[str] = []

    def add(s: str) -> None:
        s = s[:240]
        if s not in seen:
            seen.add(s)
            out.append(s)

    if harness == "claude":
        for d in _json_lines(output):
            if d.get("type") == "system" and d.get("subtype") == "hook_response":
                stderr = str(d.get("stderr") or "").strip()
                if d.get("outcome") not in (None, "success") or stderr:
                    add(
                        f"{d.get('hook_name')}: outcome={d.get('outcome')} exit={d.get('exit_code')} "
                        f"{stderr.splitlines()[-1] if stderr else ''}".strip()
                    )
        return out
    for line in output.splitlines():
        s = line.strip()
        if (
            not s.startswith("{")
            and _HOOK_LINE.search(s)
            and _ERR_WORD.search(s)
            and "--dangerously-bypass-hook-trust" not in s
            and FINAL_PREFIX not in s
        ):
            add(s)
    return out


def harness_reported_hooks(harness: str, output: str) -> list[str]:
    """Hook events the harness itself reports: codex prints `hook: <Event> [Completed|Blocked]`,
    claude's stream-json (--include-hook-events) carries hook_started/hook_response messages."""
    found: list[str] = []
    if harness == "codex":
        for m in re.finditer(r"^hook: (\w+)(?: (\w+))?\s*$", output, re.MULTILINE):
            found.append(m.group(1) + (f" {m.group(2)}" if m.group(2) else ""))
    elif harness == "claude":
        for d in _json_lines(output):
            if d.get("type") == "system" and d.get("subtype") == "hook_response":
                found.append(f"{d.get('hook_event') or '?'} {d.get('outcome')}")
    return found


def claude_tool_results(output: str) -> list[str]:
    """tool_result texts in claude stream-json user messages (what the model was told)."""
    out = []
    for d in _json_lines(output):
        msg = d.get("message") if d.get("type") == "user" else None
        for block in (msg or {}).get("content") or [] if isinstance(msg, dict) else []:
            if isinstance(block, dict) and block.get("type") == "tool_result":
                out.append(_content_text(block.get("content")))
    return out


def yn(flag) -> str:
    return "yes" if flag else "no"


def render_table(harness: str, rows: list[dict]) -> str:
    cols = list(EVENTS) + ["parity.txt", "force-push blocked"]
    head = ["scenario"] + cols
    body = []
    for r in rows:
        if r.get("setup_error"):
            body.append([r["scenario"]] + ["-"] * len(cols))
            continue
        fired = r["fired"]
        cells = [r["scenario"]] + [
            f"yes ({fired[e]})" if fired.get(e) else "no" for e in EVENTS
        ]
        cells.append(yn(r["parity_file"]) if r["scenario"] == "write" else "n/a")
        cells.append(r["force_push"] if r["scenario"] == "force-push" else "n/a")
        body.append(cells)
    widths = [max(len(str(x[i])) for x in [head] + body) for i in range(len(head))]
    fmt = lambda cells: "| " + " | ".join(str(c).ljust(w) for c, w in zip(cells, widths)) + " |"
    sep = "|-" + "-|-".join("-" * w for w in widths) + "-|"
    return "\n".join([f"## {harness}", fmt(head), sep] + [fmt(b) for b in body])


def force_push_verdict(push_ran: bool, denies: list[dict], attempted: bool) -> str:
    if push_ran:
        return "NO (push ran)"
    if denies:
        return "yes (denied)"
    if attempted:
        return "no deny; push did not run"
    return "not attempted"


# --------------------------------------------------------------------------- harness runs


def _git(cwd: str, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-c", "user.name=parity", "-c", "user.email=parity@example.invalid", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=True,
    )


def make_project(root: str) -> tuple[str, str, str]:
    """A git project on main with one commit, a local bare remote `origin`, and a pre-push hook
    that leaves a marker, so an executed push is observable. Returns (proj, remote, marker)."""
    proj, remote = os.path.join(root, "proj"), os.path.join(root, "remote.git")
    os.makedirs(proj)
    subprocess.run(["git", "init", "-q", "--bare", remote], check=True)
    _git(proj, "init", "-q", "-b", "main")
    with open(os.path.join(proj, "README.md"), "w", encoding="utf-8") as f:
        f.write("parity rig project\n")
    _git(proj, "add", "README.md")
    _git(proj, "commit", "-q", "-m", "init")
    _git(proj, "remote", "add", "origin", remote)
    marker = os.path.join(root, "push-attempted")
    hook = os.path.join(proj, ".git", "hooks", "pre-push")
    with open(hook, "w", encoding="utf-8") as f:
        f.write(f"#!/bin/sh\ntouch {json.dumps(marker)}\nexit 0\n")
    os.chmod(hook, 0o755)
    return proj, remote, marker


def remote_has_main(remote: str) -> bool:
    r = subprocess.run(
        ["git", "--git-dir", remote, "rev-parse", "--verify", "-q", "refs/heads/main"],
        capture_output=True,
        check=False,
    )
    return r.returncode == 0


_DROP_PREFIX = ("ATLAS_", "CODEX_", "OMP_", "PI_")
_DROP_EXACT = {"PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT", "OMPCODE"}
# Claude Code session sync knobs of the calling environment; the child must load only --plugin-dir.
_CLAUDE_DROP = {
    "CLAUDE_CODE_PLUGIN_SEED_DIR",
    "CLAUDE_CODE_SYNC_PLUGINS",
    "CLAUDE_CODE_SYNC_PLUGIN_INSTALL",
    "CLAUDE_CODE_SYNC_SKILLS",
}


def harness_env(harness: str, base: dict, home: str, atlas_home: str, shim_dir: str, log: str) -> dict:
    env = {
        k: v
        for k, v in base.items()
        if not k.startswith(_DROP_PREFIX) and k not in _DROP_EXACT
    }
    if harness in ("codex", "omp"):
        env = {k: v for k, v in env.items() if not k.startswith(("CLAUDE", "ANTHROPIC"))}
    else:
        env = {k: v for k, v in env.items() if k not in _CLAUDE_DROP}
    env.update(
        HOME=home,
        ATLAS_HOME=atlas_home,
        DO_NOT_TRACK="1",
        ATLAS_ANALYTICS="off",
        PATH=shim_dir + os.pathsep + base.get("PATH", ""),
        ATLAS_PARITY_HOOKLOG=log,
    )
    if harness == "codex":
        env["CODEX_HOME"] = os.path.join(home, ".codex")
    return env


def run_proc(argv: list[str], cwd: str, env: dict, timeout: int) -> tuple[int | None, str]:
    """Run in its own process group; on timeout kill the group. Returns (rc or None, output)."""
    p = subprocess.Popen(
        argv,
        cwd=cwd,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    try:
        out, _ = p.communicate(timeout=timeout)
        return p.returncode, out.decode("utf-8", "replace")
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        out, _ = p.communicate()
        return None, out.decode("utf-8", "replace") + f"\n[parity rig] timed out after {timeout}s"


def prompt_for(command: str) -> str:
    return (
        "This is a disposable test repository with a local throwaway remote. Use your shell tool to "
        f"run exactly this command once, unchanged: {command}\n"
        "Then reply with one line saying what happened. Do nothing else."
    )


def codex_setup(binary: str, env: dict, cwd: str, timeout: int) -> list[str]:
    errors = []
    for argv in (
        [binary, "plugin", "marketplace", "add", REPO_ROOT],
        [binary, "plugin", "add", "atlas@tech-tools"],
    ):
        rc, out = run_proc(argv, cwd, env, timeout)
        if rc != 0:
            errors.append(f"{' '.join(argv[1:])}: rc={rc}: {out.strip()[-400:]}")
    return errors


def harness_argv(harness: str, binary: str, proj: str, base_url: str, command: str) -> list[str]:
    prompt = prompt_for(command)
    if harness == "codex":
        provider = (
            f'{{name="parity",base_url="{base_url}",wire_api="responses",'
            "request_max_retries=0,stream_max_retries=0}"
        )
        return [
            binary, "exec",
            "--dangerously-bypass-hook-trust",
            "--dangerously-bypass-approvals-and-sandbox",
            "-c", 'model_provider="parity"',
            "-c", f"model_providers.parity={provider}",
            "-m", MODEL_ID,
            "-C", proj,
            prompt,
        ]
    if harness == "omp":
        return [
            binary, "-p",
            "--no-extensions",
            "-e", os.path.join(PLUGIN_DIR, "omp", "index.ts"),
            "--model", f"parity/{MODEL_ID}",
            "--no-title",
            "--auto-approve",
            "--cwd", proj,
            prompt,
        ]
    return [
        binary, "-p",
        "--model", "sonnet",
        "--setting-sources", "",
        "--strict-mcp-config",
        "--plugin-dir", PLUGIN_DIR,
        "--allowedTools", "Bash",
        "--output-format", "stream-json",
        "--verbose",
        "--include-hook-events",
        prompt,
    ]


def omp_models_file(home: str, base_url: str) -> None:
    d = os.path.join(home, ".omp", "agent")
    os.makedirs(d, exist_ok=True)
    cfg = {
        "providers": {
            "parity": {
                "baseUrl": base_url,
                "api": "openai-completions",
                "apiKey": "parity-fake-key",
                "models": [{"id": MODEL_ID, "name": "parity", "contextWindow": 128000, "maxTokens": 4096}],
            }
        }
    }
    with open(os.path.join(d, "models.yml"), "w", encoding="utf-8") as f:
        json.dump(cfg, f)  # JSON is valid YAML


def find_binary(harness: str) -> str | None:
    name = {"codex": "codex", "omp": "omp", "claude": "claude"}[harness]
    local = os.path.join(TOOLS_BIN, name)
    if harness != "claude" and os.access(local, os.X_OK):
        return local
    return shutil.which(name)


def run_one(harness: str, scenario: str, timeout: int, keep: bool, real_python: str) -> dict:
    command = SCENARIOS[scenario]
    row: dict = {"harness": harness, "scenario": scenario, "command": command}
    binary = find_binary(harness)
    if not binary:
        row["setup_error"] = f"{harness} binary not found"
        return row
    root = tempfile.mkdtemp(prefix=f"atlas-parity-{harness}-{scenario}-")
    row["workdir"] = root
    server = None
    try:
        home, atlas_home = os.path.join(root, "home"), os.path.join(root, "atlas-home")
        os.makedirs(home)
        os.makedirs(atlas_home)
        log = os.path.join(root, "hooks.jsonl")
        shim_dir = os.path.join(root, "shim")
        write_shim(shim_dir, real_python, log)
        proj, remote, marker = make_project(root)
        env = harness_env(harness, dict(os.environ), home, atlas_home, shim_dir, log)
        base_url = ""
        if harness in ("codex", "omp"):
            server = FakeModelServer(command).start()
            base_url = server.base_url
        if harness == "codex":
            os.makedirs(env["CODEX_HOME"])
            errs = codex_setup(binary, env, proj, timeout)
            if errs:
                row["setup_error"] = "; ".join(errs)
                return row
        if harness == "omp":
            omp_models_file(home, base_url)
        argv = harness_argv(harness, binary, proj, base_url, command)
        row["argv"] = argv
        t0 = time.time()
        rc, out = run_proc(argv, proj, env, timeout)
        row["seconds"] = round(time.time() - t0, 1)
        time.sleep(1.0)  # let async hooks (format_after_edit, detached ingest) append their rows
        records = parse_hook_log(log)
        row["rc"] = rc
        row["output_tail"] = out[-3000:]
        row["fired"] = events_fired(records)
        row["hook_scripts"] = sorted({f"{r['event']}:{r['script']}" for r in records})
        row["hook_roots"] = sorted({r.get("root", "") for r in records})
        row["parity_file"] = os.path.exists(os.path.join(proj, "parity.txt"))
        denies = deny_records(records)
        row["denies"] = [
            {"script": d["script"], "cmd": d.get("cmd", ""), "stdout": d.get("stdout", "")[:400]} for d in denies
        ]
        push_ran = os.path.exists(marker) or remote_has_main(remote)
        attempted = any("git push" in (r.get("cmd") or "") for r in records if r.get("event") == "PreToolUse")
        row["push_ran"] = push_ran
        row["force_push"] = force_push_verdict(push_ran, denies, attempted) if scenario == "force-push" else "n/a"
        row["harness_errors"] = harness_hook_errors(harness, out)
        row["hook_crashes"] = hook_problem_records(records)
        row["atlas_warnings"] = atlas_warnings(records)
        faults = os.path.join(atlas_home, "hook-faults.jsonl")
        row["fault_rows"] = []
        if os.path.exists(faults):
            with open(faults, encoding="utf-8") as f:
                row["fault_rows"] = f.read().splitlines()[:10]
        row["harness_reported"] = harness_reported_hooks(harness, out)
        with open(os.path.join(root, "harness-output.txt"), "w", encoding="utf-8") as f:
            f.write(out)
        if server is not None:
            row["model_requests"] = len(server.requests)
            seen = [t for req in server.requests for t in req["tool_results"][-1:]]
        else:
            seen = claude_tool_results(out)
        row["tool_results_seen"] = [" ".join(t.split())[:300] for t in seen][:3]
        return row
    except (OSError, subprocess.SubprocessError) as e:
        row["setup_error"] = f"{type(e).__name__}: {e}"
        return row
    finally:
        if server is not None:
            server.stop()
        if not keep:
            shutil.rmtree(root, ignore_errors=True)


def report(rows: list[dict]) -> str:
    lines = []
    for harness in dict.fromkeys(r["harness"] for r in rows):
        hrows = [r for r in rows if r["harness"] == harness]
        lines.append(render_table(harness, hrows))
        for r in hrows:
            tag = f"  [{r['scenario']}]"
            if r.get("setup_error"):
                lines.append(f"{tag} SETUP FAILED: {r['setup_error']}")
                continue
            lines.append(f"{tag} rc={r['rc']} in {r['seconds']}s; command: {r['command']}")
            lines.append(f"{tag} hooks run (event:script): {', '.join(r['hook_scripts']) or 'none'}")
            if r.get("harness_reported"):
                lines.append(f"{tag} harness-reported hooks: {', '.join(r['harness_reported'])}")
            if "model_requests" in r:
                lines.append(f"{tag} fake model requests: {r['model_requests']}")
            for t in r.get("tool_results_seen") or []:
                lines.append(f"{tag} tool result fed back to model: {t}")
            for d in r.get("denies") or []:
                lines.append(f"{tag} deny by {d['script']} for `{d['cmd']}`: {d['stdout'][:300]}")
            if r["scenario"] == "force-push":
                lines.append(f"{tag} push executed: {yn(r['push_ran'])}")
            for e in r.get("harness_errors") or []:
                lines.append(f"{tag} harness hook error: {e}")
            for e in r.get("atlas_warnings") or []:
                lines.append(f"{tag} atlas hook warning: {e}")
            for e in r.get("hook_crashes") or []:
                lines.append(f"{tag} hook crash: {e}")
            for e in r.get("fault_rows") or []:
                lines.append(f"{tag} hook-faults.jsonl: {e[:300]}")
            if not r["fired"]:
                lines.append(f"{tag} output tail:\n" + "\n".join("      " + s for s in r["output_tail"][-1500:].splitlines()))
        lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Run one live turn per harness and record which Atlas hooks fired.")
    ap.add_argument("--harness", default=",".join(HARNESSES))
    ap.add_argument("--scenario", default=",".join(SCENARIOS))
    ap.add_argument("--timeout", type=int, default=300, help="seconds per harness run")
    ap.add_argument("--keep", action="store_true", help="keep the temp dirs (paths are printed)")
    ap.add_argument("--json", dest="json_out", help="also write the raw rows as JSON here")
    a = ap.parse_args(argv)
    harnesses = [h.strip() for h in a.harness.split(",") if h.strip()]
    scenarios = [s.strip() for s in a.scenario.split(",") if s.strip()]
    bad = [h for h in harnesses if h not in HARNESSES] + [s for s in scenarios if s not in SCENARIOS]
    if bad or not harnesses or not scenarios:
        ap.error(f"unknown harness/scenario: {', '.join(bad) or '(empty)'}")
    real_python = shutil.which("python3")
    if not real_python or not shutil.which("git"):
        print("parity rig: python3 and git must be on PATH", file=sys.stderr)
        return 2
    rows = []
    for h in harnesses:
        for s in scenarios:
            print(f"[parity rig] running {h} / {s} ...", file=sys.stderr, flush=True)
            rows.append(run_one(h, s, a.timeout, a.keep, real_python))
    print(f"Atlas parity rig - plugin {PLUGIN_DIR}")
    print(f"python3 {real_python}; DO_NOT_TRACK=1 ATLAS_ANALYTICS=off; throwaway HOME per run\n")
    print(report(rows))
    if a.keep:
        for r in rows:
            print(f"kept: {r['harness']}/{r['scenario']}: {r.get('workdir')}")
    if a.json_out:
        with open(a.json_out, "w", encoding="utf-8") as f:
            json.dump(rows, f, indent=2)
    return 2 if any(r.get("setup_error") for r in rows) else 0


if __name__ == "__main__":
    raise SystemExit(main())
