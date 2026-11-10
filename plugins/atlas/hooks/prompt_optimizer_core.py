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

The optimizer runs ONLY on opt-in: a prompt that starts with a trigger prefix. The
atlas-prompt skill is separate: it rewrites in the main session and has a judge model check the
result. Every other prompt passes through untouched. A bare `SKIP` token returned by the model (its own
trivial-input verdict) is treated as a passthrough rather than injected.

Configuration (environment variables):
  ATLAS_OPTIMIZE          off | trigger            (default: trigger; legacy `always` = trigger)
  ATLAS_OPTIMIZE_TRIGGER  comma-separated prefixes  (default: "opt:,optimize:,++")
  ATLAS_OPTIMIZER_MODEL   ollama model tag          (default: prompt-optimizer:latest)
  ATLAS_OLLAMA_URL        ollama base URL; falls back to $OLLAMA_HOST, then
                                http://127.0.0.1:11434
  ATLAS_OPTIMIZE_CMD      override: run this instead of ollama. "{prompt}" is
                                substituted, else the prompt is appended as the final argv item
  ATLAS_OPTIMIZE_TIMEOUT  total seconds (API + CLI fallback share it) before giving up
                                (default: 25; hooks.json caps UserPromptSubmit at 120)
  ATLAS_OPTIMIZE_MINLEN   skip triggered prompts shorter than this many chars
                                (default: 12)
  ATLAS_OPTIMIZE_VERBOSE  if set, print a one-line stderr banner (quiet by default)
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

import prompt_decision

urllib = prompt_decision.urllib  # lazy: see prompt_decision._LazyUrllib

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
)
import atlas_hook_guard  # noqa: E402

# The ollama CLI renderer rewrites partial words at the wrap boundary using cursor-back +
# erase sequences (e.g. "data c\x1b[1D\x1b[K\nconsistency"). Stripping those codes naively
# leaves the dangling "c"; we must INTERPRET them like a terminal to get clean text. The HTTP
# API path emits no codes, so this is a no-op there.
_CSI = re.compile(r"\x1b\[([0-9;]*)([A-Za-z])")
_OSC = re.compile(r"\x1b\][^\x07]*\x07")  # OSC (e.g. window-title) sequences

DEFAULT_TRIGGERS = ("opt:", "optimize:", "++")
DEFAULT_MODEL = "prompt-optimizer:latest"


def _env(name: str, default: str) -> str:
    val = os.environ.get(name, "").strip()
    return val if val else default


def _env_num(name: str, default, cast):
    """Read a numeric env var, falling back to default on a bad value - never blocks."""
    try:
        return cast(_env(name, str(default)))
    except (ValueError, TypeError):
        return default


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
            # Multi-param CSI sequences (e.g. SGR "38;5;108m") aren't single ints -
            # they're not D/C/K anyway, so treat them as the ignored default.
            try:
                num = int(num_s) if num_s else 0
            except ValueError:
                num = 0
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
    minlen = _env_num("ATLAS_OPTIMIZE_MINLEN", 12, int)
    # Opt-in only: no trigger prefix, no optimizer run (legacy `always` mode included).
    if not matched:
        return False, prompt
    if len(body.strip()) < minlen:
        return False, prompt  # too trivial to be worth the latency
    return True, body


# Directive the optimizer must carry into its spec. It is an instruction FOR the executing
# agent; the optimizer itself does not write in STE.
STE_DIRECTIVE = (
    "Write your replies, docs and reports in ASDSTE-100 Simplified Technical English, "
    "applied about 80%: short sentences (20 words max for procedures, 25 for descriptions), "
    "one instruction per sentence, active voice, approved common words, consistent terms. "
    "Keep technical names, code and quoted text unchanged. Relax a rule when it costs clarity."
)

