"""State-machine tests for atlas_selffix with git and the launcher mocked."""

import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import shutil
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import atlas_db  # noqa: E402
import atlas_doctor  # noqa: E402
import atlas_selffix as sf  # noqa: E402


class SelffixTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.conn = atlas_db.connect(os.path.join(self.tmp, "t.db"))
        atlas_db.init(self.conn)
        self.git_calls = []
        self.live = True
        self.launches = []
        self.verify_cmd = "true"
        self.dirty = ""
        self.changed = ""
        p = [
            mock.patch.object(sf, "_git", self.fake_git),
            mock.patch.object(sf, "_worker_launch", self.fake_launch),
            mock.patch.object(sf, "_is_live", lambda t: self.live),
            mock.patch.object(sf, "_tmux_kill", lambda t: None),
            mock.patch.object(sf, "prefs", lambda: dict(sf.DEFAULT_PREFS)),
            mock.patch.object(sf, "_home", lambda: Path(self.tmp)),
            mock.patch.object(sf, "resolve_target", self.fake_resolve),
        ]
        for m in p:
            m.start()
            self.addCleanup(m.stop)

    def fake_resolve(self, f):
        if (f["target_path"] or "").startswith("src/"):
            return self.tmp, f["target_path"], ""
        return None, None, "not a source file"

    def fake_git(self, args, cwd, timeout=120):
        self.git_calls.append(args)
        if args[:2] == ["worktree", "add"]:
            os.makedirs(args[2])
        if args[:2] == ["worktree", "remove"]:
            shutil.rmtree(args[3], ignore_errors=True)
        if args[:2] == ["rev-list", "--count"]:
            return 0, "1"
        if args[:2] == ["status", "--porcelain"]:
            return 0, self.dirty
        if args[:2] == ["diff", "--name-only"]:
            return 0, self.changed
        return 0, ""

    def fake_launch(self, top, f, wt):
        self.launches.append(f["id"])
        return {"ok": True, "target": f"atlas-selffix:fix-{f['id']}"}

    def add(self, n, target="src/a.py", cmd=None):
        fid = atlas_db.upsert_finding(
            self.conn,
            f"m:{n}",
            title=f"t{n}",
            severity="MED",
            target_path=target,
            evidence_json=json.dumps({"test_command": cmd or "true"}),
        )
        return fid

    def state(self, fid):
        return atlas_db.get_finding(self.conn, fid)["fix_state"]

    def test_cap_and_skip(self):
        ids = [self.add(i) for i in range(3)]
        skip = self.add(9, target="lean-ctx.ctx_patch")
        sf.tick(self.conn)
        self.assertEqual([self.state(i) for i in ids], ["running", "running", "none"])
        self.assertEqual(self.state(skip), "skipped")
        sf.tick(self.conn)  # still capped across ticks, no duplicate launch
        self.assertEqual(self.launches, ids[:2])

    def test_ready_then_merge_refuses_dirty_overlap(self):
        fid = self.add(1)
        sf.tick(self.conn)
        self.live = False
        sf.tick(self.conn)
        self.assertEqual(self.state(fid), "ready")
        self.dirty = " M src/a.py"
        self.changed = "src/a.py"
        res = sf.merge(self.conn, fid)
        self.assertEqual(res["error"], "dirty_overlap")
        self.assertEqual(self.state(fid), "ready")
        self.dirty = " M other.py"
        self.assertTrue(sf.merge(self.conn, fid)["ok"])
        self.assertEqual(self.state(fid), "merged")
        self.assertEqual(atlas_db.get_finding(self.conn, fid)["status"], "applied")

    def test_failure_retries_twice_then_terminal_until_manual_retry(self):
        fid = self.add(1, cmd="false")
        sf.tick(self.conn)
        self.live = False
        sf.tick(
            self.conn
        )  # attempt 1 fails verify -> back to pool -> relaunched same tick
        self.assertEqual(self.state(fid), "running")
        sf.tick(self.conn)  # attempt 2 fails -> failed
        self.assertEqual(self.state(fid), "failed")
        self.assertIn("verify failed", atlas_db.get_finding(self.conn, fid)["fix_log"])
        n = len(self.launches)
        sf.tick(self.conn)
        self.assertEqual(len(self.launches), n)  # terminal: no auto relaunch
        self.assertTrue(sf.retry(self.conn, fid)["ok"])
        self.assertEqual(self.state(fid), "none")

    def test_discard(self):
        fid = self.add(1)
        sf.tick(self.conn)
        self.assertTrue(sf.discard(self.conn, fid)["ok"])
        self.assertEqual(self.state(fid), "skipped")
        self.assertIn(["branch", "-D", f"atlas/selffix-{fid}"], self.git_calls)


