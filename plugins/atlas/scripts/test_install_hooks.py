#!/usr/bin/env python3
"""Tests for install_hooks.py.

Imports the script in-process so coverage traces the real code paths.
Covers every branch: happy paths, error/except branches, argument
validation, empty/missing inputs, and edge cases. File IO uses small temp
dirs so no real installed paths are touched.
"""

import datetime as _dt
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

# Import the script in-process so its real lines are traced.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import install_hooks  # noqa: E402


class TestDefaultsAndSpecs(unittest.TestCase):
    def test_default_selection_excludes_opt_in(self) -> None:
        sel = install_hooks.default_selection()
        self.assertNotIn("completion-gate", sel)
        self.assertIn("optimizer", sel)
        self.assertIn("format", sel)
        self.assertIn("guard", sel)

    def test_command_for_uses_hooks_dir(self) -> None:
        cmd = install_hooks.command_for("prompt_optimizer.py")
        self.assertIn("prompt_optimizer.py", cmd)
        self.assertTrue(cmd.startswith('python3 "'))
        self.assertIn(str(install_hooks.HOOKS_DIR), cmd)

    def test_hook_specs_shape(self) -> None:
        for hid, spec in install_hooks.HOOK_SPECS.items():
            self.assertEqual(len(spec), 4, f"{hid} spec must be a 4-tuple")
            event, matcher, script, extra = spec
            self.assertIsInstance(event, str)
            self.assertIsInstance(script, str)
            self.assertTrue(script.endswith(".py"))
            self.assertIsInstance(extra, dict)

    def test_opt_in_subset_of_specs(self) -> None:
        self.assertTrue(install_hooks.OPT_IN.issubset(install_hooks.HOOK_SPECS))


class TestLoadSettings(unittest.TestCase):
    def test_missing_source_surfaces_error(self) -> None:
        """A missing source file must surface a non-empty error, not return {}.

        Defect M19: when the source file is missing the loader returned {} with
        no error, so a caller could mistake the empty dict for a successful read.
        """
        missing = Path(__file__).resolve().parent / "definitely_missing_settings.json"
        self.assertFalse(missing.is_file(), "fixture path must not exist")

        with self.assertRaises(SystemExit) as ctx:
            install_hooks.load_settings(missing)

        self.assertTrue(
            str(ctx.exception).strip(),
            "error message surfaced to the caller must be non-empty",
        )

    def test_valid_json_returns_dict(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "settings.json"
            p.write_text('{"hooks": {"Stop": []}}', encoding="utf-8")
            result = install_hooks.load_settings(p)
        self.assertEqual(result, {"hooks": {"Stop": []}})

    def test_invalid_json_surfaces_error(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "settings.json"
            p.write_text("{not valid json", encoding="utf-8")
            with self.assertRaises(SystemExit) as ctx:
                install_hooks.load_settings(p)
        self.assertIn("not valid JSON", str(ctx.exception))


class TestHasHook(unittest.TestCase):
    def test_absent_event(self) -> None:
        self.assertFalse(install_hooks.has_hook({}, "Stop", "completion_gate.py"))

    def test_present(self) -> None:
        settings = {
            "hooks": {
                "Stop": [
                    {
                        "hooks": [
                            {
                                "type": "command",
                                "command": 'python3 "x/completion_gate.py"',
                            }
                        ]
                    }
                ]
            }
        }
        self.assertTrue(install_hooks.has_hook(settings, "Stop", "completion_gate.py"))

    def test_absent_script(self) -> None:
        settings = {
            "hooks": {
                "Stop": [
                    {"hooks": [{"type": "command", "command": 'python3 "x/other.py"'}]}
                ]
            }
        }
        self.assertFalse(install_hooks.has_hook(settings, "Stop", "completion_gate.py"))

    def test_empty_command_field(self) -> None:
        settings = {
            "hooks": {"Stop": [{"hooks": [{"type": "command", "command": None}]}]}
        }
        # h.get("command") or "" must not blow up on None
        self.assertFalse(install_hooks.has_hook(settings, "Stop", "completion_gate.py"))


class TestPlan(unittest.TestCase):
    def test_install_action_for_missing(self) -> None:
        plan = install_hooks.plan({}, ["optimizer"])
        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0]["action"], "install")
        self.assertEqual(plan[0]["id"], "optimizer")

    def test_present_action_for_existing(self) -> None:
        settings = {
            "hooks": {
                "UserPromptSubmit": [
                    {"hooks": [{"command": 'python3 "x/prompt_optimizer.py"'}]}
                ]
            }
        }
        plan = install_hooks.plan(settings, ["optimizer"])
        self.assertEqual(plan[0]["action"], "present")


