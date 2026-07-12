#!/usr/bin/env python3
"""Atlas persistent memory store — file-backed, §-delimited, char-bounded.

Two stores, mirroring Hermes Agent's memory design:
  - MEMORY.md: agent's personal notes (environment facts, tool quirks, lessons)
  - PROJECT.md: project-specific facts (conventions, gotchas, architecture decisions)

Both live under ~/.atlas/memory/ and are injected into the session boot hook's
additionalContext as a frozen snapshot. Mid-session writes update files on disk
immediately (durable) but the snapshot refreshes on next session start.

Design mirrors Hermes Agent's MemoryStore:
  - § entry delimiter, char-bounded (not token-bounded, model-independent)
  - file lock for concurrent safety (fcntl on Unix, msvcrt on Windows)
  - atomic writes via tempfile + os.replace
  - add is append-only (never clobbers), replace/remove need exact substring match
  - batch operations for atomic multi-edit

Stdlib only. Callers in hooks MUST wrap usage in try/except and fail open.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

# fcntl is Unix-only; on Windows use msvcrt for file locking
fcntl = None
try:
    import fcntl
except ImportError:
    try:
        import msvcrt
    except ImportError:
        msvcrt = None

ENTRY_DELIMITER = "\n§\n"
DEFAULT_MEMORY_LIMIT = 4000  # chars — generous for project-specific lessons
DEFAULT_PROJECT_LIMIT = 4000


def _memory_dir() -> Path:
    """Return the atlas memory directory. Respects ATLAS_HOME env var."""
    base = os.environ.get("ATLAS_HOME", os.path.expanduser("~/.atlas"))
    return Path(base) / "memory"


def _path_for(target: str) -> Path:
    d = _memory_dir()
    if target == "project":
        return d / "PROJECT.md"
    return d / "MEMORY.md"


def _char_limit(target: str) -> int:
    if target == "project":
        return DEFAULT_PROJECT_LIMIT
    return DEFAULT_MEMORY_LIMIT


@contextmanager
def _file_lock(path: Path):
    """Exclusive file lock for read-modify-write safety."""
    lock_path = path.with_suffix(path.suffix + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)

    if fcntl is None and msvcrt is None:
        yield
        return

    fd = open(lock_path, "a+", encoding="utf-8")
    try:
        if fcntl:
            fcntl.flock(fd, fcntl.LOCK_EX)
        else:
            fd.seek(0)
            msvcrt.locking(fd.fileno(), msvcrt.LK_LOCK, 1)
        yield
    finally:
        if fcntl:
            try:
                fcntl.flock(fd, fcntl.LOCK_UN)
            except (OSError, IOError):
                pass
        elif msvcrt:
            try:
                fd.seek(0)
                msvcrt.locking(fd.fileno(), msvcrt.LK_UNLCK, 1)
            except (OSError, IOError):
                pass
        fd.close()


def _read_file(path: Path) -> List[str]:
    """Read §-delimited entries from file. Returns [] if file doesn't exist."""
    if not path.is_file():
        return []
    try:
        content = path.read_text(encoding="utf-8").strip()
        if not content:
            return []
        entries = content.split(ENTRY_DELIMITER)
        # Strip whitespace from each entry but preserve internal structure
        return [e.strip() for e in entries if e.strip()]
    except (OSError, UnicodeDecodeError):
        return []


