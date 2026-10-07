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

import contextlib
import hashlib
import json
import os
import sys
import tempfile
import time

try:
    import fcntl
except ImportError:  # Windows has no fcntl
    fcntl = None

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

# Bound on how long a Stop hook will wait for the per-session lock below --
# well under any hook timeout, so a stuck lock degrades to "fail open,
# unlocked" instead of wedging the caller.
LOCK_TIMEOUT_SECONDS = 1.0
LOCK_POLL_INTERVAL = 0.02


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


def _lock_path(session_id):
    return os.path.join(_state_dir(), _safe_session_id(session_id) + ".lock")


@contextlib.contextmanager
def _locked(session_id):
    """Exclusive lock around a state file's read-modify-write, so two Stop
    hooks that fire in parallel (Claude Code runs all matching hooks for an
    event concurrently) cannot both read the same state, each append their
    own event, and overwrite each other's write -- the race the old comment
    on _record_stop_event used to accept.

    Bounded to LOCK_TIMEOUT_SECONDS of non-blocking attempts, not a blocking
    flock: fail-open is the rule here too. No fcntl (Windows) or a lock that
    never clears in time both fall through to today's unlocked behavior
    rather than stalling the hook.
    """
    if fcntl is None:
        yield
        return
    lock_file = None
    acquired = False
    try:
        os.makedirs(_state_dir(), exist_ok=True)
        lock_file = open(_lock_path(session_id), "a+")
        # time.monotonic(), not _now(): the lock timeout is wall-clock
        # bookkeeping, unrelated to the business-logic clock tests mock via
        # _now() -- consuming _now() here would desync those mocks.
        deadline = time.monotonic() + LOCK_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            try:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
                break
            except OSError:
                time.sleep(LOCK_POLL_INTERVAL)
    except Exception:
        lock_file = None
    try:
        yield
    finally:
        if lock_file is not None:
            if acquired:
                try:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
                except Exception:
                    pass
            try:
                lock_file.close()
            except Exception:
                pass


def _load_state(session_id):
    try:
        with open(_state_path(session_id)) as f:
            return json.load(f)
    except Exception:
        return {}


def _save_state(session_id, state):
    try:
        state_dir = _state_dir()
        os.makedirs(state_dir, exist_ok=True)
        path = _state_path(session_id)
        # Write-then-rename: os.replace is atomic on POSIX and Windows, so a
        # reader never observes a partially written state file even without
        # the lock (e.g. the fcntl-unavailable fallback path).
        fd, tmp_path = tempfile.mkstemp(dir=state_dir, prefix=".tmp-", suffix=".json")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(state, f)
            os.replace(tmp_path, path)
        except Exception:
            try:
                os.remove(tmp_path)
            except Exception:
                pass
            raise
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

    Callers must hold `_locked(session_id)` across load-mutate-save: Claude
    Code runs every matching Stop hook for an event in parallel, so without
    that lock two concurrent processes can both read the same state, each
    append their own event, and the second save silently drops the first
    hook's write.
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


# Hooks that GATE (block the turn) rather than emit advice: a breaker bypass of
# one of these is a real enforcement hole, so every bypass is recorded, not
# just the first trip. The breaker still must trip (it is what ends an
# infinite Stop loop); the cap is STOP_BURST_LIMIT Stops per STOP_BURST_WINDOW.
GATE_HOOKS = ("completion_gate",)


def fault(hook, message, cwd=None):
    """Record a durable fail-open trace via atlas_faults. Never raises."""
    try:
        try:
            import atlas_faults
        except ImportError:
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            import atlas_faults
        exc = message if isinstance(message, BaseException) else ValueError(message)
        atlas_faults.record(hook, exc, cwd)
    except Exception:
        pass


def _note_bypass(hook_name, session_id, first_trip):
    """Make a breaker bypass visible: always a fault row for gate hooks (once
    per trip for the rest), and a one-line stderr note every time a gate is
    skipped. Never raises."""
    try:
        gate = hook_name in GATE_HOOKS
        if first_trip or gate:
            fault(
                hook_name,
                "circuit breaker open for session %s: %s bypassed this Stop "
                "(more than %d Stops within %ds)"
                % (session_id, hook_name, STOP_BURST_LIMIT, STOP_BURST_WINDOW),
            )
        if first_trip or gate:
            sys.stderr.write(
                "[atlas] hook_guard: circuit breaker %s for session %s -- "
                "Stop fired more than %d times within %ds; %s\n"
                % (
                    "tripped" if first_trip else "open",
                    session_id,
                    STOP_BURST_LIMIT,
                    STOP_BURST_WINDOW,
                    (
                        "%s BYPASSED (gate not enforced this Stop)" % hook_name
                        if gate
                        else "silencing all atlas Stop hooks for the rest of this session"
                    ),
                )
            )
    except Exception:
        pass