class TestApplyInstall(unittest.TestCase):
    def test_installs_with_matcher(self) -> None:
        settings: dict = {}
        n = install_hooks.apply_install(settings, ["format"])
        self.assertEqual(n, 1)
        groups = settings["hooks"]["PostToolUse"]
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["matcher"], "Edit|Write|MultiEdit")
        cmd = groups[0]["hooks"][0]["command"]
        self.assertIn("format_after_edit.py", cmd)
        self.assertTrue(groups[0]["hooks"][0]["async"])
        self.assertEqual(groups[0]["hooks"][0]["timeout"], 60)

    def test_installs_without_matcher(self) -> None:
        settings: dict = {}
        n = install_hooks.apply_install(settings, ["optimizer"])
        self.assertEqual(n, 1)
        groups = settings["hooks"]["UserPromptSubmit"]
        self.assertNotIn("matcher", groups[0])
        self.assertEqual(groups[0]["hooks"][0]["timeout"], 120)

    def test_installs_completion_gate(self) -> None:
        settings: dict = {}
        n = install_hooks.apply_install(settings, ["completion-gate"])
        self.assertEqual(n, 1)
        self.assertIn("Stop", settings["hooks"])

    def test_skips_already_installed(self) -> None:
        settings = {
            "hooks": {
                "UserPromptSubmit": [
                    {"hooks": [{"command": 'python3 "x/prompt_optimizer.py"'}]}
                ]
            }
        }
        n = install_hooks.apply_install(settings, ["optimizer"])
        self.assertEqual(n, 0)
        # only the one pre-existing group remains
        self.assertEqual(len(settings["hooks"]["UserPromptSubmit"]), 1)

    def test_multiple_selected_mixed(self) -> None:
        settings = {
            "hooks": {
                "UserPromptSubmit": [
                    {"hooks": [{"command": 'python3 "x/prompt_optimizer.py"'}]}
                ]
            }
        }
        n = install_hooks.apply_install(settings, ["optimizer", "guard"])
        self.assertEqual(n, 1)  # optimizer already present, guard newly added
        self.assertIn("PreToolUse", settings["hooks"])


class TestApplyUninstall(unittest.TestCase):
    def test_removes_handler_and_drops_emptied_group(self) -> None:
        settings = {
            "hooks": {
                "Stop": [{"hooks": [{"command": 'python3 "x/completion_gate.py"'}]}]
            }
        }
        n = install_hooks.apply_uninstall(settings, ["completion-gate"])
        self.assertEqual(n, 1)
        # emptied group is dropped entirely
        self.assertNotIn("Stop", settings["hooks"])

    def test_keeps_partial_group(self) -> None:
        settings = {
            "hooks": {
                "Stop": [
                    {
                        "hooks": [
                            {"command": 'python3 "x/completion_gate.py"'},
                            {"command": 'python3 "x/other.py"'},
                        ]
                    }
                ]
            }
        }
        n = install_hooks.apply_uninstall(settings, ["completion-gate"])
        self.assertEqual(n, 1)
        kept = settings["hooks"]["Stop"][0]["hooks"]
        self.assertEqual(len(kept), 1)
        self.assertIn("other.py", kept[0]["command"])

    def test_no_groups_for_event(self) -> None:
        settings: dict = {"hooks": {}}
        n = install_hooks.apply_uninstall(settings, ["optimizer"])
        self.assertEqual(n, 0)

    def test_absent_event(self) -> None:
        settings: dict = {}
        n = install_hooks.apply_uninstall(settings, ["optimizer"])
        self.assertEqual(n, 0)

    def test_no_match_in_groups(self) -> None:
        settings = {
            "hooks": {
                "UserPromptSubmit": [
                    {"hooks": [{"command": 'python3 "x/unrelated.py"'}]}
                ]
            }
        }
        n = install_hooks.apply_uninstall(settings, ["optimizer"])
        self.assertEqual(n, 0)
        # unrelated group untouched
        self.assertEqual(len(settings["hooks"]["UserPromptSubmit"][0]["hooks"]), 1)


