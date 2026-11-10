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

import os
import sys

# json is imported where it is used (not at module level) so the prefilter below can exit before it.
# typing is not imported (1.7 ms): annotations are strings under __future__, and the
# JSON payload values are plain `object` here.

# re, shutil, subprocess and bash_advisor (tempfile, ~15 regexes) are imported inside
# the functions that need them: nearly every call is not a git commit/push and
# returns from main() before any of them is used (~20 ms of cold-start import).

# Default matches fallow's gate floor (gate-marker agent landed in v2.85.0).
_DEFAULT_MIN_VERSION = "2.85.0"

_GATED_SUBCOMMANDS = ("commit", "push")
_RAW: str | None = None  # stdin as the prefilter read it; main() reuses it instead of reading again


# Mirrors atlas_hook_guard._STR_FIELDS (pinned by hooks/test_fallow_prefilter.py): a payload with any
# of these wrong-typed is a fault row, so the prefilter leaves it to the full path.
_PAYLOAD_STR_FIELDS = (
    "session_id",
    "cwd",
    "transcript_path",
    "tool_name",
    "hook_event_name",
    "prompt",
    "last_assistant_message",
    "agent_type",
    "agent_id",
)


def _scan_json(raw: str) -> object:
    """json.loads(raw, strict=False) through the C scanner alone: `import json` costs ~7 ms of re
    compilation this process cannot spend. Raises on anything json.loads would reject (the caller then
    leaves the payload to the full path)."""
    import _json

    class _Ctx:
        strict = False
        object_hook = None
        object_pairs_hook = None
        array_hook = None  # Python 3.15's C scanner reads this attribute; older ones ignore it
        parse_float = float
        parse_int = int

        @staticmethod
        def parse_constant(name: str) -> float:
            return float(name.replace("Infinity", "inf"))

    scan = _json.make_scanner(_Ctx())
    n = len(raw)
    i = 0
    while i < n and raw[i] in " \t\n\r":
        i += 1
    obj, end = scan(raw, i)
    while end < n and raw[end] in " \t\n\r":
        end += 1
    if end != n:
        raise ValueError("extra data")
    return obj


def _prefilter_skips(raw: str | None) -> bool:
    """True only when running the full gate on `raw` would do nothing at all: empty stdin, or a
    well-formed payload whose decoded tool_input.command holds no "git" (the gate's own first test,
    _is_git_commit_or_push). Every other case returns False and the full gate runs: any "git" in the
    command (git commit/push/merge/rebase/cherry-pick/am, `bash -c`/`sh -c` wrappers, aliases,
    path-qualified binaries), a payload that does not parse, is not an object or has a wrong-typed
    field (the full path writes the fault row), an unreadable stdin. Stdlib only; runs before atlas_env
    and atlas_hook_guard are imported."""
    if raw is None:
        return False
    if not raw.strip():
        return True  # load_payload: empty stdin is {} quietly
    try:
        data = _scan_json(raw)
        if not isinstance(data, dict):
            return False
        for key in _PAYLOAD_STR_FIELDS:
            val = data.get(key)
            if val is not None and not isinstance(val, str):
                return False
        tinput = data.get("tool_input")
        if tinput is None:
            return True
        if not isinstance(tinput, dict):
            return False
        command = tinput.get("command")
        if command is None:
            return True
        return isinstance(command, str) and "git" not in command
    except Exception:  # noqa: BLE001 -- unsure: run the gate
        return False


if __name__ == "__main__":
    try:
        _RAW = sys.stdin.read()
    except Exception:  # noqa: BLE001 -- let main() meet the same error through load_payload
        _RAW = None
    if _prefilter_skips(_RAW):
        raise SystemExit(0)

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
sys.path.insert(0, os.path.join(_HERE, "..", "scripts"))
import atlas_env  # noqa: E402
atlas_env.apply_store_env()
import atlas_hook_guard  # noqa: E402

# Worst case in-hook time: npx probe + version probe + audit must stay under the
# hooks.json timeout for this hook (300s), or the harness kills us before the
# fail-open path returns. F13: the audit is capped at 60s - a hung `fallow audit`
# used to burn 240s on EVERY commit/push before the fail-open notice.
_NPX_PROBE_TIMEOUT = 3
# A "fallow not installed" probe result is cached so later commits skip the npx
# probe entirely instead of paying its timeout on every git commit/push.
_NEGATIVE_TTL = 600
_VERSION_TIMEOUT = 15
_AUDIT_TIMEOUT = 60

