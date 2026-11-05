import io
import json
import os
import sys
import time

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import _test_isolation  # noqa: F401,E402
import atlas_faults  # noqa: E402
import atlas_hook_guard as g  # noqa: E402


@pytest.fixture
def sd(tmp_path, monkeypatch):
    d = tmp_path / "state"
    d.mkdir()
    monkeypatch.setenv("ATLAS_HOOKSTATE_DIR", str(d))
    return d


@pytest.fixture
def faults(monkeypatch):
    rec = []
    monkeypatch.setattr(atlas_faults, "record", lambda hook, exc, cwd=None: rec.append((hook, exc, cwd)))
    return rec


def _clock(monkeypatch, t):
    box = [t]
    monkeypatch.setattr(g, "_now", lambda: box[0])
    return box


# --- paths ------------------------------------------------------------------


def test_state_dir_env_override(sd):
    assert g._state_dir() == str(sd)


def test_state_dir_default_under_home(tmp_path, monkeypatch):
    monkeypatch.delenv("ATLAS_HOOKSTATE_DIR")
    monkeypatch.setenv("HOME", str(tmp_path))
    assert g._state_dir() == str(tmp_path / ".atlas" / "hookstate")
    assert (tmp_path / ".atlas" / "hookstate").is_dir()
    assert g._state_dir() == str(tmp_path / ".atlas" / "hookstate")  # already exists: still not the /tmp fallback


