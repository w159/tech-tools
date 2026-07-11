#!/usr/bin/env python3
"""UserPromptSubmit hook - optimize a prompt through a local model before Claude sees it.

Automates the manual loop of "run my prompt through `ollama run prompt-optimizer:latest`
first, then paste the result". When triggered, this pipes the raw prompt through the
optimizer model and injects the rewritten spec into Claude's context as a system reminder
(via hookSpecificOutput.additionalContext) - it augments, it does not replace the prompt.

Design constraints (these drive every decision here):
  * The optimizer is SLOW (tens of seconds) and UserPromptSubmit is SYNCHRONOUS - an async
    hook would deliver the rewrite a turn too late. So we must NOT run on every prompt.
    Default mode is TRIGGER-GATED: only prompts that opt in pay the latency; everything
    else is an instant passthrough (exit 0, no output).
  * It must NEVER block or break prompt submission. Any failure (no ollama, model missing,
    timeout, empty output) -> silent passthrough. The user's prompt always goes through.

The optimizer is reached two ways, in priority order: (1) an explicit command override,
(2) the ollama HTTP API at /api/generate - pristine text, no terminal renderer - falling
back to the `ollama run` CLI if the server is unreachable. The CLI path strips the word-wrap
control noise the renderer emits; the API path needs none.

In `always` mode the optimizer fires on every non-trivial prompt, but two cheap escape
hatches keep it from spending the ~tens-of-seconds latency on noise: the MINLEN gate skips
very short prompts instantly (before any model call), and a bare `SKIP` token returned by
the model (its own trivial-input verdict) is treated as a passthrough rather than injected.

Configuration (environment variables):
  ATLAS_OPTIMIZE          off | trigger | always   (default: trigger)
  ATLAS_OPTIMIZE_TRIGGER  comma-separated prefixes  (default: "opt:,optimize:,++")
  ATLAS_OPTIMIZER_MODEL   ollama model tag          (default: prompt-optimizer:latest)
  ATLAS_OLLAMA_URL        ollama base URL; falls back to $OLLAMA_HOST, then
                                http://127.0.0.1:11434
  ATLAS_OPTIMIZE_CMD      override: run this instead of ollama. "{prompt}" is
                                substituted, else the prompt is appended as the final argv item
  ATLAS_OPTIMIZE_TIMEOUT  seconds before giving up  (default: 110)
  ATLAS_OPTIMIZE_MINLEN   skip prompts shorter than this many chars, in BOTH trigger
                                and always mode (default: 12)
  ATLAS_OPTIMIZE_QUIET    if set, suppress the stderr banner (silent injection)
  ATLAS_OPTIMIZE_LOG      if set, append an audit line (orig -> optimized) to this file

Wire it up (settings.json) with a generous timeout so Claude Code does not kill the
optimizer mid-run:
  "UserPromptSubmit": [
    { "hooks": [ { "type": "command",
                   "command": "python3 ~/.claude/hooks/prompt_optimizer.py",
                   "timeout": 120 } ] }
  ]

Stdlib only, so the skill stays portable.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

# The ollama CLI renderer rewrites partial words at the wrap boundary using cursor-back +
# erase sequences (e.g. "data c\x1b[1D\x1b[K\nconsistency"). Stripping those codes naively
# leaves the dangling "c"; we must INTERPRET them like a terminal to get clean text. The HTTP
# API path emits no codes, so this is a no-op there.
_CSI = re.compile(r"\x1b\[([0-9]*)([A-Za-z])")
_OSC = re.compile(r"\x1b\][^\x07]*\x07")  # OSC (e.g. window-title) sequences

DEFAULT_TRIGGERS = ("opt:", "optimize:", "++")
DEFAULT_MODEL = "prompt-optimizer:latest"


def _env(name: str, default: str) -> str:
    val = os.environ.get(name, "").strip()
    return val if val else default


def clean(text: str) -> str:
    """Render terminal control sequences (cursor moves, erase) into the text they'd display."""
    text = _OSC.sub("", text)
    out_lines: list[str] = []
    line: list[str] = []
    pos = 0
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch == "\x1b":
            m = _CSI.match(text, i)
            if not m:
                i += 1
                continue
            num_s, cmd = m.group(1), m.group(2)
            num = int(num_s) if num_s else 0
            if cmd == "D":  # cursor back
                pos = max(0, pos - (num or 1))
            elif cmd == "C":  # cursor forward
                pos = min(len(line), pos + (num or 1))
            elif cmd == "K":  # erase from cursor to end of line (default mode 0)
                if num == 0:
                    del line[pos:]
            # color/style and other CSI codes are ignored
            i = m.end()
            continue
        if ch == "\r":
            pos = 0
        elif ch == "\n":
            out_lines.append("".join(line))
            line, pos = [], 0
        elif ch == "\x08":  # backspace
            pos = max(0, pos - 1)
        else:
            if pos < len(line):
                line[pos] = ch
            else:
                line.append(ch)
            pos += 1
        i += 1
    out_lines.append("".join(line))
    # drop leading/trailing blank lines without flattening internal structure
    while out_lines and not out_lines[0].strip():
        out_lines.pop(0)
    while out_lines and not out_lines[-1].strip():
        out_lines.pop()
    return "\n".join(ln.rstrip() for ln in out_lines).strip()


