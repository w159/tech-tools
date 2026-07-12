#!/usr/bin/env python3
"""Tests for skill_factory.py — auto-skill creation."""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import skill_factory


class TestSkillFactory(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        os.environ["ATLAS_HOME"] = self.tmpdir

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)
        del os.environ["ATLAS_HOME"]

    def test_validate_name_valid(self):
        self.assertIsNone(skill_factory._validate_name("my-skill"))
        self.assertIsNone(skill_factory._validate_name("learned-fix-bug"))

    def test_validate_name_invalid(self):
        self.assertIsNotNone(skill_factory._validate_name(""))
        self.assertIsNotNone(skill_factory._validate_name("UPPERCASE"))
        self.assertIsNotNone(skill_factory._validate_name("has spaces"))
        self.assertIsNotNone(skill_factory._validate_name("x" * 65))

    def test_skill_name_from_topic(self):
        name = skill_factory._skill_name_from_topic("Fix database migration errors")
        self.assertTrue(name.startswith("learned-"))
        self.assertTrue("database" in name or "migration" in name or "fix" in name)

    def test_create_skill(self):
        result = skill_factory.create_skill(
            "test-skill",
            "A test skill",
            "## Test\n\nThis is a test skill body."
        )
        self.assertTrue(result["success"])
        self.assertTrue(os.path.exists(result["path"]))
        content = open(result["path"]).read()
        self.assertIn("created_by: \"atlas-auto\"", content)
        self.assertIn("test-skill", content)

    def test_create_skill_duplicate(self):
        skill_factory.create_skill("dup-skill", "First", "body1")
        result = skill_factory.create_skill("dup-skill", "Second", "body2")
        self.assertFalse(result["success"])

    def test_create_skill_invalid_name(self):
        result = skill_factory.create_skill("INVALID", "desc", "body")
        self.assertFalse(result["success"])

    def test_existing_skill_names(self):
        skill_factory.create_skill("skill-a", "A", "body")
        skill_factory.create_skill("skill-b", "B", "body")
        names = skill_factory._existing_skill_names()
        self.assertIn("skill-a", names)
        self.assertIn("skill-b", names)

    def test_dedup_skill_name(self):
        existing = {"learned-fix", "learned-fix-2"}
        result = skill_factory._dedup_skill_name("learned-fix", existing)
        self.assertEqual(result, "learned-fix-3")
        result = skill_factory._dedup_skill_name("new-skill", existing)
        self.assertEqual(result, "new-skill")

    def test_auto_create_no_db(self):
        """Should return gracefully when no atlas DB exists."""
        # Point to a non-existent DB path
        result = skill_factory.auto_create_from_session(
            db_path=os.path.join(self.tmpdir, "nonexistent.db")
        )
        self.assertFalse(result["created"])
        self.assertIn("no atlas DB", result["reason"])

    def test_build_skill_md_has_provenance(self):
        md = skill_factory._build_skill_md("test", "desc", "body")
        self.assertIn('created_by: "atlas-auto"', md)
        self.assertIn("name: test", md)
        self.assertIn("description: \"desc\"", md)


if __name__ == "__main__":
    unittest.main()