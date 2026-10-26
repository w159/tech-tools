#!/usr/bin/env python3
"""testscope: detect test tooling, testing gaps, and run commands for a repo.

Subcommands:
  detect    languages, frameworks, test tools (with evidence), CI files
  gaps      recommended test types per area, marked present/missing
  commands  exact run commands for the tools detected

Stdlib only, python3.9+. Read-only on the target repo: never writes there.

Usage:
  testscope.py <detect|gaps|commands> [--root PATH] [--format json|md]

Exit codes: 0 success, 2 bad args.
"""

import argparse
import json
import os
import re
import subprocess
import sys

SKIP_DIRS = {
    "node_modules",
    ".git",
    ".venv",
    "venv",
    "vendor",
    "dist",
    "build",
    "target",
    "Pods",
    ".next",
    "site-packages",
    "__pycache__",
    "mutants",
    ".stryker-tmp",
}

LANG_EXTS = {
    "python": {".py", ".pyi"},
    "typescript": {".ts", ".tsx", ".mts", ".cts"},
    "javascript": {".js", ".jsx", ".mjs", ".cjs"},
    "php": {".php"},
    "swift": {".swift"},
    "csharp": {".cs"},
    "powershell": {".ps1", ".psm1", ".psd1"},
    "shell": {".sh", ".bash", ".zsh"},
    "go": {".go"},
    "rust": {".rs"},
    "java": {".java"},
    "kotlin": {".kt", ".kts"},
    "c-cpp": {".c", ".h", ".cpp", ".hpp", ".cc", ".cxx", ".hxx", ".hh"},
    "ruby": {".rb"},
    "sql": {".sql"},
    "terraform": {".tf", ".tfvars"},
    "bicep": {".bicep"},
    "markdown": {".md", ".mdx"},
    "notebook": {".ipynb"},
    "css": {".css", ".scss", ".sass"},
    "html": {".html", ".htm"},
    "yaml-ci": {".yml", ".yaml"},
}

PY_MANIFESTS = {
    "pyproject.toml",
    "requirements.txt",
    "requirements-dev.txt",
    "requirements-test.txt",
    "setup.cfg",
    "tox.ini",
    "pytest.ini",
}

# token -> (tool name, type ids)
PY_TOKENS = [
    ("pytest", "pytest", ["unit", "integration"]),
    ("hypothesis", "hypothesis", ["property-based"]),
    ("mutmut", "mutmut", ["mutation"]),
    ("cosmic-ray", "cosmic-ray", ["mutation"]),
    ("coverage", "coverage-py", ["coverage"]),
    ("pytest-cov", "pytest-cov", ["coverage"]),
    ("schemathesis", "schemathesis", ["api"]),
    ("locust", "locust", ["load"]),
    ("bandit", "bandit", ["sast"]),
    ("ruff", "ruff", ["static-lint"]),
    ("mypy", "mypy", ["type-check"]),
    ("pyright", "pyright", ["type-check"]),
    ("atheris", "atheris", ["fuzz"]),
    ("nbval", "nbval", ["notebook"]),
    ("nbmake", "nbmake", ["notebook"]),
    ("great_expectations", "great-expectations", ["data-quality"]),
    ("pytest-benchmark", "pytest-benchmark", ["benchmark"]),
]

PY_API_FRAMEWORKS = ("fastapi", "flask", "django", "uvicorn")

# package.json dep key -> (tool, type ids); prefix match on keys
NPM_PKGS = {
    "vitest": ("vitest", ["unit", "coverage", "component"]),
    "jest": ("jest", ["unit", "coverage", "component"]),
    "mocha": ("mocha", ["unit"]),
    "nyc": ("nyc", ["coverage"]),
    "playwright": ("playwright", ["e2e"]),
    "cypress": ("cypress", ["e2e"]),
    "storybook": ("storybook", ["component", "visual-regression"]),
    "msw": ("msw", ["integration"]),
    "pact": ("pact", ["contract"]),
    "fast-check": ("fast-check", ["property-based"]),
    "k6": ("k6", ["load"]),
    "artillery": ("artillery", ["load"]),
    "eslint": ("eslint", ["static-lint"]),
    "markdownlint-cli": ("markdownlint-cli", ["static-lint"]),
    "markdownlint-cli2": ("markdownlint-cli2", ["static-lint"]),
    "typescript": ("typescript", ["type-check"]),
}
NPM_PREFIXES = {
    "@testing-library/": ("testing-library", ["component"]),
    "@stryker-mutator": ("stryker-js", ["mutation"]),
    "@axe-core": ("axe-core", ["accessibility"]),
    "axe-core": ("axe-core", ["accessibility"]),
}
NPM_FRAMEWORKS = ("react", "vue", "svelte", "next")

# composer.json dep key -> (tool, type ids)
COMPOSER_PKGS = {
    "phpunit/phpunit": ("phpunit", ["unit", "integration"]),
    "pestphp/pest": ("pest", ["unit"]),
    "infection/infection": ("infection", ["mutation"]),
    "phpstan/phpstan": ("phpstan", ["static-lint"]),
    "vimeo/psalm": ("psalm", ["static-lint"]),
}

# substring in pom.xml / build.gradle -> (tool, type ids)
JVM_TOKENS = [
    ("junit", "junit", ["unit"]),
    ("pitest", "pitest", ["mutation"]),
    ("jqwik", "jqwik", ["property-based"]),
    ("jmh", "jmh", ["benchmark"]),
    ("testcontainers", "testcontainers", ["integration"]),
    ("archunit", "archunit", ["unit"]),
]

