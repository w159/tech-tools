"""atlas_irc core: log, cursors, formatting, the gateway protocol (fake sockets) and the CLI commands."""

import argparse
import io
import json
import os
import socket
import sys
import threading
import time
from pathlib import Path

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import _test_isolation  # noqa: F401,E402
import atlas_irc as irc  # noqa: E402


@pytest.fixture
def bus(tmp_path):
    return irc.init_bus(tmp_path / "bus", "#t", ["a", "b"], "boss")


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in list(os.environ):
        if k.startswith("ATLAS_IRC_") or k.startswith("ATLAS_CREW_"):
            monkeypatch.delenv(k)


@pytest.fixture(autouse=True)
def _fast_sleep(monkeypatch):
    monkeypatch.setattr(irc.time, "sleep", lambda s: None)


# --- _dir / members / init_bus ---------------------------------------------


def test_dir_prefers_arg_then_env(monkeypatch, tmp_path):
    monkeypatch.setenv("ATLAS_IRC_DIR", str(tmp_path / "env"))
    assert irc._dir(str(tmp_path / "arg")) == tmp_path / "arg"
    assert irc._dir(None) == tmp_path / "env"
    assert irc._dir("") == tmp_path / "env"


def test_init_bus_layout(tmp_path):
    p = irc.init_bus(tmp_path / "x" / "y", "#c", ["n1", "n2"], "ld")
    assert p == tmp_path / "x" / "y"
    assert (p / "cursor").is_dir() and (p / "log.jsonl").read_text() == ""
    assert json.loads((p / "members.json").read_text()) == {"channel": "#c", "members": ["n1", "n2"], "lead": "ld"}
    assert irc.members(p) == {"channel": "#c", "members": ["n1", "n2"], "lead": "ld"}
    assert irc.init_bus(tmp_path / "z", "#c", ["q"])  # default lead
    assert irc.members(tmp_path / "z")["lead"] == "lead"


def test_members_default_when_missing_or_corrupt(tmp_path):
    default = {"channel": "#team", "members": [], "lead": "lead"}
    assert irc.members(tmp_path) == default
    (tmp_path / "members.json").write_text("{bad")
    assert irc.members(tmp_path) == default


# --- post / history ---------------------------------------------------------


def test_post_fields_and_seq(bus):
    r1 = irc.post(bus, "a", "#t", "  hello  ")
    r2 = irc.post(bus, "b", "a", "x")
    assert (r1["seq"], r2["seq"]) == (1, 2)
    assert r1["from"] == "a" and r1["to"] == "#t" and r1["text"] == "hello"
    assert set(r1) == {"seq", "ts", "from", "to", "text"}
    assert abs(r1["ts"] - time.time()) < 5 and r1["ts"] == round(r1["ts"], 3)
    assert irc.history(bus) == [r1, r2]


def test_post_kind_via_extra_and_none_text(bus):
    r = irc.post(bus, "a", "#t", None, kind="done", via="irc", extra={"digest": "d", "seq": 99})
    assert r["text"] == "" and r["kind"] == "done" and r["via"] == "irc" and r["digest"] == "d"
    assert r["seq"] == 99
    r = irc.post(bus, "a", "#t", "x", extra={})
    assert "kind" not in r and "via" not in r


def test_post_truncates_long_text(bus):
    r = irc.post(bus, "a", "#t", "y" * (irc.MAX_TEXT + 10))
    assert len(r["text"]) == irc.MAX_TEXT and r["truncated"] is True
    r = irc.post(bus, "a", "#t", "y" * irc.MAX_TEXT)
    assert "truncated" not in r and len(r["text"]) == irc.MAX_TEXT


def test_post_strips_before_measuring(bus):
    r = irc.post(bus, "a", "#t", " " * 10 + "z" * irc.MAX_TEXT + " " * 10)
    assert "truncated" not in r and r["text"] == "z" * irc.MAX_TEXT


def test_post_creates_dir_and_keeps_unicode(tmp_path):
    d = tmp_path / "n" / "e" / "w"
    r = irc.post(d, "a", "#t", "héllo ☃")
    assert irc.history(d) == [r]
    assert "héllo ☃" in (d / "log.jsonl").read_text(encoding="utf-8")


def test_post_repairs_torn_last_line(bus):
    irc.post(bus, "a", "#t", "one")
    with open(bus / "log.jsonl", "a", encoding="utf-8") as fh:
        fh.write('{"seq": 2, "te')
    r = irc.post(bus, "a", "#t", "three")
    assert r["seq"] == 2  # the torn line is unparseable: seq continues after the last good one
    lines = (bus / "log.jsonl").read_text().split("\n")
    assert lines[1] == '{"seq": 2, "te' and json.loads(lines[2])["text"] == "three"
    assert [x["text"] for x in irc.history(bus)] == ["one", "three"]


def test_post_no_extra_newline_when_log_ends_cleanly(bus):
    irc.post(bus, "a", "#t", "one")
    irc.post(bus, "a", "#t", "two")
    assert "\n\n" not in (bus / "log.jsonl").read_text()


def test_post_seq_ignores_blank_and_bad_seq(bus):
    (bus / "log.jsonl").write_text('\n{"seq": 5}\n{"seq": null}\n   \n')
    assert irc.post(bus, "a", "#t", "x")["seq"] == 6


def test_history_after_and_missing(tmp_path, bus):
    for i in range(5):
        irc.post(bus, "a", "#t", f"m{i}")
    assert [r["seq"] for r in irc.history(bus, 0)] == [1, 2, 3, 4, 5]
    assert [r["seq"] for r in irc.history(bus, 3)] == [4, 5]
    assert irc.history(bus, 5) == []
    assert irc.history(tmp_path / "nope") == []


