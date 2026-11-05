#!/usr/bin/env python3
"""Anonymous Atlas usage counters: on by default, easy to see, easy to turn off.

What it is. Whole-number counters of which shipped Atlas skills, hooks, gates and team sizes fire, summed per
ISO week, plus how long hook dispatch takes and how team runs end. Once a week has ended, its totals are sent
in one small JSON payload to the endpoint named in contracts/analytics-schema.json. The weekly reports land in
the tech-tools repository (telemetry/reports/) through a scheduled GitHub workflow.

What it is not. Only counter keys that fully match contracts/analytics-schema.json are ever stored or sent;
the names in that schema come from files shipped with this plugin, so a user's own skill, repo, branch, path
or project name can never match. There is no install, session, user or machine identifier. Each weekly
payload carries a fresh random nonce so a retried send is not counted twice; it is never reused and links
nothing across weeks. Timestamps are no finer than the ISO week.

Turn it off (any one is enough; the first that applies wins):
    DO_NOT_TRACK=1                         the cross-tool convention (consoledonottrack.com)
    ATLAS_ANALYTICS=off                    env var, or the same key in ~/.atlas/settings.json "env" (config key)
    python3 atlas_analytics.py disable     records the choice in ~/.atlas/analytics/consent.json
CI and test runs (CI, GITHUB_ACTIONS, PYTEST_CURRENT_TEST, ...) are off unless explicitly enabled.

Hot path (hooks):  from atlas_analytics import record;  record("hook.git_guard.deny.protected")
Off cost is one cached check per process. On cost is one validated append to events.jsonl.

CLI:  status | explain | preview [--week W] | prove [--week W] | export [--out FILE] | enable | disable [--keep]
      | delete | send [--week W] [--auto] | allowed-keys
State: $ATLAS_HOME/analytics/ (ATLAS_HOME defaults to ~/.atlas): consent.json, events.jsonl, outbox.json,
sent.jsonl, notice.json, last_send.json.
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import re
import sys
import uuid
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = PLUGIN_ROOT / "contracts" / "analytics-schema.json"
SCHEMA_VERSION = 2
LOCAL_HOSTS = ("127.0.0.1", "localhost")
HARNESSES = ("claude", "omp", "codex", "unknown")
OFF_VALUES = ("off", "0", "false", "no", "disabled")
ON_VALUES = ("on", "1", "true", "yes", "enabled")
# CI and test runners: counting them would measure Atlas's own test suite, not people using it.
AUTOMATION_VARS = (
    "CI",
    "GITHUB_ACTIONS",
    "GITLAB_CI",
    "BUILDKITE",
    "CIRCLECI",
    "TRAVIS",
    "JENKINS_URL",
    "TF_BUILD",
    "PYTEST_CURRENT_TEST",
)
MAX_WEEKS_KEPT = 8  # unsent weeks older than this are dropped, never sent late
SEND_RETRY_S = 6 * 3600  # background send attempts at most this often
COMPACT_BYTES = 256 * 1024  # events.jsonl above this is collapsed to one line per (week, key)

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


def _store_knob(name: str) -> str:
    """A knob saved in <ATLAS_HOME>/settings.json "env" (the dashboard and atlas_control write it there)."""
    try:
        env = json.loads((home() / "settings.json").read_text(encoding="utf-8")).get("env") or {}
        v = env.get(name)
        return v if isinstance(v, str) else ""
    except Exception:
        return ""


def _knob(name: str) -> str:
    v = os.environ.get(name)
    return (v if v is not None else _store_knob(name)).strip().lower()


def load_consent() -> dict:
    try:
        d = json.loads((adir() / "consent.json").read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _automation() -> bool:
    return any(os.environ.get(v) for v in AUTOMATION_VARS)


def state() -> tuple[bool, str]:
    """(on, why). Precedence: DO_NOT_TRACK > ATLAS_ANALYTICS > the enable/disable command > CI/test > default on."""
    dnt = os.environ.get("DO_NOT_TRACK", "").strip().lower()
    if dnt and dnt not in ("0", "false", "no"):
        return False, "DO_NOT_TRACK is set"
    knob = _knob("ATLAS_ANALYTICS")
    if knob in OFF_VALUES:
        return False, "ATLAS_ANALYTICS=off"
    if knob in ON_VALUES:
        return True, "ATLAS_ANALYTICS=on"
    c = load_consent()
    if c.get("enabled") is False:
        return False, "turned off with `disable`"
    if c.get("enabled") is True:
        return True, "turned on with `enable`"
    if _automation():
        return False, "CI or test run (set ATLAS_ANALYTICS=on to count it)"
    return True, "on by default"


def is_enabled() -> bool:
    return state()[0]


def _forced_off() -> bool:
    """Off by an environment opt-out (DO_NOT_TRACK or ATLAS_ANALYTICS=off): silences the notice too."""
    on, why = state()
    return not on and (why.startswith("DO_NOT_TRACK") or why.startswith("ATLAS_ANALYTICS"))


def is_decided() -> bool:
    return "enabled" in load_consent()


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
            if not p.name.startswith(("test_", "_")) and p.stem not in ("testenv", "conftest")
        )
    if source == "skills":
        return sorted(
            p.name
            for p in (PLUGIN_ROOT / "skills").iterdir()
            if p.is_dir() and (p / "SKILL.md").exists()
        )
    if source == "agents":
        return sorted(p.stem for p in (PLUGIN_ROOT / "agents").glob("*.md"))
    if source == "hook_events":
        try:
            return sorted(
                json.loads((PLUGIN_ROOT / "hooks" / "hooks.json").read_text(encoding="utf-8"))["hooks"]
            )
        except Exception:
            return []
    if source in ("scope_classes", "scope_efforts"):
        classes = json.loads(
            (PLUGIN_ROOT / "contracts" / "scope-matrix.json").read_text(encoding="utf-8")
        )["classes"]
        if source == "scope_classes":
            return sorted(classes)
        return sorted({e for v in classes.values() for e in v})
    return []


def enum_values(name: str) -> list[str]:
    spec = load_schema()["enums"][name]
    return list(spec["values"]) if "values" in spec else _source_values(spec["source"])


def _split(pat: str) -> list[str]:
    return [tok for tok in re.split(r"(\{[a-z]+\})", pat) if tok]


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
                    "(?:" + "|".join(re.escape(v) for v in vals) + ")" if vals else "(?!)"
                )
            return cache[name]

        out = []
        for fam, spec in sch["families"].items():
            for pat in spec["patterns"]:
                rx = "".join(
                    alt(tok[1:-1]) if tok.startswith("{") else re.escape(tok) for tok in _split(pat)
                )
                out.append((fam, lre(rx)))
        _MATCHERS = out
    return _MATCHERS


def allowed_keys() -> list[str]:
    """Every key the schema allows, fully expanded (finite: every placeholder is a closed enum). The ingest
    server validates against this list, generated from the same schema (telemetry/allowed-keys.json)."""
    out: set[str] = set()
    for spec in load_schema()["families"].values():
        for pat in spec["patterns"]:
            partial = [""]
            for tok in _split(pat):
                vals = enum_values(tok[1:-1]) if tok.startswith("{") else [tok]
                partial = [p + v for p in partial for v in vals]
            out.update(partial)
    return sorted(k for k in out if valid_key(k))


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
    """Count one allowlisted event. No-op (one cached check) when off. Never raises."""
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
        line = json.dumps({"w": _week_of(_now()), "k": key, "n": n}, separators=(",", ":")) + "\n"
        with open(d / "events.jsonl", "a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        return


def ms_bucket(ms: float) -> str:
    return "lt50" if ms < 50 else "50to200" if ms < 200 else "200to1000" if ms < 1000 else "ge1000"


def wall_bucket(seconds: float) -> str:
    m = seconds / 60.0
    return "lt1m" if m < 1 else "1to5m" if m < 5 else "5to15m" if m < 15 else "15to60m" if m < 60 else "ge60m"


def detect_harness(payload: dict | None = None, env: dict | None = None) -> str:
    """The harness running this hook: ATLAS_HARNESS when it names one; omp markers; Codex (sets PLUGIN_ROOT for
    plugin hooks, a Codex-only variable, and turn_id in turn payloads); Claude Code (CLAUDECODE)."""
    env = os.environ if env is None else env
    h = env.get("ATLAS_HARNESS")
    if h in HARNESSES:
        return h
    keys = list(env)
    if "OMPCODE" in keys or any(k.startswith(("OMP_", "PI_")) for k in keys):
        return "omp"
    if "PLUGIN_ROOT" in keys or any(k.startswith("CODEX_") for k in keys):
        return "codex"
    if isinstance(payload, dict) and "turn_id" in payload:
        return "codex"
    if "CLAUDECODE" in keys or any(k.startswith("CLAUDE_CODE_") for k in keys):
        return "claude"
    return "unknown"


def _read_lines() -> list[str]:
    try:
        return (adir() / "events.jsonl").read_text(encoding="utf-8").splitlines()
    except Exception:
        return []


def read_events() -> list[dict]:
    """Stored events that still validate (a hand-edited or old line that does not is ignored)."""
    out = []
    for ln in _read_lines():
        try:
            e = json.loads(ln)
            w, k, n = e["w"], e["k"], _clamp(e["n"])
            if isinstance(w, str) and re.fullmatch(r"\d{4}-W\d{2}", w) and valid_key(k) and n:
                out.append({"w": w, "k": k, "n": n})
        except Exception:
            continue
    return out


def _rewrite_events(events: list[dict]) -> None:
    p = adir() / "events.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(
        "".join(json.dumps(e, separators=(",", ":")) + "\n" for e in events), encoding="utf-8"
    )
    os.replace(tmp, p)


def compact(force: bool = False) -> bool:
    """Collapse events.jsonl to one line per (week, key) and drop weeks older than MAX_WEEKS_KEPT.
    Returns True when the file was rewritten."""
    p = adir() / "events.jsonl"
    try:
        if not force and p.stat().st_size < COMPACT_BYTES:
            return False
    except FileNotFoundError:
        return False
    cutoff = _week_of(_now() - _dt.timedelta(weeks=MAX_WEEKS_KEPT))
    cap = load_schema().get("max_count", 10000)
    tot: dict[tuple[str, str], int] = {}
    for e in read_events():
        if e["w"] >= cutoff:
            key = (e["w"], e["k"])
            tot[key] = min(tot.get(key, 0) + e["n"], cap)
    _rewrite_events([{"w": w, "k": k, "n": n} for (w, k), n in sorted(tot.items())])
    return True


# --- payload --------------------------------------------------------------------------------------
def _os_name() -> str:
    p = sys.platform
    if p.startswith("linux"):
        return "linux"
    if p == "darwin":
        return "darwin"
    if p.startswith("win"):
        return "windows"
    return "other"


def atlas_version() -> str:
    try:
        v = json.loads(
            (PLUGIN_ROOT / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8")
        ).get("version", "")
        return v if re.fullmatch(r"\d+\.\d+\.\d+", v or "") else "unknown"
    except Exception:
        return "unknown"


def finished_weeks(events: list[dict] | None = None) -> list[str]:
    events = read_events() if events is None else events
    cur = _week_of(_now())
    return sorted({e["w"] for e in events if e["w"] < cur})


def pending_week(events: list[dict] | None = None) -> str:
    """Oldest finished week that has events; else the current week (not yet sendable)."""
    done = finished_weeks(events)
    return done[0] if done else _week_of(_now())


def _read_json(path: Path) -> dict:
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _is_uuid4(s: object) -> bool:
    return isinstance(s, str) and bool(
        re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", s)
    )


def nonce_for(week: str, persist: bool = True) -> str:
    """The random idempotency nonce for one week's payload (kept so a retry reuses it). Fresh per week."""
    ob = _read_json(adir() / "outbox.json")
    n = ob.get(week)
    if _is_uuid4(n):
        return n
    n = str(uuid.uuid4())
    if persist:
        ob[week] = n
        try:
            _write_json(adir() / "outbox.json", ob)
        except Exception:
            pass
    return n


