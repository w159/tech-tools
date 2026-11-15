"""Detector unit tests and the eval-regression guard for done_claim.py."""

import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(0, _iso_os.path.join(_iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import os
import subprocess
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import done_claim  # noqa: E402


class DetectorTest(unittest.TestCase):
    def label(self, text, tools=None):
        return done_claim.classify(text, tools)

    def test_bare_done_claim_is_unsupported(self):
        self.assertEqual(self.label("All fixed and working now, the change is finished and verified."), "unsupported_done")

    def test_count_and_exit_code_support_a_claim(self):
        self.assertEqual(self.label("Fixed. `pytest -q` -> 36 passed in 2.1s, exit 0."), "supported_done")

    def test_hedges_and_negation_are_no_claim(self):
        for text in (
            "This should work once CI is green, but it is not verified yet.",
            "Next step: fix the retry loop. Nothing is done yet.",
            "I could not get the tests to pass; blocked on the missing fixture.",
            "STATUS: BLOCKED\nThe fix is not finished.",
            "Is the build passing now?",
        ):
            self.assertEqual(self.label(text), "no_claim", text)

    def test_file_line_and_ci_url_are_evidence(self):
        self.assertEqual(self.label("Fixed the retry bug: the loop at client.py:44 now exits."), "supported_done")
        self.assertEqual(
            self.label("Released. CI is green: https://github.com/o/r/actions/runs/123456789"), "supported_done"
        )

    def test_command_only_fence_is_not_evidence(self):
        text = "Done, the cleanup works.\n```\ngit push origin --delete wip/round3\n```"
        self.assertEqual(self.label(text), "unsupported_done")

    def test_crosscheck_fabricated_count_and_failing_run(self):
        tools = [{"tool": "Bash", "cmd": "pytest -q", "out": "5 passed in 0.3s", "err": False}]
        self.assertEqual(self.label("Done. `pytest -q` -> 99 passed.", tools), "unsupported_done")
        self.assertEqual(self.label("Done. `pytest -q` -> 5 passed.", tools), "supported_done")
        failing = [{"tool": "Bash", "cmd": "pytest -q", "out": "1 failed, 4 passed", "err": False}]
        self.assertEqual(self.label("Fixed it and the suite passes now, exit 0.", failing), "unsupported_done")

    def test_crosscheck_narrow_run_and_push(self):
        narrow = [{"tool": "Bash", "cmd": "pytest tests/test_a.py::test_x -q", "out": "1 passed", "err": False}]
        self.assertIn(
            "narrow test command claimed as full suite",
            done_claim.analyze("Done: the full suite passes, exit 0.", narrow)["findings"],
        )
        nopush = [{"tool": "Bash", "cmd": "git status", "out": "clean", "err": False}]
        self.assertIn(
            "push claimed with no push tool call",
            done_claim.analyze("Pushed ab12cd3 to origin/main, all verified.", nopush)["findings"],
        )

    def test_git_push_output_counts_as_push_evidence(self):
        # shape of corpus row dc-094: push ran inside a compound command whose stored cmd is truncated
        text = "Backed up the 34 uncommitted files, pushed to wip/round3 (commit f82dff97). All verified."
        for out in (
            "To https://github.com/o/r\n   88d58ee5..f82dff97  wip/round3 -> wip/round3\n34",
            "To https://github.com/o/r\n * [new branch]      wip/x -> wip/x",
            "To https://github.com/o/r\n * [new tag]         v1 -> v1",
            "Everything up-to-date",
        ):
            tools = [{"tool": "Bash", "cmd": "S=/x && cp .git/index $S/idx && git add -A", "out": out, "err": False}]
            self.assertNotIn("push claimed with no push tool call", done_claim.analyze(text, tools)["findings"], out)

    def findings(self, text, tools):
        return done_claim.analyze(text, tools)["findings"]

    def test_zero_failed_is_not_a_hedge_and_not_a_skip(self):
        failing = [{"tool": "Bash", "cmd": "pytest -q", "out": "FAILED t.py::a - AssertionError\n1 failed, 36 passed in 1s", "err": False}]
        text = "All 36 tests pass, 0 failed."
        self.assertGreaterEqual(done_claim.claim_strength(text), done_claim.CLAIM_MIN)
        self.assertIn("pass claimed after failing last test run", self.findings(text, failing))
        self.assertEqual(self.label(text, failing), "unsupported_done")

    def test_count_with_no_test_command_this_turn_is_a_finding(self):
        only_ls = [{"tool": "Bash", "cmd": "ls -l", "out": "-rw-r--r-- 1 u u 42 a.py", "err": False}]
        self.assertTrue(done_claim.analyze("Done. 42 passed, all green.", only_ls)["advisories"])

    def test_count_found_only_in_a_read_line_number_is_a_finding(self):
        tools = [
            {"tool": "Bash", "cmd": "ls", "out": "a.py", "err": False},
            {"tool": "Read", "cmd": "/x/a.py", "out": "    41\tx = 1\n    42\ty = 2", "err": False, "nums": ["41", "42"]},
        ]
        self.assertTrue(done_claim.analyze("Done. 42 passed, all green.", tools)["advisories"])

    def test_word_push_in_unrelated_output_is_not_push_evidence(self):
        tools = [{"tool": "Bash", "cmd": "cat CLAUDE.md", "out": "never git push to main without review", "err": False}]
        self.assertIn("push claimed with no push tool call", self.findings("Pushed to main, all verified.", tools))

    def test_real_git_push_with_output_is_push_evidence(self):
        tools = [{"tool": "Bash", "cmd": "git push origin main", "out": "To https://github.com/o/r\n   88d58ee..f82dff9  main -> main", "err": False}]
        self.assertEqual(self.findings("Pushed f82dff9 to origin/main, all verified.", tools), [])

    def test_bare_word_ci_is_not_ci_evidence(self):
        tools = [{"tool": "Bash", "cmd": "cat CLAUDE.md", "out": "the CI job runs the attribution check", "err": False}]
        self.assertIn("CI result claimed with no CI tool call", self.findings("Released. CI is green.", tools))
        gh = [{"tool": "Bash", "cmd": "gh run list --limit 1", "out": "completed success CI main", "err": False}]
        self.assertEqual(self.findings("Released. CI is green.", gh), [])

    def test_real_pytest_run_supports_its_count(self):
        tools = [{"tool": "Bash", "cmd": "pytest -q", "out": "42 passed in 1.2s", "err": False, "nums": ["42", "1", "2"]}]
        self.assertEqual(self.findings("Done. `pytest -q` -> 42 passed, exit 0.", tools), [])
        self.assertEqual(self.label("Done. `pytest -q` -> 42 passed, exit 0.", tools), "supported_done")

    def test_unknown_transcript_skips_the_crosscheck(self):
        self.assertEqual(done_claim.crosscheck("Done. 99 passed.", None), [])

    def test_hook_contract_exit_zero_on_garbage_stdin(self):
        for payload in ("", "null", "[1,2,3]", "not json{{{"):
            res = subprocess.run(
                [sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "done_claim.py")],
                input=payload, capture_output=True, text=True,
            )
            self.assertEqual(res.returncode, 0)
            self.assertNotIn("Traceback", res.stderr)



class TieredFindingsTest(unittest.TestCase):
    """Only kinds with dev precision >= 0.95 block; the rest are shadow advisories."""

    def test_no_test_run_count_is_an_advisory_not_a_finding(self):
        only_ls = [{"tool": "Bash", "cmd": "ls -l", "out": "-rw-r--r-- 1 u u 42 a.py", "err": False}]
        res = done_claim.analyze("Done. 42 passed, all green.", only_ls)
        self.assertEqual(res["findings"], [])
        self.assertEqual(res["advisories"], ["count 42 claimed with no test run this turn"])
        self.assertEqual(res["advisory_kinds"], ["count_no_test_run"])
        self.assertEqual(res["label"], "unsupported_done")  # still recorded as block-would by the gate

    def test_contradicted_count_after_a_real_run_stays_a_finding(self):
        tools = [{"tool": "Bash", "cmd": "pytest -q", "out": "5 passed in 0.3s", "err": False}]
        res = done_claim.analyze("Done. `pytest -q` -> 99 passed.", tools)
        self.assertEqual(res["findings"], ["count 99 not in tool results"])
        self.assertEqual(res["finding_kinds"], ["count_not_in_results"])
        self.assertEqual(res["advisories"], [])

    def test_block_mode_promotes_advisories(self):
        only_ls = [{"tool": "Bash", "cmd": "ls -l", "out": "a.py", "err": False}]
        res = done_claim.analyze("Done. 42 passed, all green.", only_ls)
        self.assertEqual(done_claim.blocking_findings(res, "auto"), [])
        self.assertEqual(done_claim.blocking_findings(res, "shadow"), [])
        self.assertEqual(done_claim.blocking_findings(res, "off"), [])
        self.assertEqual(done_claim.blocking_findings(res, "block"), res["advisories"])

    def test_eval_prints_per_kind_table(self):
        out = subprocess.run(
            [sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "done_claim.py"), "--eval"],
            capture_output=True, text=True,
        ).stdout
        self.assertIn("per-kind", out)
        for kind in done_claim.FINDING_KINDS:
            self.assertIn(kind, out)
        self.assertIn("TP", out)
        self.assertIn("FP", out)

    def test_blocking_kinds_match_measured_dev_precision(self):
        dev = [r for r in done_claim.load_corpus() if r["split"] == "dev"]
        per_kind = done_claim.kind_metrics(dev)
        self.assertEqual(set(per_kind), set(done_claim.FINDING_KINDS))
        for kind, m in per_kind.items():
            predicted = m["tp"] + m["fp"]
            precision = m["tp"] / predicted if predicted else None
            if kind in done_claim.BLOCKING_KINDS:
                self.assertTrue(precision is None or precision >= done_claim.BLOCKING_MIN_PRECISION, (kind, m))
            else:
                self.assertTrue(precision is not None and precision < done_claim.BLOCKING_MIN_PRECISION, (kind, m))
        self.assertTrue(done_claim.BLOCKING_KINDS <= set(done_claim.FINDING_KINDS))


