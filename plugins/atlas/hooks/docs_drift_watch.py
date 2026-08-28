#!/usr/bin/env python3
"""PostToolUse hook -- inline docs-drift watcher (opt-in via docs/ presence).

completion_gate.py's condition (f) catches docs drift at Stop -- often minutes
and many edits after the code moved. This hook surfaces the same drift
signal (via the shared docs_drift module) immediately after each Edit/Write/
MultiEdit/NotebookEdit, so Stop is a backstop instead of the first notice.

No-op silently when: no project root with docs/ is found, ATLAS_GATE=off,
the edited file is itself under docs/, or under .atlas/.

Debounced: warns on the first drifting edit, then every 5th drifting edit
after that, so it does not nag on every edit. The streak resets the moment a
docs/ file appears in the diff (drift cleared), so a later regression warns
again immediately. The streak is also session-scoped: the state file records
the session_id it was last touched by, and a new/missing session_id resets
the streak before incrementing, so a fresh session always warns on its first
drifting edit instead of silently inheriting a prior session's count. State
lives in .atlas/.run/docs_drift_watch.json, scoped to the repo -- matching
where completion_gate keeps its own run state.

The git diff/rev-parse calls that back drift detection are cached in the
same state file for GIT_CACHE_TTL_SECONDS (keyed on time.monotonic, not wall
clock) so back-to-back edits within the TTL reuse the last result instead of
re-invoking git every time.

Fail-open by construction: any error, missing dir, unreadable state file,
or git failure is a silent no-op. A broken watcher must never block an edit.
State writes are atomic (temp file + os.replace) so a crash mid-write cannot
corrupt the state file; a lost increment under concurrent invocations is an
accepted tradeoff.

Stdlib only.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from docs_drift import docs_drift, find_root, git_changed_paths  # noqa: E402

WARN_EVERY = 5
STATE_RELPATH = (".atlas", ".run", "docs_drift_watch.json")
GIT_CACHE_TTL_SECONDS = 2.0


def _is_docs_or_atlas_path(path: str) -> bool:
    norm = path.replace("\\", "/")
    return (
        norm.startswith("docs/")
        or "/docs/" in norm
        or norm.startswith(".atlas/")
        or "/.atlas/" in norm
    )


def _state_path(root: Path) -> Path:
    return root.joinpath(*STATE_RELPATH)


def _load_state(root: Path) -> dict:
    try:
        return json.loads(_state_path(root).read_text(encoding="utf-8"))
    except Exception:
        return {}  # missing/corrupt/unreadable -> fail open, treat as fresh


def _save_state(root: Path, state: dict) -> None:
    path = _state_path(root)
    tmp = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.parent / (".%s.tmp%d" % (path.name, os.getpid()))
        tmp.write_text(json.dumps(state), encoding="utf-8")
        os.replace(tmp, path)  # atomic on POSIX: no partial/corrupt state file
        tmp = None
    except OSError:
        pass  # fail-open: a lost update just costs one extra/missed warning
    finally:
        if tmp is not None:
            try:
                tmp.unlink()
            except OSError:
                pass


def _nondocs_count(changed_paths: list) -> int:
    return sum(1 for p in changed_paths if not (p.startswith("docs/") or "/docs/" in p))


def _cached_changed_paths(root: Path, state: dict) -> list:
    """Return git_changed_paths(root), reusing a state-cached result when it
    is younger than GIT_CACHE_TTL_SECONDS. Mutates state["git_cache"] in
    place; caller is responsible for persisting state. Uses time.monotonic
    so the TTL is immune to wall-clock adjustments.
    """
    cache = state.get("git_cache")
    now = time.monotonic()
    if isinstance(cache, dict):
        ts = cache.get("ts")
        cached = cache.get("changed")
        if (
            isinstance(ts, (int, float))
            and isinstance(cached, list)
            and (now - ts) < GIT_CACHE_TTL_SECONDS
        ):
            return cached
    changed = git_changed_paths(root)  # may raise -- caller handles fail-open
    state["git_cache"] = {"ts": now, "changed": changed}
    return changed


def main() -> int:
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, ValueError):
        return 0
    if not isinstance(data, dict):
        return 0
    try:
        if os.environ.get("ATLAS_GATE", "").lower() == "off":
            return 0
        ti = data.get("tool_input") or {}
        fp = ti.get("file_path") or ti.get("path") or ti.get("notebook_path")
        if not fp or not isinstance(fp, str):
            return 0
        if _is_docs_or_atlas_path(fp):
            return 0

        cwd = Path(data.get("cwd") or os.getcwd())
        root = find_root(cwd)
        if root is None:
            return 0  # no docs/ SSOT -> not an atlas project -> silent no-op

        state = _load_state(root)

        # Session-scope the streak: a differing (or absent) session_id means
        # we cannot trust the stored streak belongs to this run, so reset it
        # before incrementing. This guarantees the first drifting edit of a
        # fresh session always warns, per the module's own contract.
        session_id = data.get("session_id")
        if not isinstance(session_id, str):
            session_id = ""
        if session_id != state.get("session_id", ""):
            state["session_id"] = session_id
            state["streak"] = 0

        try:
            changed = _cached_changed_paths(root, state)
        except Exception:
            return 0  # git unavailable -> advisory-only hook, fail open

        if not docs_drift(changed):
            # No drift right now -- nothing changed, or docs/ is already in
            # the diff. Either way clear the streak so a later regression
            # warns from the start again.
            state["streak"] = 0
            _save_state(root, state)
            return 0

        try:
            streak = int(state.get("streak", 0)) + 1
        except (TypeError, ValueError):
            streak = 1
        state["streak"] = streak
        _save_state(root, state)

        if streak == 1 or streak % WARN_EVERY == 0:
            count = _nondocs_count(changed)
            msg = (
                "[atlas] docs drift: %d non-docs file(s) changed with no docs/ "
                "update in the diff yet. Dispatch atlas:docs-curator before "
                "Stop -- do not wait for the completion gate to catch this." % count
            )
            print(
                json.dumps(
                    {
                        "hookSpecificOutput": {
                            "hookEventName": "PostToolUse",
                            "additionalContext": msg,
                        }
                    }
                )
            )
        return 0
    except Exception:
        return 0  # fail-open: a broken watcher must never block an edit


if __name__ == "__main__":
    raise SystemExit(main())
