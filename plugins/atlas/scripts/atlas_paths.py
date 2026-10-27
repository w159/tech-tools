#!/usr/bin/env python3
"""The one project-root resolver for atlas.

Runtime state (.atlas/.run, board, findings, DB project rows) must land at the
project root, never in a subdirectory, inside a .atlas folder, or in ~/.atlas.
Six walkers used to disagree on markers (.atlas and docs/ counted as roots, so
a stray .atlas or any subpackage with docs/ became a "root" and perpetuated
itself). Everything now delegates here.

Stdlib only, stat calls only, no subprocess: this runs on hot hook paths.
"""

from __future__ import annotations

import os
import tempfile

__all__ = ["project_root", "sanitize", "worktree_main_root"]


def sanitize(path):
    """Absolute path with everything from the first `.atlas` component down cut
    off, so a cwd or ATLAS_PROJECT_ROOT inside runtime state maps back to its
    owning project dir."""
    d = os.path.abspath(path or os.getcwd())
    parts = d.split(os.sep)
    if ".atlas" in parts:
        d = os.sep.join(parts[: parts.index(".atlas")]) or os.sep
    return d


def worktree_main_root(worktree):
    """Map a linked git worktree dir to the MAIN repo root, stdlib only.

    In a worktree, `.git` is a file (`gitdir: <main>/.git/worktrees/<n>`);
    that private git dir has a `commondir` file pointing at the main `.git`,
    whose parent is the main repo root. Returns None on anything unexpected
    (plain repos, submodule dirs, malformed files) so callers fail open.
    """
    try:
        with open(os.path.join(worktree, ".git"), "r", encoding="utf-8") as fh:
            content = fh.read()
    except OSError:
        return None
    git_dir = ""
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("gitdir:"):
            git_dir = stripped[len("gitdir:") :].strip()
            break
    if not git_dir:
        return None
    if not os.path.isabs(git_dir):
        git_dir = os.path.join(worktree, git_dir)
    try:
        with open(os.path.join(git_dir, "commondir"), "r", encoding="utf-8") as fh:
            common = fh.read().strip()
    except OSError:
        return None
    if not common:
        return None
    common_dir = os.path.normpath(
        common if os.path.isabs(common) else os.path.join(git_dir, common)
    )
    main_root = os.path.dirname(common_dir)
    return main_root if os.path.isdir(main_root) else None


def _is_non_project(path):
    """Mirror of atlas_db.not_a_project_root (exactly $HOME, ~/Downloads, bare
    temp roots), copied so hot paths never import the sqlite module."""
    real = os.path.realpath(path)
    home = os.path.realpath(os.path.expanduser("~"))
    if real in (home, os.path.join(home, "Downloads")):
        return True
    temps = {
        os.path.realpath(t) for t in ("/tmp", "/var/folders", tempfile.gettempdir())
    }
    return real in temps


def project_root(start=None):
    """Resolve the project root for `start` (default cwd).

    1. Cut at the first `.atlas` path component.
    2. Nearest ancestor with `.git`; a `.git` file (linked worktree) maps to
       the main worktree root. No level cap.
    3. No git: nearest ancestor holding a `.atlas` directory that is not
       $HOME or another non-project root.
    4. Otherwise the (sanitized) start dir.
    """
    d = sanitize(start)
    cur = d
    while True:
        git = os.path.join(cur, ".git")
        if os.path.exists(git):
            if os.path.isfile(git):
                return worktree_main_root(cur) or cur
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    cur = d
    while True:
        if os.path.isdir(os.path.join(cur, ".atlas")) and not _is_non_project(cur):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    return d
