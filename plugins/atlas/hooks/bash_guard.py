#!/usr/bin/env python3
"""PreToolUse hook - guard against destructive Bash commands.

Inspects the command a Bash tool call is about to run and returns a permission decision:
  * "deny" for catastrophic, near-irreversible commands (recursive root delete, fork bomb,
    disk overwrite, filesystem format).
  * "ask"  for the rare, hard-to-undo commands worth a deliberate pause
    (force push, piping the network into a shell, privilege escalation).
Anything else: no output, exit 0 - the normal permission flow proceeds untouched.

This encodes the atlas-engine skill's "gate writes" law as an automatic backstop so a
runaway subagent (or a careless paste) cannot quietly do something irreversible.

Wire it up (settings.json):
  "PreToolUse": [
    { "matcher": "Bash",
      "hooks": [ { "type": "command",
                   "command": "python3 ~/.claude/hooks/bash_guard.py" } ] }
  ]

Stdlib only.
"""

from __future__ import annotations

import json
import re
import sys

# (compiled pattern, human reason). Order matters only for which reason is reported first.
DENY = [
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
    (re.compile(r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:"), "fork bomb"),
    (re.compile(r"\bmkfs(\.\w+)?\b"), "filesystem format"),
    (re.compile(r"\bdd\b.*\bof=/dev/(disk|sd|nvme|hd)"), "raw write to a disk device"),
    (re.compile(r">\s*/dev/(sd|nvme|hd|disk)\w*"), "redirect over a disk device"),
    (
        re.compile(r"\bchmod\s+(-[a-zA-Z]*\s+)*-?R[a-zA-Z]*\s+0?777\s+/(\s|$)"),
        "world-writable chmod on /",
    ),
]

# Balanced ASK list: only high-blast-radius commands that are rare in normal dev work.
# Routine, state-mutating-but-recoverable commands (dependency installs, plain git push,
# hard reset, git clean, recursive chmod/chown, generic rm -rf) were removed - they fired
# on nearly every command in active repos and produced approval fatigue. The normal Claude
# Code permission prompt still gates those; this hook reserves a forced "ask" for the cases
# where a single keystroke is genuinely costly to undo.
ASK = [
    (
        re.compile(
            r"\bgit\s+push\b.*(--force\b|--force-with-lease\b|(\s|^)-[a-zA-Z]*f)"
        ),
        "force push",
    ),
    (
        re.compile(r"\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba)?sh\b"),
        "piping the network straight into a shell",
    ),
    (re.compile(r"(^|\s)sudo\s"), "privilege escalation"),
]


def decide(command: str) -> tuple[str, str] | None:
    for pat, reason in DENY:
        if pat.search(command):
            return "deny", reason
    for pat, reason in ASK:
        if pat.search(command):
            return "ask", reason
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
    verdict = decide(command)
    if not verdict:
        return 0  # nothing risky -> let the normal permission flow run
    decision, reason = verdict
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": decision,
                    "permissionDecisionReason": f"[orchestrate guard] {reason}.",
                }
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