def build_payload(week: str | None = None, persist_nonce: bool = False) -> dict:
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
        "os": _os_name(),
        "python": f"{sys.version_info.major}.{sys.version_info.minor}",
        "week": week,
        "nonce": nonce_for(week, persist=persist_nonce),
        "counts": dict(sorted(counts.items())),
    }


def payload_json(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


# --- anonymity checks (prove) ---------------------------------------------------------------------
_ENVELOPE = {"schema", "atlas_version", "os", "python", "week", "nonce", "counts"}
from atlas_lazyre import lre  # noqa: E402
_RX_EMAIL = lre(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_RX_IPV4 = lre(r"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])")
_RX_IPV6 = lre(
    r"(?<![\w:])(?=[0-9a-fA-F:]*[0-9a-fA-F])(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(?![\w:])"
)
_RX_PATH = lre(r"(?<![\w.])/[\w.~@+-]+(?:/[\w.~@+-]*)*|[A-Za-z]:\\\\|~/")
_RX_HEX = lre(r"(?<![0-9A-Za-z])[0-9a-fA-F]{16,}(?![0-9A-Za-z])")
_RX_B64 = lre(r"[A-Za-z0-9+/]{16,}={0,2}")


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


def _sent_nonces() -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        for ln in (adir() / "sent.jsonl").read_text(encoding="utf-8").splitlines():
            try:
                p = json.loads(ln)
                out[str(p.get("nonce"))] = str(p.get("week"))
            except Exception:
                continue
    except Exception:
        pass
    return out


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
        extra = sorted(set(payload) ^ _ENVELOPE) if isinstance(payload, dict) else ["not an object"]
        return [("envelope has exactly the schema fields", False, f"mismatch: {extra}")]
    res.append(("envelope has exactly the schema fields", True, ", ".join(sorted(_ENVELOPE))))
    env_bad = []
    if payload["schema"] != SCHEMA_VERSION:
        env_bad.append("schema")
    if payload["atlas_version"] != atlas_version():
        env_bad.append("atlas_version")
    if payload["os"] not in ("linux", "darwin", "windows", "other"):
        env_bad.append("os")
    if not (isinstance(payload["python"], str) and re.fullmatch(r"3\.\d{1,2}", payload["python"])):
        env_bad.append("python")
    if not (isinstance(payload["week"], str) and re.fullmatch(r"\d{4}-W\d{2}", payload["week"])):
        env_bad.append("week")
    res.append(
        ("envelope values come from closed sets", not env_bad, f"bad: {env_bad}" if env_bad else "ok")
    )
    nonce = payload["nonce"]
    reused = _sent_nonces().get(str(nonce))
    nonce_ok = _is_uuid4(nonce) and (reused is None or reused == payload["week"])
    res.append(
        (
            "nonce is a random UUIDv4 never used for another week",
            nonce_ok,
            "ok" if nonce_ok else ("reused from " + reused if reused else "not a UUIDv4"),
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
    bad_vals = [str(k)[:40] for k, v in counts.items() if type(v) is not int or not 1 <= v <= cap]
    res.append(
        (
            "every count is an integer within 1..%d" % cap,
            not bad_vals,
            "ok" if not bad_vals else f"bad: {bad_vals[:5]}",
        )
    )
    masked = payload_json(payload)
    if _is_uuid4(nonce):
        masked = masked.replace(f'"{nonce}"', '""')
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


# --- endpoint, notice, background send ------------------------------------------------------------
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
    """ATLAS_ANALYTICS_ENDPOINT, else the endpoint shipped in the schema, else none."""
    for v in (os.environ.get("ATLAS_ANALYTICS_ENDPOINT"), load_schema().get("endpoint")):
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def _script_path() -> str:
    return str(Path(__file__).resolve())


def notice_text() -> str:
    s = _script_path()
    return (
        "Atlas collects anonymous usage counts to see how well it works for people (which Atlas skills, hooks "
        "and gates fire, summed per week; never code, prompts, paths, names or IDs). Totals are sent once a week "
        "after it ends and published in the tech-tools repo. "
        f"See exactly what would be sent: python3 {s} preview | turn off: ATLAS_ANALYTICS=off, DO_NOT_TRACK=1, "
        f"or python3 {s} disable | details: python3 {s} explain"
    )


def boot_notice() -> str | None:
    """The first-run notice: once per schema version while analytics is on by default and the user has not
    decided. Silent once they enable or disable, and under any opt-out or automation. Never raises."""
    try:
        on, why = state()
        if not on or why != "on by default" or is_decided():
            return None
        p = adir() / "notice.json"
        if _read_json(p).get("schema") == SCHEMA_VERSION:
            return None
        _write_json(p, {"schema": SCHEMA_VERSION, "shown": _now().isoformat()})
        return notice_text()
    except Exception:
        return None


def _notice_shown() -> bool:
    return is_decided() or _read_json(adir() / "notice.json").get("schema") == SCHEMA_VERSION


def maybe_send_in_background() -> bool:
    """Called at session boot. Starts a detached `send --auto` when analytics is on, the notice has been shown,
    an endpoint exists, a finished week is pending and no attempt ran in the last SEND_RETRY_S. Never blocks:
    the child is detached with its output discarded. Returns True when a child was started. Never raises."""
    try:
        if not is_enabled() or not _notice_shown():
            return False
        ep = endpoint()
        if not ep or valid_endpoint(ep):
            return False
        if not finished_weeks():
            return False
        import time

        last = _read_json(adir() / "last_send.json").get("at")
        if isinstance(last, (int, float)) and time.time() - last < SEND_RETRY_S:
            return False
        _write_json(adir() / "last_send.json", {"at": time.time()})
        import subprocess

        subprocess.Popen(
            [sys.executable, _script_path(), "send", "--auto"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            close_fds=True,
        )
        return True
    except Exception:
        return False


def on_session_start(payload: dict | None = None) -> None:
    """Session boot hook point: count the session by harness, compact the event log, kick a background send."""
    try:
        record("session." + detect_harness(payload))
        if is_enabled():
            compact()
            maybe_send_in_background()
    except Exception:
        pass


# --- CLI ------------------------------------------------------------------------------------------
def _p(*a: object) -> None:
    print(*a)


def cmd_status(args) -> int:
    on, why = state()
    ev = read_events()
    weeks = sorted({e["w"] for e in ev})
    _p(f"analytics:  {'ON' if on else 'OFF'} ({why})")
    _p(f"endpoint:   {endpoint() or 'none configured (counts stay on this machine)'}")
    _p(f"directory:  {adir()}")
    for n in ("consent.json", "events.jsonl", "outbox.json", "sent.jsonl", "notice.json"):
        _p(f"  {n}: {'present' if (adir() / n).exists() else 'absent'}")
    _p(f"events:     {len(ev)} lines, {sum(e['n'] for e in ev)} counts")
    _p(f"weeks:      {weeks[0] + ' .. ' + weeks[-1] if weeks else 'none'}")
    _p(f"sendable:   {', '.join(finished_weeks(ev)) or 'none (a week is sent after it ends)'}")
    return 0


def cmd_explain(args) -> int:
    sch = load_schema()
    s = _script_path()
    _p("Atlas analytics (anonymous, on by default)\n")
    _p("WHAT IS COLLECTED")
    _p("Only whole-number counters, summed per ISO week, whose names come from a fixed list in")
    _p(f"{SCHEMA_PATH}. Each kind of counter exists for one reason:\n")
    for fam, spec in sch["families"].items():
        _p(f"  {fam:9} e.g. {spec['patterns'][0]}")
        _p(f"            why: {spec['purpose']}")
    _p("\nEach weekly payload also carries: schema version, Atlas version, OS family (linux/darwin/windows/other),")
    _p("Python minor version, the ISO week, and a random nonce used only to drop a duplicate retry.\n")
    _p("NEVER COLLECTED")
    for n in sch["never_collected"]:
        _p(f"  - {n}")
    _p("\nHOW IT IS KEPT HONEST")
    _p("  - Names allowed in counters are read from files shipped with Atlas, so your own skills, repos,")
    _p("    branches and paths can never match. Unknown keys are dropped when recorded, when sent, and")
    _p("    again by the server, which accepts only the same fixed key list.")
    _p("  - The server keeps no IP address and publishes only weekly totals, hiding any counter that fewer")
    _p(f"    than {sch.get('min_installs_published', 3)} installs reported.")
    _p("  - `prove` checks the real payload against the anonymity rules on your machine and exits 1 on any failure.")
    _p(f"\nWHERE IT GOES\n  {endpoint() or 'no endpoint configured: nothing leaves this machine'}")
    _p("  Published weekly totals: telemetry/reports/ in https://github.com/w159/tech-tools")
    _p(f"\nWHERE IT LIVES\n  {adir()}/  (events.jsonl = pending counts, sent.jsonl = every payload exactly as sent)")
    _p("\nTURN OFF (any one)")
    _p(f"  DO_NOT_TRACK=1  |  ATLAS_ANALYTICS=off (env or ~/.atlas/settings.json env)  |  python3 {s} disable")
    _p("\nSEE / DELETE")
    _p(f"  python3 {s} preview   exact payload that would be sent")
    _p(f"  python3 {s} prove     check that payload against the anonymity rules")
    _p(f"  python3 {s} export    write the payload to a file")
    _p(f"  python3 {s} delete    remove the whole analytics directory")
    return 0


def cmd_enable(args) -> int:
    _write_json(
        adir() / "consent.json",
        {"enabled": True, "decided": _now().isoformat(), "schema": SCHEMA_VERSION},
    )
    _reset()
    on, why = state()
    _p(f"analytics enabled. Now: {'ON' if on else 'OFF'} ({why}).")
    return 0


def cmd_disable(args) -> int:
    _write_json(
        adir() / "consent.json",
        {"enabled": False, "decided": _now().isoformat(), "schema": SCHEMA_VERSION},
    )
    if not args.keep:
        for n in ("events.jsonl", "outbox.json"):
            try:
                (adir() / n).unlink()
            except FileNotFoundError:
                pass
    _reset()
    _p("analytics disabled" + (" (pending counts kept)." if args.keep else "; pending counts deleted."))
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


def cmd_allowed_keys(args) -> int:
    sch = load_schema()
    doc = {
        "schema": SCHEMA_VERSION,
        "max_count": sch.get("max_count", 10000),
        "min_installs_published": sch.get("min_installs_published", 3),
        "keys": allowed_keys(),
    }
    sys.stdout.write(json.dumps(doc, indent=1) + "\n")
    return 0


def _drop_week(week: str) -> None:
    _rewrite_events([e for e in read_events() if e["w"] != week])
    ob = _read_json(adir() / "outbox.json")
    if week in ob:
        ob.pop(week)
        _write_json(adir() / "outbox.json", ob)


def _post(ep: str, body: str) -> int:
    import urllib.request
    from urllib.parse import urlsplit

    req = urllib.request.Request(
        ep,
        data=body.encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "atlas-analytics/2"},
    )
    if urlsplit(ep).hostname in LOCAL_HOSTS:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        resp = opener.open(req, timeout=5)
    else:
        resp = urllib.request.urlopen(req, timeout=5)
    with resp:
        return resp.status


def _send_week(ep: str, week: str, quiet: bool) -> int:
    payload = build_payload(week, persist_nonce=True)
    if not payload["counts"]:
        _drop_week(week)
        if not quiet:
            _p(f"nothing to send for week {week}.")
        return 0
    failed = [r for r in check_payload(payload) if not r[1]]
    if failed:
        if not quiet:
            _p(f"refused: payload for {week} failed anonymity check '{failed[0][0]}'; nothing sent.")
        return 1
    body = payload_json(payload)
    d = adir()
    d.mkdir(parents=True, exist_ok=True)
    with open(d / "sent.jsonl", "a", encoding="utf-8") as f:
        f.write(body + "\n")
    try:
        status = _post(ep, body)
    except Exception as e:
        status = getattr(e, "code", None)
        if status != 409:  # 409 = the server already has this nonce: a retry of a send that landed
            if not quiet:
                _p(f"send failed ({type(e).__name__}); pending counts kept, payload logged in sent.jsonl.")
            return 1
    if not (200 <= status < 300 or status == 409):
        if not quiet:
            _p(f"send failed (HTTP {status}); pending counts kept.")
        return 1
    _drop_week(week)
    if not quiet:
        _p(f"sent week {week} ({len(payload['counts'])} counters); those events were removed from events.jsonl.")
    return 0


def cmd_send(args) -> int:
    on, why = state()
    quiet = bool(getattr(args, "auto", False))
    if not on:
        if not quiet:
            _p(f"refused: analytics is off ({why}).")
        return 2
    ep = endpoint()
    if not ep:
        if not quiet:
            _p("refused: no endpoint is configured (ATLAS_ANALYTICS_ENDPOINT or the schema 'endpoint').")
        return 2
    why_ep = valid_endpoint(ep)
    if why_ep:
        if not quiet:
            _p(f"refused: {why_ep}")
        return 2
    if args.week:
        return _send_week(ep, args.week, quiet)
    weeks = finished_weeks()
    if not weeks:
        if not quiet:
            _p(f"nothing to send yet: week {_week_of(_now())} is still in progress (a week is sent once it has ended).")
        return 0
    cutoff = _week_of(_now() - _dt.timedelta(weeks=MAX_WEEKS_KEPT))
    rc = 0
    for w in weeks:
        if w < cutoff:
            _drop_week(w)
            continue
        rc = max(rc, _send_week(ep, w, quiet))
        if rc:
            break  # keep the rest for the next attempt
    return rc


def main(argv: list[str] | None = None) -> int:
    import argparse

    ap = argparse.ArgumentParser(prog="atlas_analytics.py", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    sub.add_parser("explain").set_defaults(fn=cmd_explain)
    sub.add_parser("enable").set_defaults(fn=cmd_enable)
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
        if name == "send":
            s.add_argument("--auto", action="store_true", help="quiet; every finished week (session boot uses this)")
        s.set_defaults(fn=fn)
    sub.add_parser("delete").set_defaults(fn=cmd_delete)
    sub.add_parser("allowed-keys").set_defaults(fn=cmd_allowed_keys)
    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
