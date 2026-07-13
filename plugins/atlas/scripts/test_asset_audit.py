#!/usr/bin/env python3
"""Tests for the asset/context-audit lens: engine, IO, plan, apply, and CLI.

Run in-process so the source module is traced by coverage:
    python3 -m coverage run --source=asset_audit -m unittest test_asset_audit
"""

import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import asset_audit  # noqa: E402
import atlas_db  # noqa: E402


class TestDbLearningLoop(unittest.TestCase):
    """Original atlas_db learning-loop coverage (kept, wrapped for unittest)."""

    def test_db_learning_loop(self):
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        try:
            conn = atlas_db.connect(path)
            atlas_db.init(conn)
            pid = atlas_db.register_project(conn, "/tmp/proj", "proj", "python")
            assets = [
                {
                    "kind": "skill",
                    "key": "salesforce-flow",
                    "tags": ["salesforce"],
                    "verdict": "disable-here",
                    "est_tokens": 100,
                },
                {
                    "kind": "skill",
                    "key": "git-commit",
                    "tags": [],
                    "verdict": "keep",
                    "est_tokens": 50,
                },
            ]
            atlas_db.record_asset_verdicts(conn, pid, assets)
            # keep verdicts are not stored
            self.assertEqual(atlas_db.asset_audit_summary(conn)["verdicts"], 1)
            # restore = learning signal -> suppressed next time
            atlas_db.mark_asset_applied(conn, "skill", "salesforce-flow")
            atlas_db.note_asset_restore(conn, "skill", "salesforce-flow")
            self.assertIn(("skill", "salesforce-flow"), atlas_db.suppressed_assets(conn))
            s = atlas_db.asset_audit_summary(conn)
            self.assertEqual(s["applied"], 1)
            self.assertEqual(s["restored"], 1)
            self.assertEqual(s["false_positive_rate"], 1.0)
        finally:
            os.remove(path)


class TestEstTokens(unittest.TestCase):
    def test_min_one_for_empty(self):
        self.assertEqual(asset_audit.est_tokens(""), 1)

    def test_chars_divided_by_four(self):
        self.assertEqual(asset_audit.est_tokens("abcd"), 1)
        self.assertEqual(asset_audit.est_tokens("abcde"), 1)  # 5//4 == 1
        self.assertEqual(asset_audit.est_tokens("abcdefgh"), 2)


class TestRead(unittest.TestCase):
    def test_reads_file_content(self):
        fd, path = tempfile.mkstemp(suffix=".txt")
        try:
            with os.fdopen(fd, "w") as f:
                f.write("hello world")
            self.assertEqual(asset_audit._read(path), "hello world")
        finally:
            os.remove(path)

    def test_respects_limit(self):
        fd, path = tempfile.mkstemp(suffix=".txt")
        try:
            with os.fdopen(fd, "w") as f:
                f.write("0123456789" * 100)
            self.assertEqual(len(asset_audit._read(path, limit=37)), 37)
        finally:
            os.remove(path)

    def test_missing_file_returns_empty(self):
        self.assertEqual(asset_audit._read("/nonexistent/path/here"), "")


class TestFrontmatterDesc(unittest.TestCase):
    def test_extracts_name_and_description(self):
        fd, path = tempfile.mkstemp(suffix=".md")
        try:
            with os.fdopen(fd, "w") as f:
                f.write("---\nname: My Skill\ndescription: A react frontend helper\n---\nbody\n")
            name, desc = asset_audit._frontmatter_desc(path)
            self.assertEqual(name, "My Skill")
            self.assertEqual(desc, "A react frontend helper")
        finally:
            os.remove(path)

    def test_falls_back_to_dirname_when_no_name(self):
        d = tempfile.mkdtemp()
        try:
            skill_md = os.path.join(d, "SKILL.md")
            with open(skill_md, "w") as f:
                f.write("no frontmatter here")
            name, desc = asset_audit._frontmatter_desc(skill_md)
            self.assertEqual(name, os.path.basename(d))
            self.assertEqual(desc, "")
        finally:
            shutil.rmtree(d)


class TestTagsFor(unittest.TestCase):
    def test_frontend_tag(self):
        self.assertIn("frontend", asset_audit.tags_for("a react component"))

    def test_mcp_tag(self):
        self.assertIn("mcp", asset_audit.tags_for("build an MCP server"))

    def test_universal_returns_empty(self):
        self.assertEqual(asset_audit.tags_for("commit message helper"), set())

    def test_multiple_tags(self):
        t = asset_audit.tags_for("azure bicep + powerbi dax report")
        self.assertIn("azure", t)
        self.assertIn("powerbi", t)


