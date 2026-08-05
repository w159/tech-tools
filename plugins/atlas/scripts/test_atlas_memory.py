#!/usr/bin/env python3
"""Tests for atlas_memory.py — persistent memory store."""

import io
import os
import runpy
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

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

    def test_char_limit_under_cap_unchanged(self):
        """(a) writing under cap works unchanged -- no regression."""
        result = atlas_memory.add("memory", "A short, ordinary fact")
        self.assertTrue(result["success"])
        self.assertNotIn("Rotated", result["message"])
        entries = atlas_memory.get_entries("memory")
        self.assertEqual(len(entries), 1)

    def test_at_cap_rotates_instead_of_failing(self):
        """(b) writing AT/OVER cap rotates instead of failing -- the lesson is
        stored, not dropped."""
        # Fill past the cap with distinct entries (dedupe would collapse
        # identical ones), each large enough that a handful crosses 20,000 chars.
        for i in range(60):
            result = atlas_memory.add("memory", f"Fact number {i} " * 20)
            self.assertTrue(result["success"], result)

        # The most recent add must have succeeded (never rejected)...
        self.assertTrue(result["success"])
        # ...and by now the cap must have been exceeded at least once, so at
        # least one add() reported a rotation rather than a plain append.
        rotated_any = False
        for i in range(60, 120):
            result = atlas_memory.add("memory", f"Fact number {i} " * 20)
            self.assertTrue(result["success"], result)
            if "Rotated" in result["message"]:
                rotated_any = True
        self.assertTrue(rotated_any, "expected at least one add() to rotate")

        # The live file must stay within the working cap.
        entries = atlas_memory.get_entries("memory")
        total = len(atlas_memory.ENTRY_DELIMITER.join(entries))
        self.assertLessEqual(total, atlas_memory.WORKING_CAP_CHARS)
        # And the newest fact is still present, i.e. NOT dropped.
        self.assertTrue(any("Fact number 119" in e for e in entries))

    def test_rotation_preserves_prior_content_in_archive(self):
        """(c) rotation preserves 100% of prior content in the archive --
        assert content, not just file existence."""
        added = []
        for i in range(80):
            content = f"Distinct rotation fact {i} " * 15
            result = atlas_memory.add("memory", content)
            self.assertTrue(result["success"], result)
            added.append(content.strip())

        live_entries = set(atlas_memory.get_entries("memory"))
        archive_path = atlas_memory._archive_path("memory")
        self.assertTrue(archive_path.is_file())
        archived_entries = set(atlas_memory._read_file(archive_path))

        # Every fact ever added is accounted for -- either still live or
        # rotated into the archive. None may be missing from both.
        for content in added:
            self.assertTrue(
                content in live_entries or content in archived_entries,
                f"fact lost entirely, in neither live file nor archive: {content[:60]!r}",
            )
        # The archive is non-trivial (something was actually rotated out).
        self.assertGreater(len(archived_entries), 0)

    def test_genuine_drop_when_single_entry_exceeds_cap(self):
        """(d) a genuine drop is still possible: a single entry larger than the
        whole working cap cannot be stored even after rotating everything else
        out, and that failure must be reported, not silent."""
        huge = "x" * (atlas_memory.WORKING_CAP_CHARS + 1000)
        result = atlas_memory.add("memory", huge)
        self.assertFalse(result["success"])
        self.assertIn("exceeding", result["error"])
        # Nothing was rotated away over this -- current entries preserved.
        self.assertEqual(atlas_memory.get_entries("memory"), [])

    def test_dedupe_prevents_repeat_entries_consuming_budget(self):
        """(e) dedupe prevents identical repeated lessons from consuming the
        rotation/archive budget."""
        for _ in range(10):
            result = atlas_memory.add("memory", "The exact same lesson every time")
        self.assertTrue(result["success"])
        self.assertIn("already exists", result["message"])
        entries = atlas_memory.get_entries("memory")
        self.assertEqual(len(entries), 1)
        # Nothing was ever rotated -- one entry can never exceed the cap.
        self.assertFalse(atlas_memory._archive_path("memory").exists())

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

    # --- import fallback paths (lines 35-39) ---

    def test_import_fallback_no_fcntl_no_msvcrt(self):
        """Both fcntl and msvcrt unavailable -> both fall back to None."""
        import builtins

        real_import = builtins.__import__
        source = open(atlas_memory.__file__).read()

        def fake_import(name, *args, **kwargs):
            if name == "fcntl":
                raise ImportError("blocked for test")
            if name == "msvcrt":
                raise ImportError("blocked for test")
            return real_import(name, *args, **kwargs)

        ns = {"__name__": "atlas_memory_import_test", "__file__": atlas_memory.__file__}
        with mock.patch("builtins.__import__", side_effect=fake_import):
            exec(compile(source, atlas_memory.__file__, "exec"), ns)
        self.assertIsNone(ns["fcntl"])
        self.assertIsNone(ns["msvcrt"])

    # --- _file_lock branches (lines 72-73, 80-81, 87-94) ---

    def test_file_lock_no_locking_module(self):
        """Both fcntl and msvcrt None -> lock is a no-op (yield + return)."""
        with (
            mock.patch.object(atlas_memory, "fcntl", None),
            mock.patch.object(atlas_memory, "msvcrt", None, create=True),
        ):
            result = atlas_memory.add("memory", "no lock path")
        self.assertTrue(result["success"])
        self.assertEqual(atlas_memory.get_entries("memory"), ["no lock path"])

    def test_file_lock_msvcrt_branch(self):
        """fcntl None, msvcrt present -> msvcrt lock/unlock path."""
        fake_msvcrt = mock.MagicMock()
        fake_msvcrt.LK_LOCK = 1
        fake_msvcrt.LK_UNLCK = 2

        def locking(fileno, op, length):
            if op == fake_msvcrt.LK_UNLCK:
                raise OSError("unlock failed")

        fake_msvcrt.locking.side_effect = locking
        with (
            mock.patch.object(atlas_memory, "fcntl", None),
            mock.patch.object(atlas_memory, "msvcrt", fake_msvcrt, create=True),
        ):
            result = atlas_memory.add("memory", "via msvcrt lock")
        self.assertTrue(result["success"])
        self.assertGreaterEqual(fake_msvcrt.locking.call_count, 2)

    def test_file_lock_fcntl_unlock_error(self):
        """fcntl.flock raising on LOCK_UN is swallowed in finally."""
        fake_fcntl = mock.MagicMock()
        fake_fcntl.LOCK_EX = 1
        fake_fcntl.LOCK_UN = 2

        def flock(fd, op):
            if op == fake_fcntl.LOCK_UN:
                raise OSError("unlock failed")

        fake_fcntl.flock.side_effect = flock
        with mock.patch.object(atlas_memory, "fcntl", fake_fcntl):
            result = atlas_memory.add("memory", "unlock error path")
        self.assertTrue(result["success"])

    # --- _read_file error path (lines 109-110) ---

    def test_read_file_decode_error(self):
        path = atlas_memory._path_for("memory")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"\xff\xfe\x00bad bytes")
        self.assertEqual(atlas_memory._read_file(path), [])

    # --- _write_file exception cleanup (lines 123-132) ---

    def test_write_file_exception_cleanup(self):
        path = atlas_memory._path_for("memory")
        path.parent.mkdir(parents=True, exist_ok=True)
        with (
            mock.patch.object(
                atlas_memory.os, "replace", side_effect=OSError("replace failed")
            ),
            mock.patch.object(
                atlas_memory.os, "unlink", side_effect=OSError("unlink failed")
            ),
        ):
            with self.assertRaises(OSError):
                atlas_memory._write_file(path, ["entry"])
        self.assertFalse(path.is_file())

    # --- replace validation branches (lines 206, 208, 227-229, 241) ---

    def test_replace_empty_old_text(self):
        result = atlas_memory.replace("memory", "   ", "new")
        self.assertFalse(result["success"])
        self.assertIn("old_text", result["error"])

    def test_replace_empty_new_content(self):
        result = atlas_memory.replace("memory", "x", "")
        self.assertFalse(result["success"])
        self.assertIn("new_content", result["error"])

    def test_replace_multiple_unique_matches(self):
        atlas_memory.add("memory", "shared token one")
        atlas_memory.add("memory", "shared token two")
        result = atlas_memory.replace("memory", "shared token", "replacement")
        self.assertFalse(result["success"])
        self.assertIn("Multiple entries", result["error"])

    def test_replace_exceeds_limit(self):
        atlas_memory.add("memory", "short")
        # Sized against WORKING_CAP_CHARS (20_000): a single entry too large to
        # rotate away must still be rejected, not silently dropped.
        result = atlas_memory.replace("memory", "short", "x" * 25000)
        self.assertFalse(result["success"])
        self.assertIn("Shorten or remove", result["error"])

    # --- remove validation branches (lines 257, 273-275) ---

    def test_remove_empty_old_text(self):
        result = atlas_memory.remove("memory", "   ")
        self.assertFalse(result["success"])
        self.assertIn("old_text", result["error"])

    def test_remove_multiple_unique_matches(self):
        atlas_memory.add("memory", "shared token one")
        atlas_memory.add("memory", "shared token two")
        result = atlas_memory.remove("memory", "shared token")
        self.assertFalse(result["success"])
        self.assertIn("Multiple entries", result["error"])

    # --- apply_batch replace/remove/budget (lines 304-318, 324) ---

    def test_batch_replace_and_remove(self):
        atlas_memory.add("memory", "original entry")
        atlas_memory.add("memory", "doomed entry")
        ops = [
            {"action": "replace", "old_text": "original", "content": "replaced entry"},
            {"action": "remove", "old_text": "doomed"},
        ]
        result = atlas_memory.apply_batch("memory", ops)
        self.assertTrue(result["success"])
        entries = atlas_memory.get_entries("memory")
        self.assertIn("replaced entry", entries)
        self.assertNotIn("doomed entry", entries)

    def test_batch_exceeds_budget(self):
        # Sized against WORKING_CAP_CHARS (20_000), same reasoning as
        # test_replace_exceeds_limit.
        ops = [{"action": "add", "content": "x" * 25000}]
        result = atlas_memory.apply_batch("memory", ops)
        self.assertFalse(result["success"])
        self.assertIn("Remove entries to make room", result["error"])

    # --- _cli branches (lines 352-380) ---

    def _run_cli(self, argv):
        buf = io.StringIO()
        with mock.patch.object(sys, "argv", argv), redirect_stdout(buf):
            atlas_memory._cli()
        return buf.getvalue()

    def test_cli_no_args(self):
        out = self._run_cli(["atlas_memory.py"])
        self.assertIn("Usage", out)

    def test_cli_snapshot(self):
        atlas_memory.add("memory", "snapshot fact")
        out = self._run_cli(["atlas_memory.py", "snapshot"])
        self.assertIn("MEMORY", out)

    def test_cli_list(self):
        atlas_memory.add("memory", "short")
        atlas_memory.add("memory", "x" * 200)
        out = self._run_cli(["atlas_memory.py", "list", "memory"])
        self.assertIn("[0]", out)
        self.assertIn("...", out)  # long entry truncated

    def test_cli_add(self):
        out = self._run_cli(["atlas_memory.py", "add", "memory", "cli", "fact"])
        self.assertIn("success", out)

    def test_cli_remove(self):
        atlas_memory.add("memory", "cli entry")
        out = self._run_cli(["atlas_memory.py", "remove", "memory", "cli", "entry"])
        self.assertIn("success", out)

    def test_cli_usage(self):
        out = self._run_cli(["atlas_memory.py", "usage", "memory"])
        self.assertIn("used", out)

    def test_cli_unknown_command(self):
        errbuf = io.StringIO()
        with (
            mock.patch.object(sys, "argv", ["atlas_memory.py", "bogus"]),
            redirect_stderr(errbuf),
        ):
            with self.assertRaises(SystemExit) as cm:
                atlas_memory._cli()
        self.assertEqual(cm.exception.code, 2)
        self.assertIn("Unknown command", errbuf.getvalue())

    def test_cli_help(self):
        out = self._run_cli(["atlas_memory.py", "--help"])
        self.assertIn("Usage", out)

    # --- __main__ entry (line 384) ---

    def test_main_entry_runs_cli(self):
        buf = io.StringIO()
        with (
            mock.patch.object(sys, "argv", ["atlas_memory.py", "usage", "memory"]),
            redirect_stdout(buf),
        ):
            runpy.run_path(atlas_memory.__file__, run_name="__main__")
        self.assertIn("used", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
