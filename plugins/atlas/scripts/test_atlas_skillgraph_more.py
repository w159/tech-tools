"""atlas_skillgraph: unit tests for the line-structure helpers, report
counters, skill resolution and the human-readable CLI output."""

import _test_isolation  # noqa: F401  (must be first)
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import atlas_skillgraph as sg


def _skill(root, body, name="demo", refs=None):
    d = Path(root) / name
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text("---\nname: %s\ndescription: x\n---\n%s" % (name, body))
    for rel, text in (refs or {}).items():
        (d / rel).parent.mkdir(parents=True, exist_ok=True)
        (d / rel).write_text(text)
    return d


def run_main(argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = sg.main(argv)
    return code, out.getvalue(), err.getvalue()


class BodyStart(unittest.TestCase):
    def test_empty_frontmatter(self):
        self.assertEqual(sg._body_start(["---", "---", "body"]), 2)

    def test_regular_frontmatter(self):
        self.assertEqual(sg._body_start(["---", "a: 1", "---", "body"]), 3)

    def test_no_frontmatter(self):
        self.assertEqual(sg._body_start(["body", "---", "x"]), 0)
        self.assertEqual(sg._body_start([]), 0)

    def test_unterminated_frontmatter(self):
        self.assertEqual(sg._body_start(["---", "a: 1", "b: 2"]), 0)


class Struct(unittest.TestCase):
    def test_is_struct_true_cases(self):
        for line in ("1. do it", "  2) do it", "a. do it", "## Step 3 - x",
                     "### 4 thing", "## Step Alpha"):
            self.assertIs(sg._is_struct(line), True, line)

    def test_is_struct_false_cases(self):
        for line in ("plain prose", "- bullet", "## Overview", "", "1.nospace"):
            self.assertIs(sg._is_struct(line), False, line)


class Joined(unittest.TestCase):
    def test_backslash_continuations(self):
        lines = ["gh api x \\", "  -X POST \\", "  /y", "next"]
        self.assertEqual(sg._joined(lines, 0), "gh api x  -X POST  /y")
        self.assertEqual(sg._joined(lines, 3), "next")

    def test_trailing_backslash_on_last_line(self):
        self.assertEqual(sg._joined(["a \\"], 0), "a \\")


class ItemContext(unittest.TestCase):
    def test_collects_item_lines_before(self):
        lines = ["1. head", "cont", "Run git push"]
        self.assertEqual(sg._item_context(lines, 2, False), ("1. head cont", False))

    def test_stops_after_item_head(self):
        lines = ["prev item text", "1. head", "cont", "push"]
        self.assertEqual(sg._item_context(lines, 3, False), ("1. head cont", False))

    def test_structural_line_has_no_context(self):
        lines = ["prose above", "1. Run git push"]
        self.assertEqual(sg._item_context(lines, 1, True), ("", False))

    def test_blank_line_ends_context(self):
        lines = ["unrelated", "", "cont", "push"]
        self.assertEqual(sg._item_context(lines, 3, False)[0], "cont")

    def test_fence_ends_context_backwards(self):
        lines = ["outside", "```", "inside one", "push"]
        self.assertEqual(sg._item_context(lines, 3, False)[0], "inside one")

    def test_fence_ends_flag_search_forwards(self):
        lines = ["push", "```", "`approved: true`"]
        self.assertEqual(sg._item_context(lines, 0, False), ("", False))
        lines = ["push", "more", "`approved: true`"]
        self.assertEqual(sg._item_context(lines, 0, False), ("", True))

    def test_flag_search_stops_at_next_item(self):
        lines = ["1. push", "2. `approved: true`"]
        self.assertEqual(sg._item_context(lines, 0, True), ("", False))

    def test_flag_search_stops_at_blank(self):
        lines = ["push", "", "`approved: true`"]
        self.assertFalse(sg._item_context(lines, 0, False)[1])

    def test_flag_before_counts(self):
        lines = ["when `approved: false`", "push"]
        self.assertEqual(sg._item_context(lines, 1, False),
                         ("when `approved: false`", True))

    def test_backward_limit_is_twelve_lines(self):
        lines = ["l%d" % k for k in range(30)]
        ctx, _ = sg._item_context(lines, 20, False)
        self.assertEqual(ctx.split(), lines[8:20])

    def test_forward_flag_limit_is_twelve_lines(self):
        base = ["push"] + ["x"] * 11
        self.assertTrue(sg._item_context(base + ["`approved: true`"], 0, False)[1])
        self.assertFalse(
            sg._item_context(base + ["x", "`approved: true`"], 0, False)[1])


class ReportAndCli(unittest.TestCase):
    def setUp(self):
        t = tempfile.TemporaryDirectory()
        self.addCleanup(t.cleanup)
        self.root = Path(t.name)

    def test_check_counts_remote_steps_and_skills(self):
        sk = self.root / "skills"
        _skill(sk, "1. Ask the user before any push.\n2. Run git push.\n3. Run git push --tags.\n", "a")
        _skill(sk, "1. Run git push.\n", "b")
        rep = sg.check(sk)
        self.assertEqual(rep["skills"], 2)
        self.assertEqual(rep["remote_steps"], 3)
        self.assertEqual(len(rep["gated"]), 2)
        self.assertEqual([r["skill"] for r in rep["ungated"]], ["b"])

    def test_check_skips_dirs_without_skill_md(self):
        sk = self.root / "skills"
        _skill(sk, "1. Read it.\n", "a")
        (sk / "docs").mkdir()
        self.assertEqual(sg.check(sk)["skills"], 1)

    def test_allowlist_moves_row_with_reason(self):
        sk = self.root / "skills"
        _skill(sk, "1. Run git push.\n", "a")
        key = sg.check(sk)["ungated"][0]["key"]
        rep = sg.check(sk, {key[:10]: "why not"})
        self.assertEqual(rep["ungated"], [])
        self.assertEqual(rep["allowed"][0]["reason"], "why not")

    def test_resolve_skill_by_path_and_by_name(self):
        sk = self.root / "skills"
        d = _skill(sk, "1. Read.\n", "a")
        self.assertEqual(sg._resolve_skill(str(d), str(self.root / "other")), d)
        self.assertEqual(sg._resolve_skill("a", sk), sk / "a")
        with self.assertRaises(sg.GraphError):
            sg._resolve_skill("zzz", sk)

    def test_compile_cli_by_direct_path_ignores_skills_dir(self):
        d = _skill(self.root / "skills", "1. Run git push.\n", "a")
        code, out, _ = run_main(["compile", str(d), "--skills-dir", str(self.root / "nope")])
        self.assertEqual(code, 0)
        self.assertIn("git push", out)

    def test_compile_cli_text_format_and_truncation(self):
        long = "1. Run git push " + "z" * 200 + "\n2. Read the notes.\n"
        sk = self.root / "skills"
        _skill(sk, long, "a")
        code, out, _ = run_main(["compile", "a", "--skills-dir", str(sk)])
        self.assertEqual(code, 0)
        rows = out.splitlines()
        self.assertEqual(len(rows), 2)
        self.assertTrue(rows[0].startswith("!SKILL.md:5 remote"), rows[0])
        self.assertEqual(rows[0].split(None, 2)[2], long.splitlines()[0][:90])
        self.assertTrue(rows[1].startswith(" SKILL.md:6 "), rows[1])

    def test_compile_cli_json(self):
        sk = self.root / "skills"
        _skill(sk, "1. Read.\n", "a")
        code, out, _ = run_main(["compile", "a", "--skills-dir", str(sk), "--json"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["skill"], "a")

    def test_unknown_skill_exits_2_on_stderr(self):
        code, out, err = run_main(["compile", "ghost", "--skills-dir", str(self.root)])
        self.assertEqual((code, out), (2, ""))
        self.assertIn("skill not found: ghost", err)

    def test_check_cli_text_and_json(self):
        sk = self.root / "skills"
        _skill(sk, "1. Run git push.\n", "a")
        allow = str(self.root / "none.json")
        code, out, _ = run_main(["check", "--skills-dir", str(sk), "--allow", allow])
        self.assertEqual(code, 1)
        lines = out.splitlines()
        self.assertEqual(lines[0], "1 skills, 1 remote steps, 1 ungated, 0 allowlisted")
        self.assertRegex(lines[1], r"^UNGATED a:SKILL\.md:5 \[[^\]]+\] 1\. Run git push")
        code, out, _ = run_main(["check", "--skills-dir", str(sk), "--allow", allow, "--json"])
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(out)["skills"], 1)

    def test_check_cli_clean_exits_0(self):
        sk = self.root / "skills"
        _skill(sk, "1. Read the file.\n", "a")
        code, out, _ = run_main(["check", "--skills-dir", str(sk),
                                 "--allow", str(self.root / "none.json")])
        self.assertEqual(code, 0)
        self.assertEqual(out.strip(), "1 skills, 0 remote steps, 0 ungated, 0 allowlisted")

    def test_load_allow_errors(self):
        p = self.root / "a.json"
        p.write_text("[1]")
        with self.assertRaises(sg.GraphError):
            sg.load_allow(p)
        p.write_text('{"k": "  "}')
        with self.assertRaises(sg.GraphError):
            sg.load_allow(p)
        p.write_text('{"k": "reason"}')
        self.assertEqual(sg.load_allow(p), {"k": "reason"})
        self.assertEqual(sg.load_allow(self.root / "missing.json"), {})

    def test_dot_styles_by_node_kind(self):
        sk = self.root / "skills"
        d = _skill(sk, "1. Ask the user before any push.\n2. Run git push.\n3. Run gh issue create.\n",
                   "a", {})
        dot = sg.to_dot(sg.compile_skill(d))
        self.assertIn("color=green", dot)
        self.assertIn('[label="a",shape=box,style=bold];', dot)
        self.assertIn("-> ", dot)
        self.assertTrue(dot.rstrip().endswith("}"))
        self.assertIn('rankdir=TB;', dot)


if __name__ == "__main__":
    unittest.main()
