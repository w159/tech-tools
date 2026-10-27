#!/usr/bin/env python3
"""Advisory: nudge when an edit targets a file read only through ctx_read.

pi-lens' read-guard credits the builtin read tool, not lean-ctx's ctx_read, so an
edit after a ctx_read-only read is rejected. One script, two bindings:
  PostToolUse (Read|read|ctx_read): record the path per session in hookstate.
  PreToolUse  (Edit|edit): if the path was ctx_read but never builtin-read,
  emit additionalContext. Never denies; any error exits 0 (fail-open).
"""

import os
import re
import sys

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
)
import atlas_env  # noqa: E402
atlas_env.apply_store_env()
import atlas_hook_guard  # noqa: E402

MSG = (
    "pi-lens read-guard does not credit ctx_read; read the file with the builtin "
    'read path="%s:N-M" before edit'
)


def _norm(data):
    """Absolute path of the tool target, ':N-M' read selector stripped."""
    ti = data.get("tool_input") or {}
    fp = ti.get("file_path") or ti.get("path")
    if not isinstance(fp, str) or not fp or "://" in fp:
        return None
    fp = re.sub(r":[\d,+\-]+$", "", fp)
    return os.path.normpath(os.path.join(data.get("cwd") or os.getcwd(), fp))


def main() -> int:
    data = atlas_hook_guard.load_payload("edit_read_nudge")
    sid, tool, fp = data.get("session_id"), data.get("tool_name") or "", _norm(data)
    if not sid or not fp:
        return 0
    lower = tool.lower()
    if lower in ("edit", "multiedit"):
        with atlas_hook_guard._locked(sid):
            reads = atlas_hook_guard._load_state(sid).get("reads", {})
        if fp in reads.get("ctx", []) and fp not in reads.get("builtin", []):
            atlas_hook_guard.emit(data, "edit_read_nudge", MSG % fp)
        return 0
    kind = "ctx" if lower.endswith("ctx_read") else "builtin" if lower == "read" else None
    if kind:
        with atlas_hook_guard._locked(sid):
            state = atlas_hook_guard._load_state(sid)
            paths = state.setdefault("reads", {}).setdefault(kind, [])
            if fp not in paths:
                paths.append(fp)
                atlas_hook_guard._save_state(sid, state)
    return 0


if __name__ == "__main__":
    raise SystemExit(atlas_hook_guard.run_hook("edit_read_nudge", main))
