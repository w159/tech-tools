#!/usr/bin/env python3
"""PreToolUse hook -- claude-mem recall gate (REQUIRED once per session).

Every main-thread tool call that is neither a claude-mem call nor TodoWrite is denied,
with the `recallGate` text from contracts/mandates.json naming the claude-mem search
tool and an example argument, until the session makes a real claude-mem call. Ignoring
a denial does not satisfy the gate; only the recall itself does (it is allowed silently
and writes the session's marker). The omp twin is omp/mandates.ts (same shared cases in
contracts/mandates.json `recallGateCases`, asserted by both suites).

Armed only when the claude-mem plugin is enabled (tool_routing.plugin_enabled).
Hooks cannot see the session's callable tool set, so "plugin enabled in Claude
settings" is the closest proxy for "the replacement is reachable"; omp checks the
real callable set per call instead. ATLAS_MANDATES=off (exact string) disables it.

Main thread only: a payload whose transcript_path lies under /subagents/ is skipped
(an absent transcript_path is treated as main), so subagents that share the parent's
session id never re-arm the gate. State is one marker file per session id, so a session
that recalled stays satisfied for every later call; a subagent running under its OWN
session id has no marker and must recall once itself.

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
MANDATES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "contracts", "mandates.json")

# The claude-mem search tool Claude Code names for this plugin (same literal as
# session_boot.recall_mandate).
CC_ROUTE = "mcp__plugin_claude-mem_mcp-search__search"

# Server/tool names that ARE a claude-mem call (mirrors CLAUDE_MEM_SERVER in omp/mandates.ts).
_MEM_NAME = re.compile(r"claude[-_]?mem|mcp[-_]?search", re.I)
# Neither denied nor satisfying (omp `todo` is matched case-insensitively too).
_EXEMPT = ("todowrite", "todo")


def _claude_mem_enabled(cwd: str | None) -> bool:
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
    import tool_routing

    return tool_routing.plugin_enabled("claude-mem", cwd)


def _contract() -> dict | None:
    with open(MANDATES_PATH, encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        return None
    if not all(isinstance(data.get(k), str) for k in ("recallGate", "recallGateExample")):
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
        if isinstance(value, str) and value.startswith("xd://mcp__") and _MEM_NAME.search(value):
            return True
    return False


def _marker(session: str) -> str:
    return os.path.join(GATE_MARKER_DIR, "recall-" + re.sub(r"[^A-Za-z0-9_.-]", "_", session))


def _mark_recalled(session: str) -> None:
    """Record that this session made its claude-mem call (idempotent)."""
    os.makedirs(GATE_MARKER_DIR, exist_ok=True)
    with contextlib.suppress(FileExistsError):
        os.close(os.open(_marker(session), os.O_CREAT | os.O_EXCL | os.O_WRONLY))


def _decide(data: dict) -> str | None:
    """The deny reason for this call, or None to allow (fail open)."""
    try:
        tool_name = data.get("tool_name")
        session = data.get("session_id")
        if not isinstance(tool_name, str) or not isinstance(session, str) or not tool_name or not session:
            return None
        if os.environ.get("ATLAS_MANDATES") == "off":
            return None
        if "/subagents/" in str(data.get("transcript_path") or ""):
            return None
        if tool_name.lower() in _EXEMPT:
            return None
        if not _claude_mem_enabled(data.get("cwd")):
            return None
        contract = _contract()
        if contract is None:
            return None
        if _is_recall(tool_name, data.get("tool_input")):
            _mark_recalled(session)  # the recall itself: allow and satisfy the gate
            return None
        if os.path.exists(_marker(session)):
            return None  # already satisfied this session
        return contract["recallGate"].replace("{route}", CC_ROUTE).replace("{example}", contract["recallGateExample"])
    except Exception:
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
