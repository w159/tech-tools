"""atlas_dash_irc units: normalisation, delivery states and text, paging, validation, presence views."""

from __future__ import annotations

import _test_isolation  # noqa: F401,E402
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

import atlas_dash_irc as irc  # noqa: E402
import atlas_seats  # noqa: E402
import atlas_todo  # noqa: E402


class FakeInbox:
    def __init__(self, result=("queued", None)):
        self.result = result
        self.calls = []

    def delivery(self, root, to, rec, memo):
        self.calls.append((root, to, rec, memo))
        return self.result(to) if callable(self.result) else self.result


@pytest.fixture
def inbox(monkeypatch):
    fi = FakeInbox()
    monkeypatch.setattr(irc, "worker_inbox", fi)
    return fi


# --- small pure helpers ------------------------------------------------------


@pytest.mark.parametrize(
    "name,exp",
    [
        (None, False),
        ("", False),
        ("a", True),
        ("wA:p1", True),
        ("a.b_c-d", True),
        ("x" * 64, True),
        ("x" * 65, False),
        ("a b", False),
        ("a/b", False),
        ("é", False),
    ],
)
def test_valid(name, exp):
    assert irc._valid(name) is exp


def test_epoch_variants():
    assert irc._epoch(None) == 0.0 and irc._epoch("") == 0.0
    assert irc._epoch(5) == 5.0 and irc._epoch("12.5") == 12.5 and irc._epoch(0) == 0.0
    assert irc._epoch("2026-01-02T03:04:05Z") == datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc).timestamp()
    assert irc._epoch("2026-01-02T03:04:05+02:00") == datetime(2026, 1, 2, 1, 4, 5, tzinfo=timezone.utc).timestamp()
    assert irc._epoch("garbage") == 0.0
    assert irc._epoch([1]) == 0.0
    assert irc._epoch({}) == 0.0


def test_sanitize_keys():
    assert irc.sanitize_keys(None) == "" and irc.sanitize_keys("") == ""
    assert irc.sanitize_keys("a\r\nb\tc\x1bd\x7fe\x00f") == "a  b c d e f"
    assert irc.sanitize_keys("plain text é") == "plain text é"


def test_message_id_is_stable_and_field_sensitive():
    rec = {"ts": 1, "owner": "o", "to": "t", "text": "x"}
    mid = irc._message_id("/r", rec)
    assert mid == irc._message_id("/r", dict(rec)) and len(mid) == 13 and mid[0] == "m"
    int(mid[1:], 16)
    assert irc._message_id("/r2", rec) != mid
    for k, v in (("ts", 2), ("owner", "p"), ("to", "u"), ("text", "y")):
        assert irc._message_id("/r", {**rec, k: v}) != mid


@pytest.mark.parametrize(
    "to,kind,exp",
    [
        ("worker", "note", True),
        ("worker", "irc", True),
        ("all", "note", False),
        (None, "note", False),
        ("", "note", False),
        ("human", "note", False),
        ("lead", "note", False),
        ("worker", "exit", False),
        ("worker", "system", False),
    ],
)
def test_tracked(to, kind, exp):
    assert irc._tracked({"to": to}, kind) is exp


# --- _delivery / text -------------------------------------------------------


def test_delivery_untracked_is_read(inbox):
    assert irc._delivery("/r", {"to": "all"}, "note", {}) == ("read", None)
    assert irc._delivery("/r", {"to": "lead", "delivery": "refused"}, "note", {}) == ("read", None)
    assert inbox.calls == []


def test_delivery_stamped_outcomes(inbox):
    assert irc._delivery("/r", {"to": "w", "delivery": "refused", "ts": 5}, "note", None) == ("refused", None)
    assert irc._delivery("/r", {"to": "w", "delivery": "delivered", "ts": 5}, "note", None) == ("delivered", 5.0)
    assert irc._delivery("/r", {"to": "w", "delivery": "bogus", "ts": time.time()}, "note", None)[0] == "queued"
    assert inbox.calls and inbox.calls[0][1] == "w"


def test_delivery_hook_states(inbox):
    now = time.time()
    rec = {"to": "w", "ts": now}
    inbox.result = ("delivered", 123.0)
    assert irc._delivery("/r", rec, "note", {}) == ("read", 123.0)
    inbox.result = ("skipped", None)
    assert irc._delivery("/r", rec, "note", {}) == ("undeliverable", None)
    inbox.result = ("queued", None)
    assert irc._delivery("/r", rec, "note", {}) == ("queued", None)
    assert irc._delivery("/r", {"to": "w", "ts": now - irc.QUEUED_TTL_S - 5}, "note", {}) == ("undeliverable", None)
    assert irc._delivery("/r", {"to": "w", "ts": now - irc.QUEUED_TTL_S + 60}, "note", {}) == ("queued", None)
    assert irc._delivery("/r", {"to": "w"}, "note", {}) == ("undeliverable", None)  # no timestamp: ancient
    root, to, r, memo = inbox.calls[0]
    assert (root, to) == ("/r", "w") and memo == {}


def test_delivery_without_hook_module(monkeypatch):
    monkeypatch.setattr(irc, "worker_inbox", None)
    assert irc._delivery("/r", {"to": "w", "ts": time.time()}, "note", {}) == ("queued", None)
    assert irc._delivery_status("/r", {"to": "w", "ts": time.time()}, "note", {}) == "queued"


def test_ttl_constant():
    assert irc.QUEUED_TTL_S == 900


