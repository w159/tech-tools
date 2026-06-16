#!/usr/bin/env python3
"""Stop hook -- the orchestrate "Definition of done" gate (opt-in).

The orchestrate skill's hardest rule is that a change is not *done* until observed
behavior is captured AND an independent agent has verified it. Prose alone does not
enforce this (the orchestrator rationalizes "I'll mark it unverified and move on").
This hook is the machine backstop.

It is **scoped**: it only engages when the working directory (or a detected project
root above it) holds a `docs/` directory -- i.e. the docs/ single source of truth is
present. In any other session it is a silent no-op, so it is safe to leave installed.

Three conditions must ALL hold before the gate passes (else block ONCE):
  (a) At least one file exists under `docs/evidence/`.
  (b) `docs/.run/findings.json` exists and contains at least one entry with
      status "verified".
  (c) `docs/CHANGELOG.md` exists and is non-empty (docs-current backstop).

If any of the three are missing the hook blocks and names exactly which condition
failed and that docs/ must be current (CHANGELOG, ROADMAP, affected subfolders)
before calling the work done.

Fail-open by construction: any error, missing dir, or unparseable input lets the
stop proceed. Disable entirely with ORCHESTRATE_GATE=off. Off by default -- installed
only via `install_hooks.py --select completion-gate --apply`.

Stdlib only.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def _find_docs(start: Path) -> Path | None:
    """Walk from start toward the filesystem root; return the first `docs/` dir found.

    Stops at the filesystem root or after 6 levels to stay cheap and fail-open.
    """
    candidate = start
    for _ in range(7):
        docs = candidate / "docs"
        if docs.is_dir():
            return docs
        parent = candidate.parent
        if parent == candidate:
            break
        candidate = parent
    return None


def _check_evidence(docs: Path) -> bool:
    """(a) At least one file under docs/evidence/."""
    evidence = docs / "evidence"
    try:
        return evidence.is_dir() and any(p.is_file() for p in evidence.iterdir())
    except OSError:
        return True  # can't read -> fail open


def _check_findings(docs: Path) -> bool:
    """(b) docs/.run/findings.json has at least one entry with status 'verified'."""
    findings = docs / ".run" / "findings.json"
    try:
        if not findings.is_file():
            return False
        data = json.loads(findings.read_text(encoding="utf-8"))
        items = data if isinstance(data, list) else data.get("findings", [])
        for item in items if isinstance(items, list) else []:
            if (
                isinstance(item, dict)
                and str(item.get("status", "")).lower() == "verified"
            ):
                return True
        return False
    except (OSError, json.JSONDecodeError, ValueError, AttributeError):
        return True  # malformed -> fail open


def _check_changelog(docs: Path) -> bool:
    """(c) docs/CHANGELOG.md exists and is non-empty."""
    changelog = docs / "CHANGELOG.md"
    try:
        return changelog.is_file() and changelog.stat().st_size > 0
    except OSError:
        return True  # can't stat -> fail open


def _reason(missing_a: bool, missing_b: bool, missing_c: bool) -> str:
    parts = []
    if missing_a:
        parts.append(
            "  (a) No files found under docs/evidence/. Capture observed-behavior proof "
            "(test output, DB read-back, endpoint response, or UI screenshot) there first."
        )
    if missing_b:
        parts.append(
            "  (b) docs/.run/findings.json is missing or has no entry with status "
            '"verified". Record an independent orc-verifier result before stopping.'
        )
    if missing_c:
        parts.append(
            "  (c) docs/CHANGELOG.md is missing or empty. docs/ must be current -- "
            "update CHANGELOG.md (and ROADMAP/affected subfolders) to reflect this run."
        )
    failed = "\n".join(parts)
    return (
        "[orchestrate] Definition-of-done gate: the following condition(s) are not met:\n"
        + failed
        + "\n\nAll three must hold before this run can be declared done. "
        "If the work is genuinely not done, say so explicitly -- what is unverified "
        "and the exact command + expected output to verify it. Do not declare success.\n"
        '"Unverified" is not a completion state. A diff or a file:line is not proof that it works.'
    )


def main() -> int:
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, ValueError):
        return 0
    try:
        if os.environ.get("ORCHESTRATE_GATE", "").lower() == "off":
            return 0
        # Loop guard: never re-block a continuation we already triggered.
        if data.get("stop_hook_active"):
            return 0
        cwd = Path(data.get("cwd") or os.getcwd())
        docs = _find_docs(cwd)
        if docs is None:
            return 0  # no docs/ dir in tree -> not an orchestrate run -> silent no-op
        ok_a = _check_evidence(docs)
        ok_b = _check_findings(docs)
        ok_c = _check_changelog(docs)
        if ok_a and ok_b and ok_c:
            return 0
        print(
            json.dumps(
                {"decision": "block", "reason": _reason(not ok_a, not ok_b, not ok_c)}
            )
        )
    except Exception:  # noqa: BLE001 -- a Stop hook must never wedge the session
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
