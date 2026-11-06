"""Tests for plugin-health.py (loaded by path: the filename has a dash): counting helpers,
manifest parsing, and main()'s exit codes and PASS/FAIL lines."""

import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path

_SRC = Path(__file__).resolve().parent / "plugin-health.py"
_spec = importlib.util.spec_from_file_location("plugin_health_under_test", _SRC)
ph = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ph)


def make_plugin(root, skills=0, agents=0, manifest=None, raw_manifest=None):
    root = Path(root)
    for i in range(skills):
        d = root / "skills" / f"s{i}"
        d.mkdir(parents=True)
        (d / "SKILL.md").write_text("x")
    if agents:
        (root / "agents").mkdir(parents=True, exist_ok=True)
    for i in range(agents):
        (root / "agents" / f"a{i}.md").write_text("x")
    if manifest is not None or raw_manifest is not None:
        (root / ".claude-plugin").mkdir(parents=True, exist_ok=True)
        text = raw_manifest if raw_manifest is not None else json.dumps(manifest)
        (root / ".claude-plugin" / "plugin.json").write_text(text)
    return root


def run_main(argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        rc = ph.main(argv)
    return rc, out.getvalue(), err.getvalue()


class CountTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def test_missing_dirs_count_zero(self):
        self.assertEqual(ph.count_skill_files(self.root / "nope"), 0)
        self.assertEqual(ph.count_agent_files(self.root / "nope"), 0)

    def test_file_in_place_of_dir_counts_zero(self):
        (self.root / "skills").write_text("x")
        self.assertEqual(ph.count_skill_files(self.root / "skills"), 0)

    def test_skills_counted_recursively_and_only_skill_md(self):
        make_plugin(self.root, skills=2)
        (self.root / "skills" / "s0" / "README.md").write_text("x")
        (self.root / "skills" / "s0" / "nested" / "deep").mkdir(parents=True)
        (self.root / "skills" / "s0" / "nested" / "deep" / "SKILL.md").write_text("x")
        self.assertEqual(ph.count_skill_files(self.root / "skills"), 3)

    def test_agents_counted_only_top_level_md(self):
        make_plugin(self.root, agents=2)
        (self.root / "agents" / "notes.txt").write_text("x")
        (self.root / "agents" / "sub").mkdir()
        (self.root / "agents" / "sub" / "hidden.md").write_text("x")
        self.assertEqual(ph.count_agent_files(self.root / "agents"), 2)


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def test_no_manifest(self):
        self.assertEqual(ph.manifest_declared_counts(self.root), (None, None))

    def test_lists_are_counted(self):
        make_plugin(self.root, manifest={"skills": ["a", "b", "c"], "agents": ["x"]})
        self.assertEqual(ph.manifest_declared_counts(self.root), (3, 1))

    def test_integer_counts_used_as_is(self):
        make_plugin(self.root, manifest={"skills": 7, "agents": 0})
        self.assertEqual(ph.manifest_declared_counts(self.root), (7, 0))

    def test_non_count_values_become_none(self):
        make_plugin(self.root, manifest={"skills": "./skills", "agents": {"a": 1}})
        self.assertEqual(ph.manifest_declared_counts(self.root), (None, None))

    def test_missing_keys_become_none(self):
        make_plugin(self.root, manifest={"name": "atlas"})
        self.assertEqual(ph.manifest_declared_counts(self.root), (None, None))

    def test_one_side_declared(self):
        make_plugin(self.root, manifest={"skills": ["a"]})
        self.assertEqual(ph.manifest_declared_counts(self.root), (1, None))

    def test_corrupt_json_is_tolerated(self):
        make_plugin(self.root, raw_manifest="{not json")
        self.assertEqual(ph.manifest_declared_counts(self.root), (None, None))

    def test_unreadable_manifest_is_tolerated(self):
        make_plugin(self.root, raw_manifest="{}")
        (self.root / ".claude-plugin" / "plugin.json").write_bytes(b"\xff\xfe\x00bad")
        # invalid utf-8 raises UnicodeDecodeError, a ValueError subclass, not JSONDecodeError/OSError
        try:
            res = ph.manifest_declared_counts(self.root)
        except UnicodeDecodeError:
            self.fail("undecodable manifest must not crash the health check")
        self.assertEqual(res, (None, None))

    def test_manifest_directory_is_not_a_file(self):
        (self.root / ".claude-plugin" / "plugin.json").mkdir(parents=True)
        self.assertEqual(ph.manifest_declared_counts(self.root), (None, None))


class MainTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def test_usage_error(self):
        for argv in (["p"], ["p", "a", "b"]):
            rc, out, err = run_main(argv)
            self.assertEqual(rc, 2)
            self.assertIn("usage: plugin-health.py <plugin-root>", err)
            self.assertEqual(out, "")

    def test_missing_root_fails(self):
        rc, out, _ = run_main(["p", str(self.root / "gone")])
        self.assertEqual(rc, 1)
        self.assertIn("FAIL: plugin-root not found:", out)

    def test_matching_counts_pass(self):
        make_plugin(self.root, skills=2, agents=3, manifest={"skills": ["a", "b"], "agents": 3})
        rc, out, _ = run_main(["p", str(self.root)])
        self.assertEqual(rc, 0)
        self.assertIn("skills: actual=2 declared=2", out)
        self.assertIn("agents: actual=3 declared=3", out)
        self.assertIn("PASS: skills count matches manifest", out)
        self.assertIn("PASS: agents count matches manifest", out)
        self.assertNotIn("FAIL", out)

    def test_skill_mismatch_fails_but_still_reports_agents(self):
        make_plugin(self.root, skills=1, agents=1, manifest={"skills": 5, "agents": 1})
        rc, out, _ = run_main(["p", str(self.root)])
        self.assertEqual(rc, 1)
        self.assertIn("FAIL: skill count mismatch (actual 1 vs declared 5)", out)
        self.assertIn("PASS: agents count matches manifest", out)

    def test_agent_mismatch_fails(self):
        make_plugin(self.root, skills=1, agents=2, manifest={"skills": 1, "agents": 1})
        rc, out, _ = run_main(["p", str(self.root)])
        self.assertEqual(rc, 1)
        self.assertIn("FAIL: agent count mismatch (actual 2 vs declared 1)", out)
        self.assertIn("PASS: skills count matches manifest", out)

    def test_both_mismatch(self):
        make_plugin(self.root, skills=1, agents=1, manifest={"skills": 2, "agents": 2})
        rc, out, _ = run_main(["p", str(self.root)])
        self.assertEqual(rc, 1)
        self.assertEqual(out.count("FAIL:"), 2)

    def test_no_manifest_passes_with_none_declared(self):
        make_plugin(self.root, skills=1, agents=1)
        rc, out, _ = run_main(["p", str(self.root)])
        self.assertEqual(rc, 0)
        self.assertIn("declared=None", out)

    def test_zero_declared_vs_nonzero_actual_is_a_mismatch(self):
        make_plugin(self.root, skills=1, manifest={"skills": 0, "agents": 0})
        rc, out, _ = run_main(["p", str(self.root)])
        self.assertEqual(rc, 1)
        self.assertIn("actual 1 vs declared 0", out)

    def test_main_is_read_only(self):
        make_plugin(self.root, skills=1, agents=1, manifest={"skills": 1, "agents": 1})
        before = sorted(str(p) for p in self.root.rglob("*"))
        run_main(["p", str(self.root)])
        self.assertEqual(sorted(str(p) for p in self.root.rglob("*")), before)

    def test_real_atlas_plugin_is_consistent(self):
        # the shipped plugin must satisfy its own health check
        root = Path(__file__).resolve().parents[3]
        rc, out, _ = run_main(["p", str(root)])
        self.assertEqual(rc, 0, out)


if __name__ == "__main__":
    unittest.main()