CARGO_TOKENS = [
    ("proptest", "proptest", ["property-based"]),
    ("quickcheck", "quickcheck", ["property-based"]),
    ("criterion", "criterion", ["benchmark"]),
    ("insta", "insta", ["snapshot-approval"]),
    ("cargo-mutants", "cargo-mutants", ["mutation"]),
]

GEM_TOKENS = [
    ("rspec", "rspec", ["unit"]),
    ("minitest", "minitest", ["unit"]),
    ("mutant", "mutant", ["mutation"]),
]

# type id -> reference file (Core's taxonomy)
REFERENCES = {
    "static-lint": "references/types-functional.md",
    "type-check": "references/types-functional.md",
    "unit": "references/types-functional.md",
    "integration": "references/types-functional.md",
    "component": "references/types-functional.md",
    "api": "references/types-functional.md",
    "contract": "references/types-functional.md",
    "e2e": "references/types-functional.md",
    "smoke": "references/types-functional.md",
    "regression": "references/types-functional.md",
    "acceptance-bdd": "references/types-functional.md",
    "snapshot-approval": "references/types-functional.md",
    "characterization": "references/types-functional.md",
    "exploratory": "references/types-functional.md",
    "coverage": "references/types-test-quality.md",
    "flakiness": "references/types-test-quality.md",
    "mutation": "references/types-mutation.md",
    "property-based": "references/types-input-generation.md",
    "fuzz": "references/types-input-generation.md",
    "metamorphic": "references/types-input-generation.md",
    "combinatorial": "references/types-input-generation.md",
    "differential": "references/types-input-generation.md",
    "model-based": "references/types-input-generation.md",
    "benchmark": "references/types-nonfunctional.md",
    "load": "references/types-nonfunctional.md",
    "chaos": "references/types-nonfunctional.md",
    "accessibility": "references/types-nonfunctional.md",
    "visual-regression": "references/types-nonfunctional.md",
    "cross-browser": "references/types-nonfunctional.md",
    "i18n": "references/types-nonfunctional.md",
    "usability": "references/types-nonfunctional.md",
    "sast": "references/types-security.md",
    "sca": "references/types-security.md",
    "secrets": "references/types-security.md",
    "dast": "references/types-security.md",
    "iac-policy": "references/types-security.md",
    "container-scan": "references/types-security.md",
    "authz": "references/types-security.md",
    "data-quality": "references/data-sql-databases.md",
    "db-migration": "references/data-sql-databases.md",
    "docs-examples": "references/docs-notebooks-web-assets.md",
    "notebook": "references/docs-notebooks-web-assets.md",
    "link-check": "references/docs-notebooks-web-assets.md",
    "ci-pipeline": "references/infra-iac-containers-ci.md",
}

TYPED_LANGS = {"typescript", "csharp", "go", "rust", "java", "kotlin", "swift"}
PRIORITY_ORDER = {"must": 0, "should": 1, "could": 2}


def rel(root, path):
    return os.path.relpath(path, root).replace(os.sep, "/")


def read_text(path, limit=400_000):
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            return fh.read(limit)
    except OSError:
        return ""


def walk_files(root):
    """Relative forward-slash paths of all files under root.

    Prefers `git ls-files -co --exclude-standard` inside a git work tree
    (respects .gitignore, skips vendored/worktree copies); falls back to a
    pruned os.walk with a fixed skip list.
    """
    try:
        proc = subprocess.run(
            ["git", "-C", root, "ls-files", "-co", "--exclude-standard", "-z"],
            capture_output=True,
            timeout=120,
        )
        if proc.returncode == 0:
            files = [p for p in proc.stdout.decode("utf-8", "replace").split("\0") if p]
            # root-level files even when gitignored (local tool configs)
            seen = set(files)
            with os.scandir(root) as entries:
                for entry in entries:
                    if entry.is_file() and entry.name not in seen:
                        seen.add(entry.name)
                        files.append(entry.name)
            return files
    except (OSError, subprocess.SubprocessError):
        pass
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if _prune_dir(d, dirpath)]
        for name in filenames:
            out.append(rel(root, os.path.join(dirpath, name)))
    return out


def _prune_dir(name, dirpath):
    if name in SKIP_DIRS or name.startswith("node_modules"):
        return False
    if name == ".worktrees":
        return False
    return not (
        name == "worktrees"
        and (os.path.basename(dirpath) == ".claude" or "/.claude" in dirpath)
    )


def ext_of(path):
    _, ext = os.path.splitext(path)
    return ext.lower()


def count_languages(files):
    counts = {}
    for path in files:
        base = os.path.basename(path).lower()
        lang = None
        if base == "dockerfile" or base.endswith(".dockerfile"):
            lang = "dockerfile"
        else:
            ext = ext_of(path)
            for name, exts in LANG_EXTS.items():
                if ext in exts:
                    lang = name
                    break
        if lang:
            counts[lang] = counts.get(lang, 0) + 1
    return {name: {"files": n} for name, n in sorted(counts.items())}


def find_tool(tools, name):
    for t in tools:
        if t["tool"] == name:
            return t
    return None


def add_tool(tools, name, type_ids, evidence):
    if name not in {t["tool"] for t in tools}:
        tools.append({"tool": name, "type_ids": list(type_ids), "evidence": evidence})


