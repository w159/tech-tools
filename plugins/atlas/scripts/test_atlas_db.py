import os, tempfile, unittest
import atlas_db


class AtlasDbTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "atlas.db")
        self.conn = atlas_db.connect(self.path)
        atlas_db.init(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_init_is_idempotent(self):
        atlas_db.init(self.conn)  # second call must not raise
        names = {
            r[0]
            for r in self.conn.execute(
                "select name from sqlite_master where type='table'"
            )
        }
        self.assertTrue(
            {"projects", "runs", "events", "dispatches", "metrics", "improvements"}
            <= names
        )

    def test_register_project_is_stable_by_path(self):
        a = atlas_db.register_project(self.conn, "/repo/x", "x", "python")
        b = atlas_db.register_project(self.conn, "/repo/x")
        self.assertEqual(a, b)  # same path -> same id

    def test_inline_ops_reset_on_dispatch(self):
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-1")
        for _ in range(3):
            atlas_db.log_event(self.conn, rid, "Read", "main", 1, "a.py")
        self.assertEqual(atlas_db.inline_ops_since_last_dispatch(self.conn, rid), 3)
        atlas_db.log_dispatch(self.conn, rid, "atlas:explorer")
        self.assertEqual(atlas_db.inline_ops_since_last_dispatch(self.conn, rid), 0)
        atlas_db.log_event(self.conn, rid, "Grep", "main", 1)
        self.assertEqual(atlas_db.inline_ops_since_last_dispatch(self.conn, rid), 1)

    def test_finalize_and_run_metrics(self):
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-1")
        atlas_db.log_event(self.conn, rid, "Read", "main", 1)
        atlas_db.log_dispatch(self.conn, rid, "atlas:implementer")
        atlas_db.finalize_run(self.conn, rid, wall_clock_s=42.0)
        m = atlas_db.run_metrics(self.conn, rid)
        self.assertEqual(m["inline_ops"], 1)
        self.assertEqual(m["dispatches"], 1)
        self.assertEqual(m["wall_clock_s"], 42.0)

    def test_record_recall_increments_and_survives_derive(self):
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-recall")
        atlas_db.record_recall(self.conn, rid, True)
        atlas_db.record_recall(self.conn, rid, True)
        atlas_db.record_recall(self.conn, rid, False)
        m = atlas_db.run_metrics(self.conn, rid)
        self.assertEqual(m["recall_hits"], 2)
        self.assertEqual(m["recall_misses"], 1)
        # A derive refresh must NOT clobber recall (it upserts only mirror-derived
        # columns), so recall survives every Stop/SubagentStop cycle.
        atlas_db.derive_run_metrics(self.conn, rid, "sess-recall")
        m2 = atlas_db.run_metrics(self.conn, rid)
        self.assertEqual(m2["recall_hits"], 2)
        self.assertEqual(m2["recall_misses"], 1)

    def test_record_improvement_and_trends(self):
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-1")
        atlas_db.finalize_run(self.conn, rid)
        atlas_db.record_improvement(
            self.conn, rid, "parallelism", "0 waves", ">=3 waves", "fan out the audit"
        )
        rows = self.conn.execute("select count(*) from improvements").fetchone()
        self.assertEqual(rows[0], 1)
        self.assertGreaterEqual(len(atlas_db.trends(self.conn)), 1)

    def test_derive_run_metrics_from_mirror(self):
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-d")
        atlas_db.upsert_session_log(
            self.conn, "sess-d", project_id=pid, started_at=100.0, ended_at=160.0
        )
        # main-thread context peak = 1000 + 200; a sidechain msg must be ignored
        atlas_db.insert_message(
            self.conn,
            "sess-d",
            {
                "uuid": "m1",
                "role": "assistant",
                "is_sidechain": 0,
                "input_tokens": 1000,
                "cache_read_tokens": 200,
            },
        )
        atlas_db.insert_message(
            self.conn,
            "sess-d",
            {
                "uuid": "m2",
                "role": "assistant",
                "is_sidechain": 1,
                "input_tokens": 9999,
                "cache_read_tokens": 9999,
            },
        )
        # in_flight_peak / parallel_waves are timestamp-based off tool_calls
        # (kind='agent') - three dispatches within the 10s window.
        atlas_db.insert_tool_call(
            self.conn,
            "sess-d",
            {
                "tool_use_id": "t1",
                "kind": "agent",
                "target": "atlas:implementer",
                "ts": 100.0,
            },
        )
        atlas_db.insert_tool_call(
            self.conn,
            "sess-d",
            {
                "tool_use_id": "t2",
                "kind": "agent",
                "target": "atlas:implementer",
                "ts": 101.0,
            },
        )
        atlas_db.insert_tool_call(
            self.conn,
            "sess-d",
            {
                "tool_use_id": "t3",
                "kind": "agent",
                "target": "atlas:verifier",
                "ts": 102.0,
            },
        )
        # verifier_coverage now comes from the dispatches table (reliable agent_type),
        # not tool_calls targets: two implementer + one verifier -> coverage 0.5.
        atlas_db.log_dispatch(self.conn, rid, "atlas:implementer")
        atlas_db.log_dispatch(self.conn, rid, "atlas:implementer")
        atlas_db.log_dispatch(self.conn, rid, "atlas:verifier")
        self.conn.commit()
        d = atlas_db.derive_run_metrics(self.conn, rid, "sess-d")
        self.assertEqual(d["est_context_tokens"], 1200)  # sidechain excluded
        self.assertEqual(d["verifier_coverage"], 0.5)
        self.assertEqual(d["in_flight_peak"], 3)  # all 3 within 10s
        self.assertEqual(d["parallel_waves"], 1)
        self.assertEqual(d["wall_clock_s"], 60.0)
        m = atlas_db.run_metrics(self.conn, rid)
        self.assertEqual(m["est_context_tokens"], 1200)
        self.assertIsNone(m["recall_hits"])  # never auto-derived

    def test_verifier_coverage_from_dispatches_partial(self):
        # 3 implementer + 2 verifier dispatches -> coverage 2/3, one unpaired.
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-cov1")
        for _ in range(3):
            atlas_db.log_dispatch(self.conn, rid, "atlas:implementer")
        for _ in range(2):
            atlas_db.log_dispatch(self.conn, rid, "atlas:verifier")
        self.conn.commit()
        d = atlas_db.derive_run_metrics(self.conn, rid, "sess-cov1")
        self.assertAlmostEqual(d["verifier_coverage"], 2 / 3)
        self.assertEqual(atlas_db.unpaired_implementer_dispatches(self.conn, rid), 1)

    def test_verifier_coverage_capped_and_no_unpaired(self):
        # 2 implementer + 3 verifier -> coverage capped at 1.0, none unpaired.
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-cov2")
        for _ in range(2):
            atlas_db.log_dispatch(self.conn, rid, "atlas:implementer")
        for _ in range(3):
            atlas_db.log_dispatch(self.conn, rid, "atlas:verifier")
        self.conn.commit()
        d = atlas_db.derive_run_metrics(self.conn, rid, "sess-cov2")
        self.assertEqual(d["verifier_coverage"], 1.0)
        self.assertEqual(atlas_db.unpaired_implementer_dispatches(self.conn, rid), 0)

    def test_verifier_coverage_null_when_no_implementer(self):
        # 0 implementer dispatches -> coverage None (not applicable), 0 unpaired.
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-cov3")
        atlas_db.log_dispatch(self.conn, rid, "atlas:verifier")
        atlas_db.log_dispatch(self.conn, rid, "atlas:explorer")
        self.conn.commit()
        d = atlas_db.derive_run_metrics(self.conn, rid, "sess-cov3")
        self.assertIsNone(d["verifier_coverage"])
        self.assertEqual(atlas_db.unpaired_implementer_dispatches(self.conn, rid), 0)

    def test_finalize_defaults_wall_clock_from_started_at(self):
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-w")
        atlas_db.finalize_run(self.conn, rid)  # no wall_clock_s passed
        m = atlas_db.run_metrics(self.conn, rid)
        self.assertIsNotNone(m["wall_clock_s"])  # was NULL on every historical run
        self.assertGreaterEqual(m["wall_clock_s"], 0.0)

    def test_latest_run_id_resolves_after_finalize(self):
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-l")
        atlas_db.finalize_run(self.conn, rid)  # closes the run (ended_at set)
        self.assertIsNone(atlas_db.current_run_id(self.conn, "sess-l"))  # closed
        self.assertEqual(
            atlas_db.latest_run_id(self.conn, "sess-l"), rid
        )  # still found

    def test_derive_does_not_clobber_finalized_wall_clock(self):
        # Regression: finalize_run sets the authoritative wall clock; a later
        # derive_run_metrics (transcript-span based, often 0) must NOT overwrite it.
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-wc")
        atlas_db.finalize_run(self.conn, rid, wall_clock_s=123.0)
        atlas_db.upsert_session_log(
            self.conn, "sess-wc", project_id=pid, started_at=100.0, ended_at=100.0
        )  # zero-span transcript -> derived wall = 0.0
        self.conn.commit()
        atlas_db.derive_run_metrics(self.conn, rid, "sess-wc")
        self.assertEqual(atlas_db.run_metrics(self.conn, rid)["wall_clock_s"], 123.0)

    def test_derive_fills_wall_clock_when_unset(self):
        # The fallback still works: a backfill-only run (never finalized) gets the
        # transcript-span wall clock from derive.
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-bf")
        atlas_db.upsert_session_log(
            self.conn, "sess-bf", project_id=pid, started_at=100.0, ended_at=160.0
        )
        self.conn.commit()
        atlas_db.derive_run_metrics(self.conn, rid, "sess-bf")
        self.assertEqual(atlas_db.run_metrics(self.conn, rid)["wall_clock_s"], 60.0)

    def test_trends_exposes_full_metric_set(self):
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-t")
        atlas_db.finalize_run(self.conn, rid)
        row = atlas_db.trends(self.conn)[0]
        for col in (
            "parallel_waves",
            "in_flight_peak",
            "est_context_tokens",
            "verifier_coverage",
        ):
            self.assertIn(col, row)  # documented dimensions must be selectable

    def test_kind_column_migration_is_idempotent(self):
        # init() was called in setUp; calling it again must not raise even
        # though the kind column already exists (ALTER TABLE would conflict).
        atlas_db.init(self.conn)  # second call
        atlas_db.init(self.conn)  # third call for extra certainty
        cols = {r[1] for r in self.conn.execute("PRAGMA table_info(runs)")}
        self.assertIn("kind", cols)

    def test_agent_column_migration_from_pre_agent_db(self):
        # A DB whose session_logs predates the agent column must migrate cleanly:
        # init() adds the column and every pre-existing row reads 'claude'.
        path = os.path.join(self.tmp, "old.db")
        raw = atlas_db.connect(path)
        # old-schema session_logs: exactly the pre-agent columns, no `agent`.
        raw.executescript(
            "CREATE TABLE session_logs ("
            "  id INTEGER PRIMARY KEY, session_id TEXT UNIQUE NOT NULL,"
            "  project_id INTEGER, transcript_path TEXT, cwd TEXT, git_branch TEXT,"
            "  model TEXT, started_at REAL, ended_at REAL,"
            "  message_count INTEGER DEFAULT 0, user_prompt_count INTEGER DEFAULT 0,"
            "  tool_call_count INTEGER DEFAULT 0, error_count INTEGER DEFAULT 0,"
            "  input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,"
            "  cache_read_tokens INTEGER DEFAULT 0, cache_creation_tokens INTEGER DEFAULT 0,"
            "  cursor_bytes INTEGER DEFAULT 0, cursor_lines INTEGER DEFAULT 0,"
            "  file_size INTEGER DEFAULT 0, file_mtime REAL, last_ingest_at REAL);"
        )
        raw.execute("INSERT INTO session_logs(session_id) VALUES('legacy-1')")
        raw.commit()
        self.assertNotIn(
            "agent",
            {r[1] for r in raw.execute("PRAGMA table_info(session_logs)")},
        )
        atlas_db.init(raw)  # must not raise; adds the column
        cols = {r[1] for r in raw.execute("PRAGMA table_info(session_logs)")}
        self.assertIn("agent", cols)
        agent = raw.execute(
            "SELECT agent FROM session_logs WHERE session_id='legacy-1'"
        ).fetchone()[0]
        self.assertEqual(agent, "claude")  # DEFAULT backfilled the old row
        atlas_db.init(raw)  # idempotent second call
        raw.close()

    def test_upsert_session_log_agent_default_and_override(self):
        # No agent passed -> column DEFAULT 'claude'. Explicit agent -> that value.
        atlas_db.upsert_session_log(self.conn, "s-default", cwd="/repo/x")
        atlas_db.upsert_session_log(self.conn, "s-codex", agent="codex", cwd="/repo/y")
        rows = dict(
            self.conn.execute("SELECT session_id, agent FROM session_logs").fetchall()
        )
        self.assertEqual(rows["s-default"], "claude")
        self.assertEqual(rows["s-codex"], "codex")

    def test_worker_run_excluded_from_trends(self):
        pid = atlas_db.register_project(self.conn, "/repo/x")
        # orchestrator run: session has a non-sidechain message
        rid_orc = atlas_db.start_run(self.conn, pid, "sess-orc")
        atlas_db.finalize_run(self.conn, rid_orc)
        atlas_db.insert_message(
            self.conn,
            "sess-orc",
            {"uuid": "mo1", "role": "assistant", "is_sidechain": 0},
        )
        self.conn.commit()
        # worker run: session has only sidechain messages
        rid_wkr = atlas_db.start_run(self.conn, pid, "sess-wkr")
        atlas_db.finalize_run(self.conn, rid_wkr)
        atlas_db.insert_message(
            self.conn,
            "sess-wkr",
            {"uuid": "mw1", "role": "assistant", "is_sidechain": 1},
        )
        self.conn.commit()
        # derive classifies both runs
        atlas_db.derive_run_metrics(self.conn, rid_orc, "sess-orc")
        atlas_db.derive_run_metrics(self.conn, rid_wkr, "sess-wkr")
        ids = [r["run_id"] for r in atlas_db.trends(self.conn)]
        self.assertIn(rid_orc, ids)  # orchestrator is visible in trends
        self.assertNotIn(rid_wkr, ids)  # worker is excluded from trends

    def test_current_or_last_run_id_fallback(self):
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-col")
        # before finalize: open run is found
        self.assertEqual(atlas_db.current_or_last_run_id(self.conn, "sess-col"), rid)
        atlas_db.finalize_run(self.conn, rid)
        # after finalize: current_run_id returns None, fallback returns the closed run
        self.assertIsNone(atlas_db.current_run_id(self.conn, "sess-col"))
        self.assertEqual(atlas_db.current_or_last_run_id(self.conn, "sess-col"), rid)
        # unknown session: returns None
        self.assertIsNone(atlas_db.current_or_last_run_id(self.conn, "sess-none"))

    def _seed_session_children(self, sid):
        """Seed one row for a session in each of the four child tables."""
        atlas_db.insert_message(
            self.conn, sid, {"uuid": f"{sid}-m", "role": "assistant"}
        )
        atlas_db.insert_tool_call(
            self.conn,
            sid,
            {"tool_use_id": f"{sid}-t", "kind": "builtin", "target": "Read"},
        )
        atlas_db.insert_user_prompt(
            self.conn,
            sid,
            {"uuid": f"{sid}-p", "text": "hi", "char_len": 2, "norm": "hi"},
        )
        atlas_db.insert_signal(
            self.conn,
            sid,
            {
                "message_uuid": f"{sid}-m",
                "signal_type": "user_correction",
                "weight": 1.5,
                "snippet": "x",
            },
        )

    def test_purge_observer_sessions(self):
        pid = atlas_db.register_project(self.conn, "/repo/x")
        atlas_db.upsert_session_log(
            self.conn,
            "obs-1",
            project_id=pid,
            transcript_path="/home/u/.claude-mem/observer-sessions/obs-1.jsonl",
            cwd="/repo/x",
        )
        atlas_db.upsert_session_log(
            self.conn,
            "norm-1",
            project_id=pid,
            transcript_path="/home/u/.claude/projects/repo-x/norm-1.jsonl",
            cwd="/repo/x",
        )
        self._seed_session_children("obs-1")
        self._seed_session_children("norm-1")
        # A run + dispatch for the observer session must be left untouched.
        rid = atlas_db.start_run(self.conn, pid, "obs-1")
        atlas_db.log_dispatch(self.conn, rid, "atlas:implementer")
        self.conn.commit()

        counts = atlas_db.purge_observer_sessions(self.conn)
        self.assertEqual(
            counts,
            {
                "messages": 1,
                "tool_calls": 1,
                "user_prompts": 1,
                "signals": 1,
                "session_logs": 1,
            },
        )
        # observer rows and ALL their children gone
        for tbl in (
            "session_logs",
            "messages",
            "tool_calls",
            "user_prompts",
            "signals",
        ):
            self.assertEqual(
                self.conn.execute(
                    f"SELECT COUNT(*) FROM {tbl} WHERE session_id='obs-1'"
                ).fetchone()[0],
                0,
            )
        # normal rows and children retained
        for tbl in (
            "session_logs",
            "messages",
            "tool_calls",
            "user_prompts",
            "signals",
        ):
            self.assertEqual(
                self.conn.execute(
                    f"SELECT COUNT(*) FROM {tbl} WHERE session_id='norm-1'"
                ).fetchone()[0],
                1,
            )
        # runs and dispatches are NOT touched by the purge
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0], 1
        )
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM dispatches").fetchone()[0], 1
        )

    def test_purge_observer_sessions_noop_when_none(self):
        pid = atlas_db.register_project(self.conn, "/repo/x")
        atlas_db.upsert_session_log(
            self.conn,
            "norm-1",
            project_id=pid,
            transcript_path="/home/u/.claude/projects/repo-x/norm-1.jsonl",
            cwd="/repo/x",
        )
        self._seed_session_children("norm-1")
        counts = atlas_db.purge_observer_sessions(self.conn)
        self.assertEqual(
            counts,
            {
                "messages": 0,
                "tool_calls": 0,
                "user_prompts": 0,
                "signals": 0,
                "session_logs": 0,
            },
        )
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM session_logs").fetchone()[0], 1
        )


