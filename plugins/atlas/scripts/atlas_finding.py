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
    python3 atlas_finding.py recent [-n 5]   # newest durable records
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
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas_paths  # noqa: E402
from atlas_memory import _file_lock  # noqa: E402

STATUSES = ("verified", "rejected", "needs-evidence", "open")
RELPATH = (".atlas", ".run", "findings.json")
TERMINAL = ("verified", "rejected")
_MARK = ("<!-- atlas-findings:start -->", "<!-- atlas-findings:end -->")
_REC = re.compile(r"^\d{4}-\d\d-\d\d_.+\.md$")


def find_root(start: Path) -> Path | None:
    """Project root for start via the shared resolver (atlas_paths), or None
    when it holds no .git, docs/ or .atlas/ (a bare dir is not a project)."""
    root = Path(atlas_paths.project_root(str(start)))
    markers = (".git", "docs", ".atlas")
    return root if any((root / m).exists() for m in markers) else None


def _quarantine(path: Path) -> Path | None:
    """Move an unparseable ledger aside (findings.json.corrupt-<ns>) so a later
    save cannot silently erase it. Returns the new path, or None if the move failed."""
    dest = path.with_name(f"{path.name}.corrupt-{time.time_ns()}")
    try:
        os.replace(path, dest)
    except OSError:
        return None
    return dest


def load(path: Path) -> list:
    """Existing findings as a list. A missing file starts fresh; a file holding
    {"findings": [...]} is unwrapped so both shapes round-trip. A file that exists
    but is unreadable/corrupt is quarantined with a stderr warning, never dropped."""
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return []
    except OSError:
        text = None
    data = None
    if text is not None:
        try:
            data = json.loads(text)
        except ValueError:
            data = None
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("findings"), list):
        return data["findings"]
    moved = _quarantine(path)
    print(
        "atlas_finding: WARNING %s is corrupt or not a findings ledger; %s"
        % (path, "preserved as %s" % moved if moved else "could not be preserved"),
        file=sys.stderr,
    )
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


# --- durable per-finding records ----------------------------------------------
# findings.json is run scratch; a terminal verdict is also written to
# <root>/.atlas/findings/<date>_<slug>.md so later sessions can retrieve it.


def _slug(fid) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(fid).lower()).strip("-") or "finding"


def _as_list(v) -> list:
    return [str(x) for x in v] if isinstance(v, list) else ([str(v)] if v else [])


def _record_id(path: Path) -> str:
    try:
        for line in path.read_text(encoding="utf-8").splitlines()[:12]:
            if line.startswith("- id: "):
                return line[6:].strip()
    except OSError:
        pass
    return ""


def _find_record(fdir: Path, fid: str) -> Path | None:
    """The one record for fid, or None. A slug collision between two different
    ids gets a numeric suffix, so the id line (not the name) is the identity."""
    base = _slug(fid)
    for cand in sorted(fdir.glob("*_%s.md" % base)) + sorted(fdir.glob("*_%s-[0-9]*.md" % base)):
        if _record_id(cand) == str(fid):
            return cand
    return None


def _render(fid, entries: list) -> str:
    last = entries[-1]
    ev = _as_list(last.get("evidence"))
    refs = _as_list(last.get("doc_refs"))
    hist = [
        "- %s %s by %s: %s"
        % (e.get("verified_at", "?"), e.get("status"), e.get("verified_by") or e.get("verifier", "?"),
           str(e.get("title") or e.get("claim") or "")[:120])
        for e in entries[:-1]
    ]
    out = [
        "# %s: %s" % (fid, last.get("title") or last.get("claim") or ""),
        "",
        "- id: %s" % fid,
        "- status: %s" % last.get("status"),
        "- verified_by: %s" % (last.get("verified_by") or last.get("verifier", "")),
        "- verified_at: %s" % last.get("verified_at", ""),
        "",
        "## Evidence",
        *(["- %s" % x for x in ev] or ["- none recorded"]),
        "",
        "## Reproduction",
        str(last.get("reproduction") or "none recorded"),
        "",
        "## Proposed fix",
        str(last.get("proposed_fix") or "none recorded"),
        "",
        "## Doc refs",
        *(["- %s" % x for x in refs] or ["- none"]),
        "",
        "## History",
        *(hist or ["- no earlier verdicts"]),
        "",
    ]
    return "\n".join(out)


def sync_record(root: Path, findings: list, fid, apply: bool = True) -> Path | None:
    """Write or update the single record for fid from its ledger entries.
    Returns the path, or None when fid has no terminal verdict yet."""
    entries = [e for e in findings if isinstance(e, dict) and e.get("id") == fid]
    term = [e for e in entries if e.get("status") in TERMINAL]
    if not term:
        return None
    fdir = Path(root) / ".atlas" / "findings"
    path = _find_record(fdir, fid)
    if path is None:
        date = str(term[0].get("verified_at") or "")[:10]
        if not re.match(r"^\d{4}-\d\d-\d\d$", date):
            date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        base, n = _slug(fid), 1
        path = fdir / ("%s_%s.md" % (date, base))
        while path.exists():  # same slug, different id
            n += 1
            path = fdir / ("%s_%s-%d.md" % (date, base, n))
    if apply:
        fdir.mkdir(parents=True, exist_ok=True)
        path.write_text(_render(fid, entries), encoding="utf-8")
    return path


