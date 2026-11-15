#!/usr/bin/env python3
"""Deterministic before/after evidence for atlas team isolation.

Builds 20 two-writer overlap cases in temp git repos (8 same-file different-hunk, 6 same-line, 6 disjoint
files) and counts the 40 edits under four modes:
  naive     two writers share one checkout; both read, both write their whole-file result, the second write
            wins. NOT how Claude Code edits: kept only as a labeled "naive overwrite (upper bound)" row.
  shared    two writers share one checkout and use Claude Code's Edit semantics: the exact old_string is
            replaced in the file as it is NOW, and the edit is REFUSED when the file changed since the
            writer read it or old_string is absent. A refused edit is not lost; the writer must re-read
            and retry.
  worktree  each writer commits on its own worker branch/worktree; atlas_mux._merge_back merges them. An
            edit on a kept conflicting branch is CONFLICTED (unmerged), never merged.
  auto      atlas_mux.resolve_isolation (no env override, members declare the files they edit) picks shared
            or worktree per case; the case is then scored under that choice.

Per mode: merged (in the lead tree), refused (needs retry), conflicted (kept branch, unmerged), lost
(applied then overwritten, or merged away; never expected outside "naive").
Run: python3 atlas_isolation_bench.py   (no tmux, no claude, no network; prints a table)
"""
from __future__ import annotations

import argparse
import atexit
import functools
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
_IDENT = dict(GIT_AUTHOR_NAME="bench", GIT_AUTHOR_EMAIL="b@b", GIT_COMMITTER_NAME="bench", GIT_COMMITTER_EMAIL="b@b")
if "ATLAS_HOME" not in os.environ:
    _HOME = tempfile.mkdtemp(prefix="atlas-bench-home-")
    os.environ["ATLAS_HOME"] = _HOME
    atexit.register(shutil.rmtree, _HOME, ignore_errors=True)

import atlas_mux  # noqa: E402

BASE = "".join(f"line {i}\n" for i in range(1, 41))


def build_cases() -> list:
    """(kind, {file: base text}, [(file, old, new) for writer A], [... for writer B])."""
    cases = []
    for i in range(8):  # same file, far-apart hunks
        a, b = 2 + i, 30 + i
        cases.append(("same-file-diff-hunk", {"f.txt": BASE},
                      [("f.txt", f"line {a}\n", f"line {a} A\n")], [("f.txt", f"line {b}\n", f"line {b} B\n")]))
    for i in range(6):  # same line
        n = 10 + i
        cases.append(("same-line", {"f.txt": BASE},
                      [("f.txt", f"line {n}\n", f"line {n} A\n")], [("f.txt", f"line {n}\n", f"line {n} B\n")]))
    for i in range(6):  # different files
        cases.append(("disjoint-files", {"a.txt": BASE, "b.txt": BASE},
                      [("a.txt", f"line {3 + i}\n", f"line {3 + i} A\n")], [("b.txt", f"line {3 + i}\n", f"line {3 + i} B\n")]))
    return cases


def _with_identity(fn):
    """Run fn with the bench git identity in os.environ, restoring the prior values (no process-wide leak)."""
    @functools.wraps(fn)
    def wrapper(*a, **kw):
        saved = {k: os.environ.get(k) for k in _IDENT}
        os.environ.update(_IDENT)
        try:
            return fn(*a, **kw)
        finally:
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
    return wrapper


def _git(repo: str, *a: str) -> str:
    return subprocess.run(["git", "-C", repo, *a], check=True, capture_output=True, text=True).stdout.strip()


@_with_identity
def _repo(tmp: str, files: dict) -> str:
    repo = os.path.join(tmp, "repo")
    os.mkdir(repo)
    _git(repo, "init", "-q", "-b", "main")
    for name, text in files.items():
        Path(repo, name).write_text(text)
    _git(repo, "add", ".")
    _git(repo, "commit", "-q", "-m", "base")
    return repo


