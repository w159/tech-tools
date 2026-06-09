#!/usr/bin/env python3
"""Stop hook — the orchestrate "Definition of done" gate (opt-in).

The orchestrate skill's hardest rule is that a change is not *done* until observed
behavior is captured AND an independent agent has verified it. Prose alone does not
enforce this (the orchestrator rationalizes "I'll mark it unverified and move on").
This hook is the machine backstop.

It is **scoped**: it only engages when the working directory holds an `.orchestrator/`
state dir — i.e. an orchestrate run is actually in progress. In any other session it is
a silent no-op, so it is safe to leave installed. When a run IS active and the
orchestrator tries to stop without having captured any evidence, it blocks the stop
ONCE (the `stop_hook_active` loop-guard) and reminds it to produce the proof or say
explicitly what is unverified.

What counts as "evidence captured": at least one file under `.orchestrator/evidence/`,
OR a `findings.json` that records a `verified` entry. Either satisfies the gate — the
hook checks that *something* was observed and verified, not that the work is perfect.

Fail-open by construction: any error, missing dir, or unparseable input lets the stop
proceed. Disable entirely with ORCHESTRATE_GATE=off. Off by default — installed only
via `install_hooks.py --select completion-gate --apply`.

Stdlib only.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def _has_evidence(orch: Path) -> bool:
    """True if the run captured any observed-behavior evidence or a verified finding."""
    evidence = orch / "evidence"
    try:
        if evidence.is_dir() and any(p.is_file() for p in evidence.iterdir()):
            return True
    except OSError:
        return True  # can't read it -> don't block on our own uncertainty

    findings = orch / "findings.json"
    try:
        if findings.is_file():
            data = json.loads(findings.read_text(encoding="utf-8"))
            items = data if isinstance(data, list) else data.get("findings", [])
            for item in items if isinstance(items, list) else []:
                if (
                    isinstance(item, dict)
                    and str(item.get("status", "")).lower() == "verified"
                ):
                    return True
    except (OSError, json.JSONDecodeError, ValueError, AttributeError):
        return True  # malformed findings -> fail open
    return False


def _reason() -> str:
    return (
        "[orchestrate] Definition-of-done gate: this is an active orchestrate run "
        "(.orchestrator/ exists) but no evidence has been captured. Before stopping, do ONE of:\n"
        "  1. Capture the observed-behavior proof into .orchestrator/evidence/ "
        "(test output, DB read-back, endpoint response, or UI screenshot), and record an "
        "independent orc-verifier result in findings.json, OR\n"
        "  2. If the work is genuinely not done, say so explicitly — what is unverified and the "
        "exact command + expected output to verify it. Do not declare success.\n"
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
        cwd = data.get("cwd") or os.getcwd()
        orch = Path(cwd) / ".orchestrator"
        if not orch.is_dir():
            return 0  # not an orchestrate run -> silent no-op
        if _has_evidence(orch):
            return 0
        print(json.dumps({"decision": "block", "reason": _reason()}))
    except Exception:  # noqa: BLE001 — a Stop hook must never wedge the session
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
