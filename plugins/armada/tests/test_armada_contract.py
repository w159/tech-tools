#!/usr/bin/env python3
"""Deterministic contract tests for the armada plugin.

Guards the invariants that broke armada in the first place: department content
that Claude Code cannot discover, and a router skill that interrogates instead
of acting.

    python3 plugins/armada/tests/test_armada_contract.py
"""

import json
import re
import sys
import unittest
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
REPO = PLUGIN.parents[1]

# Setup skills a user must be able to invoke directly, in run order.
SETUP_SKILLS = ["armada", "armada-brand", "armada-department", "armada-connect"]

DEPARTMENT_AGENTS = {
    "it-operations": "armada-it-ops",
    "security": "armada-security",
    "microsoft-365": "armada-m365",
    "hr": "armada-hr",
    "finance": "armada-finance",
    "engineering": "armada-engineering",
    "data": "armada-data",
    "design": "armada-design",
    "product": "armada-product",
    "support": "armada-support",
    "productivity": "armada-productivity",
}


def frontmatter(path):
    """Parse the leading --- block without requiring PyYAML."""
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---", 4)
    if end == -1:
        return {}
    fields = {}
    for line in text[4:end].splitlines():
        m = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if m:
            fields[m.group(1)] = m.group(2).strip()
    return fields


def skill_dirs():
    return sorted(
        p for p in (PLUGIN / "skills").iterdir() if (p / "SKILL.md").is_file()
    )


class DiscoverabilityTest(unittest.TestCase):
    """Claude Code only scans skills/<name>/SKILL.md, commands/, and agents/."""

    def test_setup_skills_are_top_level_and_discoverable(self):
        found = {p.name for p in skill_dirs()}
        missing = [s for s in SETUP_SKILLS if s not in found]
        self.assertEqual(
            [], missing, f"not discoverable as skills/<name>/SKILL.md: {missing}"
        )

    def test_skill_dir_name_matches_frontmatter_name(self):
        for d in skill_dirs():
            fm = frontmatter(d / "SKILL.md")
            self.assertEqual(
                d.name, fm.get("name"), f"{d.name}: frontmatter name mismatch"
            )

    def test_every_skill_has_a_description(self):
        for d in skill_dirs():
            desc = frontmatter(d / "SKILL.md").get("description", "")
            self.assertGreater(
                len(desc), 40, f"{d.name}: description too thin to route on"
            )

    def test_skill_names_are_unique(self):
        names = [frontmatter(d / "SKILL.md").get("name") for d in skill_dirs()]
        self.assertEqual(len(names), len(set(names)), f"duplicate skill names: {names}")


class RouterTest(unittest.TestCase):
    """The root skill reports and routes; it does not run a setup interview."""

    def setUp(self):
        self.body = (PLUGIN / "skills" / "armada" / "SKILL.md").read_text(
            encoding="utf-8"
        )

    def test_root_skill_does_not_elicit(self):
        self.assertNotIn(
            "AskUserQuestion",
            self.body,
            "root armada skill must not interrogate; it scans and routes",
        )

    def test_root_skill_names_each_setup_skill(self):
        for name in SETUP_SKILLS[1:]:
            self.assertIn(name, self.body, f"root skill does not route to {name}")

    def test_root_skill_is_read_only(self):
        tools = frontmatter(PLUGIN / "skills" / "armada" / "SKILL.md").get(
            "allowed-tools", ""
        )
        for writer in ("Write", "Edit"):
            self.assertNotIn(
                writer, tools, "root skill must not write; the setup skills do"
            )


class PathReferenceTest(unittest.TestCase):
    """Every ${CLAUDE_PLUGIN_ROOT} path a skill cites must actually exist."""

    def test_plugin_root_references_resolve(self):
        pattern = re.compile(r"\$\{CLAUDE_PLUGIN_ROOT\}/([A-Za-z0-9_./-]+)")
        broken = []
        for d in skill_dirs():
            body = (d / "SKILL.md").read_text(encoding="utf-8")
            for rel in pattern.findall(body):
                if "*" in rel or "<" in rel:
                    continue
                rel = rel.rstrip('".,`')
                if not (PLUGIN / rel).exists():
                    broken.append(f"{d.name}: {rel}")
        self.assertEqual([], broken, f"dangling plugin-root references: {broken}")


class DepartmentTest(unittest.TestCase):
    def test_every_department_dir_has_its_agent(self):
        root = PLUGIN / "skills" / "armada" / "departments"
        dirs = {p.name for p in root.iterdir() if p.is_dir()}
        self.assertEqual(
            set(DEPARTMENT_AGENTS), dirs, "department dirs drifted from the agent map"
        )
        for dept, agent in DEPARTMENT_AGENTS.items():
            self.assertTrue(
                (PLUGIN / "agents" / f"{agent}.md").is_file(),
                f"{dept}: missing {agent}.md",
            )

    def test_onboarding_seed_exists(self):
        seed = (
            PLUGIN
            / "skills"
            / "armada"
            / "templates"
            / "department-onboarding.seed.yaml"
        )
        self.assertTrue(seed.is_file(), "armada-department seeds from this file")

    def test_department_table_lists_all_eleven(self):
        body = (PLUGIN / "skills" / "armada-department" / "SKILL.md").read_text(
            encoding="utf-8"
        )
        for dept, agent in DEPARTMENT_AGENTS.items():
            self.assertIn(dept, body, f"{dept} missing from the department table")
            self.assertIn(agent, body, f"{agent} missing from the department table")


