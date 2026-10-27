#!/usr/bin/env python3
"""PostToolUse hook - auto-format a file right after Claude edits it.

Matches Edit / Write / MultiEdit / NotebookEdit. Picks a formatter by file extension, runs it in place
using the project's own config, and is a no-op when the formatter is not installed. Meant
to run ASYNC (hooks.json sets "async": true) so it never blocks the agentic loop. It
never blocks a tool call; a formatter that fails is a quiet skip (not a hook
crash) - but the skip is recorded (friction row; fault row only for crashes/timeouts), never silent.

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

import datetime
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts")
)
import atlas_env  # noqa: E402
atlas_env.apply_store_env()
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


def _local_prettier(path: str, cwd: str) -> str | None:
    """Nearest node_modules/.bin/prettier walking up from the edited file, then from
    cwd. Resolving from cwd alone missed monorepo/worktree layouts where the hook cwd
    is not the package root."""
    seen: set[str] = set()
    for start in (os.path.dirname(os.path.abspath(path)), os.path.abspath(cwd)):
        d = start
        while d not in seen:
            seen.add(d)
            local = os.path.join(d, "node_modules", ".bin", "prettier")
            if os.path.isfile(local) and os.access(local, os.X_OK):
                return local
            parent = os.path.dirname(d)
            if parent == d:
                break
            d = parent
    return None


# One shared budget across all formatter candidates; hooks.json allows 60 s.
TOTAL_BUDGET_S = 50.0

PRETTIER_CONFIGS = (
    ".prettierrc",
    ".prettierrc.json",
    ".prettierrc.yaml",
    ".prettierrc.yml",
    ".prettierrc.json5",
    ".prettierrc.js",
    ".prettierrc.cjs",
    ".prettierrc.mjs",
    ".prettierrc.ts",
    ".prettierrc.cts",
    ".prettierrc.mts",
    ".prettierrc.toml",
    "prettier.config.js",
    "prettier.config.cjs",
    "prettier.config.mjs",
    "prettier.config.ts",
    "prettier.config.cts",
    "prettier.config.mts",
)


def _has_prettier_config(path: str, cwd: str) -> bool:
    """True when a standard prettier config file, or a "prettier" key in
    package.json, exists in an ancestor of the edited file or of cwd. A global
    prettier must not reformat a repo that never opted in."""
    seen: set[str] = set()
    for start in (os.path.dirname(os.path.abspath(path)), os.path.abspath(cwd)):
        d = start
        while d not in seen:
            seen.add(d)
            if any(os.path.isfile(os.path.join(d, n)) for n in PRETTIER_CONFIGS):
                return True
            pkg = os.path.join(d, "package.json")
            if os.path.isfile(pkg):
                try:
                    with open(pkg, encoding="utf-8") as f:
                        if "prettier" in (json.load(f) or {}):
                            return True
                except (OSError, ValueError, TypeError):
                    pass
            parent = os.path.dirname(d)
            if parent == d:
                break
            d = parent
    return False


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
        local = _local_prettier(path, cwd)
        if local:
            out.append([local, "--write", "--log-level", "warn"])
        if shutil.which("prettier") and _has_prettier_config(path, cwd):
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
    if "://" not in path:  # the URI pattern requires it: skip the atlas_db import
        return False
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


# "missing" (no formatter installed) and "parse" (mid-edit syntax error) are environment/input
# state: no fault, no friction. Only crashes and timeouts record a friction row and a fault.
PARSE_MARKERS = ("parse", "syntax", "unexpected token")


def _note_missing(formatter: str, cwd: str) -> None:
    """A missing formatter is a configuration fact, not a fault or friction. Keep one
    info record per (formatter, project root) per day in ATLAS_HOME so the doctor can
    still report "formatter X not installed". Never raises."""
    try:
        base = os.environ.get("ATLAS_HOME") or str(pathlib.Path.home() / ".atlas")
        path = pathlib.Path(base) / "formatter_missing.json"
        key = "%s|%s" % (formatter, os.path.realpath(cwd))
        today = datetime.date.today().isoformat()
        try:
            state = json.loads(path.read_text())
        except (OSError, ValueError):
            state = {}
        if state.get(key) == today:
            return
        state[key] = today
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(state, indent=1))
    except Exception:
        pass


def _record_skip(data: dict, fp: str, reason: str, formatter: str = "") -> None:
    """Friction row (`formatter_skipped:<reason>`, ext in snippet) for real skips
    (crash, timeout), which also write a fault row. "parse" is not recorded and
    "missing" goes to _note_missing only. Never raises; exit stays 0."""
    if reason == "parse":
        return  # mid-edit syntax errors are expected input state, not friction
    if reason == "missing":
        _note_missing(formatter, data.get("cwd") or os.getcwd())
        return
    ext = os.path.splitext(fp)[1].lower() or "(none)"
    try:
        import atlas_db  # noqa: E402  (lazy: only on the skip path)

        conn = atlas_db.connect()
        try:
            category = "formatter_skipped:" + reason
            sid = data.get("session_id") or ""
            atlas_db.record_friction(
                conn,
                sid,
                category,
                snippet=ext,
                tool_name=data.get("tool_name") or None,
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
    # Files outside the session cwd (other repos, OneDrive) are not atlas's to
    # format; touching them produced hundreds of friction rows a day. No row, no fault.
    if not pathlib.Path(os.path.realpath(fp)).is_relative_to(os.path.realpath(cwd)):
        return 0
    reasons: set[str] = set()
    cands = candidates_for(fp, cwd)
    if not cands:
        return 0  # no formatter applies/installed for this ext: not a skip, no friction row
    deadline = time.monotonic() + TOTAL_BUDGET_S
    for base in cands:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            reasons.add("timeout")
            break
        try:
            proc = subprocess.run(
                base + [fp],
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                timeout=remaining,
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
        err = (getattr(proc, "stderr", "") or "").lower()
        # Syntax error mid-edit is input state; anything else non-zero is a crash.
        reasons.add("parse" if any(m in err for m in PARSE_MARKERS) else "crash")
    # Every candidate failed or was absent: a skip, not a hook crash, so the
    # process still exits 0; the skip is always recorded (see _record_skip).
    reason = next(
        (r for r in ("timeout", "crash", "parse", "missing") if r in reasons), "missing"
    )
    _record_skip(data, fp, reason, os.path.basename(cands[0][0]))
    return 0


if __name__ == "__main__":
    raise SystemExit(atlas_hook_guard.run_hook("format_after_edit", main))
