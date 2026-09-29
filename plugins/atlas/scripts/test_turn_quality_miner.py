"""turn_quality miner: findings from seeded turn_scores rows."""

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
DONE = "done_claim_unverified"  # noul, hit=high
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

    def test_verbosity_top_level(self):
        for i in range(20):
            self._turn("s", self.pid, {"verbosity": 3.0 if i < 8 else 1.0})
        self.assertIn("verbosity", self._keys(self._mine(min_turns=20)))

    def test_predictive_value_numbers(self):
        # 10 hit turns: 8 corrected; 10 not-hit turns: 1 corrected
        for i in range(10):
            self._turn("s", self.pid, {DONE: 0.9, NTC: 0.9 if i < 8 else 0.1})
        for i in range(10):
            self._turn("s", self.pid, {DONE: 0.1, NTC: 0.9 if i < 1 else 0.1})
        f = next(x for x in self._mine(min_turns=20) if x["key"] == DONE)
        p = f["evidence"]["predictive"]
        self.assertEqual(
            (p["p_corr_given_hit"], p["n_hit"]), (0.8, 10)
        )
        self.assertEqual((p["p_corr_given_not_hit"], p["n_not_hit"]), (0.1, 10))
        self.assertIn("80%", f["detail"])
        self.assertIn("10%", f["detail"])

    def test_metric_findings(self):
        for i in range(20):
            self._turn(
                "s",
                self.pid,
                None,
                {"header_present": 1 if i < 10 else 0, "banned_punct": 2 if i < 5 else 0},
            )
        found = {f["key"]: f for f in self._mine(min_turns=20)}
        hdr = found["metric:header_present"]
        self.assertAlmostEqual(hdr["metric_value"], 0.5)
        self.assertEqual(hdr["target_path"], "style: Status header / hooks/session_boot.py")
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


if __name__ == "__main__":
    unittest.main()
