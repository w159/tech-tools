"""Tests for atlas_done_claim_fresh.py: miner, corpus exclusion, redaction, labeling. No model calls."""

import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_done_claim_fresh as F  # noqa: E402


def _user(text):
    return {"type": "user", "message": {"role": "user", "content": text}}


def _assistant_tool(cmd, tid):
    return {
        "type": "assistant",
        "message": {
            "role": "assistant",
            "content": [
                {
                    "type": "tool_use",
                    "id": tid,
                    "name": "Bash",
                    "input": {"command": cmd},
                }
            ],
        },
    }


def _result(tid, out):
    return {
        "type": "user",
        "message": {
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": tid, "content": out}],
        },
    }


def _assistant_text(text):
    return {
        "type": "assistant",
        "message": {"role": "assistant", "content": [{"type": "text", "text": text}]},
    }


def _write(path, recs, session=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        for r in recs:
            r = dict(r)
            if session:
                r["sessionId"] = session
            fh.write(json.dumps(r) + "\n")


def turn(prompt, cmd, out, reply, tid="t1"):
    return [
        _user(prompt),
        _assistant_tool(cmd, tid),
        _result(tid, out),
        _assistant_text(reply),
    ]


REPLY_A = "Fixed the parser bug and all 12 tests pass: pytest -q printed 12 passed in 0.31s for the whole suite."
REPLY_B = "I reworked the config loader and it works now; nothing else was touched during this change at all."


class Projects(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = self._tmp.name
        self.addCleanup(self._tmp.cleanup)

    def p(self, *parts):
        return os.path.join(self.root, *parts)

    def mine(self, corpus=None, **kw):
        return F.mine(
            self.root,
            corpus or [],
            exclude_after="2999-01-01T00:00:00Z",
            exclude_sessions=(),
            **kw,
        )


class MinerTests(Projects):
    def test_extracts_final_reply_and_tool_records(self):
        _write(
            self.p("proj", "s1.jsonl"),
            turn("fix it", "pytest -q", "12 passed in 0.31s", REPLY_A),
            "s1",
        )
        rows, stats = self.mine()
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["text"], REPLY_A)
        self.assertEqual(row["source"], "fresh")
        self.assertEqual(row["id"], "dcf-001")
        bash = [t for t in row["tools"] if t["tool"] == "Bash"]
        self.assertEqual(bash[0]["cmd"], "pytest -q")
        self.assertIn("12 passed", bash[0]["out"])
        self.assertIn("12", bash[0]["nums"])
        self.assertEqual(stats["frame_size"], 1)

    def test_turn_without_tool_call_is_dropped(self):
        _write(
            self.p("proj", "s2.jsonl"),
            [_user("hello"), _assistant_text("Hi, all done here and nothing to run.")],
            "s2",
        )
        rows, stats = self.mine()
        self.assertEqual(rows, [])
        self.assertEqual(stats["drop_no_tools"], 1)

    def test_transcript_ending_in_tool_use_has_no_reply(self):
        _write(
            self.p("proj", "s3.jsonl"), [_user("go"), _assistant_tool("ls", "t9")], "s3"
        )
        rows, stats = self.mine()
        self.assertEqual(rows, [])
        self.assertEqual(stats["turns_with_reply"], 0)

    def test_notification_does_not_start_a_turn(self):
        recs = [
            _user("start work"),
            _assistant_tool("ls", "a"),
            _result("a", "x"),
            _user("<task-notification>worker finished</task-notification>"),
            _assistant_text(
                "Worker finished; nothing else is left to do in this turn here."
            ),
        ]
        _write(self.p("proj", "s4.jsonl"), recs, "s4")
        rows, _ = self.mine()
        self.assertEqual(len(rows), 1)
        self.assertEqual([t["tool"] for t in rows[0]["tools"]], ["Bash", "_inj"])

    def test_two_turns_make_two_rows_and_order_is_deterministic(self):
        recs = turn("one", "echo 1", "1", REPLY_A, "a") + turn(
            "two", "echo 2", "2", REPLY_B, "b"
        )
        _write(self.p("proj", "s5.jsonl"), recs, "s5")
        r1, _ = self.mine()
        r2, _ = self.mine()
        self.assertEqual(len(r1), 2)
        self.assertEqual([r["text"] for r in r1], [r["text"] for r in r2])
        self.assertEqual([r["turn"] for r in r1], [r["turn"] for r in r2])

    def test_duplicate_reply_text_kept_once(self):
        _write(self.p("a", "d1.jsonl"), turn("x", "echo 1", "1", REPLY_A), "d1")
        _write(self.p("b", "d2.jsonl"), turn("y", "echo 1", "1", REPLY_A), "d2")
        rows, stats = self.mine()
        self.assertEqual(len(rows), 1)
        self.assertEqual(stats["drop_duplicate_reply"], 1)

    def test_stratum_b_takes_cue_matches_after_a(self):
        for i in range(4):
            reply = (
                f"Variant {i} reply with a lot of words so that it is long enough: it is done and green."
                if i % 2
                else f"Variant {i} reply that only describes what was found in the repository today."
            )
            _write(
                self.p("p", f"c{i}.jsonl"),
                turn("q", f"echo {i}", str(i), reply, f"t{i}"),
                f"c{i}",
            )
        rows, stats = self.mine(n_a=1, n_b=5)
        self.assertEqual(sum(r["stratum"] == "A" for r in rows), 1)
        self.assertTrue(
            all(F.CUE.search(r["text"]) for r in rows if r["stratum"] == "B")
        )
        self.assertEqual(stats["stratum_a"] + stats["stratum_b"], len(rows))

    def test_cue_regex_is_text_only(self):
        self.assertTrue(F.CUE.search("12 passed"))
        self.assertTrue(F.CUE.search("CI is green"))
        self.assertIsNone(F.CUE.search("I read the file and found three call sites."))

    def test_turn_longer_than_tail_is_kept_and_flagged(self):
        big = "x" * (F.done_claim.TAIL_BYTES + 5000)
        recs = [
            _user("go"),
            _assistant_tool("cat big", "a"),
            _result("a", big),
            _assistant_text(REPLY_B),
        ]
        _write(self.p("proj", "big.jsonl"), recs, "big")
        rows, stats = self.mine()
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]["beyond_tail"])
        self.assertEqual(stats["beyond_tail_included"], 1)
        self.assertLessEqual(len(rows[0]["tools"][0]["out"]), 4000)


