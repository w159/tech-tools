"""colony_adherence miner: harness classification, reader routing, dispatch
discipline, and named-dispatch measurement from seeded tool_calls rows."""

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

    def test_ingested_omp_batches_count_named_only_when_every_item_is(self):
        """End to end: real ingest summaries of batched omp `task` calls
        through the miner. A batch with one unnamed item is NOT named, and an
        all-empty `names` list never matches the `name` token."""
        import session_ingest

        big = "w" * 900
        shapes = [
            [{"name": "ScoutA", "task": big}, {"name": "FixB", "task": big}],
            [{"name": "ScoutA", "task": big}, {"task": big}],
            [{"name": "", "task": big}, {"task": big}],
        ]
        for i in range(5):
            self._omp_session(f"b{i}")
        for i, tasks in enumerate(shapes):
            summary, _ = session_ingest.summarize_input({"context": big, "tasks": tasks})
            self._call(f"b{i}", "task", summary)
        omp = self._by_key(self._mine())["omp"]
        self.assertAlmostEqual(omp["evidence"]["named_dispatch_rate"], 1 / 3)
        self.assertIn("1/3 named", omp["detail"])

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


class DispatchNameSurvivesIngestTest(unittest.TestCase):
    """The named-dispatch rate is only trustworthy if ingest keeps the name
    past the 500-char summary cap, for both harnesses' dispatch shapes."""

    def setUp(self):
        import session_ingest

        self.summarize = session_ingest.summarize_input
        self.big = "x" * 900

    def test_claude_agent_name_survives_a_long_prompt(self):
        summary, _ = self.summarize(
            {"description": "d", "prompt": self.big, "subagent_type": "atlas:implementer", "name": "auth-impl"}
        )
        self.assertTrue(summary.startswith('{"name": "auth-impl"'))
        self.assertEqual(atlas_doctor._colony_named_dispatch_stats([summary])[0], 1.0)

    def test_omp_batch_is_named_only_when_every_item_is(self):
        full = {"context": self.big, "tasks": [{"name": "ScoutA", "task": self.big}, {"name": "FixB", "task": self.big}]}
        partial = {"context": self.big, "tasks": [{"name": "ScoutA", "task": self.big}, {"task": self.big}]}
        rows = [self.summarize(full)[0], self.summarize(partial)[0]]
        rate, text = atlas_doctor._colony_named_dispatch_stats(rows)
        self.assertEqual((rate, text), (0.5, "1/2 named"))



