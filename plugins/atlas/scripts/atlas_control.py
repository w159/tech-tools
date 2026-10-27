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
import logging
import os
import queue
import re
import shlex
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
PLUGIN_ROOT = SCRIPTS_DIR.parent
sys.path.insert(0, str(SCRIPTS_DIR))
import armada_root  # noqa: E402

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

# Every knob is saved to the atlas store (read by every hook on each run) and to Claude Code settings.json env.
# Knobs read straight from the environment of a process atlas does not start (omp extension, an atlas CLI)
# keep an internal scope of "shell", which also writes omp's config.yml env and ~/.atlas/env.sh. The API
# reports scope "hooks" for all of them. Group order here is the display order.
GROUP_INTROS = {
    "Session automation": "Things atlas does by itself when a session starts or ends, and housekeeping around them.",
    "Guardrails": "Checks that block or nudge a session that skips delegation or evidence. Turning these off removes protection.",
    "Colony": "How multi-worker runs start, talk and are cleaned up: transport, channels, seats and worktree checks.",
    "omp extension": "Read by the omp extension and its bridged hooks. Saved values also go to omp's config and ~/.atlas/env.sh.",
    "Prompt optimizer": "Rewrites your prompt with a local Ollama model before the agent sees it. By default it only runs when the prompt starts with a trigger prefix such as `opt:`.",
    "Decision model": "A local model that classifies each prompt so atlas can decide whether to arm orchestration.",
    "Turn scoring": "Optional model scoring of finished replies. Nothing is sent unless TYPESAFE_API_KEY (or a loopback ATLAS_TYPESAFE_URL) is set.",
}
SAVE_NOTE = "Saved values reach running sessions on their next hook run."
KIND_SET = {"toggle", "select", "number", "model", "url", "command", "text"}


def _norm_options(options):
    """Options as [{value, label, hint}]; a bare string is its own label."""
    out = []
    for o in options or []:
        if isinstance(o, dict):
            out.append(
                {"value": o["value"], "label": o.get("label", o["value"]), "hint": o.get("hint", "")}
            )
        else:
            out.append({"value": o, "label": o, "hint": ""})
    return out


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
    if kind == "choice":
        kind = "select"
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
            **({"options": _norm_options(options)} if options else {}),
        }
    )


_SA, _GR, _COL, _OMP, _PO, _DM, _TS = tuple(GROUP_INTROS)
_k(
    "ATLAS_DASHBOARD",
    _SA,
    "Start the Command Center automatically",
    "When on, each new session launches this dashboard if it is not already running.",
    default="off",
    details="Off (the default) means the dashboard starts only when you run it yourself (`atlas_dashboard.py ensure` or `serve`). On launches it at every session start. Sessions in scratch or temp directories never start the shared dashboard either way.",
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
    default="on",
    details="Off removes atlas's main evidence guarantee and also disables the worker report gate. Unset also means on.",
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
    default="on",
    scope="shell",
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
    default="on",
    scope="shell",
)
# --- knobs added from the discovered ATLAS_* readers; each `details` names the line that reads it ---
# Session automation
_k("ATLAS_TODO", _SA, "Mirror session todos to the board", "Copy the session's todo list onto the atlas board.", default="on", details="Off stops the copy. Read at hooks/session_boot_core.py:1097.")
_k("ATLAS_DOCS_REPAIR", _SA, "Check for a missing docs/ tree", "At session start, notice a project that has no docs/ tree.", default="on", details="Off skips the check and its notice. Read at hooks/session_boot_core.py:1146.")
_k("ATLAS_HERDR_AUTOSTART", _SA, "Start the herdr server at session start", "Start the herdr server when a session begins and none is running.", default="on", details="Off, 0, false or no leaves it stopped. Read at hooks/session_boot_core.py:178.")
_k("ATLAS_DOCTOR_HOOK_TTL_MIN", _SA, "Doctor hook recheck (minutes)", "Minutes a healthy atlas-doctor result is trusted before the session-start hook runs it again. 0 reruns every time.", "number", "30", scope="shell", details="Read at scripts/atlas_doctor.py:55; default HOOK_TTL_MIN_DEFAULT = 30.")
_k("ATLAS_SELFFIX", _SA, "Dashboard self-fix scheduler", "Let the dashboard schedule its own self-fix runs.", default="1", on="1", off="0", scope="shell", details="Only the exact value 0 disables it. Read at scripts/atlas_selffix.py:768.")

