import contextlib
import io
import os
import runpy
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(__file__))

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

    def test_verifier_coverage_counts_general_purpose_shipping(self):
        # 2 general-purpose (code-shipping) + 0 verifier -> coverage gap, NOT NULL,
        # and unpaired_implementer_dispatches > 0. general-purpose ships code just
        # like atlas:implementer; classifying it as a non-implementer defeats the
        # Law 5 gate (orchestrator escapes verification by dispatching general-purpose).
        pid = atlas_db.register_project(self.conn, "/repo/x")
        rid = atlas_db.start_run(self.conn, pid, "sess-cov-gp")
        atlas_db.log_dispatch(self.conn, rid, "general-purpose")
        atlas_db.log_dispatch(self.conn, rid, "general-purpose")
        self.conn.commit()
        d = atlas_db.derive_run_metrics(self.conn, rid, "sess-cov-gp")
        self.assertIsNotNone(d["verifier_coverage"])
        self.assertLess(d["verifier_coverage"], 1.0)
        self.assertGreater(atlas_db.unpaired_implementer_dispatches(self.conn, rid), 0)

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
        import os
        import tempfile

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


class UncoveredPathsTest(unittest.TestCase):
    """Cover source paths in atlas_db.py not exercised by the suites above."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "atlas.db")
        self.conn = atlas_db.connect(self.path)
        atlas_db.init(self.conn)

    def tearDown(self):
        self.conn.close()

    def test_db_path_respects_atlas_db_env(self):
        # The ATLAS_DB branch of db_path() (line 90).
        with patch.dict(os.environ, {"ATLAS_DB": "/custom/path/atlas.db"}):
            self.assertEqual(atlas_db.db_path(), "/custom/path/atlas.db")
        env_copy = dict(os.environ)
        env_copy.pop("ATLAS_DB", None)
        with patch.dict(os.environ, env_copy, clear=True):
            self.assertEqual(
                atlas_db.db_path(), os.path.expanduser("~/.atlas/atlas.db")
            )

    def test_init_migrates_pre_kind_pre_orchestrating_runs(self):
        # A DB whose `runs` table predates the kind/orchestrating columns: the
        # ALTER TABLE statements in init() succeed (lines 110, 115) rather than
        # hitting the OperationalError except branch.
        raw_path = os.path.join(self.tmp, "old_runs.db")
        raw = atlas_db.connect(raw_path)
        raw.executescript(
            "CREATE TABLE runs ("
            "  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, session_id TEXT,"
            "  started_at REAL, ended_at REAL, wall_clock_s REAL,"
            "  task_summary TEXT, model TEXT);"
        )
        raw.commit()
        cols_before = {r[1] for r in raw.execute("PRAGMA table_info(runs)")}
        self.assertNotIn("kind", cols_before)
        self.assertNotIn("orchestrating", cols_before)
        atlas_db.init(raw)  # ALTER succeeds -> commit on lines 110 and 115
        cols_after = {r[1] for r in raw.execute("PRAGMA table_info(runs)")}
        self.assertIn("kind", cols_after)
        self.assertIn("orchestrating", cols_after)
        raw.close()

    def test_write_orchestration_sentinel_swallows_errors(self):
        # _write_orchestration_sentinel is best-effort: a raised OSError must
        # be swallowed (lines 233-234) and mark_orchestrating still succeed.
        pid = atlas_db.register_project(self.conn, "/repo/x")
        atlas_db.start_run(self.conn, pid, "sess-sentinel")
        with patch("atlas_db.os.makedirs", side_effect=OSError("denied")):
            rid = atlas_db.mark_orchestrating(self.conn, "sess-sentinel", cwd=self.tmp)
        self.assertIsNotNone(rid)
        self.assertTrue(atlas_db.is_orchestrating(self.conn, "sess-sentinel"))

    def test_run_metrics_empty_for_missing_run(self):
        # No metrics row -> {} (line 337).
        self.assertEqual(atlas_db.run_metrics(self.conn, 999999), {})

    def test_is_shipping_agent_rejects_falsy(self):
        # Empty/None agent_type -> False (line 353).
        self.assertFalse(atlas_db.is_shipping_agent(""))
        self.assertFalse(atlas_db.is_shipping_agent(None))

    def test_dispatch_waves_advances_sliding_window(self):
        # Timestamps spanning beyond window_s force the j pointer forward
        # (line 491). Two clusters of two => peak 2, waves 2.
        ts = [0.0, 5.0, 20.0, 25.0]
        peak, waves = atlas_db._dispatch_waves(ts, window_s=10.0)
        self.assertEqual(peak, 2)
        self.assertEqual(waves, 2)

    def test_dispatch_waves_empty(self):
        self.assertEqual(atlas_db._dispatch_waves([], window_s=10.0), (0, 0))

    # --- asset/context audit lens --------------------------------------------

    def test_record_asset_verdicts_skips_keep_and_persists(self):
        # keep verdicts are skipped; non-keep are persisted (lines 550-572).
        pid = atlas_db.register_project(self.conn, "/repo/x")
        assets = [
            {"kind": "file", "key": "keep.py", "tags": ["src"], "verdict": "keep"},
            {
                "kind": "file",
                "key": "stale.py",
                "tags": ["src", "old"],
                "verdict": "remove",
                "est_tokens": 500,
            },
            {"kind": "file", "key": "move.py", "tags": [], "verdict": "relocate"},
        ]
        atlas_db.record_asset_verdicts(self.conn, pid, assets)
        rows = self.conn.execute(
            "SELECT kind, key, tags, verdict, est_tokens FROM asset_verdicts "
            "ORDER BY key"
        ).fetchall()
        self.assertEqual(len(rows), 2)  # keep.py skipped
        self.assertEqual(rows[0][0], "file")
        self.assertEqual({r[1] for r in rows}, {"stale.py", "move.py"})
        # est_tokens defaults to 0 when absent (move.py).
        tokens = {r[1]: r[4] for r in rows}
        self.assertEqual(tokens["stale.py"], 500)
        self.assertEqual(tokens["move.py"], 0)

    def test_record_asset_verdicts_replaces_unapplied(self):
        # A second verdict for the same (project, kind, key) with applied=0 and
        # restored=0 replaces the prior row (idempotent per the docstring).
        pid = atlas_db.register_project(self.conn, "/repo/x")
        atlas_db.record_asset_verdicts(
            self.conn, pid, [{"kind": "file", "key": "a.py", "verdict": "remove"}]
        )
        atlas_db.record_asset_verdicts(
            self.conn, pid, [{"kind": "file", "key": "a.py", "verdict": "relocate"}]
        )
        rows = self.conn.execute(
            "SELECT verdict FROM asset_verdicts WHERE key='a.py'"
        ).fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][0], "relocate")

    def test_mark_asset_applied(self):
        # Lines 576-579.
        pid = atlas_db.register_project(self.conn, "/repo/x")
        atlas_db.record_asset_verdicts(
            self.conn, pid, [{"kind": "file", "key": "a.py", "verdict": "remove"}]
        )
        atlas_db.mark_asset_applied(self.conn, "file", "a.py")
        applied = self.conn.execute(
            "SELECT applied FROM asset_verdicts WHERE key='a.py'"
        ).fetchone()[0]
        self.assertEqual(applied, 1)

    def test_note_asset_restore_and_suppressed(self):
        # Lines 585-596: restore flag + suppressed_assets set.
        pid = atlas_db.register_project(self.conn, "/repo/x")
        atlas_db.record_asset_verdicts(
            self.conn, pid, [{"kind": "file", "key": "a.py", "verdict": "remove"}]
        )
        atlas_db.note_asset_restore(self.conn, "file", "a.py")
        self.assertEqual(atlas_db.suppressed_assets(self.conn), {("file", "a.py")})

    def test_suppressed_assets_empty(self):
        self.assertEqual(atlas_db.suppressed_assets(self.conn), set())

    def test_asset_audit_summary_rates_false_positives(self):
        # Lines 601-608. 3 verdicts, 2 applied, 1 restored (of the applied).
        pid = atlas_db.register_project(self.conn, "/repo/x")
        for key in ("a.py", "b.py", "c.py"):
            atlas_db.record_asset_verdicts(
                self.conn, pid, [{"kind": "file", "key": key, "verdict": "remove"}]
            )
        atlas_db.mark_asset_applied(self.conn, "file", "a.py")
        atlas_db.mark_asset_applied(self.conn, "file", "b.py")
        atlas_db.note_asset_restore(self.conn, "file", "a.py")
        summary = atlas_db.asset_audit_summary(self.conn)
        self.assertEqual(summary["verdicts"], 3)
        self.assertEqual(summary["applied"], 2)
        self.assertEqual(summary["restored"], 1)
        self.assertEqual(summary["false_positive_rate"], 0.5)

    def test_asset_audit_summary_zero_applied(self):
        # No applied verdicts -> false_positive_rate 0.0 (not a div-by-zero).
        pid = atlas_db.register_project(self.conn, "/repo/x")
        atlas_db.record_asset_verdicts(
            self.conn, pid, [{"kind": "file", "key": "a.py", "verdict": "remove"}]
        )
        summary = atlas_db.asset_audit_summary(self.conn)
        self.assertEqual(summary["applied"], 0)
        self.assertEqual(summary["false_positive_rate"], 0.0)

    # --- session-log mirror write/read helpers -------------------------------

    def test_session_cursor_new_and_existing(self):
        # Lines 621-625. New session -> (0, 0); existing -> stored values.
        self.assertEqual(atlas_db.session_cursor(self.conn, "never-seen"), (0, 0))
        atlas_db.upsert_session_log(
            self.conn, "s-cur", cursor_bytes=128, file_size=4096
        )
        self.assertEqual(atlas_db.session_cursor(self.conn, "s-cur"), (128, 4096))

    def test_update_tool_result(self):
        # Line 722: join a tool_result back onto its tool_use row.
        atlas_db.insert_tool_call(
            self.conn,
            "s-utr",
            {
                "tool_use_id": "tu-1",
                "kind": "builtin",
                "target": "Read",
                "is_error": 0,
            },
        )
        atlas_db.update_tool_result(self.conn, "tu-1", 1, 999)
        row = self.conn.execute(
            "SELECT is_error, result_bytes FROM tool_calls WHERE tool_use_id='tu-1'"
        ).fetchone()
        self.assertEqual(row[0], 1)
        self.assertEqual(row[1], 999)

    def test_refresh_session_aggregates(self):
        # Lines 763-776: recompute counts/totals from child rows.
        sid = "s-agg"
        atlas_db.upsert_session_log(self.conn, sid)
        atlas_db.insert_message(
            self.conn,
            sid,
            {
                "uuid": "m1",
                "role": "assistant",
                "input_tokens": 100,
                "output_tokens": 50,
                "cache_read_tokens": 30,
                "cache_creation_tokens": 10,
            },
        )
        atlas_db.insert_message(
            self.conn,
            sid,
            {"uuid": "m2", "role": "assistant", "input_tokens": 20},
        )
        atlas_db.insert_tool_call(
            self.conn,
            sid,
            {"tool_use_id": "t1", "kind": "builtin", "target": "Read", "is_error": 1},
        )
        atlas_db.insert_user_prompt(
            self.conn, sid, {"uuid": "p1", "text": "hi", "char_len": 2, "norm": "hi"}
        )
        atlas_db.insert_signal(
            self.conn,
            sid,
            {"message_uuid": "m1", "signal_type": "user_correction"},
        )
        atlas_db.refresh_session_aggregates(self.conn, sid)
        row = self.conn.execute(
            "SELECT message_count, user_prompt_count, tool_call_count, error_count, "
            "input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens "
            "FROM session_logs WHERE session_id=?",
            (sid,),
        ).fetchone()
        self.assertEqual(row[0], 2)  # messages
        self.assertEqual(row[1], 1)  # user prompts
        self.assertEqual(row[2], 1)  # tool calls
        self.assertEqual(row[3], 1)  # errors
        self.assertEqual(row[4], 120)  # input_tokens summed
        self.assertEqual(row[5], 50)  # output_tokens
        self.assertEqual(row[6], 30)  # cache_read_tokens
        self.assertEqual(row[7], 10)  # cache_creation_tokens

    def test_reset_session_rows(self):
        # Lines 782-784: drop a session's child rows for a clean re-ingest.
        sid = "s-reset"
        atlas_db.upsert_session_log(self.conn, sid)
        for tbl_seeder in (("m1", "t1", "p1"),):
            atlas_db.insert_message(self.conn, sid, {"uuid": "m1", "role": "assistant"})
            atlas_db.insert_tool_call(
                self.conn, sid, {"tool_use_id": "t1", "kind": "builtin", "target": "R"}
            )
            atlas_db.insert_user_prompt(
                self.conn, sid, {"uuid": "p1", "text": "x", "char_len": 1}
            )
            atlas_db.insert_signal(
                self.conn, sid, {"message_uuid": "m1", "signal_type": "x"}
            )
        atlas_db.reset_session_rows(self.conn, sid)
        for tbl in ("messages", "tool_calls", "user_prompts", "signals"):
            self.assertEqual(
                self.conn.execute(
                    f"SELECT COUNT(*) FROM {tbl} WHERE session_id=?", (sid,)
                ).fetchone()[0],
                0,
            )
        # session_logs row itself is retained.
        self.assertEqual(
            self.conn.execute(
                "SELECT COUNT(*) FROM session_logs WHERE session_id=?", (sid,)
            ).fetchone()[0],
            1,
        )

    # --- session-log read path (the sextant forensics lens) ------------------

    def _seed_read_path(self):
        """Seed two sessions across two projects for tool_usage / context health."""
        pid_a = atlas_db.register_project(self.conn, "/repo/a")
        pid_b = atlas_db.register_project(self.conn, "/repo/b")
        # Each row gets a unique tool_use_id (insert_tool_call is INSERT OR IGNORE
        # on tool_use_id, so a shared id would dedupe the second insert).
        rows = (
            ("sess-a", pid_a, None, "builtin", "Read", 0, "tu-a-read-1"),
            ("sess-a", pid_a, None, "builtin", "Read", 1, "tu-a-read-2"),
            ("sess-a", pid_a, None, "skill", "atlas-harden", 0, "tu-a-skill-1"),
            ("sess-b", pid_b, "context-mode", "mcp", "ctx_search", 0, "tu-b-ctx"),
            ("sess-b", pid_b, "claude-mem", "mcp", "mem_search", 1, "tu-b-mem"),
            ("sess-b", pid_b, "ponytail", "mcp", "ponytail", 0, "tu-b-pony"),
        )
        for sid, pid, server, kind, target, err, tuid in rows:
            atlas_db.upsert_session_log(self.conn, sid, project_id=pid)
            atlas_db.insert_tool_call(
                self.conn,
                sid,
                {
                    "tool_use_id": tuid,
                    "kind": kind,
                    "target": target,
                    "server": server,
                    "is_error": err,
                    "input_bytes": 100,
                },
            )
        # Token totals on session_logs via refresh.
        atlas_db.insert_message(
            self.conn,
            "sess-a",
            {
                "uuid": "ma1",
                "role": "assistant",
                "input_tokens": 300,
                "cache_read_tokens": 700,
                "cache_creation_tokens": 50,
                "output_tokens": 40,
            },
        )
        atlas_db.insert_message(
            self.conn,
            "sess-b",
            {"uuid": "mb1", "role": "assistant", "input_tokens": 200},
        )
        atlas_db.refresh_session_aggregates(self.conn, "sess-a")
        atlas_db.refresh_session_aggregates(self.conn, "sess-b")
        return pid_a, pid_b

    def test_tool_usage_unfiltered_and_filters(self):
        # Lines 837-838 (_rows) and 844-862 (tool_usage) with kind + project_id.
        pid_a, _pid_b = self._seed_read_path()
        all_rows = atlas_db.tool_usage(self.conn)
        # 5 distinct (kind, target, server) groups: builtin Read x1,
        # skill x1, and 3 distinct mcp servers.
        self.assertEqual(len(all_rows), 5)
        # Filter by kind builtin -> Read group with calls=2, errors=1.
        builtin = atlas_db.tool_usage(self.conn, kind="builtin")
        self.assertEqual(len(builtin), 1)
        self.assertEqual(builtin[0]["calls"], 2)
        self.assertEqual(builtin[0]["errors"], 1)
        self.assertEqual(builtin[0]["sessions"], 1)
        self.assertEqual(builtin[0]["input_bytes"], 200)
        # Filter by project_a -> only sess-a rows (builtin Read x2, skill x1).
        proj_a = atlas_db.tool_usage(self.conn, project_id=pid_a)
        self.assertEqual(len(proj_a), 2)
        self.assertEqual({r["kind"] for r in proj_a}, {"builtin", "skill"})

    def test_context_tool_health(self):
        # Lines 869-884: cache hit ratio + per-server mcp tool health.
        self._seed_read_path()
        health = atlas_db.context_tool_health(self.conn)
        # cache_read=700, fresh_input=300+200=500 -> 700/1200.
        self.assertEqual(health["cache_read_tokens"], 700)
        self.assertEqual(health["fresh_input_tokens"], 500)
        self.assertEqual(health["cache_hit_ratio"], round(700 / 1200, 3))
        self.assertEqual(health["cache_creation_tokens"], 50)
        self.assertEqual(health["output_tokens"], 40)
        ctx = health["context_tools"]
        self.assertIn("context-mode", ctx)
        self.assertIn("claude-mem", ctx)
        self.assertIn("ponytail", ctx)
        self.assertEqual(ctx["claude-mem"]["errors"], 1)
        self.assertEqual(ctx["context-mode"]["calls"], 1)

    def test_context_tool_health_zero_denominator(self):
        # No session_logs token rows -> denom 0 -> cache_hit_ratio 0.0.
        health = atlas_db.context_tool_health(self.conn)
        self.assertEqual(health["cache_hit_ratio"], 0.0)
        self.assertEqual(health["context_tools"], {})

    def test_signal_rollup_and_counts(self):
        # Lines 898-909 (signal_rollup) and 914 (signal_counts).
        pid = atlas_db.register_project(self.conn, "/repo/x")
        atlas_db.upsert_session_log(self.conn, "sess-s1", project_id=pid)
        atlas_db.upsert_session_log(self.conn, "sess-s2", project_id=pid)
        for sid, mu, stype, ts in (
            ("sess-s1", "m1", "user_correction", 100.0),
            ("sess-s1", "m2", "assumption_admission", 90.0),
            ("sess-s2", "m3", "user_correction", 80.0),
        ):
            atlas_db.insert_signal(
                self.conn,
                sid,
                {
                    "message_uuid": mu,
                    "signal_type": stype,
                    "ts": ts,
                    "snippet": "s-" + stype,
                },
            )
        # rollup, no filter: most-recent first.
        all_r = atlas_db.signal_rollup(self.conn)
        self.assertEqual(len(all_r), 3)
        self.assertEqual(all_r[0]["session_id"], "sess-s1")  # ts=100 highest
        self.assertEqual(all_r[0]["root_path"], "/repo/x")
        # rollup with signal_type filter.
        corr = atlas_db.signal_rollup(self.conn, signal_type="user_correction")
        self.assertEqual(len(corr), 2)
        self.assertEqual({r["signal_type"] for r in corr}, {"user_correction"})
        # counts per type with project count.
        counts = atlas_db.signal_counts(self.conn)
        by_type = {r["signal_type"]: r for r in counts}
        self.assertEqual(by_type["user_correction"]["n"], 2)
        self.assertEqual(by_type["user_correction"]["projects"], 1)
        self.assertEqual(by_type["assumption_admission"]["n"], 1)

    def test_repeated_prompts(self):
        # Line 928: normalized prompts recurring across sessions.
        long_norm = "please review the changes"  # length >= 12
        for sid in ("sess-r1", "sess-r2", "sess-r3"):
            atlas_db.insert_user_prompt(
                self.conn,
                sid,
                {
                    "uuid": f"u-{sid}",
                    "text": long_norm,
                    "char_len": len(long_norm),
                    "norm": long_norm,
                },
            )
        # Below-threshold norm (short) must NOT be returned.
        short = "ok"
        atlas_db.insert_user_prompt(
            self.conn,
            "sess-r1",
            {"uuid": "u-short", "text": short, "char_len": 2, "norm": short},
        )
        rows = atlas_db.repeated_prompts(self.conn, min_count=3)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["norm"], long_norm)
        self.assertEqual(rows[0]["n"], 3)
        self.assertEqual(rows[0]["sessions"], 3)

    def test_repeated_prompts_below_min_count(self):
        atlas_db.insert_user_prompt(
            self.conn,
            "sess-x",
            {
                "uuid": "u1",
                "text": "do the thing now",
                "char_len": 15,
                "norm": "do the thing now",
            },
        )
        self.assertEqual(atlas_db.repeated_prompts(self.conn, min_count=2), [])

    def test_idle_assets(self):
        # Lines 942-948: known keys never invoked are reported idle.
        atlas_db.insert_tool_call(
            self.conn,
            "sess-idle",
            {"tool_use_id": "t1", "kind": "skill", "target": "atlas-harden"},
        )
        atlas_db.insert_tool_call(
            self.conn,
            "sess-idle",
            {"tool_use_id": "t2", "kind": "skill", "target": "atlas-refactor"},
        )
        idle = atlas_db.idle_assets(
            self.conn,
            "skill",
            ["atlas-harden", "atlas-refactor", "atlas-wiki"],
        )
        self.assertEqual(idle, ["atlas-wiki"])


class MainCliTest(unittest.TestCase):
    """Cover the `if __name__ == '__main__'` CLI entry points in-process.

    Uses runpy.run_path with run_name='__main__' so the guarded block executes
    in this process (and thus under coverage), with ATLAS_DB pointed at a temp
    DB and sys.argv driven per subcommand.
    """

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.db = os.path.join(self.tmp, "atlas.db")
        self.script = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "atlas_db.py"
        )

    def _run_cli(self, argv, env_extra=None):
        env = dict(os.environ)
        env["ATLAS_DB"] = self.db
        if env_extra:
            env.update(env_extra)
        out = io.StringIO()
        with (
            patch.object(sys, "argv", argv),
            patch.dict(os.environ, env, clear=False),
            contextlib.redirect_stdout(out),
        ):
            runpy.run_path(self.script, run_name="__main__")
        return out.getvalue()

    def test_main_mark_orchestrating(self):
        # Lines 952-960: mark-orchestrating <session> <cwd>.
        out = self._run_cli(["atlas_db.py", "mark-orchestrating", "sess-cli", self.tmp])
        self.assertIn("orchestrating run", out)
        self.assertIn("sess-cli", out)
        # The run is persisted and flagged.
        c = atlas_db.connect(self.db)
        atlas_db.init(c)
        self.assertTrue(atlas_db.is_orchestrating(c, "sess-cli"))
        c.close()

    def test_main_mark_orchestrating_defaults_cwd(self):
        # No cwd arg -> os.getcwd() default branch.
        out = self._run_cli(["atlas_db.py", "mark-orchestrating", "sess-cwd"])
        self.assertIn("orchestrating run", out)

    def test_main_purge_observer_sessions(self):
        # Lines 962-968: seed an observer session, then purge via CLI.
        c = atlas_db.connect(self.db)
        atlas_db.init(c)
        pid = atlas_db.register_project(c, "/repo/x")
        atlas_db.upsert_session_log(
            c,
            "obs-cli",
            project_id=pid,
            transcript_path="/home/u/.claude-mem/observer-sessions/obs-cli.jsonl",
            cwd="/repo/x",
        )
        atlas_db.insert_message(c, "obs-cli", {"uuid": "m1", "role": "assistant"})
        c.commit()
        c.close()
        out = self._run_cli(["atlas_db.py", "purge-observer-sessions"])
        import json as _json

        counts = _json.loads(out)
        self.assertEqual(counts["messages"], 1)
        self.assertEqual(counts["session_logs"], 1)

    def test_main_record_recall_hit(self):
        # Lines 970-988 happy path: record-recall <session> hit.
        c = atlas_db.connect(self.db)
        atlas_db.init(c)
        pid = atlas_db.register_project(c, "/repo/x")
        rid = atlas_db.start_run(c, pid, "sess-recall")
        c.commit()
        c.close()
        out = self._run_cli(["atlas_db.py", "record-recall", "sess-recall", "hit"])
        self.assertIn("recorded recall hit", out)
        self.assertIn(str(rid), out)
        c = atlas_db.connect(self.db)
        atlas_db.init(c)
        m = atlas_db.run_metrics(c, rid)
        self.assertEqual(m["recall_hits"], 1)
        self.assertEqual(m["recall_misses"], None)
        c.close()

    def test_main_record_recall_miss(self):
        c = atlas_db.connect(self.db)
        atlas_db.init(c)
        pid = atlas_db.register_project(c, "/repo/x")
        rid = atlas_db.start_run(c, pid, "sess-recall-m")
        c.commit()
        c.close()
        out = self._run_cli(["atlas_db.py", "record-recall", "sess-recall-m", "miss"])
        self.assertIn("recorded recall miss", out)
        c = atlas_db.connect(self.db)
        atlas_db.init(c)
        self.assertEqual(atlas_db.run_metrics(c, rid)["recall_misses"], 1)
        c.close()

    def test_main_record_recall_rejects_invalid_outcome(self):
        # Lines 973-979: an outcome word other than hit/miss is rejected.
        out = self._run_cli(["atlas_db.py", "record-recall", "sess-bad", "maybe"])
        self.assertIn("must be 'hit' or 'miss'", out)
        self.assertIn("maybe", out)

    def test_main_record_recall_no_run(self):
        # Lines 984-985: session with no run -> recall not recorded.
        out = self._run_cli(["atlas_db.py", "record-recall", "ghost-session", "hit"])
        self.assertIn("no run for session", out)
        self.assertIn("ghost-session", out)

    def test_main_help(self):
        out = self._run_cli(["atlas_db.py", "--help"])
        self.assertIn("Usage", out)

    def test_main_unknown_command_exits_2(self):
        env = dict(os.environ)
        env["ATLAS_DB"] = self.db
        err = io.StringIO()
        with (
            patch.object(sys, "argv", ["atlas_db.py", "bogus-cmd"]),
            patch.dict(os.environ, env, clear=False),
            contextlib.redirect_stderr(err),
        ):
            with self.assertRaises(SystemExit) as cm:
                runpy.run_path(self.script, run_name="__main__")
        self.assertEqual(cm.exception.code, 2)
        self.assertIn("Usage", err.getvalue())


if __name__ == "__main__":
    unittest.main()
