import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import contextlib
import io
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))

import atlas_db
import atlas_doctor
import doctor_layout

TODAY = "2026-10-26"


def touch(path, text="x"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)


class LayoutBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.home = os.path.join(self.tmp, "home")
        self.atlas_home = os.path.join(self.home, ".atlas")
        os.makedirs(self.atlas_home)
        self.repo = os.path.join(self.tmp, "work", "app")
        os.makedirs(os.path.join(self.repo, ".git"))
        patcher = mock.patch.dict(
            os.environ,
            {
                "HOME": self.home,
                "ATLAS_HOME": self.atlas_home,
                "ATLAS_DB": os.path.join(self.atlas_home, "atlas.db"),
                "CLAUDE_PROJECT_DIR": self.repo,
            },
        )
        # cwd must never be a real checkout: fix code resolves roots from it
        prev_cwd = os.getcwd()
        os.chdir(self.repo)
        self.addCleanup(os.chdir, prev_cwd)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def kinds(self, root=None):
        return sorted(
            (f["kind"], os.path.relpath(f["path"], root or self.repo))
            for f in doctor_layout.check_atlas_layout(root or self.repo)
        )


class StrayDetectionTest(LayoutBase):
    def test_stray_in_subdir_is_found_and_archived_without_data_loss(self):
        touch(
            os.path.join(self.repo, "frontend", ".atlas", ".run", "channels.json"), "{}"
        )
        self.assertEqual(self.kinds(), [("stray", "frontend/.atlas")])
        moves = doctor_layout.fix_atlas_layout(
            doctor_layout.check_atlas_layout(self.repo), self.repo, today=TODAY
        )
        self.assertEqual([m["status"] for m in moves], ["moved"])
        dest = os.path.join(
            self.repo, ".atlas", "archive", f"{TODAY}_stray-atlas_frontend-atlas"
        )
        self.assertEqual(moves[0]["dest"], dest)
        self.assertTrue(os.path.exists(os.path.join(dest, ".run", "channels.json")))
        self.assertFalse(os.path.exists(os.path.join(self.repo, "frontend", ".atlas")))

    def test_fix_is_idempotent(self):
        touch(os.path.join(self.repo, "frontend", ".atlas", "a"))
        doctor_layout.fix_atlas_layout(
            doctor_layout.check_atlas_layout(self.repo), self.repo
        )
        self.assertEqual(self.kinds(), [])  # archived copy is not re-flagged
        self.assertEqual(
            doctor_layout.fix_atlas_layout(
                doctor_layout.check_atlas_layout(self.repo), self.repo
            ),
            [],
        )

    def test_collision_is_skipped_and_reported(self):
        touch(os.path.join(self.repo, "frontend", ".atlas", "a"), "stray")
        dest = os.path.join(
            self.repo, ".atlas", "archive", f"{TODAY}_stray-atlas_frontend-atlas"
        )
        touch(os.path.join(dest, "keep"), "existing")
        moves = doctor_layout.fix_atlas_layout(
            doctor_layout.check_atlas_layout(self.repo), self.repo, today=TODAY
        )
        self.assertEqual(moves[0]["status"], "skipped")
        self.assertTrue(
            os.path.exists(os.path.join(self.repo, "frontend", ".atlas", "a"))
        )
        self.assertTrue(os.path.exists(os.path.join(dest, "keep")))

    def test_move_error_is_reported_not_raised(self):
        touch(os.path.join(self.repo, "frontend", ".atlas", "a"))
        with mock.patch.object(
            doctor_layout.shutil, "move", side_effect=OSError("denied")
        ):
            moves = doctor_layout.fix_atlas_layout(
                doctor_layout.check_atlas_layout(self.repo), self.repo
            )
        self.assertEqual(moves[0]["status"], "error")
        self.assertIn("denied", moves[0]["reason"])

    def test_nested_repo_dependency_trees_and_own_atlas_are_not_strays(self):
        touch(os.path.join(self.repo, ".atlas", ".run", "x"))
        touch(os.path.join(self.repo, "node_modules", "pkg", ".atlas", "x"))
        touch(os.path.join(self.repo, ".venv-x", "lib", ".atlas", "x"))
        os.makedirs(os.path.join(self.repo, "vendor", "lib", ".git"))
        touch(os.path.join(self.repo, "vendor", "lib", ".atlas", "x"))
        self.assertEqual(self.kinds(), [])

    def test_seeded_nested_atlas_is_detected(self):
        # the observed shape: <proj>/.atlas/.run/.atlas/.run/{...}
        touch(
            os.path.join(self.repo, ".atlas", ".run", ".atlas", ".run", "channels.json")
        )
        touch(os.path.join(self.repo, ".atlas", ".run", "atlas-orchestrate.active"))
        self.assertEqual(self.kinds(), [("nested", ".atlas/.run/.atlas")])
        moves = doctor_layout.fix_atlas_layout(
            doctor_layout.check_atlas_layout(self.repo), self.repo, today=TODAY
        )
        self.assertEqual(moves[0]["status"], "moved")
        self.assertTrue(
            os.path.exists(os.path.join(moves[0]["dest"], ".run", "channels.json"))
        )
        self.assertTrue(
            os.path.exists(
                os.path.join(self.repo, ".atlas", ".run", "atlas-orchestrate.active")
            )
        )
        self.assertEqual(self.kinds(), [])

    def test_home_run_project_scope_files_move_to_home_archive(self):
        run = os.path.join(self.atlas_home, ".run")
        touch(os.path.join(run, "channels.json"), "{}")
        touch(os.path.join(run, "board", "item.json"))
        touch(os.path.join(run, "keep-me.txt"))
        found = doctor_layout.check_atlas_layout(self.repo)
        self.assertEqual(
            sorted(
                os.path.basename(f["path"]) for f in found if f["kind"] == "home_run"
            ),
            ["board", "channels.json"],
        )
        doctor_layout.fix_atlas_layout(found, self.repo, today=TODAY)
        self.assertTrue(
            os.path.exists(
                os.path.join(
                    self.atlas_home, "archive", f"{TODAY}_stray-atlas_run-channels-json"
                )
            )
        )
        self.assertTrue(os.path.exists(os.path.join(run, "keep-me.txt")))
        self.assertEqual(doctor_layout.check_atlas_layout(self.repo), [])

    def test_container_atlas_is_found_from_a_child_repo(self):
        box = os.path.join(self.tmp, "box")
        for name in ("one", "two"):
            os.makedirs(os.path.join(box, name, ".git"))
        touch(os.path.join(box, ".atlas", ".run", "inbox", "m.json"))
        found = doctor_layout.check_atlas_layout(os.path.join(box, "one"))
        self.assertEqual(
            [(f["kind"], f["path"]) for f in found],
            [("container", os.path.join(box, ".atlas"))],
        )
        moves = doctor_layout.fix_atlas_layout(
            found, os.path.join(box, "one"), today=TODAY
        )
        # an ancestor's .atlas is reported with a manual command, never moved
        self.assertEqual([m["status"] for m in moves], ["manual"])
        self.assertIn("mv ", moves[0]["reason"])
        self.assertTrue(os.path.isdir(os.path.join(box, ".atlas")))

    def test_stray_outside_root_is_never_moved_even_with_apply(self):
        other = os.path.join(self.tmp, "work", "other")
        os.makedirs(os.path.join(other, ".git"))
        touch(os.path.join(other, "pkg", ".atlas", "a"))
        found = doctor_layout.check_atlas_layout(other)
        self.assertEqual([f["kind"] for f in found], ["stray"])
        moves = doctor_layout.fix_atlas_layout(
            found, self.repo, apply=True, today=TODAY
        )
        self.assertEqual(
            [(m["status"], m["reason"]) for m in moves],
            [("skipped", "outside project")],
        )
        self.assertTrue(os.path.exists(os.path.join(other, "pkg", ".atlas", "a")))
        self.assertFalse(os.path.exists(os.path.join(other, ".atlas")))

    def test_destination_outside_project_and_home_is_refused(self):
        touch(os.path.join(self.repo, "pkg", ".atlas", "a"))
        found = doctor_layout.check_atlas_layout(self.repo)
        found[0]["archive_base"] = os.path.join(self.tmp, "elsewhere")
        moves = doctor_layout.fix_atlas_layout(found, self.repo, today=TODAY)
        self.assertEqual(moves[0]["status"], "skipped")
        self.assertTrue(os.path.exists(os.path.join(self.repo, "pkg", ".atlas", "a")))
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "elsewhere")))

    def test_home_run_outside_given_home_is_refused(self):
        run = os.path.join(self.tmp, "otherhome", ".atlas", ".run")
        touch(os.path.join(run, "channels.json"))
        found = doctor_layout.check_atlas_layout(
            self.repo, home=os.path.join(self.tmp, "otherhome", ".atlas")
        )
        moves = doctor_layout.fix_atlas_layout(
            found, self.repo, today=TODAY
        )  # home defaults to temp HOME
        self.assertEqual(moves[0]["status"], "skipped")
        self.assertTrue(os.path.exists(os.path.join(run, "channels.json")))

    def test_single_repo_parent_atlas_is_not_a_container(self):
        box = os.path.join(self.tmp, "solo")
        os.makedirs(os.path.join(box, "one", ".git"))
        touch(os.path.join(box, ".atlas", "x"))
        self.assertEqual(doctor_layout.check_atlas_layout(os.path.join(box, "one")), [])


