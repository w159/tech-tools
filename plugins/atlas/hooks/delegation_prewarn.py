#!/usr/bin/env python3
"""PostToolUse hook: pre-warn the lead, once per session, at its first inline
code edit that completion_gate condition (m) (delegation mandate) will block
at Stop. Uses the gate's own predicate; never changes what (m) blocks.

Silent for workers (subagent transcripts), docs/exempt paths, solo mode,
ATLAS_GATE=off, and every error (fail open). Stdlib only.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
import atlas_env  # noqa: E402
atlas_env.apply_store_env()

MSG = (
    "[atlas] This inline edit of non-docs code will trip the completion gate's "
    "(m) delegation mandate at Stop. Dispatch an atlas:implementer for it now "
    "(TOOLS block with ToolSearch + a code-nav tool), or the gate will block."
)


def _marker(session_id: str) -> Path:
    safe = (
        "".join(c for c in session_id if c.isalnum() or c in "-_")[:80] or "nosession"
    )
    return Path(_temp_root()) / f"atlas-delegation-prewarn-{safe}"


def _temp_root() -> str:
    """tempfile.gettempdir() without the 9ms tempfile import: TMPDIR/TEMP/TMP, else /tmp."""
    if os.name != "posix":
        import tempfile

        return tempfile.gettempdir()
    for var in ("TMPDIR", "TEMP", "TMP"):
        value = os.environ.get(var)
        if value:
            return os.path.abspath(value)
    return "/tmp"


def _cheap_reject(payload: dict) -> bool:
    """The pure checks, run before the heavy completion_gate import."""
    if os.environ.get("ATLAS_GATE", "").lower() == "off":
        return True
    # agent_id is the documented subagent marker; the path is the pre-field fallback.
    if payload.get("agent_id") or "/subagents/" in str(
        payload.get("transcript_path") or ""
    ).replace("\\", "/"):
        return True
    return payload.get("tool_name") not in {"Edit", "Write", "MultiEdit", "NotebookEdit"}


def should_warn(payload: dict) -> bool:
    if _cheap_reject(payload):
        return False
    import completion_gate as cg

    if cg._solo_mode():
        return False
    path = str((payload.get("tool_input") or {}).get("file_path") or "")
    exempt = cg._delegation_exempt()
    if not path or exempt is None or cg.is_uri_path(path):
        return False
    return cg._is_delegation_code(path, *exempt)


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read(), strict=False)
        if _cheap_reject(payload):
            return 0
        marker = _marker(str(payload.get("session_id") or ""))
        if marker.exists():
            return 0  # already warned this session: skip the completion_gate import
        if not should_warn(payload):
            return 0
        marker.touch()
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PostToolUse",
                        "additionalContext": MSG,
                    }
                }
            )
        )
    except Exception:
        pass  # fail open: a broken warning must never block an edit
    return 0


if __name__ == "__main__":
    sys.exit(main())
