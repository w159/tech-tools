#!/usr/bin/env python3
"""PreToolUse hook -- Fallow agent gate for git commit and git push.

Mirrors fallow's official agent gate (docs.fallow.tools/integrations/claude-hooks):
when Claude Code is about to run `git commit` or `git push`, run
`fallow audit --format json --quiet --explain --gate-marker agent` and deny the
tool call when the verdict is fail. pass/warn proceed. Runtime errors fail open
with a single stderr notice so skips stay visible.

This is the atlas-shipped form of Option C (local agent gate). It lives in the
plugin so every atlas install gets the gate without each user running
`fallow hooks install --target agent`. Prefer this over a second project-level
fallow-gate.sh; both would double-audit if present.

Stdlib only. Requires the fallow CLI on PATH (or a working
`npx --no-install fallow`). Absent fallow -> silent skip (fail-open). Disable
with ATLAS_FALLOW=off. Version floor via FALLOW_GATE_MIN_VERSION (default
2.85.0) matches fallow's --gate-marker agent requirement.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from typing import Any

# Default matches fallow's gate floor (gate-marker agent landed in v2.85.0).
_DEFAULT_MIN_VERSION = "2.85.0"

# git commit / git push as a whole token, not as a substring of something else.
_GIT_GATE_RE = re.compile(
    r"(^|[\s;|&()])git\s+(commit|push)([\s;|&()]|$)"
)


def _env_off(name: str) -> bool:
    return os.environ.get(name, "on").strip().lower() in (
        "0",
        "off",
        "false",
        "no",
        "disabled",
    )


def _parse_payload(raw: str) -> dict[str, Any]:
    try:
        data = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _command_from(payload: dict[str, Any]) -> str:
    if payload.get("tool_name") not in (None, "Bash"):
        return ""
    command = (payload.get("tool_input") or {}).get("command") or ""
    return command if isinstance(command, str) else ""


def _is_git_commit_or_push(command: str) -> bool:
    return bool(_GIT_GATE_RE.search(command))


def _version_tuple(text: str) -> tuple[int, ...] | None:
    """Parse leading X.Y.Z from a version string; None if unusable."""
    m = re.match(r"(\d+)(?:\.(\d+))?(?:\.(\d+))?", text.strip())
    if not m:
        return None
    parts = [int(p) for p in m.groups() if p is not None]
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])


def _below_floor(version: str, floor: str) -> bool:
    v = _version_tuple(version)
    f = _version_tuple(floor)
    if v is None or f is None:
        return False  # cannot compare -> do not block on floor
    return v < f


def _resolve_runner() -> tuple[list[str], str] | None:
    """Return (argv_prefix, description) for invoking fallow, or None."""
    path = shutil.which("fallow")
    if path:
        return [path], path
    npx = shutil.which("npx")
    if not npx:
        return None
    # Prefer a local install without network; match official gate's probe.
    try:
        probe = subprocess.run(
            [npx, "--no-install", "fallow", "--version"],
            capture_output=True,
            text=True,
            timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    out = (probe.stdout or "") + (probe.stderr or "")
    if probe.returncode != 0 or "fallow" not in out.lower():
        return None
    return [npx, "--no-install", "fallow"], "npx --no-install fallow"


def _fallow_version(runner: list[str]) -> str:
    try:
        res = subprocess.run(
            runner + ["--version"],
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    raw = (res.stdout or res.stderr or "").strip()
    # "fallow 2.85.0" or just "2.85.0"
    if raw.lower().startswith("fallow"):
        raw = raw[6:].strip()
    return raw.split()[0] if raw else ""


def _run_audit(runner: list[str], cwd: str | None) -> tuple[int, dict[str, Any], str]:
    """Run fallow audit. Returns (exit_code, parsed_json_or_empty, stderr_text)."""
    try:
        res = subprocess.run(
            runner
            + [
                "audit",
                "--format",
                "json",
                "--quiet",
                "--explain",
                "--gate-marker",
                "agent",
            ],
            capture_output=True,
            text=True,
            timeout=300,
            cwd=cwd or None,
        )
    except subprocess.TimeoutExpired:
        return 124, {}, "fallow audit timed out"
    except OSError as exc:
        return 127, {}, str(exc)

    parsed: dict[str, Any] = {}
    stdout = (res.stdout or "").strip()
    if stdout:
        try:
            data = json.loads(stdout)
            if isinstance(data, dict):
                parsed = data
        except json.JSONDecodeError:
            parsed = {}
    return res.returncode, parsed, (res.stderr or "").strip()


def _deny(reason: str) -> None:
    # Documented Claude Code PreToolUse block form (same as dispatch_tripwire).
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


def _notice(msg: str) -> None:
    try:
        sys.stderr.write(msg if msg.endswith("\n") else msg + "\n")
    except Exception:
        pass


def main() -> int:
    if _env_off("ATLAS_FALLOW"):
        return 0

    payload = _parse_payload(sys.stdin.read())
    command = _command_from(payload)
    if not command or not _is_git_commit_or_push(command):
        return 0

    resolved = _resolve_runner()
    if resolved is None:
        _notice(
            "fallow-gate: fallow binary not found (tried PATH and npx --no-install), "
            "skipping audit."
        )
        return 0

    runner, bin_desc = resolved
    version = _fallow_version(runner)
    min_version = os.environ.get("FALLOW_GATE_MIN_VERSION", _DEFAULT_MIN_VERSION)
    # Empty string disables the floor (official gate behavior).
    if min_version.strip() and version and _below_floor(version, min_version):
        _deny(
            "fallow-gate: blocked: %s is fallow %s, below required %s. "
            "Older binaries reject --gate-marker agent (added in fallow v2.85.0), "
            "so the audit cannot run. Upgrade fallow (npm install -g fallow@latest "
            "or cargo install fallow-cli), or set FALLOW_GATE_MIN_VERSION= to disable, "
            "or ATLAS_FALLOW=off to skip this atlas gate."
            % (bin_desc, version, min_version.strip())
        )
        return 0

    cwd = payload.get("cwd") if isinstance(payload.get("cwd"), str) else None
    status, data, err = _run_audit(runner, cwd)
    verdict = str(data.get("verdict") or "").lower()
    is_error = data.get("error") is True

    if verdict == "fail":
        # Keep the reason bounded; full JSON still helps the agent fix and retry.
        body = json.dumps(data, indent=2) if data else "(no JSON body)"
        if len(body) > 12000:
            body = body[:12000] + "\n... [truncated]"
        _deny(
            "fallow-gate: blocked by fallow %s at %s\n%s"
            % (version or "unknown", bin_desc, body)
        )
        return 0

    if status == 2 or is_error:
        msg = data.get("message") if isinstance(data.get("message"), str) else ""
        if msg:
            _notice("fallow-gate: fallow audit runtime error (%s), skipping." % msg)
        else:
            _notice("fallow-gate: fallow audit runtime error, skipping.")
        return 0

    if status != 0:
        detail = err.splitlines()[0] if err else ""
        if detail:
            _notice(
                "fallow-gate: fallow audit exited %s (%s), skipping." % (status, detail)
            )
        else:
            _notice("fallow-gate: fallow audit exited %s, skipping." % status)
        return 0

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as exc:
        # fail-open: never wedge a commit/push on hook internals
        try:
            sys.stderr.write("[atlas] fallow_gate fail-open: %s\n" % exc)
        except Exception:
            pass
        raise SystemExit(0)