class SuiteIsolationTest(unittest.TestCase):
    """Running the doctor suites from inside a project whose ancestor holds a
    container .atlas must leave that ancestor, and the project, untouched."""

    def test_doctor_suites_leave_ancestor_sentinel_and_project_alone(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        for name in ("one", "two"):
            os.makedirs(os.path.join(tmp, name, ".git"))
        sentinel = os.path.join(tmp, ".atlas", ".run", "sentinel.json")
        touch(sentinel, "keep")
        touch(os.path.join(tmp, "one", "sub", ".atlas", "stray.json"), "keep")
        env = {k: v for k, v in os.environ.items() if not k.startswith("ATLAS_")}
        env.pop("CLAUDE_PROJECT_DIR", None)
        env.pop("_ATLAS_TEST_ISOLATED_ROOT", None)
        env["PYTHONPATH"] = os.path.dirname(os.path.abspath(__file__))
        proc = subprocess.run(
            [
                sys.executable,
                "-m",
                "unittest",
                "test_atlas_doctor",
                "test_atlas_doctor_layout.StrayDetectionTest",
            ],
            cwd=os.path.join(tmp, "one", "sub"),
            env=env,
            capture_output=True,
            text=True,
            timeout=300,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr[-1500:])
        self.assertEqual(open(sentinel).read(), "keep")
        self.assertTrue(
            os.path.exists(os.path.join(tmp, "one", "sub", ".atlas", "stray.json"))
        )
        self.assertFalse(os.path.exists(os.path.join(tmp, "one", ".atlas")))


class HookTest(LayoutBase):
    def hook(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            for line in atlas_doctor.hook_layout_notes(self.repo):
                print(line)
        return buf.getvalue()

    def test_clean_project_is_silent(self):
        with mock.patch.object(
            doctor_layout, "docs_naming_violations", return_value=[]
        ):
            self.assertEqual(self.hook(), "")

    def test_moved_stray_prints_exactly_one_short_line(self):
        touch(os.path.join(self.repo, "frontend", ".atlas", "a"))
        with mock.patch.object(
            doctor_layout, "docs_naming_violations", return_value=[]
        ):
            out = self.hook()
        self.assertEqual(out, "atlas layout: moved 1 stray .atlas path(s) to archive\n")

    def test_docs_naming_is_reported_not_fixed_in_hook(self):
        with (
            mock.patch.object(
                doctor_layout, "docs_naming_violations", return_value=[("a", "b")] * 3
            ),
            mock.patch.object(doctor_layout, "fix_docs_naming") as fix,
        ):
            out = self.hook()
        self.assertEqual(
            out, "docs naming: 3 files need renaming; run atlas_doctor.py --fix\n"
        )
        fix.assert_not_called()


class ScoringTest(LayoutBase):
    def test_hosted_url_warns_and_loopback_does_not(self):
        with mock.patch.dict(
            os.environ, {"ATLAS_TYPESAFE_URL": "https://api.typesafe.ai"}
        ):
            self.assertEqual(
                doctor_layout.hosted_scoring_url(), "https://api.typesafe.ai"
            )
            ok, detail = atlas_doctor.check_typesafe_scoring()
            self.assertFalse(ok)
            self.assertIn("third party", detail)
        for local in (
            "http://127.0.0.1:11434",
            "http://localhost:11434",
            "http://[::1]:11434",
        ):
            with mock.patch.dict(os.environ, {"ATLAS_TYPESAFE_URL": local}):
                self.assertEqual(doctor_layout.hosted_scoring_url(), "")

    def test_hosted_url_in_settings_json_is_read(self):
        touch(
            os.path.join(self.atlas_home, "settings.json"),
            '{"env": {"ATLAS_TYPESAFE_URL": "https://scores.example.com"}}',
        )
        with mock.patch.dict(os.environ, {"ATLAS_TYPESAFE_URL": ""}):
            self.assertEqual(
                doctor_layout.hosted_scoring_url(), "https://scores.example.com"
            )

    def test_context_limit_errors_are_counted(self):
        conn = atlas_db.connect()
        atlas_db.init(conn)
        now = time.time()
        for i, label in enumerate(
            (
                'POST x failed: {"error":"prompt 0 has 2247 tokens; expected 1–2048"}',
                "prompt 0 has 3000 tokens; expected 1-2048",
                "TypeSafe API error 429",
            )
        ):
            atlas_db.upsert_turn_score(
                conn,
                "s",
                f"m{i}",
                "scoring_error",
                kind="error",
                label=label,
                scored_at=now,
            )
        self.assertEqual(doctor_layout.context_limit_errors(conn, now), 2)
        conn.close()


class ProjectIdentityTest(LayoutBase):
    def setUp(self):
        super().setUp()
        patcher = mock.patch.object(doctor_layout, "_TEMP_PREFIXES", ())
        patcher.start()
        self.addCleanup(patcher.stop)
        self.conn = atlas_db.connect()
        atlas_db.init(self.conn)
        self.addCleanup(self.conn.close)

    def test_classification_and_repoint_with_backup(self):
        sub = os.path.join(self.repo, "frontend")
        os.makedirs(sub)
        run_dir = os.path.join(self.repo, ".atlas", ".run")
        os.makedirs(run_dir)
        gone = os.path.join(self.tmp, "gone")
        wt = os.path.join(self.tmp, "x", "worktrees", "a")
        ids = {
            name: atlas_db.register_project(self.conn, p)
            for name, p in (
                ("root", self.repo),
                ("sub", sub),
                ("atlas", run_dir),
                ("gone", gone),
                ("wt", wt),
            )
        }
        for name in ("sub", "atlas", "gone"):
            self.conn.execute(
                "INSERT INTO runs(project_id,session_id,started_at) VALUES(?,?,1)",
                (ids[name], "s-" + name),
            )
        self.conn.execute(
            "INSERT INTO facets(session_id,project_id,created_at) VALUES('f-sub',?,1)",
            (ids["sub"],),
        )
        self.conn.commit()

        counts, _ = doctor_layout.check_project_identity(self.conn)
        self.assertEqual(
            counts,
            {"git_subdir": 1, "inside_atlas": 1, "worktree_temp": 1, "missing": 1},
        )

        changed = doctor_layout.fix_project_identity(self.conn, atlas_db.db_path())
        self.assertEqual(sorted(p for p, _ in changed), sorted([sub, run_dir]))
        pid = lambda sql: self.conn.execute(sql).fetchone()[0]  # noqa: E731
        self.assertEqual(
            pid("SELECT project_id FROM runs WHERE session_id='s-sub'"), ids["root"]
        )
        self.assertEqual(
            pid("SELECT project_id FROM runs WHERE session_id='s-atlas'"), ids["root"]
        )
        self.assertEqual(
            pid("SELECT project_id FROM runs WHERE session_id='s-gone'"), ids["gone"]
        )
        self.assertEqual(
            pid("SELECT project_id FROM facets WHERE session_id='f-sub'"), ids["root"]
        )
        backups = os.listdir(os.path.join(self.atlas_home, "backups"))
        self.assertEqual(len(backups), 1)
        self.assertTrue(backups[0].startswith("atlas-") and backups[0].endswith(".db"))
        # second run: nothing left to re-point, no second backup
        self.assertEqual(
            doctor_layout.fix_project_identity(self.conn, atlas_db.db_path()), []
        )

    def test_check_is_read_only(self):
        atlas_db.register_project(self.conn, os.path.join(self.repo, "frontend"))
        before = self.conn.total_changes
        doctor_layout.check_project_identity(self.conn)
        self.assertEqual(self.conn.total_changes, before)


if __name__ == "__main__":
    unittest.main()