_STR_FIELDS = (
    "session_id",
    "cwd",
    "transcript_path",
    "tool_name",
    "hook_event_name",
    "prompt",
    "last_assistant_message",
    "agent_type",
    "agent_id",
)


def load_payload(hook_name, raw=None):
    """One payload policy for every hook: always returns a dict with typed
    fields, never raises.

      empty stdin          -> {} quietly (a harness that sends nothing)
      malformed / non-dict -> {} plus a fault row
      tool_input not dict  -> {} plus a fault row
      known string fields of another type -> "" plus a fault row
    Callers then exit 0 as usual (fail-open); the fault row is the trace.
    """
    try:
        if raw is None:
            raw = sys.stdin.read()
        if not raw.strip():
            return {}
        data = json.loads(raw)
    except Exception as exc:
        fault(hook_name, "unreadable payload: %s: %s" % (type(exc).__name__, exc))
        return {}
    if not isinstance(data, dict):
        fault(hook_name, "payload is %s, not an object" % type(data).__name__)
        return {}
    bad = []
    if "tool_input" in data and not isinstance(data["tool_input"], dict):
        if data["tool_input"] is not None:
            bad.append("tool_input=%s" % type(data["tool_input"]).__name__)
        data["tool_input"] = {}
    for key in _STR_FIELDS:
        val = data.get(key)
        if val is not None and not isinstance(val, str):
            bad.append("%s=%s" % (key, type(val).__name__))
            data[key] = ""
    if bad:
        fault(hook_name, "wrong-typed payload fields: " + ", ".join(bad))
    return data


def run_hook(hook_name, main):
    """Run a hook main(); any uncaught crash becomes a fault row and exit 0."""
    try:
        return main()
    except SystemExit:
        raise
    except BaseException as exc:  # noqa: BLE001 -- fail-open is absolute
        fault(hook_name, exc)
        try:
            sys.stderr.write("[atlas] %s fail-open: %s\n" % (hook_name, exc))
        except Exception:
            pass
        return 0


def should_run(payload, hook_name, window_seconds=None, kind="emit"):
    """False if this Stop hook must not act right now: a continuation it (or
    a sibling hook) forced, its own throttle window, or the session circuit
    breaker. True otherwise -- and on any internal error, since fail-open is
    absolute here: a hook must never be blocked by a guard bug.

    `kind` distinguishes two hook shapes that stop_hook_active must treat
    differently:
      "emit"    -- nudge/auto_skill/completion_gate re-emit a message or a
                   block decision on every Stop. stop_hook_active exists
                   precisely to stop these from looping forever on Claude
                   Code's forced-continuation retry, so it silences them.
      "capture" -- ingest_session/memory_capture/chronicle_facet only write
                   observability data; replaying that on a retry is
                   idempotent, not a loop risk. Silencing them on every
                   blocked Stop is what starved atlas's own telemetry, so
                   stop_hook_active does NOT gate capture hooks.
    The circuit breaker and per-hook throttle window still apply to both
    kinds -- only the stop_hook_active short-circuit is kind-specific.
    Defaults to "emit" so any caller not yet updated keeps today's behavior.
    """
    try:
        if payload.get("stop_hook_active") and kind != "capture":
            return False

        session_id = payload.get("session_id")
        if not session_id:
            return True  # nothing to scope state to -- allow rather than crash

        # The whole read-modify-write below must be one critical section:
        # Claude Code fires every matching Stop hook for an event in
        # parallel, so several processes reach this line at once.
        with _locked(session_id):
            state = _load_state(session_id)
            now = _now()
            _record_stop_event(state, now)

            if (
                state.get("breaker_tripped")
                or len(state["stop_events"]) > STOP_BURST_LIMIT
            ):
                first_trip = not state.get("breaker_tripped")
                state["breaker_tripped"] = True
                _save_state(session_id, state)
                _note_bypass(hook_name, session_id, first_trip)
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
            # Same race should_run() guards against: several Stop hooks (or
            # this hook re-entering via stop_hook_active) can call emit() in
            # parallel against the same session state file. should_run()
            # always releases its own _locked() before returning, so taking
            # the lock again here is sequential, not re-entrant.
            with _locked(session_id):
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
