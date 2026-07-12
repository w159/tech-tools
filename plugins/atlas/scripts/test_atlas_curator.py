#!/usr/bin/env python3
"""Tests for atlas_curator.py — skill lifecycle management."""

import json
import os
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import atlas_curator


class TestAtlasCurator(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        os.environ["ATLAS_HOME"] = self.tmpdir

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)
        del os.environ["ATLAS_HOME"]

    def _create_auto_skill(self, name, days_old=0):
        """Create a skill with atlas-auto provenance."""
        from pathlib import Path
        skills_dir = Path(self.tmpdir) / "skills"
        skill_dir = skills_dir / name
        skill_dir.mkdir(parents=True, exist_ok=True)
        content = f"""---
name: {name}
description: "Test skill"
created_by: "atlas-auto"
created_at: "2025-01-01T00:00:00Z"
---

# {name}

Test body.
"""
        (skill_dir / "SKILL.md").write_text(content)
        # Set mtime to simulate age
        if days_old > 0:
            old_time = time.time() - (days_old * 86400)
            os.utime(skill_dir / "SKILL.md", (old_time, old_time))
        return skill_dir

    def test_apply_transitions_no_skills(self):
        result = atlas_curator.apply_transitions()
        self.assertEqual(result["checked"], 0)

    def test_apply_transitions_active_skill(self):
        self._create_auto_skill("active-skill", days_old=1)
        result = atlas_curator.apply_transitions()
        self.assertEqual(result["checked"], 1)
        self.assertEqual(result["marked_stale"], 0)
        self.assertEqual(result["archived"], 0)

    def test_apply_transitions_stale_skill(self):
        self._create_auto_skill("stale-skill", days_old=45)
        result = atlas_curator.apply_transitions()
        self.assertEqual(result["marked_stale"], 1)
        # Stale marker should exist
        skills_dir = os.path.join(self.tmpdir, "skills", "stale-skill")
        self.assertTrue(os.path.exists(os.path.join(skills_dir, ".stale")))

    def test_apply_transitions_archive_skill(self):
        self._create_auto_skill("old-skill", days_old=100)
        result = atlas_curator.apply_transitions()
        self.assertEqual(result["archived"], 1)
        # Skill should be in archive
        archive_path = os.path.join(self.tmpdir, "skills", ".archive", "old-skill")
        self.assertTrue(os.path.exists(archive_path))

    def test_pinned_skill_exempt(self):
        skill_dir = self._create_auto_skill("pinned-skill", days_old=100)
        # Pin it
        (skill_dir / ".pinned").write_text(str(time.time()))
        result = atlas_curator.apply_transitions()
        self.assertEqual(result["skipped_pinned"], 1)
        self.assertEqual(result["archived"], 0)

    def test_pin_skill(self):
        self._create_auto_skill("to-pin")
        result = atlas_curator.pin_skill("to-pin")
        self.assertTrue(result["success"])
        pin_path = os.path.join(self.tmpdir, "skills", "to-pin", ".pinned")
        self.assertTrue(os.path.exists(pin_path))

    def test_unpin_skill(self):
        skill_dir = self._create_auto_skill("to-unpin")
        (skill_dir / ".pinned").write_text(str(time.time()))
        result = atlas_curator.unpin_skill("to-unpin")
        self.assertTrue(result["success"])
        pin_path = os.path.join(self.tmpdir, "skills", "to-unpin", ".pinned")
        self.assertFalse(os.path.exists(pin_path))

    def test_restore_skill(self):
        self._create_auto_skill("to-archive", days_old=100)
        atlas_curator.apply_transitions()
        # Should be archived
        archive_path = os.path.join(self.tmpdir, "skills", ".archive", "to-archive")
        self.assertTrue(os.path.exists(archive_path))
        # Restore
        result = atlas_curator.restore_skill("to-archive")
        self.assertTrue(result["success"])
        # Should be back in active
        active_path = os.path.join(self.tmpdir, "skills", "to-archive")
        self.assertTrue(os.path.exists(active_path))

    def test_reactivation(self):
        skill_dir = self._create_auto_skill("reactivate-me", days_old=45)
        # Mark stale
        atlas_curator.apply_transitions()
        self.assertTrue((skill_dir / ".stale").is_file())
        # Touch the skill file to make it active again
        os.utime(skill_dir / "SKILL.md", (time.time(), time.time()))
        result = atlas_curator.apply_transitions()
        self.assertEqual(result["reactivated"], 1)
        self.assertFalse((skill_dir / ".stale").is_file())

    def test_status(self):
        self._create_auto_skill("skill-a", days_old=1)
        self._create_auto_skill("skill-b", days_old=45)
        # Run transitions first to mark stale skills
        atlas_curator.apply_transitions()
        s = atlas_curator.status()
        self.assertEqual(s["total_auto_skills"], 2)
        self.assertEqual(s["stale"], 1)

    def test_only_manages_auto_skills(self):
        """Skills without atlas-auto provenance should be ignored."""
        from pathlib import Path
        skills_dir = Path(self.tmpdir) / "skills"
        skill_dir = skills_dir / "manual-skill"
        skill_dir.mkdir(parents=True, exist_ok=True)
        content = """---
name: manual-skill
description: "Manual skill"
---

# manual-skill
"""
        (skill_dir / "SKILL.md").write_text(content)
        result = atlas_curator.apply_transitions()
        self.assertEqual(result["checked"], 0)


if __name__ == "__main__":
    unittest.main()