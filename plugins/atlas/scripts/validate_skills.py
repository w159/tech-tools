#!/usr/bin/env python3
"""Deterministic best-practice check for every plugins/atlas/skills/*/SKILL.md.

Rules (each failure names the skill and rule):
  frontmatter  parses, has name and description
  name         matches the directory name
  desc         <= 400 chars and contains a when/trigger clause
  size         body <= BODY_BUDGET bytes (push detail into references/)
  refs         every ${CLAUDE_SKILL_DIR}/ or ${CLAUDE_PLUGIN_ROOT}/ path exists
  help         every referenced python script exits 0 on --help
  names        every mentioned atlas-* skill/agent name exists
  chars        no U+2013 U+2014 U+2018 U+2019 U+201C U+201D U+2026
  steps        every numbered step section has a completion line

Usage: validate_skills.py [--no-run] [--root PLUGIN_ROOT]   exit 1 on any failure.
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path

BODY_BUDGET = 14000  # bytes; measured max of the healthy skills is ~12.5 KB
DESC_MAX = 400
BANNED = "–—‘’“”…"
TRIGGER_RE = re.compile(
    r"\b(use when|use to|use for|use this|use after|use before|when|whenever|if the user|trigger)",
    re.I,
)
PATH_RE = re.compile(r"\$\{CLAUDE_(SKILL_DIR|PLUGIN_ROOT)\}/([A-Za-z0-9_./-]+)")
NAME_RE = re.compile(r"(?<![\w/.-])atlas-[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?!\.md|[\w-])")
STEP_RE = re.compile(r"^(#{2,4})\s+(?:Step\s+)?\d+[.:)]?\s", re.I)
DONE_RE = re.compile(
    r"done when|until|exit when|stop when|complete when|->|\u2192|=>|\bverif|\bconfirm|\bstop\b|\bmust (?:pass|be|exit)",
    re.I,
)
# Prose tokens shaped like skill names that are not skills or agents.
# atlas-work is named only to say it does not exist (atlas-plan).
NAME_ALLOW = {"atlas-work"}


def parse_frontmatter(text):
    m = re.match(r"---\n(.*?)\n---\n", text, re.S)
    if not m:
        return None, text
    fm = {}
    for line in m.group(1).splitlines():
        k, sep, v = line.partition(":")
        if sep and re.fullmatch(r"[a-z_-]+", k):
            v = v.strip()
            if len(v) > 1 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            fm[k] = v
    return fm, text[m.end() :]


def step_sections(body):
    """Yield (heading, section_text) for each numbered step heading."""
    lines = body.splitlines()
    for i, line in enumerate(lines):
        m = STEP_RE.match(line)
        if not m:
            continue
        level, chunk, fenced = len(m.group(1)), [], False
        for nxt in lines[i + 1 :]:
            if nxt.lstrip().startswith("```"):
                fenced = not fenced  # '#' inside a fence is a shell comment
            h = re.match(r"^(#{1,6})\s", nxt)
            if h and not fenced and len(h.group(1)) <= level:
                break
            chunk.append(nxt)
        yield line.strip(), "\n".join(chunk)


def check_skill(skill_md, root, names, run_help, help_cache):
    fails = []
    text = skill_md.read_text(encoding="utf-8")
    fm, body = parse_frontmatter(text)
    if fm is None or not fm.get("name") or not fm.get("description"):
        return [("frontmatter", "missing or incomplete name/description")], len(text)
    if fm["name"] != skill_md.parent.name:
        fails.append(("name", f"{fm['name']!r} != dir {skill_md.parent.name!r}"))
    d = fm["description"]
    if len(d) > DESC_MAX:
        fails.append(("desc", f"{len(d)} chars > {DESC_MAX}"))
    if not TRIGGER_RE.search(d):
        fails.append(("desc", "no when/trigger clause"))
    size = len(body.encode("utf-8"))
    if size > BODY_BUDGET:
        fails.append(
            ("size", f"body {size} B > {BODY_BUDGET}; move detail to references/")
        )
    for kind, rel in sorted(set(PATH_RE.findall(text))):
        rel = rel.rstrip(".,;:)")
        if "<" in rel or "*" in rel:
            continue
        base = skill_md.parent if kind == "SKILL_DIR" else root
        p = base / rel
        if not p.exists():
            fails.append(("refs", f"missing {kind}/{rel}"))
        elif run_help and p.suffix == ".py":
            if p not in help_cache:
                try:
                    r = subprocess.run(
                        [sys.executable, str(p), "--help"],
                        capture_output=True,
                        timeout=20,
                        stdin=subprocess.DEVNULL,
                        cwd=str(root),
                    )
                    help_cache[p] = r.returncode
                except subprocess.TimeoutExpired:
                    help_cache[p] = "timeout"
            if help_cache[p] != 0:
                fails.append(("help", f"{rel} --help -> {help_cache[p]}"))
    for n in sorted(set(NAME_RE.findall(text)) - names - NAME_ALLOW):
        # a hyphenated prefix of a longer real name, or a file stem, is not a mention
        if not any(x.startswith(n + "-") for x in names):
            fails.append(("names", f"unknown {n}"))
    bad = sorted({c for c in text if c in BANNED})
    if bad:
        fails.append(("chars", "banned " + " ".join(f"U+{ord(c):04X}" for c in bad)))
    for head, sec in step_sections(body):
        if not DONE_RE.search(sec):
            fails.append(("steps", f"no completion line under {head[:50]!r}"))
    return fails, len(text)


def run(root, run_help=True):
    names = {p.name for p in (root / "skills").iterdir() if p.is_dir()}
    names |= {p.stem for p in (root / "agents").glob("*.md")}
    results, cache = [], {}
    for md in sorted((root / "skills").glob("*/SKILL.md")):
        results.append(
            (md.parent.name,) + check_skill(md, root, names, run_help, cache)
        )
    return results


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    ap.add_argument(
        "--no-run", action="store_true", help="skip script --help execution"
    )
    a = ap.parse_args(argv)
    results = run(Path(a.root), not a.no_run)
    print(f"{'skill':32} {'bytes':>6}  status")
    failed = 0
    for name, fails, size in results:
        print(f"{name:32} {size:>6}  {'PASS' if not fails else 'FAIL'}")
        for rule, msg in fails:
            print(f"    [{rule}] {msg}")
        failed += bool(fails)
    print(
        f"\n{len(results) - failed}/{len(results)} skills pass; total {sum(r[2] for r in results)} bytes"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
