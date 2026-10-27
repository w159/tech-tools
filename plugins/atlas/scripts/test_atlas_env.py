#!/usr/bin/env python3
"""atlas_env.apply_store_env: hooks read dashboard-saved knobs on every run."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_env  # noqa: E402

HOOKS = SCRIPTS.parent / "hooks"


def _home(env_block=None, raw=None):
    d = tempfile.mkdtemp()
    if raw is not None:
        (Path(d) / "settings.json").write_text(raw)
    elif env_block is not None:
        (Path(d) / "settings.json").write_text(json.dumps({"env": env_block}))
    return d


class ApplyStoreEnv(unittest.TestCase):
    def test_store_value_overrides_inherited(self):
        env = {"ATLAS_HOME": _home({"ATLAS_X": "off"}), "ATLAS_X": "on"}
        atlas_env.apply_store_env(env)
        self.assertEqual(env["ATLAS_X"], "off")

    def test_missing_file_is_noop(self):
        env = {"ATLAS_HOME": _home(), "ATLAS_X": "on"}
        atlas_env.apply_store_env(env)
        self.assertEqual(env["ATLAS_X"], "on")

    def test_bad_json_is_noop(self):
        env = {"ATLAS_HOME": _home(raw="{nope"), "ATLAS_X": "on"}
        atlas_env.apply_store_env(env)
        self.assertEqual(env["ATLAS_X"], "on")

    def test_non_dict_is_noop(self):
        env = {"ATLAS_HOME": _home(raw='{"env": ["a"]}'), "ATLAS_X": "on"}
        atlas_env.apply_store_env(env)
        self.assertEqual(env["ATLAS_X"], "on")

    def test_non_string_values_skipped(self):
        env = {"ATLAS_HOME": _home({"ATLAS_A": 5, "ATLAS_B": "y"}), "ATLAS_A": "1"}
        atlas_env.apply_store_env(env)
        self.assertEqual((env["ATLAS_A"], env["ATLAS_B"]), ("1", "y"))

    def test_default_home_is_dot_atlas(self):
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, ".atlas"))
        Path(d, ".atlas", "settings.json").write_text('{"env": {"ATLAS_H": "z"}}')
        old = os.environ.get("HOME")
        os.environ["HOME"] = d
        try:
            env = {}
            atlas_env.apply_store_env(env)
        finally:
            os.environ["HOME"] = old
        self.assertEqual(env.get("ATLAS_H"), "z")


class RealHookRun(unittest.TestCase):
    """fallow_gate on a commit: ATLAS_FALLOW=on prints a notice, off is silent."""

    def _run(self, store_env):
        home = tempfile.mkdtemp()
        atlas = os.path.join(home, ".atlas")
        os.makedirs(atlas)
        Path(atlas, "settings.json").write_text(json.dumps({"env": store_env}))
        payload = {
            "tool_name": "Bash",
            "tool_input": {"command": "git commit -m x"},
            "session_id": "s",
            "cwd": home,
        }
        env = {
            "PATH": "/usr/bin:/bin",
            "HOME": home,
            "ATLAS_HOME": atlas,
            "ATLAS_FALLOW": "on",
        }
        p = subprocess.run(
            [sys.executable, "-S", str(HOOKS / "fallow_gate.py")],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            env=env,
            timeout=30,
        )
        return p.stdout + p.stderr

    def test_inherited_on_is_beaten_by_store_off(self):
        self.assertEqual(self._run({"ATLAS_FALLOW": "off"}).strip(), "")

    def test_inherited_on_without_store_still_runs(self):
        self.assertIn("fallow binary not found", self._run({}))


if __name__ == "__main__":
    unittest.main()
