#!/usr/bin/env python3
"""Tests for testscope.py: fixtures, detection, gaps, commands, CLI exits."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import testscope  # noqa: E402


def write(root, relpath, content):
    path = os.path.join(root, relpath)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(content)


def tool(det, name):
    for t in det["test_tools"]:
        if t["tool"] == name:
            return t
    raise AssertionError(f"tool {name!r} not detected")


def gap(rows, area, type_id):
    for r in rows:
        if r["area"] == area and r["type_id"] == type_id:
            return r
    raise AssertionError(f"gap {area}/{type_id} not recommended")


def make_python_repo():
    root = tempfile.mkdtemp(prefix="tsc_py_")
    write(
        root,
        "pyproject.toml",
        """
[project]
name = "svc"
dependencies = ["fastapi", "uvicorn"]

[project.optional-dependencies]
dev = ["pytest", "ruff"]
""",
    )
    write(root, "app/main.py", "from fastapi import FastAPI\napp = FastAPI()\n")
    write(root, "tests/test_app.py", "def test_ok():\n    assert True\n")
    # ignored decoys: js in node_modules, go in .git, ts in venv
    write(root, "node_modules/pkg/index.js", "module.exports = 1\n")
    write(root, ".git/objects/ab.go", "package main\n")
    write(root, ".venv/lib/x.ts", "export const a = 1\n")
    return root


def make_ts_repo():
    root = tempfile.mkdtemp(prefix="tsc_ts_")
    pkg = {
        "name": "web",
        "scripts": {"test": "vitest run"},
        "dependencies": {"react": "^18.0.0"},
        "devDependencies": {
            "vitest": "^1.0.0",
            "@testing-library/react": "^14.0.0",
            "typescript": "^5.0.0",
            "axe-core": "^4.9.0",
        },
    }
    write(root, "package.json", json.dumps(pkg))
    write(root, "src/App.tsx", "export default () => null\n")
    write(root, "src/App.test.tsx", "test('x', () => {})\n")
    return root


def make_go_repo():
    root = tempfile.mkdtemp(prefix="tsc_go_")
    write(
        root,
        "go.mod",
        """module example.com/svc

go 1.22

require github.com/stretchr/testify v1.9.0
""",
    )
    write(root, "main.go", "package main\n\nfunc main() {}\n")
    write(
        root,
        "fuzz_test.go",
        """package main

import "testing"

func FuzzFoo(f *testing.F) {
    f.Fuzz(func(t *testing.T, s string) {})
}

