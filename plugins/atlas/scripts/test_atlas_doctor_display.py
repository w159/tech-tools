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


BOTH = {"CLAUDE_CODE_ENABLE_TODO_TOOLS": "1", "CLAUDE_CODE_ENABLE_TASKS": "0"}


class TodoToolsTest(DisplayBase):
    def test_missing_env_flagged_fixed_and_other_keys_kept(self):
        self.write({"model": "opus", "env": {"FOO": "bar"}})
        row = self.rows()["display-todo-tools"]
        self.assertFalse(row["ok"])
        self.assertEqual(row["severity"], "warn")
        self.assertIn("CLAUDE_CODE_ENABLE_TODO_TOOLS", row["detail"])
        self.assertIn("CLAUDE_CODE_ENABLE_TASKS", row["detail"])
        self.fix()
        data = self.read()
        self.assertEqual(data["model"], "opus")
        self.assertEqual(data["env"], dict(BOTH, FOO="bar"))
        self.assertTrue(self.rows()["display-todo-tools"]["ok"])

    def test_only_todo_tools_warns_about_tasks(self):
        self.write({"env": {"CLAUDE_CODE_ENABLE_TODO_TOOLS": "1"}})
        row = self.rows()["display-todo-tools"]
        self.assertFalse(row["ok"])
        self.assertIn("CLAUDE_CODE_ENABLE_TASKS is not 0", row["detail"])
        self.assertNotIn("TODO_TOOLS is not 1", row["detail"])
        self.fix()
        self.assertEqual(self.read()["env"], BOTH)

    def test_tasks_one_warns_and_fix_flips_to_zero(self):
        self.write({"env": {"CLAUDE_CODE_ENABLE_TODO_TOOLS": "1", "CLAUDE_CODE_ENABLE_TASKS": "1"}})
        self.assertFalse(self.rows()["display-todo-tools"]["ok"])
        self.fix()
        self.assertEqual(self.read()["env"], BOTH)

    def test_tasks_only_warns_about_todo_tools(self):
        self.write({"env": {"CLAUDE_CODE_ENABLE_TASKS": "0"}})
        row = self.rows()["display-todo-tools"]
        self.assertFalse(row["ok"])
        self.assertIn("CLAUDE_CODE_ENABLE_TODO_TOOLS is not 1", row["detail"])

    def test_both_pass(self):
        self.write({"env": dict(BOTH)})
        self.assertTrue(self.rows()["display-todo-tools"]["ok"])
        self.fix()
        self.assertEqual(self.read()["env"], BOTH)

    def test_process_env_satisfies_check(self):
        self.write({})
        self.assertTrue(self.rows(dict(BOTH))["display-todo-tools"]["ok"])
        self.assertFalse(self.rows({"CLAUDE_CODE_ENABLE_TODO_TOOLS": "1"})["display-todo-tools"]["ok"])

    def test_settings_env_wins_over_process_env(self):
        self.write({"env": {"CLAUDE_CODE_ENABLE_TASKS": "1", "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1"}})
        self.assertFalse(self.rows(dict(BOTH))["display-todo-tools"]["ok"])

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

    def test_only_exact_off_is_flagged(self):
        for val in ("0", "false", "OFF", "no"):
            self.write({"env": {"ATLAS_MOD": val, "ATLAS_HUD": val}})
            self.assertTrue(self.rows()["display-mod"]["ok"], val)
            self.assertTrue(self.rows({"ATLAS_MOD": val})["display-mod"]["ok"], val)
        self.write({"env": {"ATLAS_MOD": "off"}})
        self.assertFalse(self.rows()["display-mod"]["ok"])
        self.write({})
        self.assertFalse(self.rows({"ATLAS_HUD": "off"})["display-mod"]["ok"])

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
        self.assertEqual(sl["refreshInterval"], 5)
        self.assertEqual(sl["command"], 'python3 "%s"' % os.path.join(self.root, "scripts", "atlas_statusline.py"))
        self.assertEqual(self.read()["theme"], "dark")
        self.assertTrue(self.rows()["display-statusline"]["ok"])

    def test_foreign_statusline_warns_and_is_untouched(self):
        foreign = {"type": "command", "command": "~/bin/my-line.sh"}
        self.write({"statusLine": foreign, "env": dict(BOTH)})
        row = self.rows()["display-statusline"]
        self.assertFalse(row["ok"])
        self.assertEqual(row["severity"], "warn")
        self.fix()
        self.assertEqual(self.read()["statusLine"], foreign)

    def test_live_atlas_line_gains_refresh_interval_and_keeps_user_keys(self):
        script = os.path.join(self.root, "scripts", "atlas_statusline.py")
        self.write({"statusLine": {"type": "command", "command": 'python3 "%s"' % script, "padding": 2}})
        self.fix()
        sl = self.read()["statusLine"]
        self.assertEqual((sl["refreshInterval"], sl["padding"]), (5, 2))

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