class MinerTest(unittest.TestCase):
    def test_tool_name_normalization(self):
        n = atlas_doctor._norm_tool_target
        self.assertEqual(n("lean_ctx.ctx_patch"), n("lean-ctx.ctx_patch"))
        self.assertEqual(n("Write"), "write")

    def test_uuid_connector_is_skipped_and_recovery_resolves(self):
        conn = atlas_db.connect(os.path.join(tempfile.mkdtemp(), "m.db"))
        atlas_db.init(conn)
        rows = [("mcp", "lean_ctx.ctx_patch", 1)] * 9 + [
            ("mcp", "lean-ctx.ctx_patch", 0)
        ] * 3  # 9/12 errors split across two spellings
        rows += [("mcp", "35880cc3-5c29-4ec7-88cb-c9f0cab7f98e.x", 1)] * 8
        for k, t, e in rows:
            conn.execute(
                "INSERT INTO tool_calls(session_id,kind,target,is_error,ts) "
                "VALUES('s',?,?,?,strftime('%s','now'))",
                (k, t, e),
            )
        conn.commit()
        out = atlas_doctor.mine_tool_error_rate(conn, "/x", threshold=0.2)
        keys = [f["key"] for f in out]
        self.assertEqual(keys, ["mcp:lean-ctx.ctx_patch"])  # merged, UUID dropped
        atlas_doctor.mine(conn, "/x")
        conn.execute("DELETE FROM tool_calls")
        for _ in range(10):
            conn.execute(
                "INSERT INTO tool_calls(session_id,kind,target,is_error,ts) "
                "VALUES('s','mcp','lean-ctx.ctx_patch',0,strftime('%s','now'))"
            )
        conn.commit()
        atlas_doctor.mine(conn, "/x")
        st = conn.execute(
            "SELECT status FROM findings WHERE fingerprint='tool_error_rate_high:mcp:lean-ctx.ctx_patch'"
        ).fetchone()
        self.assertEqual(st[0], "resolved")


class SurfaceTargetTest(unittest.TestCase):
    """turn_quality findings carry a surface label, not a path: resolve it."""

    def test_surface_labels_map_to_real_files_inside_the_repo(self):
        import turn_scoring

        for j, spec in turn_scoring.JUDGMENTS.items():
            if spec["surface"] == "outcome":
                continue  # next_turn_correction is a signal, not a fixable surface
            top, target, why = sf.resolve_target({"target_path": spec["surface"]})
            self.assertIsNotNone(top, f"{j}: {spec['surface']!r} -> {why}")
            self.assertTrue(os.path.isfile(target), (j, target))

    def test_hook_named_in_a_label_wins_over_the_style_file(self):
        _, target, _ = sf.resolve_target(
            {
                "target_path": "style: Evidence on the user's surface; hook: hooks/completion_gate.py"
            }
        )
        self.assertTrue(
            target.endswith("plugins/atlas/hooks/completion_gate.py"), target
        )

    def test_plain_paths_and_tool_names_are_unchanged(self):
        _, target, _ = sf.resolve_target(
            {"target_path": "plugins/atlas/hooks/dispatch_tripwire.py"}
        )
        self.assertTrue(target.endswith("plugins/atlas/hooks/dispatch_tripwire.py"))
        top, _, why = sf.resolve_target({"target_path": "builtin:bash"})
        self.assertIsNone(top)
        self.assertIn("not a source file", why)


if __name__ == "__main__":
    unittest.main()
