#!/usr/bin/env python3
"""Thin entry for prompt_optimizer: the body lives in prompt_optimizer_core so Python caches its
bytecode (a script run as __main__ is recompiled on every call). Importing this
module yields the core module itself, so `import prompt_optimizer` / mock.patch keep working."""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
try:
    import atlas_env  # noqa: E402
    atlas_env.apply_store_env()

    import prompt_optimizer_core as _core
except Exception as _exc:  # noqa: BLE001 -- a broken import must be a visible fail-open
    if __name__ != "__main__":
        raise
    import json

    try:
        import atlas_hook_guard

        atlas_hook_guard.fault("prompt_optimizer", _exc, os.getcwd())
    except Exception:  # noqa: BLE001 -- the fault log is best effort
        pass
    sys.stdout.write(
        json.dumps(
            {
                "systemMessage": "[atlas] prompt_optimizer FAIL-OPEN: the hook could not load "
                f"({type(_exc).__name__}: {_exc}), so it did nothing this time; "
                "the error is logged in hook-faults.jsonl."
            }
        )
    )
    sys.exit(0)

if __name__ == "__main__":
    _core._cli()
else:
    sys.modules[__name__] = _core