def match_trigger(prompt: str, triggers: tuple[str, ...]) -> tuple[bool, str]:
    """Return (matched, prompt_without_trigger). Case-insensitive on the prefix only."""
    stripped = prompt.lstrip()
    low = stripped.lower()
    for t in triggers:
        t = t.strip()
        if t and low.startswith(t.lower()):
            return True, stripped[len(t) :].lstrip()
    return False, prompt


def should_optimize(prompt: str) -> tuple[bool, str]:
    """Decide whether to optimize and return the (possibly de-triggered) prompt to send."""
    mode = _env("ATLAS_OPTIMIZE", "trigger").lower()
    if mode == "off":
        return False, prompt
    # Never touch slash commands - they expand into their own prompts downstream.
    if prompt.lstrip().startswith("/"):
        return False, prompt
    triggers = tuple(
        _env("ATLAS_OPTIMIZE_TRIGGER", ",".join(DEFAULT_TRIGGERS)).split(",")
    )
    matched, body = match_trigger(prompt, triggers)
    minlen = int(_env("ATLAS_OPTIMIZE_MINLEN", "12") or "12")
    if mode == "always":
        # Fire on everything that isn't a slash command, but still skip prompts too short
        # to be worth the latency - a bare "ok"/"thanks" should pass through instantly.
        body = body if matched else prompt
        if len(body.strip()) < minlen:
            return False, prompt
        return True, body
    # default: trigger-gated
    if not matched:
        return False, prompt
    if len(body.strip()) < minlen:
        return False, prompt  # too trivial to be worth the latency
    return True, body


def override_command(prompt: str) -> list[str] | None:
    """argv for ATLAS_OPTIMIZE_CMD, or None if no override is set."""
    override = os.environ.get("ATLAS_OPTIMIZE_CMD", "").strip()
    if not override:
        return None
    import shlex

    if "{prompt}" in override:
        # Split the template FIRST, then substitute into each token, so a multi-word
        # prompt stays a single argv item instead of being word-split.
        return [tok.replace("{prompt}", prompt) for tok in shlex.split(override)]
    return shlex.split(override) + [prompt]