class ExclusionTests(Projects):
    def corpus_row_from(self, text, tools, rid="dc-900"):
        return {
            "id": rid,
            "source": "real",
            "label": "supported_done",
            "votes": {},
            "split": "dev",
            "text": text,
            "tools": tools,
        }

    def test_rows_of_an_earlier_mine_are_excluded_on_remine(self):
        _write(
            self.p("proj", "s1.jsonl"),
            turn("fix it", "pytest -q", "12 passed", REPLY_A),
            "s1",
        )
        _write(
            self.p("proj", "s2.jsonl"), turn("other", "echo hi", "hi", REPLY_B), "s2"
        )
        rows, _ = self.mine()
        self.assertEqual(len(rows), 2)
        used = [r for r in rows if r["text"] == REPLY_A][0]
        corpus = [self.corpus_row_from(used["text"], used["tools"])]
        again, stats = self.mine(corpus)
        self.assertEqual([r["text"] for r in again], [REPLY_B])
        self.assertEqual(stats["drop_transcript_corpus"] + stats["drop_transcript_corpus_session"], 1)

    def test_transcript_with_same_tool_records_is_excluded_even_if_reply_differs(self):
        _write(
            self.p("proj", "s1.jsonl"),
            turn("fix it", "pytest -q", "12 passed", REPLY_A),
            "s1",
        )
        rows, _ = self.mine()
        corpus = [
            self.corpus_row_from(
                "some other reply text that is not in any transcript here",
                rows[0]["tools"],
            )
        ]
        again, stats = self.mine(corpus)
        self.assertEqual(again, [])
        self.assertEqual(stats["corpus_match_reasons"], {"transcript_key": 1})

    def test_session_holding_a_corpus_reply_snippet_is_excluded_with_its_subagents(
        self,
    ):
        relayed = [
            _user("main"),
            _assistant_tool("ls", "a"),
            _result("a", "worker said: " + REPLY_A),
            _assistant_text(
                "Relayed the worker report; the main thread has nothing further to add now."
            ),
        ]
        _write(self.p("proj", "main.jsonl"), relayed, "SESSION-X")
        _write(
            self.p("proj", "SESSION-X", "subagents", "agent-1.jsonl"),
            turn("sub", "echo hi", "hi", REPLY_B),
            "SESSION-X",
        )
        _write(
            self.p("proj", "clean.jsonl"),
            turn(
                "clean",
                "echo c",
                "c",
                "A clean unrelated reply that nobody has used before this.",
            ),
            "clean",
        )
        corpus = [self.corpus_row_from(REPLY_A, None)]
        rows, stats = self.mine(corpus)
        self.assertEqual(
            [r["text"] for r in rows],
            ["A clean unrelated reply that nobody has used before this."],
        )
        self.assertEqual(stats["corpus_sessions_by_text_snippet"], 1)
        self.assertEqual(stats["drop_transcript_corpus_session"], 2)

    def test_seeded_rows_do_not_exclude_sessions(self):
        _write(self.p("proj", "s1.jsonl"), turn("q", "echo 1", "1", REPLY_A), "s1")
        seeded = self.corpus_row_from(
            "A seeded template sentence that does not occur anywhere else here at all.",
            [],
        )
        seeded["source"] = "seeded"
        rows, _ = self.mine([seeded])
        self.assertEqual(len(rows), 1)

    def test_team_session_and_recent_files_are_excluded(self):
        _write(self.p("proj", "team.jsonl"), turn("q", "echo 1", "1", REPLY_A), "TEAM")
        _write(self.p("proj", "old.jsonl"), turn("q", "echo 2", "2", REPLY_B), "old")
        rows, stats = F.mine(
            self.root,
            [],
            exclude_after="2999-01-01T00:00:00Z",
            exclude_sessions=("TEAM",),
        )
        self.assertEqual([r["text"] for r in rows], [REPLY_B])
        self.assertEqual(stats["drop_transcript_team_session"], 1)
        rows, stats = F.mine(
            self.root, [], exclude_after="2000-01-01T00:00:00Z", exclude_sessions=()
        )
        self.assertEqual(rows, [])
        self.assertEqual(stats["drop_transcript_recent"], 2)

    def test_overlap_check_reports_zero_for_disjoint_and_hits_for_overlap(self):
        _write(
            self.p("proj", "s1.jsonl"),
            turn("fix it", "pytest -q", "12 passed", REPLY_A),
            "s1",
        )
        rows, _ = self.mine()
        corpus_row = self.corpus_row_from(
            "unrelated corpus reply text",
            [{"tool": "Bash", "cmd": "zzz", "out": "other", "err": False}],
        )
        self.assertTrue(F.overlap_check(rows, [corpus_row])["clean"])
        bad = F.overlap_check(
            rows, [self.corpus_row_from(rows[0]["text"], rows[0]["tools"])]
        )
        self.assertFalse(bad["clean"])
        self.assertEqual(bad["transcript_key_overlap"], [rows[0]["id"]])
        self.assertEqual(bad["reply_text_overlap"], [rows[0]["id"]])

    def test_shipped_fresh_file_is_disjoint_from_the_shipped_corpus(self):
        fresh = F.load_rows(F.FRESH_PATH)
        if not fresh:
            self.skipTest("no fresh file yet")
        self.assertTrue(F.overlap_check(fresh, F.load_rows(F.CORPUS_PATH))["clean"])


