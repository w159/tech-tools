#!/usr/bin/env python3
"""PreToolUse hook -- claude-mem recall gate (REQUIRED once per session).

The first main-thread tool call that is neither a claude-mem call, TodoWrite nor ToolSearch is
denied (once per session: the next call is allowed with a one-line note, because a server that failed
to connect leaves no recall tool to satisfy the gate), with the `recallGate` text from
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

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
)
import atlas_env  # noqa: E402
atlas_env.apply_store_env()


# Per-session "recall satisfied" markers (tests point this at a temp dir).
def _temp_root() -> str:
    """tempfile.gettempdir() without importing tempfile (6ms of import per tool call):
    TMPDIR/TEMP/TMP, else /tmp. Windows keeps the real call."""
    if os.name != "posix":
        import tempfile

        return tempfile.gettempdir()
    for var in ("TMPDIR", "TEMP", "TMP"):
        value = os.environ.get(var)
        if value:
            return os.path.abspath(value)
    return "/tmp"


GATE_MARKER_DIR = os.path.join(_temp_root(), "atlas-recall-gate")

# Shared mandate contract (also read by omp/mandates.ts); unreadable -> gate unarmed.
MANDATES_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "contracts", "mandates.json"
)

# The claude-mem search tool Claude Code names for this plugin (same literal as
# session_boot.recall_mandate).
CC_ROUTE = "mcp__plugin_claude-mem_mcp-search__search"

# Server/tool names that ARE a claude-mem call (mirrors CLAUDE_MEM_SERVER in omp/mandates.ts).
from atlas_lazyre import lre  # noqa: E402
_MEM_NAME = lre(r"claude[-_]?mem|mcp[-_]?search", re.I)
# Neither denied nor satisfying (omp `todo` is matched case-insensitively too).
# A claude-mem CALL: the tool name's server part must itself be claude-mem / mcp-search
# (optionally behind Claude Code's `plugin_` prefix), so a foreign server whose tool is
# merely named like one (`mcp__evil__claude_mem_dump`) never satisfies the gate.
_MEM_TOOL = lre(
    r"^mcp__(?:plugin_)?(?:claude[-_]?mem|mcp[-_]?search)(?:[-_]|$)", re.I
)
_EXEMPT = (
    "todowrite",
    "todo",
    "toolsearch",
)  # ToolSearch loads the deferred recall tool's schema


def _claude_mem_enabled(cwd: str | None) -> bool:
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
    if _MEM_TOOL.match(tool_name):
        return True
    if tool_name.lower() != "write" or not isinstance(tool_input, dict):
        return False
    for key in ("path", "file_path"):
        value = tool_input.get(key)
        if (
            isinstance(value, str)
            and value.startswith("xd://mcp__")
            and _MEM_TOOL.match(value[len("xd://") :])
        ):
            return True
    return False


def _marker(session: str) -> str:
    return os.path.join(
        GATE_MARKER_DIR, "recall-" + re.sub(r"[^A-Za-z0-9_.-]", "_", session)
    )


def _unarmed_marker(session: str) -> str:
    return os.path.join(
        GATE_MARKER_DIR, "norecall-" + re.sub(r"[^A-Za-z0-9_.-]", "_", session)
    )


def _mark_recalled(session: str) -> None:
    """Record that this session made its claude-mem call (idempotent)."""
    os.makedirs(GATE_MARKER_DIR, exist_ok=True)
    with contextlib.suppress(FileExistsError):
        os.close(os.open(_marker(session), os.O_CREAT | os.O_EXCL | os.O_WRONLY))


def _denied_marker(session: str) -> str:
    return os.path.join(
        GATE_MARKER_DIR, "denied-" + re.sub(r"[^A-Za-z0-9_.-]", "_", session)
    )


_NOTE: list = [None]  # one-line allow note main() prints (set by _release)
_MISSING_TOOL = lre(r"No such tool available:\s*mcp__(?:plugin_)?(?:claude[-_]?mem|mcp[-_]?search)", re.I)


def _recall_tool_missing(transcript_path) -> bool:
    """True when the transcript tail shows a claude-mem tool call that failed because the tool does not exist."""
    if not isinstance(transcript_path, str) or not transcript_path:
        return False
    try:
        with open(transcript_path, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            fh.seek(max(0, fh.tell() - 262144))
            tail = fh.read().decode("utf-8", "replace")
    except OSError:
        return False
    return bool(_MISSING_TOOL.search(tail))


def _release(session: str, why: str) -> None:
    """Stop gating this session (cheap marker for later calls) and queue a one-line note for the allowed call."""
    with contextlib.suppress(OSError):
        os.makedirs(GATE_MARKER_DIR, exist_ok=True)
        os.close(os.open(_unarmed_marker(session), os.O_CREAT | os.O_EXCL | os.O_WRONLY))
    _NOTE[0] = (
        "[atlas gate] Recall gate released for this session: %s. Continue without it; "
        "ATLAS_MANDATES=off disables the gate." % why
    )


def _trace_unarmed(session: str, cwd: str) -> None:
    """claude-mem is enabled but no recall tool is mounted, so the gate cannot be satisfied: allow, and leave one trace per session."""
    os.makedirs(GATE_MARKER_DIR, exist_ok=True)
    try:
        fd = os.open(
            _unarmed_marker(session),
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
    """`.mcp.json` files in the CURRENT install of the claude-mem plugin.

    The install paths come from installed_plugins.json (entries named `claude-mem@...`), so
    stale version caches and other marketplaces' leftovers under ~/.claude/plugins never count:
    a server that only an old cache ships is not mounted in this session."""
    try:
        with open(os.path.join(plugins_dir, "installed_plugins.json"), encoding="utf-8") as fh:
            installed = json.load(fh)
    except (OSError, ValueError):
        return
    plugins = installed.get("plugins") if isinstance(installed, dict) else None
    if not isinstance(plugins, dict):
        return
    for key, entries in plugins.items():
        if str(key).split("@", 1)[0] != "claude-mem" or not isinstance(entries, list):
            continue
        for entry in entries:
            path = entry.get("installPath") if isinstance(entry, dict) else None
            if isinstance(path, str) and os.path.isfile(os.path.join(path, ".mcp.json")):
                yield os.path.join(path, ".mcp.json")


def _mem_server_mounted(cwd: str):
    """Truthy when a claude-mem MCP server is configured anywhere Claude Code would read it:
    True for a server named in a project/user config, "plugin" when only the enabled plugin's
    current install ships it (a plugin server can still fail to connect, and a hook cannot see
    the callable tool set, so the gate denies that case once and then lets the session through).

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
    # Enabled claude-mem plugin's current install shipping its own .mcp.json (flat or under mcpServers).
    for path in _plugin_mcp_files(os.path.join(home, ".claude", "plugins")):
        try:
            with open(path, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            continue
        if isinstance(data, dict) and (data.get("mcpServers") or data):
            return "plugin"
    return False


def _gates_armed(cwd: str) -> bool:
    import atlas_scope

    return atlas_scope.gates_armed(cwd)


def _record_fault(exc: BaseException, cwd) -> None:
    """Persist a fail-open crash (never raises)."""
    import atlas_hook_guard

    atlas_hook_guard.fault(
        "recall_gate", exc, cwd if isinstance(cwd, str) else os.getcwd()
    )


def _decide(data: dict) -> str | None:
    """The deny reason for this call, or None to allow (fail open)."""
    _NOTE[0] = None
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
        # Headless atlas_mux bg workers (ATLAS_WORKER_NAME pinned in their env) cannot
        # grant the MCP approval a claude-mem recall needs, so arming would deny-loop
        # them to `done` with no note; exempt them like the subagents above, same leaf
        # marker as the 10.4.1 dispatch-tripwire worker exemption.
        import worker_inbox  # lazy: pathlib/time load only once the cheap checks pass

        if worker_inbox.is_worker_env():
            return None
        if (
            re.sub(r"[\W_]", "", tool_name.lower()) in _EXEMPT
        ):  # ToolSearch / tool_search / tool-search
            return None
        cwd = data.get("cwd") if isinstance(data.get("cwd"), str) else None
        cwd = cwd or os.getcwd()
        # Cheap per-session short-circuits first: the mounted scan below walks
        # ~/.claude/plugins (~16 ms) and must not run on every tool call.
        if os.path.exists(_marker(session)):
            return None  # already satisfied this session
        if os.path.exists(_unarmed_marker(session)):
            return None  # unmounted verdict cached for this session (traced once)
        if not _gates_armed(cwd):
            return None  # throwaway / non-project directory: gate never arms
        if not _claude_mem_enabled(cwd):
            return None
        mounted = _mem_server_mounted(cwd)
        if not mounted:
            _trace_unarmed(session, cwd)
            return None  # enabled in settings but its MCP server is not mounted here: no deadlock
        contract = _contract()
        if contract is None:
            return None
        if _is_recall(tool_name, data.get("tool_input")):
            _mark_recalled(session)  # the recall itself: allow and satisfy the gate
            return None
        # Deny on every attempt until the recall. If the marker dir is unusable the recall
        # could never be recorded, so fail open (traced by the caller) instead of deadlocking.
        os.makedirs(GATE_MARKER_DIR, exist_ok=True)
        if not os.access(GATE_MARKER_DIR, os.W_OK):
            raise PermissionError("recall marker dir not writable: gate unarmed")
        if _recall_tool_missing(data.get("transcript_path")):
            _release(session, "the claude-mem recall tool does not exist in this session")
            return None
        # A plugin-shipped server can have failed to connect, which would leave no recall tool and a
        # hook cannot see the callable set: deny once per session, then never lock the session.
        # A server from project or user config is deny-every-call (a missing tool is caught above).
        if mounted != "plugin":
            return (
                contract["recallGate"]
                .replace("{route}", CC_ROUTE)
                .replace("{example}", contract["recallGateExample"])
            )
        first = _denied_marker(session)
        try:
            os.close(os.open(first, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
        except FileExistsError:
            _release(session, "the claude-mem recall was asked for once and did not happen")
            return None
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
        data = json.loads(raw, strict=False) if raw.strip() else {}
        if not isinstance(data, dict):
            data = {}  # non-dict JSON (null, list) is not a payload
    except (json.JSONDecodeError, ValueError):
        return 0

    reason = _decide(data)
    if reason is None:
        if _NOTE[0]:
            print(
                json.dumps(
                    {
                        "hookSpecificOutput": {
                            "hookEventName": "PreToolUse",
                            "additionalContext": _NOTE[0],
                        }
                    }
                )
            )
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
