#!/usr/bin/env python3
"""ATLAS statusline: the durable todo board as a static line at the prompt.

Claude Code renders its todo widget only when the session's TodoWrite tool
runs, and the `auto` permission mode drops TodoWrite entirely - so the plan
lives in <project>/.atlas/.run/todos.json (mirrored by todo_capture.py, or
set by the orchestrator via scripts/atlas_todo.py in auto mode). This
statusline segment renders that board on every redraw: the current session's
items first, falling back to the whole project board.

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
DIM = "\033[1;90m"
RESET = "\033[0m"


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


def _clip(text, limit=48):
    text = str(text).strip()
    return text[: limit - 3] + "..." if len(text) > limit else text


def render(root, session_id):
    try:
        items = _board_items(root)
    except (OSError, ValueError):
        return ""  # missing or unreadable board: render nothing, never fail the line
    if not items:
        return ""
    picked = _pick(items, session_id)
    needed = len(picked)
    done = sum(1 for i in picked if i.get("status") == "completed")
    if done == needed:
        return "%sATLAS%s %s%d/%d done%s" % (BRAND, RESET, DIM, done, needed, RESET)
    now = next(
        (
            i.get("content")
            for i in picked
            if i.get("status") == "in_progress" and i.get("content")
        ),
        "",
    )
    now_seg = " | now: %s" % _clip(now) if now else ""
    return "%sATLAS%s %s%d/%d%s%s | %s%d left%s" % (
        BRAND,
        RESET,
        DIM,
        done,
        needed,
        RESET,
        now_seg,
        DIM,
        needed - done,
        RESET,
    )


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
        line = render(cwd, session_id)
    except Exception:
        return 0
    if line:
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