def _scan(root: Path) -> list:
    """[{date, id, status, title, path}] for every record, newest first."""
    fdir = Path(root) / ".atlas" / "findings"
    rows = []
    for f in fdir.glob("*.md") if fdir.is_dir() else []:
        if not _REC.match(f.name):
            continue
        meta = {}
        try:
            lines = f.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for line in lines[:12]:
            m = re.match(r"^- (id|status): (.*)$", line)
            if m:
                meta[m.group(1)] = m.group(2).strip()
        title = lines[0].split(": ", 1)[-1] if lines else ""
        rows.append({"date": f.name[:10], "id": meta.get("id", ""), "status": meta.get("status", ""),
                     "title": title, "path": str(f)})
    return sorted(rows, key=lambda r: (r["date"], r["path"]), reverse=True)


def rebuild_index(root: Path) -> Path:
    """Rewrite the generated table in findings/INDEX.md; text outside the
    markers (the hand-kept header and legacy rows) is left alone."""
    idx = Path(root) / ".atlas" / "findings" / "INDEX.md"
    rows = _scan(root)
    table = ["| Date | Id | Status | Title | Link |", "|---|---|---|---|---|"]
    for r in rows:
        title = r["title"].replace("|", "/")
        table.append("| %s | %s | %s | %s | [%s](%s) |" % (
            r["date"], r["id"].replace("|", "/"), r["status"], title,
            Path(r["path"]).name, Path(r["path"]).name))
    block = "\n".join([_MARK[0], *table, _MARK[1]])
    try:
        text = idx.read_text(encoding="utf-8")
    except OSError:
        text = "# Findings index\n\nDurable, dated record of stamped findings.\n"
    if _MARK[0] in text and _MARK[1] in text:
        a, b = text.index(_MARK[0]), text.index(_MARK[1]) + len(_MARK[1])
        text = text[:a] + block + text[b:]
    else:
        text = text.rstrip("\n") + "\n\n## Stamped records\n\n" + block + "\n"
    idx.parent.mkdir(parents=True, exist_ok=True)
    idx.write_text(text, encoding="utf-8")
    return idx


def backfill_findings(root, apply: bool = False) -> dict:
    """Records for every terminal finding already in findings.json that has none.
    Dry-run unless apply. Entries without an id (older batch/claim shape) cannot
    be keyed per id and are counted in `no_id`, not written."""
    root = Path(root)
    findings = load(root.joinpath(*RELPATH))
    ids = list(dict.fromkeys(e["id"] for e in findings if isinstance(e, dict) and e.get("id")))
    no_id = sum(1 for e in findings if isinstance(e, dict) and not e.get("id") and e.get("status") in TERMINAL)
    todo, have = [], 0
    for fid in ids:
        if not any(e.get("id") == fid and e.get("status") in TERMINAL for e in findings if isinstance(e, dict)):
            continue
        if _find_record(root / ".atlas" / "findings", fid):
            have += 1
        else:
            todo.append(fid)
    if apply:
        for fid in todo:
            sync_record(root, findings, fid)
        if todo:
            rebuild_index(root)
    return {"would_write" if not apply else "wrote": len(todo), "already_recorded": have, "no_id_skipped": no_id}


def missing_records(root) -> int:
    return backfill_findings(root, apply=False).get("would_write", 0)


def recent(root, n: int = 5) -> list:
    """Newest n records as [{id, title, status, path}]."""
    return [{k: r[k] for k in ("id", "title", "status", "path")} for r in _scan(Path(root))[:n]]


def main(argv: list | None = None) -> int:
    argv = sys.argv[1:] if argv is None else list(argv)
    if argv[:1] == ["recent"]:
        rp = argparse.ArgumentParser(prog="atlas_finding.py recent")
        rp.add_argument("-n", type=int, default=5)
        rp.add_argument("--root")
        ra = rp.parse_args(argv[1:])
        rroot = Path(ra.root) if ra.root else find_root(Path.cwd())
        for r in recent(rroot, ra.n) if rroot else []:
            print("%s [%s] %s -> %s" % (r["id"], r["status"], r["title"], r["path"]))
        return 0
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
    try:
        with _file_lock(path):
            findings = load(path)
            findings.append(entry)
            save(path, findings)
    except OSError as exc:
        print("atlas_finding: could not write %s: %s" % (path, exc), file=sys.stderr)
        return 1
    print("wrote %s -> %s" % (path, json.dumps(entry)))
    if entry["status"] in TERMINAL:
        try:  # fail open: the ledger write above is the gate's source of truth
            if sync_record(root, findings, entry["id"]):
                rebuild_index(root)
        except Exception as exc:
            print("atlas_finding: record not written: %s" % exc, file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
