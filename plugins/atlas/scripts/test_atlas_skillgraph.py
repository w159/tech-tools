"""atlas_skillgraph: classification, quote validation, gating order, and the
conformance check over the shipped skills/."""

import _test_isolation  # noqa: F401  (must be first)
import json
import tempfile
import unittest
from pathlib import Path

import atlas_skillgraph as sg

PLUGIN = Path(__file__).resolve().parent.parent
SKILLS = PLUGIN / "skills"


def _skill(tmp, body, refs=None, name="demo"):
    d = Path(tmp) / name
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text("---\nname: %s\ndescription: x\n---\n%s" % (name, body))
    for rel, text in (refs or {}).items():
        (d / rel).parent.mkdir(parents=True, exist_ok=True)
        (d / rel).write_text(text)
    return d


class Classify(unittest.TestCase):
    def kind(self, text):
        return sg.classify_line(text)["kind"]

    def test_remote_families(self):
        cases = [
            "Run `git push -u origin HEAD` now.",
            "Then `git push origin --delete old`.",
            "Run gh pr create --fill.",
            "Run gh pr merge 4 --squash.",
            "Run gh pr edit 4 --body x.",
            "Run gh pr comment 4 -b hi.",
            "Run gh pr review 4 --approve.",
            "Run gh release create v1.",
            "Run gh api repos/o/r/issues -X POST -f title=x.",
            "Run gh api --method PATCH repos/o/r/pulls/1.",
            "Run gh api repos/o/r --method=DELETE.",
            "Run gh issue create --title x.",
            "Run gh issue comment 3 -b x.",
            "Run gh issue close 3.",
            "Run npm publish --access public.",
            "Run pnpm publish.",
            "Run yarn publish.",
            "Run twine upload dist/*.",
            "Run docker push img:1.",
            "Call create_pull_request with the branch.",
            "Call push_files to land it.",
            "Call create_or_update_file on the repo.",
            "Call merge_pull_request when green.",
            'Write JSON to xd://github with `op: "pr_create"`.',
        ]
        for c in cases:
            with self.subTest(c):
                self.assertEqual(self.kind(c), "remote")

    def test_reads_are_not_remote(self):
        for c in [
            "Run gh pr view 4 --json files.",
            "Run gh pr list --head x.",
            "Run gh api repos/o/r/pulls/1/comments.",
            "Run gh api graphql -f query='{viewer{login}}'.",
            "Run gh issue list --search x.",
            "feedback type is `pr_comment` or `review_body`.",
            "Publish the doc to the review surface.",
        ]:
            with self.subTest(c):
                self.assertNotEqual(self.kind(c), "remote")

    def test_negation_is_not_a_remote_step(self):
        for c in [
            "Never `git push` from here.",
            "Do not run gh pr create.",
            "Don't call create_pull_request.",
            "TOOLS FORBIDDEN: Write, Edit, git push.",
            "OUT OF SCOPE: git push - PRs - merges.",
            "You must not git push.",
        ]:
            with self.subTest(c):
                self.assertNotEqual(self.kind(c), "remote")

    def test_user_runs_and_hook_descriptions_are_not_remote(self):
        self.assertNotEqual(
            self.kind(
                "Give the user the commands to run themselves: `git push -u origin HEAD`."
            ),
            "remote",
        )
        self.assertNotEqual(
            self.kind("PreToolUse hook: on `git push`, run the audit."), "remote"
        )

    def test_approval_families(self):
        for c in [
            "Use AskUserQuestion to pick.",
            "Ask the user which branch.",
            "Ask first.",
            "Needs the user's explicit yes.",
            "Needs the user's approval.",
            "Requires explicit approval.",
            "Confirm with the user before going on.",
            "Wait for the user's answer.",
            "Run `atlas_git.py allow main --reason x`.",
            "Only if the user explicitly asked.",
            "Follow `${CLAUDE_PLUGIN_ROOT}/references/git-policy.md`.",
        ]:
            with self.subTest(c):
                self.assertEqual(self.kind(c), "approval")

    def test_never_ask_is_not_approval(self):
        self.assertNotEqual(
            self.kind("Never ask the user to point at the problem."), "approval"
        )

    def test_same_sentence_gating(self):
        gated = sg.classify_line("Run git push only after the user's explicit yes.")
        self.assertEqual((gated["kind"], gated["gated_inline"]), ("remote", True))
        open_ = sg.classify_line("Run git push -u origin HEAD.")
        self.assertEqual((open_["kind"], open_["gated_inline"]), ("remote", False))
        # approval in a LATER sentence does not gate the earlier remote one
        later = sg.classify_line("Run git push. Then ask the user how it went.")
        self.assertFalse(later["gated_inline"])
        self.assertTrue(later["has_approval"])
        # an earlier sentence on the same line does
        earlier = sg.classify_line("Ask the user before pushing. Then run git push.")
        self.assertTrue(earlier["gated_inline"])

    def test_local_read_judgment(self):
        self.assertEqual(self.kind("Run `git commit -m x`."), "local_write")
        self.assertEqual(self.kind("Write the file to disk."), "local_write")
        self.assertEqual(self.kind("Read the config."), "read")
        self.assertEqual(self.kind("Decide what matters."), "judgment")
        self.assertEqual(sg.classify_line("Run `git commit -m x`.")["effect"], "local")


