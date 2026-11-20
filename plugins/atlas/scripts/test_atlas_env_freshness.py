import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_env  # noqa: E402


class StoreEnvTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = os.path.join(self.tmp.name, "home")
        self.cfg = os.path.join(self.tmp.name, "cfg")
        os.makedirs(self.home)
        os.makedirs(self.cfg)
        self.settings = os.path.join(self.cfg, "settings.json")

    def store(self, env, changed):
        with open(os.path.join(self.home, "settings.json"), "w") as fh:
            json.dump({"env": env, "changed": changed}, fh)

    def settings_at(self, epoch):
        with open(self.settings, "w") as fh:
            fh.write("{}")
        os.utime(self.settings, (epoch, epoch))

    def environ(self, **kw):
        e = {"ATLAS_HOME": self.home, "HOME": self.tmp.name, "CLAUDE_CONFIG_DIR": self.cfg}
        e.update(kw)
        return e

    def test_stale_store_loses_to_newer_settings(self):
        self.store({"ATLAS_DASHBOARD": "on"}, {"ATLAS_DASHBOARD": 1000})
        self.settings_at(5000)
        env = self.environ(ATLAS_DASHBOARD="off")
        self.assertEqual(atlas_env.apply_store_env(env), {})
        self.assertEqual(env["ATLAS_DASHBOARD"], "off")

    def test_newer_store_wins(self):
        self.store({"ATLAS_DASHBOARD": "on"}, {"ATLAS_DASHBOARD": 6000})
        self.settings_at(5000)
        env = self.environ(ATLAS_DASHBOARD="off")
        self.assertEqual(atlas_env.apply_store_env(env), {"ATLAS_DASHBOARD": "on"})
        self.assertEqual(env["ATLAS_DASHBOARD"], "on")

    def test_not_inherited_is_set(self):
        self.store({"ATLAS_DASHBOARD": "on"}, {})
        self.settings_at(5000)
        env = self.environ()
        self.assertEqual(atlas_env.apply_store_env(env), {"ATLAS_DASHBOARD": "on"})

    def test_missing_settings_store_wins(self):
        self.store({"ATLAS_DASHBOARD": "on"}, {"ATLAS_DASHBOARD": 1})
        env = self.environ(ATLAS_DASHBOARD="off")
        atlas_env.apply_store_env(env)
        self.assertEqual(env["ATLAS_DASHBOARD"], "on")

    def test_missing_changed_is_zero(self):
        self.store({"ATLAS_DASHBOARD": "on"}, {})
        self.settings_at(5000)
        env = self.environ(ATLAS_DASHBOARD="off")
        atlas_env.apply_store_env(env)
        self.assertEqual(env["ATLAS_DASHBOARD"], "off")

    def test_equal_value_not_reported(self):
        self.store({"ATLAS_DASHBOARD": "on"}, {})
        env = self.environ(ATLAS_DASHBOARD="on")
        self.assertEqual(atlas_env.apply_store_env(env), {})

    def test_plugin_options_still_apply(self):
        self.store({}, {})
        env = self.environ(CLAUDE_PLUGIN_OPTION_ATLAS_DECISION="off")
        atlas_env.apply_store_env(env)
        self.assertEqual(env["ATLAS_DECISION"], "off")


if __name__ == "__main__":
    unittest.main()
