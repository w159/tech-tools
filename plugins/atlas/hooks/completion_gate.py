#!/usr/bin/env python3
"""Stop hook -- the atlas "Definition of done" gate (opt-in).

The atlas-orchestrate skill's hardest rule is that a change is not *done* until observed
behavior is captured AND an independent agent has verified it. Prose alone does not
enforce this (the orchestrator rationalizes "I'll mark it unverified and move on").
This hook is the machine backstop.

It is **scoped**: it only engages when the working directory (or a detected project
root above it) holds a `docs/` directory -- the project-documentation single source
of truth that atlas-setup scaffolds. Atlas-internal state (evidence, run
findings) lives under `.atlas/` directly, never under a `.atlas/docs/` layer. In any
session with no `docs/` it is a silent no-op, so it is safe to leave installed.

The gate also stays silent whenever the Stop payload's `background_tasks`
still lists an in-flight subagent, workflow, or teammate dispatch (see
`_has_in_flight_dispatch`): a turn is not a completion claim while dispatched
work is still running, so the gate does not fire once per wave-Stop. A
long-running `shell` or `monitor` task does not suppress it.

Sixteen conditions must ALL hold before the gate passes (else block ONCE):
  (a) At least one file exists under `.atlas/evidence/` with an mtime at or
      after THIS RUN's start (via `_run_started_at`). Scoped like (f)/(g):
      only checked when THIS RUN shipped non-docs code (_nondocs_changed on
      the run-write signal). A run that shipped no code has no evidence to
      capture, so (a) is skipped rather than manufacturing busywork. When the
      run's start time cannot be determined, falls back to "any file exists"
      (fail-open) -- an evidence file left over from an earlier session must
      never satisfy this run's gate when the timestamp IS available.
  (b) `.atlas/.run/findings.json` exists and contains at least one entry with
      status "verified" whose `verified_at` stamp is at or after THIS RUN's
      start. Same scoping and same "any entry" fallback as (a): a `verified`
      row stamped during an earlier session must not satisfy today's gate.
  (c) `docs/CHANGELOG.md` exists and is non-empty (docs-current backstop).
  (d) `docs/ROADMAP.md` exists and is non-empty.
  (e) `README.md` at the project root exists and is non-empty.
  (f) No docs drift: if THIS RUN's own activity (atlas_db events + tool_calls,
      not the whole working tree) wrote non-docs files, at least one docs/
      file changed too -- this is the deterministic trigger that forces an
      atlas:docs-curator dispatch before "done". If this run wrote zero
      non-docs files, (f) is skipped -- a dirty tree left by an earlier
      session is not this run's problem to fix.
  (g) Law 5 -- verification coverage: if non-docs code changed this run, block
      when implementer dispatches outnumber the independent checks that covered
      them. Two things count and they are interchangeable: an atlas:verifier
      dispatch, or a `verified` findings.json entry stamped DURING this run (a
      deterministic test result recorded via scripts/atlas_finding.py) -- but a
      stamped entry only earns credit when the run actually executed a
      test-runner command (pytest, vitest, cargo test, ...). A stamp with no
      executed test behind it is self-attestation, and self-stamping is how
      coverage collapsed to zero while the gate stayed green.
      The formula is max(0, unpaired_implementer_dispatches - _test_verified_this_run).
      Requiring a verifier *dispatch* specifically is what made every task,
      however small, cost two subagents; a test run is the better evidence and
      now satisfies the same gate.
  (h) ROADMAP reconciliation: if docs/ROADMAP.md contains items with status
      "done" that should have been moved to CHANGELOG, block. A "done" item
      in ROADMAP is a defect -- it belongs in CHANGELOG with a date and
      evidence citation.
  (i) Todo drain: if this run shipped code and the most recent plan still
      holds non-"completed" items, block. TodoWrite writes the whole list
      every time, so the last call is current state. (i) enforces DRAINING a
      list; (k) is what enforces having one.
  (j) Worktree close-out: if this run dispatched an agent with
      isolation="worktree" (recorded by dispatch_tripwire) and `git worktree
      list` still shows trees beyond the main one, block. Scoped to this run's
      own dispatches so a user's long-lived worktrees never trip it.
  (k) Plan mandate: if this run shipped code and NO plan surface ever carried
      a single item -- no transcript TodoWrite call, no non-manual item for
      this session on the durable board, no LEDGER line -- block. (i) alone
      let a run that never planned anything pass trivially, since an absent
      list has zero open items; that gap is why orchestration ran with no
      todo state at all. Scoped to code-shipping runs and fail-open: a gate
      that demands a plan for a two-line answer is the busywork this plugin
      exists to avoid, and an unreadable surface never manufactures a block.
  (l) Docs naming: every dated record this run touched (plan, spec, lesson,
      decision, audit, finding, evidence dir) must be named
      `<YYYY-MM-DD>-<slug>` so a plain listing sorts chronologically. A
      trailing date or a leading sequence number sorts by subject instead,
      which is what made an existing plan set unreadable. Run-scoped via git
      and fail-open: historical names nobody touched never block, or the gate
      would wedge every run on frozen audit hubs that predate the convention.
  (m) Delegation mandate: THIS RUN's main-thread non-docs code writes require
      at least one Task/Agent dispatch. Checked even when orchestration was
      never armed; sidechains are exempt. DB and current-turn transcript
      evidence are combined, and internal errors fail open.
  (n) Status header: for an orchestrating, non-sidechain session, the final
      reply (`last_assistant_message` in the Stop payload; omp's stop bridge
      fills it from session_stop) must start, on its first non-empty line, with
      the header matching `headerFirstLinePattern` in
      contracts/operating-contract.json (`ATLAS | <glyph> <phase> | <state>`).
      Kill switch ATLAS_GATE_HEADER=off. Fails open on missing/empty text and
      on stop_hook_active.
  (o) Phased todo: when THIS RUN shipped non-docs code, this session's board
      items (every status, non-manual) must cover each phase in the contract's
      `requiredTodoPhasesWhenCodeShipped`. An item's phase is its `phase`
      field, else a `[<phase>] ` content prefix. Kill switch
      ATLAS_GATE_PHASES=off. Fails open on a missing contract or an
      unreadable board.
  (p) Colony channel: when THIS RUN dispatched two or more atlas workers
      (`dispatches` rows whose agent_type starts `atlas:` or `atlas-`), the
      channel must show use: a board note under .atlas/.run/board/ authored by
      an owner other than `lead` inside the run window, or IRC/SendMessage
      traffic (`agent://` event paths, SendMessage tool calls) recorded for the
      run -- the exact sources are listed in `_colony_channel_used`. Kill switch
      ATLAS_GATE_COLONY=off. Fails open on any read error.

(n), (o), and (p) ask the model to repair presentation, not to produce work, so
each blocks AT MOST ONCE per session: an O_EXCL marker `<cond>-<session>` under
CONTRACT_GATE_MARKER_DIR (tmp dir `atlas-contract-gate`, overridable with
ATLAS_CONTRACT_GATE_DIR) records the block, and a marked condition counts as
satisfied. They are evaluated only for orchestrating sessions, never for a
sidechain, and not while a dispatch is in flight. Conditions (a)-(m) re-block
on every Stop until they hold.

(a), (b), (f), and (g) all share one signal: whether THIS RUN shipped
non-docs code (_nondocs_changed on the run-write signal from atlas_db). A
run that shipped no code -- a question answered, a read-only audit --
has nothing for those four conditions to check, so they are skipped
rather than blocking on manufactured busywork or narrating a pass.

If any condition is missing the hook blocks and names exactly which condition
failed and which specialist closes it. On a pass, the gate is silent: it
never emits additionalContext or any other output that could prompt another
turn -- only a block speaks.

Fail-open by construction: any error, missing dir, or unparseable input lets the
stop proceed. Disable entirely with ATLAS_GATE=off. Opt-out (on by default when
a docs/ tree is present and wired in hooks.json on Stop; set ATLAS_GATE=off to
disable).

Stdlib only.
"""

from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import atlas_hook_guard  # noqa: E402
from atlas_db import is_uri_path  # noqa: E402

sys.path.insert(0, os.path.dirname(__file__))
from docs_drift import docs_drift as _docs_drift  # noqa: E402
from docs_drift import find_root as _find_root  # noqa: E402
from docs_drift import git_changed_paths as _git_changed_paths  # noqa: E402

# Block texts are read by the model and pasted into a shell it runs itself,
# where $CLAUDE_PLUGIN_ROOT is NOT set (Claude Code expands it only for the hook
# command line), so scripts are named by the absolute path resolved here.
SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"


