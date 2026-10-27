"""Every rule must fire exactly on its seeded violations and stay quiet on its clean fixture.

Fixtures live in tests/fixtures/rules/<RULE>/{bad,good}/. Each expected finding is marked
with '# expect: RULE' on the line the finding must be reported on.
"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))

from principles.catalog import RULES, RULES_BY_ID  # noqa: E402
from principles.engine import scan  # noqa: E402
from principles import rules_file, rules_repo  # noqa: E402

FIXTURES = HERE / "fixtures" / "rules"
EXPECT = re.compile(r"#\s*expect:\s*([A-Z0-9, ]+)")


def expected(root: Path, rule_id: str) -> set[tuple[str, int]]:
    out = set()
    for path in sorted(root.rglob("*.py")):
        for no, line in enumerate(path.read_text().splitlines(), 1):
            m = EXPECT.search(line)
            if m and rule_id in {r.strip() for r in m.group(1).split(",")}:
                out.add((path.relative_to(root).as_posix(), no))
    return out


def found(root: Path, rule_id: str) -> set[tuple[str, int]]:
    result = scan(root, {}, only=[rule_id])
    assert not result.errors, result.errors
    return {(f.path, f.line) for f in result.findings}


class RuleFixtures(unittest.TestCase):
    def test_every_rule_has_bad_and_good_fixtures(self):
        for rule in RULES:
            with self.subTest(rule=rule.id):
                bad, good = FIXTURES / rule.id / "bad", FIXTURES / rule.id / "good"
                self.assertTrue(any(bad.rglob("*.py")), f"missing {bad}")
                self.assertTrue(any(good.rglob("*.py")), f"missing {good}")
                self.assertTrue(expected(bad, rule.id), f"{bad} has no '# expect: {rule.id}' markers")

    def test_rule_fires_on_seeded_violations(self):
        for rule in RULES:
            with self.subTest(rule=rule.id):
                root = FIXTURES / rule.id / "bad"
                self.assertEqual(found(root, rule.id), expected(root, rule.id))

    def test_rule_is_quiet_on_clean_code(self):
        for rule in RULES:
            with self.subTest(rule=rule.id):
                self.assertEqual(found(FIXTURES / rule.id / "good", rule.id), set())

    def test_disabling_a_rule_breaks_its_test(self):
        """Seeded-fault check: with the rule's check replaced by a no-op, its fixture test must fail."""
        for rule in RULES:
            with self.subTest(rule=rule.id):
                table = rules_repo.REPO_CHECKS if rule.scope == "repo" else rules_file.FILE_CHECKS
                original = table[rule.id]
                table[rule.id] = lambda *a, **k: []
                try:
                    root = FIXTURES / rule.id / "bad"
                    self.assertNotEqual(found(root, rule.id), expected(root, rule.id))
                finally:
                    table[rule.id] = original

    def test_every_catalog_rule_is_implemented(self):
        implemented = set(rules_file.FILE_CHECKS) | set(rules_repo.REPO_CHECKS)
        self.assertEqual(implemented, set(RULES_BY_ID))
        for rule in RULES:
            table = rules_repo.REPO_CHECKS if rule.scope == "repo" else rules_file.FILE_CHECKS
            self.assertIn(rule.id, table, f"{rule.id} scope={rule.scope} is registered in the wrong table")


class Err001Messages(unittest.TestCase):
    def test_discard_and_fallback_handlers_get_distinct_messages(self):
        result = scan(FIXTURES / "ERR001" / "bad", {}, only=["ERR001"])
        by_line = {f.line: f.message for f in result.findings}
        src = (FIXTURES / "ERR001" / "bad" / "errs.py").read_text().splitlines()
        discard = next(n for n, l in enumerate(src, 1) if l.strip() == "except Exception:  # expect: ERR001")
        fallback = next(n for n, l in enumerate(src, 1) if "except Exception:" in l and "expect" in l and n != discard)
        self.assertEqual(by_line[discard], rules_file.ERR001_SWALLOWED)
        self.assertIn("neither re-raises nor logs", by_line[discard])
        self.assertEqual(by_line[fallback], rules_file.ERR001_FALLBACK)
        self.assertIn("turns every failure, including bugs, into a fallback", by_line[fallback])


class CleanProject(unittest.TestCase):
    def test_clean_project_has_zero_findings_across_all_rules(self):
        result = scan(HERE / "fixtures" / "clean_project", {})
        self.assertEqual(result.errors, [])
        self.assertGreater(result.files_scanned, 3)
        self.assertEqual([f"{f.path}:{f.line} {f.rule}" for f in result.findings], [])


if __name__ == "__main__":
    unittest.main()
