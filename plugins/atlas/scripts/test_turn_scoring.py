import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas_db  # noqa: E402
import turn_scoring  # noqa: E402

SID = "sess-1"


class FakeClient:
    class TypeSafeError(Exception):
        pass

    def __init__(self):
        self.calls = []

    def evaluate(self, state, questions, *, model=None, timeout=30.0):
        self.calls.append((state, questions))
        answers = {}
        for qid, q in questions.items():
            if q["type"] == "noul":
                answers[qid] = {"type": "noul", "noul": 0.9}
            elif q["type"] == "score":
                n = len(q["criteria"])
                answers[qid] = {
                    "type": "score",
                    "score": 2.2 if n == 4 else 3.6,
                    "legend": {str(i): f"L{i}" for i in range(n)},
                    "probabilities": {},
                    "confidence": 0.7,
                }
            else:
                pick = next(iter(q["criteria"]))
                answers[qid] = {
                    "type": "choice",
                    "choice": pick,
                    "probabilities": {pick: 0.8},
                    "confidence": 0.6,
                }
        return {
            "model": "jev-1.13.0",
            "answers": answers,
            "usage": {"input_tokens": 100},
        }


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.conn = atlas_db.connect(os.path.join(self.tmp, "a.db"))
        atlas_db.init(self.conn)
        self.addCleanup(self.conn.close)
        self.n = 0

    def msg(self, role, text, ts, sidechain=0, prompt=False):
        self.n += 1
        uuid = f"u{self.n}"
        self.conn.execute(
            "INSERT INTO messages(session_id,uuid,ts,role,is_sidechain,text) VALUES(?,?,?,?,?,?)",
            (SID, uuid, ts, role, sidechain, text),
        )
        if prompt:
            self.conn.execute(
                "INSERT INTO user_prompts(session_id,uuid,ts,text) VALUES(?,?,?,?)",
                (SID, uuid, ts, text),
            )
        self.conn.commit()
        return uuid

    def seed(self):
        self.msg("user", "make a table of X", 1, prompt=True)
        self.msg("assistant", "working on it", 2)
        self.msg("user", None, 3)  # tool_result row: no text, not a prompt
        self.msg("assistant", "sidechain chatter", 3.5, sidechain=1)
        last1 = self.msg("assistant", "ATLAS | done | table\nit\u2014works", 4)
        self.msg("user", "<system-reminder>hook text</system-reminder>", 5)
        self.msg("user", "no, per-day rows please", 6, prompt=True)
        last2 = self.msg("assistant", "here are rows", 7)
        return last1, last2


class ExchangeTests(Base):
    def test_excludes_tool_results_sidechains_and_injected_text(self):
        last1, last2 = self.seed()
        ex = turn_scoring.build_exchanges(self.conn, SID)
        self.assertEqual([e["message_uuid"] for e in ex], [last1, last2])
        s0 = ex[0]["state"]
        self.assertEqual(s0["request"], "make a table of X")
        self.assertNotIn("sidechain", s0["reply"])
        self.assertIn("working on it", s0["reply"])
        self.assertEqual(s0["next_user_message"], "no, per-day rows please")
        self.assertEqual(ex[1]["state"]["earlier_user_messages"], ["make a table of X"])
        self.assertNotIn("next_user_message", ex[1]["state"])

    def test_tool_errors_counted_in_turn(self):
        self.seed()
        self.conn.execute(
            "INSERT INTO tool_calls(session_id,ts,is_sidechain,tool_use_id,is_error) "
            "VALUES(?,?,0,'t1',1)",
            (SID, 2.5),
        )
        ex = turn_scoring.build_exchanges(self.conn, SID)
        self.assertEqual(ex[0]["state"]["tool_error_count_in_turn"], 1)
        self.assertEqual(ex[1]["state"]["tool_error_count_in_turn"], 0)

    def test_secrets_scrubbed(self):
        self.msg("user", "use sk-ABCDEFGHIJKLMNOPQRSTUV now", 1, prompt=True)
        self.msg("assistant", "ok", 2)
        ex = turn_scoring.build_exchanges(self.conn, SID)
        self.assertNotIn("sk-ABCDEF", ex[0]["state"]["request"])


