#!/usr/bin/env python3
"""Stop tail: ingest_session, chronicle_facet, memory_capture and nudge in one process.

Four separate interpreters cost four cold starts per Stop. Each hook still owns
its own logic, payload read, throttle and fail-open handling; this runner only
feeds the one stdin payload to each main() in the order hooks.json used to list
them, and isolates failures the way each hook's own `__main__` guard did: a
SystemExit or any Exception from one hook never stops the next. Only nudge
writes to stdout, so the combined stream stays one JSON document.
"""

import io
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
sys.path.insert(0, os.path.join(_HERE, "..", "scripts"))
import atlas_env  # noqa: E402
atlas_env.apply_store_env()

TAIL = ("ingest_session", "chronicle_facet", "memory_capture", "nudge")


def _run(name: str, raw: str) -> None:
    saved = sys.stdin
    sys.stdin = io.StringIO(raw)
    try:
        __import__(name).main()
    except SystemExit:
        pass
    except Exception as exc:  # same net as each hook's __main__ block
        try:
            import atlas_faults

            atlas_faults.record(name, exc)
        except Exception:
            pass
    finally:
        sys.stdin = saved


def main() -> int:
    try:
        raw = sys.stdin.read()
    except Exception:
        raw = ""
    for name in TAIL:
        _run(name, raw)
    return 0


if __name__ == "__main__":
    sys.exit(main())
