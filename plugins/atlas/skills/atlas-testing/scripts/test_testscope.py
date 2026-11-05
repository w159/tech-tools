#!/usr/bin/env python3
"""Tests for testscope.py: fixtures, detection, gaps, commands, CLI exits."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

import pytest

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
        write(root, ".atlas/wt/worker-a/lib.go", "package a\n")
        det = testscope.detect(root)
        self.assertIn("python", det["languages"])
        self.assertNotIn("javascript", det["languages"])
        self.assertNotIn("ruby", det["languages"])
        self.assertNotIn("go", det["languages"])

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

def mk(tmp_path, files):
    for rel, content in files.items():
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
    return str(tmp_path)


def tool_names(det):
    return {t["tool"] for t in det["test_tools"]}


def cmds(root):
    return {r["tool"]: r for r in testscope.command_rows(root)}


def test_composer_tools_and_laravel_framework(tmp_path):
    root = mk(
        tmp_path,
        {
            "composer.json": json.dumps(
                {
                    "require": {"laravel/framework": "^11"},
                    "require-dev": {
                        "phpunit/phpunit": "^10",
                        "pestphp/pest": "^2",
                        "infection/infection": "^0.27",
                        "phpstan/phpstan": "^1",
                        "vimeo/psalm": "^5",
                        "other/pkg": "1",
                    },
                }
            )
        },
    )
    det = testscope.detect(root)
    assert det["frameworks"] == ["laravel"]
    assert tool_names(det) == {"phpunit", "pest", "infection", "phpstan", "psalm"}
    assert [t for t in det["test_tools"] if t["tool"] == "phpunit"][0] == {
        "tool": "phpunit",
        "type_ids": ["unit", "integration"],
        "evidence": "composer.json",
    }
    c = cmds(root)
    assert c["phpunit"]["command"] == "vendor/bin/phpunit"
    assert c["pest"]["command"] == "vendor/bin/pest"
    assert c["infection"]["command"] == "vendor/bin/infection"
    assert c["phpstan"]["command"] == "vendor/bin/phpstan analyse"
    assert c["psalm"]["command"] == "vendor/bin/psalm"


def test_composer_without_laravel_and_bad_json(tmp_path):
    root = mk(tmp_path, {"composer.json": '{"require": {"phpunit/phpunit": "1"}}'})
    det = testscope.detect(root)
    assert det["frameworks"] == []
    assert tool_names(det) == {"phpunit"}
    bad = mk(tmp_path / "bad", {"composer.json": "{nope"})
    assert tool_names(testscope.detect(bad)) == set()


def test_csproj_web_sdk_packages_and_dotnet_commands(tmp_path):
    proj = (
        '<Project Sdk="Microsoft.NET.Sdk.Web">'
        '<PackageReference Include="xunit" Version="2" />'
        '<PackageReference Include="coverlet.collector" Version="6" />'
        '<PackageReference Include="bunit" Version="1" />'
        '<PackageReference Include="Microsoft.Playwright" Version="1" />'
        '<PackageReference Include="Unrelated.Pkg" Version="1" />'
        "</Project>"
    )
    root = mk(
        tmp_path,
        {
            "App/App.csproj": proj,
            ".config/dotnet-tools.json": '{"tools": {"dotnet-stryker": {}}}',
        },
    )
    det = testscope.detect(root)
    assert det["frameworks"] == ["aspnet"]
    assert tool_names(det) == {
        "xunit",
        "coverlet",
        "bunit",
        "playwright-dotnet",
        "dotnet-test",
        "stryker-dotnet",
    }
    c = cmds(root)
    assert c["dotnet-test"]["command"] == "dotnet test"
    assert c["stryker-dotnet"]["command"] == "dotnet stryker"


def test_empty_csproj_adds_only_dotnet_test(tmp_path):
    root = mk(tmp_path, {"a.csproj": ""})
    det = testscope.detect(root)
    assert tool_names(det) == {"dotnet-test"}
    assert det["frameworks"] == []


def test_cargo_tokens_fuzz_dir_and_commands(tmp_path):
    root = mk(
        tmp_path,
        {
            "Cargo.toml": "[dev-dependencies]\nProptest = '1'\ncriterion = '0.5'\n",
            "src/lib.rs": "pub fn a() {}\n",
            "fuzz/fuzz_targets/t.rs": "//\n",
        },
    )
    det = testscope.detect(root)
    assert tool_names(det) == {"proptest", "criterion", "cargo-fuzz"}
    fuzz = [t for t in det["test_tools"] if t["tool"] == "cargo-fuzz"][0]
    assert fuzz["evidence"] == "fuzz"
    c = cmds(root)
    assert c["cargo-test"]["command"] == "cargo test"
    assert c["criterion"]["command"] == "cargo bench"
    assert c["cargo-fuzz"]["command"] == "cargo fuzz run"


def test_cargo_without_fuzz_dir_has_no_cargo_fuzz(tmp_path):
    root = mk(tmp_path, {"Cargo.toml": "[dependencies]\ninsta = '1'\n", "fuzzy.rs": "x"})
    assert tool_names(testscope.detect(root)) == {"insta"}


@pytest.mark.parametrize(
    "files,expected",
    [
        (["db/migrations/001.sql"], True),
        (["db/migrate/001.sql"], True),
        (["alembic/versions/a.py"], True),
        (["drizzle/0001.sql"], True),
        (["Migrations/x.sql"], True),
        (["migrations"], False),
        (["src/app.py", "db/schema.sql"], False),
        ([], False),
    ],
)
def test_has_migrations(files, expected):
    assert testscope.has_migrations(files) is expected


def test_sql_baseline_priority_depends_on_migrations():
    rows = testscope.baseline_rows({"sql": {"files": 1}}, [], ["db/migrations/1.sql"])
    assert ("data", "db-migration", "must") in rows
    rows = testscope.baseline_rows({"sql": {"files": 1}}, [], ["db/schema.sql"])
    assert ("data", "db-migration", "should") in rows


def test_bats_dir_uses_evidence_directory():
    tools = [{"tool": "bats", "type_ids": ["unit"], "evidence": "tests/cli/a.bats"}]
    assert testscope.bats_dir("/x", tools) == "tests/cli"
    tools = [{"tool": "bats", "type_ids": ["unit"], "evidence": "a.bats"}]
    assert testscope.bats_dir("/x", tools) == "."
    assert testscope.bats_dir("/x", []) == "test"


def test_bats_command_row(tmp_path):
    root = mk(tmp_path, {"t/a.bats": "@test 'x' { true; }\n"})
    assert cmds(root)["bats"]["command"] == "bats t/"


def test_pytest_cmd_uv_lock(tmp_path):
    assert testscope.pytest_cmd(str(tmp_path)) == "python -m pytest"
    (tmp_path / "uv.lock").write_text("")
    assert testscope.pytest_cmd(str(tmp_path)) == "uv run pytest"


def test_uv_python_command_rows(tmp_path):
    root = mk(
        tmp_path,
        {
            "uv.lock": "",
            "pyproject.toml": '[project]\ndependencies=["pytest","pytest-cov","ruff","mypy"]\n',
        },
    )
    c = cmds(root)
    assert c["pytest"]["command"] == "uv run pytest --cov"
    assert c["ruff"]["command"] == "uv run ruff check ."
    assert c["mypy"]["command"] == "uv run mypy ."


def test_unittest_dirs_skips_non_test_files_and_keeps_scanning(tmp_path):
    root = mk(
        tmp_path,
        {
            "README.md": "x",
            "helper.py": "import unittest\n",
            "pkg/test_a.py": "import unittest\n",
            "pkg/test_b.py": "import unittest\n",
            "other/b_test.py": "from unittest import TestCase\n",
            "other/test_plain.py": "def test_x(): pass\n",
        },
    )
    files = ["README.md", "helper.py", "pkg/test_a.py", "pkg/test_b.py",
             "other/b_test.py", "other/test_plain.py"]
    assert testscope.unittest_dirs(root, files) == {
        "pkg": "pkg/test_a.py",
        "other": "other/b_test.py",
    }


def test_unittest_command_rows(tmp_path):
    root = mk(
        tmp_path,
        {
            "test_top.py": "import unittest\n",
            "pkg/test_a.py": "import unittest\n",
            "sfx/x_test.py": "import unittest\n",
        },
    )
    got = [r["command"] for r in testscope.command_rows(root) if r["tool"] == "unittest"]
    assert got == [
        "python3 -m unittest discover",
        "python3 -m unittest discover -s pkg -p 'test_*.py'",
        "python3 -m unittest discover -s sfx -p '*_test.py'",
    ]


def test_workflow_scanners_detected_from_ci_files(tmp_path):
    root = mk(
        tmp_path,
        {
            ".github/workflows/ci.yml": "uses: github/codeql-action\nrun: trivy fs .\n"
            "run: shellcheck x\nrun: gitleaks detect\n",
        },
    )
    det = testscope.detect(root)
    assert det["ci"] == [".github/workflows/ci.yml"]
    assert tool_names(det) == {
        "github-actions",
        "codeql",
        "trivy",
        "shellcheck",
        "gitleaks",
    }
    ev = {t["tool"]: t["evidence"] for t in det["test_tools"]}
    assert ev["trivy"] == ".github/workflows/ci.yml"


def test_workflow_without_scanner_tokens_only_reports_actions(tmp_path):
    root = mk(tmp_path, {".github/workflows/ci.yml": "run: echo hi\n"})
    assert tool_names(testscope.detect(root)) == {"github-actions"}


def test_workflow_only_first_iac_scanner_is_recorded(tmp_path):
    root = mk(tmp_path, {".github/workflows/ci.yml": "tfsec\ncheckov\n"})
    names = tool_names(testscope.detect(root))
    assert "checkov" in names and "tfsec" not in names


def test_jvm_and_gem_tokens_and_gradle_command(tmp_path):
    root = mk(
        tmp_path,
        {
            "build.gradle": "testImplementation 'net.jqwik:jqwik'\n",
            "gradlew": "#!/bin/sh\n",
            "Gemfile": "gem 'rspec'\ngem 'minitest'\n",
        },
    )
    c = cmds(root)
    assert c["gradle-test"]["command"] == "./gradlew test"
    assert c["rspec"]["command"] == "bundle exec rspec"
    assert c["minitest"]["command"] == "bundle exec rake test"


def test_gradle_without_wrapper_and_mvn_wrapper(tmp_path):
    root = mk(tmp_path, {"pom.xml": "<artifactId>junit</artifactId> pitest"})
    c = cmds(root)
    assert c["junit"]["command"] == "mvn test"
    assert c["gradle-test"]["command"] == "gradle test"
    (tmp_path / "mvnw").write_text("")
    assert cmds(root)["junit"]["command"] == "./mvnw test"


def test_no_gradle_row_for_junit_alone(tmp_path):
    root = mk(tmp_path, {"pom.xml": "junit"})
    assert "gradle-test" not in cmds(root)


SAMPLE_DET = {
    "languages": {"python": {"files": 3}, "go": {"files": 1}},
    "frameworks": ["fastapi"],
    "test_tools": [
        {"tool": "pytest", "type_ids": ["unit", "coverage"], "evidence": "pyproject.toml"}
    ],
    "ci": [".github/workflows/ci.yml"],
}


def test_md_detect_exact():
    assert testscope.md_detect(SAMPLE_DET) == (
        "# detect\n\n## Languages\n\n| Language | Files |\n|---|---|\n"
        "| python | 3 |\n| go | 1 |\n\n## Frameworks\n\n- fastapi\n\n"
        "## Test tools\n\n| Tool | Type IDs | Evidence |\n|---|---|---|\n"
        "| pytest | unit, coverage | pyproject.toml |\n\n## CI files\n\n"
        "- .github/workflows/ci.yml\n"
    )


def test_md_detect_empty_lists_say_none():
    out = testscope.md_detect(
        {"languages": {}, "frameworks": [], "test_tools": [], "ci": []}
    )
    assert out.count("- none\n") == 2


def test_md_gaps_exact():
    rows = [
        {
            "area": "python",
            "type_id": "unit",
            "status": "missing",
            "priority": "must",
            "reason": "r",
            "reference": "references/x.md",
        }
    ]
    assert testscope.md_gaps(rows) == (
        "# gaps\n\n| Area | Type | Status | Priority | Reason | Reference |\n"
        "|---|---|---|---|---|---|\n"
        "| python | unit | missing | must | r | references/x.md |\n"
    )


def test_md_commands_exact_with_and_without_note():
    rows = [
        {"tool": "pytest", "type_id": "unit", "command": "python -m pytest"},
        {"tool": "axe", "type_id": "accessibility", "command": "x", "note": "n"},
    ]
    assert testscope.md_commands(rows) == (
        "# commands\n\n| Tool | Type | Command | Note |\n|---|---|---|---|\n"
        "| pytest | unit | `python -m pytest` |  |\n"
        "| axe | accessibility | `x` | n |\n"
    )


def py_root(tmp_path):
    return mk(
        tmp_path,
        {
            "pyproject.toml": '[project]\ndependencies=["fastapi","pytest"]\n',
            "tests/test_a.py": "def test_a(): pass\n",
        },
    )


def run_main(capsys, *argv):
    rc = testscope.main(list(argv))
    return rc, capsys.readouterr().out


def test_main_detect_json(tmp_path, capsys):
    rc, out = run_main(capsys, "detect", "--root", py_root(tmp_path))
    assert rc == 0
    data = json.loads(out)
    assert data["frameworks"] == ["fastapi"]
    assert "pytest" in {t["tool"] for t in data["test_tools"]}
    assert out.endswith("}\n")
    assert out.startswith('{\n  "languages"')


def test_main_gaps_json_and_md(tmp_path, capsys):
    root = py_root(tmp_path)
    rc, out = run_main(capsys, "gaps", "--root", root)
    rows = json.loads(out)
    assert rc == 0 and {"area", "type_id", "status", "priority"} <= set(rows[0])
    rc, md = run_main(capsys, "gaps", "--root", root, "--format", "md")
    assert md.startswith("# gaps\n") and "| python | unit | present |" in md


def test_main_commands_json_and_md(tmp_path, capsys):
    root = py_root(tmp_path)
    rc, out = run_main(capsys, "commands", "--root", root)
    assert {"tool": "pytest", "type_id": "unit", "command": "python -m pytest"} in json.loads(out)
    rc, md = run_main(capsys, "commands", "--root", root, "--format", "md")
    assert md.startswith("# commands\n") and "`python -m pytest`" in md


def test_main_detect_md(tmp_path, capsys):
    rc, md = run_main(capsys, "detect", "--root", py_root(tmp_path), "--format", "md")
    assert md.startswith("# detect\n") and "- fastapi\n" in md


def test_main_rejects_unknown_command(tmp_path, capsys):
    with pytest.raises(SystemExit) as e:
        testscope.main(["bogus"])
    assert e.value.code == 2


def test_main_expands_user_in_root(tmp_path, capsys, monkeypatch):
    root = py_root(tmp_path)
    monkeypatch.setenv("HOME", str(tmp_path))
    rc, out = run_main(capsys, "detect", "--root", "~")
    assert rc == 0 and json.loads(out)["frameworks"] == ["fastapi"]


if __name__ == "__main__":
    unittest.main()
