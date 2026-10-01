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

Ponytail-before-commit mandate: a `git commit` (see _match_git_commit) gets a
one-time-per-session nudge to run ponytail-review on the staged diff, armed only
when the ponytail plugin is enabled (tool_routing.plugin_enabled). The omp twin is
omp/mandates.ts with the identical parse contract. ATLAS_MANDATES=off disables it.

All other commands: silent no-op, exit 0.

Stdlib only. Fail-open by construction: any parse or runtime error exits 0.
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile

# One-time marker dir for the commit nudge (tests point this at a temp dir).
MANDATE_MARKER_DIR = os.path.join(tempfile.gettempdir(), "atlas-mandates")

# Shared mandate contract (also read by omp/mandates.ts); unreadable -> no nudge.
MANDATES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "contracts", "mandates.json")


def _mandates() -> dict:
    try:
        with open(MANDATES_PATH) as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}

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


_SEGMENT_SPLIT = re.compile(r"&&|\|\||;|\|")
_ENV_ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
_GIT_VALUE_OPTS = ("-C", "-c")
_GIT_EQ_OPTS = ("--git-dir=", "--work-tree=", "--exec-path=", "--namespace=")


def _match_git_commit(command: str) -> bool:
    """True when some shell segment runs `git [global opts] commit`.

    Parse contract (mirrored by omp/mandates.ts): split on && || ; |, skip leading
    NAME=value assignments, the first token must be `git` (or a path ending /git),
    consume -C <v>, -c <v>, --git-dir=/--work-tree=/--exec-path=/--namespace= and a
    bare `--`; the next token must be exactly `commit`. So `git commit-tree`,
    `echo git commit` and `git stash commit` are not commits; `git commit --amend` is.
    """
    import shlex

    for segment in _SEGMENT_SPLIT.split(command or ""):
        try:
            tokens = shlex.split(segment)
        except ValueError:
            tokens = segment.split()
        while tokens and _ENV_ASSIGN.match(tokens[0]):
            tokens = tokens[1:]
        if not tokens or not (tokens[0] == "git" or tokens[0].endswith("/git")):
            continue
        i = 1
        while i < len(tokens):
            tok = tokens[i]
            if tok in _GIT_VALUE_OPTS:
                i += 2
            elif tok == "--" or tok.startswith(_GIT_EQ_OPTS):
                i += 1
            else:
                break
        if i < len(tokens) and tokens[i] == "commit":
            return True
    return False


def _ponytail_installed(root: str | None = None) -> bool:
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
        import tool_routing

        return tool_routing.plugin_enabled("ponytail", root)
    except Exception:
        return False


def _commit_nudge(data: dict, command: str) -> str | None:
    """The one-time ponytail nudge for this session, or None (fail open)."""
    try:
        if os.environ.get("ATLAS_MANDATES") == "off" or not _match_git_commit(command):
            return None
        session = str(data.get("session_id") or "")
        if not session or not _ponytail_installed(data.get("cwd")):
            return None
        safe = re.sub(r"[^A-Za-z0-9_.-]", "_", session)
        os.makedirs(MANDATE_MARKER_DIR, exist_ok=True)
        marker = os.path.join(MANDATE_MARKER_DIR, f"ponytail-{safe}")
        try:
            fd = os.open(marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            return None
        os.close(fd)
        return _mandates().get("commitNudge") or None
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

    if data.get("tool_name") not in (None, "Bash"):
        return 0

    command = (data.get("tool_input") or {}).get("command") or ""
    if not isinstance(command, str) or not command.strip():
        return 0

    reason = _match_catastrophic(command)
    if reason is None:
        warning = _commit_nudge(data, command)
        if warning is None:
            return 0  # benign command -- no output, normal flow continues
    else:
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
