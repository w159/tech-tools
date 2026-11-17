import os
import sys
import tempfile
import json
import unittest
from unittest import mock

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)

sys.path.insert(0, os.path.dirname(__file__))

import atlas_db
import turn_scoring as ts
import typesafe_client
from test_turn_scoring import FakeClient


def chars(state):
    return ts._state_chars(state)


class BudgetTest(unittest.TestCase):
    def test_state_text_caps_derive_from_chars_budget(self):
        total = 2 * ts.REQUEST_CAP + ts.EARLIER_N * ts.EARLIER_CAP + ts.REPLY_CAP
        self.assertLessEqual(total, ts.JUDGE_BUDGET_CHARS)

    def test_worst_case_session_state_text_within_chars_budget(self):
        conn = atlas_db.connect(os.path.join(tempfile.mkdtemp(), "atlas.db"))
        atlas_db.init(conn)
        big = "x" * 50_000
        t = 1.0
        for i in range(10):  # 10 oversized turns, each with 3 oversized replies
            conn.execute(
                "INSERT INTO messages(session_id,uuid,ts,role,text) VALUES('s',?,?,?,?)",
                (f"u{i}", t, "user", big),
            )
            conn.execute(
                "INSERT INTO user_prompts(session_id,uuid,ts,text) VALUES('s',?,?,?)",
                (f"u{i}", t, big),
            )
            for j in range(3):
                t += 1
                conn.execute(
                    "INSERT INTO messages(session_id,uuid,ts,role,text) VALUES('s',?,?,?,?)",
                    (f"a{i}_{j}", t, "assistant", big),
                )
            t += 1
        conn.commit()
        exs = ts.build_exchanges(conn, "s")
        self.assertEqual(len(exs), 10)
        for ex in exs:
            self.assertLessEqual(chars(ex["state"]), ts.JUDGE_BUDGET_CHARS)
        # Late exchange fills every field to its derived cap (the true worst case).
        last = exs[-2]["state"]
        self.assertEqual(len(last["request"]), ts.REQUEST_CAP)
        self.assertEqual(len(last["reply"]), ts.REPLY_CAP)
        self.assertEqual(len(last["earlier_user_messages"]), ts.EARLIER_N)
        self.assertEqual(chars(last), ts.JUDGE_BUDGET_CHARS)

    def _state(self):
        return {
            "request": "R" * 100,
            "earlier_user_messages": ["a" * 50, "b" * 50],
            "reply": "".join(chr(65 + i % 26) for i in range(200)),
            "next_user_message": "N" * 100,
            "tool_error_count_in_turn": 0,
        }

    def test_truncation_path_is_deterministic_and_bounded(self):
        for budget in (450, 300, 250, 100, 10, 0):
            a = ts._enforce_budget(self._state(), budget)
            b = ts._enforce_budget(self._state(), budget)
            self.assertEqual(a, b)
            self.assertLessEqual(chars(a), budget)

    def test_truncation_order_keeps_request_and_reply_tail(self):
        s = ts._enforce_budget(self._state(), 300)  # 500 total: earlier, then next shed
        self.assertEqual(s["earlier_user_messages"], [])
        self.assertEqual(s["next_user_message"], "")
        self.assertEqual(s["request"], "R" * 100)
        self.assertEqual(s["reply"], self._state()["reply"])
        s = ts._enforce_budget(self._state(), 150)  # reply now cut, from its head
        self.assertEqual(s["reply"], self._state()["reply"][-50:])
        self.assertEqual(s["request"], "R" * 100)

    def test_within_budget_untouched(self):
        s = self._state()
        self.assertEqual(ts._enforce_budget(dict(s), 10_000), s)