class OmpTodoTest(DisplayBase):
    def setUp(self):
        super().setUp()
        self.agent = os.path.join(self.tmp, "omp-agent")
        self.proj = os.path.join(self.tmp, "proj")
        os.makedirs(self.agent)
        os.makedirs(os.path.join(self.proj, ".omp"))
        self.write({})

    def rows(self, env=None):
        out = d.display_checks(self.settings, env or {}, self.root, project_dir=self.proj, omp_agent_dir=self.agent)
        return {r["check"]: r for r in out}

    def fix(self, env=None):
        return d.fix_display(self.settings, env or {}, self.root, project_dir=self.proj, omp_agent_dir=self.agent)

    def put(self, rel, text):
        fp = os.path.join(self.agent if not rel.startswith("proj/") else self.proj, rel.replace("proj/", ""))
        with open(fp, "w") as f:
            f.write(text)
        return fp

    def text(self, fp):
        with open(fp) as f:
            return f.read()

    def test_no_settings_file_is_na(self):
        row = self.rows()["display-omp-todo"]
        self.assertTrue(row["ok"])
        self.assertIn("n/a", row["detail"])

    def test_enabled_or_unset_passes(self):
        self.put("config.yml", "todo:\n  enabled: true\n")
        self.assertTrue(self.rows()["display-omp-todo"]["ok"])
        self.put("config.yml", "theme: dark\n")
        self.assertTrue(self.rows()["display-omp-todo"]["ok"])

    def test_user_yaml_block_false_warns_and_fix_keeps_rest(self):
        text = "# my omp\ntheme: dark\ntodo:\n  enabled: false  # off for now\n  reminders: true\nother: 1\n"
        fp = self.put("config.yml", text)
        row = self.rows()["display-omp-todo"]
        self.assertFalse(row["ok"])
        self.assertEqual(row["severity"], "warn")
        self.assertIn(fp, row["detail"])
        self.fix()
        self.assertEqual(self.text(fp), text.replace("enabled: false", "enabled: true"))
        self.assertTrue(self.rows()["display-omp-todo"]["ok"])

    def test_flat_dotted_and_inline_yaml_forms(self):
        fp = self.put("config.yml", 'a: 1\n"todo.enabled": false\n')
        self.assertFalse(self.rows()["display-omp-todo"]["ok"])
        self.fix()
        self.assertEqual(self.text(fp), 'a: 1\n"todo.enabled": true\n')
        fp = self.put("config.yml", "todo: {enabled: no}\n")
        self.assertFalse(self.rows()["display-omp-todo"]["ok"])
        self.fix()
        self.assertTrue(self.rows()["display-omp-todo"]["ok"])

    def test_project_json_false_warns_and_fix_sets_true(self):
        fp = self.put("proj/.omp/settings.json", json.dumps({"x": 1, "todo": {"enabled": False, "reminders": False}}))
        self.assertFalse(self.rows()["display-omp-todo"]["ok"])
        self.fix()
        self.assertEqual(json.load(open(fp)), {"x": 1, "todo": {"enabled": True, "reminders": False}})
        self.assertTrue(self.rows()["display-omp-todo"]["ok"])

    def test_project_claude_settings_false_warns(self):
        os.makedirs(os.path.join(self.proj, ".claude"))
        fp = self.put("proj/.claude/settings.json", json.dumps({"todo.enabled": False}))
        self.assertFalse(self.rows()["display-omp-todo"]["ok"])
        self.fix()
        self.assertEqual(json.load(open(fp)), {"todo.enabled": True})

    def test_project_true_overrides_user_false(self):
        self.put("config.yml", "todo:\n  enabled: false\n")
        self.put("proj/.omp/config.yml", "todo:\n  enabled: true\n")
        self.assertTrue(self.rows()["display-omp-todo"]["ok"])

    def test_user_false_project_unset_warns(self):
        self.put("config.yml", "todo:\n  enabled: false\n")
        self.put("proj/.omp/config.yml", "theme: dark\n")
        self.assertFalse(self.rows()["display-omp-todo"]["ok"])


