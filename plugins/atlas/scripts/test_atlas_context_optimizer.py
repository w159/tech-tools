#!/usr/bin/env python3
"""Tests for atlas_context_optimizer.py — disable unused skills/agents."""

import contextlib
import io
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

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
        self._create_skill(
            "skill-b", "A much longer description with more words to add tokens"
        )
        self._create_agent("agent-a")
        estimates = opt._estimate_tokens(opt._all_skills(), opt._all_agents())
        self.assertGreater(estimates["estimated_total_tokens"], 0)
        self.assertEqual(estimates["enabled_skills"], 2)
        self.assertEqual(estimates["enabled_agents"], 1)

    def test_optimize_dry_run(self):
        # Create a niche skill that should be disabled
        self._create_skill("atlas-orchestrate", "The engine")
        self._create_skill("atlas-wiki", "Wiki")
        self._create_skill("armada", "Org deployment")
        self._create_agent("explorer")
        self._create_agent("armada-security")

        result = opt.optimize(db_path="/nonexistent.db", dry_run=True)
        self.assertTrue(result["dry_run"])
        self.assertIsNone(result["changes_applied"])
        # atlas-wiki and armada should be flagged for disabling
        self.assertIn("atlas-wiki", result["skills_to_disable"])
        # Core skills should be kept
        self.assertIn("atlas-orchestrate", result["skills_kept"])
        # armada agent should be flagged for disabling
        self.assertIn("armada-security", result["agents_to_disable"])

    def test_optimize_applies_changes(self):
        self._create_skill("atlas-orchestrate", "The engine")
        self._create_skill("atlas-wiki", "Wiki")
        self._create_agent("explorer")
        self._create_agent("armada-security")

        result = opt.optimize(db_path="/nonexistent.db", dry_run=False)
        self.assertIsNotNone(result["changes_applied"])
        self.assertIn("atlas-wiki", result["changes_applied"]["skills_disabled"])
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
        # Every CORE_SKILLS member must be kept and never disabled, even under
        # aggressive optimize with no usage DB. Covers the original core set
        # plus the newly added atlas-debug, atlas-feature, atlas-validate.
        core_members = [
            "atlas-orchestrate",
            "atlas-setup",
            "atlas-audit",
            "atlas-debug",
            "atlas-feature",
            "atlas-validate",
        ]
        for name in core_members:
            self._create_skill(name, "core skill")
        # New niche members remain disable-eligible when unused.
        for name in ("atlas-harden", "atlas-refactor", "atlas-frontend"):
            self._create_skill(name, "niche skill")

        result = opt.optimize(db_path="/nonexistent.db", aggressive=True, dry_run=True)

        for name in core_members:
            self.assertIn(name, result["skills_kept"])
            self.assertNotIn(name, result["skills_to_disable"])
        for name in ("atlas-harden", "atlas-refactor", "atlas-frontend"):
            self.assertIn(name, result["skills_to_disable"])

    def test_disable_skill_surfaces_oserror(self):
        # A read-only SKILL.md (or disk-full) must not silently pass: the
        # failure must surface to stderr AND disable_skill must report it did
        # NOT change state, so the optimizer cannot claim it disabled a skill
        # that is still enabled.
        import contextlib
        import io
        from unittest import mock

        self._create_skill("to-disable", "A skill")
        skill_md = self.skills_dir / "to-disable" / "SKILL.md"

        err_buf = io.StringIO()
        with (
            mock.patch.object(
                Path, "write_text", side_effect=OSError("read-only filesystem")
            ),
            contextlib.redirect_stderr(err_buf),
        ):
            result = opt.disable_skill(skill_md)

        # Function must report it did NOT disable.
        self.assertFalse(result)
        # Failure must be surfaced to stderr, not swallowed silently.
        self.assertIn("OSError", err_buf.getvalue())
        # Skill must remain enabled (no flag written).
        self.assertNotIn("disable-model-invocation: true", skill_md.read_text())

    def test_db_error_aborts_optimize_not_disables_all(self):
        # A non-core niche skill that WOULD be disabled on an empty used-set,
        # plus a non-core agent that WOULD be disabled on an empty used-set.
        self._create_skill("atlas-wiki", "Wiki")
        self._create_agent("explorer")  # core, always kept
        self._create_agent("custom-agent")  # non-core, would be disabled on empty usage

        # Make the DB unreadable: a file that exists (so os.path.exists is True)
        # but is not a valid SQLite database, so the SELECT inside
        # _skills_used_in_db/_agents_used_in_db raises sqlite3.Error.
        bad_db = Path(self.tmpdir) / "corrupt.db"
        bad_db.write_text("not a sqlite database")

        skill_md = self.skills_dir / "atlas-wiki" / "SKILL.md"

        # optimize must abort with an error rather than fail-open and silently
        # disable the entire non-core fleet on a single transient DB read error.
        with self.assertRaises(Exception):
            opt.optimize(db_path=str(bad_db), dry_run=False)

        # No skill should have been disabled — fail-safe, not fail-open.
        self.assertNotIn("disable-model-invocation: true", skill_md.read_text())

    def _make_usage_db(self, db_path, tool_calls=None, dispatches=None):
        """Build a real atlas-shaped SQLite usage DB for the _skills/_agents_used_in_db queries."""
        conn = sqlite3.connect(db_path)
        conn.execute("CREATE TABLE tool_calls (target TEXT, kind TEXT, ts TEXT)")
        conn.execute("CREATE TABLE dispatches (agent_type TEXT, ts TEXT)")
        for tc in tool_calls or []:
            conn.execute(
                "INSERT INTO tool_calls (target, kind, ts) VALUES (?, ?, ?)", tc
            )
        for d in dispatches or []:
            conn.execute("INSERT INTO dispatches (agent_type, ts) VALUES (?, ?)", d)
        conn.commit()
        conn.close()

    def test_plugin_root_fallback_without_env(self):
        # Without CLAUDE_PLUGIN_ROOT, _plugin_root falls back to the script's
        # own location (parent.parent == plugins/atlas).
        saved = os.environ.pop("CLAUDE_PLUGIN_ROOT", None)
        try:
            result = opt._plugin_root()
            self.assertEqual(result, Path(opt.__file__).resolve().parent.parent)
        finally:
            if saved is not None:
                os.environ["CLAUDE_PLUGIN_ROOT"] = saved

    def test_all_skills_returns_empty_when_no_skills_dir(self):
        # skills dir never created -> is_dir() False -> empty list (line 98).
        self.assertEqual(opt._all_skills(), [])

    def test_all_skills_skips_non_dir_dotfile_and_missing_skillmd(self):
        self.skills_dir.mkdir(parents=True, exist_ok=True)
        (self.skills_dir / "a-file.txt").write_text("x")  # not a dir (line 101)
        (self.skills_dir / ".hidden").mkdir()  # dot-prefixed dir (line 103)
        (self.skills_dir / "no-skill-md").mkdir()  # dir without SKILL.md (line 106)
        self._create_skill("valid-skill", "v")
        skills = opt._all_skills()
        self.assertEqual([s["name"] for s in skills], ["valid-skill"])

    def test_all_agents_returns_empty_when_no_agents_dir(self):
        import shutil

        shutil.rmtree(self.agents_dir)
        self.assertEqual(opt._all_agents(), [])

    def test_parse_skill_frontmatter_no_frontmatter(self):
        skill_md = self.skills_dir / "nofm" / "SKILL.md"
        skill_md.parent.mkdir(parents=True, exist_ok=True)
        skill_md.write_text("# no frontmatter here\n")
        info = opt._parse_skill_frontmatter(skill_md)
        self.assertFalse(info["disabled"])
        self.assertEqual(info["description"], "")

    def test_parse_skill_frontmatter_no_closing_marker(self):
        skill_md = self.skills_dir / "noend" / "SKILL.md"
        skill_md.parent.mkdir(parents=True, exist_ok=True)
        skill_md.write_text("---\nname: noend\ndescription: x\n")
        info = opt._parse_skill_frontmatter(skill_md)
        self.assertFalse(info["disabled"])

    def test_parse_skill_frontmatter_line_without_colon(self):
        skill_md = self.skills_dir / "nocolon" / "SKILL.md"
        skill_md.parent.mkdir(parents=True, exist_ok=True)
        skill_md.write_text(
            "---\nname: nocolon\njust a line with no colon\ndescription: d\n---\n"
        )
        info = opt._parse_skill_frontmatter(skill_md)
        self.assertEqual(info["description"], "d")

    def test_parse_skill_frontmatter_user_invocable(self):
        skill_md = self.skills_dir / "manual" / "SKILL.md"
        skill_md.parent.mkdir(parents=True, exist_ok=True)
        skill_md.write_text(
            "---\nname: manual\nuser-invocable: true\ndescription: d\n---\n"
        )
        info = opt._parse_skill_frontmatter(skill_md)
        self.assertTrue(info["manual"])

    def test_parse_skill_frontmatter_read_error(self):
        skill_md = self.skills_dir / "err" / "SKILL.md"
        skill_md.parent.mkdir(parents=True, exist_ok=True)
        skill_md.write_text("---\nname: err\n---\n")
        with mock.patch.object(Path, "read_text", side_effect=OSError("boom")):
            info = opt._parse_skill_frontmatter(skill_md)
        self.assertFalse(info["disabled"])
        self.assertEqual(info["description"], "")

    def test_skills_used_in_db_returns_normalized(self):
        db = str(Path(self.tmpdir) / "usage.db")
        self._make_usage_db(
            db, tool_calls=[("atlas:atlas-wiki", "skill", "2024-01-01")]
        )
        used = opt._skills_used_in_db(db)
        self.assertIn("atlas-wiki", used)
        self.assertIn("wiki", used)
        self.assertIn("atlas:atlas-wiki", used)

    def test_skills_used_in_db_empty_target_skipped(self):
        db = str(Path(self.tmpdir) / "usage.db")
        self._make_usage_db(db, tool_calls=[(None, "skill", "2024-01-01")])
        self.assertEqual(opt._skills_used_in_db(db), set())

    def test_agents_used_in_db_returns_normalized(self):
        db = str(Path(self.tmpdir) / "usage.db")
        self._make_usage_db(
            db,
            dispatches=[("custom-agent", "2024-01-01")],
            tool_calls=[("atlas:custom-agent", "agent", "2024-01-01")],
        )
        used = opt._agents_used_in_db(db)
        self.assertIn("custom-agent", used)
        self.assertIn("atlas:custom-agent", used)

    def test_agents_used_in_db_raises_on_corrupt_db(self):
        # A corrupt DB must surface sqlite3.Error (fail-loud) from
        # _agents_used_in_db, not fail-open to an empty used-set.
        bad_db = Path(self.tmpdir) / "corrupt.db"
        bad_db.write_text("not a sqlite database")
        with self.assertRaises(sqlite3.Error):
            opt._agents_used_in_db(str(bad_db))

    def test_disable_skill_no_frontmatter(self):
        skill_md = self.skills_dir / "nofm" / "SKILL.md"
        skill_md.parent.mkdir(parents=True, exist_ok=True)
        skill_md.write_text("# no frontmatter\n")
        self.assertFalse(opt.disable_skill(skill_md))

    def test_disable_skill_no_closing_marker(self):
        skill_md = self.skills_dir / "noend" / "SKILL.md"
        skill_md.parent.mkdir(parents=True, exist_ok=True)
        skill_md.write_text("---\nname: noend\n")
        self.assertFalse(opt.disable_skill(skill_md))

    def test_disable_skill_unicode_error(self):
        self._create_skill("to-disable", "a skill")
        skill_md = self.skills_dir / "to-disable" / "SKILL.md"
        with mock.patch.object(
            Path,
            "read_text",
            side_effect=UnicodeDecodeError("utf-8", b"", 0, 1, "reason"),
        ):
            self.assertFalse(opt.disable_skill(skill_md))

    def test_enable_skill_no_change_when_not_disabled(self):
        self._create_skill("enabled", "a skill")
        skill_md = self.skills_dir / "enabled" / "SKILL.md"
        self.assertFalse(opt.enable_skill(skill_md))

    def test_enable_skill_unicode_error(self):
        self._create_skill("to-enable", disabled=True)
        skill_md = self.skills_dir / "to-enable" / "SKILL.md"
        with mock.patch.object(
            Path,
            "read_text",
            side_effect=UnicodeDecodeError("utf-8", b"", 0, 1, "reason"),
        ):
            self.assertFalse(opt.enable_skill(skill_md))

    def test_enable_skill_surfaces_oserror(self):
        self._create_skill("to-enable", disabled=True)
        skill_md = self.skills_dir / "to-enable" / "SKILL.md"
        err_buf = io.StringIO()
        with (
            mock.patch.object(Path, "write_text", side_effect=OSError("read-only")),
            contextlib.redirect_stderr(err_buf),
        ):
            result = opt.enable_skill(skill_md)
        self.assertFalse(result)
        self.assertIn("OSError", err_buf.getvalue())

    def test_disable_agent_not_a_file(self):
        self.assertFalse(opt.disable_agent(self.agents_dir / "missing.md"))

    def test_disable_agent_dest_exists(self):
        self._create_agent("dup")
        disabled_dir = self.agents_dir / ".disabled"
        disabled_dir.mkdir(exist_ok=True)
        (disabled_dir / "dup.md").write_text("# already disabled\n")
        self.assertFalse(opt.disable_agent(self.agents_dir / "dup.md"))

    def test_disable_agent_oserror(self):
        self._create_agent("to-disable")
        agent_md = self.agents_dir / "to-disable.md"
        with mock.patch.object(Path, "rename", side_effect=OSError("perm denied")):
            self.assertFalse(opt.disable_agent(agent_md))

    def test_enable_agent_not_disabled(self):
        self.assertFalse(opt.enable_agent("never-disabled"))

    def test_enable_agent_oserror(self):
        self._create_agent("to-restore")
        opt.disable_agent(self.agents_dir / "to-restore.md")
        with mock.patch.object(Path, "rename", side_effect=OSError("perm denied")):
            self.assertFalse(opt.enable_agent("to-restore"))

    def test_optimize_empty_db_path_uses_atlas_db_env(self):
        self._create_skill("atlas-orchestrate", "engine")
        self._create_agent("explorer")
        with mock.patch.dict(os.environ, {"ATLAS_DB": "/nonexistent.db"}):
            result = opt.optimize(dry_run=True)
        self.assertTrue(result["dry_run"])

    def test_optimize_skips_already_disabled_skill(self):
        self._create_skill("atlas-wiki", "wiki", disabled=True)
        result = opt.optimize(db_path="/nonexistent.db", dry_run=True)
        self.assertIn("atlas-wiki", result["skills_kept"])
        self.assertNotIn("atlas-wiki", result["skills_to_disable"])

    def test_optimize_aggressive_disables_noncore_unused_skill(self):
        self._create_skill("random-skill", "a skill")
        result = opt.optimize(db_path="/nonexistent.db", aggressive=True, dry_run=True)
        self.assertIn("random-skill", result["skills_to_disable"])

    def test_optimize_skips_already_disabled_agent(self):
        self._create_agent("custom-agent")
        # Mark disabled via the .disabled/ marker while keeping the file in
        # agents_dir, so _all_agents reports disabled=True (line 410-411).
        disabled_dir = self.agents_dir / ".disabled"
        disabled_dir.mkdir(exist_ok=True)
        (disabled_dir / "custom-agent.md").write_text("# disabled marker\n")
        result = opt.optimize(db_path="/nonexistent.db", dry_run=True)
        self.assertIn("custom-agent", result["agents_kept"])
        self.assertNotIn("custom-agent", result["agents_to_disable"])

    def test_optimize_agent_used_and_unused_branches(self):
        db = str(Path(self.tmpdir) / "usage.db")
        self._make_usage_db(db, dispatches=[("custom-used", "2024-01-01")])
        self._create_agent("custom-used")
        self._create_agent("custom-unused")
        result = opt.optimize(db_path=db, dry_run=True)
        self.assertIn("custom-used", result["agents_kept"])
        self.assertIn("custom-unused", result["agents_to_disable"])

    def test_cli_no_args(self):
        buf = io.StringIO()
        with mock.patch.object(sys, "argv", ["prog"]), contextlib.redirect_stdout(buf):
            opt._cli()
        self.assertIn("Usage", buf.getvalue())

    def test_cli_status(self):
        self._create_skill("skill-a")
        self._create_agent("agent-a")
        buf = io.StringIO()
        with (
            mock.patch.object(sys, "argv", ["prog", "status"]),
            contextlib.redirect_stdout(buf),
        ):
            opt._cli()
        data = json.loads(buf.getvalue())
        self.assertEqual(data["total_skills"], 1)

    def test_cli_optimize_dry_run(self):
        self._create_skill("atlas-orchestrate", "engine")
        self._create_skill("atlas-wiki", "wiki")
        self._create_agent("explorer")
        buf = io.StringIO()
        with (
            mock.patch.object(sys, "argv", ["prog", "optimize", "--dry-run"]),
            mock.patch.dict(os.environ, {"ATLAS_DB": "/nonexistent.db"}),
            contextlib.redirect_stdout(buf),
        ):
            opt._cli()
        data = json.loads(buf.getvalue())
        self.assertTrue(data["dry_run"])

    def test_cli_enable_skill(self):
        self._create_skill("to-enable", disabled=True)
        buf = io.StringIO()
        with (
            mock.patch.object(sys, "argv", ["prog", "enable", "skill", "to-enable"]),
            contextlib.redirect_stdout(buf),
        ):
            opt._cli()
        self.assertTrue(json.loads(buf.getvalue())["success"])

    def test_cli_enable_agent(self):
        self._create_agent("to-restore")
        opt.disable_agent(self.agents_dir / "to-restore.md")
        buf = io.StringIO()
        with (
            mock.patch.object(sys, "argv", ["prog", "enable", "agent", "to-restore"]),
            contextlib.redirect_stdout(buf),
        ):
            opt._cli()
        self.assertTrue(json.loads(buf.getvalue())["success"])

    def test_cli_enable_no_kind(self):
        buf = io.StringIO()
        with (
            mock.patch.object(sys, "argv", ["prog", "enable"]),
            contextlib.redirect_stdout(buf),
        ):
            opt._cli()
        self.assertIn("Usage", buf.getvalue())

    def test_cli_disable_skill(self):
        self._create_skill("to-disable", "a skill")
        buf = io.StringIO()
        with (
            mock.patch.object(sys, "argv", ["prog", "disable", "skill", "to-disable"]),
            contextlib.redirect_stdout(buf),
        ):
            opt._cli()
        self.assertTrue(json.loads(buf.getvalue())["success"])

    def test_cli_disable_agent(self):
        self._create_agent("to-disable")
        buf = io.StringIO()
        with (
            mock.patch.object(sys, "argv", ["prog", "disable", "agent", "to-disable"]),
            contextlib.redirect_stdout(buf),
        ):
            opt._cli()
        self.assertTrue(json.loads(buf.getvalue())["success"])

    def test_cli_disable_no_kind(self):
        buf = io.StringIO()
        with (
            mock.patch.object(sys, "argv", ["prog", "disable"]),
            contextlib.redirect_stdout(buf),
        ):
            opt._cli()
        self.assertIn("Usage", buf.getvalue())

    def test_cli_unknown_command(self):
        buf = io.StringIO()
        with (
            mock.patch.object(sys, "argv", ["prog", "bogus"]),
            contextlib.redirect_stdout(buf),
        ):
            opt._cli()
        self.assertIn("Unknown command", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
