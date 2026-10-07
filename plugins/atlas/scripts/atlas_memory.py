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
from datetime import datetime
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
        msvcrt: Any = None

ENTRY_DELIMITER = "\n§\n"

# Working cap for the LIVE memory file (chars, not tokens -- model-independent).
# MEMORY.md is long-lived: it accumulates a handful of short lessons per
# session across months of use, and 4000 chars (sized for a "quick note") was
# hit within about three weeks of normal use, at which point add() rejected
# every new lesson and the failure was silent (see PROBLEM 1). 20,000 chars is
# roughly a week or two of injected boot-context budget's worth of headroom --
# generous enough that rotation, not rejection, is the normal outcome of
# reaching it. When this cap is hit, oldest entries are rotated into a dated
# archive file rather than dropped (see _rotate_to_fit).
WORKING_CAP_CHARS = 20_000


# Secrets never reach long-term memory: MEMORY.md is re-injected at every SessionStart and
# captured text comes from raw user messages. ponytail: pattern list, not entropy detection;
# add a shape here when a new secret format leaks.
_REDACTED = "[REDACTED]"
_SECRET_PATTERNS = [
    (
        re.compile(
            r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|\Z)"
        ),
        _REDACTED,
    ),
    (
        re.compile(r"\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*"),
        _REDACTED,
    ),  # JWT
    (re.compile(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}"), r"\1 " + _REDACTED),
    (
        re.compile(r"\b([A-Za-z][\w+.-]*://)[^\s:/@]+:[^\s@/]+@"),
        r"\1" + _REDACTED + "@",
    ),  # URL userinfo
    (
        re.compile(
            r"\b(?:(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}"
            r"|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}"
            r"|glpat-[A-Za-z0-9_-]{16,}|npm_[A-Za-z0-9]{30,}|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})"
        ),
        _REDACTED,
    ),
    (  # key=value / key: value, quoted values may hold spaces
        re.compile(
            r"(?i)\b([\w.-]*(?:password|passwd|pwd|passphrase|secret|token|api[_-]?key|apikey|access[_-]?key"
            r"|private[_-]?key|credentials?|authorization)[\w-]*[\"']?\s*[:=]\s*)"
            r"(?:\"[^\"\n]*\"|'[^'\n]*'|[^\s,;\"']+)"
        ),
        r"\1" + _REDACTED,
    ),
    (  # "password hunter2" / "api key is abc123": whitespace form, value must look non-prose
        re.compile(
            r"(?i)\b((?:password|passwd|passphrase|pwd|secret|token|api[ _-]?key)\s+(?:is\s+)?)"
            r"(?=\S*[\d!@#$%^&*_=+-])(?!\[REDACTED\])\S{6,}"
        ),
        r"\1" + _REDACTED,
    ),
]


def redact_secrets(text: str) -> str:
    """Replace credential-shaped substrings (keys, bearer tokens, JWTs, passwords,
    key=value secrets, private key blocks, URL credentials) with [REDACTED]."""
    for pattern, repl in _SECRET_PATTERNS:
        text = pattern.sub(repl, text)
    return text


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
    return WORKING_CAP_CHARS


def _archive_dir() -> Path:
    d = _memory_dir() / "archive"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _archive_path(target: str) -> Path:
    """Dated archive file for entries rotated out of the live file this month."""
    name = "PROJECT" if target == "project" else "MEMORY"
    stamp = datetime.now().strftime("%Y-%m")
    return _archive_dir() / f"{name}-{stamp}.md"


class LockTimeout(OSError):
    """`_file_lock(timeout=...)` could not take the lock in time."""


@contextmanager
def _file_lock(path: Path, timeout: Optional[float] = None):
    """Exclusive file lock for read-modify-write safety. `timeout=None` blocks
    until acquired (the default, unchanged); a number of seconds polls a
    non-blocking flock and raises LockTimeout when it runs out (POSIX only)."""
    lock_path = path.with_suffix(path.suffix + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)

    if fcntl is None and msvcrt is None:
        yield
        return

    fd = open(lock_path, "a+", encoding="utf-8")
    try:
        if fcntl and timeout is not None:
            deadline = time.monotonic() + timeout
            while True:
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise LockTimeout(f"lock busy: {lock_path}")
                    time.sleep(0.02)
        elif fcntl:
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


