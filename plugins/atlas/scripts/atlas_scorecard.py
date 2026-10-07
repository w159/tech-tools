#!/usr/bin/env python3
"""atlas_scorecard: deterministic, stdlib-only measurement of every atlas surface.

  atlas_scorecard.py run  --root <plugins/atlas dir> --out file.json [--only a,b] [--quick]
                          [--db atlas.db-copy] [--runs N] [--repeat K] [--merge] [--list]
  atlas_scorecard.py diff a.json b.json [--quiet]

`run` measures the tree at --root (the live tree or a frozen snapshot) inside a hermetic
sandbox (temp HOME/ATLAS_*/TMPDIR, private tmux socket, copies of any DB) and writes one
JSON document: {schema, meta, probes, metrics{name: {value, unit, direction, threshold,
remeasure, state, ...}}}. A probe whose prerequisite is missing reports `skipped` with a
reason, never a fake pass.

`diff` prints per-metric before/after/delta/verdict (improved|regressed|same) using each
metric's direction and threshold and exits 1 on any regression.
"""

import argparse
import importlib
import json
import os
import platform
import signal
import subprocess
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from scorecard import core  # noqa: E402

PROBE_MODULES = ("hooks", "gates", "omp", "mesh", "connectors", "dashboard", "misc")


def load_probes():
    """-> {probe_name: (fn, declared_metric_names, module_name, slow)} in a stable order."""
    probes = {}
    for mod in PROBE_MODULES:
        m = importlib.import_module(f"scorecard.probe_{mod}")
        for name, fn, declared, slow in m.PROBES:
            probes[name] = (fn, declared, mod, slow)
    return probes


def _git_sha(root):
    try:
        r = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return r.stdout.strip() or None
    except Exception:
        return None


def _error_metric(name, msg, group):
    m = core.skipped(
        f"probe_error.{name}", msg, "", "exact", f"--only {name}", group, "error"
    )
    return m


class ProbeTimeout(BaseException):
    """Raised by SIGALRM when a probe exceeds its budget (BaseException so a probe's
    broad `except Exception` cannot swallow it)."""


def _alarm(_sig, _frm):
    raise ProbeTimeout()