class TestCmdList(unittest.TestCase):
    def test_lists_installed_and_not(self) -> None:
        settings = {
            "hooks": {
                "UserPromptSubmit": [
                    {"hooks": [{"command": 'python3 "x/prompt_optimizer.py"'}]}
                ]
            }
        }
        buf = io.StringIO()
        with redirect_stdout(buf):
            install_hooks.cmd_list(settings)
        out = buf.getvalue()
        self.assertIn("atlas hook coverage:", out)
        self.assertIn("[x] installed", out)
        self.assertIn("- not installed", out)

    def test_lists_other_hooks(self) -> None:
        settings = {
            "hooks": {
                "Stop": [{"hooks": [{"command": 'python3 "x/some_other_hook.py"'}]}]
            }
        }
        buf = io.StringIO()
        with redirect_stdout(buf):
            install_hooks.cmd_list(settings)
        out = buf.getvalue()
        self.assertIn("other hooks already configured:", out)
        self.assertIn("some_other_hook.py", out)


class TestBackupAndWrite(unittest.TestCase):
    def test_creates_parent_and_writes_new_file(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "nested" / "settings.json"
            install_hooks._backup_and_write(p, {"hooks": {}})
            self.assertTrue(p.is_file())
            data = json.loads(p.read_text(encoding="utf-8"))
            self.assertEqual(data, {"hooks": {}})

    def test_backs_up_existing_file(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "settings.json"
            original = '{"hooks": {"old": []}}'
            p.write_text(original, encoding="utf-8")
            # freeze the timestamp so the backup name is deterministic
            frozen = _dt.datetime(2026, 1, 2, 3, 4, 5)
            with mock.patch("install_hooks._dt.datetime") as m_dt:
                m_dt.now.return_value = frozen
                install_hooks._backup_and_write(p, {"hooks": {"new": []}})
            backup = p.with_name("settings.json.backup-20260102-030405")
            self.assertTrue(backup.is_file())
            self.assertEqual(backup.read_text(encoding="utf-8"), original)
            data = json.loads(p.read_text(encoding="utf-8"))
            self.assertEqual(data, {"hooks": {"new": []}})


class TestMain(unittest.TestCase):
    """Drive main() through every CLI branch with mocked inputs."""

    def _run_main(self, argv: list[str]) -> tuple[int, str]:
        buf = io.StringIO()
        with mock.patch.object(sys, "argv", ["install_hooks.py", *argv]):
            with redirect_stdout(buf):
                rc = install_hooks.main()
        return rc, buf.getvalue()

    def test_missing_hooks_dir_errors(self) -> None:
        with mock.patch.object(
            install_hooks, "HOOKS_DIR", Path("/nonexistent/atlas/hooks")
        ):
            with mock.patch.object(sys, "argv", ["install_hooks.py"]):
                with self.assertRaises(SystemExit) as ctx:
                    install_hooks.main()
        self.assertIn("hooks dir not found", str(ctx.exception))

    def test_list_with_settings_file(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "settings.json"
            p.write_text('{"hooks": {}}', encoding="utf-8")
            rc, out = self._run_main(["--settings", str(p), "--list"])
        self.assertEqual(rc, 0)
        self.assertIn("atlas hook coverage:", out)
        self.assertIn("settings:", out)

    def test_list_fresh_missing_settings(self) -> None:
        # missing settings file is a valid fresh-install starting point for --list
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "absent_settings.json"
            rc, out = self._run_main(["--settings", str(p), "--list"])
        self.assertEqual(rc, 0)
        self.assertIn("atlas hook coverage:", out)

    def test_dry_run_install(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "settings.json"
            p.write_text('{"hooks": {}}', encoding="utf-8")
            rc, out = self._run_main(["--settings", str(p)])
        self.assertEqual(rc, 0)
        self.assertIn("INSTALL", out)
        self.assertIn("(dry-run)", out)

    def test_apply_install_writes_file(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "settings.json"
            p.write_text('{"hooks": {}}', encoding="utf-8")
            rc, out = self._run_main(["--settings", str(p), "--apply"])
            data = json.loads(p.read_text(encoding="utf-8"))
        self.assertEqual(rc, 0)
        self.assertIn("UserPromptSubmit", data["hooks"])
        self.assertIn("PostToolUse", data["hooks"])
        self.assertIn("PreToolUse", data["hooks"])
        self.assertIn("installed", out)

    def test_apply_install_all_present_no_change(self) -> None:
        # pre-install all default hooks so --apply is a no-op
        settings: dict = {"hooks": {}}
        install_hooks.apply_install(settings, install_hooks.default_selection())
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "settings.json"
            p.write_text(json.dumps(settings), encoding="utf-8")
            rc, out = self._run_main(["--settings", str(p), "--apply"])
            data = json.loads(p.read_text(encoding="utf-8"))
        self.assertEqual(rc, 0)
        self.assertIn("already installed - no change", out)
        # file content unchanged
        self.assertEqual(data, settings)

    def test_apply_install_specific_select(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "settings.json"
            p.write_text('{"hooks": {}}', encoding="utf-8")
            rc, out = self._run_main(
                ["--settings", str(p), "--select", "optimizer", "--apply"]
            )
            data = json.loads(p.read_text(encoding="utf-8"))
        self.assertEqual(rc, 0)
        self.assertIn("UserPromptSubmit", data["hooks"])
        self.assertNotIn("PreToolUse", data["hooks"])
        self.assertNotIn("PostToolUse", data["hooks"])

    def test_uninstall_dry_run(self) -> None:
        settings: dict = {"hooks": {}}
        install_hooks.apply_install(settings, install_hooks.default_selection())
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "settings.json"
            p.write_text(json.dumps(settings), encoding="utf-8")
            rc, out = self._run_main(["--settings", str(p), "--uninstall"])
        self.assertEqual(rc, 0)
        self.assertIn("REMOVE", out)
        self.assertIn("(dry-run)", out)

    def test_uninstall_apply_removes(self) -> None:
        settings: dict = {"hooks": {}}
        install_hooks.apply_install(settings, install_hooks.default_selection())
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "settings.json"
            p.write_text(json.dumps(settings), encoding="utf-8")
            rc, out = self._run_main(["--settings", str(p), "--uninstall", "--apply"])
            data = json.loads(p.read_text(encoding="utf-8"))
        self.assertEqual(rc, 0)
        self.assertIn("removed", out)
        # all default hooks gone
        self.assertEqual(data.get("hooks", {}), {})

    def test_uninstall_apply_nothing_to_remove(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "settings.json"
            p.write_text('{"hooks": {}}', encoding="utf-8")
            rc, out = self._run_main(["--settings", str(p), "--uninstall", "--apply"])
        self.assertEqual(rc, 0)
        self.assertIn("nothing to remove", out)

    def test_uninstall_apply_specific_select(self) -> None:
        settings: dict = {"hooks": {}}
        install_hooks.apply_install(settings, ["optimizer", "guard"])
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "settings.json"
            p.write_text(json.dumps(settings), encoding="utf-8")
            rc, out = self._run_main(
                [
                    "--settings",
                    str(p),
                    "--select",
                    "optimizer",
                    "--uninstall",
                    "--apply",
                ]
            )
            data = json.loads(p.read_text(encoding="utf-8"))
        self.assertEqual(rc, 0)
        self.assertNotIn("UserPromptSubmit", data.get("hooks", {}))
        self.assertIn("PreToolUse", data["hooks"])

    def test_invalid_select_choice_rejected(self) -> None:
        # argparse rejects unknown --select choices with SystemExit(2)
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "settings.json"
            p.write_text('{"hooks": {}}', encoding="utf-8")
            with mock.patch.object(
                sys,
                "argv",
                ["install_hooks.py", "--settings", str(p), "--select", "bogus"],
            ):
                with self.assertRaises(SystemExit):
                    install_hooks.main()

    def test_invalid_json_settings_errors(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "settings.json"
            p.write_text("{bad json", encoding="utf-8")
            with self.assertRaises(SystemExit) as ctx:
                self._run_main(["--settings", str(p)])
        self.assertIn("not valid JSON", str(ctx.exception))

    def test_fresh_install_writes_new_file(self) -> None:
        # missing settings file: main() starts from {} then --apply creates it
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "fresh.json"
            self.assertFalse(p.is_file())
            rc, out = self._run_main(["--settings", str(p), "--apply"])
            data = json.loads(p.read_text(encoding="utf-8"))
        self.assertEqual(rc, 0)
        self.assertIn("UserPromptSubmit", data["hooks"])
        self.assertIn("installed", out)


if __name__ == "__main__":
    unittest.main()
