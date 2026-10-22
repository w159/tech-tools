"""Apply dashboard-saved behavior knobs to the environment of one hook run.

Claude Code exports its settings.json env block only at session start, so a knob saved
mid-session never reaches a running session's hooks. The dashboard also writes the knob to
<ATLAS_HOME or ~/.atlas>/settings.json {"env": {...}}; every hook entry calls
apply_store_env() before reading any knob. The store wins over an inherited value because
the inherited one is the stale copy from session start. Stdlib only; fails open.
"""

import json
import os


def apply_store_env(environ=None):
    """Set each string value of the store's "env" into environ (default os.environ)."""
    env = os.environ if environ is None else environ
    try:
        home = env.get("ATLAS_HOME") or os.path.join(os.path.expanduser("~"), ".atlas")
        with open(os.path.join(home, "settings.json"), encoding="utf-8") as fh:
            stored = json.load(fh)["env"]
        applied = {k: v for k, v in stored.items() if isinstance(k, str) and isinstance(v, str)}
    except Exception:
        return {}
    env.update(applied)
    return applied
