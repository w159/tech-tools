#!/usr/bin/env python3
"""Thin entry for completion_gate: the body lives in completion_gate_core so Python caches its
bytecode (a script run as __main__ is recompiled on every call). Importing this
module yields the core module itself, so `import completion_gate` / mock.patch keep working.

Run as a hook, a crash while loading the core must not disarm the gate
silently: it records a hook-faults row, tells the user in a systemMessage
(plain hook stdout reaches only Claude Code's debug log) and exits 0."""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))

try:
    import atlas_env  # noqa: E402
    atlas_env.apply_store_env()

    import completion_gate_core as _core
except Exception as _exc:  # noqa: BLE001 -- a broken import must be a visible fail-open
    if __name__ != "__main__":
        raise
    import json

    try:
        import atlas_hook_guard

        atlas_hook_guard.fault("completion_gate", _exc, os.getcwd())
    except Exception:  # noqa: BLE001 -- the fault log is best effort
        pass
    sys.stdout.write(
        json.dumps(
            {
                "systemMessage": "[atlas] completion-gate FAIL-OPEN: the hook could not load "
                f"({type(_exc).__name__}: {_exc}), so it checked nothing this time; "
                "the error is logged in hook-faults.jsonl."
            }
        )
    )
    sys.exit(0)

if __name__ == "__main__":
    _core._cli()
else:
    sys.modules[__name__] = _core