def _check_evidence(root: Path, started: float | None = None) -> bool:
    """(a) At least one file under .atlas/evidence/ produced during THIS RUN.

    When `started` (this run's start epoch, from `_run_started_at`) is known, a
    file only counts if its mtime is at or after it -- evidence left over from
    an earlier session must not satisfy today's gate; that gap is what made (a)
    spoofable by any stale file already on disk. When `started` is None (run
    timing unavailable), falls back to "any file exists": fail-open by design,
    since the gate must never block on its own inability to prove staleness.
    """
    evidence = root / ".atlas" / "evidence"
    try:
        if not evidence.is_dir():
            return False
        if started is None:
            return any(p.is_file() for p in evidence.iterdir())
        return any(
            p.is_file() and p.stat().st_mtime >= started for p in evidence.iterdir()
        )
    except OSError:
        return True  # can't read -> fail open  # can't read -> fail open


def _check_findings(root: Path, started: float | None = None) -> bool:
    """(b) .atlas/.run/findings.json has a 'verified' entry produced during
    THIS RUN.

    When `started` is known, an entry only counts if its `verified_at` stamp
    parses and falls at or after it -- a `verified` row inherited from an
    earlier session must not satisfy today's gate; that gap is what made (b)
    spoofable by any stale verdict already on disk. An undated verified entry
    earns no credit once `started` is known, same rule (g) already applies via
    `_test_verified_this_run`. When `started` is None, falls back to "any
    verified entry exists": fail-open by design.
    """
    findings = root / ".atlas" / ".run" / "findings.json"
    try:
        if not findings.is_file():
            return False
        data = json.loads(findings.read_text(encoding="utf-8"))
        items = data if isinstance(data, list) else data.get("findings", [])
        for item in items if isinstance(items, list) else []:
            if not isinstance(item, dict):
                continue
            if str(item.get("status", "")).lower() != "verified":
                continue
            if started is None:
                return True
            when = _parse_iso_epoch(item.get("verified_at"))
            if when is not None and when >= started:
                return True
        return False
    except OSError:
        return True  # genuine read failure -> fail open
    except (json.JSONDecodeError, ValueError, AttributeError):
        return False  # structural malformation -> does NOT count as verified  # structural malformation -> does NOT count as verified


def _check_nonempty(path: Path) -> bool:
    """A required markdown file exists and is non-empty. Fail-open on OSError."""
    try:
        return path.is_file() and path.stat().st_size > 0
    except OSError:
        return True  # can't stat -> fail open


def _parse_iso_epoch(stamp) -> float | None:
    """Parse an ISO-8601 timestamp (naive treated as UTC) to epoch seconds, or
    None if unparseable. Shared by (a)/(b) run-scoping (`_check_evidence`,
    `_check_findings`) and (g)'s pairing credit (`_test_verified_this_run`), so
    "does this timestamp belong to this run" is answered one way everywhere."""
    if not isinstance(stamp, str):
        return None
    try:
        when = datetime.fromisoformat(stamp)
    except ValueError:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return when.timestamp()


def _run_started_at(session_id: str) -> float | None:
    """Epoch seconds THIS RUN began, via atlas_db.current_run_id (falling back
    to latest_run_id) + atlas_db.run_started_at. Shared by (a)/(b)'s run-scoped
    evidence/findings checks. Fail-open to None on any error or when no run is
    on record: callers must treat None as "cannot prove staleness", not as a
    reason to block."""
    conn = None
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        conn = atlas_db.connect()
        rid = atlas_db.current_run_id(conn, session_id) or atlas_db.latest_run_id(
            conn, session_id
        )
        if rid is None:
            return None
        return atlas_db.run_started_at(conn, rid)
    except Exception:
        return None
    finally:
        if conn is not None:
            conn.close()  # can't stat -> fail open


def _check_changelog(root: Path) -> bool:
    """(c) docs/CHANGELOG.md exists and is non-empty."""
    return _check_nonempty(root / "docs" / "CHANGELOG.md")


def _check_roadmap(root: Path) -> bool:
    """(d) docs/ROADMAP.md exists and is non-empty."""
    return _check_nonempty(root / "docs" / "ROADMAP.md")


def _check_readme(root: Path) -> bool:
    """(e) README.md at the project root is non-empty. Fail-open on OSError."""
    return _check_nonempty(root / "README.md")


def _check_roadmap_reconciled(root: Path) -> bool:
    """(h) ROADMAP.md must not contain items with status 'done'.

    A 'done' item in ROADMAP is a defect — it should have been moved to
    CHANGELOG with a date and evidence citation. This check scans for
    the `- [done]` pattern or `status: done` in ROADMAP.md.

    Returns True if ROADMAP is reconciled (no 'done' items found).
    Fail-open on OSError (can't read → don't block).
    """
    roadmap = root / "docs" / "ROADMAP.md"
    try:
        if not roadmap.is_file():
            return True  # condition (d) handles missing ROADMAP
        content = roadmap.read_text(encoding="utf-8").lower()
        # Check for common patterns: "- [done]", "status: done", "| done |"
        if "- [done]" in content or "status: done" in content or "| done |" in content:
            return False
        return True
    except (OSError, UnicodeDecodeError):
        return True  # can't read → fail open


def _delegation_exempt():
    """(dirs, extensions) exempt from the (m) delegation mandate, from the shared
    contracts/native-tools.json (also read by omp/contracts.ts); None if unreadable."""
    try:
        path = (
            Path(__file__).resolve().parent.parent / "contracts" / "native-tools.json"
        )
        spec = json.loads(path.read_text())["delegationExempt"]
        return tuple(str(d) for d in spec["dirs"]), tuple(
            str(e) for e in spec["extensions"]
        )
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _nondocs_changed(changed_paths: list) -> bool:
    """Return True when at least one changed path is NOT a docs/ path.

    Unlike _docs_drift this ignores whether docs also moved: it answers only
    "did code change this run?" -- the trigger for the Law 5 verifier check (g).
    A path is 'docs' if it starts with 'docs/' or contains '/docs/'. A URI
    (`agent://Foo` IRC message, `xd://tool` device call) is not a file at all, so
    it is never shipped code and never counts.
    """
    for p in changed_paths:
        if is_uri_path(p):
            continue
        if not (p.startswith("docs/") or "/docs/" in p):
            return True
    return False


def _docs_moved_in_git(root: Path) -> bool:
    """True when git sees a changed docs/ path, regardless of how it was written.

    Condition (f)'s primary signal is `run_changed_paths`, which is fed by tool
    calls carrying a `file_path`. A docs file written by a Bash-invoked script
    never produces one, so a run whose docs are genuinely current can still be
    blocked for drift - observed twice while shipping 5.14.0. This is the
    cross-check: git-visible docs movement suppresses the block.

    Deliberately one-directional. It can only PREVENT a false block, never cause
    one. The cost is that stale docs edits left by an earlier session can mask
    this run's real drift; that is the cheaper failure than blocking a run that
    already did the work, which is how a gate teaches people to ignore it.
    """
    try:
        changed = _git_changed_paths(root)
    except Exception:
        return False  # git unavailable -> no suppression, primary signal stands
    return any(p.startswith("docs/") or "/docs/" in p for p in changed)


