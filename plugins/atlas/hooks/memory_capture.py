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

import hashlib
import json
import os
import sqlite3
import sys
import time

CAPTURE_WINDOW_SECONDS = 900  # blast-radius cap: at most once per 15 minutes
SEEN_MAX_LINES = 500  # cap the seen-hash file so it cannot grow unbounded


def _capture_marker_path():
    base = os.path.join(os.path.expanduser("~"), ".atlas")
    try:
        os.makedirs(base, exist_ok=True)
    except Exception:
        base = "/tmp"
    return os.path.join(base, ".atlas_memory_capture")


def _throttled(path):
    """At-most-once-per-window guard, mirrors nudge.py's marker-file pattern.
    This is the blast-radius cap: even if the seen-hash dedupe below somehow
    misses a duplicate, this hook still cannot fire more than once per window."""
    try:
        last = os.path.getmtime(path)
        if (time.time() - last) < CAPTURE_WINDOW_SECONDS:
            return True
    except Exception:
        pass
    try:
        with open(path, "w") as f:
            f.write(str(time.time()))
    except Exception:
        pass
    return False


def _seen_hashes_path():
    return os.path.join(os.path.expanduser("~"), ".atlas", ".memory_capture_seen")


def _hash_key(raw_text):
    """sha256 of the durable raw content (never the formatted, per-cwd fact
    string) so a fact is recognized as the same fact across subagent dirs."""
    return hashlib.sha256(raw_text.strip().encode("utf-8", "replace")).hexdigest()[:16]


def _load_seen_hashes(path):
    try:
        with open(path) as f:
            return {line.strip() for line in f if line.strip()}
    except Exception:
        return set()


def _append_seen_hashes(path, new_hashes):
    """Persist newly-announced fact hashes. Fail-open: any IO error here must
    not affect the hook result, since the fact was already written to memory
    by the time this is called."""
    if not new_hashes:
        return
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        existing = []
        if os.path.exists(path):
            with open(path) as f:
                existing = [line.strip() for line in f if line.strip()]
        for h in new_hashes:
            if h not in existing:
                existing.append(h)
        existing = existing[-SEEN_MAX_LINES:]  # cap unbounded growth
        with open(path, "w") as f:
            f.write("\n".join(existing) + "\n")
    except Exception:
        pass


class _Fact(str):
    """A captured fact string that also carries the durable dedupe key (the
    raw signal content) separately from its formatted display text. Needed
    because the display text embeds a per-cwd project label, which would
    defeat a naive string-hash dedupe across subagents running in different
    working directories."""

    def __new__(cls, text, dedupe_key):
        obj = str.__new__(cls, text)
        obj.dedupe_key = dedupe_key
        return obj


def _resolve_scope(conn, session_id):
    """Resolve the session_ids and run_ids worth querying for this Stop hook.

    The Stop hook fires with one session_id, but the learnable signals often
    live under a DIFFERENT session_id: the orchestrating run's own session
    (when the Stop session is a subagent with no run of its own) or subagent
    sessions in the orchestrating run's project. The schema has no
    parent_run_id, so the orbit is approximated by project + recency: the
    orchestrating run in the same project, plus session_logs rows started
    during that run. Fail-open: any DB error collapses to just the literal
    session_id.
    """
    # ponytail: project+recency heuristic, not a parent_run_id link; upgrade to
    # an explicit run->subagent mapping if cross-run noise in one project shows.
    session_ids = {session_id}
    run_ids = set()
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        rid = atlas_db.current_run_id(conn, session_id) or atlas_db.latest_run_id(
            conn, session_id
        )
        project_id, run_started = None, None
        if rid:
            run_ids.add(rid)
            row = conn.execute(
                "SELECT session_id, project_id, started_at FROM runs WHERE id=?",
                (rid,),
            ).fetchone()
            if row:
                session_ids.add(row[0])
                project_id, run_started = row[1], row[2]
        if project_id is None:
            # Stop session has no run; link it to a project via session_logs.
            row = conn.execute(
                "SELECT project_id FROM session_logs WHERE session_id=?",
                (session_id,),
            ).fetchone()
            if row:
                project_id = row[0]
        if project_id:
            orch = conn.execute(
                "SELECT id, session_id, started_at FROM runs "
                "WHERE project_id=? AND orchestrating=1 ORDER BY id DESC LIMIT 1",
                (project_id,),
            ).fetchone()
            if orch:
                run_ids.add(orch[0])
                session_ids.add(orch[1])
                if run_started is None:
                    run_started = orch[2]
            if run_started is not None:
                for sid in conn.execute(
                    "SELECT session_id FROM session_logs "
                    "WHERE project_id=? AND started_at>=? AND session_id!=?",
                    (project_id, run_started, session_id),
                ).fetchall():
                    session_ids.add(sid[0])
    except sqlite3.Error:
        pass
    return session_ids, run_ids


def _in_clause(values):
    """Placeholders + params for an IN (...) clause built from one tuple."""
    params = tuple(values)
    return ",".join("?" * len(params)), params