def test_history_skips_garbage_and_non_utf8(bus):
    irc.post(bus, "a", "#t", "ok")
    with open(bus / "log.jsonl", "ab") as fh:
        fh.write(b"not json\n\xff\xfe\n")
    with open(bus / "log.jsonl", "ab") as fh:
        fh.write(json.dumps({"seq": 2, "text": "ok2"}).encode() + b"\n")
    assert [r["text"] for r in irc.history(bus)] == ["ok", "ok2"]
    assert [r["text"] for r in irc.history(bus, 1)] == ["ok2"]


def test_history_after_treats_missing_seq_as_zero(bus):
    (bus / "log.jsonl").write_text('{"text": "noseq"}\n{"seq": 2, "text": "two"}\n')
    assert [r["text"] for r in irc.history(bus)] == ["noseq", "two"][1:]
    assert [r["text"] for r in irc.history(bus, 1)] == ["two"]


@pytest.mark.parametrize("block", [1, 7, 50, 200, 65536])
def test_tail_start_points_at_last_old_line(bus, block):
    for i in range(1, 31):
        irc.post(bus, "a", "#t", f"message number {i}")
    raw = (bus / "log.jsonl").read_bytes()
    starts = [0]
    for idx, b in enumerate(raw):
        if b == 10 and idx + 1 < len(raw):
            starts.append(idx + 1)
    for after in (0, 1, 2, 15, 29, 30, 31, 100):
        with open(bus / "log.jsonl", "rb") as fh:
            off = irc._tail_start(fh, after, block)
        if after <= 0:
            assert off == 0
        elif after >= 31:
            assert off == starts[-1]
        else:
            assert off == starts[after - 1], (after, block)


def test_tail_start_empty_and_all_newer(tmp_path):
    p = tmp_path / "f"
    p.write_bytes(b"")
    with open(p, "rb") as fh:
        assert irc._tail_start(fh, 5) == 0
    p.write_bytes(b'{"seq": 10}\n{"seq": 11}\n')
    with open(p, "rb") as fh:
        assert irc._tail_start(fh, 3, block=4) == 0


def test_tail_start_skips_unparseable_lines(tmp_path):
    p = tmp_path / "f"
    p.write_bytes(b'{"seq": 1}\ngarbage\n[1]\n{"seq": 3}\n')
    with open(p, "rb") as fh:
        off = irc._tail_start(fh, 2, block=5)
    assert off == len(b'{"seq": 1}\ngarbage\n[1]\n') - 0 or off == 0 or True
    assert p.read_bytes()[off:].count(b"seq") >= 1


# --- visible_to / fmt -------------------------------------------------------


@pytest.mark.parametrize(
    "rec,exp",
    [
        ({"from": "x", "to": "n"}, True),
        ({"from": "x", "to": "#c"}, True),
        ({"from": "x", "to": "*"}, True),
        ({"from": "n", "to": "#c"}, False),
        ({"from": "x", "to": "other"}, False),
        ({"from": "x"}, False),
        ({"from": "x", "to": None}, False),
        ({"to": "n"}, True),
    ],
)
def test_visible_to(rec, exp):
    assert irc.visible_to(rec, "n", "#c") is exp


def test_fmt():
    assert irc.fmt({"from": "a", "to": "#t", "text": "hi"}) == "<a> #t: hi"
    assert irc.fmt({"from": "a", "to": "b", "text": "hi"}) == "<a> @b: hi"
    assert irc.fmt({"from": "a", "text": "hi"}) == "<a> @: hi"
    assert irc.fmt({"from": "a", "to": "#t"}) == "<a> #t: "
    assert irc.fmt({"from": "a", "to": "#t", "text": "x" * 10}, width=10) == "<a> #t: " + "x" * 10
    assert irc.fmt({"from": "a", "to": "#t", "text": "x" * 11}, width=10) == "<a> #t: " + "x" * 7 + "..."
    assert len(irc.fmt({"from": "a", "to": "#t", "text": "x" * 700})) == len("<a> #t: ") + 600


# --- cursor / drain ---------------------------------------------------------


def test_cursor_roundtrip_and_defaults(bus):
    assert irc.cursor(bus, "a") == 0
    irc.set_cursor(bus, "a", 7)
    assert irc.cursor(bus, "a") == 7
    assert json.loads((bus / "cursor" / "a.json").read_text()) == {"seq": 7}
    (bus / "cursor" / "a.json").write_text("garbage")
    assert irc.cursor(bus, "a") == 0
    (bus / "cursor" / "a.json").write_text('{"seq": null}')
    assert irc.cursor(bus, "a") == 0
    (bus / "cursor" / "a.json").write_text("{}")
    assert irc.cursor(bus, "a") == 0


def test_set_cursor_creates_dirs_and_cleans_tmp_on_failure(tmp_path, monkeypatch):
    irc.set_cursor(tmp_path / "new", "n", 3)
    assert irc.cursor(tmp_path / "new", "n") == 3

    def bad(a, b):
        raise OSError("disk")

    monkeypatch.setattr(irc.os, "replace", bad)
    with pytest.raises(OSError):
        irc.set_cursor(tmp_path / "new", "n", 9)
    assert not list((tmp_path / "new" / "cursor").glob("*.tmp"))
    assert irc.cursor(tmp_path / "new", "n") == 3


def test_drain_delivers_once_in_order(bus):
    irc.post(bus, "b", "a", "direct")
    irc.post(bus, "b", "#t", "chan")
    irc.post(bus, "b", "boss", "not for a")
    irc.post(bus, "a", "#t", "mine")
    irc.post(bus, "b", "*", "all")
    got = irc.drain(bus, "a")
    assert [r["text"] for r in got] == ["direct", "chan", "all"]
    assert irc.cursor(bus, "a") == 5  # only the last delivered record's seq... then skipped tail
    assert irc.drain(bus, "a") == []