class MetricTests(unittest.TestCase):
    def test_metrics(self):
        m = turn_scoring._metrics(
            "intro\nATLAS | verify | ok\na\u2014b \u201cq\u201d\u2026"
        )
        self.assertEqual(m["header_present"], 1.0)
        self.assertEqual(m["banned_punct"], 4.0)
        m = turn_scoring._metrics("no ATLAS | header mid-line")
        self.assertEqual(m["header_present"], 0.0)
        self.assertEqual(m["reply_chars"], 26.0)


class ScoreTests(Base):
    def test_row_mapping_and_idempotence(self):
        last1, last2 = self.seed()
        c = FakeClient()
        s = turn_scoring.score_session(self.conn, SID, client=c, max_calls=10)
        self.assertEqual(s["calls"], 2)
        rows = {
            r[0]: r
            for r in self.conn.execute(
                "SELECT judgment,kind,value,label,confidence,model,input_tokens,ts "
                "FROM turn_scores WHERE message_uuid=?",
                (last1,),
            )
        }
        self.assertEqual(rows["literal_ask_delivered"][1:3], ("noul", 0.9))
        self.assertEqual(rows["verbosity"][1:4], ("score", 2.2, "L2"))
        self.assertEqual(rows["verbosity"][4], 0.7)
        self.assertEqual(rows["header_present"][1:3], ("metric", 1.0))
        self.assertEqual(rows["banned_punct"][2], 1.0)
        self.assertIn("next_turn_correction", rows)
        self.assertEqual(rows["verbosity"][5], "jev-1.13.0")
        self.assertEqual(rows["literal_ask_delivered"][6], 100)
        self.assertIsNone(rows["verbosity"][6])
        self.assertEqual(rows["verbosity"][7], 4)
        self.assertNotIn(
            "next_turn_correction",
            {
                r[0]
                for r in self.conn.execute(
                    "SELECT judgment FROM turn_scores WHERE message_uuid=?", (last2,)
                )
            },
        )
        again = FakeClient()
        s2 = turn_scoring.score_session(self.conn, SID, client=again, max_calls=10)
        self.assertEqual(s2["calls"], 0)
        self.assertEqual(again.calls, [])

    def test_late_next_message_scores_only_missing(self):
        self.msg("user", "first", 1, prompt=True)
        self.msg("assistant", "a", 2)
        c = FakeClient()
        turn_scoring.score_session(self.conn, SID, client=c)
        self.assertNotIn("next_turn_correction", c.calls[0][1])
        self.msg("user", "wrong!", 3, prompt=True)
        self.msg("assistant", "b", 4)
        c2 = FakeClient()
        turn_scoring.score_session(self.conn, SID, client=c2)
        qs = [set(q) for _, q in c2.calls]
        self.assertIn({"next_turn_correction"}, qs)

    def test_max_calls_respected(self):
        self.seed()
        c = FakeClient()
        s = turn_scoring.score_session(self.conn, SID, client=c, max_calls=1)
        self.assertEqual(len(c.calls), 1)
        self.assertEqual(s["stopped"], "max_calls")

    def test_atomic_questions_fold_into_stored_ids(self):
        state = {"request": "fix it", "reply": "done", "next_user_message": "no"}
        qs = turn_scoring._questions_for(state)
        self.assertNotIn("done_claim_unverified", qs)
        self.assertIn("done_claim_unverified__asserts_success", qs)
        self.assertIn("literal_ask_delivered__covers_named_deliverable", qs)
        self.assertIn("buried_decision__decided_without_asking", qs)
        self.assertIn("scope_drift", qs)
        for spec in qs.values():
            self.assertNotIn("The state holds", spec["instructions"])
        self.assertIn("done_claim_unverified", turn_scoring._stored_ids(state))
        folded = turn_scoring._fold_answers(
            {
                "done_claim_unverified__asserts_success": {
                    "type": "noul",
                    "noul": 0.999,
                },
                "done_claim_unverified__names_observed_result": {
                    "type": "noul",
                    "noul": 0.141,
                },
                "buried_decision__decided_without_asking": {
                    "type": "noul",
                    "noul": 0.987,
                },
                "scope_drift": {"type": "noul", "noul": 0.994},
            }
        )
        self.assertGreaterEqual(folded["done_claim_unverified"]["noul"], 0.7)
        self.assertAlmostEqual(folded["buried_decision"]["noul"], 0.987)
        self.assertEqual(folded["scope_drift"]["noul"], 0.994)
        verified = turn_scoring._fold_answers(
            {
                "done_claim_unverified__asserts_success": {
                    "type": "noul",
                    "noul": 0.998,
                },
                "done_claim_unverified__names_observed_result": {
                    "type": "noul",
                    "noul": 0.996,
                },
            }
        )
        self.assertLessEqual(verified["done_claim_unverified"]["noul"], 0.35)

    def test_dry_run_makes_no_calls_or_writes(self):
        self.seed()
        s = turn_scoring.score_session(
            self.conn, SID, client=None, dry_run=True, max_calls=10
        )
        self.assertEqual(s["calls"], 2)
        self.assertGreater(s["state_chars"], 0)
        n = self.conn.execute("SELECT COUNT(*) FROM turn_scores").fetchone()[0]
        self.assertEqual(n, 0)

    def test_error_stops_and_reports(self):
        self.seed()

        class Boom:
            def evaluate(self, *a, **k):
                raise turn_scoring.typesafe_client.TypeSafeError(401, "bad key")

        s = turn_scoring.score_session(self.conn, SID, client=Boom())
        self.assertEqual(s["stopped"], "error")
        self.assertIn("401", s["error"])
        row = self.conn.execute(
            "SELECT kind,value,label FROM turn_scores WHERE judgment='scoring_error'"
        ).fetchone()
        self.assertEqual(row[:2], ("error", 401.0))
        self.assertIn("bad key", row[2])


