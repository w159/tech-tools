#!/usr/bin/env python3
"""Atlas control plane: behavior knobs, ecosystem inventory, connector operations.

Backs the dashboard's /api/behavior, /api/ecosystem, /api/mcp/* and the
connector test / import / export routes. It lives beside atlas_dashboard.py so
that file stays the HTTP + UI layer instead of growing a second personality.

Every write is allowlisted and lands in exactly one of three places:

  ~/.claude/settings.json  env / disabledMcpServers / enabledPlugins
  ~/.claude.json           mcpServers  (user-scope MCP servers, `claude mcp add`)
  <plugin>/.env            connector credentials (handled in atlas_dashboard)

Behavior knobs go to settings.json `env` because Claude Code exports that block
into every hook subprocess, which is where the ATLAS_* vars are actually read.
"""

from __future__ import annotations

import json
import os
import re
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
PLUGIN_ROOT = SCRIPTS_DIR.parent
CLAUDE_DIR = Path.home() / ".claude"
SETTINGS_PATH = CLAUDE_DIR / "settings.json"
CLAUDE_JSON_PATH = Path.home() / ".claude.json"
PLUGINS_DIR = CLAUDE_DIR / "plugins"

ENV_KEY_RE = re.compile(r"^ATLAS_[A-Z0-9_]+$")
MCP_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$")
MAX_VALUE_LEN = 2048


# --- settings.json / .claude.json read + write --------------------------------


