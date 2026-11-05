#!/usr/bin/env python3
"""Publish Atlas telemetry into the repo.

Fetches (or locally aggregates) one ISO week of anonymous usage counts, writes
telemetry/reports/<week>.json and regenerates telemetry/REPORT.md (latest week plus a trend table
over every week in telemetry/reports).

    telemetry_report.py --url https://example.vercel.app [--week 2026-W44]
    telemetry_report.py --from-dir DIR [--week 2026-W44]

--from-dir reads raw submission files (DIR/<week>/<nonce>.json or flat *.json) and applies the same
validation and publish threshold as the server (telemetry/allowed-keys.json). An empty or
unreachable --url exits 0 with a message and changes no files. Standard library only.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TELEMETRY = ROOT / "telemetry"

WEEK_RE = re.compile(r"^\d{4}-W\d{2}$")
NONCE_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
SEMVER_RE = re.compile(r"^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]{1,16})?$")
PYTHON_RE = re.compile(r"^3\.\d{1,2}$")
OS_VALUES = {"linux", "darwin", "windows", "other"}
ENVELOPE = {"schema", "atlas_version", "os", "python", "week", "nonce", "counts"}
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}

Json = dict


def last_finished_week(now: dt.datetime | None = None) -> str:
    now = now or dt.datetime.now(dt.timezone.utc)
    year, week, _ = (now - dt.timedelta(days=7)).isocalendar()
    return f"{year}-W{week:02d}"


def valid_week(week: str) -> bool:
    if not WEEK_RE.match(week):
        return False
    year, wk = int(week[:4]), int(week[-2:])
    try:
        return dt.date.fromisocalendar(year, wk, 1).isocalendar()[:2] == (year, wk)
    except ValueError:
        return False


def load_allowed(telemetry_dir: Path) -> Json:
    return json.loads((telemetry_dir / "allowed-keys.json").read_text(encoding="utf-8"))


# --- local aggregation (mirrors telemetry/server/lib) ----------------------------------------------
def valid_submission(data: object, allowed: Json, week: str) -> bool:
    if not isinstance(data, dict) or set(data) != ENVELOPE:
        return False
    counts = data["counts"]
    ok = (
        data["schema"] == allowed["schema"]
        and isinstance(data["atlas_version"], str) and bool(SEMVER_RE.match(data["atlas_version"]))
        and data["os"] in OS_VALUES
        and isinstance(data["python"], str) and bool(PYTHON_RE.match(data["python"]))
        and data["week"] == week
        and isinstance(data["nonce"], str) and bool(NONCE_RE.match(data["nonce"]))
        and isinstance(counts, dict) and bool(counts)
    )
    if not ok:
        return False
    keys = set(allowed["keys"])
    return all(
        k in keys and type(v) is int and 1 <= v <= allowed["max_count"] for k, v in counts.items()
    )


def _bucket(values: list[str], min_installs: int) -> dict[str, int]:
    tally: dict[str, int] = {}
    for v in values:
        tally[v] = tally.get(v, 0) + 1
    out: dict[str, int] = {}
    other = 0
    for v in sorted(tally):
        if tally[v] >= min_installs and v != "other":
            out[v] = tally[v]
        else:
            other += tally[v]
    if other >= min_installs:
        out["other"] = other
    return out


def aggregate(week: str, subs: list[Json], min_installs: int) -> Json:
    if len(subs) < min_installs:
        return {"week": week, "submissions": len(subs)}
    per_key: dict[str, list[int]] = {}
    for s in subs:
        for k, n in s["counts"].items():
            cur = per_key.setdefault(k, [0, 0])
            cur[0] += 1
            cur[1] += n
    return {
        "week": week,
        "submissions": len(subs),
        "atlas_version": _bucket([s["atlas_version"] for s in subs], min_installs),
        "os": _bucket([s["os"] for s in subs], min_installs),
        "python": _bucket([s["python"] for s in subs], min_installs),
        "counts": {
            k: {"installs": v[0], "total": v[1]}
            for k, v in sorted(per_key.items())
            if v[0] >= min_installs
        },
    }


def aggregate_dir(directory: Path, week: str, allowed: Json) -> Json:
    seen: set[str] = set()
    subs: list[Json] = []
    for path in sorted(directory.rglob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not valid_submission(data, allowed, week) or data["nonce"] in seen:
            continue
        seen.add(data["nonce"])
        subs.append(data)
    return aggregate(week, subs, allowed["min_installs_published"])


# --- fetching --------------------------------------------------------------------------------------
def fetch_aggregate(base: str, week: str) -> Json | None:
    url = f"{base.rstrip('/')}/api/aggregate?week={quote(week)}"
    req = urllib.request.Request(url, headers={"User-Agent": "atlas-telemetry-report/1"})
    try:
        if urlsplit(url).hostname in LOCAL_HOSTS:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            resp = opener.open(req, timeout=15)
        else:
            resp = urllib.request.urlopen(req, timeout=15)
        with resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError) as exc:
        print(f"telemetry endpoint unreachable ({type(exc).__name__}); nothing written")
        return None
    if not isinstance(data, dict) or data.get("week") != week or not isinstance(data.get("submissions"), int):
        print("telemetry endpoint returned an unexpected shape; nothing written")
        return None
    return data


# --- report rendering ------------------------------------------------------------------------------
def _total(counts: Json, key: str) -> int:
    return int(counts.get(key, {}).get("total", 0))


def _sum(counts: Json, pattern: re.Pattern[str]) -> int:
    return sum(v["total"] for k, v in counts.items() if pattern.match(k))


HOOK_DENY = re.compile(r"^hook\.[^.]+\.deny$")
HOOK_ASK = re.compile(r"^hook\.[^.]+\.ask$")
GATE_BLOCK = re.compile(r"^gate\.[^.]+\.block$")


def _top(counts: Json, prefix: str, n: int) -> list[tuple[str, int, int]]:
    rows = [
        (k[len(prefix):], v["total"], v["installs"])
        for k, v in counts.items()
        if k.startswith(prefix)
    ]
    return sorted(rows, key=lambda r: (-r[1], r[0]))[:n]


def _table(headers: list[str], rows: list[list[str]]) -> list[str]:
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join(" --- " for _ in headers) + "|"]
    out += ["| " + " | ".join(r) + " |" for r in rows]
    return out


def _spread(d: Json | None) -> str:
    if not d:
        return "-"
    return ", ".join(f"{k} ({v})" for k, v in sorted(d.items(), key=lambda kv: (-kv[1], kv[0])))


def render_week(rep: Json, min_installs: int) -> list[str]:
    lines = [f"## Latest week: {rep['week']}", ""]
    if "counts" not in rep:
        lines.append(
            f"{rep['submissions']} submission(s). Fewer than {min_installs}, so no details are published."
        )
        return lines
    c = rep["counts"]
    lines += [
        f"- Submissions (install-weeks): {rep['submissions']}",
        f"- Atlas versions: {_spread(rep.get('atlas_version'))}",
        f"- OS: {_spread(rep.get('os'))}",
        f"- Python: {_spread(rep.get('python'))}",
        f"- Hook denies: {_sum(c, HOOK_DENY)}, asks: {_sum(c, HOOK_ASK)}",
        f"- Completion gate: {_sum(c, GATE_BLOCK)} block, {_total(c, 'gate.pass')} pass",
        "- Team outcomes: "
        + ", ".join(f"{o} {_total(c, 'team.outcome.' + o)}" for o in ("done", "failed", "timeout")),
        "",
    ]
    def section(title: str, prefix: str, n: int) -> None:
        rows = _top(c, prefix, n)
        lines.extend([f"### {title}", ""])
        lines.extend(
            _table(["Name", "Uses", "Installs"], [[f"`{a}`", str(b), str(i)] for a, b, i in rows])
            if rows else ["No published data."]
        )
        lines.append("")

    section("Top 15 skills", "skill.", 15)
    section("Top agents", "agent.", 15)
    lat = [(k.split(".")[1] + "." + k.split(".")[3], v) for k, v in c.items() if k.startswith("dispatch.")]
    lines.extend(["### Dispatch latency buckets", ""])
    if lat:
        lines.extend(_table(["Event.bucket", "Calls"], [[f"`{k}`", str(v['total'])] for k, v in sorted(lat)]))
    else:
        lines.append("No published data.")
    slow = sorted(
        ((k.split(".")[1], v["total"]) for k, v in c.items() if re.match(r"^hook\.[^.]+\.slow$", k)),
        key=lambda r: (-r[1], r[0]),
    )[:10]
    lines.extend(["", "### Slow hooks", ""])
    lines.extend(
        _table(["Hook", "Slow runs"], [[f"`{h}`", str(n)] for h, n in slow]) if slow else ["No published data."]
    )
    lines.append("")
    return lines


def render_trend(reports: list[Json]) -> list[str]:
    lines = ["## Trend", ""]
    rows: list[list[str]] = []
    for r in reports:
        c = r.get("counts")
        if c is None:
            rows.append([r["week"], str(r["submissions"])] + ["-"] * 5)
            continue
        versions = r.get("atlas_version", {})
        top_v = max(versions.items(), key=lambda kv: (kv[1], kv[0]))[0] if versions else "-"
        rows.append([
            r["week"],
            str(r["submissions"]),
            f"{top_v} ({len(versions)} bucket{'s' if len(versions) != 1 else ''})",
            f"{_sum(c, HOOK_DENY)} / {_sum(c, HOOK_ASK)}",
            f"{_sum(c, GATE_BLOCK)} / {_total(c, 'gate.pass')}",
            " / ".join(str(_total(c, "team.outcome." + o)) for o in ("done", "failed", "timeout")),
            ", ".join(f"{n} {t}" for n, t, _ in _top(c, "skill.", 3)) or "-",
        ])
    lines.extend(_table(
        ["Week", "Submissions", "Top version", "Hook deny / ask", "Gate block / pass",
         "Team done / failed / timeout", "Top 3 skills"],
        rows,
    ))
    lines.append("")
    return lines


def load_reports(reports_dir: Path) -> list[Json]:
    out: list[Json] = []
    for path in sorted(reports_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(data, dict) and valid_week(str(data.get("week", ""))):
            out.append(data)
    return sorted(out, key=lambda r: r["week"])


EMPTY_REPORT = (
    "# Atlas telemetry report\n\n"
    "No telemetry has been published yet. This file is regenerated weekly by "
    "`scripts/telemetry_report.py` from anonymous, aggregated usage counts. A key appears only "
    "once at least 3 installs reported it in the same week.\n"
)


def render_report(reports: list[Json], min_installs: int) -> str:
    if not reports:
        return EMPTY_REPORT
    lines = [
        "# Atlas telemetry report",
        "",
        "Anonymous usage counts, aggregated per ISO week. A key, version, OS or Python bucket is "
        f"published only when at least {min_installs} installs reported it. Generated by "
        "`scripts/telemetry_report.py`; do not edit by hand.",
        "",
    ]
    lines += render_week(reports[-1], min_installs)
    lines += render_trend(list(reversed(reports)))
    return "\n".join(lines).rstrip() + "\n"


def write_if_changed(path: Path, text: str) -> bool:
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return True


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--url", help="base URL of the telemetry server; empty means skip")
    src.add_argument("--from-dir", type=Path, help="directory of raw submission JSON files")
    p.add_argument("--week", help="ISO week like 2026-W44 (default: last finished week)")
    p.add_argument("--telemetry-dir", type=Path, default=DEFAULT_TELEMETRY, help=argparse.SUPPRESS)
    args = p.parse_args(argv)

    week = args.week or last_finished_week()
    if not valid_week(week):
        print(f"invalid --week: {week}", file=sys.stderr)
        return 2
    tdir: Path = args.telemetry_dir
    allowed = load_allowed(tdir)

    if args.from_dir is not None:
        if not args.from_dir.is_dir():
            print(f"--from-dir is not a directory: {args.from_dir}", file=sys.stderr)
            return 2
        rep = aggregate_dir(args.from_dir, week, allowed)
    else:
        if not (args.url or "").strip():
            print("no telemetry URL configured (--url is empty); nothing to do")
            return 0
        fetched = fetch_aggregate(args.url.strip(), week)
        if fetched is None:
            return 0
        rep = fetched

    changed = write_if_changed(
        tdir / "reports" / f"{week}.json", json.dumps(rep, indent=2, sort_keys=True) + "\n"
    )
    report = render_report(load_reports(tdir / "reports"), allowed["min_installs_published"])
    changed |= write_if_changed(tdir / "REPORT.md", report)
    print(f"{week}: {rep['submissions']} submission(s); " + ("files updated" if changed else "no changes"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
