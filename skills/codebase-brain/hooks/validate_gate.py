#!/usr/bin/env python3
"""Stop hook — a self-validation gate against unverified completion claims.

This targets the single most common agent failure: announcing "fixed / done / it
works" without having run anything. When the agent's final message makes a
completion claim but shows NO evidence (no command run, no test result, no
file:line, no observed output), this blocks the stop ONCE and asks the agent to
either show the evidence or downgrade the claim.

It fires at most once per stop chain (the `stop_hook_active` loop guard), only on a
bare claim, and is fully fail-safe — any error, or no claim, lets the stop proceed.
Disable with CODEBASE_BRAIN_GATE=off.

Evidence-before-assertions, distilled from the audit-integrity / quality-gate
patterns: a claim with no locator or observed result is unverified by definition.

Stdlib only.
"""

from __future__ import annotations

import json
import os
import re
import sys

# Bare completion claims — the language that should never appear without proof.
CLAIM = re.compile(
    r"\b("
    r"fixed|resolved|it works|now works|is working|works now|"
    r"should (?:work|be fixed|do it)|that should do it|good to go|all set|"
    r"ready to merge|task (?:is )?complete|successfully (?:fixed|implemented|completed)"
    r")\b",
    re.IGNORECASE,
)

# Signals that the claim is backed by observed reality — any one suppresses the gate.
EVIDENCE = re.compile(
    r"("
    r"\bran\b|\bexecuted\b|\bverified\b|\bobserved\b|\bconfirmed\b|"
    r"\btests?\s+(?:pass|passed|passing|green)\b|\bpassing\b|\ball green\b|"
    r"\b\d+\s+passed\b|\bexit code\b|\boutput:|"
    r"[\w/.\-]+\.[a-z]{1,4}:\d+|"  # file:line locator
    r"```|"  # a code / output block
    r"\$\s|\bPASS\b|\bFAIL\b|✓|✅"
    r")",
    re.IGNORECASE,
)


def verdict(message: str) -> str | None:
    """Return a block-reason if the message is an unverified claim, else None."""
    if not isinstance(message, str) or not message.strip():
        return None
    if not CLAIM.search(message):
        return None
    if EVIDENCE.search(message):
        return None
    return (
        "[codebase-brain] Self-validation gate: you claimed completion without showing "
        "evidence. Before finishing, do ONE of:\n"
        "  1. Run it and paste the actual command + output (the proof), OR\n"
        "  2. Cite the file:line / test result that confirms it, OR\n"
        "  3. Downgrade the claim — say explicitly what is NOT yet verified and how to verify it "
        "(exact command + expected output).\n"
        "Also check it against any committed invariants (.agents/knowledge/invariants.md). "
        '"Looks fine" / "should work" is not evidence.'
    )


def main() -> int:
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, ValueError):
        return 0
    if os.environ.get("CODEBASE_BRAIN_GATE", "").lower() == "off":
        return 0
    # Loop guard: never re-block a continuation we already triggered.
    if data.get("stop_hook_active"):
        return 0
    reason = verdict(data.get("last_assistant_message") or "")
    if not reason:
        return 0
    print(json.dumps({"decision": "block", "reason": reason}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