def _archive_entries(target: str, entries_to_archive: List[str]) -> None:
    """Append rotated-out entries to this month's dated archive file.

    Read-then-append (never overwrite) so multiple rotations within the same
    month accumulate rather than clobber each other. Reuses the same
    §-delimited reader/writer as the live file, so the archive stays in the
    same format and is just as readable.
    """
    if not entries_to_archive:
        return
    archive = _archive_path(target)
    with _file_lock(archive):
        existing = _read_file(archive)
        _write_file(archive, existing + entries_to_archive)


def _rotate_to_fit(target: str, entries: List[str]) -> Dict[str, Any]:
    """Trim `entries` from the oldest end until they fit the working cap,
    archiving anything rotated out (PROBLEM 2: rotate, never silently reject).

    Returns {"entries": fitted_list, "rotated": [popped_oldest_first], "dropped": bool}.
    dropped=True means even the newest entry alone still exceeds the cap --
    `entries` is returned unchanged so the caller can refuse the write (this
    is the one remaining genuine-drop case, and it must be reported, not
    silent -- see PROBLEM 1).
    """
    limit = _char_limit(target)
    working = list(entries)
    rotated: List[str] = []
    while len(working) > 1 and len(ENTRY_DELIMITER.join(working)) > limit:
        rotated.append(working.pop(0))  # oldest first

    if len(ENTRY_DELIMITER.join(working)) > limit:
        return {"entries": entries, "rotated": [], "dropped": True}

    if rotated:
        _archive_entries(target, rotated)

    return {"entries": working, "rotated": rotated, "dropped": False}


# --- Recall filtering -------------------------------------------------------
# MEMORY.md holds up to WORKING_CAP_CHARS. load_snapshot used to inject ALL of
# it into every SessionStart: a measured 10,874-char wall of text, most of it
# "Tool 'Write' errored 2x in agent-a870d7a4169e4bb8b" telemetry and six
# near-identical copies of the same user correction, one per subagent scope.
# Nobody can read that as it scrolls past, and it buries anything that matters.
# The file stays whole; only what gets INJECTED is filtered and capped.

RECALL_MAX_ENTRIES = 8
RECALL_MAX_CHARS = 1200

# Tool-error tallies are already in atlas_db, queryable by atlas-audit. As a
# recall line they are pure noise: they name no lesson and no action.
_NOISE_PREFIXES = ("Tool '",)

# Scope names that are not projects. A subagent's cwd basename becomes its
# "project", so lessons got filed under agent-<hex> and .run.
_JUNK_SCOPE = re.compile(r"^(agent-[0-9a-f]{6,}|\.run|\.atlas)$")


def _scope_of(entry: str) -> str:
    """The `(project)` qualifier a captured entry carries, or ''."""
    m = re.match(r"^[^(\n]{0,60}\(([^)\n]{1,80})\):", entry)
    return m.group(1).strip() if m else ""


def _dedupe_key(entry: str) -> str:
    """Collapse near-duplicates: the same lesson captured under six different
    subagent scopes differs ONLY in its `(project)` qualifier. Strip that, fold
    whitespace, and the six become one."""
    stripped = re.sub(r"\(([^)\n]{1,80})\):", ":", entry, count=1)
    return " ".join(stripped.split()).lower()[:160]


def filter_for_recall(entries: List[str]) -> List[str]:
    """What actually gets injected at SessionStart: newest first, junk scopes and
    tool-error telemetry dropped, near-duplicates collapsed, hard-capped by both
    entry count and total chars."""
    kept: List[str] = []
    seen = set()
    total = 0
    for entry in reversed(entries):  # newest first
        text = entry.strip()
        if not text:
            continue
        if text.startswith(_NOISE_PREFIXES):
            continue
        if _JUNK_SCOPE.match(_scope_of(text)):
            continue
        key = _dedupe_key(text)
        if key in seen:
            continue
        if total + len(text) > RECALL_MAX_CHARS and kept:
            break
        seen.add(key)
        kept.append(text)
        total += len(text)
        if len(kept) >= RECALL_MAX_ENTRIES:
            break
    return kept


