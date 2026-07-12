#!/usr/bin/env python3
"""Atlas memory capture hook — auto-saves durable facts to memory.

Fires on Stop and SubagentStop. Analyzes the session transcript from the
observability DB and extracts durable facts worth remembering:
  - User corrections (signals table) → "Don't do X, do Y instead"
  - Tool error patterns → "Tool X fails when Z"
  - Improvement decisions → "Changed from A to B because C"
  - Repeated prompts → "Workflow W should be done via skill S"

Unlike the old nudge.py which said "please capture a lesson," this hook
DOES the capture — no agent action required. It writes to
~/.atlas/memory/MEMORY.md and ~/.atlas/memory/PROJECT.md via atlas_memory.

Fail-open: any error exits 0 silently. Disable with ATLAS_MEMORY_CAPTURE=off.
"""

import json
import os
import sqlite3
import sys
import time


def _should_capture(conn, session_id):
    """True when this session has learnable signals worth capturing."""
    try:
        # Check for behavioral signals (corrections, assumption admissions)
        signals = conn.execute(
            "SELECT COUNT(*) FROM signals WHERE session_id=? "
            "AND signal_type IN ('user_correction', 'assumption_admission')",
            (session_id,),
        ).fetchone()[0]
        if signals > 0:
            return True, "behavioral signals"

        # Check for improvements
        run_row = conn.execute(
            "SELECT id FROM runs WHERE session_id=? ORDER BY id DESC LIMIT 1",
            (session_id,),
        ).fetchone()
        if run_row:
            improvements = conn.execute(
                "SELECT COUNT(*) FROM improvements WHERE run_id=?",
                (run_row[0],),
            ).fetchone()[0]
            if improvements > 0:
                return True, "improvements recorded"

        return False, "no learnable signals"
    except sqlite3.Error:
        return False, "DB error"


def _extract_facts(conn, session_id, cwd):
    """Extract durable facts from the session. Returns (memory_facts, project_facts)."""
    memory_facts = []  # general agent notes
    project_facts = []  # project-specific

    project_name = os.path.basename(cwd) if cwd else "unknown"

    # 1. User corrections → memory (agent-level lessons)
    try:
        for row in conn.execute(
            "SELECT snippet FROM signals WHERE session_id=? "
            "AND signal_type='user_correction' ORDER BY ts DESC LIMIT 5",
            (session_id,),
        ).fetchall():
            snippet = row[0]
            if snippet and snippet.strip():
                # Keep it concise — truncate to 200 chars
                fact = f"User correction ({project_name}): {snippet.strip()[:200]}"
                memory_facts.append(fact)
    except sqlite3.Error:
        pass

    # 2. Assumption admissions → memory (agent-level lessons)
    try:
        for row in conn.execute(
            "SELECT snippet FROM signals WHERE session_id=? "
            "AND signal_type='assumption_admission' ORDER BY ts DESC LIMIT 3",
            (session_id,),
        ).fetchall():
            snippet = row[0]
            if snippet and snippet.strip():
                fact = f"Assumption to avoid ({project_name}): {snippet.strip()[:200]}"
                memory_facts.append(fact)
    except sqlite3.Error:
        pass

    # 3. Improvements → project memory (project-specific decisions)
    try:
        run_row = conn.execute(
            "SELECT id FROM runs WHERE session_id=? ORDER BY id DESC LIMIT 1",
            (session_id,),
        ).fetchone()
        if run_row:
            for row in conn.execute(
                "SELECT dimension, baseline, target, note FROM improvements "
                "WHERE run_id=? ORDER BY id DESC LIMIT 5",
                (run_row[0],),
            ).fetchall():
                dim, baseline, target, note = row
                if note and note.strip():
                    fact = f"[{project_name}] {dim or 'Improvement'}: {note.strip()[:200]}"
                    project_facts.append(fact)
    except sqlite3.Error:
        pass

    # 4. Tool error patterns → memory (agent-level tool quirks)
    try:
        error_tools = conn.execute(
            "SELECT tool_name, COUNT(*) as cnt FROM tool_calls "
            "WHERE session_id=? AND is_error=1 "
            "GROUP BY tool_name HAVING cnt >= 1 ORDER BY cnt DESC LIMIT 3",
            (session_id,),
        ).fetchall()
        for tool_name, cnt in error_tools:
            if tool_name:
                fact = f"Tool '{tool_name}' errored {cnt}x in {project_name} — check usage pattern"
                memory_facts.append(fact)
    except sqlite3.Error:
        pass

    return memory_facts, project_facts


def main():
    if os.environ.get("ATLAS_MEMORY_CAPTURE", "on").lower() == "off":
        sys.exit(0)

    raw = ""
    try:
        raw = sys.stdin.read()
    except Exception:
        pass
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, ValueError):
        payload = {}

    session_id = payload.get("session_id", "")
    cwd = payload.get("cwd", "")

    if not session_id:
        sys.exit(0)

    # Connect to the atlas DB
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

    db_path = os.environ.get("ATLAS_DB", os.path.expanduser("~/.atlas/atlas.db"))
    if not os.path.exists(db_path):
        sys.exit(0)  # no DB yet — nothing to learn from

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except sqlite3.Error:
        sys.exit(0)

    captured = {"memory": 0, "project": 0, "facts": []}

    try:
        should, reason = _should_capture(conn, session_id)
        if not should:
            sys.exit(0)

        memory_facts, project_facts = _extract_facts(conn, session_id, cwd)

        if not memory_facts and not project_facts:
            sys.exit(0)

        # Write to memory
        import atlas_memory

        for fact in memory_facts:
            result = atlas_memory.add("memory", fact)
            if result.get("success"):
                captured["memory"] += 1
                captured["facts"].append(fact[:80])

        for fact in project_facts:
            result = atlas_memory.add("project", fact)
            if result.get("success"):
                captured["project"] += 1
                captured["facts"].append(fact[:80])

    except Exception:
        sys.exit(0)  # fail-open
    finally:
        try:
            conn.close()
        except Exception:
            pass

    # Report what was captured via additionalContext (non-blocking)
    if captured["memory"] or captured["project"]:
        msg = (
            f"[atlas] Self-improvement: captured {captured['memory']} memory fact(s) "
            f"and {captured['project']} project fact(s) from this session. "
            f"They will be available next session."
        )
        if captured["facts"]:
            msg += " Captured: " + "; ".join(captured["facts"][:3])
        sys.stdout.write(json.dumps({"additionalContext": msg}))
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(0)