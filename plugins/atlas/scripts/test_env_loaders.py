"""mcp/_env loaders (load.mjs, load.py): shell exports beat env files, missing files are loud."""

import _test_isolation  # noqa: F401  (must be first)
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ENV_DIR = Path(__file__).resolve().parent.parent / "mcp" / "_env"
PROBE = "import json,os;print(json.dumps({k:os.environ.get(k) for k in ('AUVIK_API_KEY','AUVIK_REGION','FOO')}))"
PROBE_JS = "console.log(JSON.stringify({AUVIK_API_KEY:process.env.AUVIK_API_KEY??null,AUVIK_REGION:process.env.AUVIK_REGION??null,FOO:process.env.FOO??null}))"


class LoaderCase:
    """Subclasses define run(env) -> (values dict, stderr)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.home = self.tmp / "home"
        self.home.mkdir()

    def env_file(self, text, mode=0o600, name="atlas.env"):
        p = self.tmp / name
        p.write_text(text)
        p.chmod(mode)
        return p

    def base(self, **extra):
        env = {"PATH": os.environ["PATH"], "HOME": str(self.home)}
        env.update({k: v for k, v in extra.items() if v is not None})
        return env

    def test_shell_export_beats_file(self):
        f = self.env_file("AUVIK_API_KEY=from-file\nFOO=file-foo\n")
        vals, err = self.run_loader(
            self.base(ATLAS_ENV_FILE=str(f), AUVIK_API_KEY="from-shell")
        )
        self.assertEqual(vals["AUVIK_API_KEY"], "from-shell")
        self.assertEqual(vals["FOO"], "file-foo")  # file still fills gaps
        self.assertIn("AUVIK_API_KEY: shell export wins", err)
        self.assertNotIn("from-shell", err)
        self.assertNotIn("from-file", err)

    def test_atlas_env_file_beats_default_file_and_cfg_fills_gaps(self):
        d = self.home / ".config" / "atlas"
        d.mkdir(parents=True)
        (d / "atlas.env").write_text(
            "AUVIK_API_KEY=default\nAUVIK_REGION=default-region\n"
        )
        (d / "atlas.env").chmod(0o600)
        f = self.env_file("AUVIK_API_KEY=explicit\n")
        vals, _ = self.run_loader(self.base(ATLAS_ENV_FILE=str(f), CFG_FOO="cfg-foo"))
        self.assertEqual(vals["AUVIK_API_KEY"], "explicit")
        self.assertEqual(vals["AUVIK_REGION"], "default-region")
        self.assertEqual(vals["FOO"], "cfg-foo")

    def test_blank_and_unexpanded_values_are_not_used(self):
        f = self.env_file("AUVIK_API_KEY=\nFOO=${user_config.foo}\n")
        vals, _ = self.run_loader(
            self.base(ATLAS_ENV_FILE=str(f), CFG_AUVIK_API_KEY="${user_config.x}")
        )
        self.assertIsNone(vals["AUVIK_API_KEY"])
        self.assertIsNone(vals["FOO"])

    def test_missing_files_are_reported_by_name(self):
        _, err = self.run_loader(self.base(ATLAS_ENV_FILE=str(self.tmp / "nope.env")))
        self.assertIn("ATLAS_ENV_FILE not found", err)
        self.assertIn("nope.env", err)
        self.assertIn("default env file not found", err)

    def test_world_readable_file_is_flagged(self):
        f = self.env_file("FOO=x\n", mode=0o644)
        _, err = self.run_loader(self.base(ATLAS_ENV_FILE=str(f)))
        self.assertIn("group/world-readable", err)
        f.chmod(0o600)
        _, err = self.run_loader(self.base(ATLAS_ENV_FILE=str(f)))
        self.assertNotIn("group/world-readable", err)

    def test_file_beats_saved_userconfig_but_says_so(self):
        f = self.env_file("AUVIK_API_KEY=stale\n")
        vals, err = self.run_loader(
            self.base(ATLAS_ENV_FILE=str(f), CFG_AUVIK_API_KEY="fresh")
        )
        self.assertEqual(vals["AUVIK_API_KEY"], "stale")
        self.assertIn("AUVIK_API_KEY: env file value wins over saved userConfig", err)
        self.assertNotIn("stale", err.replace("env file value", ""))


class NodeLoader(LoaderCase, unittest.TestCase):
    def run_loader(self, env):
        proc = subprocess.run(
            ["node", "--import", str(ENV_DIR / "load.mjs"), "-e", PROBE_JS],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.loads(proc.stdout), proc.stderr


class PythonLoader(LoaderCase, unittest.TestCase):
    def run_loader(self, env):
        mod = self.tmp / "probe_mod.py"
        mod.write_text(PROBE)
        env = dict(env, PYTHONPATH=str(self.tmp))
        proc = subprocess.run(
            [sys.executable, str(ENV_DIR / "load.py"), "probe_mod"],
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.loads(proc.stdout), proc.stderr


if __name__ == "__main__":
    unittest.main()