class TestInventory(unittest.TestCase):
    def _make_skill(self, parent, key, name, desc):
        d = os.path.join(parent, key)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "SKILL.md"), "w") as f:
            f.write(f"---\nname: {name}\ndescription: {desc}\n---\n")

    def test_inventory_skills_and_agents(self):
        sdir = tempfile.mkdtemp()
        adir = tempfile.mkdtemp()
        try:
            self._make_skill(sdir, "react-helper", "React", "react frontend")
            self._make_skill(sdir, "plain-tool", "Plain", "a generic helper")
            # a non-SKILL.md entry should be skipped
            os.makedirs(os.path.join(sdir, "no-skill"))
            with open(os.path.join(sdir, "no-skill", "README.md"), "w") as f:
                f.write("x")
            with open(os.path.join(adir, "code-reviewer.md"), "w") as f:
                f.write("description: review code with python tooling")
            with open(os.path.join(adir, "not-md.txt"), "w") as f:
                f.write("ignored")
            with mock.patch.object(asset_audit, "USER_SKILLS", sdir), \
                 mock.patch.object(asset_audit, "USER_AGENTS", adir):
                assets = asset_audit.inventory()
            by_key = {a["key"]: a for a in assets}
            self.assertIn("react-helper", by_key)
            self.assertEqual(by_key["react-helper"]["kind"], "skill")
            self.assertIn("frontend", by_key["react-helper"]["tags"])
            self.assertIn("plain-tool", by_key)
            self.assertEqual(by_key["plain-tool"]["tags"], [])  # universal
            self.assertIn("code-reviewer", by_key)
            self.assertEqual(by_key["code-reviewer"]["kind"], "agent")
            self.assertIn("python", by_key["code-reviewer"]["tags"])
            self.assertNotIn("not-md", by_key)
            self.assertNotIn("no-skill", by_key)
        finally:
            shutil.rmtree(sdir)
            shutil.rmtree(adir)

    def test_inventory_empty_when_dirs_missing(self):
        with mock.patch.object(asset_audit, "USER_SKILLS", "/no/such/skills"), \
             mock.patch.object(asset_audit, "USER_AGENTS", "/no/such/agents"):
            self.assertEqual(asset_audit.inventory(), [])


class TestDetectProjectTags(unittest.TestCase):
    def test_detects_python_and_node(self):
        d = tempfile.mkdtemp()
        try:
            with open(os.path.join(d, "pyproject.toml"), "w") as f:
                f.write("[tool.poetry]\n")
            with open(os.path.join(d, "tsconfig.json"), "w") as f:
                f.write("{}")
            tags = asset_audit.detect_project_tags(d)
            self.assertIn("python", tags)
            self.assertIn("node-ts", tags)
        finally:
            shutil.rmtree(d)

    def test_detects_dotnet_java_rust_go_php(self):
        d = tempfile.mkdtemp()
        try:
            for fn in ("App.csproj", "pom.xml", "Cargo.toml", "go.mod", "composer.json"):
                with open(os.path.join(d, fn), "w") as f:
                    f.write("x")
            tags = asset_audit.detect_project_tags(d)
            self.assertIn("dotnet", tags)
            self.assertIn("java", tags)
            self.assertIn("rust", tags)
            self.assertIn("go", tags)
            self.assertIn("php", tags)
        finally:
            shutil.rmtree(d)

    def test_detects_terraform_via_tf_file(self):
        d = tempfile.mkdtemp()
        try:
            # The terraform signal is `.tf$` (re.M); blob is single-line so the
            # .tf file must be the last/only name for the anchor to match.
            with open(os.path.join(d, "main.tf"), "w") as f:
                f.write("x")
            tags = asset_audit.detect_project_tags(d)
            self.assertIn("terraform", tags)
        finally:
            shutil.rmtree(d)

    def test_detects_azure_and_mcp_via_files(self):
        d = tempfile.mkdtemp()
        try:
            with open(os.path.join(d, "azure-pipelines.yml"), "w") as f:
                f.write("x")
            with open(os.path.join(d, "manifest.json"), "w") as f:
                f.write("{}")
            tags = asset_audit.detect_project_tags(d)
            self.assertIn("azure", tags)
            self.assertIn("mcp", tags)
        finally:
            shutil.rmtree(d)

    def test_package_json_frontend_and_mcp_sniff(self):
        d = tempfile.mkdtemp()
        try:
            with open(os.path.join(d, "package.json"), "w") as f:
                json.dump(
                    {"dependencies": {"react": "18", "@modelcontextprotocol/sdk": "1"}},
                    f,
                )
            tags = asset_audit.detect_project_tags(d)
            self.assertIn("frontend", tags)
            self.assertIn("mcp", tags)
        finally:
            shutil.rmtree(d)

    def test_empty_dir_no_tags(self):
        d = tempfile.mkdtemp()
        try:
            self.assertEqual(set(), asset_audit.detect_project_tags(d))
        finally:
            shutil.rmtree(d)

    def test_walk_skips_vendored_and_deep_dirs(self):
        d = tempfile.mkdtemp()
        try:
            # A .tf file nested 3 levels deep should not be walked (depth >= 2 prunes).
            deep = os.path.join(d, "a", "b", "c")
            os.makedirs(deep)
            with open(os.path.join(deep, "buried.tf"), "w") as f:
                f.write("x")
            # node_modules should be pruned.
            nm = os.path.join(d, "node_modules", "pkg")
            os.makedirs(nm)
            with open(os.path.join(nm, "package.json"), "w") as f:
                f.write("{}")
            tags = asset_audit.detect_project_tags(d)
            self.assertNotIn("terraform", tags)
            self.assertNotIn("node-ts", tags)
        finally:
            shutil.rmtree(d)


