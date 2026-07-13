#!/usr/bin/env python3
"""In-process tests for discover_capabilities: scan() and main() branches."""

import contextlib
import io
import json
import os
import runpy
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import discover_capabilities  # noqa: E402


def write(path, contents=""):
    with open(path, "w") as f:
        f.write(contents)


class ScanTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        import shutil

        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_scan_empty_dir(self):
        c = discover_capabilities.scan(self.tmp)
        self.assertEqual(c["files"], 0)
        self.assertFalse(c["frontend"])
        self.assertFalse(c["terraform"])
        self.assertFalse(c["containers"])
        self.assertFalse(c["microsoft"])
        self.assertFalse(c["has_logs"])
        self.assertFalse(c["big_files"])
        self.assertFalse(c["has_mcp_servers"])
        self.assertTrue(c["has_loops"])  # has_loops is a static default
        self.assertEqual(c["dep_count"], 0)

    def test_scan_skip_dirs_excluded(self):
        os.mkdir(os.path.join(self.tmp, "node_modules"))
        write(os.path.join(self.tmp, "node_modules", "should_be_skipped.tf"))
        os.mkdir(os.path.join(self.tmp, ".git"))
        write(os.path.join(self.tmp, ".git", "skip.log"))
        c = discover_capabilities.scan(self.tmp)
        self.assertEqual(c["files"], 0)
        self.assertFalse(c["terraform"])
        self.assertFalse(c["has_logs"])

    def test_scan_mcp_servers_dir_marks_flag(self):
        os.mkdir(os.path.join(self.tmp, "mcp_servers"))
        c = discover_capabilities.scan(self.tmp)
        self.assertTrue(c["has_mcp_servers"])

    def test_scan_mcpb_file_marks_flag(self):
        write(os.path.join(self.tmp, "thing.mcpb"), "{}")
        c = discover_capabilities.scan(self.tmp)
        self.assertTrue(c["has_mcp_servers"])

    def test_scan_terraform_file(self):
        write(os.path.join(self.tmp, "main.tf"), 'resource "x" "y" {}\n')
        c = discover_capabilities.scan(self.tmp)
        self.assertTrue(c["terraform"])

    def test_scan_log_file(self):
        write(os.path.join(self.tmp, "app.log"), "line\n")
        c = discover_capabilities.scan(self.tmp)
        self.assertTrue(c["has_logs"])

    def test_scan_microsoft_files(self):
        for name in ("build.ps1", "proj.csproj", "sol.sln"):
            write(os.path.join(self.tmp, name), "x")
        c = discover_capabilities.scan(self.tmp)
        self.assertTrue(c["microsoft"])

    def test_scan_containers_dockerfile(self):
        write(os.path.join(self.tmp, "Dockerfile"), "FROM scratch\n")
        c = discover_capabilities.scan(self.tmp)
        self.assertTrue(c["containers"])

    def test_scan_containers_dockerfile_suffix(self):
        write(os.path.join(self.tmp, "web.dockerfile"), "FROM scratch\n")
        c = discover_capabilities.scan(self.tmp)
        self.assertTrue(c["containers"])

    def test_scan_containers_docker_compose(self):
        for name in ("docker-compose.yml", "docker-compose.yaml"):
            write(os.path.join(self.tmp, name), "version: '3'\n")
        c = discover_capabilities.scan(self.tmp)
        self.assertTrue(c["containers"])

    def test_scan_containers_k8s_yaml_path(self):
        os.mkdir(os.path.join(self.tmp, "k8s"))
        write(os.path.join(self.tmp, "k8s", "deployment.yaml"), "k: v\n")
        c = discover_capabilities.scan(self.tmp)
        self.assertTrue(c["containers"])

    def test_scan_containers_k8s_yaml_kustomize_name(self):
        # The kustomize trigger keys on the substring "kustomize" in the filename.
        write(os.path.join(self.tmp, "kustomize-overlay.yaml"), "k: v\n")
        c = discover_capabilities.scan(self.tmp)
        self.assertTrue(c["containers"])

    def test_scan_containers_k8s_yaml_deployment_name(self):
        write(os.path.join(self.tmp, "deployment.yml"), "k: v\n")
        c = discover_capabilities.scan(self.tmp)
        self.assertTrue(c["containers"])

    def test_scan_package_json_frontend_and_deps(self):
        pkg = {
            "dependencies": {"react": "^18.0.0"},
            "devDependencies": {"vitest": "^1.0.0"},
        }
        write(os.path.join(self.tmp, "package.json"), json.dumps(pkg))
        c = discover_capabilities.scan(self.tmp)
        self.assertTrue(c["frontend"])
        self.assertEqual(c["dep_count"], 2)

    def test_scan_package_json_non_frontend(self):
        pkg = {"dependencies": {"express": "^4.0.0"}}
        write(os.path.join(self.tmp, "package.json"), json.dumps(pkg))
        c = discover_capabilities.scan(self.tmp)
        self.assertFalse(c["frontend"])
        self.assertEqual(c["dep_count"], 1)

    def test_scan_package_json_deps_merge_takes_max(self):
        # Two package.jsons: the larger dep set wins (max).
        write(
            os.path.join(self.tmp, "package.json"),
            json.dumps({"dependencies": {"a": "1"}}),
        )
        os.mkdir(os.path.join(self.tmp, "sub"))
        write(
            os.path.join(self.tmp, "sub", "package.json"),
            json.dumps(
                {"dependencies": {"a": "1", "b": "2"}, "devDependencies": {"c": "3"}}
            ),
        )
        c = discover_capabilities.scan(self.tmp)
        self.assertEqual(c["dep_count"], 3)

    def test_scan_package_json_other_frontend_keys(self):
        for key in ("vue", "svelte", "next", "@angular/core", "solid-js"):
            sub = os.path.join(self.tmp, key.replace("/", "_"))
            os.mkdir(sub)
            write(
                os.path.join(sub, "package.json"),
                json.dumps({"dependencies": {key: "1"}}),
            )
        c = discover_capabilities.scan(self.tmp)
        self.assertTrue(c["frontend"])

    def test_scan_package_json_bad_json_swallowed(self):
        write(os.path.join(self.tmp, "package.json"), "{not valid json")
        c = discover_capabilities.scan(self.tmp)
        # No crash; dep_count stays 0, frontend stays False.
        self.assertEqual(c["dep_count"], 0)
        self.assertFalse(c["frontend"])

    def test_scan_big_file_flag(self):
        big = os.path.join(self.tmp, "huge.bin")
        with open(big, "wb") as f:
            f.truncate(1_000_001)
        c = discover_capabilities.scan(self.tmp)
        self.assertTrue(c["big_files"])

    def test_scan_getsize_error_swallowed(self):
        write(os.path.join(self.tmp, "x.tf"), "x")
        with mock.patch("os.path.getsize", side_effect=OSError("boom")):
            c = discover_capabilities.scan(self.tmp)
        # getsize raised -> big_files stays False, scan still completes.
        self.assertFalse(c["big_files"])
        self.assertTrue(c["terraform"])

    def test_scan_files_count(self):
        for name in ("a.tf", "b.log", "c.txt"):
            write(os.path.join(self.tmp, name), "x")
        c = discover_capabilities.scan(self.tmp)
        self.assertEqual(c["files"], 3)


class MainTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        import shutil

        shutil.rmtree(self.tmp, ignore_errors=True)

    def _run_main(self, argv):
        """Run main() capturing stdout; main calls sys.exit(0)."""
        buf = io.StringIO()
        with mock.patch.object(sys, "argv", argv), contextlib.redirect_stdout(buf):
            with self.assertRaises(SystemExit) as cm:
                discover_capabilities.main()
        self.assertEqual(cm.exception.code, 0)
        return buf.getvalue()

    def test_main_default_root_dot(self):
        out = self._run_main(["prog"])
        self.assertIn("Atlas capability recommendations:", out)
        self.assertIn("JSON:", out)
        # claude-mem and ponytail always match -> always present.
        self.assertIn("claude-mem", out)
        self.assertIn("ponytail", out)
        # Default root "." resolves to abspath of cwd.
        self.assertIn("scanned", out)

    def test_main_with_explicit_root(self):
        # Build a frontend project to trigger playwright/ui-ux-pro-max/context7 recs.
        write(
            os.path.join(self.tmp, "package.json"),
            json.dumps(
                {
                    "dependencies": {
                        k: "1"
                        for k in (
                            "react",
                            "vue",
                            "svelte",
                            "next",
                            "@angular/core",
                            "solid-js",
                            "extra1",
                            "extra2",
                        )
                    }
                }
            ),
        )
        write(os.path.join(self.tmp, "Dockerfile"), "FROM scratch\n")
        write(os.path.join(self.tmp, "main.tf"), "x\n")
        write(os.path.join(self.tmp, "build.ps1"), "x\n")
        write(os.path.join(self.tmp, "app.log"), "x\n")
        os.mkdir(os.path.join(self.tmp, "mcp_servers"))
        out = self._run_main(["prog", self.tmp])
        payload = json.loads(out.split("JSON:")[1])
        ids = {r["id"] for r in payload["recommendations"]}
        self.assertIn("playwright", ids)
        self.assertIn("ui-ux-pro-max", ids)
        self.assertIn("context7", ids)  # dep_count >= 8
        self.assertIn("microsoft-docs", ids)
        self.assertIn("iac-skill", ids)
        self.assertIn("container-tooling", ids)
        self.assertIn("context-mode", ids)  # has_logs True
        self.assertIn("connectors (atlas-setup)", ids)  # has_mcp_servers True
        # Each recommendation carries the required fields.
        for r in payload["recommendations"]:
            self.assertIn("type", r)
            self.assertIn("reason", r)
            self.assertIn("command", r)
        # Context reflects the scan.
        self.assertTrue(payload["context"]["frontend"])
        self.assertTrue(payload["context"]["terraform"])
        self.assertTrue(payload["context"]["containers"])
        self.assertTrue(payload["context"]["microsoft"])
        self.assertTrue(payload["context"]["has_logs"])
        self.assertTrue(payload["context"]["has_mcp_servers"])
        # scanned header references the abspath of the provided root.
        self.assertIn(os.path.abspath(self.tmp), out)

    def test_main_no_recommendations_branch(self):
        # Patch RULES to empty so the "no recommendations" branch fires.
        with mock.patch.object(discover_capabilities, "RULES", []):
            out = self._run_main(["prog", self.tmp])
        self.assertIn("(no recommendations beyond the base set)", out)
        payload = json.loads(out.split("JSON:")[1])
        self.assertEqual(payload["recommendations"], [])

    def test_main_match_exception_swallowed(self):
        bad_rule = {
            "id": "boom",
            "type": "plugin",
            "reason": "r",
            "cmd": "c",
            "match": lambda c: (_ for _ in ()).throw(RuntimeError("boom")),
        }
        with mock.patch.object(discover_capabilities, "RULES", [bad_rule]):
            out = self._run_main(["prog", self.tmp])
        # The raising rule is skipped -> no recs -> empty-set branch text.
        self.assertIn("(no recommendations beyond the base set)", out)
        payload = json.loads(out.split("JSON:")[1])
        self.assertEqual(payload["recommendations"], [])


class MainGuardTests(unittest.TestCase):
    def test_main_guard_invokes_main(self):
        # Execute the `if __name__ == "__main__": main()` guard in-process
        # via runpy so the guard line is covered (main() exits 0).
        with mock.patch.object(sys, "argv", ["prog", tempfile.mkdtemp()]):
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                with self.assertRaises(SystemExit) as cm:
                    runpy.run_module(
                        "discover_capabilities", run_name="__main__", alter_sys=True
                    )
            self.assertEqual(cm.exception.code, 0)
            self.assertIn("Atlas capability recommendations:", buf.getvalue())


class RulesTests(unittest.TestCase):
    def test_rules_shape(self):
        for r in discover_capabilities.RULES:
            self.assertIn("id", r)
            self.assertIn("type", r)
            self.assertIn("reason", r)
            self.assertIn("cmd", r)
            self.assertTrue(callable(r["match"]))

    def test_skip_dirs_contains_common_artifacts(self):
        for d in (".git", "node_modules", "__pycache__", "dist", "build"):
            self.assertIn(d, discover_capabilities.SKIP_DIRS)


if __name__ == "__main__":
    unittest.main()
