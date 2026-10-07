#!/usr/bin/env python3
"""Scope check for orchestration gates: do they belong in this directory at all?

Gates (recall gate, dispatch tripwire, lean-ctx routing denies) make sense in a
real project. In throwaway scratch dirs (/tmp, mux bench runs) and in
directories with no project marker they only generate noise denies.

``gates_armed(cwd)`` is False for scratch roots, for $HOME itself, and for a cwd
with no project marker in itself or any ancestor below $HOME -- unless the atlas
DB (env ATLAS_DB, default ~/.atlas/atlas.db) holds a project row whose root_path
is cwd with at least one dispatch ever. Env ``ATLAS_GATES=always`` forces
True, ``ATLAS_GATES=off`` forces False. Never raises: on any error it returns
True. omp/scope.ts mirrors this rule; hooks/test_atlas_contract.py asserts the
two marker lists stay identical.
"""

from __future__ import annotations

import os
import sqlite3
from urllib.parse import quote

SCRATCH_ROOTS = ("/tmp", "/private/tmp", "/var/folders", "/private/var/folders")
PROJECT_MARKERS = (
    ".git",
    ".claude",
    ".atlas",
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "CLAUDE.md",
    "AGENTS.md",
)


_HISTORY_SQL = (
    "SELECT 1 FROM projects p JOIN runs r ON r.project_id=p.id "
    "JOIN dispatches d ON d.run_id=r.id WHERE p.root_path IN (?,?) LIMIT 1"
)


def _has_dispatch_history(paths: tuple[str, str]) -> bool:
    """True when the atlas DB has a project row for cwd with >=1 dispatch ever.

    Read-only; any error (no DB, bad schema, locked) reads as no history."""
    try:
        db = os.environ.get("ATLAS_DB") or os.path.expanduser("~/.atlas/atlas.db")
        if not os.path.isfile(db):
            return False
        conn = sqlite3.connect(f"file:{quote(db)}?mode=ro", uri=True, timeout=1)
        try:
            return conn.execute(_HISTORY_SQL, paths).fetchone() is not None
        finally:
            conn.close()
    except Exception:  # noqa: BLE001
        return False


def _under(path: str, root: str) -> bool:
    return path == root or path.startswith(root.rstrip("/") + "/")


def gates_armed(cwd: str | None = None) -> bool:
    try:
        mode = os.environ.get("ATLAS_GATES", "").strip().lower()
        if mode == "always":
            return True
        if mode == "off":
            return False
        path = os.path.abspath(cwd or os.getcwd())
        real = os.path.realpath(path)
        if any(_under(p, r) for p in (path, real) for r in SCRATCH_ROOTS):
            return False
        home = os.path.realpath(os.path.expanduser("~"))
        cur = real
        while cur != home and cur != os.path.dirname(cur):
            if any(os.path.exists(os.path.join(cur, m)) for m in PROJECT_MARKERS):
                return True
            cur = os.path.dirname(cur)
        if real == home:
            return False
        return _has_dispatch_history((path, real))
    except Exception:  # noqa: BLE001 -- fail toward enforcing
        return True
