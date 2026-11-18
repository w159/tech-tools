import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import atlas_test  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
H = "plugins/atlas/hooks/"
S = "plugins/atlas/scripts/"


def sel(*paths):
    return atlas_test.select(list(paths), REPO)


class SelectTest(unittest.TestCase):
    def test_hook_with_matching_test_selects_it_plus_contract(self):
        r = sel(H + "completion_gate_core.py")
        self.assertEqual(r.files["scripts"], [])
        self.assertIn("test_completion_gate.py", r.files["hooks"])
        self.assertIn("test_atlas_contract.py", r.files["hooks"])
        self.assertLess(len(r.files["hooks"]), 5)

    def test_hook_without_test_selects_whole_hooks(self):
        r = sel(H + "routing_corpus.jsonl")  # a hooks file with no matching test_*.py
        self.assertEqual(r.files["hooks"], atlas_test.suite_files("hooks", REPO))
        self.assertEqual(r.files["scripts"], [])

    def test_script_with_matching_test(self):
        r = sel(S + "atlas_scope.py")
        self.assertIn("test_atlas_scope.py", r.files["scripts"])
        self.assertLess(len(r.files["scripts"]), 5)
        self.assertEqual(r.files["hooks"], [])

    def test_script_without_test_selects_whole_scripts(self):
        r = sel(S + "atlas_no_such_script_xyz.py")
        self.assertEqual(r.files["scripts"], atlas_test.suite_files("scripts", REPO))
        self.assertEqual(r.files["hooks"], [])

    def test_test_file_selects_itself(self):
        r = sel(S + "test_atlas_scope.py")
        self.assertEqual(r.files["scripts"], ["test_atlas_scope.py"])

    def test_ts_selects_no_python_and_prints_js_command(self):
        r = sel("plugins/atlas/omp/advisor.ts")
        self.assertEqual(r.files, {"hooks": [], "scripts": []})
        self.assertEqual(len(r.js), 1)
        self.assertIn("bun test omp/advisor", r.js[0])

    def test_package_with_test_script_uses_it(self):
        r = sel("plugins/atlas/colony/herdr-web-ui/server/prompt.ts")
        self.assertEqual(r.js, ["cd plugins/atlas/colony/herdr-web-ui && npm test"])

    def test_docs_and_markdown_select_nothing(self):
        r = sel("docs/architecture/x.md", "README.md", "plugins/atlas/skills/a/SKILL.md")
        self.assertEqual(r.files, {"hooks": [], "scripts": []})
        self.assertEqual(r.js, [])

    def test_shared_inputs_select_both_full_suites(self):
        for p in ("plugins/atlas/contracts/scope-matrix.json", H + "hooks.json",
                  "plugins/atlas/agents/implementer.md", S + "_test_isolation.py"):
            r = sel(p)
            self.assertEqual(r.files["hooks"], atlas_test.suite_files("hooks", REPO), p)
            self.assertEqual(r.files["scripts"], atlas_test.suite_files("scripts", REPO), p)

    def test_unknown_atlas_python_selects_both(self):
        r = sel("plugins/atlas/lib/whatever.py")
        self.assertTrue(r.files["hooks"] and r.files["scripts"])

    def test_non_atlas_path_selects_nothing(self):
        self.assertEqual(sel("scripts/check_versions.py").files, {"hooks": [], "scripts": []})


class PickPythonTest(unittest.TestCase):
    def pick(self, have, env=None, exists=True):
        root = tempfile.mkdtemp()
        if exists:
            (Path(root) / ".venv/bin").mkdir(parents=True)
            (Path(root) / ".venv/bin/python").write_text("")
        which = {"python3": "/p/python3", "python3.14": "/p/python3.14"}.get
        probed = []
        def probe(c):
            probed.append(c)
            return "9.0" if c in have else None
        got = atlas_test.pick_python(probe, env or {}, root, "/p/exe", which)
        return got, probed, root

    def test_env_first_then_venv_then_exe_then_path(self):
        got, probed, root = self.pick({"/p/python3.14"})
        self.assertEqual(got, ("/p/python3.14", "9.0"))
        self.assertEqual(probed, [f"{root}/.venv/bin/python", "/p/exe", "/p/python3", "/p/python3.14"])
        got, probed, _ = self.pick({"/e", "/p/exe"}, env={"ATLAS_TEST_PYTHON": "/e"})
        self.assertEqual((got[0], probed), ("/e", ["/e"]))

    def test_missing_venv_is_skipped_without_probe(self):
        _, probed, _ = self.pick({"/p/exe"}, exists=False)
        self.assertEqual(probed, ["/p/exe"])

    def test_none_has_pytest_exits_2_with_hint(self):
        self.assertIsNone(self.pick(set())[0])
        out = []
        orig = atlas_test.pick_python
        atlas_test.pick_python = lambda *a, **k: None
        try:
            code = atlas_test.run_items([("hooks", Path("."), "test_x.py")], out=out.append)
        finally:
            atlas_test.pick_python = orig
        self.assertEqual(code, 2)
        self.assertIn("ATLAS_TEST_PYTHON", "\n".join(out))


class RunTest(unittest.TestCase):
    def test_failing_file_named_and_exit_nonzero(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "test_ok.py").write_text(
                "import unittest\nclass T(unittest.TestCase):\n    def test_a(self): pass\n")
            (Path(d) / "test_bad.py").write_text(
                "import unittest\nclass T(unittest.TestCase):\n    def test_a(self): self.assertEqual(1, 2)\n")
            items = [("hooks", Path(d), "test_ok.py"), ("hooks", Path(d), "test_bad.py")]
            out = []
            code = atlas_test.run_items(items, jobs=2, out=out.append)
        text = "\n".join(out)
        self.assertNotEqual(code, 0)
        self.assertIn("hooks: FAIL 1/2", text)
        self.assertIn("test_bad.py", text)
        self.assertIn("AssertionError", text)
        self.assertIn("wall", text)
        self.assertRegex(text.splitlines()[-1], r"python \S+, pytest \d")

    def test_all_pass_exit_zero(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "test_ok.py").write_text(
                "import unittest\nclass T(unittest.TestCase):\n    def test_a(self): pass\n")
            out = []
            code = atlas_test.run_items([("scripts", Path(d), "test_ok.py")], jobs=1, out=out.append)
        self.assertEqual(code, 0)
        self.assertIn("scripts: PASS 1 file", "\n".join(out))


if __name__ == "__main__":
    unittest.main()
