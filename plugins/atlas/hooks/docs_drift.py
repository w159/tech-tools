#!/usr/bin/env python3
"""Shared docs-drift primitives used by completion_gate.py (Stop, condition f)
and docs_drift_watch.py (PostToolUse, inline warning).

Extracted so the two hooks share one definition of "drift" instead of two
copies drifting apart from each other -- the ironic failure mode for a
docs-drift detector. Pure functions plus one subprocess-backed git helper;
no atlas_db, no hookstate. Callers own their own fail-open handling.

Stdlib only.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

__all__ = ["find_root", "docs_drift", "git_changed_paths"]


def find_root(start: Path) -> Path | None:
    """Walk from start toward the filesystem root; return the project root
    holding a `docs/` directory -- the project-documentation SSOT that
    atlas-setup scaffolds. Stops at the filesystem root or after 6 levels to
    stay cheap and fail-open.
    """
    candidate = start
    for _ in range(7):
        if (candidate / "docs").is_dir():
            return candidate
        parent = candidate.parent
        if parent == candidate:
            break
        candidate = parent
    return None


def docs_drift(changed_paths: list) -> bool:
    """Return True when >=1 non-docs file changed and `docs/CHANGELOG.md` did not.

    Previously ANY `docs/` path cleared this, which made condition (f)
    satisfiable by touching any single document. A one-line edit to a
    `docs/architecture/` scratch file kept the gate quiet while the CHANGELOG,
    the ROADMAP and the README all rotted -- the check reported "docs moved"
    when what it actually needs to know is "was the record of this change
    written". `docs-ssot.md` names the CHANGELOG specifically in its definition
    of done ("Before any change is called done: CHANGELOG updated"), and
    condition (c) already requires the file to exist, so the CHANGELOG is what
    clears drift.

    A path is 'docs' if it starts with 'docs/' or contains '/docs/', so a
    docs-only run never counts as drift regardless of the CHANGELOG.
    Pure helper: takes a list of relative path strings, does no I/O.
    """
    if not changed_paths:
        return False
    nondocs = False
    for p in changed_paths:
        rel = str(p).replace("\\", "/")
        if rel == "docs/CHANGELOG.md" or rel.endswith("/docs/CHANGELOG.md"):
            return False  # the record of this change was written
        if not (rel.startswith("docs/") or "/docs/" in rel):
            nondocs = True
    return nondocs


def git_changed_paths(root: Path) -> list:
    """Return changed file paths from git diff HEAD and the staged index.

    Uses the repo root detected from the project root. Fails open on a
    non-repo path or git command error (returns [] so the caller treats it as
    no drift). A missing git binary (FileNotFoundError) is propagated so the
    caller can fail-closed -- silently passing docs-drift when git is
    genuinely unavailable would let unverified code ship.
    """
    try:
        root_bytes = subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "--show-toplevel"],
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
        repo_root = root_bytes.decode(errors="replace").strip()
    except FileNotFoundError as exc:
        raise RuntimeError("git unavailable: could not run git (%s)" % exc) from exc
    except Exception:
        return []

    paths: set = set()
    for args in (
        ["git", "-C", repo_root, "diff", "--name-only", "HEAD"],
        ["git", "-C", repo_root, "diff", "--name-only", "--cached"],
    ):
        try:
            out = subprocess.check_output(args, stderr=subprocess.DEVNULL, timeout=5)
            for line in out.decode(errors="replace").splitlines():
                line = line.strip()
                if line:
                    paths.add(line)
        except Exception:
            pass  # fail-open: any git error -> treat as no new paths
    return list(paths)
