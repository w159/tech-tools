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
    def test_duplicate_reference_across_skills_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = make_root(
                tmp, files=[("skills/atlas-demo/references/x.md", "same\n")]
            )
            other = root / "skills" / "atlas-other"
            other.mkdir()
            (other / "SKILL.md").write_text(GOOD.replace("atlas-demo", "atlas-other"))
            (other / "references").mkdir()
            (other / "references" / "y.md").write_text("same\n")
            res = dict((n, {r for r, _ in f}) for n, f, _ in v.run(root, False))
            self.assertEqual(res["atlas-demo"], {"dupref"})
            self.assertEqual(res["atlas-other"], {"dupref"})
            (other / "references" / "y.md").write_text("different\n")
            res = dict((n, {r for r, _ in f}) for n, f, _ in v.run(root, False))
            self.assertEqual(res["atlas-demo"], set())

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


class Boundaries(unittest.TestCase):
    def test_description_limit_is_exactly_400(self):
        base = GOOD.replace("Does a thing. Use when a demo is needed.", "Use when {}")
        ok = base.format("x" * (400 - len("Use when ")))
        too_long = base.format("x" * (401 - len("Use when ")))
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(rules(make_root(tmp, ok)), set())
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(rules(make_root(tmp, too_long)), {"desc"})

    def test_parse_frontmatter_unquotes_only_matched_pairs(self):
        text = "---\nname: 'a'\nb: \"c\"\nd: \"e'\nf: \"\ng: x\n---\nbody\n"
        fm, body = v.parse_frontmatter(text)
        self.assertEqual(fm, {"name": "a", "b": "c", "d": "\"e'", "f": '"', "g": "x"})
        self.assertEqual(body, "body\n")

    def test_parse_frontmatter_skips_lines_without_a_valid_key(self):
        fm, _ = v.parse_frontmatter("---\nname: a\njusttext\nBad Key: x\n---\nb\n")
        self.assertEqual(fm, {"name": "a"})

    def test_run_executes_help_by_default(self):
        body = GOOD + "Run ${CLAUDE_PLUGIN_ROOT}/scripts/tool.py\n"
        with tempfile.TemporaryDirectory() as tmp:
            root = make_root(tmp, body, files=[("scripts/tool.py", "import sys; sys.exit(2)\n")])
            ((_, fails, _),) = v.run(root)
        self.assertEqual([r for r, _ in fails], ["help"])

    def test_usage_text_is_the_first_docstring_line(self):
        import contextlib
        import io

        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), self.assertRaises(SystemExit):
            v.main(["--help"])
        self.assertIn(v.__doc__.split("\n")[0], buf.getvalue())
        self.assertNotIn("Rules (each failure", buf.getvalue())

    def test_parse_frontmatter_none_without_block(self):
        self.assertEqual(v.parse_frontmatter("# t\n"), (None, "# t\n"))

    def test_step_section_ends_at_same_or_higher_level_not_deeper(self):
        body = (
            "## Step 1 - A\nintro\n### detail\nmore\n"
            "## Step 2 - B\nsecond\n# Top\nout\n"
        )
        got = dict(v.step_sections(body))
        self.assertEqual(got["## Step 1 - A"], "intro\n### detail\nmore")
        self.assertEqual(got["## Step 2 - B"], "second")

    def test_deeper_heading_keeps_completion_line_in_section(self):
        body = GOOD + "## Step 1 - Go\nDo it.\n### notes\nDone when ok.\n"
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(rules(make_root(tmp, body)), set())

    def test_main_reports_pass_and_exits_zero(self):
        import contextlib
        import io

        with tempfile.TemporaryDirectory() as tmp:
            root = make_root(tmp)
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                rc = v.main(["--root", str(root), "--no-run"])
        out = buf.getvalue()
        self.assertEqual(rc, 0)
        self.assertIn("atlas-demo", out)
        self.assertIn("PASS", out)
        self.assertIn("1/1 skills pass", out)

    def test_main_reports_failure_and_exits_one(self):
        import contextlib
        import io

        with tempfile.TemporaryDirectory() as tmp:
            root = make_root(tmp, GOOD + "See atlas-ghost.\n")
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                rc = v.main(["--root", str(root), "--no-run"])
        out = buf.getvalue()
        self.assertEqual(rc, 1)
        self.assertIn("FAIL", out)
        self.assertIn("[names] unknown atlas-ghost", out)
        self.assertIn("0/1 skills pass", out)


if __name__ == "__main__":
    unittest.main()