def _run_argv(cmd: list[str], timeout: float) -> str | None:
    try:
        proc = subprocess.run(
            cmd,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None
    if proc.returncode != 0:
        return None
    return clean(proc.stdout or "") or None


def ollama_base_url() -> str:
    """Resolve the ollama base URL from config, normalizing a bare host:port."""
    url = (
        os.environ.get("ATLAS_OLLAMA_URL")
        or os.environ.get("OLLAMA_HOST")
        or "http://127.0.0.1:11434"
    ).strip()
    if not url.startswith(("http://", "https://")):
        url = "http://" + url
    return url.rstrip("/")


def run_via_api(prompt: str, model: str, timeout: float) -> str | None:
    """Hit the ollama HTTP API (clean text, no terminal renderer). None on any failure."""
    body = json.dumps({"model": model, "prompt": prompt, "stream": False}).encode(
        "utf-8"
    )
    req = urllib.request.Request(
        ollama_base_url() + "/api/generate",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read())
    except (urllib.error.URLError, OSError, ValueError, TimeoutError):
        return None
    return clean(data.get("response", "")) or None


def run_optimizer(prompt: str) -> str | None:
    """Optimize via override cmd -> HTTP API -> CLI fallback. Returns cleaned text or None."""
    timeout = float(_env("ATLAS_OPTIMIZE_TIMEOUT", "110") or "110")
    override = override_command(prompt)
    if override is not None:
        return _run_argv(override, timeout)
    model = _env("ATLAS_OPTIMIZER_MODEL", DEFAULT_MODEL)
    # Prefer the HTTP API (pristine output); fall back to the CLI if the server is down.
    via_api = run_via_api(prompt, model, timeout)
    if via_api:
        return via_api
    if shutil.which("ollama"):
        return _run_argv(["ollama", "run", model, prompt], timeout)
    return None


# --- orchestration arming: classify substantive engineering prompts -----------
#
# The orchestration flag (atlas_db.mark_orchestrating) used to be set only AFTER a
# dispatch had already happened, so a session that opened with real engineering work
# but never dispatched was never nudged to dispatch. This classifier arms the flag up
# front from the UserPromptSubmit text alone. It is deliberately CONSERVATIVE: a
# wrongly-armed chat session gets denied by the dispatch tripwire, so a false positive
# costs more than a false negative. The default verdict is "trivial" unless a real
# engineering signal (an error report, or a strong action verb anchored to code or
# multiple steps) is present. mark_orchestrating stays the single writer of the flag.

ENGINE_NUDGE = (
    "[atlas-metis] This prompt reads as substantive, multi-step engineering work, so "
    "this session has been armed as an atlas orchestration run. It qualifies for the "
    "atlas-metis loop: invoke the atlas:atlas-metis skill and dispatch wave 1 to "
    "subagents (explorer / implementer / verifier) instead of doing the work inline."
)

# Bare acknowledgements / greetings - always trivial regardless of other signals.
_TRIVIAL_ACKS = {
    "thanks",
    "thank you",
    "ty",
    "thx",
    "ok",
    "okay",
    "k",
    "kk",
    "cool",
    "nice",
    "great",
    "perfect",
    "awesome",
    "yes",
    "no",
    "yep",
    "nope",
    "yeah",
    "sure",
    "got it",
    "gotcha",
    "done",
    "lgtm",
    "hi",
    "hello",
    "hey",
    "yo",
    "sup",
}

# Strong engineering verbs: unambiguously technical intent on their own. A prompt
# carrying one of these is a work order even without a named file. Deliberately
# excludes verbs that also read as everyday chores in any domain.
_STRONG_ENGINEERING_VERBS = re.compile(
    r"\b(rebuild|implement|debug|refactor|audit|investigate|migrate|"
    r"optimi[sz]e|rewrite|integrate|deploy|patch|diagnose|troubleshoot|harden|"
    r"configure|scaffold|instrument|paralleli[sz]e|redesign|restructure|"
    r"reorgani[sz]e|provision|benchmark|profile)\b",
    re.IGNORECASE,
)

# Common action verbs that dominate everyday, non-engineering chatter as much as
# code work ("fix a sandwich", "add a bow", "remove the onions", "build a
# treehouse"). These signal engineering ONLY when anchored to a concrete code
# reference; on their own - even stacked into a multi-step list - they are chat.
_COMMON_VERBS = re.compile(
    r"\b(build|fix|add|remove|delete|create|resolve|wire\s+up)\b",
    re.IGNORECASE,
)

# Error-report / failing-command signals - a strong standalone signal.
_ERROR_SIGNAL = re.compile(
    r"(traceback \(most recent call last\)"
    r"|\b\w*(?:error|exception)\b\s*:"
    r"|\bfile \".*\", line \d+"
    r"|(?:^|\s)at\s+\S+\(.*:\d+\)"
    r"|\b[\w./-]+\.\w{1,5}:\d+\b"
    r"|command not found"
    r"|npm err!"
    r"|\bexit(?:ed)?\s+(?:code|status)\s+\d+"
    r"|segmentation fault"
    r"|\bpanic:"
    r"|assertionerror|stack ?trace)",
    re.IGNORECASE | re.MULTILINE,
)

# Concrete code references: filenames with code extensions, source paths, call
# syntax, declarations, or schema/service domain nouns.
_CODE_REFERENCE = re.compile(
    r"(\b[\w./-]+\.(?:py|ts|tsx|js|jsx|go|rs|java|rb|php|sql|json|ya?ml|toml|sh|"
    r"c|cc|cpp|h|hpp|css|scss|html|vue|svelte)\b"
    r"|(?:^|[\s(])(?:src|lib|app|components?|hooks?|scripts?|services?|routes?|"
    r"models?|pages?|api|backend|frontend|tests?|migrations?)/[\w./-]+"
    r"|\b(?:class|def|function|interface|struct|enum)\s+\w+"
    r"|\b(?:endpoint|schema|migration|database|table|column|component|module|"
    r"service|route|handler|middleware|pipeline)\b)",
    re.IGNORECASE | re.MULTILINE,
)


def looks_substantive(prompt: str) -> bool:
    """Conservative classifier: True only for real engineering work. Defaults to
    False. A prompt arms orchestration only when it carries an unmistakable
    engineering signal, in priority order:
      1. an error report / failing command (a stack trace is unambiguous), or
      2. a strong engineering verb (refactor / audit / investigate / deploy / ...), or
      3. a common action verb (fix / add / remove / build / ...) ANCHORED to a
         concrete code reference.
    Common verbs on their own describe chores in any domain ("fix a sandwich",
    "add a bow", "buy tomatoes then add basil") - and stacking them into a
    numbered or sequenced list does NOT make them engineering. Multi-step
    structure was the old false-positive trap, so it is no longer a signal by
    itself; the code anchor is the hard gate."""
    text = prompt.strip()
    if len(text) < 20:
        return False  # greetings, acks, one-word follow-ups
    if text.lower().strip(" .!?,") in _TRIVIAL_ACKS:
        return False
    if _ERROR_SIGNAL.search(text):
        return True  # a stack trace / failing command is unambiguous engineering
    if _STRONG_ENGINEERING_VERBS.search(text):
        return True  # a technical verb is a work order on its own
    # Common verbs count as engineering only when anchored to code. This gate is
    # what keeps conversational multi-step prompts from arming a chat session.
    has_common = _COMMON_VERBS.search(text) is not None
    has_code = _CODE_REFERENCE.search(text) is not None
    return has_common and has_code


def arm_orchestration(data: dict, prompt: str) -> str | None:
    """Flag this session's run as an atlas orchestration run when the prompt is
    substantive engineering work, and return the engine nudge. Trivial or
    conversational prompts return None and touch nothing. Fully self-guarded: any
    failure (unreadable DB, missing module) returns None so the prompt is never
    blocked. Disable entirely with ATLAS_ENGINE_ARM=off."""
    if os.environ.get("ATLAS_ENGINE_ARM", "on").strip().lower() == "off":
        return None
    if prompt.lstrip().startswith("/"):
        return None  # slash commands expand downstream and self-orchestrate
    if not looks_substantive(prompt):
        return None
    session = (data.get("session_id") or "").strip()
    if not session:
        return None
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db  # stdlib-only observability store

        conn = atlas_db.connect()
        atlas_db.init(conn)
        atlas_db.mark_orchestrating(conn, session, data.get("cwd"))
        conn.close()
    except Exception:
        return None  # fail-open: never block a prompt over a DB hiccup
    return ENGINE_NUDGE


def optimizer_framing(optimized: str) -> str:
    """The system-reminder framing that wraps an optimized spec."""
    return (
        "[atlas - prompt-optimizer] The user opted to optimize this prompt. A local "
        "prompt-optimizer model rewrote their request into the expanded specification below. "
        "Treat it as the authoritative task spec for this turn; where it conflicts with the "
        "raw prompt, prefer the user's original intent. Do not mention this preprocessing "
        "unless asked.\n\n"
        "----- OPTIMIZED SPEC -----\n"
        f"{optimized}\n"
        "----- END OPTIMIZED SPEC -----"
    )


def emit_context(*parts: str) -> None:
    """Print a single UserPromptSubmit JSON injecting the given context block(s).
    Multiple parts (optimizer spec + orchestration nudge) are joined into one
    additionalContext so the hook only ever emits one JSON object on stdout."""
    blocks = [p for p in parts if p]
    if not blocks:
        return
    payload = {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": "\n\n".join(blocks),
        }
    }
    print(json.dumps(payload))


