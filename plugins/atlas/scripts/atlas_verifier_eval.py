#!/usr/bin/env python3
"""Seeded-fix evaluation for the atlas verifier seat.

Measures, per verifier model, how often the verifier REFUTES a seeded bad fix (catch rate)
and how often it wrongly REFUTES a good one (false-refute rate), over a deterministic
30-case corpus (atlas_verifier_eval_cases.py: 15 good, 15 bad across 6 seeded kinds).

Each case is materialized into a fresh temp dir with the claimed fix applied, then
`claude -p --model <m>` is run with the verifier agent's own instructions appended to the
system prompt and the task, diff and claim as input. The verifier gets Read, Grep, Glob and
Bash only (no Edit, Write, Agent, Task); user/project settings, plugins' hooks, MCP and Chrome
are off so nothing writes atlas state into the temp dir.

Usage:
  atlas_verifier_eval.py list
  atlas_verifier_eval.py run --scratch DIR [--models haiku,sonnet,opus] [--tier easy|hard|heldout|all] [--select all|false_good]
                             [--trials N] [--budget 25] [--workers 4] [--limit N] [--seat eval|shipped]
  atlas_verifier_eval.py report --results FILE [FILE ...] [--tier easy|hard|heldout|all]

--seat shipped runs the full agents/verifier.md body (ToolSearch and findings sections included) as the
system prompt, with CLAUDE_PLUGIN_ROOT set so its findings command works inside the case dir. MCP is
off in the sandbox, so the ToolSearch step finds nothing; a sandbox note says so. Tier "heldout"
(HELDOUT_CASES) is not part of "all".
  atlas_verifier_eval.py compare --before FILE [FILE ...] --after FILE [FILE ...]
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import math
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from atlas_verifier_eval_cases import (  # noqa: E402
    ALL_CASES, CASES, FALSE_KINDS, HARD_CASES, HELDOUT_CASES,
)

VERIFIER_MD = HERE.parent / "agents" / "verifier.md"
MODELS = {
    "haiku": "claude-haiku-5-5",
    "sonnet": "claude-sonnet-5-5",
    "opus": "claude-opus-5-5",
}
TIMEOUT_S = 180
ALLOWED_TOOLS = "Read Grep Glob Bash"
TOOLS_FLAG = "Read,Grep,Glob,Bash"
DISALLOWED_TOOLS = "Edit Write MultiEdit NotebookEdit Agent Task"
VERDICT_RE = re.compile(r"VERDICT\s*:\s*[*`_\s]*(CONFIRMED|REFUTED|NEEDS[-_ ]EVIDENCE)", re.I)

# --------------------------------------------------------------------------- corpus


def case_files(case: dict, state: str) -> dict:
    """Return {filename: text} for state 'before' or 'after'."""
    if "files_before" in case:
        return dict(case["files_before" if state == "before" else "files_after"])
    mod = case["mod"]
    if state == "before":
        return {f"{mod}.py": case["before"], f"test_{mod}.py": case["tests_before"]}
    return {f"{mod}.py": case["after"], f"test_{mod}.py": case["tests"]}


def make_diff(case: dict) -> str:
    before, after = case_files(case, "before"), case_files(case, "after")
    out = []
    for name in sorted(after):
        a = before.get(name, "").splitlines(keepends=True)
        b = after[name].splitlines(keepends=True)
        out.extend(difflib.unified_diff(a, b, f"a/{name}", f"b/{name}"))
    return "".join(out)


def materialize(case: dict, dest: Path, with_hidden: bool = False) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for name, text in case_files(case, "after").items():
        (dest / name).write_text(text, encoding="utf-8")
    if with_hidden and case["hidden"]:
        (dest / "test_hidden_oracle.py").write_text(case["hidden"], encoding="utf-8")


def visible_test_files(case: dict) -> list[str]:
    return sorted(n for n in case_files(case, "after") if n.startswith("test_"))


def run_pytest(path: Path, target: str | None = None) -> tuple[int, int, int]:
    """Run pytest in path. Returns (returncode, passed, failed)."""
    cmd = [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider"]
    if target:
        cmd.append(target)
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    env.pop("CLAUDE_PLUGIN_ROOT", None)
    p = subprocess.run(cmd, cwd=path, capture_output=True, text=True, env=env, timeout=120)
    return p.returncode, _count(p.stdout, "passed"), _count(p.stdout, "failed")


def _count(text: str, word: str) -> int:
    m = re.findall(rf"(\d+) {word}", text)
    return int(m[-1]) if m else 0


def claimed_pass_count(claim: str) -> int | None:
    m = re.search(r"(\d+) passed", claim)
    return int(m.group(1)) if m else None


# --------------------------------------------------------------------------- prompt


def verifier_system_prompt() -> str:
    """The verifier agent's own instructions, minus parts that cannot apply in this harness."""
    text = VERIFIER_MD.read_text(encoding="utf-8")
    if text.startswith("---"):
        text = text.split("---", 2)[2]
    sections = re.split(r"(?m)^(?=## )", text)
    keep = [s for s in sections if not re.match(r"## (Tools\b|Record the verdict on disk)", s)]
    body = "".join(keep).strip()
    return (
        body
        + "\n\n## Harness notes (eval run)\n"
        "- Your only tools are Read, Grep, Glob and Bash. You cannot write or edit files; run pytest "
        "with `pytest -q -p no:cacheprovider` from the working directory.\n"
        "- Do not run the findings-recording command; there is no findings.json in this run.\n"
        "- Verdict mapping: `verified` = CONFIRMED, `rejected` = REFUTED, `needs-evidence` = NEEDS-EVIDENCE.\n"
        "- Your final message must end with exactly one line of the form `VERDICT: CONFIRMED`, "
        "`VERDICT: REFUTED` or `VERDICT: NEEDS-EVIDENCE`.\n"
    )