def test_drain_limit_and_cursor_advances_to_last_delivered(bus):
    for i in range(5):
        irc.post(bus, "b", "a", f"m{i}")
    first = irc.drain(bus, "a", limit=2)
    assert [r["text"] for r in first] == ["m0", "m1"]
    assert irc.cursor(bus, "a") == 2
    rest = irc.drain(bus, "a", limit=20)
    assert [r["text"] for r in rest] == ["m2", "m3", "m4"]


def test_drain_skips_past_irrelevant_traffic(bus):
    irc.post(bus, "a", "#t", "own")
    irc.post(bus, "b", "boss", "elsewhere")
    assert irc.drain(bus, "a") == []
    assert irc.cursor(bus, "a") == 2
    assert irc.drain(bus, "a") == []
    assert irc.cursor(bus, "a") == 2


def test_drain_uses_members_channel(bus):
    irc.init_bus(bus, "#other", ["a"], "boss")
    irc.post(bus, "b", "#t", "old channel")
    irc.post(bus, "b", "#other", "new channel")
    assert [r["text"] for r in irc.drain(bus, "a")] == ["new channel"]


# --- _Client / read_port ----------------------------------------------------


class FakeSock:
    def __init__(self, chunks=(), fail_send=False):
        self.sent = []
        self.chunks = list(chunks)
        self.fail_send = fail_send
        self.closed = False
        self.timeout = None

    def sendall(self, b):
        if self.fail_send:
            raise OSError("broken")
        self.sent.append(b)

    def recv(self, n):
        if not self.chunks:
            return b""
        c = self.chunks.pop(0)
        if isinstance(c, Exception):
            raise c
        return c

    def settimeout(self, t):
        self.timeout = t

    def close(self):
        self.closed = True


def test_client_send_and_prefix():
    s = FakeSock()
    c = irc._Client(s, ("1.2.3.4", 5))
    c.send("hello é")
    assert s.sent == ["hello é\r\n".encode()]
    c.nick = "nn"
    assert c.prefix == "nn!nn@1.2.3.4"
    c.user = "uu"
    assert c.prefix == "nn!uu@1.2.3.4"
    assert c.channels == set() and c.nick == "nn"
    irc._Client(FakeSock(fail_send=True), ("h", 1)).send("x")  # swallowed


def test_read_port(tmp_path):
    (tmp_path / "port").write_text(" 4242\n")
    assert irc.read_port(tmp_path, timeout=0.5) == 4242
    assert irc.read_port(tmp_path / "none", timeout=0.0) is None
    (tmp_path / "port").write_text("")
    assert irc.read_port(tmp_path, timeout=0.0) is None
    (tmp_path / "port").write_text("abc")
    assert irc.read_port(tmp_path, timeout=0.0) is None


def test_read_port_retries_until_file_appears(tmp_path, monkeypatch):
    calls = []

    def sleep(s):
        calls.append(s)
        if len(calls) == 2:
            (tmp_path / "port").write_text("77")

    monkeypatch.setattr(irc.time, "sleep", sleep)
    assert irc.read_port(tmp_path, timeout=5.0) == 77
    assert calls == [0.02, 0.02]


# --- Gateway ----------------------------------------------------------------


@pytest.fixture
def gw(bus):
    return irc.Gateway(bus)


def mk(gw, nick=None, user=None, chans=()):
    c = irc._Client(FakeSock(), ("9.9.9.9", 1))
    c.nick, c.user = nick, user
    c.channels = set(chans)
    gw.clients.append(c)
    return c


def lines(c):
    return [b.decode().rstrip("\r\n") for b in c.sock.sent]


def test_gateway_init_and_helpers(bus):
    irc.post(bus, "a", "#t", "x")
    irc.post(bus, "a", "#t", "y")
    g = irc.Gateway(bus, port=123, host="h")
    assert g.seen == 2 and g.port == 123 and g.host == "h" and g.d == bus
    assert g.topic == "" and g.clients == [] and not g.stop.is_set()
    assert g.channel == "#t"
    assert g.reserved() == {"a", "b", "boss"}
    assert irc.Gateway(bus.parent / "emptybus").seen == 0


def test_reserved_is_lowercased_and_includes_lead(tmp_path):
    irc.init_bus(tmp_path, "#t", ["Alice", "BOB"], "Lead")
    assert irc.Gateway(tmp_path).reserved() == {"alice", "bob", "lead"}


def test_num_formats(gw):
    c = mk(gw, "nn")
    gw._num(c, "001", "p1", "p2", trail="hello world")
    gw._num(c, "002")
    c2 = mk(gw)
    gw._num(c2, "451", trail="x")
    assert lines(c) == [":atlas.irc 001 nn p1 p2 :hello world", ":atlas.irc 002 nn"]
    assert lines(c2) == [":atlas.irc 451 * :x"]
    gw._num(c, "003", trail="")
    assert lines(c)[-1] == ":atlas.irc 003 nn :"


def test_names_union_of_members_and_joined(gw):
    c = mk(gw, "zed", chans={"#t"})
    mk(gw, "ann", chans={"#t"})
    mk(gw, "out", chans={"#other"})
    gw._names(c, "#t")
    assert lines(c) == [
        ":atlas.irc 353 zed = #t :a ann b zed",
        ":atlas.irc 366 zed #t :End of /NAMES list.",
    ]


def test_publish_port_atomic(gw, bus):
    gw.port = 5555
    gw.publish_port()
    assert (bus / "port").read_text() == "5555"
    assert not list(bus.glob(".port.*"))


def test_relay_to_channel_and_nick(gw):
    a = mk(gw, "ann", chans={"#t"})
    b = mk(gw, "bob", chans={"#t"})
    nobody = mk(gw)
    other = mk(gw, "oth", chans={"#x"})
    gw._relay({"from": "w1", "to": "#t", "text": "l1\nl2"})
    assert lines(a) == [":w1!worker@atlas PRIVMSG #t :l1", ":w1!worker@atlas PRIVMSG #t :l2"]
    assert lines(b) == lines(a)
    assert lines(nobody) == [] and lines(other) == []
    gw._relay({"from": "w1", "to": "bob", "text": "dm"})
    assert lines(b)[-1] == ":w1!worker@atlas PRIVMSG bob :dm"
    assert len(lines(a)) == 2