def _read_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def write_private(path: Path, text: str) -> None:
    """Atomic, owner-only (0600) write: temp file in the same dir, then rename.

    A crash leaves the old file intact, and the credentials never exist at a
    wider mode even briefly. An existing wider-mode file is tightened.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.atlas-tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def _write_json(path: Path, data: dict) -> None:
    write_private(path, json.dumps(data, indent=2) + "\n")


def read_settings() -> dict:
    return _read_json(SETTINGS_PATH)


def mutate_settings(fn):
    """Apply fn(settings_dict) in place and persist. Returns the new settings."""
    data = read_settings()
    fn(data)
    _write_json(SETTINGS_PATH, data)
    return data


# --- atlas-owned settings store ----------------------------------------------
#
# Harness-agnostic home for knob values: <ATLAS_HOME or ~/.atlas>/settings.json,
# {"env": {KEY: value}, "changed": {KEY: epoch}}. Claude Code also gets the values
# in settings.json env (it exports that into hooks); omp/hook-bridge.ts exports
# this file into every bridged hook's env. Resolved per call, like atlas.db.


def store_path() -> Path:
    return (
        Path(os.environ.get("ATLAS_HOME") or Path.home() / ".atlas") / "settings.json"
    )


def read_store() -> dict:
    data = _read_json(store_path())
    env = data.get("env") or {}
    changed = data.get("changed") or {}
    if not isinstance(env, dict):
        env = {}
    if not isinstance(changed, dict):
        changed = {}
    return {"env": {str(k): str(v) for k, v in env.items()}, "changed": changed}


def _write_store(env: dict, changed: dict) -> None:
    write_private(
        store_path(),
        json.dumps({"env": env, "changed": changed}, indent=2, sort_keys=True) + "\n",
    )


# --- behavior knobs -----------------------------------------------------------
#
# Each entry documents a variable the atlas hooks actually read, with the
# file:line that reads it so the UI can show its own evidence. `default` is the
# hook's fallback, not a value we write.

BEHAVIOR_KNOBS = []  # filled by _k() below, in display order

# scope "hooks": a Python hook reads it, so a value saved here reaches Claude Code hooks (settings.json env,
# next session) and omp's bridged hooks (store, next hook run). scope "shell": it is read straight from the
# environment of the process that runs it (the omp extension, an atlas CLI, the dashboard), which never sees
# either saved layer, so the page shows it read-only and refuses to save it.
GROUP_INTROS = {
    "Session automation": "Things atlas does by itself when a session starts or ends.",
    "Guardrails": "Checks that block or nudge a session that skips delegation or evidence. Turning these off removes protection.",
    "Prompt optimizer": "Rewrites your prompt with a local Ollama model before the agent sees it. By default it only runs when the prompt starts with a trigger prefix such as `opt:`.",
    "Turn scoring": "Optional model scoring of finished replies. Nothing is sent unless TYPESAFE_API_KEY (or a loopback ATLAS_TYPESAFE_URL) is set.",
    "omp extension": "Read by the omp extension from the shell omp was launched from. They cannot be saved from this page: export them before starting omp.",
    "Storage paths": "Where atlas keeps its state. Shown for reference; set them in your shell profile (the settings file that stores these edits lives inside ATLAS_HOME, so it cannot move itself).",
}


def _k(
    key,
    group,
    title,
    description,
    kind="toggle",
    default="",
    scope="hooks",
    on="on",
    off="off",
    options=None,
    details="",
):
    BEHAVIOR_KNOBS.append(
        {
            "key": key,
            "group": group,
            "title": title,
            "description": description,
            "kind": kind,
            "default": default,
            "scope": scope,
            "details": details,
            **({"on": on, "off": off} if kind == "toggle" else {}),
            **({"options": options} if options else {}),
        }
    )


_SA, _GR, _PO, _TS, _OMP, _ST = (
    "Session automation",
    "Guardrails",
    "Prompt optimizer",
    "Turn scoring",
    "omp extension",
    "Storage paths",
)
_k(
    "ATLAS_DASHBOARD",
    _SA,
    "Start the Command Center automatically",
    "Each new session launches this dashboard if it is not already running.",
    default="on",
    details="Off means nothing starts it; run `atlas_dashboard.py ensure` yourself. Sessions in scratch or temp directories never start the shared dashboard either way.",
)
_k(
    "ATLAS_DASHBOARD_PORT",
    _SA,
    "Command Center port",
    "Loopback port the dashboard listens on.",
    "number",
    "7421",
    details="Sessions look for the dashboard on this port, so every terminal and the running dashboard must agree. A running dashboard keeps its old port until restarted.",
)
_k(
    "ATLAS_INGEST",
    _SA,
    "Record finished sessions",
    "At session end, read the transcript into the telemetry database that feeds Overview, Activity and Health.",
    default="on",
    details="Off leaves new sessions out of every page here. Under omp the stop bridge also checks the shell environment before it spawns the ingest.",
)
_k(
    "ATLAS_CHRONICLE",
    _SA,
    "Capture session facets",
    "Record what kind of work each session was, so atlas-doctor can mine patterns across sessions.",
    default="on",
)
_k(
    "ATLAS_MEMORY_CAPTURE",
    _SA,
    "Capture memory notes",
    "At session end, save durable lessons to ~/.atlas/memory/. Never creates skills or commands.",
    default="on",
)
_k(
    "ATLAS_CONNECTOR_WATCH",
    _SA,
    "Watch connector credentials",
    "Warn in-session when a connector call fails because its credentials are missing or stale, instead of reporting a permissions problem.",
    default="on",
)
_k(
    "ATLAS_GATE",
    _GR,
    "Completion gate",
    "Blocks a 'done' claim that has no verified finding, and flags source changes with no matching docs/ update.",
    default="",
    on="",
    details="Off removes atlas's main evidence guarantee and also disables the worker report gate. Empty (the default) means on.",
)
_k(
    "ATLAS_TRIPWIRE",
    _GR,
    "Dispatch tripwire",
    "Coaches a session back toward dispatching subagents when it does too much work inline.",
    default="on",
    details="Controls the advisory messages only. Blocking is the separate switch below.",
)
_k(
    "ATLAS_TRIPWIRE_HARD",
    _GR,
    "Let the tripwire block tool calls",
    "Allow the tripwire to deny a tool call instead of only advising.",
    default="on",
    details="Off disables the deny tier: no 'dispatch required' denials, and no denial of native Read/Grep/Glob/Bash in docs/ projects that have lean-ctx tools. Advisory messages remain.",
)
_k(
    "ATLAS_TRIPWIRE_THRESHOLD",
    _GR,
    "Tripwire threshold",
    "How many inline operations an armed orchestration run may do before the tripwire acts.",
    "number",
    "4",
)
_k(
    "ATLAS_ENGINE_ARM",
    _GR,
    "Arm orchestration from the prompt",
    "Classify each prompt and arm the orchestration run up front, so substantive work is nudged toward dispatch before the first inline edit.",
    default="on",
)
_k(
    "ATLAS_FALLOW",
    _GR,
    "Fallow commit/push gate",
    "On git commit/push, run `fallow audit` and deny when the verdict is fail. Skipped when the fallow CLI is missing.",
    default="on",
)
_k(
    "ATLAS_OPTIMIZE",
    _PO,
    "Optimizer mode",
    "When the prompt optimizer runs: only for trigger prefixes, for every non-trivial prompt (adds model latency each time), or never.",
    "choice",
    "trigger",
    options=["off", "trigger", "always"],
)
_k(
    "ATLAS_OPTIMIZE_TRIGGER",
    _PO,
    "Trigger prefixes",
    "Comma-separated prompt prefixes that request optimization in trigger mode.",
    "text",
    "opt:,optimize:,++",
)
_k(
    "ATLAS_OPTIMIZER_MODEL",
    _PO,
    "Ollama model",
    "Name of the local model that rewrites the prompt.",
    "text",
    "prompt-optimizer:latest",
)
_k(
    "ATLAS_OLLAMA_URL",
    _PO,
    "Ollama address",
    "Where Ollama listens. When unset, $OLLAMA_HOST is used, then the default.",
    "text",
    "http://127.0.0.1:11434",
)
_k(
    "ATLAS_OPTIMIZE_MINLEN",
    _PO,
    "Minimum prompt length",
    "Prompts shorter than this many characters skip the optimizer before any model call.",
    "number",
    "12",
)
_k(
    "ATLAS_OPTIMIZE_TIMEOUT",
    _PO,
    "Optimizer timeout (seconds)",
    "Give up and pass the original prompt through after this long. Keep it under the 120 s hook timeout in hooks.json.",
    "number",
    "110",
)
_k(
    "ATLAS_OPTIMIZE_CMD",
    _PO,
    "Replace Ollama with a command",
    "Run this command instead of Ollama. `{prompt}` is substituted; otherwise the prompt is appended as the last argument. Blank uses Ollama.",
    "text",
    "",
)
_k(
    "ATLAS_OPTIMIZE_VERBOSE",
    _PO,
    "Print a banner when a prompt is rewritten",
    "Print a one-line banner on stderr each time the optimizer rewrites a prompt.",
    default="",
    on="1",
    off="",
)
_k(
    "ATLAS_OPTIMIZE_LOG",
    _PO,
    "Optimizer audit log file",
    "Append an original-to-optimized line to this file for every rewrite. Blank keeps no log.",
    "text",
    "",
)
_k(
    "ATLAS_TYPESAFE_SCORING",
    _TS,
    "Score finished replies",
    "Model-score recent assistant replies via api.typesafe.ai. Transcript excerpts leave this machine (secrets scrubbed).",
    default="on",
    details="Needs TYPESAFE_API_KEY in the environment; with no key nothing is scored or sent, whatever this says. Off disables scoring even with a key.",
)
_k(
    "ATLAS_TYPESAFE_MODEL",
    _TS,
    "Scoring model",
    "Model id sent with every scoring request.",
    "text",
    "jev-latest",
)
_k(
    "ATLAS_TYPESAFE_MAX_CALLS",
    _TS,
    "Scoring calls per run",
    "Upper bound on scoring requests one scoring pass may make.",
    "number",
    "200",
)
_k(
    "ATLAS_HOOK_BRIDGE",
    _OMP,
    "Run atlas hooks inside omp",
    "The omp extension runs atlas's Claude hooks inside omp. `off` disables every bridged guardrail under omp.",
    default="",
    scope="shell",
    on="",
)
_k(
    "ATLAS_BRIDGE_HOOK_TIMEOUT_S",
    _OMP,
    "Bridged hook time limit (seconds)",
    "Hard cap per bridged hook: the lower of this and the hook's own timeout. omp cuts a handler at 30 s.",
    "number",
    "25",
    scope="shell",
)
_k(
    "ATLAS_WORKER_MAX_TOKENS",
    _OMP,
    "Worker output-token cap",
    "Atlas workers have any larger max_tokens request lowered to this. It is never raised.",
    "number",
    "32000",
    scope="shell",
)
_k(
    "ATLAS_ADVISOR_GATE",
    _OMP,
    "Advisor gate",
    "Blocks stopping under omp while advisor items are open on the atlas board. `off` skips it.",
    default="",
    scope="shell",
    on="",
)
_k(
    "ATLAS_HOME",
    _ST,
    "Atlas state directory",
    "Holds atlas.db, memory/, the saved-settings file, the dashboard pidfile and log.",
    "text",
    str(Path.home() / ".atlas"),
    scope="shell",
)
_k(
    "ATLAS_DB",
    _ST,
    "Telemetry database",
    "The sqlite file every hook writes to and this dashboard reads. Pointing elsewhere hides existing history.",
    "text",
    str(Path.home() / ".atlas" / "atlas.db"),
    scope="shell",
)

# Documented ATLAS_* variables outside the curated groups. A discovered key missing here is shown as undocumented.
_AD = {
    "ATLAS_MANDATES": (
        "`off` silences the recall reminder and the one-time commit nudge.",
        "",
        "hooks",
    ),
    "ATLAS_GATE_HEADER": (
        "`off` skips the completion-gate check that a final reply starts with the ATLAS header line.",
        "",
        "hooks",
    ),
    "ATLAS_GATE_PHASES": (
        "`off` skips the check that the board covers the required todo phases after code shipped.",
        "",
        "hooks",
    ),
    "ATLAS_GATE_COLONY": (
        "`off` skips the check that a run with two or more workers actually used its colony channel.",
        "",
        "hooks",
    ),
    "ATLAS_GATE_REPORT": (
        "`off` disables the gate that blocks a worker's final message when it is not the fixed report container.",
        "",
        "hooks",
    ),
    "ATLAS_FOOTPRINT_FILES": (
        "Distinct code files an unflagged run may touch before the tripwire treats it as orchestration. 0 disables.",
        "3",
        "hooks",
    ),
    "ATLAS_CHANNELS": (
        "`off` stops atlas steering subagent dispatches onto a colony channel.",
        "",
        "hooks",
    ),
    "ATLAS_DECISION": (
        "`off` skips the local-model prompt classifier and keeps the regex result.",
        "on",
        "hooks",
    ),
    "ATLAS_DECISION_URL": (
        "Loopback endpoint for the prompt classifier. Blank uses Ollama on 127.0.0.1:11434.",
        "",
        "hooks",
    ),
    "ATLAS_DECISION_MODEL": ("Model the prompt classifier asks.", "nimble", "hooks"),
    "ATLAS_COLONY": (
        "`off` skips starting the herdr colony when a session begins.",
        "on",
        "hooks",
    ),
    "ATLAS_TODO": (
        "`off` stops copying the session's todo list onto the atlas board.",
        "",
        "hooks",
    ),
    "ATLAS_DOCS_REPAIR": (
        "`off` skips the session-start check for a project that has no docs/ tree, and its notice.",
        "",
        "hooks",
    ),
    "ATLAS_GATES": (
        "`always` arms the orchestration gates even in scratch directories; `off` disarms them everywhere.",
        "",
        "hooks",
    ),
    "ATLAS_TYPESAFE_URL": (
        "Alternate scoring endpoint. A loopback URL scores locally with no API key.",
        "https://api.typesafe.ai",
        "hooks",
    ),
    "ATLAS_COLONY_TRANSPORT": (
        "`tmux` spawns colony workers in tmux instead of herdr.",
        "herdr",
        "shell",
    ),
    "ATLAS_STOP_BRIDGE": ("`off` disables only omp's session-end bridge.", "", "shell"),
    "ATLAS_LEAN_SHELL": ("`off` stops omp routing bash through lean-ctx.", "", "shell"),
    "ATLAS_STYLE": ("`off` stops omp injecting the atlas output style.", "", "shell"),
    "ATLAS_MUX_OMP_CONFIG": (
        "omp config file the colony reads model roles from.",
        "~/.omp/agent/config.yml",
        "shell",
    ),
    "ATLAS_MUX_OMP_EXTENSION": (
        "omp extension path passed to colony workers.",
        "",
        "shell",
    ),
    "ATLAS_PACKS_CACHE_ROOT": (
        "Where the packs git cache lives.",
        "<repo>/.atlas/.run/packs-cache",
        "shell",
    ),
    "ATLAS_PACKS_GIT_TIMEOUT": (
        "Seconds before a packs git operation is abandoned.",
        "60",
        "shell",
    ),
    "ATLAS_REMOTE_PORT": (
        "Tailnet port for remote colony access, clamped to 1024-65535.",
        "8443",
        "shell",
    ),
    "ATLAS_SELFFIX": ("`0` disables the dashboard's self-fix scheduler.", "", "shell"),
}

# Set by atlas itself, or test/isolation wiring: saving one from a settings page can only break something.
_INTERNAL = {
    "ATLAS_HARNESS",
    "ATLAS_TOOLKIT_LOAD",
    "ATLAS_NATIVE_POLICY",
    "ATLAS_WORKER_NAME",
    "ATLAS_LEAD_NAME",
    "ATLAS_PROJECT_ROOT",
    "ATLAS_CHANNEL",
    "ATLAS_SOURCE_TRANSCRIPT",
    "ATLAS_MUX",
    "ATLAS_ALLOW_TMP_INGEST",
    "ATLAS_MUX_WORKER_CMD",
    "ATLAS_CONTRACT_GATE_DIR",
    "ATLAS_REPORT_GATE_DIR",
    "ATLAS_HOOKSTATE_DIR",
    "ATLAS_DOCTOR_STATE",
    "ATLAS_PLUGINS_DIR",
    "ATLAS_OMP_PLUGINS_DIR",
    "ATLAS_CLAUDE_SETTINGS",
    "ATLAS_SKILLS_DIR",
    "ATLAS_DASHBOARD_DB",
}

_KNOBS_BY_KEY = {k["key"]: k for k in BEHAVIOR_KNOBS}

# A reader is a non-comment line naming the variable as a string literal or attribute; a bare Python
# constant that merely shares the name (ATLAS_OUTPUT_STYLE = ...) is not one. Prefer a line that touches
# the environment over a list or constant that only mentions the name.
_COMMENT_START = ("#", "//", "*", "/*")
_ENV_TOUCH = re.compile(r"environ|getenv|\benv\b|_env\w*\(|process\.env")
_SCAN_DIRS = (("hooks", "*.py"), ("scripts", "*.py"), ("omp", "*.ts"))


def _scan_env_readers() -> dict:
    """{key: {"ref": "folder/file:line", "langs": ["py","ts"]}} for every ATLAS_* the shipped code reads.

    Python (hooks, scripts) defines the key set; omp TypeScript only adds the `ts` lang to keys already found.
    """
    found: dict[str, dict] = {}
    for folder, pattern in _SCAN_DIRS:
        base = PLUGIN_ROOT / folder
        if not base.is_dir():
            continue
        lang = "ts" if pattern.endswith("ts") else "py"
        for path in sorted(base.glob(pattern)):
            name = path.name
            if (
                name.startswith("test_")
                or name.startswith("_test_")
                or ".test." in name
                or "test-isolation" in name
                or name == "atlas_control.py"
            ):
                continue
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except Exception:
                continue
            for lineno, line in enumerate(lines, 1):
                if line.lstrip().startswith(_COMMENT_START):
                    continue
                for m in _ENV_READ_RE.finditer(line):
                    key = m.group(1)
                    if not re.search(rf"[\"']{key}[\"']|\.{key}(?![A-Za-z0-9_])", line):
                        continue
                    if (
                        lang == "ts"
                        and key not in found
                        and key not in _KNOBS_BY_KEY
                        and key not in _AD
                    ):
                        continue
                    if lang == "ts" and re.search(rf"\.{key}\s*=(?!=)", line):
                        continue  # the bridge exporting it to a hook, not reading it
                    entry = found.setdefault(key, {"ref": "", "langs": [], "weak": ""})
                    ref = f"{folder}/{name}:{lineno}"
                    if lang not in entry["langs"] and _ENV_TOUCH.search(line):
                        entry["langs"].append(lang)
                    if _ENV_TOUCH.search(line):
                        entry["ref"] = entry["ref"] or ref
                    else:
                        entry["weak"] = entry["weak"] or ref
    for entry in found.values():
        entry["ref"] = entry["ref"] or entry.pop("weak")
        entry.pop("weak", None)
    return found


# Hooks reach the environment several ways -- os.environ.get, os.getenv, and
# prompt_optimizer's own _env()/_env_num() wrappers -- so match the variable name
# itself rather than one call shape. The lookbehind keeps module-local constants
# like build_hub's _ATLAS_CSS out of the environment allowlist.
_ENV_READ_RE = re.compile(r"(?<![A-Za-z0-9_])(ATLAS_[A-Z0-9_]+)")


def discovered_env_keys() -> dict:
    """Every user-facing ATLAS_* var the shipped hooks and scripts read, with its file:line.

    The curated list above is hand-written and can fall behind the code; this
    scan is what keeps the advanced table honest. Internal wiring is left out.
    """
    return {k: v["ref"] for k, v in _scan_env_readers().items() if k not in _INTERNAL}


def _settings_env() -> dict:
    env = read_settings().get("env")
    return env if isinstance(env, dict) else {}


def behavior_state() -> dict:
    """Curated knob groups plus every other ATLAS_* key the code reads.

    Every entry carries the effective value, its source (process > store >
    claude > default), each layer's raw value, the harnesses it reaches, the
    default, the reading file:line and when the store last changed it.
    `hook_value`/`hook_source` leave out the dashboard's own process env, which no
    hook sees: that is what a session will actually get from a saved setting.
    """
    claude_env = _settings_env()
    store = read_store()
    scanned = {k: v for k, v in _scan_env_readers().items() if k not in _INTERNAL}

    def detail(key, default):
        proc = os.environ.get(key)
        layers = {
            "process": proc if proc not in (None, "") else None,
            "store": store["env"].get(key),
            "claude": str(claude_env[key]) if key in claude_env else None,
        }
        value, source = default, "default"
        for name in ("process", "store", "claude"):
            if layers[name] is not None:
                value, source = layers[name], name
                break
        hook_value, hook_source = default, "default"
        for name in ("store", "claude"):
            if layers[name] is not None:
                hook_value, hook_source = layers[name], name
                break
        reaches = []
        if layers["claude"] is not None:
            reaches.append("claude")
        if layers["store"] is not None:
            reaches.append("omp")
        if layers["process"] is not None:
            reaches.append("dashboard-process")
        return {
            "value": value,
            "source": source,
            "hook_value": hook_value,
            "hook_source": hook_source,
            "layers": layers,
            "reaches": reaches,
            "default": default,
            "changed": store["changed"].get(key),
        }

    def shell_also(key):
        info = scanned.get(key) or {}
        return "ts" in (info.get("langs") or []) and "py" in (info.get("langs") or [])

    groups: dict[str, dict] = {}
    for knob in BEHAVIOR_KNOBS:
        entry = dict(knob)
        entry.update(detail(knob["key"], knob.get("default", "")))
        entry["ref"] = (scanned.get(knob["key"]) or {}).get("ref", "")
        entry["shell_also"] = shell_also(knob["key"])
        g = groups.setdefault(
            knob["group"],
            {
                "id": knob["group"],
                "title": knob["group"],
                "intro": GROUP_INTROS.get(knob["group"], ""),
                "knobs": [],
            },
        )
        g["knobs"].append(entry)

    advanced = []
    seen = set(_KNOBS_BY_KEY)
    for key, info in sorted(scanned.items()):
        if key in seen:
            continue
        doc = _AD.get(key)
        advanced.append(
            {
                "key": key,
                "ref": info["ref"],
                "title": key,
                "description": doc[0]
                if doc
                else "Undocumented: nothing here says what it does. The reading line is shown under Details.",
                "documented": bool(doc),
                "scope": doc[2] if doc else "shell",
                "kind": "text",
                "shell_also": shell_also(key),
                **detail(key, doc[1] if doc else ""),
            }
        )
        seen.add(key)
    # Keys set somewhere that no shipped file reads: still show them, so a stale value can be cleared.
    for key in sorted(set(claude_env) | set(store["env"])):
        if key.startswith("ATLAS_") and key not in seen and key not in _INTERNAL:
            advanced.append(
                {
                    "key": key,
                    "ref": "",
                    "title": key,
                    "documented": False,
                    "scope": "hooks",
                    "kind": "text",
                    "shell_also": False,
                    "description": "Saved, but no shipped file reads it. Clear it.",
                    "unread": True,
                    **detail(key, ""),
                }
            )

    return {
        "groups": list(groups.values()),
        "advanced": advanced,
        "settings_path": str(SETTINGS_PATH),
        "store_path": str(store_path()),
        "omp": omp_model_roles(),
        "note": "A change is saved to the atlas store (read by omp's bridged hooks on their next run) and to Claude Code settings.json env (read when a Claude Code session starts).",
    }


def write_behavior_updates(updates: dict) -> dict:
    """Write ATLAS_* knobs to the atlas store and Claude settings env. Empty removes."""
    if not isinstance(updates, dict) or not updates:
        return {"ok": False, "error": "updates_required"}
    settable = {k["key"] for k in BEHAVIOR_KNOBS if k["scope"] == "hooks"} | {
        k for k in discovered_env_keys() if _AD.get(k, ("", "", "shell"))[2] == "hooks"
    }
    # A value saved earlier for a key that is no longer settable (or no longer read) can still be cleared.
    clearable = settable | set(_settings_env()) | set(read_store()["env"])
    cleaned: dict[str, str] = {}
    removed: list[str] = []
    bad: list[str] = []
    for key, raw in updates.items():
        key = str(key or "").strip()
        if not ENV_KEY_RE.match(key) or key not in clearable:
            bad.append(key)
            continue
        value = "" if raw is None else str(raw)
        value = value.replace("\n", "").replace("\r", "").strip()
        if len(value) > MAX_VALUE_LEN:
            return {
                "ok": False,
                "error": "value_too_long",
                "keys": [key],
                "hint": f"Values are limited to {MAX_VALUE_LEN} characters.",
            }
        if value == "":
            removed.append(key)
        elif key not in settable:
            bad.append(key)
        else:
            cleaned[key] = value
    if bad:
        return {
            "ok": False,
            "error": "keys_not_allowlisted",
            "keys": bad,
            "hint": "Only ATLAS_* variables a shipped hook reads can be saved here. Variables read by omp or atlas CLIs come from the shell that starts them.",
        }

    store = read_store()
    now = time.time()
    store["env"].update(cleaned)
    for key in cleaned:
        store["changed"][key] = now
    for key in removed:
        store["env"].pop(key, None)
        store["changed"].pop(key, None)
    _write_store(store["env"], store["changed"])

    def apply(data):
        env = data.get("env")
        if not isinstance(env, dict):
            env = {}
            data["env"] = env
        env.update(cleaned)
        for key in removed:
            env.pop(key, None)

    mutate_settings(apply)
    return {
        "ok": True,
        "set": sorted(cleaned),
        "cleared": sorted(removed),
        "settings_path": str(SETTINGS_PATH),
        "store_path": str(store_path()),
        "note": "Saved. Reload the Claude Code or omp session so hooks pick up the new environment.",
    }


# --- MCP servers --------------------------------------------------------------
#
# Claude Code disables a server by listing its name in settings.disabledMcpServers.
# A plugin-provided server is named "plugin:<plugin>:<server>"; a user server from
# ~/.claude.json is named by its own key.


def _disabled_servers() -> list:
    v = read_settings().get("disabledMcpServers")
    return [str(x) for x in v] if isinstance(v, list) else []


def _plugin_mcp_servers(plugin_dir: Path, plugin_name: str) -> list:
    """Servers declared by one plugin, as (qualified_name, bare_name, cfg)."""
    manifest = _read_json(plugin_dir / ".claude-plugin" / "plugin.json")
    ref = manifest.get("mcpServers")
    servers = {}
    if isinstance(ref, str):
        # The manifest points at a sibling file, usually "./.mcp.json". Strip the
        # "./" as a prefix -- lstrip() would eat the leading dot of ".mcp.json".
        rel = ref[2:] if ref.startswith("./") else ref
        servers = (_read_json(plugin_dir / rel) or {}).get("mcpServers") or {}
    elif isinstance(ref, dict):
        servers = ref
    elif (plugin_dir / ".mcp.json").is_file():
        servers = _read_json(plugin_dir / ".mcp.json").get("mcpServers") or {}
    out = []
    for bare, cfg in (servers or {}).items():
        out.append(
            (f"plugin:{plugin_name}:{bare}", bare, cfg if isinstance(cfg, dict) else {})
        )
    return out


def mcp_inventory() -> dict:
    """Every MCP server this install can see, with its enabled state and origin."""
    disabled = set(_disabled_servers())
    rows = []

    for name, cfg in (_read_json(CLAUDE_JSON_PATH).get("mcpServers") or {}).items():
        cfg = cfg if isinstance(cfg, dict) else {}
        rows.append(
            {
                "name": name,
                "bare_name": name,
                "origin": "user",
                "origin_detail": str(CLAUDE_JSON_PATH),
                "transport": cfg.get("type") or ("http" if cfg.get("url") else "stdio"),
                "command": cfg.get("command") or cfg.get("url") or "",
                "enabled": name not in disabled,
                "env_keys": sorted((cfg.get("env") or {}).keys()),
                "removable": True,
            }
        )

    for plugin in installed_plugins():
        pdir = Path(plugin["path"]) if plugin.get("path") else None
        if not pdir or not pdir.is_dir():
            continue
        for qualified, bare, cfg in _plugin_mcp_servers(pdir, plugin["name"]):
            rows.append(
                {
                    "name": qualified,
                    "bare_name": bare,
                    "origin": "plugin",
                    "origin_detail": plugin["key"],
                    "transport": cfg.get("type")
                    or ("http" if cfg.get("url") else "stdio"),
                    "command": cfg.get("command") or cfg.get("url") or "",
                    "enabled": plugin["enabled"] and qualified not in disabled,
                    "plugin_enabled": plugin["enabled"],
                    "env_keys": sorted((cfg.get("env") or {}).keys()),
                    "removable": False,
                }
            )

    rows.sort(key=lambda r: (r["origin"] != "plugin", r["name"]))
    return {"servers": rows, "disabled": sorted(disabled)}


def set_mcp_enabled(name: str, enabled: bool) -> dict:
    name = str(name or "").strip()
    if not name:
        return {"ok": False, "error": "name_required"}
    known = {r["name"] for r in mcp_inventory()["servers"]}
    if name not in known:
        return {"ok": False, "error": "unknown_server", "name": name}

    def apply(data):
        current = data.get("disabledMcpServers")
        current = [str(x) for x in current] if isinstance(current, list) else []
        if enabled:
            current = [x for x in current if x != name]
        elif name not in current:
            current.append(name)
        # Drop the key entirely when nothing is disabled, rather than leaving an
        # empty array behind in the user's settings.
        if current:
            data["disabledMcpServers"] = sorted(current)
        else:
            data.pop("disabledMcpServers", None)

    mutate_settings(apply)
    return {
        "ok": True,
        "name": name,
        "enabled": bool(enabled),
        "note": "Saved to settings.json disabledMcpServers. Reload Claude Code to apply.",
    }


def add_mcp_server(spec: dict) -> dict:
    """Add a user-scope stdio or http MCP server to ~/.claude.json."""
    name = str((spec or {}).get("name") or "").strip()
    if not MCP_NAME_RE.match(name):
        return {
            "ok": False,
            "error": "invalid_name",
            "hint": "Letters, digits, dot, dash, underscore; 1-64 chars.",
        }
    url = str(spec.get("url") or "").strip()
    command = str(spec.get("command") or "").strip()
    if not url and not command:
        return {"ok": False, "error": "command_or_url_required"}
    if url and not url.startswith(("http://", "https://")):
        return {"ok": False, "error": "invalid_url"}

    args = spec.get("args")
    if isinstance(args, str):
        import shlex

        args = shlex.split(args)
    args = [str(a) for a in (args or [])]

    env = spec.get("env")
    env = {str(k): str(v) for k, v in env.items()} if isinstance(env, dict) else {}

    cfg: dict = (
        {"type": "http", "url": url} if url else {"command": command, "args": args}
    )
    if env:
        cfg["env"] = env

    data = _read_json(CLAUDE_JSON_PATH)
    servers = data.get("mcpServers")
    if not isinstance(servers, dict):
        servers = {}
        data["mcpServers"] = servers
    existed = name in servers
    servers[name] = cfg
    _write_json(CLAUDE_JSON_PATH, data)
    return {
        "ok": True,
        "name": name,
        "replaced": existed,
        "path": str(CLAUDE_JSON_PATH),
        "note": "Saved to ~/.claude.json. Reload Claude Code to connect.",
    }


def remove_mcp_server(name: str) -> dict:
    name = str(name or "").strip()
    data = _read_json(CLAUDE_JSON_PATH)
    servers = data.get("mcpServers")
    if not isinstance(servers, dict) or name not in servers:
        return {"ok": False, "error": "unknown_user_server", "name": name}
    servers.pop(name)
    _write_json(CLAUDE_JSON_PATH, data)
    return {"ok": True, "name": name, "path": str(CLAUDE_JSON_PATH)}


# --- plugins, skills, agents, hooks ------------------------------------------


def _count_dir(path: Path, suffixes=(".md",)) -> int:
    if not path.is_dir():
        return 0
    n = 0
    for entry in path.iterdir():
        if entry.is_dir() and (entry / "SKILL.md").is_file():
            n += 1
        elif entry.is_file() and entry.suffix in suffixes:
            n += 1
    return n


def _plugin_search_paths() -> dict:
    """Map plugin key -> on-disk root, from installed_plugins.json and marketplaces."""
    roots: dict[str, Path] = {}
    installed = _read_json(PLUGINS_DIR / "installed_plugins.json").get("plugins") or {}
    for key, entries in installed.items():
        if not isinstance(entries, list):
            continue
        for entry in entries:
            path = Path(str((entry or {}).get("installPath") or ""))
            if path.is_dir():
                roots[key] = path
                break
    # Marketplace checkouts host the source copy; use them when no install cache exists.
    market = PLUGINS_DIR / "marketplaces"
    if market.is_dir():
        for repo in market.iterdir():
            if not repo.is_dir():
                continue
            for candidate in list(
                repo.glob("plugins/*/.claude-plugin/plugin.json")
            ) + list(repo.glob(".claude-plugin/plugin.json")):
                pdir = candidate.parent.parent
                name = (_read_json(candidate).get("name") or pdir.name).strip()
                roots.setdefault(f"{name}@{repo.name}", pdir)
    return roots


def installed_plugins() -> list:
    """Installed plugins with enabled state and a content census."""
    enabled_map = read_settings().get("enabledPlugins") or {}
    roots = _plugin_search_paths()
    keys = sorted(set(roots) | set(k for k in enabled_map if isinstance(k, str)))
    out = []
    for key in keys:
        name, _, marketplace = key.partition("@")
        pdir = roots.get(key)
        manifest = _read_json(pdir / ".claude-plugin" / "plugin.json") if pdir else {}
        servers = _plugin_mcp_servers(pdir, name) if pdir else []
        out.append(
            {
                "key": key,
                "name": manifest.get("name") or name,
                "marketplace": marketplace or "",
                "version": manifest.get("version") or "",
                "description": (manifest.get("description") or "")[:400],
                "path": str(pdir) if pdir else "",
                "installed": bool(pdir),
                "enabled": bool(enabled_map.get(key)),
                "skills": _count_dir(pdir / "skills") if pdir else 0,
                "agents": _count_dir(pdir / "agents") if pdir else 0,
                "commands": _count_dir(pdir / "commands") if pdir else 0,
                "output_styles": _count_dir(pdir / "output-styles") if pdir else 0,
                "hooks": 1 if pdir and (pdir / "hooks" / "hooks.json").is_file() else 0,
                "mcp_servers": [qualified for qualified, _bare, _cfg in servers],
            }
        )
    out.sort(key=lambda p: (not p["enabled"], p["key"]))
    return out


def set_plugin_enabled(key: str, enabled: bool) -> dict:
    key = str(key or "").strip()
    known = {p["key"] for p in installed_plugins()}
    if key not in known:
        return {"ok": False, "error": "unknown_plugin", "key": key}
    if key.startswith("atlas@") and not enabled:
        return {
            "ok": False,
            "error": "cannot_disable_host_plugin",
            "hint": "Atlas serves this page. Disable it with `claude plugin disable atlas` from a terminal.",
        }

    def apply(data):
        plugins = data.get("enabledPlugins")
        if not isinstance(plugins, dict):
            plugins = {}
            data["enabledPlugins"] = plugins
        plugins[key] = bool(enabled)

    mutate_settings(apply)
    return {
        "ok": True,
        "key": key,
        "enabled": bool(enabled),
        "note": "Saved. Reload Claude Code to apply.",
    }


def _list_names(path: Path, suffixes=(".md",)) -> list:
    if not path.is_dir():
        return []
    names = []
    for entry in sorted(path.iterdir()):
        if entry.name.startswith("."):
            continue
        if entry.is_dir() and (entry / "SKILL.md").is_file():
            names.append(entry.name)
        elif entry.is_file() and entry.suffix in suffixes:
            names.append(entry.stem.replace(".agent", ""))
    return names


def atlas_wiring() -> dict:
    """What atlas ships versus what is actually wired into this install."""
    hooks_json = _read_json(PLUGIN_ROOT / "hooks" / "hooks.json").get("hooks") or {}
    bindings = []
    for event, blocks in hooks_json.items():
        for block in blocks if isinstance(blocks, list) else []:
            for hook in (block or {}).get("hooks") or []:
                command = str(hook.get("command") or "")
                m = re.search(r"/(hooks|scripts)/([A-Za-z0-9_]+\.py)", command)
                script = f"{m.group(1)}/{m.group(2)}" if m else command[:80]
                bindings.append(
                    {
                        "event": event,
                        "matcher": (block or {}).get("matcher") or "*",
                        "script": script,
                        "present": (PLUGIN_ROOT / script).is_file() if m else False,
                        "timeout": hook.get("timeout"),
                    }
                )
    settings = read_settings()
    return {
        "plugin_enabled": bool(
            (settings.get("enabledPlugins") or {}).get("atlas@tech-tools")
        ),
        "hooks_disabled_globally": bool(settings.get("disableAllHooks")),
        "output_style": settings.get("outputStyle") or "",
        "bindings": bindings,
        "skills": _list_names(PLUGIN_ROOT / "skills"),
        "agents": _list_names(PLUGIN_ROOT / "agents"),
        "output_styles": _list_names(PLUGIN_ROOT / "output-styles"),
        "plugin_root": str(PLUGIN_ROOT),
    }


def ecosystem_inventory() -> dict:
    settings = read_settings()
    user_hooks = settings.get("hooks") or {}
    return {
        "plugins": installed_plugins(),
        "mcp": mcp_inventory(),
        "atlas": atlas_wiring(),
        "user": {
            "skills": _list_names(CLAUDE_DIR / "skills"),
            "agents": _list_names(CLAUDE_DIR / "agents"),
            "commands": _list_names(CLAUDE_DIR / "commands"),
            "output_styles": _list_names(CLAUDE_DIR / "output-styles"),
            "hook_events": sorted(user_hooks.keys())
            if isinstance(user_hooks, dict)
            else [],
            "active_output_style": settings.get("outputStyle") or "default",
        },
        "settings_path": str(SETTINGS_PATH),
        "claude_json_path": str(CLAUDE_JSON_PATH),
    }


# --- connector connection test ------------------------------------------------


def _rpc_line(obj) -> bytes:
    return (json.dumps(obj) + "\n").encode("utf-8")


def _mcp_server_spec(name: str) -> dict:
    servers = _read_json(PLUGIN_ROOT / ".mcp.json").get("mcpServers") or {}
    spec = servers.get(name)
    return spec if isinstance(spec, dict) else {}


def _subst_root(value: str) -> str:
    return value.replace("${CLAUDE_PLUGIN_ROOT}", str(PLUGIN_ROOT))


def connector_entry(name: str) -> tuple[Path, list[str] | None]:
    """Resolve a connector's entry point and the exact argv .mcp.json launches.

    The argv comes from .mcp.json (with ${CLAUDE_PLUGIN_ROOT} substituted), so a
    test can never drift from how the plugin really starts the server: node
    bundles go through ``--import mcp/_env/load.mjs`` and python connectors
    through uv + load.py, which is what promotes CFG_* values.
    """
    node_bundle = PLUGIN_ROOT / "mcp" / name / "server.mjs"
    spec = _mcp_server_spec(name)
    if node_bundle.is_file():
        entry = node_bundle
    elif (PLUGIN_ROOT / "mcp" / name / "pyproject.toml").is_file():
        entry = PLUGIN_ROOT / "mcp" / name / "pyproject.toml"
    else:
        return node_bundle, None
    if not spec.get("command"):
        return entry, None
    argv = [spec["command"]] + [_subst_root(str(a)) for a in spec.get("args") or []]
    return entry, argv


def _connector_launch_env(name: str, env: dict | None) -> dict:
    """Process env for a connector test: .mcp.json's literal env, then the caller's."""
    proc_env = dict(os.environ)
    for k, v in (_mcp_server_spec(name).get("env") or {}).items():
        if isinstance(v, str) and "${user_config." not in v:
            proc_env[k] = _subst_root(v)
    proc_env["MCP_TRANSPORT"] = "stdio"
    proc_env.update({str(k): str(v) for k, v in (env or {}).items()})
    project = PLUGIN_ROOT / "mcp" / name
    # An already-synced uv project must not trigger a network sync from a button click.
    if (project / ".venv").is_dir() or os.environ.get("UV_PROJECT_ENVIRONMENT"):
        proc_env.setdefault("UV_NO_SYNC", "1")
    return proc_env


# What each vendor's <vendor>_status tool prints when it has no usable credentials.
_UNCONFIGURED = re.compile(
    r"NOT CONFIGURED|\"configured\":\s*false|\"hasCredentials\":\s*false|MISSING_CREDENTIALS"
)
_STATUS_TOOL = {"connectwise": "cw_status"}


def test_connector(name: str, env: dict | None = None, timeout: float = 20.0) -> dict:
    """Start the connector exactly as .mcp.json does, handshake, then ask it for its status.

    ``ok`` means the server booted AND reports credentials present. Unconfigured
    returns ``ok: False, error: "not_configured"`` with the status text naming the
    missing variables. Whether the vendor accepts the credentials is whatever the
    connector's own status tool says (shown in ``status``); this does not
    pretend to prove more than that.
    """
    name = str(name or "").strip()
    if not re.match(r"^[a-z0-9_-]+$", name):
        return {"ok": False, "error": "invalid_name"}
    entry, argv = connector_entry(name)
    if argv is None:
        return {"ok": False, "error": "bundle_missing", "path": str(entry)}

    started = time.time()
    try:
        proc = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=_connector_launch_env(name, env),
            cwd=str(PLUGIN_ROOT),
        )
    except FileNotFoundError:
        return {
            "ok": False,
            "error": f"{argv[0]}_not_found",
            "hint": f"Install {argv[0]} to run this connector.",
        }

    status_tool = _STATUS_TOOL.get(name, f"{name}_status")
    payload = b"".join(
        [
            _rpc_line(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "atlas-dashboard", "version": "1.0"},
                    },
                }
            ),
            _rpc_line({"jsonrpc": "2.0", "method": "notifications/initialized"}),
            _rpc_line(
                {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}
            ),
            _rpc_line(
                {
                    "jsonrpc": "2.0",
                    "id": 3,
                    "method": "tools/call",
                    "params": {"name": status_tool, "arguments": {}},
                }
            ),
        ]
    )
    # communicate() would close stdin right after the writes and some servers exit
    # on EOF before answering the status call, so read until id 3 arrives instead.
    lines: queue.Queue = queue.Queue()

    def _pump():
        for raw in proc.stdout:
            lines.put(raw)
        lines.put(None)

    threading.Thread(target=_pump, daemon=True).start()
    err_chunks: list = []
    threading.Thread(
        target=lambda: err_chunks.append(proc.stderr.read()), daemon=True
    ).start()
    server_info: dict = {}
    tools: list = []
    status_text = None
    deadline = time.time() + timeout
    timed_out = False
    try:
        proc.stdin.write(payload)
        proc.stdin.flush()
        while status_text is None:
            try:
                raw = lines.get(timeout=max(0.05, deadline - time.time()))
            except queue.Empty:
                timed_out = True
                break
            if raw is None:
                break
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("{"):
                continue
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            result = msg.get("result") or {}
            if msg.get("id") == 1:
                server_info = result.get("serverInfo") or {}
            elif msg.get("id") == 2:
                tools = result.get("tools") or []
            elif msg.get("id") == 3:
                parts = [
                    c.get("text", "")
                    for c in result.get("content") or []
                    if isinstance(c, dict)
                ]
                status_text = "\n".join(parts) or (msg.get("error") or {}).get(
                    "message", ""
                )
            if deadline <= time.time():
                timed_out = True
                break
    except BrokenPipeError:
        pass
    finally:
        proc.kill()
        proc.wait()
    stderr_tail = (b"".join(err_chunks)).decode("utf-8", "replace")[-600:]

    if timed_out and not server_info and not tools:
        return {
            "ok": False,
            "error": "timeout",
            "seconds": timeout,
            "stderr": stderr_tail,
        }
    if not server_info and not tools:
        return {
            "ok": False,
            "error": "no_handshake",
            "exit_code": proc.returncode,
            "stderr": stderr_tail,
        }
    configured = None if status_text is None else not _UNCONFIGURED.search(status_text)
    res = {
        "ok": configured is not False,
        "name": name,
        "server": server_info.get("name") or name,
        "version": server_info.get("version") or "",
        "tool_count": len(tools),
        "tools": [t.get("name") for t in tools[:12] if isinstance(t, dict)],
        "configured": configured,
        "status": (status_text or "")[:800],
        "elapsed_ms": int((time.time() - started) * 1000),
    }
    if configured is False:
        res["error"] = "not_configured"
        res["note"] = (
            "The server started but reports no usable credentials; "
            "the status text names the missing variables."
        )
    elif configured is None:
        res["note"] = (
            "The server started and listed its tools but did not answer its status tool."
        )
    else:
        res["note"] = (
            "The server started with these credentials and reports them present."
        )
    return res


# --- project fixtures (shared by the Agents editor and the Projects page) -----

_JUNK_PARTS = {"node_modules", "worktrees", "local-agent-mode-sessions", ".run"}
_JUNK_SUBSTRINGS = (
    "/.cache/",
    "/atlas-work/",
    "/atlas-demo/",
    "/T/atlas-",
    "/tmp/probe",
    "/atlas-e2e",  # manual lead/worker e2e repos (~/atlas-e2e-colony*), left in place on purpose
)
_JUNK_BASENAMES = {"repo", "demo", "wt", "stage", "outputs", "tmp", "T"}


def is_fixture_project(root, must_exist: bool = True) -> bool:
    """True for roots that are test fixtures, scratch dirs, or (optionally) gone.

    Covers the filesystem root and home, atlas demo/probe scratch dirs, throwaway
    worktrees, tmp dirs and agent-mode output folders. ``must_exist`` also rejects
    paths that are not directories: right for the agent editor (it writes into the
    project) and wrong for history views, which keep projects deleted since.
    """
    if not root:
        return True
    p = os.path.normpath(str(root))
    if p in (os.sep, os.path.expanduser("~")) or (must_exist and not os.path.isdir(p)):
        return True
    if _JUNK_PARTS & set(Path(p).parts):
        return True
    if any(m in p + "/" for m in _JUNK_SUBSTRINGS):
        return True
    if p.startswith(("/private/tmp", "/private/var/folders", "/tmp", "/var/folders")):
        return True
    return os.path.basename(p) in _JUNK_BASENAMES and "/Projects/" not in p


_CONNECTOR_USAGE_SQL = (
    "SELECT server, COUNT(*), SUM(CASE WHEN ts>=? THEN 1 ELSE 0 END), "
    "SUM(CASE WHEN ts>=? AND COALESCE(is_error,0)=1 THEN 1 ELSE 0 END), MAX(ts) "
    "FROM tool_calls WHERE kind='mcp' AND server IS NOT NULL AND server<>'' "
    "GROUP BY server"
)
# Same aggregate minus calls a hook refused (denied=1): policy, not connector failure.
_CONNECTOR_USAGE_SQL_DENIED = _CONNECTOR_USAGE_SQL.replace(
    "AND server<>'' ", "AND server<>'' AND COALESCE(denied,0)=0 "
)


# --- connector usage + health (one definition for Settings and Health) --------

# Older sessions logged some connectors under their former server names.
CONNECTOR_ALIASES = {"falcon-mcp": "falcon", "falcon_mcp": "falcon"}
# A connector with this many calls and at least this error share is degraded.
CONNECTOR_MIN_CALLS = 10
CONNECTOR_ERROR_RATE = 0.25
CONNECTOR_USAGE_WINDOW_S = 30 * 86400


def connector_usage(conn, since_s: float = CONNECTOR_USAGE_WINDOW_S, now=None) -> dict:
    """Per-connector call stats from tool_calls: {name: calls, errors, error_rate, last_used}.

    Calls the hooks refused (``denied=1``, when that column exists) are policy, not
    connector failures, so they count neither as calls nor as errors. ``last_used``
    is the newest call ever seen (epoch seconds); the counts cover ``since_s``.
    """
    out: dict = {}
    if conn is None:
        return out
    now = time.time() if now is None else now
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(tool_calls)")}
        if not {"server", "ts", "is_error"} <= cols:
            return out
        sql = _CONNECTOR_USAGE_SQL_DENIED if "denied" in cols else _CONNECTOR_USAGE_SQL
        rows = conn.execute(sql, (now - since_s, now - since_s)).fetchall()
    except Exception:
        return out
    for server, total, recent, errors, last in rows:
        name = CONNECTOR_ALIASES.get(server, server)
        agg = out.setdefault(
            name, {"calls_total": 0, "calls": 0, "errors": 0, "last_used": None}
        )
        agg["calls_total"] += int(total or 0)
        agg["calls"] += int(recent or 0)
        agg["errors"] += int(errors or 0)
        if last and (agg["last_used"] is None or last > agg["last_used"]):
            agg["last_used"] = float(last)
    for agg in out.values():
        agg["error_rate"] = (
            round(agg["errors"] / agg["calls"], 3) if agg["calls"] else 0.0
        )
    return out


def connector_health(configured: bool, enabled: bool, usage: dict | None) -> str:
    """unconfigured | disabled | degraded | ok | idle -- shared by Settings and Health."""
    if not enabled:
        return "disabled"
    if not configured:
        return "unconfigured"
    u = usage or {}
    if (
        u.get("calls", 0) >= CONNECTOR_MIN_CALLS
        and u.get("error_rate", 0.0) >= CONNECTOR_ERROR_RATE
    ):
        return "degraded"
    return "ok" if u.get("calls", 0) else "idle"


# --- omp (oh-my-pi) model roles, read-only ------------------------------------

OMP_CONFIG_PATH = Path.home() / ".omp" / "agent" / "config.yml"
OMP_ROLES = ("atlas-worker", "atlas-verifier", "atlas-mechanic", "default", "smol")


def _yaml_block(text: str, key: str) -> dict:
    """Flat ``name: value`` pairs under a top-level ``key:`` (stdlib; no PyYAML)."""
    out: dict = {}
    inside = False
    for raw in text.splitlines():
        if not inside:
            inside = raw.rstrip() == f"{key}:"
            continue
        if raw.strip() == "" or raw.lstrip().startswith("#"):
            continue
        if not raw.startswith((" ", "\t")):
            break
        name, sep, value = raw.strip().partition(":")
        if sep and value.strip():
            out[name.strip()] = value.strip().strip("\"'")
    return out


def omp_model_roles(path: Path | None = None) -> dict:
    """The omp roles atlas depends on and whether each resolves to a model.

    Atlas's omp agents name ``@atlas-worker`` / ``@atlas-verifier`` /
    ``@atlas-mechanic`` first and fall back to ``@default`` / ``@smol``; a role
    missing from ``modelRoles`` means that agent falls through to its fallback.
    """
    path = path or OMP_CONFIG_PATH
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return {"path": str(path), "exists": False, "roles": [], "other": []}
    roles_cfg = _yaml_block(text, "modelRoles")
    roles = []
    for role in OMP_ROLES:
        model = roles_cfg.get(role, "")
        fallback = None
        if not model and role.startswith("atlas-"):
            fallback = "default" if role == "atlas-verifier" else "smol"
            if not roles_cfg.get(fallback):
                fallback = None
        roles.append(
            {
                "role": role,
                "model": model,
                "resolves": bool(model),
                "falls_back_to": fallback,
                "fallback_model": roles_cfg.get(fallback, "") if fallback else "",
            }
        )
    other = [
        {"role": r, "model": m} for r, m in roles_cfg.items() if r not in OMP_ROLES
    ]
    return {"path": str(path), "exists": True, "roles": roles, "other": other}


# --- bulk env import / export -------------------------------------------------

ENV_LINE_RE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$")


def parse_env_block(text: str) -> dict:
    """Parse pasted KEY=VALUE lines. Ignores comments, blanks and export prefixes."""
    updates: dict[str, str] = {}
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = ENV_LINE_RE.match(line)
        if not m:
            continue
        value = m.group(2).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if value:
            updates[m.group(1)] = value
    return updates


def env_export(connectors: list, redact: bool = True) -> str:
    """A .env template grouped by connector. Secrets are redacted by default."""
    lines = [
        "# Atlas connector credentials",
        "# Generated by the Atlas dashboard. Fill in the blanks and paste it back",
        "# into Connectors > Bulk import, or drop it at plugins/atlas/.env",
        "",
    ]
    for connector in connectors or []:
        lines.append(f"# --- {connector.get('name', '?')} ---")
        for field in connector.get("fields") or []:
            key = field.get("env_key") or (field.get("user_config_key") or "").upper()
            if not key:
                continue
            if field.get("sensitive"):
                # The marker goes on its own comment line: an inline "# set" would
                # be parsed back as the secret's value on re-import.
                if field.get("is_set"):
                    lines.append(f"# {key} is already set; fill in only to replace it")
                lines.append(f"{key}={'' if redact else str(field.get('value') or '')}")
            else:
                lines.append(f"{key}={field.get('value') or ''}")
        lines.append("")
    return "\n".join(lines)


def main(argv=None):
    """Small CLI so the control plane is inspectable without the web UI."""
    argv = list(sys.argv[1:] if argv is None else argv)
    cmd = argv[0] if argv else "behavior"
    if cmd == "behavior":
        payload = behavior_state()
    elif cmd == "ecosystem":
        payload = ecosystem_inventory()
    elif cmd == "test" and len(argv) > 1:
        payload = test_connector(argv[1])
    else:
        sys.stderr.write(
            "usage: atlas_control.py [behavior|ecosystem|test <connector>]\n"
        )
        return 2
    json.dump(payload, sys.stdout, indent=2, default=str)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