def is_skip(optimized: str) -> bool:
    """True if the optimizer declined to rewrite (its trivial-input verdict).

    The model is instructed to emit the bare token ``SKIP`` for greetings, acks, and other
    trivial prompts. We honor that as a passthrough instead of injecting "SKIP" as if it
    were a spec.
    """
    head = optimized.strip()
    if not head:
        return True
    first = head.splitlines()[0].strip().rstrip(".!").upper()
    return first == "SKIP"


def notify(optimized: str) -> None:
    """Brief colored banner to STDERR so the user sees the optimizer fired.

    stderr is surfaced in the terminal and renders ANSI color; unlike stdout it never enters
    Claude's context, so it can't pollute the spec. Silence it with ATLAS_OPTIMIZE_QUIET.
    """
    if os.environ.get("ATLAS_OPTIMIZE_QUIET", "").strip():
        return
    # Pull the one-line Intent out of the spec for an at-a-glance summary, if present.
    intent = ""
    lines = optimized.splitlines()
    for i, ln in enumerate(lines):
        if ln.strip().lower().startswith("## intent"):
            for nxt in lines[i + 1 :]:
                if nxt.strip():
                    intent = nxt.strip()
                    break
            break
    if len(intent) > 96:
        intent = intent[:95].rstrip() + "..."
    header = (
        "\033[48;5;22m\033[97;1m * prompt-optimizer \033[0m"
        f"\033[38;5;108m optimized spec injected - {len(optimized)} chars \033[0m"
    )
    print(header, file=sys.stderr)
    if intent:
        print(f"\033[38;5;108m   -> {intent}\033[0m", file=sys.stderr)


