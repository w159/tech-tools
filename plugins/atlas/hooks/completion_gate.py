#!/usr/bin/env python3
"""Stop hook -- the atlas "Definition of done" gate (opt-in).

The atlas-engine skill's hardest rule is that a change is not *done* until observed
behavior is captured AND an independent agent has verified it. Prose alone does not
enforce this (the orchestrator rationalizes "I'll mark it unverified and move on").
This hook is the machine backstop.

It is **scoped**: it only engages when the working directory (or a detected project
root above it) holds a `docs/` directory -- i.e. the docs/ single source of truth is
present. In any other session it is a silent no-op, so it is safe to leave installed.

Three conditions must ALL hold before the gate passes (else block ONCE):
  (a) At least one file exists under `docs/evidence/`.
  (b) `docs/.run/findings.json` exists and contains at least one entry with
      status "verified".
  (c) `docs/CHANGELOG.md` exists and is non-empty (docs-current backstop).

If any of the three are missing the hook blocks and names exactly which condition
failed and that docs/ must be current (CHANGELOG, ROADMAP, affected subfolders)
before calling the work done.

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


def _find_docs(start: Path) -> Path | None:
    """Walk from start toward the filesystem root; return the first `docs/` dir found.

    Stops at the filesystem root or after 6 levels to stay cheap and fail-open.
    """
    candidate = start
    for _ in range(7):
        docs = candidate / "docs"
        if docs.is_dir():
            return docs
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
    """(b) docs/.run/findings.json has at least one entry with status 'verified'."""
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
    except (OSError, json.JSONDecodeError, ValueError, AttributeError):
        return True  # malformed -> fail open


def _check_changelog(docs: Path) -> bool:
    """(c) docs/CHANGELOG.md exists and is non-empty."""
    changelog = docs / "CHANGELOG.md"
    try:
        return changelog.is_file() and changelog.stat().st_size > 0
    except OSError:
        return True  # can't stat -> fail open


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


def _git_changed_paths(docs: Path) -> list:
    """Return changed file paths from git diff HEAD and the staged index.

    Uses the repo root detected from the docs/ directory. Fails open: any
    subprocess error, missing git binary, or non-repo path returns an empty
    list so the caller treats it as no drift.
    """
    try:
        root_bytes = subprocess.check_output(
            ["git", "-C", str(docs), "rev-parse", "--show-toplevel"],
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
        repo_root = root_bytes.decode(errors="replace").strip()
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


def _reason(missing_a: bool, missing_b: bool, missing_c: bool) -> str:
    parts = []
    if missing_a:
        parts.append(
            "  (a) No files found under docs/evidence/. Capture observed-behavior proof "
            "(test output, DB read-back, endpoint response, or UI screenshot) there first. "
            "-> Dispatch the relevant atlas specialist (atlas:implementer to re-run and "
            "capture, atlas:ui-runtime-tester for a live UI screenshot, or atlas:db-prober "
            "for a DB read-back) to produce and save that artifact under docs/evidence/."
        )
    if missing_b:
        parts.append(
            "  (b) docs/.run/findings.json is missing or has no entry with status "
            '"verified". Record an independent atlas:verifier result before stopping. '
            "-> Dispatch atlas:verifier for the shipping stage to independently confirm "
            'or refute the claim, then write its verdict (status="verified") into '
            "docs/.run/findings.json."
        )
    if missing_c:
        parts.append(
            "  (c) docs/CHANGELOG.md is missing or empty. docs/ must be current -- "
            "update CHANGELOG.md (and ROADMAP/affected subfolders) to reflect this run. "
            "-> Dispatch atlas:docs-curator to bring docs/ current (CHANGELOG, ROADMAP, "
            "affected subfolders) citing file:line evidence."
        )
    failed = "\n".join(parts)
    return (
        "[atlas] Definition-of-done gate: the following condition(s) are not met:\n"
        + failed
        + "\n\nClose the gap proactively, do not just refuse: first dispatch "
        "atlas:completeness-critic to pinpoint exactly which evidence and verification "
        "are still missing, then dispatch the specialist named beside each failed "
        "condition above to produce it, then retry Stop.\n\n"
        "All three must hold before this run can be declared done. "
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
        docs = _find_docs(cwd)
        if docs is None:
            return 0  # no docs/ dir in tree -> not an atlas run -> silent no-op
        if not _session_is_orchestrating(data.get("session_id", "")):
            return 0  # WS1: only real orchestration runs are gated; never block a chat/audit turn
        ok_a = _check_evidence(docs)
        ok_b = _check_findings(docs)
        ok_c = _check_changelog(docs)
        # Advisory docs-freshness signal: warn when non-docs files changed but
        # docs/ was not touched. Never blocks on its own (always fail-open).
        drift_advisory = None
        try:
            changed = _git_changed_paths(docs)
            if _docs_drift(changed):
                drift_advisory = (
                    "[atlas] Docs-freshness advisory: non-docs files changed but no "
                    "docs/ files are in the diff. Dispatch atlas:docs-curator to "
                    "reconcile docs/ (CHANGELOG, ROADMAP, affected subfolders) before "
                    "declaring this run done."
                )
        except Exception:
            pass  # fail-open: drift advisory must never block
        if ok_a and ok_b and ok_c:
            if drift_advisory:
                print(
                    json.dumps(
                        {
                            "hookSpecificOutput": {
                                "hookEventName": "Stop",
                                "additionalContext": drift_advisory,
                            }
                        }
                    )
                )
            return 0
        block_reason = _reason(not ok_a, not ok_b, not ok_c)
        if drift_advisory:
            block_reason += "\n\n" + drift_advisory
        print(json.dumps({"decision": "block", "reason": block_reason}))
    except Exception:  # noqa: BLE001 -- a Stop hook must never wedge the session
        return 0
    return 0


def _finalize_db(session_id: str) -> None:
    """Finalize the observability run for this session. Fail-open."""
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        _conn = atlas_db.connect()
        _rid = atlas_db.current_run_id(_conn, session_id)
        if _rid is not None:
            atlas_db.finalize_run(_conn, _rid)
    except Exception:
        pass  # observability is best-effort; never block stop


def _session_is_orchestrating(session_id: str) -> bool:
    """True only when this session has a run flagged orchestrating. Fail-open to
    False: if the DB is unreadable we do NOT gate (never block on uncertainty)."""
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        conn = atlas_db.connect()
        return atlas_db.is_orchestrating(conn, session_id)
    except Exception:
        return False


if __name__ == "__main__":
    raise SystemExit(main())
