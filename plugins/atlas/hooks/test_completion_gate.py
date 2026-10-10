import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(
    0,
    _iso_os.path.join(
        _iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"
    ),
)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import re
from datetime import datetime, timezone
import time
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import atlas_db  # noqa: E402
import atlas_todo  # noqa: E402
import completion_gate  # noqa: E402
from completion_gate import (
    _check_findings,
    _docs_drift,
    _find_root,
    _git_changed_paths,
    _nondocs_changed,
    _reason,
    _unpaired_implementer_dispatches,
)

GATE = os.path.join(os.path.dirname(__file__), "completion_gate.py")


def _run_gate(payload, env):
    return subprocess.run(
        [sys.executable, GATE],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        env=env,
    )


def _seed_plan(root, session_id="sess-orch"):
    """Satisfy condition (k): prove this run committed to a plan.

    (k) blocks a code-shipping run that never made a todo list at all. Every
    fixture that asserts "no block" while isolating some OTHER condition needs
    a plan on the board, or it is really asserting (k). One already-drained
    item is the smallest plan that leaves (i) at zero open items.
    """
    atlas_todo.mirror(
        root, [{"content": "fixture plan", "status": "completed"}], session_id
    )


def _seed_dispatch(db_path, session_id="sess-orch"):
    with atlas_db.connect(db_path) as conn:
        rid = atlas_db.current_run_id(conn, session_id) or atlas_db.latest_run_id(
            conn, session_id
        )
        conn.execute(
            "INSERT INTO dispatches(run_id,ts,agent_type) VALUES(?,?,?)",
            (rid, datetime.now(timezone.utc).timestamp(), "atlas:explorer"),
        )


def _lead_channel(root, session_id="sess-orch", members=()):
    """The run's lead subchannel (`<main>/lead-<first 6 of the session id>`) with
    `members` registered lead-side, as a dispatch/launch does; returns its name."""
    lead = "lead-" + atlas_todo._sanitize_owner(session_id)[:6]
    return atlas_todo.open_lead_channel(root, lead, list(members))["name"]


def _seed_report_notes(root, owners=("worker-a", "worker-b"), session_id="sess-orch"):
    """Channel traffic for gate (p): one final-report note per registered worker of
    the run's lead channel, written through atlas_todo.note exactly as atlas_mux
    does (C2: kind='report')."""
    chan = _lead_channel(root, session_id, owners)
    for owner in owners:
        atlas_todo.note(
            root, owner, "STATUS: DONE\nexit 0", channel=chan, kind="report"
        )


class DocsDriftTest(unittest.TestCase):
    def test_non_docs_only_returns_true(self):
        """Non-docs changes with no docs changes -> drift detected."""
        self.assertTrue(_docs_drift(["src/foo.py", "README.md"]))

    def test_docs_change_present_returns_false(self):
        """The CHANGELOG in the list -> no drift: the record was written."""
        self.assertFalse(_docs_drift(["src/foo.py", "docs/CHANGELOG.md"]))

    def test_only_docs_path_returns_false(self):
        """Only docs/ paths -> no drift."""
        self.assertFalse(_docs_drift(["docs/ROADMAP.md"]))

    def test_nested_docs_path_returns_false(self):
        """A path containing /docs/ is a docs path, so a docs-only run is not drift."""
        self.assertFalse(_docs_drift(["plugins/atlas/docs/features.md"]))

    def test_empty_list_returns_false(self):
        """Empty input -> no drift (nothing changed)."""
        self.assertFalse(_docs_drift([]))

    def test_unrelated_docs_edit_does_not_clear_drift(self):
        """The regression that let docs rot: any single docs/ path used to clear
        (f), so a scratch edit under docs/architecture/ kept the gate quiet while
        the CHANGELOG went unwritten."""
        self.assertTrue(_docs_drift(["src/foo.py", "docs/architecture/notes.md"]))

    def test_roadmap_alone_does_not_clear_drift(self):
        """ROADMAP holds what is NOT done yet, so it is not the record of a
        shipped change -- only the CHANGELOG is."""
        self.assertTrue(_docs_drift(["src/foo.py", "docs/ROADMAP.md"]))

    def test_nested_changelog_clears_drift(self):
        """A nested project (plugins/<x>/docs/CHANGELOG.md) clears it too."""
        self.assertFalse(_docs_drift(["src/foo.py", "plugins/atlas/docs/CHANGELOG.md"]))


class GateOrchestrationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        os.makedirs(
            os.path.join(self.tmp, "docs"), exist_ok=True
        )  # docs/ exists, no artifacts
        self.env = dict(
            os.environ,
            ATLAS_DB=os.path.join(self.tmp, "atlas.db"),
            # Isolate the guard's breaker/throttle state: several tests reuse
            # "sess-orch" across many _run_gate calls, and must never touch
            # real ~/.atlas or trip the breaker across unrelated tests.
            ATLAS_HOOKSTATE_DIR=os.path.join(self.tmp, "hookstate"),
        )
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        c = atlas_db.connect(self.env["ATLAS_DB"])
        atlas_db.init(c)
        pid = atlas_db.register_project(c, self.tmp)
        atlas_db.start_run(c, pid, "sess-chat")  # non-orchestration
        atlas_db.start_run(c, pid, "sess-orch")
        atlas_db.mark_orchestrating(c, "sess-orch")  # orchestration
        c.close()

    def test_non_orchestration_session_is_not_blocked(self):
        r = _run_gate({"session_id": "sess-chat", "cwd": self.tmp}, self.env)
        self.assertEqual(r.returncode, 0)
        self.assertNotIn('"decision": "block"', r.stdout)

    def test_orchestration_session_missing_artifacts_is_blocked(self):
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn('"decision": "block"', r.stdout)

    def _log_run_write(self, path):
        """Simulate this run's own activity writing `path` -- what
        dispatch_tripwire (main-thread) or session_ingest (dispatched
        subagents) would have recorded in atlas_db for a real run. (f)/(g)
        are now scoped to this signal instead of the whole working tree."""
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        c = atlas_db.connect(self.env["ATLAS_DB"])
        rid = atlas_db.current_run_id(c, "sess-orch") or atlas_db.latest_run_id(
            c, "sess-orch"
        )
        atlas_db.log_event(c, rid, "Write", "main", 1, path)
        c.commit()
        c.close()

    def test_legacy_atlas_docs_only_does_not_engage_gate(self):
        """A repo with only a legacy .atlas/docs/ but no root docs/ -> gate is
        a no-op, even for an orchestrating session. The SSOT is docs/ only;
        a bare legacy .atlas/docs/ must NOT trigger the gate."""
        shutil.rmtree(os.path.join(self.tmp, "docs"))
        os.makedirs(os.path.join(self.tmp, ".atlas", "docs"), exist_ok=True)
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertEqual(r.returncode, 0)
        self.assertNotIn('"decision": "block"', r.stdout)

    def _log_run_read(self, path):
        """Telemetry that is NOT a write: proves the recorder was working this
        run, so 'this run wrote no files' is a measurement and not a silence."""
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        c = atlas_db.connect(self.env["ATLAS_DB"])
        rid = atlas_db.current_run_id(c, "sess-orch") or atlas_db.latest_run_id(
            c, "sess-orch"
        )
        atlas_db.log_event(c, rid, "Read", "main", 1, path)
        c.commit()
        c.close()

    def _satisfy_all_conditions(self):
        docs = os.path.join(self.tmp, "docs")
        atlas_dir = os.path.join(self.tmp, ".atlas")
        os.makedirs(os.path.join(atlas_dir, "evidence"), exist_ok=True)
        os.makedirs(os.path.join(atlas_dir, ".run"), exist_ok=True)
        with open(os.path.join(atlas_dir, "evidence", "run.txt"), "w") as f:
            f.write("observed output")
        with open(os.path.join(atlas_dir, ".run", "findings.json"), "w") as f:
            json.dump(
                [
                    {
                        "claim": "x works",
                        "status": "verified",
                        "verified_at": datetime.now(timezone.utc).isoformat(),
                    }
                ],
                f,
            )
        for name in ("CHANGELOG.md", "ROADMAP.md"):
            with open(os.path.join(docs, name), "w") as f:
                f.write("# %s\ncontent\n" % name)
        with open(os.path.join(self.tmp, "README.md"), "w") as f:
            f.write("# project\n")
        _seed_plan(self.tmp)
        _seed_dispatch(self.env["ATLAS_DB"])

    def test_all_conditions_met_passes(self):
        self._satisfy_all_conditions()
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertEqual(r.returncode, 0)
        self.assertNotIn('"decision": "block"', r.stdout)

    def test_missing_roadmap_blocks_with_condition_d(self):
        self._satisfy_all_conditions()
        os.remove(os.path.join(self.tmp, "docs", "ROADMAP.md"))
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn('"decision": "block"', r.stdout)
        self.assertIn("ROADMAP.md is missing", r.stdout)

    def test_missing_readme_blocks_with_condition_e(self):
        self._satisfy_all_conditions()
        os.remove(os.path.join(self.tmp, "README.md"))
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn('"decision": "block"', r.stdout)
        self.assertIn("README.md at the project root is missing", r.stdout)

    def test_docs_drift_blocks_with_condition_f(self):
        """(b) (f) DOES fire when the run itself wrote non-docs files (via the
        atlas_db run-write signal, not a git diff) and no docs/ file changed."""
        self._satisfy_all_conditions()
        app_py = os.path.join(self.tmp, "app.py")
        with open(app_py, "w") as f:
            f.write("print('x')\n")
        self._log_run_write(app_py)  # this run wrote non-docs code, no docs touched
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn('"decision": "block"', r.stdout)
        self.assertIn("Docs drift", r.stdout)
        # this run ALSO touching a docs file clears the drift block
        docs_md = os.path.join(self.tmp, "docs", "CHANGELOG.md")
        with open(docs_md, "a") as f:
            f.write("- change\n")
        self._log_run_write(docs_md)
        r2 = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertNotIn('"decision": "block"', r2.stdout)

    def test_dirty_tree_from_other_run_does_not_block_condition_f(self):
        """(a) (f) does NOT fire when the tree is dirty from files THIS run did
        not write -- the exact false-positive this fix targets: a prior
        session's leftover uncommitted files must never block a run that
        touched nothing itself.

        The run must have logged SOMETHING for its "wrote no files" to be data
        rather than an absence of data: a run with no telemetry at all falls
        back to the git tree (see test_no_telemetry_falls_back_to_git below).
        One read event is enough to say the recorder was working.
        """
        self._satisfy_all_conditions()
        self._log_run_read(os.path.join(self.tmp, "README.md"))
        subprocess.run(["git", "init", "-q", self.tmp], check=True, capture_output=True)
        subprocess.run(
            ["git", "-C", self.tmp, "add", "-A"], check=True, capture_output=True
        )
        subprocess.run(
            ["git", "-C", self.tmp, "commit", "-qm", "base"],
            check=True,
            capture_output=True,
            env=dict(
                os.environ,
                GIT_AUTHOR_NAME="t",
                GIT_AUTHOR_EMAIL="t@t",
                GIT_COMMITTER_NAME="t",
                GIT_COMMITTER_EMAIL="t@t",
            ),
        )
        # A stale, non-docs, uncommitted change left dirty by some other run --
        # NOT logged via _log_run_write, so atlas_db has no record that THIS
        # run touched it.
        with open(os.path.join(self.tmp, "stale_from_prior_session.py"), "w") as f:
            f.write("print('leftover')\n")
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertNotIn('"decision": "block"', r.stdout)

    def test_no_telemetry_falls_back_to_git_condition_f(self):
        """(a2) A run that logged NOTHING is not evidence that nothing shipped.

        Before this fallback, a session whose telemetry never landed got a gate
        that checked only "the docs files exist", and unverified code shipped
        straight through. With no events and no tool_calls the gate reads the
        git working tree instead.
        """
        self._satisfy_all_conditions()
        subprocess.run(["git", "init", "-q", self.tmp], check=True, capture_output=True)
        subprocess.run(
            ["git", "-C", self.tmp, "add", "-A"], check=True, capture_output=True
        )
        subprocess.run(
            ["git", "-C", self.tmp, "commit", "-qm", "base"],
            check=True,
            capture_output=True,
            env=dict(
                os.environ,
                GIT_AUTHOR_NAME="t",
                GIT_AUTHOR_EMAIL="t@t",
                GIT_COMMITTER_NAME="t",
                GIT_COMMITTER_EMAIL="t@t",
            ),
        )
        # Tracked file modified, nothing logged in atlas_db for this run.
        with open(os.path.join(self.tmp, "app.py"), "w") as f:
            f.write("print('shipped with no telemetry')\n")
        subprocess.run(
            ["git", "-C", self.tmp, "add", "app.py"], check=True, capture_output=True
        )
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn('"decision": "block"', r.stdout)
        self.assertIn("Docs drift", r.stdout)

    def test_zero_writes_passes_silently_condition_f(self):
        """(c) The gate passes silently -- EMPTY stdout -- when the run wrote
        zero non-docs files: there is nothing for (a)/(b)/(f)/(g) to check,
        and a pass never narrates. Silence on pass is the contract; only a
        block speaks."""
        self._satisfy_all_conditions()
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertNotIn('"decision": "block"', r.stdout)
        self.assertEqual(r.stdout.strip(), "")

    def test_zero_writes_skips_a_and_b_even_when_unsatisfied(self):
        """DEFECT 1: a research-only run (zero non-docs writes) must pass even
        with no .atlas/evidence/ and no verified findings.json entry -- (a)
        and (b) only apply once this run has shipped non-docs code. Docs
        (c)/(d)/(e)/(h) are still required and satisfied here."""
        docs = os.path.join(self.tmp, "docs")
        for name in ("CHANGELOG.md", "ROADMAP.md"):
            with open(os.path.join(docs, name), "w") as f:
                f.write("# %s\ncontent\n" % name)
        with open(os.path.join(self.tmp, "README.md"), "w") as f:
            f.write("# project\n")
        # Deliberately no .atlas/evidence/ and no findings.json.
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertNotIn('"decision": "block"', r.stdout)
        self.assertEqual(r.stdout.strip(), "")

    def test_code_shipped_still_blocks_on_missing_evidence_condition_a(self):
        """A run that DID ship non-docs code still blocks on missing (a)
        evidence, exactly as before the defect-1 scoping fix."""
        self._satisfy_all_conditions()
        shutil.rmtree(os.path.join(self.tmp, ".atlas", "evidence"))
        app_py = os.path.join(self.tmp, "app.py")
        with open(app_py, "w") as f:
            f.write("print('x')\n")
        self._log_run_write(app_py)
        docs_md = os.path.join(self.tmp, "docs", "CHANGELOG.md")
        with open(docs_md, "a") as f:
            f.write("- change\n")
        self._log_run_write(docs_md)  # clear (f) drift so only (a) blocks
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn('"decision": "block"', r.stdout)
        self.assertIn("evidence/", r.stdout)

    def test_code_shipped_still_blocks_on_missing_findings_condition_b(self):
        """A run that DID ship non-docs code still blocks on missing (b)
        verified findings, exactly as before the defect-1 scoping fix."""
        self._satisfy_all_conditions()
        os.remove(os.path.join(self.tmp, ".atlas", ".run", "findings.json"))
        app_py = os.path.join(self.tmp, "app.py")
        with open(app_py, "w") as f:
            f.write("print('x')\n")
        self._log_run_write(app_py)
        docs_md = os.path.join(self.tmp, "docs", "CHANGELOG.md")
        with open(docs_md, "a") as f:
            f.write("- change\n")
        self._log_run_write(docs_md)  # clear (f) drift so only (b) blocks
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn('"decision": "block"', r.stdout)
        self.assertIn("findings.json", r.stdout)

    def _commit_and_make_mixed_diff(self):
        """Satisfy (a)-(f): a non-docs code change AND a docs touch, both
        recorded as THIS run's own writes via the atlas_db signal, so drift
        is cleared (f passes) but code did change this run (g is live)."""
        self._satisfy_all_conditions()
        # non-docs code change -> code_changed True
        app_py = os.path.join(self.tmp, "app.py")
        with open(app_py, "w") as f:
            f.write("print('x')\n")
        self._log_run_write(app_py)
        # docs change -> drift cleared, so (f) passes and only (g) can block
        docs_md = os.path.join(self.tmp, "docs", "CHANGELOG.md")
        with open(docs_md, "a") as f:
            f.write("- change\n")
        self._log_run_write(docs_md)

    def _log_dispatches(self, implementers, verifiers):
        """Record implementer/verifier dispatches on the orch session's run."""
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        c = atlas_db.connect(self.env["ATLAS_DB"])
        rid = atlas_db.current_run_id(c, "sess-orch") or atlas_db.latest_run_id(
            c, "sess-orch"
        )
        for _ in range(implementers):
            atlas_db.log_dispatch(c, rid, "atlas:implementer")
        for _ in range(verifiers):
            atlas_db.log_dispatch(c, rid, "atlas:verifier")
        c.commit()
        c.close()

    def _log_general_purpose_dispatches(self, count):
        """Record general-purpose (code-shipping) dispatches on the orch run."""
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        c = atlas_db.connect(self.env["ATLAS_DB"])
        rid = atlas_db.current_run_id(c, "sess-orch") or atlas_db.latest_run_id(
            c, "sess-orch"
        )
        for _ in range(count):
            atlas_db.log_dispatch(c, rid, "general-purpose")
        c.commit()
        c.close()

    def test_unpaired_implementer_dispatches_blocks_with_condition_g(self):
        """2 implementers + 0 verifiers, code changed, (a)-(f) met -> (g) blocks."""
        self._commit_and_make_mixed_diff()
        self._log_dispatches(implementers=2, verifiers=0)
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn('"decision": "block"', r.stdout)
        self.assertIn("verification coverage", r.stdout)
        self.assertIn("atlas:verifier", r.stdout)
        self.assertIn("2 implementer", r.stdout)

    def test_general_purpose_shipping_without_verifier_blocks_condition_g(self):
        """2 general-purpose (code-shipping) + 0 verifiers, code changed, (a)-(f)
        met -> (g) blocks. general-purpose ships code; an orchestrator must not
        escape the Law 5 gate by dispatching general-purpose instead of
        atlas:implementer."""
        self._commit_and_make_mixed_diff()
        self._log_general_purpose_dispatches(2)
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn('"decision": "block"', r.stdout)
        self.assertIn("verification coverage", r.stdout)
        self.assertIn("atlas:verifier", r.stdout)
        self.assertIn("2 implementer", r.stdout)

    def test_paired_verifier_dispatches_do_not_block(self):
        """2 implementers + 2 verifiers -> unpaired count 0 -> no (g) block."""
        self._commit_and_make_mixed_diff()
        self._log_dispatches(implementers=2, verifiers=2)
        _seed_report_notes(self.tmp)
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertEqual(r.returncode, 0)
        self.assertNotIn('"decision": "block"', r.stdout)

    def test_no_implementer_dispatches_do_not_block(self):
        """0 implementers -> unpaired count 0 -> no (g) block."""
        self._commit_and_make_mixed_diff()
        self._log_dispatches(implementers=0, verifiers=0)
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertEqual(r.returncode, 0)
        self.assertNotIn('"decision": "block"', r.stdout)

    def test_implementer_dispatch_with_no_diff_does_not_block_condition_g(self):
        """(d) (g) does NOT fire for an implementer dispatch that produced no
        diff: dispatched but still running (or shipped nothing) means
        run_written_paths is empty, so code_changed is False and (g) is
        never evaluated -- it must not be conflated with 'unverified'."""
        self._satisfy_all_conditions()  # (a)-(e)/(h) satisfied, no writes logged
        self._log_dispatches(implementers=1, verifiers=0)
        # Two atlas workers (the fixture's explorer + this implementer): the (p)
        # colony channel needs one worker handoff note to count as used.
        _seed_report_notes(self.tmp, ("worker-a",))
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertEqual(r.returncode, 0)
        self.assertNotIn('"decision": "block"', r.stdout)


