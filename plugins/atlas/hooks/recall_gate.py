#!/usr/bin/env python3
"""PreToolUse hook -- claude-mem recall gate (REQUIRED once per session).

Every main-thread tool call that is neither a claude-mem call, TodoWrite nor ToolSearch is
denied (on EVERY attempt, no once-per-session fail-open), with the `recallGate` text from
contracts/mandates.json naming the claude-mem search tool and an example argument, until
the session makes a real claude-mem call. Ignoring a denial does not satisfy the gate; only
the recall itself does (it is allowed silently and writes the session's marker, even if
the call later errors because claude-mem is down). The omp twin is omp/mandates.ts (same
shared cases in contracts/mandates.json `recallGateCases`, asserted by both suites).

Armed only when the claude-mem plugin is enabled (tool_routing.plugin_enabled) AND a
claude-mem MCP server is mounted; enabled-but-unmounted allows everything and leaves one
atlas_faults trace per session (no recall tool exists, so the gate could never be satisfied).
Hooks cannot see the session's callable tool set, so config is the closest proxy; omp
checks the real callable set per call instead. ATLAS_MANDATES=off (exact string) disables it.

Main thread only: a payload with an agent_id, or whose transcript_path lies under
/subagents/, is skipped (an absent transcript_path is treated as main), so subagents that
share the parent's session id never re-arm the gate. State is one marker file per session
id, so a session that recalled stays satisfied for every later call; a subagent running
under its OWN session id has no marker and must recall once itself.

Stdlib only. Fail-open by construction: any parse or runtime error exits 0 silently.
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import sys
import tempfile

# Per-session "recall satisfied" markers (tests point this at a temp dir).
GATE_MARKER_DIR = os.path.join(tempfile.gettempdir(), "atlas-recall-gate")

# Shared mandate contract (also read by omp/mandates.ts); unreadable -> gate unarmed.
MANDATES_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "contracts", "mandates.json"
)

# The claude-mem search tool Claude Code names for this plugin (same literal as
# session_boot.recall_mandate).
CC_ROUTE = "mcp__plugin_claude-mem_mcp-search__search"

# Server/tool names that ARE a claude-mem call (mirrors CLAUDE_MEM_SERVER in omp/mandates.ts).
_MEM_NAME = re.compile(r"claude[-_]?mem|mcp[-_]?search", re.I)
# Neither denied nor satisfying (omp `todo` is matched case-insensitively too).
_EXEMPT = (
    "todowrite",
    "todo",
    "toolsearch",
)  # ToolSearch loads the deferred recall tool's schema


def _claude_mem_enabled(cwd: str | None) -> bool:
    sys.path.insert(
        0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
    )
    import tool_routing

    return tool_routing.plugin_enabled("claude-mem", cwd)


def _contract() -> dict | None:
    with open(MANDATES_PATH, encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        return None
    if not all(
        isinstance(data.get(k), str) for k in ("recallGate", "recallGateExample")
    ):
        return None
    return data


def _is_recall(tool_name: str, tool_input) -> bool:
    """True when the call IS the claude-mem recall: a claude-mem tool, or a Write to an
    `xd://mcp__` claude-mem device (`path`, or `file_path` as Claude Code names it)."""
    if _MEM_NAME.search(tool_name):
        return True
    if tool_name.lower() != "write" or not isinstance(tool_input, dict):
        return False
    for key in ("path", "file_path"):
        value = tool_input.get(key)
        if (
            isinstance(value, str)
            and value.startswith("xd://mcp__")
            and _MEM_NAME.search(value)
        ):
            return True
    return False


def _marker(session: str) -> str:
    return os.path.join(
        GATE_MARKER_DIR, "recall-" + re.sub(r"[^A-Za-z0-9_.-]", "_", session)
    )


def _mark_recalled(session: str) -> None:
    """Record that this session made its claude-mem call (idempotent)."""
    os.makedirs(GATE_MARKER_DIR, exist_ok=True)
    with contextlib.suppress(FileExistsError):
        os.close(os.open(_marker(session), os.O_CREAT | os.O_EXCL | os.O_WRONLY))


def _trace_unarmed(session: str, cwd: str) -> None:
    """claude-mem is enabled but no recall tool is mounted, so the gate cannot be satisfied: allow, and leave one trace per session."""
    os.makedirs(GATE_MARKER_DIR, exist_ok=True)
    try:
        fd = os.open(
            os.path.join(
                GATE_MARKER_DIR, "norecall-" + re.sub(r"[^A-Za-z0-9_.-]", "_", session)
            ),
            os.O_CREAT | os.O_EXCL | os.O_WRONLY,
        )
    except FileExistsError:
        return
    os.close(fd)
    _record_fault(
        LookupError("claude-mem enabled but no recall tool mounted: gate unarmed"), cwd
    )


def _json_servers(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    servers = data.get("mcpServers")
    return servers if isinstance(servers, dict) else {}


def _has_mem_server(servers) -> bool:
    return isinstance(servers, dict) and any(_MEM_NAME.search(str(k)) for k in servers)


def _plugin_mcp_files(plugins_dir: str):
    """`.mcp.json` files under a claude-mem plugin dir in ~/.claude/plugins (bounded walk)."""
    base_depth = plugins_dir.rstrip(os.sep).count(os.sep)
    for dirpath, dirnames, filenames in os.walk(plugins_dir):
        if dirpath.count(os.sep) - base_depth >= 7:
            dirnames[:] = []
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git")]
        if ".mcp.json" in filenames and re.search(r"claude[-_]?mem", dirpath, re.I):
            yield os.path.join(dirpath, ".mcp.json")


def _mem_server_mounted(cwd: str) -> bool:
    """True when a claude-mem MCP server is configured anywhere Claude Code would read it.

    Sources: project .mcp.json (cwd up to home), ~/.claude.json (global and projects[cwd]),
    a claude-mem plugin's .mcp.json under ~/.claude/plugins, and the settings files."""
    home = os.path.expanduser("~")
    cwd = os.path.abspath(cwd)
    # Project .mcp.json, cwd up to (and including) home, or root when cwd is outside home.
    cur = cwd
    while True:
        if _has_mem_server(_json_servers(os.path.join(cur, ".mcp.json"))):
            return True
        parent = os.path.dirname(cur)
        if cur == home or parent == cur:
            break
        cur = parent
    # Project settings files and user settings.
    for path in (
        os.path.join(cwd, ".claude", "settings.json"),
        os.path.join(cwd, ".claude", "settings.local.json"),
        os.path.join(home, ".claude", "settings.json"),
    ):
        if _has_mem_server(_json_servers(path)):
            return True
    # ~/.claude.json: global mcpServers and projects[cwd].mcpServers.
    try:
        with open(os.path.join(home, ".claude.json"), encoding="utf-8") as fh:
            state = json.load(fh)
    except (OSError, ValueError):
        state = {}
    if isinstance(state, dict):
        if _has_mem_server(state.get("mcpServers")):
            return True
        projects = state.get("projects")
        entry = projects.get(cwd) if isinstance(projects, dict) else None
        if isinstance(entry, dict) and _has_mem_server(entry.get("mcpServers")):
            return True
    # Enabled claude-mem plugin shipping its own .mcp.json (flat or under mcpServers).
    for path in _plugin_mcp_files(os.path.join(home, ".claude", "plugins")):
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            continue
        if isinstance(data, dict) and (data.get("mcpServers") or data):
            return True
    return False