class Compile(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.addCleanup(self._t.cleanup)

    def test_graph_shape_and_refs(self):
        d = _skill(
            self._t.name,
            "## Step 1 - Look\nRead the repo.\n1. Plan it.\n2. See [push](references/p.md).\n",
            {"references/p.md": "1. Ask the user before any push.\n2. Run git push.\n"},
        )
        g = sg.compile_skill(d)
        types = {n["type"] for n in g["nodes"]}
        self.assertEqual(types, {"Skill", "Step", "Reference"})
        etypes = {e["type"] for e in g["edges"]}
        self.assertEqual(etypes, {"HAS_STEP", "THEN", "USES"})
        files = [n["file"] for n in g["nodes"] if n["type"] == "Step"]
        self.assertIn("references/p.md", files)
        # reference steps are spliced right after the linking line, in order
        lines = [
            (n["file"], n["line"])
            for sid in g["order"]
            for n in g["nodes"]
            if n["id"] == sid
        ]
        self.assertEqual(lines[-2:], [("references/p.md", 1), ("references/p.md", 2)])
        self.assertTrue(
            all(
                isinstance(n["quote"], str) and n["quote"]
                for n in g["nodes"]
                if n["type"] == "Step"
            )
        )

    def test_quotes_exist_in_source(self):
        d = _skill(self._t.name, "1. Run git push.\n")
        g = sg.compile_skill(d)
        sg.validate_quotes(g, d)  # does not raise
        step = next(n for n in g["nodes"] if n["type"] == "Step")
        text = (d / step["file"]).read_text().splitlines()[step["line"] - 1]
        self.assertIn(step["quote"], text)

    def test_planted_quote_is_rejected(self):
        d = _skill(self._t.name, "1. Run git push.\n")
        g = sg.compile_skill(d)
        step = next(n for n in g["nodes"] if n["type"] == "Step")
        step["quote"] = "Ask the user first."  # not in the file
        with self.assertRaises(sg.GraphError):
            sg.validate_quotes(g, d)
        step["quote"] = "Run git push."
        step["line"] = 99  # right text, wrong line
        with self.assertRaises(sg.GraphError):
            sg.validate_quotes(g, d)

    def test_frontmatter_is_not_scanned(self):
        d = Path(self._t.name) / "fm"
        d.mkdir()
        (d / "SKILL.md").write_text(
            "---\nname: fm\ndescription: runs git push\n---\n1. Read.\n"
        )
        self.assertEqual(sg.query_ungated_remote(sg.compile_skill(d)), [])


class Gating(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.addCleanup(self._t.cleanup)

    def ungated(self, body, refs=None):
        g = sg.compile_skill(_skill(self._t.name, body, refs))
        return [n["line"] for n in sg.query_ungated_remote(g)]

    def test_push_with_no_approval_is_ungated(self):
        self.assertEqual(
            self.ungated("1. Commit.\n2. Run git push -u origin HEAD.\n"), [6]
        )

    def test_approval_before_gates_push(self):
        self.assertEqual(
            self.ungated(
                "1. Ask the user whether to push.\n2. Run git push -u origin HEAD.\n"
            ),
            [],
        )

    def test_unrelated_ask_does_not_gate_push(self):
        # a scope question is an approval step but not consent to go remote
        body = "1. Ask the user what to simplify.\n2. Run git push -u origin HEAD.\n"
        self.assertEqual(self.ungated(body), [6])

    def _ungated_in(self, body):
        with tempfile.TemporaryDirectory() as t:
            return [n["line"] for n in sg.query_ungated_remote(sg.compile_skill(_skill(t, body)))]

    def test_consent_gates_only_the_class_it_names(self):
        cases = [
            # (gate sentence, remote line, ungated?)
            ("Ask the user before any push.", "Run git push.", False),
            ("Ask the user before any push.", "Run gh pr create --fill.", True),
            ("Ask the user before opening a PR.", "Run gh pr create --fill.", False),
            ("Ask the user before opening a PR.", "Run git push.", True),
            ("Ask the user before any push or PR.", "Run gh pr merge 3.", False),
            ("Ask the user before any push or PR.", "Run git push.", False),
            ("Ask the user before any push or PR.", "Run npm publish.", True),
            ("Ask the user before any release.", "Run gh release create v1.", False),
            ("Ask the user before any release.", "Run docker push img.", False),
            ("Ask the user before any release.", "Run git push.", True),
            ("Ask the user before touching issues.", "Run gh issue close 3.", False),
            ("Ask the user before touching issues.", "Run gh pr create.", True),
            ("Ask the user before any gh api write.", "Run gh api x -X POST.", False),
            ("Ask the user before any gh api write.", "Run gh issue create.", True),
            ("Follow `references/git-policy.md` for consent.", "Run git push.", False),
            ("Follow `references/git-policy.md` for consent.", "Run gh pr create.", False),
            ("Follow `references/git-policy.md` for consent.", "Run gh release create v1.", True),
            ("Follow `references/git-policy.md` for consent.", "Run gh issue close 3.", True),
            ("Run `atlas_git.py allow main --reason x`.", "Run git push.", False),
            ("Nothing leaves this machine without the user's yes.", "Run gh issue close 3.", False),
            ("Never push, never open a PR. See `references/git-policy.md`.", "Run git push.", True),
        ]
        for gate, remote, expect_ungated in cases:
            with self.subTest(gate=gate, remote=remote):
                got = self._ungated_in("1. %s\n2. %s\n" % (gate, remote))
                self.assertEqual(bool(got), expect_ungated)

    def test_mcp_and_device_classes(self):
        self.assertEqual(sg.classify_line("Call push_files now.")["classes"], ["push"])
        self.assertEqual(sg.classify_line("Call create_or_update_file.")["classes"], ["push"])
        self.assertEqual(sg.classify_line("Call create_pull_request.")["classes"], ["pr"])
        self.assertEqual(sg.classify_line("Call merge_pull_request.")["classes"], ["pr"])
        self.assertEqual(sg.classify_line("Use device op `pr_push`.")["classes"], ["pr", "push"])
        self.assertEqual(sg.classify_line("Run twine upload dist/*.")["classes"], ["release"])
        self.assertEqual(sg.classify_line("Run gh api r --method PUT.")["classes"], ["api"])

    def test_approved_flag_gates_only_its_own_item(self):
        body = (
            "1. If the source has `approved: true`, run gh issue edit 3 --add-label x.\n"
            "2. Then run gh issue edit 4 --add-label y.\n"
        )
        self.assertEqual(self._ungated_in(body), [6])
        # flag on a continuation line of the same item gates it, not the next item
        body = (
            "1. Add the label via gh issue edit 3\n"
            "   when the source is `approved: true`.\n"
            "2. Add another via gh issue edit 4.\n"
        )
        self.assertEqual(self._ungated_in(body), [7])

    def test_earlier_line_of_same_item_gates(self):
        body = "1. Ask the user before any push.\n   Then run git push -u origin HEAD.\n"
        self.assertEqual(self._ungated_in(body), [])

    def test_approval_after_does_not_gate(self):
        self.assertEqual(
            self.ungated("1. Run git push.\n2. Ask the user how it went.\n"), [5]
        )

    def test_inline_gate(self):
        self.assertEqual(
            self.ungated("1. Run git push only after the user's explicit yes.\n"), []
        )

    def test_reference_approval_gates_later_main_step(self):
        body = "1. See [gate](references/g.md).\n2. Run git push.\n"
        self.assertEqual(
            self.ungated(body, {"references/g.md": "1. Ask the user before any push.\n"}), []
        )

    def test_reference_remote_without_approval_is_ungated(self):
        body = "1. See [do](references/d.md).\n"
        g = sg.compile_skill(
            _skill(self._t.name, body, {"references/d.md": "1. Run gh pr create.\n"})
        )
        got = sg.query_ungated_remote(g)
        self.assertEqual(
            [(n["file"], n["line"]) for n in got], [("references/d.md", 1)]
        )

    def test_negated_mention_is_no_step(self):
        self.assertEqual(self.ungated("1. Never run git push here.\n"), [])


class Allowlist(unittest.TestCase):
    def test_allow_requires_reason_and_matches_prefix(self):
        with tempfile.TemporaryDirectory() as t:
            sk = Path(t) / "skills"
            _skill(sk, "1. Run git push now.\n")
            rep = sg.check(sk, {})
            self.assertEqual(len(rep["ungated"]), 1)
            key = rep["ungated"][0]["key"]
            rep2 = sg.check(sk, {key[:20]: "preapproved by test"})
            self.assertEqual((len(rep2["ungated"]), len(rep2["allowed"])), (0, 1))
            bad = Path(t) / "allow.json"
            bad.write_text(json.dumps({key: ""}))
            with self.assertRaises(sg.GraphError):
                sg.load_allow(bad)

    def test_shipped_allowlist_is_valid(self):
        allow = sg.load_allow(PLUGIN / "contracts" / "skillgraph-allow.json")
        self.assertIsInstance(allow, dict)


class Conformance(unittest.TestCase):
    def test_shipped_skills_have_no_ungated_remote_steps(self):
        allow = sg.load_allow(sg.DEFAULT_ALLOW)
        rep = sg.check(SKILLS, allow)
        self.assertGreater(rep["skills"], 20, "skills not found")
        self.assertGreater(rep["remote_steps"], 5, "remote classifier found nothing")
        self.assertEqual(
            rep["ungated"],
            [],
            "ungated remote steps (add the consent step, never silently allowlist): %s"
            % json.dumps([(r["skill"], r["file"], r["line"]) for r in rep["ungated"]]),
        )

    def test_cli_exit_codes(self):
        with tempfile.TemporaryDirectory() as t:
            sk = Path(t) / "skills"
            _skill(sk, "1. Run git push.\n")
            self.assertEqual(
                sg.main(
                    [
                        "check",
                        "--skills-dir",
                        str(sk),
                        "--allow",
                        str(Path(t) / "none.json"),
                    ]
                ),
                1,
            )
        self.assertEqual(sg.main(["check"]), 0)

    def test_dot_renders(self):
        with tempfile.TemporaryDirectory() as t:
            d = _skill(t, "1. Run git push.\n")
            dot = sg.to_dot(sg.compile_skill(d))
            self.assertTrue(dot.startswith("digraph"))
            self.assertIn("color=red", dot)


if __name__ == "__main__":
    unittest.main()
