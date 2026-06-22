#!/usr/bin/env python3
"""Atlas SessionStart boot. Fast, idempotent, crash-proof.

Emits additionalContext pointing at the operating contract and atlas-engine
methodology, reports whether claude-mem and context-mode are present, and
surfaces a one-line ready status. Never blocks session start: any error exits 0
silently.
"""

import json
import shutil
import sys


def has_cmd(name):
    return shutil.which(name) is not None


def detect_dep(module_marker):
    try:
        import importlib.util

        return importlib.util.find_spec(module_marker) is not None
    except Exception:
        return False


def main():
    try:
        _ = sys.stdin.read()  # consume stdin; payload unused for boot
    except Exception:
        pass

    mem = detect_dep("claude_mem") or has_cmd("claude-mem")
    ctx = detect_dep("context_mode") or has_cmd("context-mode")

    lines = [
        "Atlas runtime active. The operating-contract and atlas-engine methodology apply:",
        "research -> theory -> test -> validate -> implement -> test -> verify; evidence before any done claim.",
        "This session is the atlas orchestrator. Substantive implementation is routed to atlas:<role> subagents "
        "(atlas:explorer, atlas:implementer, atlas:verifier, etc.); the orchestrator plans, delegates, "
        "and synthesizes -- it does not directly write production code or run broad tool sweeps.",
        "Invoke the atlas-engine skill for multi-step or whole-codebase work; route subagents via atlas:<role>.",
        "Memory (claude-mem): "
        + (
            "available"
            if mem
            else "absent - run /atlas to install for self-improvement"
        )
        + ".",
        "Context protection (context-mode): "
        + (
            "available"
            if ctx
            else "absent - run /atlas to install for large-output work"
        )
        + ".",
    ]
    out = {
        "additionalContext": "\n".join(lines)[:9000],
        "systemMessage": "Atlas ready"
        + ("" if (mem and ctx) else " (run /atlas to complete setup)"),
    }
    sys.stdout.write(json.dumps(out))
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(0)
