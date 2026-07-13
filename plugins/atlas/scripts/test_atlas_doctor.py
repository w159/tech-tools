import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))

import atlas_doctor
import atlas_db


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f)


class AtlasDoctorTest(unittest.TestCase):
    """Recreates the 2026-07-01 incident in a sandbox: marketplace pointed at
    a stale fork, installed atlas rolled back to 1.0.1 while the canonical
    repo ships 2.3.0."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.plugins = os.path.join(self.tmp, "plugins")
        self.state = os.path.join(self.tmp, "state.json")
        self.clone = os.path.join(self.plugins, "marketplaces", "tech-tools")

        # the plugin the doctor ships inside of (defines the canonical repo)
        self.self_root = os.path.join(self.tmp, "selfplugin")
        write_json(
            os.path.join(self.self_root, ".claude-plugin", "plugin.json"),
            {
                "name": "atlas",
                "version": "2.3.0",
                "repository": "https://github.com/w159/tech-tools",
            },
        )

        # marketplace clone offers 2.3.0; installed entry is the 1.0.1 rollback
        write_json(
            os.path.join(
                self.clone, "plugins", "atlas", ".claude-plugin", "plugin.json"
            ),
            {"name": "atlas", "version": "2.3.0"},
        )
        self.install_101 = os.path.join(
            self.plugins, "cache", "tech-tools", "atlas", "1.0.1"
        )
        write_json(
            os.path.join(self.install_101, ".claude-plugin", "plugin.json"),
            {"name": "atlas", "version": "1.0.1"},
        )
        write_json(
            os.path.join(self.plugins, "installed_plugins.json"),
            {
                "version": 2,
                "plugins": {
                    "atlas@tech-tools": [
                        {
                            "scope": "user",
                            "installPath": self.install_101,
                            "version": "1.0.1",
                        }
                    ]
                },
            },
        )
        write_json(
            os.path.join(self.plugins, "known_marketplaces.json"),
            {
                "tech-tools": {
                    "source": {
                        "source": "git",
                        "url": "https://github.com/henssler-financial/tech-tools.git",
                    },
                    "installLocation": self.clone,
                    "autoUpdate": True,
                }
            },
        )

        self._saved = (
            atlas_doctor.PLUGINS_DIR,
            atlas_doctor.STATE_PATH,
            os.environ.get("CLAUDE_PLUGIN_ROOT"),
            os.environ.get("ATLAS_DB"),
        )
        atlas_doctor.PLUGINS_DIR = self.plugins
        atlas_doctor.STATE_PATH = self.state
        os.environ["CLAUDE_PLUGIN_ROOT"] = self.self_root

    def tearDown(self):
        (
            atlas_doctor.PLUGINS_DIR,
            atlas_doctor.STATE_PATH,
            root_prev,
            db_prev,
        ) = self._saved
        if root_prev is None:
            os.environ.pop("CLAUDE_PLUGIN_ROOT", None)
        else:
            os.environ["CLAUDE_PLUGIN_ROOT"] = root_prev
        if db_prev is None:
            os.environ.pop("ATLAS_DB", None)
        else:
            os.environ["ATLAS_DB"] = db_prev
        shutil.rmtree(self.tmp)

    def by_check(self, results):
        return {r["check"]: r for r in results}

    def test_count_assets_ignores_junk_entries(self):
        ip = self.install_101
        os.makedirs(os.path.join(ip, "commands"), exist_ok=True)
        os.makedirs(os.path.join(ip, "agents"), exist_ok=True)
        for d, f in (("commands", "a.md"), ("agents", "b.md")):
            open(os.path.join(ip, d, f), "w").close()
        open(os.path.join(ip, "commands", ".DS_Store"), "w").close()
        sk = os.path.join(ip, "skills", "real-skill")
        os.makedirs(sk, exist_ok=True)
        open(os.path.join(sk, "SKILL.md"), "w").close()
        # junk: a .DS_Store and a dir without SKILL.md must not count
        open(os.path.join(ip, "skills", ".DS_Store"), "w").close()
        os.makedirs(os.path.join(ip, "skills", "empty-dir"), exist_ok=True)
        counts = atlas_doctor.count_assets(ip)
        self.assertEqual(counts, {"commands": 1, "agents": 1, "skills": 1})

    def test_stale_assets_detected_in_plugin_and_user_dirs(self):
        ip = self.install_101
        os.makedirs(os.path.join(ip, "skills", "atlas-uxt-swarm"), exist_ok=True)
        user_skills = os.path.join(self.tmp, "userskills")
        user_agents = os.path.join(self.tmp, "useragents")
        os.makedirs(os.path.join(user_skills, "uxt-swarm"), exist_ok=True)
        os.makedirs(os.path.join(user_skills, "orchestrate.backup-123"), exist_ok=True)
        os.makedirs(user_agents, exist_ok=True)
        open(os.path.join(user_agents, "orc-explorer.agent.md"), "w").close()
        open(os.path.join(user_agents, "orc-explorer.toml"), "w").close()
        # a live, non-deprecated asset must NOT be flagged
        os.makedirs(os.path.join(user_skills, "webapp-testing"), exist_ok=True)
        open(os.path.join(user_agents, "code-reviewer.agent.md"), "w").close()
        stale = atlas_doctor.find_stale_assets(
            ip, self.clone, "atlas", user_skills=user_skills, user_agents=user_agents
        )
        names = sorted(os.path.basename(p) for p in stale)
        self.assertEqual(
            names,
            [
                "atlas-uxt-swarm",
                "orc-explorer.agent.md",
                "orc-explorer.toml",
                "orchestrate.backup-123",
                "uxt-swarm",
            ],
        )

    def test_fix_quarantines_stale_assets(self):
        ip = self.install_101
        ghost = os.path.join(ip, "skills", "atlas-uxt-swarm")
        os.makedirs(ghost, exist_ok=True)
        results, ctx = atlas_doctor.run_checks("atlas")
        self.assertFalse(self.by_check(results)["stale-assets"]["ok"])
        actions = atlas_doctor.apply_fixes(ctx, "atlas")
        self.assertTrue(any("quarantined" in a for a in actions))
        self.assertFalse(os.path.exists(ghost))
        # quarantine is a move, not a delete: the ghost lives in the trash dir
        trash = [
            d for d in os.listdir(self.plugins) if d.startswith(".trash-atlas-setup-")
        ]
        self.assertTrue(trash)
        self.assertTrue(
            os.path.isdir(os.path.join(self.plugins, trash[0], "atlas-uxt-swarm"))
        )

    def test_orchestration_wiring_flags_missing_skill_matcher(self):
        ip = self.install_101
        write_json(
            os.path.join(ip, "hooks", "hooks.json"),
            {
                "hooks": {
                    "PostToolUse": [
                        {
                            "matcher": "Read|Agent|Task",
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": "python3 x/dispatch_tripwire.py",
                                }
                            ],
                        }
                    ]
                }
            },
        )
        with open(os.path.join(ip, "hooks", "dispatch_tripwire.py"), "w") as f:
            f.write("# stub without auto-marking\n")
        problems = atlas_doctor.check_orchestration_wiring(ip)
        self.assertIn("PostToolUse matcher missing Skill", problems)
        self.assertTrue(any("ORCH_SKILLS" in p for p in problems))

    def test_orchestration_wiring_passes_on_current_layout(self):
        ip = self.install_101
        write_json(
            os.path.join(ip, "hooks", "hooks.json"),
            {
                "hooks": {
                    "PostToolUse": [
                        {
                            "matcher": "Read|Agent|Task|Skill",
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": "python3 x/dispatch_tripwire.py",
                                }
                            ],
                        }
                    ]
                }
            },
        )
        with open(os.path.join(ip, "hooks", "dispatch_tripwire.py"), "w") as f:
            f.write("ORCH_SKILLS = {'atlas-orchestrate'}\nmark_orchestrating = None\n")
        self.assertEqual(atlas_doctor.check_orchestration_wiring(ip), [])

    def test_norm_repo_treats_url_variants_as_equal(self):
        for u in (
            "https://github.com/w159/tech-tools.git",
            "https://github.com/W159/tech-tools",
            "git@github.com:w159/tech-tools.git",
        ):
            self.assertEqual(atlas_doctor.norm_repo(u), "w159/tech-tools")
        self.assertNotEqual(
            atlas_doctor.norm_repo(
                "https://github.com/henssler-financial/tech-tools.git"
            ),
            "w159/tech-tools",
        )

    def test_ver_tuple_orders_semver(self):
        self.assertLess(
            atlas_doctor.ver_tuple("1.0.1"), atlas_doctor.ver_tuple("2.3.0")
        )
        self.assertLess(
            atlas_doctor.ver_tuple("2.3.0"), atlas_doctor.ver_tuple("2.10.0")
        )

    def test_detects_fork_source_and_version_rollback(self):
        write_json(self.state, {"atlas@tech-tools": "2.3.0"})  # high-water mark
        checks = self.by_check(atlas_doctor.run_checks("atlas")[0])
        self.assertFalse(checks["marketplace-source"]["ok"])
        self.assertFalse(checks["version-sync"]["ok"])
        self.assertFalse(checks["rollback"]["ok"])
        self.assertIn("BELOW", checks["rollback"]["detail"])

    def test_orphan_marker_fails_install_path(self):
        open(os.path.join(self.install_101, ".orphaned_at"), "w").close()
        checks = self.by_check(atlas_doctor.run_checks("atlas")[0])
        self.assertFalse(checks["install-path"]["ok"])

    def test_fix_repoints_source_and_reregisters_marketplace_version(self):
        _, ctx = atlas_doctor.run_checks("atlas")
        actions = atlas_doctor.apply_fixes(ctx, "atlas")
        self.assertTrue(any("repointed" in a for a in actions))
        self.assertTrue(any("re-registered" in a for a in actions))

        with open(os.path.join(self.plugins, "known_marketplaces.json")) as f:
            markets = json.load(f)
        self.assertIn("w159/tech-tools", markets["tech-tools"]["source"]["url"])

        checks = self.by_check(atlas_doctor.run_checks("atlas")[0])
        self.assertTrue(checks["marketplace-source"]["ok"])
        self.assertTrue(checks["version-sync"]["ok"])
        self.assertTrue(checks["rollback"]["ok"])
        with open(os.path.join(self.plugins, "installed_plugins.json")) as f:
            installed = json.load(f)
        entry = installed["plugins"]["atlas@tech-tools"][0]
        self.assertEqual(entry["version"], "2.3.0")
        self.assertTrue(entry["installPath"].endswith("2.3.0"))

    def test_missing_registration_reports_and_does_not_crash(self):
        write_json(
            os.path.join(self.plugins, "installed_plugins.json"),
            {"version": 2, "plugins": {}},
        )
        checks = self.by_check(atlas_doctor.run_checks("atlas")[0])
        self.assertFalse(checks["registered"]["ok"])

    def test_hook_mode_always_exits_zero(self):
        self.assertEqual(atlas_doctor.main(["--hook"]), 0)

    def test_trash_dirs_capped(self):
        # M20: per-run trash dirs must not grow unbounded across runs.
        # Seed 8 trash dirs with distinct numeric stamps; cap must keep the
        # 5 newest and remove the rest.
        for i in range(100, 108):
            os.makedirs(
                os.path.join(self.plugins, f".trash-atlas-setup-{i}"),
                exist_ok=True,
            )
        removed = atlas_doctor.cap_trash_dirs(self.plugins, keep=5)
        self.assertEqual(removed, 3)
        remaining = sorted(
            d for d in os.listdir(self.plugins) if d.startswith(".trash-atlas-setup-")
        )
        self.assertEqual(len(remaining), 5)
        # the 5 highest stamps survive, the 3 oldest are gone
        self.assertEqual(remaining[-1], ".trash-atlas-setup-107")
        self.assertNotIn(".trash-atlas-setup-100", remaining)

        # apply_fixes must also cap: pre-seed 6 old trash dirs, run a fix that
        # quarantines a stale asset (creating one more), then assert the total
        # never exceeds the keep cap.
        ip = self.install_101
        ghost = os.path.join(ip, "skills", "atlas-uxt-swarm")
        os.makedirs(ghost, exist_ok=True)
        for i in range(200, 206):
            os.makedirs(
                os.path.join(self.plugins, f".trash-atlas-setup-{i}"),
                exist_ok=True,
            )
        results, ctx = atlas_doctor.run_checks("atlas")
        atlas_doctor.apply_fixes(ctx, "atlas", trash_stamp=999)
        remaining = [
            d for d in os.listdir(self.plugins) if d.startswith(".trash-atlas-setup-")
        ]
        self.assertLessEqual(len(remaining), atlas_doctor.TRASH_KEEP)

    def test_telemetry_purge_cap(self):
        # M21: telemetry tables must trim to a row cap, oldest first.
        db = os.path.join(self.tmp, "atlas.db")
        os.environ["ATLAS_DB"] = db
        conn = atlas_db.connect(db)
        atlas_db.init(conn)
        for i in range(20):
            conn.execute(
                "INSERT INTO signals (session_id, message_uuid, ts, signal_type) "
                "VALUES (?, ?, ?, ?)",
                ("s1", f"m{i}", float(i), "noise"),
            )
        conn.commit()
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM signals").fetchone()[0], 20)
        conn.close()

        summary = atlas_doctor.purge_telemetry(db, row_cap=5)
        self.assertIn("signals", summary)
        self.assertEqual(summary["signals"]["before"], 20)
        self.assertEqual(summary["signals"]["after"], 5)
        self.assertEqual(summary["signals"]["dropped"], 15)

        conn = atlas_db.connect(db)
        kept = conn.execute("SELECT id FROM signals ORDER BY id").fetchall()
        conn.close()
        # oldest-first purge: the 5 newest ids survive (SQLite ids start at 1)
        self.assertEqual([r[0] for r in kept], list(range(16, 21)))

    def test_maintenance_log_recorded(self):
        # M22: a purge/fix run must append a maintenance log entry to
        # doctor-state.json with timestamp, action, and before/after sizes.
        db = os.path.join(self.tmp, "atlas.db")
        os.environ["ATLAS_DB"] = db
        conn = atlas_db.connect(db)
        atlas_db.init(conn)
        for i in range(20):
            conn.execute(
                "INSERT INTO signals (session_id, message_uuid, ts, signal_type) "
                "VALUES (?, ?, ?, ?)",
                ("s1", f"m{i}", float(i), "noise"),
            )
        conn.commit()
        conn.close()

        self.assertEqual(atlas_doctor.main(["--purge", "--purge-cap", "5"]), 0)
        with open(self.state) as f:
            state = json.load(f)
        log = state.get("maintenance_log")
        self.assertTrue(log, "maintenance_log missing from doctor-state.json")
        entry = log[-1]
        self.assertIn("timestamp", entry)
        self.assertEqual(entry["action"], "purge")
        sizes = entry["tables"].get("signals", {})
        self.assertEqual(sizes.get("before"), 20)
        self.assertEqual(sizes.get("after"), 5)

    # --- gap-fillers: exercise the remaining uncovered source paths ---

    def test_norm_repo_empty_returns_empty(self):
        # line 71: empty/None url short-circuits to ""
        self.assertEqual(atlas_doctor.norm_repo(""), "")
        self.assertEqual(atlas_doctor.norm_repo(None), "")

    def test_self_manifest_unreadable_reports_and_returns(self):
        # lines 231-233: self_manifest() raises -> early return, empty ctx
        bad_root = os.path.join(self.tmp, "badplugin")
        os.makedirs(bad_root, exist_ok=True)
        with mock.patch.dict(os.environ, {"CLAUDE_PLUGIN_ROOT": bad_root}):
            results, ctx = atlas_doctor.run_checks("atlas")
        by = self.by_check(results)
        self.assertFalse(by["self-manifest"]["ok"])
        self.assertIn("cannot read own plugin.json", by["self-manifest"]["detail"])
        self.assertEqual(ctx, {})

    def test_config_unreadable_reports_and_returns(self):
        # lines 242-244: installed_plugins.json is not valid JSON
        with open(os.path.join(self.plugins, "installed_plugins.json"), "w") as f:
            f.write("not json{")
        results, ctx = atlas_doctor.run_checks("atlas")
        by = self.by_check(results)
        self.assertFalse(by["config-readable"]["ok"])
        self.assertIn("cannot read plugin config", by["config-readable"]["detail"])

    def test_directory_sourced_marketplace_passes_source_check(self):
        # line 262: directory-sourced marketplace has no repo URL
        write_json(
            os.path.join(self.plugins, "known_marketplaces.json"),
            {
                "tech-tools": {
                    "source": {"source": "directory", "path": "/local/market"},
                    "installLocation": self.clone,
                }
            },
        )
        results, _ = atlas_doctor.run_checks("atlas")
        by = self.by_check(results)
        self.assertTrue(by["marketplace-source"]["ok"])
        self.assertIn("directory:", by["marketplace-source"]["detail"])

    def test_clone_remote_with_git_dir_checked(self):
        # lines 275-277: clone has a .git dir -> _git remote get-url is consulted
        os.makedirs(os.path.join(self.clone, ".git"), exist_ok=True)

        def fake_git(args, cwd):
            if args[:2] == ["remote", "get-url"]:
                return subprocess.CompletedProcess(
                    ["git"] + args, 0, "https://github.com/w159/tech-tools.git", ""
                )
            return subprocess.CompletedProcess(["git"] + args, 0, "", "")

        with mock.patch.object(atlas_doctor, "_git", side_effect=fake_git):
            results, _ = atlas_doctor.run_checks("atlas")
        by = self.by_check(results)
        self.assertTrue(by["clone-remote"]["ok"])

    def test_marketplace_clone_without_manifest_fails_version_sync(self):
        # line 295: clone set but plugin.json absent -> mkt_ver None
        mf = os.path.join(
            self.clone, "plugins", "atlas", ".claude-plugin", "plugin.json"
        )
        os.remove(mf)
        results, _ = atlas_doctor.run_checks("atlas")
        by = self.by_check(results)
        self.assertFalse(by["version-sync"]["ok"])
        self.assertIn("no readable plugin.json", by["version-sync"]["detail"])

    def test_install_path_missing_manifest_fails(self):
        # line 316: installPath points at a dir with no plugin.json
        empty_install = os.path.join(self.tmp, "emptyinstall")
        os.makedirs(empty_install, exist_ok=True)
        write_json(
            os.path.join(self.plugins, "installed_plugins.json"),
            {
                "version": 2,
                "plugins": {
                    "atlas@tech-tools": [
                        {
                            "scope": "user",
                            "installPath": empty_install,
                            "version": "1.0.1",
                        }
                    ]
                },
            },
        )
        results, _ = atlas_doctor.run_checks("atlas")
        by = self.by_check(results)
        self.assertFalse(by["install-path"]["ok"])
        self.assertIn("missing manifest", by["install-path"]["detail"])

    def test_hooks_wired_detects_missing_hook_files(self):
        # lines 330-335: hooks.json exists and references a missing hook file
        ip = self.install_101
        os.makedirs(os.path.join(ip, "hooks"), exist_ok=True)
        open(os.path.join(ip, "hooks", "dispatch_tripwire.py"), "w").close()
        write_json(
            os.path.join(ip, "hooks", "hooks.json"),
            {
                "hooks": {
                    "PostToolUse": [
                        {"command": "${CLAUDE_PLUGIN_ROOT}/hooks/dispatch_tripwire.py"},
                        {"command": "${CLAUDE_PLUGIN_ROOT}/hooks/missing.py"},
                    ]
                }
            },
        )
        results, _ = atlas_doctor.run_checks("atlas")
        by = self.by_check(results)
        self.assertFalse(by["hooks-wired"]["ok"])
        self.assertIn("hooks/missing.py", by["hooks-wired"]["detail"])

    def test_cap_trash_dirs_nonexistent_returns_zero(self):
        # line 384: plugins_dir does not exist
        self.assertEqual(atlas_doctor.cap_trash_dirs("/no/such/dir/here"), 0)

    def test_cap_trash_dirs_non_numeric_stamp(self):
        # lines 390-391: non-numeric stamps hit the ValueError fallback path
        for name in (
            ".trash-atlas-setup-99",
            ".trash-atlas-setup-abc",
            ".trash-atlas-setup-zzz",
        ):
            os.makedirs(os.path.join(self.plugins, name), exist_ok=True)
        removed = atlas_doctor.cap_trash_dirs(self.plugins, keep=1)
        # numeric (0,99,"") sorts before non-numeric (1,0,*); keep=1 drops two
        self.assertEqual(removed, 2)
        remaining = [
            d for d in os.listdir(self.plugins) if d.startswith(".trash-atlas-setup-")
        ]
        self.assertEqual(remaining, [".trash-atlas-setup-zzz"])

    def test_purge_telemetry_missing_db_returns_empty(self):
        # line 416: db path does not exist -> empty summary
        self.assertEqual(atlas_doctor.purge_telemetry("/no/such/db.sqlite"), {})

    def test_purge_telemetry_handles_absent_tables_and_missing_columns(self):
        # lines 425-426 (table absent) and 434-435 (column absent / schema mismatch)
        import sqlite3

        db = os.path.join(self.tmp, "partial.db")
        conn = sqlite3.connect(db)
        # runs has the expected `id` column -> trims successfully
        conn.execute("CREATE TABLE runs (id INTEGER PRIMARY KEY)")
        for _ in range(10):
            conn.execute("INSERT INTO runs DEFAULT VALUES")
        # signals exists but has no `id` column -> DELETE raises OperationalError
        conn.execute("CREATE TABLE signals (data TEXT)")
        conn.execute("INSERT INTO signals VALUES ('x')")
        conn.commit()
        conn.close()

        summary = atlas_doctor.purge_telemetry(db, row_cap=5)
        self.assertEqual(summary["runs"]["before"], 10)
        self.assertEqual(summary["runs"]["after"], 5)
        # events absent -> skipped via the table-absent branch
        self.assertNotIn("events", summary)
        # signals present but lacks id -> skipped via the column-absent branch
        self.assertNotIn("signals", summary)

    def test_apply_fixes_context_incomplete(self):
        # line 468: no expected_repo/key in ctx -> bail out
        actions = atlas_doctor.apply_fixes({}, "atlas")
        self.assertEqual(actions, ["cannot fix: context incomplete"])

    def test_apply_fixes_resets_clone_when_git_dir_present(self):
        # lines 487-494: clone has .git -> git remote/fetch/symbolic-ref/reset run
        os.makedirs(os.path.join(self.clone, ".git"), exist_ok=True)

        def fake_git(args, cwd):
            if args[:2] == ["remote", "get-url"]:
                return subprocess.CompletedProcess(
                    ["git"] + args, 0, "https://github.com/w159/tech-tools.git", ""
                )
            if args[:1] == ["symbolic-ref"]:
                return subprocess.CompletedProcess(
                    ["git"] + args, 0, "refs/remotes/origin/main", ""
                )
            if args[:1] == ["rev-parse"]:
                return subprocess.CompletedProcess(["git"] + args, 0, "abc123", "")
            return subprocess.CompletedProcess(["git"] + args, 0, "", "")

        with mock.patch.object(atlas_doctor, "_git", side_effect=fake_git):
            results, ctx = atlas_doctor.run_checks("atlas")
            actions = atlas_doctor.apply_fixes(ctx, "atlas")
        self.assertTrue(self.by_check(results)["clone-remote"]["ok"])
        self.assertTrue(any("reset marketplace clone" in a for a in actions))

    def test_apply_fixes_quarantine_failure_recorded(self):
        # lines 529-530: shutil.move fails on a vanished stale path
        ip = self.install_101
        ghost = os.path.join(ip, "skills", "atlas-uxt-swarm")
        os.makedirs(ghost, exist_ok=True)
        _, ctx = atlas_doctor.run_checks("atlas")
        # delete the detected asset so the move during fix fails
        shutil.rmtree(ghost)
        actions = atlas_doctor.apply_fixes(ctx, "atlas")
        self.assertTrue(any("could not quarantine" in a for a in actions))

    def test_apply_fixes_clears_orphan_markers(self):
        # lines 550-551: .orphaned_at markers are removed during a fix run
        ip = self.install_101
        orphan = os.path.join(ip, ".orphaned_at")
        open(orphan, "w").close()
        _, ctx = atlas_doctor.run_checks("atlas")
        actions = atlas_doctor.apply_fixes(ctx, "atlas")
        self.assertTrue(any("cleared" in a for a in actions))
        self.assertFalse(os.path.exists(orphan))

    def test_main_fix_runs_fix_and_rechecks(self):
        # lines 593-596: --fix branch applies fixes then re-checks
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = atlas_doctor.main(["--fix"])
        self.assertIn("FIX:", buf.getvalue())
        self.assertIn(rc, (0, 1))

    def test_main_default_prints_results_and_returns_nonzero(self):
        # lines 607-612: non-hook mode prints per-check lines and the summary
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = atlas_doctor.main([])
        out = buf.getvalue()
        self.assertIn("PASS", out)
        self.assertIn("FAIL", out)
        self.assertIn("PROBLEM", out)
        self.assertEqual(rc, 1)

    def test_dunder_main_runs_and_exits(self):
        # lines 616-617: __main__ guard calls sys.exit(main())
        src = atlas_doctor.__file__
        with open(src) as f:
            code = f.read()
        env = {
            "ATLAS_PLUGINS_DIR": self.plugins,
            "ATLAS_DOCTOR_STATE": self.state,
            "CLAUDE_PLUGIN_ROOT": self.self_root,
        }
        with mock.patch.dict(os.environ, env, clear=False):
            buf = io.StringIO()
            with (
                contextlib.redirect_stdout(buf),
                mock.patch.object(sys, "argv", ["atlas_doctor.py"]),
            ):
                with self.assertRaises(SystemExit) as cm:
                    exec(
                        compile(code, src, "exec"),
                        {"__name__": "__main__", "__file__": src},
                    )
            self.assertIn(cm.exception.code, (0, 1))

    def test_dunder_main_catches_internal_error(self):
        # lines 618-620: an Exception from main() is caught and reported as exit 2
        src = atlas_doctor.__file__
        with open(src) as f:
            code = f.read()
        # ATLAS_DB points at a directory -> sqlite3.connect raises OperationalError
        # inside purge_telemetry (outside its try), which propagates out of main().
        bad_db = os.path.join(self.tmp, "notadb")
        os.makedirs(bad_db)
        env = {
            "ATLAS_PLUGINS_DIR": self.plugins,
            "ATLAS_DOCTOR_STATE": self.state,
            "CLAUDE_PLUGIN_ROOT": self.self_root,
            "ATLAS_DB": bad_db,
        }
        with mock.patch.dict(os.environ, env, clear=False):
            buf = io.StringIO()
            with (
                contextlib.redirect_stdout(buf),
                mock.patch.object(sys, "argv", ["atlas_doctor.py", "--purge"]),
            ):
                with self.assertRaises(SystemExit) as cm:
                    exec(
                        compile(code, src, "exec"),
                        {"__name__": "__main__", "__file__": src},
                    )
            self.assertEqual(cm.exception.code, 2)
            self.assertIn("internal error", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