SHIPPED_NOTES = (
    "\n\n## Sandbox notes (eval run, appended by the harness; the text above is the shipped seat prompt)\n"
    "- MCP servers are not loaded here: ToolSearch matches nothing and lean-ctx, context-mode and "
    "claude-mem tools do not exist. Use Read, Grep, Glob and Bash instead.\n"
    "- `${CLAUDE_PLUGIN_ROOT}` is set. Record your verdict with the findings command from your "
    "instructions, passing `--root .` (the current directory); the row lands in `.atlas/.run/findings.json` here.\n"
    "- You have no write or edit tools; run pytest with `pytest -q -p no:cacheprovider` from the working directory.\n"
    "- After the findings command, your final message must end with exactly one line `VERDICT: CONFIRMED` "
    "(verified), `VERDICT: REFUTED` (rejected) or `VERDICT: NEEDS-EVIDENCE` (needs-evidence).\n"
)


def shipped_system_prompt() -> str:
    """The full verifier.md body (frontmatter removed, nothing else cut) plus sandbox notes."""
    text = VERIFIER_MD.read_text(encoding="utf-8")
    if text.startswith("---"):
        text = text.split("---", 2)[2]
    return text.strip() + SHIPPED_NOTES


def seat_prompt(seat: str) -> str:
    return shipped_system_prompt() if seat == "shipped" else verifier_system_prompt()


def findings_status(work: Path) -> str | None:
    """Verdict row the seat wrote with atlas_finding.py, as 'confirmed'/'refuted'/'needs_evidence'."""
    f = work / ".atlas" / ".run" / "findings.json"
    try:
        data = json.loads(f.read_text())
    except (OSError, ValueError):
        return None
    rows = data.get("findings", data) if isinstance(data, dict) else data
    rows = list(rows.values()) if isinstance(rows, dict) else rows
    for row in reversed(rows if isinstance(rows, list) else []):
        if isinstance(row, dict) and row.get("status"):
            return {"verified": "confirmed", "rejected": "refuted"}.get(row["status"], "needs_evidence")
    return None


def build_input(case: dict) -> str:
    return (
        "Verify the following claimed fix. The current working directory holds the repo state with the "
        "fix already applied.\n\n"
        f"TASK STATEMENT:\n{case['task']}\n\n"
        f"DIFF CLAIMED AS THE FIX:\n```diff\n{make_diff(case)}```\n\n"
        f"LEAD'S CLAIM:\n{case['claim']}\n\n"
        "Reach your own verdict. End with one line: VERDICT: CONFIRMED, VERDICT: REFUTED or "
        "VERDICT: NEEDS-EVIDENCE.\n"
    )


