#!/usr/bin/env python3
"""Atlas chronicle facet hook — emits one deterministic facet row per session.

Fires on Stop, after ingest_session.py has mirrored the transcript into the
observability DB (session_logs/messages/tool_calls/signals) and derived this
run's metrics. This hook does NOT re-parse the transcript: it only queries
what ingest_session.py already wrote, aggregates it into one row of
`facets`, and leaves the LLM-enriched columns NULL for the doctor to fill in
later (see atlas_db.pending_facets).

It also mirrors this session's `signals` rows into `friction_events`,
categorized by FRICTION_CATEGORY_BY_SIGNAL below.

No LLM call, no network. Fail-open: any error exits 0 silently. Disable with
ATLAS_CHRONICLE=off.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import atlas_hook_guard  # noqa: E402

# Maps a `signals.signal_type` to a friction_events.category. Extend here as
# session_ingest.py learns to detect new signal types.
FRICTION_CATEGORY_BY_SIGNAL = {
    "user_correction": "user_correction",
    "assumption_admission": "assumption_admission",
    "error_report": "error_report",
    "unverified_claim": "friction",
}

# friction_events rows written by other hooks (completion_gate's gate blocks,
# memory_capture's drops). _sync_friction_events must not delete these when it
# re-mirrors `signals`, or it would erase the only record of them.
GATE_BLOCK_CATEGORY = "gate_block"


def _edit_read_counts(conn, session_id):
    edit_count = conn.execute(
        "SELECT COUNT(*) FROM tool_calls WHERE session_id=? "
        "AND tool_name IN ('Edit','Write','MultiEdit','NotebookEdit')",
        (session_id,),
    ).fetchone()[0]
    read_count = conn.execute(
        "SELECT COUNT(*) FROM tool_calls WHERE session_id=? "
        "AND tool_name IN ('Read','Grep','Glob')",
        (session_id,),
    ).fetchone()[0]
    return edit_count, read_count


def _gate_block_count(conn, session_id):
    """How many times completion_gate blocked this session (friction_events)."""
    return conn.execute(
        "SELECT COUNT(*) FROM friction_events WHERE session_id=? AND category=?",
        (session_id, GATE_BLOCK_CATEGORY),
    ).fetchone()[0]


def _compute_facet_fields(conn, session_id):
    """Deterministic facet columns, sourced entirely from tables ingest_session.py
    already populated. Every lookup here is a session_id/run_id equality match;
    session_logs.session_id, tool_calls.session_id, and signals.session_id all
    have an index (metrics.run_id is the table's own primary key). `runs` has
    no session_id index — noted in the implementation report as a gap, not
    fixed here per the task's instruction not to add indexes in this task."""
    import atlas_db

    row = conn.execute(
        "SELECT project_id, message_count, user_prompt_count, tool_call_count, "
        "error_count FROM session_logs WHERE session_id=?",
        (session_id,),
    ).fetchone()
    ingested = row is not None
    if row:
        project_id, message_count, user_prompt_count, tool_call_count, error_count = row
    else:
        project_id = message_count = user_prompt_count = tool_call_count = (
            error_count
        ) = None

    run_id = atlas_db.current_run_id(conn, session_id) or atlas_db.latest_run_id(
        conn, session_id
    )
    # NULL means "no run to count dispatches against" -- distinct from a real
    # run that legitimately had zero dispatches.
    dispatch_count = None
    verifier_coverage = None
    wall_clock_s = None
    if run_id is not None:
        dispatch_count = conn.execute(
            "SELECT COUNT(*) FROM dispatches WHERE run_id=?", (run_id,)
        ).fetchone()[0]
        metrics_row = conn.execute(
            "SELECT verifier_coverage, wall_clock_s FROM metrics WHERE run_id=?",
            (run_id,),
        ).fetchone()
        if metrics_row:
            verifier_coverage, wall_clock_s = metrics_row

    # edit_count/read_count/correction_count all read from tables the transcript
    # mirror (ingest_session.py) populates -- tool_calls and signals. Before that
    # mirror ever ran for this session, "0" is a false claim of "no edits/reads/
    # corrections happened"; NULL is the honest "not yet ingested."
    if ingested:
        edit_count, read_count = _edit_read_counts(conn, session_id)
        correction_count = conn.execute(
            "SELECT COUNT(*) FROM signals WHERE session_id=? "
            "AND signal_type='user_correction'",
            (session_id,),
        ).fetchone()[0]
    else:
        edit_count = read_count = correction_count = None

    return {
        "project_id": project_id,
        "message_count": message_count,
        "user_prompt_count": user_prompt_count,
        "tool_call_count": tool_call_count,
        "error_count": error_count,
        "dispatch_count": dispatch_count,
        "verifier_coverage": verifier_coverage,
        "wall_clock_s": wall_clock_s,
        "edit_count": edit_count,
        "read_count": read_count,
        # completion_gate.py records one friction_events row per block decision
        # (category `gate_block`), so this is a real count. It stays NULL only
        # when the transcript has not been ingested, matching edit/read/
        # correction_count: before ingest, "0 blocks" is a claim we cannot make.
        "gate_block_count": _gate_block_count(conn, session_id) if ingested else None,
        "correction_count": correction_count,
    }


def _sync_friction_events(conn, session_id):
    """Replace this session's signal-derived friction_events with a fresh mirror
    of its `signals` rows. Delete-then-reinsert (rather than tracking which
    signals were already mirrored) keeps this idempotent across repeat Stop
    firings without needing a new unique constraint on friction_events.

    The delete is scoped to the categories THIS hook mirrors. Rows other hooks
    own -- completion_gate's `gate_block`, memory_capture's `memory_drop` -- are
    never sourced from `signals`, so an unscoped delete would erase them on the
    next Stop and leave no record they ever happened."""
    import atlas_db

    signals = conn.execute(
        "SELECT signal_type, weight, snippet, ts FROM signals WHERE session_id=?",
        (session_id,),
    ).fetchall()
    mirrored = sorted(set(FRICTION_CATEGORY_BY_SIGNAL.values()))
    conn.execute(
        "DELETE FROM friction_events WHERE session_id=? AND category IN (%s)"
        % ",".join("?" * len(mirrored)),
        (session_id, *mirrored),
    )
    for signal_type, weight, snippet, ts in signals:
        category = FRICTION_CATEGORY_BY_SIGNAL.get(signal_type)
        if category is None:
            continue
        atlas_db.record_friction(
            conn, session_id, category, weight=weight or 1.0, snippet=snippet, ts=ts
        )


def main():
    if os.environ.get("ATLAS_CHRONICLE", "on").lower() == "off":
        sys.exit(0)

    payload = atlas_hook_guard.read_payload()
    session_id = payload.get("session_id", "")
    if not session_id:
        sys.exit(0)

    # No window: this must stay fresh every Stop (deterministic counts change
    # every turn), so only stop_hook_active and the circuit breaker gate it.
    if not atlas_hook_guard.should_run(payload, "chronicle_facet", kind="capture"):
        sys.exit(0)

    db_path = os.environ.get("ATLAS_DB", os.path.expanduser("~/.atlas/atlas.db"))
    if not os.path.exists(db_path):
        sys.exit(0)  # no DB yet -- nothing to chronicle

    try:
        import atlas_db

        conn = atlas_db.connect(db_path)
    except Exception:
        sys.exit(0)

    try:
        fields = _compute_facet_fields(conn, session_id)
        atlas_db.upsert_facet(conn, session_id, **fields)
        _sync_friction_events(conn, session_id)
    except Exception as exc:
        try:
            sys.stderr.write(f"[atlas] chronicle_facet fail-open: {exc}\n")
        except Exception:
            pass
    finally:
        try:
            conn.close()
        except Exception:
            pass

    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(0)
