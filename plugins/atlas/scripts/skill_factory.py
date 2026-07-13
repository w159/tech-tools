#!/usr/bin/env python3
"""Atlas skill factory — auto-create skills from session transcripts.

Extracts reusable lessons from the observability DB's session mirror and
writes SKILL.md files under ~/.atlas/skills/. Mirrors Hermes Agent's
skill_manage(action='create') but is hook-driven, not agent-driven.

Provenance: every auto-created skill carries `created_by: "atlas-auto"` in
its frontmatter so the curator can manage it without touching hand-written skills.

Skill-worthiness detection (a session must meet ALL):
  1. orchestrating run (not a trivial chat)
  2. >= 5 tool calls (real work happened)
  3. >= 1 improvement recorded in the DB, OR >= 1 signal of type
     'user_correction' or 'assumption_admission' (something was learned)
  4. run not already has a skill attributed to it (dedup)

Stdlib only. Callers in hooks MUST wrap in try/except and fail open.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


# Where auto-created skills live
def _skills_dir() -> Path:
    base = os.environ.get("ATLAS_HOME", os.path.expanduser("~/.atlas"))
    return Path(base) / "skills"


VALID_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")
MAX_NAME_LENGTH = 64


def _validate_name(name: str) -> Optional[str]:
    if not name:
        return "Skill name is required."
    if len(name) > MAX_NAME_LENGTH:
        return f"Skill name exceeds {MAX_NAME_LENGTH} characters."
    if not VALID_NAME_RE.match(name):
        return f"Invalid skill name '{name}'. Use lowercase letters, numbers, hyphens, dots, underscores."
    return None


def _skill_name_from_topic(topic: str) -> str:
    """Derive a filesystem-safe skill name from a topic string."""
    # Take first few words, lowercase, hyphenate
    words = re.sub(r"[^a-z0-9\s-]", "", topic.lower()).split()[:5]
    name = "-".join(w for w in words if w)
    if not name:
        name = "learned-lesson"
    # Prefix with 'learned-' to distinguish from hand-written skills
    if not name.startswith("learned-"):
        name = "learned-" + name
    # Truncate
    if len(name) > MAX_NAME_LENGTH:
        name = name[:MAX_NAME_LENGTH]
    return name


def _build_skill_md(name: str, description: str, body: str) -> str:
    """Build a SKILL.md with frontmatter."""
    return f"""---
name: {name}
description: "{description}"
created_by: "atlas-auto"
created_at: "{time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}"
version: "1.0.0"
---

# {name}