def parse_verdict(text: str | None) -> str:
    """Return 'confirmed', 'refuted', 'needs_evidence' or 'none' (last VERDICT line wins)."""
    if not text:
        return "none"
    hits = VERDICT_RE.findall(text)
    if not hits:
        return "none"
    v = hits[-1].upper().replace(" ", "-").replace("_", "-")
    return {"CONFIRMED": "confirmed", "REFUTED": "refuted"}.get(v, "needs_evidence")


# --------------------------------------------------------------------------- runner


def claude_cmd(model_id: str, system_prompt: str, seat: str = "eval") -> list[str]:
    tools = TOOLS_FLAG + (",ToolSearch" if seat == "shipped" else "")
    allowed = ALLOWED_TOOLS + (" ToolSearch" if seat == "shipped" else "")
    return [
        "claude", "-p",
        "--model", model_id,
        "--effort", "medium",
        "--output-format", "json",
        "--no-session-persistence",
        "--no-chrome",
        "--setting-sources", "",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--tools", tools,
        "--allowedTools", allowed,
        "--disallowedTools", DISALLOWED_TOOLS,
        "--permission-mode", "dontAsk",
        "--max-budget-usd", "2",
        "--append-system-prompt", system_prompt,
    ]


def prompt_sha(sys_prompt: str) -> str:
    return hashlib.sha256(sys_prompt.encode("utf-8")).hexdigest()[:12]


def run_case(case: dict, model: str, base: Path, sys_prompt: str, trial: int = 0, seat: str = "eval") -> dict:
    rec = {"case": case["id"], "tier": case.get("tier", "easy"), "label": case["label"],
           "kind": case["kind"], "model": model, "trial": trial, "prompt_sha": prompt_sha(sys_prompt),
           "seat": seat}
    if case.get("flaw"):
        rec["flaw"] = case["flaw"]
    work = Path(tempfile.mkdtemp(prefix=f"{case['id']}_{model}_{trial}_", dir=base))
    try:
        materialize(case, work)
        env = {**os.environ, "TMPDIR": str(base / "_tmp"), "PYTHONDONTWRITEBYTECODE": "1"}
        env.pop("CLAUDE_PLUGIN_ROOT", None)
        if seat == "shipped":
            env["CLAUDE_PLUGIN_ROOT"] = str(HERE.parent)
        t0 = time.monotonic()
        proc = subprocess.Popen(
            claude_cmd(MODELS[model], sys_prompt, seat), cwd=work, env=env, text=True,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            start_new_session=True,
        )
        try:
            out, err = proc.communicate(build_input(case), timeout=TIMEOUT_S)
            rec["timeout"] = False
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            out, err = proc.communicate()
            rec["timeout"] = True
        rec["seconds"] = round(time.monotonic() - t0, 2)
        rec["rc"] = proc.returncode
        data = None
        try:
            data = json.loads(out) if out.strip() else None
        except json.JSONDecodeError:
            data = None
        text = (data or {}).get("result") if isinstance(data, dict) else None
        rec["verdict"] = parse_verdict(text)
        if seat == "shipped":
            rec["finding"] = findings_status(work)
            if rec["verdict"] == "none" and rec["finding"]:
                rec["verdict"] = rec["finding"]
        rec["bucket"] = "timeout" if rec["timeout"] else (
            rec["verdict"] if rec["verdict"] != "none" else ("error" if not data or data.get("is_error") else "none"))
        if isinstance(data, dict):
            u = data.get("usage") or {}
            rec["cost_usd"] = data.get("total_cost_usd")
            rec["tokens"] = {
                "input": u.get("input_tokens"), "output": u.get("output_tokens"),
                "cache_read": u.get("cache_read_input_tokens"),
                "cache_create": u.get("cache_creation_input_tokens"),
            }
            rec["num_turns"] = data.get("num_turns")
            rec["permission_denials"] = len(data.get("permission_denials") or [])
        else:
            rec["cost_usd"] = None
            rec["stderr_tail"] = (err or "")[-300:]
        rec["final_tail"] = (text or "")[-500:]
        rec["strays"] = sorted(p.name for p in work.iterdir()
                               if p.name not in case_files(case, "after") and p.name != ".atlas")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return rec


