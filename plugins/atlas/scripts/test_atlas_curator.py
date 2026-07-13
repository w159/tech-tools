#!/usr/bin/env python3
"""Tests for atlas_curator.py \u2014 skill lifecycle management."""

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
        skills_dir = os.path.join(self.tmpdir, "skills", "stale-skill")
        self.assertTrue(os.path.exists(os.path.join(skills_dir, ".stale")))

    def test_apply_transitions_archive_skill(self):
        self._create_auto_skill("old-skill", days_old=100)
        result = atlas_curator.apply_transitions()
        self.assertEqual(result["archived"], 1)
        archive_path = os.path.join(self.tmpdir, "skills", ".archive", "old-skill")
        self.assertTrue(os.path.exists(archive_path))

    def test_pinned_skill_exempt(self):
        skill_dir = self._create_auto_skill("pinned-skill", days_old=100)
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
        archive_path = os.path.join(self.tmpdir, "skills", ".archive", "to-archive")
        self.assertTrue(os.path.exists(archive_path))
        result = atlas_curator.restore_skill("to-archive")
        self.assertTrue(result["success"])
        active_path = os.path.join(self.tmpdir, "skills", "to-archive")
        self.assertTrue(os.path.exists(active_path))

    def test_reactivation(self):
        skill_dir = self._create_auto_skill("reactivate-me", days_old=45)
        atlas_curator.apply_transitions()
        self.assertTrue((skill_dir / ".stale").is_file())
        os.utime(skill_dir / "SKILL.md", (time.time(), time.time()))
        result = atlas_curator.apply_transitions()
        self.assertEqual(result["reactivated"], 1)
        self.assertFalse((skill_dir / ".stale").is_file())

    def test_status(self):
        self._create_auto_skill("skill-a", days_old=1)
        self._create_auto_skill("skill-b", days_old=45)
        atlas_curator.apply_transitions()
        s = atlas_curator.status()
        self.assertEqual(s["total_auto_skills"], 2)
        self.assertEqual(s["stale"], 1)

    def test_corrupt_state_surfaced(self):
        from pathlib import Path
        import io
        import contextlib

        skills_dir = Path(self.tmpdir) / "skills"
        skills_dir.mkdir(parents=True, exist_ok=True)
        state_file = skills_dir / ".curator_state"
        state_file.write_text("{not valid json", encoding="utf-8")
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            atlas_curator._load_state()
        output = err.getvalue()
        self.assertIn(str(state_file), output)
        self.assertTrue(
            "corrupt" in output.lower()
            or "jsondecodeerror" in output.lower()
            or "parse" in output.lower(),
            f"expected corruption diagnostic in stderr, got: {output!r}",
        )

    def test_archive_failure_surfaced(self):
        from pathlib import Path
        import io
        import contextlib
        from unittest import mock

        self._create_auto_skill("doomed", days_old=100)
        err = io.StringIO()
        with (
            contextlib.redirect_stderr(err),
            mock.patch("atlas_curator.shutil.move", side_effect=OSError("disk full")),
        ):
            atlas_curator.apply_transitions()
        output = err.getvalue()
        self.assertIn("doomed", output)
        self.assertTrue(
            "disk full" in output or "archive" in output.lower(),
            f"expected archive failure diagnostic in stderr, got: {output!r}",
        )
        active = Path(self.tmpdir) / "skills" / "doomed"
        self.assertTrue(active.is_dir())

    def test_only_manages_auto_skills(self):
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

    # --- _read_skill_provenance branches ---

    def test_read_skill_provenance_missing_skill_md(self):
        from pathlib import Path

        empty_dir = Path(self.tmpdir) / "empty"
        empty_dir.mkdir()
        self.assertIsNone(atlas_curator._read_skill_provenance(empty_dir))

    def test_read_skill_provenance_unquoted(self):
        from pathlib import Path

        skill_dir = Path(self.tmpdir) / "skills" / "unquoted"
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "SKILL.md").write_text(
            "---\nname: unquoted\ncreated_by: atlas-auto\n---\nbody\n",
            encoding="utf-8",
        )
        self.assertEqual(atlas_curator._read_skill_provenance(skill_dir), "atlas-auto")

    def test_read_skill_provenance_unicode_error(self):
        from pathlib import Path

        skill_dir = Path(self.tmpdir) / "skills" / "badenc"
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "SKILL.md").write_bytes(b"\xff\xfe\x00bad")
        self.assertIsNone(atlas_curator._read_skill_provenance(skill_dir))

    # --- _skill_activity_time OSError ---

    def test_skill_activity_time_oserror(self):
        from pathlib import Path
        from unittest import mock

        d = Path(self.tmpdir) / "act"
        d.mkdir()
        with mock.patch.object(Path, "rglob", side_effect=OSError("io error")):
            self.assertEqual(atlas_curator._skill_activity_time(d), 0.0)

    # --- _all_auto_skills skips ---

    def test_all_auto_skills_skips_dotted_dir(self):
        from pathlib import Path

        skills_dir = Path(self.tmpdir) / "skills"
        hidden = skills_dir / ".hidden"
        hidden.mkdir(parents=True, exist_ok=True)
        (hidden / "SKILL.md").write_text(
            '---\nname: hidden\ncreated_by: "atlas-auto"\n---\nbody\n',
            encoding="utf-8",
        )
        self.assertEqual(len(atlas_curator._all_auto_skills()), 0)

    def test_all_auto_skills_skips_dir_without_skill_md(self):
        from pathlib import Path

        skills_dir = Path(self.tmpdir) / "skills"
        no_skill = skills_dir / "no-skill-md"
        no_skill.mkdir(parents=True, exist_ok=True)
        self.assertEqual(len(atlas_curator._all_auto_skills()), 0)

    # --- apply_transitions edge cases ---

    def test_apply_transitions_zero_activity_treated_as_now(self):
        skill_dir = self._create_auto_skill("young-zero", days_old=0)
        os.utime(skill_dir / "SKILL.md", (0, 0))
        result = atlas_curator.apply_transitions()
        self.assertEqual(result["marked_stale"], 0)
        self.assertEqual(result["archived"], 0)
        self.assertFalse((skill_dir / ".stale").is_file())

    def test_apply_transitions_archive_dest_already_exists(self):
        from pathlib import Path

        skill_dir = self._create_auto_skill("dup-archive", days_old=100)
        archive_dir = Path(self.tmpdir) / "skills" / ".archive"
        archive_dir.mkdir(parents=True, exist_ok=True)
        (archive_dir / "dup-archive").mkdir()
        result = atlas_curator.apply_transitions()
        self.assertEqual(result["archived"], 0)
        self.assertTrue(skill_dir.is_dir())

    def test_apply_transitions_stale_write_oserror(self):
        import io
        import contextlib
        from pathlib import Path
        from unittest import mock

        self._create_auto_skill("stale-fail", days_old=45)
        original_write_text = Path.write_text

        def fail_on_stale(self, data, *args, **kwargs):
            if str(self).endswith("/.stale"):
                raise OSError("read-only")
            return original_write_text(self, data, *args, **kwargs)

        err = io.StringIO()
        with contextlib.redirect_stderr(err), mock.patch(
            "pathlib.Path.write_text", fail_on_stale
        ):
            atlas_curator.apply_transitions()
        self.assertIn("stale-fail", err.getvalue())
        self.assertIn("failed to mark", err.getvalue())

    def test_apply_transitions_reactivate_unlink_oserror(self):
        import io
        import contextlib
        from pathlib import Path
        from unittest import mock

        skill_dir = self._create_auto_skill("react-fail", days_old=0)
        (skill_dir / ".stale").write_text("old", encoding="utf-8")
        os.utime(skill_dir / "SKILL.md", (time.time(), time.time()))
        original_unlink = Path.unlink

        def fail_unlink_stale(self, *args, **kwargs):
            if str(self).endswith("/.stale"):
                raise OSError("permission denied")
            return original_unlink(self, *args, **kwargs)

        err = io.StringIO()
        with contextlib.redirect_stderr(err), mock.patch(
            "pathlib.Path.unlink", fail_unlink_stale
        ):
            atlas_curator.apply_transitions()
        self.assertIn("react-fail", err.getvalue())
        self.assertIn("failed to reactivate", err.getvalue())

    # --- pin/restore error paths ---

    def test_pin_skill_not_found(self):
        result = atlas_curator.pin_skill("nonexistent")
        self.assertFalse(result["success"])
        self.assertIn("not found", result["error"])

    def test_restore_skill_not_found(self):
        result = atlas_curator.restore_skill("nonexistent")
        self.assertFalse(result["success"])
        self.assertIn("not found", result["error"])

    def test_restore_skill_dest_exists(self):
        from pathlib import Path

        archive = Path(self.tmpdir) / "skills" / ".archive" / "conflict"
        archive.mkdir(parents=True, exist_ok=True)
        (archive / "SKILL.md").write_text("archived", encoding="utf-8")
        dest = Path(self.tmpdir) / "skills" / "conflict"
        dest.mkdir(parents=True, exist_ok=True)
        result = atlas_curator.restore_skill("conflict")
        self.assertFalse(result["success"])
        self.assertIn("already exists", result["error"])

    def test_restore_skill_move_error(self):
        from pathlib import Path
        from unittest import mock

        archive = Path(self.tmpdir) / "skills" / ".archive" / "movefail"
        archive.mkdir(parents=True, exist_ok=True)
        (archive / "SKILL.md").write_text("archived", encoding="utf-8")
        with mock.patch("atlas_curator.shutil.move", side_effect=OSError("disk full")):
            result = atlas_curator.restore_skill("movefail")
        self.assertFalse(result["success"])
        self.assertIn("disk full", result["error"])

    # --- CLI ---

    def _run_cli(self, argv):
        import io
        import contextlib
        from unittest import mock

        out = io.StringIO()
        with mock.patch.object(sys, "argv", argv):
            with contextlib.redirect_stdout(out):
                atlas_curator._cli()
        return out.getvalue()

    def test_cli_no_args(self):
        self.assertIn("Usage", self._run_cli(["atlas_curator.py"]))

    def test_cli_run(self):
        import json

        self.assertEqual(
            json.loads(self._run_cli(["atlas_curator.py", "run"]))["checked"], 0
        )

    def test_cli_status(self):
        import json

        self.assertIn(
            "total_auto_skills", json.loads(self._run_cli(["atlas_curator.py", "status"]))
        )

    def test_cli_pin_no_name(self):
        self.assertIn("Usage", self._run_cli(["atlas_curator.py", "pin"]))

    def test_cli_pin_with_name(self):
        import json

        self._create_auto_skill("cli-pin")
        self.assertTrue(
            json.loads(self._run_cli(["atlas_curator.py", "pin", "cli-pin"]))["success"]
        )

    def test_cli_unpin_no_name(self):
        self.assertIn("Usage", self._run_cli(["atlas_curator.py", "unpin"]))

    def test_cli_unpin_with_name(self):
        import json

        skill_dir = self._create_auto_skill("cli-unpin")
        (skill_dir / ".pinned").write_text(str(time.time()))
        self.assertTrue(
            json.loads(self._run_cli(["atlas_curator.py", "unpin", "cli-unpin"]))["success"]
        )

    def test_cli_restore_no_name(self):
        self.assertIn("Usage", self._run_cli(["atlas_curator.py", "restore"]))

    def test_cli_restore_with_name(self):
        import json

        self._create_auto_skill("cli-restore", days_old=100)
        atlas_curator.apply_transitions()
        self.assertTrue(
            json.loads(
                self._run_cli(["atlas_curator.py", "restore", "cli-restore"])
            )["success"]
        )

    def test_cli_unknown_command(self):
        self.assertIn("Unknown command", self._run_cli(["atlas_curator.py", "bogus"]))

    def test_main_entry_point(self):
        import io
        import contextlib
        import runpy
        from unittest import mock

        out = io.StringIO()
        with mock.patch.object(sys, "argv", ["atlas_curator.py"]):
            with contextlib.redirect_stdout(out):
                runpy.run_path(atlas_curator.__file__, run_name="__main__")
        self.assertIn("Usage", out.getvalue())


if __name__ == "__main__":
    unittest.main()
