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

The Stop-hook loop guard (stop_hook_active, the throttle window, and the
session circuit breaker) lives in atlas_hook_guard now. The seen-hash dedupe
below is a SEPARATE, older mechanism about facts (durable content already
captured to memory across sessions) and is kept independent of it.

Fail-open: any error exits 0 silently. Disable with ATLAS_MEMORY_CAPTURE=off.
"""

import hashlib
import os
import re
import sqlite3
import sys

CAPTURE_WINDOW_SECONDS = 900  # blast-radius cap: at most once per 15 minutes
SEEN_MAX_LINES = 500  # cap the seen-hash file so it cannot grow unbounded

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import atlas_hook_guard  # noqa: E402


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
    # A subagent's cwd basename becomes agent-<hex> or .run, which is not a
    # project. Lessons filed under those scopes are unfindable and duplicate the
    # same lesson once per dispatched agent.
    if _JUNK_SCOPE.match(project_name):
        return [], []

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
                fact = _Fact(f"User correction ({project_name}): {_clip(clean)}", clean)
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
                    f"Assumption to avoid ({project_name}): {_clip(clean)}", clean
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
                        f"[{project_name}] {dim_label}: {_clip(clean)}",
                        f"{dim_label}:{clean}",
                    )
                    project_facts.append(fact)
    except sqlite3.Error:
        pass

    # 4. Tool error patterns → memory (agent-level tool quirks)
    # Tool-error tallies are NOT captured as memory. They live in atlas_db
    # (queryable by atlas-audit) and their only consumer was SessionStart recall,
    # where 40+ lines of "Tool 'Write' errored 2x in agent-a870d7a4169e4bb8b"
    # buried every real lesson. A tally names no lesson and no action.

    return memory_facts, project_facts


# A subagent's cwd basename is not a project name.
_JUNK_SCOPE = re.compile(r"^(agent-[0-9a-f]{6,}|\.run|\.atlas|)$")


def _clip(text, limit=200):
    """Truncate on a word boundary. A fact cut mid-word ("It just never ran,
    because the") is unreadable, and recall showed a screenful of them."""
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return (cut or text[:limit]).rstrip(",;:-") + "..."


def _record_drop(session_id, kind, result):
    """A lesson could not be stored: record it instead of discarding it.

    The hook's own `conn` is opened read-only, so this takes its own
    short-lived write connection. Fail-open in every direction: a logging
    failure must never cost us the capture path or block Stop.
    """
    try:
        import atlas_db

        reason = (result or {}).get("error") or "unknown"
        conn = atlas_db.connect()
        try:
            atlas_db.record_friction(
                conn,
                session_id,
                "memory_drop",
                weight=1.0,
                snippet=f"{kind}: {reason}"[:200],
            )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass
    # Surface it too -- a drop that is only in the DB is still invisible today.
    try:
        sys.stderr.write(
            f"[atlas] memory_capture dropped a {kind} lesson: "
            f"{(result or {}).get('error', 'unknown')}\n"
        )
    except Exception:
        pass


def main():
    if os.environ.get("ATLAS_MEMORY_CAPTURE", "on").lower() == "off":
        sys.exit(0)

    payload = atlas_hook_guard.read_payload()

    session_id = payload.get("session_id", "")
    cwd = payload.get("cwd", "")

    if not session_id:
        sys.exit(0)

    # stop_hook_active, the throttle window, and the circuit breaker.
    if not atlas_hook_guard.should_run(
        payload, "memory_capture", window_seconds=CAPTURE_WINDOW_SECONDS, kind="capture"
    ):
        sys.exit(0)

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
            else:
                _record_drop(session_id, "memory", result)

        for fact, h in fresh_project:
            result = atlas_memory.add("project", fact)
            if result.get("success"):
                captured["project"] += 1
                captured["facts"].append(fact[:80])
                _append_seen_hashes(seen_path, [h])
            else:
                _record_drop(session_id, "project", result)

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

    # Silent on success. Capture is bookkeeping the user did not ask to watch,
    # and additionalContext on Stop costs a whole model turn to narrate it. The
    # facts are in ~/.atlas/memory/ and surface next SessionStart. Same defect
    # nudge.py carried until 5.9.0.
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(0)