# Guardrails
_k("ATLAS_MANDATES", _GR, "Recall and commit reminders", "Remind the session to recall prior work and nudge once before a git commit.", default="on", details="Off silences both. Read at hooks/bash_advisor.py:283.")
_k("ATLAS_GATE_HEADER", _GR, "Gate: ATLAS header line", "Require a final reply to start with the ATLAS status header line.", default="on", details="Off skips that one completion-gate check. Read at hooks/completion_gate_core.py:2010.")
_k("ATLAS_GATE_PHASES", _GR, "Gate: required todo phases", "After code shipped, require the board to cover the required todo phases.", default="on", details="Off skips that one completion-gate check. Read at hooks/completion_gate_core.py:2011.")
_k("ATLAS_GATE_REPORT", _GR, "Gate: worker report container", "Block a worker's final message when it is not the fixed report container.", default="on", details="Read at hooks/worker_report_gate_core.py:324.")
_k("ATLAS_WT_GATE", _GR, "Gate: unmerged worker branches", "Block completion while worker/* branches have unmerged commits or a dirty worktree.", default="on", details="Off, 0 or false disables it; it fails open. Read at hooks/completion_gate_core.py:838.")
_k("ATLAS_GATE_BLOCK_LOOP", _GR, "Gate: repeat-block limit", "How many identical consecutive blocks the completion gate issues before it lets the Stop through. Clamped to 1-7.", "number", "3", details="Keeps the gate's own breaker below Claude Code's 8-block Stop cap. Read at hooks/completion_gate_core.py:1579.")
_k("ATLAS_MODE", _GR, "Solo mode", "Treat the session as solo work: the delegation requirement is relaxed.", default="", on="solo", off="", details="Only the value solo has an effect. Read at hooks/completion_gate_core.py:324.")
_k("ATLAS_GATES", _GR, "When the gates arm", "auto arms the orchestration gates in real projects only, always arms them in scratch directories too, off disarms them everywhere.", "select", "auto", options=["auto", "always", "off"], details="Any value other than always or off behaves as auto. Read at scripts/atlas_scope.py:70.")
_k("ATLAS_FOOTPRINT_FILES", _GR, "Inline footprint (files)", "Distinct code files an unflagged run may touch before the tripwire treats it as orchestration. 0 disables.", "number", "3", details="Read at hooks/dispatch_tripwire_core.py:1611.")
_k("ATLAS_AUTONAME", _GR, "Name unnamed dispatches", "Give a subagent dispatch that has no name one, instead of denying it.", default="on", details="Off turns the missing-name case into a denial. Read at hooks/dispatch_tripwire_core.py:1398.")
_k("ATLAS_BUILTIN_AGENT_NUDGE", _GR, "Nudge off built-in agents", "Advise using an atlas:* role when a dispatch picks a built-in agent type.", default="on", details="Read at hooks/dispatch_tripwire_core.py:916.")
_k("ATLAS_SCOPE_GATE", _GR, "Enforce dispatch SCOPE", "Deny a dispatch whose SCOPE line is missing or wrong. Off downgrades it to advice.", default="on", details="Read at hooks/dispatch_tripwire_core.py:504.")
_k("ATLAS_BURST_SECS", _GR, "Dispatch burst window (seconds)", "Window in which several dispatches count as one burst for the burst advisory. 0 or less disables the advisory.", "number", "10", details="Read at hooks/dispatch_tripwire_core.py:480; default BURST_SECS = 10.")
_k("ATLAS_QUIET", _GR, "Quiet Claude Code", "Print only what needs the user: the Stop nudge speaks once and only after non-docs changes, and board acknowledgements and progress pings stay on the board.", default="on", details="Off restores the old chatter. Read at hooks/nudge.py and hooks/worker_inbox.py.")

# Colony
_k("ATLAS_COLONY", _COL, "Start the colony at session start", "Start the herdr colony when a session begins.", default="on", details="Off, 0, false or no skips it. Read at hooks/session_boot_core.py:221.")
_k("ATLAS_CHANNELS", _COL, "Steer dispatches onto a channel", "Steer subagent dispatches onto a colony channel.", default="on", details="Read at hooks/dispatch_tripwire_core.py:2116.")
_k("ATLAS_GATE_COLONY", _COL, "Gate: colony channel used", "Require a run with two or more workers to have used its colony channel.", default="on", details="Off skips that one completion-gate check. Read at hooks/completion_gate_core.py:2012.")
_k("ATLAS_COLONY_TRANSPORT", _COL, "Worker transport", "How colony workers are launched. The default is tmux when installed, else claude-bg.", "select", "tmux", scope="shell", options=["herdr", "tmux", "claude-bg"], details="Read at scripts/atlas_mux.py:257.")
_k("ATLAS_MUX", _COL, "Run teams as tmux panes", "Multi-worker teams run through atlas_mux spawn-team (tmux panes, one task per member) by default; the in-process Agent panel is for one bounded worker. off disables mux and turns the concurrent-dispatch deny into advice.", "select", "on", scope="shell", options=["on", "tmux", "off"], details="Only off is special. Without tmux the workers fall back to claude-bg. Read at scripts/atlas_mux.py:586 and hooks/dispatch_tripwire_core.py (_burst_note).")
_k("ATLAS_COLONY_LIVE_WINDOW", _COL, "Live window (seconds)", "Seconds an agent counts as live in the colony roster after its last activity.", "number", "1800", details="Read at scripts/atlas_colony_model.py:48.")
_k("ATLAS_SEAT_BACKEND", _COL, "Seat backend", "Which backend holds worker seats: rig, herdr, or off for none. auto prefers rig when available.", "select", "auto", scope="shell", options=["auto", "rig", "herdr", "off"], details="Any other value behaves as auto. Read at scripts/atlas_seats.py:42.")
_k("ATLAS_TASKS_MIRROR", _COL, "Mirror board items to TaskCreate", "Tell workers to mirror the board item they claim into the session task list.", default="off", scope="shell", details="Read at scripts/atlas_mux.py:973. The board stays the source of truth.")
_k("ATLAS_LEAD_IDLE_TTL", _COL, "Idle lead timeout (seconds)", "A lead channel with no exit code and no activity for this long is treated as a crashed session.", "number", "7200", scope="shell", details="Read at scripts/atlas_todo.py:1245; default LEAD_IDLE_TTL_S = 7200.")
_k("ATLAS_TERM_IDLE_S", _COL, "Dashboard terminal idle limit (seconds)", "The dashboard closes a terminal session after this long with no client.", "number", "900", scope="shell", details="Read each loop at scripts/atlas_dash_term.py:532.")
_k("ATLAS_MUX_OMP_CONFIG", _COL, "omp config for colony roles", "omp config file the colony reads model roles from.", "text", "~/.omp/agent/config.yml", scope="shell", details="Read at scripts/atlas_mux.py:378.")
_k("ATLAS_MUX_OMP_EXTENSION", _COL, "omp extension for workers", "omp extension path passed to colony workers. Blank passes none.", "text", "", scope="shell", details="Read at scripts/atlas_mux.py:1135.")
_k("ATLAS_REMOTE_PORT", _COL, "Remote colony port", "Tailnet port for remote colony access.", "number", "8443", scope="shell", details="Read at scripts/atlas_remote.py:46.")
_k("ATLAS_PACKS_CACHE_ROOT", _COL, "Packs cache directory", "Where the packs git cache lives. Blank uses <repo>/.atlas/.run/packs-cache.", "text", "", scope="shell", details="Read at scripts/atlas_packs.py:230.")
_k("ATLAS_PACKS_GIT_TIMEOUT", _COL, "Packs git timeout (seconds)", "Seconds before a packs git operation is abandoned.", "number", "60", scope="shell", details="Read at scripts/atlas_packs.py:60.")

