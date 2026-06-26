#!/usr/bin/env python3
"""Mirror this session's transcript into the atlas observability DB.

Fires on Stop, SubagentStop, SessionEnd, and PreCompact. Each call reads only
the new bytes of the transcript since the stored cursor, so it stays cheap even
mid-session. Fail-open: any error exits 0 and never blocks the session. Disable
with ATLAS_INGEST=off.

The on-disk transcript - not this hook's stdin payload - is the source of truth;
the payload only tells us which file to read (transcript_path) and the
session/cwd to attribute it to.
"""

import json
import os
import sys


def main():
    if os.environ.get("ATLAS_INGEST", "on").lower() == "off":
        return
    raw = sys.stdin.read()
    payload = json.loads(raw) if raw.strip() else {}
    path = payload.get("transcript_path")
    if not path or not os.path.exists(path):
        return  # nothing to ingest yet
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
    import session_ingest

    session_ingest.ingest_transcript(path, session_id=payload.get("session_id"))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # observability is best-effort; never block a session
    sys.exit(0)