class _ColonyDb(unittest.TestCase):
    """Seeded tool_calls DB plus the row/mining helpers the routing and
    shell-edit tests share (the same row shape session_ingest writes)."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.conn = atlas_db.connect(os.path.join(self.tmp, "atlas.db"))
        atlas_db.init(self.conn)
        self.seq = 0

    def tearDown(self):
        self.conn.close()
        shutil.rmtree(self.tmp)

    def _call(self, sid, tool_name, summary=None, ts=NOW, sidechain=0):
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

    def _deny(self, tool_name):
        """Mark the most recent row for tool_name as denied (it never ran)."""
        self.conn.execute(
            "UPDATE tool_calls SET denied=1 WHERE id=(SELECT MAX(id) FROM "
            "tool_calls WHERE tool_name=?)",
            (tool_name,),
        )

    def _mine(self, **kw):
        return atlas_doctor.mine_colony_adherence(self.conn, "/x", **kw)

    def _by_key(self, found):
        return {f["key"]: f for f in found}

    def _balanced(self, sid, ctx=4):
        """1 native Read against `ctx` ctx calls: leaves headroom so a few Bash
        rows in a test never push native_reader_share over the cap."""
        self._call(sid, "Read")
        for _ in range(ctx):
            self._call(sid, "mcp__lean-ctx__ctx_search")


class ColonyReaderRoutingTest(_ColonyDb):
    """native_reader_share counts what the agent actually ran natively:
    `lean-ctx -c`-wrapped bash is a ctx route, and a call a hook/extension
    denied (it never ran) is neither native usage nor ctx usage."""

    def _share(self, harness):
        found = self._by_key(self._mine())
        return found[harness]["evidence"] if harness in found else None

    def test_lean_ctx_wrapped_bash_is_ctx_not_native(self):
        self.assertTrue(atlas_doctor._colony_is_ctx_call(
            "Bash", '{"command": "/opt/homebrew/bin/lean-ctx -c \'ls -la\'"}'))
        self.assertTrue(atlas_doctor._colony_is_ctx_call(
            "bash", '{"command": "lean-ctx -c git status"}'))
        self.assertFalse(atlas_doctor._colony_is_ctx_call(
            "Bash", '{"command": "git status && echo lean-ctx"}'))
        self.assertFalse(atlas_doctor._colony_is_ctx_call("Bash", None))

    def test_wrapped_bash_leaves_native_share_under_the_cap(self):
        for i in range(5):
            sid = f"w{i}"
            self._call(sid, "Read")
            for _ in range(3):  # would be 4/4 native without the wrapper rule
                self._call(sid, "Bash", '{"command": "lean-ctx -c \'pytest -q\'"}')
        # 5 native Read / (5 native + 15 wrapped-ctx) = 0.25: silent
        self.assertEqual(self._mine(), [])

    def test_unwrapped_bash_still_counts_native(self):
        for i in range(5):
            self._call(f"n{i}", "Bash", '{"command": "pytest -q"}')
        self.assertEqual(self._share("claude-code")["native_calls"], 5)

    def test_denied_native_calls_are_excluded_from_native(self):
        for i in range(5):
            sid = f"x{i}"
            self._call(sid, "Grep", '{"pattern": "a"}')
            self._deny("Grep")  # blocked: never ran
            self._call(sid, "Read")
            self._call(sid, "mcp__lean-ctx__ctx_search")
        self.assertEqual(self._mine(), [])  # 5 native / 10 = 0.5, at the cap
        self._call("x0", "Read")  # one real extra native call tips it
        ev = self._share("claude-code")
        self.assertEqual(ev["native_calls"], 6)  # the 5 denied Greps are not in it

    def test_denied_omp_recall_gate_bash_is_excluded(self):
        for i in range(5):
            sid = f"g{i}"
            self._call(sid, "bash", '{"command": "ls"}')
            self._deny("bash")  # [atlas gate] recall block
            self._call(sid, "read")
            self._call(sid, "ctx_read")
        self.assertEqual(self._mine(), [])

    def test_a_denied_ctx_call_is_not_ctx_usage_either(self):
        for i in range(5):
            sid = f"c{i}"
            self._call(sid, "Read")
            self._call(sid, "mcp__lean-ctx__ctx_search")
            self._deny("mcp__lean-ctx__ctx_search")
        ev = self._share("claude-code")
        self.assertEqual((ev["native_calls"], ev["ctx_calls"]), (5, 0))

    def test_omp_device_calls_are_recognised_as_ctx(self):
        for summary in (
            '{"path": "xd://mcp__lean_ctx_ctx_read", "content": "{}"}',
            '{"path": "xd://mcp__context_mode_context_mode_ctx_execute", "content": "{}"}',
            '{"path": "xd://mcp__lean_ctx_ctx_shell", "content": "{}"}',
        ):
            self.assertTrue(atlas_doctor._colony_is_ctx_call("write", summary), summary)
        # a write to any other xd:// device (or a repo file) is not a ctx route
        self.assertFalse(atlas_doctor._colony_is_ctx_call(
            "write", '{"path": "xd://mcp__serena_find_symbol", "content": "{}"}'))
        self.assertFalse(atlas_doctor._colony_is_ctx_call(
            "write", '{"path": "src/a.py", "content": "x"}'))


class ColonyShellEditTest(_ColonyDb):
    """delegation_rate must see edits made through the shell (sed -i, tee,
    redirects to repo files) and report main-thread edit counts beside the rate
    so a high rate over a handful of edits is not misleading."""

    def _mine_cc(self):
        return self._by_key(self._mine()).get("claude-code")

    def test_shell_edit_classifier(self):
        yes = [
            "sed -i 's/a/b/' src/calc.py",
            "sed -i.bak 's/a/b/' src/calc.py",
            "sed -i '' 's/a/b/' src/calc.py",
            "sed 's/a/b/' src/a.py > src/b.py",
            "git diff > changes.patch",
            "echo x > src/calc.py",
            "printf 'x' >> src/calc.py",
            "cat <<EOF | tee src/calc.py",
            "tee -a src/calc.py < patch.txt",
            "lean-ctx -c \"sed -i 's/a/b/' src/calc.py\"",
        ]
        no = [
            "pytest -q > /dev/null",
            "pytest -q 2>&1 | tee /dev/null",
            "echo x > docs/CHANGELOG.md",
            "echo x > .atlas/evidence/out.txt",
            "sed -n '1,5p' src/calc.py",
            "sed -i 's/a/b/' docs/CHANGELOG.md",
            "sed -i 's/a/b/' /tmp/x.txt",
            "sed 's/a/b/' src/a.py > /tmp/o",
            "python3 -c 'print(1>0)'",
            "cmd 2>/dev/null",
            "git diff > /tmp/p.diff",
            "git status",
            "echo x > /tmp/scratch.txt",
            "ls 2>&1",
            None,
        ]
        for c in yes:
            self.assertTrue(atlas_doctor._colony_is_shell_edit(c), c)
        for c in no:
            self.assertFalse(atlas_doctor._colony_is_shell_edit(c), c)

    def test_shell_edit_sessions_enter_the_delegation_denominator(self):
        for i in range(5):
            sid = f"s{i}"
            self._balanced(sid)
            self._call(sid, "Bash", '{"command": "sed -i \'s/a/b/\' src/calc.py"}')
            if i < 1:  # 1/5 = 0.2 delegated
                self._call(sid, "Agent", '{"subagent_type": "explorer"}')
        cc = self._mine_cc()
        self.assertIsNotNone(cc)
        self.assertAlmostEqual(cc["evidence"]["delegation_rate"], 0.2)

    def test_main_thread_edit_counts_ride_next_to_the_rate(self):
        for i in range(5):
            sid = f"m{i}"
            self._balanced(sid)
            self._call(sid, "Edit", '{"file_path": "/repo/src/a.py"}')
            self._call(sid, "Bash", '{"command": "echo y > src/b.py"}')
        cc = self._mine_cc()
        ev = cc["evidence"]
        self.assertEqual(ev["main_thread_edits"], 10)  # 5 Edit + 5 shell
        self.assertEqual(ev["shell_edits"], 5)
        self.assertEqual(ev["edit_sessions"], 5)
        self.assertIn("10 main-thread edit(s)", cc["detail"])
        self.assertIn("5 via shell", cc["detail"])

    def test_docs_and_devnull_shell_writes_are_not_edits(self):
        for i in range(5):
            sid = f"q{i}"
            self._balanced(sid)
            self._call(sid, "Bash", '{"command": "echo y > docs/CHANGELOG.md"}')
            self._call(sid, "Bash", '{"command": "pytest -q > /dev/null 2>&1"}')
        # no repo edit sessions -> delegation n/a, share 0.5 at cap -> silent
        self.assertEqual(self._mine(), [])

    def test_denied_shell_edit_never_ran_so_it_is_not_an_edit(self):
        for i in range(5):
            sid = f"r{i}"
            self._balanced(sid)
            self._call(sid, "Bash", '{"command": "sed -i \'s/a/b/\' src/calc.py"}')
            self._deny("Bash")
        self.assertEqual(self._mine(), [])


if __name__ == "__main__":
    unittest.main()