class OrchestratingMarkerTest(unittest.TestCase):
    def setUp(self):
        import tempfile, os

        self.tmp = tempfile.mkdtemp()
        self.db = os.path.join(self.tmp, "atlas.db")

    def _conn(self):
        c = atlas_db.connect(self.db)
        atlas_db.init(c)
        return c

    def test_default_run_is_not_orchestrating(self):
        c = self._conn()
        pid = atlas_db.register_project(c, "/repo/x")
        atlas_db.start_run(c, pid, "sess-A")
        self.assertFalse(atlas_db.is_orchestrating(c, "sess-A"))

    def test_mark_sets_flag(self):
        c = self._conn()
        pid = atlas_db.register_project(c, "/repo/x")
        atlas_db.start_run(c, pid, "sess-B")
        atlas_db.mark_orchestrating(c, "sess-B")
        self.assertTrue(atlas_db.is_orchestrating(c, "sess-B"))

    def test_mark_creates_run_when_none(self):
        c = self._conn()
        rid = atlas_db.mark_orchestrating(c, "sess-C", cwd=self.tmp)
        self.assertIsNotNone(rid)
        self.assertTrue(atlas_db.is_orchestrating(c, "sess-C"))

    def test_unknown_session_is_not_orchestrating(self):
        c = self._conn()
        self.assertFalse(atlas_db.is_orchestrating(c, "no-such-session"))


if __name__ == "__main__":
    unittest.main()