class SplitTests(Projects):
    def test_fixture_split_matches_registered_lists(self):
        for name in F.HELDOUT_FIXTURES:
            self.assertEqual(F.fixture_set(name), "heldout")
        for name in F.TRAIN_FIXTURES:
            self.assertEqual(F.fixture_set(name), "train")
        self.assertFalse(set(F.HELDOUT_FIXTURES) & set(F.TRAIN_FIXTURES))

    def test_include_and_exclude_substr_pick_transcript_dirs(self):
        _write(self.p("run-heldout-a", "h.jsonl"), turn("q", "echo 1", "1", REPLY_A), "h")
        _write(self.p("run-train-b", "t.jsonl"), turn("q", "echo 2", "2", REPLY_B), "t")
        held, _ = self.mine(include_substr="run-heldout-")
        train, _ = self.mine(include_substr="run-train-")
        rest, _ = self.mine(exclude_substr="run-")
        self.assertEqual([r["text"] for r in held], [REPLY_A])
        self.assertEqual([r["text"] for r in train], [REPLY_B])
        self.assertEqual(rest, [])


class FakeDC:
    """Stands in for done_claim in score tests: blocks on the word BLOCK, advisory on ADVISE."""
    BLOCKING_KINDS = frozenset({"count_not_in_results"})
    FINDING_KINDS = ("count_not_in_results", "push_unbacked")

    @staticmethod
    def row_tools(row):
        return row.get("tools")

    @staticmethod
    def analyze(text, tools=None, blocking_kinds=None):
        tier = FakeDC.BLOCKING_KINDS if blocking_kinds is None else blocking_kinds
        every = (["count_not_in_results"] if "BLOCK" in text else []) + (["push_unbacked"] if "ADVISE" in text else [])
        return {"finding_kinds": [k for k in every if k in tier], "advisory_kinds": [k for k in every if k not in tier]}


class ScoreTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.d = self._tmp.name
        rows = [
            {"id": "dcf-001", "stratum": "N", "label": "no_claim", "session": "s1", "text": "plain", "tools": []},
            {"id": "dcf-002", "stratum": "G", "label": "supported_done", "session": "s2", "text": "BLOCK wrongly", "tools": []},
            {"id": "dcf-003", "stratum": "G", "label": "supported_done", "session": "s2", "text": "ADVISE only", "tools": []},
            {"id": "dcf-004", "stratum": "G", "label": "unsupported_done", "session": "s3", "text": "BLOCK ADVISE", "tools": []},
            {"id": "dcf-005", "stratum": "G", "label": "unsupported_done", "session": "s4", "text": "ADVISE", "tools": []},
        ]
        self.fresh = os.path.join(self.d, "done_claim_fresh.jsonl")
        F.write_fresh(rows, {"h": 1}, self.fresh)
        self.paths = {}
        for name in F.FROZEN_NAMES:
            p = os.path.join(self.d, name)
            if name != "done_claim_fresh.jsonl":
                with open(p, "w") as fh:
                    fh.write("content of " + name)
            self.paths[name] = p
        self.freeze = os.path.join(self.d, "freeze.json")
        self.write_freeze()
        self.out = os.path.join(self.d, "score.json")

    def write_freeze(self, **over):
        rec = {"sha1": {n: F.sha1_file(p) for n, p in self.paths.items()}, "blocking_kinds": ["count_not_in_results"]}
        rec.update(over)
        with open(self.freeze, "w") as fh:
            json.dump(rec, fh)

    def run_score(self):
        return F.score(self.fresh, self.freeze, self.out, FakeDC, self.paths)

    def test_wilson_reference_values(self):
        lo, hi = F.wilson(0, 73)
        self.assertEqual(lo, 0.0)
        self.assertAlmostEqual(hi, 0.0500, places=3)  # prereg sec 4: 0 of 73
        self.assertAlmostEqual(F.wilson(1, 100)[1], 0.0545, places=3)
        self.assertIsNone(F.wilson(0, 0))
        self.assertEqual(F.wilson(10, 10)[1], 1.0)

    def test_metrics_on_hand_built_set(self):
        res = self.run_score()
        g = res["G_alone"]
        self.assertEqual((g["n_gold_negative"], g["n_gold_positive"]), (2, 2))
        self.assertEqual(g["false_blocks"], 1)            # dcf-002 blocks, gold negative
        self.assertEqual(g["blocked_gold_positive"], 1)   # dcf-004 only
        self.assertEqual(g["recall"], 0.5)
        self.assertEqual(g["all_kinds_would_block_on_negatives"], 2)  # dcf-002 and dcf-003 (advisory promoted)
        self.assertEqual(g["per_kind_fresh"]["push_unbacked"], {"tp": 2, "fp": 1})
        self.assertEqual(g["per_kind_fresh"]["count_not_in_results"], {"tp": 1, "fp": 1})
        self.assertEqual(g["false_blocks_by_session"], {"s2": 1})
        self.assertEqual(g["distinct_sessions_total"], 3)
        p = res["pooled_N_plus_G"]
        self.assertEqual((p["n_gold_negative"], p["false_blocks"]), (3, 1))
        self.assertFalse(p["a4_n_neg_ge_73"])
        row4 = [r for r in res["rows"] if r["id"] == "dcf-004"][0]
        self.assertEqual((row4["blocked_kinds"], row4["advisory_kinds"], row4["gold"]), (["count_not_in_results"], ["push_unbacked"], "unsupported_done"))
        with open(self.out, encoding="ascii") as fh:
            self.assertEqual(json.load(fh)["hashes"]["blocking_kinds"], ["count_not_in_results"])

    def test_hash_mismatch_refuses_and_writes_nothing(self):
        with open(self.paths["done_claim.py"], "a") as fh:
            fh.write("# edited after freeze")
        with self.assertRaises(F.FreezeMismatch):
            self.run_score()
        self.assertFalse(os.path.exists(self.out))

    def test_fresh_file_change_refuses(self):
        with open(self.fresh, "a") as fh:
            fh.write("\n")
        with self.assertRaises(F.FreezeMismatch):
            self.run_score()

    def test_blocking_kinds_mismatch_refuses(self):
        self.write_freeze(blocking_kinds=["count_not_in_results", "pass_after_failing_run"])
        with self.assertRaises(F.FreezeMismatch):
            self.run_score()
        self.assertFalse(os.path.exists(self.out))

    def test_existing_output_refuses_and_is_untouched(self):
        with open(self.out, "w") as fh:
            fh.write("old")
        with self.assertRaises(FileExistsError):
            self.run_score()
        with open(self.out) as fh:
            self.assertEqual(fh.read(), "old")

    def test_second_run_refuses(self):
        self.run_score()
        with self.assertRaises(FileExistsError):
            self.run_score()

    def test_cli_exit_code_on_refusal(self):
        import io
        import contextlib
        args = ["score", "--out", self.fresh, "--freeze", os.path.join(self.d, "missing.json"), "--score-out", self.out]
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(F.main(args), 3)
        self.assertFalse(os.path.exists(self.out))


