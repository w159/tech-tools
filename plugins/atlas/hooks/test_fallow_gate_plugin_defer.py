import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import fallow_gate as fg  # noqa: E402

PAYLOAD = {"tool_name": "Bash", "tool_input": {"command": "git commit -m x"}}


def _setup(root, enabled=True, gate=True, key="fallow@fallow-skills"):
    cfg = os.path.join(root, "cfg")
    install = os.path.join(root, "install")
    os.makedirs(os.path.join(cfg, "plugins"))
    os.makedirs(os.path.join(install, "hooks"))
    if gate:
        with open(os.path.join(install, "hooks", "fallow-gate.sh"), "w") as fh:
            fh.write("#!/bin/sh\n")
    with open(os.path.join(cfg, "settings.json"), "w") as fh:
        json.dump({"enabledPlugins": {key: enabled}}, fh)
    with open(os.path.join(cfg, "plugins", "installed_plugins.json"), "w") as fh:
        json.dump({"plugins": {key: [{"installPath": install}]}}, fh)
    return cfg


class FallowPluginGateTest(unittest.TestCase):
    def _run(self, cfg, fallow_env=None):
        env = {"CLAUDE_CONFIG_DIR": cfg}
        if fallow_env:
            env["ATLAS_FALLOW"] = fallow_env
        with mock.patch.dict(os.environ, env), \
                mock.patch.object(fg.atlas_hook_guard, "load_payload", return_value=PAYLOAD), \
                mock.patch.object(fg, "_resolve_runner", return_value=None) as res:
            rc = fg.main()
        return rc, res

    def test_enabled_and_gate_present_skips(self):
        with tempfile.TemporaryDirectory() as d:
            rc, res = self._run(_setup(d))
        self.assertEqual(rc, 0)
        res.assert_not_called()

    def test_disabled_runs(self):
        with tempfile.TemporaryDirectory() as d:
            _, res = self._run(_setup(d, enabled=False))
        res.assert_called_once()

    def test_gate_missing_runs(self):
        with tempfile.TemporaryDirectory() as d:
            _, res = self._run(_setup(d, gate=False))
        res.assert_called_once()

    def test_force_runs(self):
        with tempfile.TemporaryDirectory() as d:
            _, res = self._run(_setup(d), fallow_env="force")
        res.assert_called_once()

    def test_read_error_runs(self):
        with tempfile.TemporaryDirectory() as d:
            _, res = self._run(os.path.join(d, "nope"))
        res.assert_called_once()


if __name__ == "__main__":
    unittest.main()
