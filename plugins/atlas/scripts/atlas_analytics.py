#!/usr/bin/env python3
"""Opt-in, local-first, anonymous Atlas usage counters.

Nothing is recorded and nothing leaves the machine unless the user opted in (undecided == off).
Only counters whose key fully matches contracts/analytics-schema.json are ever stored or sent; the
enums in that schema come from files shipped with this plugin, so a user's own skill, repo, path or
project name can never match. There is no install id, session id, timestamp finer than the ISO week,
path, name, prompt or error text anywhere in the data.

Hot path (hooks):  from atlas_analytics import record;  record("hook.git_guard.deny.protected")
Disabled cost is one module-global check. Enabled cost is one validated append to events.jsonl.

CLI:  status | explain | enable [--endpoint URL] | disable [--keep] | preview | prove | export [--out FILE]
      | delete | send [--week YYYY-Www]
State: $ATLAS_HOME/analytics/ (ATLAS_HOME defaults to ~/.atlas): consent.json, events.jsonl, sent.jsonl,
notice.json. ATLAS_ANALYTICS=off forces everything off and silences the notice. There is NO default
endpoint: `send` refuses until one is configured (enable --endpoint URL, or ATLAS_ANALYTICS_ENDPOINT).
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import re
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = PLUGIN_ROOT / "contracts" / "analytics-schema.json"
SCHEMA_VERSION = 1
LOCAL_HOSTS = ("127.0.0.1", "localhost")

# --- hot-path state -------------------------------------------------------------------------------
_ENABLED: bool | None = None  # None = not resolved yet in this process
_SCHEMA: dict | None = None
_MATCHERS: list | None = None
_VALID: dict[str, bool] = {}
_VALID_CAP = 4096


def _now() -> _dt.date:
    return _dt.date.today()


def _week_of(d: _dt.date) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def home() -> Path:
    return Path(os.environ.get("ATLAS_HOME") or (Path.home() / ".atlas"))


def adir() -> Path:
    return home() / "analytics"


def _forced_off() -> bool:
    return os.environ.get("ATLAS_ANALYTICS", "").strip().lower() in (
        "off",
        "0",
        "false",
        "no",
        "disabled",
    )


def load_consent() -> dict:
    try:
        d = json.loads((adir() / "consent.json").read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def is_enabled() -> bool:
    """True only when the user explicitly opted in and ATLAS_ANALYTICS is not off."""
    if _forced_off():
        return False
    c = load_consent()
    return c.get("enabled") is True and bool(c.get("decided"))


def is_decided() -> bool:
    return bool(load_consent().get("decided"))


def _reset() -> None:
    """Drop per-process caches (tests, and the CLI after changing consent)."""
    global _ENABLED, _SCHEMA, _MATCHERS
    _ENABLED = None
    _SCHEMA = None
    _MATCHERS = None
    _VALID.clear()


# --- schema ---------------------------------------------------------------------------------------
def load_schema() -> dict:
    global _SCHEMA
    if _SCHEMA is None:
        _SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return _SCHEMA


def _source_values(source: str) -> list[str]:
    """Enum values derived from files shipped in this plugin (never from the user's project)."""
    if source == "hooks":
        return sorted(
            p.stem
            for p in (PLUGIN_ROOT / "hooks").glob("*.py")
            if not p.name.startswith(("test_", "_"))
            and p.stem not in ("testenv", "conftest")
        )
    if source == "skills":
        return sorted(
            p.name
            for p in (PLUGIN_ROOT / "skills").iterdir()
            if p.is_dir() and (p / "SKILL.md").exists()
        )
    if source == "agents":
        return sorted(p.stem for p in (PLUGIN_ROOT / "agents").glob("*.md"))
    if source in ("scope_classes", "scope_efforts"):
        classes = json.loads(
            (PLUGIN_ROOT / "contracts" / "scope-matrix.json").read_text(
                encoding="utf-8"
            )
        )["classes"]
        if source == "scope_classes":
            return sorted(classes)
        return sorted({e for v in classes.values() for e in v})
    return []


def enum_values(name: str) -> list[str]:
    spec = load_schema()["enums"][name]
    return list(spec["values"]) if "values" in spec else _source_values(spec["source"])


def _matchers() -> list:
    """[(family, compiled fullmatch regex)] built from the schema patterns and the runtime enums."""
    global _MATCHERS
    if _MATCHERS is None:
        sch = load_schema()
        cache: dict[str, str] = {}

        def alt(name: str) -> str:
            if name not in cache:
                vals = sorted(enum_values(name), key=len, reverse=True)
                cache[name] = (
                    "(?:" + "|".join(re.escape(v) for v in vals) + ")"
                    if vals
                    else "(?!)"
                )
            return cache[name]

        out = []
        for fam, spec in sch["families"].items():
            for pat in spec["patterns"]:
                rx = "".join(
                    alt(tok[1:-1]) if tok.startswith("{") else re.escape(tok)
                    for tok in re.split(r"(\{[a-z]+\})", pat)
                    if tok
                )
                out.append((fam, re.compile(rx)))
        _MATCHERS = out
    return _MATCHERS


def family_of(key: object) -> str | None:
    """The schema family a key belongs to, or None when it is not allowed."""
    if not isinstance(key, str) or len(key) > 96 or not key.isascii():
        return None
    for fam, rx in _matchers():
        if rx.fullmatch(key):
            return fam
    return None


def valid_key(key: object) -> bool:
    if type(key) is not str:
        return False
    hit = _VALID.get(key)
    if hit is None:
        hit = family_of(key) is not None
        if len(_VALID) < _VALID_CAP:
            _VALID[key] = hit
    return hit


def _clamp(n: object) -> int | None:
    if type(n) is not int or n < 1:
        return None
    return min(n, load_schema().get("max_count", 10000))


# --- recording ------------------------------------------------------------------------------------
def record(key: str, n: int = 1) -> None:
    """Count one allowlisted event. No-op (one cached check) unless opted in. Never raises."""
    global _ENABLED
    try:
        if _ENABLED is False:
            return
        if _ENABLED is None:
            _ENABLED = is_enabled()
            if not _ENABLED:
                return
        if not valid_key(key):
            return
        n = _clamp(n)
        if n is None:
            return
        d = adir()
        d.mkdir(parents=True, exist_ok=True)
        line = (
            json.dumps({"w": _week_of(_now()), "k": key, "n": n}, separators=(",", ":"))
            + "\n"
        )
        with open(d / "events.jsonl", "a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        return


def read_events() -> list[dict]:
    """Stored events that still validate (a hand-edited or old line that does not is ignored)."""
    out = []
    try:
        text = (adir() / "events.jsonl").read_text(encoding="utf-8")
    except Exception:
        return out
    for ln in text.splitlines():
        try:
            e = json.loads(ln)
            w, k, n = e["w"], e["k"], _clamp(e["n"])
            if (
                isinstance(w, str)
                and re.fullmatch(r"\d{4}-W\d{2}", w)
                and valid_key(k)
                and n
            ):
                out.append({"w": w, "k": k, "n": n})
        except Exception:
            continue
    return out


# --- payload --------------------------------------------------------------------------------------
def _harness() -> str:
    env = os.environ
    h = env.get("ATLAS_HARNESS")
    if h in ("omp", "claude", "codex"):
        return h
    keys = list(env)
    if "OMPCODE" in keys or any(k.startswith(("OMP_", "PI_")) for k in keys):
        return "omp"
    if any(k.startswith("CODEX_") for k in keys):
        return "codex"
    if "CLAUDECODE" in keys or any(k.startswith("CLAUDE_CODE_") for k in keys):
        return "claude"
    return "unknown"


def _os_name() -> str:
    p = sys.platform
    return (
        "linux"
        if p.startswith("linux")
        else "darwin"
        if p == "darwin"
        else "windows"
        if p.startswith("win")
        else "other"
    )


def atlas_version() -> str:
    try:
        v = json.loads(
            (PLUGIN_ROOT / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8")
        ).get("version", "")
        return v if re.fullmatch(r"\d+\.\d+\.\d+", v or "") else "unknown"
    except Exception:
        return "unknown"


def pending_week(events: list[dict] | None = None) -> str:
    """Oldest finished week that has events; else the current week (not yet sendable)."""
    events = read_events() if events is None else events
    cur = _week_of(_now())
    done = sorted({e["w"] for e in events if e["w"] < cur})
    return done[0] if done else cur


def build_payload(week: str | None = None) -> dict:
    """The exact payload `send` would POST. Re-validates every key and count (defence in depth)."""
    events = read_events()
    week = week or pending_week(events)
    counts: dict[str, int] = {}
    cap = load_schema().get("max_count", 10000)
    for e in events:
        if e["w"] == week and valid_key(e["k"]):
            counts[e["k"]] = min(counts.get(e["k"], 0) + e["n"], cap)
    return {
        "schema": SCHEMA_VERSION,
        "atlas_version": atlas_version(),
        "harness": _harness(),
        "os": _os_name(),
        "python": f"{sys.version_info.major}.{sys.version_info.minor}",
        "week": week,
        "counts": dict(sorted(counts.items())),
    }


def payload_json(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


# --- anonymity checks (prove) ---------------------------------------------------------------------
_ENVELOPE = {"schema", "atlas_version", "harness", "os", "python", "week", "counts"}
_RX_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_RX_IPV4 = re.compile(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")
_RX_IPV6 = re.compile(
    r"(?<![\w:])(?=[0-9a-fA-F:]*[0-9a-fA-F])(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(?![\w:])"
)
_RX_PATH = re.compile(r"(?<![\w.])/[\w.~@+-]+(?:/[\w.~@+-]*)*|[A-Za-z]:\\\\|~/")
_RX_HEX = re.compile(r"(?<![0-9A-Za-z])[0-9a-fA-F]{16,}(?![0-9A-Za-z])")
_RX_B64 = re.compile(r"[A-Za-z0-9+/]{16,}={0,2}")


def _git_remote_parts(cwd: str) -> list[tuple[str, str]]:
    import subprocess

    try:
        url = subprocess.run(
            ["git", "-C", cwd, "remote", "get-url", "origin"],
            capture_output=True,
            text=True,
            timeout=3,
        ).stdout.strip()
    except Exception:
        return []
    if not url:
        return []
    out = [("git remote url", url)]
    parts = [p for p in re.split(r"[/:@]", re.sub(r"\.git$", "", url)) if p]
    if len(parts) >= 2:
        out += [("git remote owner", parts[-2]), ("git remote repo", parts[-1])]
    return out


def gather_identities() -> list[tuple[str, str]]:
    """Things about this machine/user/project that must never appear in a payload."""
    import getpass
    import platform
    import socket

    ids: list[tuple[str, str]] = []

    def add(label: str, val: object) -> None:
        if isinstance(val, str) and len(val.strip()) >= 3:
            ids.append((label, val.strip()))

    try:
        add("username", getpass.getuser())
    except Exception:
        pass
    for var in ("USER", "USERNAME", "LOGNAME"):
        add("username", os.environ.get(var))
    for fn in (socket.gethostname, platform.node):
        try:
            add("hostname", fn())
        except Exception:
            pass
    add("home dir", str(Path.home()))
    try:
        cwd = os.getcwd()
        add("cwd", cwd)
        add("cwd basename", os.path.basename(cwd))
        ids += _git_remote_parts(cwd)
    except Exception:
        pass
    seen, uniq = set(), []
    for lab, v in ids:
        if (lab, v) not in seen:
            seen.add((lab, v))
            uniq.append((lab, v))
    return uniq


def check_payload(
    payload: object, identities: list[tuple[str, str]] | None = None
) -> list[tuple[str, bool, str]]:
    """Anonymity rules. Returns [(check name, passed, detail)]. Every check must pass for `prove` to exit 0."""
    ident = gather_identities() if identities is None else identities
    res: list[tuple[str, bool, str]] = []
    ok_shape = (
        isinstance(payload, dict)
        and set(payload) == _ENVELOPE
        and isinstance(payload.get("counts"), dict)
    )
    if not ok_shape:
        extra = (
            sorted(set(payload) ^ _ENVELOPE)
            if isinstance(payload, dict)
            else ["not an object"]
        )
        return [("envelope has exactly the schema fields", False, f"mismatch: {extra}")]
    res.append(
        ("envelope has exactly the schema fields", True, ", ".join(sorted(_ENVELOPE)))
    )
    env_bad = []
    if payload["schema"] != SCHEMA_VERSION:
        env_bad.append("schema")
    if payload["atlas_version"] != atlas_version():
        env_bad.append("atlas_version")
    if payload["harness"] not in ("claude", "omp", "codex", "unknown"):
        env_bad.append("harness")
    if payload["os"] not in ("linux", "darwin", "windows", "other"):
        env_bad.append("os")
    if not (
        isinstance(payload["python"], str)
        and re.fullmatch(r"3\.\d{1,2}", payload["python"])
    ):
        env_bad.append("python")
    if not (
        isinstance(payload["week"], str)
        and re.fullmatch(r"\d{4}-W\d{2}", payload["week"])
    ):
        env_bad.append("week")
    res.append(
        (
            "envelope values come from closed sets",
            not env_bad,
            f"bad: {env_bad}" if env_bad else "ok",
        )
    )
    counts = payload["counts"]
    bad_keys = [str(k)[:40] for k in counts if not valid_key(k)]
    res.append(
        (
            "no counter key outside the schema",
            not bad_keys,
            f"{len(counts)} keys" if not bad_keys else f"rejected: {bad_keys[:5]}",
        )
    )
    cap = load_schema().get("max_count", 10000)
    bad_vals = [
        str(k)[:40]
        for k, v in counts.items()
        if type(v) is not int or not 1 <= v <= cap
    ]
    res.append(
        (
            "every count is an integer within 1..%d" % cap,
            not bad_vals,
            "ok" if not bad_vals else f"bad: {bad_vals[:5]}",
        )
    )
    ser = payload_json(payload)
    masked = ser
    for k in set(_ENVELOPE) | {k for k in counts if valid_key(k)}:
        masked = masked.replace(f'"{k}"', '""')
    low = masked.lower()
    hits = [f"{lab} ({v[:3]}...)" for lab, v in ident if v.lower() in low]
    res.append(
        (
            "no username, hostname, home dir, cwd, repo identifiers",
            not hits,
            f"checked {len(ident)} identifiers" if not hits else f"found: {hits}",
        )
    )
    for name, rx in (
        ("no email-like strings", _RX_EMAIL),
        ("no IPv4 addresses", _RX_IPV4),
        ("no IPv6 addresses", _RX_IPV6),
        ("no absolute paths", _RX_PATH),
        ("no hex tokens of 16+ chars", _RX_HEX),
        ("no base64-like tokens of 16+ chars", _RX_B64),
    ):
        m = rx.search(masked)
        res.append((name, m is None, "ok" if m is None else "match found"))
    return res


# --- consent, notice ------------------------------------------------------------------------------
def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def valid_endpoint(url: str) -> str | None:
    """None when acceptable, else the reason it is not (https only; plain http only for localhost)."""
    from urllib.parse import urlsplit

    try:
        u = urlsplit(url)
    except Exception:
        return "not a URL"
    if u.scheme == "https" and u.hostname:
        return None
    if u.scheme == "http" and u.hostname in LOCAL_HOSTS:
        return None
    return "endpoint must be https (http is allowed only for 127.0.0.1 or localhost)"


def endpoint() -> str | None:
    return (
        os.environ.get("ATLAS_ANALYTICS_ENDPOINT")
        or load_consent().get("endpoint")
        or None
    )


def _script_path() -> str:
    return str(Path(__file__).resolve())


def boot_notice() -> str | None:
    """One honest line at session boot while consent is undecided; once per Atlas version. Never raises."""
    try:
        if _forced_off() or is_decided():
            return None
        ver = atlas_version()
        p = adir() / "notice.json"
        try:
            if json.loads(p.read_text(encoding="utf-8")).get("version") == ver:
                return None
        except Exception:
            pass
        _write_json(p, {"version": ver})
        s = _script_path()
        return (
            "Atlas analytics: OFF until you opt in. If on, it sends only weekly counts of which "
            "skills/hooks/gates fire (no paths, names, code or IDs). "
            f"Exact payload: python3 {s} preview | opt in: enable | stop: disable | details: explain"
        )
    except Exception:
        return None


# --- CLI ------------------------------------------------------------------------------------------
def _p(*a: object) -> None:
    print(*a)


def cmd_status(args) -> int:
    c = load_consent()
    ev = read_events()
    weeks = sorted({e["w"] for e in ev})
    state = "ON" if is_enabled() else "OFF"
    if _forced_off():
        state += " (forced off by ATLAS_ANALYTICS=off)"
    elif not is_decided():
        state += " (undecided)"
    _p(f"analytics:  {state}")
    _p(f"endpoint:   {endpoint() or 'none configured (nothing can be sent)'}")
    _p(f"decided:    {c.get('decided') or 'never'}")
    _p(f"directory:  {adir()}")
    for n in ("consent.json", "events.jsonl", "sent.jsonl", "notice.json"):
        _p(f"  {n}: {'present' if (adir() / n).exists() else 'absent'}")
    _p(f"events:     {len(ev)}")
    _p(f"weeks:      {weeks[0] + ' .. ' + weeks[-1] if weeks else 'none'}")
    return 0


def cmd_explain(args) -> int:
    sch = load_schema()
    _p("Atlas analytics (opt-in, off by default)\n")
    _p("WHAT IS COLLECTED")
    _p(
        "Only whole-number counters, summed per ISO week, whose names come from a fixed list in"
    )
    _p(f"{SCHEMA_PATH}. Each kind of counter exists for one reason:\n")
    for fam, spec in sch["families"].items():
        _p(f"  {fam:9} e.g. {spec['patterns'][0]}")
        _p(f"            why: {spec['purpose']}")
    _p(
        "\nAlso sent with each weekly payload: Atlas version, harness (claude/omp/codex/unknown),"
    )
    _p("OS family, Python minor version, ISO week.\n")
    _p("NEVER COLLECTED")
    for n in sch["never_collected"]:
        _p(f"  - {n}")
    _p("\nHOW IT IS KEPT HONEST")
    _p(
        "  - Off until you run `enable`. Undecided counts as off. ATLAS_ANALYTICS=off overrides everything."
    )
    _p(
        "  - Names allowed in counters are read from files shipped with Atlas, so your own skills, repos,"
    )
    _p(
        "    branches and paths can never match. Unknown keys are dropped when recorded and again when sent."
    )
    _p(
        "  - There is no built-in server address; `send` refuses until you configure one."
    )
    _p("\nWHERE IT LIVES")
    _p(
        f"  {adir()}/  (events.jsonl = pending counts, sent.jsonl = every payload exactly as sent)"
    )
    _p("\nSEE / DELETE")
    s = _script_path()
    _p(f"  python3 {s} preview   exact payload that would be sent")
    _p(f"  python3 {s} prove     check that payload against the anonymity rules")
    _p(f"  python3 {s} export    write the payload to a file to share by hand")
    _p(f"  python3 {s} disable   turn off and delete pending counts")
    _p(f"  python3 {s} delete    remove the whole analytics directory")
    return 0


def cmd_enable(args) -> int:
    ep = args.endpoint
    if ep:
        why = valid_endpoint(ep)
        if why:
            _p(f"refused: {why}")
            return 2
    c = load_consent()
    _write_json(
        adir() / "consent.json",
        {
            "enabled": True,
            "decided": _now().isoformat(),
            "schema": SCHEMA_VERSION,
            "endpoint": ep or c.get("endpoint"),
        },
    )
    try:
        _write_json(adir() / "notice.json", {"version": atlas_version()})
    except Exception:
        pass
    _reset()
    _p(
        "analytics enabled. Counts are recorded locally; nothing is sent unless an endpoint is configured and you run `send`."
    )
    return 0


def cmd_disable(args) -> int:
    c = load_consent()
    _write_json(
        adir() / "consent.json",
        {
            "enabled": False,
            "decided": _now().isoformat(),
            "schema": SCHEMA_VERSION,
            "endpoint": c.get("endpoint"),
        },
    )
    if not args.keep:
        try:
            (adir() / "events.jsonl").unlink()
        except FileNotFoundError:
            pass
    _reset()
    _p(
        "analytics disabled"
        + (" (pending counts kept)." if args.keep else "; pending counts deleted.")
    )
    return 0


def cmd_preview(args) -> int:
    _p(payload_json(build_payload(args.week)))
    return 0


def cmd_prove(args) -> int:
    payload = build_payload(args.week)
    results = check_payload(payload)
    _p(f"payload: {payload_json(payload)}")
    for name, ok, detail in results:
        _p(f"{'PASS' if ok else 'FAIL'}  {name}: {detail}")
    ok = all(r[1] for r in results)
    _p(f"RESULT: {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


def cmd_export(args) -> int:
    text = payload_json(build_payload(args.week)) + "\n"
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        _p(f"wrote {args.out}")
    else:
        sys.stdout.write(text)
    return 0


def cmd_delete(args) -> int:
    import shutil

    d = adir()
    existed = d.exists()
    shutil.rmtree(d, ignore_errors=True)
    _reset()
    _p(f"deleted {d}" if existed else f"nothing to delete at {d}")
    return 0


def _truncate_week(week: str) -> None:
    p = adir() / "events.jsonl"
    try:
        keep = [
            ln
            for ln in p.read_text(encoding="utf-8").splitlines()
            if not _line_is_week(ln, week)
        ]
    except FileNotFoundError:
        return
    tmp = p.with_suffix(".tmp")
    tmp.write_text("".join(ln + "\n" for ln in keep), encoding="utf-8")
    os.replace(tmp, p)


def _line_is_week(line: str, week: str) -> bool:
    try:
        return json.loads(line).get("w") == week
    except Exception:
        return False


def cmd_send(args) -> int:
    if _forced_off():
        _p("refused: ATLAS_ANALYTICS=off")
        return 2
    if not is_enabled():
        _p("refused: analytics is not enabled (run `enable` first).")
        return 2
    ep = endpoint()
    if not ep:
        _p(
            "refused: no endpoint is configured. Atlas ships with none. Use `enable --endpoint URL` or set "
            "ATLAS_ANALYTICS_ENDPOINT, or share `export` output by hand."
        )
        return 2
    why = valid_endpoint(ep)
    if why:
        _p(f"refused: {why}")
        return 2
    events = read_events()
    week = args.week or pending_week(events)
    if not args.week and week >= _week_of(_now()):
        _p(
            f"nothing to send yet: week {week} is still in progress (a week is sent once it has ended; use --week to override)."
        )
        return 0
    payload = build_payload(week)
    if not payload["counts"]:
        _p(f"nothing to send for week {week}.")
        return 0
    body = payload_json(payload)
    d = adir()
    d.mkdir(parents=True, exist_ok=True)
    with open(d / "sent.jsonl", "a", encoding="utf-8") as f:
        f.write(body + "\n")
    import urllib.request
    from urllib.parse import urlsplit

    req = urllib.request.Request(
        ep,
        data=body.encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "atlas-analytics/1"},
    )
    try:
        if urlsplit(ep).hostname in LOCAL_HOSTS:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            resp = opener.open(req, timeout=5)
        else:
            resp = urllib.request.urlopen(req, timeout=5)
        with resp:
            status = resp.status
    except Exception as e:
        _p(
            f"send failed ({type(e).__name__}); pending counts kept, payload is logged in sent.jsonl."
        )
        return 1
    if not 200 <= status < 300:
        _p(f"send failed (HTTP {status}); pending counts kept.")
        return 1
    _truncate_week(week)
    _p(
        f"sent week {week} ({len(payload['counts'])} counters); those events were removed from events.jsonl."
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    import argparse

    ap = argparse.ArgumentParser(
        prog="atlas_analytics.py", description=__doc__.split("\n")[0]
    )
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    sub.add_parser("explain").set_defaults(fn=cmd_explain)
    e = sub.add_parser("enable")
    e.add_argument("--endpoint")
    e.set_defaults(fn=cmd_enable)
    d = sub.add_parser("disable")
    d.add_argument("--keep", action="store_true", help="keep pending events.jsonl")
    d.set_defaults(fn=cmd_disable)
    for name, fn in (
        ("preview", cmd_preview),
        ("prove", cmd_prove),
        ("export", cmd_export),
        ("send", cmd_send),
    ):
        s = sub.add_parser(name)
        s.add_argument(
            "--week",
            help="ISO week, e.g. 2026-W45 (default: oldest finished week with data, else current)",
        )
        if name == "export":
            s.add_argument("--out")
        s.set_defaults(fn=fn)
    sub.add_parser("delete").set_defaults(fn=cmd_delete)
    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