func BenchmarkFoo(b *testing.B) {
    for i := 0; i < b.N; i++ {
    }
}
""",
    )
    return root


def make_terraform_repo():
    root = tempfile.mkdtemp(prefix="tsc_tf_")
    write(root, "main.tf", 'resource "null_resource" "a" {}\n')
    return root


class TestscopeTest(unittest.TestCase):
    def setUp(self):
        self.roots = []

    def tearDown(self):
        for root in self.roots:
            shutil.rmtree(root, ignore_errors=True)

    def register(self, root):
        self.roots.append(root)
        return root

    def test_python_detect(self):
        root = self.register(make_python_repo())
        det = testscope.detect(root)
        self.assertGreaterEqual(det["languages"]["python"]["files"], 2)
        self.assertIn("fastapi", det["frameworks"])
        pytest_tool = tool(det, "pytest")
        self.assertIsNotNone(pytest_tool)
        self.assertEqual(pytest_tool["evidence"], "pyproject.toml")
        self.assertIn("unit", pytest_tool["type_ids"])
        # ignored dirs must not leak languages or tools
        self.assertNotIn("javascript", det["languages"])
        self.assertNotIn("go", det["languages"])
        self.assertNotIn("typescript", det["languages"])
        self.assertFalse(det["ci"])

    def test_python_gaps_and_commands(self):
        root = self.register(make_python_repo())
        rows = testscope.gaps(root)
        mut = gap(rows, "python", "mutation")
        self.assertIsNotNone(mut)
        self.assertEqual(mut["status"], "missing")
        api = gap(rows, "api", "api")
        self.assertIsNotNone(api)
        self.assertEqual(api["priority"], "must")
        self.assertEqual(api["status"], "missing")
        authz = gap(rows, "api", "authz")
        self.assertIsNotNone(authz)
        self.assertEqual(authz["priority"], "must")
        refs = {r["reference"] for r in rows}
        self.assertIn("references/types-mutation.md", refs)
        cmds = testscope.command_rows(root)
        pytest_cmd = next(c for c in cmds if c["tool"] == "pytest")
        self.assertEqual(pytest_cmd["command"], "python -m pytest")

    def test_python_gaps_sorted_by_priority(self):
        root = self.register(make_python_repo())
        rows = testscope.gaps(root)
        missing = [r for r in rows if r["status"] == "missing"]
        order = {"must": 0, "should": 1, "could": 2}
        keys = [(order[r["priority"]], r["area"], r["type_id"]) for r in missing]
        self.assertEqual(keys, sorted(keys))

    def test_ts_detect(self):
        root = self.register(make_ts_repo())
        det = testscope.detect(root)
        self.assertGreaterEqual(det["languages"]["typescript"]["files"], 1)
        vitest_tool = tool(det, "vitest")
        self.assertIsNotNone(vitest_tool)
        self.assertEqual(vitest_tool["evidence"], "package.json")
        self.assertIn("react", det["frameworks"])
        self.assertIn("test-files", {t["tool"] for t in det["test_tools"]})
        self.assertNotIn("stryker-js", {t["tool"] for t in det["test_tools"]})

    def test_ts_gaps_and_commands(self):
        root = self.register(make_ts_repo())
        rows = testscope.gaps(root)
        mut = gap(rows, "typescript", "mutation")
        self.assertIsNotNone(mut)
        self.assertEqual(mut["status"], "missing")
        a11y = gap(rows, "frontend", "accessibility")
        self.assertIsNotNone(a11y)
        self.assertEqual(a11y["priority"], "must")
        cmds = testscope.command_rows(root)
        # package.json test script wins over tool-specific commands
        self.assertEqual(cmds[0]["tool"], "npm-test")
        self.assertEqual(cmds[0]["command"], "npm test")
        vitest_cmd = next(c for c in cmds if c["tool"] == "vitest")
        self.assertEqual(vitest_cmd["command"], "npx vitest run")
        axe_cmd = next(c for c in cmds if c["tool"] == "axe-core")
        self.assertEqual(axe_cmd["command"], "npx vitest run")
        self.assertIn("note", axe_cmd)
        self.assertNotIn("--axe", axe_cmd["command"])
        self.assertFalse(any("--axe" in c["command"] for c in cmds))

    def test_markdownlint_cli2_command(self):
        root = self.register(tempfile.mkdtemp(prefix="tsc_mdl_"))
        pkg = {"devDependencies": {"markdownlint-cli2": "^0.13.0"}}
        write(root, "package.json", json.dumps(pkg))
        write(root, "README.md", "# doc\n")
        cmds = testscope.command_rows(root)
        mdl = next(c for c in cmds if c["tool"] == "markdownlint-cli2")
        self.assertEqual(mdl["command"], 'npx markdownlint-cli2 "**/*.md"')
        self.assertFalse(any(c["tool"] == "markdownlint-cli" for c in cmds))

    def test_go_fuzz(self):
        root = self.register(make_go_repo())
        det = testscope.detect(root)
        fuzz_tool = tool(det, "go-fuzz")
        self.assertIsNotNone(fuzz_tool)
        self.assertEqual(fuzz_tool["evidence"], "fuzz_test.go")
        self.assertIsNotNone(tool(det, "go-benchmark"))
        self.assertIsNotNone(tool(det, "testify"))
        rows = testscope.gaps(root)
        fuzz_gap = gap(rows, "go", "fuzz")
        self.assertIsNotNone(fuzz_gap)
        self.assertEqual(fuzz_gap["status"], "present")
        cmds = testscope.command_rows(root)
        fuzz_cmd = next(c for c in cmds if c["tool"] == "go-fuzz")
        self.assertEqual(fuzz_cmd["command"], "go test -fuzz=FuzzFoo")
        self.assertTrue(any(c["command"] == "go test ./..." for c in cmds))

    def test_terraform_gaps(self):
        root = self.register(make_terraform_repo())
        det = testscope.detect(root)
        self.assertEqual(det["languages"]["terraform"]["files"], 1)
        rows = testscope.gaps(root)
        iac = gap(rows, "iac", "iac-policy")
        self.assertIsNotNone(iac)
        self.assertEqual(iac["priority"], "must")
        self.assertEqual(iac["status"], "missing")

    def test_security_rows_always_present(self):
        root = self.register(make_terraform_repo())
        rows = testscope.gaps(root)
        for tid in ("sca", "secrets"):
            row = gap(rows, "security", tid)
            self.assertIsNotNone(row)
            self.assertEqual(row["priority"], "must")
        self.assertIsNotNone(gap(rows, "ci", "ci-pipeline"))

    def test_area_scoped_gaps(self):
        root = self.register(tempfile.mkdtemp(prefix="tsc_area_"))
        write(root, "pyproject.toml", "[project]\nname = 'svc'\n")
        write(root, "app.py", "x = 1\n")
        write(root, "tests/test_app.py", "def test_ok():\n    assert True\n")
        write(root, "main.go", "package main\n\nfunc main() {}\n")
        det = testscope.detect(root)
        self.assertIn("python", det["languages"])
        self.assertIn("go", det["languages"])
        rows = testscope.gaps(root)
        self.assertEqual(gap(rows, "python", "unit")["status"], "present")
        self.assertEqual(gap(rows, "go", "unit")["status"], "missing")

    def test_gitignore_respected(self):
        if not shutil.which("git"):
            self.skipTest("git not available")
        root = self.register(tempfile.mkdtemp(prefix="tsc_git_"))
        write(root, ".gitignore", "ignored_dir/\n")
        write(root, "app.py", "x = 1\n")
        write(root, "ignored_dir/lib.rb", "class Foo; end\n")
        proc = subprocess.run(["git", "-C", root, "init"], capture_output=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        det = testscope.detect(root)
        self.assertIn("python", det["languages"])
        self.assertNotIn("ruby", det["languages"])

    def test_fallback_prunes_node_modules_prefix(self):
        root = self.register(tempfile.mkdtemp(prefix="tsc_fb_"))
        write(root, "app.py", "x = 1\n")
        write(root, "node_modules.nosync/x.js", "module.exports = 1\n")
        write(root, ".worktrees/w/lib.rb", "class Foo; end\n")
        det = testscope.detect(root)
        self.assertIn("python", det["languages"])
        self.assertNotIn("javascript", det["languages"])
        self.assertNotIn("ruby", det["languages"])

    def test_nonexec_baselines(self):
        root = self.register(tempfile.mkdtemp(prefix="tsc_nonexec_"))
        write(root, "style.css", "body { color: red }\n")
        write(root, "README.md", "# doc\n")
        write(root, "index.html", "<html></html>\n")
        rows = testscope.gaps(root)
        for area in ("css", "markdown", "html"):
            for tid in ("unit", "mutation", "property-based"):
                self.assertIsNone(
                    next(
                        (r for r in rows if r["area"] == area and r["type_id"] == tid),
                        None,
                    ),
                    f"{area}/{tid} must not be recommended",
                )
        self.assertEqual(gap(rows, "css", "static-lint")["priority"], "should")
        self.assertEqual(gap(rows, "css", "visual-regression")["priority"], "should")
        self.assertEqual(gap(rows, "markdown", "link-check")["priority"], "should")
        self.assertEqual(gap(rows, "markdown", "docs-examples")["priority"], "could")
        self.assertEqual(gap(rows, "html", "accessibility")["priority"], "should")

    def test_gitignored_top_level_files_detected(self):
        if not shutil.which("git"):
            self.skipTest("git not available")
        root = self.register(tempfile.mkdtemp(prefix="tsc_top_"))
        write(root, ".gitignore", ".gitleaks.toml\n")
        write(root, "app.py", "x = 1\n")
        write(root, ".gitleaks.toml", "[extend]\n")
        proc = subprocess.run(["git", "-C", root, "init"], capture_output=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        det = testscope.detect(root)
        self.assertIn("gitleaks", {t["tool"] for t in det["test_tools"]})
        self.assertEqual(tool(det, "gitleaks")["evidence"], ".gitleaks.toml")

    def test_cli_exit_codes(self):
        script = os.path.join(HERE, "testscope.py")
        with self.subTest("unknown command"):
            proc = subprocess.run(
                [sys.executable, script, "nope"],
                capture_output=True,
                text=True,
            )
            self.assertEqual(proc.returncode, 2)
        with self.subTest("no args"):
            proc = subprocess.run(
                [sys.executable, script], capture_output=True, text=True
            )
            self.assertEqual(proc.returncode, 2)
        with self.subTest("bad format"):
            proc = subprocess.run(
                [sys.executable, script, "detect", "--format", "xml"],
                capture_output=True,
                text=True,
            )
            self.assertEqual(proc.returncode, 2)

    def test_cli_detect_success(self):
        root = self.register(make_ts_repo())
        script = os.path.join(HERE, "testscope.py")
        proc = subprocess.run(
            [sys.executable, script, "detect", "--root", root],
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0)
        det = json.loads(proc.stdout)
        self.assertIn("typescript", det["languages"])

    def test_detect_md_and_gaps_md(self):
        root = self.register(make_go_repo())
        script = os.path.join(HERE, "testscope.py")
        proc = subprocess.run(
            [sys.executable, script, "gaps", "--root", root, "--format", "md"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0)
        self.assertIn("| go | fuzz | present |", proc.stdout)
        self.assertIn("|---|", proc.stdout)
        proc = subprocess.run(
            [sys.executable, script, "detect", "--root", root, "--format", "md"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0)
        self.assertIn("## Test tools", proc.stdout)

    def test_commands_md_wraps_command_in_backticks_with_header(self):
        root = self.register(make_python_repo())
        script = os.path.join(HERE, "testscope.py")
        proc = subprocess.run(
            [sys.executable, script, "commands", "--root", root, "--format", "md"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(proc.returncode, 0)
        self.assertIn("| Tool | Type | Command | Note |", proc.stdout)
        self.assertIn("| pytest | unit | `python -m pytest` |", proc.stdout)


    def test_unittest_detected_without_pytest(self):
        root = tempfile.mkdtemp(prefix="tsc_ut_")
        self.addCleanup(shutil.rmtree, root, True)
        write(root, "tests/test_x.py", "import unittest\n\nclass T(unittest.TestCase):\n    pass\n")
        write(root, "pkg/a_test.py", "from unittest import TestCase\n")
        det = testscope.detect(root)
        t = tool(det, "unittest")
        self.assertEqual(t["type_ids"], ["unit"])
        self.assertIn("test", t["evidence"])
        cmds = [r["command"] for r in testscope.command_rows(root) if r["tool"] == "unittest"]
        self.assertIn("python3 -m unittest discover -s tests -p 'test_*.py'", cmds)
        self.assertIn("python3 -m unittest discover -s pkg -p '*_test.py'", cmds)
        self.assertEqual(gap(testscope.gaps(root), "python", "unit")["status"], "present")

    def test_unittest_at_root_uses_bare_discover(self):
        root = tempfile.mkdtemp(prefix="tsc_ut_")
        self.addCleanup(shutil.rmtree, root, True)
        write(root, "test_x.py", "import unittest\n")
        cmds = [r["command"] for r in testscope.command_rows(root) if r["tool"] == "unittest"]
        self.assertEqual(cmds, ["python3 -m unittest discover"])

    def test_unittest_skipped_when_pytest_detected(self):
        root = tempfile.mkdtemp(prefix="tsc_ut_")
        self.addCleanup(shutil.rmtree, root, True)
        write(root, "pytest.ini", "[pytest]\n")
        write(root, "tests/test_x.py", "import unittest\n")
        names = {t["tool"] for t in testscope.detect(root)["test_tools"]}
        self.assertIn("pytest", names)
        self.assertNotIn("unittest", names)


if __name__ == "__main__":
    unittest.main()