class GateBlockSnippetTest(unittest.TestCase):
    """friction_events.snippet for a gate block used to be the bare letters
    ("conditions: m", "conditions: c,d,e"), which names no rule. It must keep the
    stable `conditions: <letters>` lead and add the human-readable reasons."""

    def test_single_condition_is_named(self):
        self.assertEqual(
            completion_gate._gate_block_snippet(["m"]),
            "conditions: m (delegation mandate)",
        )

    def test_multiple_conditions_keep_the_letters_and_all_names(self):
        snip = completion_gate._gate_block_snippet(["c", "d", "e"])
        self.assertTrue(snip.startswith("conditions: c,d,e "))
        self.assertIn("CHANGELOG missing", snip)
        self.assertIn("ROADMAP missing", snip)
        self.assertIn("README missing", snip)
        self.assertFalse(snip.endswith(" "))

    def test_unknown_letter_is_kept_not_dropped(self):
        self.assertEqual(
            completion_gate._gate_block_snippet(["z"]), "conditions: z (z)"
        )

    def test_every_letter_the_gate_can_emit_has_a_name(self):
        """main() builds `failed` from letters a..p; each must be named or a new
        condition silently regresses to an unreadable bare letter."""
        for letter in "abcdefghijklmnop":
            self.assertIn(letter, completion_gate._CONDITION_NAMES, letter)

    def test_record_gate_block_stores_the_named_snippet(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        db = os.path.join(tmp, "atlas.db")
        # The hook writes into an existing DB (the session's own init created it),
        # so seed the schema the way a real session would have.
        conn = atlas_db.connect(db)
        self.addCleanup(conn.close)
        atlas_db.init(conn)
        with mock.patch.dict(os.environ, {"ATLAS_DB": db}):
            completion_gate._record_gate_block("sess-snip", ["c", "d", "e"])
        row = conn.execute(
            "SELECT category, snippet FROM friction_events WHERE session_id=?",
            ("sess-snip",),
        ).fetchone()
        self.assertEqual(row[0], "gate_block")
        self.assertEqual(
            row[1],
            "conditions: c,d,e (CHANGELOG missing, ROADMAP missing, README missing)",
        )


class ConditionGHelperTest(unittest.TestCase):
    def test_nondocs_changed_true_for_code_path(self):
        self.assertTrue(_nondocs_changed(["src/foo.py", "docs/CHANGELOG.md"]))

    def test_nondocs_changed_false_for_docs_only(self):
        self.assertFalse(_nondocs_changed(["docs/CHANGELOG.md", "a/docs/b.md"]))

    def test_nondocs_changed_false_for_empty(self):
        self.assertFalse(_nondocs_changed([]))

    def test_nondocs_changed_ignores_uri_paths(self):
        """agent:// / xd:// are not files: they are never shipped code."""
        self.assertFalse(_nondocs_changed(["agent://Foo", "xd://x", "proc://j/kill"]))
        self.assertFalse(_nondocs_changed(["docs/CHANGELOG.md", "agent://Foo"]))
        self.assertTrue(_nondocs_changed(["agent://Foo", "src/foo.py"]))
        # A Windows drive path is a file, not a URI.
        self.assertTrue(_nondocs_changed(["C:\\repo\\src\\app.py"]))

    def test_unpaired_fails_open_to_zero_on_db_error(self):
        """atlas_db unavailable (DB path unopenable) -> helper returns 0, no crash."""
        blocker = tempfile.NamedTemporaryFile(delete=False)
        blocker.write(b"x")
        blocker.close()
        old = os.environ.get("ATLAS_DB")
        # A path *under* a regular file: connect()'s makedirs raises -> fail-open.
        os.environ["ATLAS_DB"] = os.path.join(blocker.name, "atlas.db")
        try:
            self.assertEqual(_unpaired_implementer_dispatches("sess-orch"), 0)
        finally:
            if old is None:
                os.environ.pop("ATLAS_DB", None)
            else:
                os.environ["ATLAS_DB"] = old
            os.unlink(blocker.name)

    def test_unpaired_returns_zero_when_no_run_exists(self):
        """A session with no observability run in the DB -> helper returns 0
        at the `if rid is None` guard, NOT the DB-error except branch. This
        documents that condition (g) (Law 5 verifier coverage) is NOT enforced
        when a session never started a run: the gate cannot detect unpaired
        dispatches for a run that does not exist, so it silently passes and a
        session that never opened an observability run ships code with zero
        verifier coverage undetected."""
        tmp = tempfile.mkdtemp()
        db_path = os.path.join(tmp, "atlas.db")
        old = os.environ.get("ATLAS_DB")
        os.environ["ATLAS_DB"] = db_path
        try:
            # Initialize schema so `runs` exists and the run-id queries reach the
            # `rid is None` guard rather than raising on a missing table.
            conn = atlas_db.connect()
            try:
                atlas_db.init(conn)
            finally:
                conn.close()
            # No run row was inserted for "sess-no-run", so both
            # current_run_id and latest_run_id return None.
            self.assertEqual(_unpaired_implementer_dispatches("sess-no-run"), 0)
        finally:
            if old is None:
                os.environ.pop("ATLAS_DB", None)
            else:
                os.environ["ATLAS_DB"] = old
            shutil.rmtree(tmp, ignore_errors=True)


class CheckFindingsMalformedTest(unittest.TestCase):
    def test_malformed_findings_does_not_pass_condition_b(self):
        """A structurally malformed findings.json (non-list, non-dict top-level
        value with no "findings" key) must NOT count as a verified entry.
        _check_findings must return False so condition (b) fails rather than
        silently passing as if a verified entry existed."""
        tmp = tempfile.mkdtemp()
        root = Path(tmp)
        run_dir = root / ".atlas" / ".run"
        run_dir.mkdir(parents=True, exist_ok=True)
        # Top-level JSON string: not a list, and has no "findings" key. Calling
        # .get() on a str raises AttributeError, which the buggy code swallowed
        # to return True (silently passing condition b). It must return False.
        (run_dir / "findings.json").write_text('"not-a-findings-file"')
        self.assertFalse(_check_findings(root))


# ---------------------------------------------------------------------------
# In-process main() tests -- these import completion_gate and invoke main()
# directly with mocked sys.stdin / os.environ so the real code paths are
# traced for coverage (subprocess tests run in a separate process and
# contribute nothing to the coverage of completion_gate.py).
# ---------------------------------------------------------------------------


def _git_env():
    return dict(
        os.environ,
        GIT_AUTHOR_NAME="t",
        GIT_AUTHOR_EMAIL="t@t",
        GIT_COMMITTER_NAME="t",
        GIT_COMMITTER_EMAIL="t@t",
    )


class InProcessMainTest(unittest.TestCase):
    """Drive completion_gate.main() in-process across each of the 7 conditions,
    the git-error fail-closed path, malformed findings, the non-orchestrating
    no-op, ATLAS_GATE=off, and the stop_hook_active loop guard."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.tmp, "docs"), exist_ok=True)
        self.db_path = os.path.join(self.tmp, "atlas.db")
        self.env = dict(
            os.environ,
            ATLAS_DB=self.db_path,
            ATLAS_HOOKSTATE_DIR=os.path.join(self.tmp, "hookstate"),
        )
        c = atlas_db.connect(self.db_path)
        atlas_db.init(c)
        pid = atlas_db.register_project(c, self.tmp)
        atlas_db.start_run(c, pid, "sess-chat")  # non-orchestration
        atlas_db.start_run(c, pid, "sess-orch")
        atlas_db.mark_orchestrating(c, "sess-orch")
        c.close()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    # -- invocation harness -------------------------------------------------

    def _invoke(self, payload, env_extra=None, scrub_path=False):
        env = dict(self.env)
        if env_extra:
            env.update(env_extra)
        if scrub_path:
            env["PATH"] = ""
        stdin_data = io.StringIO(json.dumps(payload))
        stdout_buf = io.StringIO()
        with (
            mock.patch("sys.stdin", new=stdin_data),
            mock.patch("sys.stdout", new=stdout_buf),
            mock.patch.dict(os.environ, env, clear=True),
        ):
            rc = completion_gate.main()
        return rc, stdout_buf.getvalue()

    def _satisfy_all(self):
        docs = os.path.join(self.tmp, "docs")
        atlas_dir = os.path.join(self.tmp, ".atlas")
        os.makedirs(os.path.join(atlas_dir, "evidence"), exist_ok=True)
        os.makedirs(os.path.join(atlas_dir, ".run"), exist_ok=True)
        with open(os.path.join(atlas_dir, "evidence", "run.txt"), "w") as f:
            f.write("observed output")
        with open(os.path.join(atlas_dir, ".run", "findings.json"), "w") as f:
            json.dump(
                [
                    {
                        "claim": "x works",
                        "status": "verified",
                        "verified_at": datetime.now(timezone.utc).isoformat(),
                    }
                ],
                f,
            )
        for name in ("CHANGELOG.md", "ROADMAP.md"):
            with open(os.path.join(docs, name), "w") as f:
                f.write("# %s\ncontent\n" % name)
        with open(os.path.join(self.tmp, "README.md"), "w") as f:
            f.write("# project\n")
        _seed_plan(self.tmp)
        _seed_dispatch(self.env["ATLAS_DB"])

    def _init_git_repo(self):
        subprocess.run(["git", "init", "-q", self.tmp], check=True, capture_output=True)
        # Observability DB lives outside the project repo in production; exclude it
        # so conn.close() checkpointing WAL into atlas.db does not register as drift.
        with open(os.path.join(self.tmp, ".gitignore"), "w") as f:
            f.write("atlas.db*\n")
        subprocess.run(
            ["git", "-C", self.tmp, "add", "-A"], check=True, capture_output=True
        )
        subprocess.run(
            ["git", "-C", self.tmp, "commit", "-qm", "base"],
            check=True,
            capture_output=True,
            env=_git_env(),
        )

    def _log_run_write(self, path):
        """Simulate this run's own activity writing `path` (what
        dispatch_tripwire/session_ingest would have recorded for a real run).
        (f)/(g) are scoped to this signal, not the whole working tree."""
        c = atlas_db.connect(self.db_path)
        rid = atlas_db.current_run_id(c, "sess-orch") or atlas_db.latest_run_id(
            c, "sess-orch"
        )
        atlas_db.log_event(c, rid, "Write", "main", 1, path)
        c.commit()
        c.close()

    def _stage_code_change(self):
        """Write app.py to disk AND record it as this run's own write."""
        app_py = os.path.join(self.tmp, "app.py")
        with open(app_py, "w") as f:
            f.write("print('x')\n")
        subprocess.run(
            ["git", "-C", self.tmp, "add", "app.py"], check=True, capture_output=True
        )
        self._log_run_write(app_py)

    def _stage_mixed_diff(self):
        self._stage_code_change()
        docs_md = os.path.join(self.tmp, "docs", "CHANGELOG.md")
        with open(docs_md, "a") as f:
            f.write("- change\n")
        self._log_run_write(docs_md)

    def _log_dispatches(self, implementers, verifiers):
        c = atlas_db.connect(self.db_path)
        rid = atlas_db.current_run_id(c, "sess-orch") or atlas_db.latest_run_id(
            c, "sess-orch"
        )
        assert rid is not None
        for _ in range(implementers):
            atlas_db.log_dispatch(c, rid, "atlas:implementer")
        for _ in range(verifiers):
            atlas_db.log_dispatch(c, rid, "atlas:verifier")
        c.commit()
        c.close()

    def _run_start_epoch(self):
        c = atlas_db.connect(self.db_path)
        rid = atlas_db.current_run_id(c, "sess-orch") or atlas_db.latest_run_id(
            c, "sess-orch"
        )
        started = atlas_db.run_started_at(c, rid)
        c.close()
        assert started is not None
        return started

    # -- early-exit / no-op paths -------------------------------------------

    def test_malformed_stdin_returns_zero(self):
        rc = self._invoke_raw("not-json")
        self.assertEqual(rc, 0)

    def _invoke_raw(self, raw_stdin, env_extra=None):
        env = dict(self.env)
        if env_extra:
            env.update(env_extra)
        stdin_data = io.StringIO(raw_stdin)
        stdout_buf = io.StringIO()
        with (
            mock.patch("sys.stdin", new=stdin_data),
            mock.patch("sys.stdout", new=stdout_buf),
            mock.patch.dict(os.environ, env, clear=True),
        ):
            rc = completion_gate.main()
        return rc

    def test_non_dict_stdin_treated_as_empty(self):
        # Top-level JSON list -> not a dict -> treated as {} -> no SSOT (cwd tmp
        # has docs/ but session_id empty -> non-orchestrating -> no-op).
        rc, _ = self._invoke(["not", "a", "dict"])
        self.assertEqual(rc, 0)

    def test_atlas_gate_off_short_circuits(self):
        self._satisfy_all()
        rc, out = self._invoke(
            {"session_id": "sess-orch", "cwd": self.tmp},
            env_extra={"ATLAS_GATE": "off"},
        )
        self.assertEqual(rc, 0)
        self.assertNotIn('"decision": "block"', out)

    def test_stop_hook_active_loop_guard(self):
        self._satisfy_all()
        rc, out = self._invoke(
            {
                "session_id": "sess-orch",
                "cwd": self.tmp,
                "stop_hook_active": True,
            }
        )
        self.assertEqual(rc, 0)
        self.assertNotIn('"decision": "block"', out)

    def test_non_orchestrating_session_is_noop(self):
        self._satisfy_all()
        rc, out = self._invoke({"session_id": "sess-chat", "cwd": self.tmp})
        self.assertEqual(rc, 0)
        self.assertNotIn('"decision": "block"', out)

    def test_no_ssot_is_noop(self):
        shutil.rmtree(os.path.join(self.tmp, "docs"))
        rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertEqual(rc, 0)
        self.assertNotIn('"decision": "block"', out)

    # -- all-pass + each failing condition (a)-(e) --------------------------

    def test_all_conditions_pass_without_git_repo(self):
        self._satisfy_all()
        # No git repo and no run-write logged -> run_written_paths returns [],
        # code_changed=False -> (a)/(b)/(f)/(g) skipped -> all pass silently.
        rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertEqual(rc, 0)
        self.assertNotIn('"decision": "block"', out)
        self.assertEqual(out.strip(), "")

    def test_all_conditions_pass_with_git_repo_clean(self):
        self._satisfy_all()
        self._init_git_repo()
        rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertEqual(rc, 0)
        self.assertNotIn('"decision": "block"', out)

    def test_missing_evidence_condition_a(self):
        """(a) only applies once this run shipped non-docs code; stage a
        mixed diff (code + docs) so (f)/(g) stay clear and only (a) blocks."""
        self._satisfy_all()
        shutil.rmtree(os.path.join(self.tmp, ".atlas", "evidence"))
        self._init_git_repo()
        self._stage_mixed_diff()
        rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertEqual(rc, 0)  # block returns 0
        self.assertIn('"decision": "block"', out)
        self.assertIn("evidence/", out)

    def test_missing_evidence_skipped_when_no_code_shipped(self):
        """DEFECT 1: with zero non-docs writes this run, missing (a) evidence
        must NOT block -- there is nothing to have captured evidence of."""
        self._satisfy_all()
        shutil.rmtree(os.path.join(self.tmp, ".atlas", "evidence"))
        rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertEqual(rc, 0)
        self.assertNotIn('"decision": "block"', out)
        self.assertEqual(out.strip(), "")

    def test_missing_findings_condition_b(self):
        self._satisfy_all()
        os.remove(os.path.join(self.tmp, ".atlas", ".run", "findings.json"))
        self._init_git_repo()
        self._stage_mixed_diff()
        _, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertIn('"decision": "block"', out)
        self.assertIn("findings.json", out)

    def test_missing_findings_skipped_when_no_code_shipped(self):
        """DEFECT 1: with zero non-docs writes this run, a missing/absent
        verified finding must NOT block -- nothing was shipped to verify."""
        self._satisfy_all()
        os.remove(os.path.join(self.tmp, ".atlas", ".run", "findings.json"))
        rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertEqual(rc, 0)
        self.assertNotIn('"decision": "block"', out)
        self.assertEqual(out.strip(), "")

    def test_malformed_findings_blocks_condition_b(self):
        """M1: structurally malformed findings.json must NOT count as verified,
        once this run has shipped non-docs code."""
        self._satisfy_all()
        with open(os.path.join(self.tmp, ".atlas", ".run", "findings.json"), "w") as f:
            f.write('"not-a-findings-file"')
        self._init_git_repo()
        self._stage_mixed_diff()
        _, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertIn('"decision": "block"', out)
        self.assertIn("findings.json", out)

    def test_stale_evidence_blocks_condition_a(self):
        """Evidence left over from an earlier session (mtime before this run
        started) must not satisfy (a) -- that is the spoofability the run
        scoping closes."""
        self._satisfy_all()
        self._init_git_repo()
        self._stage_mixed_diff()
        started = self._run_start_epoch()
        evidence_file = os.path.join(self.tmp, ".atlas", "evidence", "run.txt")
        stale = started - 3600
        os.utime(evidence_file, (stale, stale))
        _, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertIn('"decision": "block"', out)
        self.assertIn("evidence/", out)

    def test_fresh_evidence_passes_condition_a(self):
        """Evidence written during this run (mtime at/after run start) passes."""
        self._satisfy_all()
        self._init_git_repo()
        self._stage_mixed_diff()
        started = self._run_start_epoch()
        evidence_file = os.path.join(self.tmp, ".atlas", "evidence", "run.txt")
        fresh = started + 5
        os.utime(evidence_file, (fresh, fresh))
        rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertEqual(rc, 0)
        self.assertNotIn('"decision": "block"', out)

    def test_evidence_started_none_falls_back_to_any_file(self):
        """When this run's start time cannot be determined, (a) falls back
        (documented, fail-open) to 'any file exists' rather than blocking."""
        self._satisfy_all()
        self._init_git_repo()
        self._stage_mixed_diff()
        evidence_file = os.path.join(self.tmp, ".atlas", "evidence", "run.txt")
        os.utime(evidence_file, (1, 1))  # ancient mtime
        with mock.patch("completion_gate._run_started_at", return_value=None):
            rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertEqual(rc, 0)
        self.assertNotIn('"decision": "block"', out)

    def test_stale_verified_finding_blocks_condition_b(self):
        """A 'verified' row stamped before this run started must not satisfy
        (b) -- that is the spoofability the run scoping closes."""
        self._satisfy_all()
        self._init_git_repo()
        self._stage_mixed_diff()
        started = self._run_start_epoch()
        stale_iso = datetime.fromtimestamp(started - 3600, tz=timezone.utc).isoformat()
        findings_path = os.path.join(self.tmp, ".atlas", ".run", "findings.json")
        with open(findings_path, "w") as f:
            json.dump(
                [{"claim": "x works", "status": "verified", "verified_at": stale_iso}],
                f,
            )
        _, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertIn('"decision": "block"', out)
        self.assertIn("findings.json", out)

    def test_fresh_verified_finding_passes_condition_b(self):
        """A 'verified' row stamped during this run satisfies (b)."""
        self._satisfy_all()
        self._init_git_repo()
        self._stage_mixed_diff()
        started = self._run_start_epoch()
        fresh_iso = datetime.fromtimestamp(started + 5, tz=timezone.utc).isoformat()
        findings_path = os.path.join(self.tmp, ".atlas", ".run", "findings.json")
        with open(findings_path, "w") as f:
            json.dump(
                [{"claim": "x works", "status": "verified", "verified_at": fresh_iso}],
                f,
            )
        rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertEqual(rc, 0)
        self.assertNotIn('"decision": "block"', out)

    def test_undated_verified_finding_blocks_when_started_known_condition_b(self):
        """An undated 'verified' row cannot be proven to belong to this run,
        so once `started` is known it earns no credit -- same rule (g)
        already applies via _test_verified_this_run."""
        self._satisfy_all()
        self._init_git_repo()
        self._stage_mixed_diff()
        findings_path = os.path.join(self.tmp, ".atlas", ".run", "findings.json")
        with open(findings_path, "w") as f:
            json.dump([{"claim": "x works", "status": "verified"}], f)
        _, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertIn('"decision": "block"', out)
        self.assertIn("findings.json", out)

    def test_missing_changelog_condition_c(self):
        self._satisfy_all()
        os.remove(os.path.join(self.tmp, "docs", "CHANGELOG.md"))
        _, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertIn('"decision": "block"', out)
        self.assertIn("CHANGELOG.md is missing", out)

    def test_missing_roadmap_condition_d(self):
        self._satisfy_all()
        os.remove(os.path.join(self.tmp, "docs", "ROADMAP.md"))
        _, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertIn('"decision": "block"', out)
        self.assertIn("ROADMAP.md is missing", out)

    def test_missing_readme_condition_e(self):
        self._satisfy_all()
        os.remove(os.path.join(self.tmp, "README.md"))
        _, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertIn('"decision": "block"', out)
        self.assertIn("README.md at the project root is missing", out)

    # -- (f) docs drift + (g) verifier coverage + git fail-closed -----------

    def test_docs_drift_condition_f(self):
        self._satisfy_all()
        self._init_git_repo()
        self._stage_code_change()  # code only, no docs change -> drift
        _, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertIn('"decision": "block"', out)
        self.assertIn("Docs drift", out)

    def test_unpaired_implementer_condition_g(self):
        self._satisfy_all()
        self._init_git_repo()
        self._stage_mixed_diff()  # code + docs -> drift cleared, code changed
        self._log_dispatches(implementers=2, verifiers=0)
        _, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertIn('"decision": "block"', out)
        self.assertIn("verification coverage", out)
        self.assertIn("2 implementer", out)

    def test_paired_verifier_no_block_condition_g(self):
        self._satisfy_all()
        self._init_git_repo()
        self._stage_mixed_diff()
        self._log_dispatches(implementers=2, verifiers=2)
        rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertEqual(rc, 0)
        self.assertNotIn('"decision": "block"', out)

    def test_db_read_error_fails_open_to_pass_silently(self):
        """(f)/(g) are scoped to the atlas_db run-write signal, not git -- git
        being unreachable is irrelevant to them now. What DOES matter is
        atlas_db's run-write query itself failing: that must fail open
        (run_written_paths -> [], same as 'wrote nothing') and pass silently,
        matching every other fail-open condition in this gate -- a pass never
        narrates, on the happy path or the fail-open path alike.
        `is_orchestrating`/`connect` must keep working (a real run exists and
        the gate must still evaluate it) -- only `run_changed_paths` errors,
        simulating a read failure isolated to that one query."""
        self._satisfy_all()
        self._init_git_repo()
        with mock.patch.object(
            atlas_db, "run_changed_paths", side_effect=Exception("db read error")
        ):
            _, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertNotIn('"decision": "block"', out)
        self.assertEqual(out.strip(), "")

    def test_implementer_dispatch_with_no_diff_does_not_block_condition_g(self):
        """(d) (g) does NOT fire for an implementer dispatch that produced no
        diff: dispatched but nothing written this run -> code_changed False
        -> (g) is never evaluated."""
        self._satisfy_all()
        self._log_dispatches(implementers=1, verifiers=0)
        rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertEqual(rc, 0)
        self.assertNotIn('"decision": "block"', out)

    def test_outer_catch_all_failopens_on_unexpected_crash(self):
        """GAP-3: an unexpected crash in the gate logic (e.g. _reason raising)
        must fail-open to rc=0 without emitting a block decision, and the
        swallowed error must surface on stderr so the silent allow-through is
        observable in hook logs rather than zero-observability."""
        self._satisfy_all()
        # Fail condition (a) so the gate reaches the block-decision path that
        # calls _reason; then make _reason raise to hit the outer catch-all.
        # (a) only applies once this run shipped non-docs code, so stage a
        # mixed diff (code + docs) to make it live.
        shutil.rmtree(os.path.join(self.tmp, ".atlas", "evidence"))
        self._init_git_repo()
        self._stage_mixed_diff()
        env = dict(self.env)
        stdin_data = io.StringIO(
            json.dumps({"session_id": "sess-orch", "cwd": self.tmp})
        )
        stdout_buf = io.StringIO()
        stderr_buf = io.StringIO()
        with (
            mock.patch("sys.stdin", new=stdin_data),
            mock.patch("sys.stdout", new=stdout_buf),
            mock.patch("sys.stderr", new=stderr_buf),
            mock.patch.dict(os.environ, env, clear=True),
            mock.patch(
                "completion_gate._reason", side_effect=RuntimeError("reasoner crashed")
            ),
        ):
            rc = completion_gate.main()
        self.assertEqual(rc, 0)  # fail-open: never wedge the session
        self.assertNotIn('"decision": "block"', stdout_buf.getvalue())
        self.assertIn("fail-open", stderr_buf.getvalue())
        self.assertIn("reasoner crashed", stderr_buf.getvalue())

    # -- _finalize_db / _session_is_orchestrating fail-open -----------------

    def test_finalize_db_best_effort_on_unopenable_db(self):
        """Point ATLAS_DB under a regular file so atlas_db.connect raises.
        _finalize_db must swallow (best-effort) and _session_is_orchestrating
        must fail-open to False -> no-op (never block on observability I/O)."""
        blocker = tempfile.NamedTemporaryFile(delete=False)
        blocker.write(b"x")
        blocker.close()
        bad_db = os.path.join(blocker.name, "atlas.db")
        try:
            rc, out = self._invoke(
                {"session_id": "sess-orch", "cwd": self.tmp},
                env_extra={"ATLAS_DB": bad_db},
            )
            self.assertEqual(rc, 0)
            self.assertNotIn('"decision": "block"', out)
        finally:
            os.unlink(blocker.name)


