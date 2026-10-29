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

`check` runs the unit check speculatively once every peer in ATLAS_CREW_NEEDS_ALL has installed its file
(ATLAS_CREW_PEER_OWNS, ATLAS_CREW_STUB_DIR; off with ATLAS_CREW_SPECULATE=off) and posts DONE without a second
run when those peers then post DONE for the same bytes.
Stdlib only.
"""

from __future__ import annotations

import argparse
import ast
import fcntl
import json
import os
import re
import socket
import subprocess
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


def post(d, sender: str, to: str, text: str, kind: str | None = None, via: str | None = None, extra: dict | None = None) -> dict:
    """Append one message under an exclusive lock and return it (with its seq). `extra` adds fields (e.g. a DONE's digest)."""
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
            if extra:
                rec.update(extra)
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


def has_done(d, nick: str) -> bool:
    """True when `nick` has a kind-done record after its most recent kind-failed (GAVE UP) or kind-unverified
    (a failing `irc check` / refused `irc done`) record: a DONE stands only until the next failure."""
    done = False
    for r in history(d):
        if r.get("from") != nick:
            continue
        if r.get("kind") in ("failed", "unverified"):
            done = False
        elif r.get("kind") == "done":
            done = True
    return done


def _owned_files(root, owns) -> list:
    """Sorted rel paths of the owned files: literal paths as written (even if missing), globs and directories expanded."""
    out = set()
    for pat in owns or []:
        pat = pat.rstrip("/")
        if any(c in pat for c in "*?["):
            found = [f for f in Path(root).glob(pat) if f.is_file()]
        elif Path(root, pat).is_dir():
            found = [f for f in Path(root, pat).rglob("*") if f.is_file()]
        else:
            out.add(pat)
            continue
        out.update(f.relative_to(root).as_posix() for f in found)
    return sorted(out)


def _owned_digest(root, owns) -> str:
    """sha256 over the sorted owned rel paths and their bytes; a missing file hashes as empty plus a marker."""
    import hashlib

    h = hashlib.sha256()
    for rel in _owned_files(root, owns):
        try:
            data = Path(root, rel).read_bytes()
            mark = b"F"
        except OSError:
            data, mark = b"", b"M"
        h.update(rel.encode() + b"\0" + mark + b"\0" + hashlib.sha256(data).digest())
    return h.hexdigest()


_SHARED_PYTEST_INPUTS = ("pytest.ini", "pyproject.toml", "setup.cfg", "tox.ini")
_SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", ".tox", ".mypy_cache", ".pytest_cache"}


def test_inputs_digest(root, unit_check) -> str:
    """sha256 over the sorted (rel path, bytes) of the test files a unit_check names (its tokens that are existing
    files under root) plus the shared pytest inputs: conftest.py anywhere under root and pytest.ini, pyproject.toml,
    setup.cfg, tox.ini at root. Worker (_announce_done) and supervisor (verified_test_files) both call this, so a
    test file or shared input edited after DONE changes the value. Limit: imports outside the declared needs
    closure are in no digest (needs is derived from stub and test imports; `irc check` relies on the same edges)."""
    import hashlib
    import shlex

    root = Path(root)
    rels = set()
    try:
        toks = shlex.split(unit_check or "")
    except ValueError:
        toks = []
    for t in toks:
        try:
            f = root / t
            if not t.startswith("-") and f.is_file():
                rels.add(f.resolve().relative_to(root.resolve()).as_posix())
        except (OSError, ValueError):
            continue
    for name in _SHARED_PYTEST_INPUTS:
        if (root / name).is_file():
            rels.add(name)
    for dp, dns, fns in os.walk(root):
        dns[:] = [x for x in dns if x not in _SKIP_DIRS]
        if "conftest.py" in fns:
            rels.add((Path(dp) / "conftest.py").relative_to(root).as_posix())
    h = hashlib.sha256()
    for rel in sorted(rels):
        try:
            data = (root / rel).read_bytes()
        except OSError:
            data = b""
        h.update(rel.encode() + b"\0" + hashlib.sha256(data).digest())
    return h.hexdigest()


def _env_owns():
    try:
        owns = json.loads(os.environ.get("ATLAS_CREW_OWNS") or "[]")
    except ValueError:
        return []
    return owns if isinstance(owns, list) else []


def done_current(d, nick: str, root=None, owns=None) -> bool:
    """True when `nick` holds a DONE (has_done) whose recorded digest equals the owned files' digest now: the
    verified DONE still describes the files on disk, so a hook can skip re-running the check (3-5 s on slow
    test files). A DONE without a digest is never current."""
    if not has_done(d, nick):
        return False
    rec = next((r for r in reversed(history(d)) if r.get("from") == nick and r.get("kind") == "done"), None)
    if not rec or not rec.get("digest"):
        return False
    root = root or os.environ.get("ATLAS_CREW_ROOT") or os.getcwd()
    owns = _env_owns() if owns is None else owns
    return rec["digest"] == _owned_digest(root, owns)


def latest_done_record(d, nick: str):
    """The latest kind-done record of `nick` while it still stands (has_done), else None."""
    if not has_done(d, nick):
        return None
    return next((r for r in reversed(history(d)) if r.get("from") == nick and r.get("kind") == "done"), None)


CHECK_TIMEOUT_S = 600
TAIL_CHARS = 6000


def _run_unit_check(d, nick: str, quiet: bool = False, capture: list | None = None):
    """Run ATLAS_CREW_UNIT_CHECK (shell, cwd ATLAS_CREW_ROOT) and print its output tail. Returns its exit code,
    or None when no unit check is set. A failure is recorded as an `unverified` note to the nick itself (peers
    are not told), which voids any earlier DONE of this nick. `quiet` prints and records nothing; with
    `capture` (a list) it appends the output tail it would have printed."""
    cmd = os.environ.get("ATLAS_CREW_UNIT_CHECK") or ""
    if not cmd:
        return None
    root = os.environ.get("ATLAS_CREW_ROOT") or os.getcwd()
    try:
        res = subprocess.run(cmd, shell=True, cwd=root, capture_output=True, text=True, timeout=CHECK_TIMEOUT_S)
        code, out = res.returncode, (res.stdout or "") + (res.stderr or "")
    except subprocess.TimeoutExpired:
        code, out = 124, f"check timed out after {CHECK_TIMEOUT_S}s\n"
    tail = out[-TAIL_CHARS:]
    tail += "" if tail.endswith("\n") or not tail else "\n"
    if quiet:
        if capture is not None:
            capture.append(tail)
        return code
    print(tail, end="")
    if code:
        post(d, nick, nick, f"unverified {nick}: `{cmd}` exited {code}", kind="unverified")
    return code


def _doc_nodes(tree) -> dict:
    """Qualified name -> node for the module ("") and every class/function in it. A name defined twice
    (overloads, conditional defs) maps to None: it is ambiguous and never touched."""
    found: dict = {"": tree}

    def walk(node, prefix):
        for ch in node.body:
            if isinstance(ch, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                q = prefix + ch.name
                found[q] = None if q in found else ch
                walk(ch, q + ".")

    walk(tree, "")
    return found


def _has_doc(node) -> bool:
    return ast.get_docstring(node, clean=False) is not None


def _doc_literal(text: str, indent: str, stub_indent: int) -> list:
    """Source lines of `text` as a triple-quoted string at `indent`; continuation lines move from the stub's
    body indentation to `indent`."""
    body = text.replace("\\", "\\\\").replace('"""', '\\"\\"\\"').replace("\r", "\\r")
    if body.endswith('"'):
        body = body[:-1] + '\\"'
    lines = body.split("\n")
    out = [lines[0]]
    for i, ln in enumerate(lines[1:], 1):
        lead = len(ln) - len(ln.lstrip(" "))
        keep = ln.strip() or (ln and i == len(lines) - 1)  # the closing quote's own line keeps its indentation
        out.append(indent + ln[min(lead, stub_indent):] if keep else "")
    out[0] = '"""' + out[0]
    out[-1] += '"""'
    return [indent + out[0]] + out[1:]


def restore_docstrings(stub_src: str, work_src: str):
    """Put back the stub's docstrings the worker's rewrite dropped: for each module, class, function or method
    present in both (by qualified name) where only the stub has a docstring, insert the stub's text as the
    first statement. A docstring the worker wrote is never touched. Returns (new source, count); the source is
    returned unchanged (count 0) when either side does not parse or the edit would not."""
    try:
        stub_nodes = _doc_nodes(ast.parse(stub_src))
        work_nodes = _doc_nodes(ast.parse(work_src))
    except (SyntaxError, ValueError):
        return work_src, 0
    lines = work_src.splitlines(keepends=True)
    edits = []
    for q, w in work_nodes.items():
        sn = stub_nodes.get(q)
        if w is None or sn is None or not _has_doc(sn) or _has_doc(w) or not w.body:
            continue
        first = w.body[0]
        start = min([first.lineno] + [x.lineno for x in getattr(first, "decorator_list", [])])
        if q and start == w.lineno:  # one-liner `def f(): ...`: no body line to insert before
            continue
        text = ast.get_docstring(sn, clean=False)
        sbody = sn.body[0]
        edits.append((start, text, getattr(sbody, "col_offset", 0)))
    if not edits:
        return work_src, 0
    for start, text, sindent in sorted(edits, reverse=True):
        indent = re.match(r"[ \t]*", lines[start - 1]).group(0)
        new = [ln + "\n" for ln in _doc_literal(text, indent, sindent)]
        lines[start - 1:start - 1] = new
    out = "".join(lines)
    try:
        ast.parse(out)
    except (SyntaxError, ValueError):
        return work_src, 0
    return out, len(edits)


def _restore_owned_docstrings(root=None) -> list:
    """Before the unit check: restore dropped stub docstrings in the owned .py files (ATLAS_CREW_STUBS maps
    rel path -> pristine copy) so one unit check covers the final files. A restore result that does not parse
    is skipped. Returns [(rel, pre-restore text, count)] for the files changed, for `_revert_restored` and the
    "restored N docstrings" lines."""
    try:
        stubs = json.loads(os.environ.get("ATLAS_CREW_STUBS") or "{}")
        owns = json.loads(os.environ.get("ATLAS_CREW_OWNS") or "[]")
    except ValueError:
        return []
    root = Path(root or os.environ.get("ATLAS_CREW_ROOT") or os.getcwd())
    changed = []
    for rel in owns:
        stub = stubs.get(rel)
        if not rel.endswith(".py") or not stub:
            continue
        try:
            raw = (root / rel).read_bytes()
            work = raw.decode("utf-8")
            new, n = restore_docstrings(Path(stub).read_text(encoding="utf-8"), work)
            if not n:
                continue
            ast.parse(new)
            (root / rel).write_text(new, encoding="utf-8")
            changed.append((rel, raw, n))
        except (OSError, ValueError, SyntaxError):
            continue
    return changed


def _revert_restored(changed, root=None) -> None:
    """Put back the exact pre-restore bytes of every file `_restore_owned_docstrings` changed."""
    root = Path(root or os.environ.get("ATLAS_CREW_ROOT") or os.getcwd())
    for rel, raw, _ in changed:
        try:
            (root / rel).write_bytes(raw)
        except OSError:
            pass


def _check_with_docstrings(d, nick: str, quiet: bool = False, capture: list | None = None) -> int:
    """One unit check per pass (a second run cost the store worker's DONE hop 3.3-4.8 s on the critical chain):
    restore the stub docstrings first, run the check once. Pass keeps them; fail puts the pre-restore bytes
    back, and the printed failure is from the run with the docstrings. Returns the check's code (None: no
    unit check set). `quiet` (the speculative run) prints and records nothing; `capture` collects the lines
    that would have been printed, in order."""
    def say(line: str) -> None:
        if quiet:
            if capture is not None:
                capture.append(line + "\n")
        else:
            print(line)

    changed = _restore_owned_docstrings()
    code = _run_unit_check(d, nick, quiet=quiet, capture=capture)
    if changed and code:
        _revert_restored(changed)
        say("(docstrings were restored for this run and have been removed again)")
    elif changed:
        for rel, _, n in changed:
            say(f"restored {n} docstrings in {rel}")
    return code


def install_staged(stage, root, owns) -> list:
    """Copy each staged owned file `stage/<p>` over `root/<p>` when the staged copy is newer than the real one
    (or the real one is missing) and the bytes differ. Returns the rel paths installed. Workers Write into
    their stage dir (a shell heredoc write is refused by Claude Code's Bash safety check) and `irc check`
    installs the result before it runs the unit check."""
    done = []
    for p in owns or []:
        s, o = Path(stage) / p, Path(root) / p
        try:
            if not s.is_file():
                continue
            if o.exists() and s.stat().st_mtime_ns <= o.stat().st_mtime_ns:
                continue
            data = s.read_bytes()
            if o.is_file() and o.read_bytes() == data:
                continue
            o.parent.mkdir(parents=True, exist_ok=True)
            o.write_bytes(data)
            done.append(p)
        except OSError:
            continue
    return done


def _install_from_env() -> list:
    """install_staged from ATLAS_CREW_STAGE / _ROOT / _OWNS (a no-op when unset); prints one line per file."""
    stage = os.environ.get("ATLAS_CREW_STAGE")
    if not stage:
        return []
    try:
        owns = json.loads(os.environ.get("ATLAS_CREW_OWNS") or "[]")
    except ValueError:
        return []
    root = os.environ.get("ATLAS_CREW_ROOT") or os.getcwd()
    got = install_staged(stage, root, owns)
    for p in got:
        print(f"installed {p} from staged copy")
    return got


def _announce_done(d, nick: str, text: str, peer_digests: dict | None = None) -> None:
    """Post DONE with the own-files digest and test_digest (test files + shared pytest inputs); `peer_digests` ({peer: digest} of the closure bytes the passing unit
    check ran against) rides along when given, so the supervisor can skip re-running this worker's tests."""
    if has_done(d, nick):
        print(f"already announced DONE for {nick}")
        return
    root = os.environ.get("ATLAS_CREW_ROOT") or os.getcwd()
    extra = {"digest": _owned_digest(root, _env_owns()), "test_digest": test_inputs_digest(root, os.environ.get("ATLAS_CREW_UNIT_CHECK") or "")}
    if peer_digests is not None:
        extra["peer_digests"] = peer_digests
    post(d, nick, members(d).get("channel") or os.environ.get("ATLAS_IRC_CHANNEL") or "#team", f"DONE {nick}: {text}", kind="done",
         extra=extra)
    print(f"posted DONE for {nick}")


def cmd_done(a) -> int:
    """Announce DONE for the calling nick, once: a repeat (e.g. the Stop gate re-running the check) is a
    no-op until a GAVE UP or failed check intervenes. With ATLAS_CREW_UNIT_CHECK set the check is re-run first
    and a failure refuses the DONE (exit 1)."""
    d = _dir(a.dir)
    nick = _env_nick(a)
    _install_from_env()
    code = _check_with_docstrings(d, nick)
    if code:
        print(f"refused: DONE {nick} needs the unit check to pass (exit {code})")
        return 1
    _announce_done(d, nick, " ".join(a.text) or "check passes")
    return 0


# Measured: each DONE hop on a dependency chain costs 0.5-0.8 s (poll, pytest start, post); on 8 modules the
# chain ranges -> registry -> graph -> resolver -> cli took 2.5 s after the critical file's DONE.
SPECULATE_POLL_S = 0.2


def _peer_owns_env():
    """ATLAS_CREW_PEER_OWNS as {nick: [owned rel paths]}, or None when unset or malformed."""
    try:
        peer_owns = json.loads(os.environ.get("ATLAS_CREW_PEER_OWNS") or "")
    except ValueError:
        return None
    ok = isinstance(peer_owns, dict) and all(isinstance(v, list) for v in peer_owns.values())
    return peer_owns if ok else None


def _peer_ready(d, root, peer: str, owns, stub_dir) -> bool:
    """Test-ready: `peer` has a current DONE, or it owns concrete paths and every one is a file whose bytes
    differ from its pristine stub copy in `stub_dir` (a glob, a directory or a missing stub is not ready)."""
    if has_done(d, peer):
        return True
    concrete = [p for p in owns or [] if not any(c in p for c in "*?[")]
    if not concrete or len(concrete) != len(owns) or not stub_dir:
        return False
    for rel in concrete:
        try:
            if Path(root, rel).read_bytes() == Path(stub_dir, rel).read_bytes():
                return False
        except OSError:
            return False
    return True


def _peer_gave_up(d, peer: str) -> bool:
    """True when the latest done/failed record of `peer` is a GAVE UP (kind failed)."""
    gave_up = False
    for r in history(d):
        if r.get("from") == peer and r.get("kind") in ("failed", "done"):
            gave_up = r.get("kind") == "failed"
    return gave_up


def _latest_done_digest(d, peer: str):
    """The digest on `peer`'s latest DONE record (None: no DONE, or one without a digest)."""
    rec = next((r for r in reversed(history(d)) if r.get("from") == peer and r.get("kind") == "done"), None)
    return rec.get("digest") if rec else None


def _peer_digests(root, peers, peer_owns) -> dict:
    """{peer: _owned_digest of the files it owns} for the speculative-run snapshots."""
    return {p: _owned_digest(root, peer_owns.get(p) or []) for p in peers}


def _closure_snapshot(root, nick: str):
    """{peer: digest} over ATLAS_CREW_NEEDS_ALL now, or None when ATLAS_CREW_PEER_OWNS is missing or lacks a peer."""
    peers = [p for p in dict.fromkeys((os.environ.get("ATLAS_CREW_NEEDS_ALL") or "").replace(",", " ").split()) if p != nick]
    peer_owns = _peer_owns_env()
    if peer_owns is None or any(p not in peer_owns for p in peers):
        return None
    return _peer_digests(root, peers, peer_owns)


def _wait_peers_ready(d, root, peers, peer_owns, deadline) -> bool:
    """Poll until every peer is test-ready. False on timeout or when a peer gave up (the normal path reports it)."""
    stub_dir = os.environ.get("ATLAS_CREW_STUB_DIR")
    while True:
        if any(_peer_gave_up(d, p) for p in peers):
            return False
        if all(_peer_ready(d, root, p, peer_owns[p], stub_dir) for p in peers):
            return True
        if time.time() >= deadline:
            return False
        time.sleep(SPECULATE_POLL_S)


def _speculate(d, nick: str, a, deadline):
    """Speculative check: once every closure peer is test-ready run the unit check quietly, before the peers'
    DONEs. Returns None to fall through to the normal path (nothing printed), else the exit code. A valid pass
    (peer files unchanged across the run, every peer then DONE for exactly those bytes) prints the captured
    output and posts DONE with no second run."""
    closure = (os.environ.get("ATLAS_CREW_NEEDS_ALL") or os.environ.get("ATLAS_CREW_NEEDS") or "").replace(",", " ").split()
    closure = [p for p in dict.fromkeys(closure) if p != nick]
    peer_owns = _peer_owns_env()
    if not closure or peer_owns is None or any(p not in peer_owns for p in closure):
        return None
    root = os.environ.get("ATLAS_CREW_ROOT") or os.getcwd()
    if not _wait_peers_ready(d, root, closure, peer_owns, deadline):
        return None
    before = _peer_digests(root, closure, peer_owns)
    out: list = []
    code = _check_with_docstrings(d, nick, quiet=True, capture=out)
    if code or _peer_digests(root, closure, peer_owns) != before:
        return None
    rc = cmd_need(argparse.Namespace(dir=a.dir, as_=a.as_, done=True, timeout=max(deadline - time.time(), 0), peers=closure))
    if rc:
        return rc
    if any(_latest_done_digest(d, p) != before[p] for p in closure):
        return None
    print("".join(out), end="")
    _announce_done(d, nick, "check passes", before)
    return 0


EARLY_CHECK_TIMEOUT_S = 20
EARLY_TAIL_CHARS = 3000
STUB_MARKER = "NotImplementedError"
PEER_IMPORT_MARKERS = ("ModuleNotFoundError", "ImportError", "cannot import name")


def _own_failures(xml_path) -> list:
    """[(test id, short message)] for each junit <failure> whose text neither names the stub marker nor an
    import error: those come from an unfinished peer, not from the worker's own code. <error> elements
    (collection and import errors) are never own."""
    import xml.etree.ElementTree as ET
    try:
        root = ET.parse(xml_path).getroot()
    except (OSError, ET.ParseError):
        return []
    found = []
    for tc in root.iter("testcase"):
        for f in tc.findall("failure"):
            text = (f.get("message") or "") + "\n" + (f.text or "")
            if STUB_MARKER in text or any(m in text for m in PEER_IMPORT_MARKERS):
                continue
            tid = f"{(tc.get('classname') or '').replace('.', '/')}.py::{tc.get('name')}" if tc.get("classname") else tc.get("name")
            found.append((tid, (f.get("message") or "").strip().splitlines()[0][:300] if (f.get("message") or "").strip() else ""))
    return found


def _early_check(d, nick: str, needs) -> int | None:
    """While a need is not DONE, run the unit check once per owned-files digest (quiet, junit-xml via
    PYTEST_ADDOPTS, EARLY_CHECK_TIMEOUT_S) and return 1 after printing the failures that do not depend on
    unfinished peers; None to carry on to the normal wait. ATLAS_CREW_EARLY_CHECK=off disables it."""
    cmd = os.environ.get("ATLAS_CREW_UNIT_CHECK") or ""
    if (os.environ.get("ATLAS_CREW_EARLY_CHECK") or "").lower() == "off" or "pytest" not in cmd:
        return None
    if all(has_done(d, p) for p in needs if p != nick):
        return None
    root = os.environ.get("ATLAS_CREW_ROOT") or os.getcwd()
    digest = _owned_digest(root, _env_owns())
    marker = Path(d) / f"earlycheck-{nick}.digest"
    try:
        if marker.read_text().strip() == digest:
            return None
    except OSError:
        pass
    try:
        marker.write_text(digest)
    except OSError:
        pass
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        xml = os.path.join(tmp, "early.xml")
        env = dict(os.environ)
        env["PYTEST_ADDOPTS"] = (env.get("PYTEST_ADDOPTS", "") + f" --junitxml={xml} -p no:cacheprovider").strip()
        try:
            subprocess.run(cmd, shell=True, cwd=root, capture_output=True, text=True, env=env, timeout=EARLY_CHECK_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            return None
        own = _own_failures(xml)
    if not own:
        return None
    body = "".join(f"FAILED {t}: {m}\n" for t, m in own)[:EARLY_TAIL_CHARS]
    print(body + "These failures do not depend on unfinished peers (no NotImplementedError or import error); fix them now. `irc check` again waits for the peers.")
    return 1


def cmd_check(a) -> int:
    """The worker's check: wait for ATLAS_CREW_NEEDS (as `need --done`: exit 2 unknown, 3 timeout, 4 a peer
    gave up), run ATLAS_CREW_UNIT_CHECK, and post DONE only when it exits 0. Exits with the check's code. The
    DONE decision is made here, so piping the output (`irc check | tail`) cannot turn a failure into a DONE.
    With needs and ATLAS_CREW_SPECULATE not "off", the check first runs speculatively (`_speculate`) as soon as
    every peer in ATLAS_CREW_NEEDS_ALL has installed its file; a failed or invalidated run prints nothing and
    the normal path above runs after the needs' DONE, so failure output only ever comes from that later run."""
    d = _dir(a.dir)
    nick = _env_nick(a)
    _install_from_env()
    needs = (os.environ.get("ATLAS_CREW_NEEDS") or "").replace(",", " ").split()
    deadline = time.time() + a.timeout
    if needs:
        rc = _early_check(d, nick, needs)
        if rc is not None:
            return rc
    if needs and (os.environ.get("ATLAS_CREW_SPECULATE") or "").lower() != "off":
        rc = _speculate(d, nick, a, deadline)
        if rc is not None:
            return rc
    if needs:
        rc = cmd_need(argparse.Namespace(dir=a.dir, as_=a.as_, done=True, timeout=max(deadline - time.time(), 0), peers=needs))
        if rc:
            return rc
    root = os.environ.get("ATLAS_CREW_ROOT") or os.getcwd()
    snap = _closure_snapshot(root, nick)
    code = _check_with_docstrings(d, nick)
    if code:
        return code
    # peer_digests only when the closure bytes were the same before and after the passing run
    _announce_done(d, nick, "check passes", snap if snap is not None and _closure_snapshot(root, nick) == snap else None)
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
    # only messages after our cursor count, so a stale one (a DONE since invalidated) cannot satisfy the wait;
    # --all scans the whole log
    scan_from = 0 if a.all else cursor(d, nick)
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
    """Block until every named peer has announced READY or DONE (`--done`: DONE only). Exit 0 when all
    have, 3 on timeout (naming who is missing), 2 for a name that is not on the team (the lead posts no
    READY), 4 as soon as a named peer has posted GAVE UP (kind failed), whatever the mode."""
    d = _dir(a.dir)
    nick = _env_nick(a)
    peers = [p for p in ",".join(a.peers).replace(",", " ").split() if p and p != nick]
    bad = _unknown_peers(d, peers)
    if bad:
        print(f"not on the team: {', '.join(bad)}; peers are {', '.join(members(d).get('members') or [])}")
        return 2
    ok_re = r"DONE\b" if a.done else r"(READY|DONE)\b"
    deadline = time.time() + a.timeout
    ready, seen = {}, 0
    while True:
        gave_up = []
        for r in history(d, seen):
            seen = max(seen, int(r["seq"]))
            who, text = r.get("from"), r.get("text", "")
            if who not in peers:
                continue
            if r.get("kind") == "unverified":
                ready.pop(who, None)
            elif r.get("kind") == "failed" or re.match(r"GAVE UP\b", text):
                gave_up.append(who)
            elif r.get("kind") == "done" or re.match(ok_re, text):
                ready[who] = text
        if gave_up:
            print(f"peer gave up: {', '.join(dict.fromkeys(gave_up))}")
            return 4
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
    dn = sub.add_parser("done", help="announce DONE for yourself, once (idempotent; re-runs ATLAS_CREW_UNIT_CHECK when set)")
    dn.add_argument("--as", dest="as_")
    dn.add_argument("text", nargs="*")
    dn.set_defaults(fn=cmd_done)
    ck = sub.add_parser(
        "check",
        help="wait for ATLAS_CREW_NEEDS, run ATLAS_CREW_UNIT_CHECK, post DONE only if it passes (exit = the check's code)",
    )
    ck.add_argument("--as", dest="as_")
    ck.add_argument("--timeout", type=float, default=100)
    ck.set_defaults(fn=cmd_check)
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
    w.add_argument("--all", action="store_true", help="also match messages already delivered to you (scan the whole log)")
    w.add_argument("--new-only", action="store_true", help="accepted for compatibility; new messages only is the default")
    w.set_defaults(fn=cmd_wait)
    n = sub.add_parser(
        "need",
        help="block until every named peer announced READY or DONE (exit 3 on timeout, 4 if a peer gave up)",
    )
    n.add_argument("--done", action="store_true", help="only DONE counts, not READY")
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