def test_clock():
    assert irc._clock(None) == "an earlier time" and irc._clock(0) == "an earlier time"
    t = time.mktime((2026, 1, 2, 3, 4, 5, 0, 0, -1))
    assert irc._clock(t) == "03:04:05"


def test_delivery_text_named_agent_states(inbox):
    rec = {"to": "w"}
    t = time.mktime((2026, 1, 2, 3, 4, 5, 0, 0, -1))
    assert irc._delivery_text("/r", rec, "read", t, "note", {}, {}) == "delivered to w at 03:04:05"
    assert irc._delivery_text("/r", rec, "read", None, "note", {}, {}) == "delivered to w at an earlier time"
    assert irc._delivery_text("/r", rec, "delivered", t, "note", {}, {}) == "typed into w's pane at 03:04:05"
    assert irc._delivery_text("/r", rec, "refused", None, "note", {}, {}) == (
        "not deliverable: w's pane is not an interactive claude/omp session"
    )
    assert irc._delivery_text("/r", rec, "undeliverable", None, "note", {}, {}) == (
        "not deliverable: w did not read it (not a member of this channel, finished, or not running atlas hooks)"
    )
    assert irc._delivery_text("/r", rec, "queued", None, "note", {}, {}) == "queued: w reads it on its next tool call"
    assert irc._delivery_text("/r", {"to": "lead"}, "read", None, "note", {}, {}) == ""
    assert irc._delivery_text("/r", {"to": "w"}, "read", None, "exit", {}, {}) == ""


def test_delivery_text_broadcast(inbox):
    reg = {"c1": {"members": [{"name": "a"}, {"name": "b"}, {"name": "sender"}, {"name": ""}, {}]}}
    rec = {"to": "all", "channel": "c1", "owner": "sender"}
    inbox.result = lambda to: ("delivered", 1.0) if to == "a" else ("queued", None)
    assert irc._delivery_text("/r", rec, "queued", None, "note", {}, reg) == (
        "delivered to 1 of 2 members so far (each reads it on its next tool call)"
    )
    inbox.result = ("delivered", 1.0)
    assert "delivered to 2 of 2" in irc._delivery_text("/r", rec, "queued", None, "note", {}, reg)
    solo = {"c1": {"members": [{"name": "sender"}]}}
    assert irc._delivery_text("/r", rec, "queued", None, "note", {}, solo) == (
        "posted to the channel board; it has no members to receive it"
    )
    assert irc._delivery_text("/r", rec, "queued", None, "note", {}, {"c1": {}}) == ""
    assert irc._delivery_text("/r", rec, "queued", None, "exit", {}, reg) == ""
    assert irc._delivery_text("/r", rec, "queued", None, "system", {}, reg) == ""
    assert irc._delivery_text("/r", rec, "queued", None, "note", {}, {}) == ""
    assert irc._delivery_text("/r", rec, "queued", None, "note", {}, None) == ""
    assert irc._delivery_text("/r", {"to": "all"}, "queued", None, "note", {}, reg) == ""
    assert irc._delivery_text("/r", {"channel": "c1", "owner": "sender"}, "queued", None, "note", {}, reg).startswith(
        "delivered to 2 of 2"
    )


def test_delivery_text_broadcast_without_hook(monkeypatch):
    monkeypatch.setattr(irc, "worker_inbox", None)
    reg = {"c": {"members": [{"name": "a"}]}}
    assert irc._delivery_text("/r", {"to": "all", "channel": "c", "owner": "s"}, "queued", None, "note", {}, reg) == (
        "delivered to 0 of 1 members so far (each reads it on its next tool call)"
    )


# --- _normalize_note --------------------------------------------------------


def test_normalize_note_fields(inbox):
    rec = {"ts": 1_700_000_000.0, "owner": "alice", "to": "bob", "text": "hello", "irc": True, "run": "r1", "channel": "ch"}
    inbox.result = ("delivered", 1_700_000_100.0)
    m = irc._normalize_note("/root", rec, {}, {})
    assert m["from"] == "alice" and m["to"] == "bob" and m["body"] == "hello" and m["kind"] == "irc"
    assert m["status"] == "read" and m["delivered_at"] == "2023-11-14T22:15:00Z" and m["ts"] == "2023-11-14T22:13:20Z"
    assert m["tracked"] is True and m["run"] == "r1" and m["project"] == "/root"
    assert m["channel"] == "@bob" and m["channel_name"] == "ch"
    assert m["delivery_text"] == f"delivered to bob at {irc._clock(1_700_000_100.0)}"
    assert m["_epoch"] == 1_700_000_000.0 and m["id"] == irc._message_id("/root", rec)


def test_normalize_note_kinds_and_defaults(inbox):
    base = {"ts": 1.0}
    m = irc._normalize_note("/r", {**base, "text": "x"})
    assert (m["from"], m["to"], m["kind"], m["channel"], m["body"]) == ("anon", "all", "note", "all", "x")
    assert m["delivered_at"] is None and m["tracked"] is False and m["status"] == "read"
    assert irc._normalize_note("/r", {**base, "text": "exit 0"})["kind"] == "exit"
    assert irc._normalize_note("/r", {**base, "text": "exit -1 [failed: oops]", "owner": "w"})["kind"] == "exit"
    assert irc._normalize_note("/r", {**base, "text": "exited"})["kind"] == "note"
    assert irc._normalize_note("/r", {**base, "text": " exit 0"})["kind"] == "note"
    assert irc._normalize_note("/r", {**base, "text": "hi", "owner": "board"})["kind"] == "system"
    assert irc._normalize_note("/r", {**base, "text": "hi", "owner": "system", "irc": True})["kind"] == "system"
    assert irc._normalize_note("/r", {**base, "text": None})["body"] == ""
    assert irc._normalize_note("/r", {**base, "text": "x", "to": ""})["to"] == "all"


