#!/usr/bin/env python3
"""Atlas Workboard v2: integrations routes (herdr-projects, file viewer, tode, Captain's Deck).

GETs never spawn a mutating process. POSTs are token-gated by the dashboard guard; the known-root
check (Atlas projects + live agent cwds) is the only authority for which directories may be
opened. Pure logic lives in atlas_integrations.
"""

from __future__ import annotations

import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import atlas_herdr  # noqa: E402
import atlas_integrations as ai  # noqa: E402


def known_roots(ctx) -> list:
    """Atlas project roots plus the cwds of live herdr agents (read-only)."""
    roots: list = []
    try:
        conn = ctx.db()
        roots = [r[0] for r in conn.execute("SELECT root_path FROM projects") if r[0]]
        conn.close()
    except Exception:
        pass
    try:
        roots += [
            a["cwd"] for a in atlas_herdr.agents().get("agents", []) if a.get("cwd")
        ]
    except Exception:
        pass
    return roots


def _reply(res: dict):
    status = res.pop("http", None) or (200 if res.get("ok") else 500)
    return status, res


def _integrations(ctx):
    return 200, ai.detect()


def _hp(ctx):
    return _reply(ai.hp_projects())


def _deck(ctx):
    return 200, ai.deck_status()


def _hp_start(ctx):
    b = ctx.json() or {}
    return _reply(
        ai.hp_thread_start(
            b.get("project"),
            b.get("title"),
            b.get("repo"),
            b.get("kind") or "worktree",
            b.get("task"),
        )
    )


def _open_file(ctx):
    b = ctx.json() or {}
    return _reply(
        ai.open_file(
            b.get("path"),
            b.get("root"),
            known_roots(ctx),
            line=b.get("line"),
            rng=b.get("range"),
            placement=b.get("placement") or "split",
        )
    )


def _open_editor(ctx):
    b = ctx.json() or {}
    return _reply(ai.open_editor(b.get("path"), known_roots(ctx), line=b.get("line")))


ROUTES = [
    ("GET", r"^/api/v2/integrations$", _integrations),
    ("GET", r"^/api/v2/projects/hp$", _hp),
    ("GET", r"^/api/v2/deck$", _deck),
    ("POST", r"^/api/v2/projects/hp/threads$", _hp_start),
    ("POST", r"^/api/v2/open-file$", _open_file),
    ("POST", r"^/api/v2/open-editor$", _open_editor),
]