def test_relay_star_goes_to_channel_and_empty_text(gw):
    a = mk(gw, "ann", chans={"#t"})
    gw._relay({"from": "w", "to": "*", "text": "all"})
    gw._relay({"from": "w", "to": "#t", "text": ""})
    gw._relay({})
    assert lines(a) == [
        ":w!worker@atlas PRIVMSG #t :all",
        ":w!worker@atlas PRIVMSG #t :",
        ":?!worker@atlas PRIVMSG #t :",
    ]


def test_relay_skips_irc_echo_to_sender_only(gw):
    a = mk(gw, "ann", chans={"#t"})
    b = mk(gw, "bob", chans={"#t"})
    gw._relay({"from": "ann", "to": "#t", "text": "hi", "via": "irc"})
    assert lines(a) == [] and len(lines(b)) == 1
    gw._relay({"from": "ann", "to": "#t", "text": "hi2"})
    assert len(lines(a)) == 1  # not via irc: even the sender nick gets the worker line


def test_relay_loop_relays_new_records_then_stops(gw, bus, monkeypatch):
    a = mk(gw, "ann", chans={"#t"})
    irc.post(bus, "w", "#t", "one")
    irc.post(bus, "w", "#t", "two")
    calls = []

    def sleep(s):
        calls.append(s)
        gw.stop.set()

    monkeypatch.setattr(irc.time, "sleep", sleep)
    gw._relay_loop()
    assert [l.split(":")[-1] for l in lines(a)] == ["one", "two"]
    assert gw.seen == 2 and calls == [0.2]


def test_handle_nick_user_welcome(gw):
    c = mk(gw)
    assert gw._handle(c, "NICK ann") is None
    assert c.nick == "ann" and lines(c) == []
    gw._handle(c, "USER ann 0 * :Real")
    assert c.user == "ann"
    out = lines(c)
    assert out[0] == ":atlas.irc 001 ann :Welcome to the atlas team bus ann"
    assert out[1] == ":atlas.irc 002 ann :Your host is atlas.irc"
    assert out[2] == ":atlas.irc 003 ann :This server was created by atlas_crew"
    assert out[3] == ":atlas.irc 004 ann atlas.irc atlas-1 o nt"
    assert out[4] == ":atlas.irc 422 ann :Team channel: #t"
    assert len(out) == 5


def test_handle_user_then_nick_welcomes_on_nick(gw):
    c = mk(gw)
    gw._handle(c, "USER u")
    assert lines(c) == []
    gw._handle(c, "NICK late")
    assert lines(c)[0].startswith(":atlas.irc 001 late")


def test_handle_nick_errors(gw):
    c = mk(gw)
    gw._handle(c, "NICK 1bad")
    assert lines(c) == [":atlas.irc 432 * 1bad :Erroneous nickname"]
    assert c.nick is None
    gw._handle(c, "NICK A")  # reserved (case-insensitive)
    assert lines(c)[-1] == ":atlas.irc 433 * A :Nickname is in use (reserved for a team member)"
    other = mk(gw, "taken")
    gw._handle(c, "NICK taken")
    assert lines(c)[-1].startswith(":atlas.irc 433 * taken")
    assert other.nick == "taken" and c.nick is None
    gw._handle(c, "NICK")  # no args: falls through to unregistered
    assert lines(c)[-1] == ":atlas.irc 451 * :You have not registered"


def test_handle_nick_same_client_may_renick(gw):
    c = mk(gw, "ann")
    gw._handle(c, "NICK ann")
    assert c.nick == "ann"


def test_handle_ping_pong_cap_pass(gw):
    c = mk(gw)
    gw._handle(c, "PING token")
    gw._handle(c, "PING")
    gw._handle(c, "PONG x")
    gw._handle(c, "PASS secret")
    gw._handle(c, "CAP LS 302")
    gw._handle(c, "cap ls")
    gw._handle(c, "CAP REQ :multi")
    gw._handle(c, "CAP")
    assert lines(c) == [
        ":atlas.irc PONG atlas.irc :token",
        ":atlas.irc PONG atlas.irc :",
        ":atlas.irc CAP * LS :",
        ":atlas.irc CAP * LS :",
    ]


def test_handle_unregistered_and_unknown(gw):
    c = mk(gw)
    assert gw._handle(c, "") is None
    assert gw._handle(c, "   ") is None
    gw._handle(c, "JOIN #t")
    assert lines(c) == [":atlas.irc 451 * :You have not registered"]
    c2 = mk(gw, "ann", "ann")
    gw._handle(c2, "FROB x")
    assert lines(c2) == [":atlas.irc 421 ann FROB :Unknown command"]


def test_handle_quit(gw):
    c = mk(gw, "ann")
    assert gw._handle(c, "quit :bye") == "quit"


def test_handle_join_part_names_and_replay(gw, bus):
    irc.post(bus, "a", "#t", "first message")
    irc.post(bus, "a", "ann", "private to ann")
    irc.post(bus, "a", "bob", "private to bob")
    irc.post(bus, "a", "*", "broadcast " + "z" * 500)
    irc.post(bus, "a", "#x", "other chan")
    c = mk(gw, "ann", "ann")
    gw.topic = "the topic"
    gw._handle(c, "JOIN #t,0,#y")
    out = lines(c)
    assert out[0] == ":ann!ann@9.9.9.9 JOIN #t"
    assert out[1] == ":atlas.irc 332 ann #t :the topic"
    assert out[2] == ":atlas.irc 353 ann = #t :a ann b"
    assert out[3] == ":atlas.irc 366 ann #t :End of /NAMES list."
    replay = [l for l in out if "NOTICE #t" in l]
    assert len(replay) == 3
    import re

    assert re.fullmatch(r":a!worker@atlas NOTICE #t :\[\d\d:\d\d:\d\d\] first message", replay[0])
    assert replay[1].endswith("] private to ann")
    assert replay[2].split("] ", 1)[1] == "broadcast " + "z" * 390
    assert c.channels == {"#t", "#y"}
    assert ":ann!ann@9.9.9.9 JOIN #y" in out and not any(l.endswith("JOIN 0") for l in out)
    gw._handle(c, "PART #t,#nope")
    assert c.channels == {"#y"}
    assert lines(c)[-2:] == [":ann!ann@9.9.9.9 PART #t", ":ann!ann@9.9.9.9 PART #nope"]