class HelperUnitTest(unittest.TestCase):
    """Direct unit coverage of the pure/IO helpers in completion_gate."""

    def test_find_root_finds_docs_dir(self):
        tmp = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(tmp, "docs"))
            nested = Path(tmp) / "a" / "b" / "c"
            nested.mkdir(parents=True)
            found = _find_root(nested)
            self.assertEqual(found, Path(tmp))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_find_root_returns_none_when_absent(self):
        tmp = tempfile.mkdtemp()
        try:
            self.assertIsNone(_find_root(Path(tmp)))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_check_evidence_oserror_failopen(self):
        tmp = tempfile.mkdtemp()
        try:
            root = Path(tmp)
            (root / ".atlas" / "evidence").mkdir(
                parents=True
            )  # evidence/ exists so is_dir() True
            with mock.patch.object(Path, "iterdir", side_effect=OSError):
                # (a) fails open on OSError
                from completion_gate import _check_evidence

                self.assertTrue(_check_evidence(root))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_check_nonempty_oserror_failopen(self):
        # is_file() must return True so stat() is reached and raises OSError.
        with (
            mock.patch.object(Path, "is_file", return_value=True),
            mock.patch.object(Path, "stat", side_effect=OSError),
        ):
            from completion_gate import _check_nonempty

            self.assertTrue(_check_nonempty(Path("/whatever/file.md")))

    def test_check_findings_oserror_failopen(self):
        tmp = tempfile.mkdtemp()
        try:
            root = Path(tmp)
            (root / ".atlas" / ".run").mkdir(parents=True)
            (root / ".atlas" / ".run" / "findings.json").write_text("[]")
            with mock.patch.object(Path, "read_text", side_effect=OSError):
                # OSError -> fail open -> True
                self.assertTrue(_check_findings(root))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_check_findings_dict_with_findings_key(self):
        tmp = tempfile.mkdtemp()
        try:
            root = Path(tmp)
            (root / ".atlas" / ".run").mkdir(parents=True)
            (root / ".atlas" / ".run" / "findings.json").write_text(
                json.dumps({"findings": [{"status": "verified"}]})
            )
            self.assertTrue(_check_findings(root))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_check_findings_no_verified_entry(self):
        tmp = tempfile.mkdtemp()
        try:
            root = Path(tmp)
            (root / ".atlas" / ".run").mkdir(parents=True)
            (root / ".atlas" / ".run" / "findings.json").write_text(
                json.dumps([{"status": "unverified"}])
            )
            self.assertFalse(_check_findings(root))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_git_changed_paths_non_repo_returns_empty(self):
        tmp = tempfile.mkdtemp()
        try:
            root = Path(tmp) / "sub"
            root.mkdir(parents=True)
            # Not a git repo -> rev-parse fails (non-FileNotFoundError) -> []
            self.assertEqual(_git_changed_paths(root), [])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_git_changed_paths_real_repo(self):
        tmp = tempfile.mkdtemp()
        try:
            subprocess.run(["git", "init", "-q", tmp], check=True, capture_output=True)
            docs = Path(tmp) / "docs"
            docs.mkdir(parents=True)
            (docs / "CHANGELOG.md").write_text("# c\n")
            subprocess.run(
                ["git", "-C", tmp, "add", "-A"], check=True, capture_output=True
            )
            subprocess.run(
                ["git", "-C", tmp, "commit", "-qm", "base"],
                check=True,
                capture_output=True,
                env=_git_env(),
            )
            # New staged change
            (Path(tmp) / "app.py").write_text("print('x')\n")
            subprocess.run(
                ["git", "-C", tmp, "add", "app.py"], check=True, capture_output=True
            )
            changed = _git_changed_paths(Path(tmp))
            self.assertIn("app.py", changed)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_reason_emits_every_condition(self):
        """Cover the full _reason formatter with every flag set."""
        msg = _reason(
            missing_a=True,
            missing_b=True,
            missing_c=True,
            missing_d=True,
            missing_e=True,
            drift=True,
            unverified=3,
            git_error="git exploded",
        )
        self.assertIn("(a)", msg)
        self.assertIn("(b)", msg)
        self.assertIn("(c)", msg)
        self.assertIn("(d)", msg)
        self.assertIn("(e)", msg)
        self.assertIn("Docs drift", msg)
        self.assertIn("verifier coverage", msg)
        self.assertIn("3 implementer", msg)
        self.assertIn("git exploded", msg)

    def test_reason_script_paths_are_absolute_and_exist(self):
        """Block texts name scripts by absolute path resolved hook-side. The
        literal $CLAUDE_PLUGIN_ROOT is only expanded by Claude Code's hook
        runner, never in a model-run shell, so it must not appear."""
        msg = _reason(
            missing_a=False,
            missing_b=True,
            missing_c=False,
            unverified=1,
            missing_plan=True,
            name_violations=[("docs/plans/x-2026-01-01.md", "trailing date")],
        )
        self.assertNotIn("CLAUDE_PLUGIN_ROOT", msg)
        scripts = Path(completion_gate.__file__).resolve().parent.parent / "scripts"
        for name in ("atlas_finding.py", "atlas_todo.py", "lint_docs_names.py"):
            path = str(scripts / name)
            self.assertTrue(os.path.isabs(path) and os.path.exists(path), path)
            self.assertIn(f'python3 "{path}"', msg)