class FacetTests(Base):
    def test_enrichment_writes_expected_columns_only(self):
        self.seed()
        atlas_db.upsert_facet(
            self.conn, SID, correction_count=2, brief_summary="keep me"
        )
        c = FakeClient()
        s = turn_scoring.score_session(self.conn, SID, client=c)
        self.assertTrue(s["facet_enriched"])
        row = self.conn.execute(
            "SELECT enriched_at,outcome,user_satisfaction,session_type,"
            "claude_helpfulness,brief_summary FROM facets WHERE session_id=?",
            (SID,),
        ).fetchone()
        self.assertIsNotNone(row[0])
        self.assertEqual(row[1], "success")
        self.assertEqual(row[2], "positive")
        self.assertEqual(row[3], "coding")
        self.assertEqual(row[4], "5")  # score 3.6 -> round 4 -> level '5'
        self.assertEqual(row[5], "keep me")
        digest = c.calls[-1][0]
        self.assertEqual(digest["correction_count"], 2)
        self.assertEqual(digest["first_prompt"], "make a table of X")
        again = FakeClient()
        turn_scoring.score_session(self.conn, SID, client=again)
        self.assertEqual(again.calls, [])

    def test_capped_long_session_still_enriches_facet(self):
        """Long sessions exhaust max_calls on exchanges; one call is reserved
        so the facet (outcome/satisfaction) is never the one dropped."""
        self.seed()  # two exchanges
        atlas_db.upsert_facet(self.conn, SID, correction_count=0)
        c = FakeClient()
        s = turn_scoring.score_session(self.conn, SID, client=c, max_calls=2)
        self.assertEqual(len(c.calls), 2)
        self.assertTrue(s["facet_enriched"])
        self.assertEqual(s["stopped"], "max_calls")
        enriched = self.conn.execute(
            "SELECT enriched_at FROM facets WHERE session_id=?", (SID,)
        ).fetchone()[0]
        self.assertIsNotNone(enriched)


if __name__ == "__main__":
    unittest.main()
