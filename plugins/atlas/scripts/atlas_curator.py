#!/usr/bin/env python3
"""Atlas curator — background skill lifecycle management for auto-created skills.

Mirrors Hermes Agent's curator (agent/curator.py) but is simpler and file-based:
  - Walks ~/.atlas/skills/ for skills with `created_by: "atlas-auto"` in frontmatter
  - Marks skills stale after 30 days of inactivity (no file mtime change)
  - Archives stale skills after 90 days
  - Pinned skills (`.pinned` marker file) are exempt from all transitions
  - Never deletes — only archives (move to .archive/ subdirectory, recoverable)

Design choices:
  - No LLM consolidation pass (Hermes's opt-in `consolidate` feature) — too expensive
    for a hook-driven system. Consolidation is left to manual atlas-audit runs.
  - File mtime is the activity signal (skills are files; if nobody touched them,
    they're stale). This avoids needing a usage telemetry sidecar.
  - Deterministic: no model calls, pure file I/O.

Stdlib only. Callers in hooks MUST wrap in try/except and fail open.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

DEFAULT_STALE_AFTER_DAYS = 30
DEFAULT_ARCHIVE_AFTER_DAYS = 90
PROVENANCE_MARKER = "atlas-auto"


def _skills_dir() -> Path:
    base = os.environ.get("ATLAS_HOME", os.path.expanduser("~/.atlas"))
    return Path(base) / "skills"


def _archive_dir() -> Path:
    return _skills_dir() / ".archive"


def _state_file() -> Path:
    return _skills_dir() / ".curator_state"


def _load_state() -> Dict[str, Any]:
    path = _state_file()
    if not path.is_file():
        return {"last_run_at": None, "run_count": 0, "archived": [], "marked_stale": []}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        # Best-effort: keep running on corrupt state, but make the corruption
        # observable so the silent reset does not erase run history unnoticed.
        print(
            f"atlas_curator: corrupt state file {path}: {exc!r}; "
            "falling back to empty state",
            file=sys.stderr,
        )
        return {"last_run_at": None, "run_count": 0, "archived": [], "marked_stale": []}


def _save_state(state: Dict[str, Any]) -> None:
    path = _state_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _read_skill_provenance(skill_dir: Path) -> Optional[str]:
    """Read the `created_by` field from SKILL.md frontmatter."""
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        return None
    try:
        content = skill_md.read_text(encoding="utf-8")
        # Simple frontmatter parse — look for created_by in the YAML block
        match = re.search(r'^created_by:\s*"([^"]+)"', content, re.MULTILINE)
        if match:
            return match.group(1)
        # Also try unquoted
        match = re.search(r"^created_by:\s*(\S+)", content, re.MULTILINE)
        if match:
            return match.group(1)
    except (OSError, UnicodeDecodeError):
        pass
    return None


def _is_pinned(skill_dir: Path) -> bool:
    """Check if a skill has a .pinned marker file."""
    return (skill_dir / ".pinned").is_file()


def _skill_activity_time(skill_dir: Path) -> float:
    """Get the most recent file modification time in a skill directory."""
    latest = 0.0
    try:
        for item in skill_dir.rglob("*"):
            if item.is_file():
                mtime = item.stat().st_mtime
                if mtime > latest:
                    latest = mtime
    except OSError:
        pass
    return latest


def _all_auto_skills() -> List[Dict[str, Any]]:
    """Walk skills dir and return all atlas-auto skills with metadata."""
    skills = []
    d = _skills_dir()
    if not d.is_dir():
        return skills

    for item in d.iterdir():
        if not item.is_dir():
            continue
        if item.name.startswith("."):
            continue  # skip .archive etc.
        if not (item / "SKILL.md").is_file():
            continue

        provenance = _read_skill_provenance(item)
        if provenance != PROVENANCE_MARKER:
            continue  # only manage auto-created skills

        skills.append(
            {
                "name": item.name,
                "path": str(item),
                "pinned": _is_pinned(item),
                "last_activity": _skill_activity_time(item),
                "has_stale_marker": (item / ".stale").is_file(),
            }
        )
    return skills


def apply_transitions(now: Optional[float] = None) -> Dict[str, Any]:
    """Walk all auto-created skills and transition their lifecycle state.

    Returns a summary dict: {checked, marked_stale, archived, reactivated, skipped_pinned}
    """
    if now is None:
        now = time.time()

    stale_cutoff = now - (DEFAULT_STALE_AFTER_DAYS * 86400)
    archive_cutoff = now - (DEFAULT_ARCHIVE_AFTER_DAYS * 86400)

    skills = _all_auto_skills()
    counts = {
        "checked": len(skills),
        "marked_stale": 0,
        "archived": 0,
        "reactivated": 0,
        "skipped_pinned": 0,
    }
    archived_names = []

    for skill in skills:
        if skill["pinned"]:
            counts["skipped_pinned"] += 1
            continue

        name = skill["name"]
        path = Path(skill["path"])
        activity = skill["last_activity"]

        if activity == 0.0:
            # No files with mtime — treat as created now (young skill)
            activity = now

        if activity <= archive_cutoff:
            # Archive it
            archive_dir = _archive_dir()
            archive_dir.mkdir(parents=True, exist_ok=True)
            dest = archive_dir / name
            if dest.exists():
                # Already archived (shouldn't happen, but be safe)
                continue
            try:
                shutil.move(str(path), str(dest))
                counts["archived"] += 1
                archived_names.append(name)
            except (OSError, shutil.Error) as exc:
                # Best-effort: do not crash the curator, but surface the
                # archive failure so the docs tree and state do not silently
                # diverge.
                print(
                    f"atlas_curator: failed to archive skill {name} "
                    f"({path} -> {dest}): {exc!r}",
                    file=sys.stderr,
                )
        elif activity <= stale_cutoff:
            # Mark stale
            stale_marker = path / ".stale"
            if not stale_marker.is_file():
                try:
                    stale_marker.write_text(str(now), encoding="utf-8")
                    counts["marked_stale"] += 1
                except OSError as exc:
                    print(
                        f"atlas_curator: failed to mark skill {name} stale "
                        f"({stale_marker}): {exc!r}",
                        file=sys.stderr,
                    )
        else:
            # Active — clear stale marker if present
            if skill["has_stale_marker"]:
                stale_marker = path / ".stale"
                try:
                    stale_marker.unlink()
                    counts["reactivated"] += 1
                except OSError as exc:
                    print(
                        f"atlas_curator: failed to reactivate skill {name} "
                        f"({stale_marker}): {exc!r}",
                        file=sys.stderr,
                    )

    # Update state
    state = _load_state()
    state["last_run_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
    state["run_count"] = state.get("run_count", 0) + 1
    if archived_names:
        state.setdefault("archived", []).extend(archived_names)
    _save_state(state)

    return counts


def pin_skill(name: str) -> Dict[str, Any]:
    """Pin a skill so the curator never archives it."""
    skill_dir = _skills_dir() / name
    if not skill_dir.is_dir():
        return {"success": False, "error": f"Skill '{name}' not found."}
    (skill_dir / ".pinned").write_text(str(time.time()), encoding="utf-8")
    return {"success": True, "message": f"Skill '{name}' pinned."}


def unpin_skill(name: str) -> Dict[str, Any]:
    """Remove the pin marker."""
    skill_dir = _skills_dir() / name
    pin = skill_dir / ".pinned"
    if pin.is_file():
        pin.unlink()
    return {"success": True, "message": f"Skill '{name}' unpinned."}


def restore_skill(name: str) -> Dict[str, Any]:
    """Restore a skill from the archive."""
    archive = _archive_dir() / name
    dest = _skills_dir() / name
    if not archive.is_dir():
        return {"success": False, "error": f"Archived skill '{name}' not found."}
    if dest.exists():
        return {
            "success": False,
            "error": f"Skill '{name}' already exists in active dir.",
        }
    try:
        shutil.move(str(archive), str(dest))
        return {"success": True, "message": f"Skill '{name}' restored."}
    except (OSError, shutil.Error) as e:
        return {"success": False, "error": str(e)}


def status() -> Dict[str, Any]:
    """Return current curator status and skill inventory."""
    state = _load_state()
    skills = _all_auto_skills()
    return {
        "last_run": state.get("last_run_at"),
        "run_count": state.get("run_count", 0),
        "total_auto_skills": len(skills),
        "pinned": sum(1 for s in skills if s["pinned"]),
        "stale": sum(1 for s in skills if s["has_stale_marker"]),
        "skills": [
            {
                "name": s["name"],
                "pinned": s["pinned"],
                "stale": s["has_stale_marker"],
                "last_active": time.strftime(
                    "%Y-%m-%d", time.localtime(s["last_activity"])
                ),
            }
            for s in skills
        ],
    }


# --- CLI ---


def _cli():
    import sys

    if len(sys.argv) < 2:
        print("Usage: atlas_curator.py [run|status|pin|unpin|restore]")
        return
    cmd = sys.argv[1]
    if cmd == "run":
        result = apply_transitions()
        print(json.dumps(result, indent=2))
    elif cmd == "status":
        print(json.dumps(status(), indent=2))
    elif cmd == "pin":
        if len(sys.argv) < 3:
            print("Usage: atlas_curator.py pin <name>")
            return
        print(json.dumps(pin_skill(sys.argv[2]), indent=2))
    elif cmd == "unpin":
        if len(sys.argv) < 3:
            print("Usage: atlas_curator.py unpin <name>")
            return
        print(json.dumps(unpin_skill(sys.argv[2]), indent=2))
    elif cmd == "restore":
        if len(sys.argv) < 3:
            print("Usage: atlas_curator.py restore <name>")
            return
        print(json.dumps(restore_skill(sys.argv[2]), indent=2))
    else:
        print(f"Unknown command: {cmd}")


if __name__ == "__main__":
    _cli()