def detect_package_json(root, path, tools, frameworks):
    try:
        with open(os.path.join(root, path), encoding="utf-8") as fh:
            pkg = json.load(fh)
    except (OSError, ValueError):
        return
    keys = set()
    for section in ("dependencies", "devDependencies"):
        keys.update((pkg.get(section) or {}).keys())
    for key in sorted(keys):
        low = key.lower()
        if low in NPM_PKGS:
            tool, ids = NPM_PKGS[low]
            add_tool(tools, tool, ids, path)
        for prefix, mapping in NPM_PREFIXES.items():
            if low.startswith(prefix):
                tool, ids = mapping
                add_tool(tools, tool, ids, path)
        for fw in NPM_FRAMEWORKS:
            if (
                low == fw or low.startswith((fw + "/", "@" + fw))
            ) and fw not in frameworks:
                frameworks.append(fw)
    scripts = pkg.get("scripts") or {}
    if "test" in scripts:
        add_tool(tools, "npm-test", ["unit"], path)


def detect_python(root, files, tools, frameworks):
    for path in files:
        base = os.path.basename(path).lower()
        if base not in PY_MANIFESTS:
            continue
        text = read_text(os.path.join(root, path)).lower()
        if not text:
            continue
        for token, tool, ids in PY_TOKENS:
            if re.search(
                r"(?<![a-z0-9_-])" + re.escape(token) + r"(?![a-z0-9_-])", text
            ):
                add_tool(tools, tool, ids, path)
        for fw in PY_API_FRAMEWORKS:
            if (
                re.search(r"(?<![a-z0-9_-])" + fw + r"(?![a-z0-9_-])", text)
                and fw not in frameworks
            ):
                frameworks.append(fw)


def unittest_dirs(root, files):
    """{dir: first matching file} for python test files importing stdlib unittest."""
    found = {}
    for path in files:
        base = os.path.basename(path)
        if not (base.endswith(".py") and (base.startswith("test_") or base.endswith("_test.py"))):
            continue
        text = read_text(os.path.join(root, path))
        if re.search(r"^\s*(import unittest|from unittest\b)", text, re.M):
            found.setdefault(os.path.dirname(path) or ".", path)
    return found


def detect_unittest(root, files, tools):
    # pytest already runs unittest files, so only report unittest when it is absent
    if find_tool(tools, "pytest"):
        return
    dirs = unittest_dirs(root, files)
    if dirs:
        add_tool(tools, "unittest", ["unit"], dirs[sorted(dirs)[0]])