def _todo_transcript(path, todos, name="TodoWrite"):
    """Write a minimal Claude Code transcript containing one TodoWrite tool_use."""
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps({"type": "user", "message": {"content": "go"}}) + "\n")
        fh.write(
            json.dumps(
                {
                    "type": "assistant",
                    "message": {
                        "content": [
                            {"type": "text", "text": "planning"},
                            {
                                "type": "tool_use",
                                "name": name,
                                "input": {"todos": todos},
                            },
                        ]
                    },
                }
            )
            + "\n"
        )
    return path


class OpenTodosTest(unittest.TestCase):
    """(i) reads the LAST TodoWrite call as current state, and fails open."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.t = os.path.join(self.tmp, "transcript.jsonl")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_no_transcript_path_is_zero(self):
        self.assertEqual(completion_gate._open_todos(""), 0)

    def test_missing_file_fails_open(self):
        self.assertEqual(
            completion_gate._open_todos(os.path.join(self.tmp, "nope.jsonl")), 0
        )

    def test_no_todowrite_call_is_zero(self):
        """No todo list at all passes: (i) enforces draining, not creating."""
        with open(self.t, "w", encoding="utf-8") as fh:
            fh.write(json.dumps({"type": "user", "message": {"content": "hi"}}) + "\n")
        self.assertEqual(completion_gate._open_todos(self.t), 0)

    def test_all_completed_is_zero(self):
        _todo_transcript(
            self.t,
            [
                {"content": "a", "status": "completed"},
                {"content": "b", "status": "completed"},
            ],
        )
        self.assertEqual(completion_gate._open_todos(self.t), 0)

    def test_open_items_are_counted(self):
        _todo_transcript(
            self.t,
            [
                {"content": "a", "status": "completed"},
                {"content": "b", "status": "in_progress"},
                {"content": "c", "status": "pending"},
            ],
        )
        self.assertEqual(completion_gate._open_todos(self.t), 2)

    def test_last_call_wins(self):
        """TodoWrite rewrites the whole list, so only the final call is state."""
        with open(self.t, "w", encoding="utf-8") as fh:
            for todos in (
                [{"content": "a", "status": "pending"}],
                [{"content": "a", "status": "completed"}],
            ):
                fh.write(
                    json.dumps(
                        {
                            "type": "assistant",
                            "message": {
                                "content": [
                                    {
                                        "type": "tool_use",
                                        "name": "TodoWrite",
                                        "input": {"todos": todos},
                                    }
                                ]
                            },
                        }
                    )
                    + "\n"
                )
        self.assertEqual(completion_gate._open_todos(self.t), 0)

    def test_other_tool_named_in_line_is_ignored(self):
        """An allowedTools listing mentioning TodoWrite is not a TodoWrite call."""
        with open(self.t, "w", encoding="utf-8") as fh:
            fh.write(json.dumps({"tools": ["Read", "TodoWrite"], "message": {}}) + "\n")
        self.assertEqual(completion_gate._open_todos(self.t), 0)

    def test_malformed_json_line_is_skipped(self):
        with open(self.t, "w", encoding="utf-8") as fh:
            fh.write('{"TodoWrite" broken json\n')
        self.assertEqual(completion_gate._open_todos(self.t), 0)


class LeftoverWorktreeTest(unittest.TestCase):
    """(j) reports only the extra trees, and only for a real repo."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_non_repo_returns_empty(self):
        self.assertEqual(completion_gate._leftover_worktrees(Path(self.tmp)), [])

    def test_main_tree_alone_is_not_leftover(self):
        out = b"worktree /repo\nHEAD abc\nbranch refs/heads/main\n\n"
        with mock.patch("subprocess.check_output", return_value=out):
            self.assertEqual(completion_gate._leftover_worktrees(Path(self.tmp)), [])

    def test_extra_trees_are_reported(self):
        out = (
            b"worktree /repo\nHEAD abc\nbranch refs/heads/main\n\n"
            b"worktree /tmp/wt-1\nHEAD def\nbranch refs/heads/feat\n\n"
        )
        with mock.patch("subprocess.check_output", return_value=out):
            self.assertEqual(
                completion_gate._leftover_worktrees(Path(self.tmp)), ["/tmp/wt-1"]
            )


class GateConditionIJTest(GateOrchestrationTest):
    """End-to-end: (i) and (j) block Stop, and only when this run earned them."""

    def _satisfy_everything_else(self):
        """Make (a)-(h) pass so a block can only come from (i)/(j)."""
        os.makedirs(os.path.join(self.tmp, ".atlas", "evidence"), exist_ok=True)
        with open(os.path.join(self.tmp, ".atlas", "evidence", "e.md"), "w") as fh:
            fh.write("red->green")
        os.makedirs(os.path.join(self.tmp, ".atlas", ".run"), exist_ok=True)
        with open(os.path.join(self.tmp, ".atlas", ".run", "findings.json"), "w") as fh:
            json.dump(
                [
                    {
                        "id": "S1",
                        "status": "verified",
                        "verified_at": datetime.now(timezone.utc).isoformat(),
                    }
                ],
                fh,
            )
        for name in ("CHANGELOG.md", "ROADMAP.md"):
            with open(os.path.join(self.tmp, "docs", name), "w") as fh:
                fh.write("# %s\ncontent\n" % name)
        with open(os.path.join(self.tmp, "README.md"), "w") as fh:
            fh.write("# readme\n")
        # A docs write in the same run clears (f).
        self._log_run_write("docs/CHANGELOG.md")
        self._log_run_write("src/app.py")
        _seed_plan(self.tmp)
        _seed_dispatch(self.env["ATLAS_DB"])

    def test_open_todos_block_the_stop(self):
        self._satisfy_everything_else()
        t = _todo_transcript(
            os.path.join(self.tmp, "t.jsonl"),
            [{"content": "ship it", "status": "in_progress"}],
        )
        r = _run_gate(
            {"session_id": "sess-orch", "cwd": self.tmp, "transcript_path": t}, self.env
        )
        self.assertIn('"decision": "block"', r.stdout)
        self.assertIn("(i) Todo list not drained", r.stdout)

    def test_drained_todos_do_not_block(self):
        self._satisfy_everything_else()
        t = _todo_transcript(
            os.path.join(self.tmp, "t.jsonl"),
            [{"content": "ship it", "status": "completed"}],
        )
        r = _run_gate(
            {"session_id": "sess-orch", "cwd": self.tmp, "transcript_path": t}, self.env
        )
        self.assertNotIn('"decision": "block"', r.stdout)

    def test_worktrees_only_block_when_this_run_used_one(self):
        """A user's own worktree must never trip the gate."""
        self._satisfy_everything_else()
        with mock.patch.object(
            completion_gate, "_leftover_worktrees", return_value=["/tmp/wt-1"]
        ):
            self.assertFalse(
                completion_gate._run_used_worktrees("sess-orch"),
                "no isolated dispatch was recorded, so the flag must be off",
            )

    def test_recorded_worktree_dispatch_blocks_on_leftovers(self):
        self._satisfy_everything_else()
        c = atlas_db.connect(self.env["ATLAS_DB"])
        atlas_db.mark_used_worktrees(c, "sess-orch")
        c.close()
        out = (
            b"worktree /repo\nHEAD abc\n\n"
            b"worktree /tmp/wt-1\nHEAD def\nbranch refs/heads/feat\n\n"
        )
        with mock.patch("subprocess.check_output", return_value=out):
            reason = _reason(
                False, False, False, False, False, False, 0, "", False, 0, ["/tmp/wt-1"]
            )
        self.assertIn("(j) 1 git worktree(s) from this run are still on disk", reason)
        self.assertIn("git worktree remove", reason)
        self.assertIn("never run it unasked", reason)


class DocsMovedInGitTest(unittest.TestCase):
    """(f)'s cross-check: git-visible docs movement suppresses a false block.

    The tool-call signal is blind to a docs file written by a Bash-invoked
    script, which blocked two genuinely-docs-current runs while shipping 5.14.0.
    """

    def test_docs_path_in_git_diff_suppresses(self):
        with mock.patch.object(
            completion_gate, "_git_changed_paths", return_value=["docs/CHANGELOG.md"]
        ):
            self.assertTrue(completion_gate._docs_moved_in_git(Path("/x")))

    def test_nested_docs_path_counts(self):
        with mock.patch.object(
            completion_gate,
            "_git_changed_paths",
            return_value=["plugins/atlas/docs/x.md"],
        ):
            self.assertTrue(completion_gate._docs_moved_in_git(Path("/x")))

    def test_code_only_diff_does_not_suppress(self):
        with mock.patch.object(
            completion_gate, "_git_changed_paths", return_value=["src/app.py"]
        ):
            self.assertFalse(completion_gate._docs_moved_in_git(Path("/x")))

    def test_git_failure_does_not_suppress(self):
        """One-directional: the cross-check can only prevent a false block."""
        with mock.patch.object(
            completion_gate, "_git_changed_paths", side_effect=RuntimeError("no git")
        ):
            self.assertFalse(completion_gate._docs_moved_in_git(Path("/x")))


