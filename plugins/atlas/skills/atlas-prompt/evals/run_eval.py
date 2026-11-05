#!/usr/bin/env python3
"""Measure atlas-prompt: trigger precision/recall, rewrite length, goal preservation.

Runs the real skill in real Claude Code sessions (`claude -p`) with nothing loaded but a throwaway
plugin, then grades each rewrite with a judge on a different model in a fresh context, against the
human-written gold list in cases.json.

  run_eval.py rewrite  --skill SKILL.md --label new --model sonnet --out DIR
  run_eval.py grade    --out DIR --label new --judge-model opus
  run_eval.py trigger  --skill SKILL.md --label new --model sonnet --out DIR
  run_eval.py report   --out DIR --labels old,new

`--skill` is the SKILL.md to test (`git show <rev>:plugins/atlas/skills/atlas-prompt/SKILL.md > old.md`
for a baseline). Nothing here touches the user's Claude config: every session runs with
`--setting-sources ""` and `--strict-mcp-config` in a scratch project.
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKILL_DIR = HERE.parent
PLUGIN = SKILL_DIR.parent.parent  # plugins/atlas
sys.path.insert(0, str(PLUGIN / "scripts"))
import atlas_prompt_judge as judge  # noqa: E402

BASE = ["claude", "-p", "--setting-sources", "", "--strict-mcp-config", "--output-format", "stream-json",
        "--verbose", "--no-session-persistence"]


def load(name: str) -> list[dict]:
    return json.loads((HERE / name).read_text())["cases"]


def build_plugin(skill_md: Path, dest: Path, all_skills: bool) -> Path:
    """A minimal `atlas` plugin: the skill under test (plus every other atlas skill when all_skills)."""
    root = dest / "atlas"
    (root / ".claude-plugin").mkdir(parents=True)
    meta = json.loads((PLUGIN / ".claude-plugin" / "plugin.json").read_text())
    (root / ".claude-plugin" / "plugin.json").write_text(json.dumps(
        {k: meta[k] for k in ("name", "version", "description") if k in meta}))
    (root / "scripts").mkdir()
    for s in ("atlas_prompt_judge.py", "atlas_harness.py"):
        shutil.copy(PLUGIN / "scripts" / s, root / "scripts" / s)
    if all_skills:
        for sk in sorted((PLUGIN / "skills").iterdir()):
            if sk.is_dir() and (sk / "SKILL.md").exists() and sk.name != "atlas-prompt":
                (root / "skills" / sk.name).mkdir(parents=True)
                shutil.copy(sk / "SKILL.md", root / "skills" / sk.name / "SKILL.md")
    tgt = root / "skills" / "atlas-prompt"
    tgt.mkdir(parents=True)
    shutil.copy(skill_md, tgt / "SKILL.md")
    if (SKILL_DIR / "references").exists():
        shutil.copytree(SKILL_DIR / "references", tgt / "references")
    return root


def fixture(dest: Path) -> Path:
    """A small Python project for the skill to discover: CLAUDE.md, a package, tests."""
    proj = dest / "proj"
    (proj / "kit").mkdir(parents=True)
    (proj / "tests").mkdir()
    (proj / "CLAUDE.md").write_text("# kit\n\nPython 3.12 utilities. Run tests with `pytest -q`. "
                                    "Keep the public API in kit/__init__.py stable.\n")
    (proj / "kit" / "__init__.py").write_text("from .cache import LRU\n")
    (proj / "kit" / "cache.py").write_text("class LRU:\n    def __init__(self, n):\n        self.n = n\n")
    (proj / "tests" / "test_cache.py").write_text("from kit import LRU\n\ndef test_lru():\n    assert LRU(2).n == 2\n")
    subprocess.run(["git", "init", "-q"], cwd=proj, check=False)
    return proj


def run_session(argv: list[str], cwd: Path, timeout: int) -> dict:
    t0 = time.time()
    try:
        p = subprocess.run(argv, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        out = p.stdout
    except subprocess.TimeoutExpired as exc:
        out = exc.stdout.decode() if isinstance(exc.stdout, bytes) else (exc.stdout or "")
    events = []
    for line in out.splitlines():
        try:
            events.append(json.loads(line))
        except ValueError:
            pass
    res = next((e for e in reversed(events) if e.get("type") == "result"), {})
    skills = []
    for e in events:
        if e.get("type") == "assistant":
            for c in e.get("message", {}).get("content", []):
                if c.get("type") == "tool_use" and c.get("name") == "Skill":
                    skills.append(str(c.get("input", {}).get("skill", "")))
    usage = res.get("usage", {})
    return {"result": res.get("result", ""), "skills": skills, "seconds": round(time.time() - t0, 1),
            "turns": res.get("num_turns"), "cost": res.get("total_cost_usd"),
            "output_tokens": usage.get("output_tokens"), "is_error": res.get("is_error", not res)}


def extract_prompt(text: str) -> str:
    """The rewrite itself: drop a trailing `Checked:` footer line the new skill prints."""
    lines = [ln for ln in (text or "").strip().splitlines() if not ln.startswith("Checked:")]
    return "\n".join(lines).strip()


def cmd_rewrite(a) -> int:
    out = Path(a.out) / a.label
    out.mkdir(parents=True, exist_ok=True)
    cases = load("cases.json")
    with tempfile.TemporaryDirectory(prefix="ap-eval-") as tmp:
        tmp = Path(tmp)
        plugin = build_plugin(Path(a.skill), tmp / "plug", all_skills=False)

        def one(c):
            work = tmp / c["id"]
            work.mkdir()
            proj = fixture(work)
            argv = BASE + ["--model", a.model, "--plugin-dir", str(plugin), "--max-turns", str(a.max_turns),
                           f"/atlas-prompt {c['prompt']}"]
            r = run_session(argv, proj, a.timeout)
            r["id"] = c["id"]
            (out / f"{c['id']}.json").write_text(json.dumps(r, indent=1))
            return c["id"], r["seconds"], len(r["result"].split())

        with cf.ThreadPoolExecutor(a.jobs) as ex:
            for cid, sec, words in ex.map(one, cases):
                print(f"{a.label} {cid}: {words} words, {sec}s", flush=True)
    return 0


GRADE = """You are grading whether a rewritten prompt keeps the goals of the original request. You did not
write either. Be strict and literal.