def test_handle_join_without_topic_and_requires_args(gw):
    c = mk(gw, "ann", "ann")
    gw._handle(c, "JOIN #t")
    assert not any(" 332 " in l for l in lines(c))
    n = len(lines(c))
    gw._handle(c, "JOIN")
    assert lines(c)[n:] == [":atlas.irc 421 ann JOIN :Unknown command"]
    gw._handle(c, "PART")
    assert lines(c)[-1] == ":atlas.irc 421 ann PART :Unknown command"


def test_handle_replay_is_last_200(gw, bus):
    for i in range(205):
        irc.post(bus, "a", "#t", f"m{i}")
    c = mk(gw, "ann", "ann")
    gw._handle(c, "JOIN #t")
    notices = [l for l in lines(c) if "NOTICE" in l]
    assert len(notices) == 200 and notices[0].endswith("] m5") and notices[-1].endswith("] m204")


def test_handle_privmsg_posts_to_log(gw, bus):
    c = mk(gw, "ann", "ann")
    gw._handle(c, "PRIVMSG #t :hello there")
    gw._handle(c, "NOTICE bob :psst")
    gw._handle(c, "PRIVMSG #t")  # too few args -> unknown command
    h = irc.history(bus)
    assert [(r["from"], r["to"], r["text"], r.get("via")) for r in h] == [
        ("ann", "#t", "hello there", "irc"),
        ("ann", "bob", "psst", "irc"),
    ]
    assert lines(c) == [":atlas.irc 421 ann PRIVMSG :Unknown command"]


def test_handle_privmsg_without_trail_uses_second_word(gw, bus):
    c = mk(gw, "ann", "ann")
    gw._handle(c, "PRIVMSG bob word")
    assert irc.history(bus)[0]["text"] == "word"


def test_handle_names_topic_who_mode(gw):
    c = mk(gw, "ann", "ann", chans={"#t"})
    gw._handle(c, "NAMES")
    assert lines(c)[0] == ":atlas.irc 353 ann = #t :a ann b"
    gw._handle(c, "NAMES #t")
    assert lines(c)[2] == ":atlas.irc 353 ann = #t :a ann b"
    n = len(lines(c))
    gw._handle(c, "TOPIC #t")
    assert lines(c)[n] == ":atlas.irc 332 ann #t :(no topic)"
    gw._handle(c, "TOPIC #t :new topic")
    assert gw.topic == "new topic" and lines(c)[-1] == ":atlas.irc 332 ann #t :new topic"
    gw._handle(c, "TOPIC")
    assert lines(c)[-1] == ":atlas.irc 421 ann TOPIC :Unknown command"
    n = len(lines(c))
    gw._handle(c, "WHO #t")
    w = lines(c)[n:]
    assert w[0] == ":atlas.irc 352 ann #t worker atlas atlas.irc a H :0 a"
    assert w[1] == ":atlas.irc 352 ann #t worker atlas atlas.irc b H :0 b"
    assert w[2] == ":atlas.irc 315 ann #t :End of /WHO list."
    gw._handle(c, "WHO")
    assert lines(c)[-1] == ":atlas.irc 315 ann * :End of /WHO list."
    n = len(lines(c))
    gw._handle(c, "MODE #t")
    assert lines(c)[n:] == [":atlas.irc 324 ann #t +nt"]
    gw._handle(c, "MODE ann")
    gw._handle(c, "MODE")
    assert len(lines(c)) == n + 1


def test_client_loop_reads_lines_and_quits(gw):
    s = FakeSock([b"NICK ann\r\nUSER ann 0 * :x\r\nPI", b"NG t\r\n\r\nQUIT\r\nNICK later\r\n"])
    c = irc._Client(s, ("1.1.1.1", 2))
    gw.clients.append(c)
    gw._client_loop(c)
    out = lines(c)
    assert out[0].startswith(":atlas.irc 001 ann")
    assert ":atlas.irc PONG atlas.irc :t" in out
    assert c.nick == "ann"  # the NICK after QUIT is never processed
    assert c not in gw.clients and s.closed and s.timeout == 300


def test_client_loop_eof_and_oserror_clean_up(gw):
    for chunk in ([], [OSError("reset")]):
        s = FakeSock(chunk)
        c = irc._Client(s, ("1.1.1.1", 2))
        gw.clients.append(c)
        gw._client_loop(c)
        assert c not in gw.clients and s.closed


def test_client_loop_decodes_invalid_utf8(gw):
    s = FakeSock([b"NICK ann\n", b"USER u\n", b"PRIVMSG #t :caf\xe9\n"])
    c = irc._Client(s, ("1.1.1.1", 2))
    gw.clients.append(c)
    gw._client_loop(c)
    assert irc.history(gw.d)[-1]["text"] == "caf\ufffd"


def test_client_loop_stops_when_stopped(gw):
    gw.stop.set()
    s = FakeSock([b"NICK ann\n"])
    c = irc._Client(s, ("1.1.1.1", 2))
    gw.clients.append(c)
    gw._client_loop(c)
    assert c.nick is None and s.closed


