#!/usr/bin/env python3
"""UserPromptSubmit hook: nudge toward a relevant Pragmatic Programmer concept.

This is a deterministic command hook, not a prompt hook, because prompt
hooks cannot do what this needs. Per the Claude Code docs
(https://code.claude.com/docs/en/hooks.md, "Prompt-based hooks > Response
schema"), a prompt hook's LLM call can only return {"ok": bool, "reason":
str} - it has no way to emit hookSpecificOutput/additionalContext. On
UserPromptSubmit, ok: false ends the turn and shows "reason" to the user as
"Operation stopped by hook". The former prompt hook here asked the model to
return additionalContext or {}, which that schema cannot express, so the
model fell back to ok: false with its reasoning as the block message -
silently blocking subagent hand-backs, task notifications, and meta
questions about Claude Code itself.

A command hook has no such restriction: printing
{"hookSpecificOutput": {"hookEventName": "UserPromptSubmit",
"additionalContext": "..."}} to stdout on exit 0 injects context without
ever being able to block the turn. This script is deliberately silent
(prints nothing) whenever it does not match, and never exits nonzero.
"""

import json
import re
import sys
from pathlib import Path

CONCEPTS_DIR = (
    Path(__file__).resolve().parent.parent
    / "skills"
    / "tpp-principles"
    / "references"
    / "concepts"
)

# Ordered (keywords, concept filename, reason). First match wins, so more
# specific domains are listed before broader ones that would otherwise
# shadow them (e.g. "tdd" before generic "test").
DOMAIN_MAP = [
    (
        ("tdd", "red green refactor", "write test first"),
        "test-driven-development.md",
        "tests before implementation code",
    ),
    (
        ("property-based", "hypothesis", "fast-check"),
        "property-based-testing.md",
        "generated cases over hand-picked examples",
    ),
    (
        ("concurrency", "async", "thread", "parallel", "race condition", "race"),
        "shared-state.md",
        "shared mutable state under concurrency",
    ),
    (
        ("state machine", "fsm"),
        "finite-state-machine.md",
        "explicit states and transitions beat ad hoc flags",
    ),
    (
        ("debug", "bug", "reproduce", "root cause", "crash"),
        "debugging.md",
        "reproduce and understand before changing code",
    ),
    (
        ("error", "exception", "fail", "assert", "swallow error", "empty catch"),
        "crash-early.md",
        "fail fast and loud instead of limping on",
    ),
    (
        ("duplicate", "repeat", "copy-paste", "same code"),
        "dry-dont-repeat-yourself.md",
        "one authoritative source for each piece of knowledge",
    ),
    (
        ("coupling", "dependency", "train wreck", "demeter", "decouple"),
        "decoupling.md",
        "reduce how much one module needs to know about another",
    ),
    (
        ("inheritance", "extends", "subclass"),
        "inheritance-tax.md",
        "composition often beats a deep class hierarchy",
    ),
    (
        ("refactor", "restructuring"),
        "refactoring.md",
        "improve structure without changing behavior",
    ),
    (
        ("security", "attack", "exploit", "vulnerability", "auth", "permission"),
        "attack-surface.md",
        "minimize what an attacker can reach",
    ),
    (
        ("contract", "precondition", "postcondition", "invariant"),
        "design-by-contract.md",
        "make the function's promises explicit",
    ),
    (
        ("resource", "leak", "open close", "acquire release"),
        "resource-balancing.md",
        "pair every acquire with a release",
    ),
    (
        ("pubsub", "publish", "subscribe", "event bus"),
        "publish-subscribe.md",
        "decouple producers from consumers via a channel",
    ),
    (
        ("reactive", "stream", "signals"),
        "reactive-programming.md",
        "model change propagation explicitly",
    ),
    (
        ("configuration", "env var", "hardcode", "externalize"),
        "configuration.md",
        "externalize what varies by environment",
    ),
    (
        ("test", "testing", "coverage", "unit test"),
        "test-to-code.md",
        "tests as a first-class part of the code",
    ),
    (
        ("performance", "algorithm", "big-o", "complexity", "scale"),
        "algorithm-speed.md",
        "know the growth curve before optimizing",
    ),
    (
        ("naming", "rename", "identifier", "variable name"),
        "naming-things.md",
        "a name is the cheapest documentation you have",
    ),
    (
        ("architecture", "design", "module", "layer", "structure"),
        "etc-easier-to-change.md",
        "optimize for ease of change",
    ),
    (
        ("ci", "automation", "pipeline", "script", "shell", "command line"),
        "full-automation.md",
        "automate anything done more than once",
    ),
    (
        ("git", "commit", "branch", "version control"),
        "version-control.md",
        "history and rollback as a safety net",
    ),
    (
        ("requirement", "spec", "constraints", "what user needs"),
        "requirements-pit.md",
        "dig for the real need behind the ask",
    ),
    (
        ("glossary", "terms", "vocabulary"),
        "project-glossary.md",
        "one shared vocabulary for the domain",
    ),
    (
        ("tech debt", "broken window", "rot", "cleanup"),
        "broken-windows.md",
        "small decay invites more decay",
    ),
    (
        ("estimate", "estimating", "how long", "schedule"),
        "estimating.md",
        "ground the number in a stated method",
    ),
    (
        ("prototype", "spike", "proof of concept"),
        "prototypes.md",
        "throwaway code to answer a question, not to ship",
    ),
]

_WORD_RE_CACHE = [
    (
        re.compile(
            r"(?<![\w-])(?:" + "|".join(re.escape(k) for k in keywords) + r")(?![\w-])",
            re.IGNORECASE,
        ),
        concept,
        reason,
    )
    for keywords, concept, reason in DOMAIN_MAP
]

MAX_SCAN_CHARS = 4000


def find_match(prompt: str):
    """Return (concept, reason) for the first domain that matches, or None."""
    if not prompt or prompt.startswith("<") or prompt.startswith("/"):
        return None
    scan_text = prompt[:MAX_SCAN_CHARS]
    for pattern, concept, reason in _WORD_RE_CACHE:
        if pattern.search(scan_text):
            return concept, reason
    return None


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        prompt = payload.get("prompt", "")
        match = find_match(prompt)
        if match is None:
            return 0
        concept, reason = match
        if not (CONCEPTS_DIR / concept).is_file():
            return 0
        line = f"TPP relevant: {concept} - {reason}"
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "UserPromptSubmit",
                        "additionalContext": line,
                    }
                }
            )
        )
    except Exception:
        # Advisory hook: never block or error the turn on a parse failure.
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
