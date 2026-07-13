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
    _find_ssot,
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
            os.path.join(self.tmp, ".atlas", "docs"), exist_ok=True
        )  # docs/ exists, no artifacts
        self.env = dict(os.environ, ATLAS_DB=os.path.join(self.tmp, "atlas.db"))
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

    def test_legacy_docs_only_does_not_engage_gate(self):
        """A repo with a legacy root docs/ but no .atlas/docs/ -> gate is a no-op,
        even for an orchestrating session. The SSOT is .atlas/docs/ only; a bare
        docs/ must NOT trigger the gate."""
        shutil.rmtree(os.path.join(self.tmp, ".atlas"))
        os.makedirs(os.path.join(self.tmp, "docs"), exist_ok=True)
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertEqual(r.returncode, 0)
        self.assertNotIn('"decision": "block"', r.stdout)

    def _satisfy_all_conditions(self):
        docs = os.path.join(self.tmp, ".atlas", "docs")
        os.makedirs(os.path.join(docs, "evidence"), exist_ok=True)
        os.makedirs(os.path.join(docs, ".run"), exist_ok=True)
        with open(os.path.join(docs, "evidence", "run.txt"), "w") as f:
            f.write("observed output")
        with open(os.path.join(docs, ".run", "findings.json"), "w") as f:
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
        os.remove(os.path.join(self.tmp, ".atlas", "docs", "ROADMAP.md"))
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
        self._satisfy_all_conditions()
        subprocess.run(["git", "init", "-q", self.tmp], check=True, capture_output=True)
        genv = dict(
            os.environ,
            GIT_AUTHOR_NAME="t",
            GIT_AUTHOR_EMAIL="t@t",
            GIT_COMMITTER_NAME="t",
            GIT_COMMITTER_EMAIL="t@t",
        )
        subprocess.run(
            ["git", "-C", self.tmp, "add", "-A"], check=True, capture_output=True
        )
        subprocess.run(
            ["git", "-C", self.tmp, "commit", "-qm", "base"],
            check=True,
            capture_output=True,
            env=genv,
        )
        # change code only -> drift
        with open(os.path.join(self.tmp, "app.py"), "w") as f:
            f.write("print('x')\n")
        subprocess.run(
            ["git", "-C", self.tmp, "add", "app.py"], check=True, capture_output=True
        )
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertIn('"decision": "block"', r.stdout)
        self.assertIn("Docs drift", r.stdout)
        # touching a docs file clears the drift block
        with open(os.path.join(self.tmp, ".atlas", "docs", "CHANGELOG.md"), "a") as f:
            f.write("- change\n")
        r2 = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, self.env)
        self.assertNotIn('"decision": "block"', r2.stdout)

    def test_git_error_does_not_silently_pass_drift_and_g(self):
        """Git unavailable at gate time (PATH scrubbed so the git binary cannot
        be found) must NOT silently pass conditions (f) and (g). With a git repo
        that has code changed, the gate must BLOCK with a reason naming the git
        failure rather than letting unverified code ship."""
        self._satisfy_all_conditions()
        genv = dict(
            os.environ,
            GIT_AUTHOR_NAME="t",
            GIT_AUTHOR_EMAIL="t@t",
            GIT_COMMITTER_NAME="t",
            GIT_COMMITTER_EMAIL="t@t",
        )
        subprocess.run(["git", "init", "-q", self.tmp], check=True, capture_output=True)
        subprocess.run(
            ["git", "-C", self.tmp, "add", "-A"], check=True, capture_output=True
        )
        subprocess.run(
            ["git", "-C", self.tmp, "commit", "-qm", "base"],
            check=True,
            capture_output=True,
            env=genv,
        )
        # Stage a non-docs code change in the repo.
        with open(os.path.join(self.tmp, "app.py"), "w") as f:
            f.write("print('x')\n")
        subprocess.run(
            ["git", "-C", self.tmp, "add", "app.py"], check=True, capture_output=True
        )
        # Run the gate with git unreachable: PATH holds no git binary, so
        # subprocess.check_output(["git", ...]) raises FileNotFoundError. The
        # gate must fail-closed and block, naming the git failure.
        scrubbed_env = dict(self.env)
        scrubbed_env["PATH"] = ""
        r = _run_gate({"session_id": "sess-orch", "cwd": self.tmp}, scrubbed_env)
        self.assertIn('"decision": "block"', r.stdout)
        self.assertIn("git", r.stdout.lower())

    def _commit_and_make_mixed_diff(self):
        """Satisfy (a)-(f): commit a baseline, then stage a non-docs code change
        AND touch a docs file so drift is cleared but code did change this run."""
        self._satisfy_all_conditions()
        genv = dict(
            os.environ,
            GIT_AUTHOR_NAME="t",
            GIT_AUTHOR_EMAIL="t@t",
            GIT_COMMITTER_NAME="t",
            GIT_COMMITTER_EMAIL="t@t",
        )
        subprocess.run(["git", "init", "-q", self.tmp], check=True, capture_output=True)
        subprocess.run(
            ["git", "-C", self.tmp, "add", "-A"], check=True, capture_output=True
        )
        subprocess.run(
            ["git", "-C", self.tmp, "commit", "-qm", "base"],
            check=True,
            capture_output=True,
            env=genv,
        )
        # non-docs code change (staged) -> code_changed True
        with open(os.path.join(self.tmp, "app.py"), "w") as f:
            f.write("print('x')\n")
        subprocess.run(
            ["git", "-C", self.tmp, "add", "app.py"], check=True, capture_output=True
        )
        # docs change -> drift cleared, so (f) passes and only (g) can block
        with open(os.path.join(self.tmp, ".atlas", "docs", "CHANGELOG.md"), "a") as f:
            f.write("- change\n")

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
        self.assertIn("verifier coverage", r.stdout)
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
        self.assertIn("verifier coverage", r.stdout)
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
        at the `if rid is None` guard (lines 406-407), NOT the DB-error except
        branch. This documents that condition (g) (Law 5 verifier coverage) is
        NOT enforced when a session never started a run: the gate cannot detect
        unpaired dispatches for a run that does not exist, so it silently passes
        and a session that never opened an observability run ships code with
        zero verifier coverage undetected."""
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
        docs = Path(tmp) / ".atlas" / "docs"
        (docs / ".run").mkdir(parents=True, exist_ok=True)
        # Top-level JSON string: not a list, and has no "findings" key. Calling
        # .get() on a str raises AttributeError, which the buggy code swallowed
        # to return True (silently passing condition b). It must return False.
        (docs / ".run" / "findings.json").write_text('"not-a-findings-file"')
        self.assertFalse(_check_findings(docs))


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
        os.makedirs(os.path.join(self.tmp, ".atlas", "docs"), exist_ok=True)
        self.db_path = os.path.join(self.tmp, "atlas.db")
        self.env = dict(os.environ, ATLAS_DB=self.db_path)
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
        docs = os.path.join(self.tmp, ".atlas", "docs")
        os.makedirs(os.path.join(docs, "evidence"), exist_ok=True)
        os.makedirs(os.path.join(docs, ".run"), exist_ok=True)
        with open(os.path.join(docs, "evidence", "run.txt"), "w") as f:
            f.write("observed output")
        with open(os.path.join(docs, ".run", "findings.json"), "w") as f:
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

    def _stage_code_change(self):
        with open(os.path.join(self.tmp, "app.py"), "w") as f:
            f.write("print('x')\n")
        subprocess.run(
            ["git", "-C", self.tmp, "add", "app.py"], check=True, capture_output=True
        )

    def _stage_mixed_diff(self):
        self._stage_code_change()
        with open(os.path.join(self.tmp, ".atlas", "docs", "CHANGELOG.md"), "a") as f:
            f.write("- change\n")

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
        # has .atlas/docs but session_id empty -> non-orchestrating -> no-op).
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
        shutil.rmtree(os.path.join(self.tmp, ".atlas"))
        rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertEqual(rc, 0)
        self.assertNotIn('"decision": "block"', out)

    # -- all-pass + each failing condition (a)-(e) --------------------------

    def test_all_conditions_pass_without_git_repo(self):
        self._satisfy_all()
        # No git repo -> _git_changed_paths returns [] -> drift=False,
        # code_changed=False -> unpaired skipped -> all pass.
        rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertEqual(rc, 0)
        self.assertNotIn('"decision": "block"', out)

    def test_all_conditions_pass_with_git_repo_clean(self):
        self._satisfy_all()
        self._init_git_repo()
        rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertEqual(rc, 0)
        self.assertNotIn('"decision": "block"', out)

    def test_missing_evidence_condition_a(self):
        self._satisfy_all()
        shutil.rmtree(os.path.join(self.tmp, ".atlas", "docs", "evidence"))
        rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertEqual(rc, 0)  # block returns 0
        self.assertIn('"decision": "block"', out)
        self.assertIn("evidence/", out)

    def test_missing_findings_condition_b(self):
        self._satisfy_all()
        os.remove(os.path.join(self.tmp, ".atlas", "docs", ".run", "findings.json"))
        rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertIn('"decision": "block"', out)
        self.assertIn("findings.json", out)

    def test_malformed_findings_blocks_condition_b(self):
        """M1: structurally malformed findings.json must NOT count as verified."""
        self._satisfy_all()
        with open(
            os.path.join(self.tmp, ".atlas", "docs", ".run", "findings.json"), "w"
        ) as f:
            f.write('"not-a-findings-file"')
        rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertIn('"decision": "block"', out)
        self.assertIn("findings.json", out)

    def test_missing_changelog_condition_c(self):
        self._satisfy_all()
        os.remove(os.path.join(self.tmp, ".atlas", "docs", "CHANGELOG.md"))
        rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertIn('"decision": "block"', out)
        self.assertIn("CHANGELOG.md is missing", out)

    def test_missing_roadmap_condition_d(self):
        self._satisfy_all()
        os.remove(os.path.join(self.tmp, ".atlas", "docs", "ROADMAP.md"))
        rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertIn('"decision": "block"', out)
        self.assertIn("ROADMAP.md is missing", out)

    def test_missing_readme_condition_e(self):
        self._satisfy_all()
        os.remove(os.path.join(self.tmp, "README.md"))
        rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertIn('"decision": "block"', out)
        self.assertIn("README.md at the project root is missing", out)

    # -- (f) docs drift + (g) verifier coverage + git fail-closed -----------

    def test_docs_drift_condition_f(self):
        self._satisfy_all()
        self._init_git_repo()
        self._stage_code_change()  # code only, no docs change -> drift
        rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertIn('"decision": "block"', out)
        self.assertIn("Docs drift", out)

    def test_unpaired_implementer_condition_g(self):
        self._satisfy_all()
        self._init_git_repo()
        self._stage_mixed_diff()  # code + docs -> drift cleared, code changed
        self._log_dispatches(implementers=2, verifiers=0)
        rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertIn('"decision": "block"', out)
        self.assertIn("verifier coverage", out)
        self.assertIn("2 implementer", out)

    def test_paired_verifier_no_block_condition_g(self):
        self._satisfy_all()
        self._init_git_repo()
        self._stage_mixed_diff()
        self._log_dispatches(implementers=2, verifiers=2)
        rc, out = self._invoke({"session_id": "sess-orch", "cwd": self.tmp})
        self.assertEqual(rc, 0)
        self.assertNotIn('"decision": "block"', out)

    def test_git_error_fail_closed(self):
        """M2: PATH scrubbed so git raises FileNotFoundError -> gate fails
        closed and blocks naming the git failure rather than silently passing
        drift / Law 5."""
        self._satisfy_all()
        self._init_git_repo()
        self._stage_code_change()
        rc, out = self._invoke(
            {"session_id": "sess-orch", "cwd": self.tmp}, scrub_path=True
        )
        self.assertIn('"decision": "block"', out)
        self.assertIn("git", out.lower())
    def test_outer_catch_all_failopens_on_unexpected_crash(self):
        """GAP-3: an unexpected crash in the gate logic (e.g. _reason raising)
        must fail-open to rc=0 without emitting a block decision, and the
        swallowed error must surface on stderr so the silent allow-through is
        observable in hook logs rather than zero-observability."""
        self._satisfy_all()
        # Fail condition (a) so the gate reaches the block-decision path that
        # calls _reason; then make _reason raise to hit the outer catch-all.
        shutil.rmtree(os.path.join(self.tmp, ".atlas", "docs", "evidence"))
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

    def test_find_ssot_finds_atlas_docs(self):
        tmp = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(tmp, ".atlas", "docs"))
            nested = Path(tmp) / "a" / "b" / "c"
            nested.mkdir(parents=True)
            found = _find_ssot(nested)
            self.assertEqual(found, Path(tmp) / ".atlas" / "docs")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_find_ssot_returns_none_when_absent(self):
        tmp = tempfile.mkdtemp()
        try:
            self.assertIsNone(_find_ssot(Path(tmp)))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_check_evidence_oserror_failopen(self):
        tmp = tempfile.mkdtemp()
        try:
            docs = Path(tmp) / ".atlas" / "docs"
            (docs / "evidence").mkdir(parents=True)  # evidence/ exists so is_dir() True
            with mock.patch.object(Path, "iterdir", side_effect=OSError):
                # (a) fails open on OSError
                from completion_gate import _check_evidence

                self.assertTrue(_check_evidence(docs))
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
            docs = Path(tmp) / ".atlas" / "docs"
            (docs / ".run").mkdir(parents=True)
            (docs / ".run" / "findings.json").write_text("[]")
            with mock.patch.object(Path, "read_text", side_effect=OSError):
                # OSError -> fail open -> True
                self.assertTrue(_check_findings(docs))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_check_findings_dict_with_findings_key(self):
        tmp = tempfile.mkdtemp()
        try:
            docs = Path(tmp) / ".atlas" / "docs"
            (docs / ".run").mkdir(parents=True)
            (docs / ".run" / "findings.json").write_text(
                json.dumps({"findings": [{"status": "verified"}]})
            )
            self.assertTrue(_check_findings(docs))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_check_findings_no_verified_entry(self):
        tmp = tempfile.mkdtemp()
        try:
            docs = Path(tmp) / ".atlas" / "docs"
            (docs / ".run").mkdir(parents=True)
            (docs / ".run" / "findings.json").write_text(
                json.dumps([{"status": "unverified"}])
            )
            self.assertFalse(_check_findings(docs))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_git_changed_paths_non_repo_returns_empty(self):
        tmp = tempfile.mkdtemp()
        try:
            docs = Path(tmp) / ".atlas" / "docs"
            docs.mkdir(parents=True)
            # Not a git repo -> rev-parse fails (non-FileNotFoundError) -> []
            self.assertEqual(_git_changed_paths(docs), [])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_git_changed_paths_real_repo(self):
        tmp = tempfile.mkdtemp()
        try:
            subprocess.run(["git", "init", "-q", tmp], check=True, capture_output=True)
            docs = Path(tmp) / ".atlas" / "docs"
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
            changed = _git_changed_paths(docs)
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


if __name__ == "__main__":
    unittest.main()