def test_state_dir_empty_override_is_ignored(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_HOOKSTATE_DIR", "")
    monkeypatch.setenv("HOME", str(tmp_path))
    assert g._state_dir() == str(tmp_path / ".atlas" / "hookstate")


def test_state_dir_falls_back_to_tmp(tmp_path, monkeypatch):
    monkeypatch.delenv("ATLAS_HOOKSTATE_DIR")
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setattr(g.os, "makedirs", lambda *a, **k: (_ for _ in ()).throw(OSError()))
    assert g._state_dir() == "/tmp"


@pytest.mark.parametrize(
    "raw,exp",
    [
        ("abc-123_X", "abc-123_X"),
        ("../../etc/passwd", "etcpasswd"),
        ("a b.c/d", "abcd"),
        ("", "unknown"),
        ("...", "unknown"),
        ("é1", "é1"),
    ],
)
def test_safe_session_id(raw, exp):
    assert g._safe_session_id(raw) == exp


def test_paths(sd):
    assert g._state_path("s/1") == str(sd / "s1.json")
    assert g._lock_path("s/1") == str(sd / "s1.lock")


# --- state IO ---------------------------------------------------------------


def test_save_then_load_roundtrip_no_tmp_left(sd):
    g._save_state("s", {"a": [1, 2], "b": "x"})
    assert g._load_state("s") == {"a": [1, 2], "b": "x"}
    assert sorted(p.name for p in sd.iterdir()) == ["s.json"]


def test_save_creates_missing_dir(tmp_path, monkeypatch):
    d = tmp_path / "new" / "deep"
    monkeypatch.setenv("ATLAS_HOOKSTATE_DIR", str(d))
    g._save_state("s", {"k": 1})
    assert json.loads((d / "s.json").read_text()) == {"k": 1}


def test_save_overwrites_atomically(sd):
    g._save_state("s", {"v": 1})
    g._save_state("s", {"v": 2})
    assert g._load_state("s") == {"v": 2}


def test_save_failure_cleans_tmp_and_is_silent(sd, monkeypatch):
    def bad_replace(a, b):
        raise OSError("nope")

    monkeypatch.setattr(g.os, "replace", bad_replace)
    g._save_state("s", {"v": 1})
    assert list(sd.iterdir()) == []


def test_save_unserializable_cleans_tmp(sd):
    g._save_state("s", {"v": object()})
    assert list(sd.iterdir()) == []


def test_load_missing_or_corrupt_is_empty(sd):
    assert g._load_state("none") == {}
    (sd / "bad.json").write_text("{not json")
    assert g._load_state("bad") == {}


# --- _locked ----------------------------------------------------------------


def test_locked_creates_lock_and_unlocks(sd):
    with g._locked("s"):
        assert (sd / "s.lock").exists()
        # while held, a second non-blocking flock must fail
        import fcntl

        with open(sd / "s.lock", "a+") as other:
            with pytest.raises(OSError):
                fcntl.flock(other.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    with open(sd / "s.lock", "a+") as other:
        fcntl.flock(other.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)


def test_locked_without_fcntl_yields(sd, monkeypatch):
    monkeypatch.setattr(g, "fcntl", None)
    ran = []
    with g._locked("s"):
        ran.append(1)
    assert ran == [1]
    assert not (sd / "s.lock").exists()


def test_locked_times_out_and_still_yields(sd, monkeypatch):
    import fcntl

    monkeypatch.setattr(g, "LOCK_TIMEOUT_SECONDS", 0.15)
    holder = open(sd / "s.lock", "a+")
    fcntl.flock(holder.fileno(), fcntl.LOCK_EX)
    try:
        t0 = time.monotonic()
        ran = []
        with g._locked("s"):
            ran.append(1)
        dt = time.monotonic() - t0
    finally:
        holder.close()
    assert ran == [1]
    assert 0.1 <= dt < 1.0


def test_locked_open_failure_yields(sd, monkeypatch):
    monkeypatch.setattr(g, "_lock_path", lambda s: (_ for _ in ()).throw(OSError()))
    ran = []
    with g._locked("s"):
        ran.append(1)
    assert ran == [1]


def test_locked_closes_file_and_releases_on_exception(sd):
    import fcntl

    with pytest.raises(RuntimeError):
        with g._locked("s"):
            raise RuntimeError("x")
    with open(sd / "s.lock", "a+") as other:
        fcntl.flock(other.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)


def test_locked_unacquired_does_not_unlock_foreign(sd, monkeypatch):
    import fcntl

    monkeypatch.setattr(g, "LOCK_TIMEOUT_SECONDS", 0.05)
    calls = []
    real = fcntl.flock

    def spy(fd, op):
        calls.append(op)
        return real(fd, op)

    holder = open(sd / "s.lock", "a+")
    real(holder.fileno(), fcntl.LOCK_EX)
    monkeypatch.setattr(g.fcntl, "flock", spy)
    try:
        with g._locked("s"):
            pass
    finally:
        holder.close()
    assert fcntl.LOCK_UN not in calls
    assert all(op == fcntl.LOCK_EX | fcntl.LOCK_NB for op in calls) and calls


# --- prune ------------------------------------------------------------------


def test_prune_removes_only_stale_files(sd):
    now = 10_000_000.0
    old, fresh, edge = sd / "old.json", sd / "fresh.json", sd / "edge.json"
    for p in (old, fresh, edge):
        p.write_text("{}")
    os.utime(old, (now - g.STALE_SESSION_SECONDS - 1,) * 2)
    os.utime(edge, (now - g.STALE_SESSION_SECONDS,) * 2)
    os.utime(fresh, (now - 10,) * 2)
    (sd / "subdir").mkdir()
    os.utime(sd / "subdir", (now - g.STALE_SESSION_SECONDS - 5,) * 2)
    g._prune_stale_sessions(now)
    assert not old.exists()
    assert fresh.exists() and edge.exists() and (sd / "subdir").is_dir()


def test_prune_missing_dir_is_silent(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_HOOKSTATE_DIR", str(tmp_path / "nope"))
    g._prune_stale_sessions(1.0)


def test_stale_seven_days():
    assert g.STALE_SESSION_SECONDS == 7 * 86400


# --- _record_stop_event -----------------------------------------------------


def test_record_stop_event_dedup_window():
    st = {}
    g._record_stop_event(st, 100.0)
    g._record_stop_event(st, 101.9)
    assert st["stop_events"] == [100.0]
    g._record_stop_event(st, 102.0)
    assert st["stop_events"] == [100.0, 102.0]


def test_record_stop_event_drops_outside_window():
    st = {"stop_events": [0.5, 1.0, 100.0]}
    g._record_stop_event(st, 121.0)  # cutoff 1.0: inclusive boundary
    assert st["stop_events"] == [1.0, 100.0, 121.0]


# --- read_payload -----------------------------------------------------------


def test_read_payload_whitespace_and_strict_false(monkeypatch):
    monkeypatch.setattr(sys, "stdin", io.StringIO("  \n "))
    assert g.read_payload() == {}
    monkeypatch.setattr(sys, "stdin", io.StringIO('{"a": "line\nbreak"}'))
    assert g.read_payload() == {"a": "line\nbreak"}


# --- fault ------------------------------------------------------------------


def test_fault_records_string_as_valueerror(faults):
    g.fault("h", "boom", "/cwd")
    ((hook, exc, cwd),) = faults
    assert hook == "h" and isinstance(exc, ValueError) and str(exc) == "boom" and cwd == "/cwd"


def test_fault_passes_exception_through(faults):
    e = KeyError("k")
    g.fault("h", e)
    assert faults[0][1] is e and faults[0][2] is None


def test_fault_never_raises(monkeypatch):
    def bad(*a, **k):
        raise RuntimeError("x")

    monkeypatch.setattr(atlas_faults, "record", bad)
    g.fault("h", "m")


def test_fault_import_fallback_inserts_script_dir(monkeypatch):
    rec = []
    real_import = __import__
    state = {"n": 0}

    def fake_import(name, *a, **k):
        if name == "atlas_faults" and state["n"] == 0:
            state["n"] += 1
            raise ImportError("first")
        return real_import(name, *a, **k)

    monkeypatch.setattr(atlas_faults, "record", lambda h, e, c=None: rec.append(h))
    monkeypatch.setattr("builtins.__import__", fake_import)
    g.fault("hh", "m")
    assert rec == ["hh"]
    assert os.path.dirname(os.path.abspath(g.__file__)) in sys.path


# --- _note_bypass -----------------------------------------------------------


def test_note_bypass_first_trip_message(capsys):
    g._note_bypass("nudge", "sess1", True)
    err = capsys.readouterr().err
    assert err == (
        "[atlas] hook_guard: circuit breaker tripped for session sess1 -- Stop fired more than 5 "
        "times within 120s; silencing all atlas Stop hooks for the rest of this session\n"
    )


def test_note_bypass_later_trip_silent_for_non_gate(capsys):
    g._note_bypass("nudge", "s", False)
    assert capsys.readouterr().err == ""


def test_note_bypass_gate_always_noted(capsys):
    g._note_bypass("completion_gate", "s", False)
    err = capsys.readouterr().err
    assert "circuit breaker open for session s" in err
    assert "completion_gate BYPASSED (gate not enforced this Stop)" in err
    g._note_bypass("completion_gate", "s", True)
    err = capsys.readouterr().err
    assert "circuit breaker tripped" in err and "BYPASSED" in err


# --- load_payload -----------------------------------------------------------


def test_load_payload_empty_is_quiet(faults):
    assert g.load_payload("h", "   ") == {}
    assert faults == []


def test_load_payload_reads_stdin_when_raw_none(faults, monkeypatch):
    monkeypatch.setattr(sys, "stdin", io.StringIO('{"cwd": "/x"}'))
    assert g.load_payload("h") == {"cwd": "/x"}
    assert faults == []


def test_load_payload_malformed(faults):
    assert g.load_payload("h", "{nope") == {}
    (hook, exc, _), = faults
    assert hook == "h" and str(exc).startswith("unreadable payload: JSONDecodeError: ")


def test_load_payload_stdin_error(faults, monkeypatch):
    class Boom:
        def read(self):
            raise OSError("closed")

    monkeypatch.setattr(sys, "stdin", Boom())
    assert g.load_payload("h") == {}
    assert "unreadable payload: OSError: closed" in str(faults[0][1])


def test_load_payload_non_object(faults):
    assert g.load_payload("h", "[1]") == {}
    assert str(faults[0][1]) == "payload is list, not an object"


def test_load_payload_tool_input_wrong_type(faults):
    out = g.load_payload("h", json.dumps({"tool_input": "str", "tool_name": "Bash"}))
    assert out["tool_input"] == {}
    assert str(faults[0][1]) == "wrong-typed payload fields: tool_input=str"


def test_load_payload_tool_input_null_is_quiet(faults):
    out = g.load_payload("h", json.dumps({"tool_input": None}))
    assert out["tool_input"] == {} and faults == []


def test_load_payload_prompt_null_is_empty_no_fault(faults):
    out = g.load_payload("h", json.dumps({"prompt": None}))
    assert out["prompt"] == "" and faults == []


def test_load_payload_wrong_typed_string_fields(faults):
    out = g.load_payload("h", json.dumps({"session_id": 5, "cwd": ["x"], "prompt": "ok", "agent_id": None}))
    assert out["session_id"] == "" and out["cwd"] == "" and out["prompt"] == "ok"
    assert "agent_id" in out and out["agent_id"] is None
    assert str(faults[0][1]) == "wrong-typed payload fields: session_id=int, cwd=list"


def test_load_payload_good_payload_untouched(faults):
    d = {"session_id": "s", "cwd": "/x", "tool_name": "Bash", "tool_input": {"command": "ls"}}
    assert g.load_payload("h", json.dumps(d)) == d and faults == []


def test_load_payload_multiple_fields_and_tool_input(faults):
    g.load_payload("h", json.dumps({"tool_input": 3, "session_id": 1}))
    assert str(faults[0][1]) == "wrong-typed payload fields: tool_input=int, session_id=int"


def test_str_fields_contract():
    assert set(g._STR_FIELDS) == {
        "session_id", "cwd", "transcript_path", "tool_name", "hook_event_name",
        "prompt", "last_assistant_message", "agent_type", "agent_id",
    }


# --- _claude_shaped ---------------------------------------------------------


def test_claude_shaped_passthrough_for_other_tools():
    d = {"tool_name": "Bash", "tool_input": {"command": "x"}}
    assert g._claude_shaped(d) is d
    e = {}
    assert g._claude_shaped(e) is e


def test_claude_shaped_normalizes_codex_tools(monkeypatch):
    import atlas_harness

    sentinel = {"tool_name": "Write", "normalized": True}
    seen = []
    monkeypatch.setattr(atlas_harness, "normalize_tool_payload", lambda d: seen.append(d) or sentinel)
    for name in ("apply_patch", "spawn_agent", "update_plan"):
        d = {"tool_name": name}
        assert g._claude_shaped(d) is sentinel
    assert len(seen) == 3


def test_claude_shaped_failure_returns_original(monkeypatch):
    import atlas_harness

    monkeypatch.setattr(atlas_harness, "normalize_tool_payload", lambda d: (_ for _ in ()).throw(ValueError()))
    d = {"tool_name": "apply_patch"}
    assert g._claude_shaped(d) is d


def test_load_payload_normalizes_apply_patch(faults):
    patch = "*** Begin Patch\n*** Add File: a.txt\n+hi\n*** End Patch\n"
    out = g.load_payload("h", json.dumps({"tool_name": "apply_patch", "tool_input": {"command": patch}}))
    assert out["tool_name"] != "apply_patch" or out.get("codex_tool_name")


# --- run_hook ---------------------------------------------------------------


def test_run_hook_returns_main_value():
    assert g.run_hook("h", lambda: 7) == 7


def test_run_hook_systemexit_propagates():
    def m():
        raise SystemExit(3)

    with pytest.raises(SystemExit) as e:
        g.run_hook("h", m)
    assert e.value.code == 3


def test_run_hook_crash_becomes_fault_and_zero(faults, capsys):
    def m():
        raise RuntimeError("bad")

    assert g.run_hook("h", m) == 0
    assert faults[0][0] == "h" and str(faults[0][1]) == "bad"
    assert capsys.readouterr().err == "[atlas] h fail-open: bad\n"


def test_run_hook_keyboardinterrupt_is_failopen(faults):
    def m():
        raise KeyboardInterrupt()

    assert g.run_hook("h", m) == 0
    assert isinstance(faults[0][1], KeyboardInterrupt)


# --- should_run -------------------------------------------------------------


def test_should_run_state_recorded(sd, monkeypatch):
    _clock(monkeypatch, 1000.0)
    assert g.should_run({"session_id": "s"}, "h", 60) is True
    st = g._load_state("s")
    assert st["stop_events"] == [1000.0] and st["last_run"] == {"h": 1000.0}
    assert "breaker_tripped" not in st


def test_should_run_throttle_boundary(sd, monkeypatch):
    box = _clock(monkeypatch, 1000.0)
    assert g.should_run({"session_id": "s"}, "h", 60)
    box[0] = 1059.0
    assert g.should_run({"session_id": "s"}, "h", 60) is False
    assert g._load_state("s")["last_run"]["h"] == 1000.0
    box[0] = 1060.0
    assert g.should_run({"session_id": "s"}, "h", 60) is True
    assert g._load_state("s")["last_run"]["h"] == 1060.0


def test_should_run_throttle_saves_stop_event_when_blocked(sd, monkeypatch):
    box = _clock(monkeypatch, 1000.0)
    g.should_run({"session_id": "s"}, "h", 60)
    box[0] = 1010.0
    assert g.should_run({"session_id": "s"}, "h", 60) is False
    assert g._load_state("s")["stop_events"] == [1000.0, 1010.0]


def test_should_run_breaker_trips_on_sixth_stop(sd, monkeypatch, capsys):
    box = _clock(monkeypatch, 1000.0)
    results = []
    for i in range(7):
        box[0] = 1000.0 + i * 10
        results.append(g.should_run({"session_id": "s"}, "nudge", None))
    assert results == [True] * 5 + [False, False]
    st = g._load_state("s")
    assert st["breaker_tripped"] is True
    err = capsys.readouterr().err
    assert err.count("circuit breaker tripped") == 1


def test_should_run_gate_bypass_every_time(sd, monkeypatch, capsys):
    st = {"breaker_tripped": True, "stop_events": []}
    g._save_state("s", st)
    _clock(monkeypatch, 1000.0)
    assert g.should_run({"session_id": "s"}, "completion_gate") is False
    assert g.should_run({"session_id": "s"}, "completion_gate") is False
    assert capsys.readouterr().err.count("BYPASSED") == 2


def test_should_run_stop_hook_active_capture_vs_emit(sd, monkeypatch):
    _clock(monkeypatch, 1.0)
    p = {"session_id": "s", "stop_hook_active": True}
    assert g.should_run(p, "h", kind="capture") is True
    assert g.should_run(p, "h", kind="emit") is False
    assert g.should_run(p, "h") is False
    assert g.should_run({"session_id": "s", "stop_hook_active": False}, "h") is True


def test_should_run_no_session_allows_without_state(sd):
    assert g.should_run({}, "h") is True
    assert g.should_run({"session_id": ""}, "h") is True
    assert list(sd.iterdir()) == []


def test_should_run_prunes_with_now(sd, monkeypatch):
    now = 5_000_000.0
    _clock(monkeypatch, now)
    stale = sd / "stale.json"
    stale.write_text("{}")
    os.utime(stale, (now - g.STALE_SESSION_SECONDS - 10,) * 2)
    assert g.should_run({"session_id": "s"}, "h") is True
    assert not stale.exists()


def test_should_run_not_pruned_when_blocked(sd, monkeypatch):
    now = 5_000_000.0
    box = _clock(monkeypatch, now)
    g.should_run({"session_id": "s"}, "h", 60)
    stale = sd / "stale.json"
    stale.write_text("{}")
    os.utime(stale, (now - g.STALE_SESSION_SECONDS - 10,) * 2)
    box[0] = now + 5
    assert g.should_run({"session_id": "s"}, "h", 60) is False
    assert stale.exists()


# --- emit -------------------------------------------------------------------


def test_emit_stop_envelope(sd, capsys):
    assert g.emit({"session_id": "s", "hook_event_name": "Stop"}, "h", "hello") is True
    assert json.loads(capsys.readouterr().out) == {"systemMessage": "hello"}


def test_emit_subagent_stop_envelope(sd, capsys):
    assert g.emit({"hook_event_name": "SubagentStop"}, "h", "m")
    assert json.loads(capsys.readouterr().out) == {"systemMessage": "m"}


def test_emit_default_event_is_stop(sd, capsys):
    g.emit({"session_id": "s"}, "h", "m")
    assert json.loads(capsys.readouterr().out) == {"systemMessage": "m"}


def test_emit_other_event_envelope(sd, capsys):
    g.emit({"session_id": "s", "hook_event_name": "UserPromptSubmit"}, "h", "m")
    assert json.loads(capsys.readouterr().out) == {
        "hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": "m"}
    }


def test_emit_dedupes_on_stripped_message_and_records_hash(sd, capsys):
    import hashlib

    p = {"session_id": "s"}
    assert g.emit(p, "h", "  msg \n") is True
    assert g.emit(p, "h", "msg") is False
    out = capsys.readouterr().out
    assert out.count("systemMessage") == 1
    digest = hashlib.sha256(b"msg").hexdigest()[:16]
    assert g._load_state("s")["emitted"] == ["h:" + digest]
    assert g.emit(p, "other", "msg") is True


def test_emit_caps_remembered_hashes(sd, capsys):
    p = {"session_id": "s"}
    for i in range(g.MAX_EMITTED_HASHES + 5):
        assert g.emit(p, "h", f"m{i}") is True
    emitted = g._load_state("s")["emitted"]
    assert len(emitted) == 50 == g.MAX_EMITTED_HASHES
    assert g.emit(p, "h", "m0") is True  # evicted, emits again
    assert g.emit(p, "h", "m54") is False  # still remembered


def test_emit_without_session_always_writes(sd, capsys):
    assert g.emit({}, "h", "m") is True
    assert g.emit({}, "h", "m") is True
    assert capsys.readouterr().out.count("systemMessage") == 2
    assert list(sd.iterdir()) == []


def test_emit_failure_returns_false(sd, monkeypatch):
    class Bad:
        def write(self, s):
            raise OSError("closed")

    monkeypatch.setattr(sys, "stdout", Bad())
    assert g.emit({}, "h", "m") is False
    assert g.emit({"hook_event_name": "Stop"}, "h", None) is False


def test_emit_unencodable_message_hashes(sd, capsys):
    assert g.emit({"session_id": "s"}, "h", "bad \ud800 surrogate") is True


def test_locked_closes_lock_file_object(sd, monkeypatch):
    import builtins

    opened = []
    real = builtins.open

    def spy(path, *a, **k):
        f = real(path, *a, **k)
        if str(path).endswith(".lock"):
            opened.append(f)
        return f

    monkeypatch.setattr(builtins, "open", spy)
    with g._locked("s"):
        assert opened and not opened[0].closed
    assert opened[0].closed
    monkeypatch.setattr(g, "LOCK_TIMEOUT_SECONDS", 0.05)
    import fcntl

    holder = real(sd / "s.lock", "a+")
    fcntl.flock(holder.fileno(), fcntl.LOCK_EX)
    try:
        with g._locked("s"):
            pass
    finally:
        holder.close()
    assert opened[1].closed
