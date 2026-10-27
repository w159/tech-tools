"""Docs-versus-code invariants, so the plugin's claims cannot drift from what it ships again."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import unittest
from pathlib import Path

PLUGIN = Path(__file__).resolve().parent.parent
REPO = PLUGIN.parent.parent
sys.path.insert(0, str(PLUGIN / "scripts"))

from principles.catalog import RULES  # noqa: E402
from principles.output import catalog_markdown  # noqa: E402


def frontmatter(path: Path) -> dict[str, str]:
    text = path.read_text()
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    assert m, f"{path} has no frontmatter"
    fields = {}
    for line in m.group(1).splitlines():
        key, sep, value = line.partition(":")
        assert sep, f"{path}: frontmatter line without key: {line!r}"
        value = value.strip()
        quoted = len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'"
        # an unquoted ': ' inside a value is invalid YAML (the tpp-auditor defect)
        assert quoted or ": " not in value, f"{path}: unquoted value for {key} contains ': '"
        fields[key.strip()] = value.strip("\"'")
    return fields


class Contract(unittest.TestCase):
    def test_generated_catalog_is_current(self):
        page = PLUGIN / "skills" / "principles" / "references" / "catalog.md"
        self.assertEqual(page.read_text(), catalog_markdown(), "run: python3 scripts/principles catalog > skills/principles/references/catalog.md")

    def test_skills_and_agents_have_valid_frontmatter(self):
        skills = sorted(PLUGIN.glob("skills/*/SKILL.md"))
        agents = sorted(PLUGIN.glob("agents/*.md"))
        self.assertEqual([p.parent.name for p in skills], ["principles", "review"])
        self.assertEqual([p.stem for p in agents], ["principles-judge"])
        for p in skills + agents:
            fm = frontmatter(p)
            self.assertEqual(fm["name"], p.parent.name if p.name == "SKILL.md" else p.stem)
            self.assertTrue(fm["description"])

    def test_review_skill_dispatches_only_agents_that_exist(self):
        text = (PLUGIN / "skills" / "review" / "SKILL.md").read_text()
        for name in set(re.findall(r"programmer:([a-z-]+)", text)):
            self.assertTrue((PLUGIN / "agents" / f"{name}.md").is_file(), f"review skill dispatches missing agent {name}")

    def test_skill_resource_paths_exist(self):
        for skill in PLUGIN.glob("skills/*/SKILL.md"):
            for rel in re.findall(r"`(references/[\w./-]+\.md)`", skill.read_text()):
                self.assertTrue((skill.parent / rel).is_file(), f"{skill}: {rel}")
            for rel in re.findall(r"\$\{CLAUDE_PLUGIN_ROOT\}/([\w./-]+)", skill.read_text()):
                self.assertTrue((PLUGIN / rel).exists(), f"{skill}: {rel}")

    def test_claims_match_counts(self):
        manifest = json.loads((PLUGIN / ".claude-plugin" / "plugin.json").read_text())
        market = next(p for p in json.loads((REPO / ".claude-plugin" / "marketplace.json").read_text())["plugins"] if p["name"] == "programmer")
        readme = (PLUGIN / "README.md").read_text()
        n_rules = len(RULES)
        for label, text in (("plugin.json", manifest["description"]), ("marketplace.json", market["description"]), ("README.md", readme)):
            with self.subTest(source=label):
                self.assertIn(f"{n_rules} ", text)
                self.assertNotRegex(text, r"\b[3-9] (specialized )?(reviewer )?agents\b")
                self.assertNotIn("nudge hook", text)
        books = (PLUGIN / "skills" / "principles" / "references" / "books.md").read_text()
        n_books = len([ln for ln in books.splitlines() if ln.startswith("| ") and not ln.startswith(("| Book", "|---"))])
        self.assertIn(f"{n_books} books", books)

    def test_no_dangling_submodule(self):
        out = subprocess.run(["git", "-C", str(REPO), "ls-files", "-s", "plugins/programmer"], capture_output=True, text=True).stdout
        self.assertNotIn("160000", out, "gitlink without .gitmodules ships an empty folder")

    def test_hooks_json_points_at_real_scripts(self):
        data = json.loads((PLUGIN / "hooks" / "hooks.json").read_text())
        for groups in data["hooks"].values():
            for group in groups:
                for hook in group["hooks"]:
                    for rel in re.findall(r"\$\{CLAUDE_PLUGIN_ROOT\}/([\w./-]+)", hook["command"]):
                        self.assertTrue((PLUGIN / rel).is_file(), rel)


if __name__ == "__main__":
    unittest.main()
