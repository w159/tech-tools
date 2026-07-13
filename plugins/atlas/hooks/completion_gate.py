#!/usr/bin/env python3
"""Stop hook -- the atlas "Definition of done" gate (opt-in).

The atlas-orchestrate skill's hardest rule is that a change is not *done* until observed
behavior is captured AND an independent agent has verified it. Prose alone does not
enforce this (the orchestrator rationalizes "I'll mark it unverified and move on").
This hook is the machine backstop.

It is **scoped**: it only engages when the working directory (or a detected project
root above it) holds a `.atlas/docs/` directory -- the single source of truth that
atlas-setup scaffolds. The SSOT always lives at `.atlas/docs/`, never at a root
`docs/`. Before this was reconciled the gate looked for `docs/` while the skill
wrote `.atlas/docs/`, so it gated the wrong tree (when a legacy `docs/` happened to
exist) or never engaged at all (for a pure 5.0.0 project). In any session with no
`.atlas/docs/` it is a silent no-op, so it is safe to leave installed.

Seven conditions must ALL hold before the gate passes (else block ONCE):
  (a) At least one file exists under `.atlas/docs/evidence/`.
  (b) `.atlas/docs/.run/findings.json` exists and contains at least one entry with
      status "verified".
  (c) `.atlas/docs/CHANGELOG.md` exists and is non-empty (docs-current backstop).
  (d) `.atlas/docs/ROADMAP.md` exists and is non-empty.
  (e) `README.md` at the project root exists and is non-empty.
  (f) No docs drift: if non-docs files changed this run (git diff HEAD +
      staged), at least one docs/ file changed too -- this is the deterministic
      trigger that forces an atlas:docs-curator dispatch before "done".
  (g) Law 5 -- verifier coverage: if non-docs code changed this run and there
      are more implementer dispatches than verifier dispatches for the run
      (atlas_db.unpaired_implementer_dispatches > 0), block -- shipping work
      that never got an independent atlas:verifier pass.

If any condition is missing the hook blocks and names exactly which condition
failed and which specialist closes it.

Fail-open by construction: any error, missing dir, or unparseable input lets the
stop proceed. Disable entirely with ATLAS_GATE=off. Opt-out (on by default when
a docs/ tree is present and wired in hooks.json on Stop; set ATLAS_GATE=off to
disable).

Stdlib only.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


def _find_ssot(start: Path) -> Path | None:
    """Walk from start toward the filesystem root; return the .atlas/docs/ SSOT dir.

    The atlas SSOT always lives at .atlas/docs/ (never a root docs/). Before this
    was reconciled the gate looked for docs/ while the skill wrote .atlas/docs/,
    gating the wrong tree or never engaging. Stops at the filesystem root or after
    6 levels to stay cheap and fail-open.
    """
    candidate = start
    for _ in range(7):
        atlas_docs = candidate / ".atlas" / "docs"
        if atlas_docs.is_dir():
            return atlas_docs
        parent = candidate.parent
        if parent == candidate:
            break
        candidate = parent
    return None


def _check_evidence(docs: Path) -> bool:
    """(a) At least one file under docs/evidence/."""
    evidence = docs / "evidence"
    try:
        return evidence.is_dir() and any(p.is_file() for p in evidence.iterdir())
    except OSError:
        return True  # can't read -> fail open


def _check_findings(docs: Path) -> bool:
    """(b) .atlas/docs/.run/findings.json has at least one entry with status 'verified'."""
    findings = docs / ".run" / "findings.json"
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


def _check_changelog(docs: Path) -> bool:
    """(c) .atlas/docs/CHANGELOG.md exists and is non-empty."""
    return _check_nonempty(docs / "CHANGELOG.md")


def _check_roadmap(docs: Path) -> bool:
    """(d) .atlas/docs/ROADMAP.md exists and is non-empty."""
    return _check_nonempty(docs / "ROADMAP.md")


def _check_readme(docs: Path) -> bool:
    """(e) README.md at the project root is non-empty.

    docs is .atlas/docs/, so the project root is two levels up
    (.atlas/docs -> .atlas -> repo root). Fail-open on OSError.
    """
    return _check_nonempty(docs.parent.parent / "README.md")


def _docs_drift(changed_paths: list) -> bool:
    """Return True when >=1 non-docs file was changed and 0 docs files were changed.

    A path is 'docs' if it starts with 'docs/' or contains '/docs/'.
    Pure helper: takes a list of relative path strings, does no I/O.
    """
    if not changed_paths:
        return False
    for p in changed_paths:
        if p.startswith("docs/") or "/docs/" in p:
            return False  # at least one docs path -> no drift
    return True  # paths present, none are docs


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


def _git_changed_paths(docs: Path) -> list:
    """Return changed file paths from git diff HEAD and the staged index.

    Uses the repo root detected from the docs/ directory. Fails open on a
    non-repo path or git command error (returns [] so the caller treats it as
    no drift). A missing git binary (FileNotFoundError) is propagated so the
    caller can fail-closed -- silently passing docs-drift / Law 5 when git is
    genuinely unavailable would let unverified code ship.
    """
    try:
        root_bytes = subprocess.check_output(
            ["git", "-C", str(docs), "rev-parse", "--show-toplevel"],
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
        repo_root = root_bytes.decode(errors="replace").strip()
    except FileNotFoundError as exc:
        raise RuntimeError("git unavailable: could not run git (%s)" % exc) from exc
    except Exception:
        return []

    paths: set = set()
    for args in (
        ["git", "-C", repo_root, "diff", "--name-only", "HEAD"],
        ["git", "-C", repo_root, "diff", "--name-only", "--cached"],
    ):
        try:
            out = subprocess.check_output(args, stderr=subprocess.DEVNULL, timeout=5)
            for line in out.decode(errors="replace").splitlines():
                line = line.strip()
                if line:
                    paths.add(line)
        except Exception:
            pass  # fail-open: any git error -> treat as no new paths
    return list(paths)


def _reason(
    missing_a: bool,
    missing_b: bool,
    missing_c: bool,
    missing_d: bool = False,
    missing_e: bool = False,
    drift: bool = False,
    unverified: int = 0,
    git_error: str = "",
) -> str:
    parts = []
    if missing_a:
        parts.append(
            "  (a) No files found under .atlas/docs/evidence/. Capture observed-behavior proof "
            "(test output, DB read-back, endpoint response, or UI screenshot) there first. "
            "-> Dispatch the relevant atlas specialist (atlas:implementer to re-run and "
            "capture, atlas:ui-runtime-tester for a live UI screenshot, or atlas:db-prober "
            "for a DB read-back) to produce and save that artifact under .atlas/docs/evidence/."
        )
    if missing_b:
        parts.append(
            "  (b) .atlas/docs/.run/findings.json is missing or has no entry with status "
            '"verified". Record an independent atlas:verifier result before stopping. '
            "-> Dispatch atlas:verifier for the shipping stage to independently confirm "
            'or refute the claim, then write its verdict (status="verified") into '
            ".atlas/docs/.run/findings.json."
        )
    if missing_c:
        parts.append(
            "  (c) .atlas/docs/CHANGELOG.md is missing or empty. .atlas/docs/ must be current -- "
            "update CHANGELOG.md (and ROADMAP/affected subfolders) to reflect this run. "
            "-> Dispatch atlas:docs-curator to bring docs/ current (CHANGELOG, ROADMAP, "
            "affected subfolders) citing file:line evidence."
        )
    if missing_d:
        parts.append(
            "  (d) .atlas/docs/ROADMAP.md is missing or empty. The roadmap is part of the "
            ".atlas/docs/ single source of truth. -> Dispatch atlas:docs-curator to write or "
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
            "  (f) Docs drift: non-docs files changed this run but no .atlas/docs/ file is "
            "in the diff. The .atlas/docs/ tree is the single source of truth and must move "
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
        # Loop guard: never re-block a continuation we already triggered.
        if data.get("stop_hook_active"):
            return 0
        cwd = Path(data.get("cwd") or os.getcwd())
        docs = _find_ssot(cwd)
        if docs is None:
            return 0  # no .atlas/docs/ SSOT -> not an atlas run -> silent no-op
        if not _session_is_orchestrating(data.get("session_id", "")):
            return 0  # WS1: only real orchestration runs are gated; never block a chat/audit turn
        ok_a = _check_evidence(docs)
        ok_b = _check_findings(docs)
        ok_c = _check_changelog(docs)
        ok_d = _check_roadmap(docs)
        ok_e = _check_readme(docs)
        # (f) Docs drift BLOCKS: code moved but docs/ did not. This is the
        # deterministic trigger that forces an atlas:docs-curator dispatch.
        # Fail-open: any git error yields an empty path list -> no drift.
        drift = False
        code_changed = False
        git_error = ""
        try:
            changed = _git_changed_paths(docs)
            drift = _docs_drift(changed)
            code_changed = _nondocs_changed(changed)
        except Exception as exc:
            # Fail-closed for the drift/verifier conditions: if git is
            # genuinely unavailable we cannot verify docs moved with the code
            # or that non-docs code changed -- block rather than silently pass
            # and let unverified code ship.
            git_error = str(exc) or "git subprocess failed"
        # (g) Law 5 -- verifier coverage. Only when non-docs code changed this
        # run: block if implementer dispatches outnumber verifier dispatches.
        # Fail-open: the helper returns 0 on any atlas_db import/DB error, so
        # condition (g) silently passes and never crashes the session.
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
            and not drift
            and unverified == 0
            and not git_error
        ):
            return 0
        block_reason = _reason(
            not ok_a,
            not ok_b,
            not ok_c,
            not ok_d,
            not ok_e,
            drift,
            unverified,
            git_error,
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
