#!/usr/bin/env python3
# The atlas Python suites run in CI as two parallel tiers (see .github/workflows/tests.yml). The slow set lives
# only in plugins/atlas/ci-slow-tests.txt. These tests keep that list honest and prove that no test file can
# fall out of CI: every test_*.py under hooks/ and scripts/ lands in exactly one tier.
import _test_isolation  # noqa: F401,E402  (redirects ~/.atlas to a tempdir)
import pathlib
import re
import subprocess
import sys
import unittest
from typing import List, Set

PLUGIN_ROOT = pathlib.Path(__file__).resolve().parent.parent
SLOW_LIST = PLUGIN_ROOT / "ci-slow-tests.txt"
WORKFLOW = PLUGIN_ROOT.parent.parent / ".github" / "workflows" / "tests.yml"
TIER_DIRS = ("hooks", "scripts")


def slow_entries() -> List[str]:
    out = []
    for raw in SLOW_LIST.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#"):
            out.append(line)
    return out


def all_test_files() -> Set[str]:
    found = set()
    for d in TIER_DIRS:
        for p in (PLUGIN_ROOT / d).rglob("test_*.py"):
            if "__pycache__" not in p.parts:
                found.add(p.relative_to(PLUGIN_ROOT).as_posix())
    return found


def tiers(files: Set[str], slow: List[str]) -> tuple:
    # Same rule the workflow applies: listed means slow, everything else is fast.
    slow_set = set(slow)
    return files - slow_set, files & slow_set


def _job(text: str, name: str) -> str:
    m = re.search(r"^  %s:\n(.*?)(?=^  [A-Za-z0-9_-]+:\n|\Z)" % re.escape(name), text, re.S | re.M)
    assert m, "job %s missing from tests.yml" % name
    return m.group(1)


class TestSlowList(unittest.TestCase):
    def test_every_entry_names_an_existing_test_file(self) -> None:
        entries = slow_entries()
        self.assertTrue(entries, "the slow list is empty, so the tiers would not be split")
        missing = [e for e in entries if not (PLUGIN_ROOT / e).is_file()]
        self.assertEqual([], missing, "ci-slow-tests.txt names files that do not exist")

    def test_entries_are_test_files_under_a_tier_dir_without_duplicates(self) -> None:
        entries = slow_entries()
        for e in entries:
            self.assertRegex(e, r"^(hooks|scripts)/test_[^/]+\.py$", e)
        self.assertEqual(len(entries), len(set(entries)), "duplicate lines in ci-slow-tests.txt")

    def test_a_missing_file_is_detected(self) -> None:
        # Guards the existence check itself: a made-up entry must show up as missing.
        entries = slow_entries() + ["hooks/test_does_not_exist_zz.py"]
        missing = [e for e in entries if not (PLUGIN_ROOT / e).is_file()]
        self.assertEqual(["hooks/test_does_not_exist_zz.py"], missing)


class TestTierPartition(unittest.TestCase):
    def test_every_test_file_is_in_exactly_one_tier(self) -> None:
        files = all_test_files()
        slow = slow_entries()
        fast_set, slow_set = tiers(files, slow)
        self.assertEqual(set(), fast_set & slow_set)
        self.assertEqual(files, fast_set | slow_set)
        self.assertEqual(set(slow), slow_set)

    def test_a_new_test_file_is_fast_by_default(self) -> None:
        files = all_test_files() | {"hooks/test_brand_new_zz.py", "scripts/test_brand_new_zz.py"}
        fast_set, slow_set = tiers(files, slow_entries())
        self.assertIn("hooks/test_brand_new_zz.py", fast_set)
        self.assertIn("scripts/test_brand_new_zz.py", fast_set)
        self.assertNotIn("hooks/test_brand_new_zz.py", slow_set)

    def test_pytest_collects_each_test_file_in_the_fast_job_command_once_and_no_slow_file(self) -> None:
        # Runs the fast job's real selection (hooks scripts plus one --ignore per slow line) in collect-only mode.
        files = all_test_files()
        fast_set, slow_set = tiers(files, slow_entries())
        args = [sys.executable, "-m", "pytest", "--collect-only", "-q", "-p", "no:cacheprovider", "hooks", "scripts"]
        args += ["--ignore=" + e for e in slow_entries()]
        out = subprocess.run(args, cwd=str(PLUGIN_ROOT), capture_output=True, text=True, timeout=280)
        collected = {line.split("::", 1)[0] for line in out.stdout.splitlines() if "::" in line}
        self.assertEqual(set(), collected & slow_set, "a slow file is still collected by the fast job")
        self.assertEqual(set(), fast_set - collected, "a fast file is not collected by the fast job: " + out.stdout[-400:])


class TestWorkflowUsesTheList(unittest.TestCase):
    def setUp(self) -> None:
        self.text = WORKFLOW.read_text(encoding="utf-8")

    def test_fast_job_ignores_the_listed_files_and_runs_both_dirs(self) -> None:
        job = _job(self.text, "atlas-py-fast")
        self.assertIn("ci-slow-tests.txt", job)
        self.assertIn("--ignore=", job)
        self.assertRegex(job, r"pytest[^\n]*\bhooks scripts\b")

    def test_slow_job_runs_the_listed_files_for_each_dir(self) -> None:
        job = _job(self.text, "atlas-py-slow")
        self.assertIn("ci-slow-tests.txt", job)
        self.assertRegex(job, r"dir:\s*\[hooks, scripts\]")
        self.assertIn("matrix.dir", job)

    def test_every_atlas_suite_runs_on_pull_requests(self) -> None:
        for name in ("atlas-py-fast", "atlas-py-slow", "atlas-bun", "atlas-herdr"):
            job = _job(self.text, name)
            self.assertNotRegex(job, r"if:\s*github\.event_name\s*!=\s*'pull_request'", name)
        self.assertIn("bun test omp mod", _job(self.text, "atlas-bun"))
        herdr = _job(self.text, "atlas-herdr")
        self.assertIn("bun run test:unit", herdr)
        self.assertIn("bun run test:integration", herdr)
        self.assertIn("colony/herdr-web-ui", herdr)


if __name__ == "__main__":
    unittest.main()
