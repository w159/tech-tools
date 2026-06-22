#!/usr/bin/env python3
"""PostToolUse hook - auto-format a file right after Claude edits it.

Matches Edit / Write / MultiEdit. Picks a formatter by file extension, runs it in place
using the project's own config, and is a no-op when the formatter is not installed. Meant
to run ASYNC so it never blocks the agentic loop. Any failure is swallowed - formatting
must never break a tool call.

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
    { "matcher": "Edit|Write|MultiEdit",
      "hooks": [ { "type": "command",
                   "command": "python3 ~/.claude/hooks/format_after_edit.py",
                   "async": true, "timeout": 60 } ] }
  ]

Stdlib only.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

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


def file_path_from(data: dict) -> str | None:
    ti = data.get("tool_input") or {}
    fp = ti.get("file_path") or ti.get("path") or ti.get("notebook_path")
    return fp if isinstance(fp, str) and fp else None


def main() -> int:
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, ValueError):
        return 0
    fp = file_path_from(data)
    if not fp or not os.path.isfile(fp):
        return 0
    cwd = data.get("cwd") or os.getcwd()
    for base in candidates_for(fp, cwd):
        try:
            proc = subprocess.run(
                base + [fp],
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                timeout=55,
            )
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
            continue
        if proc.returncode == 0:
            tool = os.path.basename(base[0])
            print(
                json.dumps(
                    {
                        "hookSpecificOutput": {
                            "hookEventName": "PostToolUse",
                            "additionalContext": f"[atlas] auto-formatted {os.path.basename(fp)} with {tool}.",
                        }
                    }
                )
            )
            return 0
        # non-zero (e.g. syntax error mid-edit): try the next candidate, else give up quietly
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