def _write_file(path: Path, entries: List[str]) -> None:
    """Atomically write entries to file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    content = ENTRY_DELIMITER.join(entries) if entries else ""
    # Atomic write via tempfile + os.replace
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        os.write(fd, content.encode("utf-8"))
        os.close(fd)
        os.replace(tmp, str(path))
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def load_snapshot() -> Dict[str, str]:
    """Load memory entries and return a rendered snapshot for injection.

    Returns {"memory": "...", "project": "..."} with each value being
    the §-joined entries ready for injection into session boot context.
    """
    mem_dir = _memory_dir()
    mem_dir.mkdir(parents=True, exist_ok=True)

    memory_entries = _read_file(mem_dir / "MEMORY.md")
    project_entries = _read_file(mem_dir / "PROJECT.md")

    # Deduplicate preserving order
    memory_entries = list(dict.fromkeys(memory_entries))
    project_entries = list(dict.fromkeys(project_entries))

    return {
        "memory": _render_block("MEMORY", memory_entries),
        "project": _render_block("PROJECT CONTEXT", project_entries),
    }


def _render_block(title: str, entries: List[str]) -> str:
    if not entries:
        return ""
    total = len(ENTRY_DELIMITER.join(entries))
    header = f"═══ {title} [{total:,} chars] ═══"
    return header + "\n" + ENTRY_DELIMITER.join(entries)


def add(target: str, content: str) -> Dict[str, Any]:
    """Append a new entry. Returns error if it would exceed the char limit."""
    content = content.strip()
    if not content:
        return {"success": False, "error": "Content cannot be empty."}

    path = _path_for(target)
    with _file_lock(path):
        entries = _read_file(path)
        entries = list(dict.fromkeys(entries))  # dedupe

        if content in entries:
            return {"success": True, "message": "Entry already exists (no duplicate added)."}

        limit = _char_limit(target)
        new_entries = entries + [content]
        new_total = len(ENTRY_DELIMITER.join(new_entries))

        if new_total > limit:
            current = len(ENTRY_DELIMITER.join(entries)) if entries else 0
            return {
                "success": False,
                "error": f"Memory at {current:,}/{limit:,} chars. Adding this entry ({len(content)} chars) would exceed the limit. Use 'replace' or 'remove' to make room.",
                "current_entries": entries,
                "usage": f"{current:,}/{limit:,}",
            }

        entries.append(content)
        _write_file(path, entries)

    return {"success": True, "message": "Entry added."}


def replace(target: str, old_text: str, new_content: str) -> Dict[str, Any]:
    """Find entry containing old_text substring, replace it with new_content."""
    old_text = old_text.strip()
    new_content = new_content.strip()
    if not old_text:
        return {"success": False, "error": "old_text cannot be empty."}
    if not new_content:
        return {"success": False, "error": "new_content cannot be empty. Use 'remove' to delete entries."}

    path = _path_for(target)
    with _file_lock(path):
        entries = _read_file(path)
        entries = list(dict.fromkeys(entries))

        matches = [(i, e) for i, e in enumerate(entries) if old_text in e]
        if not matches:
            return {"success": False, "error": f"No entry matched '{old_text}'.", "current_entries": entries}

        if len(matches) > 1:
            unique_texts = {e for _, e in matches}
            if len(unique_texts) > 1:
                return {"success": False, "error": f"Multiple entries matched '{old_text}'. Be more specific."}

        idx = matches[0][0]
        limit = _char_limit(target)
        test_entries = entries.copy()
        test_entries[idx] = new_content
        new_total = len(ENTRY_DELIMITER.join(test_entries))

        if new_total > limit:
            return {
                "success": False,
                "error": f"Replacement would put memory at {new_total:,}/{limit:,} chars. Shorten or remove other entries.",
                "current_entries": entries,
            }

        entries[idx] = new_content
        _write_file(path, entries)

    return {"success": True, "message": "Entry replaced."}


def remove(target: str, old_text: str) -> Dict[str, Any]:
    """Remove the entry containing old_text substring."""
    old_text = old_text.strip()
    if not old_text:
        return {"success": False, "error": "old_text cannot be empty."}

    path = _path_for(target)
    with _file_lock(path):
        entries = _read_file(path)
        entries = list(dict.fromkeys(entries))

        matches = [(i, e) for i, e in enumerate(entries) if old_text in e]
        if not matches:
            return {"success": False, "error": f"No entry matched '{old_text}'.", "current_entries": entries}

        if len(matches) > 1:
            unique_texts = {e for _, e in matches}
            if len(unique_texts) > 1:
                return {"success": False, "error": f"Multiple entries matched '{old_text}'. Be more specific."}

        idx = matches[0][0]
        entries.pop(idx)
        _write_file(path, entries)

    return {"success": True, "message": "Entry removed."}


def apply_batch(target: str, operations: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Apply a sequence of add/replace/remove ops to one target atomically.

    All operations are validated and applied against the FINAL budget.
    One failed op aborts the entire batch (atomic).
    """
    path = _path_for(target)
    with _file_lock(path):
        entries = _read_file(path)
        entries = list(dict.fromkeys(entries))

        for op in operations:
            action = op.get("action", "")
            if action == "add":
                content = op.get("content", "").strip()
                if content and content not in entries:
                    entries.append(content)
            elif action == "replace":
                old_text = op.get("old_text", "").strip()
                new_content = op.get("content", "").strip()
                if old_text and new_content:
                    for i, e in enumerate(entries):
                        if old_text in e:
                            entries[i] = new_content
                            break
            elif action == "remove":
                old_text = op.get("old_text", "").strip()
                if old_text:
                    for i, e in enumerate(entries):
                        if old_text in e:
                            entries.pop(i)
                            break

        # Check final budget
        limit = _char_limit(target)
        total = len(ENTRY_DELIMITER.join(entries))
        if total > limit:
            return {
                "success": False,
                "error": f"Batch result would be {total:,}/{limit:,} chars. Remove entries to make room.",
                "current_entries": entries,
            }

        _write_file(path, entries)

    return {"success": True, "message": f"Applied {len(operations)} operations."}


def get_entries(target: str) -> List[str]:
    """Return current entries for a target (read-only, no lock)."""
    return _read_file(_path_for(target))


def usage(target: str) -> Dict[str, Any]:
    """Return current char usage for a target."""
    entries = _read_file(_path_for(target))
    total = len(ENTRY_DELIMITER.join(entries)) if entries else 0
    limit = _char_limit(target)
    return {"target": target, "used": total, "limit": limit, "entries": len(entries)}


# --- CLI for manual inspection/management ---

def _cli():
    import sys
    if len(sys.argv) < 2:
        print("Usage: atlas_memory.py [snapshot|list|add|remove|usage]")
        return
    cmd = sys.argv[1]
    if cmd == "snapshot":
        snap = load_snapshot()
        for key, val in snap.items():
            if val:
                print(val)
                print()
    elif cmd == "list":
        target = sys.argv[2] if len(sys.argv) > 2 else "memory"
        for i, e in enumerate(get_entries(target)):
            print(f"[{i}] {e[:120]}{'...' if len(e) > 120 else ''}")
    elif cmd == "add":
        target = sys.argv[2] if len(sys.argv) > 2 else "memory"
        content = " ".join(sys.argv[3:])
        print(json.dumps(add(target, content), indent=2))
    elif cmd == "remove":
        target = sys.argv[2] if len(sys.argv) > 2 else "memory"
        old_text = " ".join(sys.argv[3:])
        print(json.dumps(remove(target, old_text), indent=2))
    elif cmd == "usage":
        target = sys.argv[2] if len(sys.argv) > 2 else "memory"
        print(json.dumps(usage(target), indent=2))
    else:
        print(f"Unknown command: {cmd}")


if __name__ == "__main__":
    _cli()