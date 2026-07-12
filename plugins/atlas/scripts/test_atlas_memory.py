#!/usr/bin/env python3
"""Tests for atlas_memory.py — persistent memory store."""

import json
import os
import sys
import tempfile
import unittest

# Add scripts dir to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import atlas_memory


class TestAtlasMemory(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        os.environ["ATLAS_HOME"] = self.tmpdir

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)
        del os.environ["ATLAS_HOME"]

    def test_add_and_read(self):
        result = atlas_memory.add("memory", "Test fact about the project")
        self.assertTrue(result["success"])
        entries = atlas_memory.get_entries("memory")
        self.assertEqual(len(entries), 1)
        self.assertIn("Test fact", entries[0])

    def test_add_duplicate(self):
        atlas_memory.add("memory", "Same fact")
        result = atlas_memory.add("memory", "Same fact")
        self.assertTrue(result["success"])
        self.assertIn("already exists", result["message"])
        entries = atlas_memory.get_entries("memory")
        self.assertEqual(len(entries), 1)

    def test_add_empty(self):
        result = atlas_memory.add("memory", "")
        self.assertFalse(result["success"])

    def test_replace(self):
        atlas_memory.add("memory", "Old entry about X")
        result = atlas_memory.replace("memory", "Old entry", "New entry about X")
        self.assertTrue(result["success"])
        entries = atlas_memory.get_entries("memory")
        self.assertEqual(len(entries), 1)
        self.assertIn("New entry", entries[0])

    def test_replace_no_match(self):
        atlas_memory.add("memory", "Some entry")
        result = atlas_memory.replace("memory", "nonexistent", "replacement")
        self.assertFalse(result["success"])

    def test_remove(self):
        atlas_memory.add("memory", "Entry to remove")
        result = atlas_memory.remove("memory", "Entry to remove")
        self.assertTrue(result["success"])
        entries = atlas_memory.get_entries("memory")
        self.assertEqual(len(entries), 0)

    def test_remove_no_match(self):
        atlas_memory.add("memory", "Some entry")
        result = atlas_memory.remove("memory", "nonexistent")
        self.assertFalse(result["success"])

    def test_project_target(self):
        result = atlas_memory.add("project", "Project-specific fact")
        self.assertTrue(result["success"])
        entries = atlas_memory.get_entries("project")
        self.assertEqual(len(entries), 1)
        # Memory should be separate from project
        mem_entries = atlas_memory.get_entries("memory")
        self.assertEqual(len(mem_entries), 0)

    def test_char_limit(self):
        # Add entries until we hit the limit
        for i in range(100):
            result = atlas_memory.add("memory", f"Fact number {i} " * 20)
            if not result["success"]:
                break
        # The last one should have failed
        self.assertFalse(result["success"])
        self.assertIn("exceed", result["error"])

    def test_load_snapshot(self):
        atlas_memory.add("memory", "Memory fact")
        atlas_memory.add("project", "Project fact")
        snapshot = atlas_memory.load_snapshot()
        self.assertIn("memory", snapshot)
        self.assertIn("project", snapshot)
        self.assertIn("Memory fact", snapshot["memory"])
        self.assertIn("Project fact", snapshot["project"])

    def test_load_snapshot_empty(self):
        snapshot = atlas_memory.load_snapshot()
        self.assertEqual(snapshot["memory"], "")
        self.assertEqual(snapshot["project"], "")

    def test_batch_operations(self):
        ops = [
            {"action": "add", "content": "Fact A"},
            {"action": "add", "content": "Fact B"},
            {"action": "add", "content": "Fact C"},
        ]
        result = atlas_memory.apply_batch("memory", ops)
        self.assertTrue(result["success"])
        entries = atlas_memory.get_entries("memory")
        self.assertEqual(len(entries), 3)

    def test_persistence_across_instances(self):
        atlas_memory.add("memory", "Persistent fact")
        # Verify it's on disk
        mem_path = os.path.join(self.tmpdir, "memory", "MEMORY.md")
        self.assertTrue(os.path.exists(mem_path))
        content = open(mem_path).read()
        self.assertIn("Persistent fact", content)

    def test_usage(self):
        atlas_memory.add("memory", "Some fact")
        u = atlas_memory.usage("memory")
        self.assertEqual(u["target"], "memory")
        self.assertEqual(u["entries"], 1)
        self.assertGreater(u["used"], 0)


if __name__ == "__main__":
    unittest.main()