class TestClassify(unittest.TestCase):
    def _asset(self, key, tags):
        return {"kind": "skill", "key": key, "tags": tags}

    def test_all_four_verdicts(self):
        assets = [
            self._asset("react-thing", ["frontend"]),
            self._asset("git-commit", []),
            self._asset("rhino3d", ["novelty"]),
            self._asset("azure-rbac", ["azure"]),
        ]
        project_tags = {"frontend"}
        other = set(asset_audit.TAXONOMY) - {"novelty"}
        asset_audit.classify(assets, project_tags, other)
        v = {a["key"]: a["verdict"] for a in assets}
        self.assertEqual(v["react-thing"], "keep")  # matches project
        self.assertEqual(v["git-commit"], "keep")  # universal
        self.assertEqual(v["azure-rbac"], "disable-here")  # off-stack here, elsewhere
        self.assertEqual(v["rhino3d"], "relocate-global")  # novelty, nowhere
        for a in assets:
            self.assertTrue(a["reason"])

    def test_relocate_global_when_off_stack_everywhere(self):
        assets = [self._asset("salesforce-apex", ["salesforce"])]
        other = {"frontend"}  # salesforce not in other
        asset_audit.classify(assets, set(), other)
        self.assertEqual(assets[0]["verdict"], "relocate-global")
        self.assertIn("salesforce", assets[0]["reason"])

    def test_keep_reason_lists_matching_tags(self):
        assets = [self._asset("react-thing", ["frontend", "node-ts"])]
        asset_audit.classify(assets, {"frontend"}, set(asset_audit.TAXONOMY))
        self.assertEqual(assets[0]["verdict"], "keep")
        self.assertIn("frontend", assets[0]["reason"])


class TestBuildPlan(unittest.TestCase):
    def test_auto_only_novelty_relocate_global(self):
        assets = [
            {"kind": "skill", "key": "rhino3d", "tags": ["novelty"],
             "verdict": "relocate-global", "reason": "r", "est_tokens": 200, "path": "/x"},
            {"kind": "skill", "key": "salesforce", "tags": ["salesforce"],
             "verdict": "relocate-global", "reason": "r", "est_tokens": 100, "path": "/y"},
            {"kind": "skill", "key": "azure-rbac", "tags": ["azure"],
             "verdict": "disable-here", "reason": "r", "est_tokens": 50, "path": "/z"},
            {"kind": "skill", "key": "keepme", "tags": [],
             "verdict": "keep", "reason": "r", "est_tokens": 5, "path": "/k"},
        ]
        plan = asset_audit.build_plan(assets)
        auto_keys = {it["key"] for it in plan["auto"]}
        self.assertEqual(auto_keys, {"rhino3d"})
        confirm_keys = {it["key"] for it in plan["confirm"]}
        self.assertEqual(confirm_keys, {"salesforce", "azure-rbac"})
        self.assertEqual(plan["auto"][0]["key"], "rhino3d")  # sorted by tokens desc
        self.assertEqual(plan["confirm"][0]["key"], "salesforce")

    def test_plan_item_fields(self):
        assets = [
            {"kind": "agent", "key": "rhino3d", "tags": ["novelty"],
             "verdict": "relocate-global", "reason": "r", "est_tokens": 200,
             "path": "/x", "name": "extra-field"},
        ]
        plan = asset_audit.build_plan(assets)
        item = plan["auto"][0]
        self.assertEqual(
            set(item.keys()), {"kind", "key", "verdict", "reason", "est_tokens", "path"}
        )
        self.assertEqual(item["path"], "/x")


