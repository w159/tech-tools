"""Worker inbox: deliver board notes addressed to an atlas_mux worker.

The dashboard (POST /api/v2/irc, /colony/send) writes a human message as a board
note `to=<worker>` and, for an atlas_mux worker pane, reports it as queued: the
pane runs a headless `claude -p` / `omp -p` that never reads its tty, so nothing
else makes the worker look at the board. This module is that missing read side.

atlas_mux pins ATLAS_WORKER_NAME and ATLAS_PROJECT_ROOT in the worker env and
nothing else sets them, so both being present is the worker marker. On each
PostToolUse the dispatch_tripwire hook calls `drain()`, which returns the notes
with `to == worker` that arrived since the worker's cursor and advances the
cursor. The same hook is bridged to omp (omp/hook-bridge.ts returns its
additionalContext from tool_result), so Claude Code and omp share this code.

Cursor: `<root>/.atlas/.run/inbox/<worker>.json` = {"ts": <epoch of the newest
delivered note>}. A note is READ once its ts <= the cursor of the worker it is
addressed to; the dashboard derives queued/read from the same file through
`is_read`. A note and a cursor both carry atlas_todo's float `ts`, so there is
no second id space to keep in step.

Stdlib only. Everything fails open: a hook must never block a worker's tool call.
"""

import json
import os
import sys
import time
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
INBOX_SUBDIR = "inbox"
# One drain returns at most this many notes, each body clipped: a backlog is
# delivered over successive tool calls instead of flooding one turn.
MAX_NOTES = 10
MAX_BODY = 600


def _todo():
    if str(SCRIPTS_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPTS_DIR))
    import atlas_todo

    return atlas_todo


def worker_env(env=None):
    """(worker, root) from the atlas_mux worker env, or None when this is not a worker."""
    env = os.environ if env is None else env
    worker = (env.get("ATLAS_WORKER_NAME") or "").strip()
    root = (env.get("ATLAS_PROJECT_ROOT") or "").strip()
    return (worker, root) if worker and root else None


def cursor_path(root, worker):
    todo = _todo()
    return (
        Path(todo._resolve_base(root))
        / todo.BOARD_DIR
        / INBOX_SUBDIR
        / f"{todo._sanitize_owner(worker)}.json"
    )


def read_cursor(root, worker):
    """Epoch of the newest note delivered to `worker`; 0.0 when none has been."""
    try:
        data = json.loads(cursor_path(root, worker).read_text(encoding="utf-8"))
        return float(data.get("ts") or 0.0)
    except (OSError, ValueError, TypeError, AttributeError):
        return 0.0


def _ts(value):
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def is_read(root, worker, ts, cursors=None):
    """True when a note to `worker` stamped `ts` was already delivered.

    `cursors` is an optional {worker: epoch} memo so a caller classifying many
    messages reads each cursor file once."""
    if cursors is None:
        return _ts(ts) <= read_cursor(root, worker)
    if worker not in cursors:
        cursors[worker] = read_cursor(root, worker)
    return _ts(ts) <= cursors[worker]


def _write_cursor(path, ts):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps({"ts": ts}) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _format(notes):
    plural = "" if len(notes) == 1 else "s"
    lines = [
        f"[atlas] {len(notes)} message{plural} for you from the board (answer or "
        "act on them; they are delivered once):"
    ]
    for rec in notes:
        text = str(rec.get("text") or "").strip()
        if len(text) > MAX_BODY:
            text = text[:MAX_BODY] + " ...[truncated]"
        lines.append(f"- from {rec.get('owner') or 'anon'}: {text}")
    return "\n".join(lines)


def drain(root, worker, now=None):
    """Notes addressed to `worker` newer than its cursor, as additionalContext text.

    Returns "" when nothing is pending. The cursor moves to the newest note
    returned, under the same lock the board's writers use, so two hooks racing
    for one worker cannot deliver a note twice."""
    todo = _todo()
    path = cursor_path(root, worker)
    # The lock file would otherwise appear next to the cursor even when idle;
    # only take it when the board has notes at all.
    if not todo.notes_dir(root).is_dir():
        return ""
    with todo._file_lock(path):
        cursor = read_cursor(root, worker)
        horizon = (now if now is not None else time.time()) + 1.0
        pending = [
            rec
            for rec in todo.notes(root, to=worker, since=cursor)
            if rec.get("to") == worker
            and todo._note_ts_key(rec) > cursor
            and todo._note_ts_key(rec) <= horizon
            and str(rec.get("owner")) != todo._sanitize_owner(worker)
        ]
        if not pending:
            return ""
        batch = pending[:MAX_NOTES]
        _write_cursor(path, todo._note_ts_key(batch[-1]))
        return _format(batch)


def context_for_post_tool_use(env=None):
    """hookSpecificOutput JSON string for the current worker's pending notes, or ""."""
    marker = worker_env(env)
    if not marker:
        return ""
    text = drain(marker[1], marker[0])
    if not text:
        return ""
    return json.dumps(
        {
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": text,
            }
        }
    )
