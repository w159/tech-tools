#!/usr/bin/env python3
"""Extra tests for atlas_memory.py: per-project stores, root refusal,
on-disk format, global->project migration, and CLI target parsing."""

import _test_isolation  # noqa: F401,E402
import io
import os
import sqlite3
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
import atlas_memory as am  # noqa: E402

D = am.ENTRY_DELIMITER


class Base(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(os.path.realpath(tmp.name))
        self.home = self.tmp / "home"
        self.home.mkdir()
        p = mock.patch.dict(os.environ, {"ATLAS_HOME": str(self.home / ".atlas"),
                                         "HOME": str(self.home)})
        p.start()
        self.addCleanup(p.stop)

    def repo(self, name):
        r = self.tmp / "work" / name
        (r / ".git").mkdir(parents=True)
        return r


class ProjectStoreTest(Base):
    def test_add_with_root_writes_under_project_atlas_memory(self):
        r = self.repo("alpha")
        res = am.add("project", "alpha fact", root=str(r))
        self.assertTrue(res["success"], res)
        f = r / ".atlas" / "memory" / "MEMORY.md"
        self.assertEqual(f.read_text(encoding="utf-8"), "alpha fact")
        self.assertEqual(am.get_entries("project", root=str(r)), ["alpha fact"])
        # nothing leaked to the global store
        self.assertEqual(am.get_entries("project"), [])
        self.assertEqual(am.get_entries("memory"), [])

    def test_write_creates_missing_parent_dirs(self):
        path = self.tmp / "a" / "b" / "c" / "MEMORY.md"
        am._write_file(path, ["x", "y"])
        self.assertEqual(path.read_text(encoding="utf-8"), "x" + D + "y")
        am._write_file(path, [])
        self.assertEqual(path.read_text(encoding="utf-8"), "")
        self.assertEqual([p.name for p in path.parent.glob("*.tmp")], [])

    def test_add_refuses_home_root(self):
        res = am.add("project", "x", root=str(self.home))
        self.assertFalse(res["success"])
        self.assertIn("not a project", res["error"])
        self.assertFalse((self.home / ".atlas" / "memory" / "MEMORY.md").exists())

    def test_add_refuses_root_inside_atlas_folder(self):
        r = self.repo("beta")
        inner = r / ".atlas" / "memory"
        res = am.add("project", "x", root=str(inner))
        self.assertFalse(res["success"])
        self.assertIn(".atlas", res["error"])

    def test_replace_and_remove_report_bad_root(self):
        self.assertFalse(am.replace("project", "a", "b", root=str(self.home))["success"])
        self.assertFalse(am.remove("project", "a", root=str(self.home))["success"])

    def test_project_memory_dir_imports_atlas_paths_without_sys_path(self):
        r = self.repo("gamma")
        here = os.path.dirname(os.path.abspath(am.__file__))
        saved_mod = sys.modules.pop("atlas_paths", None)
        saved_path = list(sys.path)
        try:
            sys.path[:] = [p for p in sys.path
                           if os.path.abspath(p or ".") != here]
            d = am._project_memory_dir(str(r))
            self.assertIn(here, sys.path)
        finally:
            sys.path[:] = saved_path
            if saved_mod is not None:
                sys.modules["atlas_paths"] = saved_mod
        self.assertEqual(d, r / ".atlas" / "memory")

    def test_archive_path_names(self):
        r = self.repo("delta")
        g = am._archive_path("project")
        self.assertTrue(g.name.startswith("PROJECT-"))
        self.assertEqual(g.parent, self.home / ".atlas" / "memory" / "archive")
        self.assertTrue(am._archive_path("memory").name.startswith("MEMORY-"))
        p = am._archive_path("project", str(r))
        self.assertTrue(p.name.startswith("MEMORY-"))
        self.assertEqual(p.parent, r / ".atlas" / "memory" / "archive")


class TagTest(unittest.TestCase):
    def test_tag_of(self):
        self.assertEqual(am.tag_of("(proj) fact"), "proj")
        self.assertEqual(am.tag_of("note [other-x] fact"), "other-x")
        self.assertEqual(am.tag_of("  no tag here"), "")
        self.assertEqual(am.tag_of("fact (late tag)"), "late tag")
        self.assertEqual(am.tag_of("x" * 61 + " (too far)"), "")


class MigrationTest(Base):
    def make_db(self, rows):
        db = self.tmp / "atlas.db"
        conn = sqlite3.connect(db)
        conn.execute("CREATE TABLE projects (root_path TEXT, name TEXT)")
        conn.executemany("INSERT INTO projects VALUES (?, ?)", rows)
        conn.commit()
        conn.close()
        return str(db)

    def write_global(self, fname, entries):
        d = self.home / "memory"
        d.mkdir(parents=True, exist_ok=True)
        (d / fname).write_text(D.join(entries), encoding="utf-8")

    def global_entries(self, fname):
        return am._read_file(self.home / "memory" / fname)

    def test_roots_by_name(self):
        a = self.repo("alpha")
        b = self.repo("beta")
        nogit = self.tmp / "work" / "nogit"
        nogit.mkdir()
        db = self.make_db([(str(a), "Alpha"), (str(b), None), (str(nogit), "x"),
                           (str(self.tmp / "gone"), "gone"), ("", "empty"),
                           (str(a), "Alpha")])
        out = am._project_roots_by_name(db)
        self.assertEqual(out, {"Alpha": [str(a)], "alpha": [str(a)],
                               "beta": [str(b)]})
        self.assertEqual(am._project_roots_by_name(""), {})
        self.assertEqual(am._project_roots_by_name(str(self.tmp / "nodb")), {})

    def test_dry_run_plans_without_writing(self):
        a = self.repo("alpha")
        db = self.make_db([(str(a), "alpha")])
        entries = ["(alpha) one", "(ghost) two", "untagged three",
                   "(.atlas) junk", "recorded by dashboard remeasure (alpha)"]
        self.write_global("MEMORY.md", entries)
        plan = am.migrate_global_to_projects(str(self.home), db)
        self.assertFalse(plan["applied"])
        self.assertEqual(plan["moves"], {str(a): [("MEMORY.md", "(alpha) one")]})
        self.assertEqual(plan["stamps"],
                         [("MEMORY.md", "recorded by dashboard remeasure (alpha)")])
        self.assertEqual(plan["left"], [
            ("(ghost) two", "unknown project ghost"),
            ("untagged three", "no project tag"),
            ("(.atlas) junk", "no project tag"),
        ])
        self.assertEqual(self.global_entries("MEMORY.md"), entries)
        self.assertFalse((a / ".atlas").exists())

    def test_ambiguous_project_left(self):
        a = self.repo("one")
        b = self.tmp / "work2" / "one"
        (b / ".git").mkdir(parents=True)
        db = self.make_db([(str(a), "one"), (str(b), "one")])
        self.write_global("PROJECT.md", ["(one) fact"])
        plan = am.migrate_global_to_projects(str(self.home), db)
        self.assertEqual(plan["moves"], {})
        self.assertEqual(plan["left"], [("(one) fact", "ambiguous project")])

    def test_apply_moves_entries_and_archives_stamps(self):
        a = self.repo("alpha")
        b = self.repo("beta")
        db = self.make_db([(str(a), "alpha"), (str(b), "beta")])
        stamp = "re-baselined, supersedes #12 (alpha)"
        self.write_global("MEMORY.md", ["(alpha) a1", "(beta) b1", "(zzz) keep", stamp])
        self.write_global("PROJECT.md", ["(alpha) a2", "plain keep"])
        plan = am.migrate_global_to_projects(str(self.home), db, apply=True)
        self.assertTrue(plan["applied"])
        self.assertEqual(am.get_entries("project", root=str(a)),
                         ["(alpha) a1", "(alpha) a2"])
        self.assertEqual(am.get_entries("project", root=str(b)), ["(beta) b1"])
        self.assertEqual(self.global_entries("MEMORY.md"), ["(zzz) keep"])
        self.assertEqual(self.global_entries("PROJECT.md"), ["plain keep"])
        arch = list((self.home / "memory" / "archive").glob("MEMORY-*.md"))
        self.assertEqual(len(arch), 1)
        self.assertRegex(arch[0].name, r"^MEMORY-\d{4}-\d{2}\.md$")
        self.assertEqual(am._read_file(arch[0]), [stamp])
        self.assertEqual(list((self.home / "memory" / "archive").glob("PROJECT-*")), [])

    def test_apply_is_idempotent(self):
        a = self.repo("alpha")
        db = self.make_db([(str(a), "alpha")])
        self.write_global("MEMORY.md", ["(alpha) a1"])
        am.migrate_global_to_projects(str(self.home), db, apply=True)
        plan = am.migrate_global_to_projects(str(self.home), db, apply=True)
        self.assertEqual(plan["moves"], {})
        self.assertEqual(am.get_entries("project", root=str(a)), ["(alpha) a1"])

    def test_failed_project_write_keeps_entry_global(self):
        a = self.repo("alpha")
        db = self.make_db([(str(a), "alpha")])
        self.write_global("MEMORY.md", ["(alpha) a1"])
        with mock.patch.object(am, "add", return_value={"success": False}):
            plan = am.migrate_global_to_projects(str(self.home), db, apply=True)
        self.assertEqual(plan["left"], [("(alpha) a1", "project write failed")])
        self.assertEqual(self.global_entries("MEMORY.md"), ["(alpha) a1"])

    def test_only_root_limits_scope_and_skips_stamps(self):
        a = self.repo("alpha")
        b = self.repo("beta")
        db = self.make_db([(str(a), "alpha"), (str(b), "beta")])
        stamp = "recorded by dashboard remeasure (alpha)"
        self.write_global("MEMORY.md", ["(alpha) a1", "(beta) b1", stamp])
        plan = am.migrate_global_to_projects(str(self.home), db, apply=True,
                                             only_root=str(a))
        self.assertEqual(plan["stamps"], [])
        self.assertEqual(plan["moves"], {str(a): [("MEMORY.md", "(alpha) a1")]})
        self.assertEqual(self.global_entries("MEMORY.md"), ["(beta) b1", stamp])
        self.assertEqual(am.get_entries("project", root=str(b)), [])

    def test_only_root_bypasses_ambiguous_db(self):
        a = self.repo("dup")
        b = self.tmp / "old" / "dup"
        (b / ".git").mkdir(parents=True)
        db = self.make_db([(str(a), "dup"), (str(b), "dup")])
        self.write_global("MEMORY.md", ["(dup) fact"])
        plan = am.migrate_global_to_projects(str(self.home), db, only_root=str(a))
        self.assertEqual(plan["moves"], {str(a): [("MEMORY.md", "(dup) fact")]})
        self.assertEqual(plan["left"], [])

    def test_only_root_with_different_name_is_skipped(self):
        a = self.repo("alpha")
        b = self.repo("beta")
        db = self.make_db([(str(a), "alpha"), (str(b), "beta")])
        self.write_global("MEMORY.md", ["(beta) b1"])
        plan = am.migrate_global_to_projects(str(self.home), db, only_root=str(a))
        self.assertEqual(plan["moves"], {})
        self.assertEqual(plan["left"], [])

    def test_missing_global_files_yield_empty_plan(self):
        plan = am.migrate_global_to_projects(str(self.home), "", apply=True)
        self.assertEqual(plan, {"moves": {}, "stamps": [], "left": [], "applied": True})


class CliTargetTest(Base):
    def run_cli(self, argv):
        buf = io.StringIO()
        with mock.patch.object(sys, "argv", ["atlas_memory.py", *argv]), \
                redirect_stdout(buf):
            am._cli()
        return buf.getvalue()

    def test_list_defaults_to_memory_and_honors_target(self):
        am.add("memory", "global fact")
        am.add("project", "legacy project fact")
        self.assertIn("[0] global fact", self.run_cli(["list"]))
        out = self.run_cli(["list", "project"])
        self.assertIn("[0] legacy project fact", out)
        self.assertNotIn("global fact", out)

    def test_list_truncates_long_entries(self):
        am.add("memory", "x" * 200)
        out = self.run_cli(["list"])
        self.assertIn("x" * 120 + "...", out)
        self.assertNotIn("x" * 121, out)

    def test_add_remove_usage_targets(self):
        self.run_cli(["add", "project", "multi word", "entry"])
        self.assertEqual(am.get_entries("project"), ["multi word entry"])
        self.assertEqual(am.get_entries("memory"), [])
        self.run_cli(["add", "memory", "m1"])
        self.run_cli(["remove", "project", "multi word"])
        self.assertEqual(am.get_entries("project"), [])
        self.assertEqual(am.get_entries("memory"), ["m1"])
        import json
        u = json.loads(self.run_cli(["usage", "memory"]))
        self.assertEqual(u, am.usage("memory"))
        self.assertEqual(json.loads(self.run_cli(["usage", "project"])),
                         am.usage("project"))
        self.assertNotEqual(am.usage("memory"), am.usage("project"))


if __name__ == "__main__":
    unittest.main()