def select_cases(tier: str, select: str, only: str = "") -> list[dict]:
    pool = {"easy": CASES, "hard": HARD_CASES, "heldout": HELDOUT_CASES, "all": ALL_CASES}[tier]
    if select == "false_good":
        pool = [c for c in pool if c["label"] == "good" or c["kind"] in FALSE_KINDS]
    if only:
        want = set(only.split(","))
        pool = [c for c in pool if c["id"] in want]
    return pool


def cmd_run(args) -> int:
    base = Path(args.scratch)
    if not str(base).startswith("/tmp/claude-0/"):
        print("refusing: --scratch must live under the session scratchpad", file=sys.stderr)
        return 2
    base.mkdir(parents=True, exist_ok=True)
    (base / "_tmp").mkdir(exist_ok=True)
    out_path = Path(args.results) if args.results else base / "results.jsonl"
    models = [m for m in args.models.split(",") if m]
    done = set()
    if out_path.exists():
        for line in out_path.read_text().splitlines():
            r = json.loads(line)
            done.add((r["case"], r["model"], r.get("trial", 0)))
    cases = select_cases(args.tier, args.select, args.only)
    cases = cases[: args.limit] if args.limit else cases
    tasks = [(c, m, t) for t in range(args.trials) for c in cases for m in models
             if (c["id"], m, t) not in done]
    sys_prompt = seat_prompt(args.seat)
    lock = threading.Lock()
    state = {"spent": 0.0, "skipped": 0, "done": 0, "stopped": False}
    if out_path.exists():
        for line in out_path.read_text().splitlines():
            state["spent"] += json.loads(line).get("cost_usd") or 0.0

    def work(t):
        c, m, tr = t
        with lock:
            if state["spent"] >= args.budget or state["stopped"]:
                state["skipped"] += 1
                return
        rec = run_case(c, m, base, sys_prompt, tr, args.seat)
        with lock:
            state["spent"] += rec.get("cost_usd") or 0.0
            state["done"] += 1
            projected = state["spent"] / state["done"] * len(tasks)
            if state["done"] >= 3 and projected > args.budget:
                state["stopped"] = True
                print(f"STOP: projected ${projected:.2f} for {len(tasks)} runs exceeds budget ${args.budget:.2f}", flush=True)
            with out_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(rec) + "\n")
            print(f"{c['id']:18s} {m:7s} t{tr} {rec['bucket']:14s} {rec['seconds']:6.1f}s "
                  f"${rec.get('cost_usd') or 0:.3f}  total ${state['spent']:.2f}", flush=True)

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        list(ex.map(work, tasks))
    print(f"spent ${state['spent']:.2f}; skipped for budget: {state['skipped']}; results: {out_path}")
    return 0


# --------------------------------------------------------------------------- metrics


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - h) / d, (c + h) / d)


def percentile(values: list[float], q: float) -> float | None:
    """Nearest-rank percentile, q in (0, 100]."""
    if not values:
        return None
    s = sorted(values)
    return s[max(1, math.ceil(q / 100 * len(s))) - 1]