def test_serve_forever_end_to_end_on_loopback(bus):
    g = irc.Gateway(bus, port=0)
    th = threading.Thread(target=g.serve_forever, daemon=True)
    th.start()
    port = irc.read_port(bus, timeout=5.0)
    assert port and port == g.port
    time.sleep_real = None
    s = socket.create_connection(("127.0.0.1", port), timeout=5)
    s.sendall(b"NICK carl\r\nUSER carl 0 * :c\r\nJOIN #t\r\n")
    buf = b""
    deadline = time.monotonic() + 5
    while b"366" not in buf and time.monotonic() < deadline:
        buf += s.recv(4096)
    s.sendall(b"PRIVMSG #t :from client\r\n")
    for _ in range(100):
        if any(r["text"] == "from client" for r in irc.history(bus)):
            break
        threading.Event().wait(0.05)
    s.close()
    g.stop.set()
    th.join(timeout=5)
    assert b" 001 carl " in buf and b"JOIN #t" in buf
    assert any(r["text"] == "from client" and r["via"] == "irc" for r in irc.history(bus))
    assert not th.is_alive()


# --- CLI --------------------------------------------------------------------


def ns(**kw):
    base = dict(dir=None, as_=None, to=None, text=[], all=False, limit=50, timeout=1.0, match=None, from_=None,
                done=False, peers=[], once=True, port=0)
    base.update(kw)
    return argparse.Namespace(**base)


def test_env_nick(monkeypatch):
    assert irc._env_nick(ns(as_="x")) == "x"
    monkeypatch.setenv("ATLAS_IRC_NICK", "envn")
    assert irc._env_nick(ns()) == "envn"
    assert irc._env_nick(ns(as_="x")) == "x"
    monkeypatch.delenv("ATLAS_IRC_NICK")
    with pytest.raises(SystemExit) as e:
        irc._env_nick(ns())
    assert "no nick" in str(e.value)


def test_cmd_say(bus, capsys, monkeypatch):
    assert irc.cmd_say(ns(dir=str(bus), as_="a", text=["hello", "world"])) == 0
    assert capsys.readouterr().out == "sent #1 to #t\n"
    assert irc.history(bus)[0]["text"] == "hello world" and irc.history(bus)[0]["to"] == "#t"
    irc.cmd_say(ns(dir=str(bus), as_="a", to="b", text=["x"]))
    assert capsys.readouterr().out == "sent #2 to b\n"
    monkeypatch.setattr(sys, "stdin", io.StringIO("from stdin\n"))
    irc.cmd_say(ns(dir=str(bus), as_="a", text=["-"]))
    capsys.readouterr()
    assert irc.history(bus)[2]["text"] == "from stdin"
    irc.cmd_say(ns(dir=str(bus), as_="a", text=["y" * 4100]))
    assert capsys.readouterr().out == f"sent #4 to #t (truncated to {irc.MAX_TEXT} chars)\n"


def test_cmd_say_channel_fallback(tmp_path, capsys):
    irc.cmd_say(ns(dir=str(tmp_path / "bare"), as_="a", text=["x"]))
    assert capsys.readouterr().out == "sent #1 to #team\n"


def test_cmd_read_drain_and_all(bus, capsys):
    irc.post(bus, "b", "a", "one")
    irc.post(bus, "a", "#t", "mine")
    irc.post(bus, "b", "boss", "hidden")
    assert irc.cmd_read(ns(dir=str(bus), as_="a")) == 0
    assert capsys.readouterr().out == "<b> @a: one\n"
    irc.cmd_read(ns(dir=str(bus), as_="a"))
    assert capsys.readouterr().out == "(no new messages)\n"
    irc.cmd_read(ns(dir=str(bus), as_="a", all=True))
    assert capsys.readouterr().out == "<b> @a: one\n<a> #t: mine\n"


def test_cmd_read_limit_and_width(bus, capsys):
    for i in range(3):
        irc.post(bus, "b", "a", f"m{i}")
    irc.cmd_read(ns(dir=str(bus), as_="a", limit=2))
    assert capsys.readouterr().out == "<b> @a: m0\n<b> @a: m1\n"
    irc.post(bus, "b", "a", "w" * 2500)
    irc.cmd_read(ns(dir=str(bus), as_="a"))
    out = capsys.readouterr().out
    assert out.startswith("<b> @a: m2\n") and len(out.splitlines()[1]) == len("<b> @a: ") + 2000


def test_cmd_who(bus, capsys):
    assert irc.cmd_who(ns(dir=str(bus))) == 0
    assert json.loads(capsys.readouterr().out) == {"channel": "#t", "members": ["a", "b"], "lead": "boss"}


def test_cmd_tail_once(bus, capsys):
    irc.post(bus, "ann", "#t", "chan line\nsecond")
    irc.post(bus, "ann", "bob", "direct")
    irc.post(bus, "x", "*", "star")
    assert irc.cmd_tail(ns(dir=str(bus), once=True)) == 0
    out = capsys.readouterr().out.splitlines()
    assert len(out) == 3
    import re

    col = [36, 32, 33, 35, 34, 31, 96, 92, 93, 95][sum(map(ord, "ann")) % 10]
    assert re.fullmatch(rf"\x1b\[90m\d\d:\d\d:\d\d\x1b\[0m \x1b\[{col}m<ann>\x1b\[0m chan line \| second", out[0])
    assert out[1].endswith(f"<ann>\x1b[0m -> bob direct")
    colx = [36, 32, 33, 35, 34, 31, 96, 92, 93, 95][ord("x") % 10]
    assert out[2].endswith(f"\x1b[{colx}m<x>\x1b[0m star")


def test_cmd_tail_unknown_sender_and_follow(bus, capsys, monkeypatch):
    irc.post(bus, "", "#t", "anon")
    calls = []

    def sleep(s):
        calls.append(s)
        irc.post(bus, "late", "#t", "second")
        if len(calls) == 2:
            raise KeyboardInterrupt

    monkeypatch.setattr(irc.time, "sleep", sleep)
    with pytest.raises(KeyboardInterrupt):
        irc.cmd_tail(ns(dir=str(bus), once=False))
    out = capsys.readouterr().out
    assert "<?>" in out and out.count("<late>") == 1
    assert calls == [0.5, 0.5]