<original>
{original}
</original>

<gold_items>
{items}
</gold_items>

<rewrite>
{rewrite}
</rewrite>

For each numbered gold item, give one verdict: KEPT (asked for with the same force and scope), WEAKENED
(softer, narrower, optional or loosened), DROPPED (absent or contradicted), UNKNOWN (cannot tell).
Reply with JSON only: {{"items": [{{"n": 1, "verdict": "KEPT", "quote": "rewrite words"}}]}}"""

ADDED = """You are checking a rewritten prompt for scope creep. You did not write it.

<original>
{original}
</original>

<rewrite>
{rewrite}
</rewrite>

List each requirement in the rewrite that the original did not ask for and does not clearly imply:
features, files, deliverables, tools, standards or process steps the user never named. Do not list
checks that confirm the asked-for result (run the tests, show evidence), rules the rewrite attributes to
the project's own files (CLAUDE.md, AGENTS.md), or items the rewrite labels as assumptions or notes.
Reply with JSON only: {{"added": ["..."]}}"""


def ask_judge(prompt: str, model: str, timeout: int) -> str:
    with tempfile.TemporaryDirectory(prefix="ap-judge-") as cwd:
        p = subprocess.run(["claude", "-p", "--tools", "", "--setting-sources", "", "--strict-mcp-config",
                            "--model", model, "--max-turns", "1", prompt],
                           capture_output=True, text=True, timeout=timeout, cwd=cwd)
    return p.stdout


def first_json(text: str, key: str):
    dec = json.JSONDecoder()
    for m in re.finditer(r"\{", text or ""):
        try:
            obj, _ = dec.raw_decode(text, m.start())
        except ValueError:
            continue
        if isinstance(obj, dict) and key in obj:
            return obj[key]
    return None


def cmd_grade(a) -> int:
    out = Path(a.out) / a.label
    cases = {c["id"]: c for c in load("cases.json")}

    def one(cid):
        c = cases[cid]
        r = json.loads((out / f"{cid}.json").read_text())
        rw = extract_prompt(r["result"])
        core = judge.strip_boilerplate(rw)
        g = {"id": cid, "words": len(rw.split()), "words_core": len(core.split()), "chars": len(rw), "size": c["size"],
             "skip_expected": bool(c.get("skip")), "skip_got": rw.strip() == "SKIP",
             "anchors_missing": judge.missing_anchors(c["prompt"], rw) if not c.get("skip") else [],
             "footer": next((ln for ln in r["result"].splitlines() if ln.startswith("Checked:")), "")}
        if c["gold"] and rw and rw != "SKIP":
            items = "\n".join(f"{i}. {t}" for i, t in enumerate(c["gold"], 1))
            v = first_json(ask_judge(GRADE.format(original=c["prompt"], items=items, rewrite=core), a.judge_model,
                                     a.timeout), "items") or []
            verd = {int(x.get("n", 0)): str(x.get("verdict", "UNKNOWN")).upper() for x in v if isinstance(x, dict)}
            g["verdicts"] = [verd.get(i, "UNKNOWN") for i in range(1, len(c["gold"]) + 1)]
            g["added"] = first_json(ask_judge(ADDED.format(original=c["prompt"], rewrite=core), a.judge_model,
                                              a.timeout), "added") or []
        else:
            g["verdicts"] = ["DROPPED"] * len(c["gold"]) if c["gold"] else []
            g["added"] = []
        (out / f"{cid}.grade.json").write_text(json.dumps(g, indent=1))
        return g

    with cf.ThreadPoolExecutor(a.jobs) as ex:
        for g in ex.map(one, sorted(cases)):
            kept = g["verdicts"].count("KEPT")
            print(f"{a.label} {g['id']}: {kept}/{len(g['verdicts'])} kept, {len(g['added'])} added, {g['words']} words")
    return 0


def cmd_trigger(a) -> int:
    out = Path(a.out) / f"trigger-{a.label}"
    out.mkdir(parents=True, exist_ok=True)
    cases = load("trigger_cases.json")
    with tempfile.TemporaryDirectory(prefix="ap-trig-") as tmp:
        tmp = Path(tmp)
        plugin = build_plugin(Path(a.skill), tmp / "plug", all_skills=True)

        def one(c):
            res = []
            for rep in range(a.reps):
                work = tmp / f"{c['id']}-{rep}"
                work.mkdir()
                proj = fixture(work)
                argv = BASE + ["--model", a.model, "--plugin-dir", str(plugin), "--max-turns", "1", c["prompt"]]
                r = run_session(argv, proj, a.timeout)
                res.append(any("atlas-prompt" in s for s in r["skills"]))
                r["fired"] = res[-1]
                (out / f"{c['id']}-{rep}.json").write_text(json.dumps(r, indent=1))
            return c, res

        with cf.ThreadPoolExecutor(a.jobs) as ex:
            for c, res in ex.map(one, cases):
                print(f"trigger-{a.label} {c['id']} want={c['fire']} got={res}", flush=True)
    return 0


def summarize(out: Path, label: str) -> dict:
    gs = [json.loads(p.read_text()) for p in sorted((out / label).glob("*.grade.json"))]
    items = [v for g in gs for v in g["verdicts"]]
    nonskip = [g for g in gs if not g["skip_expected"]]
    simple = [g["words"] for g in nonskip if g["size"] == "simple"]
    cplx = [g["words"] for g in nonskip if g["size"] == "complex"]
    runs = [json.loads(p.read_text()) for p in sorted((out / label).glob("*.json")) if ".grade" not in p.name]

    def med(xs):
        xs = sorted(xs)
        return xs[len(xs) // 2] if xs else 0

    s = {"label": label, "cases": len(gs), "gold_items": len(items),
         "kept": items.count("KEPT"), "weakened": items.count("WEAKENED"), "dropped": items.count("DROPPED"),
         "unknown": items.count("UNKNOWN"),
         "added_total": sum(len(g["added"]) for g in gs),
         "skip_correct": sum(g["skip_expected"] == g["skip_got"] for g in gs),
         "anchors_missing": sum(len(g["anchors_missing"]) for g in gs),
         "words_simple_median": med(simple), "words_complex_median": med(cplx),
         "words_total": sum(g["words"] for g in gs),
         "words_core_total": sum(g.get("words_core", g["words"]) for g in gs),
         "seconds_median": med([r["seconds"] for r in runs]),
         "output_tokens_total": sum(r.get("output_tokens") or 0 for r in runs),
         "cost_total": round(sum(r.get("cost") or 0 for r in runs), 3)}
    trig = sorted((out / f"trigger-{label}").glob("*.json")) if (out / f"trigger-{label}").exists() else []
    if trig:
        want = {c["id"]: c["fire"] for c in load("trigger_cases.json")}
        tp = fp = fn = tn = 0
        for p in trig:
            r = json.loads(p.read_text())
            w = want[p.stem.rsplit("-", 1)[0]]
            tp += w and r["fired"]
            fn += w and not r["fired"]
            fp += (not w) and r["fired"]
            tn += (not w) and not r["fired"]
        s["trigger"] = {"tp": tp, "fp": fp, "fn": fn, "tn": tn,
                        "precision": round(tp / (tp + fp), 3) if tp + fp else None,
                        "recall": round(tp / (tp + fn), 3) if tp + fn else None}
    return s


def cmd_report(a) -> int:
    rows = [summarize(Path(a.out), lb) for lb in a.labels.split(",")]
    print(json.dumps(rows, indent=1))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("rewrite", "trigger"):
        sp = sub.add_parser(name)
        sp.add_argument("--skill", required=True)
        sp.add_argument("--label", required=True)
        sp.add_argument("--model", default="sonnet")
        sp.add_argument("--out", required=True)
        sp.add_argument("--jobs", type=int, default=4)
        sp.add_argument("--timeout", type=int, default=600)
        sp.add_argument("--max-turns", type=int, default=30)
        sp.add_argument("--reps", type=int, default=1)
    g = sub.add_parser("grade")
    g.add_argument("--out", required=True)
    g.add_argument("--label", required=True)
    g.add_argument("--judge-model", default="opus")
    g.add_argument("--jobs", type=int, default=4)
    g.add_argument("--timeout", type=int, default=300)
    r = sub.add_parser("report")
    r.add_argument("--out", required=True)
    r.add_argument("--labels", required=True)
    a = ap.parse_args()
    return {"rewrite": cmd_rewrite, "grade": cmd_grade, "trigger": cmd_trigger, "report": cmd_report}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
