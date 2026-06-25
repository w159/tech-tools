#!/usr/bin/env python3
"""Atlas SessionStart boot. Fast, idempotent, crash-proof.

Emits additionalContext pointing at the operating contract and atlas-engine
methodology, reports whether claude-mem and context-mode are present, and
surfaces a one-line ready status. Never blocks session start: any error exits 0
silently.
"""

import json
import os
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
    payload = {}
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except Exception:
        pass

    # Observability DB lifecycle -- fail-open; must not block boot.
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        _conn = atlas_db.connect()
        atlas_db.init(_conn)
        _root = payload.get("cwd") or os.getcwd()
        _pid = atlas_db.register_project(_conn, _root, os.path.basename(_root))
        if atlas_db.current_run_id(_conn, payload.get("session_id", "")) is None:
            atlas_db.start_run(_conn, _pid, payload.get("session_id", ""))
    except Exception:
        pass  # observability is best-effort; never block boot

    mem = detect_dep("claude_mem") or has_cmd("claude-mem")
    ctx = detect_dep("context_mode") or has_cmd("context-mode")

    pony = has_cmd("ponytail")
    if not pony:
        try:
            pony = os.path.exists(os.path.expanduser("~/.config/ponytail/config.json"))
        except Exception:
            pony = False

    lines = [
        "Atlas runtime active. The atlas-engine methodology and operating contract apply:",
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
        "Less-code mode (ponytail): "
        + ("available" if pony else "absent - run /atlas to install for less-code mode")
        + ".",
        "No-prompt scan: run /atlas, or any atlas skill with no task, to scan this project "
        "and report what is missing to reach atlas standard (claude-mem + context-mode + ponytail, "
        "loop-library, connectors, hooks, docs/ SSOT).",
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
