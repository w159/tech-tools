"""Branded live feed for tmux worker panes.

`claude -p` prints nothing until it finishes, so the pane looks dead. The worker runs claude with
`--output-format stream-json --verbose`; atlas_mux feeds each line to render_event() and prints the result.
"""

from __future__ import annotations

import json

PILL = "\x1b[1;7;36m ATLAS \x1b[0m"
DIM, CYAN, GREEN, RED, YELLOW, RESET = (
    "\x1b[2m", "\x1b[36m", "\x1b[32m", "\x1b[31m", "\x1b[33m", "\x1b[0m",
)
SPIN = "⣾"
# tool input fields worth showing, first match wins
_ARG_KEYS = ("file_path", "path", "command", "pattern", "query", "description", "url")


def header(name: str, role: str, team: str, channel: str, goal: str) -> str:
    first = (goal.strip().splitlines() or [""])[0][:100]
    meta = f"{name}  {DIM}{role}  team {team}  #{channel}{RESET}"
    return f"{PILL} {meta}\n{DIM}goal{RESET} {first}\n"


def _tool_line(block: dict) -> str:
    name = str(block.get("name") or "tool")
    inp = block.get("input") if isinstance(block.get("input"), dict) else {}
    arg = next((str(inp[k]) for k in _ARG_KEYS if inp.get(k)), "")
    arg = arg.splitlines()[0][:90] if arg else ""
    line = f"{CYAN}{SPIN} {name}{RESET}  {arg}"
    if name == "Bash" and "atlas_todo.py" in arg and " note" in arg:
        line += f"  {YELLOW}[peer note]{RESET}"
    return line


def _block_lines(block: dict) -> list[str]:
    if block.get("type") == "tool_use":
        return [_tool_line(block)]
    text = str(block.get("text") or "").strip()
    if block.get("type") == "text" and text:
        return [f"{DIM}> {text.splitlines()[0][:110]}{RESET}"]
    return []


def result_text(event: dict) -> str:
    return str(event.get("result") or "")


def render_event(event: dict) -> list[str]:
    kind = event.get("type")
    if kind == "assistant":
        content = (event.get("message") or {}).get("content") or []
        return [ln for b in content if isinstance(b, dict) for ln in _block_lines(b)]
    if kind == "result":
        bad = event.get("is_error") or event.get("subtype") != "success"
        secs = (event.get("duration_ms") or 0) / 1000
        color, code = (RED, 1) if bad else (GREEN, 0)
        return [f"{color}STATUS {secs:.1f}s  exit {code}{RESET}"]
    return []


def parse_line(raw: str) -> dict | None:
    """The JSON event on a stream line, or None for plain text (warnings, non-stream harnesses)."""
    try:
        event = json.loads(raw)
    except ValueError:
        return None
    return event if isinstance(event, dict) else None
