import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
"""turn_scoring: answer-field mapping, session selection, status/error
accounting and the CLI entry point."""
import contextlib
import io
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas_db  # noqa: E402
import turn_scoring as ts  # noqa: E402
import typesafe_client  # noqa: E402
from test_turn_scoring import FakeClient  # noqa: E402


class AnswerFields(unittest.TestCase):
    def test_noul(self):
        self.assertEqual(ts._answer_fields({"type": "noul", "noul": 0.25}),
                         {"kind": "noul", "value": 0.25})

    def test_score_uses_rounded_legend_label(self):
        out = ts._answer_fields({"type": "score", "score": 2.6,
                                 "legend": {"2": "two", "3": "three"},
                                 "confidence": 0.7})
        self.assertEqual(out, {"kind": "score", "value": 2.6, "label": "three",
                               "confidence": 0.7})
        out = ts._answer_fields({"type": "score", "score": 2.4,
                                 "legend": {"2": "two", "3": "three"}})
        self.assertEqual(out["label"], "two")
        self.assertIsNone(out["confidence"])

    def test_score_without_legend_or_score(self):
        out = ts._answer_fields({"type": "score", "score": 1.0})
        self.assertEqual(out, {"kind": "score", "value": 1.0, "label": None,
                               "confidence": None})
        out = ts._answer_fields({"type": "score", "score": None,
                                 "legend": {"0": "x"}})
        self.assertEqual(out["kind"], "score")
        self.assertIsNone(out["value"])
        self.assertIsNone(out["label"])

    def test_choice_value_is_probability_of_pick(self):
        out = ts._answer_fields({"type": "choice", "choice": "b",
                                 "probabilities": {"a": 0.2, "b": 0.8},
                                 "confidence": 0.5})
        self.assertEqual(out, {"kind": "choice", "value": 0.8, "label": "b",
                               "confidence": 0.5})
        out = ts._answer_fields({"type": "choice", "choice": "z"})
        self.assertEqual(out, {"kind": "choice", "value": None, "label": "z",
                               "confidence": None})

    def test_unknown_type_is_none(self):
        self.assertIsNone(ts._answer_fields({"type": "mystery"}))
        self.assertIsNone(ts._answer_fields({}))


