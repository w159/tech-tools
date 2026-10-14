#!/usr/bin/env python3
"""spawn-team: deterministic team expansion, max_parallel semaphore, wait/reap."""

import contextlib
import io
import json
import os
import pathlib
import tempfile
import unittest

import _test_isolation  # noqa: F401
import atlas_mux


class TeamTests(unittest.TestCase):
    def test_build_is_deterministic(self):
        a = atlas_mux.build_team("audit", "high", ["b", "a"], "do it")
        b = atlas_mux.build_team("audit", "high", ["a", "b"], "do it")
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))
        self.assertEqual(len(a["members"]), 5)
        self.assertEqual(len({m["name"] for m in a["members"]}), 5)
        self.assertEqual(a["max_parallel"], 5)

    def test_semaphore_never_exceeds_max_parallel(self):
        rec = atlas_mux.build_team("audit", "high", None, "x")
        rec["max_parallel"] = 2
        done, peak, order = set(), [0], []

        def spawn(m):
            order.append(m["name"])
            peak[0] = max(peak[0], len([n for n in order if n not in done]))
            return {"ok": True}

        def sleep(_):  # one running member exits per poll tick
            running = [n for n in order if n not in done]
            if running:
                done.add(running[0])

        res = atlas_mux.supervise(rec, spawn, lambda n: n in done, sleep, 0)
        self.assertEqual(len(res), 5)
        self.assertLessEqual(peak[0], 2)

    def test_wait_and_reap(self):
        root = tempfile.mkdtemp()
        os.environ["ATLAS_PROJECT_ROOT"] = root
        rec = atlas_mux.build_team("audit", "medium", None, "x")
        rec["created"] = 0.0
        rec["transport"] = "tmux"
        d = pathlib.Path(root) / atlas_mux.TEAMS_REL
        d.mkdir(parents=True)
        (d / f"{rec['team_id']}.json").write_text(json.dumps(rec))
        for m in rec["members"]:
            atlas_mux.atlas_todo.note(
                root, m["name"], "STATUS: DONE\nexit 0", to="lead", kind="report"
            )
        ns = type(
            "N", (), {"root": root, "team": rec["team_id"], "timeout": 5, "poll": 0.1}
        )
        self.assertEqual(atlas_mux.cmd_wait(ns), 0)
        self.assertEqual(atlas_mux.cmd_reap(ns), 0)
        self.assertFalse((d / f"{rec['team_id']}.json").exists())
        self.assertTrue((d / "archive" / f"{rec['team_id']}.json").exists())

    def test_reap_removes_briefs_and_is_idempotent_on_an_archived_team(self):
        """Live: a second reap of t1bbe70 said 'no team record'; briefs were left as orphans."""
        root = tempfile.mkdtemp()
        rec = atlas_mux.build_team("audit", "medium", None, "idem")
        rec.update(created=0.0, transport="tmux")
        d = pathlib.Path(root) / atlas_mux.TEAMS_REL
        d.mkdir(parents=True)
        (d / f"{rec['team_id']}.json").write_text(json.dumps(rec))
        briefs = [d / f"{rec['team_id']}-{m['name']}.prompt" for m in rec["members"]]
        for b in briefs:
            b.write_text("brief")
        ns = type(
            "N", (), {"root": root, "team": rec["team_id"], "timeout": 1, "poll": 0.1}
        )

        def reap():
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                rc = atlas_mux.cmd_reap(ns)
            return rc, json.loads(buf.getvalue().strip().splitlines()[-1])

        rc, first = reap()
        self.assertEqual((0, len(briefs)), (rc, first["prompts_removed"]))
        self.assertFalse([b for b in briefs if b.exists()])
        rc, again = reap()
        self.assertEqual(0, rc)
        self.assertTrue(again["ok"] and again["already_reaped"])
        self.assertEqual(
            str(d / "archive" / f"{rec['team_id']}.json"), again["archived"]
        )

    def test_reap_without_a_record_recovers_members_and_cleans(self):
        """Live: the record was gone, reap said 'no team record' and left the worker unfinished."""
        root = tempfile.mkdtemp()
        os.environ["ATLAS_PROJECT_ROOT"] = root
        d = pathlib.Path(root) / atlas_mux.TEAMS_REL
        d.mkdir(parents=True)
        (d / "tnorec-explorer-0aa5.prompt").write_text("brief")
        ns = type("N", (), {"root": root, "team": "tnorec", "timeout": 1, "poll": 0.1})
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(atlas_mux.cmd_reap(ns), 0)
        out = json.loads(buf.getvalue().strip().splitlines()[-1])
        self.assertTrue(out["ok"])
        self.assertEqual(["explorer-0aa5"], out["members"])
        self.assertTrue(atlas_mux._exited(root, "explorer-0aa5"))

    def test_reap_with_nothing_to_find_fails(self):
        root = tempfile.mkdtemp()
        ns = type("N", (), {"root": root, "team": "tghost", "timeout": 1, "poll": 0.1})
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(atlas_mux.cmd_reap(ns), 1)


