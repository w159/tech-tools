#!/usr/bin/env python3
"""PostToolUse hook - auto-format a file right after Claude edits it.

Matches Edit / Write / MultiEdit / NotebookEdit. Picks a formatter by file extension, runs it in place
using the project's own config, and is a no-op when the formatter is not installed. Meant
to run ASYNC (hooks.json sets "async": true) so it never blocks the agentic loop. It
never blocks a tool call; a formatter that fails is recorded via atlas_faults.

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


def main() -> int:
    data = atlas_hook_guard.load_payload("format_after_edit")
    fp = file_path_from(data)
    if not fp or not os.path.isfile(fp):
        return 0
    cwd = data.get("cwd") or os.getcwd()
    failures = []
    for base in candidates_for(fp, cwd):
        try:
            proc = subprocess.run(
                base + [fp],
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                timeout=55,
            )
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as exc:
            failures.append("%s: %s" % (base[0], type(exc).__name__))
            continue
        if proc.returncode == 0:
            # Silent on success. A formatter that ran is not news; announcing it on
            # every edit is the highest-frequency noise source in the plugin.
            return 0
        # non-zero (e.g. syntax error mid-edit): try the next candidate
        err = (getattr(proc, "stderr", "") or "").strip().splitlines()
        failures.append(
            "%s exited %s%s"
            % (base[0], proc.returncode, (": " + err[0][:200]) if err else "")
        )
    if failures:
        # Never blocks the edit, but a formatter that always fails must be visible.
        atlas_hook_guard.fault(
            "format_after_edit",
            "no formatter succeeded for %s (%s)" % (fp, "; ".join(failures)),
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(atlas_hook_guard.run_hook("format_after_edit", main))