class TestSummarize(unittest.TestCase):
    def test_counts_and_reclaimable(self):
        assets = [
            {"verdict": "keep", "est_tokens": 10},
            {"verdict": "keep", "est_tokens": 20},
            {"verdict": "disable-here", "est_tokens": 100},
            {"verdict": "relocate-global", "est_tokens": 50},
        ]
        plan = {"auto": [{"x": 1}], "confirm": [{"y": 2}, {"z": 3}]}
        s = asset_audit.summarize(assets, {"frontend"}, plan)
        self.assertEqual(s["assets_total"], 4)
        self.assertEqual(s["keep"], 2)
        self.assertEqual(s["disable_here"], 1)
        self.assertEqual(s["relocate_global"], 1)
        self.assertEqual(s["est_tokens_reclaimable_here"], 150)
        self.assertEqual(s["auto_actions"], 1)
        self.assertEqual(s["confirm_actions"], 2)
        self.assertEqual(s["project_tags"], ["frontend"])


class TestDb(unittest.TestCase):
    def test_db_success_returns_module_and_conn(self):
        fake_conn = object()
        with mock.patch.object(atlas_db, "connect", return_value=fake_conn), \
             mock.patch.object(atlas_db, "init", return_value=None) as init_mock:
            db, conn = asset_audit._db()
        self.assertIs(db, atlas_db)
        self.assertIs(conn, fake_conn)
        init_mock.assert_called_once_with(fake_conn)

    def test_db_fail_open_returns_none(self):
        with mock.patch.object(atlas_db, "connect", side_effect=RuntimeError("boom")):
            db, conn = asset_audit._db()
        self.assertIsNone(db)
        self.assertIsNone(conn)