def run_probe(name, fn, declared, ctx, repeat, budget=150):
    """Run one probe `repeat` times, each capped at `budget` seconds (SIGALRM; subprocess.run
    kills its child on the raise). Deterministic metrics must agree across repeats or
    they are reported `unstable` with the observed values; timing metrics keep the median
    run. A probe exception or timeout becomes an `error` metric, never a silent pass."""
    t0 = time.perf_counter()
    runs = []
    signal.signal(signal.SIGALRM, _alarm)
    for _ in range(max(1, repeat)):
        try:
            signal.setitimer(signal.ITIMER_REAL, budget)
            try:
                runs.append({m["name"]: m for m in fn(ctx)})
            finally:
                signal.setitimer(signal.ITIMER_REAL, 0)
        except (Exception, ProbeTimeout) as e:  # noqa: BLE001 - a probe must never abort the scorecard
            tb = (
                f"timeout: probe exceeded its {budget}s budget"
                if isinstance(e, ProbeTimeout)
                else "".join(traceback.format_exception_only(type(e), e)).strip()
            )
            ms = {f"probe_error.{name}": _error_metric(name, tb[-400:], "probe")}
            for d in declared:
                ms[d] = core.skipped(
                    d, f"probe {name} crashed: {tb[-200:]}", state="error"
                )
            runs.append(ms)
    merged = {}
    for key in dict.fromkeys(k for r in runs for k in r):
        samples = [r[key] for r in runs if key in r]
        first = samples[0]
        vals = [s.get("value") for s in samples if s.get("state") == "ok"]
        if (
            len(samples) > 1
            and first.get("deterministic")
            and len(set(map(str, vals))) > 1
        ):
            first = dict(
                first,
                state="unstable",
                detail={
                    "observed": vals,
                    "variance": (max(vals) - min(vals))
                    if all(core.finite(v) for v in vals)
                    else None,
                },
            )
        elif (
            len(samples) > 1
            and not first.get("deterministic")
            and vals
            and all(core.finite(v) for v in vals)
        ):
            first = dict(
                first,
                value=sorted(vals)[len(vals) // 2],
                detail={**(first.get("detail") or {}), "repeats": vals},
            )
        merged[key] = first
    return merged, time.perf_counter() - t0


def cmd_run(args):
    root = Path(args.root).resolve()
    if not (root / "scripts").is_dir() or not (root / "hooks").is_dir():
        print(
            f"error: --root {root} has no scripts/ and hooks/ (expected plugins/atlas)",
            file=sys.stderr,
        )
        return 2
    probes = load_probes()
    if args.list:
        for n, (_f, declared, mod, slow) in probes.items():
            print(f"{n:24s} {mod:11s} {'slow' if slow else ''} {','.join(declared)}")
        return 0
    only = [s for s in (args.only or "").split(",") if s]
    if only:
        unknown = [o for o in only if o not in probes and o not in PROBE_MODULES]
        if unknown:
            print(
                f"error: unknown probe(s) {unknown}; --list shows names",
                file=sys.stderr,
            )
            return 2
    selected = {
        n: p for n, p in probes.items() if not only or n in only or p[2] in only
    }
    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    ctx = core.Ctx(root, quick=args.quick, db=args.db, runs=args.runs, work=args.work)
    started = time.time()
    doc = {"schema": core.SCHEMA_VERSION, "meta": {}, "probes": {}, "metrics": {}}
    if args.merge and out_path.exists():
        doc = json.loads(out_path.read_text())
    try:
        for name, (fn, declared, mod, slow) in selected.items():
            if args.quick and slow:
                metrics = {
                    d: core.skipped(
                        d, "skipped by --quick (slow probe)", cmd=f"--only {name}"
                    )
                    for d in declared
                }
                doc["probes"][name] = {"module": mod, "state": "skipped", "wall_s": 0}
                doc["metrics"].update(metrics)
                print(f"[scorecard] {name}: skipped (--quick)", file=sys.stderr)
                continue
            print(f"[scorecard] {name} ...", file=sys.stderr, flush=True)
            budget = 45 if args.quick else (200 if slow else 90)
            metrics, wall = run_probe(name, fn, declared, ctx, args.repeat, budget)
            bad = [m for m in metrics.values() if m["state"] == "error"]
            doc["probes"][name] = {
                "module": mod,
                "wall_s": round(wall, 1),
                "state": "error" if bad else "ok",
                "metrics": len(metrics),
            }
            doc["metrics"].update(metrics)
            print(
                f"[scorecard] {name}: {len(metrics)} metrics in {wall:.1f}s",
                file=sys.stderr,
            )
    finally:
        ctx.close()
    states = {}
    for m in doc["metrics"].values():
        states[m["state"]] = states.get(m["state"], 0) + 1
    doc["meta"] = {
        "root": str(root),
        "git_sha": _git_sha(root),
        "python": platform.python_version(),
        "platform": platform.platform(),
        "quick": bool(args.quick),
        "runs": ctx.n,
        "db": str(args.db) if args.db else "synthetic",
        "repeat": args.repeat,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(started)),
        "wall_s": round(time.time() - started, 1),
        "metric_count": len(doc["metrics"]),
        "states": states,
        "only": only or None,
    }
    out_path.write_text(json.dumps(doc, indent=1, sort_keys=True, default=str) + "\n")
    skipped = [
        (m["name"], m.get("reason", ""))
        for m in doc["metrics"].values()
        if m["state"] == "skipped"
    ]
    print(
        f"[scorecard] wrote {out_path}: {len(doc['metrics'])} metrics {states} in "
        f"{doc['meta']['wall_s']}s",
        file=sys.stderr,
    )
    for n, reason in skipped:
        print(f"[scorecard]   skipped {n}: {reason}", file=sys.stderr)
    return 0


