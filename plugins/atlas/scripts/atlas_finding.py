#!/usr/bin/env python3
"""Append one verdict to `.atlas/.run/findings.json`.

Why this exists: the completion gate's condition (b) requires an entry with
status "verified" in findings.json, but atlas:verifier runs with
`disallowedTools` blocking Write/Edit/NotebookEdit (and legacy MultiEdit). It had no write path to the file
its verdict is supposed to land in, so verdicts came back as prose, the gate
tripped, and the orchestrator re-dispatched. Bash IS allowed to the verifier,
so this CLI is the write path: one command, no file bytes in context, no
chance of corrupting the ledger with a hand-rolled heredoc.

Schema is the one in atlas-orchestrate/references/scaffolding.md. The `status`
enum is verified | rejected | needs-evidence | open, and only "verified"
satisfies the gate.

Usage:
    python3 atlas_finding.py --id S3 --status verified \\
        --title "budget read path sums all income rows" \\
        --evidence "backend/tests/test_budget.py::test_multi_income" \\
        --reproduction "pytest backend/tests/test_budget.py -q"

Exits 0 on success and prints the written entry. Exits 1 with a message on a
bad status or an unwritable path -- a silent failure here would recreate the
exact bug this file fixes.

Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

STATUSES = ("verified", "rejected", "needs-evidence", "open")
RELPATH = (".atlas", ".run", "findings.json")


def find_root(start: Path) -> Path | None:
    """Nearest ancestor holding docs/ or .atlas/ -- same root notion the gate uses."""
    for candidate in [start, *start.parents]:
        if (candidate / "docs").is_dir() or (candidate / ".atlas").is_dir():
            return candidate
    return None


def load(path: Path) -> list:
    """Existing findings as a list. A missing or unreadable file starts fresh;
    a file holding {"findings": [...]} is unwrapped so both shapes round-trip."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError):
        return []
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        items = data.get("findings")
        return items if isinstance(items, list) else []
    return []


def save(path: Path, findings: list) -> None:
    """Atomic write so a crash mid-append cannot truncate the durable ledger."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / (".%s.tmp%d" % (path.name, os.getpid()))
    tmp.write_text(json.dumps(findings, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def build_entry(args: argparse.Namespace) -> dict:
    return {
        "id": args.id,
        "surface": args.surface,
        "category": args.category,
        "severity": args.severity,
        "title": args.title,
        "evidence": args.evidence or [],
        "doc_refs": args.doc_ref or [],
        "reproduction": args.reproduction or "",
        "proposed_fix": args.proposed_fix or "",
        "blast_radius": args.blast_radius,
        "status": args.status,
        "verified_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "verified_by": args.by,
    }


def main(argv: list | None = None) -> int:
    p = argparse.ArgumentParser(description="Append a verdict to findings.json")
    p.add_argument("--id", required=True, help="stage or finding id, e.g. S3 or BE-014")
    p.add_argument("--status", required=True, choices=STATUSES)
    p.add_argument("--title", required=True, help="one line")
    p.add_argument("--evidence", action="append", help="repeatable: path, test id, log")
    p.add_argument("--reproduction", help="exact command that demonstrates it")
    p.add_argument("--proposed-fix", dest="proposed_fix")
    p.add_argument("--doc-ref", action="append")
    p.add_argument("--surface", default="backend")
    p.add_argument("--category", default="correctness")
    p.add_argument("--severity", default="medium")
    p.add_argument("--blast-radius", dest="blast_radius", default="module")
    p.add_argument("--by", default="atlas:verifier")
    p.add_argument("--root", help="project root; defaults to detection from cwd")
    args = p.parse_args(argv)

    root = Path(args.root) if args.root else find_root(Path.cwd())
    if root is None:
        print(
            "atlas_finding: no project root (no docs/ or .atlas/ above cwd). "
            "Pass --root explicitly.",
            file=sys.stderr,
        )
        return 1

    path = root.joinpath(*RELPATH)
    entry = build_entry(args)
    findings = load(path)
    findings.append(entry)
    try:
        save(path, findings)
    except OSError as exc:
        print("atlas_finding: could not write %s: %s" % (path, exc), file=sys.stderr)
        return 1
    print("wrote %s -> %s" % (path, json.dumps(entry)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
