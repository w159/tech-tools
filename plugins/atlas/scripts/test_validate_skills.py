#!/usr/bin/env python3
"""Tests for validate_skills.py: one fixture per rule, plus the real tree."""

import _test_isolation  # noqa: F401  (redirects ~/.atlas to a tempdir)
import tempfile
import unittest
from pathlib import Path

import validate_skills as v

GOOD = (
    "---\nname: atlas-demo\n"
    'description: "Does a thing. Use when a demo is needed."\n---\n'
    "# demo\n"
)


def make_root(tmp, body=GOOD, name="atlas-demo", files=()):
    root = Path(tmp)
    skill = root / "skills" / name
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text(body, encoding="utf-8")
    (root / "agents").mkdir()
    (root / "agents" / "verifier.md").write_text("x")
    for rel, content in files:
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(content)
    return root


def rules(root, run_help=True):
    ((_, fails, _),) = v.run(root, run_help)
    return {r for r, _ in fails}


class ValidateSkillsTest(unittest.TestCase):
    def check(self, body=GOOD, **kw):
        with tempfile.TemporaryDirectory() as tmp:
            return rules(make_root(tmp, body, **kw.pop("mk", {})), **kw)

    def test_good_skill_passes(self):
        self.assertEqual(self.check(), set())

    def test_frontmatter_missing(self):
        self.assertEqual(self.check("# no frontmatter\n"), {"frontmatter"})

    def test_name_mismatch(self):
        self.assertIn("name", self.check(GOOD.replace("atlas-demo", "atlas-other")))

    def test_description_too_long_and_no_trigger(self):
        body = GOOD.replace("Does a thing. Use when a demo is needed.", "x" * 401)
        self.assertEqual(self.check(body) & {"desc"}, {"desc"})
        self.assertIn(
            "desc", self.check(GOOD.replace("Use when a demo is needed.", "Fancy."))
        )

    def test_size_budget(self):
        self.assertIn("size", self.check(GOOD + "a" * (v.BODY_BUDGET + 1)))

    def test_missing_ref(self):
        self.assertIn(
            "refs", self.check(GOOD + "Read ${CLAUDE_SKILL_DIR}/references/nope.md\n")
        )

    def test_existing_ref_ok(self):
        mk = {"files": [("skills/atlas-demo/references/a.md", "x")]}
        with tempfile.TemporaryDirectory() as tmp:
            root = make_root(
                tmp, GOOD + "Read ${CLAUDE_SKILL_DIR}/references/a.md\n", **mk
            )
            self.assertEqual(rules(root), set())

    def test_script_help_failure_and_success(self):
        body = GOOD + "Run ${CLAUDE_PLUGIN_ROOT}/scripts/tool.py\n"
        with tempfile.TemporaryDirectory() as tmp:
            root = make_root(
                tmp, body, files=[("scripts/tool.py", "import sys; sys.exit(2)\n")]
            )
            self.assertEqual(rules(root), {"help"})
            self.assertEqual(rules(root, run_help=False), set())
        with tempfile.TemporaryDirectory() as tmp:
            root = make_root(tmp, body, files=[("scripts/tool.py", "print('ok')\n")])
            self.assertEqual(rules(root), set())

    def test_unknown_and_known_names(self):
        self.assertIn("names", self.check(GOOD + "See atlas-ghost.\n"))
        self.assertEqual(self.check(GOOD + "See atlas-demo and verifier.\n"), set())

    def test_banned_characters(self):
        for ch in v.BANNED:
            self.assertIn("chars", self.check(GOOD + f"bad {ch} char\n"), hex(ord(ch)))

    def test_step_needs_completion_line(self):
        self.assertIn("steps", self.check(GOOD + "## Step 1 - Go\n\nJust do stuff.\n"))
        self.assertEqual(
            self.check(GOOD + "## Step 1 - Go\n\nDone when the file exists.\n"), set()
        )

    def test_fenced_hash_does_not_end_step(self):
        body = GOOD + "## Step 1 - Go\n\n```bash\n# comment\n```\n\nDone when ok.\n"
        self.assertEqual(self.check(body), set())

    def test_real_tree_passes(self):
        root = Path(__file__).resolve().parent.parent
        bad = [(n, f) for n, f, _ in v.run(root, run_help=False) if f]
        self.assertEqual(bad, [])


if __name__ == "__main__":
    unittest.main()
