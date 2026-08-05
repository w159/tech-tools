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
import atlas_hook_guard  # noqa: E402


def main():
    if os.environ.get("ATLAS_INGEST", "on").lower() == "off":
        return
    payload = atlas_hook_guard.read_payload()
    if not atlas_hook_guard.should_run(payload, "ingest_session", kind="capture"):
        return
    path = payload.get("transcript_path")
    if not path or not os.path.exists(path):
        return  # nothing to ingest yet
    import session_ingest

    session_ingest.ingest_transcript(path, session_id=payload.get("session_id"))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # observability is best-effort; never block a session
    sys.exit(0)