def summarize(records: list[dict]) -> dict:
    """Per-model summary dict. Bad-case catch = refuted; good-case false refute = refuted."""
    out = {}
    for model in sorted({r["model"] for r in records}):
        rs = [r for r in records if r["model"] == model]
        bad = [r for r in rs if r["label"] == "bad"]
        good = [r for r in rs if r["label"] == "good"]
        caught = sum(r["verdict"] == "refuted" for r in bad)
        false_ref = sum(r["verdict"] == "refuted" for r in good)
        secs = [r["seconds"] for r in rs if "seconds" in r]
        buckets: dict[str, int] = {}
        for r in rs:
            if r["verdict"] not in ("confirmed", "refuted"):
                buckets[r["bucket"]] = buckets.get(r["bucket"], 0) + 1
        kinds = {}
        for k in dict.fromkeys(r["kind"] for r in bad):
            kr = [r for r in bad if r["kind"] == k]
            kinds[k] = (sum(r["verdict"] == "refuted" for r in kr), len(kr))
        flaws = {}
        for r in rs:
            if r.get("flaw"):
                k = flaws.setdefault(r["flaw"], [0, 0])
                k[0] += r["verdict"] == "refuted"
                k[1] += 1
        groups: dict[str, set] = {}
        for r in rs:
            groups.setdefault(r["case"], []).append(r["verdict"])
        multi = [v for v in groups.values() if len(v) >= 2]
        agree = (sum(len(set(v)) == 1 for v in multi), len(multi))
        out[model] = {
            "runs": len(rs), "bad_n": len(bad), "good_n": len(good),
            "caught": caught, "catch_rate": caught / len(bad) if bad else None,
            "catch_ci": wilson(caught, len(bad)),
            "false_refuted": false_ref, "false_rate": false_ref / len(good) if good else None,
            "false_ci": wilson(false_ref, len(good)),
            "no_verdict": sum(buckets.values()), "no_verdict_buckets": buckets,
            "p50": percentile(secs, 50), "p95": percentile(secs, 95),
            "usd": sum(r.get("cost_usd") or 0 for r in rs),
            "kinds": kinds, "agree": agree,
            "flaws": {k: (v[0], v[1]) for k, v in flaws.items()},
        }
    return out


def dedupe_records(recs: list[dict]) -> list[dict]:
    """Keep the last record per (case, model, trial)."""
    out = {}
    for r in recs:
        out[(r["case"], r["model"], r.get("trial", 0))] = r
    return list(out.values())


def _pct(x: float) -> str:
    return f"{100 * max(x, 0.0):.1f}%"


