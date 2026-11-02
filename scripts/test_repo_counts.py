#!/usr/bin/env python3
"""Fail when the counts the root README and marketplace.json claim drift from the files on disk.

    python3 -m pytest scripts/test_repo_counts.py
"""
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ATLAS = ROOT / "plugins/atlas"
ARMADA = ROOT / "plugins/armada"
PROGRAMMER = ROOT / "plugins/programmer"


def real_counts():
    skills = sorted(ATLAS.glob("skills/*/SKILL.md"))
    manual = [s for s in skills if re.search(r"^disable-model-invocation:\s*true\s*$", s.read_text("utf-8"), re.M)]
    sys.path.insert(0, str(PROGRAMMER / "scripts"))
    try:
        from principles.catalog import RULES
    finally:
        sys.path.remove(str(PROGRAMMER / "scripts"))
    return {
        "atlas_skills": len(skills),
        "atlas_manual": len(manual),
        "atlas_agents": len(list(ATLAS.glob("agents/*.md"))),
        "armada_dept_skills": len(list(ARMADA.glob("skills/armada/departments/*/skills/*/SKILL.md"))),
        "armada_dept_agents": len(list(ARMADA.glob("agents/*.md"))),
        "armada_setup_skills": len(list(ARMADA.glob("skills/*/SKILL.md"))) - 1,
        "mcp_connectors": len(json.loads((ARMADA / ".mcp.json").read_text("utf-8"))["mcpServers"]),
        "programmer_rules": len(RULES),
        "programmer_skills": len(list(PROGRAMMER.glob("skills/*/SKILL.md"))),
        "programmer_agents": len(list(PROGRAMMER.glob("agents/*.md"))),
    }


class RepoCountsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.real = real_counts()
        cls.market = json.loads((ROOT / ".claude-plugin/marketplace.json").read_text("utf-8"))["description"]
        cls.readme = (ROOT / "README.md").read_text("utf-8")

    def claim(self, text, pattern, what):
        m = re.search(pattern, text)
        self.assertIsNotNone(m, f"claim not found: {what}")
        return tuple(int(g) for g in m.groups())

    def test_readme_table(self):
        def row(label):
            m = re.search(rf"^\|\s*{label}\s*\|\s*(\d+)", self.readme, re.M)
            self.assertIsNotNone(m, f"README row: {label}")
            return int(m[1])

        m = re.search(r"^\|\s*Skills\s*\|\s*(\d+) \((\d+) manual\)", self.readme, re.M)
        self.assertIsNotNone(m, "README Skills row")
        self.assertEqual((int(m[1]), int(m[2])), (self.real["atlas_skills"], self.real["atlas_manual"]), "README Skills row")
        self.assertEqual(row(r"Role agents \(`atlas:\*`\)"), self.real["atlas_agents"], "README Role agents row")
        self.assertEqual(row("MCP connectors"), self.real["mcp_connectors"], "README MCP connectors row")

    def test_marketplace_description(self):
        d = self.market
        want = [
            (r"atlas\) with (\d+) plainly named skills", "atlas_skills"),
            (r"(\d+) core agents", "atlas_agents"),
            (r"(\d+) invocable setup skills", "armada_setup_skills"),
            (r"(\d+) department agents", "armada_dept_agents"),
            (r"(\d+) department skills", "armada_dept_skills"),
            (r"(\d+) detected rules", "programmer_rules"),
        ]
        for pattern, key in want:
            with self.subTest(key):
                self.assertEqual(self.claim(d, pattern, key)[0], self.real[key], key)
        m = re.search(r"(\d+) skills and (\d+) judge agent", d)
        self.assertIsNotNone(m, "programmer skills/agent claim")
        self.assertEqual((int(m[1]), int(m[2])), (self.real["programmer_skills"], self.real["programmer_agents"]))


if __name__ == "__main__":
    unittest.main()
