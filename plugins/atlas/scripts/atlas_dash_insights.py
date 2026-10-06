#!/usr/bin/env python3
"""Atlas Workboard v2: Insights backend (projects, overview, health, activity,
improve, prefs).

Contract: ``ROUTES`` is a list of ``(method, regex_path, handler)``. A handler
takes ``ctx`` (``.query`` dict, ``.json()``, ``.groups``, ``.db()`` sqlite
connection, ``.project_root(param)``) and returns ``(status, body)``.

Rules this module follows:
* Read-mostly. ``ctx.db()`` is used as handed over; ``atlas_db.init`` (DDL +
  migrations) is NEVER run per request. Missing tables degrade to empty data.
* No N+1: every aggregate is one GROUP BY over the window; Python only folds
  rows that are already in memory.
* No auth/CSRF/Host checks here: the central guard in atlas_dashboard.Handler
  owns that for every route.

Stdlib only.
"""

from __future__ import annotations

import glob
import hashlib
import json
import os
import re
import sqlite3
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

try:  # optional collaborators; every use is guarded
    import atlas_db  # type: ignore
except Exception:  # pragma: no cover
    atlas_db = None
try:
    import atlas_doctor  # type: ignore
except Exception:  # pragma: no cover
    atlas_doctor = None
try:
    import atlas_finding  # type: ignore
except Exception:  # pragma: no cover
    atlas_finding = None


def _state_dir() -> Path:
    return Path(os.environ.get("ATLAS_HOME") or Path.home() / ".atlas")


# Set by atlas_dashboard: returns the Settings connector rows (name, health, usage).
# Health reads it so both pages share one definition of "connector problem".
CONNECTOR_STATUS_PROVIDER = None

# Module-level so tests can point them at a temp dir.
PREFS_PATH = _state_dir() / "dashboard-prefs.json"
DASHBOARD_LOG = _state_dir() / "dashboard.log"
HOOKSTATE_DIR = _state_dir() / "hookstate"
NUDGE_STAMP = _state_dir() / ".atlas_nudge"
DOCTOR_STATE = _state_dir() / "doctor-state.json"

NUDGE_THROTTLE_MIN = 15  # hooks/nudge.py WINDOW_SECONDS = 900
STOP_BURST_LIMIT = 5  # atlas_hook_guard circuit-breaker constants
STOP_BURST_WINDOW = 120
MAX_ITEMS = 500

# ---------------------------------------------------------------- helpers


def _iso(ts) -> str | None:
    try:
        if ts is None:
            return None
        return datetime.fromtimestamp(float(ts), timezone.utc).isoformat(
            timespec="seconds"
        )
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def _window_seconds(raw, default=7 * 86400) -> int:
    m = re.fullmatch(r"(\d{1,4})([hdw])", str(raw or "").strip().lower())
    if not m:
        return default
    n, unit = int(m.group(1)), m.group(2)
    return max(1, n) * {"h": 3600, "d": 86400, "w": 604800}[unit]