def audit(original: str, optimized: str | None) -> None:
    path = os.environ.get("ATLAS_OPTIMIZE_LOG", "").strip()
    if not path:
        return
    try:
        with open(os.path.expanduser(path), "a", encoding="utf-8") as fh:
            ts = time.strftime("%Y-%m-%d %H:%M:%S")
            status = "OK" if optimized else "SKIP/FAIL"
            fh.write(f"\n=== {ts} [{status}] ===\nORIGINAL: {original}\n")
            if optimized:
                fh.write(f"OPTIMIZED:\n{optimized}\n")
    except OSError:
        pass  # logging must never break the hook


def main() -> int:
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, ValueError):
        return 0  # malformed input -> passthrough
    prompt = (data.get("prompt") or "").strip()
    if not prompt:
        return 0

    # Arm the orchestration flag up front for substantive engineering prompts. This
    # is independent of the optimizer: it runs whether or not the prompt opted in,
    # and self-guards so a DB failure can never block the prompt.
    nudge = arm_orchestration(data, prompt)

    do_it, body = should_optimize(prompt)
    optimized = None
    if do_it:
        optimized = run_optimizer(body)
        if optimized and is_skip(optimized):
            optimized = (
                None  # model judged the prompt trivial - pass the raw text through
            )
        audit(body, optimized)

    # One emission point: combine the optimizer spec (if any) and the engine nudge
    # (if armed) into a single additionalContext block.
    frames = []
    if optimized:
        frames.append(optimizer_framing(optimized))
    if nudge:
        frames.append(nudge)
    if frames:
        emit_context(*frames)
    if optimized:
        notify(optimized)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