# omp extension
_k("ATLAS_STOP_BRIDGE", _OMP, "Session-end bridge", "omp's session-end bridge records the finished session. Off disables only that bridge.", default="on", scope="shell", details="Read at omp/stop-bridge.ts:397.")
_k("ATLAS_LEAN_SHELL", _OMP, "Route bash through lean-ctx", "omp routes bash commands through lean-ctx.", default="on", scope="shell", details="Read at omp/shell-route.ts:94.")
_k("ATLAS_STYLE", _OMP, "Inject the atlas output style", "omp injects the atlas output style into its prompt.", default="on", scope="shell", details="Read at omp/style.ts:259.")

# Decision model
_k("ATLAS_DECISION", _DM, "Classify prompts with a model", "Ask a local model to classify each prompt. Off keeps the regex result.", default="on", details="Read at hooks/prompt_decision.py:56.")
_k("ATLAS_DECISION_MODEL", _DM, "Classifier model", "Ollama model the prompt classifier asks.", "model", "nimble", details="Read at hooks/prompt_decision.py:66.")
_k("ATLAS_DECISION_URL", _DM, "Classifier address", "Loopback endpoint for the prompt classifier. Blank uses Ollama on 127.0.0.1:11434.", "url", "", details="Read at hooks/prompt_decision.py:53.")

# Turn scoring
_k("ATLAS_TYPESAFE_URL", _TS, "Scoring endpoint", "Base URL of the scoring service; atlas appends /v1/systemone, and a pasted full URL also works. A loopback URL (http://127.0.0.1:11434) scores locally with Ollama and sends nothing off this machine. A hosted URL sends prompt excerpts to TypeSafe, a third-party disclosure.", "url", "https://api.typesafe.ai", details="Read at scripts/typesafe_client.py:58.")


# --- knob metadata: kind overrides, finite option sets, ranges, effect, applies ---
# Kept beside the _k() calls as data so each row's behavior is one lookup, not 34 edited signatures.