class ShellEditDelegationTest(unittest.TestCase):
    """(m) also sees code written through the shell (sed -i, tee, ...): non-docs
    paths dirty now but absent/changed vs the SessionStart snapshot."""

    SESSION = "shell-edit"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(os.path.realpath(self.tmp.name))
        self.git("init", "-q")
        self.git("config", "user.email", "t@example.com")
        self.git("config", "user.name", "t")
        self.put("src/calc.py", "def add(a, b):\n    return a - b\n")
        self.put("docs/guide.md", "# guide\n")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "init")
        # Gate state lives OUTSIDE the repo so it never shows up as dirty code.
        self.state = tempfile.TemporaryDirectory()
        self.addCleanup(self.state.cleanup)
        state = Path(self.state.name)
        self.env = dict(
            os.environ,
            ATLAS_DB=str(state / "atlas.db"),
            ATLAS_HOOKSTATE_DIR=str(state / "hookstate"),
        )
        self.conn = atlas_db.connect(self.env["ATLAS_DB"])
        self.addCleanup(self.conn.close)
        atlas_db.init(self.conn)
        pid = atlas_db.register_project(self.conn, str(self.root))
        self.rid = atlas_db.start_run(self.conn, pid, self.SESSION)

    def git(self, *args):
        subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True)

    def put(self, rel, body):
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body)

    def snapshot(self):
        import session_boot

        return session_boot.write_dirty_snapshot(str(self.root), self.SESSION)

    def gate(self, **extra):
        return _run_gate(
            dict(session_id=self.SESSION, cwd=str(self.root), **extra), self.env
        ).stdout

    def test_shell_edit_after_snapshot_blocks_and_dispatch_clears_it(self):
        self.snapshot()
        subprocess.run(
            ["sed", "-i.bak", "s/a - b/a + b/", str(self.root / "src/calc.py")],
            check=True,
        )
        (self.root / "src/calc.py.bak").unlink()
        self.assertIn("(m) Delegation mandate", self.gate())
        atlas_db.log_event(self.conn, self.rid, "Task", "main", 0)
        self.assertEqual(self.gate(), "")

    def test_new_untracked_code_after_snapshot_blocks(self):
        self.snapshot()
        self.put("src/extra.py", "x = 1\n")
        self.assertIn("(m) Delegation mandate", self.gate())

    def test_pre_dirty_file_left_untouched_is_not_counted(self):
        self.put("src/calc.py", "def add(a, b):\n    return a + b  # dirty at start\n")
        self.put("src/wip.py", "x = 1\n")
        self.snapshot()
        self.assertEqual(self.gate(), "")

    def test_pre_dirty_file_edited_again_is_counted(self):
        self.put("src/wip.py", "x = 1\n")
        self.snapshot()
        self.put("src/wip.py", "x = 2\n")
        self.assertIn("(m) Delegation mandate", self.gate())

    def test_docs_markdown_and_atlas_changes_are_not_counted(self):
        self.snapshot()
        self.put("docs/guide.md", "# changed\n")
        self.put("docs/notes.txt", "n\n")
        self.put("README.md", "r\n")
        self.put("sub/.atlas/state.json", "{}\n")
        self.assertEqual(self.gate(), "")

    def test_mdx_is_code(self):
        self.snapshot()
        self.put("notes.mdx", "m\n")
        self.assertIn("(m) Delegation mandate", self.gate())

    def test_no_snapshot_fails_open(self):
        self.put("src/calc.py", "def add(a, b):\n    return a + b\n")
        self.assertEqual(self.gate(), "")

    def test_corrupt_snapshot_fails_open(self):
        self.snapshot()
        snap = self.root / ".atlas" / ".run" / ("dirty-snapshot-%s.json" % self.SESSION)
        snap.write_text("{not json")
        self.put("src/calc.py", "def add(a, b):\n    return a + b\n")
        self.assertEqual(self.gate(), "")

    def test_non_git_project_fails_open(self):
        with tempfile.TemporaryDirectory() as plain:
            plain = Path(os.path.realpath(plain))
            (plain / "docs").mkdir()
            run = plain / ".atlas" / ".run"
            run.mkdir(parents=True)
            (run / ("dirty-snapshot-%s.json" % self.SESSION)).write_text(
                json.dumps({"paths": {}})
            )
            (plain / "app.py").write_text("x = 1\n")
            pid = atlas_db.register_project(self.conn, str(plain))
            atlas_db.start_run(self.conn, pid, "plain-sess")
            out = _run_gate(
                dict(session_id=self.SESSION, cwd=str(plain)), self.env
            ).stdout
            self.assertEqual(out, "")

    def test_subagent_transcript_stays_exempt(self):
        self.snapshot()
        self.put("src/extra.py", "x = 1\n")
        self.assertEqual(
            self.gate(transcript_path="/session/subagents/agent-a.jsonl"), ""
        )


if __name__ == "__main__":
    unittest.main()


class TestRunPairsAnImplementerTest(GateOrchestrationTest):
    """Law 5 used to accept only an atlas:verifier DISPATCH as pairing, which
    forced a second subagent onto every task no matter how small. Atlas's own
    doctrine is that a deterministic test beats a verifier agent. A `verified`
    findings.json entry stamped DURING this run now pairs an implementer exactly
    like a dispatch -- and one stamped before the run still does not."""

    def _write_findings(self, entries):
        path = os.path.join(self.tmp, ".atlas", ".run", "findings.json")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(entries, f)

    def _stamp(self, offset_seconds):
        """ISO-8601 UTC stamp offset from the run's start."""
        import datetime as _dt

        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        c = atlas_db.connect(self.env["ATLAS_DB"])
        rid = atlas_db.current_run_id(c, "sess-orch") or atlas_db.latest_run_id(
            c, "sess-orch"
        )
        started = atlas_db.run_started_at(c, rid)
        c.close()
        return _dt.datetime.fromtimestamp(
            started + offset_seconds, _dt.timezone.utc
        ).isoformat(timespec="seconds")

    def _exec_test_command(self):
        """Log a test-runner bash call inside the run window. A `verified`
        stamp only earns (g) credit when the run actually executed a test
        (self-attestation without an executed test is the hole that collapsed
        real verifier coverage to zero)."""
        import time as _time

        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        c = atlas_db.connect(self.env["ATLAS_DB"])
        atlas_db.insert_tool_call(
            c,
            "sess-orch",
            {
                "message_uuid": "msg-testrun",
                "ts": _time.time(),
                "tool_use_id": "toolu-testrun",
                "tool_name": "Bash",
                "kind": "bash",
                "input_summary": '{"command": "pytest -q"}',
            },
        )
        c.commit()
        c.close()

    def _exec_mcp_test_command(self, target, tool_name, server):
        """Log a test-runner command executed through an MCP shell tool
        (lean-ctx's ctx_shell or context-mode's ctx_execute/ctx_batch_execute)
        instead of the builtin Bash tool. This workspace's CLAUDE.md mandates
        those MCP tools for shell commands, so a run that ran pytest honestly
        through one of them must earn the same (g) credit a Bash call does."""
        import time as _time

        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        c = atlas_db.connect(self.env["ATLAS_DB"])
        atlas_db.insert_tool_call(
            c,
            "sess-orch",
            {
                "message_uuid": "msg-mcp-testrun",
                "ts": _time.time(),
                "tool_use_id": "toolu-mcp-testrun",
                "tool_name": tool_name,
                "kind": "mcp",
                "target": target,
                "server": server,
                "input_summary": '{"command": "pytest -q"}',
            },
        )
        c.commit()
        c.close()

    def test_one_implementer_plus_a_test_verified_finding_passes(self):
        """The simple-task path: one subagent, verification by test, no verifier
        dispatch, gate green."""
        self._commit_and_make_mixed_diff()
        self._log_dispatches(implementers=1, verifiers=0)
        self._exec_test_command()
        self._write_findings(
            [
                {
                    "id": "S1",
                    "status": "verified",
                    "verified_at": self._stamp(1),
                    "reproduction": "pytest -q",
                }
            ]
        )
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertEqual(r.stdout.strip(), "", r.stdout)

    def test_lean_ctx_shell_test_command_earns_credit(self):
        """A pytest run through lean-ctx's ctx_shell MCP tool (this
        workspace's mandated shell path) must earn (g) credit exactly like a
        Bash call -- not just tool_name='Bash' rows."""
        self._commit_and_make_mixed_diff()
        self._log_dispatches(implementers=1, verifiers=0)
        self._exec_mcp_test_command(
            target="lean-ctx.ctx_shell",
            tool_name="mcp__lean-ctx__ctx_shell",
            server="lean-ctx",
        )
        self._write_findings(
            [{"id": "S1", "status": "verified", "verified_at": self._stamp(1)}]
        )
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertEqual(r.stdout.strip(), "", r.stdout)

    def test_context_mode_ctx_execute_test_command_earns_credit(self):
        """Same as above for context-mode's ctx_execute MCP tool, the other
        shell path CLAUDE.md mandates over native Bash."""
        self._commit_and_make_mixed_diff()
        self._log_dispatches(implementers=1, verifiers=0)
        self._exec_mcp_test_command(
            target="context-mode.ctx_execute",
            tool_name="mcp__plugin_context-mode_context-mode__ctx_execute",
            server="context-mode",
        )
        self._write_findings(
            [{"id": "S1", "status": "verified", "verified_at": self._stamp(1)}]
        )
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertEqual(r.stdout.strip(), "", r.stdout)

    def test_transcript_only_test_command_earns_credit_before_ingest(self):
        """The Stop-hook ordering gap: `tool_calls` only gets rows from
        ingest_session.py, which hooks.json runs AFTER completion_gate.py at
        the same Stop event. A pytest run the main thread makes in the turn
        that triggers this Stop is therefore not yet in the DB -- only in the
        raw transcript. No _exec_test_command/_exec_mcp_test_command call
        here: the DB has zero matching tool_calls rows, so credit can only
        come from the transcript scan."""
        self._commit_and_make_mixed_diff()
        self._log_dispatches(implementers=1, verifiers=0)
        transcript = os.path.join(self.tmp, "t.jsonl")
        with open(transcript, "w", encoding="utf-8") as fh:
            fh.write(json.dumps({"type": "user", "message": {"content": "go"}}) + "\n")
            fh.write(
                json.dumps(
                    {
                        "type": "assistant",
                        "timestamp": self._stamp(1),
                        "message": {
                            "content": [
                                {
                                    "type": "tool_use",
                                    "name": "Bash",
                                    "input": {"command": "pytest -q"},
                                }
                            ]
                        },
                    }
                )
                + "\n"
            )
        self._write_findings(
            [{"id": "S1", "status": "verified", "verified_at": self._stamp(1)}]
        )
        r = _run_gate(
            {
                "session_id": "sess-orch",
                "cwd": self.tmp,
                "transcript_path": transcript,
            },
            self.env,
        )
        self.assertEqual(r.stdout.strip(), "", r.stdout)

    def test_transcript_mention_of_pytest_does_not_earn_credit(self):
        """`_TEST_RUNNER_RE` must anchor to an actual invocation, not any
        mention: `grep -n pytest .`, `ls pytest.ini`, `echo pytest` all
        contain the word without running anything. Matching on mere presence
        would reopen the exact self-attestation hole condition (g) exists to
        close (a run could "prove" testing by grepping for the word)."""
        self._commit_and_make_mixed_diff()
        self._log_dispatches(implementers=1, verifiers=0)
        transcript = os.path.join(self.tmp, "t.jsonl")
        with open(transcript, "w", encoding="utf-8") as fh:
            fh.write(json.dumps({"type": "user", "message": {"content": "go"}}) + "\n")
            fh.write(
                json.dumps(
                    {
                        "type": "assistant",
                        "timestamp": self._stamp(1),
                        "message": {
                            "content": [
                                {
                                    "type": "tool_use",
                                    "name": "Bash",
                                    "input": {"command": "grep -n pytest ."},
                                }
                            ]
                        },
                    }
                )
                + "\n"
            )
        self._write_findings(
            [{"id": "S1", "status": "verified", "verified_at": self._stamp(1)}]
        )
        r = _run_gate(
            {
                "session_id": "sess-orch",
                "cwd": self.tmp,
                "transcript_path": transcript,
            },
            self.env,
        )
        self.assertIn("verification coverage", r.stdout)

    def test_ctx_execute_multiline_code_earns_credit(self):
        """context-mode's ctx_execute wraps a multi-line script in a single
        `code` string. After JSON-encoding (both `input_summary` and the
        transcript-scan's `json.dumps`), an embedded newline before `pytest`
        appears as the literal two characters `\\n`, not a real newline byte
        -- the anchor must recognize that escaped form too, or an honest
        multi-line ctx_execute test run earns no credit."""
        self._commit_and_make_mixed_diff()
        self._log_dispatches(implementers=1, verifiers=0)
        # No _exec_mcp_test_command call here: that helper writes an
        # unrelated single-line "pytest -q" row that would satisfy (g) on
        # its own regardless of this fix, making the test vacuous. Only the
        # multi-line row below is inserted, isolating the behavior tested.
        import time as _time

        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
        import atlas_db

        c = atlas_db.connect(self.env["ATLAS_DB"])
        atlas_db.insert_tool_call(
            c,
            "sess-orch",
            {
                "message_uuid": "msg-ctx-multiline",
                "ts": _time.time(),
                "tool_use_id": "toolu-ctx-multiline",
                "tool_name": "mcp__plugin_context-mode_context-mode__ctx_execute",
                "kind": "mcp",
                "target": "context-mode.ctx_execute",
                "server": "context-mode",
                "input_summary": json.dumps({"code": "cd plugins/atlas\npytest -q"}),
            },
        )
        c.commit()
        c.close()
        self._write_findings(
            [{"id": "S1", "status": "verified", "verified_at": self._stamp(1)}]
        )
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertEqual(r.stdout.strip(), "", r.stdout)

    def test_cd_and_python3_dash_m_pytest_earns_credit(self):
        """The most common real shape in this repo's own sessions:
        `cd plugins/atlas && python3 -m pytest scripts/ hooks/ -q`. Explicit
        regression so anchoring the regex can never silently zero out this
        specific, extremely common form."""
        self._commit_and_make_mixed_diff()
        self._log_dispatches(implementers=1, verifiers=0)
        transcript = os.path.join(self.tmp, "t.jsonl")
        with open(transcript, "w", encoding="utf-8") as fh:
            fh.write(json.dumps({"type": "user", "message": {"content": "go"}}) + "\n")
            fh.write(
                json.dumps(
                    {
                        "type": "assistant",
                        "timestamp": self._stamp(1),
                        "message": {
                            "content": [
                                {
                                    "type": "tool_use",
                                    "name": "Bash",
                                    "input": {
                                        "command": (
                                            "cd plugins/atlas && "
                                            "python3 -m pytest scripts/ hooks/ -q"
                                        )
                                    },
                                }
                            ]
                        },
                    }
                )
                + "\n"
            )
        self._write_findings(
            [{"id": "S1", "status": "verified", "verified_at": self._stamp(1)}]
        )
        r = _run_gate(
            {
                "session_id": "sess-orch",
                "cwd": self.tmp,
                "transcript_path": transcript,
            },
            self.env,
        )
        self.assertEqual(r.stdout.strip(), "", r.stdout)

    def test_undated_transcript_record_earns_no_credit(self):
        """A transcript record with no `timestamp` cannot be proven to belong
        to this run -- same "undated" rule `_test_verified_this_run` already
        applies to findings.json stamps. Regression for the strict (fail-
        closed, not fail-open) undated-record handling in
        `_transcript_test_commands`."""
        self._commit_and_make_mixed_diff()
        self._log_dispatches(implementers=1, verifiers=0)
        transcript = os.path.join(self.tmp, "t.jsonl")
        with open(transcript, "w", encoding="utf-8") as fh:
            fh.write(json.dumps({"type": "user", "message": {"content": "go"}}) + "\n")
            fh.write(
                json.dumps(
                    {
                        "type": "assistant",
                        "message": {
                            "content": [
                                {
                                    "type": "tool_use",
                                    "name": "Bash",
                                    "input": {"command": "pytest -q"},
                                }
                            ]
                        },
                    }
                )
                + "\n"
            )
        self._write_findings(
            [{"id": "S1", "status": "verified", "verified_at": self._stamp(1)}]
        )
        r = _run_gate(
            {
                "session_id": "sess-orch",
                "cwd": self.tmp,
                "transcript_path": transcript,
            },
            self.env,
        )
        self.assertIn("verification coverage", r.stdout)

    def test_stamp_without_executed_test_earns_no_credit(self):
        """A `verified` stamp written by the run itself, with no test-runner
        command executed during the run, is self-attestation: it must not
        pair an implementer."""
        self._commit_and_make_mixed_diff()
        self._log_dispatches(implementers=1, verifiers=0)
        self._write_findings(
            [{"id": "S1", "status": "verified", "verified_at": self._stamp(1)}]
        )
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn("verification coverage", r.stdout)

    def test_credit_is_scoped_to_the_run_window(self):
        """A verified row inherited from an earlier session proves nothing about
        the code THIS run shipped. It satisfies (b) but must not pair (g)."""
        self._commit_and_make_mixed_diff()
        self._log_dispatches(implementers=1, verifiers=0)
        self._write_findings(
            [{"id": "OLD", "status": "verified", "verified_at": self._stamp(-86400)}]
        )
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn("verification coverage", r.stdout)

    def test_undated_verified_entry_earns_no_credit(self):
        """No verified_at means it cannot be proven to belong to this run."""
        self._commit_and_make_mixed_diff()
        self._log_dispatches(implementers=1, verifiers=0)
        self._write_findings([{"id": "S1", "status": "verified"}])
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn("verification coverage", r.stdout)

    def test_credit_does_not_cover_more_implementers_than_it_earned(self):
        """Three implementers, one executed-test-verified finding -> still 2 unpaired."""
        self._commit_and_make_mixed_diff()
        self._log_dispatches(implementers=3, verifiers=0)
        self._exec_test_command()
        self._write_findings(
            [{"id": "S1", "status": "verified", "verified_at": self._stamp(1)}]
        )
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn("2 implementer", r.stdout)

    def test_non_verified_status_earns_no_credit(self):
        self._commit_and_make_mixed_diff()
        self._log_dispatches(implementers=1, verifiers=0)
        self._write_findings(
            [
                {"id": "S0", "status": "verified", "verified_at": self._stamp(-86400)},
                {
                    "id": "S1",
                    "status": "needs-evidence",
                    "verified_at": self._stamp(1),
                },
            ]
        )
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn("verification coverage", r.stdout)


