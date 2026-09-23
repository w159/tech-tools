#!/usr/bin/env python3
"""Tests for sweep_state.py: lease lifecycle, id-keyed merge, cursor
refusal, closed-item evidence downgrade, sensitive redaction, and corrupt
state refusal. The state engine is the only writer of sweep state, so its
status-word contract is observable behavior worth pinning."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent / "sweep_state.py"
FUTURE = "2099-01-01T00:00:00+00:00"  # a timestamp that is always live


def run(*args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args], capture_output=True, text=True
    )


def lines(result) -> tuple[str, dict]:
    out = result.stdout.strip().splitlines()
    word = out[0]
    payload = json.loads(out[1]) if len(out) > 1 else {}
    return word, payload


@pytest.fixture
def state(tmp_path):
    return str(tmp_path / "sweep-state.json")


def test_lease_acquire_release_roundtrip(state):
    assert lines(run("lease-acquire", "--state", state, "--writer", "w1"))[0] == "OK"
    assert lines(run("read", "--state", state))[0] == "OK"
    assert lines(run("lease-release", "--state", state, "--writer", "w1"))[0] == "OK"
    # Releasing a lease nobody holds is still OK.
    assert lines(run("lease-release", "--state", state, "--writer", "w1"))[0] == "OK"


def test_lease_locks_against_live_other_writer(state):
    run("lease-acquire", "--state", state, "--writer", "w1")
    # Non-holder mutation is refused with LEASE-LOST and no write.
    r = run("upsert-item", "--state", state, "--writer", "w2", "--source", "s",
            "--id", "1", "--json", '{"status": "ingested"}')
    assert lines(r)[0] == "LEASE-LOST"
    assert lines(run("read", "--state", state))[1]["items"] == {}
    # A live other-writer lease reports LOCKED.
    assert lines(run("lease-acquire", "--state", state, "--writer", "w2"))[0] == "LOCKED"
    # Re-acquire by the same writer is re-entrant.
    assert lines(run("lease-acquire", "--state", state, "--writer", "w1"))[0] == "OK"


def test_stale_lease_reclaimed_but_unparseable_is_live(state):
    run("lease-acquire", "--state", state, "--writer", "old", "--ttl-minutes", "1")
    data = json.loads(Path(state).read_text())
    # Age the lease far past its TTL.
    data["lease"]["timestamp"] = "2000-01-01T00:00:00+00:00"
    Path(state).write_text(json.dumps(data))
    word, payload = lines(run("lease-acquire", "--state", state, "--writer", "new"))
    assert word == "STALE-RECLAIMED"
    assert payload["previous_writer"] == "old"
    # An unparseable timestamp is treated as live, never stomped.
    data = json.loads(Path(state).read_text())
    data["lease"] = {"writer": "old", "timestamp": "not-a-date", "ttl_minutes": 1}
    Path(state).write_text(json.dumps(data))
    assert lines(run("lease-acquire", "--state", state, "--writer", "new"))[0] == "LOCKED"


def test_upsert_is_id_keyed_merge(state):
    run("lease-acquire", "--state", state, "--writer", "w1")
    run("upsert-item", "--state", state, "--writer", "w1", "--source", "gh",
        "--id", "#7", "--json", '{"status": "acknowledged", "body": "boom", "origin": "u"}')
    # Second upsert changes only the keys it sends.
    run("upsert-item", "--state", state, "--writer", "w1", "--source", "gh",
        "--id", "#7", "--json", '{"status": "analyzed"}')
    data = lines(run("read", "--state", state))[1]
    item = data["items"]["gh:#7"]
    assert item["status"] == "analyzed"
    assert item["origin"] == "u" and item["body"] == "boom"
    assert item["source"] == "gh" and item["id"] == "#7"


def test_sensitive_redaction_drops_body_and_quote(state):
    run("lease-acquire", "--state", state, "--writer", "w1")
    run("upsert-item", "--state", state, "--writer", "w1", "--source", "gh",
        "--id", "#9", "--json",
        '{"sensitive": true, "status": "acknowledged", "body": "secret", '
        '"quote": "pii", "title": "t", "origin": "u"}')
    item = lines(run("read", "--state", state))[1]["items"]["gh:#9"]
    assert "body" not in item and "quote" not in item
    assert item["title"] == "t" and item["origin"] == "u"
    # Source-entry flag also redacts later items on that source.
    run("upsert-item", "--state", state, "--writer", "w1", "--source", "gh",
        "--id", "#10", "--json", '{"body": "more", "status": "ingested"}')
    item = lines(run("read", "--state", state))[1]["items"]["gh:#10"]
    assert "body" not in item


def test_cursor_advance_refuses_unknown_item_and_regression(state):
    run("lease-acquire", "--state", state, "--writer", "w1")
    run("upsert-item", "--state", state, "--writer", "w1", "--source", "gh",
        "--id", "#1", "--json", '{"status": "acknowledged"}')
    assert lines(run("cursor-advance", "--state", state, "--writer", "w1",
                     "--source", "gh", "--to", "2026-01-02T00:00:00Z",
                     "--past-item", "#404"))[0] == "REFUSED"
    assert lines(run("cursor-advance", "--state", state, "--writer", "w1",
                     "--source", "gh", "--to", "2026-01-01T00:00:00Z",
                     "--past-item", "#1"))[0] == "OK"
    # Regression below the stored cursor is refused.
    assert lines(run("cursor-advance", "--state", state, "--writer", "w1",
                     "--source", "gh", "--to", "2025-12-31T00:00:00Z",
                     "--past-item", "#1"))[0] == "REFUSED"


def test_validate_downgrades_under_evidenced_closed(state):
    run("lease-acquire", "--state", state, "--writer", "w1")
    good = '{"status": "closed", "fix_ref": "#7", "verified_merge_sha": "abc1234", "verified_at": "2026-01-01T00:00:00Z"}'
    bad = '{"status": "closed", "fix_ref": "#8"}'
    run("upsert-item", "--state", state, "--writer", "w1", "--source", "gh",
        "--id", "#7", "--json", good)
    run("upsert-item", "--state", state, "--writer", "w1", "--source", "gh",
        "--id", "#8", "--json", bad)
    word, payload = lines(run("validate", "--state", state))
    assert word == "OK" and payload["downgraded"] == ["gh:#8"]
    data = lines(run("read", "--state", state))[1]
    assert data["items"]["gh:#7"]["status"] == "closed"
    assert data["items"]["gh:#8"]["status"] == "fix_pending"


def test_run_record_is_lease_agnostic(state):
    run("lease-acquire", "--state", state, "--writer", "holder")
    r = run("run-record", "--state", state, "--writer", "other",
            "--outcome", "aborted-locked", "--counts", '{"ingested": 3}',
            "--timestamp", FUTURE)
    word, payload = lines(r)
    assert word == "OK"
    assert payload["outcome"] == "aborted-locked" and payload["counts"] == {"ingested": 3}


def test_corrupt_state_is_never_overwritten(state):
    Path(state).write_text("{not json at all")
    r = run("read", "--state", state)
    assert lines(r)[0] == "CORRUPT" and r.returncode == 0
    r = run("upsert-item", "--state", state, "--writer", "w1", "--source", "s",
            "--id", "1", "--json", '{"status": "ingested"}')
    assert lines(r)[0] == "CORRUPT" and r.returncode == 0
    assert Path(state).read_text() == "{not json at all"
    # Parses but lacks schema_version: same refusal.
    Path(state).write_text('{"items": {}}')
    assert lines(run("read", "--state", state))[0] == "CORRUPT"


def test_unknown_fields_and_statuses_are_preserved(state):
    Path(state).write_text(json.dumps(
        {"schema_version": 1, "sources": {}, "items": {},
         "custom_top": {"keep": True}}))
    run("upsert-item", "--state", state, "--writer", "w", "--source", "s",
        "--id", "1", "--json", '{"status": "some-future-state", "note": "n"}')
    data = lines(run("read", "--state", state))[1]
    assert data["custom_top"] == {"keep": True}
    assert data["items"]["s:1"]["status"] == "some-future-state"


def test_misuse_exits_two(state):
    assert run("bogus-cmd").returncode == 2
    r = run("run-record", "--state", state, "--writer", "w",
            "--outcome", "nonsense", "--timestamp", FUTURE)
    assert r.returncode == 2
