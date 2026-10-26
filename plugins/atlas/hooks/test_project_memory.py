"""Project memories land in <project>/.atlas/memory/, not the global ~/.atlas/memory/."""

import os as _iso_os
import sys as _iso_sys

_iso_sys.path.insert(
    0,
    _iso_os.path.join(
        _iso_os.path.dirname(_iso_os.path.abspath(__file__)), "..", "scripts"
    ),
)
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import io
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
sys.path.insert(0, HERE)

import atlas_db  # noqa: E402
import atlas_hook_guard  # noqa: E402
import atlas_memory  # noqa: E402
import memory_capture  # noqa: E402

REAL_ATLAS = os.path.join(_test_isolation.REAL_HOME, ".atlas")


def _real_state():
    """Stat fingerprint of the user's real ~/.atlas/memory (must not change)."""
    d = os.path.join(REAL_ATLAS, "memory")
    out = {}
    for base, _dirs, files in os.walk(d):
        for f in files:
            p = os.path.join(base, f)
            st = os.stat(p)
            out[p] = (st.st_mtime_ns, st.st_size)
    return out


def _make_repo(parent, name):
    root = os.path.join(parent, name)
    os.makedirs(os.path.join(root, ".git"))
    return root


class _Base(unittest.TestCase):
    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp())
        self.home = os.path.join(self.tmp, "home")
        self.atlas_home = os.path.join(self.home, ".atlas")
        os.makedirs(self.atlas_home)
        self.db = os.path.join(self.atlas_home, "atlas.db")
        env = {
            "HOME": self.home,
            "ATLAS_HOME": self.atlas_home,
            "ATLAS_DB": self.db,
            "CLAUDE_PROJECT_DIR": os.path.join(self.tmp, "none"),
        }
        p = mock.patch.dict(os.environ, env)
        p.start()
        self.addCleanup(p.stop)
        self.real_before = _real_state()
        self.addCleanup(self._real_untouched)

    def _real_untouched(self):
        self.assertEqual(
            _real_state(), self.real_before, "real ~/.atlas/memory changed"
        )

    def global_memory(self):
        return os.path.join(self.atlas_home, "memory", "MEMORY.md")


class CaptureRoutingTest(_Base):
    def _seed(self, sid, snippet):
        conn = atlas_db.connect(self.db)
        atlas_db.init(conn)
        pid = atlas_db.register_project(conn, "/repo/x")
        rid = atlas_db.start_run(conn, pid, sid)
        conn.execute(
            "UPDATE runs SET orchestrating=1, started_at=100 WHERE id=?", (rid,)
        )
        atlas_db.insert_signal(
            conn,
            sid,
            {
                "message_uuid": "m1",
                "signal_type": "user_correction",
                "weight": 1.0,
                "snippet": snippet,
            },
        )
        conn.commit()
        conn.close()

    def _run(self, sid, cwd):
        sys.stdin = io.StringIO(json.dumps({"session_id": sid, "cwd": cwd}))
        try:
            with (
                mock.patch.object(atlas_hook_guard, "_state_dir", lambda: self.tmp),
                mock.patch.object(atlas_hook_guard, "should_run", lambda *a, **k: True),
            ):
                try:
                    memory_capture.main()
                except SystemExit:
                    pass
        finally:
            sys.stdin = sys.__stdin__

    def test_capture_writes_project_file_not_global(self):
        proj = _make_repo(self.tmp, "alpha")
        self._seed("s1", "Prefer sqlite over json")
        self._run("s1", proj)
        mem = os.path.join(proj, ".atlas", "memory", "MEMORY.md")
        text = open(mem, encoding="utf-8").read()
        self.assertIn("Prefer sqlite over json", text)
        self.assertIn("(alpha)", text)
        self.assertFalse(os.path.exists(self.global_memory()), "global file touched")
        self.assertFalse(
            os.path.exists(os.path.join(self.atlas_home, "memory", "PROJECT.md"))
        )

    def test_worktree_subagent_cwd_maps_to_main_root(self):
        main = _make_repo(self.tmp, "beta")
        gitdir = os.path.join(main, ".git", "worktrees", "wt1")
        os.makedirs(gitdir)
        with open(os.path.join(gitdir, "commondir"), "w") as fh:
            fh.write("../..\n")
        wt = os.path.join(self.tmp, "wt1")
        os.makedirs(os.path.join(wt, "agent-0123456789ab"))
        with open(os.path.join(wt, ".git"), "w") as fh:
            fh.write(f"gitdir: {gitdir}\n")
        self._seed("s2", "Never mock the db")
        self._run("s2", os.path.join(wt, "agent-0123456789ab"))
        text = open(
            os.path.join(main, ".atlas", "memory", "MEMORY.md"), encoding="utf-8"
        ).read()
        self.assertIn("Never mock the db", text)
        self.assertIn("(beta)", text)  # main project name, not agent-<hex> or wt1
        self.assertFalse(os.path.exists(os.path.join(wt, ".atlas")))
        self.assertFalse(os.path.exists(self.global_memory()))

    def test_home_cwd_is_dropped(self):
        self._seed("s3", "Something durable")
        self._run("s3", self.home)
        self.assertFalse(
            os.path.exists(os.path.join(self.home, ".atlas", "memory", "MEMORY.md"))
        )
        self.assertFalse(os.path.exists(self.global_memory()))


