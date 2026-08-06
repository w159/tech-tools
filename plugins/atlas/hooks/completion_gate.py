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

Seven conditions must ALL hold before the gate passes (else block ONCE):
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
  (g) Law 5 -- verifier coverage: if non-docs code changed this run and there
      are more implementer dispatches than verifier dispatches for the run
      (atlas_db.unpaired_implementer_dispatches > 0), block -- shipping work
      that never got an independent atlas:verifier pass.
  (h) ROADMAP reconciliation: if docs/ROADMAP.md contains items with status
      "done" that should have been moved to CHANGELOG, block. A "done" item
      in ROADMAP is a defect -- it belongs in CHANGELOG with a date and
      evidence citation.

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
            '"verified". Record an independent atlas:verifier result before stopping. '
            "-> Dispatch atlas:verifier for the shipping stage to independently confirm "
            'or refute the claim, then write its verdict (status="verified") into '
            ".atlas/.run/findings.json."
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
            "  (f) Docs drift: non-docs files changed this run but no docs/ file is "
            "in the diff. The docs/ tree is the single source of truth and must move "
            "with the code. -> Dispatch atlas:docs-curator to reconcile docs/ "
            "(CHANGELOG, ROADMAP, affected subfolders) citing file:line evidence, "
            "then retry Stop."
        )
    if unverified > 0:
        parts.append(
            "  (g) Law 5 -- verifier coverage: %d implementer dispatch(es) shipped "
            "code this run with no independent atlas:verifier to check them. Every "
            "shipping change gets an independent verifier. -> Dispatch atlas:verifier "
            "for the unverified change(s) to confirm or refute the work in a fresh "
            "context, then retry Stop." % unverified
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
    failed = "\n".join(parts)
    return (
        "[atlas] Definition-of-done gate: the following condition(s) are not met:\n"
        + failed
        + "\n\nClose the gap proactively, do not just refuse: first dispatch "
        "atlas:completeness-critic to pinpoint exactly which evidence and verification "
        "are still missing, then dispatch the specialist named beside each failed "
        "condition above to produce it, then retry Stop.\n\n"
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
        # (f) Docs drift BLOCKS: THIS RUN's own writes moved code but docs/
        # did not.
        drift = _docs_drift(run_paths) if code_changed else False
        # (g) Law 5 -- verifier coverage. Only when THIS RUN's own writes
        # touched non-docs code: block if implementer dispatches outnumber
        # verifier dispatches. An implementer still in flight, or one that
        # shipped no diff, contributes nothing to run_paths, so it cannot
        # trip this. Fail-open: the helper returns 0 on any atlas_db
        # import/DB error, so condition (g) silently passes.
        unverified = (
            _unpaired_implementer_dispatches(data.get("session_id", ""))
            if code_changed
            else 0
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