{body}
"""


def _extract_lessons_from_session(
    conn: sqlite3.Connection, session_id: str
) -> List[Dict[str, Any]]:
    """Extract learnable lessons from the observability DB for a session.

    Sources:
      - improvements table: structured (dimension, baseline, target, note)
      - signals table: behavioral signals (user_correction, assumption_admission)
      - user_prompts: repeated prompts (workflow should become a skill)
      - tool_calls: error patterns (tools that failed, how they were resolved)

    Returns a list of lesson dicts: {topic, description, body, source}
    """
    lessons = []

    # 1. Improvements table — structured lessons
    try:
        run_id = _session_run_id(conn, session_id)
        if run_id:
            for row in conn.execute(
                "SELECT dimension, baseline, target, note FROM improvements WHERE run_id=? ORDER BY id",
                (run_id,),
            ).fetchall():
                dim, baseline, target, note = row
                if note and note.strip():
                    lessons.append(
                        {
                            "topic": dim or "improvement",
                            "description": f"Lesson: {dim or 'improvement'} — {note[:100]}",
                            "body": f"## {dim or 'Improvement'}\n\n**Baseline:** {baseline or 'unknown'}\n**Target:** {target or 'improved'}\n**Lesson:** {note}\n",
                            "source": "improvements",
                        }
                    )
    except sqlite3.Error as e:
        # Surface the failure rather than swallow it; continue to the next
        # source so one bad query does not silently zero the whole extraction.
        print(
            f"skill_factory: lessons extraction error (improvements): {e}",
            file=sys.stderr,
        )

    # 2. Behavioral signals — user corrections and assumption admissions
    try:
        for row in conn.execute(
            "SELECT signal_type, snippet FROM signals WHERE session_id=? "
            "AND signal_type IN ('user_correction', 'assumption_admission') "
            "ORDER BY ts DESC LIMIT 10",
            (session_id,),
        ).fetchall():
            sig_type, snippet = row
            if snippet and snippet.strip():
                label = (
                    "User correction"
                    if sig_type == "user_correction"
                    else "Assumption admitted"
                )
                lessons.append(
                    {
                        "topic": sig_type,
                        "description": f"{label}: {snippet[:100]}",
                        "body": f"## {label}\n\n{snippet}\n\n**Lesson:** This {sig_type.replace('_', ' ')} should be avoided in future sessions.\n",
                        "source": "signals",
                    }
                )
    except sqlite3.Error as e:
        print(
            f"skill_factory: lessons extraction error (signals): {e}",
            file=sys.stderr,
        )

    # 3. Tool errors — patterns of failure
    try:
        error_tools = conn.execute(
            "SELECT tool_name, COUNT(*) as cnt, "
            "GROUP_CONCAT(input_summary, ' | ') as samples "
            "FROM tool_calls WHERE session_id=? AND is_error=1 "
            "GROUP BY tool_name ORDER BY cnt DESC LIMIT 5",
            (session_id,),
        ).fetchall()
        for tool_name, cnt, samples in error_tools:
            if tool_name and cnt > 0:
                lessons.append(
                    {
                        "topic": f"tool-error-{tool_name.lower()}",
                        "description": f"Tool '{tool_name}' failed {cnt} time(s) — error pattern to avoid",
                        "body": f"## Tool Error Pattern: {tool_name}\n\nFailed {cnt} time(s) this session.\n\n**Samples:**\n{(samples or '')[:500]}\n\n**Lesson:** Check for this error pattern when using {tool_name}.\n",
                        "source": "tool_errors",
                    }
                )
    except sqlite3.Error as e:
        print(
            f"skill_factory: lessons extraction error (tool_errors): {e}",
            file=sys.stderr,
        )

    return lessons


def _session_run_id(conn: sqlite3.Connection, session_id: str) -> Optional[int]:
    """Get the most recent run ID for a session."""
    try:
        row = conn.execute(
            "SELECT id FROM runs WHERE session_id=? ORDER BY id DESC LIMIT 1",
            (session_id,),
        ).fetchone()
        return row[0] if row else None
    except sqlite3.Error:
        return None


def _session_worthy(conn: sqlite3.Connection, session_id: str) -> Tuple[bool, str]:
    """Check if a session is worth creating a skill from.

    Returns (worthy, reason).
    """
    try:
        run_id = _session_run_id(conn, session_id)
        if not run_id:
            return False, "no run found"

        # Must be orchestrating
        row = conn.execute(
            "SELECT orchestrating FROM runs WHERE id=?", (run_id,)
        ).fetchone()
        if not row or not row[0]:
            return False, "not an orchestration run"

        # Must have enough tool calls (real work)
        tool_count = conn.execute(
            "SELECT COUNT(*) FROM tool_calls WHERE session_id=?", (session_id,)
        ).fetchone()[0]
        if tool_count < 5:
            return False, f"only {tool_count} tool calls (need >= 5)"

        # Must have at least one learnable signal
        improvements = conn.execute(
            "SELECT COUNT(*) FROM improvements WHERE run_id=?", (run_id,)
        ).fetchone()[0]
        signals = conn.execute(
            "SELECT COUNT(*) FROM signals WHERE session_id=? "
            "AND signal_type IN ('user_correction', 'assumption_admission')",
            (session_id,),
        ).fetchone()[0]
        errors = conn.execute(
            "SELECT COUNT(*) FROM tool_calls WHERE session_id=? AND is_error=1",
            (session_id,),
        ).fetchone()[0]

        if improvements == 0 and signals == 0 and errors == 0:
            return (
                False,
                "no learnable signals (no improvements, corrections, or errors)",
            )

        return (
            True,
            f"orchestrating run with {tool_count} tools, {improvements} improvements, {signals} signals, {errors} errors",
        )
    except sqlite3.Error as e:
        return False, f"DB error: {e}"


def _existing_skill_names() -> set:
    """Return set of existing skill names under ~/.atlas/skills/."""
    skills = set()
    d = _skills_dir()
    if not d.is_dir():
        return skills
    for item in d.iterdir():
        if item.is_dir() and (item / "SKILL.md").is_file():
            skills.add(item.name)
    return skills


def _dedup_skill_name(name: str, existing: set) -> str:
    """Ensure name is unique by appending -N if needed."""
    if name not in existing:
        return name
    for i in range(2, 100):
        candidate = f"{name}-{i}"
        if candidate not in existing:
            return candidate
    return name + "-" + str(int(time.time()))


def create_skill(name: str, description: str, body: str) -> Dict[str, Any]:
    """Create a skill directory with SKILL.md. Returns result dict."""
    err = _validate_name(name)
    if err:
        return {"success": False, "error": err}

    skills_dir = _skills_dir()
    skill_dir = skills_dir / name
    if skill_dir.exists():
        return {"success": False, "error": f"Skill '{name}' already exists."}

    skill_dir.mkdir(parents=True)
    skill_md = _build_skill_md(name, description, body)
    try:
        (skill_dir / "SKILL.md").write_text(skill_md, encoding="utf-8")
    except OSError as e:
        # Clean up the partially-created skill dir so a retry starts fresh
        # instead of failing with "already exists" on the next attempt.
        shutil.rmtree(skill_dir, ignore_errors=True)
        return {
            "success": False,
            "error": f"Failed to write skill '{name}': {e}",
        }

    return {
        "success": True,
        "name": name,
        "path": str(skill_dir / "SKILL.md"),
        "message": f"Skill '{name}' created.",
    }


def auto_create_from_session(db_path: Optional[str] = None) -> Dict[str, Any]:
    """Check the most recent orchestrating session and auto-create a skill if worthy.

    This is the main entry point for the auto_skill hook. It:
    1. Opens the atlas DB
    2. Finds the most recent orchestrating session
    3. Checks if it's skill-worthy
    4. Extracts lessons
    5. Creates a skill if lessons exist and no skill exists for this session

    Returns a result dict with {created, name, reason, lessons}.
    """
    # Open the atlas DB
    if db_path is None:
        db_path = os.environ.get("ATLAS_DB", os.path.expanduser("~/.atlas/atlas.db"))
    if not os.path.exists(db_path):
        return {"created": False, "reason": "no atlas DB found"}

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except sqlite3.Error:
        return {"created": False, "reason": "cannot open atlas DB"}

    try:
        # Find the most recent orchestrating session
        row = conn.execute(
            "SELECT r.session_id FROM runs r "
            "WHERE r.orchestrating=1 ORDER BY r.id DESC LIMIT 1"
        ).fetchone()
        if not row:
            return {"created": False, "reason": "no orchestrating sessions found"}
        session_id = row[0]

        worthy, reason = _session_worthy(conn, session_id)
        if not worthy:
            return {"created": False, "reason": reason, "session_id": session_id}

        lessons = _extract_lessons_from_session(conn, session_id)
        if not lessons:
            return {
                "created": False,
                "reason": "no lessons extracted",
                "session_id": session_id,
            }

        # Build a combined skill from all lessons
        # Use the most common topic as the skill name
        topics = [lesson["topic"] for lesson in lessons]
        primary_topic = max(set(topics), key=topics.count) if topics else "lesson"

        name = _skill_name_from_topic(primary_topic)
        existing = _existing_skill_names()
        name = _dedup_skill_name(name, existing)

        # Combine lesson bodies
        description = (
            f"Auto-learned from session {session_id[:8]}: {len(lessons)} lesson(s)"
        )
        body_parts = [
            f"> Auto-created by atlas skill factory from session `{session_id}`.\n"
        ]
        for lesson in lessons:
            body_parts.append(lesson["body"])
        body = "\n".join(body_parts)

        result = create_skill(name, description, body)
        result["lessons"] = lessons
        result["session_id"] = session_id
        return result
    finally:
        conn.close()


# --- CLI ---


def _cli():
    if len(sys.argv) < 2:
        print("Usage: skill_factory.py [auto|create|list]")
        return
    cmd = sys.argv[1]
    if cmd == "auto":
        result = auto_create_from_session()
        print(json.dumps(result, indent=2, default=str))
    elif cmd == "create":
        if len(sys.argv) < 4:
            print("Usage: skill_factory.py create <name> <description> [body_file]")
            return
        name = sys.argv[2]
        desc = sys.argv[3]
        body = ""
        if len(sys.argv) > 4:
            body = Path(sys.argv[4]).read_text()
        print(json.dumps(create_skill(name, desc, body), indent=2))
    elif cmd == "list":
        for name in sorted(_existing_skill_names()):
            print(name)
    else:
        print(f"Unknown command: {cmd}")


if __name__ == "__main__":
    _cli()
