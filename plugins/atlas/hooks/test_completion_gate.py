import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import atlas_db  # noqa: E402
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


class DocsDriftTest(unittest.TestCase):
    def test_non_docs_only_returns_true(self):
        """Non-docs changes with no docs changes -> drift detected."""
        self.assertTrue(_docs_drift(["src/foo.py", "README.md"]))

    def test_docs_change_present_returns_false(self):
        """Any docs/ path in the list -> no drift."""
        self.assertFalse(_docs_drift(["src/foo.py", "docs/CHANGELOG.md"]))

    def test_only_docs_path_returns_false(self):
        """Only docs/ paths -> no drift."""
        self.assertFalse(_docs_drift(["docs/ROADMAP.md"]))

    def test_nested_docs_path_returns_false(self):
        """A path containing /docs/ counts as a docs path."""
        self.assertFalse(_docs_drift(["plugins/atlas/docs/features.md"]))

    def test_empty_list_returns_false(self):
        """Empty input -> no drift (nothing changed)."""
        self.assertFalse(_docs_drift([]))


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
            json.dump([{"claim": "x works", "status": "verified"}], f)
        for name in ("CHANGELOG.md", "ROADMAP.md"):
            with open(os.path.join(docs, name), "w") as f:
                f.write("# %s\ncontent\n" % name)
        with open(os.path.join(self.tmp, "README.md"), "w") as f:
            f.write("# project\n")

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
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertEqual(r.returncode, 0)
        self.assertNotIn('"decision": "block"', r.stdout)


class ConditionGHelperTest(unittest.TestCase):
    def test_nondocs_changed_true_for_code_path(self):
        self.assertTrue(_nondocs_changed(["src/foo.py", "docs/CHANGELOG.md"]))

    def test_nondocs_changed_false_for_docs_only(self):
        self.assertFalse(_nondocs_changed(["docs/CHANGELOG.md", "a/docs/b.md"]))

    def test_nondocs_changed_false_for_empty(self):
        self.assertFalse(_nondocs_changed([]))

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
            json.dump([{"claim": "x works", "status": "verified"}], f)
        for name in ("CHANGELOG.md", "ROADMAP.md"):
            with open(os.path.join(docs, name), "w") as f:
                f.write("# %s\ncontent\n" % name)
        with open(os.path.join(self.tmp, "README.md"), "w") as f:
            f.write("# project\n")

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
            fh.write(
                json.dumps({"tools": ["Read", "TodoWrite"], "message": {}}) + "\n"
            )
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
        with open(
            os.path.join(self.tmp, ".atlas", "evidence", "e.md"), "w"
        ) as fh:
            fh.write("red->green")
        os.makedirs(os.path.join(self.tmp, ".atlas", ".run"), exist_ok=True)
        with open(os.path.join(self.tmp, ".atlas", ".run", "findings.json"), "w") as fh:
            json.dump([{"id": "S1", "status": "verified"}], fh)
        for name in ("CHANGELOG.md", "ROADMAP.md"):
            with open(os.path.join(self.tmp, "docs", name), "w") as fh:
                fh.write("# %s\ncontent\n" % name)
        with open(os.path.join(self.tmp, "README.md"), "w") as fh:
            fh.write("# readme\n")
        # A docs write in the same run clears (f).
        self._log_run_write("docs/CHANGELOG.md")
        self._log_run_write("src/app.py")

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
        return (
            _dt.datetime.fromtimestamp(started + offset_seconds, _dt.timezone.utc)
            .isoformat(timespec="seconds")
        )

    def test_one_implementer_plus_a_test_verified_finding_passes(self):
        """The simple-task path: one subagent, verification by test, no verifier
        dispatch, gate green."""
        self._commit_and_make_mixed_diff()
        self._log_dispatches(implementers=1, verifiers=0)
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
        """Three implementers, one test-verified finding -> still 2 unpaired."""
        self._commit_and_make_mixed_diff()
        self._log_dispatches(implementers=3, verifiers=0)
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