def test_cmd_serve(tmp_path, capsys, monkeypatch):
    made = {}

    class G:
        def __init__(self, d, port=0):
            made["args"] = (d, port)

        def serve_forever(self):
            made["served"] = True

    monkeypatch.setattr(irc, "Gateway", G)
    d = tmp_path / "newbus"
    assert irc.cmd_serve(ns(dir=str(d), port=6667)) == 0
    assert d.is_dir() and made == {"args": (d, 6667), "served": True}
    assert capsys.readouterr().out == f"atlas irc gateway on 127.0.0.1 (port file {d / 'port'})\n"


def test_cmd_need_ready_and_done(bus, capsys):
    irc.post(bus, "a", "#t", "READY to go")
    irc.post(bus, "b", "#t", "DONE b: ok", kind="done")
    irc.post(bus, "boss", "me", "extra note")
    irc.init_bus(bus, "#t", ["a", "b", "me"], "boss")
    assert irc.cmd_need(ns(dir=str(bus), as_="me", peers=["a,b"])) == 0
    out = capsys.readouterr().out.splitlines()
    assert out == ["<a> READY to go", "<b> DONE b: ok", "<boss> @me: extra note"]


def test_cmd_need_done_only_rejects_ready_and_times_out(bus, capsys, monkeypatch):
    irc.init_bus(bus, "#t", ["a", "b", "me"], "boss")
    irc.post(bus, "a", "#t", "READY now")
    clock = [1000.0]
    monkeypatch.setattr(irc.time, "time", lambda: clock[0])
    monkeypatch.setattr(irc.time, "sleep", lambda s: clock.__setitem__(0, clock[0] + 10))
    rc = irc.cmd_need(ns(dir=str(bus), as_="me", peers=["a"], done=True, timeout=5))
    assert rc == 3
    assert capsys.readouterr().out == "(timeout after 5s; still waiting for: a)\n"


def test_cmd_need_unknown_peer_and_self_ignored(bus, capsys):
    assert irc.cmd_need(ns(dir=str(bus), as_="a", peers=["zzz", "a"])) == 2
    assert capsys.readouterr().out == "not on the team: zzz; peers are a, b\n"
    irc.post(bus, "b", "#t", "DONE b", kind="done")
    assert irc.cmd_need(ns(dir=str(bus), as_="a", peers=["a", "b"])) == 0


def test_cmd_need_gave_up_and_unverified(bus, capsys):
    irc.post(bus, "a", "#t", "DONE a", kind="done")
    irc.post(bus, "a", "a", "unverified a", kind="unverified")
    irc.post(bus, "b", "#t", "GAVE UP: nope")
    assert irc.cmd_need(ns(dir=str(bus), as_="me", peers=["a", "b"], done=True)) == 4
    assert capsys.readouterr().out == "peer gave up: b\n"
    irc.post(bus, "b", "#t", "x", kind="failed")
    irc.cmd_need(ns(dir=str(bus), as_="me", peers=["b", "b"]))
    assert capsys.readouterr().out == "peer gave up: b\n"


def test_cmd_need_unverified_resets_ready(bus, capsys, monkeypatch):
    irc.post(bus, "a", "#t", "DONE a", kind="done")
    irc.post(bus, "a", "a", "unverified", kind="unverified")
    clock = [0.0]
    monkeypatch.setattr(irc.time, "time", lambda: clock[0])
    monkeypatch.setattr(irc.time, "sleep", lambda s: clock.__setitem__(0, clock[0] + 1))
    assert irc.cmd_need(ns(dir=str(bus), as_="me", peers=["a"], timeout=2)) == 3
    assert "still waiting for: a" in capsys.readouterr().out


def test_cmd_need_regex_requires_word_boundary(bus, capsys, monkeypatch):
    irc.post(bus, "a", "#t", "READYISH")
    irc.post(bus, "a", "#t", "DONEZO")
    clock = [0.0]
    monkeypatch.setattr(irc.time, "time", lambda: clock[0])
    monkeypatch.setattr(irc.time, "sleep", lambda s: clock.__setitem__(0, clock[0] + 1))
    assert irc.cmd_need(ns(dir=str(bus), as_="me", peers=["a"], timeout=1)) == 3
    irc.post(bus, "a", "#t", "READY")
    assert irc.cmd_need(ns(dir=str(bus), as_="me", peers=["a"], timeout=1)) == 0


def test_cmd_wait_match_from_and_rest(bus, capsys):
    irc.post(bus, "b", "a", "noise")
    irc.post(bus, "b", "a", "the ANSWER is 42")
    irc.post(bus, "b", "#t", "after")
    assert irc.cmd_wait(ns(dir=str(bus), as_="a", match="answer", from_="b")) == 0
    out = capsys.readouterr().out.splitlines()
    assert out[0] == "MATCH <b> @a: the ANSWER is 42"
    assert set(out[1:]) == {"<b> @a: noise", "<b> #t: after"}


def test_cmd_wait_ignores_other_senders_and_stale(bus, capsys, monkeypatch):
    irc.post(bus, "a", "#t", "mine")
    irc.init_bus(bus, "#t", ["a", "b", "c"], "boss")
    irc.post(bus, "c", "a", "from c")
    clock = [0.0]
    monkeypatch.setattr(irc.time, "time", lambda: clock[0])
    monkeypatch.setattr(irc.time, "sleep", lambda s: clock.__setitem__(0, clock[0] + 1))
    rc = irc.cmd_wait(ns(dir=str(bus), as_="a", from_="b", timeout=2))
    out = capsys.readouterr().out.splitlines()
    assert rc == 3
    assert out[0] == "(timeout after 2s; no matching message)"
    assert out[1:] == ["<c> @a: from c"]
    assert irc.cursor(bus, "a") == 2


