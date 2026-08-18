#!/usr/bin/env python3
"""Dispatch tripwire: counts inline ops in the main session and curbs drift.

Two tiers, branched on the payload's hook_event_name:
  - PostToolUse (advisory): after an op lands, injects a STOP nag at threshold.
    This is the original behavior, unchanged.
  - PreToolUse (deny): before an op lands, and ONLY in orchestration-flagged
    sessions, DENIES the call when inline ops since the last dispatch reach the
    hard limit, or when the op edits production target code inline.

Fail-open: any error exits 0. Logs to the atlas observability DB.
Disable both tiers with ATLAS_TRIPWIRE=off. Disable ONLY the deny tier (advisory
persists) with ATLAS_TRIPWIRE_HARD=off. Non-orchestration sessions are never denied.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from pathlib import Path  # noqa: E402

from docs_drift import find_root  # noqa: E402

INLINE_TOOLS = {"Read", "Grep", "Glob", "Edit", "Write", "Bash"}
DISPATCH_TOOLS = {"Agent", "Task"}
EDIT_TOOLS = {"Edit", "Write", "MultiEdit"}
# PreToolUse deny tier: the Nth inline op with no intervening dispatch is denied.
# 8 prior ops means this call is the 9th -> deny.
DENY_THRESHOLD = 8
# Skills whose invocation means the session IS an atlas orchestration run.
# Deliberately excludes advisory/config skills (atlas-setup, atlas-validate)
# and narrow single-purpose skills (atlas-prompt, atlas-readme,
# atlas-gitignore, atlas-handoff, atlas-db-audit)
# so casual sessions never trip the completion gate.
ORCH_SKILLS = {
    "atlas-orchestrate",
    "atlas-audit",
    "atlas-ux-test",
    "atlas-loop",
    "atlas-feature",
    "atlas-debug",
    "atlas-refactor",
    "atlas-harden",
    "atlas-launch",
    "atlas-component",
    "atlas-frontend",
}


FINDINGS_RELPATH = (".atlas", ".run", "findings.json")
VERIFIER_WATCH_RELPATH = (".atlas", ".run", "verifier_watch.json")


def _is_verifier(subagent_type):
    return "verifier" in str(subagent_type or "").lower()


def _findings_count(root):
    """Number of entries in findings.json. -1 when the count is unknowable, which
    suppresses the check rather than warning on a guess."""
    if root is None:
        return -1
    try:
        data = json.loads(root.joinpath(*FINDINGS_RELPATH).read_text(encoding="utf-8"))
    except Exception:
        return 0  # missing/corrupt reads as empty: a verdict written now still counts
    items = data if isinstance(data, list) else data.get("findings", [])
    return len(items) if isinstance(items, list) else 0


def _watch_path(root):
    return root.joinpath(*VERIFIER_WATCH_RELPATH)


def _stash_findings_count(root, session):
    """PreToolUse side of the verifier-verdict check: remember how many findings
    existed before the verifier ran. ponytail: one slot per session, so N verifiers
    dispatched in parallel share a baseline -- if any one of them writes, none are
    flagged. Under-warning beats false-warning here."""
    if root is None:
        return
    try:
        path = _watch_path(root)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"session_id": session, "count": _findings_count(root)}),
            encoding="utf-8",
        )
    except Exception:
        pass  # advisory only


def _verdict_missing(root, session):
    """PostToolUse side: True when a verifier returned and findings.json did not grow."""
    if root is None:
        return False
    try:
        state = json.loads(_watch_path(root).read_text(encoding="utf-8"))
    except Exception:
        return False  # no baseline -> cannot judge -> stay silent
    if not isinstance(state, dict) or state.get("session_id") != session:
        return False
    before = state.get("count")
    if not isinstance(before, int):
        return False
    return _findings_count(root) <= before


def _threshold():
    try:
        return int(os.environ.get("ATLAS_TRIPWIRE_THRESHOLD", "4"))
    except ValueError:
        return 4


def _is_orchestration_path(path):
    if not path:
        return True  # unknown path -> do not punish
    norm = path.replace("\\", "/")
    return (
        norm.startswith("docs/")
        or "/docs/" in norm
        or norm.startswith(".atlas/")
        or "/.atlas/" in norm
    )


def _deny(reason):
    # Documented PreToolUse blocking form (code.claude.com/docs/en/hooks.md):
    # exit 0 with hookSpecificOutput.permissionDecision "deny" plus a reason.
    out = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }
    print(json.dumps(out))


def _toolkit_gap(tinput):
    """An atlas:* dispatch whose prompt never orders the batched ToolSearch.

    Measured: 3 of 12 recorded subagent runs got no TOOLS block and made 0 MCP calls,
    reading the repo through Bash grep/cat instead. The agent's own spec says to load
    the toolset first; a dispatch that repeats the order is what makes it stick.
    """
    agent = str(tinput.get("subagent_type") or "")
    if not agent.startswith("atlas:"):
        return None  # forks inherit the parent's loaded tools; non-atlas agents opt out
    prompt = str(tinput.get("prompt") or "")
    if "ToolSearch" in prompt:
        return None
    return agent


def _pre_tool_use(conn, atlas_db, tool, session, path, tinput=None):
    """Deny tier: fires before the op lands, orchestration-flagged sessions only."""
    # The deny tier is independently kill-switchable; the advisory tier persists.
    if os.environ.get("ATLAS_TRIPWIRE_HARD", "on").lower() == "off":
        return
    run_id = atlas_db.current_run_id(conn, session)
    if run_id is None:
        return  # no active run -> nothing to gate
    if not atlas_db.is_orchestrating(conn, session):
        return  # non-orchestration sessions are NEVER denied anything
    # (c) A dispatch that never names the toolset gets a subagent that greps.
    if tool in DISPATCH_TOOLS:
        gap = _toolkit_gap(tinput or {})
        if gap:
            _deny(
                "DENY - this %s dispatch names no tools. Add the TOOLS block from "
                "subagent-kit.md, starting with the one batched "
                'ToolSearch("select:mcp__lean-ctx__...,mcp__serena__...,'
                'mcp__plugin_context-mode_context-mode__...") the subagent must run '
                "before its first Read/Grep/Bash, plus the serena-down fallback to "
                "ctx_search/ctx_read. Without it %s reads the repo through Bash grep."
                % (tool, gap)
            )
        return
    # (b) Editing production target code inline is the sharpest violation.
    if tool in EDIT_TOOLS and not _is_orchestration_path(path):
        _deny(
            "DENY - atlas orchestrators never edit target code inline. "
            "Route this %s of %s to atlas:implementer." % (tool, path)
        )
        return
    # (a) Too many inline ops with no intervening dispatch.
    # Fail CLOSED on DB error: an unverified count must never let an inline
    # op past the hard limit mid-orchestration. The broad __main__ fail-open
    # covers garbage stdin / connect failures, not this trust decision.
    try:
        count = atlas_db.inline_ops_since_last_dispatch(conn, run_id)
    except Exception:
        _deny(
            "DENY - tripwire could not verify the inline-op count (DB error). "
            "Failing closed; dispatch the next step to atlas:explorer "
            "(investigation) or atlas:implementer (edits) instead of acting inline."
        )
        return
    if count >= DENY_THRESHOLD:
        _deny(
            "DENY - %d inline ops since your last dispatch. Orchestrators "
            "delegate: dispatch the next step to atlas:explorer (investigation) "
            "or atlas:implementer (edits) instead of acting inline." % count
        )


def main():
    if os.environ.get("ATLAS_TRIPWIRE", "on").lower() == "off":
        return
    raw = sys.stdin.read()
    payload = json.loads(raw)  # may raise -> caught below
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
    import atlas_db

    # Default missing event to PostToolUse so legacy payloads keep advisory behavior.
    event = payload.get("hook_event_name", "PostToolUse")
    tool = payload.get("tool_name", "")
    tinput = payload.get("tool_input", {}) or {}
    session = payload.get("session_id", "")
    path = tinput.get("file_path") or tinput.get("path") or tinput.get("notebook_path")

    # Verifier-verdict check. Runs outside the orchestration gate on purpose: the
    # very first atlas: dispatch of a session is what FLAGS it as orchestrating,
    # so gating the baseline on that flag would always miss dispatch #1.
    if tool in DISPATCH_TOOLS and _is_verifier(tinput.get("subagent_type")):
        root = find_root(Path(payload.get("cwd") or os.getcwd()))
        if event == "PreToolUse":
            _stash_findings_count(root, session)
        elif _verdict_missing(root, session):
            print(
                json.dumps(
                    {
                        "hookSpecificOutput": {
                            "hookEventName": "PostToolUse",
                            "additionalContext": (
                                "[atlas] The verifier returned but .atlas/.run/"
                                "findings.json gained no entry, so its verdict is "
                                "prose only and the completion gate cannot see it. "
                                "Write it yourself now, from the verdict it just "
                                "returned:\n"
                                '  python3 "$CLAUDE_PLUGIN_ROOT/scripts/'
                                'atlas_finding.py" --id <stage> --status '
                                "verified|rejected|needs-evidence --title '<one "
                                "line>' --evidence '<path or test id>' "
                                "--reproduction '<exact command>'\n"
                                "Do not re-dispatch the verifier to fix this, and do "
                                "not treat the chat text as the record."
                            ),
                        }
                    }
                )
            )
            # No early return: the dispatch still needs to reach the DB below.

    conn = None
    try:
        conn = atlas_db.connect()
        atlas_db.init(conn)

        if event == "PreToolUse":
            _pre_tool_use(conn, atlas_db, tool, session, path, tinput)
            return

        if tool == "Skill":
            # Invoking an orchestration skill flags the run deterministically -
            # nothing else guarantees the model runs `atlas_db.py mark-orchestrating`.
            skill = str(tinput.get("skill", "")).split(":")[-1]
            if skill in ORCH_SKILLS:
                atlas_db.mark_orchestrating(conn, session, payload.get("cwd"))
            return

        if tool in DISPATCH_TOOLS:
            # Dispatches may arrive after the run is finalized; use the fallback
            # resolver so late Agent/Task PostToolUse events are still logged.
            dispatch_run_id = atlas_db.current_or_last_run_id(conn, session)
            if dispatch_run_id is not None:
                atlas_db.log_dispatch(
                    conn, dispatch_run_id, tinput.get("subagent_type", tool)
                )
            agent_type = str(tinput.get("subagent_type", ""))
            if agent_type.startswith(("atlas:", "atlas-")):
                # Dispatching an atlas squad agent is unambiguous orchestration.
                atlas_db.mark_orchestrating(conn, session, payload.get("cwd"))
            return

        run_id = atlas_db.current_run_id(conn, session)
        if run_id is None:
            return  # no active run for inline ops; boot hook will create one

        if tool not in INLINE_TOOLS:
            return

        atlas_db.log_event(conn, run_id, tool, "main", 1, path)
        count = atlas_db.inline_ops_since_last_dispatch(conn, run_id)

        edit_to_target = tool in EDIT_TOOLS and not _is_orchestration_path(path)
        if count >= _threshold() or edit_to_target:
            if not atlas_db.is_orchestrating(conn, session):
                return  # WS1: non-orchestration sessions are logged but never nagged
            if edit_to_target:
                msg = (
                    "STOP - atlas orchestrators never edit target code inline. "
                    "Route this %s of %s to atlas:implementer." % (tool, path)
                )
            else:
                msg = (
                    "STOP - %d inline ops since your last dispatch with no dispatch. This is "
                    "orchestrator drift. Dispatch the next investigative or edit "
                    "step to a subagent (atlas:explorer / atlas:implementer)." % count
                )
            out = {
                "hookSpecificOutput": {
                    "hookEventName": "PostToolUse",
                    "additionalContext": msg,
                }
            }
            print(json.dumps(out))
    finally:
        if conn is not None:
            conn.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # fail-open: never block a session. But surface the failure on stderr
        # so a silent misfire is observable instead of invisible, matching
        # auto_skill/memory_capture.
        try:
            sys.stderr.write(f"[atlas] dispatch_tripwire fail-open: {exc}\n")
        except Exception:
            pass
    sys.exit(0)
