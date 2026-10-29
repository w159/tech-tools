"""atlas_doctor display- checks: why the TODO tree, Subagents block, band and status line are missing."""
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import json
import os
import shutil
import tempfile
import unittest

import atlas_doctor as d

HERE = os.path.dirname(os.path.abspath(__file__))
REAL_ROOT = os.path.dirname(HERE)


class DisplayBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.settings = os.path.join(self.tmp, "settings.json")
        self.root = os.path.join(self.tmp, "plugin")
        for rel in ("hooks", "mod", "scripts"):
            os.makedirs(os.path.join(self.root, rel))
        for rel in ("hooks/hooks.json", "hooks/event_dispatch.py", "mod/register.ts", "scripts/atlas_statusline.py"):
            shutil.copy(os.path.join(REAL_ROOT, rel), os.path.join(self.root, rel))

    def write(self, obj):
        with open(self.settings, "w") as f:
            json.dump(obj, f) if not isinstance(obj, str) else f.write(obj)

    def rows(self, env=None):
        out = d.display_checks(self.settings, env or {}, self.root)
        return {r["check"]: r for r in out}

    def fix(self, env=None):
        return d.fix_display(self.settings, env or {}, self.root)

    def read(self):
        with open(self.settings) as f:
            return json.load(f)


class TodoToolsTest(DisplayBase):
    def test_missing_env_flagged_fixed_and_other_keys_kept(self):
        self.write({"model": "opus", "env": {"FOO": "bar"}})
        row = self.rows()["display-todo-tools"]
        self.assertFalse(row["ok"])
        self.assertEqual(row["severity"], "warn")
        self.assertIn("CLAUDE_CODE_ENABLE_TODO_TOOLS", row["detail"])
        self.fix()
        data = self.read()
        self.assertEqual(data["model"], "opus")
        self.assertEqual(data["env"], {"FOO": "bar", "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1"})
        self.assertTrue(self.rows()["display-todo-tools"]["ok"])

    def test_process_env_satisfies_check(self):
        self.write({})
        self.assertTrue(self.rows({"CLAUDE_CODE_ENABLE_TODO_TOOLS": "1"})["display-todo-tools"]["ok"])

    def test_bad_tasks_value_flagged(self):
        self.write({"env": {"CLAUDE_CODE_ENABLE_TODO_TOOLS": "1", "CLAUDE_CODE_ENABLE_TASKS": "maybe"}})
        row = self.rows()["display-todo-tools"]
        self.assertFalse(row["ok"])
        self.assertIn("CLAUDE_CODE_ENABLE_TASKS", row["detail"])

    def test_bad_json_is_not_written(self):
        self.write("{ not json")
        row = self.rows()["display-todo-tools"]
        self.assertFalse(row["ok"])
        self.assertIn("not valid JSON", row["detail"])
        self.assertTrue(self.fix()[0].startswith("SKIP"))
        with open(self.settings) as f:
            self.assertEqual(f.read(), "{ not json")
        self.assertEqual([n for n in os.listdir(self.tmp) if "atlas-tmp" in n], [])


class ModTest(DisplayBase):
    def test_switch_off_flagged_in_settings_and_process_env(self):
        self.write({"env": {"ATLAS_MOD": "off"}})
        row = self.rows()["display-mod"]
        self.assertFalse(row["ok"])
        self.assertIn("ATLAS_MOD=off", row["detail"])
        self.write({})
        self.assertIn("ATLAS_HUD=off", self.rows({"ATLAS_HUD": "off"})["display-mod"]["detail"])
        self.assertTrue(self.rows()["display-mod"]["ok"])

    def test_hooks_without_module_flagged(self):
        p = os.path.join(self.root, "hooks", "hooks.json")
        data = json.load(open(p))
        data.pop("modules")
        json.dump(data, open(p, "w"))
        self.write({})
        row = self.rows()["display-mod"]
        self.assertFalse(row["ok"])
        self.assertIn("../mod/register.ts", row["detail"])

    def test_missing_module_file_flagged(self):
        os.remove(os.path.join(self.root, "mod", "register.ts"))
        self.write({})
        self.assertFalse(self.rows()["display-mod"]["ok"])


class MirrorTest(DisplayBase):
    def test_real_hooks_cover_todo_capture(self):
        self.write({})
        self.assertTrue(self.rows()["display-todo-mirror"]["ok"])

    def test_matcher_missing_todowrite_flagged(self):
        p = os.path.join(self.root, "hooks", "hooks.json")
        data = json.load(open(p))
        for g in data["hooks"]["PostToolUse"]:
            g["matcher"] = g["matcher"].replace("TodoWrite|", "")
        json.dump(data, open(p, "w"))
        self.write({})
        row = self.rows()["display-todo-mirror"]
        self.assertFalse(row["ok"])
        self.assertIn("TodoWrite", row["detail"])


class StatusLineTest(DisplayBase):
    def test_unset_flagged_then_fixed(self):
        self.write({"theme": "dark"})
        self.assertFalse(self.rows()["display-statusline"]["ok"])
        self.fix()
        sl = self.read()["statusLine"]
        self.assertEqual(sl["type"], "command")
        self.assertEqual(sl["command"], 'python3 "%s"' % os.path.join(self.root, "scripts", "atlas_statusline.py"))
        self.assertEqual(self.read()["theme"], "dark")
        self.assertTrue(self.rows()["display-statusline"]["ok"])

    def test_foreign_statusline_warns_and_is_untouched(self):
        foreign = {"type": "command", "command": "~/bin/my-line.sh"}
        self.write({"statusLine": foreign, "env": {"CLAUDE_CODE_ENABLE_TODO_TOOLS": "1"}})
        row = self.rows()["display-statusline"]
        self.assertFalse(row["ok"])
        self.assertEqual(row["severity"], "warn")
        self.fix()
        self.assertEqual(self.read()["statusLine"], foreign)

    def test_stale_atlas_path_repointed(self):
        self.write({"statusLine": {"type": "command", "command": 'python3 "/gone/0.0.1/scripts/atlas_statusline.py"'}})
        self.assertFalse(self.rows()["display-statusline"]["ok"])
        self.fix()
        self.assertTrue(self.rows()["display-statusline"]["ok"])


class HarnessTest(DisplayBase):
    def test_default_is_claude_code(self):
        self.write({})
        row = self.rows()["display-harness"]
        self.assertTrue(row["ok"])
        self.assertEqual(row["detail"], "claude-code")

    def test_omp_reports_bridge(self):
        self.write({})
        omp = os.path.join(self.tmp, "omp")
        os.makedirs(omp)
        old = os.environ.get("ATLAS_OMP_PLUGINS_DIR")
        os.environ["ATLAS_OMP_PLUGINS_DIR"] = omp
        self.addCleanup(lambda: os.environ.pop("ATLAS_OMP_PLUGINS_DIR") if old is None else os.environ.__setitem__("ATLAS_OMP_PLUGINS_DIR", old))
        row = self.rows({"ATLAS_HARNESS": "omp"})["display-harness"]
        self.assertTrue(row["detail"].startswith("omp:"))
        self.assertIn("omp not installed", row["detail"])


if __name__ == "__main__":
    unittest.main()
