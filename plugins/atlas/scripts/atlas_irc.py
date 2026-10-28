#!/usr/bin/env python3
"""atlas_irc -- the team message bus: an append-only channel log plus a real IRC gateway.

Workers are headless `claude -p` processes, so they never hold a socket. They post with
`atlas_irc.py say` (the `irc` wrapper on their PATH) and receive by draining their unread
messages: the crew PostToolUse hook pushes them into the worker's context after every tool
call, and `irc wait` blocks until a matching message arrives. The log is the single source of
truth; every write takes an exclusive flock and stamps a monotonic `seq`, so ordering holds
across processes.

`serve` runs an RFC 1459 subset IRC server over the same log (NICK, USER, PASS, JOIN, PART,
PRIVMSG, NOTICE, PING, PONG, NAMES, TOPIC, WHO, MODE, QUIT). A human or any IRC client
(irssi, weechat, a bot) can join #<team> on 127.0.0.1:<port>, read the whole conversation as it
happens and talk to workers: a client PRIVMSG is appended to the log and reaches the worker at
its next tool call. Worker nicks are reserved; clients cannot take them.

Layout of a bus directory D:
  D/log.jsonl            {seq, ts, from, to, text}   to = "#chan" or a nick
  D/cursor/<nick>.json   {"seq": <last delivered>}
  D/port                 gateway TCP port (serve)
  D/members.json         {"channel": "#t", "members": [nicks], "lead": nick}

Env defaults for the CLI: ATLAS_IRC_DIR, ATLAS_IRC_NICK, ATLAS_IRC_CHANNEL.
Stdlib only.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import socket
import sys
import threading
import time
from pathlib import Path

NICK_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_\-\[\]\\`^{}|]{0,63}$")
MAX_TEXT = 4000
SERVER_NAME = "atlas.irc"


# ---------------------------------------------------------------- log


def _dir(d) -> Path:
    p = Path(d or os.environ.get("ATLAS_IRC_DIR") or "")
    if not str(p):
        raise SystemExit("atlas_irc: no bus dir (--dir or ATLAS_IRC_DIR)")
    return p


def members(d) -> dict:
    try:
        return json.loads((Path(d) / "members.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"channel": "#team", "members": [], "lead": "lead"}


def init_bus(d, channel: str, nicks: list, lead: str = "lead") -> Path:
    p = Path(d)
    (p / "cursor").mkdir(parents=True, exist_ok=True)
    (p / "log.jsonl").touch()
    (p / "members.json").write_text(
        json.dumps({"channel": channel, "members": list(nicks), "lead": lead}),
        encoding="utf-8",
    )
    return p


def post(d, sender: str, to: str, text: str, kind: str | None = None, via: str | None = None) -> dict:
    """Append one message under an exclusive lock and return it (with its seq)."""
    text = (text or "").strip()[:MAX_TEXT]
    p = Path(d) / "log.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "a+", encoding="utf-8") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            fh.seek(0)
            last = 0
            for line in fh:
                if line.strip():
                    try:
                        last = max(last, int(json.loads(line).get("seq") or 0))
                    except ValueError:
                        pass
            rec = {
                "seq": last + 1,
                "ts": round(time.time(), 3),
                "from": sender,
                "to": to,
                "text": text,
            }
            if kind:
                rec["kind"] = kind
            if via:
                rec["via"] = via
            fh.seek(0, os.SEEK_END)
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)
    return rec


def history(d, after: int = 0) -> list:
    out = []
    try:
        with open(Path(d) / "log.jsonl", encoding="utf-8") as fh:
            for line in fh:
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if int(rec.get("seq") or 0) > after:
                    out.append(rec)
    except OSError:
        pass
    return out


def visible_to(rec: dict, nick: str, channel: str) -> bool:
    """A message reaches `nick` when it is on the channel or addressed to it, and someone else sent it."""
    if rec.get("from") == nick:
        return False
    to = rec.get("to") or ""
    return to == nick or to == channel or to == "*"


def _cursor_path(d, nick) -> Path:
    return Path(d) / "cursor" / f"{nick}.json"


def cursor(d, nick) -> int:
    try:
        return int(
            json.loads(_cursor_path(d, nick).read_text(encoding="utf-8")).get("seq")
            or 0
        )
    except (OSError, ValueError):
        return 0


def set_cursor(d, nick, seq: int) -> None:
    p = _cursor_path(d, nick)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps({"seq": seq}), encoding="utf-8")
    os.replace(tmp, p)


def drain(d, nick: str, limit: int = 20) -> list:
    """Unread messages for `nick` (oldest first, at most `limit`); advances its cursor past them."""
    m = members(d)
    cur = cursor(d, nick)
    recs = [
        r for r in history(d, cur) if visible_to(r, nick, m.get("channel", "#team"))
    ]
    recs = recs[:limit]
    if recs:
        set_cursor(d, nick, int(recs[-1]["seq"]))
    else:
        # skip past own/irrelevant traffic so the next scan starts later
        tail = history(d, cur)
        if tail:
            set_cursor(d, nick, int(tail[-1]["seq"]))
    return recs


def fmt(rec: dict, width: int = 600) -> str:
    to = rec.get("to") or ""
    arrow = to if to.startswith("#") else f"@{to}"
    text = rec.get("text", "")
    if len(text) > width:
        text = text[: width - 3] + "..."
    return f"<{rec.get('from')}> {arrow}: {text}"


# ---------------------------------------------------------------- IRC gateway


class _Client:
    def __init__(self, sock, addr):
        self.sock = sock
        self.addr = addr
        self.nick = None
        self.user = None
        self.channels = set()
        self.lock = threading.Lock()

    def send(self, line: str) -> None:
        with self.lock:
            try:
                self.sock.sendall((line + "\r\n").encode("utf-8", "replace"))
            except OSError:
                pass

    @property
    def prefix(self) -> str:
        return f"{self.nick}!{self.user or self.nick}@{self.addr[0]}"


class Gateway:
    """IRC server bridged to the log: client PRIVMSGs are posted to the log, and every new log
    record is relayed to the joined clients, whoever wrote it (workers write the log directly)."""

    def __init__(self, d, port: int = 0, host: str = "127.0.0.1"):
        self.d = Path(d)
        self.host = host
        self.port = port
        self.clients: list[_Client] = []
        self.topic = ""
        self.lock = threading.Lock()
        self.stop = threading.Event()
        self.seen = max([int(r["seq"]) for r in history(self.d)] or [0])

    # -- helpers
    @property
    def channel(self) -> str:
        return members(self.d).get("channel", "#team")

    def reserved(self) -> set:
        m = members(self.d)
        return {n.lower() for n in m.get("members", [])} | {
            str(m.get("lead", "")).lower()
        }

    def _num(self, c, code, *params, trail=None):
        parts = [f":{SERVER_NAME}", code, c.nick or "*", *params]
        line = " ".join(parts)
        if trail is not None:
            line += f" :{trail}"
        c.send(line)

    def _names(self, c, chan):
        nicks = sorted(
            set(members(self.d).get("members", []))
            | {x.nick for x in self.clients if chan in x.channels}
        )
        self._num(c, "353", "=", chan, trail=" ".join(nicks))
        self._num(c, "366", chan, trail="End of /NAMES list.")

    # -- serving
    def serve_forever(self) -> None:
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind((self.host, self.port))
        srv.listen(16)
        self.port = srv.getsockname()[1]
        (self.d / "port").write_text(str(self.port), encoding="utf-8")
        threading.Thread(target=self._relay_loop, daemon=True).start()
        srv.settimeout(0.5)
        while not self.stop.is_set():
            try:
                sock, addr = srv.accept()
            except socket.timeout:
                continue
            c = _Client(sock, addr)
            with self.lock:
                self.clients.append(c)
            threading.Thread(target=self._client_loop, args=(c,), daemon=True).start()
        srv.close()

    def _relay_loop(self) -> None:
        while not self.stop.is_set():
            for rec in history(self.d, self.seen):
                self.seen = max(self.seen, int(rec["seq"]))
                self._relay(rec)
            time.sleep(0.2)

    def _relay(self, rec: dict) -> None:
        src = rec.get("from") or "?"
        to = rec.get("to") or self.channel
        if to == "*":
            to = self.channel
        for line in (rec.get("text") or "").splitlines() or [""]:
            for c in list(self.clients):
                if c.nick is None or (c.nick == src and rec.get("via") == "irc"):
                    continue
                if (to.startswith("#") and to in c.channels) or to == c.nick:
                    c.send(f":{src}!worker@atlas PRIVMSG {to} :{line}")

    def _client_loop(self, c: _Client) -> None:
        buf = b""
        try:
            c.sock.settimeout(300)
            while not self.stop.is_set():
                data = c.sock.recv(4096)
                if not data:
                    break
                buf += data
                while b"\n" in buf:
                    raw, buf = buf.split(b"\n", 1)
                    line = raw.decode("utf-8", "replace").rstrip("\r")
                    if line and self._handle(c, line) == "quit":
                        return
        except OSError:
            pass
        finally:
            with self.lock:
                if c in self.clients:
                    self.clients.remove(c)
            try:
                c.sock.close()
            except OSError:
                pass

    def _handle(self, c: _Client, line: str):
        trail = None
        if " :" in line:
            line, trail = line.split(" :", 1)
        parts = line.split()
        if not parts:
            return None
        cmd, args = parts[0].upper(), parts[1:]
        if trail is not None:
            args.append(trail)
        if cmd == "NICK" and args:
            nick = args[0]
            if not NICK_RE.match(nick):
                self._num(c, "432", nick, trail="Erroneous nickname")
            elif nick.lower() in self.reserved() or any(
                x.nick == nick for x in self.clients if x is not c
            ):
                self._num(
                    c,
                    "433",
                    nick,
                    trail="Nickname is in use (reserved for a team member)",
                )
            else:
                c.nick = nick
                if c.user:
                    self._welcome(c)
        elif cmd == "USER" and args:
            c.user = args[0]
            if c.nick:
                self._welcome(c)
        elif cmd == "PING":
            c.send(f":{SERVER_NAME} PONG {SERVER_NAME} :{args[0] if args else ''}")
        elif cmd in ("PONG", "PASS", "CAP"):
            if cmd == "CAP" and args and args[0].upper() == "LS":
                c.send(f":{SERVER_NAME} CAP * LS :")
        elif c.nick is None:
            self._num(c, "451", trail="You have not registered")
        elif cmd == "JOIN" and args:
            for chan in args[0].split(","):
                if chan == "0":
                    continue
                c.channels.add(chan)
                c.send(f":{c.prefix} JOIN {chan}")
                if self.topic:
                    self._num(c, "332", chan, trail=self.topic)
                self._names(c, chan)
                # replay the conversation so far, so a late joiner sees the whole team
                for rec in history(self.d)[-200:]:
                    if rec.get("to") in (chan, "*", c.nick):
                        c.send(
                            f":{rec.get('from')}!worker@atlas NOTICE {chan} :[{time.strftime('%H:%M:%S', time.localtime(rec.get('ts', 0)))}] {rec.get('text', '')[:400]}"
                        )
        elif cmd == "PART" and args:
            for chan in args[0].split(","):
                c.channels.discard(chan)
                c.send(f":{c.prefix} PART {chan}")
        elif cmd in ("PRIVMSG", "NOTICE") and len(args) >= 2:
            # the relay loop delivers it to the other joined clients (and to workers through the log)
            post(self.d, c.nick, args[0], args[1], via="irc")
        elif cmd == "NAMES":
            self._names(c, args[0] if args else self.channel)
        elif cmd == "TOPIC" and args:
            if len(args) > 1:
                self.topic = args[1]
            self._num(c, "332", args[0], trail=self.topic or "(no topic)")
        elif cmd == "WHO":
            for n in members(self.d).get("members", []):
                self._num(
                    c,
                    "352",
                    args[0] if args else "*",
                    "worker",
                    "atlas",
                    SERVER_NAME,
                    n,
                    "H",
                    trail=f"0 {n}",
                )
            self._num(c, "315", args[0] if args else "*", trail="End of /WHO list.")
        elif cmd == "MODE":
            if args and args[0].startswith("#"):
                self._num(c, "324", args[0], "+nt")
        elif cmd == "QUIT":
            return "quit"
        else:
            self._num(c, "421", cmd, trail="Unknown command")
        return None

    def _welcome(self, c: _Client) -> None:
        self._num(c, "001", trail=f"Welcome to the atlas team bus {c.nick}")
        self._num(c, "002", trail=f"Your host is {SERVER_NAME}")
        self._num(c, "003", trail="This server was created by atlas_crew")
        self._num(c, "004", SERVER_NAME, "atlas-1", "o", "nt")
        self._num(c, "422", trail=f"Team channel: {self.channel}")


# ---------------------------------------------------------------- CLI


def _env_nick(a) -> str:
    nick = a.as_ or os.environ.get("ATLAS_IRC_NICK") or ""
    if not nick:
        raise SystemExit("atlas_irc: no nick (--as or ATLAS_IRC_NICK)")
    return nick


def cmd_say(a) -> int:
    d = _dir(a.dir)
    nick = _env_nick(a)
    to = (
        a.to
        or members(d).get("channel")
        or os.environ.get("ATLAS_IRC_CHANNEL")
        or "#team"
    )
    text = " ".join(a.text)
    if text == "-":
        text = sys.stdin.read()
    rec = post(d, nick, to, text)
    print(f"sent #{rec['seq']} to {to}")
    return 0


def cmd_read(a) -> int:
    d = _dir(a.dir)
    nick = _env_nick(a)
    if a.all:
        recs = [
            r
            for r in history(d)
            if visible_to(r, nick, members(d).get("channel", "#team"))
            or r.get("from") == nick
        ]
    else:
        recs = drain(d, nick, limit=a.limit)
    for r in recs:
        print(fmt(r, width=2000))
    if not recs:
        print("(no new messages)")
    return 0


def cmd_wait(a) -> int:
    """Block until a message for us arrives that matches --from/--match; print it (and anything
    else unread). Exit 0 on a match, 3 on timeout."""
    d = _dir(a.dir)
    nick = _env_nick(a)
    rx = re.compile(a.match, re.I) if a.match else None
    froms = set(a.from_.split(",")) if a.from_ else None
    bad = _unknown_peers(d, [f for f in froms or () if f != members(d).get("lead")])
    if bad:
        print(f"not on the team: {', '.join(bad)}; peers are {', '.join(members(d).get('members') or [])}")
        return 2
    deadline = time.time() + a.timeout
    chan = members(d).get("channel", "#team")
    # a message already on the log counts, read or not: the peer may have announced before we waited
    scan_from = cursor(d, nick) if a.new_only else 0
    while True:
        for r in history(d, scan_from):
            scan_from = max(scan_from, int(r["seq"]))
            if not visible_to(r, nick, chan):
                continue
            if froms and r.get("from") not in froms:
                continue
            if rx and not rx.search(r.get("text", "")):
                continue
            print("MATCH " + fmt(r, width=4000))
            rest = drain(d, nick)
            for x in rest:
                if x["seq"] != r["seq"]:
                    print(fmt(x, width=1000))
            return 0
        if time.time() >= deadline:
            print(f"(timeout after {a.timeout}s; no matching message)")
            for x in drain(d, nick):
                print(fmt(x, width=1000))
            return 3
        time.sleep(1.0)


def _unknown_peers(d, names) -> list:
    team = set(members(d).get("members") or [])
    return [n for n in names if team and n not in team]


def cmd_need(a) -> int:
    """Block until every named peer has announced READY or DONE. Exit 0 when all have, 3 on timeout
    (naming who is missing), 2 for a name that is not on the team (the lead posts no READY)."""
    d = _dir(a.dir)
    nick = _env_nick(a)
    peers = [p for p in ",".join(a.peers).replace(",", " ").split() if p and p != nick]
    bad = _unknown_peers(d, peers)
    if bad:
        print(f"not on the team: {', '.join(bad)}; peers are {', '.join(members(d).get('members') or [])}")
        return 2
    deadline = time.time() + a.timeout
    ready, seen = {}, 0
    while True:
        for r in history(d, seen):
            seen = max(seen, int(r["seq"]))
            who, text = r.get("from"), r.get("text", "")
            if who in peers and (r.get("kind") == "done" or re.match(r"(READY|DONE)\b", text)):
                ready[who] = text
        missing = [p for p in peers if p not in ready]
        if not missing:
            for p in peers:
                print(f"<{p}> {ready[p][:400]}")
            for x in drain(d, nick):
                if x.get("from") not in peers:
                    print(fmt(x, width=1000))
            return 0
        if time.time() >= deadline:
            print(f"(timeout after {a.timeout}s; still waiting for: {', '.join(missing)})")
            return 3
        time.sleep(0.3)


def cmd_tail(a) -> int:
    """Human view of the channel, like an IRC client window: one coloured line per message."""
    d = _dir(a.dir)
    seen = 0
    colors = [36, 32, 33, 35, 34, 31, 96, 92, 93, 95]
    while True:
        for r in history(d, seen):
            seen = int(r["seq"])
            who = r.get("from") or "?"
            col = colors[sum(map(ord, who)) % len(colors)]
            to = r.get("to") or ""
            arrow = "" if to.startswith("#") or to == "*" else f" -> {to}"
            stamp = time.strftime("%H:%M:%S", time.localtime(r.get("ts", 0)))
            text = r.get("text", "").replace("\n", " | ")
            print(
                f"\x1b[90m{stamp}\x1b[0m \x1b[{col}m<{who}>\x1b[0m{arrow} {text}",
                flush=True,
            )
        if a.once:
            return 0
        time.sleep(0.5)


def cmd_serve(a) -> int:
    d = _dir(a.dir)
    d.mkdir(parents=True, exist_ok=True)
    gw = Gateway(d, port=a.port)
    print(f"atlas irc gateway on 127.0.0.1 (port file {d / 'port'})", flush=True)
    gw.serve_forever()
    return 0


def cmd_who(a) -> int:
    print(json.dumps(members(_dir(a.dir))))
    return 0


def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="irc", description="atlas team channel")
    ap.add_argument("--dir")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser(
        "say", help="post to the team channel (or --to <nick> for a direct message)"
    )
    s.add_argument("--as", dest="as_")
    s.add_argument("--to")
    s.add_argument("text", nargs="+")
    s.set_defaults(fn=cmd_say)
    r = sub.add_parser("read", help="print unread messages (advances your cursor)")
    r.add_argument("--as", dest="as_")
    r.add_argument("--all", action="store_true")
    r.add_argument("--limit", type=int, default=50)
    r.set_defaults(fn=cmd_read)
    w = sub.add_parser(
        "wait", help="block until a matching message arrives (exit 3 on timeout)"
    )
    w.add_argument("--as", dest="as_")
    w.add_argument("--from", dest="from_")
    w.add_argument("--match")
    w.add_argument("--timeout", type=float, default=100)
    w.add_argument("--new-only", action="store_true", help="ignore messages already delivered to you")
    w.set_defaults(fn=cmd_wait)
    n = sub.add_parser(
        "need", help="block until every named peer announced READY or DONE (exit 3 on timeout)"
    )
    n.add_argument("--as", dest="as_")
    n.add_argument("--timeout", type=float, default=100)
    n.add_argument("peers", nargs="+")
    n.set_defaults(fn=cmd_need)
    t = sub.add_parser("tail", help="live human view of the channel")
    t.add_argument("--once", action="store_true")
    t.set_defaults(fn=cmd_tail)
    v = sub.add_parser(
        "serve", help="run the IRC gateway (RFC 1459 subset) over the log"
    )
    v.add_argument("--port", type=int, default=0)
    v.set_defaults(fn=cmd_serve)
    o = sub.add_parser("who", help="team members")
    o.set_defaults(fn=cmd_who)
    return ap


def main(argv=None) -> int:
    a = parser().parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