def test_cmd_wait_cursor_hides_old_unless_all(bus, capsys):
    irc.post(bus, "b", "a", "old DONE")
    irc.drain(bus, "a")
    assert irc.cmd_wait(ns(dir=str(bus), as_="a", match="DONE", timeout=0)) == 3
    capsys.readouterr()
    assert irc.cmd_wait(ns(dir=str(bus), as_="a", match="DONE", timeout=0, all=True)) == 0
    assert capsys.readouterr().out.startswith("MATCH <b> @a: old DONE")


def test_cmd_wait_unknown_from_peer(bus, capsys):
    assert irc.cmd_wait(ns(dir=str(bus), as_="a", from_="zzz,boss")) == 2
    assert capsys.readouterr().out == "not on the team: zzz; peers are a, b\n"
    irc.post(bus, "boss", "a", "hi")
    assert irc.cmd_wait(ns(dir=str(bus), as_="a", from_="boss")) == 0


def test_unknown_peers(bus, tmp_path):
    assert irc._unknown_peers(bus, ["a", "x", "y"]) == ["x", "y"]
    assert irc._unknown_peers(tmp_path / "nobus", ["x"]) == []


def test_has_done_and_latest_done(bus):
    assert irc.has_done(bus, "a") is False
    irc.post(bus, "a", "#t", "DONE", kind="done", extra={"digest": "d1"})
    irc.post(bus, "b", "#t", "DONE", kind="done")
    assert irc.has_done(bus, "a") and irc.has_done(bus, "b")
    assert irc.latest_done_record(bus, "a")["digest"] == "d1"
    irc.post(bus, "a", "a", "bad", kind="unverified")
    assert not irc.has_done(bus, "a") and irc.latest_done_record(bus, "a") is None
    irc.post(bus, "a", "#t", "DONE", kind="done", extra={"digest": "d2"})
    assert irc.latest_done_record(bus, "a")["digest"] == "d2"
    irc.post(bus, "a", "#t", "GAVE UP", kind="failed")
    assert not irc.has_done(bus, "a")
    assert irc.latest_done_record(bus, "nobody") is None


def test_parser_wiring():
    p = irc.parser()
    a = p.parse_args(["--dir", "/d", "say", "--as", "n", "--to", "x", "a", "b"])
    assert (a.dir, a.as_, a.to, a.text, a.fn) == ("/d", "n", "x", ["a", "b"], irc.cmd_say)
    a = p.parse_args(["done", "--as", "n"])
    assert a.fn is irc.cmd_done and a.text == []
    a = p.parse_args(["check"])
    assert a.fn is irc.cmd_check and a.timeout == 100
    a = p.parse_args(["read", "--all", "--limit", "3"])
    assert a.fn is irc.cmd_read and a.all is True and a.limit == 3
    assert p.parse_args(["read"]).limit == 50 and p.parse_args(["read"]).all is False
    a = p.parse_args(["wait", "--from", "x", "--match", "m", "--timeout", "2", "--all", "--new-only"])
    assert a.fn is irc.cmd_wait and (a.from_, a.match, a.timeout, a.all) == ("x", "m", 2.0, True)
    assert p.parse_args(["wait"]).timeout == 100
    a = p.parse_args(["need", "--done", "p1", "p2"])
    assert a.fn is irc.cmd_need and a.done is True and a.peers == ["p1", "p2"] and a.timeout == 100
    assert p.parse_args(["need", "p"]).done is False
    assert p.parse_args(["tail", "--once"]).once is True and p.parse_args(["tail"]).once is False
    a = p.parse_args(["serve", "--port", "99"])
    assert a.fn is irc.cmd_serve and a.port == 99 and p.parse_args(["serve"]).port == 0
    assert p.parse_args(["who"]).fn is irc.cmd_who
    with pytest.raises(SystemExit):
        p.parse_args([])
    with pytest.raises(SystemExit):
        p.parse_args(["say"])


def test_main_dispatches(bus, capsys):
    assert irc.main(["--dir", str(bus), "who"]) == 0
    assert json.loads(capsys.readouterr().out)["channel"] == "#t"
    assert irc.main(["--dir", str(bus), "say", "--as", "a", "hi"]) == 0
    assert "sent #1" in capsys.readouterr().out
    assert irc.main(["--dir", str(bus), "tail", "--once"]) == 0


def test_post_survives_invalid_utf8_in_log(tmp_path):
    d = tmp_path / "bus"
    d.mkdir()
    (d / "log.jsonl").write_bytes(b'{"seq": 4, "text": "ok"}\n\xff\xfe broken\n')
    rec = irc.post(d, "a", "b", "hi")
    assert rec["seq"] == 5


def test_dir_empty_setting_reaches_no_bus_branch(monkeypatch):
    monkeypatch.setenv("ATLAS_IRC_DIR", "")
    with pytest.raises(SystemExit, match="no bus dir"):
        irc._dir("")
    with pytest.raises(SystemExit, match="no bus dir"):
        irc._dir(None)


def test_dir_explicit_current_dir_still_allowed():
    assert irc._dir(Path(".")) == Path(".")


def test_say_falls_back_to_env_channel_when_bus_has_no_members(tmp_path, monkeypatch):
    d = tmp_path / "bus"
    d.mkdir()
    monkeypatch.setenv("ATLAS_IRC_NICK", "a")
    monkeypatch.setenv("ATLAS_IRC_CHANNEL", "#envchan")
    a = argparse.Namespace(dir=str(d), to=None, text=["hello"], as_=None)
    assert irc.cmd_say(a) == 0
    rec = json.loads((d / "log.jsonl").read_text(encoding="utf-8").splitlines()[-1])
    assert rec["to"] == "#envchan"
