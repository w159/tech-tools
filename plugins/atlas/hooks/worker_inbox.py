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
delivered note>, "seq": <its board seq>}. atlas_todo.note stamps every note with a
board-wide `seq` assigned under the board lock together with the append, so seq order
is landing order and a note that lands late (older ts, newer seq) is never skipped, which
a ts cursor did. A note is READ once its seq <= the cursor seq (legacy notes without a
seq: ts <= cursor ts); the dashboard derives queued/read from the same file through
`is_read`. Notes the dashboard already typed into an interactive pane (`delivery`
delivered/refused) are never drained: injecting them again made every typed message
arrive twice.

Stdlib only. Everything fails open: a hook must never block a worker's tool call.
"""

import json
import os
import re
import sys
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


def _read_state(root, worker):
    """(ts, seq) of the newest note delivered to `worker`; (0.0, 0) when none has been.

    Notes carry a board-wide `seq` assigned under the board lock (atlas_todo.note), so a
    note stamped with an older ts that lands after a drain still has a higher seq and is
    delivered. Legacy notes without a seq fall back to the ts cursor."""
    try:
        data = json.loads(cursor_path(root, worker).read_text(encoding="utf-8"))
        return float(data.get("ts") or 0.0), int(data.get("seq") or 0)
    except (OSError, ValueError, TypeError, AttributeError):
        return 0.0, 0


def read_cursor(root, worker):
    """Epoch of the newest note delivered to `worker`; 0.0 when none has been."""
    return _read_state(root, worker)[0]


def _ts(value):
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _seq(rec):
    try:
        return int(rec.get("seq") or 0)
    except (TypeError, ValueError):
        return 0


def _seen(rec, state):
    ts, seq = state
    return _seq(rec) <= seq if _seq(rec) else _ts(rec.get("ts")) <= ts


def is_read(root, worker, rec, cursors=None):
    """True when the note `rec` to `worker` was already delivered by the hook.

    `cursors` is an optional {worker: (ts, seq)} memo so a caller classifying many
    messages reads each cursor file once."""
    if cursors is None:
        return _seen(rec, _read_state(root, worker))
    if worker not in cursors:
        cursors[worker] = _read_state(root, worker)
    return _seen(rec, cursors[worker])


def _write_cursor(path, ts, seq):
    """Persist (ts, seq), never moving either component backwards."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        ts = max(ts, float(data.get("ts") or 0.0))
        seq = max(seq, int(data.get("seq") or 0))
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps({"ts": ts, "seq": seq}) + "\n", encoding="utf-8")
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