def _clip(text, n=240) -> str:
    s = " ".join(str(text or "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


def _q(ctx, key, default=""):
    q = getattr(ctx, "query", None) or {}
    v = q.get(key, default)
    if isinstance(v, (list, tuple)):
        v = v[0] if v else default
    return v if v is not None else default


def _err(status, error, why="", do=""):
    return status, {"ok": False, "error": error, "why": why, "do": do}


class _Db:
    """One request's view of the connection: table/column presence probed once."""

    def __init__(self, conn):
        self.conn = conn
        self.tables: set[str] = set()
        self._cols: dict[str, set[str]] = {}
        if conn is not None:
            try:
                self.tables = {
                    r[0]
                    for r in conn.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'"
                    )
                }
            except sqlite3.Error:
                self.tables = set()

    def has(self, *names) -> bool:
        return all(n in self.tables for n in names)

    def cols(self, table) -> set[str]:
        if table not in self._cols:
            try:
                self._cols[table] = {
                    r[1] for r in self.conn.execute(f"PRAGMA table_info({table})")
                }
            except sqlite3.Error:
                self._cols[table] = set()
        return self._cols[table]

    def rows(self, sql, params=()) -> list[tuple]:
        if self.conn is None:
            return []
        try:
            return self.conn.execute(sql, params).fetchall()
        except sqlite3.Error:
            return []

    def dicts(self, sql, params=()) -> list[dict]:
        if self.conn is None:
            return []
        try:
            cur = self.conn.execute(sql, params)
            names = [d[0] for d in cur.description]
            return [dict(zip(names, r)) for r in cur.fetchall()]
        except sqlite3.Error:
            return []


def _open(ctx) -> _Db:
    try:
        return _Db(ctx.db())
    except Exception:
        return _Db(None)


def _project_filter(ctx, db: _Db):
    """(root or None). 'all'/omitted -> None (cross-project)."""
    raw = _q(ctx, "project", "")
    if not raw or raw == "all":
        return None
    try:
        root = ctx.project_root(raw)
    except Exception:
        root = None
    return str(root) if root else str(raw)


def _project_names(db: _Db) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if db.has("projects"):
        for pid, root, name, last in db.rows(
            "SELECT id, root_path, name, last_seen FROM projects"
        ):
            out[root] = {
                "id": pid,
                "name": name or os.path.basename(root) or root,
                "last_seen": last,
            }
    return out


def _is_noise_root(root: str) -> bool:
    """Throwaway roots (tmp dirs, filesystem root) are not projects to show."""
    r = (root or "").rstrip("/")
    if r in ("", "/tmp", "/private/tmp", "/var/folders"):
        return True
    return r.startswith(
        ("/tmp/", "/private/tmp/", "/private/var/folders/", "/var/folders/")
    )


# ----------------------------------------------------- silent-failure mining


def _fold_tool_calls(
    db: _Db, since: float, root: str | None, until: float | None = None
) -> list[dict]:
    """tool_calls errors and hook denies, one GROUP BY across projects."""
    if not db.has("tool_calls"):
        return []
    joined = db.has("session_logs", "projects")
    sel_proj = "COALESCE(p.root_path,'')" if joined else "''"
    join = (
        "LEFT JOIN session_logs s ON s.session_id=t.session_id "
        "LEFT JOIN projects p ON p.id=s.project_id"
        if joined
        else ""
    )
    where = "t.ts>=? AND (COALESCE(t.is_error,0)=1 OR COALESCE(t.denied,0)=1)"
    params: list = [since]
    if until is not None:
        where += " AND t.ts<?"
        params.append(until)
    if root and joined:
        where += " AND p.root_path=?"
        params.append(root)
    sql = (
        f"SELECT {sel_proj} AS proj, COALESCE(t.tool_name,'?') AS tool, "
        "CASE WHEN COALESCE(t.denied,0)=1 THEN 'deny' ELSE 'error' END AS what, "
        "COUNT(*) AS n, MIN(t.ts) AS first, MAX(t.ts) AS last, "
        "MAX(t.input_summary) AS sample "
        f"FROM tool_calls t {join} WHERE {where} "
        "GROUP BY proj, tool, what ORDER BY n DESC LIMIT 400"
    )
    out = []
    for r in db.dicts(sql, params):
        deny = r["what"] == "deny"
        out.append(
            {
                "kind": "gate_deny" if deny else "tool_error",
                "project": r["proj"],
                "count": r["n"],
                "first": r["first"],
                "last": r["last"],
                "sample": _clip(f"{r['tool']}: {r['sample'] or ''}"),
                "hint": (
                    "An atlas hook blocked this call before it ran; check the deny "
                    "rule matches intent."
                    if deny
                    else "The tool call errored; repeated errors mean the tool or "
                    "its inputs are broken."
                ),
                "source": "tool_calls.denied" if deny else "tool_calls.is_error",
                "tool": r["tool"],
            }
        )
    return out


def _fold_friction(
    db: _Db, since: float, root: str | None, until: float | None = None
) -> list[dict]:
    """friction_events.gate_block = a completion/dispatch gate refusing work."""
    if not db.has("friction_events"):
        return []
    joined = db.has("session_logs", "projects")
    sel_proj = "COALESCE(p.root_path,'')" if joined else "''"
    join = (
        "LEFT JOIN session_logs s ON s.session_id=f.session_id "
        "LEFT JOIN projects p ON p.id=s.project_id"
        if joined
        else ""
    )
    where = "f.ts>=? AND f.category='gate_block'"
    params: list = [since]
    if until is not None:
        where += " AND f.ts<?"
        params.append(until)
    if root and joined:
        where += " AND p.root_path=?"
        params.append(root)
    sql = (
        f"SELECT {sel_proj} AS proj, COUNT(*) AS n, MIN(f.ts) AS first, "
        f"MAX(f.ts) AS last, MAX(f.snippet) AS sample FROM friction_events f {join} "
        f"WHERE {where} GROUP BY proj"
    )
    return [
        {
            "kind": "gate_block",
            "project": r["proj"],
            "count": r["n"],
            "first": r["first"],
            "last": r["last"],
            "sample": _clip(r["sample"]),
            "hint": "The completion/dispatch gate blocked the turn; satisfy its "
            "condition or fix the rule if it is wrong.",
            "source": "friction_events.gate_block",
        }
        for r in db.dicts(sql, params)
    ]


def _fold_ingest(db: _Db, since: float) -> list[dict]:
    """ingest_files whose cursor never reached the file size = ingest stalled."""
    if not db.has("ingest_files"):
        return []
    rows = db.dicts(
        "SELECT COUNT(*) AS n, MIN(updated_at) AS first, MAX(updated_at) AS last, "
        "MAX(path) AS sample FROM ingest_files "
        "WHERE size IS NOT NULL AND cursor_bytes < size AND updated_at>=?",
        (since,),
    )
    out = []
    for r in rows:
        if r["n"]:
            out.append(
                {
                    "kind": "ingest_stalled",
                    "project": "",
                    "count": r["n"],
                    "first": r["first"],
                    "last": r["last"],
                    "sample": _clip(r["sample"]),
                    "hint": "Transcript ingest stopped before end of file; run "
                    "session_ingest.py to catch up.",
                    "source": "ingest_files.cursor_bytes<size",
                }
            )
    return out


def _fold_doctor_regressions(db: _Db) -> list[dict]:
    """A fix that regressed: findings marked 'regressed' (atlas_doctor
    --set-status) or improvements whose remeasure verdict is 'regressed'.
    Both are persisted, unlike miner crashes (mine() only returns those)."""
    out = []
    if db.has("findings"):
        for r in db.dicts(
            "SELECT COUNT(*) AS n, MIN(created_at) AS first, "
            "MAX(COALESCE(decided_at,applied_at,created_at)) AS last, "
            "MAX(title) AS sample FROM findings WHERE status='regressed'"
        ):
            if r["n"]:
                out.append(
                    {
                        "kind": "doctor_regression",
                        "project": "",
                        "count": r["n"],
                        "first": r["first"],
                        "last": r["last"],
                        "sample": _clip(r["sample"]),
                        "hint": "An applied fix stopped holding; re-open the finding "
                        "and re-run atlas_doctor.py --mine.",
                        "source": "findings.status=regressed",
                    }
                )
    if db.has("improvements") and "verdict" in db.cols("improvements"):
        for r in db.dicts(
            "SELECT COUNT(*) AS n, MIN(ts) AS first, MAX(COALESCE(remeasured_at,ts)) AS last, "
            "MAX(metric) AS sample FROM improvements WHERE verdict='regressed'"
        ):
            if r["n"]:
                out.append(
                    {
                        "kind": "doctor_regression",
                        "project": "",
                        "count": r["n"],
                        "first": r["first"],
                        "last": r["last"],
                        "sample": _clip(r["sample"]),
                        "hint": "Remeasure says this metric got worse after the fix.",
                        "source": "improvements.verdict=regressed",
                    }
                )
    return out


_TRACE_RE = re.compile(
    r"^(Traceback \(most recent call last\)|\w*(Error|Exception)\b.*)"
)


def _fold_dashboard_log(since: float, tail_bytes: int = 262144) -> list[dict]:
    """Python errors in dashboard.log (the daemon's stderr). The access-log
    lines are not failures; only Traceback / *Error lines count."""
    p = DASHBOARD_LOG
    try:
        st = p.stat()
        if st.st_mtime < since:
            return []
        with open(p, "rb") as f:
            if st.st_size > tail_bytes:
                f.seek(st.st_size - tail_bytes)
            text = f.read().decode("utf-8", "replace")
    except OSError:
        return []
    kinds: dict[str, int] = {}
    for ln in text.splitlines():
        if not _TRACE_RE.match(ln) or ln.startswith("Traceback"):
            continue  # the *Error line that follows a Traceback carries the cause
        kinds[ln[:160]] = kinds.get(ln[:160], 0) + 1
    if not kinds:
        return []
    top = max(kinds.items(), key=lambda kv: kv[1])[0]
    return [
        {
            "kind": "dashboard_error",
            "project": "",
            "count": sum(kinds.values()),
            "first": st.st_mtime,
            "last": st.st_mtime,
            "sample": _clip(top),
            "hint": "The dashboard daemon logged a Python error; see ~/.atlas/dashboard.log.",
            "source": "dashboard.log",
        }
    ]


def _hookstate_scan(now: float) -> dict:
    """One pass over hookstate/*.json: per-hook last_run and burst-tripped
    sessions (>= STOP_BURST_LIMIT Stop events inside STOP_BURST_WINDOW)."""
    out = {"sessions": 0, "last_run": {}, "bursts": [], "newest": None}
    try:
        files = glob.glob(str(HOOKSTATE_DIR / "*.json"))
    except OSError:
        return out
    for f in files:
        try:
            with open(f) as fh:
                st = json.load(fh)
        except (OSError, ValueError):
            continue
        out["sessions"] += 1
        for hook, ts in (st.get("last_run") or {}).items():
            try:
                if ts > out["last_run"].get(hook, 0):
                    out["last_run"][hook] = ts
            except TypeError:
                continue
        ev = sorted(
            t for t in (st.get("stop_events") or []) if isinstance(t, (int, float))
        )
        if (
            len(ev) >= STOP_BURST_LIMIT
            and ev[-1] - ev[-STOP_BURST_LIMIT] <= STOP_BURST_WINDOW
        ):
            out["bursts"].append((os.path.basename(f)[:-5], ev[-1]))
    return out


def _fold_hook_burst(scan: dict, since: float) -> list[dict]:
    recent = [(sid, ts) for sid, ts in scan["bursts"] if ts >= since]
    if not recent:
        return []
    return [
        {
            "kind": "hook_burst_tripped",
            "project": "",
            "count": len(recent),
            "first": min(t for _, t in recent),
            "last": max(t for _, t in recent),
            "sample": f"session {recent[0][0][:12]}: Stop fired >= {STOP_BURST_LIMIT}x in {STOP_BURST_WINDOW}s",
            "hint": "The Stop-hook circuit breaker tripped; the hook chain is "
            "thrashing and was silenced for that session.",
            "source": "hookstate.stop_events",
        }
    ]


def _fold_dispatch_stale(db: _Db, since: float, root: str | None) -> list[dict]:
    """dispatches rows with an empty agent_type = a dispatch the hook could not
    classify (the recorded failure mode of a broken PreToolUse payload)."""
    if not db.has("dispatches", "runs", "projects"):
        return []
    params: list = [since]
    where = "d.ts>=? AND COALESCE(d.agent_type,'')=''"
    if root:
        where += " AND p.root_path=?"
        params.append(root)
    sql = (
        "SELECT COALESCE(p.root_path,'') AS proj, COUNT(*) AS n, MIN(d.ts) AS first, "
        "MAX(d.ts) AS last FROM dispatches d JOIN runs r ON r.id=d.run_id "
        "LEFT JOIN projects p ON p.id=r.project_id "
        f"WHERE {where} GROUP BY proj"
    )
    return [
        {
            "kind": "dispatch_unclassified",
            "project": r["proj"],
            "count": r["n"],
            "first": r["first"],
            "last": r["last"],
            "sample": "dispatch recorded with empty agent_type",
            "hint": "Subagent dispatches are not being typed; check the dispatch hook payload.",
            "source": "dispatches.agent_type=''",
        }
        for r in db.dicts(sql, params)
    ]


def _fold_agents_failed(db: _Db, since: float, root: str | None) -> list[dict]:
    """Colony agents that failed/stalled. Colony state lives in board notes;
    here we use the recorded worker runs that never ended."""
    if not db.has("runs", "projects") or "kind" not in db.cols("runs"):
        return []
    params: list = [since, since]
    where = "r.kind='worker' AND r.started_at>=? AND r.ended_at IS NULL AND r.started_at<?-3600"
    if root:
        where += " AND p.root_path=?"
        params.append(root)
    sql = (
        "SELECT COALESCE(p.root_path,'') AS proj, COUNT(*) AS n, MIN(r.started_at) AS first, "
        "MAX(r.started_at) AS last, MAX(r.task_summary) AS sample FROM runs r "
        f"LEFT JOIN projects p ON p.id=r.project_id WHERE {where} GROUP BY proj"
    )
    # second param is "now" for the staleness cut: reuse `since` upper bound via time
    params[1] = time.time()
    return [
        {
            "kind": "agent_stuck",
            "project": r["proj"],
            "count": r["n"],
            "first": r["first"],
            "last": r["last"],
            "sample": _clip(r["sample"] or "worker run never closed"),
            "hint": "A worker run started over an hour ago and never ended; it is "
            "stuck or died without reporting.",
            "source": "runs.kind=worker,ended_at IS NULL",
        }
        for r in db.dicts(sql, params)
    ]


# Policy enforcement is the system working as designed (a hook or gate refusing
# a call), not a failure: it is collected into its own stream, never counted in
# silent_failures, project failures_7d, attention or the silent-failures KPI.
ENFORCEMENT_KINDS = ("gate_deny", "gate_block")


def _collect_events(
    db: _Db, since: float, root: str | None, now: float
) -> tuple[list[dict], list[dict], dict]:
    """One pass over every source, partitioned into (failures, enforcement, scan)."""
    scan = _hookstate_scan(now)
    items: list[dict] = []
    items += _fold_tool_calls(db, since, root)
    items += _fold_friction(db, since, root)
    items += _fold_dispatch_stale(db, since, root)
    items += _fold_agents_failed(db, since, root)
    if root is None:  # machine-wide sources only in the cross-project view
        items += _fold_ingest(db, since)
        items += _fold_doctor_regressions(db)
        items += _fold_dashboard_log(since)
        items += _fold_hook_burst(scan, since)
    failures: list[dict] = []
    enforcement: list[dict] = []
    for it in items:
        key = f"{it['kind']}|{it['project']}|{it.get('tool', '')}|{it['source']}"
        it["id"] = hashlib.sha1(key.encode()).hexdigest()[:12]
        it["first"] = _iso(it["first"])
        it["last"] = _iso(it["last"])
        (enforcement if it["kind"] in ENFORCEMENT_KINDS else failures).append(it)
    for it in failures:
        it.pop("tool", None)
    failures.sort(key=lambda x: (-x["count"], x["kind"]))
    return failures, enforcement, scan


def _enforcement_summary(items: list[dict]) -> dict:
    """Counts, top rules and per-project totals for the enforcement stream.
    A rule is the denied tool (gate_deny) or the gate that blocked (gate_block)."""
    counts = dict.fromkeys(ENFORCEMENT_KINDS, 0)
    rules: dict[tuple[str, str], dict] = {}
    projects: dict[str, int] = {}
    for it in items:
        counts[it["kind"]] = counts.get(it["kind"], 0) + it["count"]
        projects[it["project"]] = projects.get(it["project"], 0) + it["count"]
        rule = it.get("tool") or it["kind"]
        b = rules.setdefault(
            (it["kind"], rule),
            {
                "rule": rule,
                "kind": it["kind"],
                "count": 0,
                "last": None,
                "sample": it["sample"],
                "hint": it["hint"],
            },
        )
        b["count"] += it["count"]
        if it["last"] and (b["last"] is None or it["last"] > b["last"]):
            b["last"] = it["last"]
    top = sorted(rules.values(), key=lambda r: (-r["count"], r["rule"]))
    return {
        "total": sum(counts.values()),
        "counts": counts,
        "top_rules": top[:10],
        "projects": [
            {"project": p, "count": n}
            for p, n in sorted(projects.items(), key=lambda kv: (-kv[1], kv[0]))
        ][:MAX_ITEMS],
        "note": "Policy enforcement working as designed; not a failure.",
    }


def _collect_enforcement(db: _Db, since: float, root: str | None, now: float) -> dict:
    _, enforcement, _ = _collect_events(db, since, root, now)
    return _enforcement_summary(enforcement)


# ----------------------------------------------------------------- health


def _status_from(count: int, fail_at: int, warn_at: int = 1) -> str:
    return "fail" if count >= fail_at else "warn" if count >= warn_at else "ok"


def _health_payload(ctx):
    db = _open(ctx)
    now = time.time()
    win = _window_seconds(_q(ctx, "window", "7d"))
    since = now - win
    root = _project_filter(ctx, db)
    silent, enforcement_items, scan = _collect_events(db, since, root, now)
    enforcement = _enforcement_summary(enforcement_items)
    by_kind: dict[str, int] = {}
    for s in silent:
        by_kind[s["kind"]] = by_kind.get(s["kind"], 0) + s["count"]

    def last_of(kind):
        ls = [s["last"] for s in silent if s["kind"] == kind and s["last"]]
        return max(ls) if ls else None

    def sub(id_, label, status, detail, last_ok=None, last_fail=None, evidence=()):
        return {
            "id": id_,
            "label": label,
            "status": status,
            "detail": detail,
            "last_ok": last_ok,
            "last_fail": last_fail,
            "evidence": [e for e in evidence if e],
        }

    subs = []
    # hooks: hookstate last_run + burst breaker
    bursts = by_kind.get("hook_burst_tripped", 0)
    newest_hook = max(scan["last_run"].values()) if scan["last_run"] else None
    subs.append(
        sub(
            "hooks",
            "Hooks",
            "fail" if bursts else ("ok" if newest_hook else "unknown"),
            f"{scan['sessions']} sessions tracked; {bursts} circuit-breaker trips"
            if scan["sessions"]
            else "no hookstate recorded",
            _iso(newest_hook),
            last_of("hook_burst_tripped"),
            [
                f"{h}: last run {_iso(t)}"
                for h, t in sorted(scan["last_run"].items())[:6]
            ],
        )
    )
    # gate: enforcement is the system working, so this is informational ("ok"),
    # never warn/fail; the counts live in the separate enforcement stream.
    gate_deny_n = enforcement["counts"].get("gate_deny", 0)
    gate_block_n = enforcement["counts"].get("gate_block", 0)
    subs.append(
        sub(
            "gate",
            "Gates & denies",
            "ok" if db.has("tool_calls") else "unknown",
            f"{gate_deny_n} denied calls, {gate_block_n} gate blocks enforced in window",
            None,
            None,
            [
                f"{r['rule']} x{r['count']}: {r['sample']}"
                for r in enforcement["top_rules"]
            ][:4],
        )
    )
    # dispatch
    disp_n = by_kind.get("dispatch_unclassified", 0)
    last_disp = None
    if db.has("dispatches"):
        r = db.rows("SELECT MAX(ts) FROM dispatches")
        last_disp = r[0][0] if r and r[0] else None
    subs.append(
        sub(
            "dispatch",
            "Dispatch",
            "warn" if disp_n else ("ok" if last_disp else "unknown"),
            f"{disp_n} unclassified dispatches" if disp_n else "dispatches recorded",
            _iso(last_disp),
            last_of("dispatch_unclassified"),
            [],
        )
    )
    # mux: stuck workers
    stuck = by_kind.get("agent_stuck", 0)
    subs.append(
        sub(
            "mux",
            "Colony / mux",
            "warn" if stuck else ("ok" if db.has("runs") else "unknown"),
            f"{stuck} worker runs never closed" if stuck else "no stuck worker runs",
            None,
            last_of("agent_stuck"),
            [s["sample"] for s in silent if s["kind"] == "agent_stuck"][:3],
        )
    )
    # dashboard
    dash_n = by_kind.get("dashboard_error", 0)
    try:
        dash_mtime = DASHBOARD_LOG.stat().st_mtime
    except OSError:
        dash_mtime = None
    subs.append(
        sub(
            "dashboard",
            "Dashboard daemon",
            "warn" if dash_n else ("ok" if dash_mtime else "unknown"),
            f"{dash_n} logged errors" if dash_n else "log clean",
            _iso(dash_mtime),
            last_of("dashboard_error"),
            [s["sample"] for s in silent if s["kind"] == "dashboard_error"][:3],
        )
    )
    # db
    size = None
    try:
        size = db.rows("PRAGMA page_count")[0][0] * db.rows("PRAGMA page_size")[0][0]
    except (IndexError, TypeError):
        pass
    subs.append(
        sub(
            "db",
            "Telemetry DB",
            "ok" if db.tables else "fail",
            f"{len(db.tables)} tables" + (f", {size // 1048576} MiB" if size else ""),
            None,
            None,
            [],
        )
    )
    # connectors: same definition Settings shows (credentials on file + tool_calls
    # usage/error rate), supplied by the dashboard; no live test is run here.
    rows = []
    if CONNECTOR_STATUS_PROVIDER is not None:
        try:
            rows = list(CONNECTOR_STATUS_PROVIDER() or [])
        except Exception:
            rows = []
    flagged = [r for r in rows if r.get("health") in ("unconfigured", "degraded")]
    live = [r for r in rows if r.get("health") in ("ok", "idle", "degraded")]
    used = [
        r["usage"]["last_used"] for r in rows if (r.get("usage") or {}).get("last_used")
    ]
    subs.append(
        sub(
            "connectors",
            "Connectors",
            "warn" if flagged else ("ok" if live else "unknown"),
            f"{len(flagged)} of {len(rows)} connectors need attention "
            f"({sum(1 for r in flagged if r['health'] == 'unconfigured')} unconfigured, "
            f"{sum(1 for r in flagged if r['health'] == 'degraded')} degraded)"
            if flagged
            else (
                f"{len(live)} of {len(rows)} connectors configured"
                if rows
                else "connector status unavailable"
            ),
            _iso(max(used)) if used else None,
            None,
            [
                f"{r['name']}: {r['health']}"
                + (
                    f" ({r['usage']['errors']}/{r['usage']['calls']} calls failed)"
                    if r["health"] == "degraded"
                    else ""
                )
                for r in flagged[:6]
            ],
        )
    )
    # memory
    mem = _state_dir() / "memory" / "MEMORY.md"
    try:
        mm = mem.stat().st_mtime
    except OSError:
        mm = None
    subs.append(
        sub(
            "memory",
            "Memory capture",
            "ok" if mm else "unknown",
            "MEMORY.md present" if mm else "no MEMORY.md yet",
            _iso(mm),
            None,
            [],
        )
    )
    # nudge
    nudge_ts = None
    try:
        nudge_ts = float(NUDGE_STAMP.read_text().strip())
    except (OSError, ValueError):
        pass
    subs.append(
        sub(
            "nudge",
            "Nudge",
            "ok" if nudge_ts else "unknown",
            f"throttle {NUDGE_THROTTLE_MIN} min",
            _iso(nudge_ts),
            None,
            [],
        )
    )
    # doctor
    open_f = 0
    if db.has("findings"):
        r = db.rows("SELECT COUNT(*) FROM findings WHERE status='open'")
        open_f = r[0][0] if r else 0
    miner_err = by_kind.get("doctor_miner_error", 0)
    subs.append(
        sub(
            "doctor",
            "Doctor",
            "warn" if miner_err else ("ok" if db.has("findings") else "unknown"),
            f"{open_f} open findings; {miner_err} miner errors",
            None,
            last_of("doctor_miner_error"),
            [],
        )
    )
    # chronicle: ingest
    ing = by_kind.get("ingest_stalled", 0)
    last_ing = None
    if db.has("ingest_files"):
        r = db.rows("SELECT MAX(updated_at) FROM ingest_files")
        last_ing = r[0][0] if r and r[0] else None
    subs.append(
        sub(
            "chronicle",
            "Chronicle ingest",
            "warn" if ing else ("ok" if last_ing else "unknown"),
            f"{ing} transcript files behind" if ing else "ingest caught up",
            _iso(last_ing),
            last_of("ingest_stalled"),
            [],
        )
    )

    successes = _successes(db, since, root)
    return {
        "subsystems": subs,
        "silent_failures": silent,
        "successes": successes,
        "enforcement": enforcement,
    }


def _successes(db: _Db, since: float, root: str | None) -> list[dict]:
    out = []
    if db.has("tool_calls"):
        joined = db.has("session_logs", "projects")
        join = (
            (
                "LEFT JOIN session_logs s ON s.session_id=t.session_id "
                "LEFT JOIN projects p ON p.id=s.project_id"
            )
            if joined
            else ""
        )
        where = "t.ts>=? AND COALESCE(t.is_error,0)=0 AND COALESCE(t.denied,0)=0"
        params: list = [since]
        if root and joined:
            where += " AND p.root_path=?"
            params.append(root)
        r = db.rows(
            f"SELECT COUNT(*), MAX(t.ts) FROM tool_calls t {join} WHERE {where}", params
        )
        if r and r[0][0]:
            out.append(
                {"kind": "tool_calls_ok", "count": r[0][0], "last": _iso(r[0][1])}
            )
    if db.has("dispatches"):
        r = db.rows(
            "SELECT COUNT(*), MAX(ts) FROM dispatches WHERE ts>=? AND COALESCE(agent_type,'')<>''",
            (since,),
        )
        if r and r[0][0]:
            out.append(
                {"kind": "dispatches_ok", "count": r[0][0], "last": _iso(r[0][1])}
            )
    if db.has("findings"):
        r = db.rows(
            "SELECT COUNT(*), MAX(COALESCE(decided_at,applied_at)) FROM findings WHERE status IN ('applied','verified','resolved') AND COALESCE(decided_at,applied_at,created_at)>=?",
            (since,),
        )
        if r and r[0][0]:
            out.append(
                {"kind": "findings_closed", "count": r[0][0], "last": _iso(r[0][1])}
            )
    return out


def route_health(ctx):
    return 200, _health_payload(ctx)


# --------------------------------------------------------------- projects


def _discover_roots(db_roots: dict[str, dict]) -> dict[str, dict]:
    return {r: v for r, v in db_roots.items() if not _is_noise_root(r)}


def _todo_counts(root: str) -> dict:
    """Open/done/blocked todo counts for a project.

    Reuses the Work board's own ``todos_state`` so archived items are skipped the
    same way and the Projects card always agrees with the board. In-progress counts
    as open here (this card has no separate bucket for it).
    """
    from atlas_dash_colony import todos_state

    c = todos_state(root)["counts"]
    return {
        "open": c.get("open", 0) + c.get("in_progress", 0),
        "done": c.get("done", 0),
        "blocked": c.get("blocked", 0),
    }


def _is_fixture_root(root: str) -> bool:
    """Scratch/fixture roots, and deleted projects under the user's home, are hidden.

    Paths outside home are judged by the scratch rules alone, so a stale root is not
    hidden merely because the machine that recorded it is not this one.
    """
    try:
        import atlas_control  # type: ignore

        if atlas_control.is_fixture_project(root, must_exist=False):
            return True
    except Exception:
        pass
    p = str(root or "")
    return p.startswith(os.path.expanduser("~") + os.sep) and not os.path.isdir(p)


def route_projects(ctx):
    db = _open(ctx)
    now = time.time()
    since = now - 7 * 86400
    names = _discover_roots(_project_names(db))
    runs7: dict[str, int] = {}
    last_run: dict[str, float] = {}
    active: dict[str, int] = {}
    if db.has("runs", "projects"):
        for root, n, last in db.rows(
            "SELECT p.root_path, COUNT(*), MAX(r.started_at) FROM runs r "
            "JOIN projects p ON p.id=r.project_id WHERE r.started_at>=? GROUP BY 1",
            (since,),
        ):
            runs7[root], last_run[root] = n, last
        for root, n in db.rows(
            "SELECT p.root_path, COUNT(*) FROM runs r JOIN projects p ON p.id=r.project_id "
            "WHERE r.ended_at IS NULL AND r.started_at>=? GROUP BY 1",
            (now - 3600,),
        ):
            active[root] = n
    fails: dict[str, int] = {}
    enforced: dict[str, int] = {}
    silent, enforcement_items, _ = _collect_events(db, since, None, now)
    for s in silent:
        fails[s["project"]] = fails.get(s["project"], 0) + s["count"]
    for s in enforcement_items:
        enforced[s["project"]] = enforced.get(s["project"], 0) + s["count"]
    open_findings = 0
    if db.has("findings"):
        r = db.rows("SELECT COUNT(*) FROM findings WHERE status='open'")
        open_findings = r[0][0] if r else 0
    ledger_open: dict[str, int] = {}
    for e in _load_ledger(None, list(names)):
        if _ledger_status(e.get("status")) == "open":
            ledger_open[e["_project"]] = ledger_open.get(e["_project"], 0) + 1
    projects = []
    for root, meta in names.items():
        runs = runs7.get(root, 0)
        f = fails.get(root, 0)
        last_ts = max(last_run.get(root) or 0, meta["last_seen"] or 0) or None
        health = "idle" if not runs else "fail" if f >= 25 else "warn" if f else "ok"
        td = _todo_counts(root)
        projects.append(
            {
                "root": root,
                "name": meta["name"],
                "last_active": _iso(last_ts),
                "runs_7d": runs,
                "agents_active": active.get(root, 0),
                "todos": {"open": td["open"], "done": td["done"]},
                "health": health,
                "failures_7d": f,
                "enforcement_7d": enforced.get(root, 0),
                "findings_open": ledger_open.get(root, 0),
            }
        )
    projects = [p for p in projects if p["runs_7d"] and not _is_fixture_root(p["root"])]
    projects.sort(key=lambda p: p["last_active"] or "", reverse=True)
    return 200, {"projects": projects[:MAX_ITEMS], "findings_open": open_findings}


# ---------------------------------------------------------------- overview


def route_overview(ctx):
    db = _open(ctx)
    now = time.time()
    win = _window_seconds(_q(ctx, "window", "7d"))
    since = now - win
    root = _project_filter(ctx, db)
    silent, enforcement_items, scan = _collect_events(db, since, root, now)
    cur_total = sum(s["count"] for s in silent)
    # previous window [since-win, since): only the DB-bounded tool_error fold, so
    # the delta compares like with like (log/ingest/hookstate sources are not
    # windowed) and, like the current window, excludes enforcement.
    prev_total = sum(
        s["count"]
        for s in _fold_tool_calls(db, since - win, root, until=since)
        if s["kind"] not in ENFORCEMENT_KINDS
    )
    cur_bounded = sum(
        s["count"] for s in silent if s["source"] == "tool_calls.is_error"
    )
    prev_silent_n = prev_total

    runs_n = 0
    runs_prev = 0
    if db.has("runs", "projects"):
        where = "AND p.root_path=?" if root else ""
        pa = [since] + ([root] if root else [])
        r = db.rows(
            f"SELECT COUNT(*) FROM runs r JOIN projects p ON p.id=r.project_id WHERE r.started_at>=? {where}",
            pa,
        )
        runs_n = r[0][0] if r else 0
        pb = [since - win, since] + ([root] if root else [])
        r = db.rows(
            f"SELECT COUNT(*) FROM runs r JOIN projects p ON p.id=r.project_id WHERE r.started_at>=? AND r.started_at<? {where}",
            pb,
        )
        runs_prev = r[0][0] if r else 0
    disp_n = 0
    if db.has("dispatches", "runs", "projects"):
        where = "AND p.root_path=?" if root else ""
        pa = [since] + ([root] if root else [])
        r = db.rows(
            f"SELECT COUNT(*) FROM dispatches d JOIN runs r ON r.id=d.run_id JOIN projects p ON p.id=r.project_id WHERE d.ts>=? {where}",
            pa,
        )
        disp_n = r[0][0] if r else 0
    open_f = 0
    if db.has("findings"):
        r = db.rows("SELECT COUNT(*) FROM findings WHERE status='open'")
        open_f = r[0][0] if r else 0

    def delta(cur, prev_):
        return None if not prev_ else round((cur - prev_) / prev_ * 100, 1)

    blocked = 0
    if root:
        blocked = _todo_counts(root)["blocked"]
    kpis = [
        {
            "id": "runs",
            "label": "Runs",
            "value": runs_n,
            "delta": delta(runs_n, runs_prev),
            "status": "ok",
            "hint": "orchestrator and worker runs in window",
        },
        {
            "id": "dispatches",
            "label": "Dispatches",
            "value": disp_n,
            "delta": None,
            "status": "ok",
            "hint": "subagent dispatches in window",
        },
        {
            "id": "silent_failures",
            "label": "Silent failures",
            "value": cur_total,
            "delta": delta(cur_bounded, prev_silent_n),
            "status": "fail" if cur_total >= 100 else "warn" if cur_total else "ok",
            "hint": "errors, denies and stalls that did not surface",
        },
        {
            "id": "findings_open",
            "label": "Open findings",
            "value": open_f,
            "delta": None,
            "status": "warn" if open_f else "ok",
            "hint": "doctor findings awaiting a decision",
        },
    ]
    if root:
        kpis.append(
            {
                "id": "todos_blocked",
                "label": "Blocked todos",
                "value": blocked,
                "delta": None,
                "status": "warn" if blocked else "ok",
                "hint": "todos in blocked state",
            }
        )

    attention = []
    for s in silent[:12]:
        sev = (
            "fail"
            if s["kind"]
            in ("hook_burst_tripped", "dashboard_error", "doctor_miner_error")
            or s["count"] >= 50
            else "warn"
        )
        attention.append(
            {
                "id": s["id"],
                "severity": sev,
                "project": s["project"],
                "title": s["kind"].replace("_", " "),
                "detail": s["sample"],
                "count": s["count"],
                "first": s["first"],
                "last": s["last"],
                "action": {"label": "Open in Health", "target": f"health#{s['id']}"},
            }
        )
    if blocked:
        attention.append(
            {
                "id": "todos-blocked",
                "severity": "warn",
                "project": root or "",
                "title": "blocked todos",
                "detail": f"{blocked} todos are blocked",
                "count": blocked,
                "first": None,
                "last": None,
                "action": {"label": "Open Work", "target": "work#blocked"},
            }
        )
    order = {"fail": 0, "warn": 1, "info": 2}
    attention.sort(key=lambda a: (order[a["severity"]], -a["count"]))

    recent = []
    if db.has("runs", "projects"):
        where = "WHERE p.root_path=?" if root else ""
        recent = [
            {
                "id": r[0],
                "project": r[1],
                "started": _iso(r[2]),
                "ended": _iso(r[3]),
                "task": _clip(r[4], 140),
                "kind": r[5],
                "model": r[6],
            }
            for r in db.rows(
                "SELECT r.id, p.root_path, r.started_at, r.ended_at, r.task_summary, "
                "r.kind, r.model FROM runs r JOIN projects p ON p.id=r.project_id "
                f"{where} ORDER BY r.started_at DESC LIMIT 15",
                ([root] if root else []),
            )
        ]
    return 200, {
        "kpis": kpis,
        "attention": attention,
        "recent_runs": recent,
        "trend": _trend(db, since, root, win),
        "enforcement": _enforcement_summary(enforcement_items),
    }


def _trend(db: _Db, since: float, root: str | None, win: float) -> dict:
    bucket = 86400 if win >= 2 * 86400 else 3600
    labels, runs_series, fail_series = [], {}, {}
    end = int(time.time() // bucket) * bucket
    start = int(since // bucket) * bucket
    for b in range(start, end + bucket, bucket):
        labels.append(_iso(b))
        runs_series[b] = 0
        fail_series[b] = 0
    if db.has("runs", "projects"):
        where = "AND p.root_path=?" if root else ""
        pa = [since] + ([root] if root else [])
        for b, n in db.rows(
            f"SELECT CAST(r.started_at/{bucket} AS INTEGER)*{bucket}, COUNT(*) FROM runs r "
            f"JOIN projects p ON p.id=r.project_id WHERE r.started_at>=? {where} GROUP BY 1",
            pa,
        ):
            if b in runs_series:
                runs_series[b] = n
    if db.has("tool_calls"):
        joined = db.has("session_logs", "projects")
        join = (
            (
                "LEFT JOIN session_logs s ON s.session_id=t.session_id "
                "LEFT JOIN projects p ON p.id=s.project_id"
            )
            if joined
            else ""
        )
        where = "t.ts>=? AND COALESCE(t.is_error,0)=1 AND COALESCE(t.denied,0)=0"
        pa: list = [since]
        if root and joined:
            where += " AND p.root_path=?"
            pa.append(root)
        for b, n in db.rows(
            f"SELECT CAST(t.ts/{bucket} AS INTEGER)*{bucket}, COUNT(*) FROM tool_calls t {join} WHERE {where} GROUP BY 1",
            pa,
        ):
            if b in fail_series:
                fail_series[b] = n
    keys = sorted(runs_series)
    return {
        "labels": labels,
        "series": [
            {"name": "runs", "values": [runs_series[k] for k in keys]},
            {"name": "failures", "values": [fail_series[k] for k in keys]},
        ],
    }


# ---------------------------------------------------------------- activity

_NUM_RE = re.compile(r"\b[0-9a-f]{8,}\b|\d+")


def _norm_title(s: str) -> str:
    return _NUM_RE.sub("#", (s or "").lower()).strip()


def _activity_rows(db: _Db, since: float, root: str | None, limit: int) -> list[dict]:
    """One UNION ALL across the activity sources; the dedupe happens after."""
    parts, params = [], []
    wroot = "AND p.root_path=?" if root else ""
    if db.has("runs", "projects"):
        parts.append(
            "SELECT 'run' AS kind, r.started_at AS ts, COALESCE(p.root_path,'') AS project, "
            "COALESCE(r.kind,'run') AS agent, COALESCE(NULLIF(r.task_summary,''),'(run)') AS title, "
            "COALESCE(r.model,'') AS detail, 'ok' AS status, r.id AS ref "
            f"FROM runs r LEFT JOIN projects p ON p.id=r.project_id WHERE r.started_at>=? {wroot}"
        )
        params += [since] + ([root] if root else [])
    if db.has("dispatches", "runs", "projects"):
        parts.append(
            "SELECT 'dispatch', d.ts, COALESCE(p.root_path,''), COALESCE(NULLIF(d.agent_type,''),'unknown'), "
            "'dispatch ' || COALESCE(NULLIF(d.agent_type,''),'unknown'), COALESCE(d.model,''), "
            "CASE WHEN COALESCE(d.agent_type,'')='' THEN 'warn' ELSE 'ok' END, d.id "
            f"FROM dispatches d JOIN runs r ON r.id=d.run_id LEFT JOIN projects p ON p.id=r.project_id WHERE d.ts>=? {wroot}"
        )
        params += [since] + ([root] if root else [])
    if db.has("tool_calls"):
        joined = db.has("session_logs", "projects")
        join = (
            (
                "LEFT JOIN session_logs s ON s.session_id=t.session_id "
                "LEFT JOIN projects p ON p.id=s.project_id"
            )
            if joined
            else ""
        )
        proj = "COALESCE(p.root_path,'')" if joined else "''"
        parts.append(
            f"SELECT CASE WHEN COALESCE(t.denied,0)=1 THEN 'deny' ELSE 'tool_error' END, t.ts, {proj}, "
            "COALESCE(t.tool_name,'?'), COALESCE(t.tool_name,'?') || ' ' || "
            "CASE WHEN COALESCE(t.denied,0)=1 THEN 'denied' ELSE 'failed' END, "
            "COALESCE(t.input_summary,''), CASE WHEN COALESCE(t.denied,0)=1 THEN 'warn' ELSE 'fail' END, t.id "
            f"FROM tool_calls t {join} WHERE t.ts>=? AND (COALESCE(t.is_error,0)=1 OR COALESCE(t.denied,0)=1) "
            + ("AND p.root_path=?" if root and joined else "")
        )
        params += [since] + ([root] if root and joined else [])
    if db.has("friction_events"):
        joined = db.has("session_logs", "projects")
        join = (
            (
                "LEFT JOIN session_logs s ON s.session_id=f.session_id "
                "LEFT JOIN projects p ON p.id=s.project_id"
            )
            if joined
            else ""
        )
        proj = "COALESCE(p.root_path,'')" if joined else "''"
        parts.append(
            f"SELECT 'friction', f.ts, {proj}, 'friction', COALESCE(f.category,'friction'), "
            "COALESCE(f.snippet,''), 'warn', f.id "
            f"FROM friction_events f {join} WHERE f.ts>=? "
            + ("AND p.root_path=?" if root and joined else "")
        )
        params += [since] + ([root] if root and joined else [])
    if db.has("findings"):
        parts.append(
            "SELECT 'finding', created_at, '', COALESCE(dimension,'doctor'), COALESCE(title,''), "
            "COALESCE(detail,''), CASE WHEN severity IN ('HIGH','high') THEN 'fail' ELSE 'warn' END, id "
            "FROM findings WHERE created_at>=?"
        )
        params += [since]
    if not parts:
        return []
    sql = " UNION ALL ".join(parts) + " ORDER BY ts DESC LIMIT ?"
    params.append(limit * 5)  # over-fetch: duplicates collapse away
    return db.dicts(sql, params)


def route_activity(ctx):
    db = _open(ctx)
    now = time.time()
    root = _project_filter(ctx, db)
    since_raw = _q(ctx, "since", "")
    since = now - 7 * 86400
    if since_raw:
        try:
            since = float(since_raw)
        except ValueError:
            try:
                since = datetime.fromisoformat(
                    since_raw.replace("Z", "+00:00")
                ).timestamp()
            except ValueError:
                pass
    kind = _q(ctx, "kind", "")
    group = _q(ctx, "group", "project")
    if group not in ("project", "kind", "agent"):
        return _err(
            400,
            "bad group",
            f"group must be project|kind|agent, got {group!r}",
            "pass group=project, group=kind or group=agent",
        )
    qtext = _q(ctx, "q", "").lower()
    try:
        limit = max(1, min(int(_q(ctx, "limit", "200") or 200), MAX_ITEMS))
    except ValueError:
        limit = 200
    names = _project_names(db)
    collapse = _prefs_read().get("noise", {}).get("collapse_duplicates", True)
    # collapse keyed on (group-agnostic) identity: kind, project, agent, normalized title, status
    folded: dict[tuple, dict] = {}
    order: list[tuple] = []
    for r in _activity_rows(db, since, root, limit):
        if kind and r["kind"] != kind:
            continue
        hay = f"{r['title']} {r['detail']} {r['agent']}".lower()
        if qtext and qtext not in hay:
            continue
        k = (r["kind"], r["project"], r["agent"], _norm_title(r["title"]), r["status"])
        if not collapse:
            k = k + (r["ref"],)
        if k in folded:
            folded[k]["count"] += 1
            if r["ts"] and (folded[k]["_ts"] is None or r["ts"] > folded[k]["_ts"]):
                folded[k]["_ts"] = r["ts"]
                folded[k]["ts"] = _iso(r["ts"])
            continue
        folded[k] = {
            "id": f"{r['kind']}:{r['ref']}",
            "ts": _iso(r["ts"]),
            "_ts": r["ts"],
            "kind": r["kind"],
            "project": r["project"],
            "agent": r["agent"],
            "title": _clip(r["title"], 160),
            "detail": _clip(r["detail"], 240),
            "status": r["status"],
            "count": 1,
            "ref": {"table": r["kind"], "id": r["ref"]},
        }
        order.append(k)
    items = [folded[k] for k in order][: limit * 2]
    groups: dict[str, dict] = {}
    for it in items:
        key = {"project": it["project"], "kind": it["kind"], "agent": it["agent"]}[
            group
        ]
        label = (
            (names.get(key, {}).get("name") or key or "(none)")
            if group == "project"
            else (key or "(none)")
        )
        g = groups.setdefault(
            key, {"key": key, "label": label, "count": 0, "last": None, "items": []}
        )
        g["count"] += it["count"]
        if it["_ts"] and (g["last"] is None or it["ts"] > g["last"]):
            g["last"] = it["ts"]
        g["items"].append(it)
    for g in groups.values():
        for it in g["items"]:
            it.pop("_ts", None)
    out = sorted(groups.values(), key=lambda g: g["last"] or "", reverse=True)
    return 200, {"groups": out}


# ----------------------------------------------------------------- improve


_SEV_MAP = {
    "critical": "fail",
    "blocker": "fail",
    "high": "fail",
    "major": "fail",
    "med": "warn",
    "medium": "warn",
    "moderate": "warn",
    "low": "info",
    "minor": "info",
    "info": "info",
    "informational": "info",
    "trivial": "info",
    "warn": "warn",
    "fail": "fail",
}


def _sev(s) -> str:
    s = str(s or "").strip().lower()
    return _SEV_MAP.get(s, s or "info")


# Doctor findings live in findings.status (TEXT, no CHECK). `wontfix` is stored
# as its own value so a refresh never folds it back into dismissed; the doctor's
# upsert never overwrites status on re-mine.
_DB_STATUS_TO_CONTRACT = {
    "open": "open",
    "accepted": "accepted",
    "applied": "fixed",
    "verified": "fixed",
    "resolved": "fixed",
    "rejected": "dismissed",
    "regressed": "open",
    "wontfix": "wontfix",
}
_CONTRACT_TO_DB = {
    "open": "open",
    "accepted": "accepted",
    "fixed": "applied",
    "dismissed": "rejected",
    "wontfix": "wontfix",
}
# Ledger verdicts are append-only and free-form; every value maps to an explicit
# status. Unknown or missing never degrades to "open" (that hid unverified work).
_LEDGER_STATUS = {
    "verified": "fixed",
    "rejected": "dismissed",
    "wontfix": "wontfix",
    "needs-evidence": "open",
    "needs-verification": "open",
    "open": "open",
    "partial": "partial",
    "partially_verified": "partial",
    "partially-verified": "partial",
    "unverified": "unverified",
    "superseded": "superseded",
    "refuted": "refuted",
    "refuted-as-shared-factor": "refuted",
}


def _ledger_status(raw) -> str:
    key = str(raw or "").strip().lower()
    if key in _LEDGER_STATUS:
        return _LEDGER_STATUS[key]
    if key.startswith("refuted"):
        return "refuted"
    return "unverified"


def _ledger_when(e: dict) -> str | None:
    """ISO timestamp from the first populated of verifiedAt/verified_at/ts/date."""
    for k in ("verified_at", "verifiedAt", "ts", "date"):
        v = e.get(k)
        if v in (None, ""):
            continue
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return _iso(v / 1000.0 if v > 1e11 else v)
        s = str(v).strip()
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
            s += "T00:00:00+00:00"
        return s
    return None


def _ledger_evidence_text(ev) -> str:
    if isinstance(ev, list):
        parts = []
        for x in ev:
            if isinstance(x, dict):
                parts.append(
                    str(x.get("claim") or x.get("value") or x.get("source") or "")
                )
            else:
                parts.append(str(x))
        return "; ".join(p for p in parts if p)
    if isinstance(ev, dict):
        return str(ev.get("claim") or ev.get("value") or "")
    return str(ev or "")


def _ledger_row(e: dict, seen: set[str]) -> dict:
    """One ledger entry as a finding row: stable unique id, title/time/detail
    fallbacks, explicit status. `_file`/`_index` come from `_load_ledger`."""
    raw_id = str(e.get("id") or "").strip()
    digest = hashlib.sha1(
        f"{e.get('_file', '')}|{e.get('_index', 0)}".encode(), usedforsecurity=False
    ).hexdigest()
    fid = f"ledger:{raw_id}" if raw_id else f"ledger:{digest[:12]}"
    if fid in seen:
        fid = f"{fid}~{digest[:6]}"
    seen.add(fid)
    evidence = _ledger_evidence_text(e.get("evidence"))
    claim = str(e.get("claim") or "").strip()
    summary = str(e.get("summary") or e.get("note") or "").strip()
    notes = e.get("notes")
    notes = (
        "; ".join(str(n) for n in notes)
        if isinstance(notes, list)
        else str(notes or "")
    ).strip()
    title = (
        str(e.get("title") or "").strip()
        or claim
        or str(e.get("task") or e.get("name") or e.get("subject") or "").strip()
        or summary
        or str(e.get("area") or e.get("stage") or "").strip()
        or evidence
        or raw_id
        or str(e.get("verdict") or "").strip()
    )
    when, time_source = _ledger_when(e), "entry"
    if when is None:
        # No timestamp in the entry: the ledger file's mtime is the last time
        # this row could have been written. Marked so the UI never presents it
        # as a verification time.
        try:
            when, time_source = _iso(os.path.getmtime(e["_file"])), "file"
        except (KeyError, OSError):
            time_source = None
    headline = claim or summary or evidence
    extra = [x for x in (summary, evidence, notes) if x and x != headline]
    rule = e.get("category") or e.get("surface") or "ledger"
    return {
        "id": fid,
        "source": "ledger",
        "kind": "ledger",
        "actionable": False,
        "project": e.get("_project", ""),
        "title": _clip(title, 240),
        "severity": _sev(e.get("severity")),
        "status": _ledger_status(e.get("status")),
        "first": when,
        "last": when,
        "time_source": time_source,
        "evidence": _clip(headline, 300),
        "detail": _clip(" — ".join(extra), 600) if extra else "",
        "verifier": e.get("verified_by") or e.get("verifier"),
        "verdict": e.get("verdict") if isinstance(e.get("verdict"), str) else None,
        "baseline": None,
        "current": None,
        "rule": rule,
    }


def _ledger_sort_key(e: dict) -> tuple:
    """Chronological UTC order. Rows whose time is only the ledger file's mtime
    are not verification times, so they sort before every really-dated row."""
    real = e.get("time_source") == "entry"
    epoch = 0.0
    raw = str(e.get("time") or "")
    if raw:
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            epoch = dt.timestamp()
        except ValueError:
            epoch = 0.0
    return (real, epoch)


# Judgments whose stored value is better when it goes UP. literal_ask_delivered
# stores the probability the ask was delivered (the doctor's "hit" is low); every
# other judgment is a failure rate/count where lower is better.
_HIGHER_IS_BETTER_JUDGMENTS = {"literal_ask_delivered", "header_present"}
# Mirrors atlas_doctor.HIGHER_IS_BETTER_METRICS (kept literal: doctor import is optional).
_HIGHER_IS_BETTER_METRICS = {"verifier_coverage"}


def _direction_trend(baseline, current, higher_is_better=False) -> str | None:
    """improved|regressed|flat|None for baseline -> current, direction-aware."""
    try:
        b, c = float(baseline), float(current)
    except (TypeError, ValueError):
        return None
    if b == c:
        return "flat"
    return "improved" if (c > b) == bool(higher_is_better) else "regressed"


def _ledger_path(root: str | None) -> list[Path]:
    if root:
        return [Path(root) / ".atlas" / ".run" / "findings.json"]
    return []


def _load_ledger(root: str | None, roots: list[str]) -> list[dict]:
    paths = (
        _ledger_path(root)
        if root
        else [Path(r) / ".atlas" / ".run" / "findings.json" for r in roots]
    )
    out = []
    for p in paths:
        if not p.is_file():
            continue
        try:
            if atlas_finding is not None:
                entries = atlas_finding.load(p)
            else:
                data = json.loads(p.read_text(encoding="utf-8"))
                entries = (
                    data if isinstance(data, list) else (data.get("findings") or [])
                )
        except Exception:
            continue
        project = str(p.parent.parent.parent)
        for i, e in enumerate(entries):
            if isinstance(e, dict):
                e = dict(e)
                e["_project"] = project
                e["_file"] = str(p)
                e["_index"] = i
                out.append(e)
    return out


def _lessons(root: str | None, roots: list[str]) -> list[dict]:
    """docs/lessons/*.md of the selected project, or of every project when
    `root` is None. Agent worktrees mirror their parent's lessons, so they are
    skipped in the cross-project view."""
    if root:
        dirs = [Path(root)]
    else:
        dirs = [Path(r) for r in roots if "/.claude/worktrees/" not in r]
    out = []
    for d in dirs:
        for f in sorted(glob.glob(str(d / "docs" / "lessons" / "*.md"))):
            if f.endswith("README.md"):
                continue
            try:
                head = (
                    Path(f)
                    .read_text(encoding="utf-8", errors="replace")
                    .splitlines()[:1]
                )
            except OSError:
                continue
            title = head[0].lstrip("# ").strip() if head else os.path.basename(f)
            out.append(
                {
                    "project": str(d),
                    "project_name": d.name,
                    "title": title,
                    "path": f,
                    "date": _iso(os.path.getmtime(f)),
                }
            )
    out.sort(key=lambda x: x["date"] or "", reverse=True)
    return out[:50]


def _nudges() -> dict:
    """Nudge activity from hookstate (`last_run.nudge` per session). The legacy
    `.atlas_nudge` stamp is only a fallback: nothing writes it any more."""
    recent = []
    try:
        files = sorted(
            glob.glob(str(HOOKSTATE_DIR / "*.json")), key=os.path.getmtime, reverse=True
        )[:400]
    except OSError:
        files = []
    for f in files:
        try:
            with open(f, encoding="utf-8") as fh:
                st = json.load(fh)
        except (OSError, ValueError):
            continue
        lr = (st.get("last_run") or {}).get("nudge") if isinstance(st, dict) else None
        if lr:
            recent.append(
                {
                    "session": os.path.basename(f)[:-5][:12],
                    "ts": _iso(lr),
                    "emitted": len(st.get("emitted") or []),
                }
            )
    recent.sort(key=lambda x: x["ts"] or "", reverse=True)
    last, source = (recent[0]["ts"], "hookstate") if recent else (None, None)
    if last is None:
        try:
            last = _iso(float(NUDGE_STAMP.read_text().strip()))
            source = "stamp" if last else None
        except (OSError, ValueError):
            pass
    return {
        "last": last,
        "source": source,
        "throttle_min": NUDGE_THROTTLE_MIN,
        "sessions_nudged": len(recent),
        "recent": recent[:10],
    }


def _improvement_rows(db: _Db) -> list[dict]:
    """Every improvement with its direction-aware verdict/trend (newest first)."""
    if not db.has("improvements"):
        return []
    cols = db.cols("improvements")
    if "id" not in cols:
        return []

    def col(name):  # a fixed literal list; `NULL AS x` covers older schemas
        return name if name in cols else f"NULL AS {name}"

    titles: dict[int, str] = {}
    if db.has("findings"):
        titles = {r[0]: r[1] for r in db.rows("SELECT id, title FROM findings") if r[1]}
    out = []
    for r in db.dicts(
        "SELECT id, "
        + ", ".join(
            col(c)
            for c in (
                "ts",
                "dimension",
                "finding_id",
                "metric",
                "baseline_value",
                "target_value",
                "remeasured_value",
                "remeasured_at",
                "verdict",
                "note",
            )
        )
        + " FROM improvements ORDER BY id DESC LIMIT 200"
    ):
        higher = (r.get("metric") or "") in _HIGHER_IS_BETTER_METRICS
        out.append(
            {
                "id": r["id"],
                "finding_id": r.get("finding_id"),
                "title": titles.get(r.get("finding_id") or -1)
                or r.get("dimension")
                or "",
                "dimension": r.get("dimension"),
                "metric": r.get("metric"),
                "baseline": r.get("baseline_value"),
                "target": r.get("target_value"),
                "current": r.get("remeasured_value"),
                "verdict": r.get("verdict") or "pending",
                "trend": _direction_trend(
                    r.get("baseline_value"), r.get("remeasured_value"), higher
                ),
                "higher_is_better": higher,
                "ts": _iso(r.get("ts")),
                "remeasured_at": _iso(r.get("remeasured_at")),
                "note": _clip(r.get("note"), 200),
            }
        )
    return out


def _asset_verdict_summary(db: _Db, root: str | None) -> dict:
    """Skill/agent placement verdicts and plugin health from asset_verdicts."""
    empty = {"total": 0, "by_kind": [], "applied": 0, "restored": 0, "recent": []}
    if not db.has("asset_verdicts"):
        return empty
    pid = None
    if root:
        pid = _project_names(db).get(root, {}).get("id")
        if pid is None:
            return empty
    kinds: dict[str, dict] = {}
    for kind, verdict, n, applied, restored in db.rows(
        "SELECT kind, verdict, COUNT(*), SUM(applied), SUM(restored) "
        "FROM asset_verdicts WHERE (? IS NULL OR project_id=?) GROUP BY kind, verdict",
        (pid, pid),
    ):
        k = kinds.setdefault(
            kind or "(none)",
            {
                "kind": kind or "(none)",
                "count": 0,
                "applied": 0,
                "restored": 0,
                "verdicts": {},
            },
        )
        k["count"] += n
        k["applied"] += applied or 0
        k["restored"] += restored or 0
        k["verdicts"][verdict or "(none)"] = n
    by_kind = sorted(kinds.values(), key=lambda k: -k["count"])
    recent = [
        {
            "kind": kind,
            "key": key,
            "verdict": verdict,
            "applied": bool(applied),
            "restored": bool(restored),
            "ts": _iso(ts),
        }
        for ts, kind, key, verdict, applied, restored in db.rows(
            "SELECT ts, kind, key, verdict, applied, restored "
            "FROM asset_verdicts WHERE (? IS NULL OR project_id=?) "
            "ORDER BY ts DESC LIMIT 12",
            (pid, pid),
        )
    ]
    return {
        "total": sum(k["count"] for k in by_kind),
        "by_kind": by_kind,
        "applied": sum(k["applied"] for k in by_kind),
        "restored": sum(k["restored"] for k in by_kind),
        "recent": recent,
    }


def _score_series(db: _Db, now: float, days: int = 14) -> tuple[list, list]:
    """Daily average per judgment, each with its own 0-1 normalisation and a
    good direction so unlike scales (reply_chars vs rates) never share an axis."""
    if not db.has("turn_scores"):
        return [], []
    bucket = 86400
    rows = db.rows(
        "SELECT CAST(ts/? AS INTEGER)*?, judgment, AVG(value), COUNT(*) "
        "FROM turn_scores WHERE ts>=? AND value IS NOT NULL GROUP BY 1, 2 ORDER BY 1",
        (bucket, bucket, now - days * 86400),
    )
    day_list = sorted({r[0] for r in rows})
    labels = [_iso(d) for d in day_list]
    idx = {(r[0], r[1]): (r[2], r[3]) for r in rows}
    series = []
    for j in sorted({r[1] for r in rows}):
        vals = [idx[(d, j)][0] if (d, j) in idx else None for d in day_list]
        pts = [v for v in vals if v is not None]
        lo, hi = min(pts), max(pts)
        span = hi - lo
        higher = j in _HIGHER_IS_BETTER_JUDGMENTS
        series.append(
            {
                "name": j,
                "values": vals,
                "norm": [
                    None if v is None else (0.5 if span == 0 else (v - lo) / span)
                    for v in vals
                ],
                "direction": "up" if higher else "down",
                "min": lo,
                "max": hi,
                "first": pts[0],
                "latest": pts[-1],
                "samples": sum(idx[(d, j)][1] for d in day_list if (d, j) in idx),
                "trend": _direction_trend(pts[0], pts[-1], higher),
            }
        )
    return labels, series


def route_improve(ctx):
    db = _open(ctx)
    now = time.time()
    root = _project_filter(ctx, db)
    roots = list(_discover_roots(_project_names(db)))[:200]
    findings = []
    doctor_n = {"open": 0, "accepted": 0, "fixed": 0}
    by_rule: dict[str, dict] = {}
    improvements = _improvement_rows(db)
    improv: dict[int, dict] = {}
    for im in reversed(improvements):  # oldest first -> latest wins
        if im["finding_id"] is not None:
            improv[im["finding_id"]] = im

    def bucket_for(rule):
        return by_rule.setdefault(
            rule,
            {
                "rule": rule,
                "count": 0,
                "open": 0,
                "doctor": 0,
                "ledger": 0,
                "projects": [],
                "baseline": None,
                "current": None,
                "trend": None,
                "verdict": None,
            },
        )

    names_meta = _project_names(db)
    name_to_root: dict[str, str] = {}
    _ambiguous: set[str] = set()
    for _root, _meta in names_meta.items():
        if _is_noise_root(_root):
            continue
        n = _meta["name"]
        if n in name_to_root:
            _ambiguous.add(n)
        name_to_root[n] = _root
    for n in _ambiguous:
        name_to_root.pop(n, None)
    if db.has("findings"):
        for r in db.dicts(
            "SELECT id, created_at, dimension, severity, title, detail, evidence_json, "
            "proposed_action, target_path, status, decided_at, applied_at, fingerprint "
            "FROM findings ORDER BY id DESC LIMIT 400"
        ):
            status = _DB_STATUS_TO_CONTRACT.get(r["status"], "open")
            rule = (r["fingerprint"] or "").split(":", 1)[0] or (r["dimension"] or "")
            try:
                ev = json.loads(r["evidence_json"] or "{}")
            except ValueError:
                ev = {}
            if not isinstance(ev, dict):
                ev = {}
            im = improv.get(r["id"]) or {}
            baseline = im.get("baseline")
            current = im.get("current")
            if current is None:
                current = ev.get("metric_value")
            higher = bool(im.get("higher_is_better"))
            # evidence.project is a bare project name; attribute it only when it
            # maps to exactly one known root, else leave it unattributed.
            pname = str(ev.get("project") or "")
            project = name_to_root.get(pname, "")
            findings.append(
                {
                    "id": f"doctor:{r['id']}",
                    "source": "doctor",
                    "kind": "doctor",
                    "actionable": True,
                    "project": project,
                    "title": r["title"],
                    "severity": _sev(r["severity"]),
                    "status": status,
                    "first": _iso(r["created_at"]),
                    "last": _iso(r["decided_at"] or r["applied_at"] or r["created_at"]),
                    "evidence": _clip(r["detail"], 300),
                    "detail": _clip(r["detail"], 600),
                    "proposed_action": _clip(r["proposed_action"], 300),
                    "baseline": baseline,
                    "current": current,
                    "target": im.get("target"),
                    "metric": im.get("metric"),
                    "verdict": im.get("verdict") if im else None,
                    "trend": _direction_trend(baseline, current, higher),
                    "rule": rule,
                }
            )
            b = bucket_for(rule)
            b["count"] += 1
            b["doctor"] += 1
            if status == "open":
                b["open"] += 1
            if status in doctor_n:
                doctor_n[status] += 1
            if project and project not in b["projects"]:
                b["projects"].append(project)
            # rollup keeps the newest finding that actually has a baseline
            if baseline is not None and b["baseline"] is None:
                b["baseline"], b["current"] = baseline, current
                b["trend"] = _direction_trend(baseline, current, higher)
                b["verdict"] = im.get("verdict")
    ledger = _load_ledger(root, roots)
    ledger_out = []
    seen_ids = {f["id"] for f in findings}
    for e in ledger:
        row = _ledger_row(e, seen_ids)
        findings.append(row)
        b = bucket_for(row["rule"])
        b["count"] += 1
        b["ledger"] += 1
        if row["status"] == "open":
            b["open"] += 1
        if e["_project"] not in b["projects"]:
            b["projects"].append(e["_project"])
        ledger_out.append(
            {
                "id": row["id"],
                "title": row["title"],
                "status": row["status"],
                "severity": row["severity"],
                "time": row["last"],
                "ts": row["last"],
                "time_source": row["time_source"],
                "detail": row["detail"],
                "verdict": row["verdict"],
                "verifier": row["verifier"],
                "rule": row["rule"],
                "project": e["_project"],
            }
        )
    findings = [f for f in findings if not root or f["project"] in ("", root)]
    ledger_out = [e for e in ledger_out if not root or e["project"] == root]
    ledger_out.sort(key=_ledger_sort_key)
    labels, series = _score_series(db, now)
    mined = len(findings)
    remeasured = sum(1 for v in improv.values() if v.get("verdict") != "pending")
    # Propose = doctor work awaiting a fix: undecided (open) plus accepted but
    # not yet applied. Apply = doctor fixes that landed.
    propose_n = doctor_n["open"] + doctor_n["accepted"]
    stages = [
        {
            "id": "observe",
            "label": "Observe",
            "count": _count(db, "friction_events") + _count(db, "signals"),
            "status": "ok",
        },
        {
            "id": "mine",
            "label": "Mine",
            "count": mined,
            "status": "ok" if mined else "warn",
        },
        {
            "id": "propose",
            "label": "Propose",
            "count": propose_n,
            "status": "warn" if propose_n else "ok",
        },
        {"id": "apply", "label": "Apply", "count": doctor_n["fixed"], "status": "ok"},
        {
            "id": "remeasure",
            "label": "Remeasure",
            "count": remeasured,
            "status": "ok" if remeasured else "unknown",
        },
    ]
    verdict_counts = {"improved": 0, "no_change": 0, "regressed": 0, "pending": 0}
    for im in improvements:
        verdict_counts[im["verdict"]] = verdict_counts.get(im["verdict"], 0) + 1
    return 200, {
        "loop": {"stages": stages},
        "findings": findings[:MAX_ITEMS],
        "ledger": ledger_out[-100:],
        "nudges": _nudges(),
        "lessons": _lessons(root, roots),
        "scores": {"labels": labels, "series": series},
        "by_rule": sorted(by_rule.values(), key=lambda b: (-b["open"], -b["count"])),
        "improvements": {"verdicts": verdict_counts, "items": improvements[:40]},
        "asset_verdicts": _asset_verdict_summary(db, root),
        "enforcement": _collect_enforcement(db, now - 7 * 86400, root, now),
    }


def _count(db: _Db, table: str) -> int:
    if not db.has(table):
        return 0
    r = db.rows(f"SELECT COUNT(*) FROM {table}")
    return r[0][0] if r else 0


def route_improve_finding(ctx):
    body = ctx.json() or {}
    fid, status = str(body.get("id") or ""), str(body.get("status") or "")
    if not fid or status not in _CONTRACT_TO_DB:
        return _err(
            400,
            "bad request",
            f"id and status are required; status in {sorted(_CONTRACT_TO_DB)}",
            'POST {"id":"doctor:12","status":"accepted","note":"..."}',
        )
    src, _, raw = fid.partition(":")
    if src != "doctor" or not raw.isdigit():
        return _err(
            400,
            "unsupported finding",
            "only doctor findings have a settable status; "
            "ledger entries are append-only verdicts",
            "use atlas_finding.py to add a verdict",
        )
    db_status = _CONTRACT_TO_DB[status]
    conn = ctx.db()
    if atlas_db is None or not _Db(conn).has("findings"):
        return _err(
            503,
            "findings store unavailable",
            "atlas_db or the findings table is missing",
            "run atlas_doctor.py --mine once",
        )
    if atlas_db.get_finding(conn, int(raw)) is None:
        return _err(
            404,
            "no such finding",
            f"doctor finding {raw} does not exist",
            "refresh Improve",
        )
    ts = time.time()
    # identical semantics to atlas_doctor.main --set-status
    atlas_db.set_finding_status(
        conn,
        int(raw),
        db_status,
        decided_at=ts if db_status in ("accepted", "rejected", "wontfix") else None,
        applied_at=ts if db_status == "applied" else None,
    )
    conn.commit()
    return 200, {
        "ok": True,
        "state": {
            "id": fid,
            "status": status,
            "db_status": db_status,
            "note": _clip(body.get("note"), 400),
        },
        "next": "re-run the doctor to remeasure once the fix has had some runs",
    }


def route_improve_remeasure(ctx):
    body = ctx.json() or {}
    fid = str(body.get("id") or "")
    src, _, raw = fid.partition(":")
    if src != "doctor" or not raw.isdigit():
        return _err(
            400,
            "bad request",
            "id must be a doctor finding id like doctor:12",
            'POST {"id":"doctor:12"}',
        )
    if atlas_doctor is None or atlas_db is None:
        return _err(
            503,
            "doctor unavailable",
            "atlas_doctor could not be imported",
            "run atlas_doctor.py --remeasure from a shell",
        )
    conn = ctx.db()
    finding = atlas_db.get_finding(conn, int(raw))
    if finding is None:
        return _err(
            404,
            "no such finding",
            f"doctor finding {raw} does not exist",
            "refresh Improve",
        )
    value = atlas_doctor.measure_finding_metric(
        conn, finding, root=str(_q(ctx, "project", "")) or None
    )
    if value is None:
        return _err(
            422,
            "cannot measure",
            "the miner behind this finding is unknown or errored",
            "run atlas_doctor.py --mine and check the miner error",
        )
    finding_id = int(raw)
    existing = conn.execute(
        "SELECT id, baseline_value, metric FROM improvements "
        "WHERE finding_id=? ORDER BY id DESC LIMIT 1",
        (finding_id,),
    ).fetchone()
    if existing is None:
        # No baseline yet: the value the miner recorded when it raised the
        # finding is the baseline (same source `atlas_doctor --baseline` uses).
        try:
            ev = json.loads(finding.get("evidence_json") or "{}")
        except ValueError:
            ev = {}
        baseline = ev.get("metric_value") if isinstance(ev, dict) else None
        run = conn.execute("SELECT MAX(id) FROM runs").fetchone()
        if baseline is None or not run or run[0] is None:
            return 200, {
                "ok": True,
                "state": {"id": fid, "current": value, "resolved": value == 0.0},
                "next": "no baseline or run to attach this measurement to; "
                "run atlas_doctor.py --mine then --baseline",
            }
        imp_id = atlas_db.record_improvement(
            conn,
            run[0],
            finding.get("dimension"),
            str(baseline),
            "",
            "recorded by dashboard remeasure",
            finding_id=finding_id,
            metric=(finding.get("fingerprint") or "").split(":", 1)[0] or None,
            baseline_value=baseline,
        )
        base_value, metric = (
            baseline,
            (finding.get("fingerprint") or "").split(":", 1)[0],
        )
    else:
        imp_id, base_value, metric = existing[0], existing[1], existing[2] or ""
    higher = (metric or "") in _HIGHER_IS_BETTER_METRICS
    verdict = {
        "flat": "no_change",
        "improved": "improved",
        "regressed": "regressed",
    }.get(_direction_trend(base_value, value, higher) or "flat", "no_change")
    atlas_db.set_improvement_remeasure(conn, imp_id, value, verdict, time.time())
    return 200, {
        "ok": True,
        "state": {
            "id": fid,
            "current": value,
            "baseline": base_value,
            "verdict": verdict,
            "resolved": value == 0.0,
        },
        "next": "a value of 0 means the miner no longer reproduces this finding",
    }


# ------------------------------------------------------------------- prefs

_ENUMS = {"theme": {"dark", "light", "system"}, "density": {"comfortable", "compact"}}
_LIST_KEYS = (
    "pinned_projects",
    "hidden_projects",
    "muted_kinds",
    "muted_projects",
    "nav_order",
)
_SEVERITIES = {"info", "warn", "fail"}
_PAGE_RE = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")


def _defaults() -> dict:
    return {
        "theme": "dark",
        "density": "comfortable",
        "default_project": "all",
        "pinned_projects": [],
        "hidden_projects": [],
        "muted_kinds": [],
        "muted_projects": [],
        "saved_views": [],
        "nav_order": [],
        "refresh_seconds": 8,
        "noise": {"collapse_duplicates": True, "min_severity": "info"},
    }


def _prefs_read() -> dict:
    prefs = _defaults()
    try:
        data = json.loads(Path(PREFS_PATH).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return prefs
    if isinstance(data, dict):
        try:
            merged, _ = _validate_prefs(data, prefs)
            return merged
        except ValueError:
            return prefs
    return prefs


def _str_list(key, v, maxn=200):
    if (
        not isinstance(v, list)
        or len(v) > maxn
        or not all(isinstance(x, str) and 0 < len(x) <= 1024 for x in v)
    ):
        raise ValueError(f"{key} must be a list of up to {maxn} non-empty strings")
    return list(dict.fromkeys(v))


def _validate_prefs(update: dict, base: dict) -> tuple[dict, list[str]]:
    """Merge `update` onto `base`. Unknown keys and bad values raise ValueError."""
    out = json.loads(json.dumps(base))
    allowed = set(_defaults())
    unknown = sorted(set(update) - allowed)
    if unknown:
        raise ValueError(f"unknown pref key(s): {', '.join(unknown)}")
    changed = []
    for k, v in update.items():
        if k in _ENUMS:
            if v not in _ENUMS[k]:
                raise ValueError(f"{k} must be one of {sorted(_ENUMS[k])}")
            out[k] = v
        elif k == "default_project":
            if (
                not isinstance(v, str)
                or not v
                or len(v) > 1024
                or (v != "all" and not v.startswith("/"))
            ):
                raise ValueError(
                    "default_project must be 'all' or an absolute project root"
                )
            out[k] = v
        elif k in _LIST_KEYS:
            out[k] = _str_list(k, v)
        elif k == "refresh_seconds":
            if isinstance(v, bool) or not isinstance(v, int) or not 2 <= v <= 3600:
                raise ValueError(
                    "refresh_seconds must be an integer between 2 and 3600"
                )
            out[k] = v
        elif k == "noise":
            if not isinstance(v, dict) or set(v) - {
                "collapse_duplicates",
                "min_severity",
            }:
                raise ValueError(
                    "noise accepts only collapse_duplicates and min_severity"
                )
            n = dict(out["noise"])
            if "collapse_duplicates" in v:
                if not isinstance(v["collapse_duplicates"], bool):
                    raise ValueError("noise.collapse_duplicates must be a boolean")
                n["collapse_duplicates"] = v["collapse_duplicates"]
            if "min_severity" in v:
                if v["min_severity"] not in _SEVERITIES:
                    raise ValueError(
                        f"noise.min_severity must be one of {sorted(_SEVERITIES)}"
                    )
                n["min_severity"] = v["min_severity"]
            out[k] = n
        elif k == "saved_views":
            if not isinstance(v, list) or len(v) > 50:
                raise ValueError("saved_views must be a list of up to 50 views")
            views = []
            for sv in v:
                if (
                    not isinstance(sv, dict)
                    or set(sv) - {"id", "name", "page", "params"}
                    or not isinstance(sv.get("id"), str)
                    or not sv["id"]
                    or not isinstance(sv.get("name"), str)
                    or not 0 < len(sv["name"]) <= 80
                    or not isinstance(sv.get("page"), str)
                    or not _PAGE_RE.match(sv["page"])
                    or not isinstance(sv.get("params", {}), dict)
                ):
                    raise ValueError(
                        "each saved view needs id, name (<=80), page and params object"
                    )
                views.append(
                    {
                        "id": sv["id"],
                        "name": sv["name"],
                        "page": sv["page"],
                        "params": {
                            str(a): str(b) for a, b in (sv.get("params") or {}).items()
                        },
                    }
                )
            out[k] = views
        changed.append(k)
    return out, changed


def route_prefs_get(ctx):
    return 200, _prefs_read()


def route_prefs_put(ctx):
    body = ctx.json()
    if not isinstance(body, dict) or not body:
        return _err(
            400,
            "empty prefs update",
            "PUT body must be a JSON object with at least one key",
            'PUT {"theme":"light"}',
        )
    try:
        merged, changed = _validate_prefs(body, _prefs_read())
    except ValueError as e:
        return _err(400, "invalid prefs", str(e), "fix the key or value and resend")
    path = Path(PREFS_PATH)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(
            dir=str(path.parent), prefix=".dashboard-prefs.", suffix=".tmp"
        )
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(merged, f, indent=2)
            f.write("\n")
        os.replace(tmp, path)
    except OSError as e:
        return _err(
            500, "could not save prefs", str(e), f"check write access to {path.parent}"
        )
    return 200, {
        "ok": True,
        "state": merged,
        "prefs": merged,
        "next": f"saved {', '.join(changed)}",
    }


ROUTES = [
    ("GET", r"^/api/v2/projects$", route_projects),
    ("GET", r"^/api/v2/overview$", route_overview),
    ("GET", r"^/api/v2/health$", route_health),
    ("GET", r"^/api/v2/activity$", route_activity),
    ("GET", r"^/api/v2/improve$", route_improve),
    ("POST", r"^/api/v2/improve/finding$", route_improve_finding),
    ("POST", r"^/api/v2/improve/remeasure$", route_improve_remeasure),
    ("GET", r"^/api/v2/prefs$", route_prefs_get),
    ("PUT", r"^/api/v2/prefs$", route_prefs_put),
]