class WireBodyBoundTest(unittest.TestCase):
    """JUDGE_BODY_BUDGET_BYTES bounds the ASSEMBLED POST body (state + questions
    + model + JSON escaping), not the state text that JUDGE_BUDGET_CHARS counts."""

    SID = "hostile"

    def _hostile_db(self, big):
        conn = atlas_db.connect(os.path.join(tempfile.mkdtemp(), "atlas.db"))
        atlas_db.init(conn)
        t = 1.0
        for i in range(8):  # long request, long earlier messages, long reply, long next message
            for uuid, role, ins in ((f"u{i}", "user", True), (f"a{i}", "assistant", False)):
                t += 1
                conn.execute(
                    "INSERT INTO messages(session_id,uuid,ts,role,text) VALUES(?,?,?,?,?)",
                    (self.SID, uuid, t, role, big),
                )
                if ins:
                    conn.execute(
                        "INSERT INTO user_prompts(session_id,uuid,ts,text) VALUES(?,?,?,?)",
                        (self.SID, uuid, t, big),
                    )
        conn.commit()
        atlas_db.upsert_facet(conn, self.SID, correction_count=9)
        return conn

    def _score(self, conn):
        """Run score_session through the REAL client; return the bytes each POST carried."""
        sent = []

        def fake_urlopen(req, **kw):
            sent.append(req.data)
            body = json.dumps(FakeClient().evaluate(*(lambda d: (d["state"], d["questions"]))(json.loads(req.data)))).encode()
            return mock.MagicMock(
                __enter__=lambda s: mock.MagicMock(read=lambda: body), __exit__=lambda *a: False
            )

        env = {"TYPESAFE_API_KEY": "k", "ATLAS_TYPESAFE_URL": "https://api.typesafe.ai", "ATLAS_TYPESAFE_MODEL": "jev-latest"}
        with mock.patch.dict(os.environ, env), mock.patch.object(
            typesafe_client.urllib.request, "urlopen", fake_urlopen
        ):
            summary = ts.score_session(conn, self.SID, max_calls=50)
        return summary, sent

    def test_assembled_body_never_exceeds_byte_budget_for_exchange_and_facet(self):
        # ascii: state text fills JUDGE_BUDGET_CHARS; json: 5 chars -> ~35 bytes after escaping
        for label, big in (("ascii", "x" * 50_000), ("json-hostile", "\u00e9\n\"\U0001F600" * 20_000)):
            conn = self._hostile_db(big)
            summary, sent = self._score(conn)
            self.assertIsNone(summary["error"], (label, summary))
            self.assertTrue(summary["facet_enriched"], label)
            self.assertGreater(len(sent), 8, label)  # 8 exchanges + the facet
            facet_bodies = [b for b in sent if b"first_prompt" in b]
            self.assertEqual(len(facet_bodies), 1, label)
            for b in sent:
                self.assertLessEqual(len(b), ts.JUDGE_BODY_BUDGET_BYTES, label)

    def test_hosted_url_without_key_surfaces_scoring_error_in_the_db(self):
        conn = self._hostile_db("hello")
        env = {"TYPESAFE_API_KEY": "", "ATLAS_TYPESAFE_URL": "https://scoring.example.com"}
        with mock.patch.dict(os.environ, env), mock.patch.object(
            typesafe_client.urllib.request, "urlopen"
        ) as net:
            self.assertIn("TYPESAFE_API_KEY", ts.status(conn)["config_error"])
            summary = ts.score_session(conn, self.SID)
        net.assert_not_called()
        self.assertIn("TYPESAFE_API_KEY", summary["error"])
        self.assertEqual(summary["stopped"], "error")
        self.assertEqual(ts.recent_errors(conn)[0], 1)

    def test_state_char_bound_alone_does_not_bound_the_body(self):
        """Why the byte bound exists: 20,000 chars of state text encode to far more bytes."""
        big = "\u00e9\n\"\U0001F600" * 20_000
        st = ts._enforce_budget(
            {"request": big, "earlier_user_messages": [], "reply": big, "tool_error_count_in_turn": 0}
        )
        self.assertLessEqual(chars(st), ts.JUDGE_BUDGET_CHARS)
        q = ts._questions_for(st)
        raw = len(typesafe_client.encode_body(st, "jev-latest", q))
        self.assertGreater(raw, ts.JUDGE_BODY_BUDGET_BYTES)
        fit = ts.fit_state(st, q)
        self.assertLessEqual(len(typesafe_client.encode_body(fit, "jev-latest", q)), ts.JUDGE_BODY_BUDGET_BYTES)
        self.assertGreater(chars(fit), 0)  # trimmed to fit, not emptied

    def test_questions_alone_over_budget_raises_instead_of_cutting_them(self):
        st = {"request": "r", "earlier_user_messages": [], "reply": "a", "tool_error_count_in_turn": 0}
        with self.assertRaises(typesafe_client.TypeSafeError) as cm:
            ts.fit_state(st, ts._questions_for(st), budget=100)
        self.assertEqual(cm.exception.status, 413)

    def test_facet_state_trimmed_by_the_same_path(self):
        big = "\u00e9\n\"" * 5_000
        fs = {"first_prompt": big[:1500], "last_prompts": [big[:1500]] * 3, "last_reply": big[:3000], "correction_count": 1}
        q = ts._facet_questions()
        fit = ts.fit_state(fs, q, budget=12_000)
        self.assertLessEqual(len(typesafe_client.encode_body(fit, "jev-latest", q)), 12_000)
        self.assertEqual(fit["correction_count"], 1)


if __name__ == "__main__":
    unittest.main()