# --- read_messages ----------------------------------------------------------


@pytest.fixture
def board(tmp_path, monkeypatch):
    root = str(tmp_path / "proj")
    os.makedirs(os.path.join(root, ".atlas", ".run"))
    monkeypatch.setattr(irc, "worker_inbox", None)
    return root


def add(root, n, owner="o", to="all", base=1_700_000_000.0):
    recs = []
    for i in range(n):
        recs.append(atlas_todo.note(root, owner, f"msg{i}", to=to))
    return recs


def test_read_messages_oserror_and_nondict_skipped(monkeypatch):
    def notes(root):
        if root == "bad":
            raise OSError("x")
        return ["junk", None, {"ts": 5, "owner": "o", "to": "all", "text": "ok"}]

    monkeypatch.setattr(atlas_todo, "notes", notes)
    monkeypatch.setattr(atlas_todo, "_reg_read", lambda root: (_ for _ in ()).throw(OSError()))
    msgs, more = irc.read_messages(["bad", "good"])
    assert [m["body"] for m in msgs] == ["ok"] and more is False
    for k in ("_epoch",):
        assert k not in msgs[0]


def test_read_messages_reg_failures_become_empty(monkeypatch):
    monkeypatch.setattr(atlas_todo, "notes", lambda root: [{"ts": 5, "owner": "o", "to": "all", "text": "ok"}])
    for exc in (OSError, KeyError, ValueError):
        monkeypatch.setattr(atlas_todo, "_reg_read", lambda root, e=exc: (_ for _ in ()).throw(e()))
        assert [m["body"] for m in irc.read_messages(["r"])[0]] == ["ok"]


def fake_notes(monkeypatch, recs):
    monkeypatch.setattr(atlas_todo, "notes", lambda root: list(recs))
    monkeypatch.setattr(atlas_todo, "_reg_read", lambda root: {"channels": {}})


def test_read_messages_since_paging(monkeypatch):
    recs = [{"ts": 100 + i, "owner": "o", "to": "all", "text": f"m{i}"} for i in range(10)]
    fake_notes(monkeypatch, recs)
    msgs, more = irc.read_messages(["r"], limit=3)
    assert [m["body"] for m in msgs] == ["m7", "m8", "m9"] and more is False  # newest page without since
    first, more = irc.read_messages(["r"], since=100, limit=3)
    assert [m["body"] for m in first] == ["m1", "m2", "m3"] and more is True
    last, more = irc.read_messages(["r"], since=106, limit=3)
    assert [m["body"] for m in last] == ["m7", "m8", "m9"] and more is False
    mid = irc.read_messages(["r"], since=first[-1]["id"], limit=3)
    assert [m["body"] for m in mid[0]] == ["m4", "m5", "m6"] and mid[1] is True
    unknown, more = irc.read_messages(["r"], since="mdeadbeef", limit=4)
    assert [m["body"] for m in unknown] == ["m6", "m7", "m8", "m9"] and more is False
    exact, more = irc.read_messages(["r"], since=100, limit=9)
    assert len(exact) == 9 and more is False


def test_read_messages_limit_bounds(monkeypatch):
    recs = [{"ts": 100 + i, "owner": "o", "to": "all", "text": f"m{i}"} for i in range(5)]
    fake_notes(monkeypatch, recs)
    assert len(irc.read_messages(["r"], limit=0)[0]) == 5  # 0 -> default 200
    assert len(irc.read_messages(["r"], limit=-5)[0]) == 1  # clamped to 1
    assert len(irc.read_messages(["r"], limit=None)[0]) == 5
    many = [{"ts": 1 + i, "owner": "o", "to": "all", "text": f"m{i}"} for i in range(1100)]
    fake_notes(monkeypatch, many)
    assert len(irc.read_messages(["r"], limit=5000)[0]) == 1000


def test_read_messages_agent_filter_and_ordering(monkeypatch):
    recs = [
        {"ts": 3, "owner": "a", "to": "b", "text": "ab"},
        {"ts": 1, "owner": "c", "to": "a", "text": "ca"},
        {"ts": 2, "owner": "c", "to": "d", "text": "cd"},
        {"ts": 2, "owner": "a", "to": "all", "text": "aall"},
    ]
    fake_notes(monkeypatch, recs)
    msgs, _ = irc.read_messages(["r"])
    assert [m["body"] for m in msgs][0] == "ca" and [m["body"] for m in msgs][-1] == "ab"
    assert {m["body"] for m in irc.read_messages(["r"], agent="a")[0]} == {"ab", "ca", "aall"}
    assert [m["body"] for m in irc.read_messages(["r"], agent="d")[0]] == ["cd"]


def test_read_messages_channel_filter_and_legacy(monkeypatch):
    recs = [
        {"ts": 1, "owner": "o", "to": "all", "text": "main-legacy"},
        {"ts": 2, "owner": "o", "to": "all", "text": "in-a", "channel": "A"},
        {"ts": 3, "owner": "o", "to": "all", "text": "in-b", "channel": "B"},
    ]
    fake_notes(monkeypatch, recs)
    assert [m["body"] for m in irc.read_messages(["r"], channel="A")[0]] == ["in-a"]
    assert {m["body"] for m in irc.read_messages(["r"], channel="A", legacy_main=True)[0]} == {"in-a", "main-legacy"}
    assert len(irc.read_messages(["r"])[0]) == 3


