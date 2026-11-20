#!/usr/bin/env python3
"""Plugin settings (userConfig) for the decision model, Ollama workers and analytics.

Claude Code exports each plugin userConfig value to the plugin's subprocesses as
CLAUDE_PLUGIN_OPTION_<KEY>; atlas_env maps those onto the ATLAS_* variables the code reads,
without ever overriding a variable the environment already set.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
PLUGIN = SCRIPTS.parent
HOOKS = PLUGIN / "hooks"
sys.path.insert(0, str(SCRIPTS))
import _test_isolation  # noqa: F401,E402
import atlas_env  # noqa: E402
import atlas_provider  # noqa: E402

MANIFEST = json.loads((PLUGIN / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))
USER_CONFIG = MANIFEST["userConfig"]
READERS = {
    "ATLAS_DECISION": HOOKS / "prompt_decision.py",
    "ATLAS_DECISION_URL": HOOKS / "prompt_decision.py",
    "ATLAS_DECISION_MODEL": HOOKS / "prompt_decision.py",
    "ATLAS_DECISION_PROTOCOL": HOOKS / "prompt_decision.py",
    "ATLAS_OLLAMA_URL": SCRIPTS / "atlas_provider.py",
    "ATLAS_OLLAMA_MODEL": SCRIPTS / "atlas_provider.py",
    "ATLAS_OLLAMA_AUTO_ROLES": SCRIPTS / "atlas_provider.py",
    "ATLAS_ANALYTICS": SCRIPTS / "atlas_analytics.py",
}


def _decision_src() -> str:
    return (HOOKS / "prompt_decision.py").read_text(encoding="utf-8")


def _code_default(var: str):
    """The default today's code applies when the variable is unset, as the manifest spells it."""
    src = _decision_src()
    if var == "ATLAS_DECISION":
        # decision_url(): only the literal "off" disables, the get default is "on".
        assert 'os.environ.get("ATLAS_DECISION", "on")' in src
        return True
    if var == "ATLAS_DECISION_URL":
        return re.search(r'^DEFAULT_URL = "([^"]+)"', src, re.M).group(1)
    if var == "ATLAS_DECISION_MODEL":
        # Empty means the protocol's own default model (llama3.2:3b or nimble).
        assert 'os.environ.get("ATLAS_DECISION_MODEL", "").strip()' in src
        return ""
    if var == "ATLAS_DECISION_PROTOCOL":
        return re.search(r'os\.environ\.get\("ATLAS_DECISION_PROTOCOL", "([^"]+)"\)', src).group(1)
    if var == "ATLAS_OLLAMA_URL":
        return atlas_provider.ollama_url({})
    if var == "ATLAS_OLLAMA_MODEL":
        return atlas_provider.model_for_role("explorer", {}) or ""
    if var == "ATLAS_OLLAMA_AUTO_ROLES":
        return ",".join(atlas_provider.auto_roles({}))
    if var == "ATLAS_ANALYTICS":
        return True  # atlas_analytics.state(): "on by default"
    raise AssertionError(var)


class ManifestOptions(unittest.TestCase):
    def test_every_option_has_a_known_variable(self):
        keys = {k for k in USER_CONFIG if k != "atlas_mod_sound"}
        self.assertEqual(keys, {key for key, _ in atlas_env.PLUGIN_OPTIONS})
        self.assertEqual({var for _, var in atlas_env.PLUGIN_OPTIONS}, set(READERS))

    def test_every_variable_is_read_by_the_code(self):
        for _, var in atlas_env.PLUGIN_OPTIONS:
            self.assertIn('"%s"' % var, READERS[var].read_text(encoding="utf-8"), var)

    def test_option_shape(self):
        for key, _ in atlas_env.PLUGIN_OPTIONS:
            opt = USER_CONFIG[key]
            self.assertIn(opt["type"], ("string", "boolean"))
            self.assertTrue(opt["title"])
            self.assertIn("efault", opt["description"], key)

    def test_manifest_default_equals_code_default(self):
        for key, var in atlas_env.PLUGIN_OPTIONS:
            self.assertEqual(USER_CONFIG[key]["default"], _code_default(var), key)

    def test_version(self):
        self.assertEqual(MANIFEST["version"], "17.34.0")