class ManifestTest(unittest.TestCase):
    def test_claude_manifest_exists_and_kimi_is_gone(self):
        a = json.loads((PLUGIN / ".claude-plugin" / "plugin.json").read_text())
        self.assertEqual(a.get("name"), "armada")
        self.assertTrue(a.get("version"), "armada plugin version required")
        self.assertFalse(
            (PLUGIN / ".kimi-plugin").exists(),
            "kimi plugin manifest must not ship with armada",
        )

    def test_marketplace_lists_armada(self):
        mp = json.loads((REPO / ".claude-plugin" / "marketplace.json").read_text())
        names = [p["name"] for p in mp["plugins"]]
        self.assertIn("armada", names)

    def test_armada_declares_the_vendor_connectors_and_atlas_declares_none(self):
        """The 13 vendor MCP connectors and their 57 credential keys live on armada."""
        manifest = json.loads((PLUGIN / ".claude-plugin" / "plugin.json").read_text())
        self.assertEqual(manifest.get("mcpServers"), "./.mcp.json")
        servers = json.loads((PLUGIN / ".mcp.json").read_text())["mcpServers"]
        self.assertEqual(
            sorted(servers),
            sorted(
                "auvik blumira cipp connectwise falcon knowbe4 ninjaone panos "
                "paylocity sonicwall spanning threatlocker vanta".split()
            ),
        )
        self.assertEqual(len(manifest["userConfig"]), 57)
        for name in servers:
            self.assertTrue(
                (PLUGIN / "mcp" / name).is_dir(), f"mcp/{name} missing on armada"
            )
        atlas = json.loads(
            (REPO / "plugins" / "atlas" / ".claude-plugin" / "plugin.json").read_text()
        )
        self.assertNotIn("mcpServers", atlas)
        self.assertEqual(sorted(atlas.get("userConfig", {})), ["atlas_mod_sound"])


class EnterpriseModeTest(unittest.TestCase):
    """Enterprise mode lives in armada; the separate harbor plugin is gone."""

    SKILL = PLUGIN / "skills" / "armada-enterprise"
    REFERENCES = ["setup", "policy", "audit", "connect"]

    def test_enterprise_skill_exists_with_references(self):
        self.assertTrue((self.SKILL / "SKILL.md").is_file())
        fm = frontmatter(self.SKILL / "SKILL.md")
        self.assertEqual("armada-enterprise", fm.get("name"))
        for ref in self.REFERENCES:
            self.assertTrue(
                (self.SKILL / "references" / f"{ref}.md").is_file(),
                f"missing references/{ref}.md",
            )

    def test_enterprise_skill_and_references_resolve_paths(self):
        pattern = re.compile(r"\$\{CLAUDE_PLUGIN_ROOT\}/([A-Za-z0-9_./-]+)")
        files = [self.SKILL / "SKILL.md"] + sorted(
            (self.SKILL / "references").glob("*.md")
        )
        broken = []
        for f in files:
            for rel in pattern.findall(f.read_text(encoding="utf-8")):
                rel = rel.rstrip(".,`")
                if not (PLUGIN / rel).exists():
                    broken.append(f"{f.name}: {rel}")
        self.assertEqual([], broken, f"dangling plugin-root references: {broken}")

    def test_skill_routes_to_every_reference(self):
        body = (self.SKILL / "SKILL.md").read_text(encoding="utf-8")
        for ref in self.REFERENCES:
            self.assertIn(f"references/{ref}.md", body)

    def test_harbor_plugin_is_gone(self):
        self.assertFalse((REPO / "plugins" / "harbor").exists())
        mp = json.loads((REPO / ".claude-plugin" / "marketplace.json").read_text())
        self.assertNotIn("harbor", [p["name"] for p in mp["plugins"]])

    def test_enterprise_assets_moved_into_armada(self):
        ent = PLUGIN / "enterprise"
        for rel in (
            "infra/azure/main.bicep",
            "infra/azure/main.bicepparam",
            "queries/azure/unused-grants.kql",
            "templates/policy.example.yaml",
        ):
            self.assertTrue((ent / rel).is_file(), f"enterprise/{rel} missing")

    def test_router_names_enterprise_skill(self):
        body = (PLUGIN / "skills" / "armada" / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("armada-enterprise", body)
        readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
        self.assertIn("armada-enterprise", readme)


if __name__ == "__main__":
    sys.exit(0 if unittest.main(exit=False, verbosity=2).result.wasSuccessful() else 1)