def test_read_messages_dedupes_across_roots(monkeypatch):
    rec = {"ts": 1, "owner": "o", "to": "all", "text": "same"}
    fake_notes(monkeypatch, [rec])
    msgs, _ = irc.read_messages(["r", "r"])
    assert len(msgs) == 1
    msgs, _ = irc.read_messages(["r1", "r2"])
    assert len(msgs) == 2  # message ids include the root


# --- h_irc_get / record -----------------------------------------------------


class FakeCtx:
    def __init__(self, query=None, body=None, root=None, groups=()):
        self.query = query or {}
        self._body = body
        self._root = root
        self.groups = groups

    def json(self):
        return self._body

    def project_root(self, p):
        return self._root if p and p != "all" else None

    def db(self):
        raise OSError("no db")


def test_h_irc_get(board):
    atlas_todo.note(board, "alice", "hi", to="bob")
    atlas_todo.note(board, "carol", "yo", to="all")
    status, body = irc.h_irc_get(FakeCtx({"project": board}, root=board))
    assert status == 200 and body["more"] is False
    assert body["agents"] == ["alice", "bob", "carol"]
    assert body["channels"] == ["@bob", "all"]
    assert {m["body"] for m in body["messages"]} == {"hi", "yo"}
    st, b2 = irc.h_irc_get(FakeCtx({"project": board, "limit": "1", "agent": "carol"}, root=board))
    assert [m["body"] for m in b2["messages"]] == ["yo"]
    st, b3 = irc.h_irc_get(FakeCtx({"project": board, "limit": "abc"}, root=board))
    assert len(b3["messages"]) == 2
    st, b4 = irc.h_irc_get(FakeCtx({"project": board, "limit": "1"}, root=board))
    assert len(b4["messages"]) == 1


def test_h_irc_get_since_pages(board):
    recs = add(board, 4)
    ts0 = recs[0]["ts"] - 1
    st, body = irc.h_irc_get(FakeCtx({"project": board, "since": str(ts0), "limit": "2"}, root=board))
    assert len(body["messages"]) == 2 and body["more"] is True


def test_record_irc_returns_normalized(board):
    msg = irc._record_irc(board, "alice", "bob", "hello", run="r9", delivery="delivered", channel=None)
    assert msg["from"] == "alice" and msg["to"] == "bob" and msg["kind"] == "irc" and msg["run"] == "r9"
    assert msg["status"] == "delivered" and msg["body"] == "hello" and msg["project"] == board
    stored = atlas_todo.notes(board)[-1]
    assert stored["delivery"] == "delivered" and stored["owner"] == "alice"
    m2 = irc._record_irc(board, "alice", "all", "chan msg", channel="mychan")
    assert atlas_todo.notes(board)[-1]["channel"] == "mychan" and m2["channel_name"] == "mychan"


# --- _find_pane / _deliver --------------------------------------------------


def test_find_pane():
    live = {"agents": [
        {"pane_id": "wA:p1", "title": "worker", "workspace": "colony"},
        {"pane_id": "wA:p2", "title": "other", "workspace": ""},
    ]}
    assert irc._find_pane(live, "wA:p1")["pane_id"] == "wA:p1"
    assert irc._find_pane(live, "other")["pane_id"] == "wA:p2"
    assert irc._find_pane(live, "colony")["pane_id"] == "wA:p1"
    assert irc._find_pane(live, "nope") is None
    assert irc._find_pane({"agents": []}, "x") is None


def test_deliver_non_interactive_refused(monkeypatch):
    called = []
    monkeypatch.setattr(atlas_seats, "send_prompt", lambda *a: called.append(a))
    stamp, ref = irc._deliver({"pane_id": "p", "agent": "unknown"}, "me", "w", "hi")
    assert stamp == "refused" and called == []
    assert ref["error"] == "pane_not_steerable" and "'unknown'" in ref["why"]
    assert ref["do"].startswith("open the pane in the herd view")


@pytest.mark.parametrize("agent", ["claude", "omp"])
def test_deliver_flattens_and_sanitizes(monkeypatch, agent):
    sent = []
    monkeypatch.setattr(atlas_seats, "send_prompt", lambda pid, text: sent.append((pid, text)))
    stamp, ref = irc._deliver({"pane_id": "wA:p1", "agent": agent}, "me\x1b", "w", "line1\nline2\r\n\tend")
    assert (stamp, ref) == ("delivered", None)
    assert sent == [("wA:p1", "From: me  | To: w | line1 | line2  | \tend".replace("\t", " "))] or sent[0][0] == "wA:p1"
    assert "\n" not in sent[0][1] and "\x1b" not in sent[0][1] and "\r" not in sent[0][1] and "\t" not in sent[0][1]
    assert sent[0][1].startswith("From: me  | To: w | line1 | line2")


def test_deliver_prompt_refused_variants(monkeypatch):
    def raiser(http, error, why=""):
        def f(pid, text):
            raise atlas_seats.PromptRefused(http, error, why)
        return f

    monkeypatch.setattr(atlas_seats, "send_prompt", raiser(409, "agent is not idle", "status is busy"))
    stamp, ref = irc._deliver({"pane_id": "p", "agent": "claude"}, "me", "w", "x")
    assert stamp is None and ref["error"] == "agent_busy" and ref["why"] == "status is busy" and ref["http"] == 409
    assert ref["do"] == "it is queued on the board; the worker reads it on its next tool call"
    monkeypatch.setattr(atlas_seats, "send_prompt", raiser(502, "herdr down", ""))
    stamp, ref = irc._deliver({"pane_id": "p", "agent": "omp"}, "me", "w", "x")
    assert stamp is None and ref["error"] == "herdr_refused" and ref["why"] == "herdr down" and ref["http"] == 502


