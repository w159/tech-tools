#!/usr/bin/env python3
"""Stop tail: ingest_session, chronicle_facet, memory_capture and nudge in one process.

Four separate interpreters cost four cold starts per Stop. Each hook still owns
its own logic, payload read, throttle and fail-open handling; this runner only
feeds the one stdin payload to each main() in the order hooks.json used to list
them, and isolates failures the way each hook's own `__main__` guard did: a
SystemExit or any Exception from one hook never stops the next. Only nudge
writes to stdout, so the combined stream stays one JSON document.

Time budget: hooks.json gives this process 60 s. chronicle_facet and
memory_capture read the signals/tool_calls rows ingest_session writes, so ingest
must stay first; instead of reordering, every hook gets a bounded SIGALRM slice
(SLICES_S, 51 s in total) so a slow ingest cannot starve the rest. Ingest is
incremental (byte cursor), so an interrupted run resumes on the next ingest.
Platforms without SIGALRM run unbounded, as before.
"""

import io
import os
import signal
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
sys.path.insert(0, os.path.join(_HERE, "..", "scripts"))
import atlas_env  # noqa: E402
atlas_env.apply_store_env()

TAIL = ("ingest_session", "chronicle_facet", "memory_capture", "nudge")


# Seconds per hook; the sum stays under the 60 s hooks.json timeout.
SLICES_S = {"ingest_session": 30, "chronicle_facet": 8, "memory_capture": 8, "nudge": 5}


class _SliceExpired(BaseException):
    """BaseException so a hook's own `except Exception` cannot swallow it."""


def _on_alarm(signum, frame):
    raise _SliceExpired()


def _run(name: str, raw: str) -> None:
    saved = sys.stdin
    sys.stdin = io.StringIO(raw)
    bounded = hasattr(signal, "SIGALRM") and SLICES_S.get(name, 0) > 0
    old_handler = None
    try:
        if bounded:
            try:
                old_handler = signal.signal(signal.SIGALRM, _on_alarm)
                signal.setitimer(signal.ITIMER_REAL, SLICES_S[name])
            except (ValueError, OSError):  # not the main thread: run unbounded
                bounded = False
        __import__(name).main()
    except SystemExit:
        pass
    except _SliceExpired:
        try:
            import atlas_faults

            atlas_faults.record(name, TimeoutError("stop_tail slice expired"))
        except Exception:
            pass
    except Exception as exc:  # same net as each hook's __main__ block
        try:
            import atlas_faults

            atlas_faults.record(name, exc)
        except Exception:
            pass
    finally:
        if bounded:
            try:
                signal.setitimer(signal.ITIMER_REAL, 0)
                signal.signal(signal.SIGALRM, old_handler or signal.SIG_DFL)
            except (ValueError, OSError):
                pass
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