class HudTest(DisplayBase):
    def setUp(self):
        super().setUp()
        self.proj = os.path.join(self.tmp, "proj")
        os.makedirs(os.path.join(self.proj, ".claude"))

    def rows(self, env=None, term_rows=None):
        out = d.display_checks(self.settings, env or {}, self.root, project_dir=self.proj,
                               omp_agent_dir=os.path.join(self.tmp, "none"), term_rows=term_rows)
        return {r["check"]: r for r in out}

    def fix(self, env=None):
        return d.fix_display(self.settings, env or {}, self.root, project_dir=self.proj,
                             omp_agent_dir=os.path.join(self.tmp, "none"))

    def test_clean_passes(self):
        self.write({"env": {"ATLAS_HUD": "on", "FOO": "bar"}})
        self.assertTrue(self.rows()["display-hud"]["ok"])

    def test_user_off_warns_and_fix_removes_only_that_key(self):
        self.write({"model": "opus", "env": {"ATLAS_HUD": "off", "FOO": "bar"}})
        row = self.rows()["display-hud"]
        self.assertFalse(row["ok"])
        self.assertEqual(row["severity"], "warn")
        self.assertIn("ATLAS_HUD=off", row["detail"])
        self.fix()
        data = self.read()
        self.assertEqual(data["model"], "opus")
        self.assertEqual(data["env"]["FOO"], "bar")
        self.assertNotIn("ATLAS_HUD", data["env"])
        self.assertTrue(self.rows()["display-hud"]["ok"])

    def test_project_settings_and_local_off(self):
        self.write({})
        for name in ("settings.json", "settings.local.json"):
            with open(os.path.join(self.proj, ".claude", name), "w") as f:
                json.dump({"env": {"ATLAS_HUD": "off"}}, f)
        self.assertFalse(self.rows()["display-hud"]["ok"])
        self.fix()
        self.assertTrue(self.rows()["display-hud"]["ok"])
        for name in ("settings.json", "settings.local.json"):
            self.assertNotIn("ATLAS_HUD", json.load(open(os.path.join(self.proj, ".claude", name))).get("env", {}))

    def test_values_register_ts_ignores_are_not_flagged(self):
        # register.ts hides the HUD only when ATLAS_HUD === 'off'; these leave it on.
        for val in ("0", "false", "no", "OFF", "Off", " off"):
            self.write({"env": {"ATLAS_HUD": val}})
            self.assertTrue(self.rows()["display-hud"]["ok"], val)
            self.fix()
            self.assertEqual(self.read()["env"]["ATLAS_HUD"], val)

    def test_short_terminal_is_info_only(self):
        self.write({})
        row = self.rows(term_rows=20)["display-hud"]
        self.assertTrue(row["ok"])
        self.assertIn("INFO: terminal is 20 rows", row["detail"])
        self.assertNotIn("INFO", self.rows(term_rows=40)["display-hud"]["detail"])
        self.assertNotIn("INFO", self.rows(term_rows=None)["display-hud"]["detail"])


class RendererTest(HudTest):
    """display-renderer: Claude Code's fullscreen renderer caps everything under the transcript at half the screen."""

    def local(self):
        return os.path.join(self.proj, ".claude", "settings.local.json")

    def put(self, path, obj):
        with open(path, "w") as f:
            json.dump(obj, f)

    def test_unset_passes(self):
        self.write({"model": "opus"})
        row = self.rows()["display-renderer"]
        self.assertTrue(row["ok"])
        self.assertEqual(row["severity"], "warn")

    def test_user_fullscreen_warns_and_fix_sets_default(self):
        self.write({"model": "opus", "tui": "fullscreen"})
        row = self.rows()["display-renderer"]
        self.assertFalse(row["ok"])
        self.assertIn("half", row["detail"])
        self.assertIn("/tui fullscreen", row["detail"])
        self.assertIn(self.settings, row["detail"])
        self.fix()
        data = self.read()
        self.assertEqual((data["model"], data["tui"]), ("opus", "default"))
        row = self.rows()["display-renderer"]
        self.assertTrue(row["ok"])
        self.assertIn(self.settings, row["detail"])

    def test_local_fullscreen_over_user_default_edits_local_layer(self):
        self.write({"tui": "default"})
        self.put(self.local(), {"tui": "fullscreen", "x": 1})
        row = self.rows()["display-renderer"]
        self.assertFalse(row["ok"])
        self.assertIn("settings.local.json", row["detail"])
        self.fix()
        with open(self.local()) as f:
            self.assertEqual(json.load(f), {"tui": "default", "x": 1})
        self.assertEqual(self.read()["tui"], "default")
        self.assertTrue(self.rows()["display-renderer"]["ok"])

    def test_env_no_flicker_warns_and_fix_leaves_files(self):
        self.write({"model": "opus"})
        env = {"CLAUDE_CODE_NO_FLICKER": "1"}
        row = self.rows(env)["display-renderer"]
        self.assertFalse(row["ok"])
        self.assertIn("CLAUDE_CODE_NO_FLICKER", row["detail"])
        self.fix(env)
        self.assertNotIn("tui", self.read())
        self.assertFalse(self.rows(env)["display-renderer"]["ok"])

    def test_no_flicker_zero_overrides_fullscreen_setting(self):
        self.write({"tui": "fullscreen"})
        self.assertTrue(self.rows({"CLAUDE_CODE_NO_FLICKER": "0"})["display-renderer"]["ok"])
        self.assertTrue(self.rows({"CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN": "1"})["display-renderer"]["ok"])


class TodoToolsWhyTest(DisplayBase):
    def test_message_says_why(self):
        self.write({})
        detail = self.rows()["display-todo-tools"]["detail"]
        self.assertIn("draws its own checklist above the prompt", detail)
        self.assertIn("Subagents block", detail)


if __name__ == "__main__":
    unittest.main()
