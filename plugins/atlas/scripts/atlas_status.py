#!/usr/bin/env python3
"""Stakeholder-readable status rollup for a plan or feature (persona P9).

Assembles docs/plans/<name>.md, latest verified entries from
.atlas/.run/findings.json, the todo board (via atlas_todo read APIs), and
`git log --oneline` since the last tag, then prints a markdown report.
Every claim is labeled verified (evidence present) or assumed.
"""

import argparse
import datetime
import json
import os
import re
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)
import atlas_todo  # noqa: E402

NONE = "— (none)"
MAX_VERIFIED = 5
MAX_ASSUMED = 3


def _git(root, *args):
    try:
        out = subprocess.run(
            ("git", "-C", root) + args, capture_output=True, text=True, timeout=15
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def find_plan(root, name):
    """docs/plans/<name>.md; accepts the name with or without .md, or a
    substring of a dated plan filename."""
    plans = os.path.join(root, "docs", "plans")
    if not os.path.isdir(plans):
        return None
    base = name[:-3] if name.endswith(".md") else name
    exact = os.path.join(plans, base + ".md")
    if os.path.isfile(exact):
        return exact
    try:
        names = os.listdir(plans)
    except OSError:
        return None
    matches = sorted(f for f in names if f.endswith(".md") and base in f)
    return os.path.join(plans, matches[0]) if matches else None


def load_findings(root):
    path = os.path.join(root, ".atlas", ".run", "findings.json")
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _has_evidence(entry):
    ev = entry.get("evidence")
    if isinstance(ev, (list, tuple)):
        return bool(ev)
    return bool(ev and str(ev).strip())


def is_verified(entry):
    return entry.get("status") == "verified" and _has_evidence(entry)


def _evidence_brief(entry):
    ev = entry.get("evidence")
    text = "; ".join(str(x) for x in ev) if isinstance(ev, (list, tuple)) else str(ev)
    return text.strip()[:160]


def _verified_at(entry):
    ts = str(entry.get("verified_at") or "")
    return ts if ts else ""


def plan_section(root, name):
    path = find_plan(root, name)
    if not path:
        return NONE, None
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except OSError:
        return NONE, None
    headings = [line.lstrip("# ").strip() for line in lines if line.startswith("#")]
    planned = sum(1 for line in lines if "- [ ]" in line)
    done = sum(1 for line in lines if "- [x]" in line or "- [X]" in line)
    units = (
        f"{done}/{planned + done} task boxes checked"
        if planned + done
        else "no task boxes"
    )
    body = [f"Plan doc: `{os.path.relpath(path, root)}` — {units}."]
    if headings:
        body.append(
            "Sections: " + ", ".join(headings[:8]) + ("…" if len(headings) > 8 else "")
        )
    return "\n".join(body), path


def findings_section(entries):
    if not entries:
        return NONE
    verified = [e for e in entries if is_verified(e)]
    assumed = [
        e for e in entries if not is_verified(e) and e.get("status") != "rejected"
    ]
    out = [
        f"{len(verified)} verified · {len(assumed)} assumed/unverified claims on file."
    ]
    for e in verified[-MAX_VERIFIED:][::-1]:
        title = e.get("title") or e.get("claim") or "(untitled)"
        out.append(f"- ✅ **verified** — {title} (_{_evidence_brief(e)}_)")
    for e in assumed[-MAX_ASSUMED:][::-1]:
        title = e.get("title") or e.get("claim") or "(untitled)"
        out.append(
            f"- ⚠️ **assumed** — {title} (status: {e.get('status') or 'unlabeled'})"
        )
    return "\n".join(out)


def todos_section(root):
    try:
        board = atlas_todo.load(root)
    except Exception:
        return NONE
    items = board.get("items", []) if isinstance(board, dict) else []
    items = [i for i in items if not i.get("archived")]
    if not items:
        return NONE
    counts = atlas_todo.counts(board)
    out = [
        f"{counts.get('complete', 0)}/{counts.get('needed', 0)} complete "
        f"({counts.get('remaining', 0)} remaining)."
    ]
    open_items = [i for i in items if i.get("status") != "completed"]
    for i in open_items[:8]:
        owner = f" — {i['owner']}" if i.get("owner") else ""
        content = str(i.get("content") or "").strip()[:110]
        out.append(f"- ⏳ {i.get('id')}: {content}{owner}")
    if len(open_items) > 8:
        out.append(f"- … and {len(open_items) - 8} more open")
    return "\n".join(out)


VERSION_TAG_RE = re.compile(r"^v?\d+\.\d+\.\d+")


def _version_tag(tags):
    """First version-shaped tag (e.g. v10.4.2) from newest-first tag names.

    Ignores internal/worktree branch tags like `ref-orca` so stakeholder
    reports never anchor on a non-release marker.
    """
    for tag in tags:
        if VERSION_TAG_RE.match(tag.strip()):
            return tag.strip()
    return None


def _release_tag(root):
    tags = _git(root, "tag", "--merged", "HEAD", "--sort=-creatordate")
    return _version_tag(tags.splitlines()) if tags else None


def git_section(root):
    tag = _release_tag(root)
    if tag:
        log = _git(root, "log", "--oneline", f"{tag}..HEAD")
        if not log:
            return f"No commits since tag `{tag}`."
        lines = log.splitlines()
        out = [f"{len(lines)} commits since `{tag}`."]
    else:
        log = _git(root, "log", "--oneline", "-20", "HEAD")
        if not log:
            return NONE + " (no commits)"
        lines = log.splitlines()
        out = ["(no release tag found; last 20 commits)"]
    out.extend(f"- {line}" for line in lines[:10])
    if len(lines) > 10:
        out.append(f"- … and {len(lines) - 10} more")
    return "\n".join(out)


def build_report(name, root):
    plan_body, plan_path = plan_section(root, name)
    entries = load_findings(root)
    today = datetime.date.today().isoformat()
    report = [
        f"# Status: {name}",
        f"_Generated {today} · every claim labeled **verified** (evidence on file) or "
        f"**assumed** (recorded without evidence)._",
        "",
        "## Plan",
        plan_body,
        "",
        "## Findings",
        findings_section(entries),
        "",
        "## Todos",
        todos_section(root),
        "",
        "## Recent work (git)",
        git_section(root),
        "",
    ]
    return "\n".join(report)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Stakeholder-readable status rollup for a plan or feature."
    )
    parser.add_argument("name", help="plan or feature name (docs/plans/<name>.md)")
    parser.add_argument(
        "--root", default=os.getcwd(), help="repo root (default: current directory)"
    )
    args = parser.parse_args(argv)
    print(build_report(args.name, args.root))
    return 0


if __name__ == "__main__":
    sys.exit(main())
