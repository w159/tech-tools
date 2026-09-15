#!/usr/bin/env python3
"""ATLAS statusline: the durable todo board as a todo list at the prompt.

Claude Code draws its todo widget inline with the TodoWrite tool call, so the
widget depends on three things at once and CLAUDE_CODE_ENABLE_TODO_TOOLS=1
only buys the first: gated model families drop TodoWrite without it (docs:
tools-reference); ENABLE_TOOL_SEARCH then defers the tool behind ToolSearch,
so the model may never load it (observed 2026-09-15 with both env vars set);
and focus mode hides tool calls, so the widget is invisible even on the turns
TodoWrite does run (user-confirmed, same session). The plan therefore
lives in <project>/.atlas/.run/todos.json (mirrored by todo_capture.py, or
set by the orchestrator via scripts/atlas_todo.py), and this statusline is
the only surface that shows it unconditionally. This
statusline segment renders that board as a compact todo list on every redraw:
one line per item with a status glyph, the current session's items first,
falling back to the whole project board (carried-over work still shows).

Self-contained on purpose: session_boot.py copies this file to
~/.atlas/atlas_statusline.py so the statusline command can call a stable
path that survives plugin reinstalls. Fail-open: any problem prints nothing,
so a broken board never takes the statusline down. ATLAS_STATUSLINE=off
disables. Stdlib only.
"""

import json
import os
import sys

BRAND = "\033[1;36m"
GREEN = "\033[1;32m"
CYAN = "\033[1;36m"
DIM = "\033[1;90m"
RESET = "\033[0m"

MAX_ITEMS = 8  # list cap; overflow renders as a "+N more" line


def _board_items(root):
    path = os.path.join(root, ".atlas", ".run", "todos.json")
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    items = data.get("items") if isinstance(data, dict) else None
    return items if isinstance(items, list) else []


def _pick(items, session_id):
    """This session's active items first; the whole board as fallback (so
    items carried over from a previous session still show)."""
    active = [i for i in items if isinstance(i, dict) and not i.get("archived")]
    mine = [i for i in active if i.get("session_id") == session_id]
    return mine or active


def _clip(text, limit=56):
    text = str(text).strip()
    return text[: limit - 3] + "..." if len(text) > limit else text


def _item_line(item):
    status = item.get("status")
    content = _clip(item.get("content") or "(untitled)")
    if status == "completed":
        return "%s  ✓ %s%s" % (GREEN, content, RESET)
    if status == "in_progress":
        return "%s  ❯ %s%s" % (CYAN, content, RESET)
    return "%s  ○ %s%s" % (DIM, content, RESET)


def render(root, session_id):
    try:
        items = _board_items(root)
    except (OSError, ValueError):
        return ""  # missing or unreadable board: render nothing, never fail the line
    picked = _pick(items, session_id)
    if not picked:
        return ""
    done = sum(1 for i in picked if i.get("status") == "completed")
    if done == len(picked):
        header = "%s✓ ATLAS Todos%s %s%d/%d%s" % (
            GREEN,
            RESET,
            DIM,
            done,
            len(picked),
            RESET,
        )
    else:
        header = "%s⎇ ATLAS Todos%s %s%d/%d done%s" % (
            BRAND,
            RESET,
            DIM,
            done,
            len(picked),
            RESET,
        )
    lines = [header]
    lines.extend(_item_line(i) for i in picked[:MAX_ITEMS])
    if len(picked) > MAX_ITEMS:
        lines.append("%s  + %d more%s" % (DIM, len(picked) - MAX_ITEMS, RESET))
    return "\n".join(lines)


def main():
    if os.environ.get("ATLAS_STATUSLINE", "").lower() in ("0", "off", "false", "no"):
        return 0
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, ValueError, OSError):
        return 0
    if not isinstance(data, dict):
        return 0
    workspace = data.get("workspace") or {}
    cwd = data.get("cwd") or workspace.get("current_dir") or ""
    session_id = str(data.get("session_id") or "")
    if not cwd or not os.path.isdir(cwd):
        return 0
    try:
        block = render(cwd, session_id)
    except Exception:
        return 0
    if block:
        print(block)
    return 0


if __name__ == "__main__":
    sys.exit(main())