class TodoBoardDrainTest(GateConditionIJTest):
    """(i) beyond the transcript: the durable board and the LEDGER line.

    Signals, first to report open items wins: transcript TodoWrite, the
    .atlas/.run/todos.json board todo_capture mirrors (or the orchestrator CLI
    writes in auto mode), then the `LEDGER | n/m` line when the board has no
    items for this session.
    """

    def _seed_board(self, todos, session_id="sess-orch"):
        atlas_todo.mirror(self.tmp, todos, session_id)

    def test_open_board_items_block(self):
        self._satisfy_everything_else()
        self._seed_board([{"content": "wire the gate", "status": "in_progress"}])
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn('"decision": "block"', r.stdout)
        self.assertIn("(i) Todo list not drained", r.stdout)

    def test_drained_board_passes(self):
        self._satisfy_everything_else()
        self._seed_board([{"content": "wire the gate", "status": "completed"}])
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertNotIn('"decision": "block"', r.stdout)

    def test_manual_items_never_block(self):
        """Only this session's non-manual items count on the shared board."""
        self._satisfy_everything_else()
        atlas_todo.add(self.tmp, "human note")
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertNotIn('"decision": "block"', r.stdout)

    def test_other_session_items_never_block(self):
        """Only this session's non-manual items count on the shared board."""
        self._satisfy_everything_else()
        self._seed_board(
            [{"content": "other run", "status": "pending"}], session_id="sess-other"
        )
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertNotIn('"decision": "block"', r.stdout)

    def test_board_beats_ledger_when_board_reports_open(self):
        """The board is consulted before the LEDGER: open board items block
        even when the last LEDGER line says 3/3 done."""
        self._satisfy_everything_else()
        self._seed_board([{"content": "wire the gate", "status": "pending"}])
        t = os.path.join(self.tmp, "t.jsonl")
        with open(t, "w", encoding="utf-8") as fh:
            fh.write("LEDGER | 3/3 | now: done | left: nothing\n")
        r = _run_gate(
            {"session_id": "sess-orch", "cwd": self.tmp, "transcript_path": t}, self.env
        )
        self.assertIn('"decision": "block"', r.stdout)

    def test_ledger_line_blocks_until_complete(self):
        """No board items for this session -> the orchestrator's LEDGER line is
        the only drain signal (auto mode without CLI writes)."""
        self._satisfy_everything_else()
        t = os.path.join(self.tmp, "t.jsonl")
        with open(t, "w", encoding="utf-8") as fh:
            fh.write("ATLAS | implement | shipping\n")
            fh.write("LEDGER | 1/3 | now: wire the gate | left: docs, tests\n")
        r = _run_gate(
            {"session_id": "sess-orch", "cwd": self.tmp, "transcript_path": t}, self.env
        )
        self.assertIn('"decision": "block"', r.stdout)
        with open(t, "w", encoding="utf-8") as fh:
            fh.write("LEDGER | 3/3 | now: handoff | left: nothing\n")
        r2 = _run_gate(
            {"session_id": "sess-orch", "cwd": self.tmp, "transcript_path": t}, self.env
        )
        self.assertNotIn('"decision": "block"', r2.stdout)

    def test_board_replan_blocks_after_drained_todowrite(self):
        """A CLI re-plan on the board after a drained TodoWrite is open work:
        the board is consulted even when the transcript shows a drained list."""
        self._satisfy_everything_else()
        t = _todo_transcript(
            os.path.join(self.tmp, "t.jsonl"),
            [{"content": "ship it", "status": "completed"}],
        )
        self._seed_board([{"content": "follow-up", "status": "pending"}])
        r = _run_gate(
            {"session_id": "sess-orch", "cwd": self.tmp, "transcript_path": t}, self.env
        )
        self.assertIn('"decision": "block"', r.stdout)


class GatePlanMandateTest(GateConditionIJTest):
    """(k): a code-shipping run must have committed to a plan somewhere.

    (i) only enforces DRAINING a list, and an absent list has zero open items,
    so before (k) a run that never planned anything satisfied both trivially.
    That is the gap that let orchestration runs ship with no todo state at all.
    """

    def _clear_plan(self):
        """Remove the plan _satisfy_everything_else seeds, so these tests see
        a run that genuinely never made a list."""
        atlas_todo.mirror(self.tmp, [], "sess-orch")

    def test_no_plan_on_any_surface_blocks(self):
        self._satisfy_everything_else()
        self._clear_plan()
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn('"decision": "block"', r.stdout)
        self.assertIn("(k) No plan was ever made", r.stdout)

    def test_drained_board_plan_satisfies_k(self):
        """A fully completed list still proves a plan existed."""
        self._satisfy_everything_else()  # seeds one already-completed item
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertNotIn("(k) No plan", r.stdout)

    def test_transcript_todowrite_satisfies_k(self):
        self._satisfy_everything_else()
        self._clear_plan()
        t = _todo_transcript(
            os.path.join(self.tmp, "t.jsonl"),
            [{"content": "ship it", "status": "completed"}],
        )
        r = _run_gate(
            {"session_id": "sess-orch", "cwd": self.tmp, "transcript_path": t}, self.env
        )
        self.assertNotIn('"decision": "block"', r.stdout)

    def test_drained_ledger_line_satisfies_k(self):
        """Presence, not arithmetic: `3/3` reports zero open items but still
        proves a plan existed, so (k) reads the line's presence rather than
        going through _ledger_open_todos."""
        self._satisfy_everything_else()
        self._clear_plan()
        t = os.path.join(self.tmp, "t.jsonl")
        with open(t, "w", encoding="utf-8") as fh:
            fh.write("LEDGER | 3/3 | now: handoff | left: nothing\n")
        r = _run_gate(
            {"session_id": "sess-orch", "cwd": self.tmp, "transcript_path": t}, self.env
        )
        self.assertNotIn('"decision": "block"', r.stdout)

    def test_manual_notes_are_not_a_plan(self):
        """Manual board items are a human's notes, not the orchestrator's plan
        -- the same rule (i) applies when counting open items."""
        self._satisfy_everything_else()
        self._clear_plan()
        atlas_todo.add(self.tmp, "human note")
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn("(k) No plan was ever made", r.stdout)

    def test_run_that_shipped_no_code_needs_no_plan(self):
        """(k) is scoped to code-shipping runs: demanding a plan for a
        read-only answer is the busywork this gate exists to avoid."""
        os.makedirs(os.path.join(self.tmp, ".atlas", "evidence"), exist_ok=True)
        with open(os.path.join(self.tmp, ".atlas", "evidence", "e.md"), "w") as fh:
            fh.write("read-only audit")
        os.makedirs(os.path.join(self.tmp, ".atlas", ".run"), exist_ok=True)
        with open(os.path.join(self.tmp, ".atlas", ".run", "findings.json"), "w") as fh:
            json.dump(
                [
                    {
                        "id": "S1",
                        "status": "verified",
                        "verified_at": datetime.now(timezone.utc).isoformat(),
                    }
                ],
                fh,
            )
        for name in ("CHANGELOG.md", "ROADMAP.md"):
            with open(os.path.join(self.tmp, "docs", name), "w") as fh:
                fh.write("# %s\ncontent\n" % name)
        with open(os.path.join(self.tmp, "README.md"), "w") as fh:
            fh.write("# readme\n")
        self._log_run_read("src/app.py")  # the recorder was working this run
        self._log_run_write("docs/CHANGELOG.md")  # ...and recorded docs only
        self._clear_plan()
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertNotIn('"decision": "block"', r.stdout)


class GateDocsNamingTest(GateConditionIJTest):
    """(l) end-to-end: a dated record this run touched must be date-first.

    Uses an untracked file in a bare `git init` -- `ls-files --others` needs no
    commit, which is also how the linter sees a brand-new plan.
    """

    def _git_init(self):
        subprocess.run(["git", "init", "-q", self.tmp], check=True, capture_output=True)

    def _write_plan(self, name):
        plans = os.path.join(self.tmp, "docs", "plans")
        os.makedirs(plans, exist_ok=True)
        with open(os.path.join(plans, name), "w", encoding="utf-8") as fh:
            fh.write("# plan\n")

    def test_misnamed_plan_blocks_with_condition_l(self):
        self._satisfy_everything_else()
        self._git_init()
        self._write_plan("00-MASTER-plan.md")
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn('"decision": "block"', r.stdout)
        self.assertIn("(l)", r.stdout)
        self.assertIn("00-MASTER-plan.md", r.stdout)

    def test_trailing_date_plan_blocks_with_condition_l(self):
        """The reported failure mode: a date that is present but not first."""
        self._satisfy_everything_else()
        self._git_init()
        self._write_plan("packer-consolidation-2026-09-15.md")
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn("(l)", r.stdout)
        self.assertIn("packer-consolidation-2026-09-15.md", r.stdout)
        self.assertIn("a trailing date", r.stdout)

    def test_date_first_plan_does_not_trip_l(self):
        self._satisfy_everything_else()
        self._git_init()
        self._write_plan("2026-09-15-packer-consolidation.md")
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertNotIn("(l)", r.stdout)


class InFlightDispatchHelperTest(unittest.TestCase):
    """Defect 1: the gate must not fire once per Stop while 1-7 implementer
    subagents are still running in the background. Per the hooks docs (Stop
    input `background_tasks`), each entry carries `type` and `status`; an
    empty/absent list means nothing is in flight."""

    def test_no_background_tasks_field_does_not_suppress(self):
        self.assertFalse(completion_gate._has_in_flight_dispatch({}))

    def test_empty_background_tasks_does_not_suppress(self):
        self.assertFalse(
            completion_gate._has_in_flight_dispatch({"background_tasks": []})
        )

    def test_running_subagent_suppresses(self):
        self.assertTrue(
            completion_gate._has_in_flight_dispatch(
                {
                    "background_tasks": [
                        {"id": "1", "type": "subagent", "status": "running"}
                    ]
                }
            )
        )

    def test_running_workflow_and_teammate_suppress(self):
        for task_type in ("workflow", "teammate", "WORKFLOW", "Subagent"):
            self.assertTrue(
                completion_gate._has_in_flight_dispatch(
                    {
                        "background_tasks": [
                            {"id": "1", "type": task_type, "status": "in_progress"}
                        ]
                    }
                ),
                task_type,
            )

    def test_completed_subagent_does_not_suppress(self):
        for status in (
            "completed",
            "failed",
            "killed",
            "cancelled",
            "stopped",
            "COMPLETED",
        ):
            self.assertFalse(
                completion_gate._has_in_flight_dispatch(
                    {
                        "background_tasks": [
                            {"id": "1", "type": "subagent", "status": status}
                        ]
                    }
                ),
                status,
            )

    def test_running_shell_does_not_suppress(self):
        """A long-running `shell` (e.g. `tail -f`) must never suppress the
        gate, or it becomes a permanent bypass."""
        self.assertFalse(
            completion_gate._has_in_flight_dispatch(
                {
                    "background_tasks": [
                        {"id": "1", "type": "shell", "status": "running"}
                    ]
                }
            )
        )

    def test_running_monitor_does_not_suppress(self):
        self.assertFalse(
            completion_gate._has_in_flight_dispatch(
                {
                    "background_tasks": [
                        {"id": "1", "type": "monitor", "status": "running"}
                    ]
                }
            )
        )

    def test_malformed_background_tasks_does_not_suppress(self):
        self.assertFalse(
            completion_gate._has_in_flight_dispatch({"background_tasks": "not a list"})
        )
        self.assertFalse(
            completion_gate._has_in_flight_dispatch({"background_tasks": [None, 5]})
        )

    def test_mixed_list_one_running_subagent_among_completed_suppresses(self):
        self.assertTrue(
            completion_gate._has_in_flight_dispatch(
                {
                    "background_tasks": [
                        {"id": "1", "type": "subagent", "status": "completed"},
                        {"id": "2", "type": "subagent", "status": "running"},
                        {"id": "3", "type": "shell", "status": "running"},
                    ]
                }
            )
        )


