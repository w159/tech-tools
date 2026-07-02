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