def _count(edits_a: list, edits_b: list, status_of) -> dict:
    out = {"merged": 0, "refused": 0, "conflicted": 0, "lost": 0}
    for who, edits in (("a", edits_a), ("b", edits_b)):
        for e in edits:
            out[status_of(who, e)] += 1
    return out


def run_naive(files: dict, edits_a: list, edits_b: list) -> dict:
    """Whole-file last-write-wins (upper bound on loss; Claude Code's Edit tool does not behave this way)."""
    tmp = tempfile.mkdtemp()
    try:
        repo = _repo(tmp, files)
        snap = {n: Path(repo, n).read_text() for n in files}
        out_a, out_b = dict(snap), dict(snap)
        for f, old, new in edits_a:
            out_a[f] = out_a[f].replace(old, new)
        for f, old, new in edits_b:
            out_b[f] = out_b[f].replace(old, new)
        for out in (out_a, out_b):
            for n in files:
                if out[n] != snap[n]:
                    Path(repo, n).write_text(out[n])
        text = {n: Path(repo, n).read_text() for n in files}
        return _count(edits_a, edits_b, lambda _w, e: "merged" if e[2] in text[e[0]] else "lost")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def edit_tool(repo: str, f: str, snapshot: str, old: str, new: str) -> str:
    """Claude Code Edit semantics: replace the exact old_string in the CURRENT file. Returns "applied",
    "refused-stale" (file changed since the writer read it) or "refused-missing" (old_string not found)."""
    p = Path(repo, f)
    cur = p.read_text()
    if cur != snapshot:
        return "refused-stale"
    if old not in cur:
        return "refused-missing"
    p.write_text(cur.replace(old, new, 1))
    return "applied"


def run_shared(files: dict, edits_a: list, edits_b: list) -> dict:
    """Both writers read first (the interleaving that makes shared trees collide), then A edits, then B."""
    tmp = tempfile.mkdtemp()
    try:
        repo = _repo(tmp, files)
        snaps = {n: Path(repo, n).read_text() for n in files}  # each writer's read of each file
        verdict = {}
        for who, edits in (("a", edits_a), ("b", edits_b)):
            for e in edits:
                verdict[(who, e)] = edit_tool(repo, e[0], snaps[e[0]], e[1], e[2])
        text = {n: Path(repo, n).read_text() for n in files}

        def status(who, e):
            if verdict[(who, e)] != "applied":
                return "refused"
            return "merged" if e[2] in text[e[0]] else "lost"

        return _count(edits_a, edits_b, status)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


@_with_identity
def run_worktree(files: dict, edits_a: list, edits_b: list) -> dict:
    tmp = tempfile.mkdtemp()
    try:
        repo = _repo(tmp, files)
        rec = {"isolation": "worktree", "team_id": "bench", "members": [
            {"name": "implementer-1", "role": "implementer"}, {"name": "implementer-2", "role": "implementer"}]}
        plan = atlas_mux.worktree_plan(rec, repo)
        for (name, wt), edits in zip(sorted(plan.items()), (edits_a, edits_b)):
            if (err := atlas_mux.add_worktree(repo, wt)):
                raise RuntimeError(err)
            for f, old, new in edits:
                p = Path(wt["path"], f)
                p.write_text(p.read_text().replace(old, new))
            _git(wt["path"], "commit", "-q", "-am", f"{name} edit")
        rec["worktrees"] = plan
        merged, conflicted, skipped = atlas_mux._merge_back(repo, rec)
        atlas_mux._reap_worktrees(repo, rec)
        text = {n: Path(repo, n).read_text() for n in files}
        kept = {c["member"] for c in conflicted}
        branches = _git(repo, "branch", "--format=%(refname:short)").split()
        for c in conflicted:
            assert c["branch"] in branches, "conflicting branch must be kept"
        assert not skipped, skipped
        owner = {"a": sorted(plan)[0], "b": sorted(plan)[1]}

        def status(who, e):
            m = owner[who]
            if m in kept:
                return "conflicted"  # kept on a branch, NOT in the lead tree
            return "merged" if m in merged and e[2] in text[e[0]] else "lost"

        return _count(edits_a, edits_b, status)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def resolve_auto(files: dict, edits_a: list, edits_b: list) -> str:
    """The mode atlas_mux.resolve_isolation('auto') picks for this case: no cell, no ATLAS_ISOLATION, each
    writer declaring the files it edits."""
    tmp = tempfile.mkdtemp()
    saved = os.environ.pop("ATLAS_ISOLATION", None)
    try:
        repo = _repo(tmp, files)
        rec = {"members": [
            {"name": "implementer-1", "role": "implementer", "paths": sorted({f for f, _, _ in edits_a})},
            {"name": "implementer-2", "role": "implementer", "paths": sorted({f for f, _, _ in edits_b})}]}
        atlas_mux.resolve_isolation(rec, repo)
        return rec["isolation"]
    finally:
        if saved is not None:
            os.environ["ATLAS_ISOLATION"] = saved
        shutil.rmtree(tmp, ignore_errors=True)