class TestApplyAuto(unittest.TestCase):
    def test_moves_files_writes_manifest_and_marks_applied(self):
        work = tempfile.mkdtemp()
        try:
            src_dir = os.path.join(work, "skills")
            disabled_dir = os.path.join(work, "skills-disabled")
            manifest_dir = os.path.join(work, "manifests")
            os.makedirs(src_dir)
            os.makedirs(disabled_dir)
            manifest = os.path.join(manifest_dir, "auto.tsv")
            skill_src = os.path.join(src_dir, "rhino3d")
            os.makedirs(skill_src)
            with open(os.path.join(skill_src, "SKILL.md"), "w") as f:
                f.write("x")

            plan = {"auto": [{
                "kind": "skill", "key": "rhino3d", "path": skill_src,
                "verdict": "relocate-global", "reason": "novelty", "est_tokens": 50,
            }]}
            disabled_map = {"skill": disabled_dir,
                             "agent": os.path.join(work, "agents-disabled")}
            marks = []

            class FakeDb:
                @staticmethod
                def mark_asset_applied(conn, kind, key):
                    marks.append((kind, key))

            with mock.patch.object(asset_audit, "DISABLED", disabled_map), \
                 mock.patch.object(asset_audit, "MANIFEST", manifest):
                moved = asset_audit.apply_auto(plan, FakeDb, "conn")
            self.assertEqual(len(moved), 1)
            self.assertFalse(os.path.exists(skill_src))
            dest = os.path.join(disabled_dir, "rhino3d")
            self.assertTrue(os.path.exists(dest))
            with open(manifest) as f:
                line = f.read()
            self.assertEqual(line.strip(), f"{dest}\t{skill_src}")
            self.assertEqual(marks, [("skill", "rhino3d")])
        finally:
            shutil.rmtree(work)

    def test_skips_when_dest_exists(self):
        work = tempfile.mkdtemp()
        try:
            src_dir = os.path.join(work, "skills")
            disabled_dir = os.path.join(work, "skills-disabled")
            os.makedirs(src_dir)
            os.makedirs(disabled_dir)
            skill_src = os.path.join(src_dir, "rhino3d")
            os.makedirs(skill_src)
            agent_disabled_dir = os.path.join(work, "agents-disabled")
            os.makedirs(agent_disabled_dir)
            dest = os.path.join(disabled_dir, "rhino3d")
            os.makedirs(dest)  # pre-create dest -> skip rename

            manifest = os.path.join(work, "auto.tsv")
            plan = {"auto": [{
                "kind": "skill", "key": "rhino3d", "path": skill_src,
                "verdict": "relocate-global", "reason": "novelty", "est_tokens": 50,
            }]}
            with mock.patch.object(asset_audit, "DISABLED",
                                    {"skill": disabled_dir, "agent": agent_disabled_dir}), \
                 mock.patch.object(asset_audit, "MANIFEST", manifest):
                moved = asset_audit.apply_auto(plan, None, None)
            self.assertEqual(moved, [])
            self.assertTrue(os.path.exists(skill_src))
        finally:
            shutil.rmtree(work)

    def test_skips_when_src_missing(self):
        work = tempfile.mkdtemp()
        try:
            disabled_dir = os.path.join(work, "skills-disabled")
            os.makedirs(disabled_dir)
            agent_disabled_dir = os.path.join(work, "agents-disabled")
            os.makedirs(agent_disabled_dir)
            manifest = os.path.join(work, "auto.tsv")
            plan = {"auto": [{
                "kind": "skill", "key": "ghost", "path": "/no/such/ghost",
                "verdict": "relocate-global", "reason": "novelty", "est_tokens": 5,
            }]}
            with mock.patch.object(asset_audit, "DISABLED",
                                    {"skill": disabled_dir, "agent": agent_disabled_dir}), \
                 mock.patch.object(asset_audit, "MANIFEST", manifest):
                moved = asset_audit.apply_auto(plan, None, None)
            self.assertEqual(moved, [])
        finally:
            shutil.rmtree(work)

    def test_db_mark_raises_is_swallowed(self):
        work = tempfile.mkdtemp()
        try:
            src_dir = os.path.join(work, "skills")
            disabled_dir = os.path.join(work, "skills-disabled")
            os.makedirs(src_dir)
            os.makedirs(disabled_dir)
            skill_src = os.path.join(src_dir, "rhino3d")
            os.makedirs(skill_src)
            manifest = os.path.join(work, "auto.tsv")

            class BoomDb:
                @staticmethod
                def mark_asset_applied(conn, kind, key):
                    raise RuntimeError("db down")

            plan = {"auto": [{
                "kind": "skill", "key": "rhino3d", "path": skill_src,
                "verdict": "relocate-global", "reason": "novelty", "est_tokens": 5,
            }]}
            agent_disabled_dir = os.path.join(work, "agents-disabled")
            os.makedirs(agent_disabled_dir)
            with mock.patch.object(asset_audit, "DISABLED",
                                    {"skill": disabled_dir, "agent": agent_disabled_dir}), \
                 mock.patch.object(asset_audit, "MANIFEST", manifest):
                moved = asset_audit.apply_auto(plan, BoomDb, None)
            self.assertEqual(len(moved), 1)  # move still succeeds
        finally:
            shutil.rmtree(work)


