#!/usr/bin/env python3
"""PostToolUse hook - auto-format a file right after Claude edits it.

Matches Edit / Write / MultiEdit / NotebookEdit. Picks a formatter by file extension, runs it in place
using the project's own config, and is a no-op when the formatter is not installed. Meant
to run ASYNC (hooks.json sets "async": true) so it never blocks the agentic loop. It
never blocks a tool call; a formatter that fails is a quiet skip (not a hook
crash) - but the skip is recorded (friction row + fault row), never silent.

Why this matters for an orchestrator: a uniform, formatter-clean tree means diffs stay
minimal and reviewers (and verifier subagents) see only real changes, not whitespace noise.

Formatters (first available wins; all respect the repo's local config):
  .py                              ruff format -> black
  .js .jsx .ts .tsx .mjs .cjs      project-local prettier -> global prettier
  .json .jsonc .css .scss .less    (same prettier resolution)
  .html .vue .svelte .md .mdx .yaml .yml
  .go                              gofmt -w
  .rs                              rustfmt

Wire it up (settings.json), async so it never blocks:
  "PostToolUse": [
    { "matcher": "Edit|Write|MultiEdit|NotebookEdit",
      "hooks": [ { "type": "command",
                   "command": "python3 ~/.claude/hooks/format_after_edit.py",
                   "async": true, "timeout": 60 } ] }
  ]

Stdlib only.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
)
import atlas_hook_guard  # noqa: E402

# extension -> ordered list of candidate commands; the file path is appended as the last arg.
PRETTIER_EXTS = {
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".mjs",
    ".cjs",
    ".json",
    ".jsonc",
    ".css",
    ".scss",
    ".less",
    ".html",
    ".vue",
    ".svelte",
    ".md",
    ".mdx",
    ".yaml",
    ".yml",
    ".graphql",
}


def candidates_for(path: str, cwd: str) -> list[list[str]]:
    """Ordered formatter argv candidates for this file (path appended by caller)."""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".py":
        out = []
        if shutil.which("ruff"):
            out.append(["ruff", "format"])
        if shutil.which("black"):
            out.append(["black", "-q"])
        return out
    if ext in PRETTIER_EXTS:
        out = []
        local = os.path.join(cwd, "node_modules", ".bin", "prettier")
        if os.path.isfile(local) and os.access(local, os.X_OK):
            out.append([local, "--write", "--log-level", "warn"])
        if shutil.which("prettier"):
            out.append(["prettier", "--write", "--log-level", "warn"])
        return out
    if ext == ".go" and shutil.which("gofmt"):
        return [["gofmt", "-w"]]
    if ext == ".rs" and shutil.which("rustfmt"):
        return [["rustfmt"]]
    return []


def _is_uri_path(path: str) -> bool:
    """URI-scheme path (`agent://`, `xd://`, ...): an IRC/device message, not a file.
    Shared definition lives in atlas_db.is_uri_path; fail open (treat as a file)
    if it cannot be imported."""
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        from atlas_db import is_uri_path

        return is_uri_path(path)
    except Exception:
        return False


def file_path_from(data: dict) -> str | None:
    ti = data.get("tool_input") or {}
    fp = ti.get("file_path") or ti.get("path") or ti.get("notebook_path")
    if not isinstance(fp, str) or not fp or _is_uri_path(fp):
        return None
    return fp


def _record_skip(data: dict, fp: str, reason: str) -> None:
    """One cheap friction row per skip (`formatter_skipped:<reason>`, ext in snippet) so
    formatter latency/failures are measurable, plus one fault row (F6): a failed
    formatter used to be fully invisible - the run believed formatting happened
    while the file stayed unformatted. Never raises; exit stays 0."""
    try:
        import atlas_db  # noqa: E402  (lazy: only on the skip path)

        conn = atlas_db.connect()
        try:
            atlas_db.record_friction(
                conn,
                data.get("session_id") or "",
                "formatter_skipped:" + reason,
                snippet=os.path.splitext(fp)[1].lower() or "(none)",
            )
        finally:
            conn.close()
    except Exception:
        pass  # DB unavailable: the skip stays quiet, exit stays 0
    atlas_hook_guard.fault(
        "format_after_edit",
        "formatter skipped: %s for %s (no candidate succeeded)" % (reason, fp),
        data.get("cwd"),
    )


def main() -> int:
    data = atlas_hook_guard.load_payload("format_after_edit")
    fp = file_path_from(data)
    if not fp or not os.path.isfile(fp):
        return 0
    cwd = data.get("cwd") or os.getcwd()
    reasons: set[str] = set()
    for base in candidates_for(fp, cwd):
        try:
            proc = subprocess.run(
                base + [fp],
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                timeout=55,
            )
        except subprocess.TimeoutExpired:
            reasons.add("timeout")
            continue
        except (FileNotFoundError, OSError):
            reasons.add("missing")
            continue
        if proc.returncode == 0:
            # Silent on success. A formatter that ran is not news; announcing it on
            # every edit is the highest-frequency noise source in the plugin.
            return 0
        reasons.add("parse")  # non-zero (e.g. syntax error mid-edit): try the next
    # Every candidate failed or was absent: a skip, not a hook crash, so the
    # process still exits 0 - but the skip is recorded (friction row + fault
    # row) so the pattern is measurable instead of silent.
    reason = next(
        (r for r in ("timeout", "parse", "missing") if r in reasons), "missing"
    )
    _record_skip(data, fp, reason)
    return 0


if __name__ == "__main__":
    raise SystemExit(atlas_hook_guard.run_hook("format_after_edit", main))
