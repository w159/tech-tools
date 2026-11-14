#!/usr/bin/env python3
"""A department agent must be able to reach the skills it lists.

Department skills live under skills/armada/departments/<dept>/skills/, below the
one level Claude Code scans, so they are never registered and the Skill tool
cannot load them. The agent has to be told where to read them.

    python3 plugins/armada/tests/test_armada_agent_library.py
"""

import re
import sys
import unittest
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
DEPARTMENTS = PLUGIN / "skills" / "armada" / "departments"
AGENT_DEPT = {
    "armada-it-ops": "it-operations",
    "armada-security": "security",
    "armada-m365": "microsoft-365",
    "armada-hr": "hr",
    "armada-finance": "finance",
    "armada-engineering": "engineering",
    "armada-data": "data",
    "armada-design": "design",
    "armada-product": "product",
    "armada-support": "support",
    "armada-productivity": "productivity",
}


def listed_skills(text):
    m = re.search(r"^## Skills in this department\n\n(.+)$", text, re.M)
    return [n.strip() for n in m.group(1).split(",")] if m else []


class AgentSkillLibraryTest(unittest.TestCase):
    def test_every_listed_skill_exists_in_its_department(self):
        for agent, dept in AGENT_DEPT.items():
            text = (PLUGIN / "agents" / f"{agent}.md").read_text(encoding="utf-8")
            names = listed_skills(text)
            self.assertTrue(names, f"{agent}: no skill list")
            for name in names:
                self.assertTrue((DEPARTMENTS / dept / "skills" / name / "SKILL.md").is_file(),
                                f"{agent} lists {name}, missing under departments/{dept}/skills")

    def test_agent_names_the_path_to_its_skill_library(self):
        for agent, dept in AGENT_DEPT.items():
            text = (PLUGIN / "agents" / f"{agent}.md").read_text(encoding="utf-8")
            path = f"${{CLAUDE_PLUGIN_ROOT}}/skills/armada/departments/{dept}/skills/<name>/SKILL.md"
            self.assertIn(path, text, f"{agent} lists skills but never says where to read them")
            self.assertIn("not the Skill tool", text, f"{agent} must say the Skill tool cannot load them")


if __name__ == "__main__":
    sys.exit(0 if unittest.main(exit=False, verbosity=2).result.wasSuccessful() else 1)
