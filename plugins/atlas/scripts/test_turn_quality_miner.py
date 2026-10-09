"""turn_quality miner: findings from seeded turn_scores rows."""

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import os
import shutil
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(__file__))

import atlas_db
import atlas_doctor
import turn_scoring

LIT = "literal_ask_delivered"  # noul, hit=low
DONE = "scope_drift"  # noul, hit=high, validated
NTC = "next_turn_correction"  # noul, hit=high


class TurnQualityMinerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.conn = atlas_db.connect(os.path.join(self.tmp, "atlas.db"))
        atlas_db.init(self.conn)
        self.pid = atlas_db.register_project(self.conn, "/repo/alpha", name="alpha")
        self.pid2 = atlas_db.register_project(self.conn, "/repo/beta", name="beta")
        self.seq = 0

    def tearDown(self):
        self.conn.close()
        shutil.rmtree(self.tmp)

    def _session(self, sid, pid):
        self.conn.execute(
            "INSERT OR IGNORE INTO session_logs(session_id, project_id) VALUES(?,?)",
            (sid, pid),
        )

    def _turn(self, sid, pid, scores, metrics=None):
        """One assistant reply; scores/metrics map judgment id -> value."""
        self.seq += 1
        uuid = f"u{self.seq}"
        self._session(sid, pid)
        ts = time.time() - 3600
        for j, v in (scores or {}).items():
            kind = "score" if turn_scoring.JUDGMENTS[j]["type"] == "score" else "noul"
            atlas_db.upsert_turn_score(
                self.conn, sid, uuid, j, ts=ts, kind=kind, value=v
            )
        for j, v in (metrics or {}).items():
            atlas_db.upsert_turn_score(
                self.conn, sid, uuid, j, ts=ts, kind="metric", value=v
            )
        self.conn.commit()
        return uuid

    def _mine(self, **kw):
        return atlas_doctor.mine_turn_quality(self.conn, "/x", **kw)

    def _keys(self, found):
        return {f["key"] for f in found}

    def test_finding_above_threshold_not_below(self):
        for i in range(20):  # 6/20 = 30% > 25%
            self._turn("s", self.pid, {DONE: 0.9 if i < 6 else 0.1})
        found = self._mine(min_turns=20)
        self.assertIn(f"{DONE}", self._keys(found))
        f = next(x for x in found if x["key"] == DONE)
        self.assertAlmostEqual(f["metric_value"], 0.3)
        self.assertEqual(f["target_path"], turn_scoring.JUDGMENTS[DONE]["surface"])
        self.assertEqual(f["evidence"]["n"], 20)
        self.assertEqual(len(f["evidence"]["examples"]), 3)

        # 5/20 = 25% is not above the threshold
        self.conn.execute("DELETE FROM turn_scores")
        for i in range(20):
            self._turn("s", self.pid, {DONE: 0.9 if i < 5 else 0.1})
        self.assertNotIn(DONE, self._keys(self._mine(min_turns=20)))

    def test_hit_low_direction(self):
        for i in range(20):
            self._turn("s", self.pid, {LIT: 0.2 if i < 10 else 0.9})
        self.assertIn(LIT, self._keys(self._mine(min_turns=20)))

    def test_min_turns_respected(self):
        for _ in range(19):
            self._turn("s", self.pid, {DONE: 0.95})
        self.assertEqual(self._mine(min_turns=20), [])
        self._turn("s", self.pid, {DONE: 0.95})
        self.assertIn(DONE, self._keys(self._mine(min_turns=20)))

    def test_per_project_finding(self):
        for _ in range(20):
            self._turn("a", self.pid, {DONE: 0.95})
        for _ in range(20):
            self._turn("b", self.pid2, {DONE: 0.05})
        keys = self._keys(self._mine(min_turns=20))
        self.assertIn(f"{DONE}:alpha", keys)
        self.assertNotIn(f"{DONE}:beta", keys)
        self.assertIn(DONE, keys)  # overall 20/40 = 50% also exceeds 25%

    def test_unvalidated_judgments_are_scored_but_never_mined(self):
        for i in range(20):
            self._turn(
                "s",
                self.pid,
                {"verbosity": 3.0 if i < 8 else 1.0, "done_claim_unverified": 0.95},
            )
        found = self._mine(min_turns=20)
        self.assertNotIn("verbosity", self._keys(found))
        self.assertNotIn("done_claim_unverified", self._keys(found))
        self.assertIn(
            "verbosity", found.evaluated
        )  # still evaluated, so stale findings sweep
        self.assertAlmostEqual(found.values["verbosity"], 0.4)

    def test_predictive_value_numbers(self):
        # 10 hit turns: 8 corrected; 10 not-hit turns: 1 corrected
        for i in range(10):
            self._turn("s", self.pid, {DONE: 0.9, NTC: 0.9 if i < 8 else 0.1})
        for i in range(10):
            self._turn("s", self.pid, {DONE: 0.1, NTC: 0.9 if i < 1 else 0.1})
        f = next(x for x in self._mine(min_turns=20) if x["key"] == DONE)
        p = f["evidence"]["predictive"]
        self.assertEqual((p["p_corr_given_hit"], p["n_hit"]), (0.8, 10))
        self.assertEqual((p["p_corr_given_not_hit"], p["n_not_hit"]), (0.1, 10))
        self.assertIn("80%", f["detail"])
        self.assertIn("10%", f["detail"])

    def test_zero_validity_judgment_is_neither_finding_nor_regression(self):
        """P(corr|hit)=0% vs P(corr|not hit)=0%: noise. No finding, and no
        remeasurable value (a value would let remeasure score it 'regressed')."""
        base = time.time() - 3600
        self._session("z", self.pid)
        for i in range(20):
            ts = base + i * 10
            atlas_db.upsert_turn_score(
                self.conn,
                "z",
                f"r{i}",
                DONE,
                ts=ts,
                kind="noul",
                value=0.95 if i < 10 else 0.05,
            )
            self.conn.execute(
                "INSERT INTO user_prompts(session_id,uuid,ts,text) VALUES(?,?,?,?)",
                ("z", f"p{i}", ts + 5, "next"),
            )
        self.conn.commit()
        found = self._mine(min_turns=20)
        self.assertNotIn(DONE, self._keys(found))
        self.assertIn(DONE, found.evaluated)  # so a stale open finding is resolved
        self.assertNotIn(DONE, found.values)

    def test_metric_findings(self):
        for i in range(20):
            self._turn(
                "s",
                self.pid,
                None,
                {
                    "header_present": 1 if i < 10 else 0,
                    "banned_punct": 2 if i < 5 else 0,
                },
            )
        found = {f["key"]: f for f in self._mine(min_turns=20)}
        hdr = found["metric:header_present"]
        self.assertAlmostEqual(hdr["metric_value"], 0.5)
        self.assertEqual(
            hdr["target_path"], "style: Status header / hooks/session_boot.py"
        )
        bp = found["metric:banned_punct"]
        self.assertAlmostEqual(bp["metric_value"], 0.25)
        self.assertEqual(bp["target_path"], "style: Characters")

    def test_metric_findings_quiet_when_compliant(self):
        for _ in range(20):
            self._turn("s", self.pid, None, {"header_present": 1, "banned_punct": 0})
        self.assertEqual(self._mine(min_turns=20), [])

    def test_old_rows_outside_window_ignored(self):
        for _ in range(20):
            self._turn("s", self.pid, {DONE: 0.95})
        self.conn.execute("UPDATE turn_scores SET ts = ts - 30*86400")
        self.conn.commit()
        self.assertEqual(self._mine(min_turns=20), [])

    def test_mine_upserts_stable_fingerprint_and_remeasure(self):
        for _ in range(20):
            self._turn("s", self.pid, {DONE: 0.95})
        real = atlas_doctor.mine_turn_quality
        atlas_doctor.MINERS["turn_quality"] = lambda c, r: real(c, r, min_turns=20)
        try:
            atlas_doctor.mine(self.conn, "/x")
            atlas_doctor.mine(self.conn, "/x")
            rows = self.conn.execute(
                "SELECT id, fingerprint, evidence_json FROM findings "
                "WHERE fingerprint LIKE 'turn_quality:%'"
            ).fetchall()
            fps = [r[1] for r in rows]
            self.assertIn(f"turn_quality:{DONE}", fps)
            self.assertEqual(len(fps), len(set(fps)))
            row = next(r for r in rows if r[1] == f"turn_quality:{DONE}")
            finding = atlas_db.get_finding(self.conn, row[0])
            self.assertAlmostEqual(
                atlas_doctor.measure_finding_metric(self.conn, finding, "/x"), 1.0
            )
            # fixed: no more hits -> resolved (0.0)
            self.conn.execute("UPDATE turn_scores SET value = 0.05")
            self.conn.commit()
            self.assertEqual(
                atlas_doctor.measure_finding_metric(self.conn, finding, "/x"), 0.0
            )
        finally:
            atlas_doctor.MINERS["turn_quality"] = real

    def test_mine_resolves_findings_that_stop_firing_and_reopens(self):
        for _ in range(20):
            self._turn("s", self.pid, {DONE: 0.95})
        real = atlas_doctor.mine_turn_quality
        atlas_doctor.MINERS["turn_quality"] = lambda c, r: real(c, r, min_turns=20)
        fp = f"turn_quality:{DONE}"

        def status():
            return self.conn.execute(
                "SELECT status FROM findings WHERE fingerprint=?", (fp,)
            ).fetchone()[0]

        try:
            atlas_doctor.mine(self.conn, "/x")
            self.assertEqual(status(), "open")
            self.conn.execute("UPDATE turn_scores SET value = 0.05")
            self.conn.commit()
            atlas_doctor.mine(self.conn, "/x")
            self.assertEqual(status(), "resolved")
            self.conn.execute("UPDATE turn_scores SET value = 0.95")
            self.conn.commit()
            atlas_doctor.mine(self.conn, "/x")
            self.assertEqual(status(), "open")
            # A user's verdict is never overwritten by auto-resolve.
            self.conn.execute(
                "UPDATE findings SET status='rejected' WHERE fingerprint=?", (fp,)
            )
            self.conn.execute("UPDATE turn_scores SET value = 0.05")
            self.conn.commit()
            atlas_doctor.mine(self.conn, "/x")
            self.assertEqual(status(), "rejected")
        finally:
            atlas_doctor.MINERS["turn_quality"] = real

    def test_ground_truth_uses_next_prompt_correction_signal(self):
        """Predictive value must not rest only on Jev agreeing with Jev: the
        next real prompt's regex user_correction signal is reported too."""
        base = time.time() - 3600
        self._session("g", self.pid)
        for i in range(20):
            hit = i < 10
            reply_ts = base + i * 10
            atlas_db.upsert_turn_score(
                self.conn,
                "g",
                f"r{i}",
                DONE,
                ts=reply_ts,
                kind="noul",
                value=0.95 if hit else 0.05,
            )
            puuid = f"p{i}"
            self.conn.execute(
                "INSERT INTO user_prompts(session_id,uuid,ts,text) VALUES(?,?,?,?)",
                ("g", puuid, reply_ts + 5, "next"),
            )
            # hits: 6/10 corrected; not hits: 1/10 corrected
            if (hit and i < 6) or i == 10:
                self.conn.execute(
                    "INSERT INTO signals(session_id,message_uuid,ts,signal_type) "
                    "VALUES(?,?,?,'user_correction')",
                    ("g", puuid, reply_ts + 5),
                )
        self.conn.commit()
        f = next(x for x in self._mine(min_turns=20) if x["key"] == DONE)
        gt = f["evidence"]["ground_truth"]
        self.assertAlmostEqual(gt["p_corr_given_hit"], 0.6)
        self.assertAlmostEqual(gt["p_corr_given_not_hit"], 0.1)
        self.assertEqual((gt["n_hit"], gt["n_not_hit"]), (10, 10))
        self.assertIn("Ground truth", f["detail"])

    def test_health_check_reports_key_name_only(self):
        old = {k: os.environ.get(k) for k in ("TYPESAFE_API_KEY", "ATLAS_DB")}
        os.environ["TYPESAFE_API_KEY"] = "sk-secret-value"
        os.environ["ATLAS_DB"] = os.path.join(self.tmp, "atlas.db")
        try:
            self._turn("s", self.pid, {DONE: 0.1})
            ok, detail = atlas_doctor.check_typesafe_scoring()
            self.assertTrue(ok)
            self.assertNotIn("sk-secret-value", detail)
            self.assertIn("1 turn_scores row(s)", detail)
            results, _ = atlas_doctor.run_checks()
            for r in results:
                if r["check"] == "typesafe-scoring":
                    self.assertEqual(r["severity"], "warn")
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v