def load_snapshot() -> Dict[str, str]:
    """Load memory entries and return a rendered snapshot for injection.

    Returns {"memory": "...", "project": "..."} with each value being
    the §-joined entries ready for injection into session boot context.
    """
    mem_dir = _memory_dir()
    mem_dir.mkdir(parents=True, exist_ok=True)

    memory_entries = _read_file(mem_dir / "MEMORY.md")
    project_entries = _read_file(mem_dir / "PROJECT.md")

    # Exact dedupe first, then the recall filter (junk scopes, telemetry lines,
    # near-duplicates, hard cap). The files on disk are untouched.
    memory_entries = [
        redact_secrets(e)
        for e in filter_for_recall(list(dict.fromkeys(memory_entries)))
    ]
    project_entries = [
        redact_secrets(e)
        for e in filter_for_recall(list(dict.fromkeys(project_entries)))
    ]

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
    """Append a new entry. Rotates oldest entries to the archive rather than
    rejecting when the working cap would be exceeded (see _rotate_to_fit).
    Only fails if this single entry alone cannot fit even in an empty file."""
    content = redact_secrets(content.strip())
    if not content:
        return {"success": False, "error": "Content cannot be empty."}

    path = _path_for(target)
    with _file_lock(path):
        entries = _read_file(path)
        entries = list(dict.fromkeys(entries))  # dedupe

        if content in entries:
            return {
                "success": True,
                "message": "Entry already exists (no duplicate added).",
            }

        fit = _rotate_to_fit(target, entries + [content])
        if fit["dropped"]:
            limit = _char_limit(target)
            return {
                "success": False,
                "error": f"Entry alone is {len(content):,} chars, exceeding the {limit:,}-char working cap even after rotating out all prior entries. Shorten it.",
                "current_entries": entries,
            }

        _write_file(path, fit["entries"])

    message = "Entry added."
    if fit["rotated"]:
        n = len(fit["rotated"])
        message += f" Rotated {n} older entr{'y' if n == 1 else 'ies'} to archive to stay within cap."
    return {"success": True, "message": message}


def replace(target: str, old_text: str, new_content: str) -> Dict[str, Any]:
    """Find entry containing old_text substring, replace it with new_content."""
    old_text = old_text.strip()
    new_content = redact_secrets(new_content.strip())
    if not old_text:
        return {"success": False, "error": "old_text cannot be empty."}
    if not new_content:
        return {
            "success": False,
            "error": "new_content cannot be empty. Use 'remove' to delete entries.",
        }

    path = _path_for(target)
    with _file_lock(path):
        entries = _read_file(path)
        entries = list(dict.fromkeys(entries))

        matches = [(i, e) for i, e in enumerate(entries) if old_text in e]
        if not matches:
            return {
                "success": False,
                "error": f"No entry matched '{old_text}'.",
                "current_entries": entries,
            }

        if len(matches) > 1:
            unique_texts = {e for _, e in matches}
            if len(unique_texts) > 1:
                return {
                    "success": False,
                    "error": f"Multiple entries matched '{old_text}'. Be more specific.",
                }

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
            return {
                "success": False,
                "error": f"No entry matched '{old_text}'.",
                "current_entries": entries,
            }

        if len(matches) > 1:
            unique_texts = {e for _, e in matches}
            if len(unique_texts) > 1:
                return {
                    "success": False,
                    "error": f"Multiple entries matched '{old_text}'. Be more specific.",
                }

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
                content = redact_secrets(op.get("content", "").strip())
                if content and content not in entries:
                    entries.append(content)
            elif action == "replace":
                old_text = op.get("old_text", "").strip()
                new_content = redact_secrets(op.get("content", "").strip())
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
    elif cmd in ("--help", "-h", "help"):
        print("Usage: atlas_memory.py [snapshot|list|add|remove|usage]")
    else:
        print(
            "Usage: atlas_memory.py [snapshot|list|add|remove|usage]", file=sys.stderr
        )
        print(f"Unknown command: {cmd}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    _cli()
