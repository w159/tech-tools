#!/usr/bin/env python3
"""PreToolUse hook -- advisory-only Bash safety advisor.

Inspects the command a Bash tool call is about to run. On a catastrophic match it
emits additionalContext with a factual warning; on everything else it exits silently.

It NEVER emits permissionDecision and NEVER exits with a non-zero status that would
deny or force-ask on a tool call. The normal Claude Code permission flow is always
preserved.

Catastrophic patterns detected (near-irreversible, high blast radius):
  - Recursive force-delete of a root/home path (rm -rf /, rm -rf ~, etc.)
  - Fork bomb  (:(){ :|:& };:)
  - Filesystem format  (mkfs)
  - Raw write to a disk device  (dd of=/dev/...)
  - Redirect over a disk device  (> /dev/sd...)
  - World-writable chmod on /  (chmod -R 0777 /)

All other commands: silent no-op, exit 0.

Stdlib only. Fail-open by construction: any parse or runtime error exits 0.
"""

from __future__ import annotations

import json
import re
import sys

# (compiled pattern, human reason). Order only affects which reason is reported first.

# A flag token: a long option (--recursive, --force, --foo) or a short cluster (-rf, -r).
_RM_FLAG = r"(?:--[a-z-]+|-[a-zA-Z]+)"

_CATASTROPHIC = [
    (
        re.compile(
            r"\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+(/|/\*|~|\$HOME|\"?\$\{HOME\}\"?)(\s|$)"
        ),
        "recursive force-delete of a root/home path",
    ),
    (
        re.compile(
            r"\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*\s+(/|/\*|~|\$HOME)(\s|$)"
        ),
        "recursive force-delete of a root/home path",
    ),
    # Long-flag and mixed forms (e.g. "rm --recursive --force /", "rm -r --force /").
    # Two bounded lookaheads confirm a recursive flag and a force flag appear among the
    # leading flag tokens; the lookaheads only consume flag tokens (each - prefixed), so
    # they cannot scan past the target into a later command. Then flag tokens are consumed
    # and the catastrophic root/home target is matched.
    (
        re.compile(
            r"\brm\s+"
            r"(?=(?:" + _RM_FLAG + r"\s+)*(?:--recursive|-[a-zA-Z]*r[a-zA-Z]*))"
            r"(?=(?:" + _RM_FLAG + r"\s+)*(?:--force|-[a-zA-Z]*f[a-zA-Z]*))"
            r"(?:" + _RM_FLAG + r"\s+)+"
            r"(/|/\*|~|\$HOME|\"?\$\{HOME\}\"?)(\s|$)"
        ),
        "recursive force-delete of a root/home path",
    ),
    (re.compile(r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:"), "fork bomb"),
    (re.compile(r"\bmkfs(\.\w+)?\b"), "filesystem format"),
    (re.compile(r"\bdd\b.*\bof=/dev/(disk|sd|nvme|hd)"), "raw write to a disk device"),
    (re.compile(r">\s*/dev/(sd|nvme|hd|disk)\w*"), "redirect over a disk device"),
    (
        re.compile(r"\bchmod\s+(-[a-zA-Z]*\s+)*-?R[a-zA-Z]*\s+0?777\s+/(\s|$)"),
        "world-writable chmod on /",
    ),
]


def _match_catastrophic(command: str) -> str | None:
    """Return the human reason string if the command matches a catastrophic pattern."""
    for pat, reason in _CATASTROPHIC:
        if pat.search(command):
            return reason
    return None


def main() -> int:
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, ValueError):
        return 0

    if data.get("tool_name") not in (None, "Bash"):
        return 0

    command = (data.get("tool_input") or {}).get("command") or ""
    if not isinstance(command, str) or not command.strip():
        return 0

    reason = _match_catastrophic(command)
    if reason is None:
        return 0  # benign command -- no output, normal flow continues

    # Advisory only: additionalContext, no permissionDecision field.
    warning = (
        f"[atlas advisor] This command matches a catastrophic, near-irreversible pattern "
        f"({reason}). Confirm intent before running."
    )
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "additionalContext": warning,
                }
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
