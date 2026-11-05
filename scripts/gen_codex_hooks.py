#!/usr/bin/env python3
"""Generate plugins/atlas/hooks/hooks.codex.json from hooks.json (the source of truth).

Codex reads the same hook schema as Claude Code, with three differences handled here
(codex-rs rust-v0.166.0, hooks/src/engine and core/src/tools/hook_names.rs):

* No "modules" key (an Atlas-only extension).
* Tool matchers name Codex tools. The shell tool is already `Bash`; `apply_patch` is matched by
  `Write`, `Edit` and `apply_patch`; `spawn_agent` by `Agent` and `spawn_agent`; the plan tool is
  `update_plan` (Claude's TodoWrite); MCP tools keep `mcp__<server>__<tool>`. Claude tools Codex does
  not have (MultiEdit, NotebookEdit, Read, Grep, Glob, Task*, Skill) are dropped. A matcher with any
  regex character is evaluated with an unanchored `is_match` in Codex, so it is wrapped in ^(...)$.
* SessionEnd (and Interrupt) hook timeouts are clamped to 3 s by Codex and warn when larger, so they
  are written as 3. The hook itself detaches its work (ingest_session.py).

Usage: gen_codex_hooks.py [--check]   (--check exits 1 when the committed file differs)
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOOKS_DIR = ROOT / "plugins" / "atlas" / "hooks"
SOURCE = HOOKS_DIR / "hooks.json"
TARGET = HOOKS_DIR / "hooks.codex.json"

TOOL_EVENTS = ("PreToolUse", "PostToolUse", "PermissionRequest")
SESSION_END_TIMEOUT_S = 3
# Claude tool name -> Codex tool names that stand in for it ([] = no Codex equivalent).
CODEX_NAMES = {
    "Edit": ["Edit", "apply_patch"],
    "Write": ["Write"],
    "Agent": ["Agent", "spawn_agent"],
    "TodoWrite": ["update_plan"],
}
NO_CODEX_TOOL = {"MultiEdit", "NotebookEdit", "Read", "read", "Grep", "Glob", "Task", "TaskCreate", "TaskUpdate", "Skill", "edit"}
_PLAIN = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_|")


def codex_matcher(matcher: str | None) -> str | None:
    """Codex spelling of a Claude tool matcher; None when no Codex tool can match it."""
    if matcher in (None, "", "*"):
        return matcher
    out: list[str] = []
    for tok in matcher.split("|"):
        for name in CODEX_NAMES.get(tok, [] if tok in NO_CODEX_TOOL else [tok]):
            if name not in out:
                out.append(name)
    if "mcp__.*" in out:  # subsumes every other mcp__ alternative
        out = [t for t in out if t == "mcp__.*" or not t.startswith("mcp__")]
    if not out:
        return None
    joined = "|".join(out)
    return joined if set(joined) <= _PLAIN else "^(" + joined + ")$"


def generate(source: dict) -> dict:
    doc = copy.deepcopy(source)
    doc.pop("modules", None)
    for event, groups in doc.get("hooks", {}).items():
        kept = []
        for group in groups:
            if event in TOOL_EVENTS:
                matcher = codex_matcher(group.get("matcher"))
                if matcher is None and group.get("matcher") not in (None, "", "*"):
                    continue
                group["matcher"] = matcher
            if event == "SessionEnd":
                for hook in group.get("hooks", []):
                    hook["timeout"] = min(hook.get("timeout", SESSION_END_TIMEOUT_S), SESSION_END_TIMEOUT_S)
            kept.append(group)
        doc["hooks"][event] = kept
    return doc


def render(doc: dict) -> str:
    return json.dumps(doc, indent=2) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="exit 1 if hooks.codex.json is not the generator output")
    args = ap.parse_args(argv)
    want = render(generate(json.loads(SOURCE.read_text("utf-8"))))
    if args.check:
        ok = TARGET.is_file() and TARGET.read_text("utf-8") == want
        print("hooks.codex.json:", "ok" if ok else "STALE (run scripts/gen_codex_hooks.py)")
        return 0 if ok else 1
    TARGET.write_text(want, "utf-8")
    print("wrote", TARGET.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