class TestMain(unittest.TestCase):
    """Drive main() under coverage with mocked inventory and a temp project root."""

    def _base_assets(self):
        return [
            {"kind": "skill", "key": "react-helper", "name": "React",
             "tags": ["frontend"], "est_tokens": 100, "path": "/skills/react-helper"},
            {"kind": "skill", "key": "git-commit", "name": "Git",
             "tags": [], "est_tokens": 30, "path": "/skills/git-commit"},
            {"kind": "skill", "key": "rhino3d", "name": "Rhino",
             "tags": ["novelty"], "est_tokens": 200, "path": "/skills/rhino3d"},
            {"kind": "skill", "key": "azure-rbac", "name": "Azure",
             "tags": ["azure"], "est_tokens": 80, "path": "/skills/azure-rbac"},
        ]

    def test_main_text_output(self):
        assets = self._base_assets()
        d = tempfile.mkdtemp()
        try:
            with mock.patch.object(asset_audit, "inventory", return_value=assets), \
                 mock.patch.object(asset_audit, "detect_project_tags",
                                   return_value={"frontend"}), \
                 mock.patch.object(asset_audit, "_db", return_value=(None, None)), \
                 mock.patch.object(asset_audit, "apply_auto", return_value=[]):
                buf = io.StringIO()
                with mock.patch("sys.stdout", buf):
                    rc = asset_audit.main(["asset_audit", d])
            out = buf.getvalue()
            self.assertEqual(rc, 0)
            self.assertIn("# atlas-audit asset audit", out)
            self.assertIn("detected stack: frontend", out)
            self.assertIn("rhino3d", out)  # auto
            self.assertIn("azure-rbac", out)  # confirm
            self.assertIn("AUTO (low-risk", out)
            self.assertIn("CONFIRM (needs your eyes)", out)
            self.assertIn("use --apply to relocate", out)
        finally:
            shutil.rmtree(d)

    def test_main_json_output(self):
        assets = self._base_assets()
        d = tempfile.mkdtemp()
        try:
            with mock.patch.object(asset_audit, "inventory", return_value=assets), \
                 mock.patch.object(asset_audit, "detect_project_tags",
                                   return_value=set()), \
                 mock.patch.object(asset_audit, "_db", return_value=(None, None)), \
                 mock.patch.object(asset_audit, "apply_auto", return_value=[]):
                buf = io.StringIO()
                with mock.patch("sys.stdout", buf):
                    rc = asset_audit.main(["asset_audit", d, "--json"])
            self.assertEqual(rc, 0)
            data = json.loads(buf.getvalue())
            self.assertIn("summary", data)
            self.assertIn("plan", data)
            self.assertEqual(data["summary"]["assets_total"], 4)
        finally:
            shutil.rmtree(d)

    def test_main_apply_moves_auto_out_of_plan(self):
        assets = self._base_assets()
        d = tempfile.mkdtemp()
        try:
            applied = [{
                "kind": "skill", "key": "rhino3d", "path": "/skills/rhino3d",
                "verdict": "relocate-global", "reason": "novelty", "est_tokens": 200,
            }]
            with mock.patch.object(asset_audit, "inventory", return_value=assets), \
                 mock.patch.object(asset_audit, "detect_project_tags",
                                   return_value=set()), \
                 mock.patch.object(asset_audit, "_db", return_value=(None, None)), \
                 mock.patch.object(asset_audit, "apply_auto", return_value=applied) as ap:
                buf = io.StringIO()
                with mock.patch("sys.stdout", buf):
                    rc = asset_audit.main(["asset_audit", d, "--apply"])
            self.assertEqual(rc, 0)
            ap.assert_called_once()
            out = buf.getvalue()
            self.assertIn("APPLIED now: relocated 1", out)
            self.assertIn("restore:", out)
        finally:
            shutil.rmtree(d)

    def test_main_db_suppressed_overrides_verdict(self):
        assets = self._base_assets()
        d = tempfile.mkdtemp()
        try:
            class FakeDb:
                recorded = None

                @staticmethod
                def suppressed_assets(conn):
                    return {("skill", "azure-rbac")}

                @staticmethod
                def register_project(conn, root):
                    return 7

                @staticmethod
                def record_asset_verdicts(conn, pid, assets):
                    FakeDb.recorded = (pid, assets)

            with mock.patch.object(asset_audit, "inventory", return_value=assets), \
                 mock.patch.object(asset_audit, "detect_project_tags",
                                   return_value={"frontend"}), \
                 mock.patch.object(asset_audit, "_db",
                                   return_value=(FakeDb, "conn")), \
                 mock.patch.object(asset_audit, "apply_auto", return_value=[]):
                buf = io.StringIO()
                with mock.patch("sys.stdout", buf):
                    rc = asset_audit.main(["asset_audit", d])
            self.assertEqual(rc, 0)
            azure = next(a for a in assets if a["key"] == "azure-rbac")
            self.assertEqual(azure["verdict"], "keep")
            self.assertIn("suppressed", azure["reason"])
            self.assertEqual(FakeDb.recorded[0], 7)  # type: ignore[reportOptionalSubscript]  # recorded set by record_asset_verdicts in main()
        finally:
            shutil.rmtree(d)

    def test_main_db_exception_is_swallowed(self):
        assets = self._base_assets()
        d = tempfile.mkdtemp()
        try:
            class FakeDb:
                @staticmethod
                def suppressed_assets(conn):
                    raise RuntimeError("db down")

            with mock.patch.object(asset_audit, "inventory", return_value=assets), \
                 mock.patch.object(asset_audit, "detect_project_tags",
                                   return_value={"frontend"}), \
                 mock.patch.object(asset_audit, "_db",
                                   return_value=(FakeDb, "conn")), \
                 mock.patch.object(asset_audit, "apply_auto", return_value=[]):
                buf = io.StringIO()
                with mock.patch("sys.stdout", buf):
                    rc = asset_audit.main(["asset_audit", d])
            self.assertEqual(rc, 0)  # swallowed, original verdicts preserved
            self.assertIn("# atlas-audit asset audit", buf.getvalue())
        finally:
            shutil.rmtree(d)

    def test_main_no_arg_uses_cwd(self):
        cwd = os.getcwd()
        with mock.patch.object(asset_audit, "inventory", return_value=[]), \
             mock.patch.object(asset_audit, "detect_project_tags",
                               return_value=set()) as detect, \
             mock.patch.object(asset_audit, "_db", return_value=(None, None)), \
             mock.patch.object(asset_audit, "apply_auto", return_value=[]):
            buf = io.StringIO()
            with mock.patch("sys.stdout", buf):
                rc = asset_audit.main(["asset_audit"])
        self.assertEqual(rc, 0)
        detect.assert_called_once_with(cwd)
        self.assertIn(f"project: {cwd}", buf.getvalue())

    def test_main_flag_arg_not_used_as_root(self):
        with mock.patch.object(asset_audit, "inventory", return_value=[]), \
             mock.patch.object(asset_audit, "detect_project_tags",
                               return_value=set()), \
             mock.patch.object(asset_audit, "_db", return_value=(None, None)), \
             mock.patch.object(asset_audit, "apply_auto", return_value=[]):
            rc = asset_audit.main(["asset_audit", "--json"])
        self.assertEqual(rc, 0)

    def test_main_confirm_truncation_message(self):
        confirm = [
            {"kind": "skill", "key": f"azure-{i}", "name": "Azure",
             "tags": ["azure"], "est_tokens": 10, "path": f"/s/{i}"}
            for i in range(35)
        ]
        with mock.patch.object(asset_audit, "inventory", return_value=confirm), \
             mock.patch.object(asset_audit, "detect_project_tags",
                               return_value=set()), \
             mock.patch.object(asset_audit, "_db", return_value=(None, None)), \
             mock.patch.object(asset_audit, "apply_auto", return_value=[]):
            buf = io.StringIO()
            with mock.patch("sys.stdout", buf):
                rc = asset_audit.main(["asset_audit", "/tmp", "--apply"])
        self.assertEqual(rc, 0)
        self.assertIn("+5 more (use --json for the full plan)", buf.getvalue())