def drain(root, worker, member_of=None, aliases=()):
    """Notes for `worker` not yet delivered, as additionalContext text.

    Wanted: a note `to` the worker in a channel the worker belongs to, in the
    project's main channel, or with no channel; a note `to` an alias (the lead's `lead`) only in a channel the worker
    belongs to; or a `to=all` broadcast in a member channel (registry membership +
    ATLAS_CHANNEL). Notes of any other channel are never delivered. Returns "" when
    nothing is pending. Notes the dashboard already typed into the pane (`delivery`
    delivered/refused) and the worker's own notes are skipped. The cursor (board
    seq + ts, monotonic) moves to the last note returned under the same lock the
    board's writers use, so two hooks racing for one worker cannot deliver a note
    twice. A lead (alias identity) with no cursor yet starts after its channel's `created`
    time, or at the board's current max when that is unknown: it never replays
    history. A worker with no cursor keeps its backlog (briefs sent before its first
    tool call)."""
    todo = _todo()
    path = cursor_path(root, worker)
    # The lock file would otherwise appear next to the cursor even when idle;
    # only take it when the board has notes at all.
    if not todo.notes_dir(root).is_dir():
        return ""
    chans = set(member_of if member_of is not None else todo.channels_of(root, worker))
    env_chan = (os.environ.get("ATLAS_CHANNEL") or "").strip()
    if env_chan and todo.may_post(
        root, env_chan, worker
    ):  # an inherited env alone grants nothing
        chans.add(env_chan)
    aliases = set(aliases)
    main = todo.main_channel(todo._resolve_base(root))

    channels = todo._reg_read(root)
    peers = set(todo.SYSTEM_OWNERS)
    for name in chans:
        chan = channels["channels"].get(name) or {}
        peers |= {m["name"] for m in chan.get("members", [])} | set(
            chan.get("departed") or {}
        )

    def wanted(rec):
        ch = rec.get("channel")
        to = rec.get("to")
        # a lead channel only carries notes from its own members (or `human`/`board`)
        if ch and not todo.may_post(root, ch, rec.get("owner"), channels):
            return False
        if to in aliases:
            return bool(ch) and ch in chans
        if to == worker:
            if todo.is_lead_name(worker) and (not ch or ch == main):
                # a lead's inbox admits main/channel-less notes only from its own peers
                return rec.get("owner") in peers
            return not ch or ch in chans or ch == main
        return to == "all" and bool(ch) and ch in chans

    with todo._file_lock(path):
        state = _read_state(root, worker)
        since = 0.0
        all_notes = todo.notes(root, consistent=True)
        if not path.exists():
            created = [
                float(c.get("created") or 0)
                for n, c in todo._reg_read(root)["channels"].items()
                if n in chans
            ]
            since = max(created, default=0.0)
            if not since and aliases:
                _write_cursor(
                    path,
                    max((_ts(r.get("ts")) for r in all_notes), default=0.0),
                    max((_seq(r) for r in all_notes), default=0),
                )
                return ""
        me = todo._sanitize_owner(worker)
        pending = [
            rec
            for rec in all_notes
            if wanted(rec)
            and _ts(rec.get("ts")) > since
            and not _seen(rec, state)
            and rec.get("delivery") not in ("delivered", "refused")
            and str(rec.get("owner")) != me
        ]
        if not pending:
            return ""
        pending.sort(key=lambda r: (_seq(r), todo._note_ts_key(r)))
        batch = pending[:MAX_NOTES]
        _write_cursor(path, _ts(batch[-1].get("ts")), _seq(batch[-1]))
        return _format(batch)


def _member_for(todo, root, agent):
    """Registered channel member an omp agent id/name denotes: exact (case-blind), else
    the id with omp's `<n>-` prefix / trailing digits stripped; a unique match only."""
    agent = agent.strip()
    if not agent:
        return None
    names = {
        m["name"]
        for c in todo._reg_read(root)["channels"].values()
        for m in c["members"]
    }
    for cand in (
        agent,
        re.sub(r"^\d+-", "", agent),
        re.sub(r"\d+$", "", re.sub(r"^\d+-", "", agent)),
    ):
        hits = {n for n in names if n.lower() == todo._sanitize_owner(cand).lower()}
        if len(hits) == 1:
            return hits.pop()
    return None


def identity(payload=None, env=None):
    """(name, root, aliases) of whoever this hook fires for, or None.

    1. atlas_mux worker env (ATLAS_WORKER_NAME + ATLAS_PROJECT_ROOT).
    2. payload `agent_name`: omp subagents carry no env of their own, so the omp
       hook bridge puts the task name in the payload.
    3. the lead: a main-session payload whose lead name (atlas_todo.lead_name) has
       opened a subchannel; it also answers to `to=lead`."""
    payload = payload if isinstance(payload, dict) else {}
    marker = worker_env(env)
    if marker:
        return marker[0], marker[1], ()
    todo = _todo()
    cwd = payload.get("cwd")
    root = todo.find_root(cwd if isinstance(cwd, str) and cwd else None)
    name = _member_for(todo, root, str(payload.get("agent_name") or ""))
    if name:
        return name, root, ()
    sid = str(payload.get("session_id") or "")
    if sid and "/subagents/" not in str(payload.get("transcript_path") or ""):
        lead = todo.lead_name(sid)
        if any(
            c.get("lead") == lead for c in todo._reg_read(root)["channels"].values()
        ):
            return lead, root, ("lead",)
    return None


def context_for_post_tool_use(env=None, payload=None):
    """hookSpecificOutput JSON string for the current worker's pending notes, or ""."""
    who = identity(payload, env)
    if not who:
        return ""
    worker, root, aliases = who
    try:
        text = drain(root, worker, aliases=aliases)
    except (
        Exception
    ) as exc:  # fail open: a tool call never waits on the inbox, but leave a trace
        _todo()  # puts the scripts dir on sys.path
        import atlas_faults

        atlas_faults.record("worker_inbox", exc, root)
        return ""
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