class InFlightDispatchOrchestrationTest(GateOrchestrationTest):
    """End-to-end: an orchestrating session with everything else missing must
    still pass silently while a dispatched subagent is in flight."""

    def test_gate_stays_silent_while_subagent_runs(self):
        r = _run_gate(
            {
                "session_id": "sess-orch",
                "cwd": self.tmp,
                "background_tasks": [
                    {"id": "1", "type": "subagent", "status": "running"}
                ],
            },
            self.env,
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "", r.stdout)

    def test_gate_blocks_once_subagent_completes(self):
        r = _run_gate(
            {
                "session_id": "sess-orch",
                "cwd": self.tmp,
                "background_tasks": [
                    {"id": "1", "type": "subagent", "status": "completed"}
                ],
            },
            self.env,
        )
        self.assertIn('"decision": "block"', r.stdout)


class AtlasFindingHintTest(unittest.TestCase):
    """Defect 2: the (b)/(g) block-reason hints tell the orchestrator to run
    atlas_finding.py without --title, which argparse rejects outright
    ("the following arguments are required: --title"). Every flag the hint
    names must actually be accepted by the real parser."""

    def _finding_script(self):
        return os.path.join(
            os.path.dirname(__file__), "..", "scripts", "atlas_finding.py"
        )

    def test_help_lists_title_as_required(self):
        out = subprocess.run(
            [sys.executable, self._finding_script(), "--help"],
            capture_output=True,
            text=True,
        ).stdout
        self.assertIn("--title", out)
        self.assertIn("--id", out)
        self.assertIn("--status", out)

    def test_missing_title_is_rejected(self):
        r = subprocess.run(
            [
                sys.executable,
                self._finding_script(),
                "--id",
                "S1",
                "--status",
                "verified",
            ],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--title", r.stderr)

    def test_condition_b_hint_names_title_flag(self):
        reason = _reason(False, True, False)
        self.assertIn("--title", reason)

    def test_condition_g_hint_names_title_flag(self):
        reason = _reason(False, False, False, unverified=1)
        self.assertIn("--title", reason)


class TestRunnerRegexUnittestTest(unittest.TestCase):
    """Defect 3: `_TEST_RUNNER_RE` did not recognize `python -m unittest`,
    the test runner this repo's own suites actually use (stdlib unittest,
    not pytest)."""

    def test_python3_dash_m_unittest_discover_matches(self):
        self.assertTrue(
            completion_gate._TEST_RUNNER_RE.search(
                "python3 -m unittest discover -s plugins/atlas/hooks"
            )
        )

    def test_cd_and_python3_dash_m_unittest_matches(self):
        self.assertTrue(
            completion_gate._TEST_RUNNER_RE.search(
                "cd plugins/atlas && python3 -m unittest discover -s hooks"
            )
        )

    def test_quoted_prose_mention_does_not_match(self):
        """Mirrors the existing pytest negative test: the anchor group only
        matches at a command position (start of string, after a shell
        separator, or inside a `"command"`/`"code"` JSON value) -- never
        inside an unrelated JSON string value."""
        blob = json.dumps({"text": "we use python -m unittest here"})
        self.assertIsNone(completion_gate._TEST_RUNNER_RE.search(blob))

    def test_command_key_with_unittest_matches(self):
        blob = json.dumps({"command": "python3 -m unittest discover -s ."})
        self.assertIsNotNone(completion_gate._TEST_RUNNER_RE.search(blob))


class DelegationMandateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "docs").mkdir()
        self.env = dict(
            os.environ,
            ATLAS_DB=str(self.root / "atlas.db"),
            ATLAS_HOOKSTATE_DIR=str(self.root / "hookstate"),
        )
        self.conn = atlas_db.connect(self.env["ATLAS_DB"])
        self.addCleanup(self.conn.close)
        atlas_db.init(self.conn)
        pid = atlas_db.register_project(self.conn, str(self.root))
        self.rid = atlas_db.start_run(self.conn, pid, "mandate")

    def write(self, path="src/app.py", context="main"):
        atlas_db.log_event(self.conn, self.rid, "Write", context, 1, path)

    def gate(self, **extra):
        return _run_gate(
            dict(session_id="mandate", cwd=str(self.root), **extra), self.env
        ).stdout

    def test_unarmed_code_write_blocks_and_dispatch_clears_m(self):
        self.write()
        self.assertIn("(m) Delegation mandate", self.gate())
        atlas_db.log_event(self.conn, self.rid, "Task", "main", 0)
        self.assertEqual(self.gate(), "")

    def test_dispatch_table_and_tool_call_dispatch_clear_m(self):
        self.write()
        atlas_db.log_dispatch(self.conn, self.rid, "atlas:implementer")
        self.assertEqual(self.gate(), "")
        self.conn.execute("DELETE FROM dispatches")
        self.conn.execute("DELETE FROM events WHERE is_inline_op=0")
        self.conn.execute(
            "INSERT INTO tool_calls(session_id,ts,tool_name,is_sidechain) VALUES(?,?,?,0)",
            ("mandate", datetime.now(timezone.utc).timestamp(), "Agent"),
        )
        self.conn.commit()
        self.assertEqual(self.gate(), "")

    def test_transcript_current_dispatch_clears_m(self):
        self.write()
        transcript = self.root / "session.jsonl"
        transcript.write_text(
            json.dumps(
                {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "message": {"content": [{"type": "tool_use", "name": "Task"}]},
                }
            )
            + "\n"
        )
        self.assertEqual(self.gate(transcript_path=str(transcript)), "")

    def test_shared_exemption_cases_match_contract(self):
        """contracts/native-tools.json delegationExemptCases are asserted by both
        harnesses (omp/contracts.test.ts runs the same list through isNonDocsPath)."""
        cases = json.loads(
            (
                Path(completion_gate.__file__).resolve().parent.parent
                / "contracts"
                / "native-tools.json"
            ).read_text()
        )["delegationExemptCases"]
        for path in cases["exempt"]:
            with self.subTest(exempt=path):
                self.conn.execute("DELETE FROM events")
                self.conn.commit()
                self.write(path)
                self.assertEqual(self.gate(), "")
        for path in cases["code"]:
            with self.subTest(code=path):
                self.conn.execute("DELETE FROM events")
                self.conn.commit()
                self.write(path)
                self.assertIn("(m) Delegation mandate", self.gate())

    def test_docs_and_metadata_only_writes_are_silent(self):
        for path in ("docs/CHANGELOG.md", ".atlas/run.json", "README.md"):
            self.write(path)
        self.assertEqual(self.gate(), "")

    def test_sidechain_only_writes_are_silent(self):
        self.write(context="sidechain")
        self.conn.execute(
            "INSERT INTO tool_calls(session_id,ts,tool_name,is_sidechain,input_summary) VALUES(?,?,?,1,?)",
            (
                "mandate",
                datetime.now(timezone.utc).timestamp(),
                "Write",
                json.dumps({"file_path": "src/app.py"}),
            ),
        )
        self.conn.commit()
        self.assertEqual(self.gate(), "")

    def test_background_dispatch_and_kill_switch_suppress_m(self):
        self.write()
        self.assertEqual(
            self.gate(background_tasks=[{"type": "subagent", "status": "running"}]), ""
        )
        self.env["ATLAS_GATE"] = "off"
        self.assertEqual(self.gate(), "")

    def test_db_error_fails_open(self):
        self.write()
        with mock.patch("atlas_db.connect", side_effect=RuntimeError("DB down")):
            self.assertFalse(completion_gate._missing_delegation("mandate"))

    def test_subagent_transcript_is_exempt(self):
        self.write()
        self.assertEqual(
            self.gate(transcript_path="/session/subagents/agent-a.jsonl"), ""
        )

    def test_uri_scheme_writes_are_not_main_thread_code(self):
        """An IRC message (agent://) or xd:// device call is logged as a Write
        with a URI path. It is not a file, so it must not make (m) demand a
        dispatch."""
        for path in ("agent://Foo", "xd://report_issue", "proc://j/kill"):
            self.write(path)
        self.conn.execute(
            "INSERT INTO tool_calls(session_id,ts,tool_name,is_sidechain,input_summary) VALUES(?,?,?,0,?)",
            (
                "mandate",
                datetime.now(timezone.utc).timestamp(),
                "Write",
                json.dumps({"file_path": "agent://Bar"}),
            ),
        )
        self.conn.commit()
        self.assertEqual(self.gate(), "")

    def test_real_code_write_next_to_uri_writes_still_blocks(self):
        self.write("agent://Foo")
        self.write("src/app.py")
        self.assertIn("(m) Delegation mandate", self.gate())