class WaveAndChannelTests(unittest.TestCase):
    def setUp(self):
        import atlas_db

        self.db = atlas_db
        self.root = tempfile.mkdtemp()
        conn = atlas_db.connect()
        atlas_db.init(conn)
        pid = atlas_db.register_project(conn, self.root)
        self.sid = "abc123ef-0000-4000-8000-" + os.urandom(6).hex()
        self.run_id = atlas_db.start_run(conn, pid, self.sid)
        conn.execute(
            "UPDATE runs SET ended_at=1 WHERE id=?", (self.run_id,)
        )  # Stop already finalized it
        conn.commit()
        conn.close()
        for k in (
            "CLAUDE_SESSION_ID",
            "ATLAS_SESSION_ID",
            "CLAUDE_CODE_SESSION_ID",
            "ATLAS_LEAD_NAME",
        ):
            os.environ.pop(k, None)

    def _rows(self, team_id):
        conn = self.db.connect()
        try:
            return conn.execute(
                "SELECT run_id, agent_type FROM dispatches WHERE wave_id=?", (team_id,)
            ).fetchall()
        finally:
            conn.close()

    def test_claude_code_session_env_attributes_the_wave(self):
        """Live: CC exports CLAUDE_CODE_SESSION_ID, not CLAUDE_SESSION_ID, so 0 rows got a wave_id."""
        os.environ["CLAUDE_CODE_SESSION_ID"] = self.sid
        rec = atlas_mux.build_team("audit", "medium", None, "w1", team_id="twave1")
        run_id, sid = atlas_mux._lead_run(self.root, None)
        self.assertEqual((self.run_id, self.sid), (run_id, sid))
        self.assertTrue(atlas_mux._log_wave(rec, run_id))
        rows = self._rows("twave1")
        self.assertEqual(len(rec["members"]), len(rows))
        self.assertEqual({self.run_id}, {r[0] for r in rows})
        self.assertIn("atlas:explorer", {r[1] for r in rows})

    def test_wave_logging_is_idempotent_and_records_member_models(self):
        """live-230: team t1ad516 logged 4x (12 rows for 3 members), every row model NULL."""
        rec = atlas_mux.build_team("audit", "medium", None, "w2", team_id="twave2")
        results = [
            {
                "name": m["name"],
                "ok": True,
                "model": "haiku" if m["role"] == "explorer" else "sonnet",
            }
            for m in rec["members"]
        ]
        for _ in range(3):
            self.assertTrue(atlas_mux._log_wave(rec, self.run_id, results))
        conn = self.db.connect()
        try:
            rows = conn.execute(
                "SELECT agent_type, model FROM dispatches WHERE wave_id=? ORDER BY id",
                ("twave2",),
            ).fetchall()
        finally:
            conn.close()
        self.assertEqual(
            sorted(
                (f"atlas:{m['role']}", "haiku" if m["role"] == "explorer" else "sonnet")
                for m in rec["members"]
            ),
            sorted(rows),
        )

    def test_no_session_env_falls_back_to_the_projects_latest_run(self):
        """omp leads export no session id: the project's latest run is the lead's."""
        self.assertEqual((self.run_id, self.sid), atlas_mux._lead_run(self.root, None))
        self.assertEqual((None, None), atlas_mux._lead_run(tempfile.mkdtemp(), None))

    def test_fallback_skips_newer_worker_runs_for_the_run_owning_a_lead_channel(self):
        """Live: omp worker sessions register runs in the project too; the newest was a worker's."""
        atlas_mux.atlas_todo.open_lead_channel(self.root, f"lead-{self.sid[:6]}", [])
        conn = self.db.connect()
        pid = self.db.register_project(conn, self.root)
        self.db.start_run(conn, pid, "01a138ff-worker")  # newer and still open
        conn.close()
        self.assertEqual((self.run_id, self.sid), atlas_mux._lead_run(self.root, None))

    def test_omp_team_members_run_the_claude_tier_level_not_off(self):
        """Live 12.3.0: omp spawn-team reported "level": "off" for explorers; Claude ran them at low."""
        from unittest import mock

        os.environ["ATLAS_SESSION_ID"] = self.sid
        seen = {}

        def fake_spawn(ns):
            seen[ns.name] = (ns.agent, ns.thinking, ns.effort)
            print(json.dumps({"ok": True, "name": ns.name}))
            return 0

        ns = type(
            "N",
            (),
            dict(
                root=self.root,
                task_file=None,
                task="t",
                paths=None,
                cls="audit",
                effort="medium",
                team_id="tlvl1",
                dry_run=False,
                session=self.sid,
                harness="omp",
                poll=0,
            ),
        )
        try:
            with (
                mock.patch.object(atlas_mux, "cmd_spawn", fake_spawn),
                mock.patch.object(atlas_mux, "_exited", return_value=True),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(0, atlas_mux.cmd_spawn_team(ns))
        finally:
            os.environ.pop("ATLAS_SESSION_ID", None)
        levels = {agent: thinking for agent, thinking, _ in seen.values()}
        self.assertEqual({"explorer": "low", "completeness-critic": "low"}, levels)
        self.assertTrue(all(effort is None for *_, effort in seen.values()))

    def test_reap_closes_the_team_channel_while_its_lead_session_lives(self):
        """Live 12.3.0: omp reap returned channels_reaped 0 and left the lead's team channel open."""
        lead = f"lead-{self.sid[:6]}"
        names = ["explorer-aaaa", "explorer-bbbb"]
        chan = atlas_mux.atlas_todo.open_lead_channel(self.root, lead, names)["name"]
        rec = atlas_mux.build_team("audit", "medium", None, "r", team_id="treap1")
        rec.update(
            created=0.0,
            transport="tmux",
            channel=chan,
            lead=lead,
            members=[{"name": n, "role": "explorer"} for n in names],
        )
        d = pathlib.Path(self.root) / atlas_mux.TEAMS_REL
        d.mkdir(parents=True)
        (d / "treap1.json").write_text(json.dumps(rec))
        for n in names:
            atlas_mux.atlas_todo.mark_finished(self.root, n, 0)
        ns = type(
            "N", (), {"root": self.root, "team": "treap1", "timeout": 1, "poll": 0.1}
        )
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(0, atlas_mux.cmd_reap(ns))
        out = json.loads(buf.getvalue().strip().splitlines()[-1])
        self.assertGreaterEqual(out["channels_reaped"], 1)
        self.assertIsNone(atlas_mux.atlas_todo.get_channel(self.root, chan))

    def test_team_channel_is_the_leads_session_channel(self):
        """Live: omp workers posted to the shared '<main>/lead' channel."""
        self.assertEqual("lead-abc123", atlas_mux._team_lead(self.sid, "tx"))
        self.assertEqual("lead-tx", atlas_mux._team_lead(None, "tx"))
        os.environ["ATLAS_LEAD_NAME"] = "boss"
        try:
            self.assertEqual("boss", atlas_mux._team_lead(self.sid, "tx"))
        finally:
            del os.environ["ATLAS_LEAD_NAME"]


if __name__ == "__main__":
    unittest.main()
