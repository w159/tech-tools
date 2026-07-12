#!/usr/bin/env python3
"""Tests for atlas_context_optimizer.py — disable unused skills/agents."""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import atlas_context_optimizer as opt


class TestContextOptimizer(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        os.environ["CLAUDE_PLUGIN_ROOT"] = self.tmpdir
        # Create minimal plugin structure
        self.skills_dir = Path(self.tmpdir) / "skills"
        self.agents_dir = Path(self.tmpdir) / "agents"
        self.agents_dir.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)
        if "CLAUDE_PLUGIN_ROOT" in os.environ:
            del os.environ["CLAUDE_PLUGIN_ROOT"]

    def _create_skill(self, name, description="A skill", disabled=False):
        skill_dir = self.skills_dir / name
        skill_dir.mkdir(parents=True, exist_ok=True)
        fm = f"""---
name: {name}
description: "{description}"
"""
        if disabled:
            fm += "disable-model-invocation: true\n"
        fm += f"""---

# {name}

Body.
"""
        (skill_dir / "SKILL.md").write_text(fm)

    def _create_agent(self, name):
        (self.agents_dir / f"{name}.md").write_text(f"# {name}\nAgent body.\n")

    def test_parse_skill_frontmatter_enabled(self):
        self._create_skill("test-skill", "A test skill")
        info = opt._parse_skill_frontmatter(self.skills_dir / "test-skill" / "SKILL.md")
        self.assertFalse(info["disabled"])
        self.assertEqual(info["description"], "A test skill")

    def test_parse_skill_frontmatter_disabled(self):
        self._create_skill("test-skill", "A test skill", disabled=True)
        info = opt._parse_skill_frontmatter(self.skills_dir / "test-skill" / "SKILL.md")
        self.assertTrue(info["disabled"])

    def test_all_skills(self):
        self._create_skill("skill-a")
        self._create_skill("skill-b", disabled=True)
        skills = opt._all_skills()
        self.assertEqual(len(skills), 2)
        names = [s["name"] for s in skills]
        self.assertIn("skill-a", names)
        self.assertIn("skill-b", names)

    def test_all_agents(self):
        self._create_agent("agent-a")
        self._create_agent("agent-b")
        agents = opt._all_agents()
        self.assertEqual(len(agents), 2)

    def test_disable_skill(self):
        self._create_skill("to-disable", "A skill")
        result = opt.disable_skill(self.skills_dir / "to-disable" / "SKILL.md")
        self.assertTrue(result)
        content = (self.skills_dir / "to-disable" / "SKILL.md").read_text()
        self.assertIn("disable-model-invocation: true", content)

    def test_disable_skill_already_disabled(self):
        self._create_skill("already-disabled", disabled=True)
        result = opt.disable_skill(self.skills_dir / "already-disabled" / "SKILL.md")
        self.assertFalse(result)

    def test_enable_skill(self):
        self._create_skill("to-enable", disabled=True)
        result = opt.enable_skill(self.skills_dir / "to-enable" / "SKILL.md")
        self.assertTrue(result)
        content = (self.skills_dir / "to-enable" / "SKILL.md").read_text()
        self.assertNotIn("disable-model-invocation: true", content)

    def test_disable_agent(self):
        self._create_agent("to-disable")
        result = opt.disable_agent(self.agents_dir / "to-disable.md")
        self.assertTrue(result)
        # Should be in .disabled/
        self.assertTrue((self.agents_dir / ".disabled" / "to-disable.md").is_file())
        self.assertFalse((self.agents_dir / "to-disable.md").is_file())

    def test_enable_agent(self):
        self._create_agent("to-restore")
        opt.disable_agent(self.agents_dir / "to-restore.md")
        result = opt.enable_agent("to-restore")
        self.assertTrue(result)
        self.assertTrue((self.agents_dir / "to-restore.md").is_file())
        self.assertFalse((self.agents_dir / ".disabled" / "to-restore.md").is_file())

    def test_estimate_tokens(self):
        self._create_skill("skill-a", "Short desc")
        self._create_skill("skill-b", "A much longer description with more words to add tokens")
        self._create_agent("agent-a")
        estimates = opt._estimate_tokens(opt._all_skills(), opt._all_agents())
        self.assertGreater(estimates["estimated_total_tokens"], 0)
        self.assertEqual(estimates["enabled_skills"], 2)
        self.assertEqual(estimates["enabled_agents"], 1)

    def test_optimize_dry_run(self):
        # Create a niche skill that should be disabled
        self._create_skill("atlas-metis", "The engine")
        self._create_skill("atlas-nestor", "Concierge")
        self._create_skill("atlas-armada", "Org deployment")
        self._create_agent("explorer")
        self._create_agent("armada-security")

        result = opt.optimize(db_path="/nonexistent.db", dry_run=True)
        self.assertTrue(result["dry_run"])
        self.assertIsNone(result["changes_applied"])
        # atlas-nestor and atlas-armada should be flagged for disabling
        self.assertIn("atlas-nestor", result["skills_to_disable"])
        # Core skills should be kept
        self.assertIn("atlas-metis", result["skills_kept"])
        # armada agent should be flagged for disabling
        self.assertIn("armada-security", result["agents_to_disable"])

    def test_optimize_applies_changes(self):
        self._create_skill("atlas-metis", "The engine")
        self._create_skill("atlas-nestor", "Concierge")
        self._create_agent("explorer")
        self._create_agent("armada-security")

        result = opt.optimize(db_path="/nonexistent.db", dry_run=False)
        self.assertIsNotNone(result["changes_applied"])
        self.assertIn("atlas-nestor", result["changes_applied"]["skills_disabled"])
        self.assertIn("armada-security", result["changes_applied"]["agents_disabled"])

    def test_status(self):
        self._create_skill("skill-a")
        self._create_skill("skill-b", disabled=True)
        self._create_agent("agent-a")
        s = opt.status()
        self.assertEqual(s["total_skills"], 2)
        self.assertEqual(s["enabled_skills"], 1)
        self.assertEqual(s["disabled_skills"], 1)

    def test_core_skills_never_disabled(self):
        self._create_skill("atlas-metis", "The engine")
        result = opt.optimize(db_path="/nonexistent.db", aggressive=True, dry_run=True)
        self.assertIn("atlas-metis", result["skills_kept"])
        self.assertNotIn("atlas-metis", result["skills_to_disable"])


if __name__ == "__main__":
    unittest.main()