OPTIMIZER_TEMPLATE = (
    "Rewrite the request below into a structured task spec. Keep the user's intent and "
    "wording style. Do NOT rewrite the request itself into Simplified Technical English. "
    "If the request is trivial (a greeting or acknowledgement), output exactly: SKIP\n\n"
    "End the spec with a section titled `## Output style` that contains exactly this "
    "directive for the agent that will execute the spec, copied word for word:\n"
    "{directive}\n\n"
    "----- REQUEST -----\n{prompt}\n----- END REQUEST -----"
)


def build_optimizer_prompt(body: str) -> str:
    """Wrap the user's prompt in the optimizer instructions, including the STE directive."""
    return OPTIMIZER_TEMPLATE.format(directive=STE_DIRECTIVE, prompt=body)


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


# Set by run_via_api: True when its last call died on a timeout, so run_optimizer
# can skip the CLI fallback (a hung server will not answer the CLI either).
_api_timed_out = False


def run_via_api(prompt: str, model: str, timeout: float) -> str | None:
    """Hit the ollama HTTP API (clean text, no terminal renderer). None on any failure."""
    global _api_timed_out
    _api_timed_out = False
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
    except (urllib.error.URLError, OSError, ValueError, TimeoutError) as exc:
        reason = getattr(exc, "reason", None)
        _api_timed_out = isinstance(exc, TimeoutError) or isinstance(
            reason, TimeoutError
        )
        return None
    return clean(data.get("response", "")) or None


def run_optimizer(prompt: str) -> str | None:
    """Optimize via override cmd -> HTTP API -> CLI fallback. Returns cleaned text or None.

    One shared deadline (ATLAS_OPTIMIZE_TIMEOUT, default 25 s) covers the API call and
    the CLI fallback, and an API timeout skips the fallback: the hook must finish well
    inside hooks.json's UserPromptSubmit cap."""
    timeout = _env_num("ATLAS_OPTIMIZE_TIMEOUT", 25.0, float)
    deadline = time.monotonic() + timeout
    override = override_command(prompt)
    if override is not None:
        return _run_argv(override, timeout)
    model = _env("ATLAS_OPTIMIZER_MODEL", DEFAULT_MODEL)
    # Prefer the HTTP API (pristine output); fall back to the CLI if the server is down.
    global _api_timed_out
    _api_timed_out = False  # a stubbed/previous run_via_api must not leak its verdict
    via_api = run_via_api(prompt, model, timeout)
    if via_api:
        return via_api
    remaining = deadline - time.monotonic()
    if _api_timed_out or remaining <= 0:
        return None
    if shutil.which("ollama"):
        return _run_argv(["ollama", "run", model, prompt], remaining)
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
    "[atlas-orchestrate] Session armed as an orchestration run: invoke the "
    "atlas:atlas-orchestrate skill and dispatch wave 1 to subagents instead of working inline."
)

# ---- routing: prompt -> (class, effort) -> resolved team -> next command ----
_CLOSING_ROLES = frozenset(
    {"planner", "verifier", "completeness-critic", "docs-curator", "docs-auditor"}
)
# Classes whose workers only read: they size a tmux team, not a writing crew.
_READ_ONLY_CLASSES = frozenset({"audit", "verify", "db", "db-audit", "ui-test"})
_MATRIX_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "contracts", "scope-matrix.json"
)
_NUDGE_MAX_BYTES = 700
_WORD_RE = re.compile(r"[a-z][a-z-]*")
_FILE_REF_RE = re.compile(
    r"[\w./-]+\.(?:py|ts|tsx|js|jsx|go|rs|java|rb|php|sql|json|ya?ml|toml|sh|"
    r"c|cc|cpp|h|hpp|css|scss|html|vue|svelte|md)\b",
    re.IGNORECASE,
)
_SYMBOL_REF_RE = re.compile(
    r"`[^`\s]+`|\b[A-Za-z]\w*_\w+\b|\b[a-z]+[A-Z]\w*\b|\b\w+\(\)"
    r"|\b(?:class|def|function|interface|struct|enum)\s+\w+"
)
_HIGH_EFFORT_RE = re.compile(
    r"\b(?:whole|entire|full)\s+(?:repo|repository|codebase|project|tree|plugin)\b"
    r"|\b(?:audit|review|check|scan|sweep)\s+(?:all|every|everything)\b"
    r"|\b(?:across|throughout)\s+(?:the\s+)?(?:whole\s+)?"
    r"(?:repo|repository|codebase|project|tree|plugins?|surfaces|modules|services)\b"
    r"|\b(?:all|every)\s+(?:the\s+)?(?:files|modules|hooks|surfaces|plugins|packages|"
    r"services|scripts|components|endpoints)\b"
    r"|\bmany\s+(?:files|surfaces|modules)\b|\b(?:repo|codebase)-wide\b",
    re.IGNORECASE,
)