def _env_off(name: str) -> bool:
    return os.environ.get(name, "on").strip().lower() in (
        "0",
        "off",
        "false",
        "no",
        "disabled",
    )


def _command_from(payload: dict[str, object]) -> str:
    if payload.get("tool_name") not in (None, "Bash"):
        return ""
    command = (payload.get("tool_input") or {}).get("command") or ""
    return command if isinstance(command, str) else ""


def _is_git_commit_or_push(command: str) -> bool:
    if (
        "git" not in command
    ):  # _git_subcommands yields nothing without it: skip the import
        return False
    from bash_advisor import _git_subcommands  # one git parser for both hooks

    return any(sub in _GATED_SUBCOMMANDS for sub in _git_subcommands(command))


def _version_tuple(text: str) -> tuple[int, ...] | None:
    """Parse leading X.Y.Z from a version string; None if unusable."""
    import re

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


def _negative_path() -> str:
    return os.path.join(atlas_hook_guard._state_dir(), "fallow_gate_absent")


def _negative_cached() -> bool:
    """True when a recent probe found no npx-resolvable fallow (fail-open cache)."""
    import time

    try:
        return time.time() - os.path.getmtime(_negative_path()) < _NEGATIVE_TTL
    except OSError:
        return False


def _negative_store() -> None:
    try:
        path = _negative_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            fh.write("1")
    except OSError:
        pass


def _resolve_runner() -> tuple[list[str], str] | None:
    """Return (argv_prefix, description) for invoking fallow, or None."""
    import shutil
    import subprocess

    path = shutil.which("fallow")
    if path:
        return [path], path
    npx = shutil.which("npx")
    if not npx:
        return None
    if _negative_cached():
        return None
    # Prefer a local install without network; match official gate's probe.
    try:
        probe = subprocess.run(
            [npx, "--no-install", "fallow", "--version"],
            capture_output=True,
            text=True,
            timeout=_NPX_PROBE_TIMEOUT,
        )
    except (OSError, subprocess.TimeoutExpired):
        _negative_store()
        return None
    out = (probe.stdout or "") + (probe.stderr or "")
    if probe.returncode != 0 or "fallow" not in out.lower():
        _negative_store()
        return None
    return [npx, "--no-install", "fallow"], "npx --no-install fallow"


def _fallow_version(runner: list[str]) -> str:
    import subprocess

    try:
        res = subprocess.run(
            runner + ["--version"],
            capture_output=True,
            text=True,
            timeout=_VERSION_TIMEOUT,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    raw = (res.stdout or res.stderr or "").strip()
    # "fallow 2.85.0" or just "2.85.0"
    if raw.lower().startswith("fallow"):
        raw = raw[6:].strip()
    return raw.split()[0] if raw else ""


def _run_audit(
    runner: list[str], cwd: str | None
) -> tuple[int, dict[str, object], str]:
    """Run fallow audit. Returns (exit_code, parsed_json_or_empty, stderr_text)."""
    import subprocess

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
            timeout=_AUDIT_TIMEOUT,
            cwd=cwd or None,
        )
    except subprocess.TimeoutExpired:
        return 124, {}, "fallow audit timed out"
    except OSError as exc:
        return 127, {}, str(exc)

    import json

    parsed: dict[str, object] = {}
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
    import json

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

    payload = atlas_hook_guard.load_payload("fallow_gate", _RAW)
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
        import json

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

    if not verdict:
        # F13: rc 0 with an unparseable (or absent) JSON verdict used to pass
        # SILENTLY - a lost fail verdict is an enforcement hole. Say so.
        _notice(
            "fallow-gate: fallow audit exited 0 but returned no parsable JSON "
            "verdict; skipping this audit (fail-open). A fail verdict may have "
            "been lost to a parse error - re-run `fallow audit --format json --quiet "
            "--explain --gate-marker agent` to see it."
        )
        return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(atlas_hook_guard.run_hook("fallow_gate", main))