def _home() -> str:
    return tempfile.mkdtemp()


class OptionMapping(unittest.TestCase):
    def test_exported_option_sets_variable(self):
        env = {"ATLAS_HOME": _home(), "CLAUDE_PLUGIN_OPTION_ATLAS_DECISION_MODEL": "qwen3:4b"}
        atlas_env.apply_store_env(env)
        self.assertEqual(env["ATLAS_DECISION_MODEL"], "qwen3:4b")

    def test_boolean_off_maps_to_off(self):
        for raw in ("false", "0", "off"):
            env = {
                "ATLAS_HOME": _home(),
                "CLAUDE_PLUGIN_OPTION_ATLAS_DECISION": raw,
                "CLAUDE_PLUGIN_OPTION_ATLAS_ANALYTICS": raw,
            }
            atlas_env.apply_store_env(env)
            self.assertEqual(env["ATLAS_DECISION"], "off")
            self.assertEqual(env["ATLAS_ANALYTICS"], "off")

    def test_explicit_environment_wins(self):
        env = {
            "ATLAS_HOME": _home(),
            "ATLAS_DECISION_MODEL": "mine",
            "CLAUDE_PLUGIN_OPTION_ATLAS_DECISION_MODEL": "qwen3:4b",
        }
        atlas_env.apply_store_env(env)
        self.assertEqual(env["ATLAS_DECISION_MODEL"], "mine")

    def test_empty_or_default_option_changes_nothing(self):
        env = {"ATLAS_HOME": _home()}
        for key, _ in atlas_env.PLUGIN_OPTIONS:
            default = USER_CONFIG[key]["default"]
            env["CLAUDE_PLUGIN_OPTION_" + key.upper()] = (
                str(default).lower() if isinstance(default, bool) else default
            )
        env["CLAUDE_PLUGIN_OPTION_ATLAS_OLLAMA_MODEL"] = "  "
        before = dict(env)
        atlas_env.apply_store_env(env)
        self.assertEqual(env, before)

    def test_store_return_value_unchanged(self):
        env = {"ATLAS_HOME": _home(), "CLAUDE_PLUGIN_OPTION_ATLAS_DECISION_MODEL": "x"}
        self.assertEqual(atlas_env.apply_store_env(env), {})


def _show(extra: dict) -> str:
    env = {k: v for k, v in os.environ.items() if not k.startswith(("ATLAS_", "CLAUDE_PLUGIN_OPTION_"))}
    env["ATLAS_HOME"] = _home()
    env.update(extra)
    out = subprocess.run(
        [sys.executable, str(SCRIPTS / "atlas_settings.py"), "show"],
        capture_output=True, text=True, env=env, timeout=30, check=True,
    )
    return out.stdout


def _line(out: str, var: str) -> str:
    return next(line for line in out.splitlines() if line.split()[:1] == [var])


class ShowCommand(unittest.TestCase):
    def test_show_names_the_source(self):
        out = _show({
            "CLAUDE_PLUGIN_OPTION_ATLAS_DECISION_MODEL": "qwen3:4b",
            "ATLAS_OLLAMA_MODEL": "llama3.2:3b",
        })
        self.assertIn("qwen3:4b", _line(out, "ATLAS_DECISION_MODEL"))
        self.assertIn("plugin setting", _line(out, "ATLAS_DECISION_MODEL"))
        self.assertIn("environment", _line(out, "ATLAS_OLLAMA_MODEL"))
        self.assertIn("default", _line(out, "ATLAS_DECISION_PROTOCOL"))
        self.assertIn("auto", _line(out, "ATLAS_DECISION_PROTOCOL"))

    def test_show_never_prints_url_credentials(self):
        out = _show({"ATLAS_OLLAMA_URL": "http://user:s3cret@127.0.0.1:11434"})
        self.assertNotIn("s3cret", out)


if __name__ == "__main__":
    unittest.main()
