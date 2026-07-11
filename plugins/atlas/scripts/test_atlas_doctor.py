import json
import os
import shutil
import tempfile
import unittest

import atlas_doctor


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
        )
        atlas_doctor.PLUGINS_DIR = self.plugins
        atlas_doctor.STATE_PATH = self.state
        os.environ["CLAUDE_PLUGIN_ROOT"] = self.self_root

    def tearDown(self):
        atlas_doctor.PLUGINS_DIR, atlas_doctor.STATE_PATH, prev = self._saved
        if prev is None:
            os.environ.pop("CLAUDE_PLUGIN_ROOT", None)
        else:
            os.environ["CLAUDE_PLUGIN_ROOT"] = prev
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
        ghost = os.path.join(ip, "skills", "atlas-loop")
        os.makedirs(ghost, exist_ok=True)
        results, ctx = atlas_doctor.run_checks("atlas")
        self.assertFalse(self.by_check(results)["stale-assets"]["ok"])
        actions = atlas_doctor.apply_fixes(ctx, "atlas")
        self.assertTrue(any("quarantined" in a for a in actions))
        self.assertFalse(os.path.exists(ghost))
        # quarantine is a move, not a delete: the ghost lives in the trash dir
        trash = [
            d for d in os.listdir(self.plugins) if d.startswith(".trash-atlas-doctor-")
        ]
        self.assertTrue(trash)
        self.assertTrue(
            os.path.isdir(os.path.join(self.plugins, trash[0], "atlas-loop"))
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
            f.write("ORCH_SKILLS = {'atlas-metis'}\nmark_orchestrating = None\n")
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


if __name__ == "__main__":
    unittest.main()