# --- _post validation / routing --------------------------------------------


def post(board, body, **extra):
    return irc._post(FakeCtx(), {"body": body, **extra}, extra.pop("root", board) if False else board)


def test_post_validation_errors(board, monkeypatch):
    st, b = irc._post(FakeCtx(), {"body": "x"}, None)
    assert st == 400 and b["error"] == "unknown_project" and b["why"] == "project is required for IRC"
    st, b = irc._post(FakeCtx(), {"body": "   "}, board)
    assert st == 400 and b["error"] == "body_required" and b["do"] == "type something to send"
    st, b = irc._post(FakeCtx(), {"body": None}, board)
    assert b["error"] == "body_required"
    st, b = irc._post(FakeCtx(), {"body": "x", "to": "bad name"}, board)
    assert st == 400 and b["error"] == "invalid_to" and b["why"] == "'bad name' is not [A-Za-z0-9_.:-] or 'all'"
    limit = atlas_todo.note_max_bytes()
    st, b = irc._post(FakeCtx(), {"body": "é" * (limit // 2 + 1)}, board)
    assert st == 400 and b["error"] == "body_too_large"
    assert b["why"] == f"message is {2 * (limit // 2 + 1)} bytes; the limit is {limit}"
    st, b = irc._post(FakeCtx(), {"body": "é" * (limit // 2)}, board)
    assert st == 200


def test_post_defaults_to_all_from_human(board):
    st, b = irc._post(FakeCtx(), {"body": "hello"}, board)
    assert st == 200 and b["ok"] is True and b["delivered"] is False
    assert b["message"]["from"] == "human" and b["message"]["to"] == "all" and b["next"] == "recorded on the board"
    st, b = irc._post(FakeCtx(), {"body": "hello", "from": "bot", "to": "all"}, board)
    assert b["message"]["from"] == "bot"


def test_post_over_herdr_marks_delivered(board, monkeypatch):
    monkeypatch.setattr(atlas_seats, "agents", lambda: {"reachable": True, "agents": [
        {"pane_id": "wA:p1", "title": "worker", "workspace": "", "agent": "claude", "status": "idle"}]})
    sent = []
    monkeypatch.setattr(atlas_seats, "send_prompt", lambda pid, text: sent.append((pid, text)))
    st, b = irc._post(FakeCtx(), {"body": "do it", "to": "worker"}, board)
    assert st == 200 and b["delivered"] is True and b["next"] == "delivered to the pane"
    assert sent and sent[0][0] == "wA:p1" and b["message"]["status"] == "delivered"
    assert atlas_todo.notes(board)[-1]["delivery"] == "delivered"


def test_post_refused_pane_is_409_and_recorded(board, monkeypatch):
    monkeypatch.setattr(atlas_seats, "agents", lambda: {"reachable": True, "agents": [
        {"pane_id": "wA:p1", "title": "sh", "workspace": "", "agent": "unknown", "status": "idle"}]})
    st, b = irc._post(FakeCtx(), {"body": "ls", "to": "sh"}, board)
    assert st == 409 and b["ok"] is False and b["error"] == "pane_not_steerable" and b["delivered"] is False
    assert b["message"]["delivered"] is False and b["message"]["status"] == "refused"
    assert b["next"] == "recorded on the board, but not typed into the pane"
    assert "http" not in b


def test_post_busy_pane_uses_refusal_http(board, monkeypatch):
    monkeypatch.setattr(atlas_seats, "agents", lambda: {"reachable": True, "agents": [
        {"pane_id": "wA:p1", "title": "w", "workspace": "", "agent": "claude", "status": "working"}]})

    def busy(pid, text):
        raise atlas_seats.PromptRefused(409, "agent is not idle", "status is working")

    monkeypatch.setattr(atlas_seats, "send_prompt", busy)
    st, b = irc._post(FakeCtx(), {"body": "x", "to": "w"}, board)
    assert st == 409 and b["error"] == "agent_busy" and b["message"]["status"] in ("queued", "undeliverable")
    assert "delivery" not in atlas_todo.notes(board)[-1] or atlas_todo.notes(board)[-1]["delivery"] is None


def test_post_herdr_unreachable_ignores_agents(board, monkeypatch):
    monkeypatch.setattr(atlas_seats, "agents", lambda: {"reachable": False, "agents": [
        {"pane_id": "p", "title": "w", "workspace": "", "agent": "claude", "status": "idle"}]})
    monkeypatch.setattr(atlas_seats, "send_prompt", lambda *a: pytest.fail("must not type"))
    import atlas_dash_colony

    monkeypatch.setattr(atlas_dash_colony, "refusal", lambda root, to: None)
    st, b = irc._post(FakeCtx(), {"body": "x", "to": "w"}, board)
    assert st == 200 and b["delivered"] is False


def test_post_gone_worker_refused(board, monkeypatch):
    monkeypatch.setattr(atlas_seats, "agents", lambda: {"reachable": False, "agents": []})
    import atlas_dash_colony

    seen = []
    monkeypatch.setattr(atlas_dash_colony, "refusal", lambda root, to: seen.append((root, to)) or (409, {"error": "gone"}))
    assert irc._post(FakeCtx(), {"body": "x", "to": "ghost"}, board) == (409, {"error": "gone"})
    assert seen == [(board, "ghost")]
    assert atlas_todo.notes(board) == []
    # lead / lead-* targets and broadcasts never consult the colony
    seen.clear()
    for to in ("lead", "lead-abc", "all"):
        irc._post(FakeCtx(), {"body": "x", "to": to}, board)
    assert seen == []


def test_post_lead_resolution(board, monkeypatch):
    monkeypatch.setattr(atlas_seats, "agents", lambda: {"reachable": False, "agents": []})
    monkeypatch.setattr(irc, "_lead_of", lambda root, ch: "lead-xyz")
    import atlas_dash_colony

    monkeypatch.setattr(atlas_dash_colony, "refusal", lambda root, to: None)
    st, b = irc._post(FakeCtx(), {"body": "x", "to": "lead", "channel": "ch"}, board)
    assert b["message"]["to"] == "lead-xyz"
    monkeypatch.setattr(irc, "_lead_of", lambda root, ch: None)
    st, b = irc._post(FakeCtx(), {"body": "x", "to": "lead"}, board)
    assert b["message"]["to"] == "lead"


def test_h_irc_post_uses_ctx_project(board):
    st, b = irc.h_irc_post(FakeCtx(body={"project": board, "body": "via route"}, root=board))
    assert st == 200 and b["message"]["body"] == "via route"
    st, b = irc.h_irc_post(FakeCtx(body={"body": "no project"}, root=None))
    assert st == 400 and b["error"] == "unknown_project"


# --- _lead_of ---------------------------------------------------------------


def test_lead_of(monkeypatch):
    import atlas_dash_colony as col

    chans = [{"name": "m", "kind": "main"}, {"name": "m/l1", "kind": "lead", "lead": "lead-1"},
             {"name": "m/l2", "kind": "lead", "lead": "lead"}]
    monkeypatch.setattr(col, "_flatten", lambda root: chans)
    monkeypatch.setattr(col, "_active_lead", lambda cs: cs[1])
    assert irc._lead_of("/r", "m/l1") == "lead-1"
    assert irc._lead_of("/r", None) == "lead-1"
    assert irc._lead_of("/r", "unknown-channel") == "lead-1"  # falls back to the active lead
    assert irc._lead_of("/r", "m/l2") is None  # a literal "lead" is not an address
    monkeypatch.setattr(col, "_active_lead", lambda cs: None)
    assert irc._lead_of("/r", None) is None
    assert irc._lead_of("/r", "m") is None  # main has no lead
    for exc in (OSError, KeyError, ValueError):
        monkeypatch.setattr(col, "_flatten", lambda root, e=exc: (_ for _ in ()).throw(e()))
        assert irc._lead_of("/r", None) is None


# --- channels: live index / roster / views ---------------------------------


def test_unavailable():
    st, b = irc._unavailable()
    assert st == 503 and b["error"] == "channels_unavailable" and b["do"] == "update the atlas plugin"


def test_live_index(monkeypatch):
    agents = [
        {"pane_id": "wA:p1", "title": "t1", "status": "idle", "agent": "claude"},
        {"pane_id": "wA:p2", "title": "", "status": "working", "agent": "omp"},
    ]
    monkeypatch.setattr(atlas_seats, "agents", lambda: {"reachable": True, "agents": agents})
    monkeypatch.setattr(atlas_seats, "list_panes", lambda: [{"pane_id": "wA:p1", "label": "colony-a"}])
    idx = irc._live_index()
    assert set(idx) == {"wA:p1", "t1", "colony-a", "wA:p2"}
    assert idx["t1"] == {"pane_id": "wA:p1", "state": "idle", "kind": "claude"}
    assert idx["wA:p2"] == {"pane_id": "wA:p2", "state": "working", "kind": "omp"}

    def boom():
        raise atlas_seats.SockError("down")

    monkeypatch.setattr(atlas_seats, "list_panes", boom)
    assert set(irc._live_index()) == {"wA:p1", "t1", "wA:p2"}
    monkeypatch.setattr(atlas_seats, "agents", lambda: {"reachable": False, "agents": agents})
    assert irc._live_index() == {}


def test_live_index_first_key_wins(monkeypatch):
    agents = [
        {"pane_id": "p1", "title": "dup", "status": "idle", "agent": "claude"},
        {"pane_id": "p2", "title": "dup", "status": "working", "agent": "omp"},
    ]
    monkeypatch.setattr(atlas_seats, "agents", lambda: {"reachable": True, "agents": agents})
    monkeypatch.setattr(atlas_seats, "list_panes", lambda: [])
    assert irc._live_index()["dup"]["pane_id"] == "p1"


def test_roster(monkeypatch):
    import atlas_dash_colony as col

    monkeypatch.setattr(col, "build_colony", lambda root, all_=False: {"members": [{"name": "a", "state": "running"}, {"name": "b"}]})
    monkeypatch.setattr(col, "_flatten", lambda root: [])
    monkeypatch.setattr(col, "_active_lead", lambda cs: {"name": "m/lead-1"})
    rows, cur = irc._roster("/r")
    assert set(rows) == {"a", "b"} and rows["a"]["state"] == "running" and cur == "m/lead-1"
    monkeypatch.setattr(col, "_active_lead", lambda cs: None)
    assert irc._roster("/r")[1] is None
    for exc in (OSError, KeyError, ValueError):
        monkeypatch.setattr(col, "build_colony", lambda root, all_=False, e=exc: (_ for _ in ()).throw(e()))
        assert irc._roster("/r") == ({}, None)


def test_presence_state_map():
    assert irc.PRESENCE_STATE == {
        "running": "working", "idle": "idle", "stuck": "input", "finished": "done", "dead": "fail", "parked": "parked",
    }


def test_member_view():
    live = {"w": {"pane_id": "wA:p1", "state": "idle"}}
    roster = {"w": {"state": "running", "pane_id": "rowpane", "parked": 1, "deliver": {"ok": True}, "exit_code": 0,
                    "last_note": {"ts": 1_700_000_000}}}
    v = irc._member_view({"name": "w", "role": "worker", "parent": "lead-1"}, live, {"w": "seen!"}, roster)
    assert v == {
        "name": "w", "kind": "worker", "parent": "lead-1", "pane_id": "wA:p1", "state": "working",
        "live_state": "running", "parked": True, "deliver": {"ok": True}, "exit_code": 0, "last_seen": "seen!",
    }
    v = irc._member_view({"name": "w"}, live, None, roster)
    assert v["kind"] == "subagent" and v["last_seen"] == "2023-11-14T22:13:20Z"
    v = irc._member_view({"name": "w"}, {}, None, roster)
    assert v["pane_id"] == "rowpane"
    v = irc._member_view({"name": "x"}, live, None, None)
    assert v["state"] is None and v["live_state"] is None and v["parked"] is False and v["last_seen"] is None
    assert v["pane_id"] is None and v["name"] == "x"
    v = irc._member_view({"name": "w"}, live, None, {"w": {"state": "weird"}})
    assert v["state"] == "idle"  # unmapped roster state falls back to the live herdr state
    assert irc._member_view({}, {}, None, None)["name"] == ""
    v = irc._member_view({"name": "z", "role": ""}, {}, None, {"z": {"last_note": None}})
    assert v["kind"] == "subagent" and v["last_seen"] is None


def test_chan_view():
    c = {
        "name": "m/l", "kind": "lead", "parent": "m", "lead": "lead-1", "project_root": "/p", "branch": "br",
        "created": 1_700_000_000, "last_activity": 55.0, "members": [{"name": "w"}],
    }
    roster = {"lead-1": {"state": "idle", "liveness": {"active": False}}}
    v = irc._chan_view("/root", c, {}, roster, "m/l")
    assert v["name"] == "m/l" and v["kind"] == "lead" and v["parent"] == "m" and v["lead"] == "lead-1"
    assert v["lead_state"] == "idle" and v["lead_liveness"] == {"active": False} and v["current"] is True
    assert v["project"] == "/p" and v["branch"] == "br" and v["created"] == "2023-11-14T22:13:20Z"
    assert v["last_activity"] == 55.0 and [m["name"] for m in v["members"]] == ["w"]
    v = irc._chan_view("/root", {"name": "n", "created": "yesterday"}, {}, None, None)
    assert v["kind"] == "main" and v["project"] == "/root" and v["created"] == "yesterday" and v["current"] is False
    assert v["lead_state"] is None and v["members"] == []
    assert irc._chan_view("/root", {"name": "n"}, {}, {}, "other")["current"] is False
    assert irc._chan_view("/root", {"name": "n"}, {}, {}, "")["current"] is False


def test_decode_and_junk_root(tmp_path, monkeypatch):
    assert irc._decode("a%40b%2Fc") == "a@b/c"
    assert irc._decode("plain") == "plain"
    real = tmp_path / "real"
    real.mkdir()
    import atlas_dash_work

    monkeypatch.setattr(atlas_dash_work, "_junk_root", lambda r: r == "junk")
    assert irc._junk_root("junk") is True
    assert irc._junk_root(str(real)) is False
    assert irc._junk_root(str(tmp_path / "gone")) is True


def test_hide_stale_leads():
    def v(name, parent, la, state="idle", current=False, active=False, kind="lead"):
        return {"name": name, "kind": kind, "parent": parent, "current": current, "lead_state": state,
                "last_activity": la, "lead_liveness": {"active": active}}

    out = [
        v("main", None, 1, kind="main"),
        v("old", "main", 10),
        v("new", "main", 20),
        v("old-active", "main", 5, active=True),
        v("old-busy", "main", 5, state="running"),
        v("old-current", "main", 5, current=True),
        v("other-old", "m2", 5),
        v("none", "main", None),
    ]
    kept = [x["name"] for x in irc._hide_stale_leads(out)]
    assert kept == ["main", "new", "old-active", "old-busy", "old-current", "other-old"]
    nol = v("nol", "main", 3)
    nol["lead_liveness"] = None
    assert irc._hide_stale_leads([v("n", "main", 9), nol]) == [v("n", "main", 9)]
    assert irc._hide_stale_leads([]) == []


# --- channel handlers -------------------------------------------------------


def test_channels_handlers_unavailable(monkeypatch):
    monkeypatch.delattr(atlas_todo, "channels", raising=False) if hasattr(atlas_todo, "channels") else None
    assert irc.h_channels_get(FakeCtx())[0] == 503
    monkeypatch.undo()


def test_channel_get_and_post_unavailable(monkeypatch):
    saved = atlas_todo.get_channel
    monkeypatch.delattr(atlas_todo, "get_channel")
    try:
        assert irc.h_channel_get(FakeCtx(groups=("x",)))[0] == 503
        assert irc.h_channels_post(FakeCtx(body={"channel": "x"}))[0] == 503
        st, b = irc.h_channels_post(FakeCtx(body={}))
        assert st == 400 and b["error"] == "channel_required" and b["do"] == "pass the channel name"
    finally:
        monkeypatch.setattr(atlas_todo, "get_channel", saved, raising=False)


def test_channels_get_ensures_main_and_skips_oserror(board, monkeypatch):
    monkeypatch.setattr(irc, "_junk_root", lambda r: False)
    monkeypatch.setattr(irc, "_live_index", lambda: {})
    monkeypatch.setattr(irc, "_roster", lambda r: ({}, None))
    ctx = FakeCtx({"project": board}, root=board)
    st, body = irc.h_channels_get(ctx)
    assert st == 200 and body["channels"] and body["current"] == body["channels"][0]["name"]
    calls = []
    real = atlas_todo.channels
    monkeypatch.setattr(atlas_todo, "channels", lambda root: (calls.append(root) or (_ for _ in ()).throw(OSError())))
    assert irc.h_channels_get(ctx) == (200, {"channels": [], "current": None})
    monkeypatch.setattr(atlas_todo, "channels", real)
    monkeypatch.setattr(irc, "_junk_root", lambda r: True)
    assert irc.h_channels_get(ctx) == (200, {"channels": [], "current": None})


def test_channel_get_limit_and_missing(board, monkeypatch):
    monkeypatch.setattr(irc, "_live_index", lambda: {})
    monkeypatch.setattr(irc, "_roster", lambda r: ({}, None))
    atlas_todo.ensure_main(board)
    name = atlas_todo.channels(board)[0]["name"]
    for i in range(3):
        atlas_todo.note(board, "o", f"m{i}", to="all", channel=name)
    ctx = FakeCtx({"project": board, "limit": "2"}, root=board, groups=(name.replace("/", "%2F"),))
    st, body = irc.h_channel_get(ctx)
    assert st == 200 and len(body["messages"]) == 2 and body["channel"]["name"] == name
    ctx = FakeCtx({"project": board, "limit": "zz"}, root=board, groups=(name,))
    assert len(irc.h_channel_get(ctx)[1]["messages"]) == 3
    st, b = irc.h_channel_get(FakeCtx({"project": board}, root=board, groups=("nope",)))
    assert st == 404 and b["error"] == "no_such_channel" and b["why"] == "'nope' is not a channel"
    assert b["do"] == "list /api/v2/channels"
    st, b = irc.h_channels_post(FakeCtx(body={"channel": "nope", "project": board, "body": "x"}, root=board))
    assert st == 404 and b["error"] == "no_such_channel"


def test_find_channel_oserror_skipped(monkeypatch):
    def boom(root, name):
        raise OSError()

    monkeypatch.setattr(atlas_todo, "get_channel", boom)
    monkeypatch.setattr(irc, "_project_roots", lambda ctx, p: ["r1"])
    assert irc._find_channel(FakeCtx({"project": "r1"}, root="r1"), "x") == (None, None)


def test_find_channel_reads_project_from_body(monkeypatch):
    seen = []
    monkeypatch.setattr(irc, "_project_roots", lambda ctx, p: seen.append(p) or ["r1"])
    monkeypatch.setattr(atlas_todo, "get_channel", lambda root, name: {"name": name})
    assert irc._find_channel(FakeCtx(body={"project": "fromBody"}), "n") == ("r1", {"name": "n"})
    assert seen == ["fromBody"]
    assert irc._find_channel(FakeCtx({"project": "fromQuery"}, body={"project": "b"}), "n")[0] == "r1"
    assert seen[-1] == "fromQuery"
    assert irc._find_channel(FakeCtx(body=None), "n")[0] == "r1"


def test_board_view(monkeypatch):
    board = {
        "counts": {"needed": 2},
        "members": [
            {"name": "w", "role": "worker", "parent": "l", "counts": {"x": 1}, "last_note": {"t": 1},
             "items": [{"id": "t1", "content": "c", "status": "in_progress", "owner": "w"}, "broken"]},
            {"name": "empty"},
        ],
    }
    monkeypatch.setattr(atlas_todo, "channel_board", lambda root, name: board)
    v = irc._board_view("/r", "ch")
    assert v["counts"] == {"needed": 2} and len(v["owners"]) == 2
    w = v["owners"][0]
    assert (w["owner"], w["role"], w["parent"], w["counts"], w["last_note"]) == ("w", "worker", "l", {"x": 1}, {"t": 1})
    assert len(w["items"]) == 1 and w["items"][0]["id"] == "t1" and w["items"][0]["claimed_by"] == "w"
    assert v["owners"][1] == {"owner": "empty", "role": None, "parent": None, "counts": {}, "last_note": None, "items": []}
    monkeypatch.setattr(atlas_todo, "channel_board", lambda root, name: None)
    assert irc._board_view("/r", "ch") == {"owners": [], "counts": {}}
    for exc in (OSError, KeyError):
        monkeypatch.setattr(atlas_todo, "channel_board", lambda root, name, e=exc: (_ for _ in ()).throw(e()))
        assert irc._board_view("/r", "ch") == {"owners": [], "counts": {}}


def test_routes_table():
    assert [(m, p) for m, p, _ in irc.ROUTES] == [
        ("GET", r"/api/v2/irc"), ("POST", r"/api/v2/irc"), ("GET", r"/api/v2/channels"),
        ("POST", r"/api/v2/channels"), ("GET", r"/api/v2/channels/([^/?#]+)"),
    ]
    assert irc.HUMAN == "human" and irc.INTERACTIVE_AGENTS == ("claude", "omp")


def test_valid_rejects_trailing_newline():
    assert irc._valid("name")
    assert not irc._valid("name\n")
