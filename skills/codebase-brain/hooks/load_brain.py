#!/usr/bin/env python3
"""SessionStart hook — load a codebase's committed "brain" into the session.

When an agent (Claude / Codex / Copilot) starts in a repo that has been onboarded
with the codebase-brain skill, this surfaces the repo's committed knowledge so the
agent works WITH the codebase's memory instead of rediscovering it every session:

  ./.agents/knowledge/invariants.md   -> "do not break X" rules, injected in FULL
  ./.agents/memory/MEMORY.md          -> one-line-per-fact index, injected (capped)
  ./.agents/knowledge/*.md            -> listed by name + first heading (read on demand)

The brain lives IN the repo (committed), so it travels to anyone who clones it.

Fail-safe contract: a repo with no ./.agents dir produces NO output (exit 0) — this
never nags un-onboarded codebases. Any error → silent passthrough. It only ever ADDS
context; it can never block or break the session.

Stdlib only.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

BRAIN_DIR = ".agents"
# Keep the injected context lean — this is the user's explicit token concern.
MEMORY_CAP = 4000  # MEMORY.md is a one-line-per-fact index; cap defensively
INVARIANTS_CAP = 6000  # the safety-critical "don't break X" section, injected in full
KNOWLEDGE_ORDER = [  # surfaced in this order when present
    "invariants.md",
    "architecture.md",
    "structure.md",
    "conventions.md",
    "stack.md",
    "integrations.md",
    "testing.md",
    "concerns.md",
]


def _read(path: Path, cap: int) -> str:
    text = path.read_text(encoding="utf-8", errors="replace").strip()
    if len(text) > cap:
        text = text[:cap].rstrip() + "\n…(truncated — read the file for the rest)"
    return text


def _first_heading(path: Path) -> str:
    """First markdown heading or first non-empty line — a one-line summary."""
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        s = line.strip().lstrip("#").strip()
        if s:
            return s[:120]
    return ""


def build_context(root: Path) -> str | None:
    """Assemble the SessionStart context for a repo, or None if it has no brain."""
    brain = root / BRAIN_DIR
    if not brain.is_dir():
        return None

    knowledge = brain / "knowledge"
    memory_index = brain / "memory" / "MEMORY.md"
    invariants = knowledge / "invariants.md"

    parts: list[str] = [
        f"# Codebase Brain ({BRAIN_DIR}/)",
        "This repo carries committed agent knowledge. Consult it before changing code, "
        "push back if a request would violate an invariant, and append what you learn to memory.",
    ]
    found = False

    if invariants.is_file():
        parts += [
            "",
            "## Invariants — DO NOT BREAK  (.agents/knowledge/invariants.md)",
            _read(invariants, INVARIANTS_CAP),
        ]
        found = True

    if memory_index.is_file():
        parts += [
            "",
            "## Memory index  (.agents/memory/MEMORY.md)",
            _read(memory_index, MEMORY_CAP),
        ]
        found = True

    if knowledge.is_dir():
        listed = []
        seen = set()
        ordered = [knowledge / n for n in KNOWLEDGE_ORDER if (knowledge / n).is_file()]
        extra = sorted(p for p in knowledge.glob("*.md") if p not in ordered)
        for p in ordered + extra:
            if p.name == "invariants.md" or p.name in seen:
                continue
            seen.add(p.name)
            listed.append(f"- {p.name} — {_first_heading(p)}")
        if listed:
            parts += ["", "## Knowledge files (read on demand)", *listed]
            found = True

    if not found:
        return None

    parts += [
        "",
        "Before claiming work done, self-validate: evidence before assertions "
        "(codebase-brain → references/self-validation.md).",
    ]
    return "\n".join(parts)


def main() -> int:
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, ValueError):
        return 0
    if os.environ.get("CODEBASE_BRAIN_LOAD", "").lower() == "off":
        return 0
    cwd = data.get("cwd") or os.getcwd()
    try:
        context = build_context(Path(cwd))
    except OSError:
        return 0
    if not context:
        return 0
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "SessionStart",
                    "additionalContext": context,
                }
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