def render_tables(summary: dict) -> str:
    lines = [
        "| model | runs | catch rate on bad (refuted/bad runs) | 95% Wilson | false-refute on good (refuted/good runs) | 95% Wilson | no-verdict | p50 s | p95 s | total USD | all-trials-agree cases |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for m, s in summary.items():
        lines.append(
            f"| {m} | {s['runs']} | {s['caught']}/{s['bad_n']} = {_pct(s['catch_rate'])} | "
            f"{_pct(s['catch_ci'][0])} to {_pct(s['catch_ci'][1])} | "
            f"{s['false_refuted']}/{s['good_n']} = {_pct(s['false_rate'])} | "
            f"{_pct(s['false_ci'][0])} to {_pct(s['false_ci'][1])} | "
            f"{s['no_verdict']} | {s['p50']:.1f} | {s['p95']:.1f} | {s['usd']:.2f} | "
            f"{s['agree'][0]}/{s['agree'][1] if s['agree'][1] else 'n/a'} |")
    lines += ["", "Catch rate per seeded kind (refuted / bad runs):", "",
              "| kind | " + " | ".join(summary) + " |", "|---|" + "---|" * len(summary)]
    kinds = list(dict.fromkeys(k for s in summary.values() for k in s["kinds"]))
    for k in kinds:
        lines.append(f"| {k} | " + " | ".join(
            f"{s['kinds'].get(k, (0, 0))[0]}/{s['kinds'].get(k, (0, 0))[1]}" for s in summary.values()) + " |")
    flaws = list(dict.fromkeys(k for s in summary.values() for k in s.get("flaws", {})))
    if flaws:
        lines += ["", "Refuted / runs per mismatch kind (bad cases) or divergence kind (good cases):", "",
                  "| kind | " + " | ".join(summary) + " |", "|---|" + "---|" * len(summary)]
        for k in flaws:
            lines.append(f"| {k} | " + " | ".join(
                f"{s['flaws'].get(k, (0, 0))[0]}/{s['flaws'].get(k, (0, 0))[1]}" for s in summary.values()) + " |")
    nv = [f"{m}: {s['no_verdict_buckets']}" for m, s in summary.items() if s["no_verdict"]]
    if nv:
        lines += ["", "No-verdict breakdown: " + "; ".join(nv)]
    return "\n".join(lines)


def load_records(paths) -> list[dict]:
    recs = []
    for p in paths:
        recs += [json.loads(l) for l in Path(p).read_text().splitlines() if l.strip()]
    return dedupe_records(recs)


def cmd_report(args) -> int:
    recs = load_records(args.results)
    if args.tier != "all":
        recs = [r for r in recs if r.get("tier", "easy") == args.tier]
    print(render_tables(summarize(recs)))
    return 0


def compare(before: list[dict], after: list[dict]) -> dict:
    """Side by side on the cases present in `after`: catch on false-claim bad cases, false refute on good."""
    ids = {r["case"] for r in after}
    out = {}
    for model in sorted({r["model"] for r in after}):
        row = {}
        for name, recs in (("before", before), ("after", after)):
            rs = [r for r in recs if r["model"] == model and r["case"] in ids]
            fc = [r for r in rs if r["label"] == "bad" and r["kind"] in FALSE_KINDS]
            gd = [r for r in rs if r["label"] == "good"]
            k1 = sum(r["verdict"] == "refuted" for r in fc)
            k2 = sum(r["verdict"] == "refuted" for r in gd)
            row[name] = {"fc": (k1, len(fc)), "fc_ci": wilson(k1, len(fc)),
                         "good": (k2, len(gd)), "good_ci": wilson(k2, len(gd)),
                         "usd": sum(r.get("cost_usd") or 0 for r in rs)}
        out[model] = row
    return out


def render_compare(cmp: dict) -> str:
    lines = ["| model | phase | false-claim caught (refuted/runs) | 95% Wilson | good falsely refuted (refuted/runs) | 95% Wilson |",
             "|---|---|---|---|---|---|"]
    for m, row in cmp.items():
        for ph in ("before", "after"):
            d = row[ph]
            lines.append(
                f"| {m} | {ph} | {d['fc'][0]}/{d['fc'][1]} = {_pct(d['fc'][0] / d['fc'][1] if d['fc'][1] else 0)} | "
                f"{_pct(d['fc_ci'][0])} to {_pct(d['fc_ci'][1])} | "
                f"{d['good'][0]}/{d['good'][1]} = {_pct(d['good'][0] / d['good'][1] if d['good'][1] else 0)} | "
                f"{_pct(d['good_ci'][0])} to {_pct(d['good_ci'][1])} |")
    return "\n".join(lines)


def cmd_compare(args) -> int:
    print(render_compare(compare(load_records(args.before), load_records(args.after))))
    return 0


def cmd_list(_args) -> int:
    for c in ALL_CASES + HELDOUT_CASES:
        print(f"{c['id']:18s} {c.get('tier', 'easy'):5s} {c['label']:5s} {c['kind']}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list").set_defaults(fn=cmd_list)
    r = sub.add_parser("run")
    r.add_argument("--scratch", required=True)
    r.add_argument("--results")
    r.add_argument("--models", default="haiku,sonnet,opus")
    r.add_argument("--budget", type=float, default=25.0)
    r.add_argument("--workers", type=int, default=4)
    r.add_argument("--limit", type=int, default=0)
    r.add_argument("--tier", choices=["easy", "hard", "heldout", "all"], default="easy")
    r.add_argument("--seat", choices=["eval", "shipped"], default="eval",
                   help="eval: verifier.md minus ToolSearch/findings sections; shipped: the full body")
    r.add_argument("--select", choices=["all", "false_good"], default="all")
    r.add_argument("--trials", type=int, default=1)
    r.add_argument("--only", default="", help="comma-separated case ids")
    r.set_defaults(fn=cmd_run)
    p = sub.add_parser("report")
    p.add_argument("--results", required=True, nargs="+")
    p.add_argument("--tier", choices=["easy", "hard", "heldout", "all"], default="all")
    p.set_defaults(fn=cmd_report)
    q = sub.add_parser("compare")
    q.add_argument("--before", required=True, nargs="+")
    q.add_argument("--after", required=True, nargs="+")
    q.set_defaults(fn=cmd_compare)
    a = ap.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