class ContractVisibilityTest(unittest.TestCase):
    """Conditions (n)/(o)/(p) -- the contract-visibility conditions.

    Each blocks AT MOST ONCE per session (an O_EXCL marker file under the
    contract-gate marker dir, isolated from the real one via
    ATLAS_CONTRACT_GATE_DIR) and each is switchable off individually.

    The base fixture models a run that satisfies (a)-(m): code shipped as a
    mixed diff (code change + CHANGELOG touch, both logged as this run's own
    writes, so drift is cleared), fresh evidence, a verified findings entry,
    a phased drained board plan ("[implement] ..." / "[verify] ..." prefixes),
    and exactly one atlas:explorer dispatch (below the (p) two-worker
    threshold). Each test perturbs exactly one surface.
    """

    SID_A = "sess-cv-a"
    SID_B = "sess-cv-b"
    OK = "ATLAS | ✅ verify | ok"

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.tmp, "docs"), exist_ok=True)
        self.env = dict(
            os.environ,
            ATLAS_DB=os.path.join(self.tmp, "atlas.db"),
            ATLAS_HOOKSTATE_DIR=os.path.join(self.tmp, "hookstate"),
            ATLAS_CONTRACT_GATE_DIR=os.path.join(self.tmp, "markers"),
        )
        c = atlas_db.connect(self.env["ATLAS_DB"])
        atlas_db.init(c)
        pid = atlas_db.register_project(c, self.tmp)
        for sid in (self.SID_A, self.SID_B):
            atlas_db.start_run(c, pid, sid)
            atlas_db.mark_orchestrating(c, sid)
        c.close()
        atlas_dir = os.path.join(self.tmp, ".atlas")
        os.makedirs(os.path.join(atlas_dir, "evidence"), exist_ok=True)
        os.makedirs(os.path.join(atlas_dir, ".run"), exist_ok=True)
        with open(os.path.join(atlas_dir, "evidence", "run.txt"), "w") as f:
            f.write("observed output")
        with open(os.path.join(atlas_dir, ".run", "findings.json"), "w") as f:
            json.dump(
                [
                    {
                        "claim": "x works",
                        "status": "verified",
                        "verified_at": datetime.now(timezone.utc).isoformat(),
                    }
                ],
                f,
            )
        for rel in ("docs/CHANGELOG.md", "docs/ROADMAP.md", "README.md"):
            with open(os.path.join(self.tmp, rel), "w") as f:
                f.write("# %s\n" % rel)
        self.prepare_run(self.SID_A)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    # -- fixture helpers -----------------------------------------------------

    def prepare_run(self, sid, plan_items=None, log_code=True, dispatch=True):
        """Make `sid`'s run a compliant code-shipping run (a)-(m), minus
        whatever the caller perturbs: a phased drained plan, one
        atlas:explorer dispatch (telemetry, below the (p) threshold), and a
        mixed code+docs run-write log so (f) drift is cleared."""
        atlas_todo.mirror(
            self.tmp,
            plan_items
            if plan_items is not None
            else [
                {"content": "[implement] fixture step", "status": "completed"},
                {"content": "[verify] fixture check", "status": "completed"},
            ],
            sid,
        )
        c = atlas_db.connect(self.env["ATLAS_DB"])
        rid = atlas_db.current_run_id(c, sid) or atlas_db.latest_run_id(c, sid)
        if dispatch:
            atlas_db.log_dispatch(c, rid, "atlas:explorer")
        if log_code:
            for path in (
                os.path.join(self.tmp, "app.py"),
                os.path.join(self.tmp, "docs", "CHANGELOG.md"),
            ):
                with open(path, "a") as f:
                    f.write("x\n")
                atlas_db.log_event(c, rid, "Write", "main", 1, path)
        c.commit()
        c.close()

    def _run_start(self, sid):
        c = atlas_db.connect(self.env["ATLAS_DB"])
        rid = atlas_db.current_run_id(c, sid) or atlas_db.latest_run_id(c, sid)
        started = atlas_db.run_started_at(c, rid)
        c.close()
        assert started is not None
        return started

    def _dispatch(self, agent_type):
        c = atlas_db.connect(self.env["ATLAS_DB"])
        rid = atlas_db.current_run_id(c, self.SID_A) or atlas_db.latest_run_id(
            c, self.SID_A
        )
        atlas_db.log_dispatch(c, rid, agent_type)
        c.commit()
        c.close()

    def _two_workers(self):
        # atlas:explorer ships nothing, so (g) stays out of the picture; the
        # setUp dispatch plus this one make two atlas workers.
        self._dispatch("atlas:explorer")

    def _irc_event(self, peer="agent://worker-a"):
        """IRC (SendMessage) traffic: the harness routes peer messages
        through a Write whose path is an `agent://` URI."""
        c = atlas_db.connect(self.env["ATLAS_DB"])
        rid = atlas_db.current_run_id(c, self.SID_A) or atlas_db.latest_run_id(
            c, self.SID_A
        )
        atlas_db.log_event(c, rid, "Write", "main", 1, peer)
        c.commit()
        c.close()

    def _worker_note(self, owner="worker-a", to="lead", ts=None, text="handoff"):
        """One board note in atlas_todo.note's exact on-disk shape."""
        chan = _lead_channel(
            self.tmp, self.SID_A, [] if atlas_todo.is_lead_name(owner) else [owner]
        )
        record = {
            "ts": time.time() if ts is None else ts,
            "owner": owner,
            "to": to,
            "item": None,
            "text": text,
            "channel": chan,
        }
        notes_dir = os.path.join(self.tmp, ".atlas", ".run", "board")
        os.makedirs(notes_dir, exist_ok=True)
        with open(os.path.join(notes_dir, "%s.jsonl" % owner), "a") as f:
            f.write(json.dumps(record) + "\n")

    def gate(self, payload=None, sid=None):
        p = dict({"session_id": sid or self.SID_A, "cwd": self.tmp}, **(payload or {}))
        return _run_gate(p, self.env)

    def say(self, text=None, **extra):
        """Run the gate for SID_A with a final reply; stdout only."""
        payload = dict(extra)
        payload["last_assistant_message"] = self.OK if text is None else text
        return self.gate(payload).stdout

    # -- (n) status header ----------------------------------------------------

    def test_n_blocks_without_header_and_quotes_required_form(self):
        out = self.say("All done.")
        self.assertIn('"decision": "block"', out)
        reason = json.loads(out)["reason"]  # the model sees the decoded text
        self.assertIn("(n)", reason)
        self.assertIn("ATLAS | <glyph> <phase> | <one-line state>", reason)
        self.assertIn("research 🔍", reason)
        self.assertIn("done 🏁", reason)
        self.assertIn("blocked ⛔", reason)
        self.assertIn("re-send", reason.lower())
        self.assertIn("nothing else changed", reason)
        import sqlite3

        conn = sqlite3.connect(self.env["ATLAS_DB"])
        rows = conn.execute(
            "SELECT snippet FROM friction_events WHERE session_id=?", (self.SID_A,)
        ).fetchall()
        conn.close()
        # The snippet names the failed condition, not just its letter, so a
        # friction row is diagnosable on its own (was the bare "conditions: n").
        self.assertEqual(
            [r[0] for r in rows if r[0].startswith("conditions:")],
            ["conditions: n (status header missing)"],
        )

    def test_n_passes_when_header_is_the_first_non_empty_line(self):
        self.assertEqual(self.say("ATLAS | ✅ verify | suites green"), "")

    def test_n_ignores_leading_blank_lines(self):
        self.assertEqual(self.say("\n\n\nATLAS | 🔍 research | digging"), "")

    def test_n_blocks_when_header_is_not_the_first_non_empty_line(self):
        self.assertIn("(n)", self.say("Sure!\nATLAS | ✅ verify | suites green"))

    def test_n_fails_open_without_last_assistant_message(self):
        self.assertEqual(self.gate().stdout, "")

    def test_n_fails_open_on_empty_text(self):
        self.assertEqual(self.say(""), "")

    def test_n_fails_open_on_stop_hook_active(self):
        self.assertEqual(self.say("All done.", stop_hook_active=True), "")

    def test_n_sidechain_exempt(self):
        self.assertEqual(
            self.say("All done.", transcript_path="/session/subagents/agent-1.jsonl"),
            "",
        )

    def test_n_is_one_shot_per_session(self):
        self.assertIn("(n)", self.say("All done."))
        self.assertEqual(
            self.say("All done."), ""
        )  # same session: already blocked once
        self.prepare_run(self.SID_B)  # a different session is on its first block
        out = self.gate({"last_assistant_message": "All done."}, sid=self.SID_B).stdout
        self.assertIn("(n)", out)

    def test_n_kill_switch_and_global_off(self):
        self.env["ATLAS_GATE_HEADER"] = "off"
        self.assertEqual(self.say("All done."), "")
        del self.env["ATLAS_GATE_HEADER"]
        self.env["ATLAS_GATE"] = "off"
        self.assertEqual(self.say("All done."), "")

    # -- (o) phased todo ------------------------------------------------------

    def _research_only_plan(self):
        """Replace the plan with one that lacks implement/verify. The run
        already shipped code and logged its dispatch in setUp, so neither is
        repeated here."""
        self.prepare_run(
            self.SID_A,
            plan_items=[{"content": "[research] dig", "status": "completed"}],
            log_code=False,
            dispatch=False,
        )

    def test_o_names_missing_phases_and_both_fixes(self):
        self._research_only_plan()
        out = self.say()
        self.assertIn('"decision": "block"', out)
        self.assertIn("(o)", out)
        self.assertIn("implement", out)
        self.assertIn("verify", out)
        self.assertIn("TodoWrite", out)
        self.assertIn("[<phase>] ", out)
        self.assertIn("scaffold --task", out)
        self.assertIn("--session", out)
        self.assertNotIn("CLAUDE_PLUGIN_ROOT", out)
        m = re.search(r'python3 \\"([^"\\]*atlas_todo\.py)\\" scaffold', out)
        self.assertIsNotNone(m, out)
        self.assertTrue(os.path.isabs(m.group(1)) and os.path.exists(m.group(1)))

    def test_o_passes_when_prefixes_cover_required_phases(self):
        self.assertEqual(self.say(), "")

    def test_o_passes_when_phase_fields_cover_required_phases(self):
        """The `phase` field (omp's todo phase) is the other carrier."""
        board = Path(self.tmp, ".atlas", ".run", "todos.json")
        data = json.loads(board.read_text(encoding="utf-8"))
        template = data["items"][0]
        data["items"] = [
            {
                **template,
                "id": "cv-%s" % phase,
                "content": "step",
                "phase": phase,
                "status": "completed",
            }
            for phase in ("implement", "verify")
        ]
        board.write_text(json.dumps(data), encoding="utf-8")
        self.assertEqual(self.say(), "")

    def test_o_counts_items_of_every_status(self):
        """All statuses cover a phase; a pending [verify] item is still a
        verify phase item (the drain check (i) is a separate condition)."""
        self.assertEqual(
            completion_gate._item_phase(
                {"content": "[verify] later", "status": "pending"}, ["verify"]
            ),
            "verify",
        )

    def test_o_fails_open_on_corrupt_board(self):
        """An unreadable board never manufactures an (o) block. (k) is kept
        quiet by a LEDGER line (another plan surface) so (o) is what is under
        test."""
        Path(self.tmp, ".atlas", ".run", "todos.json").write_text(
            "{not json", encoding="utf-8"
        )
        transcript = Path(self.tmp, "session.jsonl")
        transcript.write_text("LEDGER | 3/3 | done\n", encoding="utf-8")
        out = self.say(transcript_path=str(transcript))
        self.assertNotIn("(o)", out)

    def test_o_skipped_when_no_code_shipped(self):
        """A run with telemetry but zero writes shipped nothing: (o) must not
        demand phases (same scoping as (a)/(b)/(f)/(g))."""
        c = atlas_db.connect(self.env["ATLAS_DB"])
        c.execute(
            "DELETE FROM events WHERE run_id IN (SELECT id FROM runs WHERE session_id=?) AND tool='Write'",
            (self.SID_A,),
        )
        c.commit()
        c.close()
        atlas_todo.mirror(
            self.tmp, [{"content": "[research] dig", "status": "completed"}], self.SID_A
        )
        self.assertEqual(self.say(), "")

    def test_o_is_one_shot_per_session(self):
        self._research_only_plan()
        self.assertIn("(o)", self.say())
        self.assertEqual(self.say(), "")

    def test_o_kill_switch_and_sidechain_exempt(self):
        self._research_only_plan()
        self.env["ATLAS_GATE_PHASES"] = "off"
        self.assertEqual(self.say(), "")
        del self.env["ATLAS_GATE_PHASES"]
        self.assertEqual(
            self.say(transcript_path="/session/subagents/agent-1.jsonl"), ""
        )

    # -- (p) colony channel ---------------------------------------------------

    def test_p_names_colony_fix_when_two_workers_silence_channel(self):
        self._two_workers()
        out = self.say()
        self.assertIn('"decision": "block"', out)
        self.assertIn("(p)", out)
        self.assertIn("note --owner", out)
        self.assertIn("--to lead", out)
        self.assertIn("atlas_todo.py", out)

    def test_p_below_two_workers_is_silent(self):
        self.assertEqual(self.say(), "")

    def test_p_passes_with_worker_board_note(self):
        self._two_workers()
        self._worker_note(owner="worker-a")
        self.assertEqual(self.say(), "")

    def test_p_passes_with_worker_final_report_note(self):
        """C2: a registered member's kind='report' note counts."""
        self._two_workers()
        _seed_report_notes(self.tmp, ("worker-a",), self.SID_A)
        self.assertEqual(self.say(), "")

    def test_p_lead_owned_report_and_stranger_reports_do_not_count(self):
        self._two_workers()
        chan = _lead_channel(self.tmp, self.SID_A, ["worker-a"])
        other = _lead_channel(self.tmp, "other-session", ["worker-b"])
        for owner, channel in (
            ("lead-" + atlas_todo._sanitize_owner(self.SID_A)[:6], chan),
            ("lead", chan),
            ("stranger", chan),  # never registered in this run's channel
            ("worker-b", other),  # a member, but of another lead's channel
        ):
            atlas_todo.note(
                self.tmp, owner, "STATUS: DONE\nexit 0", channel=channel, kind="report"
            )
        self.assertIn("(p)", self.say())

    def test_p_passes_with_irc_traffic_logged_under_another_run_of_the_session(self):
        """Baseline: 2 of 8 live (p) blocks had agent:// writes in the session
        but under a sibling run id, so the single-run lookup missed them."""
        self._two_workers()
        c = atlas_db.connect(self.env["ATLAS_DB"])
        c.execute(
            "INSERT INTO runs(project_id, session_id, started_at) "
            "SELECT project_id, session_id, started_at - 1 FROM runs "
            "WHERE session_id=? ORDER BY id DESC LIMIT 1",
            (self.SID_A,),
        )
        other = c.execute("SELECT MAX(id) FROM runs").fetchone()[0]
        atlas_db.log_event(c, other, "Write", "main", 1, "agent://worker-a")
        c.commit()
        c.close()
        self.assertEqual(self.say(), "")

    def test_p_passes_with_irc_traffic(self):
        self._two_workers()
        self._irc_event()
        self.assertEqual(self.say(), "")

    def test_p_passes_with_sendmessage_tool_call(self):
        self._two_workers()
        import sqlite3

        conn = sqlite3.connect(self.env["ATLAS_DB"])
        conn.execute(
            "INSERT INTO tool_calls(session_id,ts,tool_name,is_sidechain,input_summary)"
            " VALUES(?,?,?,?,?)",
            (self.SID_A, time.time(), "SendMessage", 0, json.dumps({"to": "worker-a"})),
        )
        conn.commit()
        conn.close()
        self.assertEqual(self.say(), "")

    def test_p_note_outside_run_window_does_not_count(self):
        self._two_workers()
        self._worker_note(owner="worker-a", ts=self._run_start(self.SID_A) - 100)
        self.assertIn("(p)", self.say())

    def test_p_lead_note_does_not_count(self):
        self._two_workers()
        self._worker_note(owner="lead")
        self.assertIn("(p)", self.say())

    def test_p_ignores_non_atlas_dispatches(self):
        self._dispatch("Explore")
        self._dispatch("Explore")
        self.assertEqual(self.say(), "")

    def test_p_is_one_shot_per_session(self):
        self._two_workers()
        self.assertIn("(p)", self.say())
        self.assertEqual(self.say(), "")

    def test_p_kill_switch_and_sidechain_exempt(self):
        self._two_workers()
        self.env["ATLAS_GATE_COLONY"] = "off"
        self.assertEqual(self.say(), "")
        del self.env["ATLAS_GATE_COLONY"]
        self.assertEqual(
            self.say(transcript_path="/session/subagents/agent-1.jsonl"), ""
        )

    def test_p_fails_open_when_the_dispatch_count_cannot_be_read(self):
        self._two_workers()
        with mock.patch("atlas_db.connect", side_effect=RuntimeError("DB down")):
            self.assertIsNone(completion_gate._colony_workers_dispatched(self.SID_A))


class BlockLoopCapTest(unittest.TestCase):
    """Identical consecutive blocks end in an allowed Stop plus a friction row."""

    def test_allows_after_limit_identical_blocks_and_records_friction(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        db = os.path.join(tmp, "atlas.db")
        atlas_db.init(atlas_db.connect(db))
        with (
            mock.patch.dict(os.environ, {"ATLAS_DB": db, "ATLAS_HOOKSTATE_DIR": tmp}),
        ):
            lim = completion_gate.BLOCK_LOOP_LIMIT
            got = [
                completion_gate._block_loop_exhausted("s1", ["c"])
                for _ in range(lim + 1)
            ]
            self.assertEqual(got, [False] * lim + [True])
            # a different condition set restarts the count
            self.assertFalse(completion_gate._block_loop_exhausted("s1", ["c", "d"]))
            conn = atlas_db.connect(db)
            rows = conn.execute(
                "SELECT snippet FROM friction_events WHERE category='gate_block_loop'"
            ).fetchall()
            conn.close()
        self.assertEqual(len(rows), 1)

    def test_env_override_moves_exhaustion_point(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        db = os.path.join(tmp, "atlas.db")
        atlas_db.init(atlas_db.connect(db))
        with mock.patch.dict(
            os.environ,
            {"ATLAS_DB": db, "ATLAS_HOOKSTATE_DIR": tmp, "ATLAS_GATE_BLOCK_LOOP": "5"},
        ):
            got = [
                completion_gate._block_loop_exhausted("s-env", ["c"]) for _ in range(6)
            ]
        self.assertEqual(got, [False] * 5 + [True])

    def test_invalid_env_values_fall_back_or_clamp(self):
        # non-integer/empty -> default 3 (4th identical block allowed through);
        # 9 clamps to 7 (8th exhausts, never reaching the native 8-block cap);
        # 0 clamps to 1.
        for raw, exhausted_at in (("abc", 4), ("", 4), ("9", 8), ("0", 2)):
            with self.subTest(raw=raw):
                tmp = tempfile.mkdtemp()
                self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
                with mock.patch.dict(
                    os.environ,
                    {"ATLAS_HOOKSTATE_DIR": tmp, "ATLAS_GATE_BLOCK_LOOP": raw},
                ):
                    got = [
                        completion_gate._block_loop_exhausted("s-raw", ["c"])
                        for _ in range(exhausted_at)
                    ]
                self.assertEqual(got, [False] * (exhausted_at - 1) + [True])


class ItemPhaseExtractionTest(unittest.TestCase):
    """The (o) phase carriers: the item's `phase` field wins, else the
    `[<phase>] ` content prefix; anything else carries no phase."""

    PHASES = ["research", "implement", "verify"]

    def test_phase_field_wins(self):
        item = {"content": "[verify] x", "phase": "implement"}
        self.assertEqual(completion_gate._item_phase(item, self.PHASES), "implement")

    def test_content_prefix_when_no_phase_field(self):
        item = {"content": "[verify] run suites"}
        self.assertEqual(completion_gate._item_phase(item, self.PHASES), "verify")

    def test_unknown_phase_tokens_are_ignored(self):
        self.assertIsNone(
            completion_gate._item_phase({"content": "[urgent] ship"}, self.PHASES)
        )
        self.assertIsNone(
            completion_gate._item_phase(
                {"content": "plain", "phase": "urgent"}, self.PHASES
            )
        )

    def test_no_phase_at_all(self):
        self.assertIsNone(
            completion_gate._item_phase({"content": "plain item"}, self.PHASES)
        )
        self.assertIsNone(completion_gate._item_phase({}, self.PHASES))