def run_auto(files: dict, edits_a: list, edits_b: list) -> dict:
    mode = resolve_auto(files, edits_a, edits_b)
    r = (run_worktree if mode == "worktree" else run_shared)(files, edits_a, edits_b)
    return dict(r, chose=mode)


MODES = (
    ("naive overwrite (upper bound)", run_naive),
    ("shared (Edit semantics)", run_shared),
    ("worktree", run_worktree),
    ("auto", run_auto),
)
KEYS = ("merged", "refused", "conflicted", "lost")


def main(argv: list | None = None) -> int:
    argparse.ArgumentParser(
        prog="atlas_isolation_bench",
        description="Run 20 two-writer overlap cases (40 edits) in temp git repos under naive overwrite, shared "
        "tree with Edit semantics, worktree isolation and the auto choice; print merged / refused (needs retry) / "
        "conflicted (unmerged) / lost per mode. Exit 1 if worktree or auto loses an edit.",
    ).parse_args(argv)
    rows: dict = {}
    for kind, files, ea, eb in build_cases():
        for mode, fn in MODES:
            r = fn(files, ea, eb)
            agg = rows.setdefault((kind, mode), {"cases": 0, "chose": {}, **{k: 0 for k in KEYS}})
            agg["cases"] += 1
            for k in KEYS:
                agg[k] += r[k]
            if "chose" in r:
                agg["chose"][r["chose"]] = agg["chose"].get(r["chose"], 0) + 1
    order = {m: i for i, (m, _) in enumerate(MODES)}
    print(f"{'case kind':<21}{'mode':<31}{'cases':>6}{'merged':>8}{'refused':>9}{'conflicted':>12}{'lost':>6}  chose")
    totals: dict = {}
    for (kind, mode), a in sorted(rows.items(), key=lambda kv: (order[kv[0][1]], kv[0][0])):
        chose = " ".join(f"{m}:{n}" for m, n in sorted(a["chose"].items()))
        print(f"{kind:<21}{mode:<31}{a['cases']:>6}{a['merged']:>8}{a['refused']:>9}{a['conflicted']:>12}{a['lost']:>6}  {chose}")
        t = totals.setdefault(mode, {"cases": 0, "chose": {}, **{k: 0 for k in KEYS}})
        t["cases"] += a["cases"]
        for k in KEYS:
            t[k] += a[k]
        for m, n in a["chose"].items():
            t["chose"][m] = t["chose"].get(m, 0) + n
    for mode, _ in MODES:
        a = totals[mode]
        chose = " ".join(f"{m}:{n}" for m, n in sorted(a["chose"].items()))
        print(f"{'TOTAL':<21}{mode:<31}{a['cases']:>6}{a['merged']:>8}{a['refused']:>9}{a['conflicted']:>12}{a['lost']:>6}  {chose}")
    print("edits: 2 per case. refused = shared-tree Edit refused (stale read or old_string absent), needs retry; "
          "conflicted = kept worker branch, not in the lead tree.")
    return 0 if totals["worktree"]["lost"] == 0 and totals["auto"]["lost"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