_OPT = _norm_options
_KIND = {
    "ATLAS_OPTIMIZER_MODEL": "model",
    "ATLAS_TYPESAFE_MODEL": "model",
    "ATLAS_OLLAMA_URL": "url",
    "ATLAS_OPTIMIZE_CMD": "command",
    "ATLAS_OPTIMIZE_TRIGGER": "select",
}
_OPTIONS = {
    "ATLAS_OPTIMIZE": [
        {"value": "off", "label": "Off", "hint": "Never rewrite prompts."},
        {"value": "trigger", "label": "Trigger prefix", "hint": "Only prompts that start with a trigger prefix."},
        {"value": "always", "label": "Always", "hint": "Every non-trivial prompt; adds model latency each time."},
    ],
    "ATLAS_OPTIMIZE_TRIGGER": [
        {"value": "opt:,optimize:,++", "label": "opt:, optimize:, ++", "hint": "All three prefixes (default)."},
        {"value": "opt:,optimize:", "label": "opt:, optimize:", "hint": "Word prefixes only."},
        {"value": "opt:", "label": "opt:", "hint": ""},
        {"value": "optimize:", "label": "optimize:", "hint": ""},
        {"value": "++", "label": "++", "hint": ""},
    ],
}
_RANGE = {
    "ATLAS_TRIPWIRE_THRESHOLD": {"min": 1, "max": 50, "step": 1},
    "ATLAS_OPTIMIZE_MINLEN": {"min": 0, "max": 500, "step": 1},
    "ATLAS_OPTIMIZE_TIMEOUT": {"min": 1, "max": 115, "step": 1},
    "ATLAS_TYPESAFE_MAX_CALLS": {"min": 1, "max": 5000, "step": 1},
    "ATLAS_BRIDGE_HOOK_TIMEOUT_S": {"min": 1, "max": 30, "step": 1},
    "ATLAS_WORKER_MAX_TOKENS": {"min": 1000, "max": 200000, "step": 1000},
    "ATLAS_DOCTOR_HOOK_TTL_MIN": {"min": 0, "max": 1440, "step": 1},
    "ATLAS_GATE_BLOCK_LOOP": {"min": 1, "max": 7, "step": 1},
    "ATLAS_FOOTPRINT_FILES": {"min": 0, "max": 50, "step": 1},
    "ATLAS_BURST_SECS": {"min": 0, "max": 3600, "step": 1},
    "ATLAS_COLONY_LIVE_WINDOW": {"min": 60, "max": 86400, "step": 60},
    "ATLAS_LEAD_IDLE_TTL": {"min": 60, "max": 604800, "step": 60},
    "ATLAS_TERM_IDLE_S": {"min": 30, "max": 86400, "step": 30},
    "ATLAS_REMOTE_PORT": {"min": 1024, "max": 65535, "step": 1},
    "ATLAS_PACKS_GIT_TIMEOUT": {"min": 1, "max": 3600, "step": 1},
}
# Model knobs whose value must be an installed Ollama model (the typesafe model is a hosted id).
_OLLAMA_VALIDATED = {"ATLAS_OPTIMIZER_MODEL", "ATLAS_DECISION_MODEL"}
_EFFECT = {
    "ATLAS_DASHBOARD": "New sessions start, or stop starting, the Command Center.",
    "ATLAS_INGEST": "Finished sessions are, or are not, written to the telemetry database.",
    "ATLAS_CHRONICLE": "Session facets are, or are not, recorded at session end.",
    "ATLAS_MEMORY_CAPTURE": "Durable lessons are, or are not, saved to ~/.atlas/memory/ at session end.",
    "ATLAS_CONNECTOR_WATCH": "Failed connector calls are, or are not, explained as credential problems.",
    "ATLAS_GATE": "The completion gate blocks, or stops blocking, a done claim without verified evidence.",
    "ATLAS_TRIPWIRE": "Inline-work coaching messages are shown, or hidden.",
    "ATLAS_TRIPWIRE_HARD": "The tripwire may, or may not, deny a tool call instead of only advising.",
    "ATLAS_TRIPWIRE_THRESHOLD": "The tripwire acts after this many inline operations in an armed run.",
    "ATLAS_ENGINE_ARM": "Prompts are, or are not, classified to arm orchestration before the first edit.",
    "ATLAS_FALLOW": "git commit and push run, or skip, the fallow audit gate.",
    "ATLAS_OPTIMIZE": "Sets when prompts go through the optimizer model.",
    "ATLAS_OPTIMIZE_TRIGGER": "Sets which prompt prefixes request optimization in trigger mode.",
    "ATLAS_OPTIMIZER_MODEL": "The optimizer rewrites prompts with this Ollama model.",
    "ATLAS_OLLAMA_URL": "Optimizer calls go to this Ollama address instead of $OLLAMA_HOST or the default.",
    "ATLAS_OPTIMIZE_MINLEN": "Prompts shorter than this skip the optimizer.",
    "ATLAS_OPTIMIZE_TIMEOUT": "The optimizer gives up and passes the original prompt after this many seconds.",
    "ATLAS_OPTIMIZE_CMD": "A shell command replaces Ollama for rewriting prompts; it runs with your prompt on every optimized prompt.",
    "ATLAS_OPTIMIZE_VERBOSE": "A banner is, or is not, printed when a prompt is rewritten.",
    "ATLAS_OPTIMIZE_LOG": "Each rewrite is appended to this file; blank keeps no log.",
    "ATLAS_TYPESAFE_SCORING": "Replies are, or are not, scored by the typesafe service (needs TYPESAFE_API_KEY).",
    "ATLAS_TYPESAFE_MODEL": "Scoring requests name this model. A local Ollama tag (name:tag) needs a loopback URL; a hosted URL needs a hosted model name such as jev-latest.",
    "ATLAS_TYPESAFE_MAX_CALLS": "A scoring pass makes at most this many requests.",
    "ATLAS_HOOK_BRIDGE": "omp runs, or skips, atlas's bridged Claude hooks.",
    "ATLAS_BRIDGE_HOOK_TIMEOUT_S": "Each bridged hook is cut off after this many seconds.",
    "ATLAS_WORKER_MAX_TOKENS": "Larger worker max_tokens requests are lowered to this.",
    "ATLAS_ADVISOR_GATE": "omp does, or does not, block stopping while advisor items are open.",
    "ATLAS_DECISION_MODEL": "The prompt classifier uses this Ollama model.",
    "ATLAS_DECISION_URL": "The prompt classifier calls this address; blank uses local Ollama.",
}
# Read-only: they decide where the saved settings live, so a settings page cannot move them.
PATH_KEYS = ("ATLAS_HOME", "ATLAS_DB", "ATLAS_DASHBOARD_PORT")
_PATH_DOC = {
    "ATLAS_HOME": ("Atlas state directory", "Holds atlas.db, memory/, the saved-settings file, the dashboard pidfile and log."),
    "ATLAS_DB": ("Telemetry database", "The sqlite file every hook writes to and this dashboard reads. Pointing elsewhere hides existing history."),
    "ATLAS_DASHBOARD_PORT": ("Command Center port", "Loopback port the dashboard listens on. Sessions look for the dashboard here, so every terminal must agree."),
}
_PATH_DEFAULT = {
    "ATLAS_HOME": str(Path.home() / ".atlas"),
    "ATLAS_DB": str(Path.home() / ".atlas" / "atlas.db"),
    "ATLAS_DASHBOARD_PORT": "7421",
}