def _should_capture(conn, session_id):
    """True when this session (or its orchestrating run's orbit) has learnable
    signals worth capturing."""
    try:
        session_ids, run_ids = _resolve_scope(conn, session_id)
        ph, params = _in_clause(session_ids)
        signals = conn.execute(
            "SELECT COUNT(*) FROM signals WHERE session_id IN (" + ph + ") "
            "AND signal_type IN ('user_correction', 'assumption_admission')",
            params,
        ).fetchone()[0]
        if signals > 0:
            return True, "behavioral signals"

        if run_ids:
            rph, rparams = _in_clause(run_ids)
            improvements = conn.execute(
                "SELECT COUNT(*) FROM improvements WHERE run_id IN (" + rph + ")",
                rparams,
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

    try:
        session_ids, run_ids = _resolve_scope(conn, session_id)
    except sqlite3.Error:
        session_ids, run_ids = {session_id}, set()

    # 1. User corrections → memory (agent-level lessons)
    try:
        ph, params = _in_clause(session_ids)
        for row in conn.execute(
            "SELECT snippet FROM signals WHERE session_id IN (" + ph + ") "
            "AND signal_type='user_correction' ORDER BY ts DESC LIMIT 5",
            params,
        ).fetchall():
            snippet = row[0]
            if snippet and snippet.strip():
                # Keep it concise — truncate to 200 chars
                clean = snippet.strip()
                fact = _Fact(f"User correction ({project_name}): {clean[:200]}", clean)
                memory_facts.append(fact)
    except sqlite3.Error:
        pass

    # 2. Assumption admissions → memory (agent-level lessons)
    try:
        ph, params = _in_clause(session_ids)
        for row in conn.execute(
            "SELECT snippet FROM signals WHERE session_id IN (" + ph + ") "
            "AND signal_type='assumption_admission' ORDER BY ts DESC LIMIT 3",
            params,
        ).fetchall():
            snippet = row[0]
            if snippet and snippet.strip():
                clean = snippet.strip()
                fact = _Fact(
                    f"Assumption to avoid ({project_name}): {clean[:200]}", clean
                )
                memory_facts.append(fact)
    except sqlite3.Error:
        pass

    # 3. Improvements → project memory (project-specific decisions)
    try:
        if run_ids:
            rph, rparams = _in_clause(run_ids)
            for row in conn.execute(
                "SELECT dimension, baseline, target, note FROM improvements "
                "WHERE run_id IN (" + rph + ") ORDER BY id DESC LIMIT 5",
                rparams,
            ).fetchall():
                dim, baseline, target, note = row
                if note and note.strip():
                    clean = note.strip()
                    dim_label = dim or "Improvement"
                    fact = _Fact(
                        f"[{project_name}] {dim_label}: {clean[:200]}",
                        f"{dim_label}:{clean}",
                    )
                    project_facts.append(fact)
    except sqlite3.Error:
        pass

    # 4. Tool error patterns → memory (agent-level tool quirks)
    # Only capture persistent errors (≥3 failures of the same tool in a session).
    # Single Bash/Read failures are normal during development and create noise.
    # Also skip "trivial" tools where single failures are expected (Bash, Read, Glob, Grep).
    TRIVIAL_TOOLS = {"Bash", "Read", "Glob", "Grep"}
    try:
        ph, params = _in_clause(session_ids)
        error_tools = conn.execute(
            "SELECT tool_name, COUNT(*) as cnt FROM tool_calls "
            "WHERE session_id IN (" + ph + ") AND is_error=1 "
            "GROUP BY tool_name HAVING cnt >= 3 ORDER BY cnt DESC LIMIT 3",
            params,
        ).fetchall()
        for tool_name, cnt in error_tools:
            if tool_name and tool_name not in TRIVIAL_TOOLS:
                fact = _Fact(
                    f"Tool '{tool_name}' errored {cnt}x in {project_name} — check usage pattern",
                    f"tool_error:{tool_name}",
                )
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

    # Loop guard: never re-capture on a continuation this Stop hook forced.
    if payload.get("stop_hook_active"):
        sys.exit(0)

    session_id = payload.get("session_id", "")
    cwd = payload.get("cwd", "")

    if not session_id:
        sys.exit(0)

    if _throttled(_capture_marker_path()):
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

        # Content-hash dedupe: a fact already announced in a prior turn (even
        # under a different cwd/project label) must never be re-announced --
        # that is what let the fact-string dedupe in atlas_memory.add miss and
        # sustained the Stop-hook loop.
        seen_path = _seen_hashes_path()
        seen = _load_seen_hashes(seen_path)

        def _fresh(facts):
            fresh = []
            for fact in facts:
                key = getattr(fact, "dedupe_key", fact)
                h = _hash_key(key)
                if h in seen:
                    continue
                seen.add(h)  # also dedupes within this same batch
                fresh.append((fact, h))
            return fresh

        fresh_memory = _fresh(memory_facts)
        fresh_project = _fresh(project_facts)

        if not fresh_memory and not fresh_project:
            sys.exit(0)  # nothing NEW -> emit nothing, so the loop cannot sustain

        # Write to memory
        import atlas_memory

        for fact, h in fresh_memory:
            result = atlas_memory.add("memory", fact)
            if result.get("success"):
                captured["memory"] += 1
                captured["facts"].append(fact[:80])
                _append_seen_hashes(seen_path, [h])

        for fact, h in fresh_project:
            result = atlas_memory.add("project", fact)
            if result.get("success"):
                captured["project"] += 1
                captured["facts"].append(fact[:80])
                _append_seen_hashes(seen_path, [h])

    except Exception as exc:
        # fail-open: never block the hook. But surface the failure on stderr so
        # a silent capture miss is observable instead of invisible.
        try:
            sys.stderr.write(f"[atlas] memory_capture fail-open: {exc}\n")
        except Exception:
            pass
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
        sys.stdout.write(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": payload.get("hook_event_name", "Stop"),
                        "additionalContext": msg,
                    }
                }
            )
        )
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(0)