# -- diff ---------------------------------------------------------------------
def verdict(before, after):
    """-> (verdict, delta, note). Pure function of two metric dicts (or None)."""
    if after is None:
        return "regressed", None, "metric missing in after"
    if after.get("state") == "error":
        return "regressed", None, "after errored: " + str(after.get("reason", ""))[:80]
    if before is None:
        return "new", None, ""
    if before.get("state") != "ok" or after.get("state") != "ok":
        return "skipped", None, f"{before.get('state')} -> {after.get('state')}"
    b, a = before["value"], after["value"]
    if not (core.finite(b) and core.finite(a)):
        return ("same" if b == a else "regressed"), None, "non-numeric"
    delta = a - b
    direction = (
        "info"
        if "info" in (before.get("direction"), after.get("direction"))
        else before.get("direction", "lower")
    )
    thr = before.get("threshold") or {}
    tol = max(float(thr.get("abs", 0) or 0), float(thr.get("rel", 0) or 0) * abs(b))
    if direction == "info" or abs(delta) <= tol:
        return "same", delta, ""
    if direction == "exact":
        return "regressed", delta, "changed"
    better = delta < 0 if direction == "lower" else delta > 0
    return ("improved" if better else "regressed"), delta, ""


def _fmt(v):
    if v is None:
        return "-"
    if isinstance(v, float):
        return f"{v:.3f}".rstrip("0").rstrip(".")
    return str(v)


def cmd_diff(args):
    a = json.loads(Path(args.before).read_text())["metrics"]
    b = json.loads(Path(args.after).read_text())["metrics"]
    rows, counts = [], {}
    for name in sorted(set(a) | set(b)):
        v, delta, note = verdict(a.get(name), b.get(name))
        counts[v] = counts.get(v, 0) + 1
        bm, am = a.get(name) or {}, b.get(name) or {}
        unit = am.get("unit") or bm.get("unit") or ""
        rows.append(
            (
                name,
                _fmt(bm.get("value")),
                _fmt(am.get("value")),
                _fmt(delta),
                unit,
                v,
                note,
            )
        )
    if not args.quiet or counts.get("regressed"):
        w = max([len(r[0]) for r in rows] + [6])
        print(f"{'metric':{w}}  {'before':>12}  {'after':>12}  {'delta':>10}  verdict")
        for name, bv, av, dv, unit, v, note in rows:
            if args.quiet and v != "regressed":
                continue
            print(
                f"{name:{w}}  {bv:>12}  {av:>12}  {dv:>10}  {v}"
                f"{'  [' + unit + ']' if unit else ''}{'  ' + note if note else ''}"
            )
    print("summary: " + ", ".join(f"{k}={counts[k]}" for k in sorted(counts)))
    return 1 if counts.get("regressed") else 0


def main(argv=None):
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="measure a tree and write JSON")
    r.add_argument("--root", required=True, help="the plugins/atlas dir to measure")
    r.add_argument("--out", help="output JSON path")
    r.add_argument("--only", help="comma list of probe or module names (see --list)")
    r.add_argument(
        "--quick", action="store_true", help="fewer samples; slow probes skipped"
    )
    r.add_argument(
        "--db",
        help="a COPY of an atlas.db for dashboard/doctor probes (default: synthetic)",
    )
    r.add_argument(
        "--runs", type=int, help="samples per latency metric (default 15, quick 5)"
    )
    r.add_argument(
        "--repeat",
        type=int,
        default=1,
        help="run each probe K times; deterministic disagreement => unstable",
    )
    r.add_argument(
        "--merge",
        action="store_true",
        help="update an existing --out instead of replacing it",
    )
    r.add_argument("--work", help="scratch dir (default: mkdtemp under /tmp)")
    r.add_argument("--list", action="store_true", help="list probes and exit")
    d = sub.add_parser("diff", help="compare two result files; exit 1 on regression")
    d.add_argument("before")
    d.add_argument("after")
    d.add_argument(
        "--quiet", action="store_true", help="print only regressions + summary"
    )
    args = p.parse_args(argv)
    if args.cmd == "run":
        if not args.out and not args.list:
            p.error("run requires --out")
        return cmd_run(args)
    return cmd_diff(args)


if __name__ == "__main__":
    sys.exit(main())
