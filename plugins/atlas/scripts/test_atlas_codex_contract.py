import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import atlas_codex_contract as g  # noqa: E402


class CodexContract(unittest.TestCase):
    def test_render_deterministic_and_small(self):
        self.assertEqual(g.render(), g.render())
        self.assertLess(len(g.render()), 3000)

    def test_codex_manifest_wires_skills_hooks_and_version(self):
        import json

        codex = json.loads((g.ROOT / ".codex-plugin" / "plugin.json").read_text())
        claude = json.loads((g.ROOT / ".claude-plugin" / "plugin.json").read_text())
        self.assertEqual(codex["name"], "atlas")
        self.assertEqual(codex["version"], claude["version"])
        self.assertEqual(codex["skills"], "./skills/")
        self.assertEqual(codex["hooks"], "./hooks/hooks.json")
        self.assertTrue((g.ROOT / codex["skills"]).is_dir())
        self.assertTrue((g.ROOT / codex["hooks"]).is_file())

    def test_write_check_and_outside_survives(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "AGENTS.md"
            pre, post = "# Mine\né keep\n", "\n## After\ntail"
            p.write_text(pre + g.BEGIN + "\nold\n" + g.END + post)
            with mock.patch.object(g, "TARGET", p):
                self.assertEqual(g.main(["--check"]), 1)
                self.assertEqual(g.main(["--write"]), 0)
                self.assertEqual(g.main(["--check"]), 0)
                t = p.read_text()
                self.assertTrue(t.startswith(pre) and t.endswith(post))
                p.write_text(t.replace("Phases", "Phasez"))
                self.assertEqual(g.main(["--check"]), 1)
                # no fence yet: appended, original bytes intact
                p.write_text(pre)
                g.main(["--write"])
                self.assertTrue(p.read_text().startswith(pre))


if __name__ == "__main__":
    unittest.main()