def _latest_transcript_todos(transcript_path: str) -> list | None:
    """The `todos` array from the run's LAST TodoWrite call, or None.

    TodoWrite rewrites the WHOLE list every call, so the final call in the
    transcript is current state - no replay or merging needed. None means the
    transcript holds no readable TodoWrite call at all, which is what lets
    (i) and (k) tell "drained a list" apart from "never made one".

    Fail-open to None on everything: unreadable file, malformed JSON line,
    unexpected shape. A gate that cannot read the transcript must not block.
    """
    if not transcript_path:
        return None
    latest = None
    try:
        with open(transcript_path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if '"TodoWrite"' not in line:
                    continue  # cheap prefilter; the JSON parse below is the real test
                try:
                    rec = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue
                content = ((rec.get("message") or {}).get("content")) or []
                if not isinstance(content, list):
                    continue
                for block in content:
                    if (
                        isinstance(block, dict)
                        and block.get("type") == "tool_use"
                        and block.get("name") == "TodoWrite"
                    ):
                        todos = (block.get("input") or {}).get("todos")
                        if isinstance(todos, list):
                            latest = todos
    except (OSError, UnicodeDecodeError):
        return None
    return latest


def _open_todos(transcript_path: str) -> int:
    """Count non-`completed` items in the run's most recent TodoWrite call.

    TodoWrite always writes the WHOLE list, so the last call in the transcript is
    the current state - no replay or merging needed. Returns 0 when there is no
    todo list at all: condition (i) enforces DRAINING a list, not creating one.
    Creation is the skill's job (and the harness has its own reminder for it);
    a gate that demands a todo list for a two-line run is the busywork this
    plugin exists to avoid.

    Fail-open on everything: unreadable file, malformed JSON line, unexpected
    shape. A gate that cannot read the transcript must not block on it.
    """
    latest = _latest_transcript_todos(transcript_path)
    if not latest:
        return 0
    return sum(
        1
        for item in latest
        if isinstance(item, dict) and item.get("status") != "completed"
    )


def _board_open_todos(root: Path, session_id: str) -> int:
    """Open items for THIS SESSION on the durable todo board
    (.atlas/.run/todos.json), which todo_capture mirrors from TodoWrite and
    the orchestrator's CLI maintains when TodoWrite is absent. Manual items
    are a human's notes, not the orchestrator's plan, so they never count.

    Fail-open: any error counts as 0 open items.
    """
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_todo

        board = atlas_todo.load(str(root))
        return sum(
            1
            for item in board.get("items", [])
            if not item.get("archived")
            and item.get("origin") != "manual"
            and item.get("session_id") == session_id
            and item.get("status") != "completed"
        )
    except Exception:
        return 0


def _ledger_open_todos(transcript_path: str) -> int:
    """Open items from the last `LEDGER | n/m | ...` line in the transcript.

    Last-resort fallback for runs where TodoWrite is unavailable AND no board
    was written: the orchestrator's status-header ledger is the only record of
    remaining work. open = m - n, clamped at 0. Fail-open on everything.
    """
    if not transcript_path:
        return 0
    import re

    pattern = re.compile(r"LEDGER\s*\|\s*(\d+)\s*/\s*(\d+)")
    last = None
    try:
        with open(transcript_path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if "LEDGER |" not in line and "LEDGER|" not in line:
                    continue
                m = pattern.search(line)
                if m:
                    last = (int(m.group(1)), int(m.group(2)))
    except (OSError, UnicodeDecodeError):
        return 0
    if not last:
        return 0
    return max(0, last[1] - last[0])


def _has_ledger_line(transcript_path: str) -> bool:
    """True when the transcript carries a `LEDGER | n/m | ...` line.

    Presence, not arithmetic: a fully drained ledger (`5/5`) reports zero open
    items but still proves a plan existed, so (k) must not read it through
    _ledger_open_todos. Fail-open True.
    """
    if not transcript_path:
        return False
    try:
        with open(transcript_path, encoding="utf-8", errors="replace") as fh:
            return any("LEDGER |" in line for line in fh)
    except (OSError, UnicodeDecodeError):
        return True


def _has_todo_plan(transcript_path: str, root: Path, session_id: str) -> bool:
    """(k) Did this run ever commit to a visible plan?

    True when ANY of the three plan surfaces carries at least one item: a
    transcript TodoWrite call, this session's own items on the durable board,
    or a LEDGER line. Manual items are a human's notes, not the orchestrator's
    plan, so they do not count here - same rule as (i).

    Fail-open True: when a surface cannot be read the gate must not invent a
    block. (k) fires only on positive proof that no plan was ever made.
    """
    if _latest_transcript_todos(transcript_path):
        return True
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_todo

        board = atlas_todo.load(str(root))
        for item in board.get("items", []):
            if (
                not item.get("archived")
                and item.get("origin") != "manual"
                and item.get("session_id") == session_id
            ):
                return True
    except Exception:
        return True  # board unreadable -> fail open, never block on our own error
    return _has_ledger_line(transcript_path)


def _docs_name_violations(root: Path) -> list:
    """(l) [(path, reason)] for dated artifacts this run touched that are not
    date-first, via scripts/lint_docs_names.py.

    Run-scoped, not a whole-tree scan: blocking on names nobody is touching
    would wedge every run in a repo with pre-convention history. Fail-open to
    [] on any error -- a linter that cannot load must not stop a stop.
    """
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import lint_docs_names

        return lint_docs_names.violations(lint_docs_names.changed_paths(root))
    except Exception:
        return []


def _leftover_worktrees(root: Path) -> list:
    """Extra git worktrees still on disk, excluding the main one.

    Only consulted when THIS RUN actually dispatched an isolated writer (the
    tripwire records that), so a user's own long-lived worktrees never trip the
    gate. A gate that fires on someone else's tree is exactly the false positive
    that trains people to stop reading gates.
    """
    import subprocess

    try:
        out = subprocess.check_output(
            ["git", "-C", str(root), "worktree", "list", "--porcelain"],
            stderr=subprocess.DEVNULL,
            timeout=5,
        ).decode(errors="replace")
    except Exception:
        return []  # not a repo, no git, or command error -> nothing to report
    paths = [
        ln[len("worktree ") :].strip()
        for ln in out.splitlines()
        if ln.startswith("worktree ")
    ]
    return paths[1:]  # the first entry is always the main working tree


def _run_used_worktrees(session_id: str) -> bool:
    """Did this run dispatch an agent with isolation="worktree"? Fail-open False."""
    conn = None
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        conn = atlas_db.connect()
        atlas_db.init(conn)
        return atlas_db.run_used_worktrees(conn, session_id)
    except Exception:
        return False
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


_IN_FLIGHT_DISPATCH_TYPES = {"subagent", "workflow", "teammate"}
_TERMINAL_TASK_STATUSES = {"completed", "failed", "killed", "cancelled", "stopped"}


def _has_in_flight_dispatch(data: dict) -> bool:
    """True when the Stop payload's `background_tasks` lists a dispatched
    subagent/workflow/teammate that has not reached a terminal status.

    Per the hooks docs (Stop input `background_tasks`: id, type, status,
    description, agent_type), each entry's `type` distinguishes a dispatched
    task from a long-running shell or monitor job. Only subagent/workflow/
    teammate suppress the gate here -- a `shell` (e.g. `tail -f`) or
    `monitor` task must NOT suppress it, or the gate becomes a permanent
    bypass for anyone with a watcher running. A turn with dispatched work
    still in flight is not a completion claim, so the gate stays silent
    rather than blocking (and re-blocking) on every Stop of a wave.
    Absent/malformed `background_tasks` -> no suppression (current
    behavior)."""
    tasks = data.get("background_tasks")
    if not isinstance(tasks, list):
        return False
    for task in tasks:
        if not isinstance(task, dict):
            continue
        if str(task.get("type", "")).lower() not in _IN_FLIGHT_DISPATCH_TYPES:
            continue
        if str(task.get("status", "")).lower() not in _TERMINAL_TASK_STATUSES:
            return True
    return False


def _shell_dirty_edits(root, session_id: str) -> list:
    """Non-docs paths that are dirty now but absent from, or changed since, the
    SessionStart snapshot (hooks/session_boot.py write_dirty_snapshot): code a
    main thread wrote through the shell, which no Write/Edit event records.
    Pre-existing dirt left untouched hashes the same and is not counted.
    Fail open ([]) on no root, no/corrupt snapshot, git error."""
    if root is None or not session_id:
        return []
    try:
        import session_boot

        with open(session_boot.snapshot_path(root, session_id), encoding="utf-8") as fh:
            before = json.load(fh)["paths"]
        now = session_boot.dirty_map(root)
        if not isinstance(before, dict) or now is None:
            return []
        return sorted(p for p, h in now.items() if before.get(p) != h)
    except Exception:
        return []


def _missing_delegation(session_id: str, transcript_path: str = "", root=None) -> bool:
    """(m) Main-thread code writes with no dispatch; fail open on any error.

    Unlike the other code gates, sidechain writes and inherited git dirt do
    not establish a main-thread change. Current-turn dispatches are read
    directly before Stop-time transcript ingestion has caught up. Code written
    through the shell counts too when `root` has a SessionStart dirty snapshot.
    """
    if "/subagents/" in transcript_path.replace("\\", "/"):
        return False
    conn = None
    try:
        import atlas_db

        conn = atlas_db.connect()
        rid = atlas_db.current_run_id(conn, session_id) or atlas_db.latest_run_id(
            conn, session_id
        )
        if rid is None:
            return False
        started = atlas_db.run_started_at(conn, rid)
        if started is None:
            return False
        paths = [
            row[0]
            for row in conn.execute(
                "SELECT path FROM events WHERE run_id=? AND context='main' "
                "AND tool IN ('Write','Edit','MultiEdit','NotebookEdit') AND path IS NOT NULL",
                (rid,),
            )
        ]
        for (summary,) in conn.execute(
            "SELECT input_summary FROM tool_calls WHERE session_id=? AND ts>=? "
            "AND is_sidechain=0 AND tool_name IN ('Write','Edit','MultiEdit','NotebookEdit')",
            (session_id, started),
        ):
            paths.append(json.loads(summary or "{}").get("file_path") or "")
        exempt = _delegation_exempt()
        if exempt is None:
            return False  # contract unreadable: fail open, never block
        dirs, exts = exempt
        code_paths = [
            p
            for p in paths
            if p
            and not (
                p.endswith(exts)
                or any(p.startswith(d + "/") or f"/{d}/" in p for d in dirs)
            )
        ]
        code_paths += _shell_dirty_edits(root, session_id)
        if not _nondocs_changed(code_paths):
            return False
        if conn.execute(
            "SELECT 1 FROM dispatches WHERE run_id=? LIMIT 1", (rid,)
        ).fetchone():
            return False
        if conn.execute(
            "SELECT 1 FROM events WHERE run_id=? AND context='main' "
            "AND tool IN ('Task','Agent') LIMIT 1",
            (rid,),
        ).fetchone():
            return False
        if conn.execute(
            "SELECT 1 FROM tool_calls WHERE session_id=? AND ts>=? "
            "AND is_sidechain=0 AND tool_name IN ('Task','Agent') LIMIT 1",
            (session_id, started),
        ).fetchone():
            return False
        if transcript_path:
            with open(transcript_path, encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    rec = json.loads(line)
                    if rec.get("isSidechain"):
                        continue
                    when = _parse_iso_epoch(rec.get("timestamp"))
                    if when is None or when < started:
                        continue
                    content = (rec.get("message") or {}).get("content") or []
                    if isinstance(content, list) and any(
                        isinstance(b, dict)
                        and b.get("type") == "tool_use"
                        and b.get("name") in {"Task", "Agent"}
                        for b in content
                    ):
                        return False
        return True
    except Exception:
        return False
    finally:
        if conn is not None:
            conn.close()


def _reason(
    missing_a: bool,
    missing_b: bool,
    missing_c: bool,
    missing_d: bool = False,
    missing_e: bool = False,
    drift: bool = False,
    unverified: int = 0,
    git_error: str = "",
    roadmap_not_reconciled: bool = False,
    open_todos: int = 0,
    worktrees: list | None = None,
    missing_plan: bool = False,
    name_violations: list | None = None,
    missing_delegation: bool = False,
    missing_header: bool = False,
    missing_phases: list | None = None,
    colony_missing: bool = False,
    session_id: str = "",
    colony_workers: int | None = None,
) -> str:
    parts = []
    if missing_a:
        parts.append(
            "  (a) No files found under .atlas/evidence/. Capture observed-behavior proof "
            "(test output, DB read-back, endpoint response, or UI screenshot) there first. "
            "-> Dispatch the relevant atlas specialist (atlas:implementer to re-run and "
            "capture, atlas:ui-runtime-tester for a live UI screenshot, or atlas:db-prober "
            "for a DB read-back) to produce and save that artifact under .atlas/evidence/."
        )
    if missing_b:
        parts.append(
            "  (b) .atlas/.run/findings.json is missing or has no entry with status "
            '"verified". -> If a verifier already reached a verdict this run, the '
            "record is simply unwritten: write it yourself, now, with one command -- "
            f'python3 "{SCRIPTS_DIR / "atlas_finding.py"}" --id <stage> '
            "--status verified --title '<one line>' --evidence '<path or test id>' "
            "--reproduction '<exact command>'. --title is required. Only dispatch "
            "atlas:verifier if no independent check has actually run yet."
        )
    if missing_c:
        parts.append(
            "  (c) docs/CHANGELOG.md is missing or empty. docs/ must be current -- "
            "update CHANGELOG.md (and ROADMAP/affected subfolders) to reflect this run. "
            "-> Dispatch atlas:docs-curator to bring docs/ current (CHANGELOG, ROADMAP, "
            "affected subfolders) citing file:line evidence."
        )
    if missing_d:
        parts.append(
            "  (d) docs/ROADMAP.md is missing or empty. The roadmap is part of the "
            "docs/ single source of truth. -> Dispatch atlas:docs-curator to write or "
            "update ROADMAP.md reflecting shipped, in-flight, and planned work."
        )
    if missing_e:
        parts.append(
            "  (e) README.md at the project root is missing or empty. "
            "-> Dispatch atlas:docs-curator to write or refresh the root README so it "
            "matches the current state of the code."
        )
    if drift:
        parts.append(
            "  (f) Docs drift: non-docs files changed this run but docs/CHANGELOG.md "
            "is not in the diff. The CHANGELOG is the record that this change "
            "happened and was verified; an edit to some other doc is not a "
            "substitute for it. -> Write the CHANGELOG entry inline yourself (docs/ "
            "is a tree the orchestrator may edit directly), or dispatch "
            "atlas:docs-curator to reconcile docs/ (CHANGELOG, ROADMAP, affected "
            "subfolders) citing file:line evidence, then retry Stop."
        )
    if unverified > 0:
        parts.append(
            "  (g) Law 5 -- verification coverage: %d implementer dispatch(es) "
            "shipped code this run with nothing independent checking them. Two ways "
            "to close this, cheapest first: (1) run the failing check yourself -- the "
            "project's test/lint/typecheck gate -- and record the result with "
            'python3 "%s" --id <stage> '
            "--status verified --title '<one line>' --evidence '<test id>' "
            "--reproduction '<command>'; a "
            "`verified` entry stamped during this run pairs an implementer exactly "
            "like a dispatch does, and a test cannot hallucinate. (2) Dispatch "
            "atlas:verifier only when no test can express the check. Then retry Stop."
            % (unverified, SCRIPTS_DIR / "atlas_finding.py")
        )
    if git_error:
        parts.append(
            "  (f/g) Could not verify docs drift or verifier coverage: git is "
            "unavailable, so the gate cannot inspect the run's diff (%s). The "
            "gate must not let unverified code ship on the assumption that "
            "nothing changed. -> Ensure git is reachable from this environment "
            "and retry Stop." % git_error
        )
    if roadmap_not_reconciled:
        parts.append(
            "  (h) ROADMAP reconciliation: docs/ROADMAP.md contains items with "
            'status "done" that should have been moved to CHANGELOG.md with a '
            "date and evidence citation. A 'done' item in ROADMAP is a defect. "
            "-> Dispatch atlas:docs-curator to move completed and verified "
            "items from ROADMAP to CHANGELOG, then retry Stop."
        )
    if missing_plan:
        parts.append(
            "  (k) No plan was ever made: this run shipped code with zero items on "
            "every plan surface (no TodoWrite call, no board items for this session, "
            "no LEDGER line). The plan is not paperwork - it is how the work gets "
            "decomposed into small, independently dispatchable pieces instead of one "
            "sprawling subagent. -> Write the list NOW, one item per bounded step, "
            "then mark what is already done: TodoWrite if the tool is available "
            '(load it with ToolSearch("select:TodoWrite") first), otherwise '
            f'python3 "{SCRIPTS_DIR / "atlas_todo.py"}" set '
            '\'[{"content":"...","status":"completed"}]\' --session <session_id>. '
            "Then retry Stop."
        )
    if open_todos > 0:
        parts.append(
            "  (i) Todo list not drained: %d item(s) are still open (transcript "
            "TodoWrite, the .atlas/.run/todos.json board, or the LEDGER line). An "
            "item is `completed` only when its check passed -- not when a subagent "
            "returned. -> Finish them, or mark what you are deliberately leaving and "
            "say so out loud in your reply, then retry Stop." % open_todos
        )
    if worktrees:
        parts.append(
            "  (j) %d git worktree(s) from this run are still on disk: %s. A worktree "
            "holding changes does not clean itself up. -> For each: commit inside it if "
            "`git -C <tree> status --porcelain` is non-empty, merge it into the local "
            "branch (git merge --no-ff <branch>), then `git worktree remove` it. Offer "
            "the push; never run it unasked."
            % (len(worktrees), ", ".join(worktrees[:4]))
        )
    if name_violations:
        parts.append(
            "  (l) %d docs artifact(s) this run touched are not named date-first: "
            "%s. A dated record (plan, spec, lesson, decision, audit, finding) is "
            "<YYYY-MM-DD>-<slug> so a plain listing sorts chronologically; a "
            "trailing date or a leading sequence number sorts by subject instead. "
            "-> Rename with `git mv` (keep the history), then re-check with "
            'python3 "%s".'
            % (
                len(name_violations),
                "; ".join(p for p, _ in name_violations[:5]),
                SCRIPTS_DIR / "lint_docs_names.py",
            )
        )
    if missing_delegation:
        parts.append(
            "  (m) Delegation mandate: this run shipped non-docs code from the main "
            "thread with zero Task/Agent dispatches. -> Dispatch atlas:implementer "
            "(or another atlas:* agent) for the code change, then verify and retry Stop."
        )
    if missing_header:
        parts.append(_header_reason_part(_contract_doc()))
    if missing_phases:
        parts.append(_phases_reason_part(missing_phases, _contract_doc(), session_id))
    if colony_missing:
        parts.append(_colony_reason_part(colony_workers))
    failed = "\n".join(parts)
    return (
        "[atlas] Definition-of-done gate: the following condition(s) are not met:\n"
        + failed
        + "\n\nClose the gap with the SMALLEST deterministic action, in this order:\n"
        "  1. Anything that is only an unwritten record -- a docs/CHANGELOG line, a "
        "ROADMAP move, a findings.json verdict a verifier already reached -- write it "
        "inline, yourself, right now. docs/ and .atlas/ are the two trees an "
        "orchestrator may edit directly, so no dispatch is needed and none should be "
        "made.\n"
        "  2. Dispatch a specialist ONLY when the evidence genuinely does not exist "
        "yet and someone has to go produce it (atlas:verifier for a check that never "
        "ran, atlas:ui-runtime-tester for a missing runtime capture).\n"
        "  3. If a dispatch cannot realistically finish in this session, do not start "
        "one. Say plainly what is unverified, name the exact command and its expected "
        "output, and leave the gate honestly open rather than ending mid-wave.\n\n"
        "All conditions must hold before this run can be declared done. "
        "If the work is genuinely not done, say so explicitly -- what is unverified "
        "and the exact command + expected output to verify it. Do not declare success.\n"
        '"Unverified" is not a completion state. A diff or a file:line is not proof that it works.'
    )


def main() -> int:
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, ValueError):
        return 0
    if not isinstance(data, dict):
        data = {}
    # Finalize the observability run regardless of gate outcome.
    _finalize_db(data.get("session_id", ""))
    try:
        if os.environ.get("ATLAS_GATE", "").lower() == "off":
            return 0
        # stop_hook_active and the session circuit breaker (a thrashing Stop
        # chain silences the gate too, same as the other four hooks). No
        # throttle window: the gate is meant to re-block every Stop until the
        # conditions are actually met, so window_seconds is left at its
        # default of None.
        if not atlas_hook_guard.should_run(data, "completion_gate"):
            return 0
        cwd = Path(data.get("cwd") or os.getcwd())
        root = _find_root(cwd)
        if root is None:
            return 0  # no docs/ SSOT -> not an atlas run -> silent no-op
        session = str(data.get("session_id") or "")
        missing_delegation = _missing_delegation(
            session, str(data.get("transcript_path") or ""), root
        )
        if not _session_is_orchestrating(session):
            if missing_delegation and not _has_in_flight_dispatch(data):
                _record_gate_block(session, ["m"])
                print(
                    json.dumps(
                        {
                            "decision": "block",
                            "reason": _reason(
                                False, False, False, missing_delegation=True
                            ),
                        }
                    )
                )
            return 0  # only (m) applies to unflagged runs
        if _has_in_flight_dispatch(data):
            return 0  # dispatched subagent/workflow/teammate still running -- not a completion claim yet
        # (a)/(b)/(f)/(g) share one signal: did THIS RUN's own activity ship
        # non-docs code? Scoped to run_written_paths (atlas_db events +
        # tool_calls), not the whole working tree -- a dirty tree left by an
        # earlier session must never block a run that touched nothing.
        # Fail-open: any DB error yields an empty path list -> treated the
        # same as "wrote nothing", never a false block.
        run_paths = _run_written_paths(data.get("session_id", ""), root)
        code_changed = _nondocs_changed(run_paths)
        # (a)/(b) only apply once this run has shipped non-docs code. A
        # research-only or docs-only run has no evidence/verification to
        # produce, so manufacturing a findings.json entry to satisfy an
        # inapplicable gate is the defect, not the fix. Both are further
        # scoped to THIS RUN's own window via `started`: evidence/findings
        # left over from an earlier session must not satisfy today's gate.
        started = _run_started_at(str(data.get("session_id") or ""))
        ok_a = _check_evidence(root, started) if code_changed else True
        ok_b = _check_findings(root, started) if code_changed else True
        ok_c = _check_changelog(root)
        ok_d = _check_roadmap(root)
        ok_e = _check_readme(root)
        ok_h = _check_roadmap_reconciled(root)
        # (f) Docs drift BLOCKS: THIS RUN's own writes shipped code and
        # docs/CHANGELOG.md was not among them. The primary signal is
        # tool-call-scoped and therefore blind to docs written by a
        # Bash-invoked script. Cross-check
        # git before blocking so a run whose docs ARE current is not stopped.
        drift = _docs_drift(run_paths) if code_changed else False
        if drift and _docs_moved_in_git(root):
            drift = False
        # (g) Law 5 -- verifier coverage. Only when THIS RUN's own writes
        # touched non-docs code: block if implementer dispatches outnumber
        # verifier dispatches. An implementer still in flight, or one that
        # shipped no diff, contributes nothing to run_paths, so it cannot
        # trip this. Fail-open: the helper returns 0 on any atlas_db
        # import/DB error, so condition (g) silently passes.
        # (g) Verifier coverage, with test-run credit. An implementer is
        # "paired" by an independent atlas:verifier dispatch OR by a `verified`
        # findings.json entry written during this run -- a deterministic test is
        # the stronger evidence of the two, and demanding a second subagent for a
        # one-file change is what turned every simple task into a wave.
        # (i) Todo drain and (j) worktree close-out: both are run-scoped and
        # fail-open, and neither fires on a run that shipped no code.
        # Drain signals, first one to report open items wins: the transcript
        # TodoWrite (what the harness actually tracked), the durable board
        # todo_capture mirrors (which also catches a later CLI re-plan the
        # transcript never saw), then the `LEDGER | n/m` line the orchestrator
        # must emit when TodoWrite is unavailable (auto mode).
        open_todos = (
            _open_todos(str(data.get("transcript_path") or "")) if code_changed else 0
        )
        if code_changed and open_todos == 0:
            open_todos = _board_open_todos(root, str(data.get("session_id") or ""))
        if code_changed and open_todos == 0:
            open_todos = _ledger_open_todos(str(data.get("transcript_path") or ""))
        # (k) Plan mandate. (i) enforces draining a list, so a run that never
        # made one passed it trivially -- an absent list has zero open items.
        # (k) closes that gap on code-shipping runs only.
        missing_plan = code_changed and not _has_todo_plan(
            str(data.get("transcript_path") or ""),
            root,
            str(data.get("session_id") or ""),
        )
        worktrees = (
            _leftover_worktrees(root)
            if code_changed and _run_used_worktrees(data.get("session_id", ""))
            else []
        )
        # (l) Naming: dated records must sort chronologically. Not gated on
        # code_changed -- a docs-only run that files a misnamed plan is exactly
        # the case worth catching.
        name_violations = _docs_name_violations(root)
        unverified = 0
        if code_changed:
            session = data.get("session_id", "")
            unverified = max(
                0,
                _unpaired_implementer_dispatches(session)
                - _test_verified_this_run(
                    root, session, str(data.get("transcript_path") or "")
                ),
            )
        # (n)/(o)/(p): the contract-visibility conditions. Each is evaluated for
        # orchestrating, non-sidechain sessions only (this point is past the
        # unflagged early return), is skipped while a dispatch is in flight
        # (past the in-flight return above), honors its own kill switch, fails
        # open on any error, and blocks AT MOST ONCE per session: a letter whose
        # marker already exists counts as satisfied, and the marker is created
        # when the block that names it is emitted (below).
        sidechain = _payload_is_sidechain(data)
        contract = None if sidechain else _contract_doc()
        header_failing = (
            not sidechain
            and _status_header_would_block(data, contract)
            and not _contract_block_used("n", session)
        )
        phases_missing = (
            []
            if sidechain or not code_changed or _contract_block_used("o", session)
            else _missing_required_phases(root, session, contract)
        )
        colony_workers = None
        colony_failing = False
        if (
            not sidechain
            and not _switch_off(_SWITCH_COLONY)
            and not _contract_block_used("p", session)
        ):
            colony_workers = _colony_workers_dispatched(session)
            colony_failing = (
                colony_workers is not None
                and colony_workers >= 2
                and not _colony_channel_used(root, session, started)
            )
        if (
            ok_a
            and ok_b
            and ok_c
            and ok_d
            and ok_e
            and ok_h
            and not drift
            and unverified == 0
            and open_todos == 0
            and not worktrees
            and not missing_plan
            and not name_violations
            and not missing_delegation
            and not header_failing
            and not phases_missing
            and not colony_failing
        ):
            # Silence on pass is the contract: the gate speaks only when it
            # blocks. No advisory, no "not evaluated" narration -- any output
            # here reads as a prompt for another turn.
            return 0
        failed = [
            letter
            for letter, failing in (
                ("a", not ok_a),
                ("b", not ok_b),
                ("c", not ok_c),
                ("d", not ok_d),
                ("e", not ok_e),
                ("f", drift),
                ("g", unverified > 0),
                ("h", not ok_h),
                ("i", open_todos > 0),
                ("j", bool(worktrees)),
                ("k", missing_plan),
                ("l", bool(name_violations)),
                ("m", missing_delegation),
                ("n", header_failing),
                ("o", bool(phases_missing)),
                ("p", colony_failing),
            )
            if failing
        ]
        _record_gate_block(data.get("session_id", ""), failed)
        for letter, needs_marker in (
            ("n", header_failing),
            ("o", bool(phases_missing)),
            ("p", colony_failing),
        ):
            if needs_marker:
                _mark_contract_block(
                    letter, session
                )  # one-shot: never block on this letter again
        block_reason = _reason(
            not ok_a,
            not ok_b,
            not ok_c,
            not ok_d,
            not ok_e,
            drift,
            unverified,
            "",
            not ok_h,
            open_todos,
            worktrees,
            missing_plan=missing_plan,
            name_violations=name_violations,
            missing_delegation=missing_delegation,
            missing_header=header_failing,
            missing_phases=phases_missing,
            colony_missing=colony_failing,
            session_id=session,
            colony_workers=colony_workers,
        )
        print(json.dumps({"decision": "block", "reason": block_reason}))
    except Exception as exc:  # noqa: BLE001 -- a Stop hook must never wedge the session
        # Fail-open, but surface the swallowed crash on stderr so a silent
        # allow-through is at least observable in hook logs.
        print(json.dumps({"decision": "fail-open", "error": str(exc)}), file=sys.stderr)
        return 0
    return 0


def _finalize_db(session_id: str) -> None:
    """Finalize the observability run for this session. Fail-open."""
    _conn = None
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        _conn = atlas_db.connect()
        _rid = atlas_db.current_run_id(_conn, session_id)
        if _rid is not None:
            atlas_db.finalize_run(_conn, _rid)
    except Exception:
        pass  # observability is best-effort; never block stop
    finally:
        if _conn is not None:
            _conn.close()


def _run_has_telemetry(conn, run_id, session_id: str) -> bool:
    """Did anything at all get logged for this run? Distinguishes "the run wrote
    no files" (real data) from "nothing was ever recorded" (no data). Any error
    counts as telemetry present, so a read failure cannot trigger the git
    fallback and manufacture a block."""
    try:
        events = conn.execute(
            "SELECT COUNT(*) FROM events WHERE run_id=?", (run_id,)
        ).fetchone()[0]
        if events:
            return True
        calls = conn.execute(
            "SELECT COUNT(*) FROM tool_calls WHERE session_id=?", (session_id,)
        ).fetchone()[0]
        return bool(calls)
    except Exception:
        return True


# Human-readable name per gate condition letter. The block snippet used to be the
# bare letters ("conditions: m", "conditions: c,d,e"), which says a gate fired
# but not which rule or why; the names make a friction row diagnosable on its
# own. Letters match the (a)..(p) labels in _reason().
_CONDITION_NAMES: dict[str, str] = {
    "a": "no .atlas/evidence",
    "b": "no verified finding",
    "c": "CHANGELOG missing",
    "d": "ROADMAP missing",
    "e": "README missing",
    "f": "docs drift",
    "g": "unverified implementer",
    "h": "ROADMAP not reconciled",
    "i": "open todos",
    "j": "worktrees left",
    "k": "no plan",
    "l": "docs names not date-first",
    "m": "delegation mandate",
    "n": "status header missing",
    "o": "required phases missing",
    "p": "colony channel unused",
}


def _gate_block_snippet(failed: list) -> str:
    """`conditions: <letters> (<name>, <name>)` -- the leading
    `conditions: <letters>` is the stable machine-readable part (tests and
    dashboards key on it); the parenthesised names are the reason. Unknown
    letters are kept verbatim rather than dropped."""
    names = ", ".join(_CONDITION_NAMES.get(letter, letter) for letter in failed)
    return "conditions: " + ",".join(failed) + " (" + names + ")"


def _record_gate_block(session_id: str, failed: list) -> None:
    """Persist one friction_events row per block decision, so a gate block is a
    measurable event (facets.gate_block_count) and not just a line of stdout the
    session throws away. Fail-open: observability never blocks the Stop path."""
    if not session_id or not failed:
        return
    conn = None
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        conn = atlas_db.connect()
        atlas_db.record_friction(
            conn,
            session_id,
            "gate_block",
            weight=float(len(failed)),
            snippet=_gate_block_snippet(failed),
        )
    except Exception:
        pass
    finally:
        if conn is not None:
            conn.close()


def _session_is_orchestrating(session_id: str) -> bool:
    """True only when this session has a run flagged orchestrating. Fail-open to
    False: if the DB is unreadable we do NOT gate (never block on uncertainty)."""
    conn = None
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        conn = atlas_db.connect()
        return atlas_db.is_orchestrating(conn, session_id)
    except Exception:
        return False
    finally:
        if conn is not None:
            conn.close()


def _run_written_paths(session_id: str, root: Path | None = None) -> list:
    """(a)/(b)/(f)/(g) shared signal: file paths THIS RUN's own activity wrote,
    via atlas_db.run_changed_paths for the current-or-latest run.

    Two distinct misses, handled differently on purpose:
      * The run logged tool activity and none of it wrote a file -> trust it.
        "This run touched nothing" is real data, and a dirty tree left by an
        earlier session must never block a run that shipped nothing.
      * The run logged NO tool activity at all (no run row, or a run row with
        zero events and zero tool_calls) -> the telemetry never landed, so
        there is nothing to trust. Fall back to the git working tree.
        Otherwise a session whose telemetry failed gets a gate enforcing only
        "the docs files exist", and unverified code ships through the hole.

    Fail-open to [] on any atlas_db import/DB error, same contract as
    _unpaired_implementer_dispatches."""
    conn = None
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        conn = atlas_db.connect()
        rid = atlas_db.current_run_id(conn, session_id) or atlas_db.latest_run_id(
            conn, session_id
        )
        if rid is None:
            return _git_changed_paths(root) if root is not None else []
        paths = atlas_db.run_changed_paths(conn, rid)
        if not paths and not _run_has_telemetry(conn, rid, session_id):
            return _git_changed_paths(root) if root is not None else []
        return paths
    except Exception:
        return []
    finally:
        if conn is not None:
            conn.close()


_TEST_RUNNER_RE = re.compile(
    r'(?:^|[;&|]\s*|&&\s*|\|\|\s*|"(?:command|code)":\s*"|\n|\\n)'
    r"\s*(?:sudo\s+)?(?:python3?\s+-m\s+)?"
    r"(pytest|py\.test|npm (run )?test|npx (vitest|jest)|vitest|yarn test|"
    r"cargo test|go test|tox\b|nox\b|rake test|swift test|mvn test|"
    r"gradlew? test|dotnet test|unittest)\b",
    re.IGNORECASE,
)


def _transcript_test_commands(transcript_path: str, started: float | None) -> bool:
    """True when the RAW transcript shows a test-runner command, independent of
    whether `tool_calls` has been ingested yet.

    `tool_calls` only gets rows from ingest_session.py, and hooks.json runs
    completion_gate.py BEFORE ingest_session.py at Stop (both fire from the
    same Stop event). A pytest run the main thread makes in the very turn that
    triggers this Stop is therefore invisible to the `tool_calls` query below:
    the honest run would get blocked once, spuriously, and only self-correct
    on the NEXT Stop cycle once ingestion has caught up. Reading the
    transcript directly - the same source ingestion itself reads, and the
    same technique `_latest_transcript_todos` already uses for (i)/(k) - closes
    that gap without waiting on the ingest hook.

    Fail-open to False on everything unreadable/malformed: this is one of two
    OR'd signals (the other being the DB query), so a transcript read failure
    only loses this specific gap-closer, not all (g) credit."""
    if not transcript_path:
        return False
    try:
        with open(transcript_path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if '"tool_use"' not in line or (
                    '"Bash"' not in line and "ctx_" not in line
                ):
                    continue  # cheap prefilter; the JSON parse below is the real test
                try:
                    rec = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue
                if started is not None:
                    from datetime import datetime as _dt

                    ts = rec.get("timestamp")
                    try:
                        rec_epoch = _dt.fromisoformat(
                            str(ts).replace("Z", "+00:00")
                        ).timestamp()
                    except (TypeError, ValueError):
                        continue  # undated -> cannot be proven to belong to this run
                    if rec_epoch < started:
                        continue
                content = ((rec.get("message") or {}).get("content")) or []
                if not isinstance(content, list):
                    continue
                for block in content:
                    if not (
                        isinstance(block, dict) and block.get("type") == "tool_use"
                    ):
                        continue
                    name = block.get("name") or ""
                    is_bash = name == "Bash"
                    is_mcp_shell = name.startswith("mcp__") and name.rsplit("__", 1)[
                        -1
                    ] in (
                        "ctx_shell",
                        "ctx_execute",
                        "ctx_batch_execute",
                        "ctx_execute_file",
                    )
                    if not (is_bash or is_mcp_shell):
                        continue
                    blob = json.dumps(block.get("input") or {}, default=str)
                    if _TEST_RUNNER_RE.search(blob):
                        return True
    except (OSError, UnicodeDecodeError):
        return False
    return False


def _tests_executed_this_run(
    conn, session_id: str, started: float, transcript_path: str = ""
) -> bool:
    """True when at least one test-runner command executed during this run's
    window, main thread or sidechain. The (g) test-run credit exists because a
    deterministic test is stronger evidence than a verifier agent -- but a
    `verified` stamp with no executed test behind it is self-attestation, not
    verification, and self-stamping zeroed real coverage (runs shipped with
    implementer dispatches, no verifier, and no test command at all).

    Shell execution in this repo is not always the builtin `Bash` tool: this
    workspace's CLAUDE.md mandates `lean-ctx`'s `ctx_shell` and
    `context-mode`'s `ctx_execute`/`ctx_batch_execute`/`ctx_execute_file` MCP
    tools for shell commands, reserving native `Bash` for mutating state and
    short fixed output. A run that ran its pytest honestly through one of
    those MCP tools lands in `tool_calls` as kind='mcp' with a
    `lean-ctx.ctx_shell` / `context-mode.ctx_execute` target, not
    tool_name='Bash' -- match both paths or those runs get no credit at all.

    Two sources, OR'd together: the ingested `tool_calls` row (covers prior
    turns and dispatched subagents once ingest has run), and a direct
    transcript scan (covers THIS turn's own main-thread calls before
    ingest_session.py has run - see `_transcript_test_commands`)."""

    if _transcript_test_commands(transcript_path, started):
        return True
    try:
        rows = conn.execute(
            "SELECT input_summary FROM tool_calls WHERE session_id=? "
            "AND ts >= ? AND (tool_name='Bash' OR target IN ("
            "'lean-ctx.ctx_shell','context-mode.ctx_execute',"
            "'context-mode.ctx_batch_execute','context-mode.ctx_execute_file'))",
            (session_id, started),
        ).fetchall()
    except Exception:
        return False
    for row in rows:
        summary = row[0] if not hasattr(row, "keys") else row["input_summary"]
        if summary and _TEST_RUNNER_RE.search(str(summary)):
            return True
    return False


def _test_verified_this_run(
    root: Path, session_id: str, transcript_path: str = ""
) -> int:
    """(g) pairing credit for verification that was a TEST RUN, not a subagent.

    Law 5 used to accept only an atlas:verifier *dispatch* as proof a change was
    checked, which forced a second subagent onto every task no matter how small.
    Atlas's own doctrine is that a deterministic test beats a verifier agent: it
    cannot hallucinate and returns in seconds. So a `verified` entry written into
    findings.json DURING this run counts toward pairing exactly like a dispatch --
    but only when the run actually executed a test-runner command
    (_tests_executed_this_run). A stamp alone is self-attestation: it can be
    written by the same session it vouches for, which is exactly how real
    verifier coverage collapsed to zero while the gate stayed green.

    Scoped to the run window on purpose. A `verified` row inherited from an
    earlier session proves nothing about the code this run shipped, and counting
    it would hollow the gate out completely.

    Fail-open to 0 (no credit, gate keeps its old strictness) on any error.
    """
    findings = root / ".atlas" / ".run" / "findings.json"
    conn = None
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        conn = atlas_db.connect()
        rid = atlas_db.current_run_id(conn, session_id) or atlas_db.latest_run_id(
            conn, session_id
        )
        if rid is None:
            return 0
        started = atlas_db.run_started_at(conn, rid)
        if started is None:
            return 0
        if not _tests_executed_this_run(conn, session_id, started, transcript_path):
            return 0
        data = json.loads(findings.read_text(encoding="utf-8"))
        items = data if isinstance(data, list) else data.get("findings", [])
        count = 0
        for item in items if isinstance(items, list) else []:
            if not isinstance(item, dict):
                continue
            if str(item.get("status", "")).lower() != "verified":
                continue
            when = _parse_iso_epoch(item.get("verified_at"))
            if when is None:
                continue  # an undated entry cannot be proven to belong to this run
            if when >= started:
                count += 1
        return count
    except Exception:
        return 0
    finally:
        if conn is not None:
            conn.close()


def _unpaired_implementer_dispatches(session_id: str) -> int:
    """(g) Implementer dispatches this run with no verifier to check them, via
    atlas_db.unpaired_implementer_dispatches for the current-or-latest run.
    Fail-open to 0: any atlas_db import or DB error means condition (g) silently
    passes -- the gate must never crash a session over observability I/O."""
    conn = None
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        conn = atlas_db.connect()
        rid = atlas_db.current_run_id(conn, session_id) or atlas_db.latest_run_id(
            conn, session_id
        )
        if rid is None:
            return 0
        return atlas_db.unpaired_implementer_dispatches(conn, rid)
    except Exception:
        return 0
    finally:
        if conn is not None:
            conn.close()


# --------------------------------------------------------------------------
# (n) status header, (o) phased todo, (p) colony channel -- the contract-
# visibility conditions. contracts/operating-contract.json is the single source
# for the phase ids/glyphs, the header pattern, the required phases and the
# kill-switch names. Each condition is one-shot per session (marker file,
# O_EXCL), switchable off, and fails open on any error or missing input.
# --------------------------------------------------------------------------

# Per-session "already blocked once" markers. Tests point this at a temp dir in
# process (like recall_gate.GATE_MARKER_DIR) or via ATLAS_CONTRACT_GATE_DIR for
# the subprocess-level tests.
CONTRACT_GATE_MARKER_DIR = os.environ.get("ATLAS_CONTRACT_GATE_DIR") or os.path.join(
    tempfile.gettempdir(), "atlas-contract-gate"
)

_CONTRACT_PATH = (
    Path(__file__).resolve().parent.parent / "contracts" / "operating-contract.json"
)

# Kill-switch env var names. The contract's `switches` is authoritative; these
# are the built-in fallbacks for an unreadable contract (which also disables
# (n)/(o), but (p) needs no contract data and must still be switchable).
_SWITCH_HEADER = "ATLAS_GATE_HEADER"
_SWITCH_PHASES = "ATLAS_GATE_PHASES"
_SWITCH_COLONY = "ATLAS_GATE_COLONY"


def _contract_doc() -> dict | None:
    """The parsed operating contract, or None when unreadable/malformed
    (fail-open: (n) and (o) then stand down)."""
    try:
        doc = json.loads(_CONTRACT_PATH.read_text(encoding="utf-8"))
        return doc if isinstance(doc, dict) else None
    except (OSError, ValueError):
        return None


def _switch_off(name: str) -> bool:
    """True when the kill-switch env var `name` is explicitly off/0/false.
    Unset or empty leaves the condition enabled (ATLAS_GATE=off, handled in
    main(), disables every condition at once)."""
    return os.environ.get(name, "").strip().lower() in {"off", "0", "false"}


def _contract_marker(cond: str, session_id: str) -> str:
    return os.path.join(
        CONTRACT_GATE_MARKER_DIR,
        "%s-%s" % (cond, re.sub(r"[^A-Za-z0-9_.-]", "_", session_id)),
    )


def _contract_block_used(cond: str, session_id: str) -> bool:
    """True when condition `cond` already blocked once for this session.
    Fail-open to True on an unusable session id: with no way to remember a
    block, the condition must not fire (it could never be satisfied once)."""
    if not session_id:
        return True
    try:
        return os.path.exists(_contract_marker(cond, session_id))
    except OSError:
        return True


def _mark_contract_block(cond: str, session_id: str) -> bool:
    """Record that `cond` has blocked for this session. O_EXCL, so two racing
    Stops cannot both claim the first block. Returns True when this call
    created the marker. Never raises: a marker that cannot be written means
    the condition may repeat, which is the lesser failure."""
    if not session_id:
        return False
    try:
        os.makedirs(CONTRACT_GATE_MARKER_DIR, exist_ok=True)
        os.close(
            os.open(
                _contract_marker(cond, session_id),
                os.O_CREAT | os.O_EXCL | os.O_WRONLY,
            )
        )
        return True
    except OSError:
        return False


def _payload_is_sidechain(data: dict) -> bool:
    """True for a subagent's Stop: SubagentStop-shaped payloads carry
    `agent_id`, and a converted subagent transcript lives under /subagents/
    (the same signal (m) uses)."""
    if data.get("agent_id"):
        return True
    return "/subagents/" in str(data.get("transcript_path") or "").replace("\\", "/")


def _switch_name(contract: dict | None, key: str, default: str) -> str:
    try:
        name = (contract or {})["switches"][key]
        return name if isinstance(name, str) and name else default
    except (KeyError, TypeError):
        return default


def _status_header_would_block(data: dict, contract: dict | None) -> bool:
    """(n) True when the session's FINAL REPLY does not start with the atlas
    status header. The text is `last_assistant_message` in the Stop payload
    (Claude Code supplies it; omp's stop bridge fills it from session_stop).
    Fails open (False) on: kill switch, unreadable contract, missing/empty
    text, `stop_hook_active`, or any error."""
    try:
        if contract is None or _switch_off(
            _switch_name(contract, "header", _SWITCH_HEADER)
        ):
            return False
        if data.get("stop_hook_active"):
            return False
        text = data.get("last_assistant_message")
        if not isinstance(text, str):
            return False
        first = next((ln for ln in text.splitlines() if ln.strip()), "")
        if not first:
            return False
        return re.match(contract["headerFirstLinePattern"], first.strip()) is None
    except Exception:
        return False


def _header_reason_part(contract: dict | None) -> str:
    phases = ", ".join(
        "%s %s" % (p.get("id"), p.get("glyph"))
        for p in ((contract or {}).get("phases") or [])
        if isinstance(p, dict)
    )
    return (
        "  (n) Status header: your final reply does not start with the atlas status "
        "header, so the user's terminal shows no phase or state line. The first "
        "non-empty line must be `ATLAS | <glyph> <phase> | <one-line state>`. "
        "Phases and glyphs: %s. -> Re-send your final reply with that header as its "
        "first line and nothing else changed, then retry Stop. (This check blocks "
        "once per session.)" % (phases or "see contracts/operating-contract.json")
    )


def _item_phase(item: dict, phases) -> str | None:
    """The todo phase one board item carries: its `phase` field when that is a
    known phase id, else the `[<phase>] ` content prefix (Claude TodoWrite has
    no phase field). None when it carries neither."""
    phase = item.get("phase")
    if isinstance(phase, str) and phase in phases:
        return phase
    m = re.match(r"\[([^\]\s]{1,32})\]\s", str(item.get("content") or ""))
    if m and m.group(1) in phases:
        return m.group(1)
    return None


def _missing_required_phases(
    root: Path, session_id: str, contract: dict | None
) -> list:
    """(o) The `requiredTodoPhasesWhenCodeShipped` phases that none of this
    session's board items carry. Items of every status count; manual and
    archived items are not the orchestrator's plan. The caller only asks when
    this run shipped non-docs code. Fails open ([]) on a kill switch, an
    unreadable contract, or a missing/corrupt board file: an unreadable
    surface never manufactures a block."""
    try:
        if contract is None or _switch_off(
            _switch_name(contract, "phasedTodo", _SWITCH_PHASES)
        ):
            return []
        required = [str(p) for p in contract["requiredTodoPhasesWhenCodeShipped"]]
        known = [str(p) for p in contract["todoPhases"]]
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_todo

        board_file = atlas_todo.board_path(str(root))
        if not board_file.is_file():
            items: list = []  # no board at all: nothing carries a phase
        else:
            board = json.loads(board_file.read_text(encoding="utf-8"))
            items = board["items"]
            if not isinstance(items, list):
                return []
        covered = {
            _item_phase(item, known)
            for item in items
            if isinstance(item, dict)
            and not item.get("archived")
            and item.get("origin") != "manual"
            and item.get("session_id") == session_id
        }
        return [p for p in required if p not in covered]
    except Exception:
        return []


def _phases_reason_part(missing: list, contract: dict | None, session_id: str) -> str:
    prefix = str((contract or {}).get("itemPhasePrefix") or "[<phase>] ")
    return (
        "  (o) Phased todo: this run shipped code, but this session's todo items do "
        "not cover the required phase(s): %s. A phase rides on an item either as its "
        "`phase` field (omp todo phases) or as a `%s` content prefix (Claude "
        "TodoWrite), for example `[%s] <step>`. Two ways to fix it: (1) re-tag "
        "your items with that prefix in TodoWrite, or (2) run "
        'python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_todo.py" scaffold '
        '--task "<title>" --session %s '
        "and then retry Stop. (This check blocks once per session.)"
        % (", ".join(missing), prefix, missing[0], session_id or "<id>")
    )


def _colony_workers_dispatched(session_id: str) -> int | None:
    """(p) How many atlas workers THIS RUN dispatched, or None when unknown.

    Source: the `dispatches` table (atlas_db.log_dispatch), one row per Task/
    Agent dispatch with `agent_type` = the dispatch's `subagent_type`
    (dispatch_tripwire.py PostToolUse). An atlas worker is a row whose
    agent_type starts with `atlas:` or `atlas-` -- the same prefix test
    dispatch_tripwire uses to arm orchestration. Run = current-or-latest run
    of the session. None (fail-open) on any DB error or when no run exists."""
    conn = None
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        conn = atlas_db.connect()
        rid = atlas_db.current_run_id(conn, session_id) or atlas_db.latest_run_id(
            conn, session_id
        )
        if rid is None:
            return None
        return conn.execute(
            "SELECT COUNT(*) FROM dispatches WHERE run_id=? "
            "AND (agent_type LIKE 'atlas:%' OR agent_type LIKE 'atlas-%')",
            (rid,),
        ).fetchone()[0]
    except Exception:
        return None
    finally:
        if conn is not None:
            conn.close()


def _colony_channel_used(root: Path, session_id: str, started: float | None) -> bool:
    """(p) Did the colony channel carry anything during THIS RUN? Reads exactly
    these evidence sources, any one of which is enough:

      1. Board notes: every `<root>/.atlas/.run/board/*.jsonl` line (the file
         format atlas_todo.note writes: {"ts","owner","to","item","text"}) whose
         `owner` is not `lead` and whose `ts` is at or after the run start.
      2. IRC traffic recorded in `events`: a row of the current-or-latest run
         whose `path` is an `agent://` URI (omp routes SendMessage as a Write to
         `agent://<peer>`; dispatch_tripwire logs it with that path).
      3. IRC / SendMessage recorded in `tool_calls` (ingested transcripts,
         including workers' sidechains): a row of this session at or after the
         run start whose tool_name is `SendMessage`, or whose input_summary
         carries an `agent://` URI.

    Nothing else counts (the dispatch report itself is not the channel). When
    the run start is unknown the window is open-ended (any note counts), the
    same fail-open rule (a)/(b) use. Any read error returns True: an
    unreadable surface never manufactures a block."""
    try:
        since = started if started is not None else 0.0
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_todo

        notes_dir = atlas_todo.notes_dir(str(root))
        if notes_dir.is_dir():
            for path in sorted(notes_dir.glob("*" + atlas_todo.NOTE_FILE_SUFFIX)):
                try:
                    lines = path.read_text(encoding="utf-8").splitlines()
                except OSError:
                    continue
                for line in lines:
                    try:
                        rec = json.loads(line)
                        if (
                            isinstance(rec, dict)
                            and rec.get("owner") != "lead"
                            and float(rec.get("ts") or "nan") >= since
                        ):
                            return True
                    except (ValueError, TypeError):
                        continue
        import atlas_db

        conn = atlas_db.connect()
        try:
            rid = atlas_db.current_run_id(conn, session_id) or atlas_db.latest_run_id(
                conn, session_id
            )
            if (
                rid is not None
                and conn.execute(
                    "SELECT 1 FROM events WHERE run_id=? AND path LIKE 'agent://%' LIMIT 1",
                    (rid,),
                ).fetchone()
            ):
                return True
            return bool(
                conn.execute(
                    "SELECT 1 FROM tool_calls WHERE session_id=? AND ts>=? AND "
                    "(tool_name='SendMessage' OR input_summary LIKE '%agent://%') LIMIT 1",
                    (session_id, since),
                ).fetchone()
            )
        finally:
            conn.close()
    except Exception:
        return True


def _colony_reason_part(workers: int | None) -> str:
    return (
        "  (p) Colony channel: this run dispatched %s atlas workers but the colony "
        "channel carried nothing -- no worker board note under .atlas/.run/board/ "
        "and no IRC/SendMessage traffic was recorded for the run. Workers that "
        "never report on the channel leave the lead synthesizing from nothing. "
        "-> Have each worker post its handoff note "
        '(`atlas_todo.py note --owner <worker> --to lead "<summary>"`), or state '
        "in your final reply why the work was independent and needed no handoff, "
        "then retry Stop. (This check blocks once per session.)"
        % (workers if workers is not None else "two or more")
    )


if __name__ == "__main__":
    raise SystemExit(main())