class SweepScopeTest(TurnQualityMinerTest.__bases__[0]):
    """Auto-resolve only closes keys evaluated with enough data."""

    setUp = TurnQualityMinerTest.setUp
    tearDown = TurnQualityMinerTest.tearDown
    _session = TurnQualityMinerTest._session
    _turn = TurnQualityMinerTest._turn

    def test_thin_window_does_not_resolve(self):
        for _ in range(20):
            self._turn("s", self.pid, {DONE: 0.95})
        real = atlas_doctor.mine_turn_quality
        atlas_doctor.MINERS["turn_quality"] = lambda c, r: real(c, r, min_turns=20)
        fp = f"turn_quality:{DONE}"
        try:
            atlas_doctor.mine(self.conn, "/x")
            self.conn.execute("DELETE FROM turn_scores WHERE rowid % 2 = 0")
            self.conn.commit()
            atlas_doctor.mine(self.conn, "/x")
            status = self.conn.execute(
                "SELECT status FROM findings WHERE fingerprint=?", (fp,)
            ).fetchone()[0]
            self.assertEqual(status, "open")  # too little data is not a fix
        finally:
            atlas_doctor.MINERS["turn_quality"] = real

    def test_miners_without_evaluated_keys_are_never_swept(self):
        atlas_db.upsert_finding(self.conn, "tool_error_rate_high:bash", title="t")
        self.conn.commit()
        real = atlas_doctor.MINERS["tool_error_rate_high"]
        atlas_doctor.MINERS["tool_error_rate_high"] = lambda c, r: []
        try:
            atlas_doctor.mine(self.conn, "/x")
        finally:
            atlas_doctor.MINERS["tool_error_rate_high"] = real
        status = self.conn.execute(
            "SELECT status FROM findings WHERE fingerprint='tool_error_rate_high:bash'"
        ).fetchone()[0]
        self.assertEqual(status, "open")


if __name__ == "__main__":
    unittest.main()