def _finish_knob(knob: dict) -> dict:
    """Fill the metadata fields every knob row carries (in place)."""
    key = knob["key"]
    knob["kind"] = _KIND.get(key, knob["kind"])
    if key in _OPTIONS:
        knob["options"] = _OPT(_OPTIONS[key])
    if key in _RANGE:
        knob["range"] = _RANGE[key]
    if knob["kind"] == "model":
        knob["validate"] = "ollama" if key in _OLLAMA_VALIDATED else ""
    knob["effect"] = _EFFECT.get(key) or knob.get("description", "").split(". ")[0]
    knob["applies"] = "now"
    return knob


for _knob in BEHAVIOR_KNOBS:
    _finish_knob(_knob)

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
                name.startswith(("test_", "_test_"))
                or ".test." in name
                or "test-isolation" in name
                or name == "atlas_control.py"
            ):
                continue
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except Exception as exc:
                logging.getLogger(__name__).debug("env-scan skip %s: %s", path, exc)
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


# --- shell-scope layers: omp config env, ~/.atlas/env.sh, ~/.zshenv -------------
#
# A shell-scope knob is read from the environment of a process atlas does not
# start (omp, a CLI). So a write reaches it three ways: Claude settings env,
# omp's config.yml `env:` map, and a managed block in ~/.atlas/env.sh that
# ~/.zshenv sources. Nothing outside the markers (or the `env:` block) is touched.

MANAGED_BEGIN = "# >>> atlas managed >>>"
MANAGED_END = "# <<< atlas managed <<<"
ZSHENV_LINE = "[ -f ~/.atlas/env.sh ] && . ~/.atlas/env.sh"
_BLOCK_RE = re.compile(
    re.escape(MANAGED_BEGIN) + r"\n(.*?)" + re.escape(MANAGED_END) + r"\n?", re.S
)
_OMP_ENV_HEAD = re.compile(r"^env:\s*(\{\s*\})?\s*(#.*)?$")
_OMP_ENTRY = re.compile(r"^(\s+)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*?)\s*$")


def omp_config_path() -> Path:
    return OMP_CONFIG_PATH or Path.home() / ".omp" / "agent" / "config.yml"


def env_sh_path() -> Path:
    return Path.home() / ".atlas" / "env.sh"


