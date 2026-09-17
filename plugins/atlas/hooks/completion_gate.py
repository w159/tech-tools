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

Twelve conditions must ALL hold before the gate passes (else block ONCE):
  (a) At least one file exists under `.atlas/evidence/`. Scoped like (f)/(g):
      only checked when THIS RUN shipped non-docs code (_nondocs_changed on
      the run-write signal). A run that shipped no code has no evidence to
      capture, so (a) is skipped rather than manufacturing busywork.
  (b) `.atlas/.run/findings.json` exists and contains at least one entry with
      status "verified". Same scoping as (a): only checked when this run
      shipped non-docs code.
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
      deterministic test result recorded via scripts/atlas_finding.py). The
      formula is max(0, unpaired_implementer_dispatches - _test_verified_this_run).
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
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import atlas_hook_guard  # noqa: E402

sys.path.insert(0, os.path.dirname(__file__))
from docs_drift import docs_drift as _docs_drift  # noqa: E402
from docs_drift import find_root as _find_root  # noqa: E402
from docs_drift import git_changed_paths as _git_changed_paths  # noqa: E402


def _check_evidence(root: Path) -> bool:
    """(a) At least one file under .atlas/evidence/."""
    evidence = root / ".atlas" / "evidence"
    try:
        return evidence.is_dir() and any(p.is_file() for p in evidence.iterdir())
    except OSError:
        return True  # can't read -> fail open


def _check_findings(root: Path) -> bool:
    """(b) .atlas/.run/findings.json has at least one entry with status 'verified'."""
    findings = root / ".atlas" / ".run" / "findings.json"
    try:
        if not findings.is_file():
            return False
        data = json.loads(findings.read_text(encoding="utf-8"))
        items = data if isinstance(data, list) else data.get("findings", [])
        for item in items if isinstance(items, list) else []:
            if (
                isinstance(item, dict)
                and str(item.get("status", "")).lower() == "verified"
            ):
                return True
        return False
    except OSError:
        return True  # genuine read failure -> fail open
    except (json.JSONDecodeError, ValueError, AttributeError):
        return False  # structural malformation -> does NOT count as verified


def _check_nonempty(path: Path) -> bool:
    """A required markdown file exists and is non-empty. Fail-open on OSError."""
    try:
        return path.is_file() and path.stat().st_size > 0
    except OSError:
        return True  # can't stat -> fail open


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


def _nondocs_changed(changed_paths: list) -> bool:
    """Return True when at least one changed path is NOT a docs/ path.

    Unlike _docs_drift this ignores whether docs also moved: it answers only
    "did code change this run?" -- the trigger for the Law 5 verifier check (g).
    A path is 'docs' if it starts with 'docs/' or contains '/docs/'.
    """
    for p in changed_paths:
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
            'python3 "$CLAUDE_PLUGIN_ROOT/scripts/atlas_finding.py" --id <stage> '
            "--status verified --title '<one line>' --evidence '<path or test id>' "
            "--reproduction '<exact command>'. Only dispatch atlas:verifier if no "
            "independent check has actually run yet."
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
            'python3 "$CLAUDE_PLUGIN_ROOT/scripts/atlas_finding.py" --id <stage> '
            "--status verified --evidence '<test id>' --reproduction '<command>'; a "
            "`verified` entry stamped during this run pairs an implementer exactly "
            "like a dispatch does, and a test cannot hallucinate. (2) Dispatch "
            "atlas:verifier only when no test can express the check. Then retry Stop."
            % unverified
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
            'python3 "$CLAUDE_PLUGIN_ROOT/scripts/atlas_todo.py" set '
            "'[{\"content\":\"...\",\"status\":\"completed\"}]' --session <session_id>. "
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
            'python3 "$CLAUDE_PLUGIN_ROOT/scripts/lint_docs_names.py".'
            % (len(name_violations), "; ".join(p for p, _ in name_violations[:5]))
        )
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
        if not _session_is_orchestrating(data.get("session_id", "")):
            return 0  # WS1: only real orchestration runs are gated; never block a chat/audit turn
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
        # inapplicable gate is the defect, not the fix.
        ok_a = _check_evidence(root) if code_changed else True
        ok_b = _check_findings(root) if code_changed else True
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
                - _test_verified_this_run(root, session),
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
            )
            if failing
        ]
        _record_gate_block(data.get("session_id", ""), failed)
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
            snippet="conditions: " + ",".join(failed),
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


def _test_verified_this_run(root: Path, session_id: str) -> int:
    """(g) pairing credit for verification that was a TEST RUN, not a subagent.

    Law 5 used to accept only an atlas:verifier *dispatch* as proof a change was
    checked, which forced a second subagent onto every task no matter how small.
    Atlas's own doctrine is that a deterministic test beats a verifier agent: it
    cannot hallucinate and returns in seconds. So a `verified` entry written into
    findings.json DURING this run counts toward pairing exactly like a dispatch.

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
        data = json.loads(findings.read_text(encoding="utf-8"))
        items = data if isinstance(data, list) else data.get("findings", [])
        count = 0
        for item in items if isinstance(items, list) else []:
            if not isinstance(item, dict):
                continue
            if str(item.get("status", "")).lower() != "verified":
                continue
            stamp = item.get("verified_at")
            if not isinstance(stamp, str):
                continue  # an undated entry cannot be proven to belong to this run
            try:
                when = datetime.fromisoformat(stamp)
            except ValueError:
                continue
            if when.tzinfo is None:
                when = when.replace(tzinfo=timezone.utc)
            if when.timestamp() >= started:
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


if __name__ == "__main__":
    raise SystemExit(main())
