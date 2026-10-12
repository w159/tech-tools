"""Health page support: swallowed-error collector and hook-fault stream grouping.

The health payload keeps rendering when a data source fails, so each swallow
site calls ``warn(source, message)`` instead of silently defaulting. ``source``
is a subsystem id ("db", "connectors", "hooks", "nudge", "doctor") so the
payload can mark that subsystem "warn". Stdlib only.
"""

from __future__ import annotations

import contextvars
import json
from pathlib import Path

ACTIVE_FAULT_SECS = 30 * 60
_CURRENT: contextvars.ContextVar[list | None] = contextvars.ContextVar(
    "atlas_health_warnings", default=None
)


def start() -> list[dict]:
    """Begin collecting for this request; returns the live list."""
    warnings: list[dict] = []
    _CURRENT.set(warnings)
    return warnings


def warn(source: str, message: str) -> None:
    """Record a swallowed failure. No-op outside a health request."""
    bucket = _CURRENT.get()
    if bucket is None:
        return
    entry = {"source": source, "message": str(message)[:300]}
    if entry not in bucket:
        bucket.append(entry)


def apply_to_subsystems(subs: list[dict], warnings: list[dict]) -> None:
    """A subsystem whose source failed is never 'ok': mark warn and name the source."""
    by_id = {s["id"]: s for s in subs}
    for w in warnings:
        s = by_id.get(w["source"])
        if s is None:
            continue
        # "unknown" (nothing measured) may be a failed source, not an absent one.
        if s["status"] in ("ok", "unknown"):
            s["status"] = "warn"
        s["detail"] = f"{s['detail']}; data source failed: {w['message']}"


def installed_plugin_version() -> str | None:
    p = Path(__file__).resolve().parent.parent / ".claude-plugin" / "plugin.json"
    try:
        return json.loads(p.read_text(encoding="utf-8")).get("version")
    except (OSError, ValueError):
        warn("hooks", f"cannot read {p}")
        return None


def _vkey(v: str) -> tuple:
    return tuple(int(x) if x.isdigit() else 0 for x in str(v).split("."))


def _project_of(cwd: str) -> str:
    return Path(cwd).name if cwd else "unknown"


def group_fault_streams(
    rows: list[dict], now: float, current: str | None
) -> list[dict]:
    """Group fault rows by (hook, plugin_version, cwd project); newest stream first."""
    groups: dict[tuple, dict] = {}
    for r in rows:
        ts = r.get("ts")
        if not isinstance(ts, (int, float)):
            continue
        key = (
            str(r.get("hook") or "?"),
            str(r.get("plugin_version") or "unknown"),
            _project_of(str(r.get("cwd") or "")),
        )
        g = groups.setdefault(
            key,
            {
                "hook": key[0],
                "version": key[1],
                "project": key[2],
                "cwd": str(r.get("cwd") or ""),
                "count": 0,
                "last": ts,
            },
        )
        g["count"] += 1
        g["last"] = max(g["last"], ts)
    out = list(groups.values())
    for g in out:
        g["active"] = now - g["last"] <= ACTIVE_FAULT_SECS
    out.sort(key=lambda g: (not g["active"], -g["count"], -g["last"]))
    for g in out:
        g["stale"] = bool(
            current
            and g["version"] != "unknown"
            and _vkey(g["version"]) < _vkey(current)
        )
    return out


def age_text(seconds: float) -> str:
    m = max(0, int(seconds // 60))
    if m < 60:
        return f"{m} min ago"
    return f"{m // 60} h ago" if m < 2880 else f"{m // 1440} d ago"


def describe_stream(g: dict, now: float) -> str:
    return (
        f"{g['count']} faults from {g['hook']} (plugin {g['version']}, "
        f"project {g['project']}), last seen {age_text(now - g['last'])}; "
        + ("active" if g["active"] else "none since")
    )