def zshenv_path() -> Path:
    return Path.home() / ".zshenv"


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def _write_text(path: Path, text: str) -> None:
    """Atomic write that keeps the existing file's mode (these are the user's files)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.atlas-tmp")
    try:
        tmp.write_text(text, encoding="utf-8")
        if path.exists():
            shutil.copymode(path, tmp)
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def _set_block(text: str, body: str) -> str:
    block = f"{MANAGED_BEGIN}\n{body + chr(10) if body else ''}{MANAGED_END}\n"
    if _BLOCK_RE.search(text):
        return _BLOCK_RE.sub(lambda _m: block, text, count=1)
    if text and not text.endswith("\n"):
        text += "\n"
    return text + block


def read_env_sh() -> dict:
    m = _BLOCK_RE.search(_read_text(env_sh_path()))
    out: dict = {}
    for line in (m.group(1) if m else "").splitlines():
        mm = re.match(r"^export ([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
        if mm:
            try:
                parts = shlex.split(mm.group(2))
            except ValueError:
                continue
            out[mm.group(1)] = parts[0] if parts else ""
    return out


def write_env_sh(updates: dict, removed) -> None:
    merged = read_env_sh()
    merged.update(updates)
    for key in removed:
        merged.pop(key, None)
    body = "\n".join(f"export {k}={shlex.quote(v)}" for k, v in sorted(merged.items()))
    _write_text(env_sh_path(), _set_block(_read_text(env_sh_path()), body))
    zsh = _read_text(zshenv_path())
    if MANAGED_BEGIN not in zsh:  # idempotent: the guard line is added once
        _write_text(zshenv_path(), _set_block(zsh, ZSHENV_LINE))


def _unyaml(value: str) -> str:
    if value.startswith('"'):
        try:
            return str(json.loads(value))
        except ValueError:
            return value.strip('"')
    if value.startswith("'") and value.endswith("'") and len(value) > 1:
        return value[1:-1].replace("''", "'")
    return value


def _omp_env_span(lines: list):
    """(head index, end index exclusive) of the top-level `env:` block, or None."""
    for i, line in enumerate(lines):
        if line.startswith("env:"):
            if not _OMP_ENV_HEAD.match(line):
                raise ValueError("omp config `env:` is not a block map")
            end = i + 1
            while end < len(lines) and (
                lines[end].strip() == "" or lines[end].startswith((" ", "\t"))
            ):
                end += 1
            while end > i + 1 and lines[end - 1].strip() == "":
                end -= 1
            return i, end
    return None


def read_omp_env() -> dict:
    lines = _read_text(omp_config_path()).split("\n")
    try:
        span = _omp_env_span(lines)
    except ValueError:
        return {}
    out: dict = {}
    for line in lines[span[0] + 1 : span[1]] if span else []:
        m = _OMP_ENTRY.match(line)
        if m and not line.lstrip().startswith("#"):
            out[m.group(2)] = _unyaml(m.group(3))
    return out


def write_omp_env(updates: dict, removed) -> None:
    """Set/remove keys in config.yml `env:`; every other line is kept verbatim."""
    path = omp_config_path()
    text = _read_text(path)
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    span = _omp_env_span(lines)
    quote = json.dumps  # double-quoted YAML scalar, so `on` stays a string, not a boolean
    if span is None:
        entries = [f"  {k}: {quote(v)}" for k, v in sorted(updates.items())]
        if entries:
            lines += ["env:"] + entries
    else:
        head, end = span
        body, pending, indent = [], dict(updates), "  "
        for line in lines[head + 1 : end]:
            m = _OMP_ENTRY.match(line)
            if m and not line.lstrip().startswith("#"):
                indent, key = m.group(1), m.group(2)
                if key in removed:
                    continue
                if key in pending:
                    line = f"{indent}{key}: {quote(pending.pop(key))}"
            body.append(line)
        body += [f"{indent}{k}: {quote(v)}" for k, v in sorted(pending.items())]
        has_entry = any(_OMP_ENTRY.match(x) and not x.lstrip().startswith("#") for x in body)
        lines[head:end] = ["env:" if has_entry else "env: {}"] + (body if has_entry else [])
    _write_text(path, "\n".join(lines) + "\n")


_SOURCE_NAME = {"live_env": "process", "claude_settings": "claude"}  # legacy `source` values


def _scope_of(key: str) -> str:
    knob = _KNOBS_BY_KEY.get(key)
    if knob:
        return knob["scope"]
    return "hooks"


def _layer_view(key: str, scope: str, store_env, claude_env, omp_env, rc_env) -> dict:
    """The five layers for one key: {layer: {supported, value}}. value None = not set there."""
    proc = os.environ.get(key)
    shell = scope == "shell"
    return {
        "live_env": {"supported": True, "value": proc if proc not in (None, "") else None},
        "store": {"supported": True, "value": store_env.get(key)},
        "claude_settings": {
            "supported": True,
            "value": str(claude_env[key]) if key in claude_env else None,
        },
        "omp_config": {"supported": shell, "value": omp_env.get(key)},
        "shell_rc": {"supported": shell, "value": rc_env.get(key)},
    }


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
    omp_env = read_omp_env()
    rc_env = read_env_sh()
    scanned = {k: v for k, v in _scan_env_readers().items() if k not in _INTERNAL}

    def detail(key, default, scope):
        layers = _layer_view(key, scope, store["env"], claude_env, omp_env, rc_env)
        order = ("live_env", "store", "claude_settings", "omp_config", "shell_rc")
        value, source = default, "default"
        for name in order:
            if layers[name]["value"] is not None:
                value, source = layers[name]["value"], _SOURCE_NAME.get(name, name)
                break
        hook_value, hook_source = default, "default"
        for name in ("store", "claude_settings"):
            if layers[name]["value"] is not None:
                hook_value, hook_source = layers[name]["value"], _SOURCE_NAME.get(name, name)
                break
        reaches = []
        if layers["claude_settings"]["value"] is not None:
            reaches.append("claude")
        if layers["store"]["value"] is not None:
            reaches.append("omp")
        if layers["omp_config"]["value"] is not None:
            reaches.append("omp")
        if layers["live_env"]["value"] is not None:
            reaches.append("dashboard-process")
        return {
            "value": value,
            "source": source,
            "hook_value": hook_value,
            "hook_source": hook_source,
            "layers": layers,
            "reaches": sorted(set(reaches)),
            "default": default,
            "changed": store["changed"].get(key),
        }

    def shell_also(key):
        info = scanned.get(key) or {}
        return "ts" in (info.get("langs") or []) and "py" in (info.get("langs") or [])

    groups: dict[str, dict] = {
        t: {"id": t, "title": t, "intro": GROUP_INTROS[t], "knobs": []} for t in GROUP_INTROS
    }
    for knob in BEHAVIOR_KNOBS:
        entry = dict(knob)
        entry.update(detail(knob["key"], knob.get("default", ""), knob["scope"]))
        entry["scope"] = "hooks"  # one save path for every knob; the internal scope only picks extra layers
        entry["ref"] = (scanned.get(knob["key"]) or {}).get("ref", "")
        entry["shell_also"] = shell_also(knob["key"])
        groups[knob["group"]]["knobs"].append(entry)

    paths = []
    for key in PATH_KEYS:
        title, desc = _PATH_DOC[key]
        paths.append(
            {"key": key, "title": title, "description": desc, "value": os.environ.get(key) or _PATH_DEFAULT[key]}
        )
    shown = set(_KNOBS_BY_KEY) | set(PATH_KEYS)
    hidden = sorted(k for k in scanned if k not in shown)

    return {
        "groups": list(groups.values()),
        "advanced": [],  # kept for compatibility with older pages; every key is now in a group, paths or hidden
        "paths": paths,
        "hidden": hidden,
        "settings_path": str(SETTINGS_PATH),
        "store_path": str(store_path()),
        "omp": omp_model_roles(),
        "note": SAVE_NOTE,
    }


def _check_value(key: str, value: str, confirm: bool):
    """None when the value may be saved, else the error dict (with its HTTP `status`)."""
    knob = _KNOBS_BY_KEY.get(key) or {}
    meta = _finish_knob(dict(knob)) if knob else {"kind": "text"}
    kind = meta["kind"]
    if kind == "select" and meta.get("options"):
        allowed = [o["value"] for o in meta["options"]]
        if value not in allowed:
            return {"error": "bad_option", "key": key, "options": allowed, "status": 400}
    r = _RANGE.get(key) or meta.get("range")
    if r:
        try:
            n = float(value)
        except ValueError:
            n = None
        if n is None or not r["min"] <= n <= r["max"]:
            return {"error": "out_of_range", "key": key, "range": r, "status": 400}
    if key == "ATLAS_OPTIMIZE_CMD" and not confirm:
        return {"error": "needs_confirm", "key": key, "command": value, "status": 409}
    if key in _OLLAMA_VALIDATED:
        if str(SCRIPTS_DIR) not in sys.path:
            sys.path.insert(0, str(SCRIPTS_DIR))
        import atlas_ollama

        ok, matches = atlas_ollama.validate_model(value)
        if ok is False:  # None: ollama unreachable, cannot validate, so accept
            return {"error": "unknown_model", "key": key, "value": value, "matches": matches, "status": 400}
    return None


def write_behavior_updates(updates: dict, confirm: bool = False) -> dict:
    """Write ATLAS_* knobs to every layer their scope reaches, then read each layer back.

    hooks scope: atlas store + Claude settings env. shell scope: Claude settings env,
    omp config.yml env, ~/.atlas/env.sh. Empty removes. `ok` is false when any written
    layer does not read back equal to what was wanted.
    """
    if not isinstance(updates, dict) or not updates:
        return {"ok": False, "error": "updates_required"}
    clearable = (
        {k["key"] for k in BEHAVIOR_KNOBS}
        | set(discovered_env_keys())
        | set(_settings_env())
        | set(read_store()["env"])
    ) - _INTERNAL
    cleaned: dict[str, str] = {}
    removed: list[str] = []
    bad: list[str] = []
    for key, raw in updates.items():
        key = str(key or "").strip()
        if key in PATH_KEYS:
            return {
                "ok": False,
                "error": "read_only",
                "keys": [key],
                "hint": f"{key} cannot be saved here. Set it in your shell before starting atlas.",
                "status": 400,
            }
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
            continue
        problem = _check_value(key, value, confirm)
        if problem:
            return {"ok": False, **problem}
        cleaned[key] = value
    if bad:
        return {
            "ok": False,
            "error": "keys_not_allowlisted",
            "keys": bad,
            "hint": "Only ATLAS_* variables a shipped file reads can be saved here.",
        }

    by_scope = {"hooks": ({}, []), "shell": ({}, [])}
    for key in sorted(set(cleaned) | set(removed)):
        sc = _scope_of(key)
        sc = sc if sc in by_scope else "hooks"
        if key in cleaned:
            by_scope[sc][0][key] = cleaned[key]
        else:
            by_scope[sc][1].append(key)
    shell_set, shell_rm = by_scope["shell"]
    hook_set, hook_rm = cleaned, removed  # every hook reads the store, so every knob goes there

    errors: dict[str, str] = {}  # layer -> why the write itself failed
    now = time.time()

    def attempt(layer, fn):
        try:
            fn()
        except (OSError, ValueError) as e:
            errors[layer] = f"{type(e).__name__}: {e}"

    def write_store():
        store = read_store()
        store["env"].update(hook_set)
        for key in hook_set:
            store["changed"][key] = now
        for key in hook_rm:
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

    if hook_set or hook_rm:
        attempt("store", write_store)
    attempt("claude_settings", lambda: mutate_settings(apply))
    if shell_set or shell_rm:
        attempt("omp_config", lambda: write_omp_env(shell_set, shell_rm))
        attempt("shell_rc", lambda: write_env_sh(shell_set, shell_rm))

    back = {
        "store": read_store()["env"],
        "claude_settings": {k: str(v) for k, v in _settings_env().items()},
        "omp_config": read_omp_env(),
        "shell_rc": read_env_sh(),
    }
    results = []
    for key in sorted(set(cleaned) | set(removed)):
        wanted = cleaned.get(key, "")
        scope = _scope_of(key)
        names = ["claude_settings", "store"] + (
            ["omp_config", "shell_rc"] if scope == "shell" else []
        )
        layers = []
        for name in names:
            got = back[name].get(key)
            row = {
                "layer": name,
                "wrote": wanted,
                "got": "" if got is None else got,
                "ok": name not in errors and ("" if got is None else got) == wanted,
            }
            if name in errors:
                row["error"] = errors[name]
            layers.append(row)
        results.append(
            {
                "key": key,
                "wanted": wanted,
                "layers": layers,
                "applies": "now",
                "ok": all(x["ok"] for x in layers),
            }
        )
    out = {
        "ok": all(r["ok"] for r in results),
        "set": sorted(cleaned),
        "cleared": sorted(removed),
        "results": results,
        "settings_path": str(SETTINGS_PATH),
        "store_path": str(store_path()),
        "note": SAVE_NOTE,
    }
    if len(results) == 1:
        one = results[0]
        out.update(key=one["key"], wanted=one["wanted"], layers=one["layers"], applies=one["applies"])
    if not out["ok"]:
        out["error"] = "readback_mismatch"
    return out


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
        is_skill = entry.is_dir() and (entry / "SKILL.md").is_file()
        if is_skill or (entry.is_file() and entry.suffix in suffixes):
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
    keys = sorted(set(roots) | {k for k in enabled_map if isinstance(k, str)})
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


def _connector_root() -> Path:
    """The plugin root that owns the vendor connectors: armada's, else a nonexistent sibling.

    Connectors moved from atlas to armada. With no armada install every connector
    lookup resolves under a path that does not exist, so callers see "no bundle"
    instead of crashing.
    """
    root, _reason = armada_root.find_armada_root(PLUGIN_ROOT)
    return root if root is not None else PLUGIN_ROOT / "_armada_not_installed"


def _mcp_server_spec(name: str) -> dict:
    servers = _read_json(_connector_root() / ".mcp.json").get("mcpServers") or {}
    spec = servers.get(name)
    return spec if isinstance(spec, dict) else {}


def _subst_root(value: str) -> str:
    return value.replace("${CLAUDE_PLUGIN_ROOT}", str(_connector_root()))


def _mcp_dir(name: str) -> Path:
    """<armada root>/mcp/<name>, or a nonexistent sibling when name would escape mcp/."""
    base = os.path.realpath(_connector_root() / "mcp")
    p = os.path.realpath(os.path.join(base, name))
    return Path(p) if p.startswith(base + os.sep) else Path(base) / "_invalid"


def connector_entry(name: str) -> tuple[Path, list[str] | None]:
    """Resolve a connector's entry point and the exact argv .mcp.json launches.

    The argv comes from .mcp.json (with ${CLAUDE_PLUGIN_ROOT} substituted), so a
    test can never drift from how the plugin really starts the server: node
    bundles go through ``--import mcp/_env/load.mjs`` and python connectors
    through uv + load.py, which is what promotes CFG_* values.
    """
    mcp_dir = _mcp_dir(name)
    node_bundle = mcp_dir / "server.mjs"
    spec = _mcp_server_spec(name)
    if node_bundle.is_file():
        entry = node_bundle
    elif (mcp_dir / "pyproject.toml").is_file():
        entry = mcp_dir / "pyproject.toml"
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
    project = _mcp_dir(name)
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
            cwd=str(_connector_root() if _connector_root().is_dir() else PLUGIN_ROOT),
        )
    except FileNotFoundError:
        return {
            "ok": False,
            "error": f"{argv[0]}_not_found",
            "hint": f"Install {argv[0]} to run this connector.",
        }

    assert proc.stdin is not None and proc.stdout is not None
    assert proc.stderr is not None

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
        for raw in proc.stdout or ():
            lines.put(raw)
        lines.put(None)

    threading.Thread(target=_pump, daemon=True).start()
    err_chunks: list = []
    threading.Thread(
        target=lambda: err_chunks.append(proc.stderr.read() if proc.stderr else b""),
        daemon=True,
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
    except BrokenPipeError as exc:
        logging.getLogger(__name__).debug("connector %s stdin closed: %s", name, exc)
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
    try:
        elapsed_ms = int((time.time() - started) * 1000)
    except Exception:
        elapsed_ms = 0
    res = {
        "ok": configured is None or configured,
        "name": name,
        "server": server_info.get("name") or name,
        "version": server_info.get("version") or "",
        "tool_count": len(tools),
        "tools": [t.get("name") for t in tools[:12] if isinstance(t, dict)],
        "configured": configured,
        "status": (status_text or "")[:800],
        "elapsed_ms": elapsed_ms,
    }
    if configured is not None and not configured:
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
        since = now - since_s
        if "denied" in cols:
            # pi-lens-ignore: python-sql-injection
            rows = conn.execute(_CONNECTOR_USAGE_SQL_DENIED, (since, since)).fetchall()
        else:
            # pi-lens-ignore: python-sql-injection
            rows = conn.execute(_CONNECTOR_USAGE_SQL, (since, since)).fetchall()
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
    except Exception:
        return out
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

OMP_CONFIG_PATH: Path | None = None  # None: resolve ~/.omp/agent/config.yml from HOME per call (tests patch it)
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
    path = path or omp_config_path()
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

# `=(.*)` not `=\s*(.*)`: the value is stripped by the caller, and `\s*(.*)` backtracks quadratically.
ENV_LINE_RE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$")


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