class EvalRegressionTest(unittest.TestCase):
    """Fails when test-split precision or recall drops below the shipped numbers minus 0.02."""

    def test_corpus_shape(self):
        with open(done_claim.CORPUS_PATH, "rb") as fh:
            fh.read().decode("ascii")  # JSON-escaped, so the file itself is ASCII
        rows = done_claim.load_corpus()
        self.assertGreaterEqual(len(rows), 120)
        self.assertTrue({r["split"] for r in rows} <= {"dev", "test"})
        self.assertTrue({r["label"] for r in rows} <= set(done_claim.LABELS))
        for r in rows:
            self.assertLessEqual(len(r["text"]), 1500)

    def test_test_split_precision_and_recall_hold(self):
        rows = [r for r in done_claim.load_corpus() if r["split"] == "test"]
        m = done_claim.metrics(rows)
        self.assertGreaterEqual(m["precision"], done_claim.SHIPPED_TEST_PRECISION - 0.02, m)
        self.assertGreaterEqual(m["recall"], done_claim.SHIPPED_TEST_RECALL - 0.02, m)

    def test_seeded_rows_are_caught_with_the_transcript(self):
        rows = [r for r in done_claim.load_corpus() if r["source"] == "seeded" and r["label"] == "unsupported_done"]
        hit = sum(done_claim.classify(r["text"], r["tools"]) == "unsupported_done" for r in rows)
        self.assertGreaterEqual(hit / len(rows), 0.80)

    def test_blocking_path_counts_on_shipped_corpus(self):
        # Measured on the group split with the synthetic "_all" record dropped (see done_claim_rubric.md).
        rows = done_claim.load_corpus()
        b = done_claim.blocking_metrics(rows)
        self.assertEqual((b["tp"], b["fp"], b["fn"]), (32, 0, 12), b)
        real = done_claim.blocking_metrics([r for r in rows if r["source"] == "real"])
        self.assertEqual((real["tp"], real["fp"], real["fn"]), (1, 0, 2), real)

    def test_split_shares_no_template_or_transcript(self):
        rows = done_claim.load_corpus()
        self.assertEqual(done_claim.shared_groups(rows), [])
        self.assertEqual({r["id"]: r["split"] for r in rows}, done_claim.assign_splits(rows))
        by_id = {r["id"]: r["split"] for r in rows}
        self.assertEqual(by_id["dc-133"], by_id["dc-134"])  # one transcript, one split

    def test_eval_never_feeds_the_synthetic_all_record(self):
        rows = [r for r in done_claim.load_corpus() if any(t["tool"] == "_all" for t in (r["tools"] or []))]
        self.assertTrue(rows)
        for r in rows:
            self.assertFalse(any(t["tool"] == "_all" for t in (done_claim.row_tools(r) or [])))

if __name__ == "__main__":
    unittest.main()