class WriteAnswers(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.conn = atlas_db.connect(os.path.join(self.tmp, "a.db"))
        atlas_db.init(self.conn)
        self.addCleanup(self.conn.close)

    def test_skips_unknown_answers_but_keeps_later_ones(self):
        ex = {"message_uuid": "m1", "ts": 5.0}
        resp = {"model": "jev", "usage": {"input_tokens": 42},
                "answers": {"scope_drift": {"type": "mystery"},
                            "unasked": {"type": "noul", "noul": 0.1},
                            "buried_decision__decided_without_asking":
                                {"type": "noul", "noul": 0.3}}}
        n = ts._write_answers(self.conn, "s", ex, resp,
                              {"scope_drift", "buried_decision"})
        rows = self.conn.execute(
            "SELECT judgment, kind, value, model, input_tokens FROM turn_scores "
            "ORDER BY judgment").fetchall()
        self.assertEqual(n, 1)
        self.assertEqual(rows, [("buried_decision", "noul", 0.3, "jev", 42)])


class SessionsAndStatus(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.conn = atlas_db.connect(os.path.join(self.tmp, "a.db"))
        atlas_db.init(self.conn)
        self.addCleanup(self.conn.close)
        self.now = time.time()

    def msg(self, sid, ts_, n=[0]):
        n[0] += 1
        self.conn.execute(
            "INSERT INTO messages(session_id,uuid,ts,role,is_sidechain,text) "
            "VALUES(?,?,?,?,0,?)", (sid, f"{sid}-{n[0]}", ts_, "user", "hi"))
        self.conn.commit()

    def test_recent_sessions_window_order_and_limit(self):
        day = 86400
        self.msg("old", self.now - 10 * day)
        self.msg("mid", self.now - 2 * day)
        self.msg("new", self.now - 100)
        self.msg("mid", self.now - 1.5 * day)
        self.assertEqual(ts.recent_sessions(self.conn, 3), ["new", "mid"])
        self.assertEqual(ts.recent_sessions(self.conn, 3, limit=1), ["new"])
        self.assertEqual(ts.recent_sessions(self.conn, 20), ["new", "mid", "old"])
        self.assertEqual(ts.recent_sessions(self.conn, 0.001), [])
        self.assertEqual(ts.recent_sessions(self.conn, 1.9, None), ["new", "mid"])

    def score(self, jid, sid="s", mid="m", at=None, label=None, tokens=None, value=None):
        atlas_db.upsert_turn_score(self.conn, sid, mid, jid, kind="x", label=label,
                                   scored_at=at if at is not None else self.now,
                                   input_tokens=tokens, value=value)

    def test_recent_errors_counts_window_and_latest_label(self):
        day = 86400
        self.assertEqual(ts.recent_errors(self.conn, self.now), (0, None))
        self.score("scoring_error", mid="e1", at=self.now - 10 * day, label="ancient")
        self.assertEqual(ts.recent_errors(self.conn, self.now), (0, "ancient"))
        self.score("scoring_error", mid="e2", at=self.now - 3 * day, label="older")
        self.score("scoring_error", mid="e3", at=self.now - 1 * day, label="newest")
        self.score("scope_drift", mid="ok", at=self.now - 1 * day, label="not an error")
        self.assertEqual(ts.recent_errors(self.conn, self.now), (2, "newest"))
        # the window follows the supplied clock
        self.assertEqual(ts.recent_errors(self.conn, self.now + 5 * day)[0], 1)

    def test_recent_errors_defaults_now_to_current_time(self):
        self.score("scoring_error", mid="e", at=time.time() - 60, label="boom")
        self.assertEqual(ts.recent_errors(self.conn), (1, "boom"))
        self.score("scoring_error", mid="old", at=time.time() - 8 * 86400, label="x")
        self.assertEqual(ts.recent_errors(self.conn)[0], 1)

    def test_status_aggregates(self):
        day = 86400
        self.score("scope_drift", mid="a", at=self.now - 2 * day, tokens=10)
        self.score("scope_drift", mid="b", at=self.now - 20 * day, tokens=5)
        self.score("scoring_error", mid="c", at=self.now - 1 * day, label="bad key")
        with mock.patch.dict(os.environ, {"TYPESAFE_API_KEY": " k ",
                                          "ATLAS_TYPESAFE_SCORING": "on"}):
            s = ts.status(self.conn)
        self.assertEqual(s["rows_total"], 3)
        self.assertEqual(s["rows_last_7d"], 1)
        self.assertEqual(s["total_input_tokens"], 15)
        self.assertAlmostEqual(s["last_scored_at"], self.now - 1 * day, places=3)
        self.assertEqual(s["errors_last_7d"], 1)
        self.assertEqual(s["last_error"], "bad key")
        self.assertIs(s["key_present"], True)
        self.assertIs(s["scoring_enabled"], True)

    def test_status_without_key_or_rows(self):
        with mock.patch.dict(os.environ, {"TYPESAFE_API_KEY": "  ",
                                          "ATLAS_TYPESAFE_SCORING": "on",
                                          "ATLAS_TYPESAFE_URL": ""}):
            s = ts.status(self.conn)
        self.assertEqual((s["rows_total"], s["rows_last_7d"], s["total_input_tokens"]),
                         (0, 0, 0))
        self.assertIsNone(s["last_scored_at"])
        self.assertIsNone(s["last_error"])
        self.assertIs(s["key_present"], False)
        self.assertIs(s["scoring_enabled"], False)


class MainCli(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.db = os.path.join(self.tmp, "a.db")
        p = mock.patch.dict(os.environ, {"ATLAS_DB": self.db,
                                         "TYPESAFE_API_KEY": "",
                                         "ATLAS_TYPESAFE_SCORING": "on",
                                         "ATLAS_TYPESAFE_URL": "",
                                         "ATLAS_TYPESAFE_MAX_CALLS": "200"})
        p.start()
        self.addCleanup(p.stop)
        self.conn = atlas_db.connect(self.db)
        atlas_db.init(self.conn)
        self.addCleanup(self.conn.close)
        now = time.time()
        for i, (role, text, t, pr) in enumerate([
                ("user", "make a table", now - 50, True),
                ("assistant", "ATLAS | done | ok", now - 40, False),
                ("user", "thanks", now - 30, True),
                ("assistant", "welcome", now - 20, False)]):
            self.conn.execute(
                "INSERT INTO messages(session_id,uuid,ts,role,is_sidechain,text) "
                "VALUES('S1',?,?,?,0,?)", (f"u{i}", t, role, text))
            if pr:
                self.conn.execute(
                    "INSERT INTO user_prompts(session_id,uuid,ts,text) "
                    "VALUES('S1',?,?,?)", (f"u{i}", t, text))
        self.conn.commit()

    def run_main(self, argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = ts.main(argv)
        return code, out.getvalue()

    def test_status_output(self):
        atlas_db.upsert_turn_score(self.conn, "S1", "m", "scoring_error",
                                   kind="error", label="L" * 300,
                                   scored_at=time.time())
        code, out = self.run_main(["--status"])
        self.assertEqual(code, 0)
        lines = out.splitlines()
        self.assertEqual(lines[0], "key present: no (scoring disabled)")
        self.assertEqual(lines[1], "rows total: 1")
        self.assertEqual(lines[2], "rows last 7d: 0")
        self.assertTrue(lines[3].startswith("last scored_at: "))
        self.assertEqual(lines[4], "total input_tokens: 0")
        self.assertEqual(lines[5], "errors last 7d: 1 (latest: " + "L" * 200 + ")")

    def test_status_with_key_has_no_error_suffix(self):
        with mock.patch.dict(os.environ, {"TYPESAFE_API_KEY": "k"}):
            code, out = self.run_main(["--status"])
        self.assertEqual(out.splitlines()[0], "key present: yes (scoring enabled)")
        self.assertEqual(out.splitlines()[-1], "errors last 7d: 0")

    def test_requires_a_mode(self):
        with contextlib.redirect_stderr(io.StringIO()) as err:
            with self.assertRaises(SystemExit) as cm:
                ts.main([])
        self.assertEqual(cm.exception.code, 2)
        self.assertIn("--session, --recent-days, --status", err.getvalue())

    def test_unavailable_without_key_exits_zero_and_scores_nothing(self):
        code, out = self.run_main(["--session", "S1"])
        self.assertEqual(code, 0)
        self.assertIn("scoring unavailable", out)
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM turn_scores").fetchone()[0], 0)

    def test_dry_run_works_without_key_and_writes_nothing(self):
        code, out = self.run_main(["--session", "S1", "--dry-run"])
        self.assertEqual(code, 0)
        line = out.strip()
        self.assertTrue(line.startswith("dry-run sessions=1 exchanges=2 calls=2 "), line)
        self.assertIn("rows=0", line)
        self.assertNotIn("state_chars=0", line)
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM turn_scores").fetchone()[0], 0)

    def test_real_run_writes_rows_and_reports_totals(self):
        fake = FakeClient()
        with mock.patch.dict(os.environ, {"TYPESAFE_API_KEY": "k"}), \
                mock.patch.object(typesafe_client, "evaluate", fake.evaluate):
            code, out = self.run_main(["--session", "S1"])
        self.assertEqual(code, 0)
        self.assertTrue(out.startswith("sessions=1 exchanges=2 calls="), out)
        self.assertFalse(out.startswith("dry-run"))
        self.assertGreaterEqual(len(fake.calls), 2)
        n = self.conn.execute("SELECT COUNT(*) FROM turn_scores").fetchone()[0]
        self.assertGreater(n, 4)
        self.assertIn(f"calls={len(fake.calls)} ", out)
        self.assertIn("input_tokens=%d " % (100 * len(fake.calls)), out)

    def test_max_calls_budget_limits_calls(self):
        fake = FakeClient()
        with mock.patch.dict(os.environ, {"TYPESAFE_API_KEY": "k"}), \
                mock.patch.object(typesafe_client, "evaluate", fake.evaluate):
            code, out = self.run_main(["--session", "S1", "--max-calls", "1"])
        self.assertEqual(len(fake.calls), 1)
        self.assertIn("calls=1 ", out)

    def test_zero_budget_runs_no_sessions(self):
        code, out = self.run_main(["--session", "S1", "--dry-run", "--max-calls", "0"])
        self.assertTrue(out.startswith("dry-run sessions=0 exchanges=0 calls=0"), out)

    def test_error_is_reported_and_stops_batch(self):
        def boom(state, questions, **kw):
            raise typesafe_client.TypeSafeError(401, "bad key")
        with mock.patch.dict(os.environ, {"TYPESAFE_API_KEY": "k"}), \
                mock.patch.object(typesafe_client, "evaluate", boom):
            code, out = self.run_main(["--session", "S1"])
        self.assertEqual(code, 0)
        self.assertIn("S1: TypeSafe API error 401: bad key", out)
        row = self.conn.execute(
            "SELECT label, value FROM turn_scores WHERE judgment='scoring_error'"
        ).fetchone()
        self.assertEqual(row, ("TypeSafe API error 401: bad key", 401.0))

    def test_recent_days_selects_sessions_and_honors_limit(self):
        now = time.time()
        self.conn.execute(
            "INSERT INTO messages(session_id,uuid,ts,role,is_sidechain,text) "
            "VALUES('S0','x',?,'user',0,'q')", (now - 5 * 86400,))
        self.conn.commit()
        code, out = self.run_main(["--recent-days", "10", "--dry-run"])
        self.assertIn("dry-run sessions=2 ", out)
        code, out = self.run_main(["--recent-days", "10", "--limit", "1", "--dry-run"])
        self.assertIn("dry-run sessions=1 ", out)
        code, out = self.run_main(["--recent-days", "1", "--dry-run"])
        self.assertIn("dry-run sessions=1 ", out)

    def test_default_max_calls_env(self):
        with mock.patch.dict(os.environ, {"ATLAS_TYPESAFE_MAX_CALLS": "7"}):
            self.assertEqual(ts.default_max_calls(), 7)
        with mock.patch.dict(os.environ, {"ATLAS_TYPESAFE_MAX_CALLS": "nope"}):
            self.assertEqual(ts.default_max_calls(), 200)


if __name__ == "__main__":
    unittest.main()