def _scope_vocab() -> dict:
    with open(_MATRIX_PATH) as f:
        matrix = json.load(f)
    vocab = {c: c for c in matrix.get("classes", {})}
    for alias, target in (matrix.get("class_aliases") or {}).items():
        vocab.setdefault(alias, target)
    return vocab


_ACTION_VERBS = frozenset(
    "add audit build change convert create delete document fix implement "
    "migrate move refactor remove rename replace review rewrite test update "
    "upgrade write".split()
)


def classify_scope(prompt: str) -> tuple[str, str]:
    """Keyword (task_class, effort) for a prompt.

    ponytail: keyword heuristic over scope-matrix class names and aliases, and
    a count of distinct action verbs (2+ jobs is never low); the ceiling is
    word matching (no intent, no negation). Upgrade path: ask the
    local decision model (prompt_decision) for class/effort and keep this as the
    fallback when it is off, slow or unsure.
    """
    text = prompt or ""
    files = {m.lower() for m in _FILE_REF_RE.findall(text)}
    rest = _FILE_REF_RE.sub(" ", text)
    rest = _CODE_ANCHOR.sub(" ", rest)
    symbols = {m.lower() for m in _SYMBOL_REF_RE.findall(rest)}
    words_text = _SYMBOL_REF_RE.sub(" ", rest).lower()
    task_class = "implement"
    try:
        vocab = _scope_vocab()
    except Exception:
        vocab = {}
    for word in _WORD_RE.findall(words_text):
        word = word.strip("-")
        hit = vocab.get(word) or (vocab.get(word[:-1]) if word.endswith("s") else None)
        if hit:
            task_class = hit
            break
    if _HIGH_EFFORT_RE.search(text) or len(files) >= 4:
        effort = "high"
    elif (
        len(files) <= 1
        and len(symbols) <= 1
        and (files or symbols)
        and len(text) <= 240
        and len(_ACTION_VERBS.intersection(_WORD_RE.findall(words_text))) <= 1
    ):
        effort = "low"
    else:
        effort = "medium"
    return task_class, effort


def _working_seats(team: list) -> int:
    return sum(
        int(s.get("count", 1) or 1)
        for s in team
        if s.get("role") and s["role"] not in _CLOSING_ROLES
    )


def _scope_root(cwd) -> str:
    base = cwd or os.getcwd()
    try:
        import atlas_paths

        return atlas_paths.project_root(base) or base
    except Exception:
        return base


