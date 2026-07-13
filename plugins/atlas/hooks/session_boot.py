#!/usr/bin/env python3
"""Atlas SessionStart boot. Fast, idempotent, crash-proof.

Emits additionalContext pointing at the operating contract and atlas-orchestrate
methodology, reports whether claude-mem and context-mode are present, and
surfaces a one-line ready status. Never blocks session start: any error exits 0
silently.
"""

import json
import os
import shutil
import sqlite3
import sys
import time


def has_cmd(name):
    return shutil.which(name) is not None


def detect_dep(module_marker):
    try:
        import importlib.util

        return importlib.util.find_spec(module_marker) is not None
    except Exception:
        return False


def _relative_time(epoch_s):
    """Render an epoch-seconds timestamp as a short 'Xm/Xh/Xd ago' string."""
    delta = time.time() - epoch_s
    if delta < 60:
        return "just now"
    if delta < 3600:
        return "%dm ago" % (delta // 60)
    if delta < 86400:
        return "%dh ago" % (delta // 3600)
    return "%dd ago" % (delta // 86400)


def _claude_mem_summary(project_name):
    """Latest session_summaries row plus recent decision/discovery titles for
    this project, read-only from the claude-mem SQLite store. Returns a dict
    or None when the DB or rows are absent."""
    db = os.path.expanduser("~/.claude-mem/claude-mem.db")
    if not project_name or not os.path.exists(db):
        return None
    conn = sqlite3.connect("file:" + db + "?mode=ro", uri=True)
    try:
        summary = conn.execute(
            "SELECT completed, next_steps, files_edited, created_at_epoch "
            "FROM session_summaries WHERE project=? "
            "ORDER BY created_at_epoch DESC LIMIT 1",
            (project_name,),
        ).fetchone()
        threads = conn.execute(
            "SELECT title FROM observations WHERE project=? "
            "AND type IN ('decision','discovery') "
            "ORDER BY created_at_epoch DESC LIMIT 3",
            (project_name,),
        ).fetchall()
        titles = [t[0] for t in threads if t[0]]
        if not summary and not titles:
            return None  # no rows for this project; avoid a truthy-but-empty dict
        return {"summary": summary, "threads": titles}
    finally:
        conn.close()


def _atlas_session_context(conn, root):
    """Most recent session_logs row for this cwd plus the last real user
    prompt, last edited file, and unverified-claim count, read via the
    already-open atlas_db connection. Returns a dict or None if no session
    has been mirrored for this cwd yet."""
    row = conn.execute(
        "SELECT session_id, git_branch, cursor_bytes, file_size, started_at "
        "FROM session_logs WHERE cwd=? ORDER BY started_at DESC LIMIT 1",
        (root,),
    ).fetchone()
    if not row:
        return None
    session_id, branch, cursor_bytes, file_size, started_at = row

    prompt = None
    for (text,) in conn.execute(
        "SELECT text FROM user_prompts WHERE session_id=? ORDER BY ts DESC LIMIT 10",
        (session_id,),
    ).fetchall():
        stripped = (text or "").lstrip()
        if stripped.startswith("<task-notification") or stripped.startswith(
            "<command-"
        ):
            continue
        prompt = text
        break

    last_file = None
    edit_row = conn.execute(
        "SELECT input_summary FROM tool_calls WHERE session_id=? "
        "AND tool_name IN ('Edit','Write','MultiEdit') "
        "ORDER BY ts DESC LIMIT 1",
        (session_id,),
    ).fetchone()
    if edit_row and edit_row[0]:
        try:
            last_file = json.loads(edit_row[0]).get("file_path")
        except Exception:
            last_file = None

    unverified = conn.execute(
        "SELECT COUNT(*) FROM signals WHERE session_id=? "
        "AND signal_type='unverified_claim'",
        (session_id,),
    ).fetchone()[0]

    lag_kb = 0
    if file_size and cursor_bytes and file_size > cursor_bytes:
        lag_kb = (file_size - cursor_bytes) // 1024

    return {
        "branch": branch,
        "started_at": started_at,
        "prompt": prompt,
        "last_file": last_file,
        "unverified": unverified,
        "lag_kb": lag_kb,
    }


def resume_block(root):
    """Derive a compact 'Resuming <project>' markdown block from claude-mem's
    session memory and atlas_db's transcript mirror, so the next session gets
    passive continuity context with zero user input. Read-only on both DBs;
    any failure anywhere (missing DB, missing table, locked file) returns None
    silently rather than blocking boot."""
    try:
        project_name = os.path.basename(root)
        atlas_ctx = None
        conn = None
        try:
            import atlas_db

            conn = atlas_db.connect()
            row = conn.execute(
                "SELECT name FROM projects WHERE root_path=?", (root,)
            ).fetchone()
            if row and row[0]:
                project_name = row[0]
            atlas_ctx = _atlas_session_context(conn, root)
        except Exception:
            atlas_ctx = None
        finally:
            if conn is not None:
                conn.close()

        mem = None
        try:
            mem = _claude_mem_summary(project_name)
        except Exception:
            mem = None

        if not mem and not atlas_ctx:
            return None

        summary = mem["summary"] if mem else None
        newest_epoch = None
        if summary and summary[3]:
            newest_epoch = summary[3] / 1000.0
        if atlas_ctx and atlas_ctx.get("started_at"):
            newest_epoch = max(newest_epoch or 0, atlas_ctx["started_at"])

        lines = ["## Resuming %s" % project_name]

        header = []
        if newest_epoch:
            header.append("Last active: %s" % _relative_time(newest_epoch))
        if atlas_ctx and atlas_ctx.get("branch"):
            header.append("branch: %s" % atlas_ctx["branch"])
        if header:
            lines.append("  |  ".join(header))

        if summary and summary[0]:
            lines.append("Last task: %s" % str(summary[0])[:150])
        if atlas_ctx and atlas_ctx.get("prompt"):
            lines.append("Last intent: %s" % str(atlas_ctx["prompt"])[:150])

        last_file = atlas_ctx.get("last_file") if atlas_ctx else None
        if not last_file and summary and summary[2]:
            last_file = str(summary[2]).splitlines()[0].strip(" -*\t,")
        if last_file:
            tail = "Last file: %s" % last_file
            if atlas_ctx and atlas_ctx.get("lag_kb"):
                tail += " (mirror %dKB behind live)" % atlas_ctx["lag_kb"]
            lines.append(tail)

        threads = []
        if summary and summary[1]:
            threads.extend(
                item.strip(" -*\t")
                for item in str(summary[1]).splitlines()
                if item.strip(" -*\t")
            )
        if mem and mem.get("threads"):
            threads.extend(mem["threads"])
        if threads:
            lines.append("Open threads:")
            lines.extend("- %s" % t[:150] for t in threads[:5])

        if atlas_ctx and atlas_ctx.get("unverified"):
            lines.append(
                "Unfinished verification: %d unverified claim(s)"
                % atlas_ctx["unverified"]
            )

        if summary and summary[1]:
            first_step = str(summary[1]).splitlines()[0].strip(" -*\t")
            if first_step:
                lines.append("Next step: %s" % first_step[:150])

        return "\n".join(lines)
    except Exception:
        return None


def main():
    payload = {}
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except Exception:
        pass

    # Observability DB lifecycle -- fail-open; must not block boot.
    _conn = None
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        _conn = atlas_db.connect()
        atlas_db.init(_conn)
        _root = payload.get("cwd") or os.getcwd()
        _pid = atlas_db.register_project(_conn, _root, os.path.basename(_root))
        _sid = payload.get("session_id", "")
        # Empty/missing session_id would create a phantom run keyed by "" and
        # corrupt is_orchestrating/current_run_id lookups -- skip run creation.
        if _sid and atlas_db.current_run_id(_conn, _sid) is None:
            atlas_db.start_run(_conn, _pid, _sid)
    except Exception:
        pass  # observability is best-effort; never block boot
    finally:
        if _conn is not None:
            _conn.close()

    resume = resume_block(payload.get("cwd") or os.getcwd())

    # Run the curator to manage auto-created skill lifecycle (fail-open)
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_curator

        atlas_curator.apply_transitions()
    except Exception:
        pass  # curator is best-effort; never block boot

    # Load and inject memory snapshot
    memory_block = None
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_memory

        snapshot = atlas_memory.load_snapshot()
        parts = []
        if snapshot.get("memory"):
            parts.append(snapshot["memory"])
        if snapshot.get("project"):
            parts.append(snapshot["project"])
        if parts:
            memory_block = "\n\n".join(parts)
    except Exception:
        pass  # memory is best-effort

    mem = detect_dep("claude_mem") or has_cmd("claude-mem")
    ctx = detect_dep("context_mode") or has_cmd("context-mode")

    pony = has_cmd("ponytail")
    if not pony:
        try:
            pony = os.path.exists(os.path.expanduser("~/.config/ponytail/config.json"))
        except Exception:
            pony = False

    lines = [
        "Atlas runtime active. The atlas-orchestrate methodology and operating contract apply:",
        "research -> theory -> test -> validate -> implement -> test -> verify; evidence before any done claim.",
        "This session is the atlas orchestrator. Substantive implementation is routed to atlas:<role> subagents "
        "(atlas:explorer, atlas:implementer, atlas:verifier, etc.); the orchestrator plans, delegates, "
        "and synthesizes -- it does not directly write production code or run broad tool sweeps.",
        "Invoke the atlas-orchestrate skill for multi-step or whole-codebase work; route subagents via atlas:<role>.",
        "Memory (claude-mem): "
        + (
            "available"
            if mem
            else "absent - run the `atlas` skill to install for self-improvement"
        )
        + ".",
        "Context protection (context-mode): "
        + (
            "available"
            if ctx
            else "absent - run the `atlas` skill to install for large-output work"
        )
        + ".",
        "Less-code mode (ponytail): "
        + (
            "available"
            if pony
            else "absent - run the `atlas` skill to install for less-code mode"
        )
        + ".",
        "No-prompt scan: run `atlas` or any atlas skill with no task to scan this project "
        "and report what is missing to reach atlas standard (claude-mem + context-mode + ponytail, "
        "loop-library, connectors, hooks, .atlas/docs/ SSOT).",
    ]
    if memory_block:
        lines.append(memory_block)
    if resume:
        lines.append(resume)
    out = {
        "additionalContext": "\n".join(lines)[:9000],
        "systemMessage": "Atlas ready"
        + ("" if (mem and ctx) else " (run the `atlas` skill to complete setup)"),
    }
    sys.stdout.write(json.dumps(out))
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(0)