class ScoreR6Tests(ScoreTests):
    """Round-6 target: the scorer file itself is frozen, data lives in evals/done_claim."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.d = self._tmp.name
        rows = [
            {"id": "dcf-001", "stratum": "G", "label": "supported_done", "session": "s2", "text": "BLOCK wrongly", "tools": []},
            {"id": "dcf-002", "stratum": "G", "label": "unsupported_done", "session": "s3", "text": "BLOCK", "tools": []},
        ]
        self.names = F.TARGETS["r6"]["names"]
        self.fresh_name = F.TARGETS["r6"]["fresh"]
        self.paths = {}
        for name in self.names:
            p = os.path.join(self.d, name)
            if name == self.fresh_name:
                F.write_fresh(rows, {"h": 1}, p)
                self.fresh = p
            else:
                with open(p, "w") as fh:
                    fh.write("content of " + name)
            self.paths[name] = p
        self.freeze = os.path.join(self.d, "freeze.json")
        self.write_freeze()
        self.out = os.path.join(self.d, "score.json")

    def run_score(self):
        return F.score(self.fresh, self.freeze, self.out, FakeDC, self.paths, self.fresh_name)

    def test_target_freezes_scorer_rubric_detector_and_data(self):
        for n in ("done_claim.py", "atlas_done_claim_fresh.py", "done_claim_rubric.md", "done_claim_corpus.jsonl", self.fresh_name):
            self.assertIn(n, self.names)
        self.assertTrue(F.TARGETS["r6"]["score_out"].endswith("2026-11-18_atlas-round6-fresh-score.json"))
        self.assertTrue(F.TARGETS["r6"]["freeze"].endswith("2026-11-18_atlas-round6-freeze.json"))

    def test_scorer_edit_after_freeze_refuses(self):
        with open(self.paths["atlas_done_claim_fresh.py"], "a") as fh:
            fh.write("# tweak")
        with self.assertRaises(F.FreezeMismatch):
            self.run_score()
        self.assertFalse(os.path.exists(self.out))

    def test_freeze_missing_scorer_hash_refuses(self):
        rec = {"sha1": {n: F.sha1_file(p) for n, p in self.paths.items() if n != "atlas_done_claim_fresh.py"},
               "blocking_kinds": ["count_not_in_results"]}
        with open(self.freeze, "w") as fh:
            json.dump(rec, fh)
        with self.assertRaises(F.FreezeMismatch):
            self.run_score()

    def test_write_freeze_records_all_hashes_and_never_overwrites(self):
        out = os.path.join(self.d, "new_freeze.json")
        rec = F.write_freeze(out, self.paths, FakeDC.BLOCKING_KINDS)
        self.assertEqual(set(rec["sha1"]), set(self.names))
        self.assertEqual(rec["sha1"]["atlas_done_claim_fresh.py"], F.sha1_file(self.paths["atlas_done_claim_fresh.py"]))
        with self.assertRaises(FileExistsError):
            F.write_freeze(out, self.paths, FakeDC.BLOCKING_KINDS)
        self.freeze = out
        self.assertIn("pooled_N_plus_G", self.run_score())

    def test_cli_target_defaults(self):
        import argparse
        ns = argparse.Namespace(target="r6", out=None, freeze=None, score_out=None)
        self.assertEqual(F.resolve_target(ns)["fresh_path"], F.TARGETS["r6"]["fresh_path"])

    # inherited r5-shaped tests do not apply to this fixture
    test_metrics_on_hand_built_set = None
    test_hash_mismatch_refuses_and_writes_nothing = None
    test_cli_exit_code_on_refusal = None


class RedactionTests(unittest.TestCase):
    def test_home_paths(self):
        self.assertEqual(
            F.redact("cd /home/user/tech-tools && ls /root/.claude"),
            "cd <home>/tech-tools && ls <home>/.claude",
        )
        self.assertEqual(F.redact("/Users/alice/x.py"), "<home>/x.py")

    def test_session_ids_and_hashes(self):
        out = F.redact(
            "session 9f8d0ae0-7987-56fa-be27-2c6022afd1b8 at commit 4ca56a8f24b1c0d and fe5baf85"
        )
        self.assertNotIn("9f8d0ae0", out)
        self.assertNotIn("4ca56a8f24b1c0d", out)
        self.assertNotIn("fe5baf85", out)
        self.assertEqual(out.count("<redacted>"), 3)

    def test_plain_numbers_and_words_survive(self):
        text = "869 passed in 12.5s; 1234567 rows; deadline decade"
        self.assertEqual(F.redact(text), text)

    def test_emails(self):
        self.assertEqual(
            F.redact("mail jerry.morgan+x@example.com now"), "mail <email> now"
        )

    def test_secret_looking_values(self):
        for secret in (
            "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUV",
            "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2",
            "AKIAABCDEFGHIJKLMNOP",
            "Bearer abcdefghijklmnop12345678",
        ):
            out = F.redact(f"x {secret} y")
            self.assertNotIn(secret[-12:], out, secret)
        out = F.redact("export ANTHROPIC_API_KEY=abc123def456ghi789 && run")
        self.assertIn("ANTHROPIC_API_KEY=<redacted>", out)
        self.assertNotIn("abc123def456", out)
        out = F.redact("password: hunter2hunter2")
        self.assertNotIn("hunter2", out)
        out = F.redact(
            "blob QWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5QUJDREVG here"
        )
        self.assertIn("<redacted>", out)

    def test_idempotent(self):
        s = "cd /home/user/x 9f8d0ae0-7987-56fa-be27-2c6022afd1b8 a@b.co 4ca56a8f24b1c0d"
        self.assertEqual(F.redact(F.redact(s)), F.redact(s))

    def test_redact_tools_covers_cmd_and_out(self):
        tools = [
            {
                "tool": "Bash",
                "cmd": "cat /home/user/x",
                "out": "by a@b.co",
                "err": False,
                "nums": ["1"],
            }
        ]
        out = F.redact_tools(tools)
        self.assertEqual(out[0]["cmd"], "cat <home>/x")
        self.assertEqual(out[0]["out"], "by <email>")
        self.assertEqual(out[0]["nums"], ["1"])
        self.assertEqual(tools[0]["cmd"], "cat /home/user/x")

    def test_mined_rows_carry_no_home_path_or_session_id(self):
        with tempfile.TemporaryDirectory() as root:
            sid = "11111111-2222-3333-4444-555555555555"
            _write(
                os.path.join(root, "p", "s.jsonl"),
                turn(
                    "q",
                    "cat /home/user/secret.txt",
                    f"owner root@example.com {sid}",
                    f"Done, see /home/user/x in {sid}.",
                ),
                sid,
            )
            rows, _ = F.mine(
                root, [], exclude_after="2999-01-01T00:00:00Z", exclude_sessions=()
            )
        blob = json.dumps(rows)
        for needle in ("/home/user", "example.com", sid):
            self.assertNotIn(needle, blob)
        self.assertNotEqual(rows[0]["session"], sid)


class StubRunner:
    """Stands in for `claude -p`: answers from a per-model dict keyed by row id."""

    def __init__(self, answers, cost=0.1):
        self.answers, self.cost, self.calls = answers, cost, []

    def __call__(self, model, prompt):
        self.calls.append(model)
        ids = [part.split(" ===")[0] for part in prompt.split("=== ITEM ")[1:]]
        adjudicating = "EARLIER LABELS" in prompt
        key = "adjudicated" if adjudicating else model
        return json.dumps(
            [
                {"id": i, "label": self.answers[key][i]}
                for i in ids
                if i in self.answers[key]
            ]
        ), self.cost


def _rows(n):
    return [
        {
            "id": f"dcf-{i:03d}",
            "text": f"reply {i}",
            "tools": [{"tool": "Bash", "cmd": f"c{i}", "out": "o", "err": False}],
        }
        for i in range(1, n + 1)
    ]


class LabelTests(unittest.TestCase):
    def test_agreement_disagreement_and_adjudication(self):
        rows = _rows(3)
        runner = StubRunner(
            {
                "sonnet": {
                    "dcf-001": "no_claim",
                    "dcf-002": "supported_done",
                    "dcf-003": "unsupported_done",
                },
                "opus": {
                    "dcf-001": "no_claim",
                    "dcf-002": "unsupported_done",
                    "dcf-003": "unsupported_done",
                },
                "adjudicated": {"dcf-002": "unsupported_done"},
            }
        )
        info = F.label_rows(rows, runner, F.Spend(12.0), {}, workers=1)
        self.assertEqual(
            [r["label"] for r in rows],
            ["no_claim", "unsupported_done", "unsupported_done"],
        )
        self.assertEqual(rows[0]["votes"], {"sonnet": "no_claim", "opus": "no_claim"})
        self.assertEqual(
            rows[1]["votes"],
            {
                "sonnet": "supported_done",
                "opus": "unsupported_done",
                "adjudicated": "unsupported_done",
            },
        )
        self.assertEqual(
            sorted(runner.calls), ["opus", "opus", "sonnet"]
        )  # one adjudication only
        self.assertAlmostEqual(info["spend_usd"], 0.3)

    def test_spend_cap_stops_calls_and_leaves_rows_unlabeled(self):
        rows = _rows(4)
        answers = {m: {r["id"]: "no_claim" for r in rows} for m in ("sonnet", "opus")}
        runner = StubRunner(answers, cost=1.0)
        F.label_rows(rows, runner, F.Spend(1.5), {}, workers=1, batch=2)
        labeled = [r for r in rows if r["label"]]
        self.assertLess(len(labeled), 4)
        self.assertLessEqual(len(runner.calls), 4)

    def test_unparseable_answer_is_retried_then_row_left_unlabeled(self):
        rows = _rows(1)

        def bad(model, prompt):
            return "not json", 0.01

        F.label_rows(rows, bad, F.Spend(12.0), {}, workers=1)
        self.assertIsNone(rows[0]["label"])

    def test_cache_skips_finished_rows(self):
        rows = _rows(2)
        answers = {
            m: {r["id"]: "supported_done" for r in rows} for m in ("sonnet", "opus")
        }
        cache = {}
        F.label_rows(rows, StubRunner(answers), F.Spend(12.0), cache, workers=1)
        self.assertEqual(len(cache), 2)
        again = StubRunner({"sonnet": {}, "opus": {}})
        rows2 = _rows(2)
        F.label_rows(rows2, again, F.Spend(12.0), cache, workers=1)
        self.assertEqual(again.calls, [])
        self.assertEqual(
            [r["label"] for r in rows2], ["supported_done", "supported_done"]
        )

    def test_prompt_has_rubric_clause_reply_and_tools_but_no_detector_output(self):
        prompt = F.build_prompt(_rows(1))
        self.assertIn("unsupported_done", prompt)
        self.assertIn(F.TOOL_AWARE_CLAUSE, prompt)
        self.assertIn("reply 1", prompt)
        self.assertIn("output tail", prompt)
        for word in ("claim_strength", "crosscheck", "finding"):
            self.assertNotIn(word, prompt)

    def test_parse_labels_ignores_unknown_ids_and_labels(self):
        out = F.parse_labels(
            '[{"id":"dcf-001","label":"no_claim"},{"id":"zzz","label":"no_claim"},{"id":"dcf-002","label":"bogus"}]',
            ["dcf-001", "dcf-002"],
        )
        self.assertEqual(out, {"dcf-001": "no_claim"})

    def test_kappa_and_summary(self):
        a = ["no_claim", "no_claim", "supported_done", "unsupported_done"]
        self.assertEqual(F.cohen_kappa(a, a), 1.0)
        self.assertAlmostEqual(
            F.cohen_kappa(
                ["no_claim", "supported_done"] * 2, ["supported_done", "no_claim"] * 2
            ),
            -1.0,
        )
        rows = [
            {
                "label": "no_claim",
                "stratum": "A",
                "votes": {"sonnet": "no_claim", "opus": "no_claim"},
            },
            {
                "label": "unsupported_done",
                "stratum": "B",
                "votes": {
                    "sonnet": "supported_done",
                    "opus": "unsupported_done",
                    "adjudicated": "unsupported_done",
                },
            },
        ]
        s = F.summarize(rows)
        self.assertEqual(s["adjudicated"], 1)
        self.assertEqual(s["gold_negative"], 1)
        self.assertEqual(s["gold_positive"], 1)
        self.assertEqual(s["agree"], 1)

    def test_write_fresh_schema(self):
        rows = _rows(1)
        rows[0].update(
            {
                "source": "fresh",
                "stratum": "A",
                "label": "no_claim",
                "votes": {},
                "session": "x",
                "turn": 0,
                "beyond_tail": False,
            }
        )
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "f.jsonl")
            F.write_fresh(rows, {"n": 1}, path)
            self.assertEqual(F.load_rows(path)[0]["id"], "dcf-001")
            with open(path, encoding="ascii") as fh:  # ASCII only
                self.assertEqual(json.loads(fh.readline())["_header"], {"n": 1})


if __name__ == "__main__":
    unittest.main()