def _scripts_on_path() -> None:
    scripts = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
    if scripts not in sys.path:
        sys.path.insert(0, scripts)


def _gates_armed(cwd: str) -> bool:
    _scripts_on_path()
    import atlas_scope

    return atlas_scope.gates_armed(cwd)


def _record_fault(exc: BaseException, cwd) -> None:
    """Persist a fail-open crash (never raises)."""
    try:
        _scripts_on_path()
        import atlas_faults

        atlas_faults.record(
            "recall_gate", exc, cwd if isinstance(cwd, str) else os.getcwd()
        )
    except Exception:
        pass


def _decide(data: dict) -> str | None:
    """The deny reason for this call, or None to allow (fail open)."""
    try:
        tool_name = data.get("tool_name")
        session = data.get("session_id")
        if (
            not isinstance(tool_name, str)
            or not isinstance(session, str)
            or not tool_name
            or not session
        ):
            return None
        if os.environ.get("ATLAS_MANDATES") == "off":
            return None
        if data.get("agent_id") or "/subagents/" in str(
            data.get("transcript_path") or ""
        ):
            return None
        if tool_name.lower() in _EXEMPT:
            return None
        cwd = data.get("cwd") if isinstance(data.get("cwd"), str) else None
        cwd = cwd or os.getcwd()
        if not _gates_armed(cwd):
            return None  # throwaway / non-project directory: gate never arms
        if not _claude_mem_enabled(cwd):
            return None
        if not _mem_server_mounted(cwd):
            _trace_unarmed(session, cwd)
            return None  # enabled in settings but its MCP server is not mounted here: no deadlock
        contract = _contract()
        if contract is None:
            return None
        if _is_recall(tool_name, data.get("tool_input")):
            _mark_recalled(session)  # the recall itself: allow and satisfy the gate
            return None
        if os.path.exists(_marker(session)):
            return None  # already satisfied this session
        # Deny on every attempt until the recall. If the marker dir is unusable the recall
        # could never be recorded, so fail open (traced by the caller) instead of deadlocking.
        os.makedirs(GATE_MARKER_DIR, exist_ok=True)
        if not os.access(GATE_MARKER_DIR, os.W_OK):
            raise PermissionError("recall marker dir not writable: gate unarmed")
        return (
            contract["recallGate"]
            .replace("{route}", CC_ROUTE)
            .replace("{example}", contract["recallGateExample"])
        )
    except Exception as exc:
        _record_fault(exc, data.get("cwd") if isinstance(data, dict) else None)
        return None


def main() -> int:
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
        if not isinstance(data, dict):
            data = {}  # non-dict JSON (null, list) is not a payload
    except (json.JSONDecodeError, ValueError):
        return 0

    reason = _decide(data)
    if reason is None:
        return 0
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
