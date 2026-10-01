"""colony_adherence miner: harness classification, reader routing, dispatch
discipline, and named-dispatch measurement from seeded tool_calls rows."""

import os
import shutil
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(__file__))

import atlas_db
import atlas_doctor

NOW = time.time() - 60


class ColonyAdherenceMinerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.conn = atlas_db.connect(os.path.join(self.tmp, "atlas.db"))
        atlas_db.init(self.conn)
        self.seq = 0

    def tearDown(self):
        self.conn.close()
        shutil.rmtree(self.tmp)

    def _call(self, sid, tool_name, summary=None, ts=NOW, sidechain=0):
        """One tool_calls row; mirrors session_ingest's shapes."""
        self.seq += 1
        atlas_db.insert_tool_call(
            self.conn,
            sid,
            {
                "message_uuid": f"u{self.seq}",
                "ts": ts,
                "is_sidechain": sidechain,
                "tool_use_id": f"t{self.seq}",
                "tool_name": tool_name,
                "kind": "agent" if tool_name in ("Agent", "Task") else "builtin",
                "target": None,
                "server": None,
                "input_summary": summary,
                "input_bytes": None,
                "is_error": None,
                "result_bytes": None,
            },
        )

    def _mine(self, **kw):
        return atlas_doctor.mine_colony_adherence(self.conn, "/x", **kw)

    def _by_key(self, found):
        return {f["key"]: f for f in found}

    def _omp_session(self, sid, native=2, ctx=1):
        """omp: lowercase native readers plus one of EACH ctx-call form."""
        for _ in range(native):
            self._call(sid, "bash")
            self._call(sid, "read")
        self._call(sid, "mcp__lean-ctx__ctx_search")
        self._call(sid, "ctx_read")
        self._call(
            sid,
            "write",
            '{"path": "xd://mcp__lean_ctx_ctx_search", "content": "{}"}',
        )
        # native counts bash+read; ctx counts all three forms above
        return 2 * native, 3 * ctx

    def _cc_session(self, sid, native=4, ctx=1):
        self._call(sid, "Bash")
        for _ in range(native - 1):
            self._call(sid, "Read")
        self._call(sid, "mcp__lean-ctx__ctx_search")
        return native, 1

    # --- both harnesses, ctx forms, thresholds ------------------------------

    def test_both_harnesses_fire_with_all_three_ctx_forms(self):
        for i in range(5):
            self._omp_session(f"o{i}")  # share 10/13
            self._cc_session(f"c{i}")  # share 4/5
        found = self._by_key(self._mine())
        self.assertEqual(set(found), {"omp", "claude-code"})
        omp = found["omp"]
        self.assertEqual(omp["evidence"]["native_calls"], 20)
        self.assertEqual(omp["evidence"]["ctx_calls"], 15)
        self.assertAlmostEqual(omp["evidence"]["native_reader_share"], 20 / 35)
        cc = found["claude-code"]
        self.assertAlmostEqual(cc["evidence"]["native_reader_share"], 0.8)
        self.assertEqual(cc["target_path"], "plugins/atlas/hooks/dispatch_tripwire.py")
        self.assertEqual(omp["target_path"], "plugins/atlas/omp/index.ts")

    def test_share_at_cap_does_not_fire_above_cap_does(self):
        # 4 native + 4 ctx = 0.5, exactly at COLONY_NATIVE_SHARE_MAX: silent
        for i in range(5):
            for _ in range(4):
                self._call(f"e{i}", "Read")
                self._call(f"e{i}", "mcp__lean-ctx__ctx_search")
        self.assertEqual(self._mine(), [])
        # one more native call in one session tips it over: 21/40 > 0.5
        self._call("e0", "Glob")
        found = self._by_key(self._mine())
        self.assertIn("claude-code", found)
        self.assertGreater(found["claude-code"]["evidence"]["native_reader_share"], 0.5)

    # --- sidechain exclusion ------------------------------------------------

    def test_sidechain_rows_are_excluded(self):
        # 5 omp sessions whose main thread is pure ctx, sidechains native-only:
        # native must stay 0 -> share 0.0, no native finding.
        for i in range(5):
            self._call(f"s{i}", "mcp__lean-ctx__ctx_read")
            self._call(f"s{i}", "Read", sidechain=1)
        self.assertEqual(self._mine(), [])

    # --- delegation rate ----------------------------------------------------

    def test_delegation_rate_below_threshold_fires(self):
        for i in range(5):
            self._call(f"d{i}", "Read")  # keeps native share at 0.5 (1:1)
            self._call(f"d{i}", "mcp__lean-ctx__ctx_search")
            self._call(f"d{i}", "Edit", '{"file_path": "/repo/src/a.py"}')
            if i < 2:  # 2/5 = 0.4 delegation
                self._call(f"d{i}", "Agent", '{"subagent_type": "explorer"}')
        found = self._by_key(self._mine())
        cc = found["claude-code"]
        self.assertAlmostEqual(cc["evidence"]["delegation_rate"], 0.4)
        self.assertEqual(cc["evidence"]["native_reader_share"], 0.5)

    def test_delegation_rate_at_threshold_does_not_fire(self):
        for i in range(5):
            self._call(f"a{i}", "Read")
            self._call(f"a{i}", "mcp__lean-ctx__ctx_search")
            self._call(f"a{i}", "Write", '{"file_path": "/repo/src/a.py"}')
            if i < 4:  # 4/5 = 0.8 exactly
                self._call(f"a{i}", "Agent", '{"subagent_type": "explorer"}')
        self.assertEqual(self._mine(), [])

    def test_docs_only_sessions_are_not_delegation_denominator(self):
        for i in range(5):
            self._call(f"g{i}", "Read")
            self._call(f"g{i}", "mcp__lean-ctx__ctx_search")
            # docs + .atlas writes: same carve-out as the tripwire
            self._call(f"g{i}", "Write", '{"file_path": "/repo/docs/x.md"}')
            self._call(f"g{i}", "Edit", '{"file_path": "/repo/.atlas/run.md"}')
        found = self._mine()
        self.assertEqual(found, [])  # denom 0, share 0.5 -> silent
        for i in range(5):
            self._call(f"g{i}", "Read")  # 8/12 = 0.67 > 0.5 -> fires...
        found = self._by_key(self._mine())
        cc = found["claude-code"]
        self.assertIsNone(cc["evidence"]["delegation_rate"])
        self.assertIn("0/0", cc["detail"])

    def test_uri_writes_and_dispatch_counting(self):
        for i in range(5):
            self._call(f"u{i}", "read")
            self._call(f"u{i}", "read")  # 2:1 native share -> fires
            self._call(f"u{i}", "mcp__lean-ctx__ctx_search")
            # peer message write: not a repo edit, no denominator effect
            self._call(f"u{i}", "write", '{"path": "agent://Peer", "content": "hi"}')
            self._call(f"u{i}", "task", '{"i": "work", "context": "# Goal"}')
        found = self._by_key(self._mine())
        omp = found["omp"]
        self.assertIsNone(omp["evidence"]["delegation_rate"])
        # named rate: summaries short+complete, none carry name -> 0/5, not unknown
        self.assertEqual(omp["evidence"]["named_dispatch_rate"], 0.0)

    # --- named dispatch rate ------------------------------------------------

    def test_named_dispatch_rate_mixed_and_unknown(self):
        for i in range(5):
            self._omp_session(f"n{i}")
        # one named, one determinably unnamed, one truncated, one NULL
        self._call("n0", "task", '{"name": "Scout", "context": "x"}')
        self._call("n1", "task", '{"i": "work", "context": "x"}')
        self._call("n2", "task", '{"context": "' + "y" * 600 + '"}')
        self._call("n3", "task", None)
        found = self._by_key(self._mine())
        rate = found["omp"]["evidence"]["named_dispatch_rate"]
        self.assertEqual(rate, 0.5)
        self.assertIn("2 more", found["omp"]["detail"])

    def test_named_dispatch_unknown_when_all_truncated(self):
        for i in range(5):
            self._omp_session(f"t{i}")
            self._call(f"t{i}", "task", '{"context": "' + "z" * 600 + '"}')
        found = self._by_key(self._mine())
        omp = found["omp"]
        rate = omp["evidence"]["named_dispatch_rate"]
        self.assertNotIsInstance(rate, float)
        self.assertIn("unknown", rate)
        self.assertIn("unknown", omp["detail"])

    # --- classification and silence ------------------------------------------

    def test_mcp_only_sessions_are_not_classified(self):
        for i in range(5):
            self._omp_session(f"m{i}")
            self._call(f"m{i}", "mcp__other__tool")
        found = self._by_key(self._mine())
        self.assertEqual(found["omp"]["evidence"]["sessions"], 5)
        self.assertNotIn("claude-code", found)

    def test_codex_style_lowercase_names_classify_as_omp(self):
        for i in range(5):
            self._call(f"x{i}", "exec_command")
            self._call(f"x{i}", "read")
            self._call(f"x{i}", "read")  # 2 native : 1 ctx -> share 2/3
            self._call(f"x{i}", "mcp__lean-ctx__ctx_shell")
        found = self._by_key(self._mine())
        self.assertIn("omp", found)
        self.assertNotIn("claude-code", found)

    def test_low_sample_window_is_silent_and_not_evaluated(self):
        for i in range(4):  # one below COLONY_MIN_SESSIONS
            self._omp_session(f"q{i}")  # share 2/3 > 0.5
        self.assertEqual(self._mine(), [])
        self.assertEqual(atlas_doctor.mine_colony_adherence(self.conn, "/x").evaluated, set())

    def test_fired_keys_stay_evaluated_for_sweep(self):
        for i in range(5):
            self._omp_session(f"w{i}")
        found = self._mine()
        self.assertEqual(found.evaluated, {"omp"})

    # --- registration + mine() end-to-end ------------------------------------

    def test_registered_and_mine_upserts_without_duplicates(self):
        self.assertIs(
            atlas_doctor.MINERS["colony_adherence"],
            atlas_doctor.mine_colony_adherence,
        )
        for i in range(5):
            self._omp_session(f"r{i}")
        counts = atlas_doctor.mine(self.conn, "/x")
        self.assertEqual(counts["colony_adherence"], 1)
        row = self.conn.execute(
            "SELECT fingerprint, status FROM findings "
            "WHERE fingerprint LIKE 'colony_adherence:%'"
        ).fetchall()
        self.assertEqual([r[0] for r in row], ["colony_adherence:omp"])
        self.assertEqual(row[0][1], "open")
        counts = atlas_doctor.mine(self.conn, "/x")  # re-run: upsert, no dup
        self.assertEqual(counts["colony_adherence"], 1)
        self.assertEqual(
            self.conn.execute(
                "SELECT COUNT(*) FROM findings WHERE fingerprint='colony_adherence:omp'"
            ).fetchone()[0],
            1,
        )


if __name__ == "__main__":
    unittest.main()