class TestEngineClassifiesAndLevels(unittest.TestCase):
    """Original engine+plan coverage (kept, wrapped for unittest)."""

    def test_engine_classifies_and_levels(self):
        assets = [
            {"kind": "skill", "key": "react-thing", "tags": ["frontend"]},
            {"kind": "skill", "key": "git-commit", "tags": []},
            {"kind": "skill", "key": "rhino3d", "tags": ["novelty"]},
            {"kind": "skill", "key": "azure-rbac", "tags": ["azure"]},
        ]
        project_tags = {"frontend"}
        other = set(asset_audit.TAXONOMY) - {"novelty"}
        asset_audit.classify(assets, project_tags, other)
        v = {a["key"]: a["verdict"] for a in assets}
        assert v["react-thing"] == "keep"  # matches project
        assert v["git-commit"] == "keep"  # universal
        assert v["azure-rbac"] == "disable-here"  # off-stack here, used elsewhere
        assert v["rhino3d"] == "relocate-global"  # novelty, nowhere
        for a in assets:
            a.setdefault("est_tokens", 10)
            a.setdefault("reason", "")
            a.setdefault("path", "/x")
        plan = asset_audit.build_plan(assets)
        auto_keys = {it["key"] for it in plan["auto"]}
        assert auto_keys == {"rhino3d"}  # only novelty auto-applies


class TestTagging(unittest.TestCase):
    """Original tagging coverage (kept, wrapped for unittest)."""

    def test_tagging(self):
        assert "frontend" in asset_audit.tags_for("a react component")
        assert "mcp" in asset_audit.tags_for("build an MCP server")
        assert asset_audit.tags_for("commit message helper") == set()  # universal


if __name__ == "__main__":
    unittest.main(verbosity=2)
