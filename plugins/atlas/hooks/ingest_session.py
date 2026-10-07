#!/usr/bin/env python3
"""Mirror this session's transcript into the atlas observability DB.

Fires on Stop, SubagentStop, SessionEnd, and PreCompact. Each call reads only
the new bytes of the transcript since the stored cursor, so it stays cheap even
mid-session. Fail-open: any error exits 0 and never blocks the session. Disable
with ATLAS_INGEST=off.

The on-disk transcript - not this hook's stdin payload - is the source of truth;
the payload only tells us which file to read (transcript_path) and the
session/cwd to attribute it to.

stop_hook_active and the session circuit breaker are checked via
atlas_hook_guard (window_seconds=None -- this hook has no throttle of its
own, only the breaker that silences a thrashing Stop chain).
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import atlas_faults  # noqa: E402
import atlas_hook_guard  # noqa: E402


def _spawn_scoring(payload):
    """At SessionEnd only, score the session in a detached process so the
    network call never touches the hook's latency budget. Fail-open."""
    sid = payload.get("session_id")
    if payload.get("hook_event_name") != "SessionEnd" or not sid:
        return
    try:
        import subprocess

        import typesafe_client

        if not typesafe_client.available():
            return
        script = os.path.join(
            os.path.dirname(__file__), "..", "scripts", "turn_scoring.py"
        )
        subprocess.Popen(
            [sys.executable, script, "--session", sid],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except Exception as exc:
        atlas_faults.record("ingest_session.scoring", exc)


def _leaks_to_real_db(path, atlas_db):
    """A transcript under the OS temp dir headed for the DEFAULT ~/.atlas DB is
    test/benchmark leakage (252 such sessions polluted the real DB). Anything
    that isolates state (ATLAS_DB / ATLAS_HOME) or opts in with
    ATLAS_ALLOW_TMP_INGEST=1 is a deliberate run and ingests normally."""
    if os.environ.get("ATLAS_ALLOW_TMP_INGEST") == "1":
        return False
    if os.environ.get("ATLAS_DB") or os.environ.get("ATLAS_HOME"):
        return False
    return atlas_db.is_tmp_path(path)


def _refresh_facet(path, session_id, session_ingest):
    """Keep the facet row in step with session_logs after EVERY ingest, not only
    at Stop: SubagentStop/SessionEnd/PreCompact (and omp's shutdown) ingest more
    rows after the last Stop facet was written (62% of facets were stale)."""
    if os.environ.get("ATLAS_CHRONICLE", "on").lower() == "off":
        return
    try:
        import chronicle_facet

        sid = (
            session_id
            or session_ingest._read_session_id(path)
            or os.path.splitext(os.path.basename(path))[0]
        )
        chronicle_facet.refresh(sid)
    except Exception as exc:
        atlas_faults.record("ingest_session.facet", exc)


def main():
    if os.environ.get("ATLAS_INGEST", "on").lower() == "off":
        return
    payload = atlas_hook_guard.read_payload()
    payload = payload if isinstance(payload, dict) else {}
    if not atlas_hook_guard.should_run(payload, "ingest_session", kind="capture"):
        return
    path = payload.get("transcript_path")
    if not path or not os.path.exists(path):
        return  # nothing to ingest yet
    import atlas_db

    if _leaks_to_real_db(path, atlas_db):
        return
    import session_ingest

    session_id = payload.get("session_id")
    session_ingest.ingest_transcript(path, session_id=session_id)
    _refresh_facet(path, session_id, session_ingest)
    _spawn_scoring(payload)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        atlas_faults.record("ingest_session", exc)  # best-effort; never block a session
    sys.exit(0)