def _scope_file(session_id: str, root: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", session_id)[:128]
    return os.path.join(root, ".atlas", ".run", "atlas-scope", safe + ".json")


def _store_scope(session_id: str, cwd, record: dict | None) -> None:
    try:
        path = _scope_file(session_id, _scope_root(cwd))
        if record is None:
            if os.path.exists(path):
                os.remove(path)
            return
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(record, f)
        os.replace(tmp, path)
    except Exception:
        pass


def resolved_scope(session_id: str, root: str | None = None) -> dict | None:
    """The scope arm_orchestration resolved for this session, else None.

    Keys: task_class, effort, working_seats. Never raises."""
    try:
        sid = (session_id or "").strip()
        if not sid:
            return None
        base = root or os.getcwd()
        for cand in dict.fromkeys((base, _scope_root(base))):
            path = _scope_file(sid, cand)
            if not os.path.isfile(path):
                continue
            with open(path) as f:
                rec = json.load(f)
            return {
                "task_class": str(rec["task_class"]),
                "effort": str(rec["effort"]),
                "working_seats": int(rec["working_seats"]),
            }
    except Exception:
        return None
    return None


def _route_nudge(task_class: str, effort: str, team: list) -> str:
    seats = ", ".join(
        "%s x%d (%s)" % (s["role"], int(s.get("count", 1) or 1), s.get("model") or "default")
        for s in team
    )
    working = [s for s in team if s.get("role") not in _CLOSING_ROLES]
    n = _working_seats(team)
    scope = "%s/%s" % (task_class, effort)
    if n >= 2 and task_class in _READ_ONLY_CLASSES:
        nxt = (
            "Next: python3 ${CLAUDE_PLUGIN_ROOT}/scripts/atlas_mux.py spawn-team "
            "--class %s --effort %s --task '<task>' (tmux team; not in-process "
            "atlas:* calls)." % (task_class, effort)
        )
    elif n >= 2:
        nxt = (
            "Next: python3 ${CLAUDE_PLUGIN_ROOT}/scripts/atlas_crew.py run "
            "--spec <spec.md> --files '<glob>' --check '<test cmd>' "
            "(tmux crew; not in-process atlas:* calls)."
        )
    else:
        role = (working or team)[0]["role"]
        nxt = (
            "Next: one in-process atlas:%s call with SCOPE: %s is the right size."
            % (role, scope)
        )
    head = (
        "[atlas-orchestrate] Session armed: use the atlas:atlas-orchestrate skill "
        "and dispatch, not inline work."
    )
    msg = " ".join((head, "Route %s -> %s." % (scope, seats), nxt))
    if len(msg.encode()) >= _NUDGE_MAX_BYTES:
        msg = " ".join((head, "Route %s." % scope, nxt))
    if len(msg.encode()) >= _NUDGE_MAX_BYTES:
        raise ValueError("route nudge too long")
    return msg


def _routed_nudge(data: dict, prompt: str) -> str:
    session = (data.get("session_id") or "").strip()
    cwd = data.get("cwd")
    try:
        import atlas_resolve

        task_class, effort = classify_scope(prompt)
        res = atlas_resolve.resolve(task_class, effort)
        team = list(res["team"])
        task_class, effort = res["task_class"], res["effort"]
        msg = _route_nudge(task_class, effort, team)
    except Exception as exc:
        try:
            atlas_hook_guard.fault("prompt_optimizer", "route resolve failed: %s" % exc)
        except Exception:
            pass
        _store_scope(session, cwd, None)
        return ENGINE_NUDGE
    _store_scope(
        session,
        cwd,
        {
            "task_class": task_class,
            "effort": effort,
            "working_seats": _working_seats(team),
            "team": team,
            "ts": time.time(),
        },
    )
    return msg


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

# File, path, or declaration. Generic nouns (table, service, column) are not
# an anchor: "add a bow to the table" matches _CODE_REFERENCE and is the case
# a local choice model is allowed to veto.
_CODE_ANCHOR = re.compile(
    r"(\b[\w./-]+\.(?:py|ts|tsx|js|jsx|go|rs|java|rb|php|sql|json|ya?ml|toml|sh|"
    r"c|cc|cpp|h|hpp|css|scss|html|vue|svelte)\b"
    r"|(?:^|[\s(])(?:src|lib|app|components?|hooks?|scripts?|services?|routes?|"
    r"models?|pages?|api|backend|frontend|tests?|migrations?)/[\w./-]+"
    r"|\b(?:class|def|function|interface|struct|enum)\s+\w+)",
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


def _regex_band(prompt: str) -> str:
    """arm, skip, or ask. Only ask may call the local decision model."""
    text = prompt.strip()
    if len(text) < 20 or text.lower().strip(" .!?,") in _TRIVIAL_ACKS:
        return "skip"
    if _ERROR_SIGNAL.search(text) or _STRONG_ENGINEERING_VERBS.search(text):
        return "arm"
    if _COMMON_VERBS.search(text) and _CODE_ANCHOR.search(text):
        return "arm"
    return "ask"


def resolve_substantive(prompt: str, decide=None) -> bool:
    """Regex first. The local model may only override the ask band.

    Stack traces, strong engineering verbs, and a common verb plus a file,
    path, or declaration arm with no model call. A confident conversation
    label vetoes a generic-noun arm ("add a bow to the table"). A confident
    code_change or investigation label can arm a regex miss ("explain how
    the completion gate decides"). Timeout, low confidence, ATLAS_DECISION=off,
    and a bare defect label keep the regex answer.
    """
    band = _regex_band(prompt)
    if band == "skip":
        return False
    if band == "arm":
        return True
    regex_yes = looks_substantive(prompt)
    if (
        decide is None
        and os.environ.get("ATLAS_DECISION", "on").strip().lower() == "off"
    ):
        return regex_yes
    decider = decide if decide is not None else prompt_decision.local_decision
    try:
        verdict = decider(prompt)
    except Exception:
        return regex_yes
    return prompt_decision.apply_verdict(regex_yes, verdict, prompt)


# Opening tags the harness wraps around events it injects as a user turn. A user
# prompt that merely starts with "<" (JSX/HTML such as "<Button> throws...") is not one.
_HARNESS_TAG_RE = re.compile(
    r"<(?:task-notification|system-reminder|command-[a-z-]+|local-command-[a-z-]+"
    r"|wake|agent-message|user-prompt-submit-hook)(?=[\s>/])"
)


def _is_harness_event(prompt: str) -> bool:
    """True when `prompt` is a harness-generated event, not a user request.

    UserPromptSubmit fires for more than typed user input: a subagent
    hand-back report ("Another Claude session sent a message: ...
    <agent-message from=...>[Subagent hand-back] ..."), a background task
    notification ("<task-notification>..."), and other tag-wrapped harness
    payloads (e.g. "<system-reminder>", "<local-command-...>") all arrive on
    this same hook. None of these is a user request, so neither the
    optimizer nor the orchestration classifier should ever see or act on
    them - re-arming orchestration on a hand-back re-injects the nudge for
    no new work.
    """
    head = prompt.lstrip()[:200]
    if _HARNESS_TAG_RE.match(head):
        return True
    if head.startswith("Another Claude session sent a message"):
        return True
    return "<agent-message from=" in head


def arm_orchestration(data: dict, prompt: str) -> str | None:
    """Arm via _arm_orchestration; a prompt that does not arm clears the
    stored scope so resolved_scope never reports the previous run."""
    nudge = _arm_orchestration(data, prompt)
    if nudge is None:
        try:
            session = (data.get("session_id") or "").strip()
            if session:
                _store_scope(session, data.get("cwd"), None)
        except Exception:
            pass
    return nudge


def _arm_orchestration(data: dict, prompt: str) -> str | None:
    """Flag this session's run as an atlas orchestration run when the prompt is
    substantive engineering work, and return the engine nudge. Trivial or
    conversational prompts return None and touch nothing. Fully self-guarded: any
    failure (unreadable DB, missing module, decision-model error) returns None
    so the prompt is never blocked. Disable entirely with ATLAS_ENGINE_ARM=off.
    ATLAS_DECISION=off keeps the regex and skips the local model."""
    if os.environ.get("ATLAS_ENGINE_ARM", "on").strip().lower() == "off":
        return None
    if (os.environ.get("ATLAS_WORKER_NAME") or "").strip():
        return None  # headless atlas_mux worker: a leaf, never armed
    if prompt.lstrip().startswith("/"):
        return None  # slash commands expand downstream and self-orchestrate
    if not resolve_substantive(prompt):
        return None
    session = (data.get("session_id") or "").strip()
    if not session:
        return None
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db  # stdlib-only observability store

        conn = atlas_db.connect()
        atlas_db.init(conn)
        try:
            atlas_db.mark_orchestrating(conn, session, data.get("cwd"))
        except Exception:
            # The arm failed, so this run will not be flagged as an
            # orchestration run; record one friction row so the silent miss
            # is observable. The friction write is itself guarded: a doubly
            # failing DB must not raise out of the hook.
            try:
                conn.rollback()
                atlas_db.record_friction(
                    conn,
                    session,
                    "orchestration_flag_arm_failed",
                    snippet="mark_orchestrating raised; run not flagged",
                    role="lead",  # workers returned above
                )
            except Exception:
                pass
            # Preserve the original contract: an arm failure returns None
            # (no nudge), re-raise into the outer fail-open handler.
            raise
        conn.close()
    except Exception as exc:
        # fail-open: never block a prompt over a DB hiccup, but leave a trace --
        # an unarmed run means the dispatch/completion gates stay inert.
        atlas_hook_guard.fault(
            "prompt_optimizer", "orchestration arm failed (gates inert): %s" % exc
        )
        return None
    return _routed_nudge(data, prompt)


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
    """One-line stderr banner, off unless ATLAS_OPTIMIZE_VERBOSE is set.

    stderr is surfaced in the terminal and renders ANSI color; unlike stdout it never enters
    Claude's context, so it can't pollute the spec. It is still terminal noise on every
    optimized prompt, and the spec itself is already in context, so the default is silence.
    """
    if not os.environ.get("ATLAS_OPTIMIZE_VERBOSE", "").strip():
        return  # quiet by default: the spec is in context, the banner adds nothing
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
    print(
        f"\033[38;5;108m[atlas] spec injected: {intent or str(len(optimized)) + ' chars'}\033[0m",
        file=sys.stderr,
    )


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


def _mark_prompt_boundary(data: dict) -> None:
    """Restart the tripwire's inline-op window at this user prompt. Fail-open."""
    session = (data.get("session_id") or "").strip()
    if not session:
        return
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        conn = atlas_db.connect()
        atlas_db.init(conn)
        atlas_db.mark_prompt_boundary(conn, session)
        conn.close()
    except Exception as exc:
        atlas_hook_guard.fault(
            "prompt_optimizer", "prompt boundary mark failed: %s" % exc
        )


def main() -> int:
    data = atlas_hook_guard.load_payload("prompt_optimizer")
    prompt = (data.get("prompt") or "").strip()
    if not prompt:
        return 0
    if _is_harness_event(prompt):
        return 0  # hand-back report / task-notification / system-reminder, not a user request

    if prompt.startswith("/"):  # telemetry: skill.<dir> for a leading /atlas:<skill> or /<skill>
        try:
            import event_dispatch

            event_dispatch.record_prompt(data)
        except Exception:  # noqa: BLE001, S110 -- telemetry never changes a prompt
            pass

    # Arm the orchestration flag up front for substantive engineering prompts. This
    # is independent of the optimizer: it runs whether or not the prompt opted in,
    # and self-guards so a DB failure can never block the prompt.
    nudge = arm_orchestration(data, prompt)
    _mark_prompt_boundary(data)

    do_it, body = should_optimize(prompt)
    optimized = None
    if do_it:
        optimized = run_optimizer(build_optimizer_prompt(body))
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


def _cli():
    raise SystemExit(atlas_hook_guard.run_hook("prompt_optimizer", main))
