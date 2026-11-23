import _test_isolation  # noqa: F401,E402
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import atlas_selffix as sf  # noqa: E402

STYLE = "plugins/atlas/output-styles/atlas-orchestrator.md"


class InstallLayoutTarget(unittest.TestCase):
    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp())
        self.src = os.path.join(self.tmp, "src")
        os.makedirs(os.path.join(self.src, os.path.dirname(STYLE)))
        Path(self.src, STYLE).write_text("x")
        subprocess.run(["git", "init", "-q", self.src], check=True)
        self.inst = Path(self.tmp, "home/.claude/plugins/cache/m/atlas/1.0/scripts")
        self.inst.mkdir(parents=True)
        self.bare = os.path.join(self.tmp, "bare")
        os.makedirs(self.bare)
        self.old = os.getcwd()
        self.addCleanup(os.chdir, self.old)
        env = mock.patch.dict(os.environ, {})
        env.start()
        os.environ.pop("ATLAS_PROJECT_ROOT", None)
        self.addCleanup(env.stop)

    def resolve(self, tp, cwd):
        os.chdir(cwd)
        with mock.patch.object(sf, "SCRIPTS_DIR", self.inst):
            return sf.resolve_target({"target_path": tp})

    def test_label_resolves_to_source_file(self):
        top, tgt, why = self.resolve("style: Length budget", self.src)
        self.assertEqual(why, "")
        self.assertEqual(tgt, os.path.join(self.src, STYLE))
        self.assertEqual(top, self.src)
        self.assertNotIn("/plugins/cache/", tgt)

    def test_no_checkout_has_distinct_reason(self):
        top, tgt, why = self.resolve("style: Length budget", self.bare)
        self.assertIsNone(top)
        self.assertIn("no source checkout reachable", why)
        self.assertNotIn("not a source file", why)

    def test_true_label_keeps_label_reason(self):
        for tp in ("atlas:implementer", "outcome"):
            for cwd in (self.src, self.bare):
                _, _, why = self.resolve(tp, cwd)
                self.assertIn("tool or label name", why)


if __name__ == "__main__":
    unittest.main()