class RootGuardTest(_Base):
    def test_refuses_home_temp_and_dot_atlas(self):
        for bad in (
            self.home,
            tempfile.gettempdir(),
            os.path.join(self.tmp, "p", ".atlas", "memory"),
        ):
            res = atlas_memory.add("project", "x", root=bad)
            self.assertFalse(res["success"], bad)

    def test_memory_target_ignores_root_and_no_root_keeps_legacy(self):
        proj = _make_repo(self.tmp, "gamma")
        self.assertTrue(
            atlas_memory.add("memory", "cross-project", root=proj)["success"]
        )
        self.assertTrue(atlas_memory.add("project", "legacy")["success"])
        self.assertIn("cross-project", open(self.global_memory()).read())
        self.assertTrue(
            os.path.exists(os.path.join(self.atlas_home, "memory", "PROJECT.md"))
        )
        self.assertFalse(os.path.exists(os.path.join(proj, ".atlas")))

    def test_project_store_rotates_into_project_archive(self):
        proj = _make_repo(self.tmp, "delta")
        with mock.patch.object(atlas_memory, "WORKING_CAP_CHARS", 60):
            for i in range(4):
                atlas_memory.add("project", f"entry number {i} " + "x" * 15, root=proj)
        arch = os.path.join(proj, ".atlas", "memory", "archive")
        self.assertTrue(os.listdir(arch))
        self.assertFalse(
            os.path.exists(os.path.join(self.atlas_home, "memory", "archive"))
        )


class MigrationTest(_Base):
    def setUp(self):
        super().setUp()
        self.a = _make_repo(self.tmp, "alpha")
        self.b = _make_repo(self.tmp, "beta")
        os.makedirs(os.path.join(self.tmp, "x"))
        self.d1 = _make_repo(os.path.join(self.tmp, "x"), "dup")
        os.makedirs(os.path.join(self.tmp, "y"))
        self.d2 = _make_repo(os.path.join(self.tmp, "y"), "dup")
        conn = sqlite3.connect(self.db)
        atlas_db.init(conn)
        for root in (self.a, self.b, self.d1, self.d2, os.path.join(self.tmp, "ghost")):
            conn.execute(
                "INSERT INTO projects(root_path, name) VALUES (?, ?)",
                (root, os.path.basename(root)),
            )
        conn.commit()
        conn.close()
        mem = os.path.join(self.atlas_home, "memory")
        os.makedirs(mem)
        self.mem_entries = [
            "User correction (alpha): use X not Y",
            "Assumption to avoid (dup): ambiguous one",
            "[alpha] parallelism: 1 -> 4 (recorded by dashboard remeasure)",
            "Untagged lesson",
            "User correction (ghost): project not on disk",
        ]
        self.proj_entries = [
            "[beta] speed: cache it",
            "[beta] dim: re-baselined, supersedes #7",
        ]
        atlas_memory._write_file(Path(mem) / "MEMORY.md", self.mem_entries)
        atlas_memory._write_file(Path(mem) / "PROJECT.md", self.proj_entries)

    def test_dry_run_changes_nothing(self):
        before = {
            n: open(os.path.join(self.atlas_home, "memory", n)).read()
            for n in ("MEMORY.md", "PROJECT.md")
        }
        plan = atlas_memory.migrate_global_to_projects(self.atlas_home, self.db)
        self.assertFalse(plan["applied"])
        self.assertEqual(sorted(plan["moves"]), sorted([self.a, self.b]))
        self.assertEqual(len(plan["stamps"]), 2)
        reasons = sorted(r for _, r in plan["left"])
        self.assertEqual(
            reasons,
            ["ambiguous project", "no project tag", "unknown project ghost"],
        )
        for n, text in before.items():
            self.assertEqual(
                open(os.path.join(self.atlas_home, "memory", n)).read(), text
            )
        self.assertFalse(os.path.exists(os.path.join(self.a, ".atlas")))

    def test_only_root_moves_just_that_project(self):
        plan = atlas_memory.migrate_global_to_projects(
            self.atlas_home, self.db, apply=True, only_root=self.a
        )
        self.assertEqual(list(plan["moves"]), [self.a])
        self.assertEqual(plan["stamps"], [])
        self.assertEqual(atlas_memory.get_entries("project", root=self.b), [])
        self.assertIn(
            "[beta] speed: cache it",
            atlas_memory._read_file(Path(self.atlas_home) / "memory" / "PROJECT.md"),
        )

    def test_apply_moves_archives_and_leaves(self):
        plan = atlas_memory.migrate_global_to_projects(
            self.atlas_home, self.db, apply=True
        )
        self.assertTrue(plan["applied"])
        self.assertEqual(
            atlas_memory.get_entries("project", root=self.a),
            ["User correction (alpha): use X not Y"],
        )
        self.assertEqual(
            atlas_memory.get_entries("project", root=self.b), ["[beta] speed: cache it"]
        )
        left = atlas_memory.get_entries("memory")
        self.assertEqual(
            sorted(left),
            sorted(
                [
                    "Assumption to avoid (dup): ambiguous one",
                    "Untagged lesson",
                    "User correction (ghost): project not on disk",
                ]
            ),
        )
        self.assertEqual(
            atlas_memory._read_file(Path(self.atlas_home) / "memory" / "PROJECT.md"),
            [],
        )
        arch = os.path.join(self.atlas_home, "memory", "archive")
        archived = "".join(open(os.path.join(arch, f)).read() for f in os.listdir(arch))
        self.assertIn("recorded by dashboard remeasure", archived)
        self.assertIn("supersedes #7", archived)
        # stamps never reach a project store
        self.assertNotIn(
            "remeasure", "".join(atlas_memory.get_entries("project", root=self.a))
        )
        # idempotent second run: nothing left to move
        again = atlas_memory.migrate_global_to_projects(
            self.atlas_home, self.db, apply=True
        )
        self.assertEqual(again["moves"], {})


if __name__ == "__main__":
    unittest.main()
