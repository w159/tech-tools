#!/usr/bin/env python3
"""Shared Stop-hook loop guard.

A prior incident: memory_capture.py re-emitted the same additionalContext on
every Stop, roughly every 13 seconds, until it burned a user's usage limit.
The throttle that fixed that one hook was hand-rolled and did not help the
other four atlas Stop hooks, each of which had grown its own inconsistent
version (or none at all) of the same "do not repeat yourself forever" rule.
This module is the one place that invariant lives now:

  read_payload()  -- read stdin once, parse JSON, fail-open to {}.
  should_run()    -- stop_hook_active guard + per-hook throttle window +
                     session-wide circuit breaker.
  emit()          -- content-hash dedupe (per session, per hook) before
                     writing the additionalContext envelope to stdout.

State lives in one small JSON file per session under ~/.atlas/hookstate/, not
the atlas DB: five hooks fire concurrently on the same Stop event and
memory_capture already opens the DB read-only, so a second writer there is
the wrong home for this.

Fail-open by construction: every function returns a safe default (allow the
run, or "not yet emitted") on any error. A guard that can crash a hook or
wedge a session is worse than no guard at all.
"""

import hashlib
import json
import os
import sys
import time

# Circuit breaker: a per-hook throttle only asks "have I spoken recently" --
# none of the five hooks can see the chain thrashing as a whole. If Stop
# fires more than STOP_BURST_LIMIT times within STOP_BURST_WINDOW seconds,
# every atlas Stop hook goes silent for the rest of the session. The real
# incident cycled every 13 seconds, so this must trip within the first
# minute or two of that cadence.
STOP_BURST_LIMIT = 5
STOP_BURST_WINDOW = 120  # seconds

# All five hooks fire off the same real Stop event. Collapse arrivals within
# this many seconds into a single recorded Stop event so the breaker counts
# actual Stop cycles, not how many hooks happen to be wired to Stop.
STOP_EVENT_DEDUP_SECONDS = 2

STALE_SESSION_SECONDS = 86400  # prune session state files older than a day
MAX_EMITTED_HASHES = 50  # cap per-session emitted-message memory


def _now():
    return time.time()


def _state_dir():
    override = os.environ.get("ATLAS_HOOKSTATE_DIR")
    if override:
        return override
    base = os.path.join(os.path.expanduser("~"), ".atlas", "hookstate")
    try:
        os.makedirs(base, exist_ok=True)
    except Exception:
        base = "/tmp"
    return base


def _safe_session_id(session_id):
    """A session_id becomes a filename -- strip anything but alnum/-/_ so a
    malformed id cannot escape hookstate/ or collide with a sibling file."""
    cleaned = "".join(c for c in session_id if c.isalnum() or c in "-_")
    return cleaned or "unknown"


def _state_path(session_id):
    return os.path.join(_state_dir(), _safe_session_id(session_id) + ".json")


def _load_state(session_id):
    try:
        with open(_state_path(session_id)) as f:
            return json.load(f)
    except Exception:
        return {}


def _save_state(session_id, state):
    try:
        os.makedirs(_state_dir(), exist_ok=True)
        with open(_state_path(session_id), "w") as f:
            json.dump(state, f)
    except Exception:
        pass  # best-effort: a lost update just costs one extra hook firing


def _prune_stale_sessions(now):
    """Delete session state files untouched for a day so hookstate/ cannot
    grow without bound on a long-lived machine. Takes `now` from the caller
    instead of calling _now() itself so it never consumes an extra tick from
    a test's mocked time source."""
    try:
        base = _state_dir()
        cutoff = now - STALE_SESSION_SECONDS
        for name in os.listdir(base):
            path = os.path.join(base, name)
            try:
                if os.path.isfile(path) and os.path.getmtime(path) < cutoff:
                    os.remove(path)
            except Exception:
                continue
    except Exception:
        pass


def _record_stop_event(state, now):
    """Append a Stop-event timestamp, collapsing near-simultaneous arrivals
    from the several hooks that fire off one real Stop, then drop anything
    outside the burst window so the list cannot grow unbounded.

    ponytail: a file-based counter with no locking, so two truly concurrent
    hook processes can race and lose an event -- acceptable, since undercounting
    the breaker is the fail-open direction. Add flock if misses show up in
    practice.
    """
    events = state.setdefault("stop_events", [])
    if not events or (now - events[-1]) >= STOP_EVENT_DEDUP_SECONDS:
        events.append(now)
    cutoff = now - STOP_BURST_WINDOW
    state["stop_events"] = [t for t in events if t >= cutoff]


def read_payload():
    """Read stdin once, parse JSON, fail-open to {} on any error."""
    try:
        raw = sys.stdin.read()
        return json.loads(raw) if raw.strip() else {}
    except Exception:
        return {}


def should_run(payload, hook_name, window_seconds=None):
    """False if this Stop hook must not act right now: a continuation it (or
    a sibling hook) forced, its own throttle window, or the session circuit
    breaker. True otherwise -- and on any internal error, since fail-open is
    absolute here: a hook must never be blocked by a guard bug."""
    try:
        if payload.get("stop_hook_active"):
            return False

        session_id = payload.get("session_id")
        if not session_id:
            return True  # nothing to scope state to -- allow rather than crash

        state = _load_state(session_id)
        now = _now()
        _record_stop_event(state, now)

        if state.get("breaker_tripped") or len(state["stop_events"]) > STOP_BURST_LIMIT:
            if not state.get("breaker_tripped"):
                state["breaker_tripped"] = True
                try:
                    sys.stderr.write(
                        "[atlas] hook_guard: circuit breaker tripped for "
                        "session %s -- Stop fired more than %d times within "
                        "%ds; silencing all atlas Stop hooks for the rest of "
                        "this session\n"
                        % (session_id, STOP_BURST_LIMIT, STOP_BURST_WINDOW)
                    )
                except Exception:
                    pass
            _save_state(session_id, state)
            return False

        if window_seconds:
            last_run = state.get("last_run", {}).get(hook_name)
            if last_run is not None and (now - last_run) < window_seconds:
                _save_state(session_id, state)
                return False

        state.setdefault("last_run", {})[hook_name] = now
        _save_state(session_id, state)
        _prune_stale_sessions(now)
        return True
    except Exception:
        return True


def emit(payload, hook_name, message):
    """Write the additionalContext envelope, but only the first time this
    (session, hook, message) combination is seen this session. Returns True
    if it wrote, False if it was a repeat or writing failed -- fail-open means
    never raising into the caller, not necessarily always emitting."""
    try:
        session_id = payload.get("session_id")
        if session_id:
            digest = hashlib.sha256(
                message.strip().encode("utf-8", "replace")
            ).hexdigest()[:16]
            key = hook_name + ":" + digest
            state = _load_state(session_id)
            emitted = state.setdefault("emitted", [])
            if key in emitted:
                return False
            emitted.append(key)
            state["emitted"] = emitted[-MAX_EMITTED_HASHES:]
            _save_state(session_id, state)
        sys.stdout.write(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": payload.get("hook_event_name", "Stop"),
                        "additionalContext": message,
                    }
                }
            )
        )
        return True
    except Exception:
        return False