def detect_composer(root, path, tools, frameworks):
    try:
        with open(os.path.join(root, path), encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return
    keys = set()
    for section in ("require", "require-dev"):
        keys.update((data.get(section) or {}).keys())
    for key in keys:
        if key in COMPOSER_PKGS:
            tool, ids = COMPOSER_PKGS[key]
            add_tool(tools, tool, ids, path)
        if key == "laravel/framework" and "laravel" not in frameworks:
            frameworks.append("laravel")


CSPROJ_RE = re.compile(r'PackageReference\s+Include="([^"]+)"', re.I)
CSPROJ_PKGS = [
    ("xunit", "xunit", ["unit"]),
    ("nunit", "nunit", ["unit"]),
    ("mstest", "mstest", ["unit"]),
    ("coverlet", "coverlet", ["coverage"]),
    ("bunit", "bunit", ["component"]),
    ("benchmarkdotnet", "benchmarkdotnet", ["benchmark"]),
    ("fscheck", "fscheck", ["property-based"]),
    ("cscheck", "cscheck", ["property-based"]),
    ("playwright", "playwright-dotnet", ["e2e"]),
]


def detect_csproj(root, path, tools, frameworks):
    text = read_text(os.path.join(root, path)).lower()
    if not text:
        return
    if 'sdk="microsoft.net.sdk.web"' in text and "aspnet" not in frameworks:
        frameworks.append("aspnet")
    for include in CSPROJ_RE.findall(text):
        low = include.lower()
        for token, tool, ids in CSPROJ_PKGS:
            if token in low:
                add_tool(tools, tool, ids, path)


def detect_go(root, files, tools):
    for path in files:
        if os.path.basename(path) == "go.mod":
            text = read_text(os.path.join(root, path))
            if "testify" in text:
                add_tool(tools, "testify", ["unit"], path)
            if "gopter" in text or "rapid" in text:
                add_tool(tools, "gopter/rapid", ["property-based"], path)
            break
    fuzz_evidence = bench_evidence = None
    for path in files:
        if ext_of(path) != ".go":
            continue
        text = read_text(os.path.join(root, path))
        if fuzz_evidence is None and re.search(r"func\s+Fuzz", text):
            fuzz_evidence = path
        if bench_evidence is None and re.search(r"func\s+Benchmark", text):
            bench_evidence = path
        if fuzz_evidence and bench_evidence:
            break
    if fuzz_evidence:
        add_tool(tools, "go-fuzz", ["fuzz"], fuzz_evidence)
    if bench_evidence:
        add_tool(tools, "go-benchmark", ["benchmark"], bench_evidence)


def detect_cargo(root, path, files, tools):
    text = read_text(os.path.join(root, path)).lower()
    for token, tool, ids in CARGO_TOKENS:
        if token in text:
            add_tool(tools, tool, ids, path)
    if any(p == "fuzz" or p.startswith("fuzz/") for p in files):
        add_tool(tools, "cargo-fuzz", ["fuzz"], "fuzz")


def detect_terraform(root, files, tools):
    for path in files:
        if path.endswith(".tftest.hcl"):
            add_tool(tools, "terraform-test", ["unit"], path)
            break
    for path in files:
        if os.path.basename(path) in (".tflint.hcl", "tflint.hcl") or path.endswith(
            "/.tflint.hcl"
        ):
            add_tool(tools, "tflint", ["static-lint", "iac-policy"], path)
            break
    for path in files:
        if os.path.basename(path).lower() in (
            "checkov.yml",
            "checkov.yaml",
            ".checkov.yml",
            ".checkov.yaml",
        ):
            add_tool(tools, "checkov", ["iac-policy"], path)
            break
    for path in files:
        if os.path.basename(path).lower() in (
            ".tfsec.json",
            "trivy.yaml",
            ".trivy.yaml",
            "trivy.yml",
        ):
            add_tool(tools, "trivy", ["iac-policy", "container-scan"], path)
            break
    for path in files:
        if (
            ext_of(path) == ".go"
            and "terratest" in read_text(os.path.join(root, path)).lower()
        ):
            add_tool(tools, "terratest", ["integration"], path)
            break


def detect_workflows(root, files, tools, ci):
    for path in files:
        if path.startswith(".github/workflows/"):
            ci.append(path)
    if ci:
        add_tool(tools, "github-actions", ["ci-pipeline"], ci[0])
    for path in list(ci):
        text = read_text(os.path.join(root, path)).lower()
        if "codeql" in text:
            add_tool(tools, "codeql", ["sast"], path)
        for token in ("checkov", "tfsec", "trivy"):
            if token in text:
                add_tool(tools, token, ["iac-policy"], path)
                break
        if "shellcheck" in text:
            add_tool(tools, "shellcheck", ["static-lint"], path)
        if "gitleaks" in text:
            add_tool(tools, "gitleaks", ["secrets"], path)


def detect_misc_files(root, files, tools, ci):
    basenames = {os.path.basename(p).lower(): p for p in files}
    if any(
        p == ".github/dependabot.yml" or p == ".github/dependabot.yaml" for p in files
    ):
        add_tool(tools, "dependabot", ["sca"], ".github/dependabot.yml")
    for p in files:
        if os.path.basename(p).lower().startswith("renovate"):
            add_tool(tools, "renovate", ["sca"], p)
            break
    if ".pre-commit-config.yaml" in basenames:
        add_tool(
            tools, "pre-commit", ["static-lint"], basenames[".pre-commit-config.yaml"]
        )
    if ".gitleaks.toml" in basenames:
        add_tool(tools, "gitleaks", ["secrets"], basenames[".gitleaks.toml"])
    if ".semgrep.yml" in basenames or any(p.startswith(".semgrep/") for p in files):
        add_tool(tools, "semgrep", ["sast"], basenames.get(".semgrep.yml", ".semgrep"))
    for name, path in basenames.items():
        if name in (".hadolint.yaml", ".hadolint.yml"):
            add_tool(tools, "hadolint", ["static-lint"], path)
        if name in ("bicepconfig.json", "bicepconfig.yaml"):
            add_tool(tools, "bicep", ["type-check"], path)
        if name in ("ps-rule.yaml", "psrule.yaml", "ps-rule.yml"):
            add_tool(tools, "psrule", ["iac-policy"], path)
        if name in ("mlc_config.json",):
            add_tool(tools, "markdown-link-check", ["link-check"], path)
        if name in (
            ".markdownlint-cli2.jsonc",
            ".markdownlint-cli2.yaml",
            ".markdownlint-cli2.yml",
            ".markdownlint-cli2.json",
        ):
            add_tool(tools, "markdownlint-cli2", ["static-lint"], path)
        if name in (
            ".markdownlint.yaml",
            ".markdownlint.yml",
            ".markdownlintrc",
            ".markdownlint.json",
        ) and not any(b.startswith(".markdownlint-cli2") for b in basenames):
            add_tool(tools, "markdownlint-cli", ["static-lint"], path)
        if name.startswith("lighthouserc"):
            add_tool(tools, "lighthouse", ["accessibility", "benchmark"], path)
        if name in (".sqlfluff",) or name == "sqlfluff" or name == ".sqlfluffignore":
            add_tool(tools, "sqlfluff", ["static-lint"], path)
        if name == "dbt_project.yml":
            add_tool(tools, "dbt", ["data-quality"], path)
        if name == ".shellcheckrc":
            add_tool(tools, "shellcheck", ["static-lint"], path)
    if "dotnet-tools.json" in basenames:
        text = read_text(os.path.join(root, basenames["dotnet-tools.json"])).lower()
        if "stryker" in text:
            add_tool(
                tools, "stryker-dotnet", ["mutation"], basenames["dotnet-tools.json"]
            )
    # pgTAP: any .sql exercising pgTAP plan functions
    for path in files:
        if ext_of(path) == ".sql":
            low = read_text(os.path.join(root, path)).lower()
            if "pgtap" in low or "select plan(" in low:
                add_tool(tools, "pgtap", ["unit"], path)
                break


def detect_test_files(files, tools):
    test_dirs = {"tests", "__tests__", "spec", "test"}
    for path in files:
        parts = path.split("/")
        if len(parts) > 1 and any(seg in test_dirs for seg in parts[:-1]):
            add_tool(tools, "test-files", ["unit"], path)
            return
    for path in files:
        base = os.path.basename(path).lower()
        if (
            base.endswith(("_test.go", "tests.cs"))
            or ".test." in base
            or ".spec." in base
        ):
            add_tool(tools, "test-files", ["unit"], path)
            return


def lang_of_file(path):
    """Language name for a path, or None (dockerfile-name excluded)."""
    ext = ext_of(path)
    for name, exts in LANG_EXTS.items():
        if ext in exts:
            return name
    return None


# tool -> areas its type ids cover; ALL means every detected area
TOOL_AREAS = {
    "pytest": ("python",),
    "unittest": ("python",),
    "coverage-py": ("python",),
    "pytest-cov": ("python",),
    "hypothesis": ("python",),
    "mutmut": ("python",),
    "cosmic-ray": ("python",),
    "schemathesis": ("python",),
    "locust": ("python",),
    "ruff": ("python",),
    "mypy": ("python",),
    "pyright": ("python",),
    "atheris": ("python",),
    "great-expectations": ("python",),
    "pytest-benchmark": ("python",),
    "bandit": ("python",),
    "nbval": ("python", "notebook"),
    "nbmake": ("python", "notebook"),
    "vitest": ("typescript", "javascript", "frontend"),
    "jest": ("typescript", "javascript", "frontend"),
    "mocha": ("typescript", "javascript", "frontend"),
    "nyc": ("typescript", "javascript", "frontend"),
    "playwright": ("typescript", "javascript", "frontend"),
    "cypress": ("typescript", "javascript", "frontend"),
    "storybook": ("typescript", "javascript", "frontend"),
    "msw": ("typescript", "javascript", "frontend"),
    "pact": ("typescript", "javascript", "frontend"),
    "fast-check": ("typescript", "javascript", "frontend"),
    "stryker-js": ("typescript", "javascript", "frontend"),
    "eslint": ("typescript", "javascript", "frontend"),
    "npm-test": ("typescript", "javascript", "frontend"),
    "testing-library": ("typescript", "javascript", "frontend"),
    "axe-core": ("frontend", "typescript", "javascript"),
    "typescript": ("typescript", "javascript"),
    "xunit": ("csharp",),
    "nunit": ("csharp",),
    "mstest": ("csharp",),
    "coverlet": ("csharp",),
    "bunit": ("csharp",),
    "benchmarkdotnet": ("csharp",),
    "fscheck": ("csharp",),
    "cscheck": ("csharp",),
    "playwright-dotnet": ("csharp",),
    "stryker-dotnet": ("csharp",),
    "dotnet-test": ("csharp",),
    "phpunit": ("php",),
    "pest": ("php",),
    "infection": ("php",),
    "phpstan": ("php",),
    "psalm": ("php",),
    "xctest": ("swift",),
    "swift-testing": ("swift",),
    "testify": ("go",),
    "go-fuzz": ("go",),
    "go-benchmark": ("go",),
    "gopter/rapid": ("go",),
    "proptest": ("rust",),
    "quickcheck": ("rust",),
    "criterion": ("rust",),
    "insta": ("rust",),
    "cargo-mutants": ("rust",),
    "cargo-fuzz": ("rust",),
    "junit": ("java",),
    "pitest": ("java",),
    "jqwik": ("java",),
    "jmh": ("java",),
    "testcontainers": ("java",),
    "archunit": ("java",),
    "rspec": ("ruby",),
    "minitest": ("ruby",),
    "mutant": ("ruby",),
    "pester": ("powershell",),
    "bats": ("shell",),
    "shellcheck": ("shell",),
    "terraform-test": ("iac",),
    "tflint": ("iac",),
    "checkov": ("iac",),
    "terratest": ("iac",),
    "psrule": ("iac",),
    "trivy": ("iac", "containers"),
    "bicep": ("bicep",),
    "hadolint": ("containers",),
    "sqlfluff": ("sql",),
    "pgtap": ("sql",),
    "dbt": ("data",),
    "markdownlint-cli": ("markdown",),
    "markdownlint-cli2": ("markdown",),
    "markdown-link-check": ("markdown",),
    "lighthouse": ("frontend",),
    "gitleaks": ("ALL",),
    "semgrep": ("ALL",),
    "codeql": ("ALL",),
    "dependabot": ("ALL",),
    "renovate": ("ALL",),
    "pre-commit": ("ALL",),
    "k6": ("ALL",),
    "artillery": ("ALL",),
    "github-actions": ("ci", "yaml-ci"),
}


def tool_areas(name, evidence):
    if name == "test-files":
        lang = lang_of_file(evidence)
        return (lang,) if lang else ()
    return TOOL_AREAS.get(name, ("ALL",))


def has_migrations(files):
    for path in files:
        parts = path.lower().split("/")
        if (
            any(seg in ("migrations", "migrate") for seg in parts[:-1])
            or "alembic/versions" in "/".join(parts[:-1])
            or "drizzle" in parts[:-1]
        ):
            return True
    return False


def _collect(root):
    root = os.path.abspath(root)
    files = walk_files(root)
    languages = count_languages(files)
    tools = []
    frameworks = []
    ci = []
    detect_python(root, files, tools, frameworks)
    detect_go(root, files, tools)
    detect_test_files(files, tools)
    for path in files:
        base = os.path.basename(path)
        low = base.lower()
        if base == "package.json":
            detect_package_json(root, path, tools, frameworks)
        elif base == "composer.json":
            detect_composer(root, path, tools, frameworks)
        elif low.endswith(".csproj"):
            detect_csproj(root, path, tools, frameworks)
        elif base == "Cargo.toml":
            detect_cargo(root, path, files, tools)
        elif base in ("pom.xml", "build.gradle", "build.gradle.kts"):
            text = read_text(os.path.join(root, path)).lower()
            for token, tool, ids in JVM_TOKENS:
                if token in text:
                    add_tool(tools, tool, ids, path)
        elif base == "Gemfile":
            text = read_text(os.path.join(root, path)).lower()
            for token, tool, ids in GEM_TOKENS:
                if token in text:
                    add_tool(tools, tool, ids, path)
    detect_terraform(root, files, tools)
    detect_workflows(root, files, tools, ci)
    detect_misc_files(root, files, tools, ci)
    detect_unittest(root, files, tools)
    # XCTest via Package.swift or xcodeproj
    swift_pkg = next((p for p in files if os.path.basename(p) == "Package.swift"), None)
    xcodeproj = next(
        (
            p
            for p in files
            if p.endswith(".xcodeproj/project.pbxproj") or ".xcodeproj/" in p
        ),
        None,
    )
    if swift_pkg:
        add_tool(tools, "xctest", ["unit"], swift_pkg)
        if "swift-testing" in read_text(os.path.join(root, swift_pkg)).lower():
            add_tool(tools, "swift-testing", ["unit"], swift_pkg)
    elif xcodeproj:
        add_tool(tools, "xctest", ["unit"], xcodeproj)
    # Pester / bats by file pattern
    for path in files:
        low = os.path.basename(path).lower()
        if low.endswith(".tests.ps1"):
            add_tool(tools, "pester", ["unit", "integration"], path)
            break
    for path in files:
        if os.path.basename(path).lower().endswith(".bats"):
            add_tool(tools, "bats", ["unit"], path)
            break
    # dotnet test default when csproj present
    if any(p.lower().endswith(".csproj") for p in files):
        add_tool(
            tools,
            "dotnet-test",
            ["unit", "coverage"],
            next(p for p in files if p.lower().endswith(".csproj")),
        )
    return {
        "languages": languages,
        "frameworks": frameworks,
        "test_tools": tools,
        "ci": ci,
    }, files


def detect(root):
    return _collect(root)[0]


# --------------------------------------------------------------------------
# gaps
# --------------------------------------------------------------------------

REASONS = {
    "static-lint": "lint catches defect classes before tests run",
    "type-check": "type errors surface without executing code",
    "unit": "fast isolation of logic defects",
    "integration": "verifies modules work together against real seams",
    "coverage": "measures which behavior tests actually exercise",
    "mutation": "checks test strength by mutating code under test",
    "property-based": "generates inputs beyond hand-picked examples",
    "fuzz": "random inputs find crashes and unhandled errors",
    "benchmark": "guards performance regressions",
    "load": "verifies behavior under realistic traffic",
    "api": "exercises the HTTP contract end to end",
    "contract": "locks provider/consumer API expectations",
    "dast": "runtime security testing of the running service",
    "authz": "authorization checks protect regulated client data",
    "e2e": "validates real user journeys",
    "accessibility": "regulated and public UIs must be accessible",
    "visual-regression": "catches unintended UI changes",
    "cross-browser": "UI must behave across browser engines",
    "sast": "static security analysis of first-party code",
    "sca": "third-party dependencies carry most known CVEs",
    "secrets": "committed credentials are a top incident source",
    "ci-pipeline": "tests only protect code when they run on changes",
    "iac-policy": "misconfigured infrastructure leaks data",
    "container-scan": "image layers carry CVEs and secrets",
    "data-quality": "client financial data must stay valid",
    "db-migration": "migrations can lose or corrupt client data",
    "notebook": "notebooks must execute top to bottom",
    "docs-examples": "broken doc examples mislead users",
    "link-check": "broken links erode doc trust",
}


# non-executable and infra languages get tailored baselines, not executable ones
NONEXEC_BASELINES = {
    "css": [("static-lint", "should"), ("visual-regression", "should")],
    "markdown": [
        ("static-lint", "should"),
        ("link-check", "should"),
        ("docs-examples", "could"),
    ],
    "html": [
        ("static-lint", "should"),
        ("accessibility", "should"),
        ("link-check", "could"),
    ],
    "notebook": [("notebook", "should"), ("static-lint", "could")],
    "yaml-ci": [("ci-pipeline", "must")],
    "sql": [("static-lint", "should")],
    # terraform/bicep covered by the iac area, dockerfile by containers
    "terraform": [],
    "bicep": [],
    "dockerfile": [],
}


def lang_rows(area, lang):
    if lang in NONEXEC_BASELINES:
        return [(area, tid, prio) for tid, prio in NONEXEC_BASELINES[lang]]
    rows = [
        ("static-lint", "must"),
        ("unit", "must"),
        ("integration", "should"),
        ("coverage", "should"),
        ("mutation", "should"),
        ("property-based", "could"),
        ("benchmark", "could"),
    ]
    rows.append(("type-check", "must" if lang in TYPED_LANGS else "should"))
    rows.append(("fuzz", "should" if lang in ("go", "rust", "python") else "could"))
    return [(area, tid, prio) for tid, prio in rows]


def baseline_rows(languages, frameworks, files):
    """[(area, type_id, priority)] before presence marking."""
    rows = []
    for lang in languages:
        rows.extend(lang_rows(lang, lang))
    # any repo
    rows.append(("security", "sca", "must"))
    rows.append(("security", "secrets", "must"))
    rows.append(("security", "sast", "should"))
    rows.append(("ci", "ci-pipeline", "must"))
    # UI
    ui = (
        any(fw in frameworks for fw in ("react", "vue", "svelte", "next"))
        or "css" in languages
        or "html" in languages
    )
    if ui:
        rows.extend(
            [
                ("frontend", "accessibility", "must"),
                ("frontend", "visual-regression", "should"),
                ("frontend", "e2e", "must"),
                ("frontend", "cross-browser", "could"),
            ]
        )
    # HTTP API frameworks
    api_fw = {"fastapi", "flask", "django", "express", "nest", "aspnet", "laravel"}
    if any(fw in api_fw for fw in frameworks):
        rows.extend(
            [
                ("api", "api", "must"),
                ("api", "authz", "must"),
                ("api", "contract", "should"),
                ("api", "dast", "should"),
            ]
        )
    # IaC
    if "terraform" in languages or "bicep" in languages:
        rows.extend(
            [
                ("iac", "iac-policy", "must"),
                ("iac", "unit", "should"),
                ("iac", "static-lint", "should"),
                ("iac", "integration", "could"),
            ]
        )
    # containers
    if "dockerfile" in languages:
        rows.extend(
            [
                ("containers", "container-scan", "must"),
                ("containers", "static-lint", "should"),
            ]
        )
    # data
    if "sql" in languages:
        if has_migrations(files):
            rows.append(("data", "db-migration", "must"))
        else:
            rows.append(("data", "db-migration", "should"))
        rows.append(("data", "data-quality", "should"))
    return rows


def gaps(root):
    det, files = _collect(root)
    tools = det["test_tools"]
    rows = baseline_rows(det["languages"], det["frameworks"], files)
    out = []
    for area, tid, prio in rows:
        present = any(
            tid in t["type_ids"]
            and (
                "ALL" in tool_areas(t["tool"], t["evidence"])
                or area in tool_areas(t["tool"], t["evidence"])
            )
            for t in tools
        )
        out.append(
            {
                "area": area,
                "type_id": tid,
                "status": "present" if present else "missing",
                "priority": prio,
                "reason": REASONS.get(tid, "recommended for this stack"),
                "reference": REFERENCES.get(tid, "references/taxonomy.md"),
            }
        )
    out.sort(key=lambda r: (PRIORITY_ORDER[r["priority"]], r["area"], r["type_id"]))
    return out


# --------------------------------------------------------------------------
# commands
# --------------------------------------------------------------------------


def pytest_cmd(root):
    if os.path.exists(os.path.join(root, "uv.lock")):
        return "uv run pytest"
    return "python -m pytest"


def bats_dir(root, tools):
    ev = find_tool(tools, "bats")
    if ev:
        return os.path.dirname(ev["evidence"]) or "."
    return "test"


def command_rows(root):
    det = detect(root)
    tools = det["test_tools"]
    out = []

    def add(tool, tid, command, note=None):
        row = {"tool": tool, "type_id": tid, "command": command}
        if note:
            row["note"] = note
        out.append(row)

    names = {t["tool"] for t in tools}
    has_uv = os.path.exists(os.path.join(root, "uv.lock"))
    if "npm-test" in names:
        add("npm-test", "unit", "npm test")
    if "vitest" in names:
        add("vitest", "unit", "npx vitest run")
    if "jest" in names:
        add("jest", "unit", "npx jest")
    if "mocha" in names:
        add("mocha", "unit", "npx mocha")
    if "playwright" in names:
        add("playwright", "e2e", "npx playwright test")
    if "cypress" in names:
        add("cypress", "e2e", "npx cypress run")
    if "stryker-js" in names:
        add("stryker-js", "mutation", "npx stryker run")
    if "eslint" in names:
        add("eslint", "static-lint", "npx eslint .")
    if "typescript" in names:
        add("typescript", "type-check", "npx tsc --noEmit")
    if "axe-core" in names:
        # axe runs as assertions inside a test runner; no standalone CLI flag
        if "vitest" in names:
            add(
                "axe-core",
                "accessibility",
                "npx vitest run",
                note="runs inside the vitest suite (axe-core assertions)",
            )
        elif "jest" in names:
            add(
                "axe-core",
                "accessibility",
                "npx jest",
                note="runs inside the jest suite (axe-core assertions)",
            )
        elif "pytest" in names:
            add(
                "axe-core",
                "accessibility",
                pytest_cmd(root),
                note="runs inside the pytest suite (axe-core assertions)",
            )
    if "pytest" in names or "pytest-cov" in names or "hypothesis" in names:
        cmd = pytest_cmd(root)
        if "pytest-cov" in names or "coverage-py" in names:
            cmd += " --cov"
        add("pytest", "unit", cmd)
    if "unittest" in names:
        for d in sorted(unittest_dirs(root, walk_files(root))):
            tests_here = [
                f for f in os.listdir(os.path.join(root, d)) if f.startswith("test_") and f.endswith(".py")
            ]
            if d == ".":
                cmd = "python3 -m unittest discover"
            else:
                pat = "test_*.py" if tests_here else "*_test.py"
                cmd = f"python3 -m unittest discover -s {d} -p '{pat}'"
            add("unittest", "unit", cmd)
    if "mutmut" in names:
        # mutmut installs a console script; `python -m mutmut` has no __main__
        add(
            "mutmut",
            "mutation",
            "uv run mutmut run" if has_uv else "mutmut run",
        )
    if "ruff" in names:
        add(
            "ruff",
            "static-lint",
            "uv run ruff check ." if has_uv else "ruff check .",
        )
    if "mypy" in names:
        add(
            "mypy",
            "type-check",
            "uv run mypy ." if has_uv else "mypy .",
        )
    if "bandit" in names:
        add(
            "bandit",
            "sast",
            "uv run bandit -r ." if has_uv else "bandit -r .",
        )
    if "locust" in names:
        add(
            "locust",
            "load",
            "uv run locust" if has_uv else "locust",
        )
    if "nbmake" in names:
        add("nbmake", "notebook", pytest_cmd(root) + " --nbmake")
    if (
        "go-fuzz" in names
        or "testify" in names
        or det["languages"].get("go", {}).get("files", 0)
    ):
        add("go-test", "unit", "go test ./...")
    if "go-fuzz" in names:
        fuzz_ev = find_tool(tools, "go-fuzz")
        m = re.search(
            r"func\s+(Fuzz\w+)",
            read_text(os.path.join(root, fuzz_ev["evidence"])) if fuzz_ev else "",
        )
        if m:
            add("go-fuzz", "fuzz", f"go test -fuzz={m.group(1)}")
    if "go-benchmark" in names:
        add("go-benchmark", "benchmark", "go test -bench=. ./...")
    if "cargo-mutants" in names:
        add("cargo-mutants", "mutation", "cargo mutants")
    if "cargo-fuzz" in names:
        add("cargo-fuzz", "fuzz", "cargo fuzz run")
    if det["languages"].get("rust", {}).get("files", 0) or "criterion" in names:
        add("cargo-test", "unit", "cargo test")
    if "criterion" in names:
        add("criterion", "benchmark", "cargo bench")
    if any(p.lower().endswith(".csproj") for p in walk_files(root)):
        add("dotnet-test", "unit", "dotnet test")
    if "stryker-dotnet" in names:
        add("stryker-dotnet", "mutation", "dotnet stryker")
    if "pester" in names:
        add("pester", "unit", "Invoke-Pester")
    if "bats" in names:
        add("bats", "unit", f"bats {bats_dir(root, tools)}/")
    if "terraform-test" in names:
        add("terraform-test", "unit", "terraform test")
    if "tflint" in names:
        add("tflint", "static-lint", "tflint")
    if "checkov" in names:
        add("checkov", "iac-policy", "checkov -d .")
    if "trivy" in names:
        add("trivy", "iac-policy", "trivy config .")
    if "phpunit" in names:
        add("phpunit", "unit", "vendor/bin/phpunit")
    if "pest" in names:
        add("pest", "unit", "vendor/bin/pest")
    if "infection" in names:
        add("infection", "mutation", "vendor/bin/infection")
    if "phpstan" in names:
        add("phpstan", "static-lint", "vendor/bin/phpstan analyse")
    if "psalm" in names:
        add("psalm", "static-lint", "vendor/bin/psalm")
    if "rspec" in names:
        add("rspec", "unit", "bundle exec rspec")
    if "minitest" in names:
        add("minitest", "unit", "bundle exec rake test")
    if "junit" in names:
        has_wrapper = os.path.exists(os.path.join(root, "mvnw"))
        add("junit", "unit", "./mvnw test" if has_wrapper else "mvn test")
    has_gradlew = os.path.exists(os.path.join(root, "gradlew"))
    if "pitest" in names or "jqwik" in names or "jmh" in names:
        add("gradle-test", "unit", "./gradlew test" if has_gradlew else "gradle test")
    if "gitleaks" in names:
        add("gitleaks", "secrets", "gitleaks detect")
    if "semgrep" in names:
        add("semgrep", "sast", "semgrep scan")
    if "pre-commit" in names:
        add("pre-commit", "static-lint", "pre-commit run --all-files")
    if "sqlfluff" in names:
        add("sqlfluff", "static-lint", "sqlfluff lint .")
    if "dbt" in names:
        add("dbt", "data-quality", "dbt test")
    if "hadolint" in names:
        add("hadolint", "static-lint", "hadolint Dockerfile")
    if "markdownlint-cli2" in names:
        add("markdownlint-cli2", "static-lint", 'npx markdownlint-cli2 "**/*.md"')
    if "markdownlint-cli" in names:
        add("markdownlint-cli", "static-lint", "npx markdownlint .")
    if "schemathesis" in names:
        add("schemathesis", "api", "schemathesis run <schema-url>")
    return out


# --------------------------------------------------------------------------
# markdown rendering
# --------------------------------------------------------------------------


def md_detect(det):
    lines = ["# detect", "", "## Languages", "", "| Language | Files |", "|---|---|"]
    for lang, info in det["languages"].items():
        lines.append(f"| {lang} | {info['files']} |")
    lines += ["", "## Frameworks", ""]
    lines += [f"- {fw}" for fw in det["frameworks"]] or ["- none"]
    lines += [
        "",
        "## Test tools",
        "",
        "| Tool | Type IDs | Evidence |",
        "|---|---|---|",
    ]
    for t in det["test_tools"]:
        ids = ", ".join(t["type_ids"])
        lines.append(f"| {t['tool']} | {ids} | {t['evidence']} |")
    lines += ["", "## CI files", ""]
    lines += [f"- {p}" for p in det["ci"]] or ["- none"]
    return "\n".join(lines) + "\n"


def md_gaps(rows):
    lines = [
        "# gaps",
        "",
        "| Area | Type | Status | Priority | Reason | Reference |",
        "|---|---|---|---|---|---|",
    ]
    for r in rows:
        lines.append(
            f"| {r['area']} | {r['type_id']} | {r['status']} | {r['priority']} "
            f"| {r['reason']} | {r['reference']} |"
        )
    return "\n".join(lines) + "\n"


def md_commands(rows):
    lines = [
        "# commands",
        "",
        "| Tool | Type | Command | Note |",
        "|---|---|---|---|",
    ]
    for r in rows:
        lines.append(
            f"| {r['tool']} | {r['type_id']} | `{r['command']}` | {r.get('note', '')} |"
        )
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="testscope",
        description="Detect test tooling, testing gaps, and run commands.",
    )
    parser.add_argument("command", choices=["detect", "gaps", "commands"])
    parser.add_argument("--root", default=os.getcwd())
    parser.add_argument("--format", default="json", choices=["json", "md"])
    args = parser.parse_args(argv)
    root = os.path.abspath(os.path.expanduser(args.root))
    if args.command == "detect":
        result = detect(root)
    elif args.command == "gaps":
        result = gaps(root)
    else:
        result = command_rows(root)
    if args.format == "md":
        if args.command == "detect":
            sys.stdout.write(md_detect(result))
        elif args.command == "gaps":
            sys.stdout.write(md_gaps(result))
        else:
            sys.stdout.write(md_commands(result))
    else:
        json.dump(result, sys.stdout, indent=2)
